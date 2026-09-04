# iOS 原生守护模块设计

## 目标

Swift 原生模块负责采集系统级守护事件，并通过 React Native bridge 发给界面层或后端。

React Native 不直接处理后台定位细节，只消费稳定的守护事件。

## React Native 暴露接口

```ts
requestPermissions(): Promise<PermissionState>
startGuardian(config: GuardianConfig): Promise<void>
stopGuardian(): Promise<void>
setGeofences(geofences: GuardianGeofence[]): Promise<void>
getCurrentStatus(): Promise<GuardianStatusSnapshot>
confirmSafe(): Promise<void>
sendSOS(): Promise<void>
```

## Swift 模块职责

- 申请和检查 Always Location 权限。
- 注册家、劳作地点等地理围栏。
- 监听进入、离开和停留事件。
- 监听重大位置变化。
- 读取电量状态。
- 触发本地通知。
- 将事件通过 bridge 上报给 React Native。

## 事件原则

原生模块只负责可靠采集，不在本地写复杂风险判断。

例如 Swift 上报：

```json
{
  "type": "ENTER_WORK_AREA",
  "timestamp": "2026-08-12T08:42:00+08:00",
  "latitude": 30.0,
  "longitude": 120.0,
  "accuracy": 80,
  "batteryLevel": 46,
  "source": "geofence"
}
```

风险计算可在 React Native 或后端统一处理。
