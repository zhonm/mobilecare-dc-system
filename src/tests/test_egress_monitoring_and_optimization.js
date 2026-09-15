import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractTableFromUrl,
  recordRequest,
  getEgressStats,
  isCircuitBreakerActive,
  resetSessionStats,
  formatBytes
} from '../services/egressMonitorService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: Supabase Egress Monitoring & Optimization');
console.log('====================================================\n');

// ----------------------------------------------------
// 1. Egress Monitor Service Core Metrics & Math
// ----------------------------------------------------
console.log('--- 1. Egress Monitor Service Core Metrics ---');

resetSessionStats();
assert.strictEqual(extractTableFromUrl('https://xyz.supabase.co/rest/v1/saved_records?select=*'), 'saved_records');
assert.strictEqual(extractTableFromUrl('https://xyz.supabase.co/rest/v1/inventory_units'), 'inventory_units');
assert.strictEqual(extractTableFromUrl('https://xyz.supabase.co/rest/v1/shipments?select=*,shipment_items(*)'), 'shipments');
assert.strictEqual(extractTableFromUrl('https://xyz.supabase.co/rest/v1/rpc/verify_login_credentials'), 'rpc:verify_login_credentials');
console.log('  ✓ PASS: Table & RPC extraction from Supabase PostgREST URLs is accurate');

// Test byte formatting
assert.strictEqual(formatBytes(0), '0 B');
assert.strictEqual(formatBytes(1024), '1 KB');
assert.strictEqual(formatBytes(1048576), '1 MB');
assert.strictEqual(formatBytes(3.415 * 1024 * 1024 * 1024), '3.42 GB');
console.log('  ✓ PASS: Byte formatting handles B, KB, MB, and GB boundaries cleanly');

// Record synthetic network requests
recordRequest({
  method: 'GET',
  url: 'https://xyz.supabase.co/rest/v1/saved_records?id=eq.00000000-0000-0000-0000-000000000001',
  status: 200,
  bytes: 50000,
  durationMs: 45,
  isAuto: false
});

recordRequest({
  method: 'GET',
  url: 'https://xyz.supabase.co/rest/v1/inventory_units?limit=100',
  status: 200,
  bytes: 25000,
  durationMs: 30,
  isAuto: true
});

const stats = getEgressStats();
assert.ok(stats.sessionBytes >= 75000, 'Session bytes must record accumulated request payload sizes');
assert.ok(stats.tableBreakdown['saved_records'].bytes === 50000, 'saved_records table egress recorded accurately');
assert.ok(stats.tableBreakdown['inventory_units'].bytes === 25000, 'inventory_units table egress recorded accurately');
assert.ok(stats.dailySafeBudgetBytes > 0, 'Safe daily budget must be calculated from remaining cycle days');
assert.ok(stats.percentUsed > 0 && stats.percentUsed <= 100, 'Percent used must be calculated against 5.0 GB limit');
console.log(`  ✓ PASS: Cumulative metrics registered: ${formatBytes(stats.totalBytes)} total / ${formatBytes(stats.dailySafeBudgetBytes)} daily budget`);

// ----------------------------------------------------
// 2. Circuit Breaker Runaway Loop Protection
// ----------------------------------------------------
console.log('\n--- 2. Circuit Breaker Runaway Loop Protection ---');

resetSessionStats();
assert.strictEqual(isCircuitBreakerActive(), false, 'Circuit breaker starts inactive');

// Simulate a runaway polling storm (> 36 automated requests in short window)
for (let i = 0; i < 40; i++) {
  recordRequest({
    method: 'GET',
    url: 'https://xyz.supabase.co/rest/v1/saved_records',
    status: 200,
    bytes: 2000,
    durationMs: 10,
    isAuto: true
  });
}

assert.strictEqual(isCircuitBreakerActive(), true, 'Circuit breaker must trip when rapid automated requests surge');
console.log('  ✓ PASS: Circuit breaker trips and protects quota when automated query frequency spikes');

// ----------------------------------------------------
// 3. Supabase Client Egress Tracking Fetch Integration
// ----------------------------------------------------
console.log('\n--- 3. Supabase Client Egress Tracking Integration ---');

const clientCode = fs.readFileSync(path.join(__dirname, '../supabase/client.js'), 'utf-8');
assert.ok(clientCode.includes('createEgressTrackingFetch'), 'client.js must import createEgressTrackingFetch');
assert.ok(clientCode.includes('global: { fetch: customFetch }'), 'client.js must pass customFetch to Supabase client');
assert.ok(clientCode.includes('autoRefreshToken: true'), 'client.js must preserve autoRefreshToken: true');
assert.ok(clientCode.includes('persistSession: true'), 'client.js must preserve persistSession: true');
console.log('  ✓ PASS: client.js instruments fetch pipeline for egress tracking while preserving session integrity');

// ----------------------------------------------------
// 4. useCloudSync.js Conditional Hydration & Egress Defenses
// ----------------------------------------------------
console.log('\n--- 4. useCloudSync.js Conditional Hydration & Egress Defenses ---');

const useCloudSyncCode = fs.readFileSync(path.join(__dirname, '../context/useCloudSync.js'), 'utf-8');

// 4a. SYSTEM_DOC_IDS integrity
assert.ok(useCloudSyncCode.includes("'master_masterlist_data_registry'"), 'SYSTEM_DOC_IDS must include master_masterlist_data_registry');
assert.ok(useCloudSyncCode.includes("'master_upload_audit_logs_registry'"), 'SYSTEM_DOC_IDS must include master_upload_audit_logs_registry');

// 4b. Heavy documents separation & lightweight updated_at timestamp check
assert.ok(useCloudSyncCode.includes('HEAVY_DOC_IDS'), 'useCloudSync.js must define HEAVY_DOC_IDS');
assert.ok(useCloudSyncCode.includes('LIGHTWEIGHT_SYSTEM_DOC_IDS'), 'useCloudSync.js must separate LIGHTWEIGHT_SYSTEM_DOC_IDS');
assert.ok(useCloudSyncCode.includes('mdc_live_master_updated_at'), 'useCloudSync.js must track mdc_live_master_updated_at');
assert.ok(useCloudSyncCode.includes('mdc_masterlist_updated_at'), 'useCloudSync.js must track mdc_masterlist_updated_at');
console.log('  ✓ PASS: Multi-megabyte JSON trees (live state & masterlist) utilize conditional timestamp hydration');

// 4c. Circuit breaker check in autoRefreshData
assert.ok(useCloudSyncCode.includes('isCircuitBreakerActive()'), 'autoRefreshData must consult isCircuitBreakerActive');
console.log('  ✓ PASS: autoRefreshData incorporates Circuit Breaker to prevent runaway egress depletion');

// 4d. Selective table routing for Realtime broadcast events
assert.ok(useCloudSyncCode.includes("tables: ['shipments', 'saved_records']"), 'Shipment broadcast events must target selective tables');
console.log('  ✓ PASS: Realtime broadcast handlers supply selective tables rather than blanket 10-table reloads');

// 4e. Suppression of redundant polling on tab change when Realtime is active
assert.ok(useCloudSyncCode.includes('if (realtimeConnected) return;'), 'Tab visit and window refocus must skip polling when Realtime is connected');
console.log('  ✓ PASS: Local tab visits and window refocus skip redundant background queries when Realtime is active');

// ----------------------------------------------------
// 5. UI Transparency: Settings Egress Monitor
// ----------------------------------------------------
console.log('\n--- 5. UI Transparency: Settings Egress Monitor ---');

const headerCode = fs.readFileSync(path.join(__dirname, '../components/Header.jsx'), 'utf-8');
assert.ok(!headerCode.includes('EgressUsageModal'), 'Header.jsx must not render the egress modal');
assert.ok(!headerCode.includes('egress-badge'), 'Header.jsx must not render the egress badge');

const settingsCode = fs.readFileSync(path.join(__dirname, '../components/SettingsCatalog.jsx'), 'utf-8');
assert.ok(settingsCode.includes("setActiveTab('egress')"), 'SettingsCatalog must expose an egress tab');
assert.ok(settingsCode.includes("activeTab === 'egress'"), 'SettingsCatalog must render the egress tab');
assert.ok(settingsCode.includes('tableBreakdown'), 'SettingsCatalog must display table egress breakdown');
console.log('  ✓ PASS: Settings provides complete egress visibility while the global header stays focused');

console.log('\n====================================================');
console.log('ALL SUPABASE EGRESS MONITORING & OPTIMIZATION TESTS PASSED');
console.log('====================================================\n');
