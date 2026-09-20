const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const load = createLoader({
  '@react-native-async-storage/async-storage': {},
  'react-native': {
    Alert: { alert() {} },
    Linking: { async openSettings() {} },
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
const { getFootprintEvents } = load('src/screens/FootprintsScreen.tsx');
const now = Date.parse('2026-09-08T10:00:00Z');

test('footprints include only location transitions and show the newest first', () => {
  const events = [
    { id: 'home', type: 'RETURN_HOME', timestamp: '2026-09-08T09:00:00Z' },
    { id: 'battery', type: 'LOW_BATTERY', timestamp: '2026-09-08T11:00:00Z' },
    { id: 'waypoint', type: 'ENTER_WAYPOINT', timestamp: '2026-09-08T10:00:00Z' },
  ];
  assert.deepEqual(
    getFootprintEvents(events).map((event) => event.id),
    ['waypoint', 'home'],
  );
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

test('rule time drafts accept editing but persist only valid completed times', async () => {
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
  const input = () => renderer.root.findAllByType('TextInput')[0];
  await act(async () => {
    input().props.onChangeText('0');
  });
  assert.equal(input().props.value, '0');
  assert.equal(changes.length, 0);
  await act(async () => {
    input().props.onEndEditing({ nativeEvent: { text: '99:99' } });
  });
  assert.equal(changes.length, 0);
  await act(async () => {
    input().props.onChangeText('09:00');
  });
  await act(async () => {
    input().props.onEndEditing({ nativeEvent: { text: '09:00' } });
  });
  assert.equal(changes[0].startTime, '09:00');
  await act(async () => {
    renderer.unmount();
  });
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
