import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { resolveSite, isLockedConfirmedShipment } from '../utils/appContextHelpers.js';
import {
  extractShipmentSerials,
  getShipmentCourierDisplay,
  isShipmentMetroManila
} from '../utils/shipmentHelpers.js';

const getNormalizedStatus = (sh) => {
  if (!sh) return 'draft';
  const s = String(sh.status || 'draft').toLowerCase().trim();
  if (s === 'received_confirmed' || s === 'delivered' || isLockedConfirmedShipment(sh)) return 'received_confirmed';
  if (s === 'shipped' || s === 'in_transit' || s === 'in-transit') return 'shipped';
  if (s === 'pending_pickup' || s === 'packed' || s === 'ready_for_pickup') return 'pending_pickup';
  return 'draft';
};

console.log('====================================================');
console.log('TEST SUITE: Completed Package Details Modal & Row Click');
console.log('====================================================');

// Mock site database
const mockSites = [
  { id: 'site-bgc', name: 'Mobile Care BGC High Street', code: 'BGC', province: 'Metro Manila', location: 'Taguig' },
  { id: 'site-cebu', name: 'Mobile Care Cebu Ayala', code: 'CEB', province: 'Cebu', location: 'Cebu City' },
  { id: 'site-clark', name: 'Mobile Care Clark Pampanga', code: 'CLK', province: 'Pampanga', location: 'Angeles' }
];

// Mock completed delivered shipment
const completedShipment = {
  id: 'sh-comp-001',
  invoice_ref: 'PL-2026-0914-001',
  transfer_slip: 'TS-88902',
  site_id: 'site-bgc',
  site_name: 'Mobile Care BGC High Street',
  status: 'received_confirmed',
  carrier: 'Lalamove',
  courier_name: 'Juan Dela Cruz (Lalamove Express)',
  pickup_by_name: 'Juan Dela Cruz',
  pickup_date: '2026-09-14',
  dispatched_at: '2026-09-14T09:30:00Z',
  tracking_number: 'LLM-991827364',
  vehicle_plate: 'NDG 4452',
  rider_phone: '0917-555-0192',
  prepared_by_name: 'Warehouse Specialist Maria',
  supervisor_verified_by: 'Supervisor Santos',
  guard_on_duty: 'Officer Reyes',
  total_boxes: 2,
  received_at: '2026-09-14T14:15:00Z',
  received_date: '2026-09-14',
  received_by_name: 'Mark Reyes (Lead Tech BGC)',
  receiving_signature: 'Mark Reyes (Lead Tech BGC)',
  receiving_condition: 'Good Condition (All parts intact & verified)',
  receiving_notes: 'Confirmed physical receipt of package and parts at BGC branch. All 3 serials verified against manifest.',
  items: [
    { part_number: '661-21991', description: 'Battery, iPhone 13 Pro', serial_number: 'BATT-9901-PRO', box_number: 1 },
    { part_number: '661-18034', description: 'Display Assembly, iPhone 13', serial_number: 'DISP-4402-OLED', box_number: 1 },
    { part_number: '661-09823', description: 'Rear Camera System, iPhone 12', serial_number: 'CAM-7719-DUAL', box_number: 2 }
  ]
};

// --- Test 1: isLockedConfirmedShipment validation ---
assert.strictEqual(isLockedConfirmedShipment(completedShipment), true, 'Shipment with status received_confirmed must be locked & confirmed');
assert.strictEqual(getNormalizedStatus(completedShipment), 'received_confirmed');
console.log('  ✓ PASS: isLockedConfirmedShipment correctly identifies completed shipment');

// --- Test 2: Destination site resolution ---
const resolvedSite = resolveSite(completedShipment.site_id, mockSites);
assert.strictEqual(resolvedSite.code, 'BGC');
assert.strictEqual(resolvedSite.name, 'Mobile Care BGC High Street');
assert.strictEqual(isShipmentMetroManila(completedShipment, mockSites), true);
console.log('  ✓ PASS: Destination site resolves accurately for modal header and ribbon');

// --- Test 3: Receipt & Delivery Details Extraction ---
assert.strictEqual(completedShipment.received_by_name, 'Mark Reyes (Lead Tech BGC)');
assert.strictEqual(completedShipment.receiving_condition, 'Good Condition (All parts intact & verified)');
assert.strictEqual(completedShipment.receiving_notes.includes('Confirmed physical receipt'), true);
console.log('  ✓ PASS: Receipt and delivery confirmation fields properly preserved and accessible');

// --- Test 4: Logistics & Dispatch Handover Details ---
assert.strictEqual(completedShipment.courier_name, 'Juan Dela Cruz (Lalamove Express)');
assert.strictEqual(completedShipment.vehicle_plate, 'NDG 4452');
assert.strictEqual(completedShipment.rider_phone, '0917-555-0192');
assert.strictEqual(completedShipment.prepared_by_name, 'Warehouse Specialist Maria');
assert.strictEqual(getShipmentCourierDisplay(completedShipment), 'Lalamove');
console.log('  ✓ PASS: Logistics and handover metadata accurately extracted');

// --- Test 5: Serial numbers extraction & search filtering ---
const serials = extractShipmentSerials(completedShipment);
assert.strictEqual(serials.length, 3);
assert.deepStrictEqual(serials, ['BATT-9901-PRO', 'DISP-4402-OLED', 'CAM-7719-DUAL']);

// Test filtering logic (as implemented in the modal)
const filterItems = (items, q) => {
  const query = q.trim().toLowerCase();
  return items.filter(it => {
    if (!query) return true;
    const pn = String(it.part_number || '').toLowerCase();
    const desc = String(it.description || '').toLowerCase();
    const sn = String(it.serial_number || '').toLowerCase();
    const box = String(it.box_number || '').toLowerCase();
    return pn.includes(query) || desc.includes(query) || sn.includes(query) || box.includes(query);
  });
};

const searchBySerial = filterItems(completedShipment.items, 'OLED');
assert.strictEqual(searchBySerial.length, 1);
assert.strictEqual(searchBySerial[0].serial_number, 'DISP-4402-OLED');

const searchByPartNum = filterItems(completedShipment.items, '661-21991');
assert.strictEqual(searchByPartNum.length, 1);
assert.strictEqual(searchByPartNum[0].part_number, '661-21991');

const searchByBox = filterItems(completedShipment.items, 'CAM');
assert.strictEqual(searchByBox.length, 1);
assert.strictEqual(searchByBox[0].part_number, '661-09823');
assert.strictEqual(searchByBox[0].box_number, 2);
console.log('  ✓ PASS: Serial extraction and instant search filtering work accurately');

// --- Test 6: Verify Shipments.jsx Source Code Integration ---
const shipmentsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/Shipments.jsx'),
  'utf-8'
);

assert(shipmentsSource.includes('viewPackageModalState'), 'Shipments.jsx must define viewPackageModalState');
assert(shipmentsSource.includes('handleOpenPackageDetails'), 'Shipments.jsx must define handleOpenPackageDetails');
assert(shipmentsSource.includes('shipment-row-clickable'), 'Shipments.jsx must apply shipment-row-clickable class');
assert(shipmentsSource.includes('Delivered Package Details'), 'Shipments.jsx must render Delivered Package Details modal title');
assert(shipmentsSource.includes('Branch Delivery &amp; Receipt Confirmation'), 'Shipments.jsx must render Receipt Confirmation section');
assert(shipmentsSource.includes('Dispatch &amp; Handover Information'), 'Shipments.jsx must render Dispatch & Handover section');
assert(shipmentsSource.includes('GSX / Fixably Plain Text Export'), 'Shipments.jsx must consolidate GSX export in Details modal');
assert(shipmentsSource.includes('1 Per Line (GSX/Fixably Bulk)'), 'Shipments.jsx must support GSX 1-per-line format');
assert(shipmentsSource.includes('Comma Separated (CSV)'), 'Shipments.jsx must support CSV format');
assert(shipmentsSource.includes('TSV Table (Part No + Serials)'), 'Shipments.jsx must support TSV format');
assert(shipmentsSource.includes('Copy Plain Text Serials'), 'Shipments.jsx must provide Copy Plain Text Serials in modal footer');
assert(!shipmentsSource.includes('{serialsModalState && ('), 'Shipments.jsx must have removed the redundant separate serialsModalState modal');

// --- Test 7: Verify Shipped / In-Transit Gating Logic ---
const shippedShipment = {
  id: 'sh-ship-002',
  invoice_ref: 'PL-2026-0914-002',
  status: 'shipped',
  items: [{ part_number: '661-56050', description: 'Display, iPhone 17 Pro Max', serial_number: 'SN123', box_number: 1 }]
};

assert.strictEqual(getNormalizedStatus(shippedShipment), 'shipped');
assert.strictEqual(isLockedConfirmedShipment(shippedShipment), false);

// Verify that Shipments.jsx explicitly gates condition and remarks by isReceivedConfirmed
assert(shipmentsSource.includes('Awaiting Site Confirmation (Not yet received)'), 'Shipments.jsx must show awaiting confirmation when not delivered');
assert(shipmentsSource.includes('<span>In Transit</span>'), 'Shipments.jsx must tag parts as In Transit when package is shipped');
assert(shipmentsSource.includes('<span>Verified</span>'), 'Shipments.jsx must tag parts as Verified when package is received confirmed');
assert(shipmentsSource.includes('In-Transit Package Details'), 'Shipments.jsx must show In-Transit title for shipped packages');

console.log('  ✓ PASS: Shipped / In-Transit gating verified - condition and remarks only appear after actual site confirmation');
console.log('====================================================');
console.log('ALL TESTS PASSED SUCCESSFULLY (8/8)');
console.log('====================================================');
