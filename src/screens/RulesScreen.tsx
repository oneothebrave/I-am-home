import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
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
  onChangeSchedule: (schedule: GuardianSchedule) => void;
  showRiskExplanation?: boolean;
}) {
  const [error, setError] = useState('');
  const [pickingField, setPickingField] = useState<'startTime' | 'expectedReturnTime'>();
  const pickTime = async (field: 'startTime' | 'expectedReturnTime') => {
    if (pickingField) return;
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
      onChangeSchedule({ ...schedule, startTime: start, expectedReturnTime: end });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开时间选择器，请重试。');
    } finally {
      setPickingField(undefined);
    }
  };
  const updateSchedule = (patch: Partial<GuardianSchedule>) => {
    onChangeSchedule({ ...schedule, ...patch });
  };

  return (
    <>
      <Section title="守护规则">
        {!!error && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="开始守护时间"
          disabled={Boolean(pickingField)}
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
          disabled={Boolean(pickingField)}
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
          value="只在这个时段判断家外长时间无活动；地点进出仍全天记录。"
        />
        <StepperSetting
          label="停留提醒"
          suffix="分钟无明显移动"
          value={schedule.noMotionThresholdMinutes}
          onChange={(noMotionThresholdMinutes) => updateSchedule({ noMotionThresholdMinutes })}
          min={1}
          max={240}
          step={15}
        />
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
