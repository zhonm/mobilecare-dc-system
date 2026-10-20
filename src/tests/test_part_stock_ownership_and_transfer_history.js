import assert from 'assert';
import {
  formatSiteOwner,
  normalizeSiteCode,
  recordPartTransfer,
  recordBatchTransfers,
  getTransferHistoryForPart,
  resolvePartOwnershipDetails,
  filterPartsByTransferCriteria
} from '../services/transferHistoryService.js';
import { normalizeInventoryUnits } from '../utils/partResolver.js';
import { resolveSerialFullDetails } from '../utils/serialTracker.js';

console.log('====================================================');
console.log('TEST SUITE: Stock Ownership & Part Transfer History Tracking');
console.log('====================================================');

// Mock in-memory storage for test environment
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) || null,
  setItem: (key, val) => mockStorage.set(key, String(val)),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

// ── TEST 1: Site Code Normalization & Standard MSPI Ownership Formatting ──
{
  assert.strictEqual(normalizeSiteCode('DC'), 'DC');
  assert.strictEqual(normalizeSiteCode('DC-MDC'), 'DC');
  assert.strictEqual(normalizeSiteCode('site-dc'), 'DC');
  assert.strictEqual(normalizeSiteCode('POD'), 'POD');
  assert.strictEqual(normalizeSiteCode('MOBILECARE - APP PODIUM'), 'PODIUM');
  assert.strictEqual(normalizeSiteCode('ANX'), 'ANX');
  assert.strictEqual(normalizeSiteCode('BHS'), 'BHS');
  assert.strictEqual(normalizeSiteCode('APP-AUR'), 'AUR');

  assert.strictEqual(formatSiteOwner('DC'), 'DC_MSPI-OWNED');
  assert.strictEqual(formatSiteOwner('DC-MDC'), 'DC_MSPI-OWNED');
  assert.strictEqual(formatSiteOwner('POD'), 'POD_MSPI-OWNED');
  assert.strictEqual(formatSiteOwner('ANX'), 'ANX_MSPI-OWNED');
  assert.strictEqual(formatSiteOwner('BHS'), 'BHS_MSPI-OWNED');
  assert.strictEqual(formatSiteOwner('AUR'), 'AUR_MSPI-OWNED');
  console.log('  ✓ PASS: Site normalization and uppercase MSPI ownership formatting (e.g. DC_MSPI-OWNED, POD_MSPI-OWNED)');
}

// ── TEST 2: Append-Only Non-Overwriting Transfer Log & Audit Trail ──
{
  mockStorage.clear();
  const testSerial = 'F8YTEST9012DISPLAY';
  const testPn = '661-30373';

  // Step 1: Initial Inbound Intake at DC
  recordPartTransfer({
    partNumber: testPn,
    serialNumber: testSerial,
    fromSiteCode: 'Supplier',
    toSiteCode: 'DC',
    fromOwner: 'SUPPLIER',
    toOwner: 'DC_MSPI-OWNED',
    transferType: 'Inbound Intake',
    userName: 'Zhon Manaois',
    manifestRef: 'PO-2026-001',
    transferDate: '2026-10-15T08:00:00.000Z'
  });

  // Step 2: Transfer DC -> POD
  recordPartTransfer({
    partNumber: testPn,
    serialNumber: testSerial,
    fromSiteCode: 'DC',
    toSiteCode: 'POD',
    fromOwner: 'DC_MSPI-OWNED',
    toOwner: 'POD_MSPI-OWNED',
    transferType: 'Transfer',
    userName: 'Alex Santos',
    manifestRef: 'PL-2026-089',
    transferDate: '2026-10-16T10:30:00.000Z'
  });

  // Step 3: Return POD -> DC
  recordPartTransfer({
    partNumber: testPn,
    serialNumber: testSerial,
    fromSiteCode: 'POD',
    toSiteCode: 'DC',
    fromOwner: 'POD_MSPI-OWNED',
    toOwner: 'DC_MSPI-OWNED',
    transferType: 'Return',
    userName: 'Maria Lopez',
    manifestRef: 'RET-POD-001',
    notes: 'Returned to DC — Authorized Stock Reassignment',
    transferDate: '2026-10-18T14:15:00.000Z'
  });

  // Step 4: Transfer DC -> ANNEX
  recordPartTransfer({
    partNumber: testPn,
    serialNumber: testSerial,
    fromSiteCode: 'DC',
    toSiteCode: 'ANNEX',
    fromOwner: 'DC_MSPI-OWNED',
    toOwner: 'ANNEX_MSPI-OWNED',
    transferType: 'Transfer',
    userName: 'Zhon Manaois',
    manifestRef: 'PL-2026-095',
    transferDate: '2026-10-20T09:45:00.000Z'
  });

  const history = getTransferHistoryForPart({ serialNumber: testSerial });
  assert.strictEqual(history.length, 4, 'History must contain all 4 records without any overwriting');
  assert.strictEqual(history[0].from_site_code, 'Supplier');
  assert.strictEqual(history[0].to_site_code, 'DC');
  assert.strictEqual(history[1].from_site_code, 'DC');
  assert.strictEqual(history[1].to_site_code, 'POD');
  assert.strictEqual(history[2].from_site_code, 'POD');
  assert.strictEqual(history[2].to_site_code, 'DC');
  assert.strictEqual(history[3].from_site_code, 'DC');
  assert.strictEqual(history[3].to_site_code, 'ANNEX');

  console.log('  ✓ PASS: Complete movement records are appended immutably and never overwritten');
}

// ── TEST 3: Movement History Trail & Current Owner Resolution ──
{
  const testSerial = 'F8YTEST9012DISPLAY';
  const resolved = resolvePartOwnershipDetails(testSerial);

  assert.strictEqual(resolved.currentOwner, 'ANNEX_MSPI-OWNED', 'Current owner must match latest destination owner');
  assert.strictEqual(resolved.movementTrail, 'Supplier → DC → POD → DC → ANNEX', 'Trail must accurately reconstruct complete path');
  assert.strictEqual(resolved.transferCount, 4, 'Must report accurate transfer count');
  assert.strictEqual(resolved.transfers[2].user_name, 'Maria Lopez', 'Must preserve user audit details');
  assert.strictEqual(resolved.transfers[2].transfer_type, 'Return', 'Must preserve transfer type');

  console.log('  ✓ PASS: resolvePartOwnershipDetails accurately resolves Current Owner & Movement Trail (DC → POD → DC → ANNEX)');
}

// ── TEST 4: Batch Transfers (e.g. Packing List Outbound Dispatch) ──
{
  const batch = [
    { partNumber: '661-30373', serialNumber: 'BATCH-SN-1', fromSiteCode: 'DC', toSiteCode: 'POD' },
    { partNumber: '661-30373', serialNumber: 'BATCH-SN-2', fromSiteCode: 'DC', toSiteCode: 'POD' },
    { partNumber: '661-32400', serialNumber: 'BATCH-SN-3', fromSiteCode: 'DC', toSiteCode: 'POD' }
  ];

  recordBatchTransfers(batch);

  const res1 = resolvePartOwnershipDetails('BATCH-SN-1');
  assert.strictEqual(res1.currentOwner, 'POD_MSPI-OWNED');
  assert.strictEqual(res1.movementTrail, 'DC → POD');
  assert.strictEqual(res1.transferCount, 1);

  console.log('  ✓ PASS: recordBatchTransfers correctly records multiple parts dispatched under packing list');
}

// ── TEST 5: Normalization Integrity in normalizeInventoryUnits ──
{
  const rawUnits = [
    {
      part_number: '661-30373',
      serial_number: 'UNIT-NORM-01',
      site_code: 'DC-MDC',
      current_owner: 'DC_MSPI-OWNED',
      movement_history: ['DC']
    },
    {
      part_number: '661-30373',
      serial_number: 'UNIT-NORM-02',
      site_code: 'POD',
      current_owner: 'POD_MSPI-OWNED',
      movement_history: ['DC', 'POD']
    }
  ];

  const normalized = normalizeInventoryUnits(rawUnits);
  assert.strictEqual(normalized[0].current_owner, 'DC_MSPI-OWNED');
  assert.deepStrictEqual(normalized[0].movement_history, ['DC']);
  assert.strictEqual(normalized[1].current_owner, 'POD_MSPI-OWNED');
  assert.deepStrictEqual(normalized[1].movement_history, ['DC', 'POD']);
  assert.strictEqual(normalized[1].transfer_count, 1);

  console.log('  ✓ PASS: normalizeInventoryUnits maintains current_owner, movement_history, and transfer_count');
}

// ── TEST 6: Serial Dossier Full Details Integration ──
{
  const unit = {
    part_number: '661-30373',
    serial_number: 'DOSSIER-SERIAL-99',
    site_code: 'DC-MDC',
    current_site_id: 'site-dc',
    status: 'in_stock',
    current_owner: 'DC_MSPI-OWNED',
    movement_history: ['DC', 'POD', 'DC']
  };

  const dossier = resolveSerialFullDetails('DOSSIER-SERIAL-99', {
    inventoryUnits: [unit],
    sites: [{ id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center', is_dc: true }]
  });

  assert.ok(dossier, 'Dossier must be found');
  assert.strictEqual(dossier.currentOwner, 'DC_MSPI-OWNED');
  assert.strictEqual(dossier.movementTrail, 'DC → POD → DC');

  console.log('  ✓ PASS: Serial Dossier includes comprehensive Stock Ownership and Movement History');
}

// ── TEST 7: Filtering Parts by Transfer Criteria ──
{
  const items = [
    { part_number: '661-30373', serial_number: 'F8YTEST9012DISPLAY' }, // has 4 transfers
    { part_number: '661-99999', serial_number: 'NEVER-TRANSFERRED-SN' }  // 0 transfers
  ];

  const transfersMap = new Map();
  transfersMap.set('F8YTEST9012DISPLAY', getTransferHistoryForPart({ serialNumber: 'F8YTEST9012DISPLAY' }));

  const transferredOnly = filterPartsByTransferCriteria({
    partsList: items,
    transferFilter: 'TRANSFERRED_ONLY',
    transfersMap
  });
  assert.strictEqual(transferredOnly.length, 1);
  assert.strictEqual(transferredOnly[0].serial_number, 'F8YTEST9012DISPLAY');

  const noTransfers = filterPartsByTransferCriteria({
    partsList: items,
    transferFilter: 'NO_TRANSFERS',
    transfersMap
  });
  assert.strictEqual(noTransfers.length, 1);
  assert.strictEqual(noTransfers[0].serial_number, 'NEVER-TRANSFERRED-SN');

  const sourceFilterMatch = filterPartsByTransferCriteria({
    partsList: items,
    sourceSiteFilter: 'POD',
    transfersMap
  });
  assert.strictEqual(sourceFilterMatch.length, 1);
  assert.strictEqual(sourceFilterMatch[0].serial_number, 'F8YTEST9012DISPLAY');

  console.log('  ✓ PASS: filterPartsByTransferCriteria filters parts by transfer count, source site, and destination site');
}

console.log('====================================================');
console.log('ALL 7 STOCK OWNERSHIP & TRANSFER HISTORY TESTS PASSED!');
console.log('====================================================');
