import type {
  GuardianConfig,
  GuardianContact,
  GuardianEventDraft,
  GuardianStatusSnapshot,
} from './types';

export type EscalationPhase =
  | 'idle'
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
      description: '异常记录仍保留，直到系统检测到恢复信号。',
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
  const due = now;
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
