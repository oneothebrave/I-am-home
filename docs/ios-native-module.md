# iOS 原生模块

当前源码已加入 `DaojiaShuoYisheng` App target，并在 Xcode 27 / iOS 27 模拟器完成 Debug 编译；13 项 Swift XCTest 均通过。尚未完成 iPhone 真机上的长时间后台计时、权限变化、耗电和系统终止恢复验证。

## 职责

- `GuardianRuntime` 持有原生服务，与 RN 页面生命周期分离。
- `GuardianEventStore` 将围栏配置、启停状态、通知联系人、Critical Messaging 待发送操作和未消费事件保存到 Application Support。写入使用原子替换；读取损坏或未知版本时返回错误，不重建默认数据覆盖旧内容。
- `GuardianEvent` 在创建时生成 ID，序列化和重放时保持 ID；保留测量时间和接收时间，未知电量不转换为负数百分比。
- `GuardianLocationPolicy` 拒绝超过 120 秒、超前 5 秒、精度大于 100 米或无效的位置。初次定位不算移动，移动距离必须超过 50 米及两次测量精度之和，比较样本间隔不超过 120 秒。这是待实测调整的保守策略。
- `GuardianInactivityState` 只在确认离开所有“家”围栏、且当前处于每日单段守护时段时计时，可信位移、Core Motion 活动或步数会续期；回家或离开守护时段会清除计时。达到阈值只生成一条 `NO_MOTION_FOR_LONG_TIME`，恢复移动后才允许下一次触发。阈值、时段、状态、联系人和短信操作随原生存储 v4 持久化，v1/v2/v3 文件会原地迁移。
- `GuardianCriticalMessagingGateway` 已按 iOS 18.2 的 `MSCriticalSMSMessenger` 编译真实的授权检查、授权申请和发送调用；当前 target 没有 Critical Messaging entitlement，配置开关保持关闭，因此不会实际发送。
- 生成无活动异常时，风险事件、检测状态和每位家人的待发送短信操作一次原子写入。状态页读取并展示这些操作，不能把 `prepared` 解释为 `sent`。
- 异常落盘后会为优先级最高的第 1 位家人生成与前台测试相同的 `shortcuts://run-shortcut` 输入，并立即尝试打开唯一命名的“到家了么短信通知 V3”。尝试时间、是否仍待尝试、iOS 是否接受打开请求及失败原因独立持久化；接受打开不等于信息动作执行，更不等于短信已发送或送达。旧版本生成的历史操作不会被自动补发。
- 离家期间启用百米级、50 米距离过滤的连续定位以及运动信号；在家时停止这部分采集。此设计用于争取后台回调，并不保证 iOS 在任何系统状态下都能精确到分钟触发，仍需真机做锁屏、终止和耗电验证。
- 恢复时只增删实际发生变化的系统围栏，不再先停止全部围栏；同时恢复重大位置变化和 Visit 监听。Core Location 唤醒、普通启动、回到前台、系统时间明显变化及重启后受保护数据首次可用时都会进入同一套幂等恢复流程。
- 原生恢复先取得新的可信位置并重放可用的 Core Motion 历史，再判断无活动是否超时，避免进程恢复瞬间直接使用过期内存状态报警。后台恢复期间使用有限的 UIKit background task，降低系统在恢复中途再次挂起进程的概率。
- 下一次守护时段边界或无活动截止时间会提交为 `BGAppRefreshTask`，状态接口保留最近唤醒、恢复结果、后台检查和下次请求时间用于诊断。该任务只是额外兜底；iOS 决定实际运行时间，不能把它当成精确计时器。
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
setActiveWindow(schedule: GuardianSchedule): Promise<void>
setNotificationContacts(contacts: GuardianContact[]): Promise<void>
getCriticalMessagingPreparation(): Promise<unknown>
getCurrentStatus(): Promise<{
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
}>
getPendingEvents(): Promise<unknown[]>
acknowledgeEvents(ids: string[]): Promise<void>
sendSOS(): Promise<void>
```

`requestPermissions` 启动位置授权流程，首次请求 When In Use，再次请求时申请 Always。`requestMotionPermission` 通过 Core Motion 查询触发“运动与健身”授权。调用返回不代表已经授权，均需用 `getPermissions` 读取实际状态。权限结果还包含 `backgroundRefresh`（`available`、`denied` 或 `restricted`）；后台 App 刷新不可用时，系统无法可靠地为围栏、重大位置变化或后台刷新任务重新拉起 App。运动权限被拒绝时，守护仍运行，但家外停留判断只能依赖位置信号，可靠性会降低。

`getCurrentLocation` 只用于用户主动采点。它要求 When In Use 或 Always 权限以及精确位置，等待最多 15 秒，并拒绝超过 2 分钟或水平精度差于 100 米的样本。大致位置模式下 Apple 不支持区域监控，因此不会把这类坐标保存为可用围栏。

设备模式中的 JS 协调器会把完整地点数组传给 `setGeofences`。同步操作严格串行，连续增删或调整半径时以最新配置为准；失败状态保留在界面并可用同一目标配置重试。进入设备模式前会清除所有演示坐标，避免把示例地点写入原生存储。

设备模式守护开关由独立 JS 控制器串行调用 `startGuardian` 和 `stopGuardian`。开启前会重新读取权限、要求至少一个真实地点并等待围栏同步；操作完成后必须再由 `getCurrentStatus` 确认，才把原生启停事实写回 JS。失败时会读取实际原生状态回滚 UI。App 启动、回到前台和收到 `GuardianError` 时也会重新核对，避免把未知或失效的后台能力显示成安全。

`startGuardian` 要求至少一个围栏、Always 权限、精确位置、后台 location 配置、合法的单段守护时段与受支持的区域监控；配置超过上限或含非法数据时拒绝，不静默截断。“家外长时间无明显移动”规则还要求至少一个地点类型为“家”，缺少“家”不会阻止其他围栏守护，但不会启动该规则。时段开始时间包含、结束时间不包含；时段外停止运动和连续定位采集并清零未完成的无活动周期，围栏及重大位置变化仍全天工作。实际区域注册仍是异步操作，失败通过 `GuardianError` 和状态接口暴露。事件通知为 `GuardianEvent`。

风险事件直接进入家人通知队列，不向本人发送本地确认通知，也不提供“我没事”按钮。原生检测会在保存新异常后尝试运行短信快捷指令，但锁屏或后台状态下 iOS 可能拒绝把快捷指令 App 带到前台。系统回调只记录为 `shortcutOpenSucceeded`，不会据此把 Critical Messaging 操作标记为 `sent`。

Critical Messaging 需要 iOS 18.2 或更高版本、`com.apple.developer.messages.critical-messaging` entitlement、`NSCriticalMessagingUsageDescription` 以及用户针对收件人的授权。Apple 规定 `send` 只能在 App 位于后台时调用；前台调用会返回不支持。当前只完成待发送操作和 API 适配器，自动发送协调器与 entitlement 尚未启用。

## 启动恢复

AppDelegate 的应用启动方法已在主线程、RN factory 创建前注册后台任务并恢复：

```swift
GuardianBootstrap.registerBackgroundTasks()
GuardianBootstrap.restore(reason: "application-launch")
```

这是原生恢复入口。位置事件启动会记录为 `location-event`；场景再次进入前台会主动重新核对；首次解锁前存储不可读时，`applicationProtectedDataDidBecomeAvailable` 会再次初始化。数据损坏仍返回错误，不会用默认值覆盖旧文件。以上已完成工程接线和模拟器启动验证，但不能据此声称后台唤醒时间已在真机得到系统保证。

已配置：`NSLocationWhenInUseUsageDescription`、`NSLocationAlwaysAndWhenInUseUsageDescription`、`NSMotionUsageDescription`、`NSCriticalMessagingUsageDescription`、`UIBackgroundModes` 中的 `location` 与 `fetch`，以及 `BGTaskSchedulerPermittedIdentifiers`。`GuardianCriticalMessagingEnabled` 当前为 `false`，必须和真实 entitlement、App ID 及 provisioning profile 一起启用。

系统边界必须保留在产品说明与测试结论中：关机期间没有本机代码能够执行；重启后围栏能力要等用户首次解锁；用户从多任务界面强制结束 App，或关闭后台 App 刷新/定位权限时，系统可能不再重新拉起；`BGAppRefreshTask.earliestBeginDate` 只表示不能早于该时间，不能保证准时运行。

## Mac 验证

`ios/GuardianCoreTests/GuardianCoreTests.swift` 提供 13 项 XCTest，覆盖单段时段边界、跨休息时间清零、1 分钟测试阈值、只在家外触发、单次去重、移动恢复、回家取消、风险事件与短信操作原子持久化、旧原生数据迁移，以及不重复替换配置未变化的系统围栏；在 iOS 27 模拟器全部通过，不依赖 Metro。

Ruby 版本由根目录 `mise.toml` 固定，Bundler 依赖安装在 `vendor/bundle`，无需全局安装 CocoaPods。执行：

```bash
mise exec -- bundle config set --local path vendor/bundle
mise exec -- bundle install
mise exec -- bundle exec pod install --project-directory=ios
open ios/DaojiaShuoYisheng.xcworkspace
```

Xcode 27 强制 UIKit scene 生命周期，因此 AppDelegate 只负责初始化共享运行时和 React Native factory，`SceneDelegate` 创建与场景关联的窗口。Pods 安装过程还会应用 Apple Clang 21 所需的 `fmt` 兼容修复。

随后验证真实 AsyncStorage、桥接、AppDelegate 恢复、围栏进出、权限撤回、关闭后台刷新、系统终止后的重放与确认、断网、锁屏和耗电。Windows 上的桥接导出检查只核对声明，不替代 Swift 编译或真机测试。
