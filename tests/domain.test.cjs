const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const load = createLoader();
const { buildGuardianSnapshot } = load('src/domain/riskEngine.ts');
const { guardianConfig: config, createDemoEvents } = load('src/domain/mockData.ts');
const { isWithinGuardianWindow } = load('src/domain/guardianSchedule.ts');
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

test('single guardian window includes its start and excludes its end', () => {
  const schedule = config.schedule;
  assert.equal(isWithinGuardianWindow(schedule, new Date(2026, 8, 21, 6, 59)), false);
  assert.equal(isWithinGuardianWindow(schedule, new Date(2026, 8, 21, 7, 0)), true);
  assert.equal(isWithinGuardianWindow(schedule, new Date(2026, 8, 21, 17, 59)), true);
  assert.equal(isWithinGuardianWindow(schedule, new Date(2026, 8, 21, 18, 0)), false);
});

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
test('R02: SOS replaces a passive risk with its own incident', () => {
  for (const events of [
    [event('USER_CONFIRMED_SAFE', 1), event('SOS_SENT', 2)],
    [risk, event('SOS_SENT', 2)],
  ]) {
    assert.equal(snapshot(events).incident.kind, 'sos');
    assert.equal(snapshot(events).incident.id, 'e2');
  }
});
test('SOS after a previously notified passive alert does not inherit its receipts', () => {
  const result = snapshot([risk, prompt, notified, event('SOS_SENT', 4)]).incident;
  assert.equal(result.kind, 'sos');
  assert.deepEqual(result.notifiedContactIds, []);
});
test('legacy escalation completion preserves the unresolved risk', () => {
  const result = snapshot([risk, notified,
    event('ESCALATION_FINISHED', 4, { incidentId: risk.id })]);
  assert.equal(result.incident.completed, true);
  assert.equal(result.status, 'emergency');
});
test('R03: repeated IDs and repeated delivery receipts do not consume recipients', () => {
  for (const repeat of [notified, { ...notified, id: 'another-receipt' }]) {
    assert.deepEqual(snapshot([risk, prompt, notified, repeat]).incident.notifiedContactIds, ['contact-1']);
  }
});
test('late receipts and unknown legacy recipients cannot advance a new incident', () => {
  const current = event('LOCATION_LOST', 5);
  assert.equal(
    snapshot([
      risk,
      event('USER_CONFIRMED_SAFE', 4),
      current,
      { ...notified, timestamp: event('FAMILY_NOTIFIED', 6).timestamp },
    ]).incident.notifiedContactIds.length,
    0,
  );
  assert.equal(snapshot([risk, prompt, { ...notified, contactId: undefined }]).incident.notifiedContactIds.length, 0);
});
test('legacy failed delivery does not count as notification; acknowledgement preserves the alert', () => {
  assert.equal(
    snapshot([risk, prompt, { ...notified, type: 'FAMILY_NOTIFICATION_FAILED' }]).incident.notifiedContactIds.length,
    0,
  );
  const events = [
    risk,
    prompt,
    notified,
    event('FAMILY_ACKNOWLEDGED', 4, { incidentId: risk.id, contactId: 'contact-1' }),
  ];
  assert.equal(snapshot(events).incident.acknowledgedBy, 'contact-1');
  assert.equal(snapshot(events).status, 'emergency');
});
test('no-motion snapshot creates neither self prompts nor fabricated notification receipts', () => {
  const noMotion = event('NO_MOTION_FOR_LONG_TIME', 1, { source: 'motion' });
  const result = snapshot([noMotion]).incident;
  assert.equal(result.trigger.type, 'NO_MOTION_FOR_LONG_TIME');
  assert.equal(result.selfPromptAt, undefined);
  assert.deepEqual(result.notifiedContactIds, []);
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
    !(snapshot([risk, event('USER_CONFIRMED_SAFE', 2), event('LEAVE_HOME', 3)])
      .riskReason ?? '').includes('LOCATION_LOST'),
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
