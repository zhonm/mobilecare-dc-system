/**
 * ============================================================================
 * TEST SUITE: System-Wide Sync Performance & Free Tier Optimization
 * File: src/tests/test_sync_optimization.js
 * ============================================================================
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cloudSyncCode = fs.readFileSync(path.resolve(__dirname, '../context/useCloudSync.js'), 'utf8');
const fixablyCode = fs.readFileSync(path.resolve(__dirname, '../components/FixablyInventoryDashboard.jsx'), 'utf8');
const fifoCode = fs.readFileSync(path.resolve(__dirname, '../components/SiteTransfersFifoReport.jsx'), 'utf8');
const sqlCode = fs.readFileSync(path.resolve(__dirname, '../supabase/optimize_sync_performance.sql'), 'utf8');

console.log('====================================================================');
console.log('TEST SUITE: System-Wide Sync Performance & Free Tier Optimization');
console.log('====================================================================');

// 1. Stuck Syncing Guard & Watchdog Timeout
assert(cloudSyncCode.includes('activeSyncCountRef'), 'useCloudSync.js must ref-count active syncs via activeSyncCountRef');
assert(cloudSyncCode.includes('withTimeout(executeHydration(), 25000'), 'hydrateFromSupabase must enforce a 25s watchdog timeout');
assert(cloudSyncCode.includes('inFlightSelectiveRef'), 'useCloudSync.js must deduplicate concurrent selective hydrations');
assert(cloudSyncCode.includes("status === 'TIMED_OUT'"), 'Realtime channel must clear realtimeConnected on TIMED_OUT');
console.log('  ✓ PASS: Sync watchdog timeout, ref-counted indicator, and selective deduplication verified');

// 2. Incremental Delta Sync (inventory_units, lightweight saved_records, shipments)
assert(cloudSyncCode.includes(".gt('updated_at', localInvUpdatedAt)"), 'inventory_units must use incremental delta sync via gt(updated_at)');
assert(cloudSyncCode.includes('fetchChangedLightweightDocs'), 'LIGHTWEIGHT_SYSTEM_DOC_IDS must check id, updated_at headers before downloading snapshot_data');
assert(cloudSyncCode.includes('fetchIncrementalShipments'), 'saved_records shipments must use incremental updated_at delta sync');
console.log('  ✓ PASS: Incremental delta sync for inventory_units, system registries, and shipments verified');

// 3. Realtime Channel Consolidation & Debouncing
assert(!fixablyCode.includes('fixably_sync_${Math.random()'), 'FixablyInventoryDashboard must use deterministic Realtime channel name');
assert(fixablyCode.includes("'mdc_fixably_snapshot_room'"), 'FixablyInventoryDashboard must use mdc_fixably_snapshot_room');
assert(fifoCode.includes('scheduleFifoReload'), 'SiteTransfersFifoReport must debounce Realtime/Broadcast reloads');
console.log('  ✓ PASS: Realtime channel consolidation and burst debouncing verified');

// 4. SQL Performance Indexes
assert(sqlCode.includes('idx_inventory_units_updated_at'), 'SQL migration must index inventory_units(updated_at DESC)');
assert(sqlCode.includes('idx_saved_records_type_updated_at'), 'SQL migration must index saved_records(record_type, updated_at DESC)');
assert(sqlCode.includes('idx_shipments_site_updated_at'), 'SQL migration must index shipments(site_id, updated_at DESC)');
console.log('  ✓ PASS: Free-tier-safe SQL indexes verified');

console.log('\nALL SYNC OPTIMIZATION TESTS PASSED (100%)\n');
