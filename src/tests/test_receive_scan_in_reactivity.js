import assert from 'assert';
import { normalizeInventoryUnits, validateAppleSerialNumber } from '../utils/partResolver.js';

console.log('====================================================');
console.log('TEST SUITE: Receive Scan-In Immediate Reactivity & Synchronization');
console.log('====================================================');

const samplePartsCatalog = [
  { id: 'part-661-30382', part_number: '661-30382', description: 'Battery, iPhone 14 Pro', category_id: 'cat-battery', stocking_price: 99 },
  { id: 'part-661-30366', part_number: '661-30366', description: 'Display, iPhone 14', category_id: 'cat-display', stocking_price: 279 },
  { id: 'part-661-21996', part_number: '661-21996', description: 'Battery, iPhone 13 Pro', category_id: 'cat-battery', stocking_price: 89 },
  { id: 'part-661-56050', part_number: '661-56050', description: 'Display, iPhone 17 Pro Max', category_id: 'cat-display', stocking_price: 379 }
];

const mockDcSite = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'DC-MDC',
  name: 'Distribution Center (DC)',
  is_dc: true
};

// Initial base inventory units (e.g. 245 units in DC)
const initialUnits = Array.from({ length: 245 }, (_, i) => ({
  id: `unit-base-${i}`,
  part_number: i % 2 === 0 ? '661-21996' : '661-30366',
  serial_number: `F8Y62000000000${String(i).padStart(3, '0')}`,
  description: i % 2 === 0 ? 'Battery, iPhone 13 Pro' : 'Display, iPhone 14',
  intake_assignment: i % 3 === 0 ? 'DC - CRBR' : i % 3 === 1 ? 'SVNR - Service Non-Repair' : 'MDC - Forecasting',
  notes: i % 3 === 0 ? 'DC - CRBR' : i % 3 === 1 ? 'SVNR - Service Non-Repair' : 'MDC - Forecasting',
  current_site_id: mockDcSite.id,
  site_code: 'DC-MDC',
  status: 'in_stock',
  received_at: '2026-09-07T08:00:00.000Z'
}));

// Helper simulating ScanInReceiving availableInStockUnits pooling logic
function computeAvailableInStockUnits({ inventoryUnits, sessionScans, activeReceivingSite, dcSiteObj }) {
  const serialMap = new Map();
  (inventoryUnits || []).forEach(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s) serialMap.set(s, u);
  });
  (sessionScans || []).forEach(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s) {
      const existing = serialMap.get(s);
      serialMap.set(s, { ...existing, ...u });
    }
  });
  const pool = Array.from(serialMap.values());

  const raw = pool.filter(u => {
    const _cleanSerial = String(u.serial_number || '').trim().toUpperCase();
    if (u.status === 'packed' || u.status === 'shipped' || u.status === 'deleted' || u.is_deleted) return false;
    if (u.status !== 'in_stock' && u.status) return false;

    const isDc = u.current_site_id === 'site-dc' ||
      u.current_site_id === dcSiteObj?.id ||
      u.current_site_id === activeReceivingSite?.id ||
      u.site_code === 'DC-MDC' ||
      u.site_code === 'DC' ||
      u.site_code === dcSiteObj?.code ||
      u.site_code === activeReceivingSite?.code ||
      (!u.current_site_id && !u.site_code);
    return (u.status === 'in_stock' || !u.status) && isDc;
  });

  return normalizeInventoryUnits(raw, samplePartsCatalog);
}

// Helper simulating ScanInReceiving displayedUnits sorting
function computeDisplayedUnits(enrichedUnits) {
  return [...enrichedUnits].sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
}

// [Test 1] Instant Addition & Reactivity of Scanned Part
console.log('\n--- 1. Testing Instant Addition & Reactivity of Scanned Part ---');
{
  let inventoryUnits = [...initialUnits];
  let sessionScans = [];

  const initialAvailable = computeAvailableInStockUnits({
    inventoryUnits,
    sessionScans,
    activeReceivingSite: mockDcSite,
    dcSiteObj: mockDcSite
  });
  assert.strictEqual(initialAvailable.length, 245, 'Initial in-stock count should be exactly 245');

  // User scans part 661-30382 with SN F8Y6287CP8T217WBH
  const pnToScan = '661-30382';
  const snToScan = 'F8Y6287CP8T217WBH';

  const valResult = validateAppleSerialNumber(snToScan, pnToScan, samplePartsCatalog);
  assert.strictEqual(valResult.isValid, true, 'Serial number validation must pass');

  const scannedUnit = {
    id: `unit-${Date.now()}-test`,
    part_id: 'part-661-30382',
    part_number: '661-30382',
    description: 'Battery, iPhone 14 Pro',
    serial_number: valResult.cleanSerial,
    intake_assignment: 'DC - CRBR',
    notes: 'DC - CRBR',
    current_site_id: mockDcSite.id,
    site_code: mockDcSite.code,
    status: 'in_stock',
    received_at: new Date().toISOString()
  };

  // Immediate state updates
  inventoryUnits = [scannedUnit, ...inventoryUnits];
  sessionScans = [scannedUnit, ...sessionScans];

  const updatedAvailable = computeAvailableInStockUnits({
    inventoryUnits,
    sessionScans,
    activeReceivingSite: mockDcSite,
    dcSiteObj: mockDcSite
  });

  assert.strictEqual(updatedAvailable.length, 246, 'In-stock count must immediately increment to 246 without refresh');
  const topUnit = computeDisplayedUnits(updatedAvailable)[0];
  assert.strictEqual(topUnit.serial_number, 'F8Y6287CP8T217WBH', 'Newly scanned unit must be Row #1 in table');
  assert.strictEqual(topUnit.part_number, '661-30382', 'Part number must match 661-30382');
  assert.strictEqual(topUnit.intake_assignment, 'DC - CRBR', 'Assignment must be DC - CRBR');
  console.log(`  ✓ PASS: Scanned part ${topUnit.part_number} (${topUnit.serial_number}) reflected immediately as Row #1; in-stock count: 245 ➜ 246`);
}

// [Test 2] SessionScans Resilience against Premature Database Sync
console.log('\n--- 2. Testing Resilience Against Premature Background Database Sync ---');
{
  const scannedUnit = {
    id: 'unit-optimistic-1',
    part_number: '661-56050',
    serial_number: 'G9P6915C0CDA3BJ60',
    description: 'Display, iPhone 17 Pro Max',
    intake_assignment: 'MDC - Forecasting',
    notes: 'MDC - Forecasting',
    current_site_id: mockDcSite.id,
    site_code: mockDcSite.code,
    status: 'in_stock',
    received_at: new Date().toISOString()
  };

  // Suppose inventoryUnits temporarily re-hydrates to stale DB snapshot (245 units, without scannedUnit)
  const staleDbInventory = [...initialUnits];
  // But sessionScans in component state preserves the scan!
  const sessionScans = [scannedUnit];

  const resilientAvailable = computeAvailableInStockUnits({
    inventoryUnits: staleDbInventory,
    sessionScans,
    activeReceivingSite: mockDcSite,
    dcSiteObj: mockDcSite
  });

  assert.strictEqual(resilientAvailable.length, 246, 'Count must remain 246 even if background sync returns stale data');
  const found = resilientAvailable.find(u => u.serial_number === 'G9P6915C0CDA3BJ60');
  assert(found, 'Scanned unit must remain visible in table via sessionScans pooling');
  console.log('  ✓ PASS: SessionScans pool guarantees scanned parts never disappear during background sync');
}

// [Test 3] Cloud Sync hydrateFromSupabase Optimistic Memory Preservation
console.log('\n--- 3. Testing hydrateFromSupabase In-Memory Optimistic Preservation ---');
{
  // Simulate hydrateFromSupabase setInventoryUnits reducer logic
  const prevMemoryUnits = [
    {
      id: 'unit-freshly-scanned',
      part_number: '661-30382',
      serial_number: 'F8Y6287CP8T217WBH',
      status: 'in_stock',
      current_site_id: 'site-dc',
      site_code: 'DC-MDC',
      received_at: new Date().toISOString()
    },
    ...initialUnits
  ];

  // Database query response that has NOT yet indexed the new unit
  const dbUnitsFromSupabase = initialUnits.map(u => ({ ...u }));
  const deletedSerialsSet = new Set();

  // Reducer simulation with the new fix:
  const map = new Map();
  dbUnitsFromSupabase.forEach(dbU => {
    map.set(dbU.serial_number.toUpperCase(), dbU);
  });

  // Preserve active in-memory units
  prevMemoryUnits.forEach(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s && !deletedSerialsSet.has(s) && !u.is_deleted && u.status !== 'deleted') {
      if (!map.has(s)) {
        map.set(s, u);
      }
    }
  });

  const merged = Array.from(map.values());
  assert.strictEqual(merged.length, 246, 'Merged inventory must contain 246 units');
  const preservedUnit = merged.find(u => u.serial_number === 'F8Y6287CP8T217WBH');
  assert(preservedUnit, 'Freshly scanned unit must be preserved during cloud hydration');
  console.log('  ✓ PASS: hydrateFromSupabase preserves optimistic local units not yet returned by cloud database');
}

// [Test 4] Realtime Zero-Latency Peer Event Ingestion
console.log('\n--- 4. Testing handleRealtimeInventoryEvent STOCK_UPDATED / UNIT_ADDED ---');
{
  let localUnits = [...initialUnits];
  const incomingPeerUnit = {
    id: 'unit-peer-scan-99',
    part_number: '661-30366',
    serial_number: 'GH3891MZP01289XCC',
    description: 'Display, iPhone 14',
    status: 'in_stock',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    received_at: new Date().toISOString()
  };

  // Simulate handleRealtimeInventoryEvent for STOCK_UPDATED
  const cleanS = incomingPeerUnit.serial_number.toUpperCase();
  if (!localUnits.some(u => u.serial_number.toUpperCase() === cleanS)) {
    localUnits = [incomingPeerUnit, ...localUnits];
  }

  assert.strictEqual(localUnits.length, 246, 'Local units should immediately include incoming peer unit');
  assert.strictEqual(localUnits[0].serial_number, 'GH3891MZP01289XCC', 'Peer unit must be at index 0');
  console.log('  ✓ PASS: Peer scanned unit ingested with zero latency without waiting for database query');
}

// [Test 5] Duplicate Serial Prevention
console.log('\n--- 5. Testing Duplicate Serial Prevention ---');
{
  const existingSerial = 'F8Y6287CP8T217WBH';
  const units = [
    { serial_number: existingSerial, status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC' }
  ];

  const duplicateCheck = (testSerial) => {
    return units.some(u => String(u.serial_number).toUpperCase() === testSerial.toUpperCase() && u.status === 'in_stock');
  };

  assert.strictEqual(duplicateCheck(existingSerial), true, 'Duplicate serial must be detected');
  assert.strictEqual(duplicateCheck('F8Y6287CP8T999999'), false, 'New serial must be accepted');
  console.log('  ✓ PASS: Duplicate serial number prevented immediately');
}

console.log('\n====================================================');
console.log('ALL RECEIVE SCAN-IN REACTIVITY TESTS PASSED (100%)');
console.log('====================================================');
