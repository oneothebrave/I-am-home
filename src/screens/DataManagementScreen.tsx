import React, { useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { HISTORY_EVENT_LIMIT, HISTORY_RETENTION_DAYS } from '../domain/dataRetention';
import { styles } from '../styles/appStyles';

export function DataManagementScreen({
  onClear, deletionPending = false, busy = false,
}: {
  onClear: () => Promise<void>;
  deletionPending?: boolean;
  busy?: boolean;
}) {
  const lock = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const clear = async () => {
    if (lock.current || busy) return;
    lock.current = true;
    setWorking(true);
    setError('');
    try {
      await onClear();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '清除未完成，请重试。');
    } finally {
      lock.current = false;
      setWorking(false);
    }
  };
  const confirm = () => Alert.alert(
    '清除所有本机数据？',
    '将停止守护，删除地点、家人联系方式、足迹、风险记录和待发送短信，并恢复测试模式。此操作不能撤销。已交给系统发送的短信、系统权限、快捷指令和已有系统备份不会被撤回或删除。',
    [
      { text: '取消', style: 'cancel' },
      { text: '清除本机数据', style: 'destructive', onPress: () => void clear() },
    ],
  );
  return (
    <>
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>数据保存在本机</Text>
        <Text style={styles.noticeText}>
          地点、家人号码、位置与活动记录用于本机守护；当前没有家人端或服务器同步。
          你主动运行短信测试或分享诊断时，所选内容会交给相应系统服务或接收方。
        </Text>
      </View>
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>历史保存范围</Text>
        <Text style={styles.noticeText}>
          普通历史保留最近 {HISTORY_RETENTION_DAYS} 天、最多 {HISTORY_EVENT_LIMIT} 条。
          未解除告警所需的判断记录和尚未同步的原生事件例外保留，避免误解除或丢失告警。
          时钟回拨后，时间尚未到达的记录会单独保留，时间恢复后再按普通规则整理。
          已结束的短信操作保留最近 30 天、最多 100 条；联系人和地点保留到你删除。
        </Text>
        <Text style={styles.noticeFootnote}>
          清理会在打开 App、导入事件或保存设置时进行，不是后台准点删除。
          本机存储不等于端到端加密；系统备份中已有的副本无法由此页面删除。
          守护提示不能替代紧急求助，也不构成医疗诊断。
        </Text>
      </View>
      {deletionPending && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          上次清除尚未完成。同步和自动启动已锁定，请保持 App 打开并继续清除。
        </Text>
      )}
      {!!error && <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>}
      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy || working}
        onPress={deletionPending ? () => void clear() : confirm}
        style={styles.secondaryOutlineButton}
      >
        <Text style={styles.textDangerButtonText}>
          {busy || working ? '正在清除…' : deletionPending ? '继续清除本机数据' : '清除所有本机数据'}
        </Text>
      </TouchableOpacity>
    </>
  );
}
