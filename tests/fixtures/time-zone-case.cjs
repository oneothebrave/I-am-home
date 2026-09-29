// Each case runs in its own Node process. It never changes the host OS clock/TZ.
const assert = require('node:assert/strict');
const { createLoader } = require('../loadTs.cjs');
const load = createLoader();
const { isWithinGuardianWindow } = load('src/domain/guardianSchedule.ts');
const { parseCurrentLocationSample } = load('src/domain/validation.ts');
const { retainGuardianEvents } = load('src/domain/dataRetention.ts');
const { formatEventTime } = load('src/utils/time.ts');
const { guardianConfig } = load('src/domain/mockData.ts');
const zone = process.argv[2];
assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone === zone ||
  (zone === 'Asia/Kathmandu' && Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Katmandu'), true);
const schedule = guardianConfig.schedule;
const instant = Date.parse('2026-09-28T00:00:00Z');
const expected = { UTC: [0, 0, 28], 'Asia/Shanghai': [8, 0, 28], 'America/New_York': [20, 0, 27],
  'Europe/Berlin': [2, 0, 28], 'Asia/Kathmandu': [5, 45, 28], 'Pacific/Apia': [13, 0, 28] }[zone];
const local = new Date(instant);
assert.deepEqual([local.getHours(), local.getMinutes(), local.getDate()], expected);
for (const [hour, minute, second, expected] of [[6, 59, 59, false], [7, 0, 0, true],
  [17, 59, 59, true], [18, 0, 0, false], [23, 59, 59, false], [0, 0, 0, false]]) {
  assert.equal(isWithinGuardianWindow(schedule, new Date(2026, 8, 28, hour, minute, second)), expected);
}
const sample = (timestamp) => ({ latitude: 30, longitude: 120, accuracy: 8, timestamp });
assert.equal(parseCurrentLocationSample(sample('2026-09-28T08:00:00+08:00'), instant).timestamp, new Date(instant).toISOString());
assert.doesNotThrow(() => parseCurrentLocationSample(sample(new Date(instant - 120000).toISOString()), instant));
assert.throws(() => parseCurrentLocationSample(sample(new Date(instant - 120001).toISOString()), instant), /过期/);
assert.doesNotThrow(() => parseCurrentLocationSample(sample(new Date(instant + 5000).toISOString()), instant));
assert.throws(() => parseCurrentLocationSample(sample(new Date(instant + 5001).toISOString()), instant), /过期/);
const day = 86400000;
const event = (id, at) => ({ id, type: 'LOCATION_UPDATED', title: id, description: id, source: 'location', timestamp: new Date(at).toISOString() });
assert.deepEqual(retainGuardianEvents([event('boundary', instant - 30 * day), event('expired', instant - 30 * day - 1)], instant).map((e) => e.id), ['boundary']);
const midnight = new Date(2026, 8, 29, 0, 0, 0).getTime();
assert.match(formatEventTime(new Date(midnight - 1000).toISOString(), midnight), /2026-09-28 23:59/);
assert.match(formatEventTime(new Date(midnight).toISOString(), midnight), /今天 00:00/);

if (zone === 'America/New_York' || zone === 'Europe/Berlin') {
  const newYork = zone === 'America/New_York';
  const springBefore = Date.parse(newYork ? '2026-03-08T06:59:30Z' : '2026-03-29T00:59:30Z');
  const springAfter = springBefore + 120000;
  assert.equal(new Date(springBefore).getHours(), 1);
  assert.equal(new Date(springAfter).getHours(), 3);
  assert.doesNotThrow(() => parseCurrentLocationSample(sample(new Date(springBefore).toISOString()), springAfter));
  const springWindow = { ...schedule, startTime: '01:30', expectedReturnTime: '03:30' };
  assert.equal(isWithinGuardianWindow(springWindow, new Date(springBefore)), true);
  assert.equal(isWithinGuardianWindow(springWindow, new Date(springAfter)), true);
  const first = Date.parse(newYork ? '2026-11-01T05:30:00Z' : '2026-10-25T00:30:00Z');
  const second = first + 3600000;
  const hour = newYork ? '01' : '02';
  const fallWindow = { ...schedule, startTime: hour + ':15', expectedReturnTime: hour + ':45' };
  assert.equal(new Date(first).getHours(), new Date(second).getHours());
  assert.equal(isWithinGuardianWindow(fallWindow, new Date(first)), true);
  assert.equal(isWithinGuardianWindow(fallWindow, new Date(second)), true);
  // Repeated local clock text does not make a one-hour-old sample fresh.
  assert.throws(() => parseCurrentLocationSample(sample(new Date(first).toISOString()), second), /过期/);
  assert.deepEqual(retainGuardianEvents([event('cutoff', second - 30 * day), event('old', second - 30 * day - 1)], second).map((e) => e.id), ['cutoff']);
}
// A runtime time-zone change affects the daily window, not absolute sample age.
process.env.TZ = 'Asia/Shanghai';
assert.equal(isWithinGuardianWindow(schedule, new Date(instant)), true);
process.env.TZ = 'America/New_York';
assert.equal(isWithinGuardianWindow(schedule, new Date(instant)), false);
assert.equal(parseCurrentLocationSample(sample(new Date(instant).toISOString()), instant).timestamp, new Date(instant).toISOString());
console.log('time-zone checks passed: ' + zone);
