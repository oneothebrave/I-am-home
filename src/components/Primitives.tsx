import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { styles } from '../styles/appStyles';
import { clamp } from '../utils/number';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function StepperSetting({
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}) {
  return (
    <View style={styles.stepperRow}>
      <View style={styles.flexItem}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <Text style={styles.stepperValue}>
          {value} {suffix}
        </Text>
      </View>
      <View style={styles.stepperActions}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onChange(clamp(value - step, min, max))}
          style={styles.iconButton}>
          <Text style={styles.iconButtonText}>-</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onChange(clamp(value + step, min, max))}
          style={styles.iconButton}>
          <Text style={styles.iconButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryPill}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}
