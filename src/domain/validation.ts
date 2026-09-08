import type { GeoPoint, GuardianConfig, GuardianEvent, GuardianEventType } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const numberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
export const isClockTime = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
export const normalizePhone = (value: string) =>
  value.replace(/[ ()-]/g, '').replace(/^\+86(?=1\d{10}$)/, '');
export const isPhone = (value: string) => /^\+?[1-9]\d{6,14}$/.test(normalizePhone(value));

export function parsePoint(value: unknown): GeoPoint {
  check(
    isRecord(value) && numberIn(value.latitude, -90, 90) && numberIn(value.longitude, -180, 180),
    '经纬度格式无效。',
  );
  check(value.accuracy === undefined || numberIn(value.accuracy, 0, 100_000), '定位精度无效。');
  return value as unknown as GeoPoint;
}

export function parseGuardianConfig(value: unknown): GuardianConfig {
  check(isRecord(value), '配置格式无效。');
  check(Array.isArray(value.geofences) && value.geofences.length <= 20, '最多支持 20 个守护地点。');
  check(Array.isArray(value.contacts) && value.contacts.length <= 3, '最多支持 3 位家人。');
  const ids = new Set<string>();
  for (const fence of value.geofences) {
    check(isRecord(fence) && text(fence.id) && text(fence.name), '地点名称或标识无效。');
    check(!ids.has(fence.id), '地点标识重复。');
    ids.add(fence.id);
    check(['home', 'work', 'waypoint'].includes(String(fence.kind)), '地点类型无效。');
    check(numberIn(fence.radiusMeters, 100, 1000), '围栏半径应在 100 至 1000 米之间。');
    parsePoint(fence.center);
  }
  ids.clear();
  const phones = new Set<string>();
  const priorities = new Set<number>();
  for (const contact of value.contacts) {
    check(
      isRecord(contact) &&
        text(contact.id) &&
        text(contact.name) &&
        text(contact.relation) &&
        text(contact.phone),
      '家人信息不完整。',
    );
    check(isPhone(contact.phone), '请输入有效的联系电话。');
    check(
      !ids.has(contact.id) && !phones.has(normalizePhone(contact.phone)),
      '家人或联系电话重复。',
    );
    check(
      numberIn(contact.priority, 1, 3) &&
        Number.isInteger(contact.priority) &&
        !priorities.has(contact.priority),
      '通知顺序无效。',
    );
    ids.add(contact.id);
    phones.add(normalizePhone(contact.phone));
    priorities.add(contact.priority);
  }
  const schedule = value.schedule;
  check(
    isRecord(schedule) &&
      isClockTime(schedule.startTime) &&
      isClockTime(schedule.expectedReturnTime),
    '时间格式应为 HH:mm。',
  );
  check(schedule.startTime < schedule.expectedReturnTime, '预计回家时间应晚于开始守护时间。');
  check(
    numberIn(schedule.noMotionThresholdMinutes, 30, 240) &&
      Number.isInteger(schedule.noMotionThresholdMinutes),
    '停留阈值应在 30 至 240 分钟之间。',
  );
  check(
    numberIn(schedule.escalationDelayMinutes, 5, 60) &&
      Number.isInteger(schedule.escalationDelayMinutes),
    '升级等待应在 5 至 60 分钟之间。',
  );
  return JSON.parse(JSON.stringify(value)) as GuardianConfig;
}

const eventTypes: GuardianEventType[] = [
  'LEAVE_HOME',
  'ENTER_WORK_AREA',
  'EXIT_WORK_AREA',
  'RETURN_HOME',
  'LONG_STAY',
  'LOW_BATTERY',
  'LOCATION_LOST',
  'LOCATION_UPDATED',
  'ENTER_WAYPOINT',
  'EXIT_WAYPOINT',
  'MOTION_DETECTED',
  'NO_MOTION_FOR_LONG_TIME',
  'SAFETY_CHECK_REQUESTED',
  'FAMILY_NOTIFIED',
  'FAMILY_NOTIFICATION_FAILED',
  'FAMILY_ACKNOWLEDGED',
  'ESCALATION_FINISHED',
  'USER_CONFIRMED_SAFE',
  'SOS_SENT',
  'RISK_ESCALATED',
];
export function parseGuardianEvent(value: unknown): GuardianEvent {
  check(
    isRecord(value) && text(value.id) && text(value.title) && text(value.description),
    '事件信息不完整。',
  );
  check(eventTypes.includes(value.type as GuardianEventType), '事件类型无效。');
  check(
    ['geofence', 'location', 'motion', 'battery', 'notification', 'user'].includes(
      String(value.source),
    ),
    '事件来源无效。',
  );
  check(isTimestamp(value.timestamp), '事件缺少完整日期。');
  check(value.receivedAt === undefined || isTimestamp(value.receivedAt), '事件接收时间无效。');
  check(
    value.batteryLevel === undefined || numberIn(value.batteryLevel, 0, 100),
    '电量应在 0 至 100 之间。',
  );
  if (value.location !== undefined) parsePoint(value.location);
  for (const key of ['incidentId', 'contactId', 'geofenceId', 'locationLabel'])
    check(value[key] === undefined || text(value[key]), '事件标识无效。');
  check(value.simulated === undefined || typeof value.simulated === 'boolean', '演练标识无效。');
  return {
    ...value,
    timestamp: new Date(value.timestamp).toISOString(),
  } as unknown as GuardianEvent;
}
