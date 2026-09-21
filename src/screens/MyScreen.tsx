import React, { useEffect, useState } from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import type { GuardianContact, GuardianEvent, GuardianSchedule } from '../domain/types';
import type { CurrentLocationSample } from '../domain/validation';
import type { GuardianNativeStatus, PermissionState } from '../native/GuardianNative';
import type { CriticalMessagingPreparation } from '../native/criticalMessaging';
import type { GeofenceSyncStatus } from '../native/guardianGeofenceSync';
import {
  composeShortcutTestMessage,
  openShortcutInstaller,
  sendShortcutNotification,
} from '../native/shortcutNotification';
import { styles } from '../styles/appStyles';
import {
  DiagnosticsScreen,
  guardianDiagnosticsSummary,
  type DiagnosticCurrentPlace,
  type GuardianDiagnosticsInput,
} from './DiagnosticsScreen';
import { FamilyScreen } from './FamilyScreen';
import { FootprintsScreen, getFootprintEvents } from './FootprintsScreen';
import { RulesScreen } from './RulesScreen';

type MySection = 'family' | 'schedule' | 'permissions' | 'footprints' | 'diagnostics' | undefined;

const permissionLabel: Record<PermissionState['location'], string> = {
  notDetermined: '尚未设置',
  denied: '未允许',
  restricted: '受系统限制',
  whenInUse: '仅使用时允许',
  always: '始终允许',
};

const accuracyLabel: Record<PermissionState['locationAccuracy'], string> = {
  unknown: '尚未确认',
  reduced: '大致位置',
  full: '精确位置',
};

const motionLabel: Record<PermissionState['motion'], string> = {
  notDetermined: '尚未设置',
  denied: '未允许',
  restricted: '受系统限制',
  authorized: '已允许',
};

const backgroundRefreshLabel: Record<PermissionState['backgroundRefresh'], string> = {
  available: '已开启',
  denied: '未开启',
  restricted: '受系统限制',
};

const syncLabel: Record<GeofenceSyncStatus, string> = {
  idle: '正在准备',
  syncing: '正在同步',
  synced: '已同步',
  error: '同步失败',
};

function SettingsRow({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress: () => void;
  value: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.75}
      onPress={onPress}
      style={styles.settingsRow}
    >
      <Text style={styles.settingsRowLabel}>{label}</Text>
      <View style={styles.settingsRowRight}>
        <Text style={styles.settingsRowValue}>{value}</Text>
        <Text style={styles.settingsChevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export function MyScreen({
  contacts,
  criticalMessaging,
  currentLocation,
  currentLocationState = 'idle',
  currentPlace,
  geofenceCount = 0,
  geofenceSyncStatus,
  guardianStatus,
  events,
  mode = 'device',
  now,
  permissions,
  schedule,
  onAddContact,
  onChangeSchedule,
  onRefreshDiagnostics = async () => undefined,
  onRefreshPermissions,
  onRemoveContact,
  onRequestCriticalMessagingAuthorization,
  onRefreshCriticalMessagingAuthorization,
  onRequestMotionPermission,
  onRequestPermissions,
  onRetryGeofenceSync,
  onSectionOpenChange,
}: {
  contacts: GuardianContact[];
  criticalMessaging?: CriticalMessagingPreparation;
  currentLocation?: CurrentLocationSample;
  currentLocationState?: 'idle' | 'refreshing' | 'ready' | 'error';
  currentPlace?: DiagnosticCurrentPlace;
  geofenceCount?: number;
  geofenceSyncStatus: GeofenceSyncStatus;
  guardianStatus?: GuardianNativeStatus;
  events: GuardianEvent[];
  mode?: 'demo' | 'device';
  now: number;
  permissions?: PermissionState;
  schedule: GuardianSchedule;
  onAddContact: (contact: GuardianContact) => void;
  onChangeSchedule: (schedule: GuardianSchedule) => void;
  onRefreshDiagnostics?: () => Promise<void>;
  onRefreshPermissions: () => Promise<void>;
  onRemoveContact: (id: string) => void;
  onRequestCriticalMessagingAuthorization: () => Promise<void>;
  onRefreshCriticalMessagingAuthorization: () => Promise<void>;
  onRequestMotionPermission: () => Promise<void>;
  onRequestPermissions: () => Promise<void>;
  onRetryGeofenceSync: () => Promise<void>;
  onSectionOpenChange?: (open: boolean) => void;
}) {
  const [activeSection, setActiveSection] = useState<MySection>();
  const [testNotificationPending, setTestNotificationPending] = useState(false);
  const [criticalMessagingAuthorizationPending, setCriticalMessagingAuthorizationPending] =
    useState(false);
  const footprintCount = getFootprintEvents(events).length;
  const firstContact = [...contacts].sort((a, b) => a.priority - b.priority)[0];
  const diagnosticsInput: GuardianDiagnosticsInput = {
    mode,
    now,
    status: guardianStatus,
    permissions,
    geofenceSyncStatus,
    geofenceCount,
    currentLocationState,
    currentLocation,
    currentPlace,
    events,
    criticalMessaging,
  };
  const diagnosticsSummary = guardianDiagnosticsSummary(diagnosticsInput);

  useEffect(() => {
    onSectionOpenChange?.(Boolean(activeSection));
    return () => onSectionOpenChange?.(false);
  }, [activeSection, onSectionOpenChange]);

  const sectionTitle =
    activeSection === 'family'
      ? '家人联系方式'
      : activeSection === 'schedule'
        ? '守护时间'
        : activeSection === 'permissions'
          ? '权限'
          : activeSection === 'footprints'
            ? '足迹'
            : '守护诊断';

  const showShortcutInstallError = () =>
    Alert.alert(
      '无法打开安装页面',
      '请检查网络，并确认 iPhone 已安装系统自带的“快捷指令”App，然后再试一次。',
    );

  const handleInstallShortcut = async () => {
    try {
      await openShortcutInstaller();
    } catch {
      showShortcutInstallError();
    }
  };

  const confirmTestNotification = () => {
    if (!firstContact || testNotificationPending) return;

    Alert.alert(
      '发送测试短信？',
      `将向第 1 位家人 ${firstContact.name}（${firstContact.phone}）发送一条测试短信。修正版快捷指令会直接使用已填写的收件人和内容；首次无交互发送时，如 iOS 显示隐私授权，请选择“始终允许”。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '立即测试',
          onPress: async () => {
            setTestNotificationPending(true);
            try {
              await sendShortcutNotification({
                phone: firstContact.phone,
                message: composeShortcutTestMessage(firstContact.name),
              });
            } catch {
              Alert.alert(
                '无法运行快捷指令',
                '请先安装“到家了么短信通知 V3”快捷指令，然后再试一次。',
              );
            } finally {
              setTestNotificationPending(false);
            }
          },
        },
      ],
    );
  };

  const handleCriticalMessagingAuthorization = async (request: boolean) => {
    if (criticalMessagingAuthorizationPending) return;
    setCriticalMessagingAuthorizationPending(true);
    try {
      if (request) await onRequestCriticalMessagingAuthorization();
      else await onRefreshCriticalMessagingAuthorization();
      Alert.alert(
        request ? '关键短信授权已更新' : '授权状态已刷新',
        '每位家人的授权结果已经保存在本机。',
      );
    } catch (error) {
      Alert.alert(
        '无法更新关键短信授权',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setCriticalMessagingAuthorizationPending(false);
    }
  };

  if (activeSection) {
    return (
      <>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.75}
          onPress={() => setActiveSection(undefined)}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹ 我的</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>{sectionTitle}</Text>

        {activeSection === 'family' && (
          <>
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>通过快捷指令发短信</Text>
              <Text style={styles.noticeText}>
                联系方式只在本机保存。快捷指令仅用于用户主动发送测试短信；检测到风险时，App 不会自动打开快捷指令。
              </Text>
            </View>
            <FamilyScreen
              contacts={contacts}
              criticalMessaging={criticalMessaging}
              criticalMessagingAuthorizationPending={criticalMessagingAuthorizationPending}
              onAddContact={onAddContact}
              onInstallShortcut={() => void handleInstallShortcut()}
              onRemoveContact={onRemoveContact}
              onRequestCriticalMessagingAuthorization={() =>
                void handleCriticalMessagingAuthorization(true)
              }
              onRefreshCriticalMessagingAuthorization={() =>
                void handleCriticalMessagingAuthorization(false)
              }
              onSendTestNotification={confirmTestNotification}
              showNotificationPolicy={false}
              testNotificationPending={testNotificationPending}
            />
          </>
        )}

        {activeSection === 'schedule' && (
          <RulesScreen
            schedule={schedule}
            onChangeSchedule={onChangeSchedule}
            showRiskExplanation={false}
          />
        )}

        {activeSection === 'permissions' && (
          <>
            <View style={styles.permissionCard}>
              <View style={styles.permissionRow}>
                <Text style={styles.permissionLabel}>定位权限</Text>
                <Text style={styles.permissionValue}>
                  {permissions ? permissionLabel[permissions.location] : '正在读取'}
                </Text>
              </View>
              <View style={styles.permissionDivider} />
              <View style={styles.permissionRow}>
                <Text style={styles.permissionLabel}>运动与健身</Text>
                <Text style={styles.permissionValue}>
                  {permissions ? motionLabel[permissions.motion] : '正在读取'}
                </Text>
              </View>
              <View style={styles.permissionDivider} />
              <View style={styles.permissionRow}>
                <Text style={styles.permissionLabel}>位置精度</Text>
                <Text style={styles.permissionValue}>
                  {permissions ? accuracyLabel[permissions.locationAccuracy] : '正在读取'}
                </Text>
              </View>
              <View style={styles.permissionDivider} />
              <View style={styles.permissionRow}>
                <Text style={styles.permissionLabel}>后台 App 刷新</Text>
                <Text style={styles.permissionValue}>
                  {permissions
                    ? backgroundRefreshLabel[permissions.backgroundRefresh]
                    : '正在读取'}
                </Text>
              </View>
              <View style={styles.permissionDivider} />
              <View style={styles.permissionRow}>
                <Text style={styles.permissionLabel}>守护地点</Text>
                <Text style={styles.permissionValue}>{syncLabel[geofenceSyncStatus]}</Text>
              </View>
            </View>

            <Text style={styles.settingHelpText}>
              自动守护需要“始终允许”“精确位置”和“后台 App 刷新”。允许“运动与健身”后，系统会结合步行、跑步和乘车迹象，降低家外停留误判。数据只用于本机守护。
            </Text>

            {(permissions?.location === 'notDetermined' ||
              permissions?.location === 'whenInUse') && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void onRequestPermissions()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>
                  {permissions.location === 'whenInUse' ? '改为始终允许' : '允许定位'}
                </Text>
              </TouchableOpacity>
            )}

            {permissions?.motion === 'notDetermined' && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void onRequestMotionPermission()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>允许运动与健身</Text>
              </TouchableOpacity>
            )}

            {(permissions?.location === 'denied' ||
              permissions?.location === 'restricted' ||
              permissions?.locationAccuracy === 'reduced' ||
              permissions?.motion === 'denied' ||
              permissions?.motion === 'restricted' ||
              permissions?.backgroundRefresh !== 'available') && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void Linking.openSettings()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>打开系统设置</Text>
              </TouchableOpacity>
            )}

            {geofenceSyncStatus === 'error' && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void onRetryGeofenceSync()}
                style={styles.secondaryOutlineButton}
              >
                <Text style={styles.secondaryOutlineButtonText}>重试地点同步</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => void onRefreshPermissions()}
              style={styles.secondaryOutlineButton}
            >
              <Text style={styles.secondaryOutlineButtonText}>刷新权限状态</Text>
            </TouchableOpacity>
          </>
        )}

        {activeSection === 'footprints' && <FootprintsScreen events={events} now={now} />}

        {activeSection === 'diagnostics' && (
          <DiagnosticsScreen input={diagnosticsInput} onRefresh={onRefreshDiagnostics} />
        )}
      </>
    );
  }

  return (
    <>
      <View style={styles.settingsGroup}>
        <SettingsRow
          label="家人联系方式"
          onPress={() => setActiveSection('family')}
          value={contacts.length > 0 ? `${contacts.length} 位` : '未设置'}
        />
        <SettingsRow
          label="守护时间"
          onPress={() => setActiveSection('schedule')}
          value={`${schedule.startTime}–${schedule.expectedReturnTime}`}
        />
        <SettingsRow
          label="权限"
          onPress={() => setActiveSection('permissions')}
          value={
            permissions?.location === 'always' &&
            permissions.locationAccuracy === 'full' &&
            permissions.motion === 'authorized' &&
            permissions.backgroundRefresh === 'available'
              ? '已就绪'
              : permissions
                ? '需要设置'
                : '正在读取'
          }
        />
        <SettingsRow
          label="足迹"
          onPress={() => setActiveSection('footprints')}
          value={footprintCount > 0 ? `${footprintCount} 条` : '暂无记录'}
        />
        <SettingsRow
          label="守护诊断"
          onPress={() => setActiveSection('diagnostics')}
          value={diagnosticsSummary.value}
        />
      </View>

    </>
  );
}
