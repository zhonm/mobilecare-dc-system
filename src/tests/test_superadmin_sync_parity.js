import assert from 'assert';
import {
  parseDcIntakeRecordFromDb,
  formatDcIntakeRecordForDb,
  consolidateDcIntakeRecordsList
} from '../utils/appContextHelpers.js';

console.log('--- Testing Superadmin Synchronization Parity & Intake Record Helpers ---');

// [Test 1] Verify parseDcIntakeRecordFromDb parses direct Supabase database rows correctly
console.log('\n[Test 1] Testing parseDcIntakeRecordFromDb...');
const mockDbRow = {
  id: 'MDC202600018',
  record_name: 'MDC202600018 (Apple GSX PO)',
  intake_date: '2026-09-02',
  po_id: 'po-mdc202600018',
  po_number: 'MDC202600018',
  supplier: 'Apple South Asia Pte Ltd',
  total_units: 54,
  saved_by_name: 'Zhon Manaois',
  saved_by_user_id: '00000000-0000-0000-0000-000000000001',
  notes: 'Received batch',
  category_breakdown: { Battery: 54 },
  items: Array.from({ length: 54 }, (_, i) => ({
    part_number: '661-36918',
    description: 'Battery, iPhone 15 Pro Max',
    serial_number: `F89NV0931C000036${i.toString().padStart(2, '0')}`,
    stocking_price: 99,
    intake_assignment: 'MDC - Forecasting'
  })),
  created_at: '2026-09-02T10:00:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z'
};

const parsed = parseDcIntakeRecordFromDb(mockDbRow);
assert.strictEqual(parsed.id, 'MDC202600018');
assert.strictEqual(parsed.record_name, 'MDC202600018 (Apple GSX PO)');
assert.strictEqual(parsed.total_units, 54);
assert.strictEqual(parsed.items.length, 54);
assert.strictEqual(parsed.saved_by_name, 'Zhon Manaois');
assert.strictEqual(parsed.status, 'completed');
assert.strictEqual(parsed.total_value, 54 * 99);
console.log('✓ parseDcIntakeRecordFromDb parsed 54 units correctly with status completed and full items list.');

// [Test 2] Verify formatDcIntakeRecordForDb and parseDcIntakeRecordFromDb round-trip
console.log('\n[Test 2] Testing format & parse round-trip...');
const formatted = formatDcIntakeRecordForDb(parsed);
assert.strictEqual(formatted.id, 'MDC202600018');
assert.strictEqual(formatted.total_units, 54);
assert.strictEqual(formatted.items.length, 54);

const roundTripped = parseDcIntakeRecordFromDb(formatted);
assert.strictEqual(roundTripped.id, parsed.id);
assert.strictEqual(roundTripped.total_units, parsed.total_units);
assert.strictEqual(roundTripped.items.length, parsed.items.length);
assert.strictEqual(roundTripped.saved_by_name, parsed.saved_by_name);
console.log('✓ Format and parse round-trip successful with full parity.');

// [Test 3] Simulating Cross-Superadmin Session Parity
console.log('\n[Test 3] Simulating Superadmin 1 (Zhon) saving batch and Superadmin 2 (Joshua) hydration...');
// Zhon creates 2 PO batches + 1 Direct Receiving batch (total 243 units)
const zhonRecords = [
  {
    id: 'MDC202600018',
    record_name: 'MDC202600018 (Apple GSX PO)',
    po_number: 'MDC202600018',
    total_units: 54,
    items: Array.from({ length: 54 }, (_, i) => ({ serial_number: `SER-18-${i}`, part_number: '661-36918' })),
    saved_by_name: 'Zhon Manaois'
  },
  {
    id: 'MDC202600020',
    record_name: 'MDC202600020 (Apple GSX PO)',
    po_number: 'MDC202600020',
    total_units: 51,
    items: Array.from({ length: 51 }, (_, i) => ({ serial_number: `SER-20-${i}`, part_number: '661-36919' })),
    saved_by_name: 'Zhon Manaois'
  },
  {
    id: 'DIRECT-20260903',
    record_name: 'Direct Receiving (Apple)',
    po_number: null,
    total_units: 98,
    items: Array.from({ length: 98 }, (_, i) => ({ serial_number: `SER-DIR-${i}`, part_number: '661-36920' })),
    saved_by_name: 'Joshua Juvida'
  }
];

// Joshua's session loads without error
const intakeMap = new Map();
// 1. Direct table rows parsed without crashing
zhonRecords.forEach(r => {
  const p = parseDcIntakeRecordFromDb(r);
  intakeMap.set(p.id, p);
});

assert.strictEqual(intakeMap.size, 3);
const totalUnitsJoshua = Array.from(intakeMap.values()).reduce((sum, r) => sum + r.items.length, 0);
assert.strictEqual(totalUnitsJoshua, 54 + 51 + 98);
console.log(`✓ Joshua's session successfully parsed all batches across superadmins (${totalUnitsJoshua} units).`);

// [Test 4] Consolidation preserves all items and authors
console.log('\n[Test 4] Verifying consolidateDcIntakeRecordsList preserves items and batch authors...');
const purchaseOrders = [
  { id: 'po-mdc202600018', po_number: 'MDC202600018', items: [{ part_number: '661-36918', quantity_ordered: 54 }] },
  { id: 'po-mdc202600020', po_number: 'MDC202600020', items: [{ part_number: '661-36919', quantity_ordered: 51 }] }
];

const { consolidatedRecords } = consolidateDcIntakeRecordsList(Array.from(intakeMap.values()), purchaseOrders);
assert.strictEqual(consolidatedRecords.length, 3);
const batch18 = consolidatedRecords.find(r => r.po_number === 'MDC202600018');
assert.strictEqual(batch18.total_units, 54);
assert.strictEqual(batch18.status, 'completed');
assert.strictEqual(batch18.saved_by_name, 'Zhon Manaois');

const dirBatch = consolidatedRecords.find(r => r.id === 'DIRECT-20260903');
assert.strictEqual(dirBatch.total_units, 98);
assert.strictEqual(dirBatch.saved_by_name, 'Joshua Juvida');

console.log('✓ Consolidated records accurately retained all 3 batches, items, and original recording authors.');
console.log('\n--- ALL SUPERADMIN SYNC PARITY TESTS PASSED ---');
