import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as auditService from '../services/scanInAuditService.js';
import { PRESERVED_SESSION_KEYS, isPreservedKey } from '../utils/cacheManager.js';

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: Permanent Immutable Scan-In Audit Trail');
  console.log('====================================================');

  // ── 1. Service Immutability Contract (No delete / edit / clear exports) ──
  const exportedNames = Object.keys(auditService);
  assert.ok(
    !exportedNames.some(n => /^(delete|remove|clear|edit|update|purge)/i.test(n)),
    `scanInAuditService must be strictly append-only (found forbidden export in ${exportedNames.join(', ')})`
  );
  console.log('  ✓ PASS: scanInAuditService exposes strictly append-only API (zero delete/edit/clear exports)');

  // ── 2. Record Construction, Required Fields & Freeze Immutability ────────
  const rec1 = auditService.buildScanInAuditRecord(
    {
      id: 'unit-001',
      part_number: '661-30401',
      description: 'Display, iPhone 14 Pro Max',
      serial_number: 'G9P5183N8Q514YDA2',
      intake_assignment: 'MDC - Forecasting',
      received_at: '2026-11-19T05:10:00.000Z',
      received_by: 'Zhon Manaois',
      site_code: 'DC-MDC',
      site_name: 'Distribution Center (DC-MDC)',
      po_number: 'MDC202600025'
    },
    { intakeMethod: 'Barcode Scan' }
  );

  assert.strictEqual(Object.isFrozen(rec1), true, 'Audit record must be frozen (immutable)');
  assert.strictEqual(rec1.part_number, '661-30401');
  assert.strictEqual(rec1.part_description, 'Display, iPhone 14 Pro Max');
  assert.strictEqual(rec1.serial_number, 'G9P5183N8Q514YDA2');
  assert.strictEqual(rec1.classification, 'MDC - Forecasting');
  assert.strictEqual(rec1.scanned_at, '2026-11-19T05:10:00.000Z');
  assert.strictEqual(rec1.scanned_by, 'Zhon Manaois');
  assert.strictEqual(rec1.receiving_site_code, 'DC-MDC');
  assert.strictEqual(rec1.reference_number, 'MDC202600025');
  assert.ok(rec1.audit_id.startsWith('AUD-20261119-'));
  assert.strictEqual(rec1.integrity_hash, auditService.computeAuditIntegrityHash(rec1));
  console.log('  ✓ PASS: Audit record captures all 8 compliance fields + frozen integrity hash');

  // ── 3. Strictly Append-Only Union Merge (All Scanned Sites & Transaction Types) ──
  const rec2TransferBranch = auditService.buildScanInAuditRecord(
    {
      id: 'unit-002',
      part_number: '661-36863',
      description: 'Battery, iPhone 15',
      serial_number: 'F8Y6234C9AR231LB3',
      intake_assignment: 'Transfer Parts',
      received_at: '2026-11-19T05:15:00.000Z',
      received_by: 'Maria Santos',
      site_code: 'APP MOA',
      site_name: 'MOBILECARE - MALL OF ASIA',
      previous_site_code: 'DC-MDC',
      po_number: 'TRF-2026-001'
    },
    { intakeMethod: 'Barcode Scan', recordSource: 'scan_in' }
  );

  const rec3LegacyBranchBackfill = auditService.buildScanInAuditRecord(
    {
      id: 'unit-003',
      part_number: '661-99999',
      description: 'Fixably Synced Branch Stock',
      serial_number: 'BRN1234567890ABCD',
      intake_assignment: 'MDC - Forecasting',
      received_at: '2026-11-19T05:20:00.000Z',
      received_by: 'Fixably Sync',
      site_code: 'APP MOA',
      site_name: 'MOBILECARE - MALL OF ASIA',
      po_number: 'HISTORICAL-STOCK'
    },
    { intakeMethod: 'Historical Backfill' }
  );

  // Merge rec1 (DC Forecasting) + duplicate rec1 + rec2TransferBranch (APP MOA Transfer Parts) + legacy non-DC backfill
  // Must keep BOTH live scans (DC-MDC + APP MOA Transfer) and exclude only non-DC Historical Backfill noise!
  const { merged, addedCount } = auditService.mergeScanInAuditRecords([rec1], [rec1, rec2TransferBranch, rec3LegacyBranchBackfill]);
  assert.strictEqual(merged.length, 2, 'Live scans from all sites & transaction types must be preserved while excluding legacy non-DC backfill');
  assert.strictEqual(addedCount, 1);
  assert.strictEqual(merged[0].audit_id, rec2TransferBranch.audit_id, 'Newest scan must sort first');
  assert.strictEqual(merged[0].classification, 'Transfer Parts');
  assert.strictEqual(merged[0].receiving_site_code, 'APP MOA');
  assert.strictEqual(merged[0].origin_site, 'DC-MDC');
  assert.strictEqual(merged[1].audit_id, rec1.audit_id);

  // Merging with empty array must NEVER shrink existing audit trail
  const { merged: afterEmpty } = auditService.mergeScanInAuditRecords(merged, []);
  assert.strictEqual(afterEmpty.length, 2, 'Empty incoming merge must preserve all existing audit records');
  console.log('  ✓ PASS: Append-only union preserves all live scans (all sites & Transfer/Forecasting/SVNR) while blocking non-DC Fixably backfill');

  // ── 4. Cache Reset / Session Clear Immunity ──────────────────────────────
  assert.ok(
    PRESERVED_SESSION_KEYS.includes(auditService.SCAN_IN_AUDIT_IDB_KEY),
    'Audit ledger key must be in PRESERVED_SESSION_KEYS'
  );
  assert.strictEqual(
    isPreservedKey(auditService.SCAN_IN_AUDIT_IDB_KEY),
    true,
    'isPreservedKey must protect the Scan-In Audit Trail key'
  );
  console.log('  ✓ PASS: Audit ledger is protected from operational cache resets');

  // ── 5. Compliance Excel Export ───────────────────────────────────────────
  const xlsxBuf = await auditService.buildScanInAuditExcelBuffer({
    records: merged,
    filters: { classification: 'All Tags', site: 'All Sites' },
    generatedBy: 'Zhon Manaois'
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxBuf);
  assert.deepStrictEqual(wb.worksheets.map(w => w.name), ['Audit Summary', 'Scan-In Audit Log']);
  const logWs = wb.getWorksheet('Scan-In Audit Log');
  assert.strictEqual(logWs.rowCount, 3, 'Audit Log sheet must have header + 2 records');
  assert.strictEqual(logWs.getRow(2).getCell(4).value, '661-36863');
  assert.strictEqual(logWs.getRow(2).getCell(7).value, 'Transfer Parts');
  assert.strictEqual(logWs.getRow(2).getCell(8).value, 'Maria Santos');
  assert.strictEqual(logWs.getRow(2).getCell(9).value, 'DC-MDC');
  console.log('  ✓ PASS: Compliance Excel (.xlsx) workbook generated and verified');

  // ── 6. UI Read-Only & Pipeline Wiring Checks ─────────────────────────────
  const panelSrc = fs.readFileSync(path.resolve('src/components/ScanInAuditTrailPanel.jsx'), 'utf8');
  const scanInSrc = fs.readFileSync(path.resolve('src/components/ScanInReceiving.jsx'), 'utf8');
  const invSrc = fs.readFileSync(path.resolve('src/context/useInventory.js'), 'utf8');

  assert.ok(!panelSrc.includes('Trash2') && !panelSrc.includes('deleteScanInUnit'), 'Audit Trail UI must not expose any delete control');
  assert.ok(scanInSrc.includes('ScanInAuditTrailPanel'), 'ScanInReceiving must render ScanInAuditTrailPanel as a dedicated tab');
  assert.ok(scanInSrc.includes('Scan-In Audit Trail'), 'ScanInReceiving must display Scan-In Audit Trail tab');
  assert.ok(invSrc.includes('appendScanInAuditRecords'), 'useInventory must permanently append every scanned part to the audit trail');
  console.log('  ✓ PASS: UI read-only enforcement and Receive Scan-In intake wiring verified');
  console.log('ALL PERMANENT SCAN-IN AUDIT TRAIL TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ FAIL:', err);
  process.exit(1);
});
