# iOS 原生模块

2026-09-29 最新：增加原生持久化暂停意图、明确恢复参数；修复时钟回拨导致定位/无活动检查卡住、短信结果落盘失败导致误重发及多个风险绕过冷却的问题。Windows 基线 **213 项**，原生测试源码 **73 项**，原生部分未编译运行；必须重新构建完整 iOS 包。见 [Bug 修复与代码清理](bugfix-and-dead-code-cleanup.md)。

同日前轮：`GuardianStorageProtection` 负责元数据和历史副本清理，`GuardianStorageIntegrity` 增加底层完整性、磁盘结果核对与存在性标记。保护桥接仍为 `checkLocalStorage` / `checked-v2`。当轮 205/65 见 [完整性与 Mac 验收](storage-integrity-and-mac-acceptance.md)，此前 181/49 见 [本地存储保护专项](local-storage-protection.md)。下方更早记录为历史基线。

2026-09-28 后续：已加入原生清除标记、原子清除、旧异步回调隔离、已结束通知保留期限与原生目录备份排除。当前 XCTest 源码共 37 项，仍未在本轮 Windows 环境编译运行；验收见 [数据生命周期与地点状态](data-lifecycle-and-place-status.md)。JS 端对 `getCurrentStatus` / `getPermissions` 做校验与 8 秒只读超时，其余有副作用接口不套用；见 [读取及分享加固](windows-reliability-hardening.md)。最新 Windows 基线 162 项、固定工程标识及时间行为边界见 [发布与时间专项](release-preflight-and-time.md)。

2026-09-28 第一轮：加入模式分离、低电量与可信位置中断执行器（`GuardianRiskDetector.swift`），并接入 App / XCTest target。原生存储升为 v6，该轮测试源码为 31 项；**Windows 仅验证了 JS/TS 和打包，以下 21 项通过记录属于上一版，不能视为新原生代码已编译。** 规则与验收详见 [模式与风险执行器](testing-mode-and-risk-executors.md)。

当前源码已加入 `DaojiaShuoYisheng` App target，并在 Xcode 27 / iOS 27 模拟器完成 Debug 编译；21 项 Swift XCTest 均通过。尚未完成 iPhone 真机上的长时间后台计时、权限变化、耗电和系统终止恢复验证。

## 职责

- `GuardianRuntime` 持有原生服务，与 RN 页面生命周期分离。
- `GuardianEventStore` 将围栏配置、启停状态、通知联系人、Critical Messaging 待发送操作和未消费事件保存到 Application Support。写入使用原子替换；读取损坏或未知版本时返回错误，不重建默认数据覆盖旧内容。
- `beginDataDeletion` 只能在用户确认清除后调用，先持久化禁用状态及清除标记；若原文件无法读取，允许此明确清除操作重建空的“清除中”文件。普通启动/重试读取不会走此覆盖路径。`clearLocalData` 在 JS 清除标记已可靠保存后清空原生数据；两侧标记均完成前不报告清除成功。
- `GuardianEvent` 在创建时生成 ID，序列化和重放时保持 ID；保留测量时间和接收时间，未知电量不转换为负数百分比。
- `GuardianLocationPolicy` 拒绝超过 120 秒、超前 5 秒、精度大于 100 米或无效的位置。初次定位不算移动，移动距离必须超过 50 米及两次测量精度之和，比较样本间隔不超过 120 秒。这是待实测调整的保守策略。
- `GuardianInactivityState` 只在确认离开所有“家”围栏、且当前处于每日单段守护时段时计时，可信位移、Core Motion 活动或步数会续期；回家或离开守护时段会清除计时。达到阈值只生成一条 `NO_MOTION_FOR_LONG_TIME`，恢复移动后才允许下一次触发。阈值、时段、状态、联系人、逐联系人授权和短信操作随原生存储 v6 持久化，v1/v2/v3/v4/v5 文件会原地迁移。
- `GuardianCriticalMessagingGateway` 已按 iOS 18.2 的 `MSCriticalSMSMessenger` 编译真实的授权检查、授权申请和发送调用；当前 target 没有 Critical Messaging entitlement，配置开关保持关闭，因此不会实际发送。
- `GuardianCriticalMessagingCoordinator` 只在 App 位于后台时提交短信；前台生成或恢复的操作会等待下一次后台机会。每位联系人独立经历 `prepared`、`sending`、`retryScheduled`、`accepted`、`failed`、`restricted`、`expired` 或 `cancelled`，授权与结果均持久化。
- 默认策略为 30 分钟有效期、最多 3 次尝试、失败后 1 分钟和 5 分钟重试、同一联系人 10 分钟冷却。提交前先原子写入 `sending`；若进程在结果返回前消失，2 分钟后标记为结果未知并停止自动重试，优先避免重复短信。
- 生成无活动异常时，风险事件、检测状态和每位家人的待发送短信操作一次原子写入。状态页读取并展示这些操作，不能把 `prepared` 解释为 `sent`。
- 原生风险检测不会打开 `shortcuts://run-shortcut`。快捷指令仅用于用户在“家人联系方式”中主动发送测试短信；历史快捷指令尝试字段继续兼容读取，但旧的待尝试操作会在原生存储加载时关闭，不会补发。
- 离家期间启用百米级、50 米距离过滤的连续定位以及运动信号；在家时停止这部分采集。此设计用于争取后台回调，并不保证 iOS 在任何系统状态下都能精确到分钟触发，仍需真机做锁屏、终止和耗电验证。
- 恢复时只增删实际发生变化的系统围栏，不再先停止全部围栏；同时恢复重大位置变化和 Visit 监听。Core Location 唤醒、普通启动、回到前台、系统时间明显变化及重启后受保护数据首次可用时都会进入同一套幂等恢复流程。
- 原生恢复先取得新的可信位置并重放可用的 Core Motion 历史，再判断无活动是否超时，避免进程恢复瞬间直接使用过期内存状态报警。后台恢复期间使用有限的 UIKit background task，降低系统在恢复中途再次挂起进程的概率。
- 下一次守护时段边界或无活动截止时间会提交为 `BGAppRefreshTask`，状态接口保留最近唤醒、恢复结果、后台检查和下次请求时间用于诊断。该任务只是额外兜底；iOS 决定实际运行时间，不能把它当成精确计时器。
- 围栏事件记录围栏 ID 和名称，不把围栏中心伪装成手机精确位置。路口和劳作区使用不同事件类型。
- `GuardianNativeModule` 的守护/系统操作派发到主线程；事件先写入队列，再尝试通知 JS。存储检查独立在串行工作队列执行，普通检查不启动 GuardianRuntime，也不要求定位权限；明确清除的修复检查须先在主线程核对原生持久化清除意图。它有副作用，不套用 8 秒只读超时。

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
startGuardian(config: GuardianConfig, resumePaused: boolean): Promise<void>
stopGuardian(): Promise<void>
beginDataDeletion(): Promise<void>
clearLocalData(): Promise<void>
checkLocalStorage(access: {
  operation: 'read' | 'write' | 'remove' | 'deletion';
  phase: 'before' | 'after' | 'failed';
  value: string | null;
}): Promise<'checked-v2'>
setGeofences(geofences: GuardianGeofence[]): Promise<void>
setNoMotionThresholdMinutes(value: number): Promise<void>
setMonitoringPolicy(schedule: GuardianSchedule): Promise<void>
setActiveWindow(schedule: GuardianSchedule): Promise<void>
setNotificationContacts(contacts: GuardianContact[]): Promise<void>
getCriticalMessagingPreparation(): Promise<unknown>
requestCriticalMessagingAuthorization(): Promise<unknown>
refreshCriticalMessagingAuthorization(): Promise<unknown>
getCurrentStatus(): Promise<{
  isGuardianOn: boolean;
  isGuardianPaused: boolean;
  isMonitoring: boolean;
  isInActiveWindow: boolean;
  pendingEventCount: number;
  dataDeletionPending: boolean;
  monitoringMode: 'standard' | 'test';
  riskHealth: {
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
}>
getPendingEvents(): Promise<unknown[]>
acknowledgeEvents(ids: string[]): Promise<void>
sendSOS(): Promise<void>
```

`requestPermissions` 启动位置授权流程，首次请求 When In Use，再次请求时申请 Always。`requestMotionPermission` 通过 Core Motion 查询触发“运动与健身”授权。调用返回不代表已经授权，均需用 `getPermissions` 读取实际状态。权限结果还包含 `backgroundRefresh`（`available`、`denied` 或 `restricted`）；后台 App 刷新不可用时，系统无法可靠地为围栏、重大位置变化或后台刷新任务重新拉起 App。运动权限被拒绝时，守护仍运行，但家外停留判断只能依赖位置信号，可靠性会降低。

`getCurrentLocation` 只用于用户主动采点。它要求 When In Use 或 Always 权限以及精确位置，等待最多 15 秒，并拒绝超过 2 分钟或水平精度差于 100 米的样本。大致位置模式下 Apple 不支持区域监控，因此不会把这类坐标保存为可用围栏。

设备模式中的 JS 协调器会把完整地点数组传给 `setGeofences`。同步操作严格串行，连续增删或调整半径时以最新配置为准；失败状态保留在界面并可用同一目标配置重试。进入设备模式前会清除所有演示坐标，避免把示例地点写入原生存储。

设备模式守护开关由独立 JS 控制器串行调用 `startGuardian` 和 `stopGuardian`。开启前会重新读取权限、要求至少一个真实地点并等待围栏同步；操作完成后必须再由 `getCurrentStatus` 确认，才把原生启停事实写回 JS。失败时会读取实际原生状态回滚 UI。App 启动、回到前台和收到 `GuardianError` 时也会重新核对，避免把未知或失效的后台能力显示成安全。

`stopGuardian` 同时持久化 `userPaused=true`。自动启动传 `resumePaused=false`，不能越过原生暂停；只有用户点击恢复才传 true。JS 启动预检先接纳原生暂停，再进行配置同步和自动启动。成功启停须回读匹配的启停事实与暂停标记，恢复前权限检查失败不清除暂停。状态缺少 `isGuardianPaused` 的旧原生包会被拒绝；原生 v6 新字段为可兼容读取的可选存储字段，不改变原有用户数据格式版本。JS 启动门槛和正常状态展示均要求后台刷新可用。

`startGuardian` 要求至少一个围栏、Always 权限、精确位置、后台 location 配置、合法的单段守护时段与受支持的区域监控；配置超过上限或含非法数据时拒绝，不静默截断。“家外长时间无明显移动”规则还要求至少一个地点类型为“家”，缺少“家”不会阻止其他围栏守护，但不会启动该规则。时段开始时间包含、结束时间不包含；时段外停止运动和连续定位采集并清零未完成的无活动周期，围栏及重大位置变化仍全天工作。实际区域注册仍是异步操作，失败通过 `GuardianError` 和状态接口暴露。事件通知为 `GuardianEvent`。

风险事件直接进入家人通知队列，不向本人发送本地确认通知，也不提供“我没事”按钮。原生检测只保存风险和 Critical Messaging 待发送操作，不会自动运行短信快捷指令；快捷指令的人工测试结果也不能把 Critical Messaging 操作标记为 `sent`。

Critical Messaging 需要 iOS 18.2 或更高版本、`com.apple.developer.messages.critical-messaging` entitlement、`NSCriticalMessagingUsageDescription` 以及用户针对收件人的授权。Apple 规定 `send` 只能在 App 位于后台时调用；前台调用会返回不支持。发送协调器、逐联系人授权和持久化状态机已接入，但当前 target 仍没有 entitlement，`GuardianCriticalMessagingEnabled` 也保持为 `false`，因此不会实际调用发送 API。

## 启动恢复

2026-09-28 的规则更新通过 `setMonitoringPolicy` 一次保存模式、两个时间阈值与守护时段，避免拆分调用短暂使用错误模式。正式模式时间阈值均为 15–240 分钟，测试模式为 1–240 分钟。进入正式模式还会在原生侧核对真实“家”、联系人、定位权限、精确位置、后台刷新及已注册围栏。旧的阈值 setter 同样执行当前模式限制。

电量/充电状态通知、后台刷新状态变化、定位回调、恢复流程、守护时段边界和可运行时的检查计时器都会进入原生风险检查。只有通过现有精度与年龄策略的 GPS 样本才能更新新执行器的可信位置时间；运动、围栏和 Visit 不能替代 GPS。两个新风险的检测状态、事件、逐联系人操作及解除取消在同一次原子写入中保存。测试模式和测试操作在协调器及发送入口两层阻止自动发送。

AppDelegate 的应用启动方法已在主线程、RN factory 创建前注册后台任务并恢复：

```swift
GuardianBootstrap.registerBackgroundTasks()
GuardianBootstrap.restore(reason: "application-launch")
```

这是原生恢复入口。位置事件启动会记录为 `location-event`；场景再次进入前台会主动重新核对；首次解锁前存储不可读时，`applicationProtectedDataDidBecomeAvailable` 会再次初始化。数据损坏仍返回错误，不会用默认值覆盖旧文件。以上已完成工程接线和模拟器启动验证，但不能据此声称后台唤醒时间已在真机得到系统保证。

已配置：`NSLocationWhenInUseUsageDescription`、`NSLocationAlwaysAndWhenInUseUsageDescription`、`NSMotionUsageDescription`、`NSCriticalMessagingUsageDescription`、`UIBackgroundModes` 中的 `location` 与 `fetch`，以及 `BGTaskSchedulerPermittedIdentifiers`。`GuardianCriticalMessagingEnabled` 当前为 `false`，必须和真实 entitlement、App ID 及 provisioning profile 一起启用。

系统边界必须保留在产品说明与测试结论中：关机期间没有本机代码能够执行；重启后围栏能力要等用户首次解锁；用户从多任务界面强制结束 App，或关闭后台 App 刷新/定位权限时，系统可能不再重新拉起；`BGAppRefreshTask.earliestBeginDate` 只表示不能早于该时间，不能保证准时运行。

## Mac 验证

当前统一入口为 `npm run check:mac -- --simulator <UUID>`，原生测试源共 73 项，全部待本轮 Mac 执行；流程、日志与边界见 [Mac 验收说明](storage-integrity-and-mac-acceptance.md)。下面 21 项通过结论只属于 2026-09-21 的旧版本。

`ios/GuardianCoreTests/GuardianCoreTests.swift` 提供 21 项 XCTest，覆盖单段时段边界、跨休息时间清零、1 分钟测试阈值、只在家外触发、单次去重、移动恢复、回家取消、风险事件与短信操作原子持久化、逐联系人授权、三次尝试上限、冷却、过期、恢复取消、未知发送结果不重试、旧原生数据迁移，以及不重复替换配置未变化的系统围栏；在 iOS 27 模拟器全部通过，不依赖 Metro。

Ruby 版本由根目录 `mise.toml` 固定，Bundler 依赖安装在 `vendor/bundle`，无需全局安装 CocoaPods。执行：

```bash
mise exec -- bundle config set --local path vendor/bundle
mise exec -- bundle install
mise exec -- bundle exec pod install --project-directory=ios
open ios/DaojiaShuoYisheng.xcworkspace
```

Xcode 27 强制 UIKit scene 生命周期，因此 AppDelegate 只负责初始化共享运行时和 React Native factory，`SceneDelegate` 创建与场景关联的窗口。Pods 安装过程还会应用 Apple Clang 21 所需的 `fmt` 兼容修复。

随后验证真实 AsyncStorage、桥接、AppDelegate 恢复、围栏进出、权限撤回、关闭后台刷新、系统终止后的重放与确认、断网、锁屏和耗电。Windows 上的桥接导出检查只核对声明，不替代 Swift 编译或真机测试。
