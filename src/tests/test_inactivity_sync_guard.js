import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INACTIVITY_TIMEOUT_MS,
  INACTIVITY_STORAGE_KEY,
  INACTIVITY_PAUSED_STORAGE_KEY
} from '../hooks/useInactivitySyncGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: 1-Hour User Inactivity Guard & Egress Optimization');
console.log('====================================================\n');

// ----------------------------------------------------
// 1. Inactivity Configuration & Constants
// ----------------------------------------------------
console.log('--- 1. Inactivity Guard Constants ---');
assert.strictEqual(INACTIVITY_TIMEOUT_MS, 60 * 60 * 1000, 'Inactivity timeout must be exactly 1 hour (3,600,000 ms)');
assert.strictEqual(INACTIVITY_STORAGE_KEY, 'mdc_last_user_activity_time', 'Storage key for last activity timestamp matches');
assert.strictEqual(INACTIVITY_PAUSED_STORAGE_KEY, 'mdc_is_sync_paused_inactivity', 'Storage key for paused flag matches');
console.log('  ✓ PASS: Inactivity threshold is configured for 1 hour (60 minutes / 3,600,000 ms)');

// ----------------------------------------------------
// 2. Codebase Static Verification: useCloudSync Inactivity Blocking
// ----------------------------------------------------
console.log('\n--- 2. useCloudSync Inactivity Blocking Verification ---');
const cloudSyncCode = fs.readFileSync(path.join(__dirname, '../context/useCloudSync.js'), 'utf-8');

// 2a. isDataSyncPaused parameter
assert.ok(cloudSyncCode.includes('isDataSyncPaused = false'), 'useCloudSync must accept isDataSyncPaused');
console.log('  ✓ PASS: useCloudSync accepts isDataSyncPaused parameter');

// 2b. autoRefreshData guard
assert.ok(
  cloudSyncCode.includes('if (isDataSyncPaused && !isManual)') &&
  cloudSyncCode.includes("reason: 'inactivity_pause'"),
  'autoRefreshData must abort automatic background refreshes when isDataSyncPaused is true'
);
console.log('  ✓ PASS: autoRefreshData rejects automatic background sync when data sync is paused due to inactivity');

// 2c. Realtime WebSocket subscription guard
assert.ok(
  cloudSyncCode.includes('if (isDataSyncPaused)') &&
  cloudSyncCode.includes('setRealtimeConnected(false);'),
  'Realtime subscription effect must disconnect and abort when isDataSyncPaused is true'
);
console.log('  ✓ PASS: Realtime channels are disconnected when user is inactive');

// 2d. Heartbeat safety-net guard & promise bug fix
assert.ok(
  cloudSyncCode.includes('if (!currentUser?.id || isDataSyncPaused) return;') &&
  cloudSyncCode.includes('if (isDataSyncPaused) return;'),
  'Heartbeat interval must not execute when isDataSyncPaused is true'
);
assert.ok(
  !cloudSyncCode.includes('const hasQueuedItems = processOfflineSyncQueue();'),
  'Heartbeat must NOT use un-awaited processOfflineSyncQueue() which returned a truthy Promise'
);
assert.ok(
  cloudSyncCode.includes('hasQueuedItems = Array.isArray(queue) && queue.length > 0;'),
  'Heartbeat correctly inspects queued items synchronously'
);
console.log('  ✓ PASS: Heartbeat promise bug resolved and guarded against inactive users');

// 2e. Heavy registries conditional check
assert.ok(
  cloudSyncCode.includes("'live_master_dc_inventory'"),
  'HEAVY_DOC_IDS includes live_master_dc_inventory'
);
assert.ok(
  cloudSyncCode.includes('mdc_live_inventory_updated_at'),
  'useCloudSync tracks mdc_live_inventory_updated_at for conditional hydration'
);
console.log('  ✓ PASS: live_master_dc_inventory uses conditional timestamp checking to avoid multi-MB downloads');

// ----------------------------------------------------
// 3. UI Verification: InactivityRefreshModal
// ----------------------------------------------------
console.log('\n--- 3. UI InactivityRefreshModal Verification ---');
const modalCode = fs.readFileSync(path.join(__dirname, '../components/InactivityRefreshModal.jsx'), 'utf-8');

assert.ok(modalCode.includes('Data Sync Paused'), 'Modal contains Data Sync Paused heading');
assert.ok(modalCode.includes('Refresh Page'), 'Modal provides Refresh Page action');
assert.ok(modalCode.includes('window.location.reload()'), 'Modal reloads page on user confirmation');
assert.ok(modalCode.includes('onResumeSync'), 'Modal supports resuming live sync');
console.log('  ✓ PASS: InactivityRefreshModal properly prompts users with reload and resume options');

// ----------------------------------------------------
// 4. AppContext Integration Verification
// ----------------------------------------------------
console.log('\n--- 4. AppContext Wiring Verification ---');
const appContextCode = fs.readFileSync(path.join(__dirname, '../context/AppContext.jsx'), 'utf-8');

assert.ok(appContextCode.includes('useInactivitySyncGuard'), 'AppContext imports useInactivitySyncGuard');
assert.ok(appContextCode.includes('InactivityRefreshModal'), 'AppContext imports InactivityRefreshModal');
assert.ok(appContextCode.includes('isDataSyncPaused: inactivityGuard.isDataSyncPaused'), 'isDataSyncPaused is passed to cloudSync');
assert.ok(appContextCode.includes('<InactivityRefreshModal'), 'InactivityRefreshModal is rendered at root level');
console.log('  ✓ PASS: AppContext wires useInactivitySyncGuard and renders InactivityRefreshModal');

console.log('\n====================================================');
console.log('ALL INACTIVITY GUARD & EGRESS OPTIMIZATION TESTS PASSED');
console.log('====================================================\n');
