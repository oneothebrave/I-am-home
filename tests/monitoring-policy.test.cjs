const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const confirmations = [];
const load = createLoader({
  'react-native': {
    Alert: { alert: (...args) => confirmations.push(args) },
    NativeModules: {}, Platform: { OS: 'ios' },
    Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity',
    StyleSheet: { create: (styles) => styles },
  },
});
const { createInitialStoredState, parseStoredState } = load('src/storage/guardianSchema.ts');
const { parseGuardianConfig, parseGuardianEvent } = load('src/domain/validation.ts');
const { scheduleForMode, standardModeBlocker } = load('src/domain/monitoringPolicy.ts');
const { startGuardianPolicySync } = load('src/native/guardianPolicySync.ts');
const { projectGuardianEvents } = load('src/domain/guardianProjection.ts');
const { RulesScreen } = load('src/screens/RulesScreen.tsx');
const initial = () => createInitialStoredState();
const permissions = {
  location: 'always', locationAccuracy: 'full', backgroundRefresh: 'available',
  motion: 'authorized', notifications: 'notDetermined',
};
const epoch = Date.parse('2026-09-28T08:00:00Z');
const event = (type, index, extras = {}) => ({
  id: String(index), type, title: type, description: type, source: 'location',
  timestamp: new Date(epoch + index * 1000).toISOString(), ...extras,
});

test('v3 one-minute settings migrate to explicit test mode without losing contacts or pause', () => {
  const value = initial();
  value.schemaVersion = 3;
  value.isGuardianPaused = true;
  value.config.schedule.noMotionThresholdMinutes = 1;
  delete value.config.schedule.monitoringMode;
  delete value.config.schedule.locationLostThresholdMinutes;
  const migrated = parseStoredState(value);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.config.schedule.monitoringMode, 'test');
  assert.equal(migrated.config.schedule.noMotionThresholdMinutes, 1);
  assert.equal(migrated.config.schedule.locationLostThresholdMinutes, 120);
  assert.deepEqual(migrated.config.contacts, value.config.contacts);
  assert.equal(migrated.isGuardianPaused, true);
  assert.deepEqual(parseStoredState(migrated), migrated);
});

test('v4 requires an explicit valid mode and validates both threshold boundaries', () => {
  for (const mode of ['standard', 'test']) {
    const min = mode === 'test' ? 1 : 15;
    for (const key of ['noMotionThresholdMinutes', 'locationLostThresholdMinutes']) {
      for (const bad of [0, min - 1, 241, 15.5, NaN, '120', true]) {
        const config = initial().config;
        config.schedule.monitoringMode = mode;
        config.schedule[key] = bad;
        assert.throws(() => parseGuardianConfig(config));
      }
      const config = initial().config;
      config.schedule.monitoringMode = mode;
      config.schedule[key] = min;
      assert.equal(parseGuardianConfig(config).schedule[key], min);
    }
  }
  const value = initial();
  delete value.config.schedule.monitoringMode;
  assert.throws(() => parseStoredState(value));
});

test('leaving test mode resets short thresholds and preserves real settings', () => {
  const schedule = initial().config.schedule;
  assert.deepEqual(scheduleForMode({ ...schedule, noMotionThresholdMinutes: 1,
    locationLostThresholdMinutes: 5 }, 'standard'), {
    ...schedule, monitoringMode: 'standard', noMotionThresholdMinutes: 120,
    locationLostThresholdMinutes: 120,
  });
  assert.equal(scheduleForMode({ ...schedule, noMotionThresholdMinutes: 75 }, 'standard')
    .noMotionThresholdMinutes, 75);
});

test('standard mode requires home, contacts, permission accuracy and synchronized fences', () => {
  const config = initial().config;
  assert.equal(standardModeBlocker(config, permissions, true), undefined);
  assert.match(standardModeBlocker({ ...config, geofences: [] }, permissions, true), /家/);
  assert.match(standardModeBlocker({ ...config, contacts: [] }, permissions, true), /家人/);
  assert.match(standardModeBlocker(config, undefined, true), /始终/);
  for (const change of [{ location: 'whenInUse' }, { locationAccuracy: 'reduced' },
    { backgroundRefresh: 'denied' }]) {
    assert.ok(standardModeBlocker(config, { ...permissions, ...change }, true));
  }
  assert.match(standardModeBlocker(config, permissions, false), /同步/);
});

test('policy sync preserves full snapshots and order across a failed native write', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const applied = [];
  const sync = startGuardianPolicySync({
    async setMonitoringPolicy(value) {
      applied.push({ ...value });
      if (applied.length === 1) { await gate; throw Error('disk full'); }
    },
  });
  const first = initial().config.schedule;
  const failed = assert.rejects(sync.update(first), /disk full/);
  first.noMotionThresholdMinutes = 1;
  const second = scheduleForMode(first, 'standard');
  const done = sync.update(second);
  second.monitoringMode = 'test';
  await Promise.resolve();
  assert.equal(applied.length, 1);
  release();
  await Promise.all([failed, done]);
  assert.equal(applied[0].noMotionThresholdMinutes, 120);
  assert.equal(applied[1].monitoringMode, 'standard');
  assert.equal(applied[1].noMotionThresholdMinutes, 120);
});

test('charging recovery resolves battery risk without clearing a location or SOS risk', () => {
  const events = [event('LOW_BATTERY', 1), event('LOCATION_LOST', 2),
    event('BATTERY_RECOVERED', 3, { batteryLevel: 5 })];
  assert.deepEqual(projectGuardianEvents(events).incident.risks.map((risk) => risk.type), ['LOCATION_LOST']);
  assert.equal(projectGuardianEvents([event('SOS_SENT', 0), ...events]).incident.kind, 'sos');
});

test('permission-related location risks survive ordinary movement and geofence return', () => {
  const events = [event('LOCATION_LOST', 1, { riskReason: 'locationPermissionDisabled' }),
    event('MOTION_DETECTED', 2), event('RETURN_HOME', 3), event('LOCATION_UPDATED', 4)];
  assert.equal(projectGuardianEvents(events).incident.risks[0].type, 'LOCATION_LOST');
  assert.equal(projectGuardianEvents([...events, event('LOCATION_RESTORED', 5)]).incident, undefined);
});

test('ending a session closes passive test incidents without deleting history or SOS', () => {
  const events = [event('LOW_BATTERY', 1, { isTest: true }),
    event('GUARDIAN_SESSION_RESET', 2, { isTest: true })];
  assert.equal(projectGuardianEvents(events).incident, undefined);
  assert.equal(projectGuardianEvents(events).events.length, 2);
  assert.equal(projectGuardianEvents([event('SOS_SENT', 0), ...events]).incident.kind, 'sos');
  assert.equal(parseGuardianEvent(events[0]).isTest, true);
  assert.throws(() => parseGuardianEvent({ ...events[0], isTest: 'true' }));
});

test('test shortcut sets both one-minute thresholds; production controls stop at 15', async () => {
  let renderer;
  const calls = [];
  await act(async () => {
    renderer = create(React.createElement(RulesScreen, {
      schedule: initial().config.schedule,
      onChangeSchedule: (schedule) => { calls.push(schedule); },
    }));
  });
  const buttonWith = (copy) => renderer.root.findAllByType('TouchableOpacity')
    .find((button) => button.findAllByType('Text').some((text) => text.children.join('') === copy));
  await act(async () => buttonWith('使用 1 分钟测试阈值').props.onPress());
  assert.equal(calls[0].monitoringMode, 'test');
  assert.equal(calls[0].noMotionThresholdMinutes, 1);
  assert.equal(calls[0].locationLostThresholdMinutes, 1);
  await act(async () => buttonWith('切换到正式模式').props.onPress());
  assert.equal(calls.length, 1); // Confirmation must precede the mode change.
  await act(async () => confirmations.at(-1)[2][1].onPress());
  assert.equal(calls[1].monitoringMode, 'standard');
  await act(async () => renderer.update(React.createElement(RulesScreen, {
    schedule: { ...calls[1], noMotionThresholdMinutes: 15, locationLostThresholdMinutes: 15 },
    onChangeSchedule() {},
  })));
  assert.equal(buttonWith('使用 1 分钟测试阈值'), undefined);
  const decreases = renderer.root.findAllByType('TouchableOpacity').filter((button) =>
    button.findAllByType('Text').some((text) => text.children.join('') === '-'));
  assert.equal(decreases.length, 2);
  assert.ok(decreases.every((button) => button.props.disabled));
  await act(async () => renderer.unmount());
});

test('native policy failure is shown in the rules screen', async () => {
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(RulesScreen, {
      schedule: initial().config.schedule,
      async onChangeSchedule() { throw Error('原生写入失败'); },
    }));
  });
  const button = renderer.root.findAllByType('TouchableOpacity').find((candidate) =>
    candidate.findAllByType('Text').some((node) => node.children.join('') === '使用 1 分钟测试阈值'));
  await act(async () => button.props.onPress());
  assert.ok(renderer.root.findAllByType('Text').some((node) => node.children.join('') === '原生写入失败'));
  await act(async () => renderer.unmount());
});
