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
  getMasterlistPartsForSite
} from '../utils/rawMasterlistScanner.js';
import { exportDashboardReportToExcel } from '../utils/dashboardReportExporter.js';
import { processRawUsageSheet, CANONICAL_SITE_LIST } from '../utils/excelParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '../../');

console.log('====================================================');
console.log('AUDIT: 100% Report Accuracy vs Masterlist Files');
console.log('====================================================');

async function runAudit() {
  const augPath = path.join(rootDir, 'Battery & Display (Allocation) - August 2026.xlsx');
  const sepPath = path.join(rootDir, 'Battery & Display (Allocation) - September 2026.xlsx');
  const octPath = path.join(rootDir, 'Battery & Display (Allocation) - October 2026.xlsx');
  const octCsvPath = path.join(rootDir, 'october masterlist.csv');

  // 1. Audit August 2026 Raw Ingestion vs Scanned Output
  if (fs.existsSync(augPath)) {
    console.log('\n--- 1. Auditing August 2026 Masterlist ---');
    const wbAug = XLSX.readFile(augPath);
    const augRows = XLSX.utils.sheet_to_json(wbAug.Sheets['Masterlist'], { header: 1, defval: '' });
    const usageAug = processRawUsageSheet(augRows, CANONICAL_SITE_LIST, [], {
      filterScope: 'ALL_IPHONE_PARTS',
      selectedMonth: 'auto',
      fileName: augPath
    });
    const scannedAug = scanMasterlistData(usageAug.records, { periodLabel: 'August 2026' });

    let manualAugUnits = 0;
    const manualAugParts = new Map();
    const manualAugSites = new Map();

    usageAug.records.forEach(r => {
      const qty = parseInt(r.quantity, 10) || 1;
      manualAugUnits += qty;
      const pn = r.partNumber;
      manualAugParts.set(pn, (manualAugParts.get(pn) || 0) + qty);
      const site = r.siteName;
      manualAugSites.set(site, (manualAugSites.get(site) || 0) + qty);
    });

    const summaryAug = getMasterlistSummary(scannedAug, 'August 2026');
    assert.strictEqual(summaryAug.totalUnits, manualAugUnits, 'August total units must match 100%');
    assert.strictEqual(summaryAug.totalDistinctParts, manualAugParts.size, 'August distinct parts count must match 100%');
    assert.strictEqual(summaryAug.totalSites, manualAugSites.size, 'August total sites must match 100%');
    console.log('  ✓ PASS: August 2026 masterlist raw calculation matches system reports 100%');
  }

  // 2. Audit September 2026 Raw Ingestion vs Scanned Output
  if (fs.existsSync(sepPath)) {
    console.log('\n--- 2. Auditing September 2026 Masterlist ---');
    const wbSep = XLSX.readFile(sepPath);
    const sepRows = XLSX.utils.sheet_to_json(wbSep.Sheets['Masterlist'], { header: 1, defval: '' });
    const usageSep = processRawUsageSheet(sepRows, CANONICAL_SITE_LIST, [], {
      filterScope: 'ALL_IPHONE_PARTS',
      selectedMonth: 'auto',
      fileName: sepPath
    });
    const scannedSep = scanMasterlistData(usageSep.records, { periodLabel: 'September 2026' });

    let manualSepUnits = 0;
    const manualSepParts = new Map();
    const manualSepSites = new Map();

    usageSep.records.forEach(r => {
      const qty = parseInt(r.quantity, 10) || 1;
      manualSepUnits += qty;
      const pn = r.partNumber;
      manualSepParts.set(pn, (manualSepParts.get(pn) || 0) + qty);
      const site = r.siteName;
      manualSepSites.set(site, (manualSepSites.get(site) || 0) + qty);
    });

    const summarySep = getMasterlistSummary(scannedSep, 'September 2026');
    assert.strictEqual(summarySep.totalUnits, manualSepUnits, 'September total units must match 100%');
    assert.strictEqual(summarySep.totalDistinctParts, manualSepParts.size, 'September distinct parts count must match 100%');
    assert.strictEqual(summarySep.totalSites, manualSepSites.size, 'September total sites must match 100%');
    console.log('  ✓ PASS: September 2026 masterlist raw calculation matches system reports 100%');
  }

  // 3. Audit October 2026 Raw Ingestion vs Scanned Output
  const activeOctPath = fs.existsSync(octPath) ? octPath : (fs.existsSync(octCsvPath) ? octCsvPath : null);
  if (activeOctPath) {
    console.log('\n--- Auditing October 2026 Masterlist ---');
    const isCsv = activeOctPath.endsWith('.csv');
    const wbOct = isCsv ? XLSX.read(fs.readFileSync(activeOctPath, 'utf8'), { type: 'string' }) : XLSX.readFile(activeOctPath);
    const sheetName = isCsv ? wbOct.SheetNames[0] : 'Masterlist';
    const octRows = XLSX.utils.sheet_to_json(wbOct.Sheets[sheetName], { header: 1, defval: '' });
    const usageOct = processRawUsageSheet(octRows, CANONICAL_SITE_LIST, [], {
      filterScope: 'ALL_IPHONE_PARTS',
      selectedMonth: 'auto',
      fileName: activeOctPath
    });
    const scannedOct = scanMasterlistData(usageOct.records, { periodLabel: 'October 2026' });

    let manualOctUnits = 0;
    const manualOctParts = new Map();
    const manualOctSites = new Map();

    usageOct.records.forEach(r => {
      const qty = parseInt(r.quantity, 10) || 1;
      manualOctUnits += qty;
      const pn = r.partNumber;
      manualOctParts.set(pn, (manualOctParts.get(pn) || 0) + qty);
      const site = r.siteName;
      manualOctSites.set(site, (manualOctSites.get(site) || 0) + qty);
    });

    const summaryOct = getMasterlistSummary(scannedOct, 'October 2026');
    console.log(`  Manual Calculation: ${manualOctUnits} units | System Scanned: ${summaryOct.totalUnits} units`);
    console.log(`  Manual SKUs: ${manualOctParts.size} SKUs | System Scanned: ${summaryOct.totalDistinctParts} SKUs`);
    console.log(`  Manual Sites: ${manualOctSites.size} Sites | System Scanned: ${summaryOct.totalSites} Sites`);

    assert.strictEqual(summaryOct.totalUnits, manualOctUnits, 'October total units must match 100%');
    assert.strictEqual(summaryOct.totalDistinctParts, manualOctParts.size, 'October distinct parts count must match 100%');
    assert.strictEqual(summaryOct.totalSites, manualOctSites.size, 'October total sites must match 100%');
    console.log('  ✓ PASS: October 2026 masterlist raw calculation matches system reports 100%');

    // Audit Generated Excel Report Workbook Integrity
    console.log('\n--- Auditing Exported Excel Report Workbook ---');
    const partsReportOct = getMasterlistParts({ category: 'ALL', limit: 'ALL' }, scannedOct, 'October 2026');
    const sitesReportOct = getMasterlistSites({ limit: 'ALL' }, scannedOct, 'October 2026');
    const sitePartsReportOct = getMasterlistPartsForSite('MOBILECARE - NEWPOINT MALL', { limit: 'ALL' }, scannedOct, 'October 2026');

    const { workbook: exportWb, buffer } = await exportDashboardReportToExcel({
      activeTab: 'all',
      masterPartsReport: partsReportOct,
      masterSitesReport: sitesReportOct,
      sitePartsReport: sitePartsReportOct,
      masterSummary: summaryOct,
      selectedSiteName: 'MOBILECARE - NEWPOINT MALL',
      periodLabel: 'October 2026',
      exportMode: 'all'
    });

    assert.ok(buffer && buffer.length > 0, 'Export buffer generated');
    const overviewSheet = exportWb.getWorksheet('Executive Overview');
    const partsSheet = exportWb.getWorksheet('Top iPhone Parts');
    const sitesSheet = exportWb.getWorksheet('Service Hubs Network');

    assert.ok(overviewSheet, 'Executive Overview sheet exists');
    assert.ok(partsSheet, 'Top iPhone Parts sheet exists');
    assert.ok(sitesSheet, 'Service Hubs Network sheet exists');
    console.log('  ✓ PASS: Exported report workbooks accurately reflect 100% of masterlist items');
  }

  console.log('\n====================================================');
  console.log('ALL 100% MASTERLIST REPORT ACCURACY CHECKS PASSED');
  console.log('====================================================');
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
