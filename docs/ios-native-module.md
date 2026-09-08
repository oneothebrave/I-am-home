# iOS 原生模块

当前源码尚未通过 Xcode 编译或真机验证。需要先建立完整 iOS 工程，将 `ios/GuardianCore` 中全部 Swift 文件及 `.m` 导出文件加入 target，并配置 React、CoreLocation、CoreMotion 和 UserNotifications。

## 职责

- `GuardianRuntime` 持有原生服务，与 RN 页面生命周期分离。
- `GuardianEventStore` 将围栏配置、启停状态和未消费事件保存到 Application Support。写入使用原子替换；读取损坏或未知版本时返回错误，不重建默认数据覆盖旧内容。
- `GuardianEvent` 在创建时生成 ID，序列化和重放时保持 ID；保留测量时间和接收时间，未知电量不转换为负数百分比。
- `GuardianLocationPolicy` 拒绝超过 120 秒、超前 5 秒、精度大于 100 米或无效的位置。初次定位不算移动，移动距离必须超过 50 米及两次测量精度之和，比较样本间隔不超过 120 秒。这是待实测调整的保守策略。
- 围栏事件记录围栏 ID 和名称，不把围栏中心伪装成手机精确位置。路口和劳作区使用不同事件类型。
- `GuardianNativeModule` 的系统操作统一派发到主线程；事件先写入队列，再尝试通知 JS。

定位质量检查依据 [Apple 定位数据处理说明](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html)。文件保护使用 [首次解锁后可访问的保护选项](https://developer.apple.com/documentation/foundation/nsdata/writingoptions/completefileprotectionuntilfirstuserauthentication)。这些设计仍需锁屏、重启及权限变化实测。

## 接口

```ts
requestPermissions(): Promise<void>
getPermissions(): Promise<PermissionState>
startGuardian(config: GuardianConfig): Promise<void>
stopGuardian(): Promise<void>
setGeofences(geofences: GuardianGeofence[]): Promise<void>
getCurrentStatus(): Promise<{
  isGuardianOn: boolean;
  isMonitoring: boolean;
  pendingEventCount: number;
  lastError?: string;
}>
getPendingEvents(): Promise<unknown[]>
acknowledgeEvents(ids: string[]): Promise<void>
confirmSafe(): Promise<void>
sendSOS(): Promise<void>
```

`requestPermissions` 当前启动位置授权流程，首次请求 When In Use，再次请求时申请 Always。调用返回不代表已经授权，需用 `getPermissions` 读取实际状态。运动和通知权限可读取，但其申请流程、运动采集和通知发送尚待接入。

`startGuardian` 要求 Always 权限、后台 location 配置与受支持的围栏；配置超过上限或含非法数据时拒绝，不静默截断。实际区域注册仍是异步操作，失败通过 `GuardianError` 和状态接口暴露。事件通知为 `GuardianEvent`。

## 启动恢复

未来 AppDelegate 的应用启动方法中，在主线程、RN bridge 创建前调用：

```swift
GuardianBootstrap.restore()
```

这是本次提供的恢复入口。由于仓库没有 AppDelegate/Xcode 工程，该调用尚未接入真正的启动过程，不能声称已经实现并验证后台唤醒。首次解锁前存储不可读时，后续接口调用会重试初始化；数据损坏仍返回错误。

需配置：`NSLocationWhenInUseUsageDescription`、`NSLocationAlwaysAndWhenInUseUsageDescription`、后续运动采集使用的 `NSMotionUsageDescription`、`UIBackgroundModes` 中的 `location`。

## Mac 验证

`ios/GuardianCoreTests/GuardianCoreTests.swift` 提供 4 项 XCTest。创建 iOS 单元测试 target，将该文件和 `GuardianEvent.swift`、`GuardianGeofence.swift`、`GuardianEventStore.swift`、`GuardianLocationPolicy.swift` 加入测试 target 后执行。不依赖预先猜测的 App module 名称。

随后验证真实 AsyncStorage、桥接、AppDelegate 恢复、围栏进出、权限撤回、关闭后台刷新、系统终止后的重放与确认、断网、锁屏和耗电。Windows 上的桥接导出检查只核对声明，不替代 Swift 编译或真机测试。
