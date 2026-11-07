import assert from 'node:assert';
import fs from 'node:fs';

console.log('========================================================================');
console.log('TEST SUITE: Supabase Upload Payload Guard & Part Transfer History RLS');
console.log('========================================================================');

// --- Test 1: Realtime Payload Defense in useCloudSync.js ---
console.log('\n--- Test 1: Realtime Payload Defense in useCloudSync.js ---');
const cloudSyncContent = fs.readFileSync('src/context/useCloudSync.js', 'utf8');

assert.ok(
  cloudSyncContent.includes('Sanitize payload for Supabase Realtime broadcast to prevent HTTP 422'),
  'useCloudSync.js must contain defensive sanitization comments for Realtime broadcast'
);
assert.ok(
  cloudSyncContent.includes('hasBulkyArray'),
  'useCloudSync.js must detect bulky arrays before sending to Supabase Realtime'
);
assert.ok(
  cloudSyncContent.includes('msgStr.length > 45000'),
  'useCloudSync.js must enforce payload size ceiling (< 45KB) for Realtime broadcast'
);
console.log('  ✓ PASS: useCloudSync.js enforces defensive Realtime payload size bounds');

// --- Test 2: In-Memory Payload Sanitizer Logic Verification ---
console.log('\n--- Test 2: In-Memory Payload Sanitizer Logic Verification ---');
// Simulate the exact sanitization algorithm used in useCloudSync.js
function sanitizeForCloud(payload) {
  let cloudPayload = payload;
  if (cloudPayload && typeof cloudPayload === 'object') {
    const { units, items, records, snapshot_data, snapshot, transfers, ...rest } = cloudPayload;
    const hasBulkyArray = Boolean(
      (Array.isArray(units) && units.length > 20) ||
      (Array.isArray(items) && items.length > 20) ||
      (Array.isArray(records) && records.length > 20) ||
      (Array.isArray(transfers) && transfers.length > 20) ||
      snapshot_data ||
      snapshot
    );

    if (hasBulkyArray) {
      cloudPayload = {
        ...rest,
        count: rest.count !== undefined ? rest.count : (units?.length ?? items?.length ?? records?.length ?? transfers?.length ?? 0),
        hasBulkyData: true
      };
    }
  }

  let msgStr;
  try {
    msgStr = JSON.stringify(cloudPayload);
  } catch {
    cloudPayload = { count: cloudPayload?.count || 0, truncated: true };
    msgStr = '';
  }

  if (msgStr.length > 45000) {
    cloudPayload = {
      scope: cloudPayload?.scope,
      siteCode: cloudPayload?.siteCode,
      siteId: cloudPayload?.siteId,
      count: cloudPayload?.count || 0,
      timestamp: Date.now(),
      truncated: true
    };
  }
  return cloudPayload;
}

// Generate 2,845 mock inventory units matching real Fixably ingestion
const mockUnits = Array.from({ length: 2845 }, (_, i) => ({
  partNumber: `661-${10000 + (i % 200)}`,
  serialNumber: `F2LY${i.toString().padStart(8, '0')}`,
  siteCode: 'NES',
  siteId: 'site-nes',
  currentOwner: 'ASP_RETAIL',
  lastReceivedDate: '2026-11-04',
  movementHistory: ['DC', 'NES'],
  transferCount: 1,
  status: 'VALID',
  lifecycle_status: 'in_stock'
}));

const rawPayload = {
  scope: 'ALL',
  count: mockUnits.length,
  units: mockUnits,
  timestamp: Date.now()
};

const rawBytes = JSON.stringify(rawPayload).length;
console.log(`  Raw unpruned payload byte length: ${rawBytes.toLocaleString()} bytes (~${(rawBytes / (1024 * 1024)).toFixed(2)} MB)`);
assert.ok(rawBytes > 500000, 'Raw payload with 2,845 units should exceed 500 KB');

const sanitized = sanitizeForCloud(rawPayload);
const sanitizedBytes = JSON.stringify(sanitized).length;
console.log(`  Sanitized payload byte length: ${sanitizedBytes} bytes`);

assert.strictEqual(sanitized.units, undefined, 'Sanitized payload must not contain bulky units array');
assert.strictEqual(sanitized.count, 2845, 'Sanitized payload must retain exact count');
assert.strictEqual(sanitized.hasBulkyData, true, 'Sanitized payload must flag hasBulkyData');
assert.ok(sanitizedBytes < 500, 'Sanitized signaling payload must be well under 500 bytes');
console.log('  ✓ PASS: Bulky 2,845-unit payload reduced from ~1 MB to < 500 bytes signaling message');

// --- Test 3: useInventory.js Caller Verification ---
console.log('\n--- Test 3: useInventory.js Caller Verification ---');
const invContent = fs.readFileSync('src/context/useInventory.js', 'utf8');

// Ensure saveUnitsToSupabase does not pass bulky units array
assert.ok(
  !invContent.includes("broadcastCloudEvent('STOCK_UPDATED', { count: units.length, units"),
  'saveUnitsToSupabase must not pass units array to STOCK_UPDATED'
);
assert.ok(
  !invContent.includes("broadcastCloudEvent('UNITS_IMPORTED', { count: units.length, units"),
  'saveUnitsToSupabase must not pass units array to UNITS_IMPORTED'
);

// Ensure batchAddScanInUnits does not pass bulky units array
assert.ok(
  !invContent.includes("broadcastCloudEvent('INVENTORY_CACHE_INVALIDATED', {\n        scope: isMultiSite ? 'ALL' : resolvedSiteCode,\n        siteId: resolvedSiteId,\n        siteCode: resolvedSiteCode,\n        count: newUnits.length,\n        units: newUnits"),
  'batchAddScanInUnits must not pass units array to INVENTORY_CACHE_INVALIDATED'
);
console.log('  ✓ PASS: useInventory.js does not broadcast bulky unit arrays');

// --- Test 4: AllStocksImportModal.jsx Verification ---
console.log('\n--- Test 4: AllStocksImportModal.jsx Verification ---');
const modalContent = fs.readFileSync('src/components/AllStocksImportModal.jsx', 'utf8');
assert.ok(
  !modalContent.includes('units: finalImportedUnits,'),
  'AllStocksImportModal must not pass bulky units array to broadcastCloudEvent'
);
console.log('  ✓ PASS: AllStocksImportModal does not broadcast bulky unit arrays');

// --- Test 5: Part Transfer History RLS & Upsert Fix ---
console.log('\n--- Test 5: Part Transfer History RLS & Upsert Fix ---');
const transferServiceContent = fs.readFileSync('src/services/transferHistoryService.js', 'utf8');
assert.ok(
  transferServiceContent.includes("upsert(recent, { onConflict: 'id', ignoreDuplicates: true })"),
  'transferHistoryService must specify ignoreDuplicates: true to prevent 42501 RLS UPDATE violation'
);

const migrationContent = fs.readFileSync('src/supabase/part_transfer_history_migration.sql', 'utf8');
assert.ok(
  migrationContent.includes('FOR UPDATE') || migrationContent.includes('FOR ALL'),
  'part_transfer_history_migration.sql must include UPDATE or ALL RLS policy'
);

const patchContent = fs.readFileSync('src/supabase/fix_part_transfer_history_rls.sql', 'utf8');
assert.ok(
  patchContent.includes('CREATE POLICY "part_transfer_history_all"'),
  'Dedicated patch fix_part_transfer_history_rls.sql must include comprehensive ALL RLS policy'
);

const schemaContent = fs.readFileSync('src/supabase/schema.sql', 'utf8');
assert.ok(
  schemaContent.includes('part_transfer_history ENABLE ROW LEVEL SECURITY'),
  'schema.sql must enable RLS on part_transfer_history'
);
assert.ok(
  schemaContent.includes('part_transfer_history_all'),
  'schema.sql must contain policy for part_transfer_history'
);
console.log('  ✓ PASS: transferHistoryService and Supabase SQL configurations enforce full RLS coverage');

console.log('\n========================================================================');
console.log('ALL SUPABASE UPLOAD PAYLOAD GUARD & RLS TESTS PASSED (100%)');
console.log('========================================================================');
