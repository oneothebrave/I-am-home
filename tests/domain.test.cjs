const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader();
const { buildGuardianSnapshot } = load('src/domain/riskEngine.ts');
const { getEscalationState } = load('src/domain/escalation.ts');
const { guardianConfig: config, createDemoEvents } = load('src/domain/mockData.ts');
const { summarizeRiskReason } = load('src/domain/guardianRules.ts');
const now = Date.parse('2026-09-08T08:30:00Z');
const event = (type, index, fields = {}) => ({
  id: `e${index}`,
  type,
  title: type,
  description: type,
  source: 'user',
  timestamp: new Date(now - 60_000 + index * 1000).toISOString(),
  ...fields,
});
const risk = event('LOCATION_LOST', 1);
const prompt = event('SAFETY_CHECK_REQUESTED', 2, { incidentId: risk.id });
const notified = event('FAMILY_NOTIFIED', 3, { incidentId: risk.id, contactId: 'contact-1' });
const snapshot = (events) => buildGuardianSnapshot(events, { now });
const escalation = (events, cfg = config, options = {}) =>
  getEscalationState(snapshot(events), cfg, { now, simulate: true, ...options });

test('demo starts with attention; empty and stale signals remain unknown', () => {
  assert.equal(snapshot(createDemoEvents(now)).status, 'attention');
  assert.equal(snapshot([]).status, 'unknown');
  assert.equal(
    snapshot([event('USER_CONFIRMED_SAFE', 1, { timestamp: '2026-09-07T08:00:00Z' })]).status,
    'unknown',
  );
});
test('R01: SOS persists through battery, movement, home and neutral updates', () => {
  for (const type of [
    'LOW_BATTERY',
    'MOTION_DETECTED',
    'RETURN_HOME',
    'ENTER_WORK_AREA',
    'LOCATION_UPDATED',
  ]) {
    assert.equal(snapshot([event('SOS_SENT', 1), event(type, 2)]).status, 'emergency');
  }
});
test('confirmation resolves SOS and passive risks', () => {
  for (const type of ['SOS_SENT', 'LOCATION_LOST']) {
    assert.equal(snapshot([event(type, 1), event('USER_CONFIRMED_SAFE', 2)]).status, 'safe');
  }
});
test('R02: SOS enters family queue both with and without an existing passive risk', () => {
  for (const events of [
    [event('USER_CONFIRMED_SAFE', 1), event('SOS_SENT', 2)],
    [risk, event('SOS_SENT', 2)],
  ]) {
    assert.equal(escalation(events).phase, 'family_queue');
  }
});
test('SOS after a previously notified passive alert starts a fresh notification queue', () => {
  const result = escalation([risk, prompt, notified, event('SOS_SENT', 4)]);
  assert.equal(result.phase, 'family_queue');
  assert.equal(result.nextContact.id, 'contact-1');
  assert.equal(result.notifiedCount, 0);
});
test('manual progression notifies family directly and reaches a terminal state', () => {
  let events = [risk];
  for (const type of ['FAMILY_NOTIFIED', 'FAMILY_NOTIFIED', 'ESCALATION_FINISHED']) {
    const next = escalation(events).nextEvent;
    assert.equal(next.type, type);
    events.push(event(type, events.length + 1, next));
  }
  assert.equal(escalation(events).phase, 'completed');
  assert.equal(escalation(events).nextEvent, undefined);
});
test('R03: removing a notified contact does not skip another recipient', () => {
  const result = escalation([risk, prompt, notified], {
    ...config,
    contacts: [config.contacts[1]],
  });
  assert.equal(result.nextContact.id, 'contact-2');
  assert.equal(result.notifiedCount, 1);
});
test('R03: repeated IDs and repeated delivery receipts do not consume recipients', () => {
  for (const repeat of [notified, { ...notified, id: 'another-receipt' }]) {
    assert.equal(escalation([risk, prompt, notified, repeat]).nextContact.id, 'contact-2');
  }
});
test('reordered contact array still respects priorities', () => {
  assert.equal(
    escalation([risk, prompt], { ...config, contacts: [...config.contacts].reverse() }).nextContact
      .id,
    'contact-1',
  );
});
test('R04: empty contacts block notification and never claim completion', () => {
  assert.equal(escalation([risk, prompt], { ...config, contacts: [] }).phase, 'blocked');
});
test('late receipts and unknown legacy recipients cannot advance a new incident', () => {
  const current = event('LOCATION_LOST', 5);
  assert.equal(
    escalation([
      risk,
      event('USER_CONFIRMED_SAFE', 4),
      current,
      { ...notified, timestamp: event('FAMILY_NOTIFIED', 6).timestamp },
    ]).notifiedCount,
    0,
  );
  assert.equal(escalation([risk, prompt, { ...notified, contactId: undefined }]).notifiedCount, 0);
});
test('failed delivery retries the same contact; acknowledgement preserves the alert', () => {
  assert.equal(
    escalation([risk, prompt, { ...notified, type: 'FAMILY_NOTIFICATION_FAILED' }]).nextContact.id,
    'contact-1',
  );
  const events = [
    risk,
    prompt,
    notified,
    event('FAMILY_ACKNOWLEDGED', 4, { incidentId: risk.id, contactId: 'contact-1' }),
  ];
  assert.equal(escalation(events).phase, 'acknowledged');
  assert.equal(snapshot(events).status, 'emergency');
});
test('live escalation respects deadlines and does not fabricate sent events', () => {
  assert.equal(escalation([risk], config, { simulate: false }).phase, 'family_queue');
  assert.equal(escalation([risk, notified], config, { simulate: false }).phase, 'waiting');
  const late = getEscalationState(snapshot([risk, notified]), config, { now: now + 600_000 });
  assert.equal(late.phase, 'family_queue');
  assert.equal(late.nextEvent, undefined);
});
test('no-motion risk goes directly to the family queue without a self prompt', () => {
  const noMotion = event('NO_MOTION_FOR_LONG_TIME', 1, { source: 'motion' });
  const result = escalation([noMotion]);
  assert.equal(result.phase, 'family_queue');
  assert.equal(result.nextEvent.type, 'FAMILY_NOTIFIED');
  assert.doesNotMatch(result.title, /本人/);
});
test('R08: location and battery are preserved across unrelated events', () => {
  const result = snapshot([
    event('RETURN_HOME', 1, { batteryLevel: 5 }),
    event('USER_CONFIRMED_SAFE', 2),
  ]);
  assert.equal(result.locationLabel, '家附近');
  assert.equal(result.batteryLevel, 5);
});
test('R08: resolved historical reasons do not reappear after leaving home', () => {
  assert.ok(
    !summarizeRiskReason(
      [risk, event('USER_CONFIRMED_SAFE', 2), event('LEAVE_HOME', 3)],
      now,
    ).includes('LOCATION_LOST'),
  );
});
test('motion cannot resolve a low-battery or missing-location risk', () => {
  for (const type of ['LOW_BATTERY', 'LOCATION_LOST'])
    assert.equal(snapshot([event(type, 1), event('MOTION_DETECTED', 2)]).status, 'attention');
});
test('out-of-order replay keeps the chronological alarm; future confirmations are ignored', () => {
  assert.equal(
    snapshot([event('SOS_SENT', 2), event('USER_CONFIRMED_SAFE', 1)]).status,
    'emergency',
  );
  assert.equal(
    snapshot([
      event('SOS_SENT', 1),
      event('USER_CONFIRMED_SAFE', 2, { timestamp: new Date(now + 86_400_000).toISOString() }),
    ]).status,
    'emergency',
  );
});
