# iOS 原生模块

当前源码已加入 `DaojiaShuoYisheng` App target，并在 Xcode 27 / iOS 27 模拟器完成 Debug 编译；8 项 Swift XCTest 均通过。尚未完成 iPhone 真机上的长时间后台计时、权限变化、耗电和系统终止恢复验证。

## 职责

- `GuardianRuntime` 持有原生服务，与 RN 页面生命周期分离。
- `GuardianEventStore` 将围栏配置、启停状态和未消费事件保存到 Application Support。写入使用原子替换；读取损坏或未知版本时返回错误，不重建默认数据覆盖旧内容。
- `GuardianEvent` 在创建时生成 ID，序列化和重放时保持 ID；保留测量时间和接收时间，未知电量不转换为负数百分比。
- `GuardianLocationPolicy` 拒绝超过 120 秒、超前 5 秒、精度大于 100 米或无效的位置。初次定位不算移动，移动距离必须超过 50 米及两次测量精度之和，比较样本间隔不超过 120 秒。这是待实测调整的保守策略。
- `GuardianInactivityState` 只在确认离开所有“家”围栏后计时，可信位移、Core Motion 活动或步数会续期；回家会清除计时。达到阈值只生成一条 `NO_MOTION_FOR_LONG_TIME`，恢复移动后才允许下一次触发。阈值和状态随原生存储 v2 持久化，v1 文件会原地迁移。
- 离家期间启用百米级、50 米距离过滤的连续定位以及运动信号；在家时停止这部分采集。此设计用于争取后台回调，并不保证 iOS 在任何系统状态下都能精确到分钟触发，仍需真机做锁屏、终止和耗电验证。
- 围栏事件记录围栏 ID 和名称，不把围栏中心伪装成手机精确位置。路口和劳作区使用不同事件类型。
- `GuardianNativeModule` 的系统操作统一派发到主线程；事件先写入队列，再尝试通知 JS。

定位质量检查依据 [Apple 定位数据处理说明](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html)。文件保护使用 [首次解锁后可访问的保护选项](https://developer.apple.com/documentation/foundation/nsdata/writingoptions/completefileprotectionuntilfirstuserauthentication)。这些设计仍需锁屏、重启及权限变化实测。

## 接口

```ts
requestPermissions(): Promise<void>
requestMotionPermission(): Promise<void>
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
setNoMotionThresholdMinutes(value: number): Promise<void>
getCurrentStatus(): Promise<{
  isGuardianOn: boolean;
  isMonitoring: boolean;
  pendingEventCount: number;
  lastError?: string;
}>
getPendingEvents(): Promise<unknown[]>
acknowledgeEvents(ids: string[]): Promise<void>
sendSOS(): Promise<void>
```

`requestPermissions` 启动位置授权流程，首次请求 When In Use，再次请求时申请 Always。`requestMotionPermission` 通过 Core Motion 查询触发“运动与健身”授权。调用返回不代表已经授权，均需用 `getPermissions` 读取实际状态。运动权限被拒绝时，守护仍运行，但家外停留判断只能依赖位置信号，可靠性会降低。

`getCurrentLocation` 只用于用户主动采点。它要求 When In Use 或 Always 权限以及精确位置，等待最多 15 秒，并拒绝超过 2 分钟或水平精度差于 100 米的样本。大致位置模式下 Apple 不支持区域监控，因此不会把这类坐标保存为可用围栏。

设备模式中的 JS 协调器会把完整地点数组传给 `setGeofences`。同步操作严格串行，连续增删或调整半径时以最新配置为准；失败状态保留在界面并可用同一目标配置重试。进入设备模式前会清除所有演示坐标，避免把示例地点写入原生存储。

设备模式守护开关由独立 JS 控制器串行调用 `startGuardian` 和 `stopGuardian`。开启前会重新读取权限、要求至少一个真实地点并等待围栏同步；操作完成后必须再由 `getCurrentStatus` 确认，才把原生启停事实写回 JS。失败时会读取实际原生状态回滚 UI。App 启动、回到前台和收到 `GuardianError` 时也会重新核对，避免把未知或失效的后台能力显示成安全。

`startGuardian` 要求至少一个围栏、Always 权限、精确位置、后台 location 配置与受支持的区域监控；配置超过上限或含非法数据时拒绝，不静默截断。“家外长时间无明显移动”规则还要求至少一个地点类型为“家”，缺少“家”不会阻止其他围栏守护，但不会启动该规则。实际区域注册仍是异步操作，失败通过 `GuardianError` 和状态接口暴露。事件通知为 `GuardianEvent`。

风险事件直接进入家人通知队列，不向本人发送本地确认通知，也不提供“我没事”按钮。当前快捷指令只能由前台主动测试；原生后台检测不会冒充成短信已发送。

## 启动恢复

AppDelegate 的应用启动方法已在主线程、RN factory 创建前调用：

```swift
GuardianBootstrap.restore()
```

这是原生恢复入口。它已完成工程接线和模拟器启动验证，但不能据此声称后台唤醒已在真机验证。首次解锁前存储不可读时，后续接口调用会重试初始化；数据损坏仍返回错误。

需配置：`NSLocationWhenInUseUsageDescription`、`NSLocationAlwaysAndWhenInUseUsageDescription`、后续运动采集使用的 `NSMotionUsageDescription`、`UIBackgroundModes` 中的 `location`。

## Mac 验证

`ios/GuardianCoreTests/GuardianCoreTests.swift` 提供 8 项无 App 宿主的 XCTest。测试 target 还包含纯状态机 `GuardianInactivityDetector.swift`，覆盖只在家外触发、单次去重、移动恢复、回家取消、事件与状态原子持久化和 v1 原生数据迁移；在 iOS 27 模拟器全部通过，不依赖 Metro 或 React Native UI 启动。

Ruby 版本由根目录 `mise.toml` 固定，Bundler 依赖安装在 `vendor/bundle`，无需全局安装 CocoaPods。执行：

```bash
mise exec -- bundle config set --local path vendor/bundle
mise exec -- bundle install
mise exec -- bundle exec pod install --project-directory=ios
open ios/DaojiaShuoYisheng.xcworkspace
```

Xcode 27 强制 UIKit scene 生命周期，因此 AppDelegate 只负责初始化共享运行时和 React Native factory，`SceneDelegate` 创建与场景关联的窗口。Pods 安装过程还会应用 Apple Clang 21 所需的 `fmt` 兼容修复。

随后验证真实 AsyncStorage、桥接、AppDelegate 恢复、围栏进出、权限撤回、关闭后台刷新、系统终止后的重放与确认、断网、锁屏和耗电。Windows 上的桥接导出检查只核对声明，不替代 Swift 编译或真机测试。
