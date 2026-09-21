import React, { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { GuardianGeofence } from '../domain/types';
import type { CurrentLocationSample } from '../domain/validation';
import type { GeofenceSyncStatus } from '../native/guardianGeofenceSync';
import { styles } from '../styles/appStyles';

export type NewCurrentLocationPlace = Pick<GuardianGeofence, 'name' | 'kind' | 'radiusMeters'>;

const radiusOptions = [150, 300, 500] as const;
const placeOptions: Array<{
  kind: GuardianGeofence['kind'];
  label: string;
  defaultRadius: (typeof radiusOptions)[number];
}> = [
  { kind: 'home', label: '家', defaultRadius: 150 },
  { kind: 'work', label: '农场', defaultRadius: 500 },
];

const syncCopy: Record<GeofenceSyncStatus, string> = {
  idle: '正在准备',
  syncing: '正在同步',
  synced: '守护正常',
  error: '需要处理',
};

export function PlacesScreen({
  geofences,
  geofenceSyncStatus,
  isGuardianOn,
  isGuardianPaused,
  mode,
  onActivateDeviceMode,
  onAdjustRadius,
  onGetCurrentLocation,
  onOpenSettings,
  onRemoveGeofence,
  onRetryGeofenceSync,
  onSaveCurrentLocation,
}: {
  geofences: GuardianGeofence[];
  geofenceSyncStatus: GeofenceSyncStatus;
  isGuardianOn: boolean;
  isGuardianPaused: boolean;
  mode: 'demo' | 'device';
  onActivateDeviceMode: () => void;
  onAdjustRadius: (id: string, radiusMeters: number) => void;
  onGetCurrentLocation: () => Promise<CurrentLocationSample>;
  onOpenSettings: () => void;
  onRemoveGeofence: (id: string) => void;
  onRetryGeofenceSync: () => Promise<void>;
  onSaveCurrentLocation: (
    place: NewCurrentLocationPlace,
    sample: CurrentLocationSample,
  ) => Promise<void>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'locating' | 'ready' | 'saving'>(
    'idle',
  );
  const [sample, setSample] = useState<CurrentLocationSample>();
  const [placeKind, setPlaceKind] = useState<GuardianGeofence['kind']>('home');
  const [placeName, setPlaceName] = useState('家');
  const [customName, setCustomName] = useState('');
  const [radiusMeters, setRadiusMeters] = useState<(typeof radiusOptions)[number]>(150);
  const [isCustomName, setIsCustomName] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [managedPlaceId, setManagedPlaceId] = useState<string>();
  const guardianActive = isGuardianOn && !isGuardianPaused;
  const placeStatus = isGuardianPaused
    ? '已暂停'
    : geofenceSyncStatus === 'synced' && !isGuardianOn
      ? '正在准备'
      : syncCopy[geofenceSyncStatus];

  const resetForm = () => {
    setIsAdding(false);
    setLocationStatus('idle');
    setSample(undefined);
    setPlaceKind('home');
    setPlaceName('家');
    setCustomName('');
    setRadiusMeters(150);
    setIsCustomName(false);
    setError('');
  };

  const acquireLocation = async () => {
    setIsAdding(true);
    setLocationStatus('locating');
    setMessage('');
    setError('');
    try {
      const nextSample = await onGetCurrentLocation();
      setSample(nextSample);
      setLocationStatus('ready');
    } catch (locationError) {
      setLocationStatus('idle');
      setError(locationError instanceof Error ? locationError.message : '无法获取当前位置，请重试。');
    }
  };

  const beginAdding = () => {
    if (mode === 'demo') {
      Alert.alert(
        '开始使用真实位置？',
        '演示地点和演示记录会被清除，之后将使用这台手机的真实位置。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '继续',
            onPress: () => {
              onActivateDeviceMode();
              void acquireLocation();
            },
          },
        ],
      );
      return;
    }
    void acquireLocation();
  };

  const choosePlace = (option: (typeof placeOptions)[number]) => {
    setPlaceKind(option.kind);
    setPlaceName(option.label);
    setRadiusMeters(option.defaultRadius);
    setIsCustomName(false);
    setError('');
  };

  const savePlace = async () => {
    const name = (isCustomName ? customName : placeName).trim();
    if (!sample || !name || geofences.length >= 20) return;
    setLocationStatus('saving');
    setError('');
    try {
      await onSaveCurrentLocation({ name, kind: placeKind, radiusMeters }, sample);
      resetForm();
      setMessage(`${name}已添加，周围 ${radiusMeters} 米将自动守护。`);
    } catch (saveError) {
      setLocationStatus('ready');
      setError(saveError instanceof Error ? saveError.message : '保存失败，请重试。');
    }
  };

  const confirmRemove = (geofence: GuardianGeofence) =>
    Alert.alert('删除这个地点？', `删除“${geofence.name}”后，这个区域将不再被守护。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => onRemoveGeofence(geofence.id) },
    ]);

  return (
    <>
      {geofences.length > 0 ? (
        <>
          <View style={styles.placeSummaryCard}>
            <Text style={styles.placeSummaryEyebrow}>守护地点</Text>
            <Text style={styles.placeSummaryTitle}>
              {guardianActive
                ? `已守护 ${geofences.length} 个地点`
                : `已设置 ${geofences.length} 个地点`}
            </Text>
            <Text style={styles.placeSummaryText}>
              {isGuardianPaused
                ? '自动守护已暂停，可在“我的”中恢复。'
                : '到达或离开这些区域时，会在后台自动记录。'}
            </Text>
          </View>

          <View style={styles.placeList}>
            {geofences.map((geofence) => {
              const isManaging = managedPlaceId === geofence.id;
              return (
                <View style={styles.placeCard} key={geofence.id}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.75}
                    onPress={() => setManagedPlaceId(isManaging ? undefined : geofence.id)}
                    style={styles.placeCardMain}
                  >
                    <View style={styles.placeIcon}>
                      <Text style={styles.placeIconText}>
                        {geofence.kind === 'home' ? '家' : geofence.kind === 'work' ? '农' : '常'}
                      </Text>
                    </View>
                    <View style={styles.flexItem}>
                      <Text style={styles.rowTitle}>{geofence.name}</Text>
                      <Text style={styles.rowMeta}>周围 {geofence.radiusMeters} 米</Text>
                    </View>
                    <View
                      style={[
                        styles.guardianBadge,
                        geofenceSyncStatus === 'error' && styles.guardianBadgeWarning,
                        isGuardianPaused && styles.guardianBadgePaused,
                      ]}
                    >
                      <Text
                        style={[
                          styles.guardianBadgeText,
                          geofenceSyncStatus === 'error' && styles.guardianBadgeWarningText,
                          isGuardianPaused && styles.guardianBadgePausedText,
                        ]}
                      >
                        {placeStatus}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {isManaging && (
                    <View style={styles.placeManagePanel}>
                      <Text style={styles.formLabel}>守护范围</Text>
                      <View style={styles.choiceRow}>
                        {radiusOptions.map((radius) => (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            key={radius}
                            onPress={() => onAdjustRadius(geofence.id, radius)}
                            style={[
                              styles.choiceButton,
                              geofence.radiusMeters === radius && styles.choiceButtonActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.choiceButtonText,
                                geofence.radiusMeters === radius && styles.choiceButtonTextActive,
                              ]}
                            >
                              {radius} 米
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => confirmRemove(geofence)}
                        style={styles.textDangerButton}
                      >
                        <Text style={styles.textDangerButtonText}>删除这个地点</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {geofenceSyncStatus === 'error' && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => void onRetryGeofenceSync()}
              style={styles.inlineNoticeButton}
            >
              <Text style={styles.inlineNoticeTitle}>地点同步失败</Text>
              <Text style={styles.inlineNoticeText}>点这里重试</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <View style={styles.placeEmptyCard}>
          <View style={styles.emptyPlaceIcon}>
            <Text style={styles.emptyPlaceIconText}>⌖</Text>
          </View>
          <Text style={styles.emptyStateTitle}>还没有守护地点</Text>
          <Text style={styles.emptyStateText}>请站在想要守护的位置，然后点击下方按钮。</Text>
          <View style={styles.setupSteps}>
            {['获取当前位置', '选择守护范围', '保存后自动守护'].map((label, index) => (
              <View style={styles.setupStep} key={label}>
                <View style={styles.setupStepNumber}>
                  <Text style={styles.setupStepNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.setupStepText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!!message && <Text style={styles.successText}>{message}</Text>}

      {!isAdding ? (
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={geofences.length >= 20}
          onPress={beginAdding}
          style={[styles.primaryButton, geofences.length >= 20 && styles.secondaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>
            {geofences.length >= 20 ? '已达到地点上限' : '添加守护地点'}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.addPlaceCard}>
          <View style={styles.addPlaceHeader}>
            <Text style={styles.addPlaceTitle}>添加守护地点</Text>
            <TouchableOpacity activeOpacity={0.8} onPress={resetForm}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </View>

          {locationStatus === 'locating' && (
            <View style={styles.locatingCard}>
              <Text style={styles.locatingTitle}>正在获取当前位置…</Text>
              <Text style={styles.locatingText}>请在当前位置稍等片刻。</Text>
            </View>
          )}

          {!!error && (
            <View style={styles.formErrorCard}>
              <Text accessibilityRole="alert" style={styles.errorText}>
                {error}
              </Text>
              {locationStatus === 'idle' && (
                <View style={styles.errorActions}>
                  <TouchableOpacity activeOpacity={0.8} onPress={() => void acquireLocation()}>
                    <Text style={styles.linkText}>重新获取</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.8} onPress={onOpenSettings}>
                    <Text style={styles.linkText}>检查定位权限</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {!!sample && (
            <>
              <View style={styles.locationSuccessCard}>
                <Text style={styles.locationSuccessMark}>✓</Text>
                <View style={styles.flexItem}>
                  <Text style={styles.locationSuccessTitle}>位置已获取</Text>
                  <Text style={styles.locationSuccessText}>
                    精度约 {Math.round(sample.accuracy)} 米
                  </Text>
                </View>
              </View>

              <Text style={styles.formLabel}>这是哪里？</Text>
              <View style={styles.choiceRowWrap}>
                {placeOptions.map((option) => (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    key={option.label}
                    onPress={() => choosePlace(option)}
                    style={[
                      styles.choiceButton,
                      !isCustomName && placeName === option.label && styles.choiceButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceButtonText,
                        !isCustomName &&
                          placeName === option.label &&
                          styles.choiceButtonTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    setIsCustomName(true);
                    setPlaceKind('waypoint');
                  }}
                  style={[styles.choiceButton, isCustomName && styles.choiceButtonActive]}
                >
                  <Text
                    style={[styles.choiceButtonText, isCustomName && styles.choiceButtonTextActive]}
                  >
                    自定义
                  </Text>
                </TouchableOpacity>
              </View>
              {isCustomName && (
                <TextInput
                  accessibilityLabel="地点名称"
                  maxLength={20}
                  onChangeText={setCustomName}
                  placeholder="输入地点名称"
                  placeholderTextColor="#9A9387"
                  style={styles.input}
                  value={customName}
                />
              )}

              <Text style={styles.formLabel}>守护范围</Text>
              <View style={styles.choiceRow}>
                {radiusOptions.map((radius) => (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    key={radius}
                    onPress={() => setRadiusMeters(radius)}
                    style={[
                      styles.choiceButton,
                      radiusMeters === radius && styles.choiceButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceButtonText,
                        radiusMeters === radius && styles.choiceButtonTextActive,
                      ]}
                    >
                      {radius} 米
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fieldHelpText}>
                围栏需要容纳定位误差：家建议 150 米，农场等户外区域建议 500 米。
              </Text>

              <TouchableOpacity
                activeOpacity={0.8}
                disabled={locationStatus === 'saving' || (isCustomName && !customName.trim())}
                onPress={() => void savePlace()}
                style={[
                  styles.primaryButton,
                  (locationStatus === 'saving' || (isCustomName && !customName.trim())) &&
                    styles.secondaryButtonDisabled,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {locationStatus === 'saving' ? '正在保存…' : '保存并开始守护'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {geofences.length > 0 && !isAdding && (
        <Text style={styles.pageFootnote}>站在新地点附近，即可继续添加。无需查看地图。</Text>
      )}
    </>
  );
}
