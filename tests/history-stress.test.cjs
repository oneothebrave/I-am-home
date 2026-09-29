const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader({ '@react-native-async-storage/async-storage': {}, 'react-native': {} });
const { createInitialStoredState } = load('src/storage/guardianSchema.ts');
const { createMemoryGuardianStorage, createFallbackGuardianStorage } = load('src/storage/guardianStorage.ts');
const { createGuardianRepository } = load('src/storage/guardianRepository.ts');
const { createGuardianStore } = load('src/state/guardianStore.ts');
const { startGuardianEventSync } = load('src/native/guardianEventSync.ts');
const { projectGuardianEvents } = load('src/domain/guardianProjection.ts');
const { retainGuardianEvents, HISTORY_EVENT_LIMIT } = load('src/domain/dataRetention.ts');
const start = Date.parse('2026-06-01T10:00:00Z'), day = 86400000;
const event = (id, type, at, extra = {}) => ({ id, type, timestamp: new Date(at).toISOString(),
  source: 'location', title: type, description: type, ...extra });
const seed = () => ({ ...createInitialStoredState(start, 'device'), isGuardianPaused: true });
const disk = () => ({ ...createMemoryGuardianStorage(seed()), getStatus: () => ({ durability: 'durable' }) });

test('60 simulated days preserve replay truth through retention, periodic restart and recovery', async () => {
  let clock = start; const storage = disk();
  const makeStore = () => createGuardianStore(createGuardianRepository(storage), () => clock);
  let store = makeStore(); await store.initialize();
  const originalConfig = store.getSnapshot().data.config;
  const reference = [];
  for (let index = 0; index < 60; index++) {
    clock = start + index * day + 60000;
    const at = clock - 60000;
    const batch = Array.from({ length: 120 }, (_, i) => event(`day-${index}-${i}`, 'LOCATION_UPDATED', at + i));
    if (index === 0) batch.unshift(event('persistent-risk', 'LOCATION_LOST', at - 1,
      { riskReason: 'locationPermissionDisabled' }));
    if (index === 35) batch.push(event('restored', 'LOCATION_RESTORED', at + 500));
    if (index === 40) batch.push(event('battery-risk', 'LOW_BATTERY', at + 500));
    if (index === 44) batch.push(event('charged', 'BATTERY_RECOVERED', at + 500));
    reference.push(...batch);
    assert.equal(await store.importEvents(batch), true);
    if (index % 7 === 0) {
      store = makeStore(); await store.initialize(); await store.flush();
    }
    const current = store.getSnapshot().data;
    assert.deepEqual(projectGuardianEvents(current.localEvents, clock).incident,
      projectGuardianEvents(reference, clock).incident, `day ${index}`);
    assert.equal(new Set(current.localEvents.map((value) => value.id)).size, current.localEvents.length);
    assert.deepEqual(current.config, originalConfig);
    assert.equal(current.isGuardianPaused, true);
    assert.ok(current.localEvents.length <= HISTORY_EVENT_LIMIT + 1);
    if (index === 34) assert.ok(current.localEvents.some((value) => value.id === 'persistent-risk'));
    if (index === 35) assert.equal(current.localEvents.some((value) => value.id === 'persistent-risk'), false);
  }
  clock += 31 * day;
  store.pruneHistory(); await store.flush();
  assert.deepEqual(store.getSnapshot().data.localEvents, []);
  assert.deepEqual((await storage.load()).localEvents, []);
});

test('8000-event burst survives unavailable storage, acknowledgement failure and restart without duplicate history', async () => {
  const now = start + day;
  const durable = disk(); let failSave = true, failAck = true;
  const primary = { ...durable, async save(value) {
    if (failSave) throw Error('disk-full');
    await durable.save(value);
  } };
  let store = createGuardianStore(createGuardianRepository(
    createFallbackGuardianStorage(primary, createMemoryGuardianStorage())), () => now);
  await store.initialize();
  let backlog = Array.from({ length: 8000 }, (_, i) => event('burst-' + i, 'LOCATION_UPDATED', now - 8000 + i));
  let acknowledgements = 0;
  const errors = [];
  const native = {
    async getPendingEvents() { return [...backlog]; },
    async acknowledgeEvents(ids) {
      acknowledgements++;
      assert.equal(store.getSnapshot().saveStatus, 'durable');
      if (failAck) throw Error('ack interrupted');
      const received = new Set(ids); backlog = backlog.filter((value) => !received.has(value.id));
    },
  };
  const makeSync = () => startGuardianEventSync(native, () => () => {}, store.importEvents, (error) => errors.push(error));
  let sync = makeSync(); await sync.flush();
  assert.equal(acknowledgements, 0);
  assert.equal(backlog.length, 8000);
  assert.equal(store.getSnapshot().saveStatus, 'memory');
  failSave = false; await sync.retry();
  assert.equal(backlog.length, 8000);
  assert.ok(errors.some((error) => error.message === 'ack interrupted'));
  const persisted = await durable.load();
  assert.equal(persisted.localEvents.length, HISTORY_EVENT_LIMIT);
  assert.equal(persisted.localEvents[0].id, 'burst-6000');
  sync.stop(); await sync.flush();
  store = createGuardianStore(createGuardianRepository(primary), () => now);
  await store.initialize(); failAck = false;
  sync = makeSync(); await sync.flush(); sync.stop();
  assert.equal(backlog.length, 0);
  assert.deepEqual(store.getSnapshot().data.localEvents, persisted.localEvents);
  assert.equal(acknowledgements, 2);
});

test('10000 active risk transitions may exceed the normal cap without losing evidence or exhausting replay', () => {
  const now = start + 60 * day;
  const input = [event('sos', 'SOS_SENT', start, { source: 'user' }),
    ...Array.from({ length: 10000 }, (_, i) => event('risk-' + i,
      i % 2 ? 'BATTERY_RECOVERED' : 'LOW_BATTERY', start + i + 1))];
  const retained = retainGuardianEvents(input, now);
  assert.deepEqual(projectGuardianEvents(retained, now).incident, projectGuardianEvents(input, now).incident);
  assert.ok(retained.length > HISTORY_EVENT_LIMIT);
  assert.deepEqual(retainGuardianEvents([...retained,
    event('safe', 'USER_CONFIRMED_SAFE', now, { source: 'user' })], now).map((value) => value.id), ['safe']);
});
