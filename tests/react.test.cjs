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
const now = Date.parse('2026-09-08T10:00:00Z');

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

test('device place form captures a real sample before reporting native sync success', async () => {
  const captured = [];
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(PlacesScreen, {
        geofences: [],
        geofenceSyncStatus: 'synced',
        guardianStatus: '已暂停',
        mode: 'device',
        permissions: {
          location: 'whenInUse',
          locationAccuracy: 'full',
          motion: 'notDetermined',
          notifications: 'notDetermined',
        },
        onActivateDeviceMode() {},
        onAdjustRadius() {},
        async onCaptureCurrentLocation(place) {
          captured.push(place);
          return {
            latitude: 30,
            longitude: 120,
            accuracy: 18,
            timestamp: '2026-09-20T10:00:00.000Z',
          };
        },
        async onRefreshPermissions() {},
        onRemoveGeofence() {},
        async onRequestPermissions() {},
        async onRetryGeofenceSync() {},
      }),
    );
  });
  const button = renderer.root
    .findAllByType('TouchableOpacity')
    .find((node) =>
      node
        .findAllByType('Text')
        .some((text) => text.children.join('') === '获取当前位置并同步围栏'),
    );
  assert.equal(button.props.disabled, false);
  await act(async () => {
    button.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(captured, [{ name: '菜地', kind: 'work', radiusMeters: 320 }]);
  assert.ok(
    renderer.root
      .findAllByType('Text')
      .some((text) => text.children.join('').includes('精度约 18 米')),
  );
  await act(async () => renderer.unmount());
});
