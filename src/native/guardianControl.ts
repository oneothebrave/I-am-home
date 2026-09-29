import type { GuardianConfig } from '../domain/types';
import type { GuardianNativeStatus } from './GuardianNative';

export type GuardianControlPhase =
  | 'unknown'
  | 'checking'
  | 'starting'
  | 'stopping'
  | 'off'
  | 'monitoring'
  | 'degraded'
  | 'error';

export type GuardianControlState = {
  phase: GuardianControlPhase;
  nativeStatus?: GuardianNativeStatus;
  error?: string;
};

type NativeGuardianController = {
  getCurrentStatus: () => Promise<GuardianNativeStatus>;
  startGuardian: (config: GuardianConfig, resumePaused: boolean) => Promise<void>;
  stopGuardian: () => Promise<void>;
};

const phaseFor = (status: GuardianNativeStatus): GuardianControlPhase => {
  if (!status.isGuardianOn) return 'off';
  return status.isMonitoring ? 'monitoring' : 'degraded';
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error || '原生守护操作失败。');

export function startGuardianControl(
  native: NativeGuardianController,
  onState: (state: GuardianControlState) => void,
  onNativeEnabled: (enabled: boolean) => void,
  onError: (error: unknown) => void,
) {
  let queue = Promise.resolve();
  let stopped = false;
  let refreshRequest: Promise<void> | undefined;

  const emit = (state: GuardianControlState) => {
    if (!stopped) onState(state);
  };

  const accept = (status: GuardianNativeStatus) => {
    if (stopped) return;
    onNativeEnabled(status.isGuardianOn);
    emit({ phase: phaseFor(status), nativeStatus: status });
  };

  const enqueue = (operation: () => Promise<void>) => {
    const result = queue.then(async () => {
      if (!stopped) await operation();
    });
    queue = result.catch(() => undefined);
    return result;
  };

  const reconcileAfterFailure = async (error: unknown) => {
    let nativeStatus: GuardianNativeStatus | undefined;
    try {
      nativeStatus = await native.getCurrentStatus();
      if (!stopped) onNativeEnabled(nativeStatus.isGuardianOn);
    } catch {
      // Keep the original operation error. A failed status read means state is unknown.
    }
    if (!stopped) {
      emit({ phase: 'error', nativeStatus, error: message(error) });
      onError(error);
    }
  };

  return {
    refresh() {
      if (refreshRequest) return refreshRequest;
      const request = enqueue(async () => {
        emit({ phase: 'checking' });
        try {
          accept(await native.getCurrentStatus());
        } catch (error) {
          emit({ phase: 'error', error: message(error) });
          if (!stopped) onError(error);
          throw error;
        }
      });
      refreshRequest = request;
      const clear = () => { if (refreshRequest === request) refreshRequest = undefined; };
      request.then(clear, clear);
      return request;
    },
    setEnabled(enabled: boolean, config: GuardianConfig, resumePaused = false) {
      // A refresh requested after this write must not reuse its pre-write read.
      refreshRequest = undefined;
      return enqueue(async () => {
        emit({ phase: enabled ? 'starting' : 'stopping' });
        try {
          if (enabled) await native.startGuardian(config, resumePaused);
          else await native.stopGuardian();
          const status = await native.getCurrentStatus();
          const confirmed = enabled
            ? status.isGuardianOn && status.isMonitoring && status.isGuardianPaused === false
            : !status.isGuardianOn && !status.isMonitoring && status.isGuardianPaused === true;
          if (!confirmed) throw new Error('原生守护状态与本次操作不一致，请重试。');
          accept(status);
        } catch (error) {
          await reconcileAfterFailure(error);
          throw error;
        }
      });
    },
    async flush() {
      await queue;
    },
    stop() {
      stopped = true;
    },
  };
}
