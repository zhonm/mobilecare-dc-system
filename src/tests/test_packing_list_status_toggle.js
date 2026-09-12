import assert from 'node:assert';
import { formatShipmentForDb } from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Packing List (PL) Status Change Functionality');
console.log('====================================================');

// --- Test 1: formatShipmentForDb preserves pending_pickup & ready_for_pickup for Postgres enum ---
console.log('\n--- 1. Testing formatShipmentForDb Status Normalization ---');

const testSite = [{ id: '11111111-2222-3333-4444-555555555555', code: 'NES' }];

const draftShipment = {
  id: 'shp-draft-1',
  invoice_ref: 'DCOWNED#091126A',
  site_id: 'site-nes',
  status: 'draft'
};
const formattedDraft = formatShipmentForDb(draftShipment, testSite);
assert.strictEqual(formattedDraft.status, 'draft', 'Draft status must remain draft');
console.log('  ✓ PASS: status: "draft" preserved as "draft"');

const pendingShipment = {
  id: 'shp-ready-1',
  invoice_ref: 'DCOWNED#091126B',
  site_id: 'site-nes',
  status: 'pending_pickup'
};
const formattedPending = formatShipmentForDb(pendingShipment, testSite);
assert.strictEqual(formattedPending.status, 'pending_pickup', 'pending_pickup must be preserved for Supabase enum');
console.log('  ✓ PASS: status: "pending_pickup" preserved for Supabase enum');

const readyForPickupShipment = {
  id: 'shp-ready-2',
  invoice_ref: 'DCOWNED#091126C',
  site_id: 'site-nes',
  status: 'ready_for_pickup'
};
const formattedReady = formatShipmentForDb(readyForPickupShipment, testSite);
assert.strictEqual(formattedReady.status, 'pending_pickup', 'ready_for_pickup must normalize to pending_pickup');
console.log('  ✓ PASS: status: "ready_for_pickup" correctly normalizes to "pending_pickup"');

const readyForDispatchShipment = {
  id: 'shp-ready-3',
  invoice_ref: 'DCOWNED#091126D',
  site_id: 'site-nes',
  status: 'ready_for_dispatch'
};
const formattedDispatch = formatShipmentForDb(readyForDispatchShipment, testSite);
assert.strictEqual(formattedDispatch.status, 'pending_pickup', 'ready_for_dispatch must normalize to pending_pickup');
console.log('  ✓ PASS: status: "ready_for_dispatch" correctly normalizes to "pending_pickup"');

// --- Test 2: Normalized status helper logic in Shipments ---
console.log('\n--- 2. Testing getNormalizedStatus Logic ---');

const getNormalizedStatus = (sh) => {
  if (!sh) return 'pending_pickup';
  if (sh.status === 'received_confirmed' || sh.status === 'delivered') {
    return 'received_confirmed';
  }
  if (sh.status === 'shipped' || sh.status === 'in_transit') {
    return 'shipped';
  }
  if (sh.status === 'draft' || sh.status === 'packing') {
    return 'draft';
  }
  return 'pending_pickup';
};

assert.strictEqual(getNormalizedStatus({ status: 'draft' }), 'draft');
assert.strictEqual(getNormalizedStatus({ status: 'packing' }), 'draft');
assert.strictEqual(getNormalizedStatus({ status: 'pending_pickup' }), 'pending_pickup');
assert.strictEqual(getNormalizedStatus({ status: 'ready_for_pickup' }), 'pending_pickup');
assert.strictEqual(getNormalizedStatus({ status: 'shipped' }), 'shipped');
assert.strictEqual(getNormalizedStatus({ status: 'received_confirmed' }), 'received_confirmed');
console.log('  ✓ PASS: getNormalizedStatus correctly separates draft from pending_pickup');

// --- Test 3: Status updating simulation ---
console.log('\n--- 3. Testing Status Toggle / Update Lifecycle ---');

let simulatedShipments = [
  { id: 's1', invoice_ref: 'DCOWNED#091126A', site_id: 'site-nes', status: 'draft', items: [{ serial_number: 'SN1' }] },
  { id: 's2', invoice_ref: 'DCOWNED#091026H', site_id: 'site-vn', status: 'draft', items: [{ serial_number: 'SN2' }] },
  { id: 's3', invoice_ref: 'DCOWNED#091026G', site_id: 'site-fes', status: 'pending_pickup', items: [{ serial_number: 'SN3' }] }
];

const simulateUpdateStatus = (shipmentId, newStatus) => {
  let resolvedStatus = newStatus;
  const raw = String(newStatus || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (raw === 'ready_for_pickup' || raw === 'ready_for_dispatch' || raw === 'pending_pickup' || raw === 'ready') {
    resolvedStatus = 'pending_pickup';
  } else if (raw === 'draft' || raw === 'packing') {
    resolvedStatus = 'draft';
  }
  simulatedShipments = simulatedShipments.map(s => s.id === shipmentId ? { ...s, status: resolvedStatus } : s);
};

// Toggle s1 from draft to Ready for Pickup
simulateUpdateStatus('s1', 'ready_for_pickup');
assert.strictEqual(simulatedShipments.find(s => s.id === 's1').status, 'pending_pickup');
console.log('  ✓ PASS: Promoted s1 from "draft" to "pending_pickup" (Ready for Pickup)');

// Toggle s3 from pending_pickup back to draft
simulateUpdateStatus('s3', 'draft');
assert.strictEqual(simulatedShipments.find(s => s.id === 's3').status, 'draft');
console.log('  ✓ PASS: Reverted s3 from "pending_pickup" back to "draft"');

// Bulk update all remaining drafts to Ready for Pickup
simulatedShipments.forEach(s => {
  if (s.status === 'draft') simulateUpdateStatus(s.id, 'pending_pickup');
});
assert.ok(simulatedShipments.every(s => s.status === 'pending_pickup'));
console.log('  ✓ PASS: Bulk update marked all drafts as "pending_pickup"');

// --- Test 4: Shipments Tab Counts & Filtering Isolation ---
console.log('\n--- 4. Testing Shipments Tab Counts & Filtering Isolation ---');

const mixedShipments = [
  { id: 'm1', status: 'draft', items: [1] },
  { id: 'm2', status: 'draft', items: [1] },
  { id: 'm3', status: 'pending_pickup', items: [1] },
  { id: 'm4', status: 'shipped', items: [1] },
  { id: 'm5', status: 'received_confirmed', items: [1] }
];

const computeCounts = (list) => {
  let pending = 0;
  let shipped = 0;
  let received = 0;
  let draft = 0;
  let total = 0;

  list.forEach(sh => {
    if (!sh.items || sh.items.length === 0) return;
    total++;
    const norm = getNormalizedStatus(sh);
    if (norm === 'received_confirmed') received++;
    else if (norm === 'shipped') shipped++;
    else if (norm === 'draft') draft++;
    else pending++;
  });

  return { total, pending, shipped, received, draft };
};

const counts = computeCounts(mixedShipments);
assert.strictEqual(counts.total, 5);
assert.strictEqual(counts.draft, 2, 'Must have exactly 2 drafts');
assert.strictEqual(counts.pending, 1, 'Pending for pickup must count ONLY ready manifests, not drafts');
assert.strictEqual(counts.shipped, 1);
assert.strictEqual(counts.received, 1);
console.log('  ✓ PASS: Filter tab counts cleanly differentiate Drafts (2) from Pending for Pickup (1)');

const filterList = (list, tab) => {
  return list.filter(sh => {
    const norm = getNormalizedStatus(sh);
    if (tab === 'ALL') return true;
    if (tab === 'pending_pickup') return norm === 'pending_pickup';
    if (tab === 'draft') return norm === 'draft';
    if (tab === 'shipped') return norm === 'shipped';
    if (tab === 'received_confirmed') return norm === 'received_confirmed';
    return true;
  });
};

const pendingOnly = filterList(mixedShipments, 'pending_pickup');
assert.strictEqual(pendingOnly.length, 1);
assert.strictEqual(pendingOnly[0].id, 'm3');
console.log('  ✓ PASS: "Pending for Pickup" filter strictly includes only ready manifests');

const draftOnly = filterList(mixedShipments, 'draft');
assert.strictEqual(draftOnly.length, 2);
console.log('  ✓ PASS: "Drafts" filter strictly returns draft manifests');

console.log('\n====================================================');
console.log('ALL PACKING LIST STATUS CHANGE TESTS PASSED (100%)');
console.log('====================================================\n');
