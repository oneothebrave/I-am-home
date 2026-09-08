# 到家说一声 - 下一阶段开发步骤

> 2026-09-08：下方为早期原型规划。已完成的重构、正式测试和当前接入限制以 [重构记录](refactoring.md) 为准。下一阶段重点是完整 iOS 工程、AppDelegate 原生恢复接入及真机验证。

## 当前阶段

当前版本是 React Native 可编辑原型：

- 概览页可查看安全、关注、异常状态。
- 地点页展示家、劳作地点、路口围栏，并支持模拟当前位置新增地点、调整围栏半径、删除地点。
- 规则页支持编辑守护时段、预计回家时间、停留阈值和升级策略。
- 家人页展示通知顺序，并支持新增和删除家人。
- 记录页展示当天事件流。
- 我没事和求助按钮会写入本地模拟事件，并改变当前状态。
- 记录页支持演练回家、失联、通知家人三种关键事件。
- 风险状态由 `src/domain/riskEngine.ts` 根据事件流自动计算。
- 概览页会生成本人提醒和家人提醒的通知文案预览。
- 记录页接入了 `src/domain/escalation.ts`，可以演练本人提醒和家人升级通知。
- 本地配置和事件通过 `src/storage` 抽象保存，优先使用 AsyncStorage，失败时退回内存存储。
- 页面已拆分到 `src/screens`，通用 UI 组件在 `src/components`，共享样式在 `src/styles`。

## 当前目录职责

- `App.tsx`：应用入口、顶部切换、全局配置状态、事件演练处理。
- `src/screens`：概览、地点、规则、家人、记录页面。
- `src/components`：Section、InfoLine、Metric、Stepper 等复用组件。
- `src/domain`：事件模型、风险引擎、通知文案、地理围栏辅助逻辑。
- `src/styles`：当前原型共享样式。
- `src/utils`：时间、数值等通用工具。
- `src/storage`：本地状态保存接口、AsyncStorage 适配器、仓库层。

## 下一步

1. 补齐完整 iOS Xcode 工程。
2. 把 `ios/GuardianCore` Swift 文件加入 iOS target。
3. 增加 iOS 权限说明：
   - `NSLocationWhenInUseUsageDescription`
   - `NSLocationAlwaysAndWhenInUseUsageDescription`
   - `NSMotionUsageDescription`
   - `UIBackgroundModes` 中的 `location`
4. 将地点设置页的模拟采点替换为真实采点：
   - 使用 iPhone 当前位置设为家。
   - 使用 iPhone 当前位置设为劳作地点。
   - 将界面上的围栏半径同步到 iOS geofence。
5. 接入 Swift 原生模块：
   - 请求 Always Location。
   - 注册地理围栏。
   - 监听进入/离开。
   - 上报 GuardianEvent。
6. 接入本地通知：
   - 关注提醒本人。
   - 求助时模拟通知家人。
   - 复用 `src/domain/notificationCopy.ts` 的通知文案规则。
7. 真机测试：
   - 离家。
   - 到达劳作地点。
   - 离开劳作地点。
   - 回家。
   - App 后台和被系统关闭后的事件表现。

## 重要决策

在 iOS 原生能力接通前，`mockData.ts` 只用于界面和流程演示。正式版本的经纬度应来自 App 内采点或地图选点，不应该写死在代码里。
