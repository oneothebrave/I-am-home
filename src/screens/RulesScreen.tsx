import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { scheduleForMode } from '../domain/monitoringPolicy';
import { InfoLine, Section, StepperSetting } from '../components/Primitives';
import type { GuardianSchedule } from '../domain/types';
import { styles } from '../styles/appStyles';
import { isClockTime } from '../domain/validation';
import { getGuardianNative } from '../native/GuardianNative';

export function RulesScreen({
  schedule,
  onChangeSchedule,
  showRiskExplanation = true,
}: {
  schedule: GuardianSchedule;
  onChangeSchedule: (schedule: GuardianSchedule) => void | Promise<void>;
  showRiskExplanation?: boolean;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const updateSchedule = async (patch: Partial<GuardianSchedule>) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onChangeSchedule({ ...schedule, ...patch }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '规则保存失败。'); }
    finally { setSaving(false); }
  };
  const changeMode = () => {
    const target = schedule.monitoringMode === 'test' ? 'standard' : 'test';
    Alert.alert(target === 'test' ? '进入测试模式？' : '进入正式模式？',
      target === 'test'
        ? '测试告警只保存在本机。切换会结束本轮风险检查，并取消尚未发送的告警。'
        : '将检查真实地点、家人联系方式和定位权限。短于 15 分钟的测试阈值会恢复为 120 分钟；当前短信能力仍以实际状态为准。',
      [{ text: '取消', style: 'cancel' },
       { text: '确认切换', onPress: () => void updateSchedule(scheduleForMode(schedule, target)) }]);
  };
  const [pickingField, setPickingField] = useState<'startTime' | 'expectedReturnTime'>();
  const pickTime = async (field: 'startTime' | 'expectedReturnTime') => {
    if (pickingField || saving) return;
    setError('');
    setPickingField(field);
    try {
      const selected = await getGuardianNative().pickTime(
        schedule[field],
        field === 'startTime' ? '开始守护时间' : '结束守护时间',
      );
      if (!selected) return;
      const start = field === 'startTime' ? selected : schedule.startTime;
      const end = field === 'expectedReturnTime' ? selected : schedule.expectedReturnTime;
      if (!isClockTime(start) || !isClockTime(end) || start >= end) {
        setError('结束时间应晚于开始时间。');
        return;
      }
      await updateSchedule({ startTime: start, expectedReturnTime: end });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开时间选择器，请重试。');
    } finally {
      setPickingField(undefined);
    }
  };

  return (
    <>
      <Section title="守护规则">
        <InfoLine label="守护模式" value={schedule.monitoringMode === 'test' ? '测试模式' : '正式模式'} />
        <TouchableOpacity accessibilityRole="button" disabled={saving || Boolean(pickingField)}
          onPress={changeMode} style={styles.secondaryOutlineButton}>
          <Text style={styles.secondaryOutlineButtonText}>
            {schedule.monitoringMode === 'test' ? '切换到正式模式' : '进入测试模式'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.settingHelpText}>
          {schedule.monitoringMode === 'test'
            ? '测试告警会标记“测试”，仅保存在本机，不会自动发送短信。'
            : '正式模式的时间阈值最短为 15 分钟；自动通知仍取决于短信能力和逐位家人授权。'}
        </Text>
        {!!error && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="开始守护时间"
          disabled={Boolean(pickingField) || saving}
          onPress={() => void pickTime('startTime')}
          style={styles.timePickerRow}
        >
          <Text style={styles.timePickerLabel}>开始时间</Text>
          <View style={styles.timePickerValueGroup}>
            <Text style={styles.timePickerValue}>{schedule.startTime}</Text>
            <Text style={styles.settingsChevron}>›</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="结束守护时间"
          disabled={Boolean(pickingField) || saving}
          onPress={() => void pickTime('expectedReturnTime')}
          style={styles.timePickerRow}
        >
          <Text style={styles.timePickerLabel}>结束时间</Text>
          <View style={styles.timePickerValueGroup}>
            <Text style={styles.timePickerValue}>{schedule.expectedReturnTime}</Text>
            <Text style={styles.settingsChevron}>›</Text>
          </View>
        </TouchableOpacity>
        <InfoLine
          label="时段作用"
          value="家外无活动和位置过旧只在这个时段判断；地点进出、家外低电量及权限异常仍会在系统运行机会中检查。"
        />
        <StepperSetting
          label="停留提醒"
          suffix="分钟无明显移动"
          value={schedule.noMotionThresholdMinutes}
          onChange={(noMotionThresholdMinutes) => void updateSchedule({ noMotionThresholdMinutes })}
          disabled={saving}
          min={schedule.monitoringMode === 'test' ? 1 : 15}
          max={240}
          step={schedule.monitoringMode === 'test' ? 1 : 15}
        />
        <StepperSetting label="可信位置中断" suffix="分钟未取得新位置"
          value={schedule.locationLostThresholdMinutes}
          onChange={(locationLostThresholdMinutes) => void updateSchedule({ locationLostThresholdMinutes })}
          disabled={saving} min={schedule.monitoringMode === 'test' ? 1 : 15} max={240}
          step={schedule.monitoringMode === 'test' ? 1 : 15} />
        <InfoLine label="家外低电量" value="低于 20% 且未充电时提醒；充电、电量恢复或回家后解除。" />
        {schedule.monitoringMode === 'test' && (
          <TouchableOpacity accessibilityRole="button" disabled={saving}
            onPress={() => void updateSchedule({ noMotionThresholdMinutes: 1, locationLostThresholdMinutes: 1 })}
            style={styles.secondaryOutlineButton}>
            <Text style={styles.secondaryOutlineButtonText}>使用 1 分钟测试阈值</Text>
          </TouchableOpacity>
        )}
      </Section>

      {showRiskExplanation && (
        <Section title="风险判断">
          <InfoLine label="绿色" value="离家、到达劳作地、回家、有移动，都可以续上安全状态。" />
          <InfoLine label="黄色" value="守护时段内家外长时间无活动，或出现低电量，需要通知家人留意。" />
          <InfoLine label="红色" value="多个风险叠加时，提醒家人尽快联系确认。" />
        </Section>
      )}
    </>
  );
}
