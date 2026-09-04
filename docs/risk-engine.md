# 到家说一声 - 风险引擎说明

## 输入

风险引擎只接收事件流，不直接读取 iOS 系统能力。

事件来源可以是：

- 地理围栏：离家、回家、进入劳作地、离开劳作地。
- 位置：长时间停留、位置中断。
- 运动：检测到移动、长时间无运动。
- 电量：低电量。
- 用户：我没事、求助。
- 通知：已升级通知家人。

## 输出

`buildGuardianSnapshot` 会输出当前状态快照：

- `safe`：安全。
- `attention`：需要本人确认。
- `emergency`：需要家人尽快确认。

同时输出：

- 首页标题。
- 首页说明。
- 最后安全信号。
- 位置标签。
- 电量。
- 完整事件流。

## 当前规则

- 最新事件是 `SOS_SENT` 或 `RISK_ESCALATED`：进入异常。
- 最新事件是 `RETURN_HOME`、`MOTION_DETECTED`、`USER_CONFIRMED_SAFE`：进入安全。
- 最新事件是 `LONG_STAY`、`LOW_BATTERY`、`LOCATION_LOST`、`NO_MOTION_FOR_LONG_TIME`：进入关注。
- 其他情况默认安全。

## 通知文案

`composeNotificationPreview` 根据当前状态生成两类文案：

- 本人提醒：优先让本人点“我没事”。
- 家人提醒：说明异常原因、最后位置、电量和触发时间。

后续接入 APNs 或短信时，应复用这套文案规则，避免每个入口单独写通知内容。
