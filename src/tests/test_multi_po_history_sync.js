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

// [Test 4] Cross-PO Auto-Routing without Manual Selection
console.log('\n[Test 4] Testing Cross-PO Auto-Routing without Manual PO Linking...');

// Intelligent routing function matching useInventory.js
const smartResolvePo = (cleanPN, explicitPoId) => {
  let matchedPo = null;
  let isAutoRouted = false;

  if (explicitPoId) {
    const explicitPo = purchaseOrders.find(p => p.id === explicitPoId || p.po_number === explicitPoId);
    const hasPartWithCapacity = explicitPo && explicitPo.status !== 'received' && explicitPo.items?.some(it => 
      it.part_number === cleanPN && (it.quantity_received || 0) < (it.quantity_ordered || 0)
    );
    if (hasPartWithCapacity) {
      matchedPo = explicitPo;
    }
  }

  if (!matchedPo) {
    const candidatePo = purchaseOrders.find(p => 
      p.status !== 'received' &&
      p.items?.some(it => it.part_number === cleanPN && (it.quantity_received || 0) < (it.quantity_ordered || 0))
    );
    if (candidatePo) {
      matchedPo = candidatePo;
      isAutoRouted = true;
    }
  }

  return { matchedPo, isAutoRouted };
};

// Scan part for PO #2 ('MDC202600025') while explicitPoId is null (Auto-detect mode)
const scanResultAuto = smartResolvePo('661-21996', null);
assert.ok(scanResultAuto.matchedPo, 'Should find candidate PO for 661-21996');
assert.strictEqual(scanResultAuto.matchedPo.po_number, 'MDC202600025');
assert.strictEqual(scanResultAuto.isAutoRouted, true);
console.log('  ✓ PASS: Auto-detect correctly identified PO MDC202600025 for 661-21996 without manual linking');

// Even if user passed a mismatched/deleted PO ID, smartResolvePo auto-routes to the right PO!
const scanResultMismatched = smartResolvePo('661-21996', 'NON_EXISTENT_PO');
assert.strictEqual(scanResultMismatched.matchedPo.po_number, 'MDC202600025');
assert.strictEqual(scanResultMismatched.isAutoRouted, true);
console.log('  ✓ PASS: Even with wrong PO selected, system auto-routes to PO MDC202600025');

// [Test 5] 4-PO Discrepancy Reconciliation to 105 Total Units
console.log('\n[Test 5] Reconciling 4 POs from Screenshot Scenario (105 Total Units)...');

// Setup the exact 4 POs from user screenshots
const poScenario = [
  {
    id: 'po-mdc-20',
    po_number: 'MDC202600020',
    invoice_ref: 'MD03675752',
    status: 'pending',
    items: [
      { part_number: '661-44954', quantity_ordered: 1, quantity_received: 0 },
      { part_number: '661-56044', quantity_ordered: 2, quantity_received: 0 }
    ] // Total: 3 units
  },
  {
    id: 'po-mdc-18',
    po_number: 'MDC202600018',
    invoice_ref: 'MD03675752',
    status: 'pending',
    items: [
      { part_number: '661-44751', quantity_ordered: 1, quantity_received: 0 },
      { part_number: '661-44954', quantity_ordered: 1, quantity_received: 0 },
      { part_number: '661-56044', quantity_ordered: 2, quantity_received: 0 }
    ] // Total: 4 units
  },
  {
    id: 'po-3',
    po_number: 'MDC202600019',
    invoice_ref: 'MD04136487',
    status: 'pending',
    items: [
      { part_number: '661-21988', quantity_ordered: 50, quantity_received: 0 }
    ] // Total: 50 units
  },
  {
    id: 'po-4',
    po_number: 'MDC202600021',
    invoice_ref: 'MD04136490',
    status: 'pending',
    items: [
      { part_number: '661-56065', quantity_ordered: 48, quantity_received: 0 }
    ] // Total: 48 units
  }
];

const totalScenarioExpectedUnits = poScenario.reduce((sum, po) => {
  return sum + po.items.reduce((s, it) => s + it.quantity_ordered, 0);
}, 0);

assert.strictEqual(totalScenarioExpectedUnits, 105, 'Total PO units must be 105 (3 + 4 + 50 + 48)');
console.log(`  ✓ Total PO units verified: ${totalScenarioExpectedUnits} across 4 POs`);

// Simulate corrupted / inconsistent history records matching user screenshot (showing 48 and 50)
let mockHistoryRecords = [
  { id: 'INTAKE-20260907-PO-MDC202600020', po_id: 'po-mdc-20', po_number: 'MDC202600020', expected_units: 48, items: [] },
  { id: 'INTAKE-20260907-PO-MDC202600018', po_id: 'po-mdc-18', po_number: 'MDC202600018', expected_units: 50, items: [] }
];

// Run dynamic reconciliation engine
const reconcileHistoryWithPOs = (history, pos) => {
  const records = [...history];
  pos.forEach(po => {
    const poExpected = po.items.reduce((s, it) => s + (it.quantity_ordered || 0), 0);
    const poNumClean = po.po_number.toUpperCase();
    const existingIdx = records.findIndex(r => 
      r.po_id === po.id || 
      (r.po_number && r.po_number.toUpperCase() === poNumClean) ||
      (r.id && r.id.toUpperCase().includes(poNumClean))
    );
    if (existingIdx !== -1) {
      records[existingIdx] = {
        ...records[existingIdx],
        po_id: po.id,
        po_number: po.po_number,
        expected_units: poExpected
      };
    } else {
      records.push({
        id: po.po_number,
        po_id: po.id,
        po_number: po.po_number,
        expected_units: poExpected,
        items: []
      });
    }
  });
  return records;
};

const reconciledHistory = reconcileHistoryWithPOs(mockHistoryRecords, poScenario);

// Verify that MDC202600020 reconciled to 3 units, MDC202600018 to 4 units, and other 2 POs are added
const rec20 = reconciledHistory.find(r => r.po_number === 'MDC202600020');
const rec18 = reconciledHistory.find(r => r.po_number === 'MDC202600018');
const rec19 = reconciledHistory.find(r => r.po_number === 'MDC202600019');
const rec21 = reconciledHistory.find(r => r.po_number === 'MDC202602021' || r.po_number === 'MDC202600021');

assert.strictEqual(rec20.expected_units, 3, 'MDC202600020 expected units must be reconciled to 3');
assert.strictEqual(rec18.expected_units, 4, 'MDC202600018 expected units must be reconciled to 4');
assert.strictEqual(rec19.expected_units, 50, 'MDC202600019 expected units must be 50');
assert.strictEqual(rec21.expected_units, 48, 'MDC202600021 expected units must be 48');

const totalReconciledHistoryExpected = reconciledHistory.reduce((sum, r) => sum + r.expected_units, 0);
assert.strictEqual(totalReconciledHistoryExpected, 105, 'Reconciled history total expected units must equal 105');
console.log(`  ✓ PASS: Discrepancy resolved! Parts Saved History reconciled to 105 units (3, 4, 50, 48)`);

// [Test 6] Multiple GSX Invoices with Same Base PO Number: Unified into ONE row per PO!
console.log('\n[Test 6] Consolidating Multiple Invoices for Same PO into ONE Single Row (54 & 51 = 105 Units)...');
import { getBasePoNumber, consolidatePurchaseOrdersList, consolidateDcIntakeRecordsList } from '../utils/appContextHelpers.js';

const multiInvoicePOs = [
  {
    id: 'po-mdc-20-1',
    po_number: 'MDC202600020',
    invoice_ref: 'MD03875750',
    status: 'pending',
    items: [
      { id: 'it-1', part_number: '661-44954', quantity_ordered: 1, quantity_received: 0, unit_price: 10 },
      { id: 'it-2', part_number: '661-56044', quantity_ordered: 2, quantity_received: 0, unit_price: 20 }
    ] // 3 units
  },
  {
    id: 'po-mdc-20-2',
    po_number: 'MDC202600020-1',
    invoice_ref: 'MD03875752',
    status: 'pending',
    items: [
      { id: 'it-3', part_number: '661-56065', quantity_ordered: 48, quantity_received: 0, unit_price: 15 }
    ] // 48 units
  },
  {
    id: 'po-mdc-18-1',
    po_number: 'MDC202600018-1',
    invoice_ref: 'MD03875753',
    status: 'pending',
    items: [
      { id: 'it-4', part_number: '661-21956', quantity_ordered: 50, quantity_received: 0, unit_price: 25 }
    ] // 50 units
  },
  {
    id: 'po-mdc-18-2',
    po_number: 'MDC202600018',
    invoice_ref: 'MD03875751',
    status: 'pending',
    items: [
      { id: 'it-5', part_number: '661-44751', quantity_ordered: 4, quantity_received: 0, unit_price: 30 }
    ] // 4 units
  }
];

// Test PO list consolidation: 4 PO entries collapsed into 2 unified POs
const consolidatedPOs = consolidatePurchaseOrdersList(multiInvoicePOs);
assert.strictEqual(consolidatedPOs.length, 2, 'Must consolidate 4 invoices into exactly 2 POs (MDC202600018 and MDC202600020)');

const po18 = consolidatedPOs.find(p => p.po_number === 'MDC202600018');
const po20 = consolidatedPOs.find(p => p.po_number === 'MDC202600020');

assert.ok(po18, 'PO MDC202600018 must exist as single PO');
assert.ok(po20, 'PO MDC202600020 must exist as single PO');

const po18TotalUnits = po18.items.reduce((s, it) => s + it.quantity_ordered, 0);
const po20TotalUnits = po20.items.reduce((s, it) => s + it.quantity_ordered, 0);

assert.strictEqual(po18TotalUnits, 54, 'MDC202600018 must have 54 total units (50 + 4)');
assert.strictEqual(po20TotalUnits, 51, 'MDC202600020 must have 51 total units (48 + 3)');
assert.strictEqual(po18TotalUnits + po20TotalUnits, 105, 'Combined units must be 105');
console.log('  ✓ PASS: Purchase Orders consolidated into exactly 2 orders: MDC202600018 (54 units) & MDC202600020 (51 units)');

// Test History Records consolidation: must also have exactly 2 batches (not 4 duplicate rows!)
const duplicateHistoryRows = [
  { id: 'MDC202600020-1', po_number: 'MDC202600020-1', expected_units: 48, items: [] },
  { id: 'MDC202600020', po_number: 'MDC202600020', expected_units: 3, items: [] },
  { id: 'MDC202600018', po_number: 'MDC202600018', expected_units: 4, items: [] },
  { id: 'MDC202600018-1', po_number: 'MDC202600018-1', expected_units: 50, items: [] }
];

const { consolidatedRecords, obsoleteIdsToPurge } = consolidateDcIntakeRecordsList(duplicateHistoryRows, consolidatedPOs);

assert.strictEqual(consolidatedRecords.length, 2, 'History records must consolidate duplicate rows into exactly 2 rows');
assert.ok(obsoleteIdsToPurge.includes('MDC202600020-1'), 'MDC202600020-1 must be marked for purging');
assert.ok(obsoleteIdsToPurge.includes('MDC202600018-1'), 'MDC202600018-1 must be marked for purging');

const hist18 = consolidatedRecords.find(r => r.po_number === 'MDC202600018');
const hist20 = consolidatedRecords.find(r => r.po_number === 'MDC202600020');

assert.strictEqual(hist18.expected_units, 54, 'MDC202600018 history batch must have 54 expected units');
assert.strictEqual(hist20.expected_units, 51, 'MDC202600020 history batch must have 51 expected units');
assert.strictEqual(hist18.id, 'MDC202600018', 'Canonical ID must be MDC202600018');
assert.strictEqual(hist20.id, 'MDC202600020', 'Canonical ID must be MDC202600020');

console.log('  ✓ PASS: History records consolidated into exactly 2 rows:');
console.log(`    • ${hist18.record_name}: 0/${hist18.expected_units} RECEIVED (1 row, not two!)`);
console.log(`    • ${hist20.record_name}: 0/${hist20.expected_units} RECEIVED (1 row, not two!)`);
console.log(`    • Obsolete suffixed IDs purged: ${obsoleteIdsToPurge.join(', ')}`);
console.log(`    • Total Units: ${hist18.expected_units + hist20.expected_units} / 105`);

console.log('\n--- ALL MULTI-PO & HISTORY RECORDS SYNC TESTS PASSED (100%) ---');


