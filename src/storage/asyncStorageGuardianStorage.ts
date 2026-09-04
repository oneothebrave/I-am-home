import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuardianStorage, GuardianStoredState } from './guardianStorage';

const STORAGE_KEY = '@daojia_shuo_yisheng/guardian_state_v1';

export function createAsyncStorageGuardianStorage(): GuardianStorage {
  return {
    async load() {
      const rawValue = await AsyncStorage.getItem(STORAGE_KEY);

      if (!rawValue) {
        return undefined;
      }

      return JSON.parse(rawValue) as GuardianStoredState;
    },
    async save(state) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    async clear() {
      await AsyncStorage.removeItem(STORAGE_KEY);
    },
  };
}
