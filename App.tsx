import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getStatusTone } from './src/domain/guardianRules';
import { isWithinGuardianWindow } from './src/domain/guardianSchedule';
import { standardModeBlocker } from './src/domain/monitoringPolicy';
import type { GuardianSchedule } from './src/domain/types';
import { parseGuardianConfig } from './src/domain/validation';
import { startGuardianPolicySync } from './src/native/guardianPolicySync';
import { buildGuardianSnapshot } from './src/domain/riskEngine';
import {
  parseCurrentLocationSample,
  type CurrentLocationSample,
} from './src/domain/validation';
import {
  getGuardianNative,
  subscribeToGuardianErrors,
  subscribeToGuardianEvents,
  subscribeToGuardianMessagingUpdates,
  type PermissionState,
} from './src/native/GuardianNative';
import {
  startGuardianControl,
  type GuardianControlState,
} from './src/native/guardianControl';
import { startGuardianEventSync } from './src/native/guardianEventSync';
import {
  parseCriticalMessagingPreparation,
  type CriticalMessagingPreparation,
} from './src/native/criticalMessaging';
import {
  startGuardianGeofenceSync,
  type GeofenceSyncStatus,
} from './src/native/guardianGeofenceSync';
import { MyScreen } from './src/screens/MyScreen';
import { DataManagementScreen } from './src/screens/DataManagementScreen';
import { describeCurrentPlace, OverviewScreen } from './src/screens/OverviewScreen';
import { PlacesScreen, type NewCurrentLocationPlace } from './src/screens/PlacesScreen';
import { createGuardianStore } from './src/state/guardianStore';
import { useGuardian } from './src/state/useGuardian';
import { guardianRepository } from './src/storage/guardianRepository';
import { styles } from './src/styles/appStyles';

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
  hasHomeGeofence: boolean,
  isInActiveWindow: boolean,
  activeWindowLabel: string,
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
  if (permissions.backgroundRefresh !== 'available')
    return '需要开启“后台 App 刷新”，否则 iOS 无法在 App 未运行时恢复守护。';
  if (geofenceSyncStatus === 'error') return '守护地点同步失败，请重试。';
  if (geofenceSyncStatus !== 'synced') return '正在准备守护地点。';
  if (control.nativeStatus?.isGuardianOn && control.nativeStatus.isMonitoring) {
    if (!hasHomeGeofence)
      return '设置一个“家”地点后，才会启用家外长时间停留判断。';
    if (!isInActiveWindow)
      return `地点守护仍在运行；当前不在 ${activeWindowLabel} 守护时段，家外无活动判断已暂停。`;
    if (permissions.motion !== 'authorized')
      return '允许“运动与健身”后，家外停留判断会更可靠。';
    return '';
  }
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
  const [isMySubviewOpen, setIsMySubviewOpen] = useState(false);
  const [criticalMessaging, setCriticalMessaging] = useState<CriticalMessagingPreparation>();
  const [currentLocation, setCurrentLocation] = useState<CurrentLocationSample>();
  const [currentLocationState, setCurrentLocationState] = useState<
    'idle' | 'refreshing' | 'ready' | 'error'
  >('idle');
  const nativeSync = useRef<ReturnType<typeof startGuardianEventSync> | undefined>(undefined);
  const geofenceSync = useRef<ReturnType<typeof startGuardianGeofenceSync> | undefined>(undefined);
  const guardianControl = useRef<ReturnType<typeof startGuardianControl> | undefined>(undefined);
  const guardianToggleLock = useRef(false);
  const policySync = useRef<ReturnType<typeof startGuardianPolicySync> | undefined>(undefined);
  const [policyReady, setPolicyReady] = useState(false);
  const [clearingLocalData, setClearingLocalData] = useState(false);
  const [nativeDataChecked, setNativeDataChecked] = useState(false);
  const nativeDataCheckLock = useRef(false);
  const dataDeletionLock = useRef(false);
  const dataClearRequest = useRef(false);
  const dataEpoch = useRef(0);
  const policyChangeLock = useRef(false);
  const motionPermissionRequested = useRef(false);
  const currentLocationRequest = useRef<Promise<CurrentLocationSample> | undefined>(undefined);
  const state = useGuardian(store);
  const { config, isGuardianOn, isGuardianPaused, localEvents, mode } = state.data;
  const isHydrated = state.loadStatus === 'ready';
  const dataBlocked = clearingLocalData || Boolean(state.data.dataDeletionPending);
  const deviceDataReady = mode !== 'device' || nativeDataChecked;
  const canUseData = () => !dataDeletionLock.current && !store.getSnapshot().data.dataDeletionPending;
  const ensureDataAvailable = (epoch = dataEpoch.current) => {
    if (!canUseData() || epoch !== dataEpoch.current) throw new Error('数据操作已取消，请先完成本机数据清除。');
  };
  const hasHomeGeofence = config.geofences.some((fence) => fence.kind === 'home');

  const refreshPermissions = async () => {
    if (!canUseData()) return false;
    const epoch = dataEpoch.current;
    try {
      const next = await getGuardianNative().getPermissions();
      if (epoch !== dataEpoch.current) return false;
      setPermissions(next);
      return true;
    } catch (error) {
      if (epoch !== dataEpoch.current) return false;
      setPermissions(undefined);
      setNativeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const refreshCriticalMessaging = async () => {
    if (!canUseData()) return false;
    const epoch = dataEpoch.current;
    try {
      const preparation = parseCriticalMessagingPreparation(
        await getGuardianNative().getCriticalMessagingPreparation(),
      );
      if (epoch !== dataEpoch.current) return false;
      setCriticalMessaging(preparation);
      return true;
    } catch (error) {
      if (epoch !== dataEpoch.current) return false;
      setCriticalMessaging(undefined);
      setNativeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const requestFreshCurrentLocation = () => {
    ensureDataAvailable();
    if (currentLocationRequest.current) return currentLocationRequest.current;
    const request = getGuardianNative().getCurrentLocation().then(parseCurrentLocationSample);
    currentLocationRequest.current = request;
    const clear = () => {
      if (currentLocationRequest.current === request) currentLocationRequest.current = undefined;
    };
    request.then(clear, clear);
    return request;
  };

  const refreshCurrentPlace = async (
    eventSync = nativeSync.current,
  ) => {
    if (!canUseData()) return false;
    const epoch = dataEpoch.current;
    setCurrentLocationState('refreshing');
    try {
      const sample = await requestFreshCurrentLocation();
      if (epoch !== dataEpoch.current) return false;
      setCurrentLocation(sample);
      setCurrentLocationState('ready');
      await eventSync?.retry();
      return true;
    } catch {
      if (epoch !== dataEpoch.current) return false;
      setCurrentLocationState('error');
      return false;
    }
  };

  const checkNativeData = async () => {
    if (!isHydrated || mode !== 'device' || dataBlocked || !canUseData() || nativeDataCheckLock.current) return;
    nativeDataCheckLock.current = true;
    setNativeError('');
    const epoch = dataEpoch.current;
    try {
      const status = await getGuardianNative().getCurrentStatus();
      if (epoch !== dataEpoch.current) return;
      if (status.dataDeletionPending) {
        store.requireDataDeletion();
        return;
      }
      // Native pause survives a failed JS write and must win before auto-start.
      if (status.isGuardianPaused) store.setPaused(true);
      setNativeDataChecked(true);
      setNativeError('');
    } catch (error) {
      if (epoch === dataEpoch.current) setNativeError(String(error));
    } finally {
      nativeDataCheckLock.current = false;
    }
  };

  useEffect(() => {
    void checkNativeData();
  }, [isHydrated, mode, dataBlocked]);

  useEffect(() => {
    if (!isHydrated || mode !== 'device') return;
    if (dataBlocked || !nativeDataChecked || !canUseData()) return;
    let cancelled = false;
    try {
      const native = getGuardianNative();
      const eventSync = startGuardianEventSync(
        native,
        (listener) =>
          subscribeToGuardianEvents(() => {
            listener();
            void refreshCriticalMessaging();
          }),
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
        (state) => {
          if (state.nativeStatus?.isGuardianPaused) store.setPaused(true);
          setGuardianControlState(state);
        },
        (enabled) => store.setEnabled(enabled),
        (error) => setNativeError(error instanceof Error ? error.message : String(error)),
      );
      nativeSync.current = eventSync;
      geofenceSync.current = fenceSync;
      guardianControl.current = control;
      const policies = startGuardianPolicySync(native);
      policySync.current = policies;
      setPolicyReady(false);
      fenceSync.update(store.getSnapshot().data.config.geofences);
      void (async () => {
        await fenceSync.flush();
        if (cancelled || !canUseData()) return;
        const initialConfig = store.getSnapshot().data.config;
        await native.setNotificationContacts(initialConfig.contacts);
        if (cancelled || !canUseData()) return;
        await policies.update(initialConfig.schedule);
        if (policySync.current !== policies) return;
        setPolicyReady(true);
        await eventSync.retry();
        await control.refresh();
      })().catch((error) => { if (!cancelled && canUseData()) setNativeError(String(error)); });
      void refreshPermissions();
      void refreshCriticalMessaging();
      if (!store.getSnapshot().data.isGuardianPaused || store.getSnapshot().data.config.geofences.length)
        void refreshCurrentPlace(eventSync);
      void control.refresh().catch(() => undefined);
      const removeErrors = subscribeToGuardianErrors((event) => {
        setNativeError(event.message);
        void control.refresh().catch(() => undefined);
      });
      const removeMessagingUpdates = subscribeToGuardianMessagingUpdates(() => {
        void refreshCriticalMessaging();
      });
      const appState = AppState.addEventListener('change', (value) => {
        if (value === 'active') {
          setNow(Date.now());
          void eventSync.retry();
          void refreshPermissions();
          void refreshCriticalMessaging();
          void refreshCurrentPlace(eventSync);
          void control.refresh().catch(() => undefined);
        }
      });
      return () => {
        cancelled = true;
        eventSync.stop();
        fenceSync.stop();
        control.stop();
        policies.stop();
        removeErrors();
        removeMessagingUpdates();
        appState.remove();
        nativeSync.current = undefined;
        geofenceSync.current = undefined;
        guardianControl.current = undefined;
        policySync.current = undefined;
        setPolicyReady(false);
        setGeofenceSyncStatus('idle');
        setGuardianControlState({ phase: 'unknown' });
      };
    } catch (error) {
      setNativeError(String(error));
    }
  }, [isHydrated, mode, dataBlocked, nativeDataChecked]);

  useEffect(() => {
    if (isHydrated && mode === 'device' && !dataBlocked && canUseData())
      geofenceSync.current?.update(config.geofences);
  }, [config.geofences, isHydrated, mode, dataBlocked]);

  const changeSchedule = async (schedule: GuardianSchedule) => {
    ensureDataAvailable();
    if (policyChangeLock.current) throw new Error('正在保存守护规则，请稍候。');
    policyChangeLock.current = true;
    try {
      const current = store.getSnapshot().data;
      const candidate = parseGuardianConfig({ ...current.config, schedule });
      if (current.mode === 'device') {
        if (!policyReady || !policySync.current) throw new Error('原生守护规则尚未就绪，请刷新诊断后重试。');
        if (schedule.monitoringMode === 'standard' &&
            current.config.schedule.monitoringMode !== 'standard') {
          const nextPermissions = await getGuardianNative().getPermissions();
          setPermissions(nextPermissions);
          const blocker = standardModeBlocker(candidate, nextPermissions, geofenceSyncStatus === 'synced');
          if (blocker) throw new Error(blocker);
          await getGuardianNative().setNotificationContacts(candidate.contacts);
        }
        await policySync.current.update(schedule);
      } else if (schedule.monitoringMode === 'standard') {
        throw new Error('请先添加真实地点并进入设备模式，再启用正式守护。');
      }
      if (!store.updateConfig((value) => ({ ...value, schedule })))
        throw new Error(store.getSnapshot().error ?? '规则保存失败。');
      await store.flush();
      if (store.getSnapshot().saveStatus !== 'durable')
        throw new Error('规则尚未持久保存，请使用页面的保存错误提示重试。');
      // Native has committed the policy. Persist its matching UI value before
      // optional status reads, whose failure must not leave the old mode displayed.
      if (current.mode === 'device') {
        await nativeSync.current?.retry();
        await guardianControl.current?.refresh();
        await refreshCriticalMessaging();
      }
    } finally {
      policyChangeLock.current = false;
    }
  };

  useEffect(() => {
    if (!isHydrated || mode !== 'device') return;
    if (dataBlocked || !nativeDataChecked || !canUseData()) return;
    void getGuardianNative()
      .setNotificationContacts(config.contacts)
      .then(refreshCriticalMessaging)
      .catch((error) => setNativeError(error instanceof Error ? error.message : String(error)));
  }, [config.contacts, isHydrated, mode, dataBlocked, nativeDataChecked]);

  useEffect(() => {
    if (
      !isHydrated ||
      mode !== 'device' ||
      permissions?.motion !== 'notDetermined' ||
      motionPermissionRequested.current ||
      !nativeDataChecked ||
      dataBlocked
    )
      return;
    motionPermissionRequested.current = true;
    void requestMotionPermission();
  }, [isHydrated, mode, permissions?.motion, dataBlocked, nativeDataChecked]);

  useEffect(() => {
    // Native events may arrive between the 30-second UI ticks. Compare them
    // with the current clock, not the previous render's time.
    setNow(Date.now());
  }, [localEvents]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      store.pruneHistory();
    }, 30_000);
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

  const refreshDiagnostics = async () => {
    ensureDataAvailable();
    const epoch = dataEpoch.current;
    let setupFailed = false;
    setNativeError('');
    if (!policyReady && policySync.current) {
      try {
        const current = store.getSnapshot().data.config;
        geofenceSync.current?.update(current.geofences);
        await geofenceSync.current?.flush();
        ensureDataAvailable(epoch);
        await getGuardianNative().setNotificationContacts(current.contacts);
        ensureDataAvailable(epoch);
        await policySync.current.update(current.schedule);
        ensureDataAvailable(epoch);
        setPolicyReady(true);
      } catch (error) {
        setupFailed = true;
        if (epoch === dataEpoch.current) setNativeError(String(error));
      }
    }
    ensureDataAvailable(epoch);
    const results = await Promise.all([
      refreshPermissions(),
      refreshCriticalMessaging(),
      refreshCurrentPlace(),
      guardianControl.current?.refresh() ?? Promise.resolve(),
    ]);
    ensureDataAvailable(epoch);
    if (setupFailed || results.some((result) => result === false))
      throw new Error('部分诊断信息读取失败，请重试。');
  };

  const deviceGuardianDescription = useMemo(
    () =>
      describeDeviceGuardian(
        guardianControlState,
        permissions,
        geofenceSyncStatus,
        config.geofences.length,
        hasHomeGeofence,
        isWithinGuardianWindow(config.schedule, new Date(now)),
        `${config.schedule.startTime}–${config.schedule.expectedReturnTime}`,
        isGuardianPaused,
      ),
    [
      config.geofences.length,
      config.schedule.expectedReturnTime,
      config.schedule.startTime,
      geofenceSyncStatus,
      guardianControlState,
      hasHomeGeofence,
      isGuardianPaused,
      now,
      permissions,
    ],
  );

  const deviceGuardianConfirmed =
    !isGuardianPaused &&
    guardianControlState.phase === 'monitoring' &&
    permissions?.location === 'always' &&
    permissions.locationAccuracy === 'full' &&
    permissions.backgroundRefresh === 'available' &&
    geofenceSyncStatus === 'synced' &&
    config.geofences.length > 0;

  const requestLocationPermissions = async () => {
    if (!canUseData()) return;
    const epoch = dataEpoch.current;
    try {
      setNativeError('');
      const native = getGuardianNative();
      const before = (await native.getPermissions()).location;
      await native.requestPermissions();
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        if (epoch !== dataEpoch.current) return;
        const next = await native.getPermissions();
        if (epoch !== dataEpoch.current) return;
        setPermissions(next);
        if (next.location !== before) {
          if (next.location === 'always' && next.locationAccuracy === 'full')
            void refreshCurrentPlace();
          return;
        }
      }
      setNativeError('定位权限尚未改变；如果系统没有再次弹窗，请打开系统设置。');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestMotionPermission = async () => {
    if (!canUseData()) return;
    const epoch = dataEpoch.current;
    try {
      setNativeError('');
      const native = getGuardianNative();
      await native.requestMotionPermission();
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        if (epoch !== dataEpoch.current) return;
        const next = await native.getPermissions();
        if (epoch !== dataEpoch.current) return;
        setPermissions(next);
        if (next.motion !== 'notDetermined') return;
      }
      setNativeError('“运动与健身”权限尚未改变；如果系统没有弹窗，请打开系统设置。');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  };

  const getCurrentLocation = async () => {
    ensureDataAvailable();
    const epoch = dataEpoch.current;
    const current = store.getSnapshot();
    if (current.loadStatus !== 'ready' || current.data.mode !== 'device')
      throw new Error('真实设备模式尚未就绪。');
    const sample = await requestFreshCurrentLocation();
    if (epoch !== dataEpoch.current) throw new Error('位置请求已取消。');
    setCurrentLocation(sample);
    setCurrentLocationState('ready');
    return sample;
  };

  const saveCurrentLocation = async (
    place: NewCurrentLocationPlace,
    sample: CurrentLocationSample,
  ) => {
    ensureDataAvailable();
    const epoch = dataEpoch.current;
    const current = store.getSnapshot();
    if (current.loadStatus !== 'ready' || current.data.mode !== 'device')
      throw new Error('真实设备模式尚未就绪。');
    const nextGeofences = [
      ...current.data.config.geofences.filter((value) => value.id !== place.id),
      {
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
    ensureDataAvailable(epoch);
    if (store.getSnapshot().saveStatus !== 'durable')
      throw new Error('地点尚未可靠保存在本机，请重试保存。');
    const sync = geofenceSync.current;
    if (!sync) throw new Error('守护地点同步尚未就绪。');
    sync.update(store.getSnapshot().data.config.geofences);
    try {
      await sync.flush();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`地点已保存，但同步失败：${message}`);
    }
  };

  const retryGeofenceSync = async () => {
    if (!canUseData()) return;
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

  const setGuardianEnabled = async (enabled: boolean, resumePaused = false): Promise<boolean> => {
    if (!isHydrated || guardianToggleLock.current || !canUseData()) return false;
    if (mode === 'demo') {
      if (enabled && resumePaused) store.setPaused(false);
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
        if (current.config.schedule.monitoringMode === 'standard') {
          const blocker = standardModeBlocker(current.config, await getGuardianNative().getPermissions(),
            geofenceSyncStatus === 'synced');
          if (blocker) throw new Error(blocker);
        }
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
        if (nextPermissions.backgroundRefresh !== 'available')
          throw new Error('请在系统设置中开启后台 App 刷新。');
        await store.flush();
        const sync = geofenceSync.current;
        if (!sync) throw new Error('守护地点同步尚未就绪。');
        sync.update(current.config.geofences);
        await sync.flush();
      }
      await control.setEnabled(enabled, current.config, resumePaused);
      if (enabled && resumePaused) store.setPaused(false);
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
    if (!canUseData()) return;
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
      setNativeError(store.getSnapshot().saveStatus === 'durable'
        ? '' : '守护已暂停；页面数据尚未可靠保存，请重试保存。');
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    } finally {
      guardianToggleLock.current = false;
      setGuardianTogglePending(false);
    }
  };

  const resumeGuardian = async () => {
    if (!canUseData()) return;
    await setGuardianEnabled(true, true);
  };

  const confirmPauseGuardian = () =>
    Alert.alert('暂停自动守护？', '暂停后，App 不会在后台记录地点变化，直到你再次恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '确认暂停', style: 'destructive', onPress: () => void pauseGuardian() },
    ]);

  const clearLocalData = async () => {
    if (dataClearRequest.current) return;
    if (guardianToggleLock.current || policyChangeLock.current)
      throw new Error('正在更改守护状态或规则，请完成后再清除。');
    dataClearRequest.current = true;
    dataDeletionLock.current = true;
    dataEpoch.current += 1;
    setClearingLocalData(true);
    setNativeDataChecked(false);
    const eventSync = nativeSync.current;
    const fences = geofenceSync.current;
    const control = guardianControl.current;
    const policies = policySync.current;
    eventSync?.stop();
    fences?.stop();
    control?.stop();
    policies?.stop();
    try {
      await store.clearLocalData(() => getGuardianNative().clearLocalData(), async () => {
        await Promise.all([eventSync?.flush(), fences?.flush().catch(() => undefined),
          control?.flush(), policies?.flush()]);
        await getGuardianNative().beginDataDeletion();
      });
      setCriticalMessaging(undefined);
      setPermissions(undefined);
      setCurrentLocation(undefined);
      currentLocationRequest.current = undefined;
      setCurrentLocationState('idle');
      setNativeError('');
      setIsMySubviewOpen(false);
      setActiveTab('places');
      dataDeletionLock.current = false;
      Alert.alert('本机数据已清除', '守护保持暂停，已恢复测试模式。重新添加地点和家人后，可在“我的”恢复守护。');
    } finally {
      dataClearRequest.current = false;
      setClearingLocalData(false);
    }
  };

  useEffect(() => {
    if (
      !isHydrated ||
      mode !== 'device' ||
      !policyReady ||
      dataBlocked ||
      isGuardianPaused ||
      isGuardianOn ||
      guardianTogglePending ||
      guardianControlState.phase !== 'off' ||
      permissions?.location !== 'always' ||
      permissions.locationAccuracy !== 'full' ||
      permissions.backgroundRefresh !== 'available' ||
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
    policyReady,
    dataBlocked,
  ]);

  useEffect(() => {
    if (
      isHydrated &&
      mode === 'device' &&
      !dataBlocked &&
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
    dataBlocked,
  ]);

  const guardianBusy =
    guardianTogglePending ||
    ['unknown', 'checking', 'starting', 'stopping'].includes(guardianControlState.phase);
  const overviewGuardianReady =
    mode === 'demo' ? isGuardianOn && !isGuardianPaused : deviceGuardianConfirmed;
  const overviewToneStatus =
    !overviewGuardianReady || !isGuardianOn || isGuardianPaused
      ? 'unknown'
      : snapshot.status === 'unknown' && !snapshot.clockUncertain
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
          {isHydrated && mode === 'device' && (
            <Text style={styles.settingHelpText} accessibilityRole="text">
              {config.schedule.monitoringMode === 'test'
                ? '测试模式 · 测试告警仅保存在本机，不会自动通知家人。'
                : criticalMessaging?.automaticSendingEnabled
                  ? '正式模式 · 家人通知以实际授权和发送状态为准。'
                  : '正式模式 · 当前版本尚不能自动通知家人。'}
            </Text>
          )}
          {state.loadStatus === 'error' && !dataBlocked && (
            <>
              <TouchableOpacity onPress={() => void store.retry()} style={styles.secondaryOutlineButton}>
                <Text style={styles.secondaryOutlineButtonText}>重试读取本机数据</Text>
              </TouchableOpacity>
              <DataManagementScreen onClear={clearLocalData} />
            </>
          )}

          {dataBlocked && (
            <DataManagementScreen deletionPending busy={clearingLocalData} onClear={clearLocalData} />
          )}
          {isHydrated && !dataBlocked && !deviceDataReady && (
            <>
              <Text style={styles.settingHelpText}>{nativeError
                ? '本机数据状态尚未确认，暂未同步守护。可以重试，原有数据不会因此被清除。'
                : '正在确认本机数据状态，确认后才会同步守护。'}</Text>
              {!!nativeError && (
                <>
                  <TouchableOpacity onPress={() => void checkNativeData()} style={styles.secondaryOutlineButton}>
                    <Text style={styles.secondaryOutlineButtonText}>重试确认本机数据状态</Text>
                  </TouchableOpacity>
                  <DataManagementScreen onClear={clearLocalData} />
                </>
              )}
            </>
          )}
          {!dataBlocked && deviceDataReady && activeTab === 'status' && (
            <OverviewScreen
              criticalMessaging={criticalMessaging}
              currentLocation={currentLocation}
              currentLocationState={currentLocationState}
              geofences={config.geofences}
              guardianReady={overviewGuardianReady}
              guardianStatus={
                mode === 'demo' ? '当前是演示状态，不会发送真实通知。' : deviceGuardianDescription
              }
              isGuardianOn={isGuardianOn && !isGuardianPaused}
              mode={mode}
              snapshot={snapshot}
              now={now}
              tone={getStatusTone(overviewToneStatus)}
            />
          )}

          {isHydrated && !dataBlocked && deviceDataReady && activeTab === 'places' && (
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

          {isHydrated && !dataBlocked && deviceDataReady && activeTab === 'me' && (
            <MyScreen
              contacts={config.contacts}
              criticalMessaging={criticalMessaging}
              currentLocation={currentLocation}
              currentLocationState={currentLocationState}
              currentPlace={describeCurrentPlace(snapshot, config.geofences, currentLocation, now)}
              geofenceCount={config.geofences.length}
              geofenceSyncStatus={geofenceSyncStatus}
              guardianStatus={guardianControlState.nativeStatus}
              events={snapshot.events}
              mode={mode}
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
              onChangeSchedule={changeSchedule}
              onClearLocalData={clearLocalData}
              onRefreshDiagnostics={refreshDiagnostics}
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
              onRequestCriticalMessagingAuthorization={async () => {
                setNativeError('');
                await getGuardianNative().requestCriticalMessagingAuthorization();
                await refreshCriticalMessaging();
              }}
              onRefreshCriticalMessagingAuthorization={async () => {
                setNativeError('');
                await getGuardianNative().refreshCriticalMessagingAuthorization();
                await refreshCriticalMessaging();
              }}
              onRequestMotionPermission={requestMotionPermission}
              onRequestPermissions={requestLocationPermissions}
              onRetryGeofenceSync={retryGeofenceSync}
              onSectionOpenChange={setIsMySubviewOpen}
            />
          )}
        </ScrollView>

        {isHydrated && !dataBlocked && deviceDataReady && activeTab === 'me' && !isMySubviewOpen && (isGuardianPaused || isGuardianOn) && (
          <View style={styles.myGuardianFooter}>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.65}
              disabled={guardianBusy}
              onPress={isGuardianPaused ? () => void resumeGuardian() : confirmPauseGuardian}
              style={styles.myGuardianTextAction}
            >
              <Text
                style={[
                  styles.myGuardianText,
                  isGuardianPaused && styles.myGuardianResumeText,
                  guardianBusy && styles.myGuardianTextDisabled,
                ]}
              >
                {guardianBusy
                  ? isGuardianPaused
                    ? '正在恢复…'
                    : '正在暂停…'
                  : isGuardianPaused
                    ? '恢复自动守护'
                    : '暂停自动守护'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.key }}
              activeOpacity={0.75}
              disabled={dataBlocked || !deviceDataReady || (!isHydrated && tab.key !== 'status')}
              key={tab.key}
              onPress={() => {
                if (tab.key !== 'me') setIsMySubviewOpen(false);
                setActiveTab(tab.key);
              }}
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
