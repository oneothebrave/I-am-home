import { createAsyncStorageGuardianStorage } from './asyncStorageGuardianStorage';
import {
  createFallbackGuardianStorage,
  createMemoryGuardianStorage,
  type GuardianStorage,
  type StorageStatus,
} from './guardianStorage';
import {
  createInitialStoredState,
  parseStoredState,
  type GuardianStoredState,
} from './guardianSchema';

export interface GuardianRepository {
  loadState: () => Promise<GuardianStoredState>;
  saveState: (state: GuardianStoredState) => Promise<GuardianStoredState>;
  getStatus: () => StorageStatus & { hasStoredState: boolean };
}

export function createGuardianRepository(
  storage: GuardianStorage,
  initial = createInitialStoredState,
): GuardianRepository {
  let tail: Promise<unknown> = Promise.resolve();
  let hasStoredState = false;
  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    loadState: () =>
      enqueue(async () => {
        const value = await storage.load();
        hasStoredState = value !== undefined;
        return value ? parseStoredState(value) : initial();
      }),
    saveState(value) {
      // Capture a validated copy before waiting so caller mutation cannot change a queued write.
      const state = parseStoredState(value);
      return enqueue(async () => {
        await storage.save(state);
        hasStoredState = true;
        return state;
      });
    },
    getStatus: () => ({ ...(storage.getStatus?.() ?? { durability: 'durable' }), hasStoredState }),
  };
}

export const guardianRepository = createGuardianRepository(
  createFallbackGuardianStorage(createAsyncStorageGuardianStorage(), createMemoryGuardianStorage()),
);
