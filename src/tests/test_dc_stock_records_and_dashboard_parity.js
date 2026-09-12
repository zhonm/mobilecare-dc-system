import assert from 'assert';
import { filterAvailableDcInStockUnits } from '../utils/appContextHelpers.js';

console.log('====================================================================');
console.log('TEST SUITE: DC Stock Records & System Dashboard Parity Verification');
console.log('====================================================================\n');

// -----------------------------------------------------------------------------
// 1. Recreate the Dataset that Caused the 256 vs 162 Discrepancy
// -----------------------------------------------------------------------------
console.log('--- 1. Testing Root Cause Identification (256 vs 162 Discrepancy) ---');

// A. 162 Genuine September Physical DC In-Stock Units
// (56 Display modules, 106 Battery modules matching user screenshot)
const genuineDcInStockUnits = [
  ...Array.from({ length: 56 }, (_, i) => ({
    id: `unit-sep-display-${i + 1}`,
    serial_number: `SEP_DISP_${String(i + 1).padStart(3, '0')}`,
    part_number: '661-30366',
    description: 'Display, iPhone 14',
    category: 'Display',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-07T08:00:00.000Z'
  })),
  ...Array.from({ length: 106 }, (_, i) => ({
    id: `unit-sep-battery-${i + 1}`,
    serial_number: `SEP_BATT_${String(i + 1).padStart(3, '0')}`,
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    category: 'Battery',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    status: 'in_stock',
    received_at: '2026-09-09T09:00:00.000Z'
  }))
];
assert.strictEqual(genuineDcInStockUnits.length, 162, 'Genuine DC in-stock units must equal 162');

// B. 53 Outdated Pre-September (August 24) Units that Leaked into Dashboard Aging
const outdatedAugustUnits = Array.from({ length: 53 }, (_, i) => ({
  id: `unit-aug-aging-${i + 1}`,
  serial_number: `AUG_LEAK_${String(i + 1).padStart(3, '0')}`,
  part_number: '661-35694',
  description: 'Battery, iPhone 15 Pro',
  current_site_id: 'site-dc',
  site_code: 'DC-MDC',
  status: 'in_stock',
  received_at: '2026-08-24T10:00:00.000Z' // >= 4 days in DC
}));
assert.strictEqual(outdatedAugustUnits.length, 53, 'Outdated August units must equal 53');

// C. 41 Units in Finalized / Received Branch Shipments
const receivedShipmentUnits = Array.from({ length: 41 }, (_, i) => ({
  id: `unit-shipped-${i + 1}`,
  serial_number: `DISPATCHED_${String(i + 1).padStart(3, '0')}`,
  part_number: '661-21988',
  description: 'Display, iPhone 13',
  current_site_id: 'site-dc', // Retained old site code in DB
  site_code: 'DC-MDC',
  status: 'in_stock', // Re-marked in_stock upon branch arrival
  received_at: '2026-09-02T10:00:00.000Z'
}));
assert.strictEqual(receivedShipmentUnits.length, 41, 'Received shipment units must equal 41');

// Reconstructed inventory pool in the system
const mixedInventoryPool = [
  ...genuineDcInStockUnits,
  ...outdatedAugustUnits,
  ...receivedShipmentUnits
];
assert.strictEqual(mixedInventoryPool.length, 256, 'Total mixed inventory pool equals 256 units');

// Finalized / received shipment containing the 41 dispatched serials
const shipments = [
  {
    id: 'ship-001',
    invoice_ref: 'DCOWNED#090226A',
    status: 'received_confirmed',
    items: receivedShipmentUnits.map(u => ({ serial_number: u.serial_number, part_number: u.part_number }))
  }
];

// Active outbound shipments (which excluded received_confirmed shipments in Dashboard)
const activeShipments = shipments.filter(s => s.status === 'shipped' || s.status === 'pending_pickup');
assert.strictEqual(activeShipments.length, 0, 'No active in-transit shipments');

// --- Demonstrate Old Dashboard Calculation Bug ---
const oldDashboardPackedSerials = new Set();
activeShipments.forEach(sh => {
  sh.items.forEach(it => oldDashboardPackedSerials.add(it.serial_number.toUpperCase()));
});
const oldDashboardUnits = mixedInventoryPool.filter(u => {
  const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
  if (cleanSerial && oldDashboardPackedSerials.has(cleanSerial)) return false;
  const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC';
  return isDc && (u.status === 'in_stock' || !u.status);
});

assert.strictEqual(oldDashboardUnits.length, 256, 'Old Dashboard logic returned 256 units (Bug confirmed)');
console.log('  ✓ CONFIRMED: Old Dashboard logic counted 256 units (leaked 53 August units + 41 delivered units)');

// -----------------------------------------------------------------------------
// 2. Test Canonical filterAvailableDcInStockUnits Parity
// -----------------------------------------------------------------------------
console.log('\n--- 2. Testing Canonical filterAvailableDcInStockUnits Synchronization ---');

const synchronizedDashboardUnits = filterAvailableDcInStockUnits({
  inventoryUnits: mixedInventoryPool,
  activePackDraft: null,
  shipments: shipments
});

assert.strictEqual(
  synchronizedDashboardUnits.length,
  162,
  `Synchronized Dashboard units must be exactly 162 (got ${synchronizedDashboardUnits.length})`
);
console.log('  ✓ PASS: System Dashboard now computes exactly 162 in-stock units');

// Verify Category breakdown matches the user screenshot (56 Display, 106 Battery)
let displayCount = 0;
let batteryCount = 0;
synchronizedDashboardUnits.forEach(u => {
  if (u.category === 'Display' || u.description.includes('Display')) displayCount++;
  if (u.category === 'Battery' || u.description.includes('Battery')) batteryCount++;
});

assert.strictEqual(displayCount, 56, 'Dashboard Display count must be 56');
assert.strictEqual(batteryCount, 106, 'Dashboard Battery count must be 106');
console.log('  ✓ PASS: Perfect category breakdown parity: 56 Displays + 106 Batteries = 162 Total Units');

// -----------------------------------------------------------------------------
// 3. Test Aging Alert Accuracy (Zero False Aging Alerts from August Units)
// -----------------------------------------------------------------------------
console.log('\n--- 3. Testing Aging Parts Calculation Integrity ---');

function calculateDaysInDc(dateString, mockNow = new Date('2026-09-11T08:00:00Z')) {
  if (!dateString) return 0;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((mockNow.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

const agingUnits = [];
const freshUnits = [];
synchronizedDashboardUnits.forEach(u => {
  const days = calculateDaysInDc(u.received_at);
  if (days >= 4) {
    agingUnits.push(u);
  } else {
    freshUnits.push(u);
  }
});

// Outdated August units must not appear in aging
const hasAugustInAging = agingUnits.some(u => u.received_at.startsWith('2026-08'));
assert.strictEqual(hasAugustInAging, false, 'August 24 units must NEVER leak into aging alerts');
console.log(`  ✓ PASS: Zero August units in aging alert (Active stock: ${agingUnits.length} aging, ${freshUnits.length} fresh)`);

// -----------------------------------------------------------------------------
// 4. Test Dynamic Operations (Instant Two-Way Synchronization)
// -----------------------------------------------------------------------------
console.log('\n--- 4. Testing Dynamic Two-Way Realtime Synchronization ---');

// A. Unit Scan-In: Adding a new unit to DC stock
const newScannedUnit = {
  id: 'unit-sep-new-1',
  serial_number: 'SEP_NEW_001',
  part_number: '661-30366',
  description: 'Display, iPhone 14',
  current_site_id: 'site-dc',
  site_code: 'DC-MDC',
  status: 'in_stock',
  received_at: '2026-09-11T10:00:00.000Z'
};

const updatedPoolWithNewUnit = [newScannedUnit, ...mixedInventoryPool];
const dcStockAfterScan = filterAvailableDcInStockUnits({
  inventoryUnits: updatedPoolWithNewUnit,
  activePackDraft: null,
  shipments: shipments
});

assert.strictEqual(dcStockAfterScan.length, 163, 'Stock count immediately increases to 163');
console.log('  ✓ PASS: Scan-In instantly updates both DC Stock Records and Dashboard to 163');

// B. Unit Scan-Out: Packing a unit into active draft
const activeDraft = {
  id: 'draft-01',
  items: [{ serial_number: 'SEP_DISP_001' }]
};

const dcStockAfterPack = filterAvailableDcInStockUnits({
  inventoryUnits: mixedInventoryPool,
  activePackDraft: activeDraft,
  shipments: shipments
});

assert.strictEqual(dcStockAfterPack.length, 161, 'Stock count immediately decreases to 161');
assert.strictEqual(dcStockAfterPack.some(u => u.serial_number === 'SEP_DISP_001'), false, 'Packed unit removed');
console.log('  ✓ PASS: Pack Scan-Out instantly updates both DC Stock Records and Dashboard to 161');

// C. Outbound Dispatch: Finalizing shipment removes unit permanently from DC stock
const shipmentsWithNewDispatched = [
  ...shipments,
  {
    id: 'ship-002',
    invoice_ref: 'DCOWNED#091126B',
    status: 'pending_pickup',
    items: [{ serial_number: 'SEP_DISP_002' }]
  }
];

const dcStockAfterDispatch = filterAvailableDcInStockUnits({
  inventoryUnits: mixedInventoryPool,
  activePackDraft: null,
  shipments: shipmentsWithNewDispatched
});

assert.strictEqual(dcStockAfterDispatch.length, 161, 'Dispatched unit properly deducted');
assert.strictEqual(dcStockAfterDispatch.some(u => u.serial_number === 'SEP_DISP_002'), false);
console.log('  ✓ PASS: Outbound shipments immediately deducted across DC Stock Records & Dashboard');

console.log('\n====================================================================');
console.log('ALL DC STOCK & DASHBOARD PARITY TESTS PASSED (100%)');
console.log('====================================================================');
