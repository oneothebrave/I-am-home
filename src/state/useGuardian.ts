import { useEffect, useSyncExternalStore } from 'react';
import type { GuardianStore } from './guardianStore';

export function useGuardian(store: GuardianStore) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.initialize();
  }, [store]);
  return state;
}
