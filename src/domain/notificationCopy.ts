import { formatEventTime } from '../utils/time';
import type { GuardianConfig, GuardianStatusSnapshot } from './types';

export interface NotificationPreview {
  selfTitle: string;
  selfBody: string;
  familyTitle: string;
  familyBody: string;
  firstContactName: string;
}

export function composeNotificationPreview(
  snapshot: GuardianStatusSnapshot,
  config: GuardianConfig,
): NotificationPreview {
  const incident = snapshot.incident;
  const contact = [...config.contacts]
    .sort((a, b) => a.priority - b.priority)
    .find((item) => !incident?.notifiedContactIds.includes(item.id));
  const firstContactName = contact?.name ?? '家人';
  const battery =
    snapshot.batteryLevel === undefined ? '电量未知' : `电量 ${snapshot.batteryLevel}%`;
  return {
    firstContactName,
    selfTitle: incident ? '请确认是否安全' : snapshot.headline,
    selfBody: incident ? snapshot.detail : snapshot.lastSafeSignal,
    familyTitle: incident
      ? '需要确认亲人状态'
      : snapshot.status === 'unknown'
        ? '亲人状态待确认'
        : '最近有平安信号',
    familyBody: `${incident ? formatEventTime(incident.trigger.timestamp) + '，' : ''}${snapshot.detail} 位置：${snapshot.locationLabel}，${battery}。`,
  };
}
