import { guardianConfig } from '../domain/mockData';
import type { GuardianConfig, GuardianEvent } from '../domain/types';

export interface GuardianStoredState {
  config: GuardianConfig;
  localEvents: GuardianEvent[];
  updatedAt: string;
}

export interface GuardianStorage {
  load: () => Promise<GuardianStoredState | undefined>;
  save: (state: GuardianStoredState) => Promise<void>;
  clear: () => Promise<void>;
}

function createInitialStoredState(): GuardianStoredState {
  return {
    config: guardianConfig,
    localEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createMemoryGuardianStorage(seed = createInitialStoredState()): GuardianStorage {
  let state: GuardianStoredState | undefined = seed;

  return {
    async load() {
      return state ? cloneStoredState(state) : undefined;
    },
    async save(nextState) {
      state = cloneStoredState(nextState);
    },
    async clear() {
      state = createInitialStoredState();
    },
  };
}

export function createFallbackGuardianStorage(
  primary: GuardianStorage,
  fallback: GuardianStorage,
): GuardianStorage {
  return {
    async load() {
      try {
        return await primary.load();
      } catch {
        return fallback.load();
      }
    },
    async save(state) {
      try {
        await primary.save(state);
      } finally {
        await fallback.save(state);
      }
    },
    async clear() {
      try {
        await primary.clear();
      } finally {
        await fallback.clear();
      }
    },
  };
}

function cloneStoredState(state: GuardianStoredState): GuardianStoredState {
  return JSON.parse(JSON.stringify(state)) as GuardianStoredState;
}
