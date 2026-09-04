import { guardianConfig } from '../domain/mockData';
import type { GuardianConfig, GuardianEvent } from '../domain/types';
import { createAsyncStorageGuardianStorage } from './asyncStorageGuardianStorage';
import {
  createFallbackGuardianStorage,
  createMemoryGuardianStorage,
  type GuardianStoredState,
  type GuardianStorage,
} from './guardianStorage';

export interface GuardianRepository {
  loadState: () => Promise<GuardianStoredState>;
  saveConfig: (config: GuardianConfig, localEvents: GuardianEvent[]) => Promise<GuardianStoredState>;
  saveEvents: (config: GuardianConfig, localEvents: GuardianEvent[]) => Promise<GuardianStoredState>;
  reset: () => Promise<GuardianStoredState>;
}

export function createGuardianRepository(storage: GuardianStorage): GuardianRepository {
  const saveState = async (
    config: GuardianConfig,
    localEvents: GuardianEvent[],
  ): Promise<GuardianStoredState> => {
    const state: GuardianStoredState = {
      config,
      localEvents,
      updatedAt: new Date().toISOString(),
    };
    await storage.save(state);
    return state;
  };

  return {
    async loadState() {
      const storedState = await storage.load();

      return storedState ?? {
        config: guardianConfig,
        localEvents: [],
        updatedAt: new Date().toISOString(),
      };
    },
    async saveConfig(config, localEvents) {
      return saveState(config, localEvents);
    },
    async saveEvents(config, localEvents) {
      return saveState(config, localEvents);
    },
    async reset() {
      await storage.clear();
      return this.loadState();
    },
  };
}

const defaultGuardianStorage = createFallbackGuardianStorage(
  createAsyncStorageGuardianStorage(),
  createMemoryGuardianStorage(),
);

export const guardianRepository = createGuardianRepository(defaultGuardianStorage);
