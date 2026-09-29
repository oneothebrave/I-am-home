import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuardianStorage } from './guardianStorage';
import { parseStoredState } from './guardianSchema';
import { protectLocalStorage, type StorageAccess } from '../native/storageProtection';

const STORAGE_KEY = '@daojia_shuo_yisheng/guardian_state_v1';

// Include the attribute checks in the same queue as the data operation, across
// adapter instances. No caller may report success before the final check finishes.
let tail: Promise<unknown> = Promise.resolve();
function protectedOperation<T>(kind: StorageAccess['operation'], operation: () => Promise<T>,
  expected: (result: T) => string | null): Promise<T> {
  const result = tail.then(async () => {
    await protectLocalStorage({ operation: kind, phase: 'before', value: null });
    let value: T;
    try {
      value = await operation();
    } catch (error) {
      // Legacy AsyncStorage can migrate/create files even on a failed read/write.
      // Do not record a successful write/clear when the library itself failed.
      await protectLocalStorage({ operation: kind, phase: 'failed', value: null });
      throw error;
    }
    await protectLocalStorage({ operation: kind, phase: 'after', value: expected(value) });
    return value;
  });
  tail = result.catch(() => undefined);
  return result;
}

export function createAsyncStorageGuardianStorage(): GuardianStorage {
  return {
    async load() {
      const rawValue = await protectedOperation('read', () => AsyncStorage.getItem(STORAGE_KEY), (raw) => raw);

      if (rawValue === null) {
        return undefined;
      }

      return parseStoredState(JSON.parse(rawValue));
    },
    async save(state) {
      const parsed = parseStoredState(state);
      const serialized = JSON.stringify(parsed);
      await protectedOperation(parsed.dataDeletionPending ? 'deletion' : 'write',
        () => AsyncStorage.setItem(STORAGE_KEY, serialized), () => serialized);
    },
    async clear() {
      await protectedOperation('remove', () => AsyncStorage.removeItem(STORAGE_KEY), () => null);
    },
  };
}
