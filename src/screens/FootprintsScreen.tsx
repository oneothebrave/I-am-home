import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { GuardianEvent, GuardianEventType } from '../domain/types';
import { styles } from '../styles/appStyles';
import { formatEventTime } from '../utils/time';

const footprintTypes = new Set<GuardianEventType>([
  'LEAVE_HOME',
  'ENTER_WORK_AREA',
  'EXIT_WORK_AREA',
  'RETURN_HOME',
  'ENTER_WAYPOINT',
  'EXIT_WAYPOINT',
  'MOTION_DETECTED',
]);

const duplicateWindowMs = 5 * 60 * 1000;
export const FOOTPRINT_PAGE_SIZE = 40;

function transitionKey(event: GuardianEvent) {
  return [event.type, event.geofenceId ?? '', event.locationLabel ?? '', event.title].join('|');
}

export function getFootprintEvents(events: GuardianEvent[]) {
  const ordered = events
    .filter((event) => footprintTypes.has(event.type))
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return ordered.filter((event, index) => {
    const newer = ordered[index - 1];
    if (!newer || transitionKey(newer) !== transitionKey(event)) return true;
    const interval = Date.parse(newer.timestamp) - Date.parse(event.timestamp);
    return !Number.isFinite(interval) || interval > duplicateWindowMs;
  });
}

export function FootprintsScreen({ events, now }: { events: GuardianEvent[]; now: number }) {
  const footprints = useMemo(() => getFootprintEvents(events), [events]);
  // Anchor older pages by ID so live arrivals do not push the visible records.
  // If retention removes that anchor, fall back to the latest available page.
  const [anchor, setAnchor] = useState<string>();
  const start = anchor ? Math.max(0, footprints.findIndex((event) => event.id === anchor)) : 0;
  const visible = footprints.slice(start, start + FOOTPRINT_PAGE_SIZE);

  return (
    <>
      <View style={styles.footprintPrivacyCard}>
        <Text style={styles.footprintPrivacyTitle}>足迹只保存在本机</Text>
        <Text style={styles.footprintPrivacyText}>
          这里记录到达、离开和可信活动来源，不显示精确坐标，数据只保存在本机。
        </Text>
      </View>

      {footprints.length === 0 ? (
        <View style={[styles.emptyStateCard, styles.footprintEmptyCard]}>
          <Text style={styles.emptyStateTitle}>还没有足迹或活动记录</Text>
          <Text style={styles.emptyStateText}>到达、离开守护地点或检测到可信活动后，会记录在这里。</Text>
        </View>
      ) : (
        <View style={styles.footprintList}>
          <Text style={styles.settingHelpText}>
            第 {start + 1}–{start + visible.length} 条，共 {footprints.length} 条
          </Text>
          {visible.map((event) => (
            <View style={styles.footprintRow} key={event.id}>
              <View style={styles.footprintMarker}>
                <View style={styles.footprintMarkerDot} />
              </View>
              <View style={styles.flexItem}>
                <Text style={styles.footprintTitle}>{event.title}</Text>
                {!!event.locationLabel && (
                  <Text style={styles.footprintLocation}>{event.locationLabel}</Text>
                )}
                {event.type === 'MOTION_DETECTED' && (
                  <Text style={styles.footprintLocation}>{event.description}</Text>
                )}
                <Text style={styles.footprintTime}>{formatEventTime(event.timestamp, now)}</Text>
              </View>
            </View>
          ))}
          {start > 0 && (
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryOutlineButton}
              onPress={() => setAnchor(start > FOOTPRINT_PAGE_SIZE
                ? footprints[start - FOOTPRINT_PAGE_SIZE].id : undefined)}>
              <Text style={styles.secondaryOutlineButtonText}>较新记录</Text>
            </TouchableOpacity>
          )}
          {start + FOOTPRINT_PAGE_SIZE < footprints.length && (
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryOutlineButton}
              onPress={() => setAnchor(footprints[start + FOOTPRINT_PAGE_SIZE].id)}>
              <Text style={styles.secondaryOutlineButtonText}>更早记录</Text>
            </TouchableOpacity>
          )}
          {start > 0 && (
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryOutlineButton}
              onPress={() => setAnchor(undefined)}>
              <Text style={styles.secondaryOutlineButtonText}>回到最新记录</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </>
  );
}
