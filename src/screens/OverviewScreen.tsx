import React from 'react';
import { Image, Text, View } from 'react-native';
import type { GuardianGeofence, GuardianStatusSnapshot } from '../domain/types';
import type { CurrentLocationSample } from '../domain/validation';
import type { getStatusTone } from '../domain/guardianRules';
import type { CriticalMessagingPreparation } from '../native/criticalMessaging';
import { styles } from '../styles/appStyles';

import { describeCurrentPlace } from '../domain/placePresence';
export { describeCurrentPlace } from '../domain/placePresence';

export function OverviewScreen({
  criticalMessaging,
  currentLocation,
  currentLocationState,
  geofences,
  guardianReady,
  guardianStatus,
  isGuardianOn,
  mode,
  now = Date.now(),
  snapshot,
  tone,
}: {
  criticalMessaging?: CriticalMessagingPreparation;
  currentLocation?: CurrentLocationSample;
  currentLocationState: 'idle' | 'refreshing' | 'ready' | 'error';
  geofences: GuardianGeofence[];
  guardianReady: boolean;
  guardianStatus: string;
  isGuardianOn: boolean;
  mode: 'demo' | 'device';
  now?: number;
  snapshot: GuardianStatusSnapshot;
  tone: ReturnType<typeof getStatusTone>;
}) {
  const needsConfirmation = snapshot.status === 'attention' || snapshot.status === 'emergency';
  const headline = !isGuardianOn
    ? '守护已暂停'
    : !guardianReady
      ? '守护需要处理'
      : snapshot.clockUncertain && !needsConfirmation
        ? '设备时间需要确认'
      : snapshot.status === 'unknown'
        ? '守护中'
        : snapshot.headline;
  const detail = !isGuardianOn
    ? '前往“我的”即可恢复自动守护。'
    : !guardianReady
      ? guardianStatus
      : snapshot.clockUncertain && !needsConfirmation
        ? '记录时间与手机当前时间不一致。请检查系统日期与时间；暂不根据这些记录确认安全。'
      : snapshot.status === 'unknown'
        ? guardianStatus
        : snapshot.detail;
  const shieldMark = !isGuardianOn || !guardianReady || snapshot.clockUncertain ? '!' : needsConfirmation ? '!' : '✓';
  const knownPlace = describeCurrentPlace(snapshot, geofences, currentLocation, now);
  const currentPlace = knownPlace.label !== '暂时无法确认' ? knownPlace :
    currentLocationState === 'refreshing'
      ? { label: '正在确认位置', radius: '正在获取当前位置' }
      : currentLocationState === 'error'
        ? { label: '位置暂未确认', radius: '稍后将自动重试' }
        : knownPlace;
  const newestMessage = criticalMessaging?.operations.at(-1);
  const latestMessage = newestMessage
    ? criticalMessaging?.operations.find(
        (operation) =>
          operation.eventId === newestMessage.eventId &&
          (operation.shortcutAttemptPending || operation.shortcutAttemptedAt !== undefined),
      ) ?? newestMessage
    : undefined;
  const messagingTitle = latestMessage?.isTest
    ? '测试短信内容，仅本机记录'
    : latestMessage
    ? latestMessage.status === 'accepted'
      ? '系统已接受家人短信'
      : latestMessage.status === 'sending'
        ? '正在提交家人短信'
        : latestMessage.status === 'retryScheduled'
          ? '家人短信等待重试'
          : latestMessage.status === 'failed'
            ? '家人短信发送失败'
            : latestMessage.status === 'restricted'
              ? criticalMessaging?.buildConfigured ? '家人短信发送受限' : '家人短信已准备'
              : latestMessage.status === 'expired'
                ? '家人短信已过期'
                : latestMessage.status === 'cancelled'
                  ? '本次家人短信已取消'
                  : '家人短信已准备'
    : criticalMessaging?.recipients.length
      ? '家人短信链路已准备'
      : '家人短信尚未准备';

  return (
    <>
      <View style={[styles.heroStatusCard, { backgroundColor: tone.background }]}>
        <View
          accessible
          accessibilityLabel={detail ? `${headline}，${detail}` : headline}
          style={styles.guardianVisual}
        >
          <View
            style={[styles.guardianHaloOuter, { backgroundColor: `${tone.accent}12` }]}
          >
            <View
              style={[styles.guardianHaloMiddle, { backgroundColor: `${tone.accent}22` }]}
            >
              <View style={[styles.guardianHaloCore, { backgroundColor: tone.accent }]}>
                <Image
                  resizeMode="contain"
                  source={require('../assets/guardian-shield.png')}
                  style={styles.guardianShieldImage}
                />
                <Text style={[styles.guardianShieldMark, { color: tone.accent }]}>
                  {shieldMark}
                </Text>
              </View>
            </View>
          </View>
        </View>
        <Text
          style={[styles.statusLabel, styles.centeredStatusLabel, { color: tone.foreground }]}
        >
          自动守护
        </Text>
        <Text style={[styles.heroStatusHeadline, styles.centeredStatusText]}>{headline}</Text>
        {!!detail && (
          <Text style={[styles.heroStatusDetail, styles.centeredStatusText]}>{detail}</Text>
        )}
        <View style={styles.statusFacts}>
          <View style={styles.statusFact}>
            <Text style={styles.statusFactLabel}>所在地点</Text>
            <Text style={styles.statusFactValue}>{currentPlace.label}</Text>
          </View>
          <View style={styles.statusFactDivider} />
          <View style={styles.statusFact}>
            <Text style={styles.statusFactLabel}>守护范围</Text>
            <Text style={styles.statusFactValue}>{currentPlace.radius}</Text>
          </View>
        </View>
      </View>

      {mode === 'device' && (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>{messagingTitle}</Text>
          <Text style={styles.noticeText}>
            {latestMessage
              ? `${latestMessage.contactName}（${latestMessage.phoneNumber}）：${latestMessage.messageText}`
              : criticalMessaging?.recipients.length
                ? `检测到家外无活动、低电量或位置异常后，将为 ${criticalMessaging.recipients.map((recipient) => recipient.name).join('、')} 生成待发送短信。`
                : '请先在“我的”中添加至少一位家人。'}
          </Text>
          <Text style={styles.noticeFootnote}>
            {latestMessage?.detectionContext === 'background' ? '检测时 App 在后台。' :
              latestMessage?.detectionContext === 'restoration' ? '恢复 App 时完成检测。' :
              latestMessage?.detectionContext === 'foreground' ? '检测时 App 在前台。' : ''}
            {criticalMessaging?.buildConfigured
              ? latestMessage?.lastError ??
                `Apple 关键短信能力已配置；已尝试 ${latestMessage?.attemptCount ?? 0}/${criticalMessaging.policy.maximumAttempts} 次。系统接受发送不代表家人已经阅读。`
              : '当前未启用 Apple 关键短信；异常短信只会准备并保存在本机，不会自动运行快捷指令。'}
          </Text>
        </View>
      )}
    </>
  );
}
