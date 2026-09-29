const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader({ '@react-native-async-storage/async-storage': {}, 'react-native': {} });
const { retainGuardianEvents, HISTORY_EVENT_LIMIT } = load('src/domain/dataRetention.ts');
const { projectGuardianEvents } = load('src/domain/guardianProjection.ts');
const { createInitialStoredState, parseStoredState } = load('src/storage/guardianSchema.ts');
const { createMemoryGuardianStorage, createFallbackGuardianStorage } = load('src/storage/guardianStorage.ts');
const { createGuardianRepository } = load('src/storage/guardianRepository.ts');
const { createGuardianStore } = load('src/state/guardianStore.ts');
const now = Date.parse('2026-09-28T10:00:00Z');
const day = 86_400_000;
const event = (id, type, at, extra = {}) => ({
  id, type, timestamp: new Date(at).toISOString(), title: type, description: type, source: 'user', ...extra,
});
const seed = () => ({
  ...createInitialStoredState(now), mode: 'device',
});
const disk = (value = seed()) => ({
  ...createMemoryGuardianStorage(value), getStatus: () => ({ durability: 'durable' }),
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

test('history drops expired ordinary events and bounds recent raw samples', () => {
  const input = [event('old', 'LOCATION_UPDATED', now - 31 * day),
    ...Array.from({ length: 2_500 }, (_, i) => event('gps-' + i, 'LOCATION_UPDATED', now - 2_500 + i))];
  const retained = retainGuardianEvents(input, now);
  assert.equal(retained.length, HISTORY_EVENT_LIMIT);
  assert.equal(retained[0].id, 'gps-500');
  assert.equal(input.length, 2_501);
  assert.deepEqual(retainGuardianEvents(retained, now), retained);
});

test('open risk evidence survives age/volume retention and subsequent partial recovery', () => {
  const base = now - 40 * day;
  const risks = [
    event('battery', 'LOW_BATTERY', base),
    event('still', 'NO_MOTION_FOR_LONG_TIME', base + 1),
    event('charge', 'BATTERY_RECOVERED', base + 2),
    event('battery2', 'LOW_BATTERY', base + 3),
    event('move', 'MOTION_DETECTED', base + 4),
    event('location', 'LOCATION_LOST', base + 5, { riskReason: 'locationPermissionDisabled' }),
  ];
  const samples = Array.from({ length: 3_000 }, (_, i) => event('gps' + i, 'LOCATION_UPDATED', now - 3_000 + i));
  const retained = retainGuardianEvents([...risks, ...samples], now);
  assert.equal(retained.length, 2_000 + risks.length);
  assert.deepEqual(projectGuardianEvents(retained, now).incident,
    projectGuardianEvents([...risks, ...samples], now).incident);
  const recovered = retainGuardianEvents([...retained,
    event('reset', 'GUARDIAN_SESSION_RESET', now)], now);
  assert.equal(projectGuardianEvents(recovered, now).incident, undefined);
  assert.equal(recovered.length, 2_000);
  assert.ok(recovered.every((value) => Date.parse(value.timestamp) > base + 5));
});

test('SOS, notifications and same-time recovery preserve their original replay order', () => {
  const base = now - 40 * day;
  const input = [
    event('sos', 'SOS_SENT', base),
    event('sent', 'FAMILY_NOTIFIED', base, { incidentId: 'sos', contactId: 'one' }),
    event('battery', 'LOW_BATTERY', base + 1),
    event('home', 'RETURN_HOME', base + 2),
    event('ack', 'FAMILY_ACKNOWLEDGED', base + 3, { incidentId: 'sos', contactId: 'one' }),
  ];
  assert.deepEqual(projectGuardianEvents(retainGuardianEvents(input, now), now).incident,
    projectGuardianEvents(input, now).incident);
  const settled = [...input, event('safe', 'USER_CONFIRMED_SAFE', base + 4)];
  assert.deepEqual(retainGuardianEvents(settled, now), []);
});

test('deterministic mixed-risk replay preserves the incident across retention and restart', () => {
  const types = ['LOW_BATTERY', 'LOCATION_LOST', 'LOCATION_UPDATED', 'LONG_STAY',
    'NO_MOTION_FOR_LONG_TIME', 'MOTION_DETECTED', 'RETURN_HOME', 'BATTERY_RECOVERED',
    'LOCATION_RESTORED', 'GUARDIAN_SESSION_RESET', 'SOS_SENT', 'USER_CONFIRMED_SAFE', 'RISK_ESCALATED'];
  let random = 0x87325;
  for (let run = 0; run < 250; run++) {
    const input = Array.from({ length: 120 }, (_, i) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const type = types[random % types.length];
      return event('event-' + i, type, now - 35 * day + i * day / 20, {
        ...(type === 'LOCATION_LOST' && random % 2 ? { riskReason: 'locationStale' } : {}),
        ...(random % 5 === 0 ? { batteryLevel: random % 100 } : {}),
      });
    });
    const expected = projectGuardianEvents(input, now).incident;
    const retained = retainGuardianEvents(input, now);
    assert.deepEqual(projectGuardianEvents(retained, now).incident, expected, 'sequence ' + run);
    const restarted = parseStoredState({ ...seed(), localEvents: retained });
    assert.deepEqual(projectGuardianEvents(restarted.localEvents, now).incident, expected);
  }
});

test('startup persists automatic pruning without altering contacts, mode or paused intent', async () => {
  const original = { ...seed(), isGuardianPaused: true,
    localEvents: [event('old', 'LOCATION_UPDATED', now - 40 * day)] };
  const storage = disk(original);
  const store = createGuardianStore(createGuardianRepository(storage), () => now);
  await store.initialize();
  await store.flush();
  assert.deepEqual((await storage.load()).localEvents, []);
  assert.deepEqual(store.getSnapshot().data.config, original.config);
  assert.equal(store.getSnapshot().data.isGuardianPaused, true);
});

test('clear waits for old writes, persists an empty journal, rejects imports, and finishes paused', async () => {
  const gate = deferred();
  const storage = disk();
  let writes = 0;
  const repo = createGuardianRepository({ ...storage, async save(value) {
    if (++writes === 1) await gate.promise;
    await storage.save(value);
  } });
  const store = createGuardianStore(repo, () => now);
  await store.initialize();
  store.setPaused(true);
  await Promise.resolve();
  let nativeCalls = 0;
  const clearing = store.clearLocalData(async () => {
    nativeCalls++;
    const journal = await storage.load();
    assert.equal(journal.dataDeletionPending, true);
    assert.deepEqual(journal.config.contacts, []);
    assert.deepEqual(journal.localEvents, []);
    assert.equal(store.updateConfig((config) => config), false);
    assert.equal(await store.importEvents([event('late', 'SOS_SENT', now)]), false);
  });
  assert.equal(await store.importEvents([event('late2', 'SOS_SENT', now)]), false);
  assert.equal(nativeCalls, 0);
  gate.resolve();
  await clearing;
  const final = await storage.load();
  assert.equal(final.dataDeletionPending, undefined);
  assert.equal(final.isGuardianOn, false);
  assert.equal(final.isGuardianPaused, true);
  assert.equal(final.config.schedule.monitoringMode, 'test');
  assert.deepEqual(final.config.contacts, []);
  assert.deepEqual(final.config.geofences, []);
  assert.deepEqual(final.localEvents, []);
});

test('native deletion failure survives a process restart and can only resume deletion', async () => {
  const storage = disk();
  const store = createGuardianStore(createGuardianRepository(storage), () => now);
  await store.initialize();
  await assert.rejects(store.clearLocalData(async () => { throw Error('native disk locked'); }), /locked/);
  assert.equal((await storage.load()).dataDeletionPending, true);
  const reloaded = createGuardianStore(createGuardianRepository(storage), () => now);
  await reloaded.initialize();
  assert.equal(reloaded.getSnapshot().data.dataDeletionPending, true);
  reloaded.setPaused(false);
  reloaded.reset();
  assert.equal(await reloaded.importEvents([event('old-sos', 'SOS_SENT', now)]), false);
  assert.equal(reloaded.getSnapshot().data.isGuardianPaused, true);
  await reloaded.clearLocalData(async () => {});
  assert.equal((await storage.load()).dataDeletionPending, undefined);
});

test('volatile journal storage never claims deletion or invokes native erase', async () => {
  const primary = disk();
  let offline = true;
  const storage = createFallbackGuardianStorage({
    ...primary, async save(value) {
      if (offline) throw Error('disk full');
      await primary.save(value);
    },
  }, createMemoryGuardianStorage());
  const store = createGuardianStore(createGuardianRepository(storage), () => now);
  await store.initialize();
  let calls = 0;
  await assert.rejects(store.clearLocalData(async () => { calls++; }), /可靠保存/);
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot().data.dataDeletionPending, true);
  assert.equal((await primary.load()).config.contacts.length, 2);
  offline = false;
  await store.clearLocalData(async () => { calls++; });
  assert.equal(calls, 1);
  assert.deepEqual((await primary.load()).config.contacts, []);
});

test('failure saving completion leaves a restartable journal and duplicate clear is blocked', async () => {
  const storage = disk();
  let fail = true;
  const store = createGuardianStore(createGuardianRepository({ ...storage, async save(value) {
    if (fail && !value.dataDeletionPending) throw Error('completion failed');
    await storage.save(value);
  } }), () => now);
  await store.initialize();
  const gate = deferred();
  const first = store.clearLocalData(() => gate.promise);
  await assert.rejects(store.clearLocalData(async () => {}), /正在清除/);
  gate.resolve();
  await assert.rejects(first, /completion failed/);
  assert.equal((await storage.load()).dataDeletionPending, true);
  fail = false;
  await store.clearLocalData(async () => {});
  assert.equal(store.getSnapshot().saveStatus, 'durable');
});

test('clearing is available after corrupted storage without loading default personal data', async () => {
  const storage = disk();
  const store = createGuardianStore(createGuardianRepository({
    ...storage, async load() { throw Error('corrupt'); },
  }), () => now);
  await store.initialize();
  assert.equal(store.getSnapshot().loadStatus, 'error');
  await store.clearLocalData(async () => {});
  assert.equal(store.getSnapshot().loadStatus, 'ready');
  assert.deepEqual((await storage.load()).config.contacts, []);
  assert.equal(store.getSnapshot().data.isGuardianPaused, true);
});

test('frequent raw samples do not remove the latest still-fresh safety confirmation', () => {
  const movement = event('walk', 'MOTION_DETECTED', now - 60_000);
  const samples = Array.from({ length: 2_100 }, (_, i) => event('gps' + i, 'LOCATION_UPDATED', now - 2_100 + i));
  const retained = retainGuardianEvents([movement, ...samples], now);
  assert.equal(projectGuardianEvents(retained, now).lastSafeEvent.id, movement.id);
  assert.equal(retained.length, 2_001);
});

test('native deletion intent precedes the JS journal; failed preparation never erases JS data', async () => {
  const storage = disk();
  const order = [];
  const store = createGuardianStore(createGuardianRepository({ ...storage, async save(value) {
    order.push(value.dataDeletionPending ? 'journal' : 'complete');
    await storage.save(value);
  } }), () => now);
  await store.initialize();
  await assert.rejects(store.clearLocalData(async () => order.push('clear'),
    async () => { throw Error('cannot pause native'); }), /cannot pause/);
  assert.equal((await storage.load()).config.contacts.length, 2);
  assert.deepEqual(order, []);
  await store.clearLocalData(async () => { order.push('clear'); },
    async () => { order.push('native-intent'); });
  assert.deepEqual(order, ['native-intent', 'journal', 'clear', 'complete']);
});

test('stopped event drains neither persist nor acknowledge a delayed pre-delete backlog', async () => {
  const { startGuardianEventSync } = load('src/native/guardianEventSync.ts');
  const gate = deferred();
  const calls = [];
  const sync = startGuardianEventSync({
    getPendingEvents: () => gate.promise,
    async acknowledgeEvents() { calls.push('ack'); },
  }, () => () => {}, async () => { calls.push('save'); return true; }, () => calls.push('error'));
  await Promise.resolve();
  sync.stop();
  gate.resolve([event('old', 'SOS_SENT', now)]);
  await sync.flush();
  assert.deepEqual(calls, []);
});

test('stopping policy sync drops queued edits and waits for the one already in flight', async () => {
  const { startGuardianPolicySync } = load('src/native/guardianPolicySync.ts');
  const gate = deferred(), calls = [];
  const sync = startGuardianPolicySync({ async setMonitoringPolicy(value) {
    calls.push(value.startTime); await gate.promise;
  } });
  const first = sync.update(seed().config.schedule);
  await Promise.resolve();
  const next = sync.update({ ...seed().config.schedule, startTime: '08:00' });
  sync.stop();
  gate.resolve();
  await first;
  await assert.rejects(next, /已停止/);
  await sync.flush();
  assert.deepEqual(calls, ['07:00']);
});
