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
  status:
    | 'prepared'
    | 'sending'
    | 'retryScheduled'
    | 'accepted'
    | 'failed'
    | 'restricted'
    | 'expired'
    | 'cancelled';
  statusUpdatedAt: string;
  authorizationStatus: 'unknown' | 'approved' | 'denied' | 'unavailable';
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  expiresAt: string;
  cooldownUntil?: string;
  acceptedAt?: string;
  sentAt?: string;
  resolvedAt?: string;
  lastErrorCode?: string;
  lastError?: string;
  shortcutAttemptPending: boolean;
  shortcutAttemptedAt?: string;
  shortcutOpenSucceeded?: boolean;
  shortcutAttemptError?: string;
  detectionContext?: 'restoration' | 'background' | 'foreground';
};

export type CriticalMessagingAuthorization = {
  contactId: string;
  phoneNumber: string;
  status: 'unknown' | 'approved' | 'denied' | 'unavailable';
  checkedAt: string;
};

export type CriticalMessagingPolicy = {
  validityMinutes: number;
  maximumAttempts: number;
  retryDelaysSeconds: number[];
  cooldownMinutes: number;
};

export type CriticalMessagingReadiness =
  | 'ready'
  | 'noRecipients'
  | 'apiUnavailable'
  | 'buildNotConfigured'
  | 'authorizationRequired'
  | 'authorizationDenied'
  | 'unavailable';

export type CriticalMessagingPreparation = {
  apiAvailable: boolean;
  buildConfigured: boolean;
  automaticSendingEnabled: boolean;
  requiresBackgroundExecution: boolean;
  readiness: CriticalMessagingReadiness;
  recipients: CriticalMessagingRecipient[];
  authorizations: CriticalMessagingAuthorization[];
  policy: CriticalMessagingPolicy;
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
    typeof value.automaticSendingEnabled !== 'boolean' ||
    typeof value.requiresBackgroundExecution !== 'boolean' ||
    ![
      'ready',
      'noRecipients',
      'apiUnavailable',
      'buildNotConfigured',
      'authorizationRequired',
      'authorizationDenied',
      'unavailable',
    ].includes(String(value.readiness)) ||
    !Array.isArray(value.recipients) ||
    !Array.isArray(value.authorizations) ||
    !isRecord(value.policy) ||
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

  const authorizations = value.authorizations.map((authorization) => {
    if (
      !isRecord(authorization) ||
      !requiredText(authorization.contactId) ||
      !requiredText(authorization.phoneNumber) ||
      !['unknown', 'approved', 'denied', 'unavailable'].includes(
        String(authorization.status),
      ) ||
      !isTimestamp(authorization.checkedAt)
    )
      throw new Error('关键短信授权状态格式无效。');
    return authorization as CriticalMessagingAuthorization;
  });

  const policy = value.policy;
  if (
    typeof policy.validityMinutes !== 'number' ||
    !Number.isInteger(policy.validityMinutes) ||
    typeof policy.maximumAttempts !== 'number' ||
    !Number.isInteger(policy.maximumAttempts) ||
    !Array.isArray(policy.retryDelaysSeconds) ||
    !policy.retryDelaysSeconds.every(
      (delay) => typeof delay === 'number' && Number.isInteger(delay),
    ) ||
    typeof policy.cooldownMinutes !== 'number' ||
    !Number.isInteger(policy.cooldownMinutes)
  )
    throw new Error('关键短信发送策略格式无效。');

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
      ![
        'prepared',
        'sending',
        'retryScheduled',
        'accepted',
        'failed',
        'restricted',
        'expired',
        'cancelled',
      ].includes(String(operation.status)) ||
      !isTimestamp(operation.statusUpdatedAt) ||
      !['unknown', 'approved', 'denied', 'unavailable'].includes(
        String(operation.authorizationStatus),
      ) ||
      typeof operation.attemptCount !== 'number' ||
      !Number.isInteger(operation.attemptCount) ||
      !isTimestamp(operation.expiresAt) ||
      typeof operation.shortcutAttemptPending !== 'boolean' ||
      (operation.lastAttemptAt !== undefined && !isTimestamp(operation.lastAttemptAt)) ||
      (operation.nextAttemptAt !== undefined && !isTimestamp(operation.nextAttemptAt)) ||
      (operation.cooldownUntil !== undefined && !isTimestamp(operation.cooldownUntil)) ||
      (operation.acceptedAt !== undefined && !isTimestamp(operation.acceptedAt)) ||
      (operation.sentAt !== undefined && !isTimestamp(operation.sentAt)) ||
      (operation.resolvedAt !== undefined && !isTimestamp(operation.resolvedAt)) ||
      (operation.lastErrorCode !== undefined && typeof operation.lastErrorCode !== 'string') ||
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
    automaticSendingEnabled: value.automaticSendingEnabled,
    requiresBackgroundExecution: value.requiresBackgroundExecution,
    readiness: value.readiness as CriticalMessagingReadiness,
    recipients,
    authorizations,
    policy: policy as CriticalMessagingPolicy,
    operations,
  };
}
