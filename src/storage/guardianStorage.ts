import type { GuardianStoredState } from './guardianSchema';
export type { GuardianStoredState } from './guardianSchema';

export interface StorageStatus {
  durability: 'durable' | 'memory';
  error?: string;
}
export interface GuardianStorage {
  load: () => Promise<GuardianStoredState | undefined>;
  save: (state: GuardianStoredState) => Promise<void>;
  clear: () => Promise<void>;
  getStatus?: () => StorageStatus;
}
export const cloneStoredState = (state: GuardianStoredState): GuardianStoredState =>
  JSON.parse(JSON.stringify(state));

export function createMemoryGuardianStorage(seed?: GuardianStoredState): GuardianStorage {
  let state = seed ? cloneStoredState(seed) : undefined;
  return {
    async load() {
      return state ? cloneStoredState(state) : undefined;
    },
    async save(nextState) {
      state = cloneStoredState(nextState);
    },
    async clear() {
      state = undefined;
    },
    getStatus: () => ({ durability: 'memory' }),
  };
}

export function createFallbackGuardianStorage(
  primary: GuardianStorage,
  fallback: GuardianStorage,
): GuardianStorage {
  let status: StorageStatus = { durability: 'durable' };
  let dirty = false;
  const degraded = (error: unknown) => {
    status = {
      durability: 'memory',
      error: error instanceof Error ? error.message : '本机存储不可用。',
    };
  };
  return {
    async load() {
      if (dirty) return fallback.load();
      try {
        const state = await primary.load();
        if (state) await fallback.save(state);
        else await fallback.clear();
        status = { durability: primary.getStatus?.().durability ?? 'durable' };
        return state;
      } catch (error) {
        degraded(error);
        const cached = await fallback.load();
        if (!cached) throw error;
        return cached;
      }
    },
    async save(state) {
      await fallback.save(state);
      try {
        await primary.save(state);
        dirty = false;
        status = { durability: primary.getStatus?.().durability ?? 'durable' };
      } catch (error) {
        dirty = true;
        degraded(error);
      }
    },
    async clear() {
      await fallback.clear();
      try {
        await primary.clear();
        dirty = false;
        status = { durability: primary.getStatus?.().durability ?? 'durable' };
      } catch (error) {
        dirty = true;
        degraded(error);
      }
    },
    getStatus: () => ({ ...status }),
  };
}
