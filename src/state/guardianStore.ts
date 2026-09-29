import type { GuardianConfig, GuardianEventDraft } from '../domain/types';
import { parseGuardianConfig, parseGuardianEvent } from '../domain/validation';
import { createId } from '../utils/id';
import type { GuardianRepository } from '../storage/guardianRepository';
import { createInitialStoredState, type GuardianStoredState } from '../storage/guardianSchema';
import { guardianReducer, type GuardianAction } from './guardianReducer';
import { retainGuardianEvents } from '../domain/dataRetention';

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
  let clearing = false;
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
    if (clearing || view.data.dataDeletionPending) return false;
    if (view.loadStatus !== 'ready' && action.type !== 'events') return false;
    if (view.loadStatus !== 'ready') pending.push(action);
    let data = guardianReducer(view.data, action);
    if (data !== view.data && data.mode === 'device')
      data = { ...data, localEvents: retainGuardianEvents(data.localEvents, clock()) };
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
        if (!data.dataDeletionPending)
          for (const action of pending) data = guardianReducer(data, action);
        pending = [];
        const retained = data.mode === 'device' ? retainGuardianEvents(data.localEvents, clock()) : data.localEvents;
        const pruned = retained.length !== data.localEvents.length;
        data = { ...data, localEvents: retained };
        const status = repository.getStatus();
        processedRevision = 0;
        publish({
          data,
          loadStatus: 'ready',
          revision: hadPending || pruned ? 1 : 0,
          saveStatus: status.hasStoredState ? status.durability : 'idle',
          savedAt:
            status.hasStoredState && status.durability === 'durable' ? data.updatedAt : undefined,
          error: status.error,
        });
        if (hadPending || pruned) void persist();
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
    setPaused(paused: boolean) {
      dispatch({ type: 'paused', paused });
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
      if (clearing || view.data.dataDeletionPending) return false;
      const events = rawEvents.map(parseGuardianEvent);
      if (view.loadStatus !== 'ready') await initialize();
      if (view.loadStatus !== 'ready' || view.data.mode !== 'device') return false;
      if (!dispatch({ type: 'events', events })) return false;
      retryRequested = true;
      await flush();
      return !clearing && !view.data.dataDeletionPending && view.saveStatus === 'durable';
    },
    pruneHistory() {
      if (view.loadStatus !== 'ready' || view.data.mode !== 'device' || clearing || view.data.dataDeletionPending) return;
      const events = retainGuardianEvents(view.data.localEvents, clock());
      if (events.length !== view.data.localEvents.length)
        dispatch({ type: 'reset', data: { ...view.data, localEvents: events } });
    },
    requireDataDeletion() {
      return dispatch({ type: 'reset', data: {
        ...createInitialStoredState(clock(), 'device'), isGuardianPaused: true, dataDeletionPending: true,
      } });
    },
    async clearLocalData(clearNative: () => Promise<void>, prepareNative = async () => {}) {
      if (clearing) throw new Error('正在清除本机数据，请稍候。');
      clearing = true;
      try {
        if (loading) await loading;
        // Finish any pre-delete write before committing the empty deletion journal.
        if (saving) await saving;
        pending = [];
        retryRequested = false;
        const empty = { ...createInitialStoredState(clock(), 'device'), isGuardianPaused: true };
        const journal = { ...empty, dataDeletionPending: true };
        const revision = view.revision + 1;
        processedRevision = revision;
        publish({ data: journal, loadStatus: 'ready', revision, saveStatus: 'saving', error: undefined });
        // A native tombstone must precede deleting JS state: native bootstrap
        // runs before React and must not resume monitoring after an interrupted wipe.
        await prepareNative();
        await repository.saveState(journal);
        if (repository.getStatus().durability !== 'durable')
          throw new Error('清除进度尚未可靠保存，旧数据可能仍在本机，请重试。');
        await clearNative();
        await repository.saveState(empty);
        if (repository.getStatus().durability !== 'durable')
          throw new Error('清除结果尚未可靠保存，请重试完成清除。');
        publish({ data: empty, saveStatus: 'durable', savedAt: empty.updatedAt, error: undefined });
      } catch (error) {
        publish({ saveStatus: 'error', error: message(error) });
        throw error;
      } finally {
        clearing = false;
      }
    },
    reset() {
      return dispatch({ type: 'reset', data: createInitialStoredState(clock(), view.data.mode) });
    },
    async retry() {
      if (clearing || view.data.dataDeletionPending) return;
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
