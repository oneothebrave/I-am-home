import type { GuardianEvent, GuardianStatusSnapshot } from './types';

const SAFETY_EVENT_TYPES = ['RETURN_HOME', 'MOTION_DETECTED', 'USER_CONFIRMED_SAFE'] as const;
const RISK_EVENT_TYPES = ['LONG_STAY', 'LOW_BATTERY', 'LOCATION_LOST', 'NO_MOTION_FOR_LONG_TIME'] as const;
const SELF_PROMPT_EVENT_TYPES = ['SAFETY_CHECK_REQUESTED'] as const;
const EMERGENCY_EVENT_TYPES = ['SOS_SENT', 'RISK_ESCALATED', 'FAMILY_NOTIFIED', 'ESCALATION_FINISHED'] as const;

export function buildGuardianSnapshot(
  baseSnapshot: GuardianStatusSnapshot,
  events: GuardianEvent[],
): GuardianStatusSnapshot {
  const latestEvent = getLatestEvent(events);
  const latestSafetyEvent = findLatestEvent(events, SAFETY_EVENT_TYPES);
  const latestRiskEvent = findLatestEvent(events, RISK_EVENT_TYPES);
  const latestSelfPromptEvent = findLatestEvent(events, SELF_PROMPT_EVENT_TYPES);
  const latestEmergencyEvent = findLatestEvent(events, EMERGENCY_EVENT_TYPES);

  if (latestEmergencyEvent && latestEmergencyEvent === latestEvent) {
    return {
      ...baseSnapshot,
      status: 'emergency',
      headline: getEmergencyHeadline(latestEmergencyEvent),
      detail: latestEmergencyEvent.description,
      lastSafeSignal: formatLastSafeSignal(latestSafetyEvent, baseSnapshot.lastSafeSignal),
      locationLabel: resolveLocationLabel(baseSnapshot, latestEvent),
      batteryLevel: resolveBatteryLevel(baseSnapshot, latestEvent),
      events,
    };
  }

  if (latestSafetyEvent && latestSafetyEvent === latestEvent) {
    return {
      ...baseSnapshot,
      status: 'safe',
      headline: getSafetyHeadline(latestSafetyEvent),
      detail: latestSafetyEvent.description,
      lastSafeSignal: formatLastSafeSignal(latestSafetyEvent, baseSnapshot.lastSafeSignal),
      locationLabel: resolveLocationLabel(baseSnapshot, latestEvent),
      batteryLevel: resolveBatteryLevel(baseSnapshot, latestEvent),
      events,
    };
  }

  if (latestRiskEvent && latestRiskEvent === latestEvent) {
    return {
      ...baseSnapshot,
      status: 'attention',
      headline: getRiskHeadline(latestRiskEvent),
      detail: latestRiskEvent.description,
      lastSafeSignal: formatLastSafeSignal(latestSafetyEvent, baseSnapshot.lastSafeSignal),
      locationLabel: resolveLocationLabel(baseSnapshot, latestEvent),
      batteryLevel: resolveBatteryLevel(baseSnapshot, latestEvent),
      events,
    };
  }

  if (latestSelfPromptEvent && latestSelfPromptEvent === latestEvent) {
    return {
      ...baseSnapshot,
      status: 'attention',
      headline: '等待本人确认',
      detail: latestSelfPromptEvent.description,
      lastSafeSignal: formatLastSafeSignal(latestSafetyEvent, baseSnapshot.lastSafeSignal),
      locationLabel: resolveLocationLabel(baseSnapshot, latestEvent),
      batteryLevel: resolveBatteryLevel(baseSnapshot, latestEvent),
      events,
    };
  }

  return {
    ...baseSnapshot,
    status: 'safe',
    headline: '今天看起来正常',
    detail: latestEvent?.description ?? '暂时没有发现需要关注的风险信号。',
    lastSafeSignal: formatLastSafeSignal(latestSafetyEvent, baseSnapshot.lastSafeSignal),
    locationLabel: resolveLocationLabel(baseSnapshot, latestEvent),
    batteryLevel: resolveBatteryLevel(baseSnapshot, latestEvent),
    events,
  };
}

function getLatestEvent(events: GuardianEvent[]) {
  return events.at(-1);
}

function findLatestEvent<T extends readonly GuardianEvent['type'][]>(
  events: GuardianEvent[],
  types: T,
) {
  return [...events].reverse().find(event => types.includes(event.type));
}

function formatLastSafeSignal(event: GuardianEvent | undefined, fallback: string) {
  if (!event) {
    return fallback;
  }

  return `今天 ${event.timestamp} ${event.title}`;
}

function getSafetyHeadline(event: GuardianEvent) {
  switch (event.type) {
    case 'RETURN_HOME':
      return '已经到家';
    case 'USER_CONFIRMED_SAFE':
      return '已经报平安';
    default:
      return '看起来正常';
  }
}

function getRiskHeadline(event: GuardianEvent) {
  switch (event.type) {
    case 'LOCATION_LOST':
      return '需要确认';
    case 'LOW_BATTERY':
      return '电量偏低';
    case 'NO_MOTION_FOR_LONG_TIME':
    case 'LONG_STAY':
      return '需要留意';
    default:
      return '出现关注信号';
  }
}

function getEmergencyHeadline(event: GuardianEvent) {
  return event.type === 'SOS_SENT' ? '正在求助' : '已通知家人';
}

function resolveLocationLabel(baseSnapshot: GuardianStatusSnapshot, latestEvent?: GuardianEvent) {
  if (!latestEvent) {
    return baseSnapshot.locationLabel;
  }

  switch (latestEvent.type) {
    case 'RETURN_HOME':
      return '家附近';
    case 'LOCATION_LOST':
      return '最后在果园附近';
    default:
      return baseSnapshot.locationLabel;
  }
}

function resolveBatteryLevel(baseSnapshot: GuardianStatusSnapshot, latestEvent?: GuardianEvent) {
  return latestEvent?.batteryLevel ?? baseSnapshot.batteryLevel;
}
