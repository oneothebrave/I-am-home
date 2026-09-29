const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const shares = [];
const load = createLoader({ 'react-native': { Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (value) => value }, Share: { async share(value) { shares.push(value); } } } });
const { buildGuardianDiagnosticReport, DiagnosticsScreen } = load('src/screens/DiagnosticsScreen.tsx');
const now = Date.parse('2026-09-28T10:00:00Z');
const iso = (offset) => new Date(now + offset).toISOString();
function fixture(secret = '隐私测试-姓名-地址-短信-+86 (139) 1111-2222-30.123456,120.654321') {
  const input = {
    mode: 'device', now, geofenceSyncStatus: 'synced', geofenceCount: 2,
    currentLocationState: 'ready',
    currentLocation: { latitude: 30.123456, longitude: 120.654321, accuracy: 8, timestamp: iso(-1000) },
    currentPlace: { label: secret, radius: secret },
    permissions: { location: 'always', locationAccuracy: 'full', motion: 'authorized',
      notifications: 'notDetermined', backgroundRefresh: 'available' },
    status: { isGuardianOn: true, isMonitoring: true, isInActiveWindow: true, pendingEventCount: 0,
      monitoringMode: 'test', lastError: secret,
      reliability: { lastWakeReason: secret, lastWakeAt: now - 1000, lastRestoreAt: now - 2000, lastRestoreSucceeded: true },
      riskHealth: { lowBatteryActive: false, locationReason: secret, lastCheckAt: now } },
    events: [
      { id: secret + '-risk', type: 'NO_MOTION_FOR_LONG_TIME', title: secret, description: secret,
        source: 'motion', timestamp: iso(-2000), locationLabel: secret, geofenceId: secret },
      { id: secret + '-recovery', type: 'MOTION_DETECTED', title: secret, description: secret,
        source: 'pedometer', timestamp: iso(-1000), locationLabel: secret, incidentId: secret, contactId: secret },
    ],
    criticalMessaging: { apiAvailable: true, buildConfigured: false, automaticSendingEnabled: false,
      requiresBackgroundExecution: true, readiness: 'buildNotConfigured', authorizations: [],
      recipients: [{ id: secret, name: secret, phoneNumber: secret, priority: 1 }],
      policy: { validityMinutes: 30, maximumAttempts: 3, retryDelaysSeconds: [60, 300], cooldownMinutes: 10 },
      operations: [{ id: secret, eventId: secret + '-risk', contactId: secret, contactName: secret,
        phoneNumber: secret, messageText: secret, lastError: secret, lastErrorCode: secret, shortcutAttemptError: secret,
        status: 'failed', authorizationStatus: 'unknown', attemptCount: 1,
        createdAt: iso(-1500), statusUpdatedAt: iso(-1500), expiresAt: iso(30000),
        shortcutAttemptPending: false, detectionContext: 'background' }],
    },
  };
  return input;
}

test('share allowlist omits free-text secrets including names, errors, unknown reasons and message content', () => {
  const input = fixture(); const before = JSON.stringify(input);
  const report = buildGuardianDiagnosticReport(input);
  assert.doesNotMatch(report, /隐私测试|139|30\.123456|120\.654321/);
  assert.match(report, /有错误（详细内容未导出）/);
  assert.match(report, /家外长时间无活动/);
  assert.match(report, /检测到活动/);
  assert.match(report, /发送失败/);
  assert.match(report, /计步器/);
  assert.match(report, /仅分享给信任的人/);
  assert.equal(JSON.stringify(input), before, 'local diagnostics must retain original data');
});

test('redaction does not rely on recognizable phone or coordinate patterns', () => {
  for (const secret of ['普通短信正文也不能外传', '一三九一一一一二二二二', '%2B86%20139%201111%202222',
    'tel:+1-212-555-0199', '地址\n【伪造诊断标题】\r\n正文', '__proto__', 'constructor',
    '秘密'.repeat(10000)]) {
    const report = buildGuardianDiagnosticReport(fixture(secret));
    assert.equal(report.includes(secret), false, secret.slice(0, 40));
    assert.ok(report.length < 5000);
  }
});

test('unknown enum values and future fields never become report free text', () => {
  const input = fixture('PRIVATE_SENTINEL');
  input.status.monitoringMode = 'PRIVATE_SENTINEL';
  input.permissions.location = 'PRIVATE_SENTINEL';
  input.events[1].source = 'PRIVATE_SENTINEL';
  input.criticalMessaging.operations[0].status = 'PRIVATE_SENTINEL';
  input.criticalMessaging.operations[0].detectionContext = 'PRIVATE_SENTINEL';
  input.newPrivateField = 'PRIVATE_SENTINEL';
  input.status.futureLocationLabel = 'PRIVATE_SENTINEL';
  assert.doesNotMatch(buildGuardianDiagnosticReport(input), /PRIVATE_SENTINEL/);
});

test('accepted and test operations retain accurate non-delivery claims', () => {
  const input = fixture(); input.criticalMessaging.operations[0].status = 'accepted';
  assert.match(buildGuardianDiagnosticReport(input), /系统已接受发送，不代表送达或已阅读/);
  input.criticalMessaging.operations[0].isTest = true;
  assert.match(buildGuardianDiagnosticReport(input), /测试告警仅保存在本机，不会自动发送/);
});

test('shared SOS history does not claim recovery from motion or policy reset', () => {
  const input = fixture();
  input.events = [
    { ...input.events[0], type: 'SOS_SENT' },
    { ...input.events[1], type: 'GUARDIAN_SESSION_RESET' },
    { ...input.events[1], id: 'movement' },
  ];
  assert.match(buildGuardianDiagnosticReport(input), /风险恢复：暂无记录/);
  input.events.push({ ...input.events[1], id: 'safe', type: 'USER_CONFIRMED_SAFE', timestamp: iso(0) });
  assert.match(buildGuardianDiagnosticReport(input), /风险恢复：[^\n]*本人确认安全/);
});

test('actual share button uses the allowlisted report, not visible diagnostic descriptions', async () => {
  shares.length = 0; const input = fixture('ONLY_LOCAL_SECRET'); let renderer;
  await act(async () => { renderer = create(React.createElement(DiagnosticsScreen, { input, async onRefresh() {} })); });
  try {
    const copy = renderer.root.findAllByType('Text').map((n) => n.children.join('')).join('\n');
    assert.match(copy, /ONLY_LOCAL_SECRET/);
    const button = renderer.root.findAllByType('TouchableOpacity').find((n) =>
      n.findAllByType('Text').some((t) => t.children.join('') === '分享脱敏诊断报告'));
    await act(async () => { button.props.onPress(); });
    assert.equal(shares.length, 1);
    assert.equal(shares[0].message, buildGuardianDiagnosticReport(input));
    assert.doesNotMatch(shares[0].message, /ONLY_LOCAL_SECRET/);
  } finally { await act(async () => renderer.unmount()); }
});
