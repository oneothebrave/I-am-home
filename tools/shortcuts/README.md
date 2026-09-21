# 到家了么短信通知 V3 快捷指令

`DaojiaNotification.plist` 是可复现的快捷指令源文件。模板只包含：

- 将 App 传入的 JSON 文本转换为字典；
- 读取 `phone` 作为系统“发送信息”动作的收件人；
- 读取 `message` 作为短信正文；
- 关闭“运行时显示”。

模板中没有真实联系人或手机号。正式公开模板为：

`https://www.icloud.com/shortcuts/f8e16cab9ea34fffb16cb514108ada44`

安装时不包含联系人选择问题，也不包含真实联系人或手机号。收件人始终来自 App
本机保存的第 1 位家人。系统首次运行时仍会要求发送信息权限；这是 iOS 的隐私
保护，模板不能预先授予。用户选择“始终允许”后，后续运行不再重复询问。

`signed/到家了么短信通知 V3.shortcut` 是模板的 Apple 签名产物；V3 第一项操作
显式引用 `ExtensionInput`，并将 `WFWorkflowHasShortcutInputVariables` 设为 `true`，
确保 URL 方案传入的手机号和正文不会丢失。唯一名称还能避免 `run-shortcut` 命中旧副本。
重新共享会生成新的 iCloud 标识；更新模板后，必须同时更新 JavaScript、
Swift 原生名称和对应测试，且应先在真机完成安装与发送测试。
