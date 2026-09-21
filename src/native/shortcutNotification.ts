import { Linking } from 'react-native';

export const SHORTCUT_NOTIFICATION_NAME = '到家了么通知';
export const SHORTCUT_NOTIFICATION_INSTALL_URL =
  'https://www.icloud.com/shortcuts/83ac6708621a475589c98e59c27b6949';

export interface ShortcutNotificationInput {
  phone: string;
  message: string;
}

export function buildShortcutNotificationUrl({
  phone,
  message,
}: ShortcutNotificationInput): string {
  const recipient = phone.trim();
  const text = message.trim();
  if (!recipient) throw new Error('收件人手机号不能为空。');
  if (!text) throw new Error('通知内容不能为空。');
  const payload = JSON.stringify({ phone: recipient, message: text });

  return `shortcuts://run-shortcut?name=${encodeURIComponent(
    SHORTCUT_NOTIFICATION_NAME,
  )}&input=text&text=${encodeURIComponent(payload)}`;
}

export function composeShortcutTestMessage(contactName: string): string {
  const greeting = contactName.trim() ? `${contactName.trim()}，` : '';
  return `【到家了么】测试通知\n${greeting}这是一条自动通知功能测试。被守护人目前没有异常，请不用担心。`;
}

export async function openShortcutInstaller(): Promise<void> {
  await Linking.openURL(SHORTCUT_NOTIFICATION_INSTALL_URL);
}

export async function sendShortcutNotification(input: ShortcutNotificationInput): Promise<void> {
  await Linking.openURL(buildShortcutNotificationUrl(input));
}
