import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getStatusTone } from './src/domain/guardianRules';
import { buildGuardianSnapshot } from './src/domain/riskEngine';
import type { GuardianEventDraft } from './src/domain/types';
import {
  parseCurrentLocationSample,
  type CurrentLocationSample,
} from './src/domain/validation';
import {
  getGuardianNative,
  subscribeToGuardianErrors,
  subscribeToGuardianEvents,
  type PermissionState,
} from './src/native/GuardianNative';
import {
  startGuardianControl,
  type GuardianControlState,
} from './src/native/guardianControl';
import { startGuardianEventSync } from './src/native/guardianEventSync';
import {
  startGuardianGeofenceSync,
  type GeofenceSyncStatus,
} from './src/native/guardianGeofenceSync';
import { MyScreen } from './src/screens/MyScreen';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { PlacesScreen, type NewCurrentLocationPlace } from './src/screens/PlacesScreen';
import { createGuardianStore } from './src/state/guardianStore';
import { useGuardian } from './src/state/useGuardian';
import { guardianRepository } from './src/storage/guardianRepository';
import { styles } from './src/styles/appStyles';
import { createId } from './src/utils/id';

const store = createGuardianStore(guardianRepository);
type TabKey = 'status' | 'places' | 'me';
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'status', label: '状态' },
  { key: 'places', label: '地点' },
  { key: 'me', label: '我的' },
];

function describeDeviceGuardian(
  control: GuardianControlState,
  permissions: PermissionState | undefined,
  geofenceSyncStatus: GeofenceSyncStatus,
  geofenceCount: number,
  isPaused: boolean,
) {
  if (isPaused) return '已由你暂停；恢复后会继续在后台守护。';
  if (geofenceCount === 0) return '添加至少一个守护地点后会自动开始。';
  if (!permissions || control.phase === 'unknown' || control.phase === 'checking')
    return '正在确认设备状态。';
  if (control.phase === 'starting') return '正在启动后台守护。';
  if (control.phase === 'stopping') return '正在暂停后台守护。';
  if (control.phase === 'error') return `守护遇到问题：${control.error ?? '请重试'}`;
  if (permissions.location !== 'always') return '需要把定位权限设为“始终允许”。';
  if (permissions.locationAccuracy !== 'full') return '需要在系统设置中开启精确位置。';
  if (geofenceSyncStatus === 'error') return '守护地点同步失败，请重试。';
  if (geofenceSyncStatus !== 'synced') return '正在准备守护地点。';
  if (control.nativeStatus?.isGuardianOn && control.nativeStatus.isMonitoring)
    return '后台守护中，无需保持 App 打开。';
  if (control.nativeStatus?.isGuardianOn) return '守护已开启，正在恢复后台运行。';
  return '准备完成，正在自动启动守护。';
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('status');
  const [now, setNow] = useState(Date.now());
  const [nativeError, setNativeError] = useState('');
  const [permissions, setPermissions] = useState<PermissionState>();
  const [geofenceSyncStatus, setGeofenceSyncStatus] = useState<GeofenceSyncStatus>('idle');
  const [guardianControlState, setGuardianControlState] = useState<GuardianControlState>({
    phase: 'unknown',
  });
  const [guardianTogglePending, setGuardianTogglePending] = useState(false);
  const nativeSync = useRef<ReturnType<typeof startGuardianEventSync> | undefined>(undefined);
  const geofenceSync = useRef<ReturnType<typeof startGuardianGeofenceSync> | undefined>(undefined);
  const guardianControl = useRef<ReturnType<typeof startGuardianControl> | undefined>(undefined);
  const guardianToggleLock = useRef(false);
  const state = useGuardian(store);
  const { config, isGuardianOn, isGuardianPaused, localEvents, mode } = state.data;
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
      const eventSync = startGuardianEventSync(
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
      nativeSync.current = eventSync;
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
          void eventSync.retry();
          void refreshPermissions();
          void control.refresh().catch(() => undefined);
        }
      });
      return () => {
        eventSync.stop();
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
    [config.schedule.noMotionThresholdMinutes, localEvents, now],
  );

  const deviceGuardianDescription = useMemo(
    () =>
      describeDeviceGuardian(
        guardianControlState,
        permissions,
        geofenceSyncStatus,
        config.geofences.length,
        isGuardianPaused,
      ),
    [
      config.geofences.length,
      geofenceSyncStatus,
      guardianControlState,
      isGuardianPaused,
      permissions,
    ],
  );

  const deviceGuardianConfirmed =
    !isGuardianPaused &&
    guardianControlState.phase === 'monitoring' &&
    permissions?.location === 'always' &&
    permissions.locationAccuracy === 'full' &&
    geofenceSyncStatus === 'synced' &&
    config.geofences.length > 0;

  const addEvent = (draft: GuardianEventDraft) => {
    store.addEvent({ ...draft, simulated: isHydrated ? mode === 'demo' : undefined });
    setNow(Date.now());
  };

  const requestLocationPermissions = async () => {
    try {
      setNativeError('');
      const native = getGuardianNative();
      const before = (await native.getPermissions()).location;
      await native.requestPermissions();
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        const next = await native.getPermissions();
        setPermissions(next);
        if (next.location !== before) return;
      }
      setNativeError('定位权限尚未改变；如果系统没有再次弹窗，请打开系统设置。');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };

  const getCurrentLocation = async () => {
    const current = store.getSnapshot();
    if (current.loadStatus !== 'ready' || current.data.mode !== 'device')
      throw new Error('真实设备模式尚未就绪。');
    return parseCurrentLocationSample(await getGuardianNative().getCurrentLocation());
  };

  const saveCurrentLocation = async (
    place: NewCurrentLocationPlace,
    sample: CurrentLocationSample,
  ) => {
    const current = store.getSnapshot();
    if (current.loadStatus !== 'ready' || current.data.mode !== 'device')
      throw new Error('真实设备模式尚未就绪。');
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
    if (!sync) throw new Error('守护地点同步尚未就绪。');
    sync.update(nextGeofences);
    try {
      await sync.flush();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`地点已保存，但同步失败：${message}`);
    }
  };

  const retryGeofenceSync = async () => {
    const sync = geofenceSync.current;
    if (!sync) {
      setNativeError('守护地点同步尚未就绪。');
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

  const setGuardianEnabled = async (enabled: boolean): Promise<boolean> => {
    if (!isHydrated || guardianToggleLock.current) return false;
    if (mode === 'demo') {
      store.setEnabled(enabled);
      return true;
    }
    const control = guardianControl.current;
    if (!control) {
      setNativeError('设备守护状态尚未就绪。');
      return false;
    }

    guardianToggleLock.current = true;
    setGuardianTogglePending(true);
    setNativeError('');
    try {
      const current = store.getSnapshot().data;
      if (enabled) {
        if (current.config.geofences.length === 0) {
          setActiveTab('places');
          throw new Error('请先添加至少一个守护地点。');
        }
        const nextPermissions = await getGuardianNative().getPermissions();
        setPermissions(nextPermissions);
        if (nextPermissions.location !== 'always') {
          setActiveTab('me');
          throw new Error('请在“我的”中把定位权限设为“始终允许”。');
        }
        if (nextPermissions.locationAccuracy !== 'full') {
          setActiveTab('me');
          throw new Error('请在系统设置中开启精确位置。');
        }
        await store.flush();
        const sync = geofenceSync.current;
        if (!sync) throw new Error('守护地点同步尚未就绪。');
        sync.update(current.config.geofences);
        await sync.flush();
      }
      await control.setEnabled(enabled, current.config);
      await store.flush();
      return true;
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      guardianToggleLock.current = false;
      setGuardianTogglePending(false);
    }
  };

  const pauseGuardian = async () => {
    if (mode === 'demo') {
      store.setPaused(true);
      store.setEnabled(false);
      await store.flush();
      return;
    }
    if (guardianToggleLock.current) return;
    const control = guardianControl.current;
    if (!control) {
      setNativeError('设备守护状态尚未就绪。');
      return;
    }
    guardianToggleLock.current = true;
    setGuardianTogglePending(true);
    try {
      await control.setEnabled(false, store.getSnapshot().data.config);
      store.setPaused(true);
      await store.flush();
      setNativeError('');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    } finally {
      guardianToggleLock.current = false;
      setGuardianTogglePending(false);
    }
  };

  const resumeGuardian = async () => {
    store.setPaused(false);
    await store.flush();
    await setGuardianEnabled(true);
  };

  useEffect(() => {
    if (
      !isHydrated ||
      mode !== 'device' ||
      isGuardianPaused ||
      isGuardianOn ||
      guardianTogglePending ||
      guardianControlState.phase !== 'off' ||
      permissions?.location !== 'always' ||
      permissions.locationAccuracy !== 'full' ||
      geofenceSyncStatus !== 'synced' ||
      config.geofences.length === 0
    )
      return;
    void setGuardianEnabled(true);
  }, [
    config.geofences.length,
    geofenceSyncStatus,
    guardianControlState.phase,
    guardianTogglePending,
    isGuardianOn,
    isGuardianPaused,
    isHydrated,
    mode,
    permissions,
  ]);

  useEffect(() => {
    if (
      isHydrated &&
      mode === 'device' &&
      isGuardianPaused &&
      guardianControlState.phase === 'monitoring' &&
      !guardianTogglePending
    )
      void pauseGuardian();
  }, [
    guardianControlState.phase,
    guardianTogglePending,
    isGuardianPaused,
    isHydrated,
    mode,
  ]);

  const resetLocalState = async () => {
    if (mode !== 'device') {
      store.reset();
      return;
    }
    const control = guardianControl.current;
    if (!control || guardianToggleLock.current) {
      setNativeError('设备守护状态尚未就绪，未清除数据。');
      return;
    }
    guardianToggleLock.current = true;
    setGuardianTogglePending(true);
    try {
      await control.setEnabled(false, store.getSnapshot().data.config);
      store.reset();
      await store.flush();
      setNativeError('');
      setActiveTab('places');
    } catch (error) {
      setNativeError(`停止守护失败，未清除数据：${
        error instanceof Error ? error.message : String(error)
      }`);
    } finally {
      guardianToggleLock.current = false;
      setGuardianTogglePending(false);
    }
  };

  const guardianBusy =
    guardianTogglePending ||
    ['unknown', 'checking', 'starting', 'stopping'].includes(guardianControlState.phase);
  const overviewGuardianReady =
    mode === 'demo' ? isGuardianOn && !isGuardianPaused : deviceGuardianConfirmed;
  const overviewToneStatus =
    !overviewGuardianReady || !isGuardianOn || isGuardianPaused
      ? 'unknown'
      : snapshot.status === 'unknown'
        ? 'safe'
        : snapshot.status;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F4ED" />
      <View style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {state.error && (
            <Text accessibilityRole="alert" style={styles.errorBanner}>
              {state.error}
            </Text>
          )}
          {!!nativeError && (
            <Text accessibilityRole="alert" style={styles.errorBanner}>
              {nativeError}
            </Text>
          )}

          {activeTab === 'status' && (
            <OverviewScreen
              guardianReady={overviewGuardianReady}
              guardianStatus={
                mode === 'demo' ? '当前是演示状态，不会发送真实通知。' : deviceGuardianDescription
              }
              isGuardianOn={isGuardianOn && !isGuardianPaused}
              mode={mode}
              snapshot={snapshot}
              tone={getStatusTone(overviewToneStatus)}
              onConfirmSafe={() =>
                addEvent({
                  type: 'USER_CONFIRMED_SAFE',
                  title: '本人确认平安',
                  description: '本人已明确确认平安。',
                  source: 'user',
                })
              }
            />
          )}

          {isHydrated && activeTab === 'places' && (
            <PlacesScreen
              geofences={config.geofences}
              geofenceSyncStatus={geofenceSyncStatus}
              isGuardianOn={isGuardianOn}
              isGuardianPaused={isGuardianPaused}
              mode={mode}
              onActivateDeviceMode={() => store.activateDeviceMode()}
              onAdjustRadius={(id, radiusMeters) => {
                store.updateConfig((current) => ({
                  ...current,
                  geofences: current.geofences.map((fence) =>
                    fence.id === id ? { ...fence, radiusMeters } : fence,
                  ),
                }));
              }}
              onGetCurrentLocation={getCurrentLocation}
              onOpenSettings={() => setActiveTab('me')}
              onRemoveGeofence={(id) => {
                if (isGuardianOn && config.geofences.length === 1) {
                  setNativeError('请先在“我的”暂停守护，再删除最后一个地点。');
                  setActiveTab('me');
                  return;
                }
                store.updateConfig((current) => ({
                  ...current,
                  geofences: current.geofences.filter((fence) => fence.id !== id),
                }));
              }}
              onRetryGeofenceSync={retryGeofenceSync}
              onSaveCurrentLocation={saveCurrentLocation}
            />
          )}

          {isHydrated && activeTab === 'me' && (
            <MyScreen
              contacts={config.contacts}
              geofenceCount={config.geofences.length}
              geofenceSyncStatus={geofenceSyncStatus}
              guardianBusy={guardianBusy}
              guardianStatus={deviceGuardianDescription}
              isGuardianOn={isGuardianOn}
              isGuardianPaused={isGuardianPaused}
              events={snapshot.events}
              now={now}
              permissions={permissions}
              schedule={config.schedule}
              onAddContact={(contact) => {
                store.updateConfig((current) => ({
                  ...current,
                  contacts: [
                    ...current.contacts,
                    { ...contact, priority: current.contacts.length + 1 },
                  ],
                }));
              }}
              onChangeSchedule={(schedule) => {
                store.updateConfig((current) => ({ ...current, schedule }));
              }}
              onPauseGuardian={pauseGuardian}
              onRefreshPermissions={async () => {
                setNativeError('');
                await refreshPermissions();
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
              onRequestPermissions={requestLocationPermissions}
              onResetLocalState={resetLocalState}
              onResumeGuardian={resumeGuardian}
              onRetryGeofenceSync={retryGeofenceSync}
            />
          )}
        </ScrollView>

        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.key }}
              activeOpacity={0.75}
              disabled={!isHydrated && tab.key !== 'status'}
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={styles.tabButton}
            >
              <View style={[styles.tabDot, activeTab === tab.key && styles.tabDotActive]} />
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default App;
