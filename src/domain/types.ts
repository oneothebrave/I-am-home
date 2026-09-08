export type GuardianStatus = 'unknown' | 'safe' | 'attention' | 'emergency';

export type GuardianEventType =
  | 'LEAVE_HOME'
  | 'ENTER_WORK_AREA'
  | 'EXIT_WORK_AREA'
  | 'RETURN_HOME'
  | 'LONG_STAY'
  | 'LOW_BATTERY'
  | 'LOCATION_LOST'
  | 'LOCATION_UPDATED'
  | 'ENTER_WAYPOINT'
  | 'EXIT_WAYPOINT'
  | 'MOTION_DETECTED'
  | 'NO_MOTION_FOR_LONG_TIME'
  | 'SAFETY_CHECK_REQUESTED'
  | 'FAMILY_NOTIFIED'
  | 'FAMILY_NOTIFICATION_FAILED'
  | 'FAMILY_ACKNOWLEDGED'
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
  receivedAt?: string;
  geofenceId?: string;
  locationLabel?: string;
  incidentId?: string;
  contactId?: string;
  simulated?: boolean;
}

export type GuardianEventDraft = Omit<GuardianEvent, 'id' | 'timestamp'>;

export interface GuardianIncident {
  id: string;
  trigger: GuardianEvent;
  kind: 'passive' | 'sos';
  severity: 'attention' | 'emergency';
  risks: GuardianEvent[];
  selfPromptAt?: string;
  notifiedContactIds: string[];
  lastNotificationAt?: string;
  acknowledgedBy?: string;
  completed: boolean;
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
  batteryLevel?: number;
  riskReason?: string;
  incident?: GuardianIncident;
  events: GuardianEvent[];
}
