import type { GuardianConfig, GuardianSchedule } from './types';
import type { PermissionState } from '../native/GuardianNative';

export function scheduleForMode(
  schedule: GuardianSchedule,
  monitoringMode: GuardianSchedule['monitoringMode'],
): GuardianSchedule {
  return {
    ...schedule,
    monitoringMode,
    // A one-minute test must never become a live threshold by merely changing a label.
    noMotionThresholdMinutes: monitoringMode === 'standard' &&
      schedule.noMotionThresholdMinutes < 15 ? 120 : schedule.noMotionThresholdMinutes,
    locationLostThresholdMinutes: monitoringMode === 'standard' &&
      schedule.locationLostThresholdMinutes < 15 ? 120 : schedule.locationLostThresholdMinutes,
  };
}

export function standardModeBlocker(
  config: GuardianConfig,
  permissions: PermissionState | undefined,
  geofencesSynced: boolean,
): string | undefined {
  if (!config.geofences.some((fence) => fence.kind === 'home'))
    return '请先添加真实的“家”地点。';
  if (config.contacts.length === 0) return '请先添加至少一位家人联系方式。';
  if (permissions?.location !== 'always') return '请先把定位权限设为“始终允许”。';
  if (permissions.locationAccuracy !== 'full') return '请先开启精确位置。';
  if (permissions.backgroundRefresh !== 'available') return '请先开启后台 App 刷新。';
  if (!geofencesSynced) return '请等待守护地点同步成功。';
  return undefined;
}
