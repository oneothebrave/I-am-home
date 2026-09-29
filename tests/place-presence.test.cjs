const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./loadTs.cjs');
const { resolvePlacePresence: resolve, distanceMeters } = createLoader()('src/domain/placePresence.ts');
const now = Date.parse('2026-09-28T10:00:00Z');
const home = { id: 'home', kind: 'home', name: '家', radiusMeters: 150, center: { latitude: 30, longitude: 120 } };
const point = (meters, accuracy = 5) => ({
  latitude: 30 + meters / 6_371_000 * 180 / Math.PI, longitude: 120, accuracy,
});
const gps = (meters, seconds, accuracy = 5) => ({
  id: 'gps-' + seconds, type: 'LOCATION_UPDATED', source: 'location',
  timestamp: new Date(now + seconds * 1000).toISOString(), location: point(meters, accuracy),
});
const check = (events, at = now) => resolve({ events }, [home], undefined, at);

test('place classification distinguishes inside, nearby, outside and unknown without claiming indoors', () => {
  assert.equal(check([gps(0, 0)]).state, 'inside');
  assert.equal(check([gps(0, 0)]).label, '家的范围内');
  assert.equal(check([gps(145, 0)]).state, 'nearby');
  assert.equal(check([gps(200, 0)]).state, 'outside');
  assert.equal(check([]).state, 'unknown');
  assert.equal(resolve({ events: [gps(0, 0)] }, [], undefined, now).state, 'unknown');
});

test('accuracy overlaps the boundary and jitter never alternates inside/outside', () => {
  for (const meters of [130, 149, 151, 169])
    assert.equal(check([gps(meters, 0, 30)]).state, 'nearby');
  const jitter = [145, 155, 148, 159, 141].map((meters, i) => gps(meters, -40 + i * 10));
  assert.equal(check(jitter).state, 'nearby');
});

test('a changed place needs two distinct fixes at least 15 seconds apart', () => {
  const original = gps(0, -60), changed = gps(250, -30);
  assert.equal(check([original, changed]).state, 'nearby');
  assert.equal(check([original, changed, { ...changed, id: 'duplicate' }]).state, 'nearby');
  assert.equal(check([original, changed, gps(260, -16)]).state, 'nearby');
  assert.equal(check([original, changed, gps(260, -15)]).state, 'outside');
  assert.equal(check([gps(250, -60), gps(0, -30), gps(1, -15)]).state, 'inside');
});

test('out-of-order fixes replay chronologically; a boundary sample resets confirmation', () => {
  assert.equal(check([gps(260, -15), gps(0, -60), gps(250, -30)]).state, 'outside');
  assert.equal(check([gps(0, -60), gps(250, -30), gps(150, -25), gps(260, -15)]).state, 'nearby');
});

test('stale, future, inaccurate, missing accuracy and invalid coordinate samples are unknown', () => {
  for (const value of [gps(0, -121), gps(0, 6), gps(0, 0, 101),
    { ...gps(0, 0), location: home.center },
    { ...gps(0, 0), location: { ...point(0), latitude: 91 } }])
    assert.equal(check([value]).state, 'unknown');
  assert.equal(check([gps(0, -120)]).state, 'inside');
  assert.equal(check([gps(0, -120)], now + 1).state, 'unknown');
});

test('risk-event cached coordinates cannot renew GPS freshness or override its place', () => {
  const risk = { ...gps(0, 0), id: 'risk', type: 'LOCATION_LOST' };
  assert.equal(check([gps(500, -121), risk]).state, 'unknown');
  assert.equal(check([gps(500, -30), risk]).state, 'outside');
});

test('region transitions indicate vicinity only and deleted region names are not inferred', () => {
  const boundary = { id: 'region', type: 'RETURN_HOME', source: 'geofence',
    geofenceId: 'home', timestamp: new Date(now).toISOString() };
  assert.equal(check([boundary]).state, 'nearby');
  assert.equal(check([{ ...boundary, type: 'LEAVE_HOME' }]).state, 'nearby');
  assert.equal(check([{ ...boundary, geofenceId: 'deleted', title: '进入家' }]).state, 'unknown');
});

test('overlapping fences keep an already confirmed place and ignore configuration order', () => {
  const farm = { ...home, id: 'farm', kind: 'work', name: '农场', center: point(80) };
  const input = { events: [gps(0, -30), gps(70, -10)] };
  const first = resolve(input, [home, farm], undefined, now);
  assert.equal(first.label, '家的范围内');
  assert.deepEqual(resolve(input, [farm, home], undefined, now), first);
  assert.ok(Number.isFinite(distanceMeters({ latitude: 90, longitude: 180 }, { latitude: -90, longitude: 0 })));
});
