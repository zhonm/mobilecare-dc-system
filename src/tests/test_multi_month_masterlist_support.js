/**
 * Automated Multi-Month Masterlist Validation Suite
 * Verifies that the system works correctly for ANY month and year:
 * - October 2026
 * - November 2026
 * - December 2026
 * - January 2027
 * - Arbitrary future periods
 */

import assert from 'assert';
import {
  scanMasterlistData,
  getMasterlistSummary,
  getMasterlistParts,
  getMasterlistSites,
  getMasterlistPartsForSite
} from '../utils/rawMasterlistScanner.js';
import { exportDashboardReportToExcel } from '../utils/dashboardReportExporter.js';

console.log('====================================================');
console.log('TEST SUITE: Multi-Month Masterlist Dynamic Lifecycle');
console.log('====================================================');

async function testMonth(monthName, monthNum, year, mockUnits) {
  const periodLabel = `${monthName} ${year}`;
  console.log(`\nTesting Lifecycle for: ${periodLabel} (Month ${monthNum})...`);

  // Generate synthetic masterlist repair rows for this month
  const testRows = [
    ['Location Name', 'GSX Repair Number', 'Repair Closed Date', 'Product Code', 'Product Description', 'Quantity'],
    ['MOBILECARE - NEWPOINT MALL', 'R10001', `${year}-${String(monthNum).padStart(2, '0')}-05`, '661-21991', 'Battery, iPhone 13', mockUnits.partA],
    ['MOBILECARE - SM MEGAMALL', 'R10002', `${year}-${String(monthNum).padStart(2, '0')}-08`, '661-21991', 'Battery, iPhone 13', mockUnits.partA2],
    ['MOBILECARE - AYALA CEBU', 'R10003', `${year}-${String(monthNum).padStart(2, '0')}-12`, '661-22002', 'Display, iPhone 13 Pro', mockUnits.partB],
    ['MOBILECARE - SM DAVAO', 'R10004', `${year}-${String(monthNum).padStart(2, '0')}-15`, '661-23000', 'Camera, iPhone 14', mockUnits.partC]
  ];

  const totalExpectedUnits = mockUnits.partA + mockUnits.partA2 + mockUnits.partB + mockUnits.partC;

  // 1. Ingestion / Scanner Verification
  const scanned = scanMasterlistData(testRows, { periodLabel });
  assert.strictEqual(scanned.periodLabel, periodLabel, `Period label must be preserved as ${periodLabel}`);
  assert.strictEqual(scanned.totalUnits, totalExpectedUnits, `Total units must strictly match ${totalExpectedUnits}`);
  assert.strictEqual(scanned.totalDistinctParts, 3, 'Must detect 3 distinct parts');
  assert.strictEqual(scanned.totalSites, 4, 'Must detect 4 distinct service sites');

  // 2. Summary & Query Getters
  const summary = getMasterlistSummary(scanned);
  assert.strictEqual(summary.totalUnits, totalExpectedUnits, 'Summary reflects dynamic units');

  const parts = getMasterlistParts({ sortBy: 'units', limit: 5 }, scanned);
  assert.strictEqual(parts.displayList[0].part_number, '661-21991', 'Top part is 661-21991');
  assert.strictEqual(parts.displayList[0].totalUnits, mockUnits.partA + mockUnits.partA2, 'Top part has combined units');

  const sites = getMasterlistSites({ limit: 'ALL' }, scanned);
  assert.strictEqual(sites.totalSitesCount, 4, '4 sites reported');

  const newpointParts = getMasterlistPartsForSite('MOBILECARE - NEWPOINT MALL', {}, scanned);
  assert.strictEqual(newpointParts.siteTotalUnits, mockUnits.partA, 'Site parts properly filtered for Newpoint');

  // 3. Excel Multi-Sheet Export Verification
  const { workbook, filename } = await exportDashboardReportToExcel({
    exportMode: 'all',
    masterPartsReport: parts,
    masterSitesReport: sites,
    sitePartsReport: newpointParts,
    masterSummary: summary,
    selectedSiteName: 'MOBILECARE - NEWPOINT MALL',
    periodLabel
  });

  const expectedFilename = `MDC_Dashboard_Master_Intelligence_Package_${monthName}_${year}.xlsx`;
  assert.strictEqual(filename, expectedFilename, `Export filename must be ${expectedFilename} (got ${filename})`);

  const overviewSheet = workbook.getWorksheet('Executive Overview');
  const titleCell = overviewSheet.getCell('A1').value;
  const demandCell = overviewSheet.getCell('A4').value;
  const netCell = overviewSheet.getCell('E4').value;

  assert(titleCell.includes(periodLabel), `Title banner must contain ${periodLabel}`);
  assert(demandCell.includes(totalExpectedUnits.toLocaleString()), `Demand cell must contain ${totalExpectedUnits.toLocaleString()}`);
  assert(netCell.includes('3 SKUs across 4 Service Hubs'), 'Network summary reflects scanned counts');

  console.log(`  ✓ PASS: ${periodLabel} parsed, queried, and exported successfully as ${filename}`);
}

async function runAllMonths() {
  await testMonth('October', 10, 2026, { partA: 50, partA2: 30, partB: 20, partC: 15 });
  await testMonth('November', 11, 2026, { partA: 75, partA2: 45, partB: 35, partC: 25 });
  await testMonth('December', 12, 2026, { partA: 100, partA2: 60, partB: 40, partC: 30 });
  await testMonth('January', 1, 2027, { partA: 120, partA2: 80, partB: 50, partC: 40 });
  await testMonth('February', 2, 2027, { partA: 90, partA2: 50, partB: 30, partC: 20 });

  console.log('\n====================================================');
  console.log('ALL MULTI-MONTH MASTERLIST TESTS PASSED (100%)');
  console.log('====================================================');
}

runAllMonths().catch(err => {
  console.error('Multi-month test failed:', err);
  process.exit(1);
});
