const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader();
const { guardedNativeRead, parseGuardianNativeStatus, parsePermissionState, NATIVE_READ_TIMEOUT_MS } =
  load('src/native/nativeReadGuard.ts');
const status = { isGuardianOn: false, isGuardianPaused: false, isMonitoring: false, isInActiveWindow: false, pendingEventCount: 0 };
const permissions = { location: 'always', locationAccuracy: 'full', motion: 'authorized',
  notifications: 'notDetermined', backgroundRefresh: 'available' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {
  resolve = a; reject = b;
}); return { promise, resolve, reject }; };

test('status parser accepts old optional fields without inventing a confirmed mode', () => {
  const result = parseGuardianNativeStatus({ ...status, futureField: 'discard' });
  assert.equal(result.monitoringMode, undefined);
  assert.equal(result.dataDeletionPending, undefined);
  assert.equal(result.riskHealth, undefined);
  assert.equal(result.futureField, undefined);
  assert.equal(parseGuardianNativeStatus({ ...status, dataDeletionPending: true }).dataDeletionPending, true);
  const current = parseGuardianNativeStatus({ ...status, monitoringMode: 'test', dataDeletionPending: false,
    riskHealth: { lowBatteryActive: false, lastCheckAt: 123, locationReason: 'futureReason' },
    reliability: { lastRestoreAt: 456, lastRestoreSucceeded: false }, lastError: '' });
  assert.equal(current.riskHealth.lastCheckAt, 123);
  assert.equal(current.reliability.lastRestoreSucceeded, false);
});

test('malformed status fails closed instead of coercing flags, counts or timestamps', () => {
  for (const bad of [null, [], {}, { ...status, isGuardianOn: 'false' }, { ...status, isMonitoring: 1 },
    { ...status, isGuardianPaused: undefined }, { ...status, isGuardianPaused: 'false' },
    { ...status, isInActiveWindow: null }, { ...status, pendingEventCount: -1 },
    { ...status, pendingEventCount: 0.5 }, { ...status, pendingEventCount: Infinity },
    { ...status, pendingEventCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...status, dataDeletionPending: 'false' }, { ...status, monitoringMode: 'future' },
    { ...status, lastError: {} }, { ...status, reliability: [] },
    { ...status, reliability: { lastRestoreSucceeded: 'false' } },
    { ...status, reliability: { lastWakeAt: NaN } },
    { ...status, reliability: { lastWakeAt: 9e15 } },
    { ...status, riskHealth: { lowBatteryActive: 0 } },
    { ...status, riskHealth: { lowBatteryActive: false, lastCheckAt: '123' } },
  ]) assert.throws(() => parseGuardianNativeStatus(bad), /格式无效/);
});

test('permission parser requires known values for every required permission', () => {
  assert.deepEqual(parsePermissionState(permissions), permissions);
  for (const key of Object.keys(permissions)) {
    for (const value of [undefined, null, true, {}, 'unknown-future-value'])
      assert.throws(() => parsePermissionState({ ...permissions, [key]: value }), /格式无效/);
  }
  assert.deepEqual(parsePermissionState({ ...permissions, location: 'denied', locationAccuracy: 'reduced' }),
    { ...permissions, location: 'denied', locationAccuracy: 'reduced' });
});

test('concurrent reads share one call and a timeout discards late success before safe retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(); let calls = 0, parsed = 0;
  const read = guardedNativeRead(() => ++calls === 1 ? first.promise : Promise.resolve(status),
    (value) => { parsed++; return parseGuardianNativeStatus(value); }, '读取守护状态');
  const a = read(), b = read();
  assert.equal(a, b);
  const rejected = assert.rejects(a, /读取守护状态超时/);
  await Promise.resolve();
  assert.equal(calls, 1);
  t.mock.timers.tick(NATIVE_READ_TIMEOUT_MS);
  await rejected;
  assert.equal((await read()).isGuardianOn, false);
  first.resolve({ ...status, isGuardianOn: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(parsed, 1, 'expired result must not even be parsed');
  assert.equal(calls, 2);
});

test('late rejection is consumed and synchronous/parser failures release the read slot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  const read = guardedNativeRead(() => pending.promise, parseGuardianNativeStatus, '读取');
  const result = read(); const rejected = assert.rejects(result, /超时/);
  await Promise.resolve(); t.mock.timers.tick(NATIVE_READ_TIMEOUT_MS); await rejected;
  pending.reject(Error('late')); await Promise.resolve();
  let calls = 0;
  const retry = guardedNativeRead(() => {
    if (++calls === 1) throw Error('sync');
    return Promise.resolve(calls === 2 ? null : status);
  }, parseGuardianNativeStatus, '读取');
  await assert.rejects(retry(), /sync/);
  await assert.rejects(retry(), /格式无效/);
  await retry(); assert.equal(calls, 3);
});

test('bridge deadlines leave writes, deletion and permission prompts untouched', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred();
  const write = () => gate.promise;
  const raw = { getCurrentStatus: async () => status, getPermissions: async () => permissions,
    startGuardian: write, stopGuardian: write, clearLocalData: write, beginDataDeletion: write,
    requestPermissions: write, getCriticalMessagingPreparation: write, getPendingEvents: write };
  const nativeLoad = createLoader({ 'react-native': { Platform: { OS: 'ios' }, NativeModules: { GuardianNative: raw } } });
  const { getGuardianNative } = nativeLoad('src/native/GuardianNative.ts');
  const native = getGuardianNative();
  assert.equal(native, getGuardianNative());
  for (const key of Object.keys(raw).filter((key) => !['getCurrentStatus', 'getPermissions'].includes(key)))
    assert.equal(native[key](), gate.promise, key + ' must preserve the original pending operation');
  let finished = false;
  const clearing = native.clearLocalData().then(() => { finished = true; });
  t.mock.timers.tick(60_000); await Promise.resolve();
  assert.equal(finished, false);
  gate.resolve(); await clearing;
});

test('control coalesces foreground refresh storms and can recover after read timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { startGuardianControl } = load('src/native/guardianControl.ts');
  let calls = 0; const phases = [];
  const control = startGuardianControl({ getCurrentStatus: guardedNativeRead(() => {
    calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve(status);
  }, parseGuardianNativeStatus, '读取'), async startGuardian() {}, async stopGuardian() {} },
    (state) => phases.push(state.phase), () => {}, () => {});
  const first = control.refresh();
  const reject = assert.rejects(first, /超时/);
  for (let i = 0; i < 100; i++) assert.equal(control.refresh(), first);
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(NATIVE_READ_TIMEOUT_MS); await reject;
  await control.refresh();
  assert.equal(calls, 2); assert.deepEqual(phases, ['checking', 'error', 'checking', 'off']);
  control.stop();
});

test('native facade supports non-enumerable methods and preserves their receiver', async () => {
  const raw = {};
  Object.defineProperty(raw, 'getCurrentStatus', { value: async function () {
    assert.equal(this, raw); return status;
  } });
  Object.defineProperty(raw, 'stopGuardian', { value: function () {
    assert.equal(this, raw); return Promise.resolve('stopped');
  } });
  const nativeLoad = createLoader({ 'react-native': { Platform: { OS: 'ios' }, NativeModules: { GuardianNative: raw } } });
  const native = nativeLoad('src/native/GuardianNative.ts').getGuardianNative();
  assert.equal((await native.getCurrentStatus()).isGuardianOn, false);
  assert.equal(await native.stopGuardian(), 'stopped');
  await assert.rejects(native.getPermissions(), /缺少所需接口/);
});

test('refresh requested after a write cannot reuse an earlier read', async () => {
  const { startGuardianControl } = load('src/native/guardianControl.ts');
  const gate = deferred(); let calls = 0, enabled = false;
  const states = [];
  const control = startGuardianControl({
    async getCurrentStatus() {
      if (++calls === 1) return gate.promise;
      return { ...status, isGuardianOn: enabled, isMonitoring: enabled };
    },
    async startGuardian() { enabled = true; }, async stopGuardian() { enabled = false; },
  }, (value) => states.push(value.phase), () => {}, () => {});
  const first = control.refresh();
  const start = control.setEnabled(true, {});
  const after = control.refresh(); assert.notEqual(first, after);
  gate.resolve(status);
  await Promise.all([first, start, after]);
  assert.equal(calls, 3);
  assert.equal(states.at(-1), 'monitoring');
  control.stop();
});
