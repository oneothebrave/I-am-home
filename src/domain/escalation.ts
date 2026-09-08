import type {
  GuardianConfig,
  GuardianContact,
  GuardianEventDraft,
  GuardianStatusSnapshot,
} from './types';

export type EscalationPhase =
  | 'idle'
  | 'self_prompt'
  | 'waiting'
  | 'family_queue'
  | 'blocked'
  | 'completed'
  | 'acknowledged';
export interface EscalationState {
  phase: EscalationPhase;
  title: string;
  description: string;
  notifiedContacts: GuardianContact[];
  notifiedCount: number;
  nextContact?: GuardianContact;
  dueAt?: string;
  nextActionLabel?: string;
  nextEvent?: GuardianEventDraft;
}

export function getEscalationState(
  snapshot: GuardianStatusSnapshot,
  config: GuardianConfig,
  { now = Date.now(), simulate = false }: { now?: number; simulate?: boolean } = {},
): EscalationState {
  const incident = snapshot.incident;
  const contacts = [...config.contacts].sort((a, b) => a.priority - b.priority);
  const common = {
    notifiedContacts: contacts.filter((contact) =>
      incident?.notifiedContactIds.includes(contact.id),
    ),
    notifiedCount: incident?.notifiedContactIds.length ?? 0,
  };
  if (!incident)
    return {
      ...common,
      phase: 'idle',
      title: '没有升级中的提醒',
      description: '当前没有待处理告警。',
    };
  if (incident.acknowledgedBy)
    return {
      ...common,
      phase: 'acknowledged',
      title: '家人已接手',
      description: '等待本人确认平安，告警尚未解除。',
    };
  if (!contacts.length)
    return {
      ...common,
      phase: 'blocked',
      title: '没有可通知的家人',
      description: '请添加至少一位家人。',
    };
  const simulationEvent = (event: GuardianEventDraft) =>
    simulate ? { ...event, incidentId: incident.id, simulated: true } : undefined;
  if (incident.kind !== 'sos' && incident.severity !== 'emergency' && !incident.selfPromptAt) {
    return {
      ...common,
      phase: 'self_prompt',
      title: '先提醒本人',
      description: '等待向本人发送确认提醒。',
      nextActionLabel: simulate ? '演练提醒本人' : undefined,
      nextEvent: simulationEvent({
        type: 'SAFETY_CHECK_REQUESTED',
        title: '模拟提醒本人',
        description: '已演练本人确认提醒。',
        source: 'notification',
      }),
    };
  }
  const nextContact = contacts.find((contact) => !incident.notifiedContactIds.includes(contact.id));
  if (!nextContact) {
    return {
      ...common,
      phase: 'completed',
      title: simulate ? '名单通知演练完成' : '名单已发送完毕',
      description: '发送完毕不代表家人已确认，告警仍保留。',
      nextActionLabel: simulate && !incident.completed ? '演练完成升级' : undefined,
      nextEvent: incident.completed
        ? undefined
        : simulationEvent({
            type: 'ESCALATION_FINISHED',
            title: '升级演练完成',
            description: '保留告警，等待确认。',
            source: 'notification',
          }),
    };
  }
  const anchor =
    incident.lastNotificationAt ??
    (incident.kind === 'sos' || incident.severity === 'emergency'
      ? undefined
      : incident.selfPromptAt);
  const due = anchor ? Date.parse(anchor) + config.schedule.escalationDelayMinutes * 60_000 : now;
  if (!simulate && now < due)
    return {
      ...common,
      phase: 'waiting',
      title: '等待响应',
      description: '确认期限未到。',
      nextContact,
      dueAt: new Date(due).toISOString(),
    };
  return {
    ...common,
    phase: 'family_queue',
    title: `等待通知${nextContact.name}`,
    description: `下一位接收人为${nextContact.name}。`,
    nextContact,
    dueAt: new Date(due).toISOString(),
    nextActionLabel: simulate ? `演练通知${nextContact.name}` : undefined,
    nextEvent: simulationEvent({
      type: 'FAMILY_NOTIFIED',
      contactId: nextContact.id,
      title: `模拟通知${nextContact.name}`,
      description: `已演练向${nextContact.name}发送提醒，未实际发送。`,
      source: 'notification',
    }),
  };
}
