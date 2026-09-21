import React, { useState } from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import type { GuardianContact, GuardianEvent, GuardianSchedule } from '../domain/types';
import type { PermissionState } from '../native/GuardianNative';
import type { GeofenceSyncStatus } from '../native/guardianGeofenceSync';
import {
  composeShortcutTestMessage,
  openShortcutInstaller,
  sendShortcutNotification,
} from '../native/shortcutNotification';
import { styles } from '../styles/appStyles';
import { FamilyScreen } from './FamilyScreen';
import { FootprintsScreen, getFootprintEvents } from './FootprintsScreen';
import { RulesScreen } from './RulesScreen';

type MySection = 'family' | 'schedule' | 'permissions' | 'footprints' | undefined;

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
  geofenceCount,
  geofenceSyncStatus,
  guardianBusy,
  guardianStatus,
  isGuardianOn,
  isGuardianPaused,
  events,
  now,
  permissions,
  schedule,
  onAddContact,
  onChangeSchedule,
  onPauseGuardian,
  onRefreshPermissions,
  onRemoveContact,
  onRequestMotionPermission,
  onRequestPermissions,
  onResetLocalState,
  onResumeGuardian,
  onRetryGeofenceSync,
}: {
  contacts: GuardianContact[];
  geofenceCount: number;
  geofenceSyncStatus: GeofenceSyncStatus;
  guardianBusy: boolean;
  guardianStatus: string;
  isGuardianOn: boolean;
  isGuardianPaused: boolean;
  events: GuardianEvent[];
  now: number;
  permissions?: PermissionState;
  schedule: GuardianSchedule;
  onAddContact: (contact: GuardianContact) => void;
  onChangeSchedule: (schedule: GuardianSchedule) => void;
  onPauseGuardian: () => Promise<void>;
  onRefreshPermissions: () => Promise<void>;
  onRemoveContact: (id: string) => void;
  onRequestMotionPermission: () => Promise<void>;
  onRequestPermissions: () => Promise<void>;
  onResetLocalState: () => Promise<void>;
  onResumeGuardian: () => Promise<void>;
  onRetryGeofenceSync: () => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<MySection>();
  const [testNotificationPending, setTestNotificationPending] = useState(false);
  const footprintCount = getFootprintEvents(events).length;
  const firstContact = [...contacts].sort((a, b) => a.priority - b.priority)[0];

  const sectionTitle =
    activeSection === 'family'
      ? '家人联系方式'
      : activeSection === 'schedule'
        ? '守护时间'
        : activeSection === 'permissions'
          ? '系统权限'
          : '足迹';

  const confirmPause = () =>
    Alert.alert('暂停自动守护？', '暂停后，App 不会在后台记录地点变化，直到你再次恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '确认暂停', style: 'destructive', onPress: () => void onPauseGuardian() },
    ]);

  const confirmReset = () =>
    Alert.alert('重新开始设置？', '这会清除本机保存的地点、家人信息和守护记录。', [
      { text: '取消', style: 'cancel' },
      { text: '清除并重新设置', style: 'destructive', onPress: () => void onResetLocalState() },
    ]);

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
      `将向第 1 位家人 ${firstContact.name}（${firstContact.phone}）发送一条测试短信。首次运行时，iOS 会要求一次发送权限。`,
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
                '请先安装“到家了么通知”快捷指令，然后再试一次。',
              );
            } finally {
              setTestNotificationPending(false);
            }
          },
        },
      ],
    );
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
                联系方式只在本机保存。主动测试时，App 会将第 1 位家人的手机号和通知内容交给系统快捷指令；后台异常不会自动打开它。
              </Text>
            </View>
            <FamilyScreen
              contacts={contacts}
              onAddContact={onAddContact}
              onInstallShortcut={() => void handleInstallShortcut()}
              onRemoveContact={onRemoveContact}
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
                <Text style={styles.permissionLabel}>守护地点</Text>
                <Text style={styles.permissionValue}>{syncLabel[geofenceSyncStatus]}</Text>
              </View>
            </View>

            <Text style={styles.settingHelpText}>
              自动守护需要“始终允许”和“精确位置”。允许“运动与健身”后，系统会结合步行、跑步和乘车迹象，降低家外停留误判。数据只用于本机守护。
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
              permissions?.motion === 'restricted') && (
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
      </>
    );
  }

  return (
    <>
      <Text style={styles.screenTitle}>我的</Text>

      <View style={[styles.guardianSettingCard, isGuardianPaused && styles.guardianSettingPaused]}>
        <View style={styles.guardianSettingHeader}>
          <View style={styles.flexItem}>
            <Text style={styles.guardianSettingLabel}>自动守护</Text>
            <Text style={styles.guardianSettingTitle}>
              {isGuardianPaused
                ? '已暂停'
                : isGuardianOn
                  ? '正在后台守护'
                  : geofenceCount === 0
                    ? '添加地点后自动开始'
                    : '正在准备'}
            </Text>
          </View>
          <View
            style={[
              styles.guardianStatusDot,
              isGuardianPaused && styles.guardianStatusDotPaused,
            ]}
          />
        </View>
        <Text style={styles.guardianSettingDetail}>{guardianStatus}</Text>
      </View>

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
          label="系统权限"
          onPress={() => setActiveSection('permissions')}
          value={
            permissions?.location === 'always' &&
            permissions.locationAccuracy === 'full' &&
            permissions.motion === 'authorized'
              ? '已就绪'
              : permissions
                ? permissionLabel[permissions.location]
                : '正在读取'
          }
        />
        <SettingsRow
          label="足迹"
          onPress={() => setActiveSection('footprints')}
          value={footprintCount > 0 ? `${footprintCount} 条` : '暂无记录'}
        />
      </View>

      {isGuardianPaused ? (
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={guardianBusy}
          onPress={() => void onResumeGuardian()}
          style={[styles.primaryButton, guardianBusy && styles.secondaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>{guardianBusy ? '正在恢复…' : '恢复自动守护'}</Text>
        </TouchableOpacity>
      ) : isGuardianOn ? (
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={guardianBusy}
          onPress={confirmPause}
          style={styles.quietButton}
        >
          <Text style={styles.quietButtonText}>暂停自动守护</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.aboutCard}>
        <Text style={styles.aboutTitle}>到家了么</Text>
        <Text style={styles.aboutText}>在后台安静守护，只在需要时提醒。</Text>
      </View>

      <TouchableOpacity activeOpacity={0.8} onPress={confirmReset} style={styles.resetLink}>
        <Text style={styles.resetLinkText}>重新开始设置</Text>
      </TouchableOpacity>
    </>
  );
}
