# 到家了么 · 开发交接

更新时间：2026-09-29。本文用于从借用的 Mac 迁回原电脑继续开发。先看本文件，再看 `docs/development-plan.md` 和 `docs/ios-native-module.md`。不要把历史设计稿或旧审查文档中的计划当作当前已实现功能。

路径更新（2026-09-28）：当前 Windows 本地仓库位于 `E:\I-am-home`。后续命令以此目录为工作目录；iOS 编译和真机安装仍需在 Mac / Xcode 环境完成。

## 当前交接点：暂停开发，整理并本地提交

- 用户要求先不继续开发。本次将此前各轮尚未提交的 Windows 实现、修复、测试和配套文档一起归档到本地 Git；不推送、不联网同步、不执行新待办。恢复工作需用户明确要求。
- 完整的已完成/待完成清单已写入 [开发计划](docs/development-plan.md#当前暂停点与交付状态)。Windows 还可开展的异常并发、升级兼容、性能及隐私安全专项仅登记为后续待办，本轮未开展这些新增专项。
- 当前验证基线为 213 项 JS/React 测试及 8 组发布检查、类型检查、JS 打包通过；73 项原生测试仅有源码，Mac 编译、Release 构建和 iPhone 实测待完成。旧真机安装结果不能替代本轮验证。
- 下次优先确认本地提交与文档版本；有 Mac 后按验收入口运行原生检查并完整重建 App。Critical Messaging 尚未申请，真实短信继续关闭；适老化及需产品确认的功能继续暂缓。
- 本次整理前 HEAD 为 `ad1466f`。本次提交号请以 `git log -1 --oneline` 或本轮交付消息为准；提交保存在本机，不等于已经上传 GitHub。

## 2026-09-29 Bug 修复与未使用代码清理（最新）

- 完成审查发现的 7 类问题修复：暂停保存失败后重启误恢复、围栏 A→B→A 丢失最后配置、地点失败重试重复添加、后台刷新关闭仍显示正常、调时后位置/无活动状态卡住、短信结果保存失败误重发、并行风险绕过联系人冷却。原生部分为源码修复，仍待 Mac 编译验收。
- 暂停意图新增原生 `userPaused` 持久化字段；自动启动不能清除它，只有用户明确恢复才可清除。桥接 `getCurrentStatus` 必须返回 `isGuardianPaused`，`startGuardian(config, resumePaused)` 增加明确恢复参数。**JS 与原生必须一起重新构建，不能只更新 JS 或配旧原生包。** JS schema v4 / 原生 v6 保持不变，旧 v6 缺少新字段时默认未设置原生暂停，由原有 JS 暂停意图继续约束。
- 删除 4 个无应用引用的旧模块、2 个旧组件、旧诊断分组与风险摘要包装函数、未使用的 Swift 无参包装函数及 55 个样式；保留历史事件读取兼容性。没有删除用户数据或依赖，已跟踪的旧代码可从 Git 历史恢复，现有其他未提交修改保留。
- 最新 `npm run check:all`：**8 组发布检查、类型检查、213 项 Node/React 测试、iOS JavaScript 打包通过**；额外未使用局部变量/参数检查通过。原生测试源码增加 8 项，共 **73 项**，Windows 未编译执行。详细修复与 Mac 验收见 [Bug 修复与代码清理](docs/bugfix-and-dead-code-cleanup.md)。真实短信仍关闭，适老化仍暂缓。

## 2026-09-29 底层完整性与 Mac 验收入口（前轮基线）

- 已增加库调用前的 manifest/外置值检查、调用后的磁盘值核对及独立存在性标记，阻止已识别的损坏被当作空数据初始化。明确清除需要原生已持久化授权；无法识别的坏索引仍保留，不整目录删除。
- 增加 `npm run check:mac`：Windows 可 `--plan` 查看；Mac 先 `--list-simulators`，再 `--simulator <UUID>` 完整检查环境、跑 JS/原生测试、编译 Release 模拟器包并保存日志。不会改签名、自动安装工具、清空模拟器或安装到 iPhone。
- 当轮 `npm run check:all`：**8 组发布检查、类型检查、205 项 Node/React 测试、iOS JavaScript 打包通过**。原生测试源码当时为 **65 项**，未编译运行；Mac 验收脚本仅完成 Windows 流程测试。详见 [底层完整性与 Mac 验收](docs/storage-integrity-and-mac-acceptance.md)，最新 213/73 见最上方修复章节。
- 原生协议升级为 `checkLocalStorage` / `checked-v2`，**必须重新构建完整原生包**，旧 `protectLocalStorage` 接口不足以运行新 JS。存在性标记不是备份，不能恢复丢失内容；后置检查失败也不保证旧文件未改变。JS v4 / 原生 v6、真实短信关闭、适老化暂缓不变。

## 2026-09-29 本地存储保护进展（前轮基线）

- 核实 AsyncStorage 3.1.1 默认导出实际使用兼容文件后端，已有默认备份排除；不是命名存储的 SQLite 后端。已补读写前后文件保护/备份属性检查、旧文件原地升级、失败重试及依赖/工程防回退检查。
- 正常读取不搬迁或重写旧 JSON；用户明确清除时，额外清理三个旧 Documents 目录中的本应用数据项及外置值，保留其他数据；失败继续保留清除标记。
- 前轮 `npm run check:all`：**8 组发布检查、类型检查、181 项测试、iOS JavaScript 打包通过**。当时新增 12 项原生测试源码，总计 **49 项**，Windows 未编译运行。详见 [本地存储保护专项](docs/local-storage-protection.md)；最新结果见最上方修复章节。
- 必须在 Mac 重新编译完整 iOS 包后覆盖安装；新 JS 不能单独配旧原生包，缺少保护接口时会提示更新。实际文件属性、锁屏/重启、旧目录迁移、清除和系统备份仍待 iPhone 验收。JS v4 / 原生 v6 未变，适老化与真实短信开关未动。

## 2026-09-28 Windows 开发进展（历史基线）

- 当日最后一轮：完成发布防错检查、固定 App/测试包标识、六时区与时钟异常回归，并修正未来恢复提前解除告警和未来采样挤掉新记录的问题。当轮 `npm run check:all` 通过：7 组配置检查、类型检查、**162 项测试**及 iOS JavaScript 打包。原生测试源当时为 37 项。范围与限制见 [发布防错与时间异常](docs/release-preflight-and-time.md)。最新结果见上方 2026-09-29 专项。
- 上一轮：完成原生状态/权限校验与 8 秒只读超时、分享报告字段白名单、足迹每页最多 40 条，以及长期/突发/失败压力回归。当轮 Windows 基线为 **136 项测试**；详见 [Windows 可靠性加固](docs/windows-reliability-hardening.md)。
- 按用户要求跳过适老化，已继续实现数据保存与清除、地点状态展示和整页回归。入口为“我的 → 数据与隐私”；清除有双方持久化标记、失败重试及重启隔离，完成后保持暂停和测试模式。详细范围与 Mac 验收见 [数据生命周期与地点状态](docs/data-lifecycle-and-place-status.md)。
- 普通历史保留最近 30 天、最多 2,000 条，活动风险必要证据和未同步事件例外；时钟异常后的未来记录单独保留，可能暂时超过普通上限，详见最新时间专项说明。地点展示增加误差缓冲和双样本防抖，不改动原生围栏判定链路。
- 数据生命周期一轮的 Windows 验证：类型检查、**110 项 Node/React 测试**、iOS JavaScript 打包均通过。Swift 测试源当时共 **37 项**，未在 Windows 编译运行。下面 79/31 是当天更早一轮模式分离工作的记录，最新结果见上方 2026-09-29 专项。

- 已实现测试/正式模式分离，以及低电量和长时间无可信位置两个原生执行器。规则、迁移与 Mac 验收步骤见 [模式与风险执行器](docs/testing-mode-and-risk-executors.md)。
- 新安装及旧版本升级后默认测试模式；保留旧阈值、地点、联系人与历史记录。测试告警有显式标识，不能自动发送短信。进入正式模式前检查“家”、家人、定位/精确位置/后台刷新和围栏同步。
- JS schema 升为 v4，原生 schema 升为 v6。模式或规则改变会结束旧风险周期并取消未发送操作，避免把测试告警带入正式模式。
- Windows 已通过类型检查、79 项 Node/React 测试及 iOS JavaScript 打包。Swift 测试源现有 31 项，本轮新增/调整部分尚未在 Mac 编译运行，也未安装到 iPhone。
- 下述 2026-09-22 真机记录仅对应上一版；当前源码不能引用那次安装作为本轮原生验证。

## 最重要的三件事

1. **换机先核对最新本地 Git 提交。** 历史关键提交包括 `a98028c5`、`f4480eb1` 和 `ad1466f`；本轮 Windows 工作在它们之后另作本地提交，以 `git log` 为准。远端是 `https://github.com/oneothebrave/I-am-home.git`，本轮没有 fetch 或 push，不能把 2026-09-22 的远端检查当作当前同步状态。以后获得同步授权再核对远端与分支差异，不强制推送；换机时不要只复制源码而遗漏 `.git`。
2. **当前代码不会自动给家人发短信。** 家外无活动风险检测与 Apple Critical Messaging 发送状态机已实现，但 iOS target 尚无所需 entitlement，`ios/DaojiaShuoYisheng/Info.plist` 中 `GuardianCriticalMessagingEnabled` 仍是 `false`。快捷指令 V3 仅供用户主动点击“发送测试短信”，风险事件不再自动运行快捷指令。界面中的“已准备”“系统已接受”分别是不同状态，不能写成“已送达”。
3. **2026-09-22 状态机版本已覆盖安装到真机，但未完成实地回归。** 2026-09-22 用现有开发签名构建 Release 包，以 `com.llingrui.iamhome` 覆盖安装到 “Larry’s iPhone”（iPhone 16 Pro），安装后回读仍只有一个同 bundle ID 的 App，并成功启动。此前的真机实测证明过定位采点、原生围栏和家外无活动检测；这次新版本尚未做锁屏/实地/真实短信验证。

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
- 家外长时间无明显活动只在**单段每日守护时段**内判断；必须至少设置一个类型为“家”的地点。时段外不累计无活动时间，但围栏进出仍记录。1 分钟阈值仅允许在明确的测试模式；正式模式最短 15 分钟，默认 120 分钟，最终阈值仍需实地校准。
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

已新增低电量与长时间无可信位置执行器的源码，待 Mac 编译及真机验收。尚未完成：家中无活动规则、自动外发的生产验证、送达回执、完整的长期后台/耗电/异常权限实地验证。**不要向用户暗示家人已能收到自动通知。**

## 代码入口

- `App.tsx`：三 Tab、原生状态回读及页面协调。
- `src/screens/OverviewScreen.tsx`、`PlacesScreen.tsx`、`MyScreen.tsx`：主要用户界面。
- `src/screens/FamilyScreen.tsx`、`FootprintsScreen.tsx`、`DiagnosticsScreen.tsx`：家人、足迹、诊断。
- `src/storage/guardianSchema.ts`、`guardianRepository.ts`、`src/state/guardianStore.ts`：JS 本地数据 schema v4、迁移和持久化。
- `ios/GuardianCore/GuardianLocationService.swift`、`GuardianInactivityDetector.swift`：原生位置、活动与家外无活动规则。
- `ios/GuardianCore/GuardianEventStore.swift`：原生持久化 schema v6、风险事件和逐联系人短信操作；兼容旧版本。
- `ios/GuardianCore/GuardianStorageProtection.swift`、`src/native/storageProtection.ts`：存储保护检查、旧目录属性升级及明确清除时的历史副本处理。
- `ios/GuardianCore/GuardianStorageIntegrity.swift`：底层文件完整性、前后值核对与存在性标记；`scripts/check-mac.cjs`：Mac 本地验收与日志入口。
- `ios/GuardianCore/GuardianRiskDetector.swift`：模式/阈值校验、低电量与可信位置检查状态机；不依赖 JS 常驻。
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

- 既有真机 App 的 bundle ID 是 **`com.llingrui.iamhome`**。Xcode App 的 Debug/Release 已固定为此 ID，测试包为 `com.llingrui.iamhome.tests`，并加入防错检查。仍须在 Mac 选择自己的签名团队，核对最终构建参数和安装包标识；外部覆盖参数仍可能改变 ID，产生第二个 App 且不能自动迁移旧数据。
- 原电脑需要重新核对 Apple 登录、设备信任、开发签名、Always 定位、精确位置、运动与健身及后台 App 刷新。之前借用电脑上的证书/配置不会随 Git 迁移。
- 覆盖安装前保留同一 bundle ID；不要卸载真机旧 App。App 的本地地点、足迹、家人号码和系统授权不属于 Git 仓库。快捷指令模板安装状态属于 iPhone/快捷指令环境，不是仓库数据。
- 当准备启用 Critical Messaging 时，先取得并核对真实 entitlement、App ID 和 provisioning profile，再将 `GuardianCriticalMessagingEnabled` 打开。分别在前台准备、切后台、锁屏、授权拒绝/恢复、无网络、风险解除、进程终止等场景做真机测试；系统“接受发送”不等于短信送达。不要仅凭购买开发者会员或模拟器编译就宣布可用。

## 建议的下一步（按优先级）

1. **完成代码迁移**：在原电脑核对是否已取得 `a98028c5`、`f4480eb1` 和本交接文件的提交，保留原电脑上任何已有未提交修改。
2. 2026-09-22 版本已在真机覆盖安装；本轮新代码尚未安装，后续需验证地点、权限、守护时间、活动恢复、诊断状态和旧数据迁移。原电脑若再次安装，仍须保持同一个 bundle ID；**不要测试真实 Critical Messaging 发送，当前构建未启用。**
3. Mac 依赖就绪后运行 `npm run check:mac -- --simulator <UUID>`，完成当前 **65 项原生测试**和 Release 模拟器构建（含 `check:all`）；用法见 [Mac 验收入口](docs/storage-integrity-and-mac-acceptance.md)。随后按模式/风险、数据/地点、Windows 可靠性、发布/时间及 [本地存储保护专项](docs/local-storage-protection.md) 实测。必须重新构建原生包。Windows 检查不能替代签名包、文件保护/备份、原生调度和真机验证；不要用真实家人资料直接做清除测试。
4. 补完整真机矩阵：锁屏、系统挂起/回收、重启首次解锁、断网、低电量、权限变化、时区变化、围栏边界和耗电；记录异常出现时间、活动来源及诊断结果。
5. 取得 Critical Messaging 所需权限与签名后，再做逐联系人授权、后台真实提交、系统限频/失败、重复发送防护与 UI 文案验收。首次实测只发给明确同意接收的测试号码。

任何新修改都先检查 `git status` 和 `git diff`，不要覆盖或回退用户未提交的工作，也不要重构已通过真机验证的定位/围栏链路，除非有复现证据。
