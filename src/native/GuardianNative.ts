import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { GuardianConfig } from '../domain/types';
import type { NativeEventQueue } from './guardianEventSync';

export type PermissionState = {
  location: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always';
  motion: 'notDetermined' | 'denied' | 'restricted' | 'authorized';
  notifications: 'notDetermined' | 'denied' | 'authorized';
};
export type GuardianNativeModule = NativeEventQueue & {
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
  requestPermissions: () => Promise<void>;
  getPermissions: () => Promise<PermissionState>;
  startGuardian: (config: GuardianConfig) => Promise<void>;
  stopGuardian: () => Promise<void>;
  setGeofences: (geofences: GuardianConfig['geofences']) => Promise<void>;
  getCurrentStatus: () => Promise<{
    isGuardianOn: boolean;
    isMonitoring: boolean;
    pendingEventCount: number;
    lastError?: string;
  }>;
  confirmSafe: () => Promise<void>;
  sendSOS: () => Promise<void>;
};

export function getGuardianNative(): GuardianNativeModule {
  const native = Platform.OS === 'ios' ? NativeModules.GuardianNative : undefined;
  if (!native) throw new Error('当前环境尚未接入 iOS 守护模块。');
  return native as GuardianNativeModule;
}

export function subscribeToGuardianEvents(listener: () => void) {
  const emitter = new NativeEventEmitter(getGuardianNative());
  const subscription = emitter.addListener('GuardianEvent', listener);
  return () => subscription.remove();
}

export function subscribeToGuardianErrors(listener: (event: { message: string }) => void) {
  const emitter = new NativeEventEmitter(getGuardianNative());
  const subscription = emitter.addListener('GuardianError', listener);
  return () => subscription.remove();
}
