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
  schemaVersion: 2;
  config: GuardianConfig;
  localEvents: GuardianEvent[];
  isGuardianOn: boolean;
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
    schemaVersion: 2,
    config,
    localEvents: mode === 'demo' ? createDemoEvents(now) : [],
    isGuardianOn: mode === 'demo',
    mode,
    updatedAt: new Date(now).toISOString(),
  };
}

export function parseStoredState(value: unknown): GuardianStoredState {
  if (!isRecord(value) || !Array.isArray(value.localEvents) || !isTimestamp(value.updatedAt))
    throw new Error('本机数据格式损坏，读取已停止。');
  const legacy = value.schemaVersion === undefined || value.schemaVersion === 1;
  if (!legacy && value.schemaVersion !== 2) throw new Error('本机数据版本不受支持。');
  const config = parseGuardianConfig(value.config);
  if (
    !legacy &&
    (typeof value.isGuardianOn !== 'boolean' || !['demo', 'device'].includes(String(value.mode)))
  )
    throw new Error('本机运行状态无效。');
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
  return {
    schemaVersion: 2,
    config,
    localEvents: orderGuardianEvents(events.reverse()),
    isGuardianOn: legacy ? true : (value.isGuardianOn as boolean),
    mode: legacy ? 'demo' : (value.mode as GuardianStoredState['mode']),
    updatedAt: new Date(value.updatedAt).toISOString(),
  };
}
