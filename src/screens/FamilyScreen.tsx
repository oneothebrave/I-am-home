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
  onRemoveContact,
  showNotificationPolicy = true,
}: {
  contacts: GuardianContact[];
  onAddContact: (contact: GuardianContact) => void;
  onRemoveContact: (id: string) => void;
  showNotificationPolicy?: boolean;
}) {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const canAddMore = contacts.length < 3;
  const [error, setError] = useState('');

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

      {showNotificationPolicy && (
        <Section title="通知策略">
          <InfoLine label="先提醒本人" value="异常出现后，先让本人确认我没事。" />
          <InfoLine label="再通知家人" value="未确认时按家人优先级逐个升级。" />
          <InfoLine label="通知内容" value="包含最后位置、最后信号、电量和异常原因。" />
        </Section>
      )}
    </>
  );
}
