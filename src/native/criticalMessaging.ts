import { isRecord, isTimestamp } from '../domain/validation';

export type CriticalMessagingRecipient = {
  id: string;
  name: string;
  phoneNumber: string;
  priority: number;
};

export type CriticalMessageOperation = {
  id: string;
  eventId: string;
  contactId: string;
  contactName: string;
  phoneNumber: string;
  messageText: string;
  createdAt: string;
  status: 'prepared' | 'sent' | 'failed';
  sentAt?: string;
  lastError?: string;
  shortcutAttemptPending: boolean;
  shortcutAttemptedAt?: string;
  shortcutOpenSucceeded?: boolean;
  shortcutAttemptError?: string;
  detectionContext?: 'restoration' | 'background' | 'foreground';
};

export type CriticalMessagingPreparation = {
  apiAvailable: boolean;
  buildConfigured: boolean;
  recipients: CriticalMessagingRecipient[];
  operations: CriticalMessageOperation[];
};

function requiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseCriticalMessagingPreparation(
  value: unknown,
): CriticalMessagingPreparation {
  if (
    !isRecord(value) ||
    typeof value.apiAvailable !== 'boolean' ||
    typeof value.buildConfigured !== 'boolean' ||
    !Array.isArray(value.recipients) ||
    !Array.isArray(value.operations)
  )
    throw new Error('短信准备状态格式无效。');

  const recipients = value.recipients.map((recipient) => {
    if (
      !isRecord(recipient) ||
      !requiredText(recipient.id) ||
      !requiredText(recipient.name) ||
      !requiredText(recipient.phoneNumber) ||
      typeof recipient.priority !== 'number' ||
      !Number.isInteger(recipient.priority)
    )
      throw new Error('短信收件人状态格式无效。');
    return recipient as CriticalMessagingRecipient;
  });

  const operations = value.operations.map((operation) => {
    if (
      !isRecord(operation) ||
      !requiredText(operation.id) ||
      !requiredText(operation.eventId) ||
      !requiredText(operation.contactId) ||
      !requiredText(operation.contactName) ||
      !requiredText(operation.phoneNumber) ||
      !requiredText(operation.messageText) ||
      !isTimestamp(operation.createdAt) ||
      !['prepared', 'sent', 'failed'].includes(String(operation.status)) ||
      typeof operation.shortcutAttemptPending !== 'boolean' ||
      (operation.sentAt !== undefined && !isTimestamp(operation.sentAt)) ||
      (operation.lastError !== undefined && typeof operation.lastError !== 'string') ||
      (operation.shortcutAttemptedAt !== undefined &&
        !isTimestamp(operation.shortcutAttemptedAt)) ||
      (operation.shortcutOpenSucceeded !== undefined &&
        typeof operation.shortcutOpenSucceeded !== 'boolean') ||
      (operation.shortcutAttemptError !== undefined &&
        typeof operation.shortcutAttemptError !== 'string') ||
      (operation.detectionContext !== undefined &&
        !['restoration', 'background', 'foreground'].includes(String(operation.detectionContext)))
    )
      throw new Error('短信待发送操作格式无效。');
    return operation as CriticalMessageOperation;
  });

  return {
    apiAvailable: value.apiAvailable,
    buildConfigured: value.buildConfigured,
    recipients,
    operations,
  };
}
