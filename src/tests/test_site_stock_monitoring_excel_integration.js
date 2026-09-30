import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import {
  isSiteStockMonitoringWorkbook,
  parseSiteStockMonitoringWorkbook,
  parseScanInPartsFile
} from '../utils/excelParser.js';
import { exportSiteStockMonitoringToExcel } from '../utils/stockExportUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');
const excelFilePath = path.join(rootDir, 'Site Stock Monitoring.xlsx');

console.log('====================================================================');
console.log('TEST SUITE: Site Stock Monitoring Excel Structure & PMG Integration');
console.log('====================================================================');

async function runTests() {
  assert(fs.existsSync(excelFilePath), 'Site Stock Monitoring.xlsx must exist at project root');

  const buf = fs.readFileSync(excelFilePath);
  const workbook = XLSX.read(buf, { type: 'buffer' });

  // 1. Detection
  console.log('\n--- 1. Detection of Site Stock Monitoring Workbook ---');
  const isDetected = isSiteStockMonitoringWorkbook(workbook);
  assert.strictEqual(isDetected, true, 'isSiteStockMonitoringWorkbook must identify Site Stock Monitoring.xlsx');
  console.log('  ✓ PASS: isSiteStockMonitoringWorkbook accurately detects Site Stock Monitoring workbook');

  // 2. Multi-Section Parsing for APP BHS
  console.log('\n--- 2. Parsing Sheet Sections for APP BHS ---');
  const bhsResult = parseSiteStockMonitoringWorkbook(workbook, {
    targetSiteCode: 'APP BHS'
  });

  assert.strictEqual(bhsResult.success, true, 'Parsing APP BHS must succeed');
  assert.strictEqual(bhsResult.activeSheet, 'APP BHS', 'Active sheet should be APP BHS');
  assert.strictEqual(bhsResult.isSiteStockMonitoring, true, 'isSiteStockMonitoring flag must be true');
  assert(bhsResult.items.length > 0, 'Items must be extracted');
  assert(bhsResult.summary.inStock > 0, 'APP BHS must have in-stock parts');
  assert(bhsResult.summary.used > 0, 'APP BHS must have used parts');
  assert(bhsResult.summary.transferred > 0, 'APP BHS must have transferred parts');

  console.log(`  ✓ PASS: APP BHS extracted ${bhsResult.items.length} items (In-Stock: ${bhsResult.summary.inStock}, Used: ${bhsResult.summary.used}, Transferred: ${bhsResult.summary.transferred})`);

  // Verify item properties
  const sampleUsed = bhsResult.items.find(i => i.lifecycle_status === 'used');
  assert(sampleUsed, 'Must have at least one used item');
  assert(sampleUsed.serialNumber, 'Used item must have serial number');
  assert(sampleUsed.partNumber, 'Used item must have part number');
  console.log(`  ✓ PASS: Used item sample verified: PN=${sampleUsed.partNumber}, Serial=${sampleUsed.serialNumber}, OC#=${sampleUsed.workOrderNumber || sampleUsed.remarks}`);

  // 3. Multi-Section Parsing for ASP ABR
  console.log('\n--- 3. Parsing Sheet Sections for ASP ABR ---');
  const abrResult = parseSiteStockMonitoringWorkbook(workbook, {
    targetSiteCode: 'ASP ABR'
  });
  assert.strictEqual(abrResult.success, true, 'Parsing ASP ABR must succeed');
  assert(abrResult.summary.inStock >= 100, 'ASP ABR has over 100 in-stock parts');
  assert(abrResult.summary.used >= 30, 'ASP ABR has over 30 used parts');
  console.log(`  ✓ PASS: ASP ABR extracted ${abrResult.items.length} items (In-Stock: ${abrResult.summary.inStock}, Used: ${abrResult.summary.used})`);

  // 4. Auto-Routing via parseScanInPartsFile
  console.log('\n--- 4. Routing via parseScanInPartsFile ---');
  const mockFile = {
    name: 'Site Stock Monitoring.xlsx',
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  };
  const scanInResult = await parseScanInPartsFile(
    mockFile,
    [],
    [],
    [],
    'site-bhs',
    'APP BHS'
  );
  assert.strictEqual(scanInResult.success, true, 'parseScanInPartsFile must succeed on Site Stock Monitoring.xlsx');
  assert.strictEqual(scanInResult.isSiteStockMonitoring, true, 'Must detect isSiteStockMonitoring');
  assert.strictEqual(scanInResult.activeSheet, 'APP BHS', 'Should match APP BHS');
  console.log(`  ✓ PASS: parseScanInPartsFile routed cleanly to Site Stock Monitoring parser (${scanInResult.summary.valid} valid records)`);

  // 5. Excel Exporter Replicating Exact Layout
  console.log('\n--- 5. Export Replicating Exact 5-Section Layout ---');
  const exportRes = await exportSiteStockMonitoringToExcel({
    siteCode: 'APP BHS',
    siteName: 'MOBILECARE - APP BONIFACIO HIGH STREET',
    inStockUnits: bhsResult.items.filter(i => i.lifecycle_status === 'in_stock'),
    usedUnits: bhsResult.items.filter(i => i.lifecycle_status === 'used'),
    outtakeUnits: bhsResult.items.filter(i => i.lifecycle_status === 'outtake'),
    transferredUnits: bhsResult.items.filter(i => i.lifecycle_status === 'transferred'),
    stockSummary: [
      { partNumber: '661-21991', description: 'Battery, iPhone 13', inStockCount: 11 },
      { partNumber: '661-30366', description: 'Display, iPhone 14', inStockCount: 2 }
    ]
  });
  assert(exportRes.buffer, 'Export must return buffer');
  assert(exportRes.workbook, 'Export must return workbook');
  const exportedWs = exportRes.workbook.getWorksheet('APP BHS');
  assert(exportedWs, 'Exported workbook must contain APP BHS worksheet');
  assert.strictEqual(exportedWs.getCell('B1').value, 'Stock on hand');
  assert.strictEqual(exportedWs.getCell('I1').value, 'Used Parts');
  assert.strictEqual(exportedWs.getCell('O1').value, 'For Outtake');
  assert.strictEqual(exportedWs.getCell('T1').value, 'Transferred Parts to Other Sites');
  assert.strictEqual(exportedWs.getCell('Z1').value, 'Site Stock');
  console.log('  ✓ PASS: exportSiteStockMonitoringToExcel produced exact 5-section workbook with correct headers');

  // 6. Network-Wide Multi-Sheet Parsing (All 27 Branch Sheets)
  console.log('\n--- 6. Network-Wide Multi-Sheet Parsing (All 27 Branch Sheets Consolidated) ---');
  const seedDataPath = path.join(rootDir, 'src/data/seedData.json');
  const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));
  const sites = seedData.sites || [];

  const multiSheetResult = parseSiteStockMonitoringWorkbook(workbook, {
    parseAllSheets: true,
    sites
  });

  assert.strictEqual(multiSheetResult.success, true, 'Multi-sheet parsing must succeed');
  assert.strictEqual(multiSheetResult.activeSheet, 'ALL_SHEETS', 'Active sheet must be ALL_SHEETS');
  assert.strictEqual(multiSheetResult.isMultiSite, true, 'isMultiSite flag must be true');
  assert.strictEqual(multiSheetResult.availableSheets.length, 28, 'Should have ALL_SHEETS + 27 branch sheets');
  assert.strictEqual(multiSheetResult.items.length, 5104, 'Must parse the reconciled total units across all 27 branch sheets');
  assert.strictEqual(multiSheetResult.summary.inStock, 3457, 'Must reconcile the Site Stock summary in-stock units');
  assert.strictEqual(multiSheetResult.summary.used, 1454, 'Must have exactly 1,454 used units');
  assert.strictEqual(multiSheetResult.summary.outtake, 46, 'Must have exactly 46 outtake units');
  assert.strictEqual(multiSheetResult.summary.transferred, 147, 'Must have exactly 147 transferred units');

  console.log(`  ✓ PASS: All 27 branch sheets parsed simultaneously!`);
  console.log(`    Total Records: ${multiSheetResult.items.length}`);
  console.log(`    In-Stock:      ${multiSheetResult.summary.inStock}`);
  console.log(`    Used:          ${multiSheetResult.summary.used}`);
  console.log(`    For Outtake:   ${multiSheetResult.summary.outtake}`);
  console.log(`    Transferred:   ${multiSheetResult.summary.transferred}`);

  // 7. Verify Branch Normalization & Tagging across Sheets
  console.log('\n--- 7. Branch Normalization & Site ID/Code Tagging ---');
  const limaUnits = multiSheetResult.items.filter(i => i.sheetName === 'ASP LIMA');
  assert(limaUnits.length > 0, 'Must have units from ASP LIMA sheet');
  assert.strictEqual(limaUnits[0].site_code, 'ASP LIM', 'ASP LIMA sheet must normalize to ASP LIM site code');
  assert.strictEqual(limaUnits[0].current_site_id, 'site-16', 'ASP LIMA sheet must map to site-16');

  const iloUnits = multiSheetResult.items.filter(i => i.sheetName === 'APP ILO');
  assert(iloUnits.length > 0, 'Must have units from APP ILO sheet');
  assert.strictEqual(iloUnits[0].site_code, 'ASP ILO', 'APP ILO sheet must normalize to ASP ILO site code');
  assert.strictEqual(iloUnits[0].current_site_id, 'site-20', 'APP ILO sheet must map to site-20');

  console.log(`  ✓ PASS: ASP LIMA -> ASP LIM (${limaUnits[0].current_site_id}) verified`);
  console.log(`  ✓ PASS: APP ILO  -> ASP ILO (${iloUnits[0].current_site_id}) verified`);

  // 8. Auto-Routing via parseScanInPartsFile with parseAllSheets
  console.log('\n--- 8. Multi-Sheet Auto-Routing via parseScanInPartsFile ---');
  const scanInAllRes = await parseScanInPartsFile(
    mockFile,
    [],
    [],
    [],
    'ALL',
    'ALL',
    { parseAllSheets: true, sites }
  );
  assert.strictEqual(scanInAllRes.success, true, 'parseScanInPartsFile multi-sheet must succeed');
  assert.strictEqual(scanInAllRes.activeSheet, 'ALL_SHEETS', 'Active sheet must be ALL_SHEETS');
  assert.strictEqual(scanInAllRes.items.length, 5104, 'Must parse the reconciled record count');
  console.log(`  ✓ PASS: parseScanInPartsFile multi-sheet routed cleanly (${scanInAllRes.items.length} units extracted)`);

  console.log('\n====================================================================');
  console.log('ALL SITE STOCK MONITORING INTEGRATION TESTS PASSED (100%)');
  console.log('====================================================================');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
