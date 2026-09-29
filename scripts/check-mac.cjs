const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCHEME = 'DaojiaShuoYisheng';
const TARGET = SCHEME + 'Tests';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PLAN = [
  '检查 Node、已安装依赖、Pod 锁文件、测试源文件与工程接线',
  '检查当前 Xcode（27+）、mise Ruby 3.3.12、Bundler 和指定 iOS 模拟器',
  '运行 npm run check:all（配置、类型、JS/React 测试及离线 JS 包）',
  'Debug 编译并运行全部原生 XCTest，核对结果包中的通过/失败/跳过数量',
  'Release 模拟器编译（关闭签名，不安装到 iPhone）',
  '在 .build/mac-acceptance/ 独立目录保留日志、结果包与 report.json',
];

function parseOptions(args) {
  if (args.length === 1 && args[0] === '--plan') return { mode: 'plan' };
  if (args.length === 1 && args[0] === '--list-simulators') return { mode: 'list' };
  if (args.length === 2 && args[0] === '--simulator' && UUID.test(args[1]))
    return { mode: 'run', simulator: args[1].toUpperCase() };
  throw Error('用法：npm run check:mac -- --plan | --list-simulators | --simulator <UUID>');
}

function supportsNode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return (major === 22 && minor >= 13) || (major === 24 && minor >= 3) || major >= 26;
}

function availableSimulators(source) {
  const { devices } = JSON.parse(source);
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) throw Error('无法识别模拟器列表');
  return Object.entries(devices).filter(([runtime]) => /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-/.test(runtime))
    .flatMap(([runtime, entries]) => {
      if (!Array.isArray(entries)) throw Error('无法识别模拟器设备列表');
      return entries.filter((device) => device?.isAvailable === true && UUID.test(device.udid))
        .map((device) => ({ id: device.udid.toUpperCase(), name: device.name, runtime }));
    });
}

function validateTestSummary(source, expected) {
  const summary = JSON.parse(source);
  if (!Number.isSafeInteger(expected) || expected < 1 || summary.testResult !== 'Passed' ||
      summary.totalTestCount !== expected || summary.passedTests !== expected ||
      summary.failedTests !== 0 || summary.skippedTests !== 0)
    throw Error('原生测试结果不完整或未全部通过；请查看 xcresult（不接受零测试、跳过或未知格式）');
  return { total: summary.totalTestCount, passed: summary.passedTests, failed: 0, skipped: 0 };
}

function inspectRepository(root, io = fs) {
  const read = (file) => io.readFileSync(path.join(root, file), 'utf8');
  for (const file of ['node_modules/react-native/package.json', 'ios/DaojiaShuoYisheng.xcworkspace/contents.xcworkspacedata']) {
    if (!io.existsSync(path.join(root, file))) throw Error('环境未准备：' + file + '，请按 HANDOFF.md 手动安装依赖');
  }
  if (read('ios/Pods/Manifest.lock') !== read('ios/Podfile.lock')) throw Error('Pods 与锁文件不同，请先按 HANDOFF.md 更新本地 Pods');
  const { parsePbxProject } = require('./config-parsers.cjs');
  const { objects } = parsePbxProject(read('ios/DaojiaShuoYisheng.xcodeproj/project.pbxproj'));
  const targets = Object.values(objects).filter((entry) => entry.isa === 'PBXNativeTarget' && entry.name === TARGET);
  if (targets.length !== 1) throw Error('原生测试目标缺失或重复');
  const sources = targets[0].buildPhases.map((id) => objects[id]).filter((phase) => phase?.isa === 'PBXSourcesBuildPhase')
    .flatMap((phase) => phase.files ?? []).map((id) => objects[objects[id]?.fileRef]?.path);
  const testFiles = io.readdirSync(path.join(root, 'ios/GuardianCoreTests')).filter((file) => file.endsWith('.swift'));
  let count = 0;
  for (const file of testFiles) {
    if (sources.filter((source) => source === file).length !== 1) throw Error('测试文件未唯一加入目标：' + file);
    const source = read('ios/GuardianCoreTests/' + file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
    // Current suite uses XCTest test methods, not parameterized Swift Testing.
    const methods = source.match(/^\s*func\s+test\w+\s*\(\s*\)/gm) ?? [];
    if (!methods.length || /@Test\b/.test(source)) throw Error('测试声明格式变化，需更新验收计数器：' + file);
    count += methods.length;
  }
  if (!count) throw Error('未找到原生测试，不能视为通过');
  return count;
}

function createReportDirectory(root, io = fs) {
  // No caller-selected output path, cleanup, cache deletion or recursive removal.
  let directory = io.realpathSync(root);
  for (const part of ['.build', 'mac-acceptance']) {
    directory = path.join(directory, part);
    try { io.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = io.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('报告目录不能是链接或普通文件');
  }
  return io.mkdtempSync(path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
}

function commandRunner(command, args, { cwd, logPath } = {}) {
  return new Promise((resolve, reject) => {
    const descriptor = logPath ? fs.openSync(logPath, 'wx', 0o600) : undefined;
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      // mise exec auto-installs by default. Keep checks read-only for tool setup,
      // and prevent bundle check from rewriting dependency resolution.
      env: { ...process.env, MISE_AUTO_INSTALL: 'false', MISE_EXEC_AUTO_INSTALL: 'false', BUNDLE_FROZEN: 'true' } });
    const limit = 4 * 1024 * 1024;
    let stdout = '', stderr = '', truncated = false, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (error) reject(error); else resolve(result);
    };
    const append = (chunk, stream) => {
      if (settled) return;
      try {
        if (descriptor !== undefined) fs.writeSync(descriptor, chunk);
        const previous = stream === 'stdout' ? stdout : stderr;
        const combined = previous + chunk;
        if (combined.length > limit) truncated = true;
        if (stream === 'stdout') stdout = combined.slice(0, limit);
        else stderr = combined.slice(0, limit);
      } catch (error) { child.kill(); finish(error); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(chunk, 'stderr'));
    child.on('error', (error) => finish(Error('无法启动 ' + command + '：' + error.message)));
    child.on('close', (code, signal) => finish(null, { code, signal, stdout, stderr, truncated }));
  });
}

function buildSteps(simulator, directory) {
  if (!UUID.test(simulator)) throw Error('模拟器 UUID 无效');
  const common = ['-workspace', 'ios/DaojiaShuoYisheng.xcworkspace', '-scheme', SCHEME,
    '-derivedDataPath', path.join(directory, 'DerivedData'), 'CODE_SIGNING_ALLOWED=NO'];
  const resultPath = path.join(directory, 'NativeTests.xcresult');
  return [
    { name: 'windows-checks', command: 'npm', args: ['run', 'check:all'] },
    { name: 'native-tests', command: 'xcodebuild', args: ['test', ...common, '-configuration', 'Debug',
      '-destination', 'platform=iOS Simulator,id=' + simulator, '-destination-timeout', '120',
      '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
      '-only-testing:' + TARGET, '-resultBundlePath', resultPath] },
    { name: 'native-summary', command: 'xcrun', args: ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultPath] },
    { name: 'release-build', command: 'xcodebuild', args: ['build', ...common, '-configuration', 'Release',
      '-destination', 'generic/platform=iOS Simulator'] },
  ];
}

async function main(args = process.argv.slice(2), deps = {}) {
  const { platform = process.platform, nodeVersion = process.versions.node, root = ROOT,
    run = commandRunner, inspect = inspectRepository, createDirectory = createReportDirectory,
    write = (file, value) => fs.writeFileSync(file, value, { mode: 0o600 }), out = console.log } = deps;
  const options = parseOptions(args);
  if (options.mode === 'plan') {
    out('仅显示计划：没有执行环境检查、编译、测试或文件写入。');
    PLAN.forEach((line, index) => out(`${index + 1}. ${line}`));
    return { status: 'planned' };
  }
  if (platform !== 'darwin') throw Error('实际验收仅支持 Mac；Windows 可使用 --plan，不能运行 Xcode 或原生测试');
  if (!supportsNode(nodeVersion)) throw Error('Node 版本不满足 package.json engines');
  if (options.mode === 'list') {
    const result = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { cwd: root });
    if (result.code !== 0 || result.signal || result.truncated) throw Error('无法读取模拟器列表，请检查当前 Xcode');
    const devices = availableSimulators(result.stdout);
    if (!devices.length) throw Error('未发现可用 iOS 模拟器；请在 Xcode 中手动准备');
    devices.forEach((device) => out(`${device.id}  ${device.name}  ${device.runtime}`));
    return { status: 'listed' };
  }
  const directory = createDirectory(root);
  const report = { status: 'running', startedAt: new Date().toISOString(), simulator: options.simulator,
    expectedTests: null, steps: [], nativeTests: null,
    limits: '仅模拟器验收，不代表签名、真机、备份、后台可靠性或真实短信已验收。' };
  const save = () => write(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  out('验收日志：' + directory);
  const execute = async (name, command, commandArgs) => {
    out('正在检查：' + name);
    const step = { name, command, args: commandArgs, status: 'running' };
    report.steps.push(step); save();
    try {
      const result = await run(command, commandArgs, { cwd: root, logPath: path.join(directory, name + '.log') });
      if (result.code !== 0 || result.signal) throw Error(name + ' 执行失败，请查看对应日志');
      step.status = 'passed'; save(); return result;
    } catch (error) { step.status = 'failed'; save(); throw error; }
  };
  try {
    save(); report.expectedTests = inspect(root); save();
    const selected = await execute('xcode-select', 'xcode-select', ['-p']);
    if (!selected.stdout.trim() || selected.stdout.includes('CommandLineTools')) throw Error('请选择完整 Xcode，不能只使用 Command Line Tools');
    const xcode = await execute('xcode-version', 'xcodebuild', ['-version']);
    if (Number(/^Xcode (\d+)/m.exec(xcode.stdout)?.[1] ?? 0) < 27) throw Error('此项目基线需要 Xcode 27 或更新版本');
    const ruby = await execute('ruby-version', 'mise', ['exec', '--', 'ruby', '-e', 'print RUBY_VERSION']);
    if (ruby.stdout.trim() !== '3.3.12') throw Error('Ruby 不符合 mise.toml 固定的 3.3.12');
    await execute('bundle-check', 'mise', ['exec', '--', 'bundle', 'check']);
    const devices = await execute('simulators', 'xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
    if (devices.truncated || !availableSimulators(devices.stdout).some((device) => device.id === options.simulator))
      throw Error('指定设备不是当前可用的 iOS 模拟器；不会改用真机或其他设备');
    for (const step of buildSteps(options.simulator, directory)) {
      const result = await execute(step.name, step.command, step.args);
      if (step.name === 'native-summary') {
        if (result.truncated) throw Error('测试摘要被截断，不能确认通过');
        report.nativeTests = validateTestSummary(result.stdout, report.expectedTests); save();
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); save();
  }
  out('模拟器验收通过：' + report.nativeTests.passed + ' 项原生测试及 Release 编译。' + report.limits);
  return report;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, parseOptions, supportsNode, availableSimulators, validateTestSummary,
  inspectRepository, createReportDirectory, commandRunner, buildSteps };
