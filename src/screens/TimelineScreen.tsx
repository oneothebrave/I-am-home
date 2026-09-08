import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Section } from '../components/Primitives';
import type { EscalationState } from '../domain/escalation';
import type { GuardianEvent } from '../domain/types';
import { styles } from '../styles/appStyles';
import { formatClockTime, formatEventTime } from '../utils/time';

export function TimelineScreen({
  escalationState,
  events,
  onAdvanceEscalation,
  onSimulateLocationLost,
  onSimulateReturnHome,
  now,
  canSimulate,
}: {
  escalationState: EscalationState;
  events: GuardianEvent[];
  onAdvanceEscalation: () => void;
  onSimulateLocationLost: () => void;
  onSimulateReturnHome: () => void;
  now: number;
  canSimulate: boolean;
}) {
  return (
    <>
      {canSimulate && (
        <Section title="事件演练">
          <View style={styles.exerciseRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onSimulateReturnHome}
              style={styles.exerciseButton}
            >
              <Text style={styles.exerciseButtonText}>模拟回家</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onSimulateLocationLost}
              style={styles.exerciseButton}
            >
              <Text style={styles.exerciseButtonText}>模拟失联</Text>
            </TouchableOpacity>
          </View>
        </Section>
      )}

      <Section title="升级流程">
        <View style={styles.escalationPanel}>
          <Text style={styles.escalationTitle}>{escalationState.title}</Text>
          <Text style={styles.escalationDescription}>{escalationState.description}</Text>
          <Text style={styles.eventMeta}>
            已记录 {escalationState.notifiedCount} 位接收人
            {escalationState.nextContact ? ` · 下一位 ${escalationState.nextContact.name}` : ''}
          </Text>
        </View>
        {canSimulate && escalationState.nextActionLabel ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={onAdvanceEscalation}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>{escalationState.nextActionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </Section>

      <Section title="守护记录">
        {events.map((event) => (
          <View style={styles.eventRow} key={event.id}>
            <Text style={styles.eventTime}>{formatClockTime(event.timestamp)}</Text>
            <View style={styles.eventBody}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <Text style={styles.eventDescription}>{event.description}</Text>
              <Text style={styles.eventMeta}>
                {formatEventTime(event.timestamp, now)}
                {event.simulated ? ' · 演练' : ''}
                {event.batteryLevel !== undefined ? ` · 电量 ${event.batteryLevel}%` : ''}
              </Text>
            </View>
          </View>
        ))}
      </Section>
    </>
  );
}
