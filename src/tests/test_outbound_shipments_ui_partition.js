import assert from 'assert';
import {
  parseShipmentDate,
  sortShipmentsChronological,
  isShipmentOlderArchive,
  partitionShipmentsByRecency,
  isShipmentActive,
  isShipmentToday
} from '../utils/shipmentHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Outbound Shipments Sorting & Recency Partitioning');
console.log('====================================================\n');

// 1. Testing parseShipmentDate
console.log('Test 1: parseShipmentDate parsing precision');
const shExplicit1 = { pickup_date: '2026-09-12' };
const shExplicit2 = { shipment_date: '2026-09-10T14:30:00Z' };
const shRefCode1 = { invoice_ref: 'DCONWED#091226A' };
const shRefCode2 = { shipment_number: 'DCOWNED#083126E' };
const shNull = { invoice_ref: 'INVALID_REF' };

const date1 = parseShipmentDate(shExplicit1);
assert.strictEqual(date1.getFullYear(), 2026);
assert.strictEqual(date1.getMonth(), 8); // September is 8 (0-indexed)
assert.strictEqual(date1.getDate(), 12);

const date2 = parseShipmentDate(shExplicit2);
assert.strictEqual(date2.getFullYear(), 2026);
assert.strictEqual(date2.getMonth(), 8);

const dateRef1 = parseShipmentDate(shRefCode1);
assert.strictEqual(dateRef1.getFullYear(), 2026);
assert.strictEqual(dateRef1.getMonth(), 8);
assert.strictEqual(dateRef1.getDate(), 12);

const dateRef2 = parseShipmentDate(shRefCode2);
assert.strictEqual(dateRef2.getFullYear(), 2026);
assert.strictEqual(dateRef2.getMonth(), 7); // August is 7
assert.strictEqual(dateRef2.getDate(), 31);

assert.strictEqual(parseShipmentDate(shNull), null);
console.log('  ✓ PASS: parseShipmentDate parses explicit dates and MMDDYY invoice codes accurately.');

// 2. Testing sortShipmentsChronological (newest to oldest)
console.log('\nTest 2: sortShipmentsChronological ordering');
const mixedShipments = [
  { id: 's-aug31', invoice_ref: 'DCOWNED#083126A', status: 'received_confirmed' },
  { id: 's-sep12-pending', invoice_ref: 'DCONWED#091226I', status: 'pending_pickup' },
  { id: 's-sep03', invoice_ref: 'DCOWNED#090326A', status: 'received_confirmed' },
  { id: 's-sep11', invoice_ref: 'DCONWED#091126C', status: 'received_confirmed' },
  { id: 's-sep12-draft', invoice_ref: 'DCONWED#091226A', status: 'draft' }
];

const sorted = sortShipmentsChronological(mixedShipments, 'desc');
assert.strictEqual(sorted[0].invoice_ref.includes('091226'), true, 'First must be Sep 12');
assert.strictEqual(sorted[1].invoice_ref.includes('091226'), true, 'Second must be Sep 12');
assert.strictEqual(sorted[2].invoice_ref, 'DCONWED#091126C', 'Third must be Sep 11');
assert.strictEqual(sorted[3].invoice_ref, 'DCOWNED#090326A', 'Fourth must be Sep 03');
assert.strictEqual(sorted[4].invoice_ref, 'DCOWNED#083126A', 'Fifth must be Aug 31');
console.log('  ✓ PASS: sortShipmentsChronological properly places newest manifests first.');

// 3. Testing isShipmentOlderArchive
console.log('\nTest 3: isShipmentOlderArchive classification');
const refTime = new Date('2026-09-13T12:00:00Z').getTime();

// Pending dispatch from 14 days ago must NEVER be classified as older archive (because it is ACTIVE)
const oldPending = {
  id: 's-old-pending',
  invoice_ref: 'DCONWED#082026A',
  status: 'pending_pickup',
  items: [{ serial_number: 'SN1' }]
};
assert.strictEqual(isShipmentActive(oldPending), true);
assert.strictEqual(isShipmentOlderArchive(oldPending, refTime, 7), false, 'Active pending shipment must NEVER be older archive');

// Received shipment from Aug 31 is 13 days old -> MUST be older archive
const oldReceived = {
  id: 's-old-received',
  invoice_ref: 'DCOWNED#083126A',
  status: 'received_confirmed',
  items: [{ serial_number: 'SN2' }]
};
assert.strictEqual(isShipmentOlderArchive(oldReceived, refTime, 7), true, 'Aug 31 received shipment must be older archive');

// Received shipment from Sep 11 is 2 days old -> MUST NOT be older archive
const recentReceived = {
  id: 's-recent-received',
  invoice_ref: 'DCONWED#091126C',
  status: 'received_confirmed',
  items: [{ serial_number: 'SN3' }]
};
assert.strictEqual(isShipmentOlderArchive(recentReceived, refTime, 7), false, 'Sep 11 received shipment is recent');
console.log('  ✓ PASS: isShipmentOlderArchive preserves active manifests and correctly isolates older completed records.');

// 4. Testing partitionShipmentsByRecency on simulated 39-manifest dataset
console.log('\nTest 4: partitionShipmentsByRecency on real-world sample dataset');
const dataset = [
  // 14 Pending manifests from Sep 11 & Sep 12
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `pending-${i}`,
    invoice_ref: `DCONWED#091226${String.fromCharCode(65 + i)}`,
    status: 'pending_pickup',
    items: [{ serial_number: `SN-P-${i}` }]
  })),
  // 5 Recent received manifests from Sep 10-12
  { id: 'rec-1', invoice_ref: 'DCONWED#091226Z', status: 'received_confirmed', items: [{ serial_number: 'SN-R1' }] },
  { id: 'rec-2', invoice_ref: 'DCONWED#091126Y', status: 'received_confirmed', items: [{ serial_number: 'SN-R2' }] },
  { id: 'rec-3', invoice_ref: 'DCONWED#091126X', status: 'received_confirmed', items: [{ serial_number: 'SN-R3' }] },
  { id: 'rec-4', invoice_ref: 'DCONWED#091026W', status: 'received_confirmed', items: [{ serial_number: 'SN-R4' }] },
  { id: 'rec-5', invoice_ref: 'DCONWED#091026V', status: 'received_confirmed', items: [{ serial_number: 'SN-R5' }] },
  // 20 Older received manifests from Aug 31 - Sep 3
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `older-${i}`,
    invoice_ref: `DCOWNED#083126${String.fromCharCode(65 + (i % 26))}`,
    status: 'received_confirmed',
    items: [{ serial_number: `SN-O-${i}` }]
  }))
];

assert.strictEqual(dataset.length, 39, 'Total test dataset should be 39 manifests');

const partitioned = partitionShipmentsByRecency(dataset, 7);
assert.strictEqual(partitioned.totalCount, 39);
assert.strictEqual(partitioned.recentCount, 19, 'Recent should contain 14 pending + 5 recent received = 19');
assert.strictEqual(partitioned.olderCount, 20, 'Older should contain 20 older manifests');

// Verify all 14 pending are in recent
const pendingInRecent = partitioned.recent.filter(s => s.status === 'pending_pickup');
assert.strictEqual(pendingInRecent.length, 14, 'All 14 pending manifests must be in recent');

// Verify older manifests are all received
const allOlderAreReceived = partitioned.older.every(s => s.status === 'received_confirmed');
assert.strictEqual(allOlderAreReceived, true, 'All older shipments must be received confirmed');

console.log('  ✓ PASS: partitionShipmentsByRecency splits 39 manifests cleanly: 19 recent/active and 20 in older archive.');

// 5. Testing isShipmentToday
console.log('\nTest 5: isShipmentToday daily throughput detection');
const testTodayRef = new Date('2026-09-13T10:00:00Z');
assert.strictEqual(isShipmentToday({ shipment_date: '2026-09-13' }, testTodayRef), true, 'Date string 2026-09-13 matches');
assert.strictEqual(isShipmentToday({ created_at: '2026-09-13T06:30:00Z' }, testTodayRef), true, 'ISO timestamp matches');
assert.strictEqual(isShipmentToday({ invoice_ref: 'DCONWED#091326A' }, testTodayRef), true, 'Invoice code 091326 matches');
assert.strictEqual(isShipmentToday({ shipment_date: '2026-09-12' }, testTodayRef), false, 'Yesterday does not match today');
assert.strictEqual(isShipmentToday({ invoice_ref: 'DCOWNED#083126A' }, testTodayRef), false, 'Aug 31 does not match today');
assert.strictEqual(isShipmentToday(null, testTodayRef), false, 'Null shipment safely returns false');
console.log('  ✓ PASS: isShipmentToday accurately identifies daily dispatches.');

console.log('\n====================================================');
console.log('ALL OUTBOUND SHIPMENTS PARTITIONING TESTS PASSED (100%)');
console.log('====================================================');

