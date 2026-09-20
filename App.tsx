import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getStatusTone } from './src/domain/guardianRules';
import { composeNotificationPreview } from './src/domain/notificationCopy';
import { buildGuardianSnapshot } from './src/domain/riskEngine';
import { getEscalationState } from './src/domain/escalation';
import type { GuardianEventDraft } from './src/domain/types';
import { parseCurrentLocationSample } from './src/domain/validation';
import { FamilyScreen } from './src/screens/FamilyScreen';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { PlacesScreen, type NewCurrentLocationPlace } from './src/screens/PlacesScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { TimelineScreen } from './src/screens/TimelineScreen';
import { guardianRepository } from './src/storage/guardianRepository';
import { createGuardianStore } from './src/state/guardianStore';
import { useGuardian } from './src/state/useGuardian';
import { styles } from './src/styles/appStyles';
import { clamp } from './src/utils/number';
import {
  getGuardianNative,
  subscribeToGuardianEvents,
  subscribeToGuardianErrors,
  type PermissionState,
} from './src/native/GuardianNative';
import { startGuardianEventSync } from './src/native/guardianEventSync';
import {
  startGuardianControl,
  type GuardianControlState,
} from './src/native/guardianControl';
import {
  startGuardianGeofenceSync,
  type GeofenceSyncStatus,
} from './src/native/guardianGeofenceSync';
import { createId } from './src/utils/id';

const store = createGuardianStore(guardianRepository);
type TabKey = 'overview' | 'places' | 'rules' | 'family' | 'timeline';
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'places', label: '地点' },
  { key: 'rules', label: '规则' },
  { key: 'family', label: '家人' },
  { key: 'timeline', label: '记录' },
];

function describeDeviceGuardian(
  control: GuardianControlState,
  permissions: PermissionState | undefined,
  geofenceSyncStatus: GeofenceSyncStatus,
  geofenceCount: number,
) {
  if (control.phase === 'unknown' || control.phase === 'checking') return '正在核对原生守护状态';
  if (control.phase === 'starting') return '正在启动后台守护';
  if (control.phase === 'stopping') return '正在停止后台守护';
  if (control.phase === 'error')
    return `${control.nativeStatus ? '原生操作失败' : '原生状态未知'}：${control.error ?? '请重试'}`;

  if (control.nativeStatus?.isGuardianOn) {
    if (permissions?.location !== 'always') return '权限不足：后台守护需要“始终允许”定位';
    if (permissions.locationAccuracy !== 'full') return '权限不足：后台守护需要精确位置';
    if (geofenceCount === 0 || geofenceSyncStatus !== 'synced')
      return '配置未同步：后台监控当前不可确认';
    if (control.nativeStatus.isMonitoring) return '后台监控中';
    return control.nativeStatus.lastError
      ? `原生错误：${control.nativeStatus.lastError}`
      : '守护已开启，但后台监控未运行';
  }

  if (geofenceCount === 0) return '已暂停 · 开启前请添加至少一个真实地点';
  if (permissions?.location !== 'always' || permissions.locationAccuracy !== 'full')
    return '已暂停 · 开启前需始终允许精确定位';
  if (geofenceSyncStatus === 'error') return '已暂停 · 围栏配置同步失败';
  return '已暂停';
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [now, setNow] = useState(Date.now());
  const [nativeError, setNativeError] = useState('');
  const [permissions, setPermissions] = useState<PermissionState>();
  const [geofenceSyncStatus, setGeofenceSyncStatus] = useState<GeofenceSyncStatus>('idle');
  const [guardianControlState, setGuardianControlState] = useState<GuardianControlState>({
    phase: 'unknown',
  });
  const [guardianTogglePending, setGuardianTogglePending] = useState(false);
  const nativeSync = useRef<ReturnType<typeof startGuardianEventSync> | undefined>(undefined);
  const geofenceSync = useRef<ReturnType<typeof startGuardianGeofenceSync> | undefined>(
    undefined,
  );
  const guardianControl = useRef<ReturnType<typeof startGuardianControl> | undefined>(undefined);
  const guardianToggleLock = useRef(false);
  const state = useGuardian(store);
  const { config, localEvents, isGuardianOn, mode } = state.data;
  const isHydrated = state.loadStatus === 'ready';

  const refreshPermissions = async () => {
    try {
      const next = await getGuardianNative().getPermissions();
      setPermissions(next);
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!isHydrated || mode !== 'device') return;
    try {
      const native = getGuardianNative();
      const sync = startGuardianEventSync(
        native,
        subscribeToGuardianEvents,
        store.importEvents,
        (error) => setNativeError(String(error)),
      );
      const fenceSync = startGuardianGeofenceSync(
        native,
        setGeofenceSyncStatus,
        (error) => setNativeError(error instanceof Error ? error.message : String(error)),
      );
      const control = startGuardianControl(
        native,
        setGuardianControlState,
        (enabled) => store.setEnabled(enabled),
        (error) => setNativeError(error instanceof Error ? error.message : String(error)),
      );
      nativeSync.current = sync;
      geofenceSync.current = fenceSync;
      guardianControl.current = control;
      fenceSync.update(store.getSnapshot().data.config.geofences);
      void refreshPermissions();
      void control.refresh().catch(() => undefined);
      const removeErrors = subscribeToGuardianErrors((event) => {
        setNativeError(event.message);
        void control.refresh().catch(() => undefined);
      });
      const appState = AppState.addEventListener('change', (value) => {
        if (value === 'active') {
          void sync.retry();
          void refreshPermissions();
          void control.refresh().catch(() => undefined);
        }
      });
      return () => {
        sync.stop();
        fenceSync.stop();
        control.stop();
        removeErrors();
        appState.remove();
        nativeSync.current = undefined;
        geofenceSync.current = undefined;
        guardianControl.current = undefined;
        setGeofenceSyncStatus('idle');
        setGuardianControlState({ phase: 'unknown' });
      };
    } catch (error) {
      setNativeError(String(error));
    }
  }, [isHydrated, mode]);
  useEffect(() => {
    if (isHydrated && mode === 'device') geofenceSync.current?.update(config.geofences);
  }, [config.geofences, isHydrated, mode]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const snapshot = useMemo(
    () =>
      buildGuardianSnapshot(localEvents, {
        now,
        maxSafeAgeMinutes: config.schedule.noMotionThresholdMinutes,
      }),
    [localEvents, now, config.schedule.noMotionThresholdMinutes],
  );
  const escalation = useMemo(
    () => getEscalationState(snapshot, config, { now, simulate: mode === 'demo' }),
    [snapshot, config, now, mode],
  );
  const preview = useMemo(() => composeNotificationPreview(snapshot, config), [snapshot, config]);
  const deviceGuardianDescription = useMemo(
    () =>
      describeDeviceGuardian(
        guardianControlState,
        permissions,
        geofenceSyncStatus,
        config.geofences.length,
      ),
    [guardianControlState, permissions, geofenceSyncStatus, config.geofences.length],
  );
  const deviceGuardianConfirmed =
    guardianControlState.phase === 'monitoring' &&
    permissions?.location === 'always' &&
    permissions.locationAccuracy === 'full' &&
    geofenceSyncStatus === 'synced' &&
    config.geofences.length > 0;
  const addEvent = (draft: GuardianEventDraft) => {
    store.addEvent({ ...draft, simulated: isHydrated ? mode === 'demo' : undefined });
    setNow(Date.now());
  };
  const advance = () => {
    // Recompute from the store so rapid taps cannot submit a stale next recipient.
    const current = store.getSnapshot().data;
    if (!current.isGuardianOn || current.mode !== 'demo') return;
    const next = getEscalationState(buildGuardianSnapshot(current.localEvents), current.config, {
      simulate: true,
    }).nextEvent;
    if (next) addEvent(next);
  };

  const requestLocationPermissions = async () => {
    try {
      setNativeError('');
      const native = getGuardianNative();
      const before = (await native.getPermissions()).location;
      await native.requestPermissions();
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
        const next = await native.getPermissions();
        setPermissions(next);
        if (next.location !== before) return;
      }
      setNativeError('定位权限尚未改变；如果系统没有再次弹窗，请点“打开系统设置”。');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };

  const captureCurrentLocation = async (place: NewCurrentLocationPlace) => {
    const native = getGuardianNative();
    const sample = parseCurrentLocationSample(await native.getCurrentLocation());
    const current = store.getSnapshot();
    if (current.loadStatus !== 'ready' || current.data.mode !== 'device') {
      throw new Error('请先进入真实设备模式。');
    }
    const nextGeofences = [
      ...current.data.config.geofences,
      {
        id: createId('place'),
        ...place,
        center: {
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracy: sample.accuracy,
        },
      },
    ];
    const updated = store.updateConfig((value) => ({ ...value, geofences: nextGeofences }));
    if (!updated) throw new Error(store.getSnapshot().error ?? '保存地点失败。');
    await store.flush();
    const sync = geofenceSync.current;
    if (!sync) throw new Error('原生围栏同步尚未就绪。');
    sync.update(nextGeofences);
    try {
      await sync.flush();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`真实位置已保存，但原生围栏同步失败：${message}`);
    }
    return sample;
  };

  const retryGeofenceSync = async () => {
    const sync = geofenceSync.current;
    if (!sync) {
      setNativeError('原生围栏同步尚未就绪。');
      return;
    }
    try {
      setNativeError('');
      sync.update(store.getSnapshot().data.config.geofences);
      await sync.flush();
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };

  const setGuardianEnabled = async (enabled: boolean) => {
    if (!isHydrated || guardianToggleLock.current) return;
    if (mode === 'demo') {
      store.setEnabled(enabled);
      return;
    }

    const control = guardianControl.current;
    if (!control) {
      setNativeError('原生守护状态尚未就绪。');
      return;
    }

    guardianToggleLock.current = true;
    setGuardianTogglePending(true);
    setNativeError('');
    try {
      const current = store.getSnapshot().data;
      if (enabled) {
        if (current.config.geofences.length === 0) {
          setActiveTab('places');
          throw new Error('请先在地点页添加并同步至少一个真实地点。');
        }
        const nextPermissions = await getGuardianNative().getPermissions();
        setPermissions(nextPermissions);
        if (nextPermissions.location !== 'always') {
          setActiveTab('places');
          throw new Error('请先把定位权限升级为“始终允许”。');
        }
        if (nextPermissions.locationAccuracy !== 'full') {
          setActiveTab('places');
          throw new Error('请先在系统设置中开启精确位置。');
        }
        await store.flush();
        const sync = geofenceSync.current;
        if (!sync) throw new Error('原生围栏同步尚未就绪。');
        sync.update(current.config.geofences);
        await sync.flush();
      }
      await control.setEnabled(enabled, current.config);
      await store.flush();
      setNativeError('');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    } finally {
      guardianToggleLock.current = false;
      setGuardianTogglePending(false);
    }
  };

  const resetLocalState = async () => {
    if (mode !== 'device') {
      store.reset();
      return;
    }
    const control = guardianControl.current;
    if (!control || guardianToggleLock.current) {
      setNativeError('原生守护状态尚未就绪，未重置设备数据。');
      return;
    }
    guardianToggleLock.current = true;
    setGuardianTogglePending(true);
    try {
      await control.setEnabled(false, store.getSnapshot().data.config);
      store.reset();
      await store.flush();
      setNativeError('');
    } catch (error) {
      setNativeError(`停止原生守护失败，未重置设备数据：${
        error instanceof Error ? error.message : String(error)
      }`);
    } finally {
      guardianToggleLock.current = false;
      setGuardianTogglePending(false);
    }
  };

  const guardianSwitchBusy =
    guardianTogglePending ||
    ['unknown', 'checking', 'starting', 'stopping'].includes(guardianControlState.phase);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F4ED" />
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.flexItem}>
            <Text style={styles.appName}>到家说一声</Text>
            <Text style={styles.subtleText}>
              {mode === 'demo' ? '演示模式 · 不发送真实通知' : '设备模式 · 通知服务尚未接入'}
            </Text>
            {mode === 'device' && (
              <Text
                style={[
                  styles.runtimeText,
                  deviceGuardianConfirmed && styles.runtimeTextMonitoring,
                ]}
              >
                {deviceGuardianDescription}
              </Text>
            )}
          </View>
          <Switch
            accessibilityLabel="守护开关"
            disabled={!isHydrated || (mode === 'device' && guardianSwitchBusy)}
            value={isGuardianOn}
            onValueChange={(enabled) => void setGuardianEnabled(enabled)}
          />
        </View>
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              disabled={!isHydrated && tab.key !== 'overview'}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {state.error && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {state.error}
            </Text>
          )}
          {!!nativeError && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {nativeError}
            </Text>
          )}
          {activeTab === 'overview' && (
            <OverviewScreen
              config={config}
              isGuardianOn={isGuardianOn}
              isHydrated={isHydrated}
              riskReason={snapshot.riskReason ?? ''}
              storageUpdatedAt={state.savedAt}
              storageStatus={state.loadStatus === 'ready' ? state.saveStatus : state.loadStatus}
              nextStep={
                isGuardianOn
                  ? mode === 'device' && !deviceGuardianConfirmed
                    ? deviceGuardianDescription
                    : escalation.description
                  : '守护已暂停，未解除的告警仍然保留。'
              }
              snapshot={snapshot}
              tone={getStatusTone(snapshot.status)}
              notificationPreview={preview}
              onRetryStorage={() => {
                void store.retry().then(() => nativeSync.current?.retry());
              }}
              onResetLocalState={() => {
                void resetLocalState();
              }}
              onConfirmSafe={() =>
                addEvent({
                  type: 'USER_CONFIRMED_SAFE',
                  title: '本人确认平安',
                  description: '本人已明确确认平安。',
                  source: 'user',
                })
              }
              onSOS={() =>
                addEvent({
                  type: 'SOS_SENT',
                  title: '主动求助',
                  description:
                    mode === 'demo'
                      ? '已记录求助演练，未向家人实际发送通知。'
                      : '已记录求助，请直接联系家人。',
                  source: 'user',
                })
              }
            />
          )}
          {isHydrated && activeTab === 'places' && (
            <PlacesScreen
              geofences={config.geofences}
              geofenceSyncStatus={geofenceSyncStatus}
              guardianStatus={deviceGuardianDescription}
              mode={mode}
              permissions={permissions}
              onActivateDeviceMode={() => store.activateDeviceMode()}
              onAdjustRadius={(id, delta) => {
                store.updateConfig((current) => ({
                  ...current,
                  geofences: current.geofences.map((fence) =>
                    fence.id === id
                      ? { ...fence, radiusMeters: clamp(fence.radiusMeters + delta, 100, 1000) }
                      : fence,
                  ),
                }));
              }}
              onRemoveGeofence={(id) => {
                if (isGuardianOn && config.geofences.length === 1) {
                  setNativeError('请先关闭守护，再删除最后一个地点。');
                  return;
                }
                store.updateConfig((current) => ({
                  ...current,
                  geofences: current.geofences.filter((fence) => fence.id !== id),
                }));
              }}
              onCaptureCurrentLocation={captureCurrentLocation}
              onRefreshPermissions={() => {
                setNativeError('');
                return refreshPermissions();
              }}
              onRequestPermissions={requestLocationPermissions}
              onRetryGeofenceSync={retryGeofenceSync}
            />
          )}
          {isHydrated && activeTab === 'rules' && (
            <RulesScreen
              schedule={config.schedule}
              onChangeSchedule={(schedule) => {
                store.updateConfig((current) => ({ ...current, schedule }));
              }}
            />
          )}
          {isHydrated && activeTab === 'family' && (
            <FamilyScreen
              contacts={config.contacts}
              onAddContact={(contact) => {
                store.updateConfig((current) => ({
                  ...current,
                  contacts: [
                    ...current.contacts,
                    { ...contact, priority: current.contacts.length + 1 },
                  ],
                }));
              }}
              onRemoveContact={(id) => {
                store.updateConfig((current) => ({
                  ...current,
                  contacts: current.contacts
                    .filter((contact) => contact.id !== id)
                    .sort((a, b) => a.priority - b.priority)
                    .map((contact, index) => ({ ...contact, priority: index + 1 })),
                }));
              }}
            />
          )}
          {isHydrated && activeTab === 'timeline' && (
            <TimelineScreen
              escalationState={escalation}
              events={snapshot.events}
              now={now}
              canSimulate={mode === 'demo' && isGuardianOn}
              onAdvanceEscalation={advance}
              onSimulateLocationLost={() =>
                addEvent({
                  type: 'LOCATION_LOST',
                  title: '位置中断演练',
                  description: '暂时没有新的定位信号。',
                  source: 'location',
                })
              }
              onSimulateReturnHome={() =>
                addEvent({
                  type: 'RETURN_HOME',
                  title: '回家演练',
                  description: '模拟进入家的地理围栏。',
                  locationLabel: '家附近',
                  source: 'geofence',
                })
              }
            />
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
export default App;
