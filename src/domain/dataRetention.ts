import { projectGuardianEvents } from './guardianProjection';
import type { GuardianEvent } from './types';

export const HISTORY_RETENTION_DAYS = 30;
export const HISTORY_EVENT_LIMIT = 2_000;

export function retainGuardianEvents(events: GuardianEvent[], now = Date.now()): GuardianEvent[] {
  const projection = projectGuardianEvents(events, now);
  // An invalid clock must never become a destructive history-cleanup request.
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return projection.events;
  const cutoff = now - HISTORY_RETENTION_DAYS * 86_400_000;
  const recent = projection.events
    .filter((event) => Date.parse(event.timestamp) >= cutoff && Date.parse(event.timestamp) <= now)
    .slice(-HISTORY_EVENT_LIMIT);
  // After a rollback, future-dated records are quarantined from the current
  // quota, otherwise old-clock GPS records can evict every new sample forever.
  const future = projection.events.filter((event) => Date.parse(event.timestamp) > now);
  // Retain future transitions (including recoveries of a current incident).
  // Replaying only the future suffix could drop a recovery whose trigger is
  // before `now`, and turn a resolved incident into a permanent one later.
  const futureEvidence = future.filter((event) => event.type !== 'LOCATION_UPDATED');
  const firstFutureLocation = future.find((event) => event.type === 'LOCATION_UPDATED');
  // Clearing history is not evidence that an alert has recovered. Preserve the
  // complete semantic chain of an open incident (including partial recoveries).
  const retainedIds = new Set([...projection.incidentEvidence, ...recent,
    ...future.slice(-HISTORY_EVENT_LIMIT), ...futureEvidence].map((event) => event.id));
  if (firstFutureLocation) retainedIds.add(firstFutureLocation.id);
  // A burst of GPS samples must not erase a still-fresh activity confirmation.
  if (projection.lastSafeEvent && now - Date.parse(projection.lastSafeEvent.timestamp) <= 240 * 60_000)
    retainedIds.add(projection.lastSafeEvent.id);
  // Keep original tie order; a trigger and its recovery can share a timestamp.
  return projection.events.filter((event) => retainedIds.has(event.id));
}
