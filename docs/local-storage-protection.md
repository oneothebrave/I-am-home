# 本地存储保护专项

更新时间：2026-09-29。项目目录 `E:\I-am-home`。完成源码核查、保护补强和 Windows 回归；不代表已经在 iOS 编译、验证真实文件属性或完成备份验收。适老化未开发，真实短信开关仍为 `false`。

本页 181/49 为前轮验证记录。随后已加入底层完整性检查、存在性标记和 Mac 验收入口；最新 Windows 205 项、原生测试源码 65 项待运行，见 [最新专项](storage-integrity-and-mac-acceptance.md)。原生接口现为 `checkLocalStorage` / `checked-v2`。

## 核查结论

实际安装的 AsyncStorage 为 **3.1.1**。项目使用默认导出，它经 `getLegacyStorage()` 调用 `legacy_multiGet/Set/Remove`，并不使用 v3 命名存储的 SQLite/XCFramework 后端。关键证据来自本机安装包：

- `src/index.tsx`、`src/createAsyncStorage.native.ts`：默认导出及兼容接口路由。
- `apple/AsyncStorage.mm`：转发至 `RNCAsyncStorage` 的串行队列。
- `apple/legacy_storage/RNCAsyncStorage.mm`：目录、manifest、外置值文件、迁移、备份设置与写入实现。

默认后端已有备份排除；不是“此前完全没有保护”。但 `_ensureSetup` 忽略设置备份排除的返回值，写入未显式传入文件保护级别；Documents 迁移至 Application Support 时保留源目录。原生 GuardianCore 原本在写入时排除目录备份并指定首次解锁保护，但已存在且无需业务迁移的文件不会重新核查属性。

| 数据 | 位置（均相对 App 沙盒） | 本轮处理 |
| --- | --- | --- |
| 配置、家人、JS 历史 | `Library/Application Support/<bundleID>/RCTAsyncLocalStorage_V1/` 中的 `manifest.json` 及外置值文件 | 读写前后检查目录和文件的保护、备份排除 |
| 兼容迁移源 | `Documents/RCTAsyncLocalStorage_V1/`、`RNCAsyncLocalStorage_V1/`、`RCTAsyncLocalStorage/` | 原地补属性；只在明确清除时移除本应用数据项 |
| 原生配置、事件、通知操作 | `Library/Application Support/GuardianCore/state-v1.json` | 旧文件读取前补属性；每次原子写入后重新核查 |

## 实施范围

- `GuardianStorageProtection.swift` 只接受原生固定路径，拒绝沙盒外路径、应用自建符号链接和不符合预期的文件类型；不向 JS 返回目录、文件内容或身份信息。
- 普通读写仅升级元数据，不搬迁或重写已有 JSON。JS schema 仍为 v4，原生仍为 v6；联系人、地点、阈值、暂停状态和清除标记继续按原有解析规则处理。
- 显式设置并回读 `completeUntilFirstUserAuthentication` 和 `isExcludedFromBackup`。该保护级别允许首次解锁后继续锁屏访问，供后台守护使用；不选择锁屏即禁止访问的 `complete`。[Apple 文件保护说明](https://developer.apple.com/documentation/foundation/fileprotectiontype/completeuntilfirstuserauthentication)
- 准备受保护的 bundle ID 父目录，但**不提前创建兼容存储的最终目录**，否则会使库跳过 Documents 数据复制。已有三个历史目录也补属性；库操作失败后仍做一次保护检查，覆盖可能已产生的文件。
- JS 适配器跨实例串行执行“前置检查 → 库读写 → 后置检查”。不对修改属性的接口使用只读超时，也不与另一笔数据操作交叉。
- 冷启动保护失败时显示重试，不初始化默认数据覆盖旧文件。写入后检查失败时，数据可能已经写入，但不确认可靠保存；保留最新内存状态供重试。空字符串现在作为损坏 JSON 报错，只有真正缺失的 `null` 才算无存储数据。
- 原生数据原子替换完成后先更新内存，再做属性回读；后置检查失败也不能让旧内存覆盖已经提交的新数据。
- Info.plist 显式设置 `RCTAsyncStorageExcludeFromBackup=true`。依赖由 `^3.1.1` 固定为 `3.1.1`，未升级库；新增发布检查核对 package/lock/已安装包/Podfile.lock、默认后端与路径标记、备份开关和 Xcode 接线。未来升级必须重新核查，不能套用这些路径。

备份标记可能随文件操作变化，因此不仅在首次安装时设置；同时保护父目录与最终文件。[Apple 备份排除说明](https://developer.apple.com/documentation/foundation/urlresourcekey/isexcludedfrombackupkey)

## 历史副本与明确清除

正常启动不会删除历史副本。用户确认“清除所有本机数据”后，仍先写入原生清除意图和空的 JS 清除日志，再执行旧目录清理，最后结束原生与 JS 清除状态。

历史清理仅从上述三个固定 Documents 目录移除 `@daojia_shuo_yisheng/guardian_state_v1` 项和该键对应的外置值文件；保留其他键、文件和整个目录。文件名按库的 MD5 索引规则计算，**这不是加密**。先原子更新 manifest，再移除外置文件；重启后可继续移除中断留下的孤立文件。

无清除意图时原生拒绝执行；旧 manifest 损坏、文件类型异常、权限/保护失败时不猜测或整目录删除，清除保持未完成。部分目录可能已清除，不能承诺回滚。持续损坏需在 Mac 使用合成数据排查，不能绕过保护去覆盖真实家人数据。

## 验证结果

- `npm run check:all`：**8 组防错检查、类型检查、181 项 Node/React 测试、iOS JavaScript 打包通过**。相较上一轮 162 项新增 19 项：存储保护 16（其中 1 项只查原生清除接线）、整页恢复 2、发布防错 1。
- 覆盖 v1/v2/v3 数据迁移、v4 清除标记保留、旧原生包缺少接口、错误确认值、前/后检查失败、写入已完成但保护未确认、库调用失败后的检查、并发序列、旧对象变更隔离、空/损坏 JSON、失败重试和重启恢复。
- 新增 **12 项 Swift XCTest 源码**，当前原生测试总数 **49 项**，均待本轮 Mac 编译运行。覆盖属性读回、历史目录复制前后、字节不变、原子替换、目录/链接边界、原生旧文件升级、历史项精确清除、中断孤立文件、损坏旧清单及重复清除。测试只创建合成临时数据。
- Windows 的模拟桥接成功不等于真实 iOS 属性成功。Swift 迁移测试模拟库的目录复制，不执行完整 AsyncStorage 迁移；必须另做实际覆盖升级。
- 未访问、清除或迁移任何真机个人数据；未发送短信、未提交或推送 Git。

## Mac / iPhone 必做验收

1. 使用同一 `com.llingrui.iamhome` 重新编译完整 iOS 包，运行当前全部 65 项原生测试，可使用 `npm run check:mac -- --simulator <UUID>`。**不能只将新 JS 放进旧安装包**：没有 `checkLocalStorage` / `checked-v2` 的旧原生包会提示更新，不会降级绕过检查。
2. 在隔离测试容器中分别准备当前目录、仅 Documents 旧目录、两者共存、内联/外置值、清除中标记和旧 schema。覆盖安装后比对联系人、地点、事件、模式和暂停状态；无需业务迁移的读取应保持文件字节不变。
3. 实际运行 AsyncStorage 后核对父目录、当前/旧目录、manifest、外置文件和 GuardianCore 的保护及备份属性；反复读写、切换内联/外置值、重启/中断后重复检查。检查实际备份产物，不能仅凭属性值认定系统备份已验收。
4. 测试重启首次解锁前、首次解锁后再次锁屏、后台定位唤醒和前台恢复；不可读时不能覆盖旧数据或宣称同步成功。iOS 是否唤醒/执行 App 仍受系统控制。
5. 注入只读/空间不足/属性设置失败；验证不确认可靠保存、不提前确认原生事件、恢复后重试最新数据。后续完整性门禁会在库调用前检查 manifest/外置值，但未替换库本身；真实文件损坏、库缓存与磁盘差异、存在性标记损坏仍需单独验收，JS 模拟不能证明底层文件行为。
6. 用合成资料执行确认清除：三种历史目录、本应用内联值/外置值/孤立文件应消失，其他键与文件保留；中断、损坏 manifest、链接异常时不显示成功，重启仍隔离未完成清除。
7. 测量大量旧文件时属性检查耗时及锁屏耗电。当前每次读写检查相关目录树；Windows 压力测试不代表真机文件系统性能。

这不是额外的应用级加密或端到端加密，不使用 Keychain 保存整份历史；不能抵御已解锁设备中的合法应用读取、越狱或取证攻击，不承诺安全擦除。已有系统备份、短信/收件人副本和已分享报告不能由本次代码撤回。

依赖版本背景可参考 [AsyncStorage 官方变更记录](https://github.com/react-native-async-storage/async-storage/blob/main/packages/async-storage/CHANGELOG.md)；本次路径判断以本机锁定的 3.1.1 源码为准，不以会更新的主分支或不同后端说明替代。
