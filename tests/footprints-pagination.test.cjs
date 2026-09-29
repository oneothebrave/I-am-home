const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./loadTs.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const load = createLoader({ 'react-native': { Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (value) => value } } });
const { FootprintsScreen, FOOTPRINT_PAGE_SIZE } = load('src/screens/FootprintsScreen.tsx');
const now = Date.parse('2026-09-28T10:00:00Z');
const events = (size, offset = 0) => Array.from({ length: size }, (_, i) => ({
  id: 'record-' + (i + offset), title: 'record-' + (i + offset), description: '活动', source: 'geofence',
  timestamp: new Date(now - (i + offset) * 1000).toISOString(), type: i % 2 ? 'LEAVE_HOME' : 'RETURN_HOME',
}));
const texts = (r) => r.root.findAllByType('Text').map((n) => n.children.join(''));
const rows = (r) => texts(r).filter((value) => value.startsWith('record-'));
const button = (r, label) => r.root.findAllByType('TouchableOpacity').find((n) =>
  n.findAllByType('Text').some((t) => t.children.join('') === label));

test('2001 footprints remain accessible with no more than 40 rendered rows on every page', async () => {
  const input = events(2001); let renderer;
  await act(async () => { renderer = create(React.createElement(FootprintsScreen, { events: input, now })); });
  try {
    const seen = [];
    do {
      assert.ok(rows(renderer).length <= FOOTPRINT_PAGE_SIZE);
      seen.push(...rows(renderer));
      const next = button(renderer, '更早记录'); if (!next) break;
      await act(async () => next.props.onPress());
    } while (true);
    assert.deepEqual(seen, input.map((event) => event.title));
    await act(async () => button(renderer, '回到最新记录').props.onPress());
    assert.deepEqual(rows(renderer), input.slice(0, 40).map((event) => event.title));
    assert.equal(button(renderer, '较新记录'), undefined);
  } finally { await act(async () => renderer.unmount()); }
});

test('live arrivals anchor older pages; retention or clearing never leaves an empty stale page', async () => {
  let input = events(120); let renderer;
  const update = async () => { await act(async () => renderer.update(React.createElement(FootprintsScreen, { events: input, now }))); };
  await act(async () => { renderer = create(React.createElement(FootprintsScreen, { events: input, now })); });
  try {
    await act(async () => button(renderer, '更早记录').props.onPress());
    const anchored = rows(renderer);
    input = [{ ...events(1)[0], id: 'record-new', title: 'record-new', timestamp: new Date(now + 1000).toISOString(), type: 'LEAVE_HOME' }, ...input];
    await update(); assert.deepEqual(rows(renderer), anchored);
    await act(async () => button(renderer, '较新记录').props.onPress());
    assert.equal(rows(renderer)[0], 'record-0');
    await act(async () => button(renderer, '回到最新记录').props.onPress());
    assert.equal(rows(renderer)[0], 'record-new');
    await act(async () => button(renderer, '更早记录').props.onPress());
    input = input.slice(0, 10); await update();
    assert.equal(rows(renderer).length, 10);
    assert.equal(button(renderer, '更早记录'), undefined);
    input = []; await update();
    assert.equal(rows(renderer).length, 0);
    assert.ok(texts(renderer).includes('还没有足迹或活动记录'));
  } finally { await act(async () => renderer.unmount()); }
});

test('clock-only updates do not refilter or resort the event history', async () => {
  let reads = 0;
  const input = events(2000).map((event) => ({ ...event, get timestamp() { reads++; return event.timestamp; } }));
  let renderer;
  await act(async () => { renderer = create(React.createElement(FootprintsScreen, { events: input, now })); });
  try {
    reads = 0;
    await act(async () => renderer.update(React.createElement(FootprintsScreen, { events: input, now: now + 30000 })));
    assert.ok(reads <= FOOTPRINT_PAGE_SIZE, 'only the visible timestamps should be formatted');
  } finally { await act(async () => renderer.unmount()); }
});
