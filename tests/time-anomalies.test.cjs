const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const load = createLoader({ '@react-native-async-storage/async-storage': {},
  '../assets/guardian-shield.png': 'shield.png',
  'react-native': { Text: 'Text', View: 'View', Image: 'Image', StyleSheet: { create: (value) => value } } });
const { buildGuardianSnapshot } = load('src/domain/riskEngine.ts');
const { retainGuardianEvents, HISTORY_EVENT_LIMIT } = load('src/domain/dataRetention.ts');
const { isWithinGuardianWindow } = load('src/domain/guardianSchedule.ts');
const { parseCurrentLocationSample, parseGuardianConfig } = load('src/domain/validation.ts');
const { resolvePlacePresence } = load('src/domain/placePresence.ts');
const { guardianConfig } = load('src/domain/mockData.ts');
const { createGuardianStore } = load('src/state/guardianStore.ts');
const { createGuardianRepository } = load('src/storage/guardianRepository.ts');
const { createMemoryGuardianStorage } = load('src/storage/guardianStorage.ts');
const { createInitialStoredState } = load('src/storage/guardianSchema.ts');
const { OverviewScreen } = load('src/screens/OverviewScreen.tsx');
const { guardianDiagnosticsSummary, buildGuardianDiagnosticReport, buildGuardianRecentConfirmation } =
  load('src/screens/DiagnosticsScreen.tsx');
const { getStatusTone } = load('src/domain/guardianRules.ts');
const now = Date.parse('2026-09-28T10:00:00Z'), day = 86400000;
const event = (id, type, at, extra = {}) => ({ id, type, source: 'user', title: type, description: type,
  timestamp: new Date(at).toISOString(), ...extra });

for (const zone of ['UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/Berlin', 'Asia/Kathmandu', 'Pacific/Apia']) {
  test('daily window, absolute freshness and calendar labels in ' + zone, () => {
    const output = execFileSync(process.execPath, [path.join(__dirname, 'fixtures/time-zone-case.cjs'), zone], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 20000,
    });
    assert.match(output, /time-zone checks passed/);
  });
}

test('future confirmations and recoveries cannot clear current SOS or passive risks early', () => {
  for (const [risk, recovery] of [['SOS_SENT', 'USER_CONFIRMED_SAFE'], ['LOW_BATTERY', 'BATTERY_RECOVERED'],
    ['LOCATION_LOST', 'LOCATION_RESTORED'], ['NO_MOTION_FOR_LONG_TIME', 'MOTION_DETECTED']]) {
    const events = [event('risk', risk, now - 60000), event('recovery', recovery, now + 10000)];
    const current = buildGuardianSnapshot(events, { now });
    assert.ok(current.incident, risk);
    assert.equal(current.clockUncertain, true);
    assert.equal(buildGuardianSnapshot(events, { now: now + 10000 }).incident, undefined);
  }
  assert.equal(buildGuardianSnapshot([event('safe', 'USER_CONFIRMED_SAFE', now + 1)], { now }).status, 'unknown');
});

test('a rolled-back clock cannot use old future signals to claim a healthy snapshot', () => {
  const events = [event('past', 'MOTION_DETECTED', now - 60000), event('future-risk', 'SOS_SENT', now + 3600000)];
  const snapshot = buildGuardianSnapshot(events, { now });
  assert.equal(snapshot.status, 'unknown');
  assert.equal(snapshot.clockUncertain, true);
  assert.match(snapshot.riskReason, /无法确认/);
  assert.equal(snapshot.events.length, 2);
  assert.equal(buildGuardianSnapshot(events, { now: now + 3600000 }).status, 'emergency');
});

test('diagnostic summary and report never describe a future recovery as already confirmed', () => {
  const input = { mode: 'device', now, geofenceSyncStatus: 'synced', geofenceCount: 1,
    currentLocationState: 'idle', events: [event('risk', 'NO_MOTION_FOR_LONG_TIME', now - 60000),
      event('recovery', 'MOTION_DETECTED', now + 10000)] };
  assert.equal(guardianDiagnosticsSummary(input).title, '设备时间需要确认');
  assert.match(buildGuardianDiagnosticReport(input), /存在晚于当前时间的记录/);
  assert.match(buildGuardianDiagnosticReport(input), /风险恢复：暂无记录/);
  assert.equal(buildGuardianRecentConfirmation(input), undefined);
});

test('rollback rejects an old-clock location; a fresh replacement can still locate the place', () => {
  const fences = [{ id: 'home', kind: 'home', name: '家', center: { latitude: 30, longitude: 120 }, radiusMeters: 150 }];
  const sample = { latitude: 30, longitude: 120, accuracy: 8, timestamp: new Date(now + 3600000).toISOString() };
  assert.throws(() => parseCurrentLocationSample(sample, now), /过期/);
  assert.equal(resolvePlacePresence({ events: [] }, fences, sample, now).state, 'unknown');
  const fresh = { ...sample, timestamp: new Date(now).toISOString() };
  assert.equal(resolvePlacePresence({ events: [] }, fences, fresh, now).state, 'inside');
  assert.equal(resolvePlacePresence({ events: [] }, fences, fresh, now + 120001).state, 'unknown');
});

test('future GPS backlog cannot evict new samples or future recovery evidence', () => {
  const input = [event('risk', 'LOW_BATTERY', now - 60000),
    event('fresh', 'LOCATION_UPDATED', now),
    event('later-recovery', 'BATTERY_RECOVERED', now + 1000),
    ...Array.from({ length: 2500 }, (_, i) => event('ahead-' + i, 'LOCATION_UPDATED', now + 2000 + i))];
  const retained = retainGuardianEvents(input, now);
  assert.ok(retained.some((e) => e.id === 'fresh'));
  assert.ok(retained.some((e) => e.id === 'later-recovery'));
  assert.equal(buildGuardianSnapshot(retained, { now }).incident.risks[0].type, 'LOW_BATTERY');
  assert.equal(buildGuardianSnapshot(retained, { now: now + 1500 }).incident, undefined);
  assert.ok(retained.length <= HISTORY_EVENT_LIMIT + 4);
  assert.deepEqual(retainGuardianEvents(retained, now), retained);
  assert.ok(retainGuardianEvents(retained, now + 10000).length <= HISTORY_EVENT_LIMIT);
});

test('forward jumps expire ordinary signals, preserve active risks, and invalid clocks never erase history', () => {
  const input = [event('sos', 'SOS_SENT', now - day), event('gps', 'LOCATION_UPDATED', now)];
  assert.equal(buildGuardianSnapshot([event('move', 'MOTION_DETECTED', now)], { now: now + day }).status, 'unknown');
  assert.equal(buildGuardianSnapshot(retainGuardianEvents(input, now + 60 * day), { now: now + 60 * day }).status, 'emergency');
  for (const invalid of [NaN, Infinity, -Infinity, 9e15])
    assert.deepEqual(retainGuardianEvents(input, invalid), input);
  assert.equal(buildGuardianSnapshot(input, { now: NaN }).status, 'unknown');
});

test('time changes do not implicitly enable overnight or equal-endpoint schedules', () => {
  for (const [startTime, expectedReturnTime] of [['23:00', '07:00'], ['07:00', '07:00'], ['00:00', '25:00'], ['bad', '18:00']]) {
    const schedule = { ...guardianConfig.schedule, startTime, expectedReturnTime };
    assert.equal(isWithinGuardianWindow(schedule, new Date(now)), false);
    assert.throws(() => parseGuardianConfig({ ...guardianConfig, schedule }));
  }
  assert.equal(isWithinGuardianWindow(guardianConfig.schedule, new Date(NaN)), false);
});

test('quarantined future recovery survives durable import and restart without resurrecting a resolved alert', async () => {
  const seed = createInitialStoredState(now, 'device'); seed.isGuardianPaused = true;
  const storage = { ...createMemoryGuardianStorage(seed), getStatus: () => ({ durability: 'durable' }) };
  let clock = now;
  const make = () => createGuardianStore(createGuardianRepository(storage), () => clock);
  let store = make(); await store.initialize();
  const input = [event('risk', 'NO_MOTION_FOR_LONG_TIME', now - 1000),
    event('recovery', 'MOTION_DETECTED', now + 1000),
    ...Array.from({ length: 2200 }, (_, i) => event('ahead-' + i, 'LOCATION_UPDATED', now + 2000 + i))];
  assert.equal(await store.importEvents(input), true);
  assert.equal(await store.importEvents([event('new', 'LOCATION_UPDATED', now)]), true);
  store = make(); await store.initialize();
  assert.ok(store.getSnapshot().data.localEvents.some((e) => e.id === 'new'));
  assert.ok(buildGuardianSnapshot(store.getSnapshot().data.localEvents, { now: clock }).incident);
  clock += 1500;
  assert.equal(buildGuardianSnapshot(store.getSnapshot().data.localEvents, { now: clock }).incident, undefined);
  clock += 10000; store.pruneHistory(); await store.flush();
  assert.ok(store.getSnapshot().data.localEvents.length <= HISTORY_EVENT_LIMIT + 1);
  assert.equal(store.getSnapshot().data.isGuardianPaused, true);
});

test('time inconsistency is visible instead of a healthy shield, without changing monitoring', async () => {
  const snapshot = buildGuardianSnapshot([event('ahead', 'MOTION_DETECTED', now + 60000)], { now });
  let renderer;
  await act(async () => { renderer = create(React.createElement(OverviewScreen, {
    snapshot, now, geofences: [], currentLocationState: 'idle', guardianReady: true,
    guardianStatus: '', isGuardianOn: true, mode: 'device', tone: getStatusTone(snapshot.status),
  })); });
  try {
    const copy = renderer.root.findAllByType('Text').map((node) => node.children.join('')).join('\n');
    assert.match(copy, /设备时间需要确认/);
    assert.doesNotMatch(copy, /✓|状态正常|守护已暂停/);
  } finally { await act(async () => renderer.unmount()); }
});
