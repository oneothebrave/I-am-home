# 家人通知队列

升级器读取快照中的当前告警，不另行推算“最新事件代表什么”。告警包含稳定的 `incidentId`，通知进度按 `contactId` 记录，重复回执不重复计数，已删除的联系人也不会挤掉下一位接收人。

## 阶段

| 阶段 | 含义 |
| --- | --- |
| idle | 无未解除告警 |
| family_queue | 下一位家人待通知 |
| blocked | 没有可通知的家人 |
| completed | 当前名单已发送完毕，不等于确认平安 |
| acknowledged | 家人已接手，异常记录继续保留 |

被动风险与主动求助均直接进入家人队列，不经过本人确认或等待阶段。失败回执不会把接收人标为成功。Critical Messaging 准备层会在家外无活动异常发生时，同时为所有已设置家人创建待发送操作。

真实模式下，函数只计算队列，不会生成“已发送”事件。发送执行器必须在收到真实 API 结果后记录 `FAMILY_NOTIFIED` 或 `FAMILY_NOTIFICATION_FAILED`；只有曾收到通知的联系人才能记录 `FAMILY_ACKNOWLEDGED`。

原型通过显式 `simulate: true` 演练，生成的事件带 `simulated: true`。页面说明不发送真实通知。终态不会反复生成 `ESCALATION_FINISHED`。

Critical Messaging 待发送操作和 API 适配器已接入；entitlement、后台自动发送协调器、送达确认与重试调度尚未启用。
