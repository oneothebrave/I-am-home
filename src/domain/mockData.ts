import type { GuardianConfig, GuardianStatusSnapshot } from './types';

export const guardianConfig: GuardianConfig = {
  geofences: [
    {
      id: 'home',
      name: '家',
      kind: 'home',
      center: { latitude: 30.2741, longitude: 120.1551 },
      radiusMeters: 160,
    },
    {
      id: 'orchard',
      name: '果园',
      kind: 'work',
      center: { latitude: 30.3012, longitude: 120.1044 },
      radiusMeters: 320,
    },
    {
      id: 'mountain-pass',
      name: '山脚路口',
      kind: 'waypoint',
      center: { latitude: 30.2925, longitude: 120.1288 },
      radiusMeters: 260,
    },
  ],
  contacts: [
    {
      id: 'contact-1',
      name: '阿明',
      relation: '儿子',
      phone: '13800000000',
      priority: 1,
    },
    {
      id: 'contact-2',
      name: '小兰',
      relation: '女儿',
      phone: '13900000000',
      priority: 2,
    },
  ],
  schedule: {
    startTime: '07:00',
    expectedReturnTime: '18:00',
    noMotionThresholdMinutes: 120,
    escalationDelayMinutes: 10,
  },
};

export const statusSnapshot: GuardianStatusSnapshot = {
  status: 'attention',
  headline: '需要留意',
  detail: '手机在果园附近停留较久，系统已先提醒本人确认。',
  lastSafeSignal: '今天 10:18 检测到移动',
  locationLabel: '果园附近',
  batteryLevel: 24,
  events: [
    {
      id: 'e1',
      type: 'LEAVE_HOME',
      title: '离开家',
      description: '手机离开家的守护范围。',
      timestamp: '08:05',
      source: 'geofence',
      batteryLevel: 82,
    },
    {
      id: 'e2',
      type: 'ENTER_WORK_AREA',
      title: '经过山脚路口',
      description: '进入山脚路口的守护范围，路线符合平常模式。',
      timestamp: '08:26',
      source: 'geofence',
      batteryLevel: 79,
    },
    {
      id: 'e3',
      type: 'ENTER_WORK_AREA',
      title: '到达果园',
      description: '进入果园附近的劳作范围。',
      timestamp: '08:42',
      source: 'geofence',
      batteryLevel: 76,
    },
    {
      id: 'e4',
      type: 'MOTION_DETECTED',
      title: '检测到移动',
      description: '运动趋势正常，维持安全状态。',
      timestamp: '10:18',
      source: 'motion',
      batteryLevel: 53,
    },
    {
      id: 'e5',
      type: 'LOW_BATTERY',
      title: '电量偏低',
      description: '手机电量低于 25%，且仍在劳作地点附近。',
      timestamp: '14:55',
      source: 'battery',
      batteryLevel: 24,
    },
    {
      id: 'e6',
      type: 'LONG_STAY',
      title: '停留较久',
      description: '已在果园附近停留超过 2 小时，进入关注。',
      timestamp: '15:42',
      source: 'location',
      batteryLevel: 24,
    },
  ],
};
