# 底层存储完整性与 Mac 验收入口

更新时间：2026-09-29。Windows 项目目录 `E:\I-am-home`。本轮完成源码和 Windows 验证；**没有运行 Xcode、Swift XCTest 或真机测试**。适老化未开发，真实短信开关仍为 `false`，JS v4 / 原生 v6 不变。

## 已解决的缺口

锁定的 AsyncStorage 3.1.1 默认兼容后端有两处可能把损坏当作空数据：`_ensureSetup` 遇到不可解析的 manifest 会创建空内存字典；`_getValueForKey` 遇到外置值文件缺失会移除内存索引并返回空值。仅校验 JS JSON 和文件保护属性无法拦截这些情况。

新 `GuardianStorageIntegrity.swift` 在调用库之前检查固定目录、manifest 类型及本应用数据项，在成功返回后核对实际落盘值。库失败也检查可能已产生的文件，但不记录为操作成功。不修改依赖源码，不自动把损坏数据恢复为默认配置。

| 情况 | 当前行为 |
| --- | --- |
| 全新安装、无数据痕迹 | 允许库正常初始化；不预建最终存储目录，保留旧目录迁移机会 |
| manifest 无效、缺失却留有文件，或值文件缺失/非 UTF-8/非 JSON 对象 | 库调用前失败，保留现有内容，显示重试/明确清除入口 |
| 当前目录为空但存在旧数据；当前目录缺失且多个旧副本不一致 | 不按修改日期猜测，要求排查，阻止库隐式选择造成数据丢失 |
| 库返回空值但磁盘有数据，或写入返回成功但磁盘内容不同 | 后置校验失败，不初始化默认状态、不声称可靠保存 |
| 曾观察到有数据，此后数据消失 | 独立存在性标记可以发现；不会当作新安装 |
| 用户确认清除且原生清除意图已落盘 | 允许用空清除日志替换可确定属于本应用的坏值；确认新日志后才清理旧副本 |
| 整个索引无法识别、链接/路径异常或不可访问 | 即使确认清除也不猜测、不整目录删除；保留未完成清除状态 |

正常检查不重写配置/联系人/历史的 JSON。会升级文件保护、备份属性，并维护 `Library/Application Support/GuardianStorageIntegrity/receipt-v1.json`：只有版本号与 `hasValue` 布尔值，不含姓名、号码、位置、事件或内容摘要；同样受首次解锁保护并排除备份。

JS 适配器跨实例串行执行前置检查、库操作、后置检查。原生接口为：

```ts
checkLocalStorage({
  operation: 'read' | 'write' | 'remove' | 'deletion',
  phase: 'before' | 'after' | 'failed',
  value: string | null
}): Promise<'checked-v2'>
```

只在成功的后置检查传递读取/写入值；其他阶段为 null。清除修复不仅检查 JS 日志标记，还在原生独立核对持久化清除意图。原生错误返回固定错误码和通用说明，不带目录或个人内容。该接口有副作用，不套用只读超时。**必须重新编译完整原生包**：旧 `protectLocalStorage` / `protected-v1` 不能满足新版协议，新 JS 会要求更新，不静默绕过。

### 边界

- 存在性标记不是备份、事务日志、加密或防篡改校验，不能恢复已丢失的字节；数据和标记同时消失、引入本功能前就已全部丢失、内容仍为有效 JSON 的篡改，都不能仅凭它检测出来。
- 后置失败时写入可能已经发生，不承诺回滚或“旧数据一定未改变”；页面不确认保存成功，内存继续保留待重试状态。检查不能防止外部在两次检查之间改动文件。
- 保守检查包括所有现存旧目录；旧目录损坏也可能阻止当前可读数据的普通访问。不要通过卸载 App、手动删整个目录来绕过；先用合成容器复现并制定保留数据的恢复方案。
- 历史副本清理器只删本应用键和外置文件。库本身的初始化仍有旧目录选择/迁移逻辑；Swift 测试只模拟目录复制，**不证明完整 AsyncStorage 升级迁移已验收**。库升级必须重新审查。
- 本轮不改变原生风险规则，也不证明后台唤醒、文件保护、备份或真实短信可用。

## Mac 一次执行完整验收

先按 [HANDOFF 环境准备](../HANDOFF.md#验证基线与迁移环境) 安装项目依赖。脚本不下载工具、SDK 或依赖，不执行 pod install，不切换 Xcode，不修改签名，也不删除缓存。环境要求沿用项目基线：完整 Xcode 27+、符合 engines 的 Node、mise Ruby 3.3.12、Bundler 依赖及与 Podfile.lock 一致的 Pods。

脚本对子进程显式关闭 mise 的 `auto_install` / `exec_auto_install`，并使用 Bundler frozen 模式，避免环境检查隐式安装工具或改写锁文件；不会改动用户的全局设置。[mise 官方设置说明](https://mise.jdx.dev/configuration/settings.html#auto-install)

Windows 可先查看流程（不运行工具、不写文件）：

```powershell
Set-Location E:\I-am-home
npm run check:mac -- --plan
```

在 Mac 项目根目录先列出可用 iOS 模拟器，选择专用于验收的模拟器 UUID：

```bash
npm run check:mac -- --list-simulators
npm run check:mac -- --simulator <从上一步复制的UUID>
```

第二条是完整验收命令；将占位符替换成真实 UUID 后执行。只接受当前可用的 iOS 模拟器，不会自动改用 iPhone、创建/清空模拟器或申请签名权限。Xcode 测试会使用指定模拟器的测试容器，不要把个人资料放入该测试环境。

执行顺序：环境与测试工程接线 → `npm run check:all` → Debug XCTest → 读取 `.xcresult` 摘要 → Release 模拟器编译。原生通过数量必须与当前测试源声明完全一致（目前 65），失败/跳过必须为零；零测试、少测、结果格式未知、工具错误均失败，不继续宣称验收成功。

输出在 `.build/mac-acceptance/<时间与随机后缀>/`，每次独立目录、不覆盖旧结果：

- 每步日志、`NativeTests.xcresult`、`DerivedData/`。
- `report.json` 记录步骤、测试数量、通过/失败及验证边界；进程强制终止可能保留 `running`，同样不能当作通过。
- `.build/` 已由 Git 忽略。日志可能带有本机路径、设备名称、编译器输出，只保存在本机，不自动上传。分享前需人工检查。脚本不自动清理这些文件，长期运行需自行管理磁盘空间。

采用 Apple 提供的 [Xcode 命令行工具](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference) 与 [xcresulttool 测试摘要入口](https://developer.apple.com/documentation/xcode-release-notes/xcode-16_3-release-notes)。摘要校验遇到新版格式变化时明确失败，需在 Mac 核对实际输出后更新，不能跳过验证。

## 本轮验证与 Mac 剩余验收

- `npm run check:all`：8 组发布防错检查、TypeScript 检查、**205 项 Node/React 测试**与 iOS JavaScript 打包通过。较前轮 181 项增加 24 项：存储接口/失败隔离 6、整页恢复 2、Mac 验收脚本 16。
- 新增 16 项 Swift XCTest 源码，总计 **65 项**；检查了工程接线，未编译运行。测试只使用合成数据和独立临时目录。
- Windows 已验证脚本的计划展示、非 Mac 拦截、流程顺序、失败日志、禁止零测试/跳过误报和安全参数；模拟的 Mac 输出不能算实际 Mac 通过。
- Mac 首次运行须核对脚本与当前 Xcode 的兼容性；然后按 [文件保护验收矩阵](local-storage-protection.md#mac--iphone-必做验收) 做真实 AsyncStorage 覆盖升级、内联/外置切换、旧目录迁移、损坏注入及清除中断。增加存在性标记损坏/丢失、旧副本冲突、库缓存与磁盘不一致的测试。
- 模拟器全部通过后，仍须同 bundle ID 的 iPhone 覆盖安装和锁屏/重启/后台/备份实测；脚本不会执行这些步骤，不等于可发布。未申请 Critical Messaging 时继续保持真实发送关闭。
