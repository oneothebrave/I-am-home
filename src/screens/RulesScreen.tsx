import React from 'react';
import { Text, TextInput } from 'react-native';
import { InfoLine, Section, StepperSetting } from '../components/Primitives';
import type { GuardianSchedule } from '../domain/types';
import { styles } from '../styles/appStyles';

export function RulesScreen({
  schedule,
  onChangeSchedule,
}: {
  schedule: GuardianSchedule;
  onChangeSchedule: (schedule: GuardianSchedule) => void;
}) {
  const updateSchedule = (patch: Partial<GuardianSchedule>) => {
    onChangeSchedule({ ...schedule, ...patch });
  };

  return (
    <>
      <Section title="守护规则">
        <Text style={styles.formLabel}>开始守护</Text>
        <TextInput
          onChangeText={startTime => updateSchedule({ startTime })}
          placeholder="07:00"
          placeholderTextColor="#9A9387"
          style={styles.input}
          value={schedule.startTime}
        />
        <Text style={styles.formLabel}>预计回家</Text>
        <TextInput
          onChangeText={expectedReturnTime => updateSchedule({ expectedReturnTime })}
          placeholder="18:00"
          placeholderTextColor="#9A9387"
          style={styles.input}
          value={schedule.expectedReturnTime}
        />
        <StepperSetting
          label="停留提醒"
          suffix="分钟无明显移动"
          value={schedule.noMotionThresholdMinutes}
          onChange={noMotionThresholdMinutes => updateSchedule({ noMotionThresholdMinutes })}
          min={30}
          max={240}
          step={15}
        />
        <StepperSetting
          label="通知升级"
          suffix="分钟后通知家人"
          value={schedule.escalationDelayMinutes}
          onChange={escalationDelayMinutes => updateSchedule({ escalationDelayMinutes })}
          min={5}
          max={60}
          step={5}
        />
      </Section>

      <Section title="风险判断">
        <InfoLine label="绿色" value="离家、到达劳作地、回家、有移动，都可以续上安全状态。" />
        <InfoLine label="黄色" value="长时间停留、超过预计回家时间、低电量时先提醒本人。" />
        <InfoLine label="红色" value="本人未响应，或多个风险叠加时通知家人。" />
      </Section>
    </>
  );
}
