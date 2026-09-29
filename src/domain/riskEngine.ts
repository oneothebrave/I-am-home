import { projectGuardianEvents } from './guardianProjection';
import { formatEventTime } from '../utils/time';
import type { GuardianEvent, GuardianStatusSnapshot } from './types';

export function buildGuardianSnapshot(
  events: GuardianEvent[],
  { now = Date.now(), maxSafeAgeMinutes = 120 }: { now?: number; maxSafeAgeMinutes?: number } = {},
): GuardianStatusSnapshot {
  const projection = projectGuardianEvents(events, now);
  const { incident, lastSafeEvent } = projection;
  const clockUncertain = !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime()) ||
    projection.events.some((event) => Date.parse(event.timestamp) > now + 5_000);
  const isFresh =
    !clockUncertain && lastSafeEvent && now >= Date.parse(lastSafeEvent.timestamp) &&
    now - Date.parse(lastSafeEvent.timestamp) <= maxSafeAgeMinutes * 60_000;
  const status = incident?.severity ?? (isFresh ? 'safe' : 'unknown');
  const riskReason = incident
    ? incident.kind === 'sos'
      ? incident.trigger.description
      : incident.risks.map((event) => event.description).join('；') || incident.trigger.description
    : clockUncertain ? '记录时间晚于手机当前时间，暂时无法确认告警状态。' : '当前没有未解除的告警。';
  const headline = incident
    ? incident.kind === 'sos'
      ? '求助尚未解除'
      : incident.severity === 'emergency'
        ? '需要家人确认'
        : '检测到异常'
    : isFresh
      ? lastSafeEvent.type === 'RETURN_HOME'
        ? '已经到家'
        : '状态正常'
      : '暂时无法确认';
  return {
    status,
    clockUncertain,
    headline,
    detail: incident
      ? riskReason
      : isFresh
        ? lastSafeEvent.description
        : '暂时没有可用的位置或活动记录。',
    lastSafeSignal: lastSafeEvent
      ? `${formatEventTime(lastSafeEvent.timestamp, now)} ${lastSafeEvent.title}`
      : '暂无记录',
    locationLabel: projection.locationLabel,
    batteryLevel: projection.batteryLevel,
    riskReason,
    incident,
    events: projection.events,
  };
}
