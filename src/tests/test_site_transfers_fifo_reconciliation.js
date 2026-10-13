import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  reconcileSiteTransfers,
  parseFifoMonitoringWorkbook,
  normalizeSite,
  normalizeDate,
  isIPhone13AndUp
} from '../utils/siteTransfersReconciler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, '../..');

console.log('====================================================');
console.log('TEST SUITE: Site Transfers & FIFO Reconciliation');
console.log('====================================================\n');

// 0. Test iPhone 13+ Filter
console.log('Test 0: iPhone 13 and Up Model Filter');
assert.strictEqual(isIPhone13AndUp('Battery, iPhone 13 Pro'), true);
assert.strictEqual(isIPhone13AndUp('Display, iPhone 14 Plus'), true);
assert.strictEqual(isIPhone13AndUp('Battery, iPhone 15 Pro Max'), true);
assert.strictEqual(isIPhone13AndUp('Display, iPhone 16e'), true);
assert.strictEqual(isIPhone13AndUp('SVC, IPHONE 17E, DISPLAY'), true);
assert.strictEqual(isIPhone13AndUp('Battery, iPhone Air'), true);
assert.strictEqual(isIPhone13AndUp('Battery, iPhone 11'), false);
assert.strictEqual(isIPhone13AndUp('Display, iPhone 12 Pro Max'), false);
assert.strictEqual(isIPhone13AndUp('BATTERY IPHONE 7'), false);
assert.strictEqual(isIPhone13AndUp('AirPods 4 w/ ANC, Left'), false);
console.log('  ✓ PASS: Successfully filters out older iPhones (<13) and non-iPhones\n');

// 1. Test Site Normalization
console.log('Test 1: Site Normalization');
assert.strictEqual(normalizeSite('GL5_MSPI-Owned').code, 'GL5');
assert.strictEqual(normalizeSite('MOBILECARE - GLORIETTA 5').code, 'GL5');
assert.strictEqual(normalizeSite('BHS_Repair').code, 'BHS');
assert.strictEqual(normalizeSite('MOBILECARE - APP BONIFACIO HIGH STREET').code, 'BHS');
assert.strictEqual(normalizeSite('DC_MSPI-Owned').code, 'DC');
assert.strictEqual(normalizeSite('MOBILECARE - S\'MAISON').code, 'SMS');
assert.strictEqual(normalizeSite('FES-MSPI-Owned').code, 'FES');
console.log('  ✓ PASS: Site codes and full names normalize accurately across formats\n');

// 2. Test Date Normalization
console.log('Test 2: Date Normalization');
assert.strictEqual(normalizeDate('2026-03-21'), '2026-03-21');
assert.strictEqual(normalizeDate('3/21/2026'), '2026-03-21');
assert.strictEqual(normalizeDate(46066), '2026-02-13');
assert.strictEqual(normalizeDate('46181.333333333336'), '2026-06-08');
console.log('  ✓ PASS: Dates normalize from ISO string, slash format, and Excel serial numbers\n');

// 3. Test Full Dataset Reconciliation against FIFO & (DC stocks only) Aging Stocks  Monitoring.xlsx
console.log('Test 3: Reconciliation with FIFO & (DC stocks only) Aging Stocks  Monitoring.xlsx');
const workbookPath = path.join(workspaceDir, 'FIFO & (DC stocks only) Aging Stocks  Monitoring.xlsx');

if (fs.existsSync(workbookPath)) {
  const wbBuf = fs.readFileSync(workbookPath);
  const mockFile = {
    name: 'FIFO & (DC stocks only) Aging Stocks  Monitoring.xlsx',
    arrayBuffer: async () => wbBuf.buffer.slice(wbBuf.byteOffset, wbBuf.byteOffset + wbBuf.byteLength)
  };
  const parsedWb = await parseFifoMonitoringWorkbook(mockFile);
  assert.strictEqual(parsedWb.success, true, 'Expected workbook parse to succeed');

  const transRecords = parsedWb.transfers;
  const gsxRecords = parsedWb.gsxRecords;

  console.log(`  Read ${gsxRecords.length} KGB Used rows and ${transRecords.length} Stock Transfer rows.`);

  const reconciliation = reconcileSiteTransfers(transRecords, gsxRecords, [], {
    dcStocksOnly: true,
    preserveDuplicateTransfers: true,
    agingPolicy: 'EXCEL_PARITY',
    referenceDate: '2026-10-13',
    customPriceMap: parsedWb.customPrices
  });

  console.log('  Reconciliation KPIs:');
  console.log(`    Total Serials: ${reconciliation.kpis.totalSerials}`);
  console.log(`    Used Count: ${reconciliation.kpis.usedCount} (${reconciliation.kpis.usedRate}%)`);
  console.log(`    In Stock (Unused): ${reconciliation.kpis.inStockCount}`);
  console.log(`    FIFO Violations: ${reconciliation.kpis.fifoViolationsCount}`);
  console.log(`    FIFO Compliance Rate: ${reconciliation.kpis.fifoComplianceRate}%`);
  console.log(`    Non-Moving: ${reconciliation.kpis.nonMovingCount} ($${reconciliation.kpis.nonMovingValue})`);
  console.log(`    Slow-Moving: ${reconciliation.kpis.slowMovingCount} ($${reconciliation.kpis.slowMovingValue})`);
  console.log(`    Cross-Site Usages: ${reconciliation.kpis.crossSiteDiscrepanciesCount}`);
  console.log(`    Sites Audited: ${reconciliation.sitesScorecard.length}`);

  assert.strictEqual(reconciliation.kpis.totalSerials, 2962, 'Expected 2,962 DC transfer rows');
  assert.strictEqual(reconciliation.kpis.usedCount, 1534, 'Expected 1,534 used serials');
  assert.strictEqual(reconciliation.kpis.inStockCount, 1428, 'Expected 1,428 in stock serials');
  assert.strictEqual(reconciliation.kpis.fifoViolationsCount, 197, 'Expected 197 FIFO violations');
  assert.strictEqual(reconciliation.kpis.nonMovingCount, 609, 'Expected 609 Non-Moving units');
  assert.strictEqual(reconciliation.kpis.nonMovingValue, 120261, 'Expected $120,261 Non-Moving cost');
  assert.strictEqual(reconciliation.kpis.slowMovingCount, 631, 'Expected 631 Slow-Moving units');
  assert.strictEqual(reconciliation.kpis.slowMovingValue, 101619, 'Expected $101,619 Slow-Moving cost');
  assert.strictEqual(reconciliation.kpis.crossSiteDiscrepanciesCount, 62, 'Expected 62 Cross-Site usages');
  assert.strictEqual(reconciliation.sitesScorecard.length, 26, 'Expected 26 branches audited');

  console.log('  ✓ PASS: 100% mathematical parity with FIFO & (DC stocks only) Aging Stocks Monitoring.xlsx\n');
} else {
  console.log('  (Skipping dataset load: workbook not found)');
}

// 4. Test FIFO Violation Edge Case Specifically
console.log('Test 4: FIFO Violation Logic Verification');
const mockTransfers = [
  {
    serial_number: 'SERIAL_OLDER',
    transfer_received_date: '2026-01-01',
    from_stock: 'DC_MSPI-Owned',
    to_stock: 'GL5_MSPI-Owned',
    product_code: '661-30382',
    product_name: 'Battery, iPhone 14 Pro',
    transfer_quantity: 1,
    transfer_value: 99
  },
  {
    serial_number: 'SERIAL_NEWER',
    transfer_received_date: '2026-02-01',
    from_stock: 'DC_MSPI-Owned',
    to_stock: 'GL5_MSPI-Owned',
    product_code: '661-30382',
    product_name: 'Battery, iPhone 14 Pro',
    transfer_quantity: 1,
    transfer_value: 99
  }
];

// Case A: Newer is used, older is still in stock -> Should flag FIFO VIOLATION
const mockGsxCaseA = [
  {
    product_kgb: 'SERIAL_NEWER',
    location_name: 'MOBILECARE - GLORIETTA 5',
    repair_closed_date: '2026-02-15',
    order_id: 'ORDER_101',
    gsx_repair_number: 'REP_101'
  }
];

const resultA = reconcileSiteTransfers(mockTransfers, mockGsxCaseA, []);
const newerRecordA = resultA.records.find(r => r.serial_number === 'SERIAL_NEWER');
const olderRecordA = resultA.records.find(r => r.serial_number === 'SERIAL_OLDER');

assert.strictEqual(newerRecordA.fifo_status, 'FIFO_VIOLATION_OLDER_IN_STOCK');
assert.strictEqual(olderRecordA.fifo_status, 'IN_STOCK');
assert(newerRecordA.fifo_violation_reasons.length > 0);
assert.strictEqual(newerRecordA.fifo_violation_reasons[0].olderSerial, 'SERIAL_OLDER');
console.log('  ✓ PASS: Case A flags FIFO Violation when older stock is left idle while newer is used');

// Case B: Older is used first -> Should be FIFO COMPLIANT
const mockGsxCaseB = [
  {
    product_kgb: 'SERIAL_OLDER',
    location_name: 'MOBILECARE - GLORIETTA 5',
    repair_closed_date: '2026-01-15',
    order_id: 'ORDER_100',
    gsx_repair_number: 'REP_100'
  },
  {
    product_kgb: 'SERIAL_NEWER',
    location_name: 'MOBILECARE - GLORIETTA 5',
    repair_closed_date: '2026-02-15',
    order_id: 'ORDER_101',
    gsx_repair_number: 'REP_101'
  }
];

const resultB = reconcileSiteTransfers(mockTransfers, mockGsxCaseB, []);
const newerRecordB = resultB.records.find(r => r.serial_number === 'SERIAL_NEWER');
const olderRecordB = resultB.records.find(r => r.serial_number === 'SERIAL_OLDER');

assert.strictEqual(olderRecordB.fifo_status, 'FIFO_COMPLIANT');
assert.strictEqual(newerRecordB.fifo_status, 'FIFO_COMPLIANT');
console.log('  ✓ PASS: Case B flags FIFO Compliant when older stock is consumed first\n');

// Case C: Transferred to ANX, consumed at MAG -> Should flag CROSS-SITE DISCREPANCY
console.log('Test 5: Cross-Site Usage Leakage Detection');
const mockTransfersLeakage = [
  {
    serial_number: 'SERIAL_LEAK',
    transfer_received_date: '2026-03-01',
    from_stock: 'DC_MSPI-Owned',
    to_stock: 'ANX-MSPI-Owned',
    product_code: '661-30382',
    product_name: 'Battery, iPhone 14 Pro',
    transfer_quantity: 1,
    transfer_value: 99
  }
];

const mockGsxLeakage = [
  {
    product_kgb: 'SERIAL_LEAK',
    location_name: 'MOBILECARE - APP MAGNOLIA',
    repair_closed_date: '2026-03-10',
    order_id: 'ORDER_999',
    gsx_repair_number: 'REP_999'
  }
];

const resultC = reconcileSiteTransfers(mockTransfersLeakage, mockGsxLeakage, []);
const leakRecord = resultC.records[0];
assert.strictEqual(leakRecord.is_cross_site_discrepancy, true);
assert.strictEqual(leakRecord.cross_site_detail.transferredToCode, 'ANX');
assert.strictEqual(leakRecord.cross_site_detail.usedAtCode, 'MAG');
assert.strictEqual(resultC.kpis.crossSiteDiscrepanciesCount, 1);
console.log('  ✓ PASS: Case C flags cross-site leakage when consumed site differs from destination\n');

console.log('====================================================');
console.log('ALL SITE TRANSFERS & FIFO RECONCILIATION TESTS PASSED (100%)');
console.log('====================================================');
