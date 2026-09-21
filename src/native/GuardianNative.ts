import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { GuardianConfig } from '../domain/types';
import type { NativeEventQueue } from './guardianEventSync';

export type PermissionState = {
  location: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always';
  locationAccuracy: 'unknown' | 'reduced' | 'full';
  motion: 'notDetermined' | 'denied' | 'restricted' | 'authorized';
  notifications: 'notDetermined' | 'denied' | 'authorized';
  backgroundRefresh: 'available' | 'denied' | 'restricted';
};
export type GuardianNativeStatus = {
  isGuardianOn: boolean;
  isMonitoring: boolean;
  isInActiveWindow: boolean;
  pendingEventCount: number;
  lastError?: string;
  reliability?: {
    lastWakeReason?: string;
    lastWakeAt?: number;
    lastRestoreAt?: number;
    lastRestoreSucceeded?: boolean;
    lastBackgroundCheckAt?: number;
    nextBackgroundCheckAt?: number;
  };
};
export type GuardianNativeModule = NativeEventQueue & {
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
  requestPermissions: () => Promise<void>;
  requestMotionPermission: () => Promise<void>;
  getPermissions: () => Promise<PermissionState>;
  getCurrentLocation: () => Promise<unknown>;
  pickTime: (initialTime: string, title: string) => Promise<string | null>;
  startGuardian: (config: GuardianConfig) => Promise<void>;
  stopGuardian: () => Promise<void>;
  setGeofences: (geofences: GuardianConfig['geofences']) => Promise<void>;
  setNoMotionThresholdMinutes: (value: number) => Promise<void>;
  setActiveWindow: (schedule: GuardianConfig['schedule']) => Promise<void>;
  setNotificationContacts: (contacts: GuardianConfig['contacts']) => Promise<void>;
  getCriticalMessagingPreparation: () => Promise<unknown>;
  getCurrentStatus: () => Promise<GuardianNativeStatus>;
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

export function subscribeToGuardianMessagingUpdates(listener: () => void) {
  const emitter = new NativeEventEmitter(getGuardianNative());
  const subscription = emitter.addListener('GuardianMessagingUpdate', listener);
  return () => subscription.remove();
}
