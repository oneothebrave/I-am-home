import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { InfoLine, Section } from '../components/Primitives';
import type { GuardianContact } from '../domain/types';
import type { CriticalMessagingPreparation } from '../native/criticalMessaging';
import { styles } from '../styles/appStyles';
import { isPhone, normalizePhone } from '../domain/validation';
import { createId } from '../utils/id';

function latestOperationLabel(
  operation: CriticalMessagingPreparation['operations'][number] | undefined,
) {
  if (!operation) return '暂无告警';
  switch (operation.status) {
    case 'prepared':
      return '最近：等待后台发送';
    case 'sending':
      return `最近：正在提交（第 ${operation.attemptCount} 次）`;
    case 'retryScheduled':
      return `最近：等待重试（已尝试 ${operation.attemptCount} 次）`;
    case 'accepted':
      return '最近：系统已接受';
    case 'failed':
      return '最近：发送失败';
    case 'restricted':
      return '最近：发送受限';
    case 'expired':
      return '最近：已过有效期';
    case 'cancelled':
      return '最近：风险已解除';
  }
}

export function FamilyScreen({
  contacts,
  criticalMessaging,
  onAddContact,
  onInstallShortcut,
  onRemoveContact,
  onRequestCriticalMessagingAuthorization,
  onRefreshCriticalMessagingAuthorization,
  onSendTestNotification,
  criticalMessagingAuthorizationPending = false,
  testNotificationPending = false,
  showNotificationPolicy = true,
}: {
  contacts: GuardianContact[];
  criticalMessaging?: CriticalMessagingPreparation;
  onAddContact: (contact: GuardianContact) => void;
  onInstallShortcut: () => void;
  onRemoveContact: (id: string) => void;
  onRequestCriticalMessagingAuthorization: () => void;
  onRefreshCriticalMessagingAuthorization: () => void;
  onSendTestNotification: () => void;
  criticalMessagingAuthorizationPending?: boolean;
  testNotificationPending?: boolean;
  showNotificationPolicy?: boolean;
}) {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const canAddMore = contacts.length < 3;
  const [error, setError] = useState('');
  const firstContact = [...contacts].sort((a, b) => a.priority - b.priority)[0];
  const authorizationByContact = new Map(
    criticalMessaging?.authorizations.map((authorization) => [
      authorization.contactId,
      authorization.status,
    ]) ?? [],
  );
  const authorizationLabel = {
    unknown: '尚未授权',
    approved: '已允许',
    denied: '未允许',
    unavailable: '暂时无法读取',
  } as const;
  const latestOperationByContact = new Map<
    string,
    CriticalMessagingPreparation['operations'][number]
  >();
  for (const operation of criticalMessaging?.operations ?? []) {
    const current = latestOperationByContact.get(operation.contactId);
    if (!current || Date.parse(operation.statusUpdatedAt) > Date.parse(current.statusUpdatedAt))
      latestOperationByContact.set(operation.contactId, operation);
  }

  const handleAddContact = () => {
    if (!canAddMore || !name.trim() || !phone.trim()) {
      setError('请输入姓名和联系电话，最多添加 3 位家人。');
      return;
    }
    if (
      !isPhone(phone) ||
      contacts.some((contact) => normalizePhone(contact.phone) === normalizePhone(phone))
    ) {
      setError('联系电话无效或已在名单中。');
      return;
    }
    setError('');

    onAddContact({
      id: createId('contact'),
      name: name.trim(),
      relation: relation.trim() || '家人',
      phone: normalizePhone(phone),
      priority: contacts.length + 1,
    });
    setName('');
    setRelation('');
    setPhone('');
    setIsAddingContact(false);
  };

  const cancelAddingContact = () => {
    setName('');
    setRelation('');
    setPhone('');
    setError('');
    setIsAddingContact(false);
  };

  return (
    <>
      <Section title="家人名单">
        {contacts.length === 0 && (
          <Text style={styles.emptyListText}>还没有家人信息。</Text>
        )}
        {contacts.map((contact) => (
          <View style={styles.contactRow} key={contact.id}>
            <View style={styles.flexItem}>
              <Text style={styles.rowTitle}>{contact.name}</Text>
              <Text style={styles.rowMeta}>
                {contact.relation} · {contact.phone}
              </Text>
            </View>
            <Text style={styles.priority}>第 {contact.priority} 位</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => onRemoveContact(contact.id)}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>删</Text>
            </TouchableOpacity>
          </View>
        ))}
        {canAddMore && !isAddingContact && (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.8}
            onPress={() => {
              setError('');
              setIsAddingContact(true);
            }}
            style={styles.secondaryOutlineButton}
          >
            <Text style={styles.secondaryOutlineButtonText}>增加家人信息</Text>
          </TouchableOpacity>
        )}
      </Section>

      {isAddingContact && (
        <Section title="增加家人信息">
          {!!error && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
          )}
          <TextInput
            autoFocus
            onChangeText={setName}
            placeholder="姓名"
            placeholderTextColor="#9A9387"
            style={styles.input}
            value={name}
          />
          <TextInput
            onChangeText={setRelation}
            placeholder="关系"
            placeholderTextColor="#9A9387"
            style={styles.input}
            value={relation}
          />
          <TextInput
            keyboardType="phone-pad"
            onChangeText={setPhone}
            placeholder="手机号"
            placeholderTextColor="#9A9387"
            style={styles.input}
            value={phone}
          />
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleAddContact}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>保存家人信息</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.8}
            onPress={cancelAddingContact}
            style={styles.formCancelLink}
          >
            <Text style={styles.formCancelLinkText}>取消</Text>
          </TouchableOpacity>
        </Section>
      )}

      <Section title="Apple 关键短信">
        <Text style={styles.settingHelpText}>
          {criticalMessaging?.buildConfigured
            ? '授权后，系统检测到有效风险时可在后台直接向家人发送短信。系统接受发送不代表家人已经阅读。'
            : '当前安装包尚未启用 Apple 关键短信。发送状态机已经就绪，但现在只会在本机准备并记录告警。'}
        </Text>
        {contacts.map((contact) => {
          const status = authorizationByContact.get(contact.id) ?? 'unknown';
          const operation = latestOperationByContact.get(contact.id);
          const authorization = criticalMessaging?.buildConfigured
            ? authorizationLabel[status]
            : '等待工程启用';
          return (
            <InfoLine
              key={`critical-${contact.id}`}
              label={contact.name}
              value={`${authorization} · ${latestOperationLabel(operation)}`}
            />
          );
        })}
        {criticalMessaging?.buildConfigured && contacts.length > 0 && (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              disabled={criticalMessagingAuthorizationPending}
              onPress={onRequestCriticalMessagingAuthorization}
              style={[
                styles.primaryButton,
                criticalMessagingAuthorizationPending && styles.secondaryButtonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {criticalMessagingAuthorizationPending ? '正在处理…' : '允许关键短信通知家人'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.8}
              disabled={criticalMessagingAuthorizationPending}
              onPress={onRefreshCriticalMessagingAuthorization}
              style={[
                styles.secondaryOutlineButton,
                criticalMessagingAuthorizationPending && styles.secondaryButtonDisabled,
              ]}
            >
              <Text style={styles.secondaryOutlineButtonText}>刷新关键短信授权</Text>
            </TouchableOpacity>
          </>
        )}
        <Text style={styles.shortcutFootnote}>
          有效期 {criticalMessaging?.policy.validityMinutes ?? 30} 分钟，最多尝试 {criticalMessaging?.policy.maximumAttempts ?? 3} 次；风险解除或过期后不会补发。
        </Text>
      </Section>

      <Section title="备用短信测试">
        <Text style={styles.settingHelpText}>
          测试短信由 iPhone 自带的“快捷指令”发出，不经过第三方通知平台，只需安装一次。
        </Text>

        <Text style={styles.shortcutInstallText}>
          直发版使用唯一名称，并明确接收 App 传入的快捷指令输入。它已关闭“显示编写表单”，会自动使用 App 中保存的第 1 位家人手机号和通知内容。
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          onPress={onInstallShortcut}
          style={styles.secondaryOutlineButton}
        >
          <Text style={styles.secondaryOutlineButtonText}>安装短信快捷指令直发版</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          disabled={!firstContact || testNotificationPending}
          onPress={onSendTestNotification}
          style={[
            styles.primaryButton,
            (!firstContact || testNotificationPending) && styles.secondaryButtonDisabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {testNotificationPending ? '正在打开…' : firstContact ? '发送测试短信' : '请先添加家人'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.shortcutFootnote}>
          快捷指令只在用户点击“发送测试短信”时运行，不参与风险自动通知。首次无交互发送时，如果 iOS 显示“始终允许”，请选择它。可能产生短信费用。
        </Text>
      </Section>

      {showNotificationPolicy && (
        <Section title="通知策略">
          <InfoLine label="直接通知家人" value="检测到异常后，不打扰本人，直接进入家人通知队列。" />
          <InfoLine label="通知顺序" value="按家人优先级逐个发送。" />
          <InfoLine label="通知内容" value="包含最后位置、最后信号、电量和异常原因。" />
        </Section>
      )}
    </>
  );
}
