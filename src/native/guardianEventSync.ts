import { parseGuardianEvent } from '../domain/validation';

export interface NativeEventQueue {
  getPendingEvents: () => Promise<unknown[]>;
  acknowledgeEvents: (ids: string[]) => Promise<void>;
}

export function startGuardianEventSync(
  native: NativeEventQueue,
  subscribe: (listener: () => void) => () => void,
  persistEvents: (events: unknown[]) => Promise<boolean>,
  onError: (error: unknown) => void,
) {
  let stopped = false;
  let requested = false;
  let running: Promise<void> | undefined;
  function drain(): Promise<void> {
    requested = true;
    if (running) return running;
    let successful = true;
    running = Promise.resolve()
      .then(async () => {
        while (requested && !stopped) {
          requested = false;
          const events = (await native.getPendingEvents()).map(parseGuardianEvent);
          if (!events.length || stopped) return;
          const durable = await persistEvents(events);
          if (!durable || stopped) {
            successful = false;
            return;
          }
          await native.acknowledgeEvents([...new Set(events.map((event) => event.id))]);
        }
      })
      .catch((error) => {
        successful = false;
        onError(error);
      })
      .finally(() => {
        running = undefined;
        if (successful && requested && !stopped) void drain();
      });
    return running;
  }
  // Subscribe first, then pull the durable backlog to cover startup races.
  const unsubscribe = subscribe(() => {
    void drain();
  });
  void drain();
  return {
    retry: drain,
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
