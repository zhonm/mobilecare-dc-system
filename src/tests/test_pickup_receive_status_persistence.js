import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getShipmentStatusRank,
  resolveMergedShipmentStatus
} from '../utils/shipmentHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useShipmentsCode = fs.readFileSync(path.resolve(__dirname, '../context/useShipments.js'), 'utf8');
const useCloudSyncCode = fs.readFileSync(path.resolve(__dirname, '../context/useCloudSync.js'), 'utf8');

console.log('====================================================================');
console.log('TEST SUITE: Pickup & Receive Status Persistence & Sync Precedence');
console.log('====================================================================\n');

// 1. Lifecycle rank ordering
assert.strictEqual(getShipmentStatusRank('draft'), 0);
assert.strictEqual(getShipmentStatusRank('packing'), 1);
assert.strictEqual(getShipmentStatusRank('pending_pickup'), 2);
assert.strictEqual(getShipmentStatusRank('ready_for_pickup'), 2);
assert.strictEqual(getShipmentStatusRank('shipped'), 3);
assert.strictEqual(getShipmentStatusRank('in_transit'), 3);
assert.strictEqual(getShipmentStatusRank('received_confirmed'), 4);
assert.strictEqual(getShipmentStatusRank('delivered'), 4);
console.log('  ✓ PASS: Shipment lifecycle status rank ordering verified');

// 2. Stale pending_pickup DB row must NOT roll back a newer Pickup (shipped) snapshot
{
  const existingSnapshot = {
    status: 'shipped',
    tracking_number: '548396878335',
    updated_at: '2026-11-22T03:40:00.000Z'
  };
  const staleDbRow = {
    status: 'pending_pickup',
    tracking_number: null,
    updated_at: '2026-11-19T08:00:00.000Z'
  };
  const merged = resolveMergedShipmentStatus(existingSnapshot, staleDbRow);
  assert.strictEqual(merged.status, 'shipped', 'Newer shipped snapshot must not be rolled back by stale pending_pickup DB row');
  assert.strictEqual(merged.updated_at, existingSnapshot.updated_at);
  console.log('  ✓ PASS: Stale pending_pickup DB row does not roll back newer Pickup (shipped)');
}

// 3. Stale pending_pickup DB row must NOT roll back Received Confirmed snapshot
{
  const existingSnapshot = {
    status: 'received_confirmed',
    received_date: '2026-11-22',
    received_at: '2026-11-22T03:45:00.000Z',
    updated_at: '2026-11-22T03:45:00.000Z'
  };
  const staleDbRow = {
    status: 'pending_pickup',
    tracking_number: null,
    updated_at: '2026-11-19T08:00:00.000Z'
  };
  const merged = resolveMergedShipmentStatus(existingSnapshot, staleDbRow);
  assert.strictEqual(merged.status, 'received_confirmed', 'Confirmed receipt must never regress to pending_pickup');
  console.log('  ✓ PASS: Stale pending_pickup DB row does not roll back Received Confirmed');
}

// 4. Intentional revert (e.g. "Set Draft") with strictly newer DB updated_at IS respected
{
  const olderSnapshot = {
    status: 'pending_pickup',
    updated_at: '2026-11-19T08:00:00.000Z'
  };
  const newerRevertedDbRow = {
    status: 'draft',
    updated_at: '2026-11-22T04:00:00.000Z'
  };
  const merged = resolveMergedShipmentStatus(olderSnapshot, newerRevertedDbRow);
  assert.strictEqual(merged.status, 'draft', 'Newer DB revert to draft must be honored');
  assert.strictEqual(merged.updated_at, newerRevertedDbRow.updated_at);
  console.log('  ✓ PASS: Intentional Set Draft revert with newer DB timestamp is honored');
}

// 5. confirmCourierPickup must not send non-existent public.shipments columns in direct DB write
{
  const startIdx = useShipmentsCode.indexOf('const confirmCourierPickup = async');
  const endIdx = useShipmentsCode.indexOf('const confirmSiteReceive = async');
  assert.ok(startIdx > 0 && endIdx > startIdx, 'confirmCourierPickup block found');
  const pickupBlock = useShipmentsCode.slice(startIdx, endIdx);
  const dbSectionStart = pickupBlock.indexOf('// B: Direct shipments table row update');
  const dbSectionEnd = pickupBlock.indexOf('// C: Direct inventory_units table update');
  const dbSection = pickupBlock.slice(dbSectionStart, dbSectionEnd);

  assert.ok(!dbSection.includes('courier_name:'), 'public.shipments dispatch write must not include non-existent courier_name column');
  assert.ok(!dbSection.includes('shipping_mode:'), 'public.shipments dispatch write must not include non-existent shipping_mode column');
  assert.ok(!dbSection.includes('dispatched_at:'), 'public.shipments dispatch write must not include non-existent dispatched_at column');
  assert.ok(dbSection.includes(".eq('id', existingShp.id)"), 'confirmCourierPickup should update existing row directly by id');
  assert.ok(dbSection.includes('if (fbErr) throw fbErr'), 'confirmCourierPickup must propagate DB failure so offline queue enqueues retry');
  console.log('  ✓ PASS: confirmCourierPickup writes only valid public.shipments columns and propagates errors');
}

// 6. useCloudSync offline queue & merge guards
{
  assert.ok(
    useCloudSyncCode.includes("const { error: recErr } = await supabase.from('saved_records').upsert(item.payload"),
    'processOfflineSyncQueue must check error on saved_records upsert'
  );
  assert.ok(
    useCloudSyncCode.includes('resolveMergedShipmentStatus(existing, dbS)'),
    'hydrateFromSupabase must use resolveMergedShipmentStatus when merging dbShipments'
  );
  assert.ok(
    useCloudSyncCode.includes('const resolvedTrackingNumber ='),
    'hydrateFromSupabase must preserve tracking_number non-destructively'
  );
  console.log('  ✓ PASS: useCloudSync offline replay and merge precedence guards verified');
}

console.log('\nALL PICKUP & RECEIVE STATUS PERSISTENCE TESTS PASSED (100%)\n');
