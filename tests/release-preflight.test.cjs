const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { checkRelease, PROJECT, INFO, PRIVACY } = require('../scripts/check-release.cjs');
const { parsePlist, parsePbxProject } = require('../scripts/config-parsers.cjs');
const { createLoader } = require('./loadTs.cjs');
const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checkChange = (file, change) => checkRelease({ read: (name) => name === file ? change(source(name)) : source(name) });
const failed = (checks) => checks.filter((item) => !item.ok);

test('checked-in release defaults pass without a phone, signing account or network', async () => {
  const checks = await checkRelease();
  assert.equal(checks.length, 8);
  assert.deepEqual(failed(checks), []);
});

test('wrong App/test IDs or a conditional identifier override fail the gate', async () => {
  for (const change of [
    (s) => s.replace('PRODUCT_BUNDLE_IDENTIFIER = com.llingrui.iamhome;', 'PRODUCT_BUNDLE_IDENTIFIER = example.other;'),
    (s) => s.replace('PRODUCT_BUNDLE_IDENTIFIER = com.llingrui.iamhome.tests;', 'PRODUCT_BUNDLE_IDENTIFIER = com.llingrui.iamhome;'),
    (s) => s.replace('PRODUCT_BUNDLE_IDENTIFIER = com.llingrui.iamhome;', 'PRODUCT_BUNDLE_IDENTIFIER = com.llingrui.iamhome; "PRODUCT_BUNDLE_IDENTIFIER[sdk=iphoneos*]" = example.other;'),
  ]) assert.ok(failed(await checkChange(PROJECT, change)).some((item) => /标识和版本/.test(item.name)));
});

test('missing Release configuration or wrong Info.plist cannot pass via unrelated matching text', async () => {
  const changes = [
    (s) => s.replace('13B07F951A680F5B00A75B9A /* Release */,', ''),
    (s) => s.replace('INFOPLIST_FILE = DaojiaShuoYisheng/Info.plist;', 'INFOPLIST_FILE = Other/Info.plist;'),
    (s) => s.replace('CURRENT_PROJECT_VERSION = 1;', 'CURRENT_PROJECT_VERSION = 2;'),
  ];
  for (const change of changes) assert.ok(failed(await checkChange(PROJECT, change)).length);
});

test('enabled, missing, string-valued or duplicate critical-messaging switches are rejected', async () => {
  for (const replacement of ['<true/>', '<string>false</string>', '', '<false/><key>GuardianCriticalMessagingEnabled</key><false/>']) {
    const result = await checkChange(INFO, (s) => s.replace(/(<key>GuardianCriticalMessagingEnabled<\/key>)\s*<false\/>/, '$1' + replacement));
    assert.ok(failed(result).length, replacement);
  }
});

test('required permission/background declarations and privacy resource membership are enforced', async () => {
  for (const [file, change] of [
    [INFO, (s) => s.replace('NSMotionUsageDescription', 'RemovedMotionDescription')],
    [INFO, (s) => s.replace('<string>location</string>', '<string>removed</string>')],
    [INFO, (s) => s.replace('com.llingrui.iamhome.guardian.refresh', 'wrong.refresh')],
    [PRIVACY, (s) => s.replace('<string>CA92.1</string>', '<string>missing</string>')],
    [PROJECT, (s) => s.replace('FCD397D5AA59D013AC86E02F /* PrivacyInfo.xcprivacy in Resources */,', '')],
  ]) assert.ok(failed(await checkChange(file, change)).length);
});

test('new-device demo data or a production default fails behavioral defaults verification', async () => {
  const original = createLoader({ '@react-native-async-storage/async-storage': {} });
  const base = original('src/storage/guardianSchema.ts').createInitialStoredState(Date.now(), 'device');
  for (const change of [(s) => { s.mode = 'demo'; }, (s) => { s.isGuardianOn = true; },
    (s) => { s.config.schedule.monitoringMode = 'standard'; }, (s) => { s.localEvents = [{}]; },
    (s) => { s.config.contacts = [{}]; }, (s) => { s.config.geofences = [{}]; }]) {
    const state = JSON.parse(JSON.stringify(base)); change(state);
    const checks = await checkRelease({ load: (file) => file.endsWith('guardianRepository.ts')
      ? { guardianRepository: { async loadState() { return state; } } } : original(file) });
    assert.ok(failed(checks).some((item) => /新设备/.test(item.name)));
  }
});

test('native default changes and unreadable configuration files fail closed', async () => {
  assert.ok(failed(await checkChange('ios/GuardianCore/GuardianRiskDetector.swift',
    (s) => s.replace('var mode: GuardianMonitoringMode = .test', 'var mode: GuardianMonitoringMode = .standard'))).length);
  const checks = await checkRelease({ read: (file) => { if (file === INFO) throw Error('missing'); return source(file); } });
  assert.ok(failed(checks).length);
});

test('config parsers ignore comments, reject ambiguous keys and do not resolve custom entities', () => {
  assert.equal(parsePlist('<plist><dict><!-- <key>x</key><true/> --><key>x</key><false/></dict></plist>').x, false);
  assert.throws(() => parsePlist('<plist><dict><key>x</key><true/><key>x</key><false/></dict></plist>'), /重复/);
  assert.throws(() => parsePlist('<!DOCTYPE plist [<!ENTITY x SYSTEM "secret">]><plist><string>&x;</string></plist>'), /实体/);
  assert.throws(() => parsePlist('<plist><dict></plist>'), /XML/);
  assert.equal(parsePbxProject('{/*bad = 1;*/ path = Folder/File; text = "x; { y }"; list = (a,b,); }').path, 'Folder/File');
  assert.throws(() => parsePbxProject('{ a = 1; a = 2; }'), /重复/);
  assert.throws(() => parsePbxProject('{ a = (a, b; }'), /结构|标量/);
});

test('CLI resolves the project from its own path and rejects skip flags', () => {
  const script = path.join(root, 'scripts/check-release.cjs');
  const output = execFileSync(process.execPath, [script], { cwd: path.dirname(root), encoding: 'utf8', timeout: 20000 });
  assert.match(output, /工程防错检查通过/);
  assert.match(output, /不代表已完成发布验收/);
  const skipped = spawnSync(process.execPath, [script, '--skip'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(skipped.status, 1);
});

test('storage backup opt-in, dependency drift or missing native protection fails release preflight', async () => {
  for (const [file, change] of [
    [INFO, (s) => s.replace(/(<key>RCTAsyncStorageExcludeFromBackup<\/key>)\s*<true\/>/, '$1<false/>')],
    [INFO, (s) => s.replace('<key>RCTNewArchEnabled</key>', '<key>UIFileSharingEnabled</key>')],
    ['package.json', (s) => s.replace('"@react-native-async-storage/async-storage": "3.1.1"', '"@react-native-async-storage/async-storage": "^3.1.1"')],
    ['ios/Podfile.lock', (s) => s.replace('AsyncStorage (3.1.1):', 'AsyncStorage (3.2.0):')],
    [PROJECT, (s) => s.replace('B10000000000000000000001 /* GuardianStorageProtection.swift in Sources */,', '')],
    ['ios/GuardianCore/GuardianNativeModule.m', (s) => s.replace('RCT_EXTERN_METHOD(checkLocalStorage:', 'RCT_EXTERN_METHOD(removed:')],
  ]) assert.ok(failed(await checkChange(file, change)).some((item) => /本机存储保护/.test(item.name)), file);
});

test('release preflight is wired before bundle creation and into existing CI', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.equal(pkg.scripts['prebundle:ios'], 'npm run check:release');
  assert.match(pkg.scripts['check:all'], /check:release.*typecheck.*npm test.*bundle:ios/);
  assert.match(source('.github/workflows/checks.yml'), /run: npm run check:release/);
});
