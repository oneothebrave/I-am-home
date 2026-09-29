import { isRecord } from '../domain/validation';
import type { GuardianNativeStatus, PermissionState } from './GuardianNative';

export const NATIVE_READ_TIMEOUT_MS = 8_000;

// Only for side-effect-free reads. A deadline does not cancel a native call;
// never use this helper to unlock/retry writes, permissions prompts or deletion.
export function guardedNativeRead<T>(
  read: () => Promise<unknown>,
  parse: (value: unknown) => T,
  label: string,
  timeoutMs = NATIVE_READ_TIMEOUT_MS,
) {
  let inFlight: Promise<T> | undefined;
  return () => {
    if (inFlight) return inFlight;
    const request = new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error(`${label}超时，请重试。`));
      }, timeoutMs);
      Promise.resolve().then(read).then((value) => {
        if (settled) return;
        try { resolve(parse(value)); } catch (error) { reject(error); }
        settled = true;
        clearTimeout(timer);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
    inFlight = request;
    const clear = () => { if (inFlight === request) inFlight = undefined; };
    request.then(clear, clear);
    return request;
  };
}

function invalid(): never { throw new Error('原生状态格式无效，请更新匹配的 App 版本后重试。'); }
function record(value: unknown) {
  if (!isRecord(value)) return invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid();
  return value;
}
function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      !Number.isFinite(new Date(value).getTime())) return invalid();
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return invalid();
  return value as T;
}

export function parsePermissionState(value: unknown): PermissionState {
  const raw = record(value);
  return {
    location: choice(raw.location, ['notDetermined', 'denied', 'restricted', 'whenInUse', 'always']),
    locationAccuracy: choice(raw.locationAccuracy, ['unknown', 'reduced', 'full']),
    motion: choice(raw.motion, ['notDetermined', 'denied', 'restricted', 'authorized']),
    notifications: choice(raw.notifications, ['notDetermined', 'denied', 'authorized']),
    backgroundRefresh: choice(raw.backgroundRefresh, ['available', 'denied', 'restricted']),
  };
}

export function parseGuardianNativeStatus(value: unknown): GuardianNativeStatus {
  const raw = record(value);
  if (typeof raw.pendingEventCount !== 'number' || !Number.isSafeInteger(raw.pendingEventCount) ||
      raw.pendingEventCount < 0) return invalid();
  const reliability = optional(raw.reliability, record);
  const health = optional(raw.riskHealth, record);
  return {
    isGuardianOn: bool(raw.isGuardianOn),
    isGuardianPaused: bool(raw.isGuardianPaused),
    isMonitoring: bool(raw.isMonitoring),
    isInActiveWindow: bool(raw.isInActiveWindow),
    pendingEventCount: raw.pendingEventCount,
    // Older builds omit these fields. Do not invent a confirmed mode or health.
    dataDeletionPending: optional(raw.dataDeletionPending, bool),
    monitoringMode: optional(raw.monitoringMode, (mode) => choice(mode, ['test', 'standard'])),
    lastError: optional(raw.lastError, text),
    reliability: reliability && {
      lastWakeReason: optional(reliability.lastWakeReason, text),
      lastWakeAt: optional(reliability.lastWakeAt, timestamp),
      lastRestoreAt: optional(reliability.lastRestoreAt, timestamp),
      lastRestoreSucceeded: optional(reliability.lastRestoreSucceeded, bool),
      lastBackgroundCheckAt: optional(reliability.lastBackgroundCheckAt, timestamp),
      nextBackgroundCheckAt: optional(reliability.nextBackgroundCheckAt, timestamp),
    },
    riskHealth: health && {
      lowBatteryActive: bool(health.lowBatteryActive),
      locationReason: optional(health.locationReason, text),
      lastTrustedLocationAt: optional(health.lastTrustedLocationAt, timestamp),
      lastCheckAt: optional(health.lastCheckAt, timestamp),
    },
  };
}
