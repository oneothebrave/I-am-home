import { NativeModules, Platform } from 'react-native';

// This changes file attributes, so it must not use the read-only timeout helper.
// A missing/older native binary must never silently bypass the iOS protection gate.
export type StorageAccess = {
  operation: 'read' | 'write' | 'remove' | 'deletion';
  phase: 'before' | 'after' | 'failed';
  value: string | null;
};

export async function protectLocalStorage(access: StorageAccess): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const native = NativeModules.GuardianNative;
  if (typeof native?.checkLocalStorage !== 'function') {
    throw new Error('当前安装包缺少本机数据保护模块，请更新 App 后重试。');
  }
  try {
    if ((await native.checkLocalStorage(access)) !== 'checked-v2') throw new Error();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'STORAGE_INTEGRITY_ERROR') {
      throw new Error('本机存储文件缺失、损坏或不一致，未确认读取或保存成功。可先重试读取；确认不再保留后再清除。无法识别的损坏索引不会被自动删除。');
    }
    // Do not expose native paths, file contents, or a dependency's raw errors.
    throw new Error('本机数据保护检查未完成，请解锁设备后重试。仍失败时请检查存储空间或更新 App。');
  }
}
