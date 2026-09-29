const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, parseOptions, supportsNode, availableSimulators, validateTestSummary, inspectRepository,
  createReportDirectory, commandRunner, buildSteps } = require('../scripts/check-mac.cjs');
const root = path.resolve(__dirname, '..');
const simulator = '12345678-1234-1234-1234-123456789ABC';
const list = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
  { udid: simulator, name: 'Synthetic iPhone', isAvailable: true },
  { udid: '87654321-1234-1234-1234-123456789ABC', isAvailable: false },
], 'com.apple.CoreSimulator.SimRuntime.tvOS-27-0': [
  { udid: '87654321-1234-1234-1234-123456789ABC', isAvailable: true },
] } };
const passed = { testResult: 'Passed', totalTestCount: 65, passedTests: 65, failedTests: 0, skippedTests: 0 };
function fixture(overrides = {}) {
  const commands = [], writes = [], messages = [];
  let directories = 0;
  const deps = { platform: 'darwin', nodeVersion: '26.0.0', root, inspect: () => 65,
    createDirectory: () => { directories++; return path.join(root, '.build', 'synthetic-only'); },
    write: (file, value) => writes.push({ file, value: JSON.parse(value) }), out: (line) => messages.push(line),
    run: async (command, args, options) => {
      commands.push({ command, args, options });
      let stdout = '';
      if (command === 'xcode-select') stdout = '/Applications/Xcode.app/Contents/Developer';
      if (command === 'xcodebuild' && args[0] === '-version') stdout = 'Xcode 27.0\nBuild version synthetic';
      if (command === 'mise' && args.includes('ruby')) stdout = '3.3.12';
      if (args.includes('simctl')) stdout = JSON.stringify(list);
      if (args.includes('xcresulttool')) stdout = JSON.stringify(passed);
      return { stdout, code: 0, signal: null, truncated: false };
    }, ...overrides };
  return { deps, commands, writes, messages, directories: () => directories,
    run: () => main(['--simulator', simulator], deps) };
}
function repoIO(change = {}) {
  return { ...fs,
    readFileSync(file, encoding) {
      if (file.endsWith(path.join('Pods', 'Manifest.lock'))) return fs.readFileSync(path.join(root, 'ios/Podfile.lock'), encoding);
      return fs.readFileSync(file, encoding);
    }, ...change };
}

test('Mac acceptance accepts only explicit modes and one simulator UUID', () => {
  assert.equal(parseOptions(['--simulator', simulator.toLowerCase()]).simulator, simulator);
  for (const args of [[], ['--skip-tests'], ['--simulator', 'iPhone'], ['--plan', '--simulator', simulator],
    ['--simulator', simulator, 'CODE_SIGNING_ALLOWED=YES'], ['--simulator', simulator + ';erase']])
    assert.throws(() => parseOptions(args), /用法/);
});

test('Windows plan executes no tools and writes no files', async () => {
  const f = fixture({ platform: 'win32' });
  assert.deepEqual(await main(['--plan'], f.deps), { status: 'planned' });
  assert.equal(f.commands.length + f.writes.length + f.directories(), 0);
  assert.match(f.messages.join('\n'), /没有执行/);
});

test('Windows actual run and simulator listing fail before any side effect', async () => {
  const f = fixture({ platform: 'win32' });
  await assert.rejects(f.run(), /仅支持 Mac/);
  await assert.rejects(main(['--list-simulators'], f.deps), /仅支持 Mac/);
  assert.equal(f.commands.length + f.writes.length + f.directories(), 0);
});

test('Node version boundaries agree with the repository engine constraint', () => {
  for (const version of ['22.13.0', '22.99.0', '24.3.0', '24.99.0', '26.0.0', '27.1.1']) assert.equal(supportsNode(version), true);
  for (const version of ['22.12.9', '23.9.0', '24.2.9', '25.9.0', '20.0.0', '26.0.0-beta', 'unknown']) assert.equal(supportsNode(version), false);
});

test('Simulator listing is read-only and excludes unavailable and non-iOS devices', async () => {
  const f = fixture();
  await main(['--list-simulators'], f.deps);
  assert.equal(f.commands.length, 1);
  assert.equal(f.writes.length + f.directories(), 0);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /Synthetic iPhone/);
  assert.equal(availableSimulators(JSON.stringify(list)).length, 1);
  for (const source of ['{}', '{"devices":[]}', '{broken']) assert.throws(() => availableSimulators(source));
});

test('Native result summary rejects zero, missing, failed, skipped and mismatched tests', () => {
  assert.deepEqual(validateTestSummary(JSON.stringify(passed), 65), { total: 65, passed: 65, failed: 0, skipped: 0 });
  for (const patch of [{ testResult: 'Failed' }, { totalTestCount: 0 }, { passedTests: 64 },
    { skippedTests: 1 }, { failedTests: 1 }, { passedTests: '65' }, { totalTestCount: 66 }])
    assert.throws(() => validateTestSummary(JSON.stringify({ ...passed, ...patch }), 65));
  assert.throws(() => validateTestSummary('{}', 65));
  assert.throws(() => validateTestSummary(JSON.stringify(passed), 0));
});

test('Actual checked-in XCTest declarations are all wired, currently 73 (not executed here)', () => {
  assert.equal(inspectRepository(root, repoIO()), 73);
});

test('Repository preflight refuses missing dependencies, mismatched Pods and unwired tests', () => {
  assert.throws(() => inspectRepository(root, repoIO({ existsSync: () => false })), /环境未准备/);
  assert.throws(() => inspectRepository(root, repoIO({ readFileSync: (file) => file })), /锁文件不同/);
  assert.throws(() => inspectRepository(root, repoIO({ readdirSync: () => ['UnwiredTests.swift'] })), /未唯一加入/);
  assert.throws(() => inspectRepository(root, repoIO({ readdirSync: () => [] })), /未找到原生测试/);
});

test('Report output rejects existing linked parents before creating children', () => {
  const operations = [];
  const io = { realpathSync: () => root, mkdirSync: (file) => { operations.push(file); const error = Error(); error.code = 'EEXIST'; throw error; },
    lstatSync: () => ({ isSymbolicLink: () => true }), mkdtempSync: () => assert.fail('must not create output') };
  assert.throws(() => createReportDirectory(root, io), /不能是链接/);
  assert.deepEqual(operations, [path.join(root, '.build')]);
});

test('Build arguments only target the chosen simulator and never sign, clean or erase', () => {
  const steps = buildSteps(simulator, 'directory with spaces');
  const tests = steps.find((step) => step.name === 'native-tests');
  assert.ok(tests.args.includes('platform=iOS Simulator,id=' + simulator));
  assert.ok(tests.args.includes('-only-testing:DaojiaShuoYishengTests'));
  assert.ok(tests.args.includes(path.join('directory with spaces', 'NativeTests.xcresult')));
  for (const step of steps.filter((step) => step.command === 'xcodebuild')) assert.ok(step.args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.doesNotMatch(JSON.stringify(steps), /erase|clean|provisioning|generic\/platform=iOS"/);
});

test('Complete mocked Mac flow requires all stages before reporting passed', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.status, 'passed');
  assert.equal(result.nativeTests.passed, 65);
  assert.deepEqual(result.steps.map((step) => step.name), ['xcode-select', 'xcode-version', 'ruby-version',
    'bundle-check', 'simulators', 'windows-checks', 'native-tests', 'native-summary', 'release-build']);
  assert.equal(f.writes.at(-1).value.status, 'passed');
  assert.ok(f.commands.every((command) => command.options.cwd === root && command.options.logPath.endsWith('.log')));
});

test('Every failed command stops later work and leaves a failed report', async () => {
  for (const failedIndex of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const f = fixture(); const original = f.deps.run; let calls = 0;
    f.deps.run = async (...args) => { const result = await original(...args); return calls++ === failedIndex ? { ...result, code: 1 } : result; };
    await assert.rejects(f.run(), /执行失败/);
    assert.equal(calls, failedIndex + 1);
    assert.equal(f.writes.at(-1).value.status, 'failed');
    assert.equal(f.writes.at(-1).value.steps.at(-1).status, 'failed');
  }
});

test('Missing or truncated summary and skipped tests cannot reach Release build', async () => {
  for (const replacement of [{ stdout: '{}' }, { truncated: true }, { stdout: JSON.stringify({ ...passed, skippedTests: 1 }) }]) {
    const f = fixture(); const original = f.deps.run;
    f.deps.run = async (...args) => { const result = await original(...args); return args[1].includes('xcresulttool') ? { ...result, ...replacement } : result; };
    await assert.rejects(f.run());
    assert.equal(f.writes.at(-1).value.status, 'failed');
    assert.ok(!f.commands.some((command) => command.args[0] === 'build'));
  }
});

test('Wrong Xcode, Ruby or simulator fails without auto-installing or switching tools', async () => {
  for (const [match, stdout] of [['-p', '/Library/Developer/CommandLineTools'], ['-version', 'Xcode 26.0'],
    ['ruby', '2.6.10'], ['simctl', '{"devices":{}}']]) {
    const f = fixture(); const original = f.deps.run;
    f.deps.run = async (...args) => { const result = await original(...args); return args[1].includes(match) ? { ...result, stdout } : result; };
    await assert.rejects(f.run());
    assert.equal(f.writes.at(-1).value.status, 'failed');
    assert.ok(!f.commands.some((command) => command.command === 'npm'));
  }
});

test('Dependency preflight failures leave a report without invoking Xcode', async () => {
  const f = fixture({ inspect: () => { throw Error('synthetic dependency failure'); } });
  await assert.rejects(f.run(), /synthetic dependency failure/);
  assert.equal(f.commands.length, 0);
  assert.equal(f.writes.at(-1).value.status, 'failed');
});

test('Production process runner uses literal arguments and preserves failure output', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-mac-runner-test-'));
  const log = path.join(directory, 'synthetic.log');
  try {
    const result = await commandRunner(process.execPath, ['-e',
      'process.stdout.write(process.argv[1]+"|"+process.env.MISE_AUTO_INSTALL+"|"+process.env.MISE_EXEC_AUTO_INSTALL+"|"+process.env.BUNDLE_FROZEN); process.stderr.write("synthetic failure"); process.exitCode=7;',
      'literal $(no-command); 中文'], { cwd: root, logPath: log });
    assert.equal(result.code, 7);
    assert.equal(result.stdout, 'literal $(no-command); 中文|false|false|true');
    assert.equal(result.stderr, 'synthetic failure');
    assert.match(fs.readFileSync(log, 'utf8'), /中文/);
    await assert.rejects(commandRunner('guardian-nonexistent-synthetic-executable', [], { cwd: root }), /无法启动/);
  } finally {
    // Only this test's known file and empty unique temp directory are removed.
    if (fs.existsSync(log)) fs.unlinkSync(log);
    fs.rmdirSync(directory);
  }
});
