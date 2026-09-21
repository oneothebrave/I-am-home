import React from 'react';
import { Image, Text, View } from 'react-native';
import type { GuardianGeofence, GuardianStatusSnapshot } from '../domain/types';
import type { CurrentLocationSample } from '../domain/validation';
import type { getStatusTone } from '../domain/guardianRules';
import type { CriticalMessagingPreparation } from '../native/criticalMessaging';
import { styles } from '../styles/appStyles';

const enteringTypes = new Set(['RETURN_HOME', 'ENTER_WORK_AREA', 'ENTER_WAYPOINT']);
const exitingTypes = new Set(['LEAVE_HOME', 'EXIT_WORK_AREA', 'EXIT_WAYPOINT']);

function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function describePoint(
  point: { latitude: number; longitude: number },
  geofences: GuardianGeofence[],
) {
  const fence = geofences
    .map((candidate) => ({
      fence: candidate,
      distance: distanceMeters(point, candidate.center),
    }))
    .filter(({ fence: candidate, distance }) => distance <= candidate.radiusMeters)
    .sort((a, b) => a.distance - b.distance)[0]?.fence;
  if (fence)
    return {
      label: fence.kind === 'home' ? '家中' : fence.name,
      radius: `周围 ${fence.radiusMeters} 米`,
    };
  return { label: '守护地点外', radius: '未进入已设置地点' };
}

export function describeCurrentPlace(
  snapshot: GuardianStatusSnapshot,
  geofences: GuardianGeofence[],
  currentLocation?: CurrentLocationSample,
) {
  const newestPositionEventAt = snapshot.events.reduce((latest, event) => {
    if (!(event.source === 'location' && event.location) && !enteringTypes.has(event.type) && !exitingTypes.has(event.type))
      return latest;
    const timestamp = Date.parse(event.timestamp);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  if (
    currentLocation &&
    Date.parse(currentLocation.timestamp) >= newestPositionEventAt
  )
    return describePoint(currentLocation, geofences);

  for (const event of [...snapshot.events].reverse()) {
    // Motion/risk events can carry an old cached point; their timestamp is not a GPS timestamp.
    if (event.source === 'location' && event.location) return describePoint(event.location, geofences);
    if (enteringTypes.has(event.type)) {
      const fence =
        geofences.find((candidate) => candidate.id === event.geofenceId) ??
        geofences.find((candidate) =>
          `${event.locationLabel ?? ''}${event.title}`.includes(candidate.name),
        );
      if (fence)
        return {
          label: fence.kind === 'home' ? '家中' : fence.name,
          radius: `周围 ${fence.radiusMeters} 米`,
        };
    }
    if (exitingTypes.has(event.type))
      return { label: '守护地点外', radius: '未进入已设置地点' };
  }
  const matched = geofences.find((fence) => snapshot.locationLabel.includes(fence.name));
  if (matched)
    return {
      label: matched.kind === 'home' ? '家中' : matched.name,
      radius: `周围 ${matched.radiusMeters} 米`,
    };
  return { label: '位置尚未确认', radius: '等待新的位置记录' };
}

export function OverviewScreen({
  criticalMessaging,
  currentLocation,
  currentLocationState,
  geofences,
  guardianReady,
  guardianStatus,
  isGuardianOn,
  mode,
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
  snapshot: GuardianStatusSnapshot;
  tone: ReturnType<typeof getStatusTone>;
}) {
  const needsConfirmation = snapshot.status === 'attention' || snapshot.status === 'emergency';
  const headline = !isGuardianOn
    ? '守护已暂停'
    : !guardianReady
      ? '守护需要处理'
      : snapshot.status === 'unknown'
        ? '守护中'
        : snapshot.headline;
  const detail = !isGuardianOn
    ? '前往“我的”即可恢复自动守护。'
    : !guardianReady
      ? guardianStatus
      : snapshot.status === 'unknown'
        ? guardianStatus
        : snapshot.detail;
  const shieldMark = !isGuardianOn || !guardianReady ? '!' : needsConfirmation ? '!' : '✓';
  const knownPlace = describeCurrentPlace(snapshot, geofences, currentLocation);
  const currentPlace = knownPlace.label !== '位置尚未确认' ? knownPlace :
    currentLocationState === 'refreshing'
      ? { label: '正在确认位置', radius: '正在获取当前位置' }
      : currentLocationState === 'error'
        ? { label: '位置暂未确认', radius: '稍后将自动重试' }
        : describeCurrentPlace(snapshot, geofences, currentLocation);
  const newestMessage = criticalMessaging?.operations.at(-1);
  const latestMessage = newestMessage
    ? criticalMessaging?.operations.find(
        (operation) =>
          operation.eventId === newestMessage.eventId &&
          (operation.shortcutAttemptPending || operation.shortcutAttemptedAt !== undefined),
      ) ?? newestMessage
    : undefined;
  const messagingTitle = latestMessage
    ? latestMessage.status === 'sent'
      ? '家人短信已发送'
      : latestMessage.status === 'failed'
        ? '家人短信发送失败'
          : latestMessage.shortcutOpenSucceeded === true
          ? '已尝试运行短信快捷指令'
          : latestMessage.shortcutOpenSucceeded === false
            ? '短信快捷指令未能启动'
            : latestMessage.shortcutAttemptError
              ? latestMessage.shortcutAttemptedAt ? '短信快捷指令结果未确认' : '短信未自动发送'
            : latestMessage.shortcutAttemptedAt
              ? '正在尝试运行短信快捷指令'
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
                ? `检测到家外长时间无活动后，将为 ${criticalMessaging.recipients.map((recipient) => recipient.name).join('、')} 生成待发送短信。`
                : '请先在“我的”中添加至少一位家人。'}
          </Text>
          <Text style={styles.noticeFootnote}>
            {latestMessage?.detectionContext === 'background' ? '检测时 App 在后台。' :
              latestMessage?.detectionContext === 'restoration' ? '恢复 App 时完成检测。' :
              latestMessage?.detectionContext === 'foreground' ? '检测时 App 在前台。' : ''}
            {criticalMessaging?.buildConfigured
              ? 'Apple 关键短信能力已配置；实际发送结果会单独记录。'
              : latestMessage?.shortcutOpenSucceeded === true
                ? 'iOS 已接受打开快捷指令的请求；这不代表短信已经发送或送达。'
                : latestMessage?.shortcutOpenSucceeded === false
                  ? latestMessage.shortcutAttemptError ?? 'iOS 未允许打开快捷指令；待发送内容仍保存在本机。'
                  : latestMessage?.shortcutAttemptError
                    ? latestMessage.shortcutAttemptError
                  : '当前未启用 Apple 关键短信；检测到异常后会尝试运行已安装的短信快捷指令。'}
          </Text>
        </View>
      )}
    </>
  );
}
