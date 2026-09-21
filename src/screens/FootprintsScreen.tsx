import React from 'react';
import { Text, View } from 'react-native';
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
  const footprints = getFootprintEvents(events);

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
          {footprints.map((event) => (
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
        </View>
      )}
    </>
  );
}
