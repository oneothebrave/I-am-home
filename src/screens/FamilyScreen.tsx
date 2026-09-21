import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { InfoLine, Section } from '../components/Primitives';
import type { GuardianContact } from '../domain/types';
import { styles } from '../styles/appStyles';
import { isPhone, normalizePhone } from '../domain/validation';
import { createId } from '../utils/id';

export function FamilyScreen({
  contacts,
  onAddContact,
  onInstallShortcut,
  onRemoveContact,
  onSendTestNotification,
  testNotificationPending = false,
  showNotificationPolicy = true,
}: {
  contacts: GuardianContact[];
  onAddContact: (contact: GuardianContact) => void;
  onInstallShortcut: () => void;
  onRemoveContact: (id: string) => void;
  onSendTestNotification: () => void;
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

      <Section title="短信快捷指令">
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
          新版名称为“到家了么短信通知 V3”，旧快捷指令可以保留，App 不会再调用它。前台可以主动测试；检测到家外长时间无活动时，App 也会尝试运行新版。锁屏或后台时 iOS 仍可能拒绝打开。首次无交互发送时，如果 iOS 显示“始终允许”，请选择它。可能产生短信费用。
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
