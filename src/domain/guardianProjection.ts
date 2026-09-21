import type { GuardianEvent, GuardianIncident } from './types';

const riskTypes = new Set(['LONG_STAY', 'LOW_BATTERY', 'LOCATION_LOST', 'NO_MOTION_FOR_LONG_TIME']);
const safetyTypes = new Set([
  'RETURN_HOME',
  'MOTION_DETECTED',
  'USER_CONFIRMED_SAFE',
  'LEAVE_HOME',
  'ENTER_WORK_AREA',
  'ENTER_WAYPOINT',
  'EXIT_WORK_AREA',
  'EXIT_WAYPOINT',
]);
const notificationTypes = new Set([
  'SAFETY_CHECK_REQUESTED',
  'FAMILY_NOTIFIED',
  'FAMILY_NOTIFICATION_FAILED',
  'FAMILY_ACKNOWLEDGED',
  'ESCALATION_FINISHED',
]);

export function orderGuardianEvents(events: GuardianEvent[]): GuardianEvent[] {
  const unique = new Map<string, GuardianEvent>();
  for (const event of events) {
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function projectGuardianEvents(input: GuardianEvent[], now = Date.now()) {
  const events = orderGuardianEvents(input);
  let incident: GuardianIncident | undefined;
  let lastSafeEvent: GuardianEvent | undefined;
  let batteryLevel: number | undefined;
  let locationLabel = '位置未知';

  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (!Number.isFinite(time) || time > now + 30_000) continue;
    if (event.batteryLevel !== undefined && event.batteryLevel >= 0 && event.batteryLevel <= 100)
      batteryLevel = event.batteryLevel;
    if (event.locationLabel) locationLabel = event.locationLabel;
    else if (event.type === 'RETURN_HOME') locationLabel = '家附近';
    else if (event.location) locationLabel = '守护地点外';

    if (safetyTypes.has(event.type)) lastSafeEvent = event;
    if (event.type === 'USER_CONFIRMED_SAFE') {
      incident = undefined;
      continue;
    }
    if (event.type === 'SOS_SENT' || event.type === 'RISK_ESCALATED' || riskTypes.has(event.type)) {
      if (!incident || (event.type === 'SOS_SENT' && incident.kind !== 'sos')) {
        incident = {
          id: event.incidentId ?? event.id,
          trigger: event,
          kind: event.type === 'SOS_SENT' ? 'sos' : 'passive',
          severity: 'attention',
          risks: [],
          notifiedContactIds: [],
          completed: false,
        };
      }
      if (event.type === 'SOS_SENT') {
        incident.kind = 'sos';
        incident.trigger = event;
        incident.acknowledgedBy = undefined;
      }
      if (event.type === 'SOS_SENT' || event.type === 'RISK_ESCALATED')
        incident.severity = 'emergency';
      if (riskTypes.has(event.type))
        incident.risks = [...incident.risks.filter((risk) => risk.type !== event.type), event];
      continue;
    }
    if (!incident) continue;

    // Late delivery records cannot advance another incident.
    if (notificationTypes.has(event.type)) {
      if (event.incidentId !== incident.id) continue;
      switch (event.type) {
        case 'SAFETY_CHECK_REQUESTED':
          incident.selfPromptAt ??= event.timestamp;
          break;
        case 'FAMILY_NOTIFIED':
          if (event.contactId && !incident.notifiedContactIds.includes(event.contactId)) {
            incident.notifiedContactIds.push(event.contactId);
            incident.lastNotificationAt = event.timestamp;
            incident.severity = 'emergency';
          }
          break;
        case 'FAMILY_ACKNOWLEDGED':
          if (event.contactId && incident.notifiedContactIds.includes(event.contactId))
            incident.acknowledgedBy = event.contactId;
          break;
        case 'ESCALATION_FINISHED':
          incident.completed = true;
          break;
      }
      continue;
    }
    // Passive signals resolve only related risks. SOS needs explicit confirmation.
    if (incident.kind === 'sos') continue;
    if (event.type === 'RETURN_HOME') {
      incident = undefined;
      continue;
    }
    const resolved = new Set<string>();
    if (event.type === 'MOTION_DETECTED') {
      resolved.add('LONG_STAY');
      resolved.add('NO_MOTION_FOR_LONG_TIME');
    }
    if (
      event.type === 'LOCATION_UPDATED' ||
      (event.type === 'MOTION_DETECTED' && event.source === 'location')
    )
      resolved.add('LOCATION_LOST');
    if (event.batteryLevel !== undefined && event.batteryLevel >= 20) resolved.add('LOW_BATTERY');
    if (resolved.size) {
      incident.risks = incident.risks.filter((risk) => !resolved.has(risk.type));
      if (!incident.risks.length && riskTypes.has(incident.trigger.type)) incident = undefined;
    }
  }
  return { events, incident, lastSafeEvent, batteryLevel, locationLabel };
}
