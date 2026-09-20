import type { GuardianGeofence } from '../domain/types';

export type GeofenceSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

type NativeGeofenceWriter = {
  setGeofences: (geofences: GuardianGeofence[]) => Promise<void>;
};

const snapshot = (geofences: GuardianGeofence[]) =>
  JSON.parse(JSON.stringify(geofences)) as GuardianGeofence[];

export function startGuardianGeofenceSync(
  native: NativeGeofenceWriter,
  onStatus: (status: GeofenceSyncStatus) => void,
  onError: (error: unknown) => void,
) {
  let desired: { geofences: GuardianGeofence[]; key: string } | undefined;
  let activeKey: string | undefined;
  let lastSyncedKey: string | undefined;
  let lastError: unknown;
  let running: Promise<void> | undefined;
  let stopped = false;

  const run = () => {
    if (running || stopped || !desired) return;
    running = Promise.resolve()
      .then(async () => {
        while (desired && !stopped) {
          const current = desired;
          desired = undefined;
          activeKey = current.key;
          onStatus('syncing');
          try {
            await native.setGeofences(current.geofences);
            lastSyncedKey = current.key;
            lastError = undefined;
          } catch (error) {
            lastError = error;
            onError(error);
            if (!desired) break;
          } finally {
            activeKey = undefined;
          }
        }
      })
      .finally(() => {
        running = undefined;
        if (desired && !stopped) run();
        else if (!stopped) onStatus(lastError ? 'error' : lastSyncedKey ? 'synced' : 'idle');
      });
  };

  return {
    update(geofences: GuardianGeofence[]) {
      if (stopped) return;
      const next = snapshot(geofences);
      const key = JSON.stringify(next);
      if (
        desired?.key === key ||
        (!desired && activeKey === key) ||
        (!desired && !lastError && lastSyncedKey === key)
      )
        return;
      desired = { geofences: next, key };
      lastError = undefined;
      run();
    },
    async flush() {
      do {
        run();
        if (running) await running;
      } while (!stopped && (desired || running));
      if (lastError) throw lastError;
    },
    stop() {
      stopped = true;
      desired = undefined;
    },
  };
}
