import React, { useState } from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import type { GuardianContact, GuardianEvent, GuardianSchedule } from '../domain/types';
import type { PermissionState } from '../native/GuardianNative';
import type { GeofenceSyncStatus } from '../native/guardianGeofenceSync';
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
  onRequestPermissions: () => Promise<void>;
  onResetLocalState: () => Promise<void>;
  onResumeGuardian: () => Promise<void>;
  onRetryGeofenceSync: () => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<MySection>();
  const footprintCount = getFootprintEvents(events).length;

  const sectionTitle =
    activeSection === 'family'
      ? '家人联系方式'
      : activeSection === 'schedule'
        ? '守护时间'
        : activeSection === 'permissions'
          ? '定位权限'
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
              <Text style={styles.noticeTitle}>家人通知尚未启用</Text>
              <Text style={styles.noticeText}>
                当前只会把联系方式保存在本机，不会自动发送短信或电话。
              </Text>
            </View>
            <FamilyScreen
              contacts={contacts}
              onAddContact={onAddContact}
              onRemoveContact={onRemoveContact}
              showNotificationPolicy={false}
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
              自动守护需要“始终允许”和“精确位置”。位置数据只用于本机守护。
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

            {(permissions?.location === 'denied' ||
              permissions?.location === 'restricted' ||
              permissions?.locationAccuracy === 'reduced') && (
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
          label="定位权限"
          onPress={() => setActiveSection('permissions')}
          value={permissions ? permissionLabel[permissions.location] : '正在读取'}
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
