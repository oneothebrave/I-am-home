import { orderGuardianEvents } from '../domain/guardianProjection';
import type { GuardianConfig, GuardianEvent } from '../domain/types';
import type { GuardianStoredState } from '../storage/guardianSchema';

export type GuardianAction =
  | { type: 'config'; config: GuardianConfig }
  | { type: 'events'; events: GuardianEvent[] }
  | { type: 'enabled'; enabled: boolean }
  | { type: 'reset'; data: GuardianStoredState };

export function guardianReducer(
  data: GuardianStoredState,
  action: GuardianAction,
): GuardianStoredState {
  switch (action.type) {
    case 'config':
      return { ...data, config: action.config };
    case 'enabled':
      return data.isGuardianOn === action.enabled
        ? data
        : { ...data, isGuardianOn: action.enabled };
    case 'reset':
      return action.data;
    case 'events': {
      const localEvents = orderGuardianEvents([...data.localEvents, ...action.events]);
      return localEvents.length === data.localEvents.length ? data : { ...data, localEvents };
    }
  }
}
