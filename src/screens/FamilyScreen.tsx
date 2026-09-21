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
  };

  return (
    <>
      <Section title="家人名单">
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
      </Section>

      <Section title="新增家人">
        {!!error && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
        )}
        <TextInput
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
          disabled={!canAddMore}
          onPress={handleAddContact}
          style={[styles.secondaryButton, !canAddMore && styles.secondaryButtonDisabled]}
        >
          <Text style={styles.secondaryButtonText}>
            {canAddMore ? '保存家人信息' : '最多保存 3 位家人'}
          </Text>
        </TouchableOpacity>
      </Section>

      <Section title="短信快捷指令">
        <Text style={styles.settingHelpText}>
          测试短信由 iPhone 自带的“快捷指令”发出，不经过第三方通知平台，只需安装一次。
        </Text>

        <Text style={styles.shortcutInstallText}>
          安装时无需再选择通讯录联系人。发送时会自动使用 App 中保存的第 1 位家人手机号。
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          activeOpacity={0.8}
          onPress={onInstallShortcut}
          style={styles.secondaryOutlineButton}
        >
          <Text style={styles.secondaryOutlineButtonText}>安装短信快捷指令</Text>
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
          当前只用于前台主动测试，后台检测不会自动打开快捷指令。首次测试时，iOS 会要求发送信息权限；如果出现“始终允许”，请选择它。发送使用第 1 位家人，可能产生短信费用。
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
