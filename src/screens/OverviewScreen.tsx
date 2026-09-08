import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { InfoLine, Metric, Section, SummaryPill } from '../components/Primitives';
import type { NotificationPreview } from '../domain/notificationCopy';
import { getStatusTone } from '../domain/guardianRules';
import type { GuardianConfig, GuardianStatusSnapshot } from '../domain/types';
import { styles } from '../styles/appStyles';
import { formatEventTime } from '../utils/time';

export function OverviewScreen({
  config,
  isGuardianOn,
  isHydrated,
  onResetLocalState,
  onRetryStorage,
  storageStatus,
  nextStep,
  onConfirmSafe,
  onSOS,
  notificationPreview,
  riskReason,
  snapshot,
  storageUpdatedAt,
  tone,
}: {
  config: GuardianConfig;
  isGuardianOn: boolean;
  isHydrated: boolean;
  onConfirmSafe: () => void;
  onResetLocalState: () => void;
  onRetryStorage: () => void;
  storageStatus: string;
  nextStep: string;
  onSOS: () => void;
  notificationPreview: NotificationPreview;
  riskReason: string;
  snapshot: GuardianStatusSnapshot;
  storageUpdatedAt?: string;
  tone: ReturnType<typeof getStatusTone>;
}) {
  return (
    <>
      <View style={[styles.statusPanel, { backgroundColor: tone.background }]}>
        <View style={styles.statusRow}>
          <View style={styles.flexItem}>
            <Text style={[styles.statusLabel, { color: tone.foreground }]}>{tone.label}</Text>
            <Text style={styles.statusHeadline}>{snapshot.headline}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: tone.accent }]} />
        </View>
        <Text style={styles.statusDetail}>
          {isGuardianOn ? snapshot.detail : '暂停后不会主动记录位置事件，也不会自动升级通知家人。'}
        </Text>
        <View style={styles.metricsRow}>
          <Metric label="位置" value={snapshot.locationLabel} />
          <Metric
            label="电量"
            value={snapshot.batteryLevel === undefined ? '未知' : `${snapshot.batteryLevel}%`}
          />
        </View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.primaryButton} activeOpacity={0.8} onPress={onConfirmSafe}>
          <Text style={styles.primaryButtonText}>我没事</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerButton} activeOpacity={0.8} onPress={onSOS}>
          <Text style={styles.dangerButtonText}>求助</Text>
        </TouchableOpacity>
      </View>

      <Section title="最近信号">
        <InfoLine label="最后安全信号" value={snapshot.lastSafeSignal} />
        <InfoLine label="关注原因" value={riskReason} />
        <InfoLine label="下一步" value={nextStep} />
      </Section>

      <Section title="今天概况">
        <View style={styles.summaryGrid}>
          <SummaryPill
            label="守护时段"
            value={`${config.schedule.startTime}-${config.schedule.expectedReturnTime}`}
          />
          <SummaryPill label="地点数量" value={`${config.geofences.length} 个`} />
          <SummaryPill label="家人数量" value={`${config.contacts.length} 位`} />
          <SummaryPill
            label="停留阈值"
            value={`${config.schedule.noMotionThresholdMinutes} 分钟`}
          />
        </View>
      </Section>

      <Section title="本机保存">
        <InfoLine
          label={
            {
              loading: '正在载入',
              idle: '尚未保存',
              saving: '正在保存',
              durable: '已保存到本机',
              memory: '仅保存在内存',
              error: '存储需要重试',
            }[storageStatus] ?? '存储状态未知'
          }
          value={
            storageStatus === 'memory'
              ? '关闭应用后，本次修改可能丢失。'
              : storageUpdatedAt
                ? `上次保存：${formatEventTime(storageUpdatedAt)}`
                : '暂时没有保存记录。'
          }
        />
        {(storageStatus === 'error' || storageStatus === 'memory') && (
          <TouchableOpacity onPress={onRetryStorage} style={styles.exerciseButton}>
            <Text style={styles.exerciseButtonText}>重试存储</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          disabled={!isHydrated}
          activeOpacity={0.8}
          onPress={onResetLocalState}
          style={styles.exerciseButton}
        >
          <Text style={styles.exerciseButtonText}>恢复默认演示数据</Text>
        </TouchableOpacity>
      </Section>

      <Section title="提醒预览">
        <InfoLine
          label={`提醒本人：${notificationPreview.selfTitle}`}
          value={notificationPreview.selfBody}
        />
        <InfoLine
          label={`提醒${notificationPreview.firstContactName}：${notificationPreview.familyTitle}`}
          value={notificationPreview.familyBody}
        />
      </Section>
    </>
  );
}
