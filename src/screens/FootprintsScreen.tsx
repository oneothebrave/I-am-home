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
  'LOCATION_UPDATED',
  'ENTER_WAYPOINT',
  'EXIT_WAYPOINT',
]);

export function getFootprintEvents(events: GuardianEvent[]) {
  return events
    .filter((event) => footprintTypes.has(event.type))
    .slice()
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export function FootprintsScreen({ events, now }: { events: GuardianEvent[]; now: number }) {
  const footprints = getFootprintEvents(events);

  return (
    <>
      <View style={styles.footprintPrivacyCard}>
        <Text style={styles.footprintPrivacyTitle}>足迹只保存在本机</Text>
        <Text style={styles.footprintPrivacyText}>这里只记录到达或离开守护地点，不显示精确坐标。</Text>
      </View>

      {footprints.length === 0 ? (
        <View style={[styles.emptyStateCard, styles.footprintEmptyCard]}>
          <Text style={styles.emptyStateTitle}>还没有足迹</Text>
          <Text style={styles.emptyStateText}>到达或离开守护地点后，会自动记录在这里。</Text>
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
                <Text style={styles.footprintTime}>{formatEventTime(event.timestamp, now)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}
