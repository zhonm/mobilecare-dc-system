import assert from 'assert';

console.log('--- Testing Multi-PO Upload, Parts Saved History Records Auto-Sync & Lifecycle ---');

// Mock localStorage
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

// [Test 1] Multi-PO Upload Simulation
console.log('\n[Test 1] Adding Multiple Purchase Orders to System...');
let purchaseOrders = [];
let dcIntakeRecords = [];

const mockAddPurchaseOrder = (poData) => {
  const newPo = {
    id: poData.id || `po-${Date.now()}-${Math.random()}`,
    po_number: poData.po_number,
    invoice_ref: poData.invoice_ref || null,
    sales_order_no: poData.sales_order_no || null,
    supplier: poData.supplier || 'Apple South Asia Pte Ltd',
    order_date: poData.order_date || '2026-09-07',
    status: 'pending',
    currency: 'USD',
    total_amount: poData.total_amount || 0,
    items: (poData.items || []).map(it => ({
      part_number: it.part_number,
      description: it.description,
      quantity_ordered: it.quantity_ordered,
      quantity_received: 0 // strictly 0
    }))
  };

  purchaseOrders = [newPo, ...purchaseOrders.filter(p => p.id !== newPo.id)];

  // Auto-save to Parts Saved History Records
  const expectedUnits = newPo.items.reduce((s, it) => s + (it.quantity_ordered || 0), 0);
  const initialHistoryRecord = {
    id: newPo.po_number.toUpperCase(),
    record_name: `${newPo.po_number} - ${newPo.invoice_ref || 'GSX PO'}`,
    intake_date: newPo.order_date,
    po_id: newPo.id,
    po_number: newPo.po_number,
    invoice_ref: newPo.invoice_ref,
    status: 'in_progress',
    items: [], // strictly empty initially!
    expected_units: expectedUnits,
    total_units: 0
  };

  dcIntakeRecords = [initialHistoryRecord, ...dcIntakeRecords.filter(r => r.id !== initialHistoryRecord.id)];
  return newPo;
};

// Upload PO #1: MD04136487 (4 units)
const po1 = mockAddPurchaseOrder({
  po_number: 'MDC202600024',
  invoice_ref: 'MD04136487',
  items: [
    { part_number: '661-42837', description: 'SVC,IPHONE 16 PLUS,BATTERY', quantity_ordered: 1 },
    { part_number: '661-44554', description: 'SVC,IPHONE 16 PRO MAX,BATTERY', quantity_ordered: 1 },
    { part_number: '661-56044', description: 'SVC,IPHONE 17,BATTERY', quantity_ordered: 1 },
    { part_number: '661-55235', description: 'SVC,IPHONE AIR,BATTERY', quantity_ordered: 1 }
  ]
});

// Upload PO #2: MD04136490 (2 units)
const po2 = mockAddPurchaseOrder({
  po_number: 'MDC202600025',
  invoice_ref: 'MD04136490',
  items: [
    { part_number: '661-21996', description: 'SVC,BATTERY,IPHONE 13 PRO', quantity_ordered: 2 }
  ]
});

assert.strictEqual(purchaseOrders.length, 2, 'Should have 2 purchase orders');
assert.strictEqual(dcIntakeRecords.length, 2, 'Should have 2 records in Parts Saved History Records');

// Verify initial state: zero received, zero pre-existing stock attached
assert.strictEqual(po1.status, 'pending');
assert.strictEqual(po1.items[0].quantity_received, 0);
assert.strictEqual(dcIntakeRecords.find(r => r.po_number === 'MDC202600024').items.length, 0);
assert.strictEqual(dcIntakeRecords.find(r => r.po_number === 'MDC202600024').total_units, 0);
assert.strictEqual(dcIntakeRecords.find(r => r.po_number === 'MDC202600024').expected_units, 4);
console.log('  ✓ PASS: Both POs uploaded with 0 received units and auto-saved in Parts Saved History Records');

// [Test 2] Scanning arriving parts under PO #1
console.log('\n[Test 2] Scanning arriving parts under PO MDC202600024...');
const mockScanInUnit = (pn, sn, poId) => {
  const newUnit = {
    id: `unit-${sn}`,
    part_number: pn,
    serial_number: sn,
    received_at: new Date().toISOString()
  };

  // Update PO received quantity
  let matchedPoNumber = null;
  purchaseOrders = purchaseOrders.map(po => {
    if (po.id === poId || po.po_number === poId) {
      matchedPoNumber = po.po_number;
      const updatedItems = po.items.map(it => {
        if (it.part_number === pn) {
          return { ...it, quantity_received: it.quantity_received + 1 };
        }
        return it;
      });
      const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
      return {
        ...po,
        items: updatedItems,
        status: allReceived ? 'received' : 'partially_received'
      };
    }
    return po;
  });

  // Automatically record under Parts Saved History Records
  dcIntakeRecords = dcIntakeRecords.map(rec => {
    if (rec.po_id === poId || rec.po_number === matchedPoNumber || rec.po_number === poId) {
      const updatedItems = [newUnit, ...rec.items];
      const isAllDone = rec.expected_units ? updatedItems.length >= rec.expected_units : false;
      return {
        ...rec,
        items: updatedItems,
        total_units: updatedItems.length,
        status: isAllDone ? 'completed' : 'in_progress'
      };
    }
    return rec;
  });

  return newUnit;
};

// Scan part 1 of PO #1
mockScanInUnit('661-42837', 'C02ABC123456', po1.id);
let historyBatch1 = dcIntakeRecords.find(r => r.po_number === 'MDC202600024');
let currentPo1 = purchaseOrders.find(p => p.id === po1.id);

assert.strictEqual(currentPo1.status, 'partially_received');
assert.strictEqual(currentPo1.items[0].quantity_received, 1);
assert.strictEqual(historyBatch1.items.length, 1);
assert.strictEqual(historyBatch1.items[0].serial_number, 'C02ABC123456');
assert.strictEqual(historyBatch1.total_units, 1);
console.log('  ✓ PASS: Scanned part 1 automatically recorded under PO batch in Parts Saved History Records');

// Scan parts 2, 3, and 4 of PO #1 to complete it
mockScanInUnit('661-44554', 'C02DEF234567', po1.id);
mockScanInUnit('661-56044', 'C02GHI345678', po1.id);
mockScanInUnit('661-55235', 'C02JKL456789', po1.id);

currentPo1 = purchaseOrders.find(p => p.id === po1.id);
historyBatch1 = dcIntakeRecords.find(r => r.po_number === 'MDC202600024');

assert.strictEqual(currentPo1.status, 'received', 'PO #1 should be fully received');
assert.strictEqual(historyBatch1.total_units, 4, 'History batch should have 4 units');
assert.strictEqual(historyBatch1.status, 'completed', 'History batch status should be completed');
console.log('  ✓ PASS: All 4 parts scanned, PO status transitioned to received, history batch marked completed');

// [Test 3] Deleting Completed PO from active tracking
console.log('\n[Test 3] Deleting completed PO from active tracking while preserving history...');
const mockDeletePurchaseOrder = (poId) => {
  const targetPo = purchaseOrders.find(p => p.id === poId);
  purchaseOrders = purchaseOrders.filter(p => p.id !== poId);

  // Preserve in dcIntakeRecords with completed/archived status
  if (targetPo) {
    dcIntakeRecords = dcIntakeRecords.map(r => {
      if (r.po_id === poId || r.po_number === targetPo.po_number) {
        return {
          ...r,
          status: 'completed',
          notes: `${r.notes || ''} (PO completed & archived from active tracking)`.trim()
        };
      }
      return r;
    });
  }
};

mockDeletePurchaseOrder(po1.id);

// Active POs should only have PO #2 remaining
assert.strictEqual(purchaseOrders.length, 1, 'Active POs should have 1 order left');
assert.strictEqual(purchaseOrders[0].po_number, 'MDC202600025');

// Historical batch in dcIntakeRecords MUST still exist with all 4 serials!
const preservedBatch = dcIntakeRecords.find(r => r.po_number === 'MDC202600024');
assert.ok(preservedBatch, 'Historical batch for MDC202600024 must remain in Parts Saved History Records');
assert.strictEqual(preservedBatch.total_units, 4);
assert.strictEqual(preservedBatch.items.length, 4);
assert.strictEqual(preservedBatch.items[0].serial_number, 'C02JKL456789');
assert.strictEqual(preservedBatch.items[3].serial_number, 'C02ABC123456');
console.log('  ✓ PASS: Completed PO deleted from active tracking, all 4 serials safely preserved in Parts Saved History Records!');

console.log('\n--- ALL MULTI-PO & HISTORY RECORDS SYNC TESTS PASSED (100%) ---');
