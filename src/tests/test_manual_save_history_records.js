/**
 * Test: Manual Save Parts History Record
 *
 * Verifies that records manually saved via the "Save Parts History Record" button
 * (with no linked PO) are NOT destroyed by consolidateDcIntakeRecordsList.
 *
 * This is a regression test for the bug where any MDC-prefixed ID was classified
 * as a PO batch, causing manually-saved records to be silently overwritten.
 */

import assert from 'assert';
import { consolidateDcIntakeRecordsList } from '../utils/appContextHelpers.js';

console.log('--- Testing Manual Save Parts History Record (Regression) ---\n');

// --- Test 1: Manual intake with is_manual_intake=true survives consolidation ---
{
  const manualRecord = {
    id: 'MDC202600021',
    record_name: 'Direct Intake - Sept 8 2026',
    intake_date: '2026-09-08',
    po_id: null,
    po_number: null,
    supplier_name: 'Direct Intake',
    notes: 'Manual direct save by warehouse staff',
    items: [
      { serial_number: 'SN001', part_number: '661-12345', description: 'iPhone Battery' },
      { serial_number: 'SN002', part_number: '661-12345', description: 'iPhone Battery' }
    ],
    total_units: 2,
    saved_by_name: 'Zhon Manaois',
    is_manual_intake: true,
    created_at: new Date().toISOString()
  };

  const { consolidatedRecords } = consolidateDcIntakeRecordsList(
    [manualRecord],
    [], // no purchase orders
    null,
    []
  );

  assert.strictEqual(consolidatedRecords.length, 1, 'Manual intake record should be preserved (not discarded)');
  const result = consolidatedRecords[0];
  assert.strictEqual(result.id, 'MDC202600021', 'Manual record ID must be preserved exactly');
  assert.strictEqual(result.record_name, 'Direct Intake - Sept 8 2026', 'Manual record name must not be overwritten with PO badge');
  assert.strictEqual(result.total_units, 2, 'Manual record unit count must be preserved');
  assert.strictEqual(result.is_manual_intake, true, 'is_manual_intake flag must be preserved');
  assert.ok(!result.record_name.includes('(Apple GSX PO)'), 'Manual record must NOT be labelled as Apple GSX PO');

  console.log('  ✓ PASS: Manual intake record (is_manual_intake=true) preserved correctly through consolidation');
}

// --- Test 2: Manual intake with null po_number AND null po_id survives even without explicit flag ---
{
  // Legacy records saved before the flag was added — protected by the null-PO guard
  const legacyManualRecord = {
    id: 'MDC202600022',
    record_name: 'SVNR Batch - Legacy',
    intake_date: '2026-09-07',
    po_id: null,
    po_number: null,
    supplier_name: 'Direct Intake',
    notes: 'SVNR - Service Non-Repair',
    items: [
      { serial_number: 'SN010', part_number: '661-99999', description: 'Display Assembly' }
    ],
    total_units: 1,
    saved_by_name: 'Zhon Manaois',
    // Intentionally no is_manual_intake flag (legacy record)
    created_at: new Date().toISOString()
  };

  const { consolidatedRecords } = consolidateDcIntakeRecordsList(
    [legacyManualRecord],
    [], // no purchase orders
    null,
    []
  );

  assert.strictEqual(consolidatedRecords.length, 1, 'Legacy manual intake (no flag, null PO) must be preserved');
  const result = consolidatedRecords[0];
  assert.strictEqual(result.id, 'MDC202600022', 'Legacy manual record ID must be preserved');
  assert.strictEqual(result.record_name, 'SVNR Batch - Legacy', 'Legacy manual record name must not be overwritten');
  assert.ok(!result.record_name.includes('(Apple GSX PO)'), 'Legacy manual record must NOT get PO badge');

  console.log('  ✓ PASS: Legacy manual intake (no flag, null po_number & po_id) also preserved through consolidation');
}

// --- Test 3: Manual record and PO batch can coexist without collision ---
{
  const manualRecord = {
    id: 'MDC202600030',
    record_name: 'Direct Dispatch Batch #30',
    intake_date: '2026-09-08',
    po_id: null,
    po_number: null,
    supplier_name: 'Direct Intake',
    notes: 'Manually saved',
    items: [{ serial_number: 'SN100', part_number: '661-10001', description: 'Battery' }],
    total_units: 1,
    saved_by_name: 'Zhon Manaois',
    is_manual_intake: true,
    created_at: new Date().toISOString()
  };

  const poBatch = {
    id: 'MDC202600024',
    record_name: 'MDC202600024 (Apple GSX PO)',
    intake_date: '2026-09-01',
    po_id: 'po-mdc202600024',
    po_number: 'MDC202600024',
    supplier_name: 'Apple South Asia Pte Ltd',
    notes: 'Purchase Order MDC202600024 (4 units expected from Apple)',
    items: [{ serial_number: 'SN200', part_number: '661-12346', description: 'Display' }],
    total_units: 1,
    saved_by_name: 'Zhon Manaois',
    is_manual_intake: false,
    created_at: new Date().toISOString()
  };

  const purchaseOrders = [{
    id: 'po-mdc202600024',
    po_number: 'MDC202600024',
    status: 'received',
    supplier: 'Apple South Asia Pte Ltd',
    items: [{ part_number: '661-12346', description: 'Display', quantity_ordered: 1, quantity_received: 1, unit_price: 5000 }],
    order_date: '2026-09-01',
    total_amount: 5000
  }];

  const { consolidatedRecords } = consolidateDcIntakeRecordsList(
    [manualRecord, poBatch],
    purchaseOrders,
    null,
    []
  );

  assert.strictEqual(consolidatedRecords.length, 2, 'Both manual and PO batch records should be preserved');

  const manualResult = consolidatedRecords.find(r => r.id === 'MDC202600030');
  const poResult = consolidatedRecords.find(r => r.id === 'MDC202600024');

  assert.ok(manualResult, 'Manual record MDC202600030 must exist in results');
  assert.strictEqual(manualResult.record_name, 'Direct Dispatch Batch #30', 'Manual record name must be preserved');
  assert.ok(poResult, 'PO batch record MDC202600024 must exist in results');
  assert.ok(poResult.record_name.includes('Apple GSX PO'), 'PO batch must retain its Apple GSX PO label');

  console.log('  ✓ PASS: Manual record and PO batch coexist correctly without collision');
}

// --- Test 4: po_number: 'Direct Receiving' is NEVER treated as a PO number ---
{
  const directRec1 = {
    id: 'MDC202600017 (1)',
    record_name: 'MDC202600017 (1)',
    intake_date: '2026-09-03',
    po_id: null,
    po_number: 'Direct Receiving',
    supplier_name: 'Direct Intake',
    total_units: 66,
    items: [{ serial_number: 'SN-001', part_number: '661-21988' }]
  };

  const directRec2 = {
    id: 'MDC202600827',
    record_name: 'MDC202600827',
    intake_date: '2026-08-27',
    po_id: null,
    po_number: 'Direct Receiving',
    supplier_name: 'Direct Intake',
    total_units: 15,
    items: [{ serial_number: 'SN-002', part_number: '661-21988' }]
  };

  const { consolidatedRecords } = consolidateDcIntakeRecordsList(
    [directRec1, directRec2],
    [],
    null,
    []
  );

  assert.strictEqual(consolidatedRecords.length, 2, 'Direct receiving records must NOT be merged into a single DIRECT RECEIVING row');
  assert.ok(!consolidatedRecords.some(r => r.id === 'DIRECT RECEIVING'), 'No row with id DIRECT RECEIVING should ever be created');
  assert.ok(consolidatedRecords.some(r => r.id === 'MDC202600017 (1)'), 'MDC202600017 (1) must retain its original ID');
  assert.ok(consolidatedRecords.some(r => r.id === 'MDC202600827'), 'MDC202600827 must retain its original ID');

  console.log('  ✓ PASS: Direct receiving records (po_number: Direct Receiving) not merged into bogus PO batch');
}

// --- Test 5: Legacy corrupted record with id: 'DIRECT RECEIVING' is healed to MDC202600021 ---
{
  const corruptedRec = {
    id: 'DIRECT RECEIVING',
    record_name: 'DIRECT RECEIVING (Apple GSX PO)',
    intake_date: '2026-09-08',
    po_id: 'po-direct receiving',
    po_number: 'DIRECT RECEIVING',
    notes: 'Purchase Order DIRECT RECEIVING (0 units expected from Apple)',
    total_units: 264,
    items: [{ serial_number: 'SN-X1' }]
  };

  const { consolidatedRecords, obsoleteIdsToPurge } = consolidateDcIntakeRecordsList(
    [corruptedRec],
    [],
    null,
    []
  );

  assert.strictEqual(consolidatedRecords.length, 1, 'Corrupted record should be healed to 1 valid record');
  const healed = consolidatedRecords[0];
  assert.strictEqual(healed.id, 'MDC202600021', 'Corrupted DIRECT RECEIVING must be healed to MDC202600021');
  assert.ok(!healed.record_name.includes('(Apple GSX PO)'), 'Healed record must not contain Apple GSX PO badge');
  assert.strictEqual(healed.po_number, null, 'Healed record po_number must be null');
  assert.ok(obsoleteIdsToPurge.includes('DIRECT RECEIVING'), 'Obsolete ID DIRECT RECEIVING must be marked for database purge');

  console.log('  ✓ PASS: Corrupted DIRECT RECEIVING healed to MDC202600021 and purged from obsolete IDs');
}

console.log('\n--- ALL MANUAL SAVE REGRESSION TESTS PASSED (100%) ---\n');
