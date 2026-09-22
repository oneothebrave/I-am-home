# 到家了么 · 开发交接

更新时间：2026-09-22。本文用于从借用的 Mac 迁回原电脑继续开发。先看本文件，再看 `docs/development-plan.md` 和 `docs/ios-native-module.md`。不要把历史设计稿或旧审查文档中的计划当作当前已实现功能。

## 最重要的三件事

1. **迁回原电脑先核对 Git 提交。** 交接前的两个关键本地提交是 `a98028c5` 和 `f4480eb1`（守护诊断与 Critical Messaging 状态机）。远端是 `https://github.com/oneothebrave/I-am-home.git`。2026-09-22 已执行 `git fetch origin main`，确认远端当时停在 `dd3b69c5`、本地只领先两次提交且没有分叉；本文件应与这两次提交一起推送。在原电脑上先拉取并核对 `git log`，不要基于旧的 `dd3b69c5` 继续开发。
2. **当前代码不会自动给家人发短信。** 家外无活动风险检测与 Apple Critical Messaging 发送状态机已实现，但 iOS target 尚无所需 entitlement，`ios/DaojiaShuoYisheng/Info.plist` 中 `GuardianCriticalMessagingEnabled` 仍是 `false`。快捷指令 V3 仅供用户主动点击“发送测试短信”，风险事件不再自动运行快捷指令。界面中的“已准备”“系统已接受”分别是不同状态，不能写成“已送达”。
3. **最新状态机版本已覆盖安装到真机，但未完成实地回归。** 2026-09-22 用现有开发签名构建 Release 包，以 `com.llingrui.iamhome` 覆盖安装到 “Larry’s iPhone”（iPhone 16 Pro），安装后回读仍只有一个同 bundle ID 的 App，并成功启动。此前的真机实测证明过定位采点、原生围栏和家外无活动检测；这次新版本尚未做锁屏/实地/真实短信验证。

若后续还要从另一台电脑同步修改，先读取远端状态；确认没有分叉后再推送，不要强制推送：

```bash
git fetch origin main
git status -sb
# 仅在确认本地分支只是领先、没有分叉后：git push origin main
```

若无法使用 GitHub，也可以将整个仓库（尤其是 `.git` 与本文件）复制到自己的存储介质；不要只复制工作树而遗漏提交历史。

## 产品约束与已确定决策

- App 名称“到家了么”；面向老年用户，原则是“尽可能不打扰，在后台安静守护”。用户文案用“守护”，不用“监控”。界面只有“状态 / 地点 / 我的”三个 Tab；没有地图，也不需要地图依赖。
- 添加地点先取当前位置并显示精度，再选“家 / 农场 / 自定义”和半径 **150 / 300 / 500 米**；保存后同步到 iOS 原生围栏。围栏不能做成“小于 10 米”等不可靠选项。
- 至少一个真实地点、Always 定位、精确位置和原生围栏同步就绪后自动开始守护；“我的”可主动暂停并持久保存意图，不设常驻总开关。
- 家外长时间无明显活动只在**单段每日守护时段**内判断；必须至少设置一个类型为“家”的地点。时段外不累计无活动时间，但围栏进出仍记录。当前允许 1 分钟阈值用于实地测试，正式版需要独立测试模式。
- 不要求本人点击“我没事”，不向本人发无活动确认通知。家中“手机不动”不等于“人有危险”，家中无活动规则尚未获产品确认。
- 地点、足迹、异常、家人联系方式目前主要保存在本机；没有家人端 App、服务器通知或短信送达回执。

## 当前实现

| 范围 | 状态 |
| --- | --- |
| 地点与守护 | 真实位置采点、精度校验、本地保存、围栏同步；权限满足时自动启动，暂停意图持久化。 |
| 家外无活动 | Swift 原生状态机融合可信位置位移、Core Motion、步数和地点访问；风险事件落盘、去重，活动恢复/回家后解除；活动来源可追踪。不是保证精确到分钟的后台计时器。 |
| 后台恢复 | Core Location 唤醒、启动恢复、受保护数据可用后的重试及 `BGAppRefreshTask` 请求已接线；系统是否和何时执行仍由 iOS 决定。关机、强制退出、权限关闭时不能保证继续守护。 |
| 页面 | 三个主 Tab；“我的”内有家人联系方式、守护时间、权限、足迹、守护诊断。诊断按时间展示最近信号、后台机会、风险及短信操作，并提供脱敏报告。 |
| Critical Messaging | 每位联系人独立持久化授权与操作状态；支持准备、发送中、等待重试、系统接受、失败、受限、过期、取消。有效期 30 分钟，最多 3 次尝试，失败后 1/5 分钟重试，同联系人 10 分钟冷却。风险解除或操作过期不补发；若进程中断导致发送结果未知，不自动重试以避免重复短信。真实发送仍关闭。 |
| 快捷指令 | `到家了么短信通知 V3` 仅用于用户主动测试，使用 App 中第 1 位家人号码和测试内容；不是锁屏自动通知的生产方案。 |

尚未实现：低电量风险的正式原生后台执行器、长时间没有可信位置风险执行器、家中无活动规则、自动外发的生产验证、送达回执、完整的长期后台/耗电/异常权限实地验证。**不要向用户暗示家人已能收到自动通知。**

## 代码入口

- `App.tsx`：三 Tab、原生状态回读及页面协调。
- `src/screens/OverviewScreen.tsx`、`PlacesScreen.tsx`、`MyScreen.tsx`：主要用户界面。
- `src/screens/FamilyScreen.tsx`、`FootprintsScreen.tsx`、`DiagnosticsScreen.tsx`：家人、足迹、诊断。
- `src/storage/guardianSchema.ts`、`guardianRepository.ts`、`src/state/guardianStore.ts`：JS 本地数据 schema v3、迁移和持久化。
- `ios/GuardianCore/GuardianLocationService.swift`、`GuardianInactivityDetector.swift`：原生位置、活动与家外无活动规则。
- `ios/GuardianCore/GuardianEventStore.swift`：原生持久化 schema v5、风险事件和逐联系人短信操作；兼容旧版本。
- `ios/GuardianCore/GuardianCriticalMessaging.swift`：Apple API 适配器、授权、发送状态机与策略。
- `ios/GuardianCore/GuardianRuntime.swift`、`GuardianNativeModule.swift` / `.m`：原生生命周期、后台任务和 React Native 桥接。
- `src/native/criticalMessaging.ts`、`GuardianNative.ts`：JS 侧桥接类型与校验。
- `ios/GuardianCoreTests/GuardianCoreTests.swift`、`tests/`：原生与 JS 回归测试。

详细优先级见 `docs/development-plan.md`；原生接口与系统边界见 `docs/ios-native-module.md`；历史问题和修复见 `docs/refactoring.md`。部分旧文档/README 的测试数量与早期方案可能落后，以最新代码和本文件的验证结果为准。

## 验证基线与迁移环境

- 2026-09-22 在当前 Mac 重跑：`npm run typecheck` 通过；`npm test` **69/69** 通过。
- 2026-09-21：`npm run bundle:ios` 通过，iOS 27 模拟器 Debug 编译通过，**21 项 Swift XCTest** 通过。
- 2026-09-22：iPhone Release 构建与签名校验通过，内置离线 JS 包；覆盖安装到 `com.llingrui.iamhome` 成功，App 启动命令成功。没有进行当前版本的锁屏风险或真实 Critical Messaging 发送验证。
- 当前 Mac：macOS Apple Silicon、Xcode 27.0、Node v26.0.0。项目 `mise.toml` 固定 Ruby **3.3.12**；裸 `ruby` 指向系统 Ruby 2.6.10，运行 Bundler/CocoaPods 时应使用 `mise exec -- ...`。Watchman 未安装，也不需要为此额外安装。避免全局安装 CocoaPods 或其他依赖。
- 原电脑准备：先确认 Node 满足 `package.json` engines、Xcode/iOS SDK 可用；然后在仓库运行：

```bash
npm ci
mise exec -- bundle config set --local path vendor/bundle
mise exec -- bundle install
mise exec -- bundle exec pod install --project-directory=ios
npm run typecheck
npm test
npm run bundle:ios
open ios/DaojiaShuoYisheng.xcworkspace
```

`node_modules`、`vendor/bundle`、`ios/Pods` 和 `dist` 不在 Git 中，换电脑后需要按上述方式重建。若原电脑缺少 Node、mise 或 Xcode，先由用户决定/安装，不要通过全局依赖或额外绕路悄悄替代。不要把借用电脑上的签名证书、账号凭据或本机家人数据复制到仓库。

## 真机与签名注意

- 既有真机 App 的 bundle ID 是 **`com.llingrui.iamhome`**。Xcode 项目文件中的默认 `PRODUCT_BUNDLE_IDENTIFIER` 仍是 React Native 示例值；在原电脑选择自己的签名团队并明确设成上述 ID 后再安装，否则会生成第二个 App，且旧 App 的本机数据不会自动迁移。
- 原电脑需要重新核对 Apple 登录、设备信任、开发签名、Always 定位、精确位置、运动与健身及后台 App 刷新。之前借用电脑上的证书/配置不会随 Git 迁移。
- 覆盖安装前保留同一 bundle ID；不要卸载真机旧 App。App 的本地地点、足迹、家人号码和系统授权不属于 Git 仓库。快捷指令模板安装状态属于 iPhone/快捷指令环境，不是仓库数据。
- 当准备启用 Critical Messaging 时，先取得并核对真实 entitlement、App ID 和 provisioning profile，再将 `GuardianCriticalMessagingEnabled` 打开。分别在前台准备、切后台、锁屏、授权拒绝/恢复、无网络、风险解除、进程终止等场景做真机测试；系统“接受发送”不等于短信送达。不要仅凭购买开发者会员或模拟器编译就宣布可用。

## 建议的下一步（按优先级）

1. **完成代码迁移**：在原电脑核对是否已取得 `a98028c5`、`f4480eb1` 和本交接文件的提交，保留原电脑上任何已有未提交修改。
2. 当前版本已在真机覆盖安装；继续验证地点、权限、守护时间、活动恢复、诊断状态和旧数据迁移。原电脑若再次安装，仍须保持同一个 bundle ID；**不要测试真实 Critical Messaging 发送，当前构建未启用。**
3. 按 `docs/development-plan.md` 做低电量与长时间无可信位置执行器，并把 1 分钟停留阈值从正式模式拆出去。
4. 补完整真机矩阵：锁屏、系统挂起/回收、重启首次解锁、断网、低电量、权限变化、时区变化、围栏边界和耗电；记录异常出现时间、活动来源及诊断结果。
5. 取得 Critical Messaging 所需权限与签名后，再做逐联系人授权、后台真实提交、系统限频/失败、重复发送防护与 UI 文案验收。首次实测只发给明确同意接收的测试号码。

任何新修改都先检查 `git status` 和 `git diff`，不要覆盖或回退用户未提交的工作，也不要重构已通过真机验证的定位/围栏链路，除非有复现证据。
