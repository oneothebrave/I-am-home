const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const textOf = (node) => node.findAllByType('Text').map((n) => n.children.join('')).join('\n');
const button = (renderer, label) => {
  const found = renderer.root.findAllByType('TouchableOpacity').find((n) => textOf(n) === label);
  assert.ok(found, 'missing button: ' + label);
  return found;
};
const press = async (fixture, label) => {
  await act(async () => { button(fixture.renderer, label).props.onPress(); });
};
async function fixture(options = {}) {
  const now = Date.now();
  const baseLoad = createLoader();
  const { createInitialStoredState } = baseLoad('src/storage/guardianSchema.ts');
  const initial = { ...createInitialStoredState(now), mode: 'device', isGuardianOn: false, isGuardianPaused: true };
  if (options.configure) options.configure(initial);
  let stored = JSON.stringify(initial), enabled = false;
  let nativePaused = Boolean(options.nativePaused);
  let failClear = Boolean(options.failClear);
  let nativeDeletionPending = Boolean(options.nativeDeletionPending);
  let statusFailures = options.statusFailures ?? 0;
  const calls = [], alerts = [], lifecycle = new Set();
  const permissions = {
    location: options.denied ? 'denied' : 'always', locationAccuracy: 'full',
    motion: 'authorized', notifications: 'notDetermined', backgroundRefresh: options.backgroundRefresh ?? 'available',
  };
  const preparation = {
    apiAvailable: false, buildConfigured: false, automaticSendingEnabled: false,
    requiresBackgroundExecution: true, readiness: 'testMode', recipients: [], authorizations: [],
    policy: { validityMinutes: 30, maximumAttempts: 3, retryDelaysSeconds: [60, 300], cooldownMinutes: 10 },
    operations: [],
  };
  const native = {
    async checkLocalStorage(access) {
      if (options.protectionFailure?.()) throw Error('保护设置失败：/private/test-only');
      if (options.integrityFailure?.(access)) {
        const error = Error('sensitive-file-details'); error.code = 'STORAGE_INTEGRITY_ERROR'; throw error;
      }
      if (access.operation === 'deletion') assert.equal(nativeDeletionPending, true);
      return 'checked-v2';
    },
    addListener() {}, removeListeners() {},
    async getPermissions() { calls.push(['permissions']);
      return options.permissionsRead ? options.permissionsRead({ ...permissions }) : { ...permissions }; },
    async getCurrentStatus() {
      if (statusFailures-- > 0) throw Error('原生状态读取失败');
      const value = { isGuardianOn: enabled, isMonitoring: enabled,
        isGuardianPaused: nativePaused,
        isInActiveWindow: enabled, pendingEventCount: 0, dataDeletionPending: nativeDeletionPending };
      return options.statusRead ? options.statusRead(value) : value; },
    async getCurrentLocation() {
      calls.push(['location']);
      if (options.locationGate) return options.locationGate.promise;
      if (options.locationFailure) throw Error('定位超时');
      return { latitude: 30, longitude: 120, accuracy: 8, timestamp: new Date().toISOString() };
    },
    async getPendingEvents() { calls.push(['events']); return []; },
    async acknowledgeEvents(ids) { calls.push(['ack', ids]); },
    async setGeofences(value) { calls.push(['fences', value]); },
    async setMonitoringPolicy(value) { calls.push(['policy', value]); },
    async setNotificationContacts(value) { calls.push(['contacts', value]); },
    async getCriticalMessagingPreparation() { return preparation; },
    async startGuardian(config, resumePaused) {
      calls.push(['start', config, resumePaused]);
      if (nativePaused && !resumePaused) throw Error('必须明确恢复守护');
      enabled = true; nativePaused = false;
    },
    async stopGuardian() { calls.push(['stop']); enabled = false; nativePaused = true; },
    async beginDataDeletion() { calls.push(['begin-clear']); nativeDeletionPending = true; enabled = false; },
    async clearLocalData() {
      calls.push(['clear']);
      if (options.clearGate) await options.clearGate.promise;
      if (failClear) { failClear = false; throw Error('原生数据清除失败'); }
      enabled = false;
      nativePaused = true;
      nativeDeletionPending = false;
    },
  };
  const load = createLoader({
    '../assets/guardian-shield.png': 'shield.png',
    '@react-native-async-storage/async-storage': {
      async getItem() {
        if (options.corrupt) throw Error('本机数据损坏');
        return stored;
      },
      async setItem(key, value) {
        if (options.saveFailure?.()) throw Error('磁盘写入失败');
        stored = value;
      },
      async removeItem() { stored = undefined; },
    },
    'react-native': {
      Text: 'Text', View: 'View', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
      Image: 'Image', SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView', StatusBar: 'StatusBar',
      StyleSheet: { create: (value) => value }, Platform: { OS: 'ios' },
      NativeModules: { GuardianNative: native },
      NativeEventEmitter: class { addListener() { return { remove() {} }; } },
      Alert: { alert(...args) { alerts.push(args); } },
      AppState: { addEventListener(name, listener) {
        lifecycle.add(listener); return { remove() { lifecycle.delete(listener); } };
      } },
      Linking: { async openSettings() {} }, Share: { async share() {} },
    },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(load('App.tsx').default)); });
  return {
    renderer, calls, alerts, permissions, native,
    saved: () => JSON.parse(stored),
    async foreground() { await act(async () => { for (const listener of lifecycle) listener('active'); }); },
    async close() { await act(async () => { renderer.unmount(); }); },
  };
}

test('native pause survives a failed JS write and cold start requires explicit resume', async () => {
  let failSave = false;
  const f = await fixture({ saveFailure: () => failSave,
    configure(initial) { initial.isGuardianPaused = false; } });
  let oldDisk;
  try {
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
    failSave = true;
    await press(f, '我的');
    await press(f, '暂停自动守护');
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    assert.equal((await f.native.getCurrentStatus()).isGuardianPaused, true);
    assert.equal((await f.native.getCurrentStatus()).isGuardianOn, false);
    oldDisk = f.saved();
    assert.equal(oldDisk.isGuardianPaused, false);
    await f.foreground();
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
  } finally { await f.close(); }
  const restarted = await fixture({ nativePaused: true,
    configure(initial) { Object.assign(initial, oldDisk); } });
  try {
    assert.equal(restarted.calls.some(([name]) => name === 'start'), false);
    assert.equal(restarted.saved().isGuardianPaused, true);
    await press(restarted, '我的');
    await press(restarted, '恢复自动守护');
    assert.equal(restarted.calls.filter(([name]) => name === 'start').length, 1);
    assert.equal(restarted.calls.find(([name]) => name === 'start')[2], true);
    assert.equal(restarted.saved().isGuardianPaused, false);
    assert.equal(restarted.calls.some(([name]) => name === 'stop'), false);
  } finally { await restarted.close(); }
});

test('a failed explicit resume preserves the paused intent', async () => {
  const f = await fixture({ nativePaused: true, denied: true });
  try {
    await press(f, '我的'); await press(f, '恢复自动守护');
    assert.equal(f.saved().isGuardianPaused, true);
    f.permissions.location = 'always'; await f.foreground();
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
  } finally { await f.close(); }
});

test('missing native pause protocol fails closed before configuration or automatic start', async () => {
  const f = await fixture({ statusRead(value) { delete value.isGuardianPaused; return value; },
    configure(initial) { initial.isGuardianPaused = false; } });
  try {
    assert.deepEqual(f.calls, []);
    assert.match(textOf(f.renderer.root), /格式无效/);
  } finally { await f.close(); }
});

for (const backgroundRefresh of ['denied', 'restricted']) {
  test(`background refresh ${backgroundRefresh} blocks startup and confirmed readiness`, async () => {
    const f = await fixture({ backgroundRefresh, configure(initial) { initial.isGuardianPaused = false; } });
    const overview = () => f.renderer.root.findByType(
      f.renderer.root.find((node) => node.type?.name === 'OverviewScreen').type);
    try {
      assert.equal(f.calls.some(([name]) => name === 'start'), false);
      assert.equal(overview().props.guardianReady, false);
      f.permissions.backgroundRefresh = 'available'; await f.foreground();
      assert.equal(overview().props.guardianReady, true);
      f.permissions.backgroundRefresh = backgroundRefresh; await f.foreground();
      assert.equal(overview().props.guardianReady, false);
      assert.match(textOf(f.renderer.root), /后台.*刷新/);
      assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
    } finally { await f.close(); }
  });
}

for (const failure of ['sync', 'disk']) {
  test(`retrying a place after ${failure} failure updates the same draft even at the limit`, async () => {
    let failSave = false;
    const f = await fixture({ saveFailure: () => failSave, configure(initial) {
      initial.config.geofences = Array.from({ length: 19 }, (_, index) => ({
        ...initial.config.geofences[0], id: `existing-${index}` }));
    } });
    try {
      await press(f, '地点'); await press(f, '添加守护地点');
      const writeFences = f.native.setGeofences;
      if (failure === 'sync') f.native.setGeofences = async () => { throw Error('围栏写入失败'); };
      else failSave = true;
      await press(f, '保存并开始守护');
      const places = () => f.renderer.root.find((node) => node.type?.name === 'PlacesScreen').props.geofences;
      assert.equal(places().length, 20);
      const id = places().at(-1).id;
      assert.match(textOf(f.renderer.root), failure === 'sync' ? /同步失败/ : /尚未可靠保存/);
      f.native.setGeofences = writeFences; failSave = false;
      await press(f, '保存并开始守护');
      assert.equal(f.saved().config.geofences.length, 20);
      assert.equal(f.saved().config.geofences.at(-1).id, id);
      assert.match(textOf(f.renderer.root), /已添加/);
      assert.equal(f.calls.filter(([name]) => name === 'fences').at(-1)[1].length, 20);
    } finally { await f.close(); }
  });
}

test('whole-app deletion requires confirmation, clears both stores and stays paused', async () => {
  const f = await fixture();
  try {
    await press(f, '我的');
    await press(f, '数据与隐私\n保存与清除\n›');
    await press(f, '清除所有本机数据');
    assert.equal(f.calls.some(([name]) => name === 'clear'), false);
    assert.equal(f.saved().config.contacts.length, 2);
    const confirmation = f.alerts.at(-1);
    assert.equal(confirmation[0], '清除所有本机数据？');
    assert.match(confirmation[1], /不能撤销/);
    await act(async () => { confirmation[2].find((value) => value.style === 'destructive').onPress(); });
    assert.equal(f.calls.filter(([name]) => name === 'clear').length, 1);
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 0);
    assert.deepEqual(f.saved().config.contacts, []);
    assert.deepEqual(f.saved().config.geofences, []);
    assert.deepEqual(f.saved().localEvents, []);
    assert.equal(f.saved().isGuardianPaused, true);
    assert.ok(f.alerts.some(([title]) => title === '本机数据已清除'));
    const after = f.calls.slice(f.calls.findIndex(([name]) => name === 'clear') + 1);
    assert.ok(after.filter(([name]) => name === 'contacts' || name === 'fences').every(([, value]) => value.length === 0));
    await f.foreground();
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
  } finally { await f.close(); }
});

test('interrupted deletion prevents every native startup/sync until explicit retry succeeds', async () => {
  const f = await fixture({ configure(initial) {
    initial.dataDeletionPending = true;
    initial.config.contacts = [];
    initial.config.geofences = [];
    initial.localEvents = [];
  } });
  try {
    assert.deepEqual(f.calls, []);
    assert.match(textOf(f.renderer.root), /上次清除尚未完成/);
    assert.ok(f.renderer.root.findAllByType('TouchableOpacity')
      .filter((n) => n.props.accessibilityRole === 'tab').every((n) => n.props.disabled));
    await press(f, '继续清除本机数据');
    assert.equal(f.calls[0][0], 'begin-clear');
    assert.equal(f.saved().dataDeletionPending, undefined);
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
  } finally { await f.close(); }
});

test('native-only deletion intent takes precedence over old JS contacts and startup configuration', async () => {
  const f = await fixture({ nativeDeletionPending: true, configure(initial) { initial.isGuardianPaused = false; } });
  try {
    assert.deepEqual(f.calls, []);
    assert.match(textOf(f.renderer.root), /上次清除尚未完成/);
    assert.deepEqual(f.saved().config.contacts, []);
    assert.equal(f.saved().dataDeletionPending, true);
    await press(f, '继续清除本机数据');
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
    assert.equal(f.saved().dataDeletionPending, undefined);
  } finally { await f.close(); }
});

test('native erase failure remains visibly incomplete and offers a safe retry', async () => {
  const f = await fixture({ failClear: true });
  try {
    await press(f, '我的');
    await press(f, '数据与隐私\n保存与清除\n›');
    await press(f, '清除所有本机数据');
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    assert.equal(f.saved().dataDeletionPending, true);
    assert.match(textOf(f.renderer.root), /原生数据清除失败/);
    assert.equal(f.alerts.some(([title]) => title === '本机数据已清除'), false);
    await press(f, '继续清除本机数据');
    assert.equal(f.calls.filter(([name]) => name === 'clear').length, 2);
    assert.equal(f.saved().dataDeletionPending, undefined);
  } finally { await f.close(); }
});

test('a delayed pre-delete location cannot repopulate the cleared status screen', async () => {
  const locationGate = deferred();
  const f = await fixture({ locationGate });
  try {
    await press(f, '我的');
    await press(f, '数据与隐私\n保存与清除\n›');
    await press(f, '清除所有本机数据');
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    await act(async () => { locationGate.resolve({
      latitude: 30, longitude: 120, accuracy: 8, timestamp: new Date().toISOString(),
    }); });
    await press(f, '状态');
    assert.match(textOf(f.renderer.root), /守护已暂停/);
    assert.doesNotMatch(textOf(f.renderer.root), /家的范围内/);
    assert.deepEqual(f.saved().config.geofences, []);
  } finally { await f.close(); }
});

test('denied permission blocks automatic start; permission restoration retries real readiness', async () => {
  const f = await fixture({ denied: true, configure(initial) { initial.isGuardianPaused = false; } });
  try {
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
    f.permissions.location = 'always';
    await f.foreground();
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
    const start = f.calls.findIndex(([name]) => name === 'start');
    assert.ok(f.calls.slice(0, start).some(([name]) => name === 'policy'));
    assert.ok(f.calls.slice(0, start).some(([name]) => name === 'fences'));
  } finally { await f.close(); }
});

test('location timeout is displayed without inventing a confirmed place', async () => {
  const f = await fixture({ locationFailure: true, configure(initial) { initial.localEvents = []; } });
  try {
    assert.match(textOf(f.renderer.root), /位置暂未确认/);
    assert.doesNotMatch(textOf(f.renderer.root), /家的范围内/);
  } finally { await f.close(); }
});

test('corrupted local storage has retry and confirmed-clear actions without syncing defaults', async () => {
  const f = await fixture({ corrupt: true });
  try {
    assert.deepEqual(f.calls, []);
    assert.ok(button(f.renderer, '重试读取本机数据'));
    await press(f, '清除所有本机数据');
    assert.equal(f.calls.length, 0);
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    assert.deepEqual(f.saved().config.contacts, []);
    assert.equal(f.saved().isGuardianPaused, true);
  } finally { await f.close(); }
});

test('storage-protection failure blocks cold-start sync; retry recovers the original contacts', async () => {
  let fail = true;
  const f = await fixture({ protectionFailure: () => fail });
  try {
    assert.match(textOf(f.renderer.root), /保护检查未完成/);
    assert.doesNotMatch(textOf(f.renderer.root), /private\/test-only/);
    assert.equal(f.calls.some(([name]) => ['start', 'fences', 'contacts', 'policy'].includes(name)), false);
    assert.equal(f.saved().config.contacts.length, 2);
    fail = false;
    await press(f, '重试读取本机数据');
    assert.equal(f.saved().config.contacts.length, 2);
    assert.equal(f.calls.some(([name]) => name === 'clear' || name === 'begin-clear'), false);
  } finally { await f.close(); }
});

test('bottom-layer corruption stops startup writes and can retry without clearing personal data', async () => {
  let damaged = true;
  const f = await fixture({ integrityFailure: () => damaged });
  try {
    assert.match(textOf(f.renderer.root), /未确认读取或保存成功/);
    assert.doesNotMatch(textOf(f.renderer.root), /sensitive-file-details/);
    assert.equal(f.calls.some(([name]) => ['start', 'fences', 'contacts', 'policy'].includes(name)), false);
    assert.equal(f.saved().config.contacts.length, 2);
    damaged = false;
    await press(f, '重试读取本机数据');
    assert.equal(f.saved().config.contacts.length, 2);
    assert.equal(f.calls.some(([name]) => ['clear', 'begin-clear'].includes(name)), false);
  } finally { await f.close(); }
});

test('an unreadable manifest does not become a successful clear, even after confirmation', async () => {
  const f = await fixture({ integrityFailure: () => true });
  try {
    await press(f, '清除所有本机数据');
    assert.equal(f.calls.some(([name]) => name === 'begin-clear'), false);
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    assert.equal(f.calls.some(([name]) => name === 'begin-clear'), true);
    assert.equal(f.calls.some(([name]) => name === 'clear'), false);
    assert.equal(f.saved().config.contacts.length, 2);
    assert.equal(f.alerts.some(([title]) => title === '本机数据已清除'), false);
    assert.match(textOf(f.renderer.root), /继续清除本机数据/);
  } finally { await f.close(); }
});

test('protection failure during confirmed deletion remains pending until an explicit successful retry', async () => {
  let fail = false;
  const f = await fixture({ protectionFailure: () => fail });
  try {
    await press(f, '我的');
    await press(f, '数据与隐私\n保存与清除\n›');
    fail = true;
    await press(f, '清除所有本机数据');
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    assert.equal(f.saved().config.contacts.length, 2);
    assert.equal(f.calls.some(([name]) => name === 'begin-clear'), true);
    assert.equal(f.calls.some(([name]) => name === 'clear'), false);
    assert.equal(f.alerts.some(([title]) => title === '本机数据已清除'), false);
    assert.match(textOf(f.renderer.root), /继续清除本机数据/);
    fail = false;
    await press(f, '继续清除本机数据');
    assert.deepEqual(f.saved().config.contacts, []);
    assert.equal(f.saved().isGuardianPaused, true);
    assert.equal(f.saved().config.schedule.monitoringMode, 'test');
    assert.ok(f.alerts.some(([title]) => title === '本机数据已清除'));
  } finally { await f.close(); }
});

test('native preflight failure blocks all config writes and can be retried without erasing data', async () => {
  const f = await fixture({ statusFailures: 1 });
  try {
    assert.deepEqual(f.calls, []);
    assert.match(textOf(f.renderer.root), /原生状态读取失败/);
    await press(f, '重试确认本机数据状态');
    assert.ok(f.calls.some(([name]) => name === 'fences'));
    assert.equal(f.saved().config.contacts.length, 2);
    assert.equal(f.calls.some(([name]) => name === 'begin-clear'), false);
  } finally { await f.close(); }
});

test('hung preflight times out, retries safely and ignores a late deletion flag', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred(); let calls = 0;
  const f = await fixture({ statusRead(value) { return ++calls === 1 ? gate.promise : value; } });
  try {
    assert.deepEqual(f.calls, []);
    await act(async () => { t.mock.timers.tick(8000); });
    assert.match(textOf(f.renderer.root), /读取守护状态超时/);
    assert.match(textOf(f.renderer.root), /暂未同步守护/);
    assert.equal(f.saved().config.contacts.length, 2);
    await press(f, '重试确认本机数据状态');
    assert.ok(f.calls.some(([name]) => name === 'fences'));
    await act(async () => { gate.resolve({
      isGuardianOn: false, isMonitoring: false, isInActiveWindow: false,
      pendingEventCount: 0, dataDeletionPending: true,
    }); });
    assert.equal(f.saved().dataDeletionPending, undefined);
    assert.equal(f.saved().config.contacts.length, 2);
    assert.equal(f.calls.some(([name]) => name === 'clear' || name === 'begin-clear'), false);
  } finally { await f.close(); }
});

test('malformed preflight blocks all startup writes until a valid retry', async () => {
  let calls = 0;
  const f = await fixture({ statusRead(value) { return ++calls === 1 ? { ...value, dataDeletionPending: 'false' } : value; } });
  try {
    assert.deepEqual(f.calls, []);
    assert.match(textOf(f.renderer.root), /原生状态格式无效/);
    await press(f, '重试确认本机数据状态');
    assert.ok(f.calls.some(([name]) => name === 'fences'));
    assert.equal(f.saved().config.contacts.length, 2);
  } finally { await f.close(); }
});

test('permission timeout never auto-starts; foreground retry recovers and discards late denied result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred(); let calls = 0;
  const f = await fixture({
    configure(initial) { initial.isGuardianPaused = false; },
    permissionsRead(value) { return ++calls === 1 ? gate.promise : value; },
  });
  try {
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
    await act(async () => { t.mock.timers.tick(8000); });
    assert.match(textOf(f.renderer.root), /读取系统权限超时/);
    assert.equal(f.calls.some(([name]) => name === 'start'), false);
    await f.foreground();
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
    await act(async () => { gate.resolve({ ...f.permissions, location: 'denied' }); });
    assert.equal(f.saved().isGuardianOn, true);
    assert.doesNotMatch(textOf(f.renderer.root), /需要把定位权限设为/);
  } finally { await f.close(); }
});

test('a failed permission refresh invalidates old permissions and never reports diagnostic success', async () => {
  const f = await fixture({ configure(initial) { initial.isGuardianPaused = false; } });
  try {
    assert.equal(f.saved().isGuardianOn, true);
    f.native.getPermissions = async () => ({ ...f.permissions, location: 'newUnknownValue' });
    await press(f, '我的');
    const row = f.renderer.root.findAllByType('TouchableOpacity')
      .find((node) => textOf(node).startsWith('守护诊断\n'));
    assert.ok(row);
    await act(async () => row.props.onPress());
    await press(f, '刷新诊断信息');
    assert.match(textOf(f.renderer.root), /刷新未完成/);
    assert.doesNotMatch(textOf(f.renderer.root), /诊断信息已刷新|守护链路已就绪/);
    f.native.getPermissions = async () => ({ ...f.permissions });
    await press(f, '刷新诊断信息');
    assert.match(textOf(f.renderer.root), /诊断信息已刷新/);
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
  } finally { await f.close(); }
});

test('a still-pending native deletion keeps the UI locked without automatic replay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = deferred();
  const f = await fixture({ clearGate: gate });
  try {
    await press(f, '我的');
    await press(f, '数据与隐私\n保存与清除\n›');
    await press(f, '清除所有本机数据');
    await act(async () => { f.alerts.at(-1)[2].find((value) => value.style === 'destructive').onPress(); });
    await act(async () => { t.mock.timers.tick(60000); });
    assert.equal(f.calls.filter(([name]) => name === 'clear').length, 1);
    assert.equal(f.saved().dataDeletionPending, true);
    assert.equal(f.alerts.some(([title]) => title === '本机数据已清除'), false);
    assert.ok(f.renderer.root.findAllByType('TouchableOpacity')
      .filter((node) => node.props.accessibilityRole === 'tab').every((node) => node.props.disabled));
    await act(async () => { gate.resolve(); });
    assert.equal(f.saved().dataDeletionPending, undefined);
    assert.equal(f.saved().isGuardianPaused, true);
  } finally { await f.close(); }
});

test('foreground clock rollback immediately warns without stopping or restarting native monitoring', async (t) => {
  const initialClock = Date.now(); let currentClock = initialClock;
  t.mock.method(Date, 'now', () => currentClock);
  const f = await fixture({ locationFailure: true, configure(initial) {
    initial.isGuardianPaused = false;
    initial.localEvents = [{ id: 'safe-before-rollback', type: 'MOTION_DETECTED', source: 'motion',
      title: '活动', description: '可信活动', timestamp: new Date(initialClock - 1000).toISOString() }];
  } });
  try {
    assert.match(textOf(f.renderer.root), /状态正常/);
    currentClock -= 3600000;
    await f.foreground();
    assert.match(textOf(f.renderer.root), /设备时间需要确认/);
    assert.doesNotMatch(textOf(f.renderer.root), /状态正常/);
    assert.equal(f.saved().isGuardianPaused, false);
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
    assert.equal(f.calls.some(([name]) => name === 'stop' || name === 'clear'), false);
    currentClock = initialClock;
    await f.foreground();
    assert.match(textOf(f.renderer.root), /状态正常/);
    assert.equal(f.saved().localEvents.length, 1);
  } finally { await f.close(); }
});
