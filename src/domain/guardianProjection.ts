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
  // Only transitions that affect the current incident are exempt from history
  // retention. Routine GPS/motion callbacks must not grow an open episode forever.
  let incidentEvidence: GuardianEvent[] = [];
  let lastSafeEvent: GuardianEvent | undefined;
  let batteryLevel: number | undefined;
  let locationLabel = '位置未知';

  for (const event of events) {
    const time = Date.parse(event.timestamp);
    // A clock rollback must not let a future recovery clear a current alert.
    // Keep future records in history, but do not replay them ahead of their time.
    if (!Number.isFinite(now) || !Number.isFinite(time) || time > now) continue;
    if (event.batteryLevel !== undefined && event.batteryLevel >= 0 && event.batteryLevel <= 100)
      batteryLevel = event.batteryLevel;
    if (event.locationLabel) locationLabel = event.locationLabel;
    else if (event.type === 'RETURN_HOME') locationLabel = '家附近';
    else if (event.location) locationLabel = '守护地点外';

    if (safetyTypes.has(event.type)) lastSafeEvent = event;
    if (event.type === 'USER_CONFIRMED_SAFE') {
      incident = undefined;
      incidentEvidence = [];
      continue;
    }
    if (event.type === 'SOS_SENT' || event.type === 'RISK_ESCALATED' || riskTypes.has(event.type)) {
      if (!incident || (event.type === 'SOS_SENT' && incident.kind !== 'sos')) {
        incidentEvidence = [];
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
      incidentEvidence.push(event);
      continue;
    }
    if (!incident) continue;

    // Late delivery records cannot advance another incident.
    if (notificationTypes.has(event.type)) {
      if (event.incidentId !== incident.id) continue;
      incidentEvidence.push(event);
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
    if (event.type === 'GUARDIAN_SESSION_RESET') {
      incident = undefined;
      incidentEvidence = [];
      continue;
    }
    const resolved = new Set<string>();
    if (event.type === 'MOTION_DETECTED') {
      resolved.add('LONG_STAY');
      resolved.add('NO_MOTION_FOR_LONG_TIME');
    }
    if (event.type === 'RETURN_HOME') {
      resolved.add('LONG_STAY');
      resolved.add('NO_MOTION_FOR_LONG_TIME');
      resolved.add('LOW_BATTERY');
    }
    if (
      event.type === 'LOCATION_RESTORED' ||
      // Legacy events had no cause. Permission-related episodes require explicit recovery.
      ((event.type === 'LOCATION_UPDATED' ||
        (event.type === 'MOTION_DETECTED' && event.source === 'location')) &&
        !incident.risks.some((risk) => risk.type === 'LOCATION_LOST' && risk.riskReason))
    )
      resolved.add('LOCATION_LOST');
    if (event.batteryLevel !== undefined && event.batteryLevel >= 20) resolved.add('LOW_BATTERY');
    if (event.type === 'BATTERY_RECOVERED') resolved.add('LOW_BATTERY');
    if (resolved.size) {
      const before = incident.risks.length;
      incident.risks = incident.risks.filter((risk) => !resolved.has(risk.type));
      if (incident.risks.length !== before) incidentEvidence.push(event);
      if (!incident.risks.length && riskTypes.has(incident.trigger.type)) incident = undefined;
      if (!incident) incidentEvidence = [];
    }
  }
  return { events, incident, incidentEvidence, lastSafeEvent, batteryLevel, locationLabel };
}
