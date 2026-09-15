import assert from 'node:assert';
import {
  isDraftSupersededOrFulfilled,
  reconcileShipmentsAndDrafts
} from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Draft Manifest & Outbound Shipment Sync');
console.log('====================================================');

// Mock data representing user scenario:
// 8 Drafts from 09/10/2026 (DCOWNED#091026A through H, 28 items each)
// 9 Shipped Shipments from 09/12/2026 (DCOWNED#091226A through I, 28 items each)
// 1 Truly Active Draft for today (DCOWNED#091526A, 10 fresh items)

const generateItems = (prefix, count) => {
  return Array.from({ length: count }, (_, i) => ({
    part_number: '661-21991',
    description: 'Battery, iPhone 13 Pro',
    serial_number: `${prefix}-SN-${String(i + 1).padStart(4, '0')}`,
    box_number: 1
  }));
};

const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const sites = ['site-sm-north', 'site-bgc', 'site-cebu', 'site-clark', 'site-davao', 'site-iloilo', 'site-alabang', 'site-fairview'];

// 1. Stale drafts from 9/10/2026
const staleDrafts = letters.map((letter, idx) => ({
  id: `draft-0910-${letter}`,
  invoice_ref: `DCOWNED#091026${letter}`,
  shipment_number: `DCOWNED#091026${letter}`,
  site_id: sites[idx],
  status: 'draft',
  created_at: '2026-09-10T08:00:00.000Z',
  items: generateItems(`PKG-${letter}`, 28)
}));

// 2. Shipped dispatches from 9/12/2026 (fulfilling the same packages with same parts)
const shippedShipments = letters.map((letter, idx) => ({
  id: `shipped-0912-${letter}`,
  invoice_ref: `DCOWNED#091226${letter}`,
  shipment_number: `DCOWNED#091226${letter}`,
  site_id: sites[idx],
  status: 'shipped',
  created_at: '2026-09-12T09:00:00.000Z',
  shipment_date: '2026-09-14',
  items: generateItems(`PKG-${letter}`, 28)
}));

// Add shipment 9 (DCOWNED#091226I)
shippedShipments.push({
  id: 'shipped-0912-I',
  invoice_ref: 'DCOWNED#091226I',
  shipment_number: 'DCOWNED#091226I',
  site_id: 'site-bacolod',
  status: 'shipped',
  created_at: '2026-09-12T10:00:00.000Z',
  shipment_date: '2026-09-14',
  items: generateItems('PKG-I', 28)
});

// 3. One genuine active draft (not yet shipped)
const activeDraft = {
  id: 'draft-today-A',
  invoice_ref: 'DCOWNED#091526A',
  shipment_number: 'DCOWNED#091526A',
  site_id: 'site-bgc',
  status: 'draft',
  created_at: '2026-09-15T10:00:00.000Z',
  items: generateItems('PKG-TODAY', 10)
};

const allShipments = [...staleDrafts, ...shippedShipments, activeDraft];

console.log('\n--- 1. Testing isDraftSupersededOrFulfilled by Serial Matching ---');
staleDrafts.forEach((draft) => {
  const isSuperseded = isDraftSupersededOrFulfilled(draft, allShipments);
  assert.strictEqual(isSuperseded, true, `Stale draft ${draft.invoice_ref} must be recognized as superseded`);
});
console.log(`  ✓ PASS: All 8 stale drafts (DCOWNED#091026A-H) correctly identified as superseded by shipped shipments`);

console.log('\n--- 2. Testing isDraftSupersededOrFulfilled with Active Fresh Draft ---');
const isActiveDraftSuperseded = isDraftSupersededOrFulfilled(activeDraft, allShipments);
assert.strictEqual(isActiveDraftSuperseded, false, 'Truly active draft must NOT be flagged as superseded');
console.log('  ✓ PASS: Fresh active draft DCOWNED#091526A remains active');

console.log('\n--- 3. Testing isDraftSupersededOrFulfilled by Sequence Letter and Destination Site ---');
// Draft with different/un-serialized items but matching site & sequence letter
const unSerializedDraft = {
  id: 'draft-unserial-B',
  invoice_ref: 'DCOWNED#091026B',
  site_id: sites[1], // site-bgc
  status: 'draft',
  created_at: '2026-09-10T08:00:00.000Z',
  items: [{ part_number: '661-21991', description: 'Battery' }]
};
const isUnserialSuperseded = isDraftSupersededOrFulfilled(unSerializedDraft, shippedShipments);
assert.strictEqual(isUnserialSuperseded, true, 'Draft matching completed shipment site and sequence letter must be superseded');
console.log('  ✓ PASS: Site + sequence letter matching correctly supersedes old draft');

console.log('\n--- 4. Testing reconcileShipmentsAndDrafts Bulk Cleanup ---');
const { reconciledList, supersededDraftIds, count } = reconcileShipmentsAndDrafts(allShipments, { removeSuperseded: true });
assert.strictEqual(count, 8, 'Exactly 8 stale drafts must be reconciled');
assert.strictEqual(supersededDraftIds.length, 8, '8 superseded IDs returned');
assert.strictEqual(reconciledList.length, 10, 'Reconciled list must contain 9 shipped + 1 active draft = 10');
assert.strictEqual(reconciledList.some(s => s.invoice_ref.includes('091026')), false, 'Stale 091026 drafts must be absent');
assert.strictEqual(reconciledList.some(s => s.id === activeDraft.id), true, 'Active draft must be preserved');
console.log('  ✓ PASS: reconcileShipmentsAndDrafts cleans up 8 stale drafts while preserving shipped and active dispatches');

console.log('\n--- 5. Testing ScanOutPacking draftShipments Filtering Parity ---');
const filterDraftShipments = (list) => {
  return (list || []).filter(s => {
    if (!s || !Array.isArray(s.items) || s.items.length === 0) return false;
    const st = String(s.status || '').toLowerCase().trim();
    if (st === 'shipped' || st === 'received_confirmed' || st === 'delivered' || s.is_superseded || st === 'completed_superseded') {
      return false;
    }
    if (isDraftSupersededOrFulfilled(s, list)) {
      return false;
    }
    return st === 'draft' || st === 'pending_pickup' || st === 'packing' || st === 'in_progress' || st === 'saved' || !st;
  });
};

const activeWorkstationDrafts = filterDraftShipments(allShipments);
assert.strictEqual(activeWorkstationDrafts.length, 1, 'Only the single truly active draft should appear in packing station');
assert.strictEqual(activeWorkstationDrafts[0].id, activeDraft.id);
console.log('  ✓ PASS: ScanOutPacking draft table shows only truly active draft (8 old drafts filtered out)');

console.log('\n--- 6. Testing Sidebar Badge Count Parity ---');
const getPendingShipmentsBadge = (list) => {
  return (list || []).filter(s => {
    if (!s || !Array.isArray(s.items) || s.items.length === 0) return false;
    const st = String(s.status || '').toLowerCase().trim();
    if (st !== 'draft' && st !== 'packing' && st !== 'pending_pickup') return false;
    if (s.is_superseded || st === 'completed_superseded') return false;
    if (isDraftSupersededOrFulfilled(s, list)) return false;
    return true;
  }).length;
};

const badgeCount = getPendingShipmentsBadge(allShipments);
assert.strictEqual(badgeCount, 1, 'Sidebar badge should display 1 (active draft only, not 8 stale drafts)');
console.log('  ✓ PASS: Sidebar badge displays accurate count of 1 (excluding completed drafts)');

console.log('\n--- 7. Testing Real-World Screenshot Scenario (media_1789445984748.png) ---');
// In the user's screenshot:
// 8 manifests with status 'pending_pickup' (Ready for Pickup) from 09/10/26:
// A: APP GB3 (19 units)
// B: APP BHS (6 units)
// C: APP PPM (8 units)
// D: ASP GL5 (43 units)
// E: APP MOA (14 units)
// F: ASP SMS (48 units)
// G: APP FES (45 units)
// H: ASP VN (61 units)
// And in Shipments.jsx, completed dispatches DCOWNED#091226A through H (with status 'shipped')

const realBranchData = [
  { letter: 'A', code: 'APP GB3', name: 'Mobile Care - Greenbelt 3', count: 19 },
  { letter: 'B', code: 'APP BHS', name: 'Mobile Care - Bonifacio High Street', count: 6 },
  { letter: 'C', code: 'APP PPM', name: 'Mobile Care - Power Plant Mall', count: 8 },
  { letter: 'D', code: 'ASP GL5', name: 'Mobile Care - Glorietta 5', count: 43 },
  { letter: 'E', code: 'APP MOA', name: 'Mobile Care - Mall of Asia', count: 14 },
  { letter: 'F', code: 'ASP SMS', name: 'Mobile Care - SM San Lazaro', count: 48 },
  { letter: 'G', code: 'APP FES', name: 'Mobile Care - Festival Mall', count: 45 },
  { letter: 'H', code: 'ASP VN', name: 'Mobile Care - Vertis North', count: 61 }
];

const mockRealSites = realBranchData.map((b, idx) => ({
  id: `site-uuid-${idx + 1}`,
  code: b.code,
  name: b.name,
  is_dc: false
}));

// The 8 pending manifests in the screenshot have status: 'pending_pickup'
const screenshotPendingManifests = realBranchData.map((b, idx) => ({
  id: `draft-rec-${idx + 1}`,
  invoice_ref: `DCOWNED#091026${b.letter}`,
  shipment_number: `DCOWNED#091026${b.letter}`,
  site_id: `site-uuid-${idx + 1}`,
  site_code: b.code,
  site_name: b.name,
  status: 'pending_pickup', // In screenshot: yellow badge "READY FOR PICKUP"
  created_at: '2026-09-10T11:00:00.000Z',
  created_date: '9/10/2026',
  items: Array.from({ length: b.count }, (_, i) => ({
    part_number: '661-00001',
    serial_number: `DRAFT-SN-${b.letter}-${i + 1}`
  }))
}));

// Completed dispatches in Shipments.jsx
const completedDispatches = realBranchData.map((b, idx) => ({
  id: `shipment-uuid-${idx + 1}`,
  invoice_ref: `DCOWNED#091226${b.letter}`,
  shipment_number: `DCOWNED#091226${b.letter}`,
  destination_site_id: `site-uuid-${idx + 1}`,
  destination_site_code: b.code,
  destination_site_name: b.name,
  status: 'shipped',
  shipment_date: '2026-09-14',
  created_at: '2026-09-12T14:00:00.000Z',
  items: Array.from({ length: b.count }, (_, i) => ({
    part_number: '661-00001',
    // Deliberately different serial numbers (e.g. re-scanned upon dispatch)
    serial_number: `FINAL-SN-${b.letter}-${i + 1}`
  }))
}));

// Add dispatch I
completedDispatches.push({
  id: 'shipment-uuid-9',
  invoice_ref: 'DCOWNED#091226I',
  shipment_number: 'DCOWNED#091226I',
  destination_site_code: 'ASP LAU',
  destination_site_name: 'Mobile Care - La Union',
  status: 'shipped',
  shipment_date: '2026-09-14',
  created_at: '2026-09-12T15:00:00.000Z',
  items: Array.from({ length: 28 }, (_, i) => ({ serial_number: `FINAL-SN-I-${i + 1}` }))
});

const fullDataset = [...screenshotPendingManifests, ...completedDispatches];

// Test isDraftSupersededOrFulfilled on each of the screenshot pending manifests
screenshotPendingManifests.forEach(manifest => {
  const superseded = isDraftSupersededOrFulfilled(manifest, fullDataset, mockRealSites);
  assert.strictEqual(superseded, true, `Pending manifest ${manifest.invoice_ref} must be recognized as superseded by completed dispatch`);
});
console.log('  ✓ PASS: All 8 Ready for Pickup manifests from screenshot successfully recognized as fulfilled');

// Test reconcileShipmentsAndDrafts
const realReconcileResult = reconcileShipmentsAndDrafts(fullDataset, { removeSuperseded: true }, mockRealSites);
assert.strictEqual(realReconcileResult.count, 8, 'Must remove all 8 stale pending manifests');
assert.strictEqual(realReconcileResult.reconciledList.length, 9, 'Must preserve all 9 completed shipments');
assert.strictEqual(
  realReconcileResult.reconciledList.every(s => s.status === 'shipped'),
  true,
  'Remaining shipments in list must all be the active shipped dispatches'
);
console.log('  ✓ PASS: reconcileShipmentsAndDrafts purges all 8 screenshot manifests and retains 9 shipped records');

console.log('====================================================');
console.log('ALL DRAFT RECONCILIATION TESTS PASSED (7/7)');
console.log('====================================================');

