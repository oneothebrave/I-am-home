import { projectGuardianEvents } from './guardianProjection';
import { formatEventTime } from '../utils/time';
import type { GuardianEvent, GuardianStatusSnapshot } from './types';

export function buildGuardianSnapshot(
  events: GuardianEvent[],
  { now = Date.now(), maxSafeAgeMinutes = 120 }: { now?: number; maxSafeAgeMinutes?: number } = {},
): GuardianStatusSnapshot {
  const projection = projectGuardianEvents(events, now);
  const { incident, lastSafeEvent } = projection;
  const isFresh =
    lastSafeEvent && now - Date.parse(lastSafeEvent.timestamp) <= maxSafeAgeMinutes * 60_000;
  const status = incident?.severity ?? (isFresh ? 'safe' : 'unknown');
  const riskReason = incident
    ? incident.kind === 'sos'
      ? incident.trigger.description
      : incident.risks.map((event) => event.description).join('；') || incident.trigger.description
    : '当前没有未解除的告警。';
  const headline = incident
    ? incident.kind === 'sos'
      ? '求助尚未解除'
      : incident.severity === 'emergency'
        ? '需要家人确认'
        : '检测到异常'
    : isFresh
      ? lastSafeEvent.type === 'RETURN_HOME'
        ? '已经到家'
        : '最近有平安信号'
      : '暂时无法确认';
  return {
    status,
    headline,
    detail: incident
      ? riskReason
      : isFresh
        ? lastSafeEvent.description
        : '尚无近期可信信号，建议家人主动联系。',
    lastSafeSignal: lastSafeEvent
      ? `${formatEventTime(lastSafeEvent.timestamp, now)} ${lastSafeEvent.title}`
      : '暂无可信信号',
    locationLabel: projection.locationLabel,
    batteryLevel: projection.batteryLevel,
    riskReason,
    incident,
    events: projection.events,
  };
}
