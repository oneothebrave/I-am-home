import type { GuardianConfig, GuardianContact, GuardianEvent, GuardianStatusSnapshot } from './types';

export type EscalationPhase = 'idle' | 'self_prompt' | 'family_queue' | 'completed';

export interface EscalationState {
  phase: EscalationPhase;
  title: string;
  description: string;
  notifiedContacts: GuardianContact[];
  nextContact?: GuardianContact;
  nextActionLabel?: string;
  nextEvent?: Omit<GuardianEvent, 'id' | 'timestamp'>;
}

const RISK_START_TYPES: GuardianEvent['type'][] = [
  'LONG_STAY',
  'LOW_BATTERY',
  'LOCATION_LOST',
  'NO_MOTION_FOR_LONG_TIME',
];

const SAFETY_RESOLUTION_TYPES: GuardianEvent['type'][] = [
  'RETURN_HOME',
  'USER_CONFIRMED_SAFE',
  'MOTION_DETECTED',
];

export function getEscalationState(
  snapshot: GuardianStatusSnapshot,
  config: GuardianConfig,
): EscalationState {
  const activeEvents = getEventsSinceLastResolution(snapshot.events);
  const hasActiveRisk = activeEvents.some(event => RISK_START_TYPES.includes(event.type));
  const familyNotifiedEvents = activeEvents.filter(event => event.type === 'FAMILY_NOTIFIED');
  const contacts = [...config.contacts].sort((a, b) => a.priority - b.priority);
  const notifiedContacts = contacts.slice(0, familyNotifiedEvents.length);
  const nextContact = contacts[familyNotifiedEvents.length];
  const latestEvent = activeEvents.at(-1);

  if (snapshot.status === 'safe' || !hasActiveRisk) {
    return {
      phase: 'idle',
      title: '没有升级中的提醒',
      description: '当前状态正常，暂时不需要通知家人。',
      notifiedContacts: [],
    };
  }

  if (!activeEvents.some(event => event.type === 'SAFETY_CHECK_REQUESTED')) {
    return {
      phase: 'self_prompt',
      title: '先提醒本人',
      description: `系统会先提醒本人确认安全，${config.schedule.escalationDelayMinutes} 分钟内未响应再通知家人。`,
      notifiedContacts,
      nextActionLabel: '演练提醒本人',
      nextEvent: {
        type: 'SAFETY_CHECK_REQUESTED',
        title: '已提醒本人',
        description: '系统已向本人发送确认提醒，等待点击“我没事”。',
        source: 'notification',
        batteryLevel: snapshot.batteryLevel,
      },
    };
  }

  if (nextContact) {
    return {
      phase: 'family_queue',
      title: `等待通知${nextContact.name}`,
      description: latestEvent?.type === 'FAMILY_NOTIFIED'
        ? `上一位家人已收到提醒，若仍无人处理，将继续通知${nextContact.name}。`
        : `${config.schedule.escalationDelayMinutes} 分钟内本人未确认时，将通知${nextContact.name}。`,
      notifiedContacts,
      nextContact,
      nextActionLabel: `演练通知${nextContact.name}`,
      nextEvent: {
        type: 'FAMILY_NOTIFIED',
        title: `已通知${nextContact.name}`,
        description: `系统已向${nextContact.name}发送提醒，包含最后位置、电量和异常原因。`,
        source: 'notification',
        batteryLevel: snapshot.batteryLevel,
      },
    };
  }

  return {
    phase: 'completed',
    title: '家人已全部通知',
    description: '名单中的家人都已收到提醒，需要尽快线下确认。',
    notifiedContacts,
    nextActionLabel: '演练完成升级',
    nextEvent: {
      type: 'ESCALATION_FINISHED',
      title: '升级流程完成',
      description: '所有家人已收到提醒，系统保留当前异常状态。',
      source: 'notification',
      batteryLevel: snapshot.batteryLevel,
    },
  };
}

function getEventsSinceLastResolution(events: GuardianEvent[]) {
  let lastResolutionIndex = -1;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (SAFETY_RESOLUTION_TYPES.includes(events[index].type)) {
      lastResolutionIndex = index;
      break;
    }
  }

  return events.slice(lastResolutionIndex + 1);
}
