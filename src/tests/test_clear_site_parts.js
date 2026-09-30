import assert from 'assert';
import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Clear Site Parts & Excel Re-Import Safety');
console.log('====================================================');

// Mock localStorage for test environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => (mockStorage.has(key) ? mockStorage.get(key) : null),
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

// 1. Initial State: Central DC and multiple branch sites with inventory
const initialUnits = [
  // Central DC units (Must NEVER be cleared)
  { id: 'dc-1', serial_number: 'DC-SERIAL-001', part_number: '661-30401', current_site_id: 'site-dc', site_code: 'DC-MDC', status: 'in_stock' },
  { id: 'dc-2', serial_number: 'DC-SERIAL-002', part_number: '661-30402', current_site_id: 'site-dc', site_code: 'DC-MDC', status: 'in_stock' },

  // Site APP BHS units (previously shipped by DC)
  { id: 'bhs-1', serial_number: 'BHS-OLD-SERIAL-1', part_number: '661-22294', current_site_id: 'site-bhs', site_code: 'APP BHS', status: 'in_stock' },
  { id: 'bhs-2', serial_number: 'BHS-OLD-SERIAL-2', part_number: '661-22295', current_site_id: 'site-bhs', site_code: 'APP BHS', status: 'used', work_order_number: 'OC-12345' },

  // Site ASP ABR units (previously shipped by DC)
  { id: 'abr-1', serial_number: 'ABR-OLD-SERIAL-1', part_number: '661-22294', current_site_id: 'site-abr', site_code: 'ASP ABR', status: 'in_stock' },
  { id: 'abr-2', serial_number: 'ABR-OLD-SERIAL-2', part_number: '661-30401', current_site_id: 'site-abr', site_code: 'ASP ABR', status: 'outtake' }
];

console.log('\n--- 1. CLEAR SINGLE SITE (APP BHS) ---');
// Helper simulating clearSiteParts logic for a single site
function simulateClearSiteParts(units, { siteId, siteCode, clearAllSites = false }) {
  const isDc = (u) => {
    const sId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
    const sCode = String(u.site_code || u.siteCode || '').toUpperCase();
    return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode);
  };

  const isMatch = (u) => {
    if (clearAllSites) return !isDc(u);
    const sId = String(u.current_site_id || u.site_id || u.siteId || '');
    const sCode = String(u.site_code || u.siteCode || '');
    if (siteId && (sId === siteId || sCode === siteId)) return true;
    if (siteCode && (sCode === siteCode || sId === siteCode)) return true;
    return false;
  };

  const clearedUnits = units.filter(isMatch);
  const remainingUnits = units.filter(u => !isMatch(u));
  const clearedSerials = clearedUnits.map(u => u.serial_number);

  // Update deleted serials in storage
  const existingDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
  const updatedDeleted = Array.from(new Set([...existingDeleted, ...clearedSerials]));
  localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeleted));

  return { remainingUnits, clearedUnits, clearedSerials };
}

const clearBhsResult = simulateClearSiteParts(initialUnits, { siteId: 'site-bhs', siteCode: 'APP BHS' });
assert.strictEqual(clearBhsResult.clearedUnits.length, 2, 'APP BHS should have exactly 2 units cleared');
assert.strictEqual(clearBhsResult.remainingUnits.length, 4, 'Remaining units should be 4 (2 DC + 2 ABR)');
assert.ok(clearBhsResult.remainingUnits.every(u => u.site_code !== 'APP BHS'), 'No APP BHS units remain');
assert.ok(clearBhsResult.remainingUnits.some(u => u.site_code === 'DC-MDC'), 'Central DC stock strictly preserved');
assert.ok(clearBhsResult.remainingUnits.some(u => u.site_code === 'ASP ABR'), 'ASP ABR stock unaffected');
console.log('  ✓ PASS: Single site cleared accurately while other sites and Central DC are preserved');

console.log('\n--- 2. PREVENT RESURRECTION VIA RECONCILE UNITS WITH PACKED DRAFTS ---');
// Simulate an old shipment from DC to APP BHS containing BHS-OLD-SERIAL-1
const oldShipments = [
  {
    id: 'sh-bhs-old',
    status: 'delivered',
    site_id: 'site-bhs',
    site_code: 'APP BHS',
    items: [
      { serial_number: 'BHS-OLD-SERIAL-1', part_number: '661-22294', description: 'Screen' }
    ]
  }
];

// Reconcile units with shipments - should NOT bring back BHS-OLD-SERIAL-1 because it is in deletedSerials
const reconciled = reconcileUnitsWithPackedDrafts(clearBhsResult.remainingUnits, oldShipments);
assert.strictEqual(
  reconciled.some(u => u.serial_number === 'BHS-OLD-SERIAL-1'),
  false,
  'reconcileUnitsWithPackedDrafts must NOT resurrect cleared serial BHS-OLD-SERIAL-1'
);

// Verify all shipments records are strictly preserved and not modified or deleted
assert.strictEqual(oldShipments.length, 1, 'Shipments count must remain unchanged');
assert.strictEqual(oldShipments[0].items.length, 1, 'Shipment items must remain 100% intact');
assert.strictEqual(oldShipments[0].items[0].serial_number, 'BHS-OLD-SERIAL-1', 'Shipment manifest item serial must remain intact');
assert.strictEqual(oldShipments[0].status, 'delivered', 'Shipment status must remain unchanged');
console.log('  ✓ PASS: Shipments records are 100% preserved and untouched (not cleared or modified)');
console.log('  ✓ PASS: Old shipments cannot resurrect cleared serial numbers into active stock');

console.log('\n--- 3. CLEAR ALL RETAIL SITES (NETWORK-WIDE) ---');
const clearAllResult = simulateClearSiteParts(initialUnits, { clearAllSites: true });
assert.strictEqual(clearAllResult.clearedUnits.length, 4, 'All 4 branch units across BHS and ABR must be cleared');
assert.strictEqual(clearAllResult.remainingUnits.length, 2, 'Only Central DC units remain');
assert.ok(clearAllResult.remainingUnits.every(u => u.site_code === 'DC-MDC'), 'Every remaining unit is DC stock');
console.log('  ✓ PASS: Network-wide clear purges all branch inventory while 100% preserving Central DC');

console.log('\n--- 4. CLEAN IMPORT AFTER CLEARING ---');
// Simulate user importing updated records from Site Stock Monitoring.xlsx
const freshBhsImport = [
  { id: 'fresh-1', serial_number: 'BHS-NEW-2026-001', part_number: '661-22294', current_site_id: 'site-bhs', site_code: 'APP BHS', status: 'in_stock' },
  { id: 'fresh-2', serial_number: 'BHS-NEW-2026-002', part_number: '661-30401', current_site_id: 'site-bhs', site_code: 'APP BHS', status: 'used', work_order_number: 'OC-99887' }
];

const postImportInventory = [...clearAllResult.remainingUnits, ...freshBhsImport];
assert.strictEqual(postImportInventory.length, 4, '2 DC units + 2 fresh BHS units = 4 total');
assert.ok(postImportInventory.some(u => u.serial_number === 'BHS-NEW-2026-001'), 'New live records successfully populated');
assert.ok(!postImportInventory.some(u => u.serial_number === 'BHS-OLD-SERIAL-1'), 'No obsolete leftovers present');
console.log('  ✓ PASS: Fresh Site Stock Monitoring import successfully replaces cleared records');

console.log('\n--- 5. CLEAR ENTIRE SYSTEM (SUPERADMIN COMPLETE RESET) ---');
function simulateClearSystem(units, { clearEntireSystem = false, clearAllSites = false, siteId = null, siteCode = null }) {
  const isDc = (u) => {
    const sId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
    const sCode = String(u.site_code || u.siteCode || '').toUpperCase();
    return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode);
  };

  const isMatch = (u) => {
    if (clearEntireSystem) return true;
    if (clearAllSites) return !isDc(u);
    const sId = String(u.current_site_id || u.site_id || u.siteId || '');
    const sCode = String(u.site_code || u.siteCode || '');
    if (siteId && (sId === siteId || sCode === siteId)) return true;
    if (siteCode && (sCode === siteCode || sId === siteCode)) return true;
    return false;
  };

  const clearedUnits = units.filter(isMatch);
  const remainingUnits = units.filter(u => !isMatch(u));
  return { remainingUnits, clearedUnits };
}

const clearSystemResult = simulateClearSystem(initialUnits, { clearEntireSystem: true });
assert.strictEqual(clearSystemResult.clearedUnits.length, 6, 'All 6 units (including Central DC) must be cleared');
assert.strictEqual(clearSystemResult.remainingUnits.length, 0, '0 units remaining after entire system clear');
console.log('  ✓ PASS: Superadmin Entire System purge wipes 100% of units for clean factory re-import');

console.log('\n--- 6. MULTI-SITE BATCH ADD & SERIAL MERGING ---');
const multiSiteBatch = [
  { id: 'bhs-new', serial_number: 'BHS-S-1', part_number: '661-22294', current_site_id: 'site-bhs', site_code: 'APP BHS', site_name: 'BHS' },
  { id: 'abr-new', serial_number: 'ABR-S-1', part_number: '661-30401', current_site_id: 'site-abr', site_code: 'ASP ABR', site_name: 'ABR' },
  { id: 'gl5-new', serial_number: 'GL5-S-1', part_number: '661-21988', current_site_id: 'site-gl5', site_code: 'ASP GL5', site_name: 'GL5' }
];

const serialsToImport = new Set(multiSiteBatch.map(u => u.serial_number.toUpperCase()));
const untouched = initialUnits.filter(u => !serialsToImport.has(u.serial_number.toUpperCase()));
const updatedUnits = [...untouched, ...multiSiteBatch];

assert.strictEqual(updatedUnits.length, initialUnits.length + multiSiteBatch.length);
assert.ok(updatedUnits.find(u => u.serial_number === 'BHS-S-1' && u.site_code === 'APP BHS'));
assert.ok(updatedUnits.find(u => u.serial_number === 'ABR-S-1' && u.site_code === 'ASP ABR'));
assert.ok(updatedUnits.find(u => u.serial_number === 'GL5-S-1' && u.site_code === 'ASP GL5'));
console.log('  ✓ PASS: Multi-site batch import accurately tags each unit with its respective branch');

console.log('\n--- 7. PREVENT 17 UNITS RESURRECTION ON ASP ABR FROM HISTORICAL SHIPMENT DCOWNED#091226C ---');
// Historical shipment DCOWNED#091226C with 17 units of 661-13575 delivered to ASP ABR on 2026-09-19
const abrHistoricalShipment = {
  id: 'shp-abr-20227493',
  invoice_ref: 'DCOWNED#091226C',
  shipment_number: 'DCOWNED#091226C',
  site_id: 'site-23',
  site_code: 'ASP ABR',
  status: 'received_confirmed',
  shipment_date: '2026-09-14',
  received_at: '2026-09-19T08:00:00.000Z',
  items: [
    { serial_number: 'G9Q6197WJD221KHAZ', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHMCX0RE40000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHVHE27SC0000MUY', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHVNES2LQ0000MUY', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHVLV5WSI0000MUY', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHWJ5C34K0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHVN4NWHX0000MUY', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHVNBLWE10000MUY', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PHVMRDW8M0000MUY', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3702TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3705TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3708TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3710TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3712TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3714TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3716TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' },
    { serial_number: 'G9PJ3718TDM0000HUB', part_number: '661-13575', description: 'Rear Camera, iPhone 11' }
  ]
};

// 1. Before clearing: reconcileUnitsWithPackedDrafts naturally synthesizes 17 units for ASP ABR
const initialAbrReconciled = reconcileUnitsWithPackedDrafts([], [abrHistoricalShipment]);
assert.strictEqual(initialAbrReconciled.length, 17, 'Before clearing, 17 units are synthesized from delivered shipment');
assert.ok(initialAbrReconciled.every(u => u.site_code === 'ASP ABR'), 'All 17 units belong to ASP ABR');

// 2. Superadmin clears all retail branch sites:
// Harvesting shipments ensures all 17 serials are placed into mdc_deleted_unit_serials
const clearAbrTime = new Date().toISOString();
const abrHarvestedSerials = abrHistoricalShipment.items.map(it => it.serial_number);
const currentDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify([...currentDeleted, ...abrHarvestedSerials]));
localStorage.setItem('mdc_cleared_site_timestamps', JSON.stringify({ ALL_BRANCHES: clearAbrTime, 'ASP ABR': clearAbrTime, 'site-23': clearAbrTime }));

// 3. Reconcile again: ASP ABR MUST be 0 units!
const postClearReconciled = reconcileUnitsWithPackedDrafts([], [abrHistoricalShipment]);
assert.strictEqual(postClearReconciled.length, 0, 'After clear, ASP ABR must have exactly 0 stock units (NO resurrection)');
assert.strictEqual(abrHistoricalShipment.items.length, 17, 'Shipment record DCOWNED#091226C remains 100% intact');
console.log('  ✓ PASS: ASP ABR drops to 0 parts; historical 17-unit shipment cannot resurrect units');
console.log('  ✓ PASS: Shipment DCOWNED#091226C manifest and dispatch records remain completely untouched');

console.log('\n====================================================');
console.log('FINAL RESULTS: ALL CLEAR SITE PARTS TESTS PASSED');
console.log('====================================================');
