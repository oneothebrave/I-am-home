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
  const firstContact = [...config.contacts].sort((a, b) => a.priority - b.priority)[0];
  const firstContactName = firstContact?.name ?? '第一位家人';
  const latestEvent = snapshot.events.at(-1);
  const latestTime = latestEvent?.timestamp ?? '刚刚';

  if (snapshot.status === 'safe') {
    return {
      selfTitle: '今天看起来正常',
      selfBody: `${snapshot.lastSafeSignal}，系统会继续安静守着。`,
      familyTitle: '亲人状态正常',
      familyBody: `${snapshot.locationLabel}，${snapshot.lastSafeSignal}。`,
      firstContactName,
    };
  }

  if (snapshot.status === 'emergency') {
    return {
      selfTitle: '正在通知家人',
      selfBody: '系统会按家人名单顺序发送提醒，也可以直接拨打电话联系。',
      familyTitle: '需要尽快确认亲人状态',
      familyBody: `${latestTime}，${snapshot.detail} 当前电量 ${snapshot.batteryLevel}%，位置：${snapshot.locationLabel}。`,
      firstContactName,
    };
  }

  return {
    selfTitle: '请确认是否安全',
    selfBody: `${snapshot.detail} 请点击“我没事”，避免家人担心。`,
    familyTitle: '亲人状态需要留意',
    familyBody: `${latestTime}，${snapshot.detail} 当前电量 ${snapshot.batteryLevel}%，最后位置：${snapshot.locationLabel}。`,
    firstContactName,
  };
}
