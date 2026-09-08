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
import { FamilyScreen } from './src/screens/FamilyScreen';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { PlacesScreen } from './src/screens/PlacesScreen';
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
} from './src/native/GuardianNative';
import { startGuardianEventSync } from './src/native/guardianEventSync';

const store = createGuardianStore(guardianRepository);
type TabKey = 'overview' | 'places' | 'rules' | 'family' | 'timeline';
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'places', label: '地点' },
  { key: 'rules', label: '规则' },
  { key: 'family', label: '家人' },
  { key: 'timeline', label: '记录' },
];

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [now, setNow] = useState(Date.now());
  const [nativeError, setNativeError] = useState('');
  const nativeSync = useRef<ReturnType<typeof startGuardianEventSync> | undefined>(undefined);
  const state = useGuardian(store);
  const { config, localEvents, isGuardianOn, mode } = state.data;
  const isHydrated = state.loadStatus === 'ready';
  useEffect(() => {
    if (!isHydrated || mode !== 'device') return;
    try {
      const sync = startGuardianEventSync(
        getGuardianNative(),
        subscribeToGuardianEvents,
        store.importEvents,
        (error) => setNativeError(String(error)),
      );
      nativeSync.current = sync;
      const removeErrors = subscribeToGuardianErrors((event) => setNativeError(event.message));
      const appState = AppState.addEventListener('change', (value) => {
        if (value === 'active') void sync.retry();
      });
      return () => {
        sync.stop();
        removeErrors();
        appState.remove();
        nativeSync.current = undefined;
      };
    } catch (error) {
      setNativeError(String(error));
    }
  }, [isHydrated, mode]);
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
          </View>
          <Switch
            accessibilityLabel="守护开关"
            disabled={!isHydrated || mode !== 'demo'}
            value={isGuardianOn}
            onValueChange={store.setEnabled}
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
                isGuardianOn ? escalation.description : '守护已暂停，未解除的告警仍然保留。'
              }
              snapshot={snapshot}
              tone={getStatusTone(snapshot.status)}
              notificationPreview={preview}
              onRetryStorage={() => {
                void store.retry().then(() => nativeSync.current?.retry());
              }}
              onResetLocalState={() => {
                store.reset();
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
              onAddGeofence={(geofence) => {
                store.updateConfig((current) => ({
                  ...current,
                  geofences: [...current.geofences, geofence],
                }));
              }}
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
                store.updateConfig((current) => ({
                  ...current,
                  geofences: current.geofences.filter((fence) => fence.id !== id),
                }));
              }}
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
