# 通知升级流程

升级器读取快照中的当前告警，不另行推算“最新事件代表什么”。告警包含稳定的 `incidentId`，通知进度按 `contactId` 记录，重复回执不重复计数，已删除的联系人也不会挤掉下一位接收人。

## 阶段

| 阶段 | 含义 |
| --- | --- |
| idle | 无未解除告警 |
| self_prompt | 被动风险需要提醒本人 |
| waiting | 本人或上一位家人的等待期限未到 |
| family_queue | 下一位家人待通知 |
| blocked | 没有可通知的家人 |
| completed | 当前名单已发送完毕，不等于确认平安 |
| acknowledged | 家人已接手，等待本人明确报平安 |

主动 SOS 跳过本人提醒，直接进入家人队列。失败回执不会把接收人标为成功，下一次仍尝试同一位。通知完成后新增家人，会继续处理新接收人。

真实模式下，函数只计算阶段和 `dueAt`，不会生成“已发送”事件。发送执行器需要在收到真实发送结果后记录 `FAMILY_NOTIFIED` 或 `FAMILY_NOTIFICATION_FAILED`；只有曾收到通知的联系人才能记录 `FAMILY_ACKNOWLEDGED`。

原型通过显式 `simulate: true` 演练，允许跳过等待时间，生成的事件带 `simulated: true`。页面说明不发送真实通知。终态不会反复生成 `ESCALATION_FINISHED`。

通知执行器、APNs/短信、送达确认与重试调度尚未接入。
