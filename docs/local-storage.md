# 到家说一声 - 本地存储抽象

## 当前实现

应用现在通过 `src/storage` 读写本机状态：

- `guardianStorage.ts`：定义 `GuardianStorage` 接口、内存实现、fallback 实现。
- `asyncStorageGuardianStorage.ts`：使用 AsyncStorage 保存到手机本机。
- `guardianRepository.ts`：提供给 App 使用的仓库层。

默认策略：

1. 优先使用 AsyncStorage。
2. 如果当前环境没有 native 存储能力，退回内存存储。

## 保存内容

`GuardianStoredState` 当前包含：

- `config`：地点、家人名单、守护规则。
- `localEvents`：本机演练和手动产生的事件。
- `updatedAt`：最后保存时间。

## App 中的行为

- 启动时从仓库载入配置和事件。
- 新增地点、删除地点、调整半径后保存。
- 修改守护规则后保存。
- 新增或删除家人后保存。
- “我没事”、求助、事件演练后保存事件流。
- 概览页显示本机保存状态，并提供恢复默认演示数据。

## 后续替换方向

如果需要更强的本地能力，可以新增存储适配器，而不改页面：

- SQLite：适合大量事件记录和离线队列。
- Keychain：适合保存敏感 token。
- 后端同步：适合家人端查看状态和通知记录。

建议保持页面只调用 `guardianRepository`，不要直接调用具体存储库。
