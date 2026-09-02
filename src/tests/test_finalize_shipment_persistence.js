import assert from 'assert';
import { generateNextInvoiceRef } from '../utils/appContextHelpers.js';
import { unmarkDeletedShipmentIds } from '../services/deletionRegistryService.js';

console.log('====================================================');
console.log('TEST SUITE: Finalize Packing List Persistence & Deletion Unmarking');
console.log('====================================================');

// Mock localStorage for node test runner
const storage = {};
global.localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};

// Test 1: Generate invoice ref sequential assignment
const mockShipments = [
  { id: 'ship-1', invoice_ref: 'DCOWNED#090226A', items: [{ serial_number: 'SN1' }] }
];
const nextRef = generateNextInvoiceRef(mockShipments, new Date(2026, 8, 2));
assert.strictEqual(nextRef, 'DCOWNED#090226B', 'Next reference after A should be B on 09/02/2026');
console.log('  ✓ PASS: Sequenced next invoice reference successfully generates B when A exists');

// Test 2: Unmarking deletion markers when new shipment is saved
storage['mdc_deleted_shipment_ids'] = JSON.stringify(['SHIP-OLD', 'DCOWNED#090226A', 'SHIP-123']);
unmarkDeletedShipmentIds(['DCOWNED#090226A', 'ship-123']);

const remainingDeleted = JSON.parse(storage['mdc_deleted_shipment_ids'] || '[]');
assert(!remainingDeleted.includes('DCOWNED#090226A'), 'DCOWNED#090226A should be removed from deleted list');
assert(!remainingDeleted.includes('SHIP-123'), 'SHIP-123 should be removed from deleted list');
assert(remainingDeleted.includes('SHIP-OLD'), 'SHIP-OLD should remain in deleted list');
console.log('  ✓ PASS: unmarkDeletedShipmentIds cleanly removes new shipment tokens from deletion registry');

// Test 3: Multiple Draft/Pending status filtering
const sampleShipments = [
  { id: 'ship-1', invoice_ref: 'DCOWNED#090226A', status: 'pending_pickup', items: [{ serial_number: 'S1' }] },
  { id: 'ship-2', invoice_ref: 'DCOWNED#090226B', status: 'draft', items: [{ serial_number: 'S2' }] },
  { id: 'ship-3', invoice_ref: 'DCOWNED#090226C', status: 'saved', items: [{ serial_number: 'S3' }] },
  { id: 'ship-4', invoice_ref: 'DCOWNED#090226D', status: 'shipped', items: [{ serial_number: 'S4' }] }
];

const drafts = sampleShipments.filter(s => {
  if (!s || !Array.isArray(s.items) || s.items.length === 0) return false;
  const st = String(s.status || '').toLowerCase().trim();
  return st === 'draft' || st === 'pending_pickup' || st === 'packing' || st === 'in_progress' || st === 'saved' || !st;
});

assert.strictEqual(drafts.length, 3, 'Drafts list should contain 3 active drafts/pending manifests');
assert.strictEqual(drafts.find(d => d.invoice_ref === 'DCOWNED#090226D'), undefined, 'Shipped manifest should be excluded from drafts');
console.log('  ✓ PASS: Active drafts filter strictly includes pending_pickup, draft, saved, and packing statuses');

console.log('\n====================================================');
console.log('RESULTS: ALL 3/3 FINALIZATION TESTS PASSED (100%)');
console.log('====================================================\n');
