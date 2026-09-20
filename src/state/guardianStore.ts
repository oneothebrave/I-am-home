import type { GuardianConfig, GuardianEventDraft } from '../domain/types';
import { parseGuardianConfig, parseGuardianEvent } from '../domain/validation';
import { createId } from '../utils/id';
import type { GuardianRepository } from '../storage/guardianRepository';
import { createInitialStoredState, type GuardianStoredState } from '../storage/guardianSchema';
import { guardianReducer, type GuardianAction } from './guardianReducer';

export interface GuardianViewState {
  data: GuardianStoredState;
  loadStatus: 'loading' | 'ready' | 'error';
  saveStatus: 'idle' | 'saving' | 'durable' | 'memory' | 'error';
  error?: string;
  savedAt?: string;
  revision: number;
}

export function createGuardianStore(repository: GuardianRepository, clock = Date.now) {
  let view: GuardianViewState = {
    data: createInitialStoredState(clock()),
    loadStatus: 'loading',
    saveStatus: 'idle',
    revision: 0,
  };
  let pending: GuardianAction[] = [];
  const listeners = new Set<() => void>();
  let loading: Promise<void> | undefined;
  let saving: Promise<void> | undefined;
  let processedRevision = 0;
  let retryRequested = false;
  const message = (error: unknown) =>
    error instanceof Error ? error.message : '操作失败，请重试。';
  const publish = (patch: Partial<GuardianViewState>) => {
    view = { ...view, ...patch };
    for (const listener of listeners) listener();
  };

  function persist(): Promise<void> {
    if (view.loadStatus !== 'ready') return Promise.resolve();
    if (saving) return saving;
    saving = Promise.resolve()
      .then(async () => {
        while (processedRevision < view.revision || retryRequested) {
          retryRequested = false;
          const revision = view.revision;
          const data = { ...view.data, updatedAt: new Date(clock()).toISOString() };
          publish({ saveStatus: 'saving', error: undefined });
          try {
            const saved = await repository.saveState(data);
            processedRevision = revision;
            const status = repository.getStatus();
            publish({
              saveStatus: view.revision > revision ? 'saving' : status.durability,
              savedAt: status.durability === 'durable' ? saved.updatedAt : view.savedAt,
              error: status.error,
            });
          } catch (error) {
            publish({ saveStatus: 'error', error: message(error) });
            break;
          }
        }
      })
      .finally(() => {
        saving = undefined;
        if (view.saveStatus !== 'error' && (processedRevision < view.revision || retryRequested)) {
          void persist();
        }
      });
    return saving;
  }

  async function flush() {
    if (loading) await loading;
    do {
      await persist();
    } while (
      view.loadStatus === 'ready' &&
      view.saveStatus !== 'error' &&
      (processedRevision < view.revision || retryRequested)
    );
  }

  function dispatch(action: GuardianAction) {
    if (view.loadStatus !== 'ready' && action.type !== 'events') return false;
    if (view.loadStatus !== 'ready') pending.push(action);
    const data = guardianReducer(view.data, action);
    if (data !== view.data) {
      publish({
        data,
        revision: view.revision + 1,
        saveStatus: view.loadStatus === 'ready' ? 'saving' : view.saveStatus,
      });
      void persist();
    }
    return true;
  }

  function initialize(): Promise<void> {
    if (loading) return loading;
    if (view.loadStatus === 'ready') return Promise.resolve();
    publish({ loadStatus: 'loading', error: undefined });
    loading = repository
      .loadState()
      .then((data) => {
        const hadPending = pending.length > 0;
        for (const action of pending) data = guardianReducer(data, action);
        pending = [];
        const status = repository.getStatus();
        processedRevision = 0;
        publish({
          data,
          loadStatus: 'ready',
          revision: hadPending ? 1 : 0,
          saveStatus: status.hasStoredState ? status.durability : 'idle',
          savedAt:
            status.hasStoredState && status.durability === 'durable' ? data.updatedAt : undefined,
          error: status.error,
        });
        if (hadPending) void persist();
      })
      .catch((error) => {
        publish({ loadStatus: 'error', saveStatus: 'error', error: message(error) });
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }

  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize,
    updateConfig(updater: (config: GuardianConfig) => GuardianConfig) {
      try {
        return dispatch({ type: 'config', config: parseGuardianConfig(updater(view.data.config)) });
      } catch (error) {
        publish({ error: message(error) });
        return false;
      }
    },
    setEnabled(enabled: boolean) {
      dispatch({ type: 'enabled', enabled });
    },
    activateDeviceMode() {
      if (view.loadStatus !== 'ready' || view.data.mode === 'device') return false;
      return dispatch({ type: 'reset', data: createInitialStoredState(clock(), 'device') });
    },
    addEvent(draft: GuardianEventDraft) {
      const event = parseGuardianEvent({
        ...draft,
        id: createId('event'),
        timestamp: new Date(clock()).toISOString(),
      });
      dispatch({ type: 'events', events: [event] });
      return event;
    },
    async importEvents(rawEvents: unknown[]) {
      const events = rawEvents.map(parseGuardianEvent);
      if (view.loadStatus !== 'ready') await initialize();
      if (view.loadStatus !== 'ready' || view.data.mode !== 'device') return false;
      dispatch({ type: 'events', events });
      retryRequested = true;
      await flush();
      return view.saveStatus === 'durable';
    },
    reset() {
      return dispatch({ type: 'reset', data: createInitialStoredState(clock(), view.data.mode) });
    },
    async retry() {
      if (view.loadStatus !== 'ready') await initialize();
      else {
        retryRequested = true;
      }
      await flush();
    },
    flush,
  };
}

export type GuardianStore = ReturnType<typeof createGuardianStore>;
