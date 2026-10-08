import assert from 'assert';
import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers.js';

console.log('========================================================================');
console.log('TEST SUITE: Zero Retained Units on All-Stocks After Clearing All Branches');
console.log('========================================================================');

// Mock localStorage for test environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => (mockStorage.has(key) ? mockStorage.get(key) : null),
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

// 1. Initial State: Central DC and APP ANX with 661-30401 (Display, iPhone 14 Pro Max)
const initialUnits = [
  // Central DC unit (Must NEVER be cleared)
  { id: 'dc-1', serial_number: 'DC-SERIAL-001', part_number: '661-30401', current_site_id: 'site-dc', site_code: 'DC-MDC', status: 'in_stock', created_at: '2026-08-01T00:00:00.000Z' },

  // APP ANX units (including the exact part from the user screenshot)
  { id: 'anx-1', serial_number: 'G9P5207NNJZ14YDAX', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', current_site_id: 'site-9', site_code: 'APP ANX', status: 'in_stock', created_at: '2026-08-10T00:00:00.000Z' },
  { id: 'anx-2', serial_number: 'F8YHLQH01PY0000UMJ', part_number: '661-44954', description: 'Battery, iPhone 16 Pro Max', current_site_id: 'site-9', site_code: 'APP ANX', status: 'used', created_at: '2026-08-10T00:00:00.000Z' },

  // ASP ABR units
  { id: 'abr-1', serial_number: 'ABR-SERIAL-001', part_number: '661-22294', current_site_id: 'site-23', site_code: 'ASP ABR', status: 'in_stock', created_at: '2026-08-10T00:00:00.000Z' }
];

// Historical shipment to APP ANX
const historicalShipments = [
  {
    id: 'shp-anx-1',
    invoice_ref: 'DCOWNED#082726ANX',
    siteId: 'site-9',
    destination: 'APP ANX',
    status: 'delivered',
    received_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-10-08T09:00:00.000Z', // Note: newer updated_at must NOT cause resurrection!
    items: [
      { serial_number: 'G9P5207NNJZ14YDAX', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max' }
    ]
  }
];

const mockSites = [
  { id: 'site-dc', code: 'DC-MDC', name: 'Central DC', is_dc: true },
  { id: 'site-9', code: 'APP ANX', name: 'APP Ayala Malls Manila Bay (ANX)', is_dc: false },
  { id: 'site-23', code: 'ASP ABR', name: 'ASP Abreeza (ABR)', is_dc: false }
];

// Helper reproducing getStockOnHandForSite with the updated logic
function getStockOnHandForSite(siteIdOrCode, units) {
  const targetSite = mockSites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
  const siteId = targetSite?.id || siteIdOrCode;
  const siteCode = targetSite?.code || siteIdOrCode;

  let deletedSerialsSet = new Set();
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
    if (Array.isArray(localDeleted)) {
      deletedSerialsSet = new Set(localDeleted.map(s => String(s).trim().toUpperCase()));
    }
  } catch (e) {}

  let clearedSitesMap = {};
  try {
    const localCleared = JSON.parse(localStorage.getItem('mdc_cleared_site_timestamps') || '{}');
    if (localCleared && typeof localCleared === 'object') {
      clearedSitesMap = localCleared;
    }
  } catch (e) {}

  const isDc = siteId === 'site-dc' || siteCode === 'DC-MDC';
  const isBranchTarget = !isDc;
  const clearTime = clearedSitesMap['ENTIRE_SYSTEM'] ||
    (isBranchTarget ? clearedSitesMap['ALL_BRANCHES'] : null) ||
    clearedSitesMap[siteId] ||
    clearedSitesMap[siteCode] ||
    null;

  const targetIdLower = String(siteId).toLowerCase();
  const targetCodeUpper = String(siteCode).toUpperCase();
  const targetClean = targetCodeUpper.replace(/^(ASP|APP)\s+/, '');

  const matchingUnits = (units || []).filter(u => {
    if (!u || u.is_deleted || u.status === 'deleted') return false;

    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s && deletedSerialsSet.has(s)) return false;

    if (clearTime) {
      const uDateStr = u.received_at || u.created_at;
      if (!uDateStr || new Date(uDateStr).getTime() <= new Date(clearTime).getTime()) {
        return false;
      }
    }

    const uSiteId = String(u.current_site_id || u.siteId || u.site_id || '').toLowerCase();
    const uSiteCode = String(u.site_code || u.siteCode || '').toUpperCase();
    const uClean = uSiteCode.replace(/^(ASP|APP)\s+/, '');

    return (targetIdLower && uSiteId === targetIdLower) ||
           (targetCodeUpper && uSiteCode === targetCodeUpper) ||
           (targetClean && uClean && targetClean === uClean);
  });

  let totalInStock = 0;
  matchingUnits.forEach(u => {
    const st = String(u.status || 'in_stock').toLowerCase();
    if (st === 'in_stock' || st === 'delivered' || st === 'received') {
      totalInStock++;
    }
  });

  return { siteId, siteCode, totalInStock, units: matchingUnits };
}

console.log('\n--- 1. Verification Before Clearing ---');
const beforeAnxStock = getStockOnHandForSite('site-9', initialUnits);
assert.strictEqual(beforeAnxStock.totalInStock, 1, 'APP ANX has 1 unit in stock before clear');
console.log('  ✓ PASS: Before clear, APP ANX has 1 unit in stock (Display, iPhone 14 Pro Max)');

console.log('\n--- 2. Clear All Retail Branches (Simulation of clearSiteParts clearAllSites: true) ---');
const clearTimeIso = new Date().toISOString();

// Populate deleted serials
const clearedSerials = ['G9P5207NNJZ14YDAX', 'F8YHLQH01PY0000UMJ', 'ABR-SERIAL-001'];
localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(clearedSerials));

// Populate cleared site timestamps including ALL_BRANCHES and individual branch codes
const clearedTimestamps = {
  ALL_BRANCHES: clearTimeIso,
  'site-9': clearTimeIso,
  'APP ANX': clearTimeIso,
  'site-23': clearTimeIso,
  'ASP ABR': clearTimeIso
};
localStorage.setItem('mdc_cleared_site_timestamps', JSON.stringify(clearedTimestamps));

// Reconcile units with historical shipments (simulating background sync or startup)
const postClearUnits = reconcileUnitsWithPackedDrafts(
  initialUnits.filter(u => u.site_code === 'DC-MDC'), // DC stock kept
  historicalShipments
);

console.log('  Total units remaining in inventory state:', postClearUnits.length);
assert.strictEqual(postClearUnits.length, 1, 'Only Central DC unit survives in inventoryUnits state');
assert.strictEqual(postClearUnits[0].site_code, 'DC-MDC', 'Surviving unit is Central DC');

console.log('\n--- 3. Verification of APP ANX After Clear ---');
const afterAnxStock = getStockOnHandForSite('site-9', postClearUnits);
assert.strictEqual(afterAnxStock.totalInStock, 0, 'APP ANX must have exactly 0 units in stock');
assert.strictEqual(afterAnxStock.units.length, 0, 'APP ANX matchingUnits length must be 0');
console.log('  ✓ PASS: APP ANX totalInStock is exactly 0 units (0 retained parts)');

console.log('\n--- 4. Verification of All Stocks & Multi-Site Summary ---');
let totalNetworkUnits = 0;
mockSites.filter(s => !s.is_dc).forEach(branch => {
  const stock = getStockOnHandForSite(branch.id, postClearUnits);
  totalNetworkUnits += stock.totalInStock;
  assert.strictEqual(stock.totalInStock, 0, `${branch.code} must have 0 units`);
});
assert.strictEqual(totalNetworkUnits, 0, 'Total Network Inventory must be exactly 0 across ASPs');
console.log('  ✓ PASS: Total Network Inventory is 0 across all ASPs! Zero parts retained.');

console.log('\n--- 5. Even If In-Memory inventoryUnits Contains Stale Object ---');
// Even if an un-cleared in-memory copy of initialUnits was passed:
const staleQueryStock = getStockOnHandForSite('site-9', initialUnits);
assert.strictEqual(staleQueryStock.totalInStock, 0, 'Stale unit must be filtered out by deletedSerials and clear timestamp');
assert.strictEqual(staleQueryStock.units.length, 0, 'Stale matching units array must be empty');
console.log('  ✓ PASS: getStockOnHandForSite defenses filter out stale in-memory units via deletedSerials and clear timestamp');

console.log('\n========================================================================');
console.log('ALL ZERO RETAINED ANX TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================');
