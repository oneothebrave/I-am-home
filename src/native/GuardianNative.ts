import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { GuardianConfig, GuardianEvent, GuardianStatusSnapshot } from '@/domain/types';

type PermissionState = {
  location: 'notDetermined' | 'denied' | 'whenInUse' | 'always';
  motion: 'notDetermined' | 'denied' | 'authorized';
  notifications: 'notDetermined' | 'denied' | 'authorized';
};

type GuardianNativeModule = {
  requestPermissions: () => Promise<PermissionState>;
  startGuardian: (config: GuardianConfig) => Promise<void>;
  stopGuardian: () => Promise<void>;
  setGeofences: (geofences: GuardianConfig['geofences']) => Promise<void>;
  getCurrentStatus: () => Promise<GuardianStatusSnapshot>;
  confirmSafe: () => Promise<void>;
  sendSOS: () => Promise<void>;
};

const NativeGuardian = NativeModules.GuardianNative as GuardianNativeModule | undefined;

export const guardianEvents =
  Platform.OS === 'ios' && NativeGuardian
    ? new NativeEventEmitter(NativeModules.GuardianNative)
    : undefined;

export function getGuardianNative() {
  if (!NativeGuardian) {
    throw new Error('GuardianNative is not available on this platform yet.');
  }

  return NativeGuardian;
}

export function subscribeToGuardianEvents(listener: (event: GuardianEvent) => void) {
  if (!guardianEvents) {
    return () => undefined;
  }

  const subscription = guardianEvents.addListener('GuardianEvent', listener);
  return () => subscription.remove();
}
