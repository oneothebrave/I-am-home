import type { GuardianSchedule } from '../domain/types';

// Preserve order across quick edits; a failed write remains visible and can be retried.
export function startGuardianPolicySync(native: {
  setMonitoringPolicy: (schedule: GuardianSchedule) => Promise<void>;
}) {
  let queue = Promise.resolve();
  let stopped = false;
  return {
    update(schedule: GuardianSchedule) {
      const snapshot = { ...schedule };
      const result = queue.then(() => {
        if (stopped) throw new Error('守护规则同步已停止。');
        return native.setMonitoringPolicy(snapshot);
      });
      queue = result.catch(() => undefined);
      return result;
    },
    flush() { return queue; },
    stop() { stopped = true; },
  };
}
