# iOS 原生模块

当前源码已加入 `DaojiaShuoYisheng` App target，并在 Xcode 27 / iOS 27 模拟器完成 Debug 编译和启动；4 项 Swift XCTest 均通过。尚未完成 iPhone 真机上的后台、权限变化、耗电和系统终止恢复验证。

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
getCurrentLocation(): Promise<{
  latitude: number
  longitude: number
  accuracy: number
  timestamp: string
}>
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

`getCurrentLocation` 只用于用户主动采点。它要求 When In Use 或 Always 权限以及精确位置，等待最多 15 秒，并拒绝超过 2 分钟或水平精度差于 100 米的样本。大致位置模式下 Apple 不支持区域监控，因此不会把这类坐标保存为可用围栏。

设备模式中的 JS 协调器会把完整地点数组传给 `setGeofences`。同步操作严格串行，连续增删或调整半径时以最新配置为准；失败状态保留在界面并可用同一目标配置重试。进入设备模式前会清除所有演示坐标，避免把示例地点写入原生存储。

设备模式守护开关由独立 JS 控制器串行调用 `startGuardian` 和 `stopGuardian`。开启前会重新读取权限、要求至少一个真实地点并等待围栏同步；操作完成后必须再由 `getCurrentStatus` 确认，才把原生启停事实写回 JS。失败时会读取实际原生状态回滚 UI。App 启动、回到前台和收到 `GuardianError` 时也会重新核对，避免把未知或失效的后台能力显示成安全。

`startGuardian` 要求至少一个围栏、Always 权限、精确位置、后台 location 配置与受支持的区域监控；配置超过上限或含非法数据时拒绝，不静默截断。实际区域注册仍是异步操作，失败通过 `GuardianError` 和状态接口暴露。事件通知为 `GuardianEvent`。

## 启动恢复

AppDelegate 的应用启动方法已在主线程、RN factory 创建前调用：

```swift
GuardianBootstrap.restore()
```

这是原生恢复入口。它已完成工程接线和模拟器启动验证，但不能据此声称后台唤醒已在真机验证。首次解锁前存储不可读时，后续接口调用会重试初始化；数据损坏仍返回错误。

需配置：`NSLocationWhenInUseUsageDescription`、`NSLocationAlwaysAndWhenInUseUsageDescription`、后续运动采集使用的 `NSMotionUsageDescription`、`UIBackgroundModes` 中的 `location`。

## Mac 验证

`ios/GuardianCoreTests/GuardianCoreTests.swift` 提供 4 项无 App 宿主的 XCTest。测试 target 已包含该文件以及 `GuardianEvent.swift`、`GuardianGeofence.swift`、`GuardianEventStore.swift`、`GuardianLocationPolicy.swift`，在 iOS 27 模拟器全部通过，不依赖 Metro 或 React Native UI 启动。

Ruby 版本由根目录 `mise.toml` 固定，Bundler 依赖安装在 `vendor/bundle`，无需全局安装 CocoaPods。执行：

```bash
mise exec -- bundle config set --local path vendor/bundle
mise exec -- bundle install
mise exec -- bundle exec pod install --project-directory=ios
open ios/DaojiaShuoYisheng.xcworkspace
```

Xcode 27 强制 UIKit scene 生命周期，因此 AppDelegate 只负责初始化共享运行时和 React Native factory，`SceneDelegate` 创建与场景关联的窗口。Pods 安装过程还会应用 Apple Clang 21 所需的 `fmt` 兼容修复。

随后验证真实 AsyncStorage、桥接、AppDelegate 恢复、围栏进出、权限撤回、关闭后台刷新、系统终止后的重放与确认、断网、锁屏和耗电。Windows 上的桥接导出检查只核对声明，不替代 Swift 编译或真机测试。
