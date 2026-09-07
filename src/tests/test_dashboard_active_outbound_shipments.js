import assert from 'assert';
import {
  isShipmentReceived,
  isShipmentActive,
  filterActiveOutboundShipments,
  calculateActiveQueuePartsCount
} from '../utils/shipmentHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Dashboard Dynamic Outbound Shipments Display');
console.log('====================================================\n');

// 1. Test isShipmentReceived & isShipmentActive classification
console.log('1. Testing status classification...');
const received1 = { id: 's1', status: 'received_confirmed', items: [{ serial_number: 'SN1' }] };
const received2 = { id: 's2', status: 'Delivered', items: [{ serial_number: 'SN2' }] };
const received3 = { id: 's3', status: 'received', items: [{ serial_number: 'SN3' }] };
const received4 = { id: 's4', status: 'completed', items: [{ serial_number: 'SN4' }] };
const received5 = { id: 's5', status: 'pending_pickup', received_confirmed_at: '2026-09-07T10:00:00Z', items: [{ serial_number: 'SN5' }] };

const shipped1 = { id: 's6', status: 'shipped', items: [{ serial_number: 'SN6' }] };
const shipped2 = { id: 's7', status: 'in_transit', items: [{ serial_number: 'SN7' }] };
const pending1 = { id: 's8', status: 'pending_pickup', items: [{ serial_number: 'SN8' }] };
const pending2 = { id: 's9', status: 'pending', items: [{ serial_number: 'SN9' }] };
const draft1 = { id: 's10', status: 'draft', items: [{ serial_number: 'SN10' }] };
const cancelled = { id: 's11', status: 'cancelled', items: [{ serial_number: 'SN11' }] };
const emptyShipped = { id: 's12', status: 'shipped', items: [] };

assert.strictEqual(isShipmentReceived(received1), true, 'received_confirmed is received');
assert.strictEqual(isShipmentReceived(received2), true, 'Delivered is received');
assert.strictEqual(isShipmentReceived(received3), true, 'received is received');
assert.strictEqual(isShipmentReceived(received4), true, 'completed is received');
assert.strictEqual(isShipmentReceived(received5), true, 'received_confirmed_at makes it received');
assert.strictEqual(isShipmentReceived(shipped1), false, 'shipped is not received');
assert.strictEqual(isShipmentReceived(pending1), false, 'pending_pickup is not received');

assert.strictEqual(isShipmentActive(received1), false, 'received1 must not be active');
assert.strictEqual(isShipmentActive(shipped1), true, 'shipped1 must be active');
assert.strictEqual(isShipmentActive(shipped2), true, 'shipped2 in_transit must be active');
assert.strictEqual(isShipmentActive(pending1), true, 'pending1 must be active');
assert.strictEqual(isShipmentActive(pending2), true, 'pending2 must be active');
assert.strictEqual(isShipmentActive(draft1), true, 'draft1 must be active');
assert.strictEqual(isShipmentActive(cancelled), false, 'cancelled must not be active');
assert.strictEqual(isShipmentActive(emptyShipped), false, 'empty shipment must not be active');
console.log('✓ Status classification verified successfully.');

// 2. Test filterActiveOutboundShipments on user screenshot dataset (10 manifests: 9 received, 1 in transit)
console.log('\n2. Testing user dataset filtering (10 manifests total, 9 received, 1 in transit)...');
const datasetShipments = [
  // 9 Received manifests (total 51 units)
  { id: 'm1', invoice_ref: 'DCOWNED#090326A', status: 'received_confirmed', items: new Array(4).fill({ serial_number: 'SN-M1' }) },
  { id: 'm2', invoice_ref: 'DCOWNED#090226B', status: 'received_confirmed', items: new Array(5).fill({ serial_number: 'SN-M2' }) },
  { id: 'm3', invoice_ref: 'DCOWNED#090226C', status: 'received_confirmed', items: new Array(6).fill({ serial_number: 'SN-M3' }) },
  { id: 'm4', invoice_ref: 'DCOWNED#090126D', status: 'received_confirmed', items: new Array(7).fill({ serial_number: 'SN-M4' }) },
  { id: 'm5', invoice_ref: 'DCOWNED#090126E', status: 'received_confirmed', items: new Array(4).fill({ serial_number: 'SN-M5' }) },
  { id: 'm6', invoice_ref: 'DCOWNED#083126F', status: 'received_confirmed', items: new Array(8).fill({ serial_number: 'SN-M6' }) },
  { id: 'm7', invoice_ref: 'DCOWNED#083126G', status: 'received_confirmed', items: new Array(9).fill({ serial_number: 'SN-M7' }) },
  { id: 'm8', invoice_ref: 'DCOWNED#083126H', status: 'received_confirmed', items: new Array(5).fill({ serial_number: 'SN-M8' }) },
  { id: 'm9', invoice_ref: 'DCOWNED#083126I', status: 'received_confirmed', items: new Array(3).fill({ serial_number: 'SN-M9' }) },
  // 1 Active Shipped manifest (ASP ZAM, 3 units)
  {
    id: 'm10',
    invoice_ref: 'DICNMED083126E',
    site_name: 'MOBILECARE - ZAMBOANGA',
    status: 'shipped',
    items: [
      { serial_number: 'G9QHTUY0CY200004Y1', part_number: '661-44797' },
      { serial_number: 'GVH54810T98PR5PA2', part_number: '661-21988' },
      { serial_number: 'G9PHNTT172200005D3', part_number: '661-44955' }
    ]
  }
];

const active = filterActiveOutboundShipments(datasetShipments);
assert.strictEqual(active.length, 1, 'Active shipments must be exactly 1 (only the shipped ASP ZAM manifest)');
assert.strictEqual(active[0].invoice_ref, 'DICNMED083126E', 'Active shipment must be ASP ZAM');

const partsInQueue = calculateActiveQueuePartsCount(null, active);
assert.strictEqual(partsInQueue, 3, 'Parts in queue must be exactly 3 parts from the active shipment, NOT 54');
console.log('✓ Active shipments count = 1, Parts in queue = 3 (Received 51 parts successfully excluded).');

// 3. Test active draft inclusion in parts in queue
console.log('\n3. Testing active draft inclusion in parts in queue...');
const mockDraft = {
  items: [
    { serial_number: 'DRAFT-SN-1' },
    { serial_number: 'DRAFT-SN-2' }
  ]
};
const partsWithDraft = calculateActiveQueuePartsCount(mockDraft, active);
assert.strictEqual(partsWithDraft, 5, 'Parts in queue with 2 draft parts + 3 shipped parts must equal 5');
console.log('✓ Active draft + active shipments parts count verified.');

// 4. Test dynamic status update when shipped manifest is received
console.log('\n4. Testing dynamic transition when last shipment is received...');
const allReceivedShipments = datasetShipments.map(s => {
  if (s.id === 'm10') return { ...s, status: 'received_confirmed', received_at: '2026-09-07T14:00:00Z' };
  return s;
});

const activeAfterReceive = filterActiveOutboundShipments(allReceivedShipments);
assert.strictEqual(activeAfterReceive.length, 0, 'Active shipments count must be 0 once all manifests are received');
const queueAfterReceive = calculateActiveQueuePartsCount(null, activeAfterReceive);
assert.strictEqual(queueAfterReceive, 0, 'Parts in queue must be 0 once all manifests are received');
console.log('✓ Dynamic transition to 0 shipments and 0 parts in queue verified.');

console.log('\n====================================================');
console.log('ALL DASHBOARD OUTBOUND SHIPMENTS TESTS PASSED (100%)');
console.log('====================================================');
