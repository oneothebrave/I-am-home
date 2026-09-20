import { createDemoEvents, guardianConfig } from '../domain/mockData';
import { orderGuardianEvents } from '../domain/guardianProjection';
import {
  isClockTime,
  isRecord,
  isTimestamp,
  parseGuardianConfig,
  parseGuardianEvent,
} from '../domain/validation';
import type { GuardianConfig, GuardianEvent } from '../domain/types';

export interface GuardianStoredState {
  schemaVersion: 3;
  config: GuardianConfig;
  localEvents: GuardianEvent[];
  isGuardianOn: boolean;
  isGuardianPaused: boolean;
  mode: 'demo' | 'device';
  updatedAt: string;
}

export function createInitialStoredState(
  now = Date.now(),
  mode: GuardianStoredState['mode'] = 'demo',
): GuardianStoredState {
  const config = JSON.parse(JSON.stringify(guardianConfig)) as GuardianConfig;
  if (mode === 'device') {
    config.contacts = [];
    config.geofences = [];
  }
  return {
    schemaVersion: 3,
    config,
    localEvents: mode === 'demo' ? createDemoEvents(now) : [],
    isGuardianOn: mode === 'demo',
    isGuardianPaused: false,
    mode,
    updatedAt: new Date(now).toISOString(),
  };
}

export function parseStoredState(value: unknown): GuardianStoredState {
  if (!isRecord(value) || !Array.isArray(value.localEvents) || !isTimestamp(value.updatedAt))
    throw new Error('本机数据格式损坏，读取已停止。');
  const legacy = value.schemaVersion === undefined || value.schemaVersion === 1;
  const version2 = value.schemaVersion === 2;
  if (!legacy && !version2 && value.schemaVersion !== 3)
    throw new Error('本机数据版本不受支持。');
  const config = parseGuardianConfig(value.config);
  if (
    !legacy &&
    (typeof value.isGuardianOn !== 'boolean' || !['demo', 'device'].includes(String(value.mode)))
  )
    throw new Error('本机运行状态无效。');
  if (value.schemaVersion === 3 && typeof value.isGuardianPaused !== 'boolean')
    throw new Error('本机守护偏好无效。');
  let cursor = new Date(value.updatedAt);
  const events: GuardianEvent[] = [];
  // v1 only stored HH:mm. Infer the latest possible local date, walking backwards
  // across midnight. The original date cannot be recovered with certainty.
  for (const raw of [...value.localEvents].reverse()) {
    if (!isRecord(raw)) throw new Error('事件数据损坏。');
    let timestamp = raw.timestamp;
    if (legacy && isClockTime(timestamp)) {
      const candidate = new Date(cursor);
      const [hour, minute] = timestamp.split(':').map(Number);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() > cursor.getTime()) candidate.setDate(candidate.getDate() - 1);
      timestamp = candidate.toISOString();
    }
    const event = parseGuardianEvent({ ...raw, timestamp });
    cursor = new Date(event.timestamp);
    events.push(event);
  }
  const mode = legacy ? 'demo' : (value.mode as GuardianStoredState['mode']);
  const isGuardianOn = legacy ? true : (value.isGuardianOn as boolean);
  return {
    schemaVersion: 3,
    config,
    localEvents: orderGuardianEvents(events.reverse()),
    isGuardianOn,
    isGuardianPaused:
      value.schemaVersion === 3
        ? (value.isGuardianPaused as boolean)
        : mode === 'device' && !isGuardianOn && config.geofences.length > 0,
    mode,
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}
