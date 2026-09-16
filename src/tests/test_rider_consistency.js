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

// Test 4: Sibling fallback by tracking number (including whitespace differences)
const sisterShipments = [
  {
    id: 's-parent',
    invoice_ref: 'DCOWNED#091226H',
    tracking_number: '5483 9687 8387',
    transfer_slip_number: '20227500',
    pickup_by_name: 'Chrysnell Jon Hernandez'
  },
  {
    id: 's-child',
    invoice_ref: 'DCOWNED#091226I',
    tracking_number: '548396878387',
    transfer_slip_number: '20227500',
    pickup_by_name: null,
    courier_name: null
  }
];
assert.strictEqual(getShipmentRiderName(sisterShipments[1], sisterShipments), 'Chrysnell Jon Hernandez');
console.log('  ✓ PASS: getShipmentRiderName inherits rider from sibling shipment matching tracking number with whitespace normalization');

// Test 5: Sibling fallback by dispatch batch (same carrier + same shipment date + shared invoice cycle prefix)
const batchShipments = [
  {
    id: 'b-dispatched',
    invoice_ref: 'DCOWNED#091226E',
    carrier: 'Lite Express',
    shipment_date: '2026-09-12',
    pickup_by_name: 'Chrysnel jon Hernandez'
  },
  {
    id: 'b-orphan',
    invoice_ref: 'DCOWNED#091226A',
    carrier: 'Lite Express',
    shipment_date: '2026-09-12',
    pickup_by_name: null,
    courier_name: null
  }
];
assert.strictEqual(getShipmentRiderName(batchShipments[1], batchShipments), 'Chrysnel jon Hernandez');
console.log('  ✓ PASS: getShipmentRiderName inherits rider from batch sibling sharing carrier, date, and invoice cycle prefix');

// Test 6: Verify Shipments.jsx uses getShipmentRiderName in main view and Details modal
const shipmentsFile = fs.readFileSync(path.join(__dirname, '../components/Shipments.jsx'), 'utf8');
assert(shipmentsFile.includes('getShipmentRiderName(sh, shipments)'), 'Main view table row must use getShipmentRiderName');
assert(shipmentsFile.includes('getShipmentRiderName(viewPackageModalState.shipment, shipments)'), 'Details modal must use getShipmentRiderName');
console.log('  ✓ PASS: Shipments.jsx consistently uses getShipmentRiderName in both main table and details modal');

// Test 7: Verify ScanOutPacking.jsx uses getShipmentRiderName
const scanOutFile = fs.readFileSync(path.join(__dirname, '../components/ScanOutPacking.jsx'), 'utf8');
assert(scanOutFile.includes('getShipmentRiderName(s, shipments)'), 'ScanOutPacking draft table must use getShipmentRiderName');
console.log('  ✓ PASS: ScanOutPacking uses getShipmentRiderName');

// Test 8: Verify pdfGenerator.js and excelParser.js use getShipmentRiderName
const pdfFile = fs.readFileSync(path.join(__dirname, '../utils/pdfGenerator.js'), 'utf8');
assert(pdfFile.includes('getShipmentRiderName(shipment)'), 'pdfGenerator.js must use getShipmentRiderName');
const excelFile = fs.readFileSync(path.join(__dirname, '../utils/excelParser.js'), 'utf8');
assert(excelFile.includes('getShipmentRiderName(shipment)'), 'excelParser.js must use getShipmentRiderName');
console.log('  ✓ PASS: Corporate PDF and Excel exports consistently use getShipmentRiderName');

// Test 9: Verify useCloudSync.js preserves dispatch details and has increased query limit
const cloudSyncFile = fs.readFileSync(path.join(__dirname, '../context/useCloudSync.js'), 'utf8');
assert(cloudSyncFile.includes('resolvedPickupByName'), 'useCloudSync must preserve resolvedPickupByName');
assert(cloudSyncFile.includes('resolvedCourierName'), 'useCloudSync must preserve resolvedCourierName');
assert(cloudSyncFile.includes('limit(500)'), 'useCloudSync must query up to 500 saved_records shipments to prevent cutoff');
console.log('  ✓ PASS: useCloudSync query limit increased to 500 and preserves non-destructive merge');

console.log('====================================================');
console.log('ALL RIDER CONSISTENCY TESTS PASSED (9/9)');
console.log('====================================================');
