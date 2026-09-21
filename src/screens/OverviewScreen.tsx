import React from 'react';
import { Image, Text, View } from 'react-native';
import type { GuardianStatusSnapshot } from '../domain/types';
import type { getStatusTone } from '../domain/guardianRules';
import { styles } from '../styles/appStyles';

export function OverviewScreen({
  guardianReady,
  guardianStatus,
  isGuardianOn,
  mode,
  snapshot,
  tone,
}: {
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
        ? '正在后台安静守护，暂时还没有新的可信信号。'
        : snapshot.detail;
  const shieldMark = !isGuardianOn || !guardianReady ? '!' : needsConfirmation ? '!' : '✓';

  return (
    <>
      <Text style={styles.screenTitle}>今天</Text>
      <View style={[styles.heroStatusCard, { backgroundColor: tone.background }]}>
        <View
          accessible
          accessibilityLabel={`${headline}，${detail}`}
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
        <Text style={[styles.heroStatusDetail, styles.centeredStatusText]}>{detail}</Text>
        <View style={styles.statusFacts}>
          <View style={styles.statusFact}>
            <Text style={styles.statusFactLabel}>当前位置</Text>
            <Text style={styles.statusFactValue}>{snapshot.locationLabel}</Text>
          </View>
          <View style={styles.statusFactDivider} />
          <View style={styles.statusFact}>
            <Text style={styles.statusFactLabel}>最后信号</Text>
            <Text style={styles.statusFactValue}>{snapshot.lastSafeSignal}</Text>
          </View>
        </View>
      </View>

      {mode === 'device' && (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>自动家人通知尚未启用</Text>
          <Text style={styles.noticeText}>
            当前可以在本机识别并记录异常；短信快捷指令仍只支持主动测试。
          </Text>
        </View>
      )}
    </>
  );
}
