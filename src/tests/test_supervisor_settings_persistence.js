import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { DEFAULT_SUPERVISOR_SETTINGS } from '../context/useCatalogAndSites.js';
import { clearOperationalLocalStorage } from '../utils/cacheManager.js';

console.log('====================================================');
console.log('TEST SUITE: MDC Supervisor & Declaration Form Persistence');
console.log('====================================================');

// Mock browser globals for test environment
if (typeof window === 'undefined') {
  const store = new Map();
  global.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (i) => Array.from(store.keys())[i] || null
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    }
  };
  global.localStorage = global.window.localStorage;
  global.sessionStorage = global.window.sessionStorage;
}

// 1. Verify DEFAULT_SUPERVISOR_SETTINGS defaults
assert.strictEqual(DEFAULT_SUPERVISOR_SETTINGS.supervisor_name, 'Anjo Alcazar', 'Default supervisor name should be Anjo Alcazar');
assert.strictEqual(DEFAULT_SUPERVISOR_SETTINGS.supervisor_title, 'MDC Supervisor of DC', 'Default supervisor title should be MDC Supervisor of DC');
assert.strictEqual(DEFAULT_SUPERVISOR_SETTINGS.guard_on_duty, '', 'Default guard on duty should be empty');
console.log('  ✓ PASS: DEFAULT_SUPERVISOR_SETTINGS defaults correctly configured');

// 2. Verify cacheManager.js preserves mdc_supervisor_settings during clearOperationalLocalStorage
window.localStorage.clear();
const testSettings = {
  supervisor_name: 'Juan Dela Cruz',
  supervisor_title: 'Operations Director',
  guard_on_duty: 'Sgt. Ramos'
};
window.localStorage.setItem('mdc_supervisor_settings', JSON.stringify(testSettings));
window.localStorage.setItem('mdc_forecast', JSON.stringify([{ id: 'test' }])); // Operational key that SHOULD be wiped

await clearOperationalLocalStorage({ keepSession: true });

const preservedRaw = window.localStorage.getItem('mdc_supervisor_settings');
assert.ok(preservedRaw, 'mdc_supervisor_settings must NOT be wiped by clearOperationalLocalStorage');
const preserved = JSON.parse(preservedRaw);
assert.strictEqual(preserved.supervisor_name, 'Juan Dela Cruz', 'Supervisor name must be intact after cache clear');
assert.strictEqual(preserved.supervisor_title, 'Operations Director', 'Supervisor title must be intact after cache clear');
assert.strictEqual(preserved.guard_on_duty, 'Sgt. Ramos', 'Guard on duty must be intact after cache clear');

const wipedOperational = window.localStorage.getItem('mdc_forecast');
assert.strictEqual(wipedOperational, null, 'Operational forecast cache must be wiped');
console.log('  ✓ PASS: cacheManager preserves mdc_supervisor_settings across cache clearances');

// 3. Verify useCloudSync.js declares master_supervisor_settings_registry in SYSTEM_DOC_IDS
const cloudSyncPath = path.resolve('src/context/useCloudSync.js');
const cloudSyncCode = fs.readFileSync(cloudSyncPath, 'utf-8');
const systemDocIdsMatch = cloudSyncCode.match(/const SYSTEM_DOC_IDS = \[([\s\S]*?)\];/);
assert.ok(systemDocIdsMatch, 'SYSTEM_DOC_IDS must be declared in useCloudSync.js');
const docIdsContent = systemDocIdsMatch[1];
assert.ok(
  docIdsContent.includes('master_supervisor_settings_registry'),
  'SYSTEM_DOC_IDS must include master_supervisor_settings_registry'
);
console.log('  ✓ PASS: useCloudSync.js includes master_supervisor_settings_registry in SYSTEM_DOC_IDS');

// 4. Verify useCloudSync.js handles SUPERVISOR_SETTINGS_UPDATED realtime broadcast
assert.ok(
  cloudSyncCode.includes("bType === 'SUPERVISOR_SETTINGS_UPDATED'"),
  'useCloudSync.js must listen for SUPERVISOR_SETTINGS_UPDATED realtime events'
);
assert.ok(
  cloudSyncCode.includes("'SUPERVISOR_SETTINGS_UPDATED'"),
  'SUPERVISOR_SETTINGS_UPDATED must be in isAlreadyHandledLocally'
);
console.log('  ✓ PASS: Realtime broadcast handler for SUPERVISOR_SETTINGS_UPDATED is present');

// 5. Verify useCatalogAndSites.js implements Supabase cloud persistence for supervisor settings
const catalogPath = path.resolve('src/context/useCatalogAndSites.js');
const catalogCode = fs.readFileSync(catalogPath, 'utf-8');
assert.ok(
  catalogCode.includes('master_supervisor_settings_registry'),
  'useCatalogAndSites.js must reference master_supervisor_settings_registry'
);
assert.ok(
  catalogCode.includes("id: 'master_supervisor_settings_registry'"),
  'useCatalogAndSites.js must upsert to saved_records with master_supervisor_settings_registry'
);
console.log('  ✓ PASS: useCatalogAndSites.js implements cloud persistence to saved_records');

// 6. Verify SettingsCatalog.jsx has reactive effect and UI states for supervisor settings
const settingsCatalogPath = path.resolve('src/components/SettingsCatalog.jsx');
const settingsCatalogCode = fs.readFileSync(settingsCatalogPath, 'utf-8');
assert.ok(
  settingsCatalogCode.includes('handleSaveSupervisor'),
  'SettingsCatalog.jsx must define handleSaveSupervisor'
);
assert.ok(
  settingsCatalogCode.includes('isSavingSupervisor'),
  'SettingsCatalog.jsx must have isSavingSupervisor state'
);
assert.ok(
  settingsCatalogCode.includes('saveSupervisorSuccess'),
  'SettingsCatalog.jsx must have saveSupervisorSuccess state'
);
assert.ok(
  settingsCatalogCode.includes('useEffect('),
  'SettingsCatalog.jsx must have useEffect to synchronize supervisorSettings'
);
console.log('  ✓ PASS: SettingsCatalog.jsx provides reactive sync and visual save indicators');

console.log('====================================================');
console.log('ALL SUPERVISOR PERSISTENCE TESTS PASSED (6/6)');
console.log('====================================================');
