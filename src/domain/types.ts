export type GuardianStatus = 'safe' | 'attention' | 'emergency';

export type GuardianEventType =
  | 'LEAVE_HOME'
  | 'ENTER_WORK_AREA'
  | 'EXIT_WORK_AREA'
  | 'RETURN_HOME'
  | 'LONG_STAY'
  | 'LOW_BATTERY'
  | 'LOCATION_LOST'
  | 'MOTION_DETECTED'
  | 'NO_MOTION_FOR_LONG_TIME'
  | 'SAFETY_CHECK_REQUESTED'
  | 'FAMILY_NOTIFIED'
  | 'ESCALATION_FINISHED'
  | 'USER_CONFIRMED_SAFE'
  | 'SOS_SENT'
  | 'RISK_ESCALATED';

export type GuardianEventSource =
  | 'geofence'
  | 'location'
  | 'motion'
  | 'battery'
  | 'notification'
  | 'user';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface GuardianEvent {
  id: string;
  type: GuardianEventType;
  title: string;
  description: string;
  timestamp: string;
  source: GuardianEventSource;
  location?: GeoPoint;
  batteryLevel?: number;
}

export interface GuardianGeofence {
  id: string;
  name: string;
  kind: 'home' | 'work' | 'waypoint';
  center: GeoPoint;
  radiusMeters: number;
}

export interface GuardianContact {
  id: string;
  name: string;
  relation: string;
  phone: string;
  priority: number;
}

export interface GuardianSchedule {
  startTime: string;
  expectedReturnTime: string;
  noMotionThresholdMinutes: number;
  escalationDelayMinutes: number;
}

export interface GuardianConfig {
  geofences: GuardianGeofence[];
  contacts: GuardianContact[];
  schedule: GuardianSchedule;
}

export interface GuardianStatusSnapshot {
  status: GuardianStatus;
  headline: string;
  detail: string;
  lastSafeSignal: string;
  locationLabel: string;
  batteryLevel: number;
  events: GuardianEvent[];
}
