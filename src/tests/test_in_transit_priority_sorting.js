import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  partitionShipmentsByRecency
} from '../utils/shipmentHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: In-Transit Packages Priority Sorting at Top');
console.log('====================================================\n');

// 1. Recreate the exact dataset from user screenshot:
// 3 In-Transit packages (picked up 2026-09-14)
// 5 Recent Received Confirmed packages (confirmed between 2026-09-17 and 2026-09-23)
const inTransitDavao = {
  id: 'shp-abr-in-transit',
  invoice_ref: 'DCOWNED#091226B',
  site_name: 'ASP ABR - MOBILECARE - DAVAO',
  status: 'shipped',
  pickup_date: '2026-09-14',
  shipment_date: '2026-09-14',
  tracking_number: '5483 9687 8386',
  items: [{ serial_number: 'SN-ABR-1' }, { serial_number: 'SN-ABR-2' }]
};

const inTransitCDO = {
  id: 'shp-cdo-in-transit',
  invoice_ref: 'DCOWNED#091226D',
  site_name: 'ASP CDO - MOBILECARE - CAGAYAN DE ORO',
  status: 'shipped',
  pickup_date: '2026-09-14',
  shipment_date: '2026-09-14',
  tracking_number: '5483 9687 8388',
  items: [{ serial_number: 'SN-CDO-1' }]
};

const inTransitCebu = {
  id: 'shp-ceb-in-transit',
  invoice_ref: 'DCOWNED#091226F',
  site_name: 'ASP CEB - MOBILECARE - CEBU',
  status: 'shipped',
  pickup_date: '2026-09-14',
  shipment_date: '2026-09-14',
  tracking_number: '5483 9687 8385',
  items: [{ serial_number: 'SN-CEB-1' }]
};

const completedShipments = [
  {
    id: 'shp-cdo-recv',
    invoice_ref: 'DCOWNED#091226E',
    site_name: 'ASP CDO',
    status: 'received_confirmed',
    pickup_date: '2026-09-14',
    received_date: '2026-09-17',
    received_at: '2026-09-17T10:00:00Z',
    items: [{ serial_number: 'SN-R1' }]
  },
  {
    id: 'shp-zam-recv',
    invoice_ref: 'DCOWNED#091126H',
    site_name: 'ASP ZAM',
    status: 'received_confirmed',
    pickup_date: '2026-09-14',
    received_date: '2026-09-23',
    received_at: '2026-09-23T11:00:00Z',
    items: [{ serial_number: 'SN-R2' }]
  },
  {
    id: 'shp-ilo-recv',
    invoice_ref: 'DCOWNED#091226W',
    site_name: 'ASP ILO',
    status: 'received_confirmed',
    pickup_date: '2026-09-14',
    received_date: '2026-09-22',
    received_at: '2026-09-22T09:00:00Z',
    items: [{ serial_number: 'SN-R3' }]
  },
  {
    id: 'shp-cot-recv',
    invoice_ref: 'DCOWNED#091126I',
    site_name: 'ASP COT',
    status: 'received_confirmed',
    pickup_date: '2026-09-14',
    received_date: '2026-09-21',
    received_at: '2026-09-21T08:00:00Z',
    items: [{ serial_number: 'SN-R4' }]
  },
  {
    id: 'shp-lau-recv',
    invoice_ref: 'DCOWNED#091126K',
    site_name: 'ASP LAU',
    status: 'received_confirmed',
    pickup_date: '2026-09-14',
    received_date: '2026-09-19',
    received_at: '2026-09-19T14:00:00Z',
    items: [{ serial_number: 'SN-R5' }]
  }
];

const fullTestDataset = [
  ...completedShipments,
  inTransitDavao,
  inTransitCDO,
  inTransitCebu
];

// Test 1: partitionShipmentsByRecency puts all 3 In-Transit packages at the top
console.log('Test 1: partitionShipmentsByRecency places all In-Transit packages at indices 0, 1, 2');
const partitioned = partitionShipmentsByRecency(fullTestDataset, 7, 5);
const recent = partitioned.recent;

assert.strictEqual(recent.length, 8, 'Recent must contain 3 in-transit + 5 completed = 8 manifests');
assert.strictEqual(recent[0].status, 'shipped', 'Row 1 must be In-Transit (shipped)');
assert.strictEqual(recent[1].status, 'shipped', 'Row 2 must be In-Transit (shipped)');
assert.strictEqual(recent[2].status, 'shipped', 'Row 3 must be In-Transit (shipped)');

const topThreeIds = [recent[0].id, recent[1].id, recent[2].id];
assert.ok(topThreeIds.includes('shp-abr-in-transit'), 'Davao in-transit must be in top 3');
assert.ok(topThreeIds.includes('shp-cdo-in-transit'), 'CDO in-transit must be in top 3');
assert.ok(topThreeIds.includes('shp-ceb-in-transit'), 'Cebu in-transit must be in top 3');

console.log('  ✓ PASS: partitionShipmentsByRecency strictly prioritizes In-Transit at top');

// Test 2: Following completed shipments are properly preserved
console.log('\nTest 2: Completed shipments correctly appear below In-Transit packages');
for (let i = 3; i < recent.length; i++) {
  assert.strictEqual(recent[i].status, 'received_confirmed', `Row ${i + 1} must be completed shipment`);
}
console.log('  ✓ PASS: Completed shipments follow cleanly after all In-Transit packages');

// Test 3: Shipments.jsx source code verification
console.log('\nTest 3: Shipments.jsx filteredShipments explicitly groups In-Transit packages at top');
const shipmentsFile = fs.readFileSync(path.join(__dirname, '../components/Shipments.jsx'), 'utf8');
assert.ok(
  shipmentsFile.includes("const inTransit = [];") &&
  shipmentsFile.includes("norm === 'shipped'") &&
  shipmentsFile.includes("return [...inTransit, ...otherActive, ...completed];"),
  'Shipments.jsx must explicitly partition filteredShipments with inTransit at top'
);
console.log('  ✓ PASS: Shipments.jsx explicitly prioritizes In-Transit packages at the top');

console.log('\n====================================================');
console.log('ALL IN-TRANSIT PRIORITY SORTING TESTS PASSED (100%)');
console.log('====================================================');
