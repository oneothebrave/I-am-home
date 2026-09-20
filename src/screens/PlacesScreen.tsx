import React, { useState } from 'react';
import { Alert, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { InfoLine, Section } from '../components/Primitives';
import { getGeofenceKindLabel } from '../domain/geofenceHelpers';
import type { GuardianGeofence } from '../domain/types';
import type { CurrentLocationSample } from '../domain/validation';
import type { PermissionState } from '../native/GuardianNative';
import type { GeofenceSyncStatus } from '../native/guardianGeofenceSync';
import { styles } from '../styles/appStyles';
import { clamp } from '../utils/number';

export type NewCurrentLocationPlace = Pick<GuardianGeofence, 'name' | 'kind' | 'radiusMeters'>;

const permissionLabel: Record<PermissionState['location'], string> = {
  notDetermined: '尚未询问',
  denied: '已拒绝',
  restricted: '受系统限制',
  whenInUse: '使用 App 时允许',
  always: '始终允许',
};

const accuracyLabel: Record<PermissionState['locationAccuracy'], string> = {
  unknown: '未知',
  reduced: '大致位置（围栏不可用）',
  full: '精确位置',
};

const syncLabel: Record<GeofenceSyncStatus, string> = {
  idle: '等待设备模式',
  syncing: '正在同步到原生围栏',
  synced: '已同步到原生围栏',
  error: '同步失败，请重试',
};

export function PlacesScreen({
  geofences,
  geofenceSyncStatus,
  guardianStatus,
  mode,
  permissions,
  onActivateDeviceMode,
  onAdjustRadius,
  onCaptureCurrentLocation,
  onRefreshPermissions,
  onRemoveGeofence,
  onRequestPermissions,
  onRetryGeofenceSync,
}: {
  geofences: GuardianGeofence[];
  geofenceSyncStatus: GeofenceSyncStatus;
  guardianStatus: string;
  mode: 'demo' | 'device';
  permissions?: PermissionState;
  onActivateDeviceMode: () => void;
  onAdjustRadius: (id: string, delta: number) => void;
  onCaptureCurrentLocation: (place: NewCurrentLocationPlace) => Promise<CurrentLocationSample>;
  onRefreshPermissions: () => Promise<void>;
  onRemoveGeofence: (id: string) => void;
  onRequestPermissions: () => Promise<void>;
  onRetryGeofenceSync: () => Promise<void>;
}) {
  const [newPlaceName, setNewPlaceName] = useState('菜地');
  const [newPlaceKind, setNewPlaceKind] = useState<GuardianGeofence['kind']>('work');
  const [newPlaceRadius, setNewPlaceRadius] = useState(320);
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'capturing'>('idle');
  const [captureMessage, setCaptureMessage] = useState('');
  const [captureError, setCaptureError] = useState('');

  const handleAddPlace = async () => {
    const name = newPlaceName.trim();

    if (!name || geofences.length >= 20) {
      return;
    }
    setCaptureStatus('capturing');
    setCaptureError('');
    setCaptureMessage('');
    try {
      const sample = await onCaptureCurrentLocation({
        name,
        kind: newPlaceKind,
        radiusMeters: newPlaceRadius,
      });
      setCaptureMessage(`采点成功，精度约 ${Math.round(sample.accuracy)} 米；围栏已同步。`);
      setNewPlaceName('');
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : '采点失败，请重试。');
    } finally {
      setCaptureStatus('idle');
    }
  };

  const canCapture =
    mode === 'device' &&
    !!permissions &&
    ['whenInUse', 'always'].includes(permissions.location) &&
    permissions.locationAccuracy === 'full' &&
    captureStatus !== 'capturing' &&
    !!newPlaceName.trim() &&
    geofences.length < 20;

  const confirmDeviceMode = () =>
    Alert.alert(
      '进入真实设备模式？',
      '演示地点、演示事件和演示联系人会被清除，之后新增地点只使用真实定位。',
      [
        { text: '取消', style: 'cancel' },
        { text: '清除并继续', style: 'destructive', onPress: onActivateDeviceMode },
      ],
    );

  return (
    <>
      <Section title="守护地点">
        {geofences.length === 0 && (
          <InfoLine label="尚无地点" value="请站在家或劳作地点附近，使用下方真实位置采点。" />
        )}
        {geofences.map((geofence) => (
          <View style={styles.placeRow} key={geofence.id}>
            <View style={styles.flexItem}>
              <Text style={styles.rowTitle}>{geofence.name}</Text>
              <Text style={styles.rowMeta}>
                {geofence.center.latitude.toFixed(4)}, {geofence.center.longitude.toFixed(4)} · 半径{' '}
                {geofence.radiusMeters} 米
              </Text>
            </View>
            <View style={styles.rowBadge}>
              <Text style={styles.rowBadgeText}>{getGeofenceKindLabel(geofence.kind)}</Text>
            </View>
            <View style={styles.inlineActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onAdjustRadius(geofence.id, -50)}
                style={styles.iconButton}
              >
                <Text style={styles.iconButtonText}>-</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onAdjustRadius(geofence.id, 50)}
                style={styles.iconButton}
              >
                <Text style={styles.iconButtonText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onRemoveGeofence(geofence.id)}
                style={styles.removeButton}
              >
                <Text style={styles.removeButtonText}>删</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </Section>

      {mode === 'demo' ? (
        <Section title="真实位置采点">
          <InfoLine
            label="当前仍是演示模式"
            value="演示坐标不会同步到原生围栏。进入真实设备模式后，会先清除全部演示数据。"
          />
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={confirmDeviceMode}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>清除演示数据并进入设备模式</Text>
          </TouchableOpacity>
        </Section>
      ) : (
        <>
          <Section title="定位权限与围栏同步">
            <InfoLine label="后台守护" value={guardianStatus} />
            <InfoLine
              label="定位权限"
              value={permissions ? permissionLabel[permissions.location] : '正在读取'}
            />
            <InfoLine
              label="位置精度"
              value={permissions ? accuracyLabel[permissions.locationAccuracy] : '正在读取'}
            />
            <InfoLine label="原生围栏" value={syncLabel[geofenceSyncStatus]} />
            {geofenceSyncStatus === 'error' && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void onRetryGeofenceSync()}
                style={styles.exerciseButton}
              >
                <Text style={styles.exerciseButtonText}>重试围栏同步</Text>
              </TouchableOpacity>
            )}
            <View style={styles.exerciseRow}>
              {(permissions?.location === 'notDetermined' ||
                permissions?.location === 'whenInUse') && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => void onRequestPermissions()}
                  style={styles.exerciseButton}
                >
                  <Text style={styles.exerciseButtonText}>
                    {permissions.location === 'whenInUse' ? '申请始终允许' : '申请定位权限'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void onRefreshPermissions()}
                style={styles.exerciseButton}
              >
                <Text style={styles.exerciseButtonText}>刷新权限</Text>
              </TouchableOpacity>
              {(permissions?.location === 'denied' ||
                permissions?.location === 'restricted' ||
                permissions?.location === 'whenInUse' ||
                permissions?.locationAccuracy === 'reduced') && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => void Linking.openSettings()}
                  style={styles.exerciseButton}
                >
                  <Text style={styles.exerciseButtonText}>打开系统设置</Text>
                </TouchableOpacity>
              )}
            </View>
          </Section>

          <Section title="使用当前位置新增地点">
            <TextInput
              onChangeText={setNewPlaceName}
              placeholder="地点名称"
              placeholderTextColor="#9A9387"
              style={styles.input}
              value={newPlaceName}
            />
            <View style={styles.segmentRow}>
              {(['home', 'work', 'waypoint'] as const).map((kind) => {
                const isActive = newPlaceKind === kind;
                return (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    key={kind}
                    onPress={() => setNewPlaceKind(kind)}
                    style={[styles.segmentButton, isActive && styles.segmentButtonActive]}
                  >
                    <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                      {getGeofenceKindLabel(kind)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.stepperRow}>
              <Text style={styles.stepperLabel}>围栏半径 {newPlaceRadius} 米</Text>
              <View style={styles.stepperActions}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setNewPlaceRadius((value) => clamp(value - 50, 100, 1000))}
                  style={styles.iconButton}
                >
                  <Text style={styles.iconButtonText}>-</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setNewPlaceRadius((value) => clamp(value + 50, 100, 1000))}
                  style={styles.iconButton}
                >
                  <Text style={styles.iconButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity
              disabled={!canCapture}
              activeOpacity={0.8}
              onPress={() => void handleAddPlace()}
              style={[styles.secondaryButton, !canCapture && styles.secondaryButtonDisabled]}
            >
              <Text style={styles.secondaryButtonText}>
                {geofences.length >= 20
                  ? '已达到 20 个地点上限'
                  : captureStatus === 'capturing'
                    ? '正在获取真实位置…'
                    : '获取当前位置并同步围栏'}
              </Text>
            </TouchableOpacity>
            {!!captureMessage && <Text style={styles.successText}>{captureMessage}</Text>}
            {!!captureError && (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {captureError}
              </Text>
            )}
          </Section>
        </>
      )}

      <Section title="采点方式">
        <InfoLine label="推荐" value="站在地点附近，使用当前位置设为家或劳作地点。" />
        <InfoLine label="半径建议" value="家 100-200 米，山地或果园 300-800 米。" />
        <InfoLine label="精度要求" value="只接受两分钟内、水平精度 100 米以内的真实定位。" />
      </Section>
    </>
  );
}
