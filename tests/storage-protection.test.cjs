const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('./loadTs.cjs');

const key = '@daojia_shuo_yisheng/guardian_state_v1';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function fixture(options = {}) {
  const calls = [], checks = [], values = options.values ?? new Map();
  let protectionCalls = 0;
  const native = Object.hasOwn(options, 'native') ? options.native : {
    async checkLocalStorage(access) {
      assert.equal(this, native, 'preserve native receiver');
      calls.push('protect');
      checks.push(access);
      protectionCalls++;
      return options.protect ? options.protect(protectionCalls, access) : 'checked-v2';
    },
  };
  const load = createLoader({
    'react-native': { Platform: { OS: options.os ?? 'ios' }, NativeModules: { GuardianNative: native } },
    '@react-native-async-storage/async-storage': {
      async getItem(k) {
        assert.equal(k, key); calls.push('read');
        if (options.readError) throw Error('read failed');
        return options.libraryNull ? null : values.get(k) ?? null;
      },
      async setItem(k, value) {
        assert.equal(k, key); calls.push('write');
        if (options.writeError) throw Error('write failed');
        if (!options.dropWrite) values.set(k, value);
      },
      async removeItem(k) { assert.equal(k, key); calls.push('remove'); values.delete(k); },
    },
  });
  const create = load('src/storage/asyncStorageGuardianStorage.ts').createAsyncStorageGuardianStorage;
  return { load, calls, checks, values, native, create, driver: create(),
    initial: () => load('src/storage/guardianSchema.ts').createInitialStoredState(Date.parse('2026-09-29T02:00:00Z')) };
}

test('iOS reads, writes and clears all require before/after protection', async () => {
  const f = fixture();
  await f.driver.save(f.initial());
  assert.deepEqual(await f.driver.load(), f.initial());
  await f.driver.clear();
  assert.deepEqual(f.calls, ['protect', 'write', 'protect', 'protect', 'read', 'protect', 'protect', 'remove', 'protect']);
  assert.equal(f.values.size, 0);
});

test('metadata upgrade leaves the stored JSON untouched and preserves pending deletion on restart', async () => {
  const f = fixture();
  const state = { ...f.initial(), mode: 'device', isGuardianPaused: true, dataDeletionPending: true };
  const raw = JSON.stringify(state, null, 2);
  f.values.set(key, raw);
  assert.deepEqual(await f.driver.load(), state);
  const restart = fixture({ values: f.values });
  assert.deepEqual(await restart.driver.load(), state);
  assert.equal(f.values.get(key), raw);
  assert.ok(![...f.calls, ...restart.calls].includes('write'));
});

test('v1/v2/v3 JS migrations preserve contacts/events and remain test-mode behind the protection gate', async () => {
  for (const schemaVersion of [1, 2, 3]) {
    const f = fixture(), state = f.initial();
    state.schemaVersion = schemaVersion;
    delete state.config.schedule.monitoringMode;
    delete state.config.schedule.locationLostThresholdMinutes;
    const raw = JSON.stringify(state);
    f.values.set(key, raw);
    const result = await f.driver.load();
    assert.equal(result.schemaVersion, 4);
    assert.equal(result.config.schedule.monitoringMode, 'test');
    assert.deepEqual(result.config.contacts, state.config.contacts);
    assert.deepEqual(result.config.geofences, state.config.geofences);
    assert.equal(result.localEvents.length, state.localEvents.length);
    assert.equal(f.values.get(key), raw);
  }
});

test('missing native protection in an older iOS binary blocks every data operation', async () => {
  for (const native of [undefined, {}, { checkLocalStorage: true }]) {
    const f = fixture({ native });
    await assert.rejects(f.driver.load(), /更新 App/);
    await assert.rejects(f.driver.save(f.initial()), /更新 App/);
    await assert.rejects(f.driver.clear(), /更新 App/);
    assert.deepEqual(f.calls, []);
  }
});

test('an unrecognized native acknowledgement never bypasses protection', async () => {
  for (const ack of [null, undefined, true, 1, 'protected-v1', 'protected', { status: 'checked-v2' }]) {
    const f = fixture({ protect: () => ack });
    await assert.rejects(f.driver.load(), /保护检查未完成/);
    assert.deepEqual(f.calls, ['protect']);
  }
});

test('native errors are redacted and a failed guard does not poison subsequent retries', async () => {
  const f = fixture({ protect: (count) => {
    if (count === 1) throw Error('/private/secret 13800138000 30.12345');
    return 'checked-v2';
  } });
  await assert.rejects(f.driver.save(f.initial()), (error) => {
    assert.match(error.message, /保护检查未完成/);
    assert.doesNotMatch(error.message, /private|secret|13800138000|30\.12345/);
    return true;
  });
  assert.equal(f.values.size, 0);
  await f.driver.save(f.initial());
  assert.deepEqual(await fixture({ values: f.values }).driver.load(), f.initial());
});

test('a post-write protection failure is not reported as durable; retry saves the latest edit', async () => {
  const f = fixture({ protect: (count) => {
    if (count === 2) throw Error('metadata failed after atomic save');
    return 'checked-v2';
  } });
  const { createFallbackGuardianStorage, createMemoryGuardianStorage } = f.load('src/storage/guardianStorage.ts');
  const storage = createFallbackGuardianStorage(f.driver, createMemoryGuardianStorage());
  const first = f.initial();
  await storage.save(first);
  assert.equal(storage.getStatus().durability, 'memory');
  assert.deepEqual(await storage.load(), first);
  assert.deepEqual(await fixture({ values: f.values }).driver.load(), first);
  const latest = { ...first, isGuardianPaused: true };
  await storage.save(latest);
  assert.equal(storage.getStatus().durability, 'durable');
  assert.deepEqual(await fixture({ values: f.values }).driver.load(), latest);
});

test('post-read protection failure does not expose an unchecked result as a successful load', async () => {
  const f = fixture({ protect: (count) => { if (count === 2) throw Error(); return 'checked-v2'; } });
  f.values.set(key, JSON.stringify(f.initial()));
  const raw = f.values.get(key);
  await assert.rejects(f.driver.load(), /保护检查未完成/);
  assert.equal(f.values.get(key), raw);
  assert.deepEqual(await f.driver.load(), f.initial());
});

test('post-remove failure remains a failure and a repeated clear is safe', async () => {
  const f = fixture({ protect: (count) => { if (count === 2) throw Error(); return 'checked-v2'; } });
  f.values.set(key, JSON.stringify(f.initial()));
  await assert.rejects(f.driver.clear(), /保护检查未完成/);
  await f.driver.clear();
  assert.equal(await f.driver.load(), undefined);
});

test('the final protection pass also runs after failed library reads and writes', async () => {
  for (const option of ['readError', 'writeError']) {
    const f = fixture({ [option]: true });
    const operation = option === 'readError' ? f.driver.load() : f.driver.save(f.initial());
    await assert.rejects(operation, /failed/);
    assert.deepEqual(f.calls, ['protect', option === 'readError' ? 'read' : 'write', 'protect']);
  }
});

test('all adapter instances serialize data operations with slow protection checks', async () => {
  const gate = deferred(), reached = deferred();
  const f = fixture({ protect: (count) => {
    if (count === 2) { reached.resolve(); return gate.promise; }
    return 'checked-v2';
  } });
  const state = f.initial();
  const saving = f.driver.save(state);
  const reading = f.create().load();
  const clearing = f.create().clear();
  await reached.promise;
  assert.deepEqual(f.calls, ['protect', 'write', 'protect']);
  gate.resolve('checked-v2');
  await saving;
  assert.deepEqual(await reading, state);
  await clearing;
  assert.deepEqual(f.calls, ['protect', 'write', 'protect', 'protect', 'read', 'protect', 'protect', 'remove', 'protect']);
});

test('queued writes snapshot state before waiting for protection', async () => {
  const gate = deferred();
  const f = fixture({ protect: (count) => count === 1 ? gate.promise : 'checked-v2' });
  const state = f.initial(), original = structuredClone(state);
  const saved = f.driver.save(state);
  state.config.contacts.length = 0;
  state.localEvents.length = 0;
  gate.resolve('checked-v2');
  await saved;
  assert.deepEqual(await f.driver.load(), original);
});

test('empty, corrupt or future-schema JSON is never interpreted as a new installation', async () => {
  for (const raw of ['', '{bad', 'null', '{}', '{"schemaVersion":999}']) {
    const f = fixture(); f.values.set(key, raw);
    await assert.rejects(f.driver.load());
    assert.equal(f.values.get(key), raw);
    assert.ok(!f.calls.includes('write'));
  }
  const f = fixture();
  assert.equal(await f.driver.load(), undefined);
  assert.deepEqual(f.calls, ['protect', 'read', 'protect']);
});

test('invalid state is rejected before any protection or disk mutation', async () => {
  const f = fixture();
  await assert.rejects(f.driver.save({ schemaVersion: 999 }));
  assert.deepEqual(f.calls, []);
});

test('non-iOS adapters remain usable without claiming iOS protection', async () => {
  const f = fixture({ os: 'web', native: undefined });
  await f.driver.save(f.initial());
  assert.deepEqual(await f.driver.load(), f.initial());
  assert.deepEqual(f.calls, ['write', 'read']);
});

test('native legacy cleanup is gated by deletion intent and precedes completion (source wiring only)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../ios/GuardianCore/GuardianRuntime.swift'), 'utf8');
  const clear = source.split('func clearLocalData() throws {')[1].split('func beginDataDeletion()')[0];
  const intent = clear.indexOf('guard try requireStore().dataDeletionPending');
  const cleanup = clear.indexOf('try GuardianStorageProtection.clearLegacyGuardianData()');
  const completion = clear.indexOf('try service.clearLocalData()');
  assert.ok(intent >= 0 && cleanup > intent && completion > cleanup);
  const begin = source.split('func beginDataDeletion()')[1].split('var reliabilityDiagnostics')[0];
  assert.doesNotMatch(begin, /clearLegacyGuardianData/);
});

test('each check identifies its operation and compares the actual returned/written value', async () => {
  const f = fixture();
  const state = f.initial(), raw = JSON.stringify(state);
  await f.driver.save(state);
  await f.driver.load();
  await f.driver.clear();
  assert.deepEqual(f.checks, [
    { operation: 'write', phase: 'before', value: null }, { operation: 'write', phase: 'after', value: raw },
    { operation: 'read', phase: 'before', value: null }, { operation: 'read', phase: 'after', value: raw },
    { operation: 'remove', phase: 'before', value: null }, { operation: 'remove', phase: 'after', value: null },
  ]);
});

test('a failed library operation uses the failure phase, never the success receipt phase', async () => {
  const f = fixture({ writeError: true });
  await assert.rejects(f.driver.save(f.initial()), /write failed/);
  assert.deepEqual(f.checks.map((c) => c.phase), ['before', 'failed']);
});

test('native corruption errors block the library and never expose file contents or paths', async () => {
  const f = fixture({ protect() {
    throw Object.assign(Error('/private/name-and-phone'), { code: 'STORAGE_INTEGRITY_ERROR' });
  } });
  f.values.set(key, 'preserve damaged fixture');
  await assert.rejects(f.driver.load(), (error) => {
    assert.match(error.message, /未确认读取或保存成功/);
    assert.doesNotMatch(error.message, /private|name-and-phone/);
    return true;
  });
  await assert.rejects(f.driver.save(f.initial()), /未确认读取或保存成功/);
  assert.equal(f.values.get(key), 'preserve damaged fixture');
  assert.deepEqual(f.calls, ['protect', 'protect']);
});

test('a library false-null cannot initialize the repository over an existing disk value', async () => {
  const options = { libraryNull: true, protect(count, access) {
    if (access.phase === 'after' && access.value !== f.values.get(key))
      throw { code: 'STORAGE_INTEGRITY_ERROR' };
    return 'checked-v2';
  } };
  const f = fixture(options);
  f.values.set(key, JSON.stringify(f.initial()));
  const repository = f.load('src/storage/guardianRepository.ts').createGuardianRepository(f.driver);
  await assert.rejects(repository.loadState(), /未确认读取或保存成功/);
  assert.equal(f.calls.includes('write'), false);
  options.libraryNull = false;
  assert.deepEqual(await repository.loadState(), f.initial());
});

test('silent dropped writes fail verification instead of reporting durable persistence', async () => {
  const f = fixture({ dropWrite: true, protect(count, access) {
    if (access.phase === 'after' && access.value !== f.values.get(key))
      throw { code: 'STORAGE_INTEGRITY_ERROR' };
    return 'checked-v2';
  } });
  const previous = f.initial(); f.values.set(key, JSON.stringify(previous));
  const { createFallbackGuardianStorage, createMemoryGuardianStorage } = f.load('src/storage/guardianStorage.ts');
  const storage = createFallbackGuardianStorage(f.driver, createMemoryGuardianStorage());
  await storage.save({ ...previous, isGuardianPaused: true });
  assert.equal(storage.getStatus().durability, 'memory');
  assert.deepEqual(JSON.parse(f.values.get(key)), previous);
});

test('only a validated deletion journal requests the native-authorized repair path', async () => {
  const f = fixture();
  await f.driver.save({ ...f.initial(), dataDeletionPending: true });
  assert.deepEqual(f.checks.map((c) => c.operation), ['deletion', 'deletion']);
  f.checks.length = 0;
  await f.driver.save(f.initial());
  assert.deepEqual(f.checks.map((c) => c.operation), ['write', 'write']);
});
