/**
 * Automated Dynamic Masterlist Dashboard Test Suite
 * Validates that:
 * 1. Scanned masterlist data dynamically reflects uploaded masterlist (August vs September)
 * 2. Matches exact metrics shown on live Dashboard UI (August: 6,383 units, September: 7,611 units)
 * 3. Getters properly consume dynamic datasets rather than static snapshots
 * 4. Exported reports (Excel/PDF) dynamically derive demand, valuation, SKUs, and sites from active masterlist
 * 5. Distinct uploaded masterlists produce distinct dashboard analytics and report workbooks
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import {
  scanMasterlistData,
  getMasterlistSummary,
  getMasterlistParts,
  getMasterlistSites,
  getMasterlistPartsForSite,
  setActiveScannedMasterlist,
  getActiveMasterlist
} from '../utils/rawMasterlistScanner.js';
import { exportDashboardReportToExcel } from '../utils/dashboardReportExporter.js';
import { processRawUsageSheet, CANONICAL_SITE_LIST } from '../utils/excelParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '../../');

console.log('====================================================');
console.log('TEST SUITE: Dynamic Masterlist Dashboard & Reports');
console.log('====================================================');

async function runTests() {
  const augPath = path.join(rootDir, 'Battery & Display (Allocation) - August 2026.xlsx');
  const sepPath = path.join(rootDir, 'Battery & Display (Allocation) - September 2026.xlsx');

  assert(fs.existsSync(augPath), 'August masterlist file must exist in workspace root');
  assert(fs.existsSync(sepPath), 'September masterlist file must exist in workspace root');

  const wbAug = XLSX.readFile(augPath);
  const augRows = XLSX.utils.sheet_to_json(wbAug.Sheets['Masterlist'], { header: 1, defval: '' });

  const wbSep = XLSX.readFile(sepPath);
  const sepRows = XLSX.utils.sheet_to_json(wbSep.Sheets['Masterlist'], { header: 1, defval: '' });

  // ── TEST 1: August Masterlist Ingestion Parity (Matching Screenshot 1) ──────
  const usageAug = processRawUsageSheet(augRows, CANONICAL_SITE_LIST, [], {
    filterScope: 'ALL_IPHONE_PARTS',
    selectedMonth: 'auto',
    fileName: augPath
  });
  const scannedAug = scanMasterlistData(usageAug.records, { periodLabel: 'August 2026' });
  const summaryAug = getMasterlistSummary(scannedAug);

  assert.strictEqual(summaryAug.totalUnits, 6383, `August total units must be 6,383 (got ${summaryAug.totalUnits})`);
  assert.strictEqual(summaryAug.totalDistinctParts, 375, `August distinct SKUs must be 375 (got ${summaryAug.totalDistinctParts})`);
  assert.strictEqual(summaryAug.totalSites, 26, `August sites must be 26 (got ${summaryAug.totalSites})`);
  assert.strictEqual(summaryAug.totalValuationUSD, 1333547, `August valuation USD must be $1,333,547 (got ${summaryAug.totalValuationUSD})`);
  assert.strictEqual(summaryAug.totalValuationPHP, 76012179, `August valuation PHP must be ₱76,012,179 (got ${summaryAug.totalValuationPHP})`);
  console.log('  ✓ PASS: August masterlist scan yields 6,383 units, 375 SKUs, 26 hubs, $1,333,547 [₱76,012,179]');

  // ── TEST 2: September Masterlist Ingestion Parity (Matching Screenshot 2) ────
  const usageSep = processRawUsageSheet(sepRows, CANONICAL_SITE_LIST, [], {
    filterScope: 'ALL_IPHONE_PARTS',
    selectedMonth: 'auto',
    fileName: sepPath
  });
  const scannedSep = scanMasterlistData(usageSep.records, { periodLabel: 'September 2026' });
  const summarySep = getMasterlistSummary(scannedSep);

  assert.strictEqual(summarySep.totalUnits, 7611, `September total units must be 7,611 (got ${summarySep.totalUnits})`);
  assert.strictEqual(summarySep.totalDistinctParts, 395, `September distinct SKUs must be 395 (got ${summarySep.totalDistinctParts})`);
  assert.strictEqual(summarySep.totalSites, 27, `September sites must be 27 (got ${summarySep.totalSites})`);
  assert.strictEqual(summarySep.totalValuationUSD, 1561089, `September valuation USD must be $1,561,089 (got ${summarySep.totalValuationUSD})`);
  assert.strictEqual(summarySep.totalValuationPHP, 88982073, `September valuation PHP must be ₱88,982,073 (got ${summarySep.totalValuationPHP})`);
  console.log('  ✓ PASS: September masterlist scan yields 7,611 units, 395 SKUs, 27 hubs, $1,561,089 [₱88,982,073]');

  // ── TEST 3: Dynamic Getters consume uploaded dataset ────────────────────────
  const partsAug = getMasterlistParts({ category: 'ALL', search: '', limit: 10, sortBy: 'units' }, scannedAug);
  assert.strictEqual(partsAug.all.length, 375, 'August parts list contains 375 items');
  assert.strictEqual(partsAug.displayList[0].part_number, '661-21991', 'Top part is 661-21991');
  assert.strictEqual(partsAug.displayList[0].totalUnits, 961, 'August top part demand is 961 units');

  const partsSep = getMasterlistParts({ category: 'ALL', search: '', limit: 10, sortBy: 'units' }, scannedSep);
  assert.strictEqual(partsSep.all.length, 395, 'September parts list contains 395 items');
  assert.strictEqual(partsSep.displayList[0].part_number, '661-21991', 'Top part is 661-21991');
  assert.strictEqual(partsSep.displayList[0].totalUnits, 1260, 'September top part demand is 1,260 units');
  console.log('  ✓ PASS: Masterlist getters return dynamically distinct part counts (Aug: 961 vs Sep: 1,260)');

  // ── TEST 4: Global Active Scanned Cache ─────────────────────────────────────
  setActiveScannedMasterlist(scannedAug);
  const activeCached = getActiveMasterlist();
  assert.strictEqual(activeCached.totalUnits, 6383, 'Active cached masterlist returns August 6,383 units');
  const cachedSummary = getMasterlistSummary();
  assert.strictEqual(cachedSummary.totalUnits, 6383, 'getMasterlistSummary() without arguments uses active cached masterlist');

  setActiveScannedMasterlist(scannedSep);
  const activeCachedSep = getActiveMasterlist();
  assert.strictEqual(activeCachedSep.totalUnits, 7611, 'Active cached masterlist updated to September 7,611 units');
  console.log('  ✓ PASS: Global active masterlist cache updates and propagates to default queries');

  // ── TEST 5: Excel Report Export Differentiation ────────────────────────────
  const sitesAug = getMasterlistSites({ search: '', limit: 'ALL' }, scannedAug);
  const sitePartsAug = getMasterlistPartsForSite(sitesAug.all[0].siteName, scannedAug);

  const { workbook: wbExportAug } = await exportDashboardReportToExcel({
    exportMode: 'all',
    masterPartsReport: partsAug,
    masterSitesReport: sitesAug,
    sitePartsReport: sitePartsAug,
    masterSummary: summaryAug,
    selectedSiteName: sitesAug.all[0].siteName,
    periodLabel: 'August 2026'
  });

  const wsExportAug = wbExportAug.getWorksheet('Executive Overview');
  const cellDemandAug = wsExportAug.getCell('A4').value;
  const cellValAug = wsExportAug.getCell('C4').value;
  const cellNetAug = wsExportAug.getCell('E4').value;

  assert(cellDemandAug.includes('6,383'), `August export demand must include 6,383 (got ${cellDemandAug})`);
  assert(cellValAug.includes('1,333,547'), `August export valuation must include 1,333,547 (got ${cellValAug})`);
  assert(cellNetAug.includes('375 SKUs across 26 Service Hubs'), `August export network must match 375 SKUs / 26 hubs (got ${cellNetAug})`);

  const sitesSep = getMasterlistSites({ search: '', limit: 'ALL' }, scannedSep);
  const sitePartsSep = getMasterlistPartsForSite(sitesSep.all[0].siteName, scannedSep);

  const { workbook: wbExportSep } = await exportDashboardReportToExcel({
    exportMode: 'all',
    masterPartsReport: partsSep,
    masterSitesReport: sitesSep,
    sitePartsReport: sitePartsSep,
    masterSummary: summarySep,
    selectedSiteName: sitesSep.all[0].siteName,
    periodLabel: 'September 2026'
  });

  const wsExportSep = wbExportSep.getWorksheet('Executive Overview');
  const cellDemandSep = wsExportSep.getCell('A4').value;
  const cellValSep = wsExportSep.getCell('C4').value;
  const cellNetSep = wsExportSep.getCell('E4').value;

  assert(cellDemandSep.includes('7,611'), `September export demand must include 7,611 (got ${cellDemandSep})`);
  assert(cellValSep.includes('1,561,089'), `September export valuation must include 1,561,089 (got ${cellValSep})`);
  assert(cellNetSep.includes('395 SKUs across 27 Service Hubs'), `September export network must match 395 SKUs / 27 hubs (got ${cellNetSep})`);
  console.log('  ✓ PASS: Excel report exporter generates distinct workbooks strictly reflecting active masterlist');

  // ── TEST 6: Root Workspace Export Files Verification ───────────────────────
  const augPkgPath = path.join(rootDir, 'MDC_Dashboard_Master_Intelligence_Package_August_2026.xlsx');
  const sepPkgPath = path.join(rootDir, 'MDC_Dashboard_Master_Intelligence_Package_September_2026.xlsx');

  assert(fs.existsSync(augPkgPath), 'August package must exist in root');
  assert(fs.existsSync(sepPkgPath), 'September package must exist in root');

  const readAugPkg = XLSX.readFile(augPkgPath);
  const wsReadAug = readAugPkg.Sheets['Executive Overview'];
  assert.strictEqual(wsReadAug['A4']?.v, 'TOTAL IPHONE DEMAND: 6,383 units', 'August package file has 6,383 units');
  assert(wsReadAug['C4']?.v.includes('$1,333,547'), 'August package file has $1,333,547');
  assert(wsReadAug['E4']?.v.includes('375 SKUs across 26 Service Hubs'), 'August package file has 375 SKUs / 26 hubs');

  const readSepPkg = XLSX.readFile(sepPkgPath);
  const wsReadSep = readSepPkg.Sheets['Executive Overview'];
  assert.strictEqual(wsReadSep['A4']?.v, 'TOTAL IPHONE DEMAND: 7,611 units', 'September package file has 7,611 units');
  assert(wsReadSep['C4']?.v.includes('$1,561,089'), 'September package file has $1,561,089');
  assert(wsReadSep['E4']?.v.includes('395 SKUs across 27 Service Hubs'), 'September package file has 395 SKUs / 27 hubs');
  console.log('  ✓ PASS: Root intelligence workbooks verified on disk matching user dashboard screenshots bit-for-bit');

  console.log('====================================================');
  console.log('ALL DYNAMIC MASTERLIST DASHBOARD TESTS PASSED (100%)');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
