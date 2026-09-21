const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader({ '@react-native-async-storage/async-storage': {} });
const { createInitialStoredState, parseStoredState } = load('src/storage/guardianSchema.ts');
const { createMemoryGuardianStorage: memory, createFallbackGuardianStorage: fallback } = load(
  'src/storage/guardianStorage.ts',
);
const { createGuardianRepository: repository } = load('src/storage/guardianRepository.ts');
const { createGuardianStore } = load('src/state/guardianStore.ts');
const { parseGuardianConfig } = load('src/domain/validation.ts');
const now = Date.parse('2026-09-08T10:00:00Z');
const initial = () => createInitialStoredState(now);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const unavailable = {
  async load() {
    throw Error('offline');
  },
  async save() {
    throw Error('offline');
  },
  async clear() {
    throw Error('offline');
  },
};
const durable = (seed = initial()) => ({
  ...memory(seed),
  getStatus: () => ({ durability: 'durable' }),
});
const sos = { type: 'SOS_SENT', title: 'SOS', description: 'Help requested', source: 'user' };

test('memory storage clones reads and writes; clear means absent', async () => {
  const driver = memory(initial());
  const state = await driver.load();
  state.config.contacts.length = 0;
  assert.equal((await driver.load()).config.contacts.length, 2);
  await driver.save(state);
  state.localEvents.length = 0;
  assert.notEqual((await driver.load()).localEvents.length, 0);
  await driver.clear();
  assert.equal(await driver.load(), undefined);
});
test('AsyncStorage JSON adapter round-trips v3', async () => {
  const values = new Map();
  const adapterLoad = createLoader({
    '@react-native-async-storage/async-storage': {
      async getItem(key) {
        return values.get(key) ?? null;
      },
      async setItem(key, value) {
        values.set(key, value);
      },
      async removeItem(key) {
        values.delete(key);
      },
    },
  });
  const driver = adapterLoad(
    'src/storage/asyncStorageGuardianStorage.ts',
  ).createAsyncStorageGuardianStorage();
  await driver.save(initial());
  assert.deepEqual(await driver.load(), initial());
  await driver.clear();
  assert.equal(await driver.load(), undefined);
});
test('R05: failed writes and clears resolve with explicit volatile status', async () => {
  const driver = fallback(unavailable, memory(initial()));
  const next = { ...initial(), isGuardianOn: false };
  await driver.save(next);
  assert.equal(driver.getStatus().durability, 'memory');
  assert.deepEqual(await driver.load(), next);
  await driver.clear();
  assert.equal(await driver.load(), undefined);
});
test('R05: successful reads refresh the fallback; subsequent errors preserve user data', async () => {
  let offline = false;
  const state = initial();
  state.config.contacts[0].name = 'Saved family';
  const driver = fallback(
    {
      ...unavailable,
      async load() {
        if (offline) throw Error('offline');
        return state;
      },
    },
    memory(),
  );
  await driver.load();
  offline = true;
  assert.equal((await driver.load()).config.contacts[0].name, 'Saved family');
});
test('cold read failures reject and never fabricate default contacts', async () => {
  await assert.rejects(repository(fallback(unavailable, memory()), initial).loadState(), /offline/);
});
test('dirty fallback is not overwritten by an old primary copy after recovery', async () => {
  let offline = true;
  const primary = durable();
  const driver = fallback(
    {
      ...primary,
      async save(state) {
        if (offline) throw Error('offline');
        await primary.save(state);
      },
    },
    memory(),
  );
  await driver.load();
  const next = { ...initial(), isGuardianOn: false };
  await driver.save(next);
  offline = false;
  assert.equal((await driver.load()).isGuardianOn, false);
  await driver.save(next);
  assert.equal(driver.getStatus().durability, 'durable');
  assert.equal((await primary.load()).isGuardianOn, false);
});
test('R07: bad JSON shape and future schema versions are rejected', () => {
  for (const value of [
    {},
    { ...initial(), schemaVersion: 4 },
    { ...initial(), isGuardianPaused: 'yes' },
    { ...initial(), localEvents: [{}] },
  ])
    assert.throws(() => parseStoredState(value));
});
test('R09: legacy HH:mm events migrate across midnight without assuming recipients', () => {
  const updatedAt = new Date(2026, 8, 8, 0, 5).toISOString();
  const raw = {
    config: initial().config,
    updatedAt,
    localEvents: [
      {
        id: 'old1',
        type: 'SOS_SENT',
        title: 'SOS',
        description: 'SOS',
        source: 'user',
        timestamp: '23:58',
      },
      {
        id: 'old2',
        type: 'FAMILY_NOTIFIED',
        title: 'Sent',
        description: 'Sent',
        source: 'notification',
        timestamp: '00:02',
      },
    ],
  };
  const migrated = parseStoredState(raw);
  assert.equal(new Date(migrated.localEvents[0].timestamp).getDate(), 7);
  assert.equal(new Date(migrated.localEvents[1].timestamp).getDate(), 8);
  assert.equal(migrated.localEvents[1].contactId, undefined);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.isGuardianPaused, false);
});
test('v2 device state preserves an intentional pause during migration', () => {
  const raw = initial();
  raw.schemaVersion = 2;
  delete raw.isGuardianPaused;
  raw.mode = 'device';
  raw.isGuardianOn = false;
  const migrated = parseStoredState(raw);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.isGuardianPaused, true);
});
test('R12: invalid time, phone, duplicate contacts and excessive fences are rejected', () => {
  const variants = [
    (value) => {
      value.schedule.startTime = '99:99';
    },
    (value) => {
      value.schedule.expectedReturnTime = '06:00';
    },
    (value) => {
      value.schedule.noMotionThresholdMinutes = 0;
    },
    (value) => {
      value.contacts[0].phone = 'x';
    },
    (value) => {
      value.contacts[1].phone = value.contacts[0].phone;
    },
    (value) => {
      value.geofences = Array.from({ length: 21 }, (_, i) => ({
        ...value.geofences[0],
        id: `f${i}`,
      }));
    },
  ];
  for (const mutate of variants) {
    const value = initial().config;
    mutate(value);
    assert.throws(() => parseGuardianConfig(value));
  }
});
test('one-minute inactivity threshold is accepted for field testing', () => {
  const value = initial().config;
  value.schedule.noMotionThresholdMinutes = 1;
  assert.equal(parseGuardianConfig(value).schedule.noMotionThresholdMinutes, 1);
});
test('repository serializes writes and snapshots values before awaiting', async () => {
  const gate = deferred();
  const calls = [];
  const driver = durable();
  const repo = repository(
    {
      ...driver,
      async save(value) {
        calls.push(value);
        if (calls.length === 1) await gate.promise;
        await driver.save(value);
      },
    },
    initial,
  );
  const first = initial();
  const one = repo.saveState(first);
  first.isGuardianOn = false;
  const two = repo.saveState({ ...initial(), isGuardianOn: false });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].isGuardianOn, true);
  gate.resolve();
  await Promise.all([one, two]);
  assert.equal((await driver.load()).isGuardianOn, false);
});
test('activating device mode clears demo coordinates, contacts and events before persistence', async () => {
  const disk = durable();
  const store = createGuardianStore(repository(disk), () => now);
  await store.initialize();
  assert.equal(store.activateDeviceMode(), true);
  await store.flush();
  const current = store.getSnapshot().data;
  assert.equal(current.mode, 'device');
  assert.deepEqual(current.config.geofences, []);
  assert.deepEqual(current.config.contacts, []);
  assert.deepEqual(current.localEvents, []);
  assert.equal(current.isGuardianOn, false);
  assert.equal((await disk.load()).mode, 'device');
  assert.equal(store.activateDeviceMode(), false);
});
test('R06: a pending SOS survives hydration and is saved with loaded contacts', async () => {
  const gate = deferred();
  const disk = durable();
  const old = initial();
  old.config.contacts[0].name = 'Actual family';
  const store = createGuardianStore(
    repository({ ...disk, load: () => gate.promise }, initial),
    () => now,
  );
  const initializing = store.initialize();
  const requested = store.addEvent(sos);
  assert.equal(
    store.updateConfig((config) => ({ ...config, contacts: [] })),
    false,
  );
  gate.resolve(old);
  await initializing;
  await store.flush();
  assert.equal(store.getSnapshot().data.config.contacts[0].name, 'Actual family');
  assert.ok((await disk.load()).localEvents.some((event) => event.id === requested.id));
});
test('failed hydration keeps queued actions and never writes until retry succeeds', async () => {
  let offline = true,
    writes = 0;
  const disk = durable();
  const store = createGuardianStore(
    repository(
      {
        ...disk,
        async load() {
          if (offline) throw Error('offline');
          return disk.load();
        },
        async save(value) {
          writes++;
          await disk.save(value);
        },
      },
      initial,
    ),
    () => now,
  );
  await store.initialize();
  store.addEvent(sos);
  await store.flush();
  assert.equal(writes, 0);
  assert.equal(store.getSnapshot().loadStatus, 'error');
  offline = false;
  await store.retry();
  await store.flush();
  assert.equal((await disk.load()).localEvents.at(-1).type, 'SOS_SENT');
});
test('continuous config/event changes and reset settle on the latest full state', async () => {
  const gate = deferred();
  const disk = durable();
  let writes = 0;
  const store = createGuardianStore(
    repository(
      {
        ...disk,
        async save(value) {
          if (++writes === 1) await gate.promise;
          await disk.save(value);
        },
      },
      initial,
    ),
    () => now,
  );
  await store.initialize();
  store.updateConfig((config) => ({
    ...config,
    schedule: { ...config.schedule, startTime: '09:00' },
  }));
  store.addEvent(sos);
  await Promise.resolve();
  store.reset();
  store.setEnabled(false);
  gate.resolve();
  await store.flush();
  const saved = await disk.load();
  assert.equal(saved.isGuardianOn, false);
  assert.equal(saved.config.schedule.startTime, '07:00');
  assert.ok(!saved.localEvents.some((event) => event.type === 'SOS_SENT'));
});
test('save failure retains edits and retries only the latest state', async () => {
  let offline = true;
  const disk = durable();
  const store = createGuardianStore(
    repository(
      {
        ...disk,
        async save(state) {
          if (offline) throw Error('offline');
          await disk.save(state);
        },
      },
      initial,
    ),
    () => now,
  );
  await store.initialize();
  store.setEnabled(false);
  await store.flush();
  assert.equal(store.getSnapshot().saveStatus, 'error');
  assert.equal(store.getSnapshot().data.isGuardianOn, false);
  offline = false;
  await store.retry();
  assert.equal(store.getSnapshot().saveStatus, 'durable');
  assert.equal((await disk.load()).isGuardianOn, false);
});
test('an explicit guardian pause is durable and independent from native enabled state', async () => {
  const disk = durable();
  const store = createGuardianStore(repository(disk), () => now);
  await store.initialize();
  store.setPaused(true);
  await store.flush();
  assert.equal(store.getSnapshot().data.isGuardianPaused, true);
  assert.equal((await disk.load()).isGuardianPaused, true);
});
test('same-millisecond events get unique identities', async () => {
  const store = createGuardianStore(repository(durable(), initial), () => now);
  await store.initialize();
  const ids = Array.from({ length: 100 }, () => store.addEvent(sos).id);
  assert.equal(new Set(ids).size, 100);
  await store.flush();
});

test('an edit queued at Promise completion is persisted before flush returns', async () => {
  const disk = durable();
  const store = createGuardianStore(repository(disk, initial), () => now);
  await store.initialize();
  let queued = false;
  let sawSaving = false;
  const unsubscribe = store.subscribe(() => {
    if (store.getSnapshot().saveStatus === 'saving') sawSaving = true;
    if (store.getSnapshot().saveStatus === 'durable' && sawSaving && !queued) {
      queued = true;
      queueMicrotask(() => store.addEvent(sos));
    }
  });
  store.setEnabled(false);
  await store.flush();
  unsubscribe();
  assert.ok((await disk.load()).localEvents.some((event) => event.type === 'SOS_SENT'));
});
