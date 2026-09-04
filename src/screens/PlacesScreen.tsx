import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { InfoLine, Section } from '../components/Primitives';
import { getGeofenceKindLabel, getMockCurrentPoint } from '../domain/geofenceHelpers';
import type { GuardianGeofence } from '../domain/types';
import { styles } from '../styles/appStyles';
import { clamp } from '../utils/number';

export function PlacesScreen({
  geofences,
  onAddGeofence,
  onAdjustRadius,
  onRemoveGeofence,
}: {
  geofences: GuardianGeofence[];
  onAddGeofence: (geofence: GuardianGeofence) => void;
  onAdjustRadius: (id: string, delta: number) => void;
  onRemoveGeofence: (id: string) => void;
}) {
  const [newPlaceName, setNewPlaceName] = useState('菜地');
  const [newPlaceKind, setNewPlaceKind] = useState<GuardianGeofence['kind']>('work');
  const [newPlaceRadius, setNewPlaceRadius] = useState(320);

  const handleAddPlace = () => {
    const name = newPlaceName.trim();

    if (!name) {
      return;
    }

    onAddGeofence({
      id: `place-${Date.now()}`,
      name,
      kind: newPlaceKind,
      center: getMockCurrentPoint(newPlaceKind, geofences.length),
      radiusMeters: newPlaceRadius,
    });
    setNewPlaceName('');
  };

  return (
    <>
      <Section title="守护地点">
        {geofences.map(geofence => (
          <View style={styles.placeRow} key={geofence.id}>
            <View style={styles.flexItem}>
              <Text style={styles.rowTitle}>{geofence.name}</Text>
              <Text style={styles.rowMeta}>
                {geofence.center.latitude.toFixed(4)}, {geofence.center.longitude.toFixed(4)} · 半径 {geofence.radiusMeters} 米
              </Text>
            </View>
            <View style={styles.rowBadge}>
              <Text style={styles.rowBadgeText}>{getGeofenceKindLabel(geofence.kind)}</Text>
            </View>
            <View style={styles.inlineActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onAdjustRadius(geofence.id, -50)}
                style={styles.iconButton}>
                <Text style={styles.iconButtonText}>-</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onAdjustRadius(geofence.id, 50)}
                style={styles.iconButton}>
                <Text style={styles.iconButtonText}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onRemoveGeofence(geofence.id)}
                style={styles.removeButton}>
                <Text style={styles.removeButtonText}>删</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </Section>

      <Section title="新增地点">
        <TextInput
          onChangeText={setNewPlaceName}
          placeholder="地点名称"
          placeholderTextColor="#9A9387"
          style={styles.input}
          value={newPlaceName}
        />
        <View style={styles.segmentRow}>
          {(['home', 'work', 'waypoint'] as const).map(kind => {
            const isActive = newPlaceKind === kind;
            return (
              <TouchableOpacity
                activeOpacity={0.8}
                key={kind}
                onPress={() => setNewPlaceKind(kind)}
                style={[styles.segmentButton, isActive && styles.segmentButtonActive]}>
                <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
                  {getGeofenceKindLabel(kind)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.stepperRow}>
          <Text style={styles.stepperLabel}>围栏半径 {newPlaceRadius} 米</Text>
          <View style={styles.stepperActions}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setNewPlaceRadius(value => clamp(value - 50, 100, 1000))}
              style={styles.iconButton}>
              <Text style={styles.iconButtonText}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setNewPlaceRadius(value => clamp(value + 50, 100, 1000))}
              style={styles.iconButton}>
              <Text style={styles.iconButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity activeOpacity={0.8} onPress={handleAddPlace} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>用当前位置新增地点</Text>
        </TouchableOpacity>
      </Section>

      <Section title="采点方式">
        <InfoLine label="推荐" value="站在地点附近，使用当前位置设为家或劳作地点。" />
        <InfoLine label="半径建议" value="家 100-200 米，山地或果园 300-800 米。" />
        <InfoLine label="下一版" value="接入地图选点、当前位置采点、围栏半径滑块。" />
      </Section>
    </>
  );
}
