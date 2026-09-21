const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const openedUrls = [];
let pickedTime = null;
const load = createLoader({
  '@react-native-async-storage/async-storage': {},
  'react-native': {
    Alert: { alert() {} },
    Linking: {
      async openSettings() {},
      async openURL(url) {
        openedUrls.push(url);
      },
    },
    NativeModules: {
      GuardianNative: {
        async pickTime() {
          return pickedTime;
        },
      },
    },
    Platform: { OS: 'ios' },
    Text: 'Text',
    TextInput: 'TextInput',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
    StyleSheet: { create: (value) => value },
  },
});
const { createGuardianStore } = load('src/state/guardianStore.ts');
const { createGuardianRepository } = load('src/storage/guardianRepository.ts');
const { createMemoryGuardianStorage } = load('src/storage/guardianStorage.ts');
const { createInitialStoredState } = load('src/storage/guardianSchema.ts');
const { useGuardian } = load('src/state/useGuardian.ts');
const { RulesScreen } = load('src/screens/RulesScreen.tsx');
const { PlacesScreen } = load('src/screens/PlacesScreen.tsx');
const { describeCurrentPlace } = load('src/screens/OverviewScreen.tsx');
const { MyScreen } = load('src/screens/MyScreen.tsx');
const { FamilyScreen } = load('src/screens/FamilyScreen.tsx');
const { getFootprintEvents } = load('src/screens/FootprintsScreen.tsx');
const {
  SHORTCUT_NOTIFICATION_INSTALL_URL,
  SHORTCUT_NOTIFICATION_NAME,
  buildShortcutNotificationUrl,
  composeShortcutTestMessage,
  openShortcutInstaller,
  sendShortcutNotification,
} = load('src/native/shortcutNotification.ts');
const now = Date.parse('2026-09-08T10:00:00Z');

test('shortcut installer and notification open the expected system URLs', async () => {
  openedUrls.length = 0;
  const message = composeShortcutTestMessage('小林');
  const input = { phone: '18768106491', message };
  const url = new URL(buildShortcutNotificationUrl(input));

  assert.equal(url.protocol, 'shortcuts:');
  assert.equal(url.hostname, 'run-shortcut');
  assert.equal(SHORTCUT_NOTIFICATION_NAME, '到家了么短信通知 V3');
  assert.equal(url.searchParams.get('name'), SHORTCUT_NOTIFICATION_NAME);
  assert.equal(url.searchParams.get('input'), 'text');
  assert.deepEqual(JSON.parse(url.searchParams.get('text')), input);
  assert.match(message, /测试通知/);
  assert.match(message, /目前没有异常/);
  assert.throws(
    () => buildShortcutNotificationUrl({ phone: ' ', message }),
    /收件人手机号不能为空/,
  );
  assert.throws(
    () => buildShortcutNotificationUrl({ phone: input.phone, message: ' ' }),
    /通知内容不能为空/,
  );
  assert.equal(
    SHORTCUT_NOTIFICATION_INSTALL_URL,
    'https://www.icloud.com/shortcuts/f8e16cab9ea34fffb16cb514108ada44',
  );

  await openShortcutInstaller();
  await sendShortcutNotification(input);
  assert.deepEqual(openedUrls, [SHORTCUT_NOTIFICATION_INSTALL_URL, url.toString()]);
});

test('shortcut template explicitly consumes URL input and sends without a compose sheet', () => {
  const template = readFileSync(
    join(process.cwd(), 'tools/shortcuts/DaojiaNotification.plist'),
    'utf8',
  );

  assert.match(template, /<string>ExtensionInput<\/string>/);
  assert.match(
    template,
    /<key>WFWorkflowHasShortcutInputVariables<\/key>\s*<true\/>/,
  );
  assert.match(template, /<key>ShowWhenRun<\/key>\s*<false\/>/);
});

test('footprints exclude raw samples and collapse repeated transition callbacks', () => {
  const events = [
    {
      id: 'home',
      type: 'RETURN_HOME',
      title: '进入家',
      geofenceId: 'home',
      timestamp: '2026-09-08T09:00:00Z',
    },
    { id: 'battery', type: 'LOW_BATTERY', timestamp: '2026-09-08T11:00:00Z' },
    { id: 'sample', type: 'LOCATION_UPDATED', timestamp: '2026-09-08T10:30:00Z' },
    {
      id: 'waypoint-old',
      type: 'ENTER_WAYPOINT',
      title: '进入菜地',
      geofenceId: 'garden',
      timestamp: '2026-09-08T10:00:00Z',
    },
    {
      id: 'waypoint-new',
      type: 'ENTER_WAYPOINT',
      title: '进入菜地',
      geofenceId: 'garden',
      timestamp: '2026-09-08T10:03:00Z',
    },
    {
      id: 'steps',
      type: 'MOTION_DETECTED',
      title: '检测到连续步数',
      description: '计步器累计新增 5 步。',
      source: 'pedometer',
      timestamp: '2026-09-08T10:10:00Z',
    },
  ];
  assert.deepEqual(
    getFootprintEvents(events).map((event) => event.id),
    ['steps', 'waypoint-new', 'home'],
  );
});

test('status location uses a named guardian place and radius instead of coordinates', () => {
  const geofences = [
    {
      id: 'garden',
      name: '菜园',
      kind: 'work',
      center: { latitude: 30, longitude: 120 },
      radiusMeters: 300,
    },
  ];
  assert.deepEqual(
    describeCurrentPlace(
      {
        events: [
          {
            id: 'location-1',
            type: 'LOCATION_UPDATED',
            title: '更新位置',
            description: '测试',
            timestamp: '2026-09-21T01:00:00.000Z',
            source: 'location',
            location: { latitude: 30.0001, longitude: 120.0001 },
          },
        ],
        locationLabel: '30.0001, 120.0001',
      },
      geofences,
    ),
    { label: '菜园', radius: '周围 300 米' },
  );
});

test('a fresh foreground location replaces stale home and away labels', () => {
  const home = {
    id: 'home',
    name: '家',
    kind: 'home',
    center: { latitude: 30, longitude: 120 },
    radiusMeters: 150,
  };
  const staleHomeSnapshot = {
    events: [
      {
        id: 'old-home',
        type: 'RETURN_HOME',
        title: '进入家',
        description: '测试',
        timestamp: '2026-09-21T01:00:00.000Z',
        source: 'geofence',
        geofenceId: 'home',
      },
    ],
    locationLabel: '家附近',
  };
  assert.deepEqual(
    describeCurrentPlace(staleHomeSnapshot, [home], {
      latitude: 30.01,
      longitude: 120.01,
      accuracy: 10,
      timestamp: '2026-09-21T02:00:00.000Z',
    }),
    { label: '守护地点外', radius: '未进入已设置地点' },
  );

  const staleAwaySnapshot = {
    events: [
      {
        id: 'old-away',
        type: 'LEAVE_HOME',
        title: '离开家',
        description: '测试',
        timestamp: '2026-09-21T03:00:00.000Z',
        source: 'geofence',
        geofenceId: 'home',
      },
    ],
    locationLabel: '家外',
  };
  assert.deepEqual(
    describeCurrentPlace(staleAwaySnapshot, [home], {
      latitude: 30,
      longitude: 120,
      accuracy: 10,
      timestamp: '2026-09-21T04:00:00.000Z',
    }),
    { label: '家中', radius: '周围 150 米' },
  );
});

test('cached coordinates on a newer risk event do not hide the farm GPS fix', () => {
  const farm = { id: 'farm', name: '农场', kind: 'work',
    center: { latitude: 30, longitude: 120 }, radiusMeters: 150 };
  const snapshot = { locationLabel: '家外', events: [
    { id: 'gps', type: 'LOCATION_UPDATED', source: 'location',
      timestamp: '2026-09-21T01:00:00Z', location: farm.center },
    { id: 'risk', type: 'NO_MOTION_FOR_LONG_TIME', source: 'motion',
      timestamp: '2026-09-21T01:02:00Z', location: { latitude: 31, longitude: 121 } },
  ] };
  assert.deepEqual(describeCurrentPlace(snapshot, [farm]),
    { label: '农场', radius: '周围 150 米' });
  assert.deepEqual(describeCurrentPlace(snapshot, [farm], {
    ...farm.center, accuracy: 5, timestamp: '2026-09-21T01:01:00Z',
  }), { label: '农场', radius: '周围 150 米' });
});

test('React StrictMode loads once and renders an SOS queued before hydration', async () => {
  let resolveLoad,
    loadCalls = 0,
    observed;
  const pending = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const seed = createInitialStoredState(now);
  const disk = createMemoryGuardianStorage(seed);
  const repository = createGuardianRepository({
    ...disk,
    load() {
      loadCalls++;
      return pending;
    },
    getStatus: () => ({ durability: 'durable' }),
  });
  const store = createGuardianStore(repository, () => now);
  function Probe() {
    observed = useGuardian(store);
    return React.createElement('state', { count: observed.data.localEvents.length });
  }
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(React.StrictMode, null, React.createElement(Probe)));
  });
  await act(async () => {
    store.addEvent({ type: 'SOS_SENT', title: 'SOS', description: 'Help', source: 'user' });
  });
  await act(async () => {
    resolveLoad(seed);
    await store.initialize();
    await store.flush();
  });
  assert.equal(loadCalls, 1);
  assert.equal(observed.loadStatus, 'ready');
  assert.equal(observed.data.localEvents.at(-1).type, 'SOS_SENT');
  assert.equal(renderer.toJSON().props.count, seed.localEvents.length + 1);
  await act(async () => {
    renderer.unmount();
  });
});

test('guardian times use the native picker and persist only a valid interval', async () => {
  const changes = [];
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(RulesScreen, {
        schedule: createInitialStoredState(now).config.schedule,
        onChangeSchedule: (value) => changes.push(value),
      }),
    );
  });
  const button = (label) =>
    renderer.root
      .findAllByType('TouchableOpacity')
      .find((node) => node.props.accessibilityLabel === label);
  pickedTime = '09:00';
  await act(async () => {
    button('开始守护时间').props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(changes[0].startTime, '09:00');

  pickedTime = '06:00';
  await act(async () => {
    button('结束守护时间').props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(changes.length, 1);
  assert.ok(
    renderer.root
      .findAllByType('Text')
      .some((node) => node.children.join('') === '结束时间应晚于开始时间。'),
  );
  await act(async () => {
    renderer.unmount();
  });
});

test('family form stays collapsed until the add-family action is chosen', async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(FamilyScreen, {
        contacts: [],
        onAddContact() {},
        onInstallShortcut() {},
        onRemoveContact() {},
        onSendTestNotification() {},
      }),
    );
  });
  assert.equal(renderer.root.findAllByType('TextInput').length, 0);
  const add = renderer.root
    .findAllByType('TouchableOpacity')
    .find((node) =>
      node.findAllByType('Text').some((text) => text.children.join('') === '增加家人信息'),
    );
  await act(async () => add.props.onPress());
  assert.equal(renderer.root.findAllByType('TextInput').length, 3);
  await act(async () => renderer.unmount());
});

test('My keeps one permission entry and omits duplicate status, reset, and about copy', async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(MyScreen, {
        contacts: [],
        geofenceSyncStatus: 'synced',
        events: [],
        now,
        permissions: {
          location: 'always',
          locationAccuracy: 'full',
          motion: 'authorized',
          notifications: 'notDetermined',
          backgroundRefresh: 'available',
        },
        schedule: createInitialStoredState(now).config.schedule,
        onAddContact() {},
        onChangeSchedule() {},
        async onRefreshPermissions() {},
        onRemoveContact() {},
        async onRequestMotionPermission() {},
        async onRequestPermissions() {},
        async onRetryGeofenceSync() {},
      }),
    );
  });
  const copy = renderer.root
    .findAllByType('Text')
    .map((node) => node.children.join(''))
    .join('\n');
  assert.match(copy, /权限/);
  assert.doesNotMatch(
    copy,
    /系统权限|正在后台守护|重新开始设置|在后台安静守护|暂停自动守护/,
  );
  await act(async () => renderer.unmount());
});

test('guardian rules no longer expose a notification escalation delay', async () => {
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(RulesScreen, {
        schedule: createInitialStoredState(now).config.schedule,
        onChangeSchedule() {},
      }),
    );
  });
  const copy = renderer.root
    .findAllByType('Text')
    .map((node) => node.children.join(''))
    .join('\n');
  assert.match(copy, /只在这个时段判断家外长时间无活动/);
  assert.doesNotMatch(copy, /预计回家/);
  assert.doesNotMatch(copy, /通知升级|分钟后通知家人/);
  await act(async () => renderer.unmount());
});

test('device place flow gets the current location before saving the chosen radius', async () => {
  const saved = [];
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(PlacesScreen, {
        geofences: [],
        geofenceSyncStatus: 'synced',
        isGuardianOn: false,
        isGuardianPaused: false,
        mode: 'device',
        onActivateDeviceMode() {},
        onAdjustRadius() {},
        async onGetCurrentLocation() {
          return {
            latitude: 30,
            longitude: 120,
            accuracy: 18,
            timestamp: '2026-09-20T10:00:00.000Z',
          };
        },
        onOpenSettings() {},
        onRemoveGeofence() {},
        async onRetryGeofenceSync() {},
        async onSaveCurrentLocation(place, sample) {
          saved.push({ place, sample });
        },
      }),
    );
  });
  const addButton = renderer.root
    .findAllByType('TouchableOpacity')
    .find((node) =>
      node
        .findAllByType('Text')
        .some((text) => text.children.join('') === '添加守护地点'),
    );
  assert.equal(addButton.props.disabled, false);
  await act(async () => {
    addButton.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.ok(
    renderer.root
      .findAllByType('Text')
      .some((text) => text.children.join('').includes('精度约 18 米')),
  );
  const visibleChoices = renderer.root
    .findAllByType('Text')
    .map((text) => text.children.join(''));
  assert.ok(visibleChoices.includes('家'));
  assert.ok(visibleChoices.includes('农场'));
  assert.ok(visibleChoices.includes('自定义'));
  assert.equal(visibleChoices.includes('菜地'), false);
  assert.equal(visibleChoices.includes('常去地点'), false);
  const saveButton = renderer.root
    .findAllByType('TouchableOpacity')
    .find((node) =>
      node.findAllByType('Text').some((text) => text.children.join('') === '保存并开始守护'),
    );
  await act(async () => {
    saveButton.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(saved, [
    {
      place: { name: '家', kind: 'home', radiusMeters: 150 },
      sample: {
        latitude: 30,
        longitude: 120,
        accuracy: 18,
        timestamp: '2026-09-20T10:00:00.000Z',
      },
    },
  ]);
  await act(async () => renderer.unmount());
});
