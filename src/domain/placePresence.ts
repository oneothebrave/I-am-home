import type { GeoPoint, GuardianGeofence, GuardianStatusSnapshot } from './types';
import type { CurrentLocationSample } from './validation';

export const PLACE_SAMPLE_MAX_AGE_MS = 120_000;
export const PLACE_TRANSITION_CONFIRM_MS = 15_000;
export type PlacePresence = {
  state: 'inside' | 'nearby' | 'outside' | 'unknown';
  label: string;
  radius: string;
};
type Candidate = { state: 'inside' | 'nearby' | 'outside'; fence?: GuardianGeofence };
type Observation = { at: number; point?: GeoPoint; fence?: GuardianGeofence };
const boundaryTypes = new Set([
  'RETURN_HOME', 'LEAVE_HOME', 'ENTER_WORK_AREA', 'EXIT_WORK_AREA', 'ENTER_WAYPOINT', 'EXIT_WAYPOINT',
]);
const unknown = (reason = '等待新的可信位置'): PlacePresence =>
  ({ state: 'unknown', label: '暂时无法确认', radius: reason });
const candidateKey = (candidate: Candidate) => candidate.state + ':' + (candidate.fence?.id ?? '');

export function distanceMeters(from: GeoPoint, to: GeoPoint) {
  const radians = (value: number) => value * Math.PI / 180;
  const a = Math.sin(radians(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) *
    Math.sin(radians(to.longitude - from.longitude) / 2) ** 2;
  const clamped = Math.max(0, Math.min(1, a));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function validPoint(point: GeoPoint) {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 &&
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) &&
    point.accuracy >= 0 && point.accuracy <= 100;
}

function classify(point: GeoPoint, fences: GuardianGeofence[], previous?: Candidate): Candidate {
  const distances = fences.map((fence) => ({
    fence, distance: distanceMeters(point, fence.center),
    margin: Math.max(25, Math.min(50, fence.radiusMeters * 0.1)),
  })).sort((a, b) => a.distance / a.fence.radiusMeters - b.distance / b.fence.radiusMeters ||
    a.fence.id.localeCompare(b.fence.id));
  const inside = distances.filter(({ fence, distance, margin }) =>
    distance + point.accuracy! <= fence.radiusMeters - margin);
  const preferred = inside.find(({ fence }) => fence.id === previous?.fence?.id) ?? inside[0];
  if (preferred) return { state: 'inside', fence: preferred.fence };
  const near = distances.find(({ fence, distance, margin }) =>
    distance - point.accuracy! <= fence.radiusMeters + margin);
  return near ? { state: 'nearby', fence: near.fence } : { state: 'outside' };
}

function describe(candidate: Candidate): PlacePresence {
  if (candidate.state === 'outside')
    return { state: 'outside', label: '守护地点外', radius: '未进入已设置地点' };
  const fence = candidate.fence!;
  return {
    state: candidate.state,
    // A 150 m geofence cannot prove that someone is indoors.
    label: candidate.state === 'inside' ? fence.kind === 'home' ? '家的范围内' : fence.name : fence.name + '附近',
    radius: candidate.state === 'inside' ? '周围 ' + fence.radiusMeters + ' 米' : '边界或位置变化待确认',
  };
}

// Presentation only: never emits risks or changes Core Location monitoring.
export function resolvePlacePresence(
  snapshot: Pick<GuardianStatusSnapshot, 'events'>,
  fences: GuardianGeofence[],
  currentLocation?: CurrentLocationSample,
  now = Date.now(),
): PlacePresence {
  if (!fences.length) return unknown('尚未设置守护地点');
  const observations: Observation[] = [];
  for (const event of snapshot.events) {
    const at = Date.parse(event.timestamp);
    if (event.source === 'location' &&
        (event.type === 'LOCATION_UPDATED' || event.type === 'MOTION_DETECTED') && event.location) {
      observations.push({ at, point: event.location });
    } else if (event.source === 'geofence' && boundaryTypes.has(event.type)) {
      const fence = fences.find((value) => value.id === event.geofenceId);
      if (fence) observations.push({ at, fence });
    }
  }
  if (currentLocation) observations.push({ at: Date.parse(currentLocation.timestamp), point: currentLocation });
  const recent = observations.filter(({ at }) =>
    Number.isFinite(at) && at <= now + 5_000 && now - at <= PLACE_SAMPLE_MAX_AGE_MS)
    .sort((a, b) => a.at - b.at || Number(Boolean(a.point)) - Number(Boolean(b.point)));
  if (!recent.length) return unknown();
  let stable: Candidate | undefined;
  let pending: { key: string; since: number } | undefined;
  let result = unknown();
  let lastPointAt = -Infinity;
  for (const observation of recent) {
    if (observation.fence) {
      result = describe({ state: 'nearby', fence: observation.fence });
      pending = undefined;
      continue;
    }
    if (!observation.point || !validPoint(observation.point)) {
      stable = undefined;
      pending = undefined;
      result = unknown('定位精度不足，等待重新确认');
      continue;
    }
    if (observation.at <= lastPointAt) continue;
    lastPointAt = observation.at;
    const next = classify(observation.point, fences, stable);
    if (next.state === 'nearby') {
      pending = undefined;
      result = describe(next);
    } else if (!stable || candidateKey(stable) === candidateKey(next)) {
      stable = next;
      pending = undefined;
      result = describe(next);
    } else {
      const key = candidateKey(next);
      if (pending?.key === key && observation.at - pending.since >= PLACE_TRANSITION_CONFIRM_MS) {
        stable = next;
        pending = undefined;
        result = describe(next);
      } else {
        if (pending?.key !== key) pending = { key, since: observation.at };
        result = describe({ state: 'nearby', fence: next.fence ?? stable.fence! });
      }
    }
  }
  return result;
}

export function describeCurrentPlace(
  snapshot: Pick<GuardianStatusSnapshot, 'events'>,
  geofences: GuardianGeofence[],
  currentLocation?: CurrentLocationSample,
  now = Date.now(),
) {
  const { label, radius } = resolvePlacePresence(snapshot, geofences, currentLocation, now);
  return { label, radius };
}
