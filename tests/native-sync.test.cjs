const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader({ '@react-native-async-storage/async-storage': {} });
const { startGuardianEventSync } = load('src/native/guardianEventSync.ts');
const { startGuardianGeofenceSync } = load('src/native/guardianGeofenceSync.ts');
const { startGuardianControl } = load('src/native/guardianControl.ts');
const { parseCurrentLocationSample } = load('src/domain/validation.ts');
const { parseCriticalMessagingPreparation } = load('src/native/criticalMessaging.ts');
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
test('geofence sync serializes writes and leaves native on the latest configuration', async () => {
  let releaseFirst, markStarted;
  const firstStarted = new Promise((resolve) => {
    markStarted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const calls = [];
  let concurrent = 0,
    maxConcurrent = 0;
  const sync = startGuardianGeofenceSync(
    {
      async setGeofences(geofences) {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        calls.push(geofences.map((fence) => fence.id));
        if (calls.length === 1) {
          markStarted();
          await firstGate;
        }
        concurrent--;
      },
    },
    () => {},
    (error) => {
      throw error;
    },
  );
  const fence = (id) => ({
    id,
    name: id,
    kind: 'work',
    center: { latitude: 30, longitude: 120, accuracy: 10 },
    radiusMeters: 300,
  });
  sync.update([fence('first')]);
  await firstStarted;
  sync.update([fence('first')]);
  sync.update([fence('latest')]);
  releaseFirst();
  await sync.flush();
  sync.update([fence('latest')]);
  await sync.flush();
  sync.stop();
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(calls, [['first'], ['latest']]);
});
test('failed geofence sync reports failure and retries the same desired state', async () => {
  let attempts = 0,
    errors = 0;
  const statuses = [];
  const sync = startGuardianGeofenceSync(
    {
      async setGeofences() {
        if (++attempts === 1) throw Error('native write failed');
      },
    },
    (status) => statuses.push(status),
    () => errors++,
  );
  const fences = [
    {
      id: 'home',
      name: '家',
      kind: 'home',
      center: { latitude: 30, longitude: 120 },
      radiusMeters: 160,
    },
  ];
  sync.update(fences);
  await assert.rejects(sync.flush(), /native write failed/);
  sync.update(fences);
  await sync.flush();
  sync.stop();
  assert.equal(attempts, 2);
  assert.equal(errors, 1);
  assert.equal(statuses.at(-1), 'synced');
});
test('current location samples reject stale, imprecise and malformed bridge data', () => {
  const now = Date.parse('2026-09-20T10:00:00.000Z');
  const valid = {
    latitude: 30,
    longitude: 120,
    accuracy: 18,
    timestamp: '2026-09-20T09:59:30.000Z',
  };
  assert.deepEqual(parseCurrentLocationSample(valid, now), valid);
  assert.throws(() => parseCurrentLocationSample({ ...valid, accuracy: 101 }, now), /精度/);
  assert.throws(
    () =>
      parseCurrentLocationSample({ ...valid, timestamp: '2026-09-20T09:57:59.000Z' }, now),
    /过期/,
  );
  assert.throws(() => parseCurrentLocationSample({ ...valid, latitude: 91 }, now), /经纬度/);
});
test('guardian control changes JS state only after native confirms start and stop', async () => {
  const order = [];
  let status = {
    isGuardianOn: false,
    isMonitoring: false,
    pendingEventCount: 0,
  };
  const states = [];
  const control = startGuardianControl(
    {
      async getCurrentStatus() {
        order.push('status');
        return { ...status };
      },
      async startGuardian() {
        order.push('start');
        status = { ...status, isGuardianOn: true, isMonitoring: true };
      },
      async stopGuardian() {
        order.push('stop');
        status = { ...status, isGuardianOn: false, isMonitoring: false };
      },
    },
    (state) => states.push(state.phase),
    (enabled) => order.push(`js:${enabled}`),
    (error) => {
      throw error;
    },
  );
  const config = createInitialStoredState().config;
  await control.setEnabled(true, config);
  await control.setEnabled(false, config);
  control.stop();
  assert.deepEqual(order, ['start', 'status', 'js:true', 'stop', 'status', 'js:false']);
  assert.deepEqual(states, ['starting', 'monitoring', 'stopping', 'off']);
});
test('guardian control rolls the UI back to native truth after a failed start', async () => {
  const enabled = [];
  const states = [];
  const errors = [];
  const control = startGuardianControl(
    {
      async getCurrentStatus() {
        return { isGuardianOn: false, isMonitoring: false, pendingEventCount: 0 };
      },
      async startGuardian() {
        throw Error('Always permission required');
      },
      async stopGuardian() {},
    },
    (state) => states.push(state),
    (value) => enabled.push(value),
    (error) => errors.push(error),
  );
  await assert.rejects(
    control.setEnabled(true, createInitialStoredState().config),
    /Always permission required/,
  );
  control.stop();
  assert.deepEqual(enabled, [false]);
  assert.equal(states.at(-1).phase, 'error');
  assert.equal(states.at(-1).nativeStatus.isGuardianOn, false);
  assert.equal(errors.length, 1);
});
test('guardian control serializes rapid toggles and refresh recovers native state', async () => {
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  let status = { isGuardianOn: false, isMonitoring: false, pendingEventCount: 0 };
  let concurrent = 0;
  let maxConcurrent = 0;
  const calls = [];
  const enabled = [];
  const control = startGuardianControl(
    {
      async getCurrentStatus() {
        calls.push('status');
        return { ...status };
      },
      async startGuardian() {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        calls.push('start');
        await startGate;
        status = { ...status, isGuardianOn: true, isMonitoring: true };
        concurrent--;
      },
      async stopGuardian() {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        calls.push('stop');
        status = { ...status, isGuardianOn: false, isMonitoring: false };
        concurrent--;
      },
    },
    () => {},
    (value) => enabled.push(value),
    (error) => {
      throw error;
    },
  );
  const config = createInitialStoredState().config;
  const starting = control.setEnabled(true, config);
  const stopping = control.setEnabled(false, config);
  await Promise.resolve();
  assert.deepEqual(calls, ['start']);
  releaseStart();
  await Promise.all([starting, stopping]);
  status = { ...status, isGuardianOn: true, isMonitoring: false };
  await control.refresh();
  control.stop();
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(enabled, [true, false, true]);
  assert.deepEqual(calls.slice(0, 4), ['start', 'status', 'stop', 'status']);
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
    'getCurrentLocation',
    'pickTime',
    'getPermissions',
    'requestPermissions',
    'requestMotionPermission',
    'startGuardian',
    'stopGuardian',
    'setGeofences',
    'setNoMotionThresholdMinutes',
    'setActiveWindow',
    'setNotificationContacts',
    'getCriticalMessagingPreparation',
    'sendSOS',
  ]) {
    assert.ok(swift.includes(`func ${method}(`));
    assert.ok(objc.includes(`RCT_EXTERN_METHOD(${method}:`));
  }
});

test('iOS registers and permits the local reliability refresh task before restore', () => {
  const plist = fs.readFileSync(
    path.join(__dirname, '../ios/DaojiaShuoYisheng/Info.plist'),
    'utf8',
  );
  const appDelegate = fs.readFileSync(
    path.join(__dirname, '../ios/DaojiaShuoYisheng/AppDelegate.swift'),
    'utf8',
  );
  assert.match(plist, /BGTaskSchedulerPermittedIdentifiers/);
  assert.match(plist, /com\.llingrui\.iamhome\.guardian\.refresh/);
  assert.match(plist, /<string>fetch<\/string>/);
  assert.match(plist, /<string>location<\/string>/);
  assert.ok(
    appDelegate.indexOf('GuardianBootstrap.registerBackgroundTasks()') <
      appDelegate.indexOf('GuardianBootstrap.restore('),
  );
  assert.match(appDelegate, /applicationProtectedDataDidBecomeAvailable/);
});

test('critical messaging preparation validates recipients and pending operations', () => {
  const value = parseCriticalMessagingPreparation({
    apiAvailable: true,
    buildConfigured: false,
    recipients: [{ id: 'family-1', name: '小林', phoneNumber: '+8613800000000', priority: 1 }],
    operations: [
      {
        id: 'risk-1:family-1',
        eventId: 'risk-1',
        contactId: 'family-1',
        contactName: '小林',
        phoneNumber: '+8613800000000',
        messageText: '测试待发送内容',
        createdAt: '2026-09-21T01:00:00.000Z',
        status: 'prepared',
        shortcutAttemptPending: false,
      },
    ],
  });
  assert.equal(value.operations[0].status, 'prepared');
  assert.equal(value.recipients[0].name, '小林');
  assert.throws(
    () => parseCriticalMessagingPreparation({ ...value, operations: [{}] }),
    /格式无效/,
  );
});
