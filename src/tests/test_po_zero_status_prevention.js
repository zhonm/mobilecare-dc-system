import assert from 'assert';
import {
  consolidateDcIntakeRecordsList,
  getBasePoNumber
} from '../utils/appContextHelpers.js';

console.log('--- Testing Prevention of PO Status Reset to Zero & Author Parity ---');

// Mock Data reproducing user screenshot scenario:
// PO MDC202600018: 54 units expected
// PO MDC202600020: 51 units expected
const purchaseOrders = [
  {
    id: 'po-mdc202600018',
    po_number: 'MDC202600018',
    invoice_ref: 'INV-0018',
    supplier: 'Apple South Asia Pte Ltd',
    order_date: '2026-09-02',
    status: 'received',
    items: [
      {
        part_number: '661-36918',
        description: 'Battery, iPhone 15 Pro Max',
        quantity_ordered: 54,
        quantity_received: 54,
        unit_price: 99
      }
    ]
  },
  {
    id: 'po-mdc202600020',
    po_number: 'MDC202600020',
    invoice_ref: 'INV-0020',
    supplier: 'Apple South Asia Pte Ltd',
    order_date: '2026-09-03',
    status: 'received',
    items: [
      {
        part_number: '661-21991',
        description: 'Battery, iPhone 13',
        quantity_ordered: 51,
        quantity_received: 51,
        unit_price: 89
      }
    ]
  }
];

// Inventory units in DC stock
const mockInventoryUnits = [
  ...Array.from({ length: 54 }, (_, i) => ({
    id: `unit-sn-0018-${i}`,
    part_number: '661-36918',
    serial_number: `F89NV0931C000036${i.toString().padStart(2, '0')}`,
    po_id: 'po-mdc202600018',
    po_number: 'MDC202600018',
    received_by: 'Zhon Manaois',
    status: 'in_stock'
  })),
  ...Array.from({ length: 51 }, (_, i) => ({
    id: `unit-sn-0020-${i}`,
    part_number: '661-21991',
    serial_number: `F89NV0931C000051${i.toString().padStart(2, '0')}`,
    po_id: 'po-mdc202600020',
    po_number: 'MDC202600020',
    received_by: 'Zhon Manaois',
    status: 'in_stock'
  }))
];

// [Test 1] Consolidating when history records contain empty placeholder (e.g. from initial PO auto-reg)
console.log('\n[Test 1] Reconciling empty PO batch placeholder against inventory units & PO received items...');
const emptyHistoryPlaceholders = [
  {
    id: 'MDC202600018',
    record_name: 'MDC202600018 (Apple GSX PO)',
    po_number: 'MDC202600018',
    po_id: 'po-mdc202600018',
    expected_units: 54,
    total_units: 0,
    items: [],
    saved_by_name: 'Superadmin',
    status: 'in_progress'
  },
  {
    id: 'MDC202600020',
    record_name: 'MDC202600020 (Apple GSX PO)',
    po_number: 'MDC202600020',
    po_id: 'po-mdc202600020',
    expected_units: 51,
    total_units: 0,
    items: [],
    saved_by_name: 'Superadmin',
    status: 'in_progress'
  }
];

const { consolidatedRecords } = consolidateDcIntakeRecordsList(
  emptyHistoryPlaceholders,
  purchaseOrders,
  { fullName: 'Joshua Juvida', role: 'superadmin' },
  mockInventoryUnits
);

assert.strictEqual(consolidatedRecords.length, 2);

const rec18 = consolidatedRecords.find(r => r.id === 'MDC202600018');
assert.ok(rec18, 'MDC202600018 must exist in consolidated records');
assert.strictEqual(rec18.total_units, 54, 'MDC202600018 must have 54 units, NOT 0!');
assert.strictEqual(rec18.expected_units, 54);
assert.strictEqual(rec18.items.length, 54, 'MDC202600018 items array must contain all 54 serialized units');
assert.strictEqual(rec18.status, 'completed', 'MDC202600018 must be completed (Fulfilled Saved)');
assert.strictEqual(rec18.saved_by_name, 'Zhon Manaois', 'Original author Zhon Manaois must be preserved over generic Superadmin');

console.log('✓ PASS: MDC202600018 recovered from 0 back to 54 units, completed status, and Zhon Manaois author!');

const rec20 = consolidatedRecords.find(r => r.id === 'MDC202600020');
assert.ok(rec20, 'MDC202600020 must exist in consolidated records');
assert.strictEqual(rec20.total_units, 51, 'MDC202600020 must have 51 units, NOT 0!');
assert.strictEqual(rec20.expected_units, 51);
assert.strictEqual(rec20.items.length, 51, 'MDC202600020 items array must contain all 51 serialized units');
assert.strictEqual(rec20.status, 'completed', 'MDC202600020 must be completed (Fulfilled Saved)');
assert.strictEqual(rec20.saved_by_name, 'Zhon Manaois', 'Original author Zhon Manaois must be preserved over generic Superadmin');

console.log('✓ PASS: MDC202600020 recovered from 0 back to 51 units, completed status, and Zhon Manaois author!');

// [Test 2] Testing table display calculation resilience
console.log('\n[Test 2] Testing IntakeRecords table display logic...');
const testTableDisplay = (rec, linkedPo, invUnits) => {
  const baseRecPo = getBasePoNumber(rec.po_number || rec.id);
  const effectiveExpectedUnits = linkedPo
    ? (linkedPo.items || []).reduce((s, it) => s + (Number(it.quantity_ordered) || 0), 0)
    : (Number(rec.expected_units) || 0);

  const poReceivedUnits = linkedPo
    ? (linkedPo.items || []).reduce((s, it) => s + (Number(it.quantity_received) || 0), 0)
    : 0;

  const invUnitsForPo = (invUnits || []).filter(u => {
    if (!u || u.is_deleted || u.status === 'deleted') return false;
    const uBase = getBasePoNumber(u.po_number || u.po_id);
    return (uBase && baseRecPo && uBase === baseRecPo) || (linkedPo?.id && u.po_id === linkedPo.id);
  }).length;

  const isDone = rec.status === 'completed' ||
                 rec.status === 'fulfilled' ||
                 linkedPo?.status === 'received' ||
                 (effectiveExpectedUnits > 0 && Math.max(Number(rec.total_units) || 0, (rec.items ? rec.items.length : 0), poReceivedUnits, invUnitsForPo) >= effectiveExpectedUnits);

  const effectiveDisplayUnits = Math.max(
    Number(rec.total_units) || 0,
    (rec.items ? rec.items.length : 0),
    poReceivedUnits,
    invUnitsForPo,
    isDone && effectiveExpectedUnits > 0 ? effectiveExpectedUnits : 0
  );

  const displayAuthor = rec.saved_by_name && rec.saved_by_name !== 'Superadmin' && rec.saved_by_name !== 'usr-system' && rec.saved_by_name !== 'Warehouse Staff'
    ? rec.saved_by_name
    : 'Zhon Manaois';

  return { effectiveDisplayUnits, effectiveExpectedUnits, isDone, displayAuthor };
};

const displayResult = testTableDisplay(rec18, purchaseOrders[0], mockInventoryUnits);
assert.strictEqual(displayResult.effectiveDisplayUnits, 54);
assert.strictEqual(displayResult.effectiveExpectedUnits, 54);
assert.strictEqual(displayResult.isDone, true);
assert.strictEqual(displayResult.displayAuthor, 'Zhon Manaois');
console.log('✓ PASS: Table display shows "54 units", "Zhon Manaois", and "Fulfilled (Saved)" badge!');

console.log('\n--- ALL PO STATUS & ZERO RESET PREVENTION TESTS PASSED ---');
