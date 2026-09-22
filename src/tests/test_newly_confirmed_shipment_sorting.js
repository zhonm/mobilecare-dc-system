import assert from 'assert';
import {
  parseShipmentDate,
  sortShipmentsChronological,
  partitionShipmentsByRecency,
  isShipmentToday,
  isShipmentOlderArchive
} from '../utils/shipmentHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Newly Confirmed Shipments Sorting & Recency Verification');
console.log('====================================================\n');

// 1. Simulate the exact dataset from user screenshot:
// Cotabato (ASP COT) confirmed with TS 20227487, DCOWNED#091126I
// Alongside 5 other province shipments from same pickup run (2026-09-14) confirmed earlier on 2026-09-19
const cotabatoShipment = {
  id: 'shp-cotabato-20227487',
  invoice_ref: 'DCOWNED#091126I',
  shipment_number: 'DCOWNED#091126I',
  transfer_slip_number: '20227487',
  site_id: 'site-cot',
  site_name: 'ASP COT - MOBILECARE SERVICES',
  pickup_date: '2026-09-14',
  shipment_date: '2026-09-14',
  received_date: '2026-09-21',
  received_at: '2026-09-22T02:19:00.000Z',
  updated_at: '2026-09-22T02:19:00.000Z',
  status: 'received_confirmed',
  items: [{ serial_number: 'SN-COT-1' }, { serial_number: 'SN-COT-2' }, { serial_number: 'SN-COT-3' }, { serial_number: 'SN-COT-4' }]
};

const earlierConfirmedShipments = [
  {
    id: 'shp-ilo-20227501',
    invoice_ref: 'DCOWNED#091226I',
    transfer_slip_number: '20227501',
    site_name: 'ASP ILO',
    pickup_date: '2026-09-14',
    shipment_date: '2026-09-14',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z',
    status: 'received_confirmed',
    items: [{ serial_number: 'SN-ILO-1' }]
  },
  {
    id: 'shp-ceb-20227498',
    invoice_ref: 'DCOWNED#091226D',
    transfer_slip_number: '20227498',
    site_name: 'ASP CEB',
    pickup_date: '2026-09-14',
    shipment_date: '2026-09-14',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z',
    status: 'received_confirmed',
    items: [{ serial_number: 'SN-CEB-1' }]
  },
  {
    id: 'shp-abr-20227493',
    invoice_ref: 'DCOWNED#091226C',
    transfer_slip_number: '20227493',
    site_name: 'ASP ABR',
    pickup_date: '2026-09-14',
    shipment_date: '2026-09-14',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z',
    status: 'received_confirmed',
    items: [{ serial_number: 'SN-ABR-1' }]
  },
  {
    id: 'shp-npm-20227491',
    invoice_ref: 'DCOWNED#091226A',
    transfer_slip_number: '20227491',
    site_name: 'ASP NPM',
    pickup_date: '2026-09-14',
    shipment_date: '2026-09-14',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z',
    status: 'received_confirmed',
    items: [{ serial_number: 'SN-NPM-1' }]
  },
  {
    id: 'shp-lim-20227490',
    invoice_ref: 'DCOWNED#091126L',
    transfer_slip_number: '20227490',
    site_name: 'ASP LIM',
    pickup_date: '2026-09-14',
    shipment_date: '2026-09-14',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00.000Z',
    updated_at: '2026-09-19T08:00:00.000Z',
    status: 'received_confirmed',
    items: [{ serial_number: 'SN-LIM-1' }]
  }
];

// Historical shipments received in August/early September (older archive)
const olderHistoricalShipments = Array.from({ length: 19 }, (_, i) => ({
  id: `hist-${i}`,
  invoice_ref: `DCOWNED#090126${String.fromCharCode(65 + i)}`,
  site_name: `ASP HIST ${i}`,
  pickup_date: '2026-09-01',
  received_date: '2026-09-05',
  received_at: '2026-09-05T08:00:00.000Z',
  status: 'received_confirmed',
  items: [{ serial_number: `SN-H-${i}` }]
}));

const allReceivedList = [
  ...earlierConfirmedShipments,
  cotabatoShipment,
  ...olderHistoricalShipments
];

console.log('Test 1: parseShipmentDate prioritizes received_at / received_date for confirmed shipments');
const parsedCot = parseShipmentDate(cotabatoShipment);
assert.ok(parsedCot instanceof Date, 'Should return a valid Date object');
assert.strictEqual(parsedCot.getFullYear(), 2026);
assert.strictEqual(parsedCot.getMonth(), 8); // September
// It should parse received_at (Sep 22) or received_date (Sep 21), NOT pickup_date (Sep 14)
assert.ok(parsedCot.getDate() >= 21, `Date should be >= 21 (confirmation date), got: ${parsedCot.getDate()}`);
console.log(`  ✓ PASS: Cotabato parsed date is ${parsedCot.toISOString()} (reflects confirmation milestone)`);

console.log('\nTest 2: sortShipmentsChronological places newly confirmed Cotabato shipment at index 0');
const sorted = sortShipmentsChronological(allReceivedList, 'desc');
assert.strictEqual(sorted[0].id, cotabatoShipment.id, 'Cotabato MUST be the first (latest) shipment in sorted list');
assert.strictEqual(sorted[0].transfer_slip_number, '20227487', 'TS of first item must be 20227487');
console.log(`  ✓ PASS: sorted[0] is ${sorted[0].invoice_ref} (TS: ${sorted[0].transfer_slip_number})`);

console.log('\nTest 3: partitionShipmentsByRecency keeps newly confirmed Cotabato shipment in Recent Shipments');
const { recent, older } = partitionShipmentsByRecency(allReceivedList, 7, 5);
assert.ok(recent.some(s => s.id === cotabatoShipment.id), 'Cotabato MUST be in recent shipments');
assert.strictEqual(recent[0].id, cotabatoShipment.id, 'Cotabato MUST be the very first entry in recent shipments');
assert.ok(!older.some(s => s.id === cotabatoShipment.id), 'Cotabato MUST NOT be in older archive');
console.log(`  ✓ PASS: Cotabato is recent[0] out of ${recent.length} recent shipments, not in older archive (${older.length} older manifests)`);

console.log('\nTest 4: Tie-breaking when multiple shipments have the same received_date');
const sameDateEarlier = {
  id: 'shp-same-date-1',
  invoice_ref: 'DCOWNED#092226A',
  status: 'received_confirmed',
  received_date: '2026-09-22',
  received_at: '2026-09-22T08:00:00.000Z',
  updated_at: '2026-09-22T08:00:00.000Z',
  items: [{ serial_number: 'SN1' }]
};
const sameDateLater = {
  id: 'shp-same-date-2',
  invoice_ref: 'DCOWNED#092226B',
  status: 'received_confirmed',
  received_date: '2026-09-22',
  received_at: '2026-09-22T10:15:00.000Z',
  updated_at: '2026-09-22T10:15:00.000Z',
  items: [{ serial_number: 'SN2' }]
};
const tieBroken = sortShipmentsChronological([sameDateEarlier, sameDateLater], 'desc');
assert.strictEqual(tieBroken[0].id, sameDateLater.id, 'The one confirmed later in the day must be first');
console.log('  ✓ PASS: Tie-breaker sorts newly confirmed shipments above previously confirmed shipments on same date');

console.log('\nTest 5: Newly confirmed shipment is not classified as older archive');
const now = new Date('2026-09-22T10:20:00.000Z').getTime();
assert.strictEqual(isShipmentOlderArchive(cotabatoShipment, now, 7), false, 'Cotabato must not be older archive');
console.log('  ✓ PASS: isShipmentOlderArchive correctly returns false for newly confirmed shipment');

console.log('\n====================================================');
console.log('ALL NEWLY CONFIRMED SHIPMENTS SORTING TESTS PASSED (100%)');
console.log('====================================================');
