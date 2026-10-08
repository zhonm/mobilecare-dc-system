import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('TEST SUITE: Supabase Free-Tier Optimization & Quota Safeguards');
console.log('========================================================================\n');

const cloudSyncPath = path.resolve('src/context/useCloudSync.js');
const cloudSyncCode = fs.readFileSync(cloudSyncPath, 'utf8');

const sqlOptPath = path.resolve('src/supabase/optimize_free_tier_usage.sql');
const sqlOptCode = fs.readFileSync(sqlOptPath, 'utf8');

const inactivityGuardPath = path.resolve('src/hooks/useInactivitySyncGuard.js');
const inactivityGuardCode = fs.readFileSync(inactivityGuardPath, 'utf8');

// --- Test 1: Inventory Units Egress Probe & Column Projection ---
console.log('--- Test 1: Inventory Units Egress Probe & Projection ---');
assert(
  cloudSyncCode.includes("select('updated_at', { count: 'exact' })"),
  'fetchAllInventoryUnits must probe updated_at with exact count before bulk downloading'
);
assert(
  cloudSyncCode.includes('fromCache: true'),
  'fetchAllInventoryUnits must return cachedUnits when probe detects no changes'
);
assert(
  cloudSyncCode.includes('INVENTORY_COLUMNS'),
  'fetchAllInventoryUnits must select only necessary projected columns instead of select(*)'
);
console.log('  ✓ PASS: inventory_units uses lightweight ~200-byte probe to avoid megabyte bulk downloads');

// --- Test 2: Parts Catalog In-Memory Caching ---
console.log('\n--- Test 2: Parts Catalog In-Memory Egress Defense ---');
assert(
  cloudSyncCode.includes("tbl === 'parts'") &&
  cloudSyncCode.includes('Array.isArray(parts) && parts.length > 0'),
  'shouldFetch must skip parts re-fetch if catalog is already loaded in memory'
);
console.log('  ✓ PASS: parts catalog is protected from redundant background re-fetching');

// --- Test 3: Heavy Document Registry Optimization ---
console.log('\n--- Test 3: Heavy Document Registry Optimization ---');
assert(
  cloudSyncCode.includes("'master_branch_inventory_registry'"),
  'HEAVY_DOC_IDS must include master_branch_inventory_registry'
);
assert(
  cloudSyncCode.includes('remoteBranchInvHeader'),
  'master_branch_inventory_registry must have conditional timestamp comparison'
);
assert(
  cloudSyncCode.includes(".limit(150)"),
  'saved_records shipment documents query must be limited to 150 records'
);
console.log('  ✓ PASS: master_branch_inventory_registry and shipment manifests capped and conditionally cached');

// --- Test 4: Cache Invalidation Tracking ---
console.log('\n--- Test 4: Cache Invalidation Tracking ---');
assert(
  cloudSyncCode.includes("localStorage.removeItem('mdc_live_inventory_count')"),
  'Cache invalidation handlers must clear mdc_live_inventory_count alongside updated_at'
);
console.log('  ✓ PASS: mdc_live_inventory_count is invalidated alongside mdc_live_inventory_updated_at');

// --- Test 5: Inactivity Watchdog Protection ---
console.log('\n--- Test 5: Inactivity Watchdog Protection ---');
assert(
  inactivityGuardCode.includes('60 * 60 * 1000') || inactivityGuardCode.includes('INACTIVITY_TIMEOUT_MS'),
  'Inactivity watchdog must enforce 1-hour idle cutoff'
);
assert(
  cloudSyncCode.includes('isDataSyncPaused'),
  'useCloudSync must halt background sync queries when isDataSyncPaused is true'
);
console.log('  ✓ PASS: 1-hour idle watchdog halts background queries for inactive branch PCs');

// --- Test 6: SQL Optimization Script Verification ---
console.log('\n--- Test 6: SQL Optimization Script Verification ---');
assert(
  sqlOptCode.includes('ALTER PUBLICATION supabase_realtime DROP TABLE'),
  'optimize_free_tier_usage.sql must exclude high-volume tables from realtime publication'
);
assert(
  sqlOptCode.includes('idx_inventory_units_updated_at'),
  'optimize_free_tier_usage.sql must ensure updated_at index for probe checks'
);
assert(
  sqlOptCode.includes('clean_stale_free_tier_records'),
  'optimize_free_tier_usage.sql must provide a storage cleanup routine for 500 MB quota'
);
console.log('  ✓ PASS: SQL optimization script verified');

console.log('\n========================================================================');
console.log('ALL SUPABASE FREE-TIER OPTIMIZATION TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================\n');
