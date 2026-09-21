import React, { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { InfoLine, Section, StepperSetting } from '../components/Primitives';
import type { GuardianSchedule } from '../domain/types';
import { styles } from '../styles/appStyles';
import { isClockTime } from '../domain/validation';

export function RulesScreen({
  schedule,
  onChangeSchedule,
  showRiskExplanation = true,
}: {
  schedule: GuardianSchedule;
  onChangeSchedule: (schedule: GuardianSchedule) => void;
  showRiskExplanation?: boolean;
}) {
  const [startTime, setStartTime] = useState(schedule.startTime);
  const [returnTime, setReturnTime] = useState(schedule.expectedReturnTime);
  const [error, setError] = useState('');
  useEffect(() => {
    setStartTime(schedule.startTime);
    setReturnTime(schedule.expectedReturnTime);
  }, [schedule.startTime, schedule.expectedReturnTime]);
  const commitTime = (field: 'startTime' | 'expectedReturnTime', text: string) => {
    const start = field === 'startTime' ? text : startTime;
    const end = field === 'expectedReturnTime' ? text : returnTime;
    if (!isClockTime(start) || !isClockTime(end) || start >= end) {
      setError('请输入有效的 HH:mm 时间，回家时间应晚于开始时间。');
      return;
    }
    setError('');
    onChangeSchedule({ ...schedule, startTime: start, expectedReturnTime: end });
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
        <Text style={styles.formLabel}>开始守护</Text>
        <TextInput
          onChangeText={setStartTime}
          onEndEditing={(event) => commitTime('startTime', event.nativeEvent.text)}
          accessibilityLabel="开始守护时间"
          maxLength={5}
          placeholder="07:00"
          placeholderTextColor="#9A9387"
          style={styles.input}
          value={startTime}
        />
        <Text style={styles.formLabel}>预计回家</Text>
        <TextInput
          onChangeText={setReturnTime}
          onEndEditing={(event) => commitTime('expectedReturnTime', event.nativeEvent.text)}
          accessibilityLabel="预计回家时间"
          maxLength={5}
          placeholder="18:00"
          placeholderTextColor="#9A9387"
          style={styles.input}
          value={returnTime}
        />
        <StepperSetting
          label="停留提醒"
          suffix="分钟无明显移动"
          value={schedule.noMotionThresholdMinutes}
          onChange={(noMotionThresholdMinutes) => updateSchedule({ noMotionThresholdMinutes })}
          min={30}
          max={240}
          step={15}
        />
        <StepperSetting
          label="通知升级"
          suffix="分钟后通知家人"
          value={schedule.escalationDelayMinutes}
          onChange={(escalationDelayMinutes) => updateSchedule({ escalationDelayMinutes })}
          min={5}
          max={60}
          step={5}
        />
      </Section>

      {showRiskExplanation && (
        <Section title="风险判断">
          <InfoLine label="绿色" value="离家、到达劳作地、回家、有移动，都可以续上安全状态。" />
          <InfoLine label="黄色" value="长时间停留、超过预计回家时间或低电量，需要通知家人留意。" />
          <InfoLine label="红色" value="多个风险叠加时，提醒家人尽快联系确认。" />
        </Section>
      )}
    </>
  );
}
