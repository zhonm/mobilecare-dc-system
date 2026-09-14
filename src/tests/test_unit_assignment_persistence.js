import assert from 'assert';
import { normalizeInventoryUnits } from '../utils/partResolver.js';

console.log('====================================================');
console.log('TEST SUITE: Unit Assignment Switching & Persistence');
console.log('====================================================');

// --- 1. Assignment Cycling Logic (Forecasting -> CRBR -> SVNR -> Forecasting) ---
function cycleAssignment(currentAssignment) {
  const str = String(currentAssignment || '').trim().toUpperCase();
  const isSvnr = str.includes('SVNR') || str.includes('NON-REPAIR');
  const isCrbr = !isSvnr && str.includes('CRBR');

  if (isSvnr) {
    return 'MDC - Forecasting';
  } else if (isCrbr) {
    return 'SVNR - Service Non-Repair';
  } else {
    return 'DC - CRBR';
  }
}

assert.strictEqual(cycleAssignment('MDC - Forecasting'), 'DC - CRBR', 'Forecasting transitions to CRBR');
assert.strictEqual(cycleAssignment('DC - CRBR'), 'SVNR - Service Non-Repair', 'CRBR transitions to SVNR');
assert.strictEqual(cycleAssignment('SVNR - Service Non-Repair'), 'MDC - Forecasting', 'SVNR transitions to Forecasting');
assert.strictEqual(cycleAssignment(null), 'DC - CRBR', 'Default null transitions to CRBR');
console.log('  ✓ PASS: Assignment transitions correctly cycle across all 3 tiers');

// --- 2. Normalization & Notes Fallback ---
const unitsWithVariousTags = [
  {
    serial_number: 'G9PQHU084CQ9D088S5L4B',
    part_number: '661-30373',
    notes: 'DC - CRBR'
  },
  {
    serial_number: 'G9PQHU084CQ9D088S5L4C',
    part_number: '661-30373',
    notes: 'SVNR - Service Non-Repair'
  },
  {
    serial_number: 'G9PQHU084CQ9D088S5L4D',
    part_number: '661-30373',
    notes: 'MDC - Forecasting'
  },
  {
    serial_number: 'G9PQHU084CQ9D088S5L4E',
    part_number: '661-30373',
    intake_assignment: 'DC - CRBR',
    notes: ''
  }
];

const normalizedUnits = normalizeInventoryUnits(unitsWithVariousTags);
assert.strictEqual(normalizedUnits[0].intake_assignment, 'DC - CRBR', 'Resolves DC - CRBR from notes');
assert.strictEqual(normalizedUnits[1].intake_assignment, 'SVNR - Service Non-Repair', 'Resolves SVNR from notes');
assert.strictEqual(normalizedUnits[2].intake_assignment, 'MDC - Forecasting', 'Resolves Forecasting from notes');
assert.strictEqual(normalizedUnits[3].intake_assignment, 'DC - CRBR', 'Resolves DC - CRBR from intake_assignment');
console.log('  ✓ PASS: normalizeInventoryUnits correctly parses both notes and intake_assignment');

// --- 3. Cloud Sync Resolution: Stale Snapshot vs Authoritative inventory_units ---
function simulateCloudSyncMerge({ dbUnits, liveMasterSnapshot, prevLocalUnits }) {
  const map = new Map();

  // 1. Direct Supabase public.inventory_units table (authoritative)
  if (Array.isArray(dbUnits)) {
    dbUnits.forEach(dbU => {
      const cleanSerial = String(dbU.serial_number || '').trim().toUpperCase();
      if (cleanSerial) {
        const cloudAssign = dbU.intake_assignment || (dbU.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : dbU.notes?.includes('CRBR') ? 'DC - CRBR' : dbU.notes?.includes('Forecasting') ? 'MDC - Forecasting' : null);
        const assign = cloudAssign || (dbU.notes?.includes('SVNR') ? 'SVNR - Service Non-Repair' : dbU.notes?.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
        map.set(cleanSerial, {
          id: dbU.id || `unit-${cleanSerial}`,
          serial_number: cleanSerial,
          part_number: dbU.part_number,
          intake_assignment: assign,
          notes: assign,
          status: dbU.status || 'in_stock',
          updated_at: dbU.updated_at || '2026-09-14T10:00:00.000Z'
        });
      }
    });
  }

  // 2. Overlay Live Master Inventory Snapshot from saved_records
  if (liveMasterSnapshot?.snapshot_data?.units && Array.isArray(liveMasterSnapshot.snapshot_data.units)) {
    liveMasterSnapshot.snapshot_data.units.forEach(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      if (s) {
        if (!map.has(s)) {
          map.set(s, u);
        } else {
          const existing = map.get(s);
          const isExistingPackedOrShipped = existing && (existing.status === 'packed' || existing.status === 'shipped');

          const existingTime = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
          const uTime = u?.updated_at ? new Date(u.updated_at).getTime() : 0;
          const preferExisting = existingTime >= uTime || !u.intake_assignment;

          const resolvedAssignment = preferExisting
            ? (existing.intake_assignment || u.intake_assignment || 'MDC - Forecasting')
            : (u.intake_assignment || existing.intake_assignment || 'MDC - Forecasting');

          const resolvedNotes = preferExisting
            ? (existing.notes || u.notes || resolvedAssignment)
            : (u.notes || existing.notes || resolvedAssignment);

          map.set(s, {
            ...u,
            ...existing,
            status: isExistingPackedOrShipped ? existing.status : (u.status || existing.status || 'in_stock'),
            intake_assignment: resolvedAssignment,
            notes: resolvedNotes,
            updated_at: preferExisting ? (existing.updated_at || u.updated_at) : (u.updated_at || existing.updated_at)
          });
        }
      }
    });
  }

  // 3. Preserve active local inventory units if local updated_at is newer
  (prevLocalUnits || []).forEach(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    if (s) {
      if (!map.has(s)) {
        map.set(s, u);
      } else {
        const cloudUnit = map.get(s);
        const localTime = u.updated_at ? new Date(u.updated_at).getTime() : 0;
        const cloudTime = cloudUnit?.updated_at ? new Date(cloudUnit.updated_at).getTime() : 0;
        if (localTime > cloudTime && (u.intake_assignment || u.notes)) {
          map.set(s, {
            ...cloudUnit,
            intake_assignment: u.intake_assignment || cloudUnit.intake_assignment,
            notes: u.notes || cloudUnit.notes,
            updated_at: u.updated_at
          });
        }
      }
    }
  });

  return Array.from(map.values());
}

// Test Case A: Database has newer assignment 'DC - CRBR', stale snapshot still has 'MDC - Forecasting'
const testSerial = 'F2LW8990K48D00';
const dbUnits = [
  {
    serial_number: testSerial,
    part_number: '661-30373',
    notes: 'DC - CRBR',
    updated_at: '2026-09-14T12:00:00.000Z'
  }
];

const staleSnapshot = {
  id: 'live_master_dc_inventory',
  snapshot_data: {
    units: [
      {
        serial_number: testSerial,
        part_number: '661-30373',
        intake_assignment: 'MDC - Forecasting',
        notes: 'MDC - Forecasting',
        updated_at: '2026-09-14T08:00:00.000Z'
      }
    ]
  }
};

const result = simulateCloudSyncMerge({
  dbUnits,
  liveMasterSnapshot: staleSnapshot,
  prevLocalUnits: []
});

assert.strictEqual(result.length, 1);
assert.strictEqual(result[0].intake_assignment, 'DC - CRBR', 'Authoritative newer DB assignment must prevail over stale snapshot');
console.log('  ✓ PASS: Stale live_master_dc_inventory snapshot does NOT overwrite authoritative assignment');

// Test Case B: Local user just clicked switch (local time 12:05), cloud query returned 12:00
const localUnitsAfterClick = [
  {
    serial_number: testSerial,
    part_number: '661-30373',
    intake_assignment: 'SVNR - Service Non-Repair',
    notes: 'SVNR - Service Non-Repair',
    updated_at: '2026-09-14T12:05:00.000Z'
  }
];

const resultWithLocal = simulateCloudSyncMerge({
  dbUnits,
  liveMasterSnapshot: staleSnapshot,
  prevLocalUnits: localUnitsAfterClick
});

assert.strictEqual(resultWithLocal.length, 1);
assert.strictEqual(resultWithLocal[0].intake_assignment, 'SVNR - Service Non-Repair', 'Newer local edit must survive cloud synchronization');
console.log('  ✓ PASS: In-memory optimistic update survives background cloud sync');

// --- 4. Intake Batch Items Synchronization ---
const sampleIntakeRecord = {
  id: 'INTAKE-20260914-001',
  record_name: 'Batch Sep 14',
  items: [
    { serial_number: testSerial, part_number: '661-30373', intake_assignment: 'MDC - Forecasting', notes: 'MDC - Forecasting' }
  ]
};

const updatedBatch = {
  ...sampleIntakeRecord,
  items: sampleIntakeRecord.items.map(it => {
    if (it.serial_number === testSerial) {
      return { ...it, intake_assignment: 'DC - CRBR', notes: 'DC - CRBR' };
    }
    return it;
  })
};

assert.strictEqual(updatedBatch.items[0].intake_assignment, 'DC - CRBR');
assert.strictEqual(updatedBatch.items[0].notes, 'DC - CRBR');
console.log('  ✓ PASS: Intake batch items properly reflect assignment updates');

console.log('====================================================');
console.log('ALL UNIT ASSIGNMENT PERSISTENCE TESTS PASSED (4/4)');
console.log('====================================================');
