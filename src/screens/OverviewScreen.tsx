import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import type { GuardianStatusSnapshot } from '../domain/types';
import type { getStatusTone } from '../domain/guardianRules';
import { styles } from '../styles/appStyles';

export function OverviewScreen({
  guardianReady,
  guardianStatus,
  isGuardianOn,
  mode,
  onConfirmSafe,
  snapshot,
  tone,
}: {
  guardianReady: boolean;
  guardianStatus: string;
  isGuardianOn: boolean;
  mode: 'demo' | 'device';
  onConfirmSafe: () => void;
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

      {needsConfirmation && (
        <TouchableOpacity activeOpacity={0.8} onPress={onConfirmSafe} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>我没事</Text>
        </TouchableOpacity>
      )}

      {mode === 'device' && (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>家人通知尚未启用</Text>
          <Text style={styles.noticeText}>当前异常与守护记录只保存在本机。</Text>
        </View>
      )}
    </>
  );
}
