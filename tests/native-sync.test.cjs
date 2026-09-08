const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader({ '@react-native-async-storage/async-storage': {} });
const { startGuardianEventSync } = load('src/native/guardianEventSync.ts');
const { createGuardianStore } = load('src/state/guardianStore.ts');
const { createGuardianRepository } = load('src/storage/guardianRepository.ts');
const { createInitialStoredState } = load('src/storage/guardianSchema.ts');
const { createMemoryGuardianStorage, createFallbackGuardianStorage } = load(
  'src/storage/guardianStorage.ts',
);
const event = {
  id: 'native-1',
  type: 'SOS_SENT',
  title: 'SOS',
  description: 'Help',
  timestamp: '2026-09-08T08:00:00.000Z',
  receivedAt: '2026-09-08T08:00:01.000Z',
  source: 'user',
};

test('native queue is acknowledged only after durable JS persistence', async () => {
  const order = [];
  const errors = [];
  const sync = startGuardianEventSync(
    {
      async getPendingEvents() {
        order.push('read');
        return [event];
      },
      async acknowledgeEvents(ids) {
        order.push('ack');
        assert.deepEqual(ids, [event.id]);
      },
    },
    () => {
      order.push('subscribe');
      return () => {};
    },
    async (values) => {
      order.push('persist');
      assert.equal(values[0].id, event.id);
      return true;
    },
    (error) => errors.push(error),
  );
  await sync.retry();
  sync.stop();
  assert.deepEqual(order, ['subscribe', 'read', 'persist', 'ack']);
  assert.deepEqual(errors, []);
});
test('failed or volatile persistence leaves the native queue intact', async () => {
  for (const persist of [
    async () => false,
    async () => {
      throw Error('disk failure');
    },
  ]) {
    let acknowledgements = 0;
    const sync = startGuardianEventSync(
      {
        async getPendingEvents() {
          return [event];
        },
        async acknowledgeEvents() {
          acknowledgements++;
        },
      },
      () => () => {},
      persist,
      () => {},
    );
    await sync.retry();
    sync.stop();
    assert.equal(acknowledgements, 0);
  }
});
test('events arriving during a save trigger another serialized drain', async () => {
  let listener,
    saved = [],
    acked = [],
    pending = [event];
  const second = { ...event, id: 'native-2' };
  const sync = startGuardianEventSync(
    {
      async getPendingEvents() {
        return [...pending];
      },
      async acknowledgeEvents(ids) {
        acked.push(...ids);
        pending = pending.filter((item) => !ids.includes(item.id));
      },
    },
    (callback) => {
      listener = callback;
      return () => {};
    },
    async (events) => {
      saved.push(...events.map((item) => item.id));
      if (saved.length === 1) {
        pending.push(second);
        listener();
      }
      return true;
    },
    (error) => {
      throw error;
    },
  );
  await sync.retry();
  sync.stop();
  assert.deepEqual(saved, ['native-1', 'native-2']);
  assert.deepEqual(acked, saved);
});
test('invalid bridge data fails closed instead of acknowledging lost events', async () => {
  let acknowledgements = 0,
    errors = [];
  const sync = startGuardianEventSync(
    {
      async getPendingEvents() {
        return [{}];
      },
      async acknowledgeEvents() {
        acknowledgements++;
      },
    },
    () => () => {},
    async () => true,
    (error) => errors.push(error),
  );
  await sync.retry();
  sync.stop();
  assert.equal(acknowledgements, 0);
  assert.equal(errors.length, 1);
});
test('an acknowledgement failure can replay without duplicating stored events', async () => {
  const seed = createInitialStoredState(Date.parse(event.timestamp), 'device');
  const memory = createMemoryGuardianStorage(seed);
  const store = createGuardianStore(
    createGuardianRepository({ ...memory, getStatus: () => ({ durability: 'durable' }) }),
  );
  await store.initialize();
  let attempts = 0;
  const sync = startGuardianEventSync(
    {
      async getPendingEvents() {
        return [event];
      },
      async acknowledgeEvents() {
        if (++attempts === 1) throw Error('ack failed');
      },
    },
    () => () => {},
    store.importEvents,
    () => {},
  );
  await sync.retry();
  await sync.retry();
  sync.stop();
  assert.equal(attempts, 2);
  assert.equal((await memory.load()).localEvents.length, 1);
});
test('memory fallback prevents native acknowledgement until a durable retry succeeds', async () => {
  let offline = true,
    acked = 0;
  const seed = createInitialStoredState(Date.parse(event.timestamp), 'device');
  const disk = createMemoryGuardianStorage(seed);
  const driver = createFallbackGuardianStorage(
    {
      ...disk,
      getStatus: () => ({ durability: 'durable' }),
      async save(value) {
        if (offline) throw Error('offline');
        await disk.save(value);
      },
    },
    createMemoryGuardianStorage(),
  );
  const store = createGuardianStore(createGuardianRepository(driver));
  await store.initialize();
  const sync = startGuardianEventSync(
    {
      async getPendingEvents() {
        return [event];
      },
      async acknowledgeEvents() {
        acked++;
      },
    },
    () => () => {},
    store.importEvents,
    () => {},
  );
  await sync.retry();
  assert.equal(acked, 0);
  offline = false;
  await sync.retry();
  sync.stop();
  assert.equal(acked, 1);
  assert.equal((await disk.load()).localEvents.length, 1);
});
test('bridge export declarations match the TS queue and permission contract (static)', () => {
  const swift = fs.readFileSync(
    path.join(__dirname, '../ios/GuardianCore/GuardianNativeModule.swift'),
    'utf8',
  );
  const objc = fs.readFileSync(
    path.join(__dirname, '../ios/GuardianCore/GuardianNativeModule.m'),
    'utf8',
  );
  for (const method of [
    'getPendingEvents',
    'acknowledgeEvents',
    'getCurrentStatus',
    'getPermissions',
    'requestPermissions',
    'startGuardian',
    'stopGuardian',
    'setGeofences',
    'confirmSafe',
    'sendSOS',
  ]) {
    assert.ok(swift.includes(`func ${method}(`));
    assert.ok(objc.includes(`RCT_EXTERN_METHOD(${method}:`));
  }
});
