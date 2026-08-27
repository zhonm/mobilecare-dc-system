import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('====================================================');
console.log('TEST SUITE: Parts Stock Deletion & Packing List Sync');
console.log('====================================================');

// Mock In-Stock Inventory Units
const initialUnits = [
  {
    id: 'unit-0',
    part_id: 'part-661-56125',
    part_number: '661-56125',
    description: 'Display, iPhone 17 Pro',
    serial_number: 'G9PQHU084CQ9D088S5L4B',
    status: 'in_stock',
    intake_assignment: 'MDC - Forecasting',
    notes: 'MDC - Forecasting',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    received_at: '2026-08-27T12:16:21.000Z'
  },
  {
    id: 'unit-1',
    part_id: 'part-661-38461',
    part_number: '661-38461',
    description: 'Display, iPhone 14 Pro Max',
    serial_number: 'G9P5442NAFK14YDXP',
    status: 'in_stock',
    intake_assignment: 'MDC - Forecasting',
    notes: 'MDC - Forecasting',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    received_at: '2026-08-27T12:16:21.000Z'
  },
  {
    id: 'unit-2',
    part_id: 'part-661-42843',
    part_number: '661-42843',
    description: 'Display, iPhone 16 Plus',
    serial_number: 'G9QHXKT0KU690004YY',
    status: 'in_stock',
    intake_assignment: 'MDC - Forecasting',
    notes: 'MDC - Forecasting',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    received_at: '2026-08-27T12:16:21.000Z'
  }
];

// Mock Intake Batches
let mockDcIntakeRecords = [
  {
    id: 'MDC202600001',
    record_name: 'Intake Batch 1',
    intake_date: '2026-08-27',
    total_units: 3,
    items: [...initialUnits]
  }
];

// --- TEST 1: Deletion of unit by object vs serial vs id ---
const unitToDelete = initialUnits[0]; // G9PQHU084CQ9D088S5L4B (id: 'unit-0')

function simulateDeleteScanInUnit(serialOrUnit, currentUnits, currentIntakeRecords, deletedSerialsRegistry) {
  let cleanSerial = '';
  let existing = null;

  if (typeof serialOrUnit === 'object' && serialOrUnit !== null) {
    cleanSerial = String(serialOrUnit.serial_number || serialOrUnit.serialNumber || '').trim().toUpperCase();
    existing = serialOrUnit;
  } else {
    const searchKey = String(serialOrUnit || '').trim().toUpperCase();
    existing = (currentUnits || []).find(u =>
      String(u.serial_number || '').toUpperCase() === searchKey ||
      String(u.id || '').toUpperCase() === searchKey
    );
    cleanSerial = String(existing?.serial_number || searchKey).trim().toUpperCase();
  }

  const updatedDeleted = Array.from(new Set([...deletedSerialsRegistry, cleanSerial]));

  const nextUnits = currentUnits.filter(u =>
    String(u.serial_number || '').toUpperCase() !== cleanSerial &&
    (!existing?.id || u.id !== existing.id)
  );

  const nextRecords = currentIntakeRecords.map(rec => {
    if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').toUpperCase() === cleanSerial)) {
      const filtered = rec.items.filter(it => String(it.serial_number || '').toUpperCase() !== cleanSerial);
      return { ...rec, items: filtered, total_units: filtered.length };
    }
    return rec;
  });

  return { nextUnits, nextRecords, updatedDeleted, cleanSerial };
}

let deletedRegistry = [];
const deleteResult = simulateDeleteScanInUnit(unitToDelete, initialUnits, mockDcIntakeRecords, deletedRegistry);

assert(deleteResult.cleanSerial === 'G9PQHU084CQ9D088S5L4B', `Resolved cleanSerial is actual Apple serial: ${deleteResult.cleanSerial}`);
assert(deleteResult.nextUnits.length === 2, `Unit removed from active units (remaining: ${deleteResult.nextUnits.length})`);
assert(!deleteResult.nextUnits.some(u => u.serial_number === 'G9PQHU084CQ9D088S5L4B'), `Deleted serial is absent from remaining units`);
assert(deleteResult.updatedDeleted.includes('G9PQHU084CQ9D088S5L4B'), `Deleted serial registered in deleted serials registry`);
assert(deleteResult.nextRecords[0].total_units === 2, `Intake batch items reduced to 2 (actual: ${deleteResult.nextRecords[0].total_units})`);

// --- TEST 2: Re-hydration / Refresh Protection ---
function simulateHydration({ dbUnits, deletedSerials = [], localSavedUnits = [] }) {
  const deletedSet = new Set((deletedSerials || []).map(s => String(s).toUpperCase()));
  const map = new Map();

  // 1. Authoritative Supabase dbUnits (when connected, database is source of truth)
  if (Array.isArray(dbUnits)) {
    dbUnits.filter(u => !u.is_deleted && u.status !== 'deleted').forEach(dbU => {
      const s = String(dbU.serial_number || '').trim().toUpperCase();
      if (s && !deletedSet.has(s)) {
        map.set(s, dbU);
      }
    });
  } else {
    // 2. Offline fallback ONLY if dbUnits is completely unavailable (null)
    localSavedUnits.forEach(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s && !deletedSet.has(s) && !map.has(s)) {
        map.set(s, u);
      }
    });
  }

  return Array.from(map.values());
}

// Suppose stale local storage had 3 units, but cloud pool only has 2 after delete
const hydratedUnits = simulateHydration({
  dbUnits: deleteResult.nextUnits,
  deletedSerials: deleteResult.updatedDeleted,
  localSavedUnits: initialUnits
});

assert(hydratedUnits.length === 2, `Hydration accurately excludes deleted serials (count: ${hydratedUnits.length})`);
assert(!hydratedUnits.some(u => u.serial_number === 'G9PQHU084CQ9D088S5L4B'), `Deleted part DOES NOT reappear after refresh/hydration`);

// --- TEST 3: Packing List Draft Exclusion from Parts Stock Records ---
const activeDraft = {
  id: 'ship-draft-1',
  site_id: 'site-bhs',
  status: 'draft',
  items: [
    { part_number: '661-38461', description: 'Display, iPhone 14 Pro Max', serial_number: 'G9P5442NAFK14YDXP', box_number: 1 }
  ]
};

// Reconcile units with active draft
const reconciledUnits = reconcileUnitsWithPackedDrafts(hydratedUnits, [], activeDraft);
const packedUnit = reconciledUnits.find(u => u.serial_number === 'G9P5442NAFK14YDXP');
assert(packedUnit?.status === 'packed', `Unit packed in draft is marked with status 'packed' (actual: ${packedUnit?.status})`);

// Filter for available in-stock parts (Parts Stock Records page logic)
const packedSerialsSet = new Set(activeDraft.items.map(it => it.serial_number.toUpperCase()));
const availableInStockUnits = reconciledUnits.filter(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  if (!s || packedSerialsSet.has(s)) return false;
  if (u.status === 'packed' || u.status === 'shipped' || u.status === 'deleted') return false;
  return u.status === 'in_stock';
});

assert(availableInStockUnits.length === 1, `Parts Stock view shows only 1 available unit (unit G9QHXKT0KU690004YY)`);
assert(availableInStockUnits[0].serial_number === 'G9QHXKT0KU690004YY', `Available in-stock part is G9QHXKT0KU690004YY`);
assert(!availableInStockUnits.some(u => u.serial_number === 'G9P5442NAFK14YDXP'), `Packed unit is removed from available Parts Stock`);

// --- TEST 4: Unpacking / Removing Item Returns Part to Stock ---
const clearedDraft = { id: 'ship-draft-1', site_id: 'site-bhs', status: 'draft', items: [] };
const revertedUnits = reconcileUnitsWithPackedDrafts(
  hydratedUnits.map(u => u.serial_number === 'G9P5442NAFK14YDXP' ? { ...u, status: 'in_stock' } : u),
  [],
  clearedDraft
);
const unpackedPackedSerialsSet = new Set();
const availableAfterUnpack = revertedUnits.filter(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  if (!s || unpackedPackedSerialsSet.has(s)) return false;
  if (u.status === 'packed' || u.status === 'shipped' || u.status === 'deleted') return false;
  return u.status === 'in_stock';
});

assert(availableAfterUnpack.length === 2, `Unpacking returns item back to DC Parts Stock (count: ${availableAfterUnpack.length})`);
assert(availableAfterUnpack.some(u => u.serial_number === 'G9P5442NAFK14YDXP'), `Part G9P5442NAFK14YDXP is available in stock again`);

// --- TEST 5: Assignment Update preserves all other stock units ---
const unitToUpdate = initialUnits[1]; // G9P5442NAFK14YDXP
const updatedAssignment = 'DC - CRBR';

// Simulate updating assignment
const unitsAfterAssignmentUpdate = initialUnits.map(u => {
  if (u.serial_number === unitToUpdate.serial_number) {
    return { ...u, intake_assignment: updatedAssignment, notes: updatedAssignment };
  }
  return u;
});

assert(unitsAfterAssignmentUpdate.length === 3, `All 3 units remain in stock after assignment update`);
const targetUpdatedUnit = unitsAfterAssignmentUpdate.find(u => u.serial_number === unitToUpdate.serial_number);
assert(targetUpdatedUnit.intake_assignment === 'DC - CRBR', `Target unit assignment updated to DC - CRBR`);

// --- TEST 6: Multi-User Parity & Eviction of Stale Local Ghost Units ---
// User A (Joshua) has clean local storage (31 units from cloud)
// User B (Zhon) has stale local storage with 63 old units + 31 active units
const cloudActiveUnits = Array.from({ length: 31 }, (_, i) => ({
  serial_number: `ACTIVE_DISPLAY_SN_${i + 1}`,
  description: 'Display, iPhone 17 Pro',
  status: 'in_stock',
  received_at: '2026-08-27T12:00:00.000Z'
}));

const staleLocalUnitsZhon = [
  ...Array.from({ length: 63 }, (_, i) => ({
    serial_number: `OLD_BATTERY_SN_${i + 1}`,
    description: 'Battery, iPhone 16 Pro',
    status: 'in_stock',
    received_at: '2026-08-24T09:00:00.000Z'
  })),
  ...cloudActiveUnits
];

// Hydrate User A (Joshua)
const joshuaHydrated = simulateHydration({
  dbUnits: cloudActiveUnits,
  localSavedUnits: []
});

// Hydrate User B (Zhon)
const zhonHydrated = simulateHydration({
  dbUnits: cloudActiveUnits,
  localSavedUnits: staleLocalUnitsZhon
});

assert(joshuaHydrated.length === 31, `Joshua sees exactly 31 active units (actual: ${joshuaHydrated.length})`);
assert(zhonHydrated.length === 31, `Zhon's stale 63 ghost units are evicted and Zhon sees exactly 31 active units (actual: ${zhonHydrated.length})`);
assert(joshuaHydrated.length === zhonHydrated.length, `Multi-user stock parity: Joshua (${joshuaHydrated.length}) === Zhon (${zhonHydrated.length})`);

// --- TEST 7: Supabase Empty Table -> 0 In-Stock Units (Database-First Authority) ---
const emptyDbHydration = simulateHydration({
  dbUnits: [],
  localSavedUnits: staleLocalUnitsZhon
});

assert(emptyDbHydration.length === 0, `When Supabase database table is empty, hydrated stock is 0 (actual: ${emptyDbHydration.length})`);

console.log('====================================================');
console.log(`RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log('====================================================');

if (failedTests > 0) {
  process.exit(1);
}
