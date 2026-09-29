const fs = require('node:fs');
const path = require('node:path');
const { parsePlist, parsePbxProject } = require('./config-parsers.cjs');
const { createLoader } = require('../tests/loadTs.cjs');

const APP_ID = 'com.llingrui.iamhome';
const PROJECT = 'ios/DaojiaShuoYisheng.xcodeproj/project.pbxproj';
const INFO = 'ios/DaojiaShuoYisheng/Info.plist';
const PRIVACY = 'ios/DaojiaShuoYisheng/PrivacyInfo.xcprivacy';
const root = path.resolve(__dirname, '..');

async function checkRelease({ read = (file) => fs.readFileSync(path.join(root, file), 'utf8'),
  load = createLoader({ '@react-native-async-storage/async-storage': { async getItem() { return null; } },
    'react-native': { Platform: { OS: 'ios' }, NativeModules: { GuardianNative: {
      async checkLocalStorage() { return 'checked-v2'; },
    } } },
  }),
} = {}) {
  const checks = [];
  const check = async (name, operation) => {
    try { await operation(); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, detail: error.message }); }
  };
  const requireValue = (value, message) => { if (!value) throw Error(message); };
  let project, info, privacy;
  await check('工程、Info.plist 和隐私清单可解析', () => {
    project = parsePbxProject(read(PROJECT)); info = parsePlist(read(INFO)); privacy = parsePlist(read(PRIVACY));
  });
  const objects = () => { requireValue(project?.objects, '工程未正确读取'); return project.objects; };
  const target = (name) => {
    const matches = Object.values(objects()).filter((value) => value.isa === 'PBXNativeTarget' && value.name === name);
    requireValue(matches.length === 1, '目标缺失或重复：' + name); return matches[0];
  };
  await check('App 与测试包的 Debug/Release 标识和版本', () => {
    const versions = [];
    for (const [name, identifier] of [['DaojiaShuoYisheng', APP_ID], ['DaojiaShuoYishengTests', APP_ID + '.tests']]) {
      const current = target(name);
      const configurations = objects()[current.buildConfigurationList]?.buildConfigurations?.map((id) => objects()[id]);
      requireValue(configurations?.length === 2 && ['Debug', 'Release'].every((value) => configurations.filter((c) => c?.name === value).length === 1), '目标必须有明确的 Debug/Release 配置');
      for (const config of configurations) {
        const settings = config.buildSettings;
        requireValue(settings?.PRODUCT_BUNDLE_IDENTIFIER === identifier, name + ' / ' + config.name + ' 的 App 标识不匹配');
        requireValue(!Object.keys(settings).some((key) => key.startsWith('PRODUCT_BUNDLE_IDENTIFIER[')), '存在条件化 App 标识，请人工审查');
        requireValue(/^\d+(\.\d+){0,2}$/.test(settings.MARKETING_VERSION ?? '') && /^[1-9]\d*$/.test(settings.CURRENT_PROJECT_VERSION ?? ''), '版本号或构建号无效');
        if (name === 'DaojiaShuoYisheng') {
          requireValue(settings.INFOPLIST_FILE === 'DaojiaShuoYisheng/Info.plist', 'App 使用了不同的 Info.plist');
          versions.push(settings.MARKETING_VERSION + '/' + settings.CURRENT_PROJECT_VERSION);
        }
      }
    }
    requireValue(new Set(versions).size === 1, 'App Debug/Release 版本号不同');
  });
  await check('短信能力保持关闭，标识与权限说明完整', () => {
    requireValue(info?.GuardianCriticalMessagingEnabled === false, '未经真机与 entitlement 验收，不允许启用真实短信');
    requireValue(info.CFBundleIdentifier === '$(PRODUCT_BUNDLE_IDENTIFIER)', 'Info.plist 绕过了工程 App 标识');
    requireValue(info.CFBundleDisplayName === '到家了么', 'App 显示名称不匹配');
    requireValue(info.CFBundleVersion === '$(CURRENT_PROJECT_VERSION)' && info.CFBundleShortVersionString === '$(MARKETING_VERSION)', 'Info.plist 绕过了工程版本号');
    for (const key of ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription', 'NSMotionUsageDescription', 'NSCriticalMessagingUsageDescription'])
      requireValue(typeof info[key] === 'string' && info[key].trim().length >= 8, '权限说明缺失：' + key);
    requireValue(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false, '不允许全局关闭网络安全限制');
  });
  await check('后台模式、任务 ID 与原生注册保持一致', () => {
    requireValue(info && ['fetch', 'location'].every((mode) => info.UIBackgroundModes?.includes(mode)), '后台定位/刷新模式缺失');
    const taskId = APP_ID + '.guardian.refresh';
    requireValue(info.BGTaskSchedulerPermittedIdentifiers?.includes(taskId), '后台任务 ID 缺失');
    requireValue(read('ios/GuardianCore/GuardianRuntime.swift').includes('static let identifier = "' + taskId + '"'), '原生后台任务 ID 与声明不一致');
    const delegate = read('ios/DaojiaShuoYisheng/AppDelegate.swift');
    requireValue(delegate.includes('GuardianBootstrap.registerBackgroundTasks()'), 'App 启动缺少后台任务注册');
  });
  await check('隐私清单在 App 资源中，已有 API 声明未丢失', () => {
    requireValue(privacy?.NSPrivacyTracking === false, '跟踪声明改变，需要重新审查');
    requireValue(Array.isArray(privacy.NSPrivacyCollectedDataTypes), '缺少数据使用声明结构');
    for (const [category, reason] of [['FileTimestamp', 'C617.1'], ['UserDefaults', 'CA92.1'], ['SystemBootTime', '35F9.1']]) {
      const entries = privacy.NSPrivacyAccessedAPITypes?.filter((entry) => entry.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategory' + category);
      requireValue(entries?.length === 1 && entries[0].NSPrivacyAccessedAPITypeReasons?.includes(reason), '现有 API 声明缺失或重复：' + category);
    }
    const current = target('DaojiaShuoYisheng');
    const files = current.buildPhases.map((id) => objects()[id]).filter((phase) => phase?.isa === 'PBXResourcesBuildPhase')
      .flatMap((phase) => phase.files ?? []).map((id) => objects()[objects()[id]?.fileRef]);
    requireValue(files.some((file) => file?.path === 'DaojiaShuoYisheng/PrivacyInfo.xcprivacy'), '隐私清单没有加入 App 资源');
  });
  await check('新设备不载入演示数据，默认测试模式；旧版本不自动转正式', async () => {
    const { guardianRepository } = load('src/storage/guardianRepository.ts');
    const fresh = await guardianRepository.loadState();
    requireValue(fresh.mode === 'device' && fresh.isGuardianOn === false, '新安装不是未启动的设备模式');
    requireValue(fresh.config.contacts.length === 0 && fresh.config.geofences.length === 0 && fresh.localEvents.length === 0, '新安装含演示联系人、地点或事件');
    requireValue(fresh.config.schedule.monitoringMode === 'test', '新安装默认模式不是测试');
    const { parseStoredState } = load('src/storage/guardianSchema.ts');
    parseStoredState(fresh);
    for (const schemaVersion of [1, 2, 3]) {
      const legacy = JSON.parse(JSON.stringify(fresh)); legacy.schemaVersion = schemaVersion;
      delete legacy.config.schedule.monitoringMode; delete legacy.config.schedule.locationLostThresholdMinutes;
      requireValue(parseStoredState(legacy).config.schedule.monitoringMode === 'test', '旧版本迁移不再默认测试：' + schemaVersion);
    }
  });
  await check('原生默认策略仍为测试（源码防回退检查）', () => {
    const source = read('ios/GuardianCore/GuardianRiskDetector.swift').replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
    requireValue(/var mode:\s*GuardianMonitoringMode\s*=\s*\.test\b/.test(source) && /init\(mode:\s*GuardianMonitoringMode\s*=\s*\.test\b/.test(source), '原生默认策略改变，必须人工审查');
  });
  await check('本机存储保护的依赖版本、备份开关和原生接线', () => {
    requireValue(info?.RCTAsyncStorageExcludeFromBackup === true, '兼容存储必须明确排除备份');
    for (const key of ['UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace'])
      requireValue(info[key] === undefined || info[key] === false, '不能公开本机存储目录：' + key);
    const name = '@react-native-async-storage/async-storage';
    const pkg = JSON.parse(read('package.json')), lock = JSON.parse(read('package-lock.json'));
    requireValue(pkg.dependencies[name] === '3.1.1' && lock.packages[''].dependencies[name] === '3.1.1' &&
      lock.packages['node_modules/' + name].version === '3.1.1' &&
      JSON.parse(read('node_modules/' + name + '/package.json')).version === '3.1.1', '存储版本变化，必须重新审查目录和保护策略');
    requireValue(/- AsyncStorage \(3\.1\.1\):/.test(read('ios/Podfile.lock')), '原生存储依赖版本不一致');
    requireValue(read('node_modules/' + name + '/src/index.tsx').includes('export default getLegacyStorage();'), '默认存储后端变化，必须重新审查');
    const legacy = read('node_modules/' + name + '/apple/legacy_storage/RNCAsyncStorage.mm');
    for (const marker of ['@"RCTAsyncLocalStorage_V1"', '@"RNCAsyncLocalStorage_V1"', '@"RCTAsyncLocalStorage"',
      'NSApplicationSupportDirectory', '[[NSBundle mainBundle] bundleIdentifier]', '@"RCTAsyncStorageExcludeFromBackup"'])
      requireValue(legacy.includes(marker), '兼容存储布局变化，必须重新审查');
    for (const name of ['DaojiaShuoYisheng', 'DaojiaShuoYishengTests']) {
      const files = target(name).buildPhases.map((id) => objects()[id]).filter((phase) => phase?.isa === 'PBXSourcesBuildPhase')
        .flatMap((phase) => phase.files ?? []).map((id) => objects()[objects()[id]?.fileRef]);
      requireValue(files.some((file) => file?.path === 'GuardianStorageProtection.swift'), '保护源文件未加入目标：' + name);
      requireValue(files.some((file) => file?.path === 'GuardianStorageIntegrity.swift'), '完整性检查未加入目标：' + name);
      if (name === 'DaojiaShuoYishengTests') {
        requireValue(files.some((file) => file?.path === 'GuardianStorageProtectionTests.swift'), '存储保护测试未加入测试目标');
        requireValue(files.some((file) => file?.path === 'GuardianStorageIntegrityTests.swift'), '存储完整性测试未加入测试目标');
      }
    }
    requireValue(read('ios/GuardianCore/GuardianNativeModule.m').includes('RCT_EXTERN_METHOD(checkLocalStorage:'), '缺少原生保护桥接');
  });
  return checks;
}

if (require.main === module) {
  if (process.argv.length > 2) { console.error('此检查不接受跳过项或启用短信的参数。'); process.exitCode = 1; }
  else checkRelease().then((checks) => {
    for (const item of checks) console.log(`${item.ok ? '通过' : '失败'}：${item.name}${item.detail ? ' — ' + item.detail : ''}`);
    const ok = checks.every((item) => item.ok);
    console.log(ok ? '工程防错检查通过；不代表已完成发布验收。' : '工程防错检查失败，请修正后再打包。');
    console.log('仍需 Mac 编译、最终签名/构建参数与安装包核验、全部原生测试及 iPhone 实地测试；本工具不联网、不改文件、不发送短信。');
    process.exitCode = ok ? 0 : 1;
  }).catch((error) => { console.error('检查未完成：' + error.message); process.exitCode = 1; });
}
module.exports = { checkRelease, PROJECT, INFO, PRIVACY };
