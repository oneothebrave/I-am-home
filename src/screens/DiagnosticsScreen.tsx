import React, { useMemo, useState } from 'react';
import { Share, Text, TouchableOpacity, View } from 'react-native';
import type { GuardianEvent } from '../domain/types';
import type { CurrentLocationSample } from '../domain/validation';
import type { GuardianNativeStatus, PermissionState } from '../native/GuardianNative';
import type { CriticalMessagingPreparation } from '../native/criticalMessaging';
import type { GeofenceSyncStatus } from '../native/guardianGeofenceSync';
import { styles } from '../styles/appStyles';

export type DiagnosticCurrentPlace = { label: string; radius: string };

export type GuardianDiagnosticsInput = {
  mode: 'demo' | 'device';
  now: number;
  status?: GuardianNativeStatus;
  permissions?: PermissionState;
  geofenceSyncStatus: GeofenceSyncStatus;
  geofenceCount: number;
  currentLocationState: 'idle' | 'refreshing' | 'ready' | 'error';
  currentLocation?: CurrentLocationSample;
  currentPlace?: DiagnosticCurrentPlace;
  events: GuardianEvent[];
  criticalMessaging?: CriticalMessagingPreparation;
};

type DiagnosticSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

type DiagnosticTimelineTone = 'default' | 'risk' | 'recovery' | 'notification';

export type DiagnosticTimelineItem = {
  id: string;
  at: number;
  title: string;
  detail: string;
  tone: DiagnosticTimelineTone;
};

const riskTypes = new Set([
  'LONG_STAY',
  'LOW_BATTERY',
  'LOCATION_LOST',
  'NO_MOTION_FOR_LONG_TIME',
]);

const locationPermissionLabels: Record<PermissionState['location'], string> = {
  notDetermined: '尚未设置',
  denied: '未允许',
  restricted: '受系统限制',
  whenInUse: '仅使用时允许',
  always: '始终允许',
};

const accuracyLabels: Record<PermissionState['locationAccuracy'], string> = {
  unknown: '尚未确认',
  reduced: '大致位置',
  full: '精确位置',
};

const motionLabels: Record<PermissionState['motion'], string> = {
  notDetermined: '尚未设置',
  denied: '未允许',
  restricted: '受系统限制',
  authorized: '已允许',
};

const backgroundRefreshLabels: Record<PermissionState['backgroundRefresh'], string> = {
  available: '已开启',
  denied: '未开启',
  restricted: '受系统限制',
};

const geofenceSyncLabels: Record<GeofenceSyncStatus, string> = {
  idle: '正在准备',
  syncing: '正在同步',
  synced: '已同步',
  error: '同步失败',
};

const activitySourceLabels: Record<string, string> = {
  coreMotion: '运动识别',
  pedometer: '计步器',
  visit: '地点访问',
  location: '可信位置移动',
  motion: '运动信号',
  geofence: '地点围栏',
};

const wakeReasonLabels: Record<string, string> = {
  'application-launch': 'App 启动',
  'location-event': '定位事件唤醒',
  'protected-data-available': '重启后本地数据恢复可用',
  'scene-active': 'App 回到前台',
};

function timestamp(value: string | number | undefined) {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDiagnosticTime(value: string | number | undefined, now: number) {
  const parsed = timestamp(value);
  if (parsed === undefined) return '暂无记录';
  const date = new Date(parsed);
  const today = date.toDateString() === new Date(now).toDateString();
  const day = today
    ? '今天'
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatRelativeTime(value: string | number | undefined, now: number) {
  const parsed = timestamp(value);
  if (parsed === undefined) return '暂无记录';
  const elapsed = Math.max(0, now - parsed);
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)} 天前`;
  return formatDiagnosticTime(parsed, now);
}

function formatTimelineTime(value: number, now: number) {
  const date = new Date(value);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${time}`;
}

function isToday(value: number, now: number) {
  return new Date(value).toDateString() === new Date(now).toDateString();
}

function newestEvent(events: GuardianEvent[], predicate: (event: GuardianEvent) => boolean) {
  return events
    .filter(predicate)
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
}

function recoveryForRisk(risk: GuardianEvent | undefined, events: GuardianEvent[], now: number) {
  if (!risk) return undefined;
  const riskAt = Date.parse(risk.timestamp);
  return events
    .filter((event) => Date.parse(event.timestamp) > riskAt && Date.parse(event.timestamp) <= now)
    .filter((event) => {
      if (risk.type === 'SOS_SENT') return event.type === 'USER_CONFIRMED_SAFE';
      if (event.type === 'GUARDIAN_SESSION_RESET') return true;
      if (event.type === 'RETURN_HOME' && risk.type !== 'LOCATION_LOST') return true;
      if (risk.type === 'NO_MOTION_FOR_LONG_TIME' || risk.type === 'LONG_STAY')
        return event.type === 'MOTION_DETECTED';
      if (risk.type === 'LOCATION_LOST')
        return event.type === 'LOCATION_RESTORED' || (!risk.riskReason &&
          (event.type === 'LOCATION_UPDATED' ||
          (event.type === 'MOTION_DETECTED' && event.source === 'location')));
      if (risk.type === 'LOW_BATTERY')
        return event.type === 'BATTERY_RECOVERED' ||
          (event.batteryLevel !== undefined && event.batteryLevel >= 20);
      return false;
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))[0];
}

function messagingStatus(preparation: CriticalMessagingPreparation | undefined) {
  const operation = preparation?.operations.at(-1);
  if (operation?.isTest) return '测试告警仅保存在本机，不会自动发送';
  if (!operation)
    return preparation?.recipients.length
      ? `已设置 ${preparation.recipients.length} 位家人，暂无待发送告警`
      : '尚未设置家人';
  if (operation.status === 'accepted') return '系统已接受发送，不代表家人已经阅读';
  if (operation.status === 'sending') return `正在提交（第 ${operation.attemptCount} 次）`;
  if (operation.status === 'retryScheduled')
    return `等待重试（已尝试 ${operation.attemptCount}/${preparation?.policy.maximumAttempts ?? 3} 次）`;
  if (operation.status === 'failed') return `发送失败${operation.lastError ? `：${operation.lastError}` : ''}`;
  if (operation.status === 'restricted')
    return `发送受限${operation.lastError ? `：${operation.lastError}` : ''}`;
  if (operation.status === 'expired') return '已过有效期，不再发送';
  if (operation.status === 'cancelled') return '风险已解除，不再发送';
  return '短信已准备，尚未通过 Apple 关键短信发送';
}

function detectionContext(preparation: CriticalMessagingPreparation | undefined) {
  const context = preparation?.operations.at(-1)?.detectionContext;
  if (context === 'background') return 'App 在后台时检测';
  if (context === 'restoration') return '恢复守护时检测';
  if (context === 'foreground') return 'App 在前台时检测';
  return '暂无记录';
}

export function guardianDiagnosticsSummary(input: GuardianDiagnosticsInput) {
  if (input.mode === 'demo') return { title: '尚未启用真机守护', value: '未启用' };
  if (input.events.some((event) => Date.parse(event.timestamp) > input.now + 5_000))
    return { title: '设备时间需要确认', value: '需要检查' };
  if (!input.status || !input.permissions)
    return { title: '正在检查守护链路', value: '正在检查' };
  const ready =
    input.status.isGuardianOn === true &&
    input.status.isMonitoring === true &&
    input.permissions?.location === 'always' &&
    input.permissions.locationAccuracy === 'full' &&
    input.permissions.backgroundRefresh === 'available' &&
    input.geofenceSyncStatus === 'synced' &&
    input.geofenceCount > 0;
  return ready
    ? { title: '守护链路已就绪', value: '正常' }
    : { title: '守护链路需要检查', value: '需要检查' };
}

function latestLocationEvidence(input: GuardianDiagnosticsInput) {
  const lastLocationEvent = newestEvent(
    input.events,
    (event) => event.source === 'location' && event.location !== undefined,
  );
  const currentLocationAt = timestamp(input.currentLocation?.timestamp) ?? 0;
  const eventLocationAt = timestamp(lastLocationEvent?.timestamp) ?? 0;
  if (currentLocationAt >= eventLocationAt && input.currentLocation) {
    return {
      at: currentLocationAt,
      title: '获得可信位置',
      detail: `${input.currentPlace ? `${input.currentPlace.label} · ${input.currentPlace.radius} · ` : ''}精度约 ${Math.round(input.currentLocation.accuracy)} 米`,
    };
  }
  if (!lastLocationEvent) return undefined;
  return {
    at: eventLocationAt,
    title: lastLocationEvent.title,
    detail: `${lastLocationEvent.locationLabel ? `${lastLocationEvent.locationLabel} · ` : ''}精度约 ${Math.round(lastLocationEvent.location?.accuracy ?? 0)} 米`,
  };
}

export function buildGuardianRecentConfirmation(input: GuardianDiagnosticsInput) {
  const candidates: DiagnosticTimelineItem[] = [];
  const location = latestLocationEvidence(input);
  if (location?.at) {
    candidates.push({ id: 'recent-location', ...location, tone: 'default' });
  }
  const activity = newestEvent(input.events, (event) => event.type === 'MOTION_DETECTED');
  const activityAt = timestamp(activity?.timestamp);
  if (activity && activityAt !== undefined) {
    candidates.push({
      id: `recent-${activity.id}`,
      at: activityAt,
      title: activity.title,
      detail: `${activitySourceLabels[activity.source] ?? activity.source} · ${activity.description}`,
      tone: 'recovery',
    });
  }
  const reliability = input.status?.reliability;
  const wakeAt = timestamp(reliability?.lastWakeAt);
  const wakeReason = reliability?.lastWakeReason;
  const isBackgroundWake = wakeReason !== 'application-launch' && wakeReason !== 'scene-active';
  if (wakeAt !== undefined && isBackgroundWake) {
    candidates.push({
      id: 'recent-wake',
      at: wakeAt,
      title: wakeReason
        ? wakeReasonLabels[wakeReason] ?? wakeReason
        : '系统唤醒守护',
      detail: 'iPhone 留下了一次系统唤醒记录。',
      tone: 'default',
    });
  }
  const restoreAt = timestamp(reliability?.lastRestoreAt);
  if (restoreAt !== undefined && reliability?.lastRestoreSucceeded) {
    candidates.push({
      id: 'recent-restore',
      at: restoreAt,
      title: '原生守护恢复成功',
      detail: '后台定位和围栏守护已恢复。',
      tone: 'default',
    });
  }
  const backgroundAt = timestamp(reliability?.lastBackgroundCheckAt);
  if (backgroundAt !== undefined) {
    candidates.push({
      id: 'recent-background-check',
      at: backgroundAt,
      title: '完成后台守护检查',
      detail: 'iOS 提供了一次后台运行机会。',
      tone: 'default',
    });
  }
  return candidates.filter((item) => item.at <= input.now).sort((left, right) => right.at - left.at)[0];
}

export function buildGuardianTodayTimeline(input: GuardianDiagnosticsInput) {
  const items: DiagnosticTimelineItem[] = [];
  const location = latestLocationEvidence(input);
  if (location?.at && isToday(location.at, input.now)) {
    items.push({ id: 'today-location', ...location, tone: 'default' });
  }

  const excludedEvents = new Set([
    ...riskTypes,
    'FAMILY_NOTIFIED',
    'FAMILY_NOTIFICATION_FAILED',
    'FAMILY_ACKNOWLEDGED',
    'ESCALATION_FINISHED',
    'RISK_ESCALATED',
  ]);
  for (const event of input.events) {
    const at = timestamp(event.timestamp);
    if (at === undefined || !isToday(at, input.now) || excludedEvents.has(event.type)) continue;
    const source = activitySourceLabels[event.source] ?? event.source;
    items.push({
      id: `event-${event.id}`,
      at,
      title: event.title,
      detail: `${source}${event.locationLabel ? ` · ${event.locationLabel}` : ''} · ${event.description}`,
      tone: event.type === 'MOTION_DETECTED' || event.type === 'RETURN_HOME' ? 'recovery' : 'default',
    });
  }

  const reliability = input.status?.reliability;
  const nativeItems: Array<DiagnosticTimelineItem | undefined> = [
    timestamp(reliability?.lastWakeAt) !== undefined
      ? {
          id: 'today-wake',
          at: timestamp(reliability?.lastWakeAt)!,
          title: reliability?.lastWakeReason
            ? wakeReasonLabels[reliability.lastWakeReason] ?? reliability.lastWakeReason
            : '系统唤醒守护',
          detail: 'iPhone 留下了一次系统唤醒记录。',
          tone: 'default',
        }
      : undefined,
    timestamp(reliability?.lastRestoreAt) !== undefined
      ? {
          id: 'today-restore',
          at: timestamp(reliability?.lastRestoreAt)!,
          title: reliability?.lastRestoreSucceeded ? '原生守护恢复成功' : '原生守护恢复未成功',
          detail: reliability?.lastRestoreSucceeded
            ? '后台定位和围栏守护已恢复。'
            : '这次恢复没有完成，后续记录可用于继续排查。',
          tone: reliability?.lastRestoreSucceeded ? 'default' : 'risk',
        }
      : undefined,
    timestamp(reliability?.lastBackgroundCheckAt) !== undefined
      ? {
          id: 'today-background-check',
          at: timestamp(reliability?.lastBackgroundCheckAt)!,
          title: '完成后台守护检查',
          detail: 'iOS 提供了一次后台运行机会。',
          tone: 'default',
        }
      : undefined,
  ];
  for (const item of nativeItems) {
    if (item && isToday(item.at, input.now)) items.push(item);
  }

  return items
    .sort((left, right) => right.at - left.at)
    .filter((item, index, sorted) => {
      const previous = sorted[index - 1];
      return !previous || previous.title !== item.title || Math.abs(previous.at - item.at) > 5_000;
    })
    .slice(0, 10);
}

export function buildGuardianLatestRiskTimeline(input: GuardianDiagnosticsInput) {
  const risk = newestEvent(input.events, (event) => riskTypes.has(event.type));
  if (!risk) return [];
  const riskAt = timestamp(risk.timestamp);
  if (riskAt === undefined) return [];

  const items: DiagnosticTimelineItem[] = [{
    id: `risk-${risk.id}`,
    at: riskAt,
    title: risk.title,
    detail: risk.description,
    tone: 'risk',
  }];
  const operations = input.criticalMessaging?.operations
    .filter((candidate) => candidate.eventId === risk.id)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)) ?? [];
  for (const operation of operations) {
    const operationPreparation: CriticalMessagingPreparation = {
      apiAvailable: input.criticalMessaging?.apiAvailable ?? false,
      buildConfigured: input.criticalMessaging?.buildConfigured ?? false,
      automaticSendingEnabled: input.criticalMessaging?.automaticSendingEnabled ?? false,
      requiresBackgroundExecution: true,
      readiness: input.criticalMessaging?.readiness ?? 'unavailable',
      recipients: input.criticalMessaging?.recipients ?? [],
      authorizations: input.criticalMessaging?.authorizations ?? [],
      policy: input.criticalMessaging?.policy ?? {
        validityMinutes: 30,
        maximumAttempts: 3,
        retryDelaysSeconds: [60, 300],
        cooldownMinutes: 10,
      },
      operations: [operation],
    };
    const createdAt = timestamp(operation.createdAt);
    if (createdAt !== undefined) {
      items.push({
        id: `notification-prepared-${operation.id}`,
        at: createdAt,
        title: '已准备家人短信',
        detail: `${operation.contactName} · ${detectionContext(operationPreparation)} · ${messagingStatus(operationPreparation)}`,
        tone: 'notification',
      });
    }
    const attemptedAt = timestamp(operation.lastAttemptAt);
    if (attemptedAt !== undefined) {
      items.push({
        id: `notification-attempt-${operation.id}`,
        at: attemptedAt,
        title: `第 ${operation.attemptCount} 次提交关键短信`,
        detail: `${operation.contactName} · ${messagingStatus(operationPreparation)}`,
        tone: operation.status === 'failed' ? 'risk' : 'notification',
      });
    }
    const sentAt = timestamp(operation.acceptedAt ?? operation.sentAt);
    if (sentAt !== undefined) {
      items.push({
        id: `notification-sent-${operation.id}`,
        at: sentAt,
        title: '系统已接受关键短信',
        detail: `${operation.contactName} · 系统接受发送不代表家人已经收到或阅读。`,
        tone: 'notification',
      });
    }
  }
  const recovery = recoveryForRisk(risk, input.events, input.now);
  const recoveryAt = timestamp(recovery?.timestamp);
  if (recovery && recoveryAt !== undefined) {
    items.push({
      id: `recovery-${recovery.id}`,
      at: recoveryAt,
      title: recovery.title,
      detail: recovery.description,
      tone: 'recovery',
    });
  }
  return items.sort((left, right) => left.at - right.at);
}


export function buildGuardianDiagnosticReport(input: GuardianDiagnosticsInput) {
  // Sharing is a separate allowlist, not a serialization of the on-device UI.
  // Never export arbitrary titles/descriptions/errors/IDs/place names, even when
  // they look harmless: any of them may contain a phone, address or SMS body.
  const label = (labels: Record<string, string>, key: unknown) =>
    typeof key === 'string' && Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : '尚未确认';
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value) : '尚未确认';
  const time = (value: string | number | undefined) => {
    const parsed = timestamp(value);
    return parsed !== undefined && parsed >= 0 && Number.isFinite(new Date(parsed).getTime())
      ? formatDiagnosticTime(parsed, input.now) : '暂无记录';
  };
  const flag = (value: unknown, yes: string, no: string) => value === true ? yes
    : value === false ? no : '尚未确认';
  const eventLabels: Record<string, string> = {
    LONG_STAY: '长时间停留', NO_MOTION_FOR_LONG_TIME: '家外长时间无活动',
    LOW_BATTERY: '低电量', LOCATION_LOST: '无可信位置', SOS_SENT: '主动求助',
    RETURN_HOME: '回到家范围', MOTION_DETECTED: '检测到活动',
    BATTERY_RECOVERED: '电量恢复', LOCATION_RESTORED: '可信位置恢复',
    LOCATION_UPDATED: '位置更新', GUARDIAN_SESSION_RESET: '守护周期重置', USER_CONFIRMED_SAFE: '本人确认安全',
  };
  const status = input.status;
  const reliability = status?.reliability;
  const health = status?.riskHealth;
  const messaging = input.criticalMessaging;
  const operation = messaging?.operations.at(-1);
  const risk = newestEvent(input.events, (event) => riskTypes.has(event.type) || event.type === 'SOS_SENT');
  const recovery = recoveryForRisk(risk, input.events, input.now);
  const activity = newestEvent(input.events, (event) => event.type === 'MOTION_DETECTED');
  const location = newestEvent(input.events, (event) => event.source === 'location' && !!event.location);
  const eventSummary = (event: GuardianEvent | undefined) => event
    ? `${time(event.timestamp)} · ${label(eventLabels, event.type)}` : '暂无记录';
  const sections: DiagnosticSection[] = [
    { title: '守护运行', rows: [
      { label: '记录时间', value: input.events.some((event) => Date.parse(event.timestamp) > input.now + 5_000)
        ? '存在晚于当前时间的记录，请检查系统日期与时间' : '未发现未来时间记录' },
      { label: '数据模式', value: label({ demo: '演示模式', device: '设备模式' }, input.mode) },
      { label: '检测模式', value: label({ test: '测试模式（不自动发送短信）', standard: '正式模式' }, status?.monitoringMode) },
      { label: '自动守护', value: flag(status?.isGuardianOn, '已开启', '未开启') },
      { label: '原生监听', value: flag(status?.isMonitoring, '正在运行', '未运行') },
      { label: '守护时段', value: flag(status?.isInActiveWindow, '时段内', '时段外') },
      { label: '守护地点数量', value: count(input.geofenceCount) },
      { label: '地点同步', value: label(geofenceSyncLabels, input.geofenceSyncStatus) },
      { label: '待同步事件', value: count(status?.pendingEventCount) },
      { label: '最近原生错误', value: status?.lastError ? '有错误（详细内容未导出）' : '无错误记录' },
    ] },
    { title: '权限状态', rows: [
      { label: '定位', value: label(locationPermissionLabels, input.permissions?.location) },
      { label: '位置精度', value: label(accuracyLabels, input.permissions?.locationAccuracy) },
      { label: '运动与健身', value: label(motionLabels, input.permissions?.motion) },
      { label: '后台 App 刷新', value: label(backgroundRefreshLabels, input.permissions?.backgroundRefresh) },
    ] },
    { title: '电量与可信位置检查', rows: [
      { label: '最近执行检查', value: time(health?.lastCheckAt) },
      { label: '家外低电量', value: flag(health?.lowBatteryActive, '正在提醒', '当前未触发') },
      { label: '可信位置时间', value: time(health?.lastTrustedLocationAt) },
      { label: '位置检查', value: health?.locationReason ? label({
        locationServicesDisabled: '系统定位服务关闭', locationPermissionDisabled: '缺少始终定位权限',
        preciseLocationDisabled: '精确位置关闭', backgroundRefreshDisabled: '后台刷新不可用',
        locationFailed: '长期无可信位置，最近定位失败', locationStale: '长期未取得可信位置',
      }, health.locationReason) : health ? '当前未触发' : '尚未检查' },
    ] },
    { title: '后台恢复', rows: [
      { label: '最近系统唤醒', value: `${time(reliability?.lastWakeAt)} · ${label(wakeReasonLabels, reliability?.lastWakeReason)}` },
      { label: '最近恢复时间', value: time(reliability?.lastRestoreAt) },
      { label: '最近恢复结果', value: flag(reliability?.lastRestoreSucceeded, '成功', '未成功') },
      { label: '最近后台检查', value: time(reliability?.lastBackgroundCheckAt) },
      { label: '下次请求检查', value: `${time(reliability?.nextBackgroundCheckAt)}（实际时间由 iOS 决定）` },
    ] },
    { title: '最近信号', rows: [
      { label: '位置读取', value: label({ idle: '未采点', refreshing: '正在读取', ready: '已读取', error: '读取失败' }, input.currentLocationState) },
      { label: '最近位置采样', value: time(Math.max(timestamp(input.currentLocation?.timestamp) ?? 0, timestamp(location?.timestamp) ?? 0) || undefined) },
      { label: '可信活动', value: activity ? `${time(activity.timestamp)} · ${label(activitySourceLabels, activity.source)}` : '暂无记录' },
      { label: '最近风险', value: eventSummary(risk) },
      { label: '风险恢复', value: eventSummary(recovery) },
    ] },
    { title: '家人通知准备', rows: [
      { label: 'Apple 关键短信', value: flag(messaging?.buildConfigured, '工程已配置', '工程尚未启用') },
      { label: '家人数量', value: count(messaging?.recipients.length) },
      { label: '最近短信操作', value: operation?.isTest ? '测试告警仅保存在本机，不会自动发送' : label({
        prepared: '短信已准备', sending: '正在提交', retryScheduled: '等待重试',
        accepted: '系统已接受发送，不代表送达或已阅读', failed: '发送失败', restricted: '发送受限',
        expired: '已过有效期', cancelled: '已取消',
      }, operation?.status) },
      { label: '已尝试次数', value: count(operation?.attemptCount) },
      { label: '短信操作错误', value: operation?.lastError ? '有错误（详细内容未导出）' : '无错误记录' },
      { label: '异常检测环境', value: label({ foreground: '前台', background: '后台', restoration: '恢复守护' }, operation?.detectionContext) },
    ] },
  ];
  const lines = [
    '到家了么 · 守护诊断',
    `生成时间：${formatDiagnosticTime(input.now, input.now)}`,
    '说明：报告不包含电话号码、短信正文或经纬度。姓名、地点名称及自由文本也不导出。',
    '报告仍含事件时间、权限与运行状态；请仅分享给信任的人。',
  ];
  for (const section of sections) {
    lines.push('', `【${section.title}】`);
    for (const row of section.rows) lines.push(`${row.label}：${row.value}`);
  }
  return lines.join('\n');
}

function DiagnosticTimeline({
  items,
  now,
  emptyTitle,
  emptyDetail,
}: {
  items: DiagnosticTimelineItem[];
  now: number;
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.diagnosticTimelineEmpty}>
        <Text style={styles.diagnosticTimelineTitle}>{emptyTitle}</Text>
        <Text style={styles.diagnosticTimelineDetail}>{emptyDetail}</Text>
      </View>
    );
  }
  return (
    <View style={styles.diagnosticTimelineCard}>
      {items.map((item, index) => (
        <View key={item.id} style={styles.diagnosticTimelineRow}>
          <Text style={styles.diagnosticTimelineTime}>{formatTimelineTime(item.at, now)}</Text>
          <View style={styles.diagnosticTimelineRail}>
            <View
              style={[
                styles.diagnosticTimelineDot,
                item.tone === 'risk' && styles.diagnosticTimelineDotRisk,
                item.tone === 'recovery' && styles.diagnosticTimelineDotRecovery,
                item.tone === 'notification' && styles.diagnosticTimelineDotNotification,
              ]}
            />
            {index < items.length - 1 && <View style={styles.diagnosticTimelineLine} />}
          </View>
          <View style={styles.diagnosticTimelineContent}>
            <Text style={styles.diagnosticTimelineTitle}>{item.title}</Text>
            <Text selectable style={styles.diagnosticTimelineDetail}>{item.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function DiagnosticsScreen({
  input,
  onRefresh,
}: {
  input: GuardianDiagnosticsInput;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState('');
  const recentConfirmation = useMemo(() => buildGuardianRecentConfirmation(input), [input]);
  const todayTimeline = useMemo(() => buildGuardianTodayTimeline(input), [input]);
  const riskTimeline = useMemo(() => buildGuardianLatestRiskTimeline(input), [input]);
  const summary = guardianDiagnosticsSummary(input);
  const summaryTone = summary.value === '正常'
    ? 'healthy'
    : summary.value === '需要检查'
      ? 'attention'
      : 'neutral';

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshResult('');
    try {
      await onRefresh();
      setRefreshResult('诊断信息已刷新。');
    } catch {
      setRefreshResult('刷新未完成，请稍后重试。');
    } finally {
      setRefreshing(false);
    }
  };

  const share = async () => {
    try {
      await Share.share({
        title: '到家了么守护诊断',
        message: buildGuardianDiagnosticReport(input),
      });
    } catch {
      setRefreshResult('无法打开系统分享，请稍后重试。');
    }
  };

  return (
    <>
      <View
        style={[
          styles.diagnosticSummaryCard,
          summaryTone === 'attention' && styles.diagnosticSummaryCardAttention,
          summaryTone === 'neutral' && styles.diagnosticSummaryCardNeutral,
        ]}
      >
        <Text
          style={[
            styles.diagnosticSummaryTitle,
            summaryTone === 'attention' && styles.diagnosticSummaryTitleAttention,
            summaryTone === 'neutral' && styles.diagnosticSummaryTitleNeutral,
          ]}
        >
          {summary.title}
        </Text>
        <Text
          style={[
            styles.diagnosticSummaryEyebrow,
            summaryTone !== 'healthy' && styles.diagnosticSummaryTextNeutral,
          ]}
        >
          最近确认 · {recentConfirmation
            ? formatRelativeTime(recentConfirmation.at, input.now)
            : '暂无记录'}
        </Text>
        <Text
          style={[
            styles.diagnosticSummaryText,
            summaryTone !== 'healthy' && styles.diagnosticSummaryTextNeutral,
          ]}
        >
          {recentConfirmation
            ? `${formatDiagnosticTime(recentConfirmation.at, input.now)} · ${recentConfirmation.title}`
            : '还没有可用于确认后台守护运行的时间记录。'}
        </Text>
        {!!recentConfirmation && (
          <Text
            style={[
              styles.diagnosticSummaryEvidence,
              summaryTone !== 'healthy' && styles.diagnosticSummaryTextNeutral,
            ]}
          >
            {recentConfirmation.detail}
          </Text>
        )}
      </View>

      <View style={styles.diagnosticSection}>
        <Text style={styles.diagnosticSectionTitle}>今天的守护记录</Text>
        <DiagnosticTimeline
          items={todayTimeline}
          now={input.now}
          emptyTitle="今天暂无守护记录"
          emptyDetail="出现可信位置、活动或后台唤醒后，会按时间显示在这里。"
        />
      </View>

      <View style={styles.diagnosticSection}>
        <Text style={styles.diagnosticSectionTitle}>最近一次风险</Text>
        <DiagnosticTimeline
          items={riskTimeline}
          now={input.now}
          emptyTitle="暂无风险记录"
          emptyDetail="检测到异常后，这里会显示发现、通知准备和恢复的完整时间顺序。"
        />
      </View>

      <View style={styles.diagnosticSection}>
        <Text style={styles.diagnosticSectionTitle}>下一次系统机会</Text>
        <View style={styles.diagnosticFutureCard}>
          <Text style={styles.diagnosticFutureTitle}>
            {input.status?.reliability?.nextBackgroundCheckAt
              ? '已请求后台检查'
              : '当前没有已登记的后台检查请求'}
          </Text>
          <Text style={styles.diagnosticFutureTime}>
            {input.status?.reliability?.nextBackgroundCheckAt
              ? `最早请求时间：${formatDiagnosticTime(input.status.reliability.nextBackgroundCheckAt, input.now)}`
              : 'iOS 仍可能通过定位或围栏事件唤醒守护。'}
          </Text>
          {!!input.status?.reliability?.nextBackgroundCheckAt && (
            <Text style={styles.diagnosticFutureDetail}>
              这是系统调度请求，不是精确定时器；iOS 会自行决定实际执行时间。
            </Text>
          )}
        </View>
      </View>

      <Text style={styles.diagnosticNote}>
        手机关机或用户强制退出 App 时，系统无法继续执行守护。
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.8}
        disabled={refreshing}
        onPress={() => void refresh()}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>{refreshing ? '正在刷新…' : '刷新诊断信息'}</Text>
      </TouchableOpacity>
      {!!refreshResult && <Text style={styles.diagnosticRefreshResult}>{refreshResult}</Text>}

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.8}
        onPress={() => void share()}
        style={styles.secondaryOutlineButton}
      >
        <Text style={styles.secondaryOutlineButtonText}>分享脱敏诊断报告</Text>
      </TouchableOpacity>
    </>
  );
}
