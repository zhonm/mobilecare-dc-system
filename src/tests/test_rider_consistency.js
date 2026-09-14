import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getShipmentRiderName } from '../utils/shipmentHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: Rider Consistency Across Views');
console.log('====================================================');

// Test 1: Direct pickup_by_name resolution
const s1 = {
  id: 's1',
  invoice_ref: 'DCOWNED#091226H',
  carrier: 'Lite Express',
  pickup_by_name: 'Chrysnell Jon Hernandez'
};
assert.strictEqual(getShipmentRiderName(s1), 'Chrysnell Jon Hernandez');
console.log('  ✓ PASS: getShipmentRiderName resolves direct pickup_by_name');

// Test 2: courier_name fallback when pickup_by_name is missing (DCOWNED#091226G issue)
const s2 = {
  id: 's2',
  invoice_ref: 'DCOWNED#091226G',
  carrier: 'Lite Express (Air)',
  courier_name: 'Chrysnell Jon Hernandez',
  pickup_by_name: null
};
assert.strictEqual(getShipmentRiderName(s2), 'Chrysnell Jon Hernandez');
console.log('  ✓ PASS: getShipmentRiderName resolves courier_name when pickup_by_name is missing (DCOWNED#091226G)');

// Test 3: Filters out carrier name or generic placeholder
const s3 = {
  id: 's3',
  invoice_ref: 'DCOWNED#091226X',
  carrier: 'Lite Express',
  courier_name: 'Lite Express',
  pickup_by_name: 'Assigned Rider'
};
assert.strictEqual(getShipmentRiderName(s3), '');
console.log('  ✓ PASS: getShipmentRiderName ignores company name and generic placeholders');

// Test 4: Sibling fallback by tracking number or transfer slip
const sisterShipments = [
  {
    id: 's-parent',
    invoice_ref: 'DCOWNED#091226H',
    tracking_number: '4548396878387',
    transfer_slip_number: '20227500',
    pickup_by_name: 'Chrysnell Jon Hernandez'
  },
  {
    id: 's-child',
    invoice_ref: 'DCOWNED#091226I',
    tracking_number: '4548396878387',
    transfer_slip_number: '20227500',
    pickup_by_name: null,
    courier_name: null
  }
];
assert.strictEqual(getShipmentRiderName(sisterShipments[1], sisterShipments), 'Chrysnell Jon Hernandez');
console.log('  ✓ PASS: getShipmentRiderName inherits rider from sibling shipment in same dispatch batch');

// Test 5: Verify Shipments.jsx uses getShipmentRiderName in main view and Details modal
const shipmentsFile = fs.readFileSync(path.join(__dirname, '../components/Shipments.jsx'), 'utf8');
assert(shipmentsFile.includes('getShipmentRiderName(sh, shipments)'), 'Main view table row must use getShipmentRiderName');
assert(shipmentsFile.includes('getShipmentRiderName(viewPackageModalState.shipment, shipments)'), 'Details modal must use getShipmentRiderName');
console.log('  ✓ PASS: Shipments.jsx consistently uses getShipmentRiderName in both main table and details modal');

// Test 6: Verify ScanOutPacking.jsx and useCloudSync.js preserve courier_name and pickup_by_name
const cloudSyncFile = fs.readFileSync(path.join(__dirname, '../context/useCloudSync.js'), 'utf8');
assert(cloudSyncFile.includes('resolvedPickupByName'), 'useCloudSync must preserve resolvedPickupByName');
assert(cloudSyncFile.includes('resolvedCourierName'), 'useCloudSync must preserve resolvedCourierName');

const scanOutFile = fs.readFileSync(path.join(__dirname, '../components/ScanOutPacking.jsx'), 'utf8');
assert(scanOutFile.includes('s.pickup_by_name || s.courier_name'), 'ScanOutPacking must display rider from both fields');
console.log('  ✓ PASS: Cloud sync and Scan-Out preserve rider details bidirectionally');

console.log('====================================================');
console.log('ALL RIDER CONSISTENCY TESTS PASSED (6/6)');
console.log('====================================================');
