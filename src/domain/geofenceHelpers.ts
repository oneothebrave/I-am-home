import type { GuardianGeofence } from './types';

export function getGeofenceKindLabel(kind: GuardianGeofence['kind']) {
  switch (kind) {
    case 'home':
      return '家';
    case 'work':
      return '劳作地';
    case 'waypoint':
      return '路口';
  }
}

export function getMockCurrentPoint(kind: GuardianGeofence['kind'], index: number) {
  const basePoint =
    kind === 'home'
      ? { latitude: 30.2741, longitude: 120.1551 }
      : { latitude: 30.3012, longitude: 120.1044 };

  return {
    latitude: basePoint.latitude + index * 0.0012,
    longitude: basePoint.longitude + index * 0.0014,
  };
}
