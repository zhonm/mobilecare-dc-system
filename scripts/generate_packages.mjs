import fs from 'fs';
import XLSX from 'xlsx';
import {
  scanMasterlistData,
  getMasterlistSummary,
  getMasterlistParts,
  getMasterlistSites,
  getMasterlistPartsForSite
} from '../src/utils/rawMasterlistScanner.js';
import { exportDashboardReportToExcel } from '../src/utils/dashboardReportExporter.js';
import { processRawUsageSheet, CANONICAL_SITE_LIST } from '../src/utils/excelParser.js';

async function generatePackage(allocationFile, periodLabel, targetOutputFile) {
  console.log(`Generating ${targetOutputFile} from ${allocationFile}...`);
  const wb = XLSX.readFile(allocationFile);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Masterlist'], { header: 1, defval: '' });

  // Ingest through the authoritative raw usage pipeline to filter in-scope iPhone records
  const usageResult = processRawUsageSheet(rows, CANONICAL_SITE_LIST, [], {
    filterScope: 'ALL_IPHONE_PARTS',
    selectedMonth: 'auto',
    fileName: allocationFile
  });

  const scanned = scanMasterlistData(usageResult.records, { periodLabel });
  const masterSummary = getMasterlistSummary(scanned);
  const masterPartsReport = getMasterlistParts({ category: 'ALL', search: '', limit: 'ALL', sortBy: 'units' }, scanned);
  const masterSitesReport = getMasterlistSites({ search: '', limit: 'ALL' }, scanned);
  const selectedSite = masterSitesReport.all?.[0]?.siteName || 'MOBILECARE - NEWPOINT MALL';
  const sitePartsReport = getMasterlistPartsForSite(selectedSite, scanned);

  const { workbook } = await exportDashboardReportToExcel({
    exportMode: 'all',
    masterPartsReport,
    masterSitesReport,
    sitePartsReport,
    masterSummary,
    selectedSiteName: selectedSite,
    reportCategory: 'ALL',
    reportSearch: '',
    periodLabel
  });

  const buffer = await workbook.xlsx.writeBuffer();
  fs.writeFileSync(targetOutputFile, Buffer.from(buffer));
  console.log(`Successfully written ${targetOutputFile} (${buffer.byteLength} bytes)`);
  console.log(`  - Total Units: ${masterSummary.totalUnits.toLocaleString()}`);
  console.log(`  - Total SKUs: ${masterSummary.totalDistinctParts}`);
  console.log(`  - Total Sites: ${masterSummary.totalSites}`);
  console.log(`  - Valuation USD: $${masterSummary.totalValuationUSD.toLocaleString()}`);
}

async function main() {
  await generatePackage(
    'Battery & Display (Allocation) - August 2026.xlsx',
    'August 2026',
    'MDC_Dashboard_Master_Intelligence_Package_August_2026.xlsx'
  );

  await generatePackage(
    'Battery & Display (Allocation) - September 2026.xlsx',
    'September 2026',
    'MDC_Dashboard_Master_Intelligence_Package_September_2026.xlsx'
  );

  console.log('\nAll packages generated successfully.');
}

main().catch(err => {
  console.error('Error generating packages:', err);
  process.exit(1);
});
