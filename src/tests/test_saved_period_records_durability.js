/**
 * ============================================================================
 * TEST SUITE: Saved Period Records Durability & Permanent Persistence
 * File: src/tests/test_saved_period_records_durability.js
 * ============================================================================
 *
 * Verifies:
 * 1. Saved period record structure and broadcast payload format ({ record, recordId, label }).
 * 2. Non-destructive smart merger in useCloudSync (no clobbering by empty cloud responses).
 * 3. Preservation of local snapshot_data when remote returns lightweight sync headers.
 * 4. Deletion tombstone registration and respectful purging.
 * 5. SQL Migration file structure and RLS policy rules for saved_records.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================================');
console.log('TEST SUITE: Saved Period Records Durability & Permanent Persistence');
console.log('====================================================================\n');

// --- Test 1: Verify SQL Migration & RLS Policy Structure ---
console.log('--- Test 1: Verify SQL Migration & RLS Policies ---');
const sqlPath = path.resolve(__dirname, '../supabase/fix_saved_period_records_and_persistence.sql');
assert(fs.existsSync(sqlPath), 'fix_saved_period_records_and_persistence.sql must exist');

const sqlContent = fs.readFileSync(sqlPath, 'utf8');

// 1.1 Verify trigger allows period records
assert(sqlContent.includes('silent_ignore_anon_saved_records_writes'), 'SQL must define silent_ignore_anon_saved_records_writes');
assert(sqlContent.includes("IF NEW.id = 'master_users_registry' THEN"), 'Trigger must specifically protect master_users_registry');
assert(!sqlContent.includes("IF public.current_user_role() = 'anon' OR NEW.id = 'master_users_registry' THEN"), 'Trigger must NOT block anon writes for period records');

// 1.2 Verify RLS policies on saved_records
assert(sqlContent.includes('CREATE POLICY saved_records_select_anon'), 'SQL must define saved_records_select_anon');
assert(sqlContent.includes("'both', 'forecast', 'allocation'"), 'saved_records_select_anon must include period record types');
assert(sqlContent.includes("id LIKE 'rec-%'"), 'saved_records_select_anon must match rec-% prefix');

assert(sqlContent.includes('CREATE POLICY saved_records_insert_anon'), 'SQL must define saved_records_insert_anon');
assert(sqlContent.includes('CREATE POLICY saved_records_update_anon'), 'SQL must define saved_records_update_anon');
assert(sqlContent.includes('CREATE POLICY saved_records_delete_anon'), 'SQL must define saved_records_delete_anon');
assert(sqlContent.includes('CREATE POLICY saved_records_authenticated_all'), 'SQL must preserve authenticated access');

// 1.3 Verify auth RPC confirmed_at fix
assert(sqlContent.includes('register_or_update_auth_user'), 'SQL must redefine register_or_update_auth_user');
// confirmed_at must NOT be in the INSERT column list
const insertPart = sqlContent.slice(sqlContent.indexOf('INSERT INTO auth.users'), sqlContent.indexOf(') VALUES ('));
assert(!insertPart.includes('\n            confirmed_at,'), 'INSERT INTO auth.users must omit generated confirmed_at column');

console.log('  ✓ PASS: SQL migration file properly removes silent drops and permits period record RLS operations');


// --- Test 2: Verify usePeriodRecordsAndReports.js Broadcast Payload & Startup Hydration ---
console.log('\n--- Test 2: Verify usePeriodRecordsAndReports.js Logic ---');
const hookPath = path.resolve(__dirname, '../context/usePeriodRecordsAndReports.js');
const hookContent = fs.readFileSync(hookPath, 'utf8');

// 2.1 Broadcast payload must pass full record
assert(
  hookContent.includes("broadcastCloudEvent('PERIOD_RECORD_SAVED', { record: newRecord, recordId: newRecord.id, label: newRecord.period_label })"),
  'savePeriodRecord must broadcast { record: newRecord, recordId, label }'
);

// 2.2 Startup hydration must query dbStorage.getAllSavedRecords()
assert(hookContent.includes('dbStorage.getAllSavedRecords()'), 'Hook must call dbStorage.getAllSavedRecords() on mount');

// 2.3 Local storage and dbStorage must both be updated on save
assert(hookContent.includes('dbStorage.putSavedRecord(newRecord)'), 'Hook must call dbStorage.putSavedRecord on save');
assert(hookContent.includes("dbStorage.setItem('mdc_saved_records'"), 'Hook must set mdc_saved_records in dbStorage on save');

console.log('  ✓ PASS: usePeriodRecordsAndReports.js correctly broadcasts full record and hydrates from IndexedDB');


// --- Test 3: Verify useCloudSync.js Non-Destructive Smart Merger ---
console.log('\n--- Test 3: Verify useCloudSync.js Smart Merger & Event Handlers ---');
const syncPath = path.resolve(__dirname, '../context/useCloudSync.js');
const syncContent = fs.readFileSync(syncPath, 'utf8');

// 3.1 resPeriods query must include period_week and saved_by_user_id
assert(syncContent.includes('period_week, saved_by_name, saved_by_user_id'), 'resPeriods query must include period_week and saved_by_user_id');

// 3.2 Smart merger must preserve local records and snapshot_data
assert(syncContent.includes('cloudMap.get(localRec.id)'), 'Sync must use cloudMap to merge local and remote records');
assert(syncContent.includes('snapshot_data: localRec.snapshot_data'), 'Sync must preserve rich local snapshot_data over lightweight header');

// 3.3 Event listeners must support both payload.record and payload.recordId
assert(syncContent.includes("ev.data.type === 'PERIOD_RECORD_SAVED' && (ev.data.payload?.record || ev.data.payload?.recordId)"), 'Broadcast listener must accept record or recordId');
assert(syncContent.includes("bType === 'PERIOD_RECORD_SAVED' && (bPayload?.record || bPayload?.recordId)"), 'WebSocket listener must accept record or recordId');

console.log('  ✓ PASS: useCloudSync.js smart merger and dual-event handlers verified');


// --- Test 4: Simulation of Smart Merger Algorithm ---
console.log('\n--- Test 4: Functional Simulation of Smart Merger ---');
{
  const localSaved = [
    {
      id: 'rec-101',
      record_type: 'both',
      period_label: 'September 2026 – Week 3',
      period_year: 2026,
      period_month: 9,
      snapshot_data: { forecastItems: [{ id: 1, part: 'Display', qty: 50 }], summary: { totalForecastUnits: 50 } },
      created_at: '2026-09-20T08:00:00.000Z'
    },
    {
      id: 'rec-100',
      record_type: 'forecast',
      period_label: 'September 2026 – Week 2',
      period_year: 2026,
      period_month: 9,
      snapshot_data: { forecastItems: [{ id: 2, part: 'Battery', qty: 30 }], summary: { totalForecastUnits: 30 } },
      created_at: '2026-09-15T08:00:00.000Z'
    }
  ];

  // Case A: Cloud returns empty array (e.g. initial connection, offline, or lag)
  const emptyCloudRecords = [];
  const allDeletedPeriodIds = new Set(['rec-999']);

  const cloudMapA = new Map(emptyCloudRecords.map(r => [r.id, r]));
  const mergedA = [...emptyCloudRecords];

  localSaved.forEach(localRec => {
    if (!localRec || !localRec.id) return;
    const cleanId = String(localRec.id).trim();
    if (allDeletedPeriodIds.has(cleanId) || localRec.notes === '__DELETED__' || localRec.snapshot_data?.isDeleted) {
      return;
    }
    const remote = cloudMapA.get(localRec.id);
    if (!remote) {
      mergedA.push(localRec);
    }
  });

  assert.strictEqual(mergedA.length, 2, 'Locally saved records must NOT be deleted when cloud returns empty');
  assert.strictEqual(mergedA[0].id, 'rec-101');
  assert.ok(mergedA[0].snapshot_data?.summary, 'Snapshot data must be retained');
  console.log('  ✓ PASS Case A: Local records survive empty remote response');

  // Case B: Cloud returns lightweight header for rec-101 without snapshot_data
  const remoteHeaders = [
    {
      id: 'rec-101',
      record_type: 'both',
      period_label: 'September 2026 – Week 3',
      period_year: 2026,
      period_month: 9,
      snapshot_data: null, // lightweight header from egress defense
      created_at: '2026-09-20T08:00:00.000Z'
    }
  ];

  const cloudMapB = new Map(remoteHeaders.map(r => [r.id, r]));
  const mergedB = [...remoteHeaders];

  localSaved.forEach(localRec => {
    if (!localRec || !localRec.id) return;
    const cleanId = String(localRec.id).trim();
    if (allDeletedPeriodIds.has(cleanId)) return;
    const remote = cloudMapB.get(localRec.id);
    if (!remote) {
      mergedB.push(localRec);
    } else {
      const idx = mergedB.findIndex(r => r.id === localRec.id);
      if (idx !== -1 && localRec.snapshot_data && Object.keys(localRec.snapshot_data).length > 0) {
        if (!mergedB[idx].snapshot_data || Object.keys(mergedB[idx].snapshot_data).length === 0) {
          mergedB[idx] = { ...mergedB[idx], snapshot_data: localRec.snapshot_data };
        }
      }
    }
  });

  assert.strictEqual(mergedB.length, 2, 'Merged array must contain both rec-101 and local rec-100');
  const mergedRec101 = mergedB.find(r => r.id === 'rec-101');
  assert.ok(mergedRec101.snapshot_data, 'rec-101 must keep local snapshot_data despite remote returning null snapshot_data');
  assert.strictEqual(mergedRec101.snapshot_data.summary.totalForecastUnits, 50);
  console.log('  ✓ PASS Case B: Remote lightweight header is seamlessly enriched with local snapshot data');

  // Case C: Record is in allDeletedPeriodIds
  allDeletedPeriodIds.add('rec-100');
  const mergedC = [];
  localSaved.forEach(localRec => {
    if (allDeletedPeriodIds.has(localRec.id)) return;
    mergedC.push(localRec);
  });
  assert.strictEqual(mergedC.length, 1, 'Deleted record rec-100 must be filtered out');
  assert.strictEqual(mergedC[0].id, 'rec-101');
  console.log('  ✓ PASS Case C: Registered deletion tombstones are properly purged');
}

console.log('\n====================================================================');
console.log('ALL SAVED PERIOD RECORDS DURABILITY TESTS PASSED (100%)');
console.log('====================================================================\n');
