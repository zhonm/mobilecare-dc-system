import assert from 'assert';
import {
  consolidateDcIntakeRecordsList
} from '../utils/appContextHelpers.js';

console.log('====================================================================');
console.log('TEST SUITE: PO Structure Enforcement & SVC/Non-SVC Duplication Defense');
console.log('====================================================================\n');

// --- Test 1: Real Scanned Units Replace Generated Units 1-for-1 (No 56-unit doubling!) ---
console.log('--- Test 1: Real Scanned Units (Non-SVC) Replace Generated Placeholders (SVC) 1-for-1 ---');

const po18 = {
  id: 'po-mdc20260001801',
  po_number: 'MDC20260001801',
  invoice_ref: 'MD03875753',
  supplier: 'Apple South Asia Pte Ltd',
  order_date: '2026-09-08',
  status: 'received',
  items: [
    {
      part_number: '661-23646',
      description: 'SVC,BATTERY,IPHONE 13',
      quantity_ordered: 28,
      quantity_received: 28,
      unit_price: 99
    }
  ]
};

// Initial auto-saved record from GSX PO upload (has 28 generated placeholder units with SVC description)
const initialPoRecord = {
  id: 'MDC20260001801',
  record_name: 'MDC20260001801 (Apple GSX PO)',
  po_id: 'po-mdc20260001801',
  po_number: 'MDC20260001801',
  intake_date: '2026-09-08',
  expected_units: 28,
  total_units: 28,
  status: 'in_progress',
  items: Array.from({ length: 28 }, (_, i) => ({
    id: `unit-mdc20260001801-661-23646-${i}`,
    part_number: '661-23646',
    description: 'SVC,BATTERY,IPHONE 13',
    serial_number: `F8Y6280001801${i.toString().padStart(4, '0')}`,
    is_generated: true,
    po_number: 'MDC20260001801'
  }))
};

// Real physically scanned units in inventoryUnits (scanned with parts catalog description without SVC)
const realScannedInventoryUnits = Array.from({ length: 28 }, (_, i) => ({
  id: `real-uuid-${i}`,
  part_number: '661-23646',
  description: 'Battery, iPhone 13', // Scanned from catalog without "SVC,"
  serial_number: `F8Y6305C84E18FK${i.toString().padStart(2, '0')}`, // Real scanned serials
  po_number: 'MDC20260001801',
  po_id: 'po-mdc20260001801',
  is_generated: false,
  status: 'in_stock'
}));

const { consolidatedRecords: result1 } = consolidateDcIntakeRecordsList(
  [initialPoRecord],
  [po18],
  { fullName: 'Zhon Manaois' },
  realScannedInventoryUnits
);

assert.strictEqual(result1.length, 1, 'Should consolidate to exactly 1 record');
const rec1 = result1[0];

assert.strictEqual(rec1.id, 'MDC20260001801', 'Canonical ID must match PO');
assert.strictEqual(rec1.total_units, 28, 'Total units MUST be exactly 28 (NOT doubled to 56!)');
assert.strictEqual(rec1.items.length, 28, 'Items array MUST contain exactly 28 units (NOT 56!)');

// Check that all 28 units have the official PO description 'SVC,BATTERY,IPHONE 13' (NO split between SVC and Non-SVC)
const svcDescriptions = new Set(rec1.items.map(it => it.description));
assert.strictEqual(svcDescriptions.size, 1, 'All units must share 1 unified description matching the PO structure');
assert.strictEqual(Array.from(svcDescriptions)[0], 'SVC,BATTERY,IPHONE 13', 'Description must follow PO structure (SVC,BATTERY,IPHONE 13)');

// Verify that all 28 units contain the REAL scanned serial numbers from inventoryUnits
const serials = rec1.items.map(it => it.serial_number);
assert.strictEqual(serials.length, 28);
assert.ok(serials[0].startsWith('F8Y6305C84E18FK'), 'Must retain authentic scanned serial numbers');

console.log('  ✓ PASS: Exactly 28 units recorded (Zero doubling, placeholders replaced 1-for-1)');
console.log('  ✓ PASS: Unified PO description "SVC,BATTERY,IPHONE 13" applied to all units (Zero SVC/Non-SVC split)');
console.log('  ✓ PASS: 100% authentic scanned serial numbers preserved');

// --- Test 2: Partial Scans Retain Scanned Units + Fill Remaining with Placeholders up to PO Qty ---
console.log('\n--- Test 2: Partial Scans (10 Scanned / 28 Ordered) -> Exactly 28 Units Total ---');

const partialScannedUnits = realScannedInventoryUnits.slice(0, 10);
const { consolidatedRecords: result2 } = consolidateDcIntakeRecordsList(
  [initialPoRecord],
  [po18],
  { fullName: 'Zhon Manaois' },
  partialScannedUnits
);

const rec2 = result2[0];
assert.strictEqual(rec2.total_units, 28, 'Partial scan must still cap to expected 28 units');
assert.strictEqual(rec2.items.length, 28, 'Items length must be exactly 28');

const realCount = rec2.items.filter(it => !it.is_generated).length;
const genCount = rec2.items.filter(it => it.is_generated).length;
assert.strictEqual(realCount, 10, 'Must have 10 real scanned units');
assert.strictEqual(genCount, 18, 'Must have 18 placeholder units for remainder');

// All 28 units still follow the PO structure description
rec2.items.forEach(it => {
  assert.strictEqual(it.description, 'SVC,BATTERY,IPHONE 13');
});
console.log('  ✓ PASS: 10 real units + 18 placeholders = exactly 28 units total with unified description');

// --- Test 3: Composite Row "MDC202600022 AND MDC202600024" is Purged ---
console.log('\n--- Test 3: Purging Obsolete Composite Record "MDC202600022 AND MDC202600024" ---');

const compositeRecord = {
  id: 'MDC202600022 AND MDC202600024',
  record_name: 'MDC202600022 AND MDC202600024',
  intake_date: '2026-09-08',
  total_units: 29,
  items: []
};

const po22 = {
  id: 'po-mdc202600022',
  po_number: 'MDC202600022',
  order_date: '2026-09-08',
  status: 'received',
  items: [{ part_number: '661-30382', description: 'SVC,BATTERY,IPHONE 14', quantity_ordered: 30 }]
};

const po24 = {
  id: 'po-mdc202600024',
  po_number: 'MDC202600024',
  order_date: '2026-09-08',
  status: 'received',
  items: [{ part_number: '661-42837', description: 'SVC,BATTERY,IPHONE 16', quantity_ordered: 30 }]
};

const { consolidatedRecords: result3, obsoleteIdsToPurge } = consolidateDcIntakeRecordsList(
  [compositeRecord],
  [po22, po24],
  { fullName: 'Zhon Manaois' },
  []
);

assert.ok(obsoleteIdsToPurge.includes('MDC202600022 AND MDC202600024'), 'Composite record must be marked for purge');
const foundComposite = result3.find(r => r.id.includes(' AND '));
assert.strictEqual(foundComposite, undefined, 'Composite record must NOT be in consolidated records');
console.log('  ✓ PASS: Composite record correctly purged and omitted from history list');

// --- Test 4: Deduplicate Batches by Canonical ID (No Duplicate MDC202600021) ---
console.log('\n--- Test 4: Deduplicating Batches by Canonical ID ---');

const duplicateRecords = [
  {
    id: 'MDC202600021',
    record_name: 'MDC202600021',
    total_units: 24,
    items: []
  },
  {
    id: 'MDC202600021',
    record_name: 'MDC202600021 (Apple GSX PO)',
    total_units: 1,
    items: []
  }
];

const po21 = {
  id: 'po-mdc202600021',
  po_number: 'MDC202600021',
  order_date: '2026-09-08',
  items: [{ part_number: '661-23646', description: 'SVC,BATTERY,IPHONE 13', quantity_ordered: 1 }]
};

const { consolidatedRecords: result4 } = consolidateDcIntakeRecordsList(
  duplicateRecords,
  [po21],
  { fullName: 'Zhon Manaois' },
  []
);

const mdc21Matches = result4.filter(r => r.id === 'MDC202600021');
assert.strictEqual(mdc21Matches.length, 1, 'MDC202600021 must appear EXACTLY ONCE in consolidated history');
console.log('  ✓ PASS: MDC202600021 appears exactly once (Zero duplicate rows)');

console.log('\n====================================================================');
console.log('ALL PO STRUCTURE & DEDUPLICATION TESTS COMPLETED');
console.log('====================================================================\n');
