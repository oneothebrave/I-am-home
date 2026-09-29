import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { GuardianConfig } from '../domain/types';
import type { NativeEventQueue } from './guardianEventSync';
import { guardedNativeRead, parseGuardianNativeStatus, parsePermissionState } from './nativeReadGuard';

export type PermissionState = {
  location: 'notDetermined' | 'denied' | 'restricted' | 'whenInUse' | 'always';
  locationAccuracy: 'unknown' | 'reduced' | 'full';
  motion: 'notDetermined' | 'denied' | 'restricted' | 'authorized';
  notifications: 'notDetermined' | 'denied' | 'authorized';
  backgroundRefresh: 'available' | 'denied' | 'restricted';
};
export type GuardianNativeStatus = {
  isGuardianOn: boolean;
  isGuardianPaused: boolean;
  isMonitoring: boolean;
  isInActiveWindow: boolean;
  pendingEventCount: number;
  dataDeletionPending?: boolean;
  monitoringMode?: 'standard' | 'test';
  riskHealth?: {
    lowBatteryActive: boolean;
    locationReason?: string;
    lastTrustedLocationAt?: number;
    lastCheckAt?: number;
  };
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
  startGuardian: (config: GuardianConfig, resumePaused: boolean) => Promise<void>;
  stopGuardian: () => Promise<void>;
  clearLocalData: () => Promise<void>;
  beginDataDeletion: () => Promise<void>;
  setGeofences: (geofences: GuardianConfig['geofences']) => Promise<void>;
  setNoMotionThresholdMinutes: (value: number) => Promise<void>;
  setMonitoringPolicy: (schedule: GuardianConfig['schedule']) => Promise<void>;
  setActiveWindow: (schedule: GuardianConfig['schedule']) => Promise<void>;
  setNotificationContacts: (contacts: GuardianConfig['contacts']) => Promise<void>;
  getCriticalMessagingPreparation: () => Promise<unknown>;
  requestCriticalMessagingAuthorization: () => Promise<void>;
  refreshCriticalMessagingAuthorization: () => Promise<void>;
  getCurrentStatus: () => Promise<GuardianNativeStatus>;
  sendSOS: () => Promise<void>;
};

const guardedModules = new WeakMap<object, GuardianNativeModule>();

export function getGuardianNative(): GuardianNativeModule {
  const native = Platform.OS === 'ios' ? NativeModules.GuardianNative : undefined;
  if (!native) throw new Error('当前环境尚未接入 iOS 守护模块。');
  let guarded = guardedModules.get(native);
  if (!guarded) {
    // Native host objects may expose methods lazily/non-enumerably. Delegate
    // explicitly instead of spreading the native object, preserving its receiver.
    const delegate = <K extends keyof GuardianNativeModule>(method: K): GuardianNativeModule[K] =>
      ((...args: unknown[]) => {
        const operation = native[method];
        if (typeof operation !== 'function') throw new Error('当前原生模块缺少所需接口，请更新 App 后重试。');
        return operation.apply(native, args);
      }) as GuardianNativeModule[K];
    guarded = {
      getPermissions: guardedNativeRead(delegate('getPermissions'), parsePermissionState, '读取系统权限'),
      getCurrentStatus: guardedNativeRead(delegate('getCurrentStatus'), parseGuardianNativeStatus, '读取守护状态'),
      addListener: delegate('addListener'),
      removeListeners: delegate('removeListeners'),
      requestPermissions: delegate('requestPermissions'),
      requestMotionPermission: delegate('requestMotionPermission'),
      getCurrentLocation: delegate('getCurrentLocation'),
      pickTime: delegate('pickTime'),
      startGuardian: delegate('startGuardian'),
      stopGuardian: delegate('stopGuardian'),
      clearLocalData: delegate('clearLocalData'),
      beginDataDeletion: delegate('beginDataDeletion'),
      setGeofences: delegate('setGeofences'),
      setNoMotionThresholdMinutes: delegate('setNoMotionThresholdMinutes'),
      setMonitoringPolicy: delegate('setMonitoringPolicy'),
      setActiveWindow: delegate('setActiveWindow'),
      setNotificationContacts: delegate('setNotificationContacts'),
      getCriticalMessagingPreparation: delegate('getCriticalMessagingPreparation'),
      requestCriticalMessagingAuthorization: delegate('requestCriticalMessagingAuthorization'),
      refreshCriticalMessagingAuthorization: delegate('refreshCriticalMessagingAuthorization'),
      getPendingEvents: delegate('getPendingEvents'),
      acknowledgeEvents: delegate('acknowledgeEvents'),
      sendSOS: delegate('sendSOS'),
    };
    guardedModules.set(native, guarded);
  }
  return guarded;
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
