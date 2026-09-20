# 到家说一声：Codex 项目交接 Prompt

> 更新日期：2026-09-20
> GitHub：https://github.com/oneothebrave/I-am-home
> 分支：`main`
> 功能代码基线：`3a1fbfd`（本文件会在其后的交接提交中加入）

下面的内容可以直接作为新电脑上新 Codex 会话的首条 prompt。请先阅读和核对仓库，不要把文档里的“已实现”误解为已经通过 iPhone 真机验证。

---

你正在接手一个名为《到家说一声》的 iOS-first 家庭安全守护 App。请在开始修改前完整阅读本文件、`README.md`、`docs/refactoring.md` 和相关源码，并执行 `git status` 确认工作区状态。现有代码可能包含用户后续修改，不要覆盖或回退不属于你的改动。

## 一、产品目标与技术路线

产品面向独居或经常独自上山劳作的人。被监护人不应频繁手动签到，App 应在获得明确授权后，利用后台定位、重大位置变化、地理围栏、运动信号和电量等信息判断是否可能发生异常，再按规则提醒本人并逐步通知家人。

当前确定的技术路线：

- React Native + TypeScript：页面、配置、状态展示、联系人、地点和事件记录。
- Swift 原生模块：iOS 后台定位、地理围栏、运动采集、权限、事件持久化和系统唤醒入口。
- 共享领域层：将原生事件归约为 `safe`、`attention`、`emergency` 或 `unknown`，并维护一次事故的升级状态。
- 当前不需要远程数据库来完成本地原型；未来若要跨设备通知家人、账户同步、送达回执和审计记录，则需要后端服务、推送服务和数据库。

这是一款安全相关产品，但当前仓库仍是工程原型，不能宣称能够可靠发现事故，也不能作为唯一安全保障。

## 二、当前状态

- 默认运行在明确标识的演示模式，不发送真实通知。
- React Native 页面、领域规则、本地持久化抽象和 JavaScript 到 Swift 的事件协议已经实现。
- 仓库已包含可直接构建的 React Native iOS workspace；Swift 核心已加入 App target，4 项 XCTest 已加入无宿主测试 target。
- Swift 代码已用 Xcode 27 在 iOS 27 模拟器编译、启动并通过 4 项 XCTest；后台定位、进程被系统终止后的恢复、耗电和真机通知仍未验证。
- `GuardianBootstrap.restore()` 已在 AppDelegate 中接入 React Native factory 创建前的启动流程；这不等于真机后台唤醒已经验证。
- 地点页已支持真实设备模式下的当前位置采点；进入设备模式会先清除演示地点、事件和联系人，避免把 `mockData.ts` 的演示经纬度同步到原生围栏。地图选点仍未实现。
- 真实采点要求定位已授权、精确位置开启、样本不超过 2 分钟且水平精度在 100 米内。新增、删除和半径调整会串行同步到 Swift，失败会显示并允许重试。
- 设备模式守护开关已接入 Swift `startGuardian` / `stopGuardian`。开启前要求至少一个真实地点、Always 定位、精确位置和成功的围栏同步；原生确认成功后才更新 JS 状态，失败会回读原生状态并回滚。App 启动和回到前台时会重新核对 `getCurrentStatus()`，明确显示后台监控、权限不足、配置未同步或原生错误。
- 当前没有真实 CoreMotion 采集执行器、后台定时风险评估器、APNs/短信通知、家人端、账户系统或服务端送达回执。
- CI 位于 `.github/workflows/checks.yml`，使用 Windows + Node 24 执行安装、类型检查、测试和 iOS JavaScript bundle。交接时尚未在本文档中记录远端 CI 的实际运行结论，请自行查看 GitHub Actions。

## 三、已经完成的工作

### 1. 事故状态与升级规则

- `src/domain/guardianProjection.ts` 是统一事件归约入口。
- SOS 会直接建立紧急事故，不依赖先出现被动风险。
- SOS 不会被普通运动、回家、电量恢复等事件错误清除，只能由明确的本人安全确认结束。
- 被动风险升级为 SOS 时会建立新的事故 ID，旧通知回执不会污染新事故。
- 通知进度按事故 ID 和联系人 ID 追踪，不再依赖“通知事件数量”。联系人删除、重排或事件重放不会跳过下一位联系人。
- 空联系人名单进入阻断状态；完成动作不会重复产生。
- `src/domain/escalation.ts` 负责本人提醒、等待、家人队列、阻断、完成和家人确认等阶段。
- `src/domain/riskEngine.ts`、`guardianRules.ts` 和 `notificationCopy.ts` 共享统一快照与原因，不再分别推断状态。

### 2. 本地状态与持久化

- `src/state/guardianStore.ts` 是集中状态协调器，页面不再各自维护相互竞争的业务状态。
- 支持安全 hydration：加载期间发生的 SOS 或“我没事”不会被迟到的磁盘数据覆盖。
- 保存操作串行、合并且可 `flush()`；已修复“保存 Promise 即将结束时又发生新修改会丢失”的竞态。
- `src/storage/guardianSchema.ts` 定义 v2 本地 schema，并迁移旧版数据。
- `src/storage/guardianStorage.ts` 支持持久存储失败时退回内存，同时明确报告 `durable` 或 `memory`，不会把内存成功伪装成磁盘成功。
- 存储失败可重试；读取失败不会悄悄生成默认数据并覆盖原数据。
- 旧版仅保存 `HH:mm` 的事件无法恢复真实日期，迁移只能依据最后保存时间推断，这是已知限制。

### 3. 数据协议与校验

- `src/domain/validation.ts` 对配置、联系人、地点、时间、坐标和原生事件做运行时校验。
- 事件使用稳定 ID 和 ISO 时间；时间线按真实日期显示。
- 联系人上限为 3，地点/围栏上限为 20，并校验重复 ID、电话号码、半径和经纬度。
- 未知电量不再伪造成固定数值，`0%` 可以正确显示。
- 原生定位事件保留测量时间，陈旧、未来、精度差或坐标非法的样本由策略过滤。

### 4. iOS 原生核心

- `ios/GuardianCore/GuardianEventStore.swift`：原生事件和围栏配置的原子持久化队列。
- `GuardianLocationPolicy.swift`：定位年龄、精度和真实位移过滤。
- `GuardianLocationService.swift`：权限、重大位置变化、地理围栏和事件产生。
- `GuardianRuntime.swift`：独立于 React Native 监听器的运行时、启动恢复和失败缓冲。
- `GuardianNativeModule.swift/.m`：React Native bridge，提供权限、启动/停止、围栏、状态、待处理事件、确认消费、SOS 和安全确认接口。
- `src/native/guardianEventSync.ts`：先把原生事件持久化到 JS 状态，再向原生确认消费；失败时保留原生队列以便重放。
- `ios/GuardianCoreTests/GuardianCoreTests.swift`：4 个已在 iOS 27 模拟器通过的 XCTest。

### 5. 测试与文档

- Windows 基线及 2026-09-20 macOS 复验：`npm ci`、`npm run typecheck`、`npm test`、`npm run bundle:ios` 全部通过。
- Node 测试共 50 项，覆盖领域规则、状态/存储竞态、React 组件、定位样本校验、原生事件、围栏同步与守护启停协议。
- iOS Debug 工程已用 Xcode 27 编译并在 iOS 27 模拟器启动，4 项 Swift XCTest 全部通过。
- 现有测试仍不包含真实后台行为、UI 截图或 iPhone 真机测试。
- 详细重构说明：`docs/refactoring.md`。
- 原始审查记录：`docs/reviews/2026-09-08-review.md`，它是历史基线，不代表当前仍存在其中所有问题。

## 四、关键目录

- `App.tsx`：应用组合、Tab、演示动作和设备模式同步入口。
- `src/screens`：概览、地点、规则、家人和时间线页面。
- `src/domain`：领域类型、事件归约、风险判断、升级流程、校验和通知文案。
- `src/state`：纯 reducer、集中 store 和 React hook。
- `src/storage`：schema、repository、AsyncStorage 和内存降级。
- `src/native`：JS 原生桥契约、事件同步与串行围栏同步。
- `ios/DaojiaShuoYisheng.xcworkspace`：安装 Pods 后应打开的 iOS workspace。
- `ios/GuardianCore`：已加入 App target 的 Swift 原生核心源码。
- `ios/GuardianCoreTests`：已加入测试 target 并在模拟器通过的 Swift 测试。
- `tests`：Windows/Node 可执行的 50 项测试。
- `docs`：产品、风险、升级、存储、iOS 接入和重构文档。

## 五、新电脑接手后的第一轮操作

1. 克隆仓库并确认分支：

   ```bash
   git clone https://github.com/oneothebrave/I-am-home.git
   cd I-am-home
   git status
   git log -3 --oneline
   ```

2. 使用符合 `package.json` engines 的 Node 版本，推荐 Node 24，然后执行：

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run bundle:ios
   ```

3. 不要仅凭文档假设测试仍通过。记录当前 commit、命令输出和任何环境差异。

4. 如果新电脑是 Mac，使用 `mise.toml` 固定的 Ruby，先将 Bundler/CocoaPods 安装在项目内，再生成 Pods：

   ```bash
   mise exec -- bundle config set --local path vendor/bundle
   mise exec -- bundle install
   mise exec -- bundle exec pod install --project-directory=ios
   ```

   不需要 Watchman。打开 `ios/DaojiaShuoYisheng.xcworkspace`，不要打开 `.xcodeproj`。

## 六、下一步，按优先级执行

### P0：建立可编译的 iOS 工程（已完成）

1. 生成或补齐与 React Native 0.82 兼容的 iOS Xcode 工程，并保留现有 bundle identifier 决策空间。
2. 将 `ios/GuardianCore` 文件加入 App target，将 `ios/GuardianCoreTests` 加入测试 target。
3. 补齐 bridging/module 注册、React Native 依赖和构建设置。
4. 在 Info.plist 增加定位和运动权限说明，并配置 `UIBackgroundModes/location`。
5. 在 AppDelegate 启动阶段接入 `GuardianBootstrap.restore()`。
6. Swift 编译、模拟器启动和 4 个 XCTest 已通过。Xcode 27 所需的 UIScene 接入，以及 React Native 0.82 / Apple Clang 21 的小范围 Pods 兼容修复，均已纳入工程。

### P1：打通真实设备模式

1. iPhone 当前位置采点已实现；下一步补地图选点和采点位置的可视化复核。
2. 页面地点配置、定位/精度状态、Always Location 升级引导和守护开关已接入原生围栏；下一步补运动和通知权限的完整申请与能力展示。
3. 接入真正的运动/步数来源，明确各信号的更新时间和置信度。
4. 增加后台风险评估与本人本地通知；不要依赖 JavaScript 常驻或普通定时器。
5. 在 UI 中保持“未知”和“能力不可用”状态，禁止把缺失信号解释成安全。

### P2：真机测试与产品校准

1. 覆盖离家、进入劳作地点、离开、长时间停留、无运动、低电量、定位关闭、回家和 SOS。
2. 测试前台、后台、锁屏、重启、App 被系统终止、弱网和无网。
3. 记录误报、漏报、事件延迟和电量消耗，再调整定位精度、围栏半径和时间阈值。
4. 明确 iOS 无法保证任意时刻持续执行 App 代码，产品文案和安全承诺必须符合平台现实。

### P3：真实家人通知与后端

1. 先定义通知通道、账户/家庭关系、隐私同意、撤销授权、送达/确认和升级策略。
2. 再设计最小后端、数据库和 APNs；短信只能作为受成本、地区和合规约束的补充通道。
3. 对敏感位置数据执行最小化采集、明确保留期限、传输加密和访问审计。
4. 在真实通知链路可验证之前，继续保留醒目的演示模式标识。

## 七、接手时必须遵守的边界

- 不要声称应用已经具备可靠的事故检测或真实通知能力。
- 不要把“有位置变化”直接等同于“人安全”；它只能作为多信号中的一个证据。
- 不要把没有事件、没有权限、定位失败或数据过期解释为安全。
- 不要依靠 React Native 后台常驻完成安全关键判断；关键采集、恢复和落盘应在 iOS 原生侧。
- 不要将真实家庭住址写入 `mockData.ts` 或提交到 Git。
- 不要在没有用户明确要求时引入云服务、付费短信或收集更多个人数据。
- 修改后至少运行与影响范围对应的测试；涉及 Swift 时必须在 Mac/Xcode 中编译和运行 XCTest，并记录未覆盖的真机风险。

请从核对仓库和运行现有检查开始，然后汇报：当前 commit、工作区是否干净、Windows/Node 检查结果、Mac/Xcode 是否可用，以及你建议执行的第一个 P0 小步骤。除非用户另有指示，接下来优先完成可编译 iOS 工程和原生接入，不要继续扩展演示功能。
