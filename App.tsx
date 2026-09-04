import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getStatusTone, summarizeRiskReason } from './src/domain/guardianRules';
import { guardianConfig, statusSnapshot } from './src/domain/mockData';
import { composeNotificationPreview } from './src/domain/notificationCopy';
import { buildGuardianSnapshot } from './src/domain/riskEngine';
import { getEscalationState } from './src/domain/escalation';
import type { GuardianConfig, GuardianEvent, GuardianStatusSnapshot } from './src/domain/types';
import { FamilyScreen } from './src/screens/FamilyScreen';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { PlacesScreen } from './src/screens/PlacesScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { TimelineScreen } from './src/screens/TimelineScreen';
import { guardianRepository } from './src/storage/guardianRepository';
import { styles } from './src/styles/appStyles';
import { clamp } from './src/utils/number';
import { formatClockTime } from './src/utils/time';

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
  const [isGuardianOn, setIsGuardianOn] = useState(true);
  const [config, setConfig] = useState<GuardianConfig>(guardianConfig);
  const [localEvents, setLocalEvents] = useState<GuardianEvent[]>([]);
  const [storageUpdatedAt, setStorageUpdatedAt] = useState<string>();
  const [isHydrated, setIsHydrated] = useState(false);
  const currentSnapshot = useMemo<GuardianStatusSnapshot>(() => {
    const events = [...statusSnapshot.events, ...localEvents];
    return buildGuardianSnapshot(statusSnapshot, events);
  }, [localEvents]);
  const tone = getStatusTone(currentSnapshot.status);
  const riskReason = useMemo(() => summarizeRiskReason(currentSnapshot.events), [currentSnapshot.events]);
  const notificationPreview = useMemo(
    () => composeNotificationPreview(currentSnapshot, config),
    [config, currentSnapshot],
  );
  const escalationState = useMemo(
    () => getEscalationState(currentSnapshot, config),
    [config, currentSnapshot],
  );

  useEffect(() => {
    let isMounted = true;

    guardianRepository.loadState().then(storedState => {
      if (!isMounted) {
        return;
      }

      setConfig(storedState.config);
      setLocalEvents(storedState.localEvents);
      setStorageUpdatedAt(storedState.updatedAt);
      setIsHydrated(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const persistState = (nextConfig: GuardianConfig, nextEvents: GuardianEvent[]) => {
    guardianRepository.saveConfig(nextConfig, nextEvents).then(savedState => {
      setStorageUpdatedAt(savedState.updatedAt);
    });
  };

  const updateConfig = (updater: (current: GuardianConfig) => GuardianConfig) => {
    setConfig(current => {
      const nextConfig = updater(current);
      persistState(nextConfig, localEvents);
      return nextConfig;
    });
  };

  const addLocalEvent = (event: Omit<GuardianEvent, 'id' | 'timestamp'>) => {
    setLocalEvents(currentEvents => {
      const nextEvents = [...currentEvents, createLocalEvent(event)];
      guardianRepository.saveEvents(config, nextEvents).then(savedState => {
        setStorageUpdatedAt(savedState.updatedAt);
      });
      return nextEvents;
    });
  };

  const handleResetLocalState = () => {
    guardianRepository.reset().then(storedState => {
      setConfig(storedState.config);
      setLocalEvents(storedState.localEvents);
      setStorageUpdatedAt(storedState.updatedAt);
    });
  };

  const createLocalEvent = (event: Omit<GuardianEvent, 'id' | 'timestamp'>): GuardianEvent => {
    return {
      ...event,
      id: `local-${Date.now()}`,
      timestamp: formatClockTime(),
    };
  };

  const handleConfirmSafe = () => {
    addLocalEvent({
      type: 'USER_CONFIRMED_SAFE',
      title: '本人确认安全',
      description: '本人点击了我没事，当前风险状态已转为安全。',
      source: 'user',
      batteryLevel: currentSnapshot.batteryLevel,
    });
  };

  const handleSOS = () => {
    addLocalEvent({
      type: 'SOS_SENT',
      title: '发起求助',
      description: '本人主动发送求助，家人名单会按顺序收到通知。',
      source: 'user',
      batteryLevel: currentSnapshot.batteryLevel,
    });
  };

  const handleSimulateReturnHome = () => {
    addLocalEvent({
      type: 'RETURN_HOME',
      title: '回到家',
      description: '模拟进入家的地理围栏，系统将状态恢复为安全。',
      source: 'geofence',
      batteryLevel: currentSnapshot.batteryLevel,
    });
  };

  const handleSimulateLocationLost = () => {
    addLocalEvent({
      type: 'LOCATION_LOST',
      title: '位置中断',
      description: '模拟最后位置在劳作地点附近，随后暂时没有新的定位信号。',
      source: 'location',
      batteryLevel: currentSnapshot.batteryLevel,
    });
  };

  const handleSimulateRiskEscalated = () => {
    const firstContact = [...config.contacts].sort((a, b) => a.priority - b.priority)[0];
    const contactName = firstContact?.name ?? '第一位家人';

    addLocalEvent({
      type: 'FAMILY_NOTIFIED',
      title: `已通知${contactName}`,
      description: `模拟本人未响应安全确认，系统已通知${contactName}。`,
      source: 'notification',
      batteryLevel: currentSnapshot.batteryLevel,
    });
  };

  const handleAdvanceEscalation = () => {
    if (!escalationState.nextEvent) {
      return;
    }

    addLocalEvent(escalationState.nextEvent);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F4ED" />
      <View style={styles.shell}>
        <View style={styles.header}>
          <View>
            <Text style={styles.appName}>到家说一声</Text>
            <Text style={styles.subtleText}>
              {isGuardianOn ? '今天正在安静守着' : '守护已暂停'}
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setIsGuardianOn(value => !value)}
            style={[styles.guardianSwitch, isGuardianOn ? styles.switchOn : styles.switchOff]}>
            <Text style={[styles.switchText, isGuardianOn ? styles.switchTextOn : styles.switchTextOff]}>
              {isGuardianOn ? '开启' : '暂停'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                activeOpacity={0.8}
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tabButton, isActive && styles.tabButtonActive]}>
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          {activeTab === 'overview' && (
            <OverviewScreen
              config={config}
              isGuardianOn={isGuardianOn}
              isHydrated={isHydrated}
              riskReason={riskReason}
              storageUpdatedAt={storageUpdatedAt}
              snapshot={currentSnapshot}
              tone={tone}
              onResetLocalState={handleResetLocalState}
              onConfirmSafe={handleConfirmSafe}
              onSOS={handleSOS}
              notificationPreview={notificationPreview}
            />
          )}
          {activeTab === 'places' && (
            <PlacesScreen
              geofences={config.geofences}
              onAddGeofence={geofence =>
                updateConfig(current => ({
                  ...current,
                  geofences: [...current.geofences, geofence],
                }))
              }
              onAdjustRadius={(id, delta) =>
                updateConfig(current => ({
                  ...current,
                  geofences: current.geofences.map(geofence =>
                    geofence.id === id
                      ? {
                          ...geofence,
                          radiusMeters: clamp(geofence.radiusMeters + delta, 100, 1000),
                        }
                      : geofence,
                  ),
                }))
              }
              onRemoveGeofence={id =>
                updateConfig(current => ({
                  ...current,
                  geofences: current.geofences.filter(geofence => geofence.id !== id),
                }))
              }
            />
          )}
          {activeTab === 'rules' && (
            <RulesScreen
              schedule={config.schedule}
              onChangeSchedule={schedule =>
                updateConfig(current => ({
                  ...current,
                  schedule,
                }))
              }
            />
          )}
          {activeTab === 'family' && (
            <FamilyScreen
              contacts={config.contacts}
              onAddContact={contact =>
                updateConfig(current => ({
                  ...current,
                  contacts: [
                    ...current.contacts,
                    {
                      ...contact,
                      priority: current.contacts.length + 1,
                    },
                  ],
                }))
              }
              onRemoveContact={id =>
                updateConfig(current => ({
                  ...current,
                  contacts: current.contacts
                    .filter(contact => contact.id !== id)
                    .map((contact, index) => ({ ...contact, priority: index + 1 })),
                }))
              }
            />
          )}
          {activeTab === 'timeline' && (
            <TimelineScreen
              escalationState={escalationState}
              events={currentSnapshot.events}
              onAdvanceEscalation={handleAdvanceEscalation}
              onSimulateLocationLost={handleSimulateLocationLost}
              onSimulateReturnHome={handleSimulateReturnHome}
              onSimulateRiskEscalated={handleSimulateRiskEscalated}
            />
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

export default App;
