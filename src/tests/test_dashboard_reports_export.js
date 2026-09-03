import assert from 'assert';
import {
  exportDashboardReportToExcel,
  exportDashboardReportToPDF,
  exportDcInventoryToExcel,
  exportDcInventoryToPDF
} from '../utils/dashboardReportExporter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rawData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/rawMasterlistData.json'), 'utf-8'));

console.log('====================================================');
console.log('TEST SUITE: System Dashboard Reports Export (XLSX & PDF)');
console.log('====================================================');

async function runTests() {
  const masterSummary = {
    totalRecords: rawData.totalRecords || 8295,
    totalUnits: rawData.totalUnits || 8295,
    totalValuationUSD: rawData.totalValuationUSD || 1632575,
    totalValuationPHP: rawData.totalValuationPHP || 93056775,
    totalDistinctParts: rawData.totalDistinctParts || 415,
    totalSites: rawData.totalSites || 28,
    categoryStats: rawData.categoryStats || {}
  };

  const partsList = (rawData.partsSummary || []).slice(0, 15).map(p => ({
    ...p,
    pctShare: ((p.totalUnits || 1) / (rawData.totalUnits || 8295)) * 100
  }));

  const masterPartsReport = {
    totalCount: partsList.length,
    totalFilteredUnits: partsList.reduce((s, p) => s + p.totalUnits, 0),
    totalFilteredValUSD: partsList.reduce((s, p) => s + p.totalValUSD, 0),
    totalFilteredValPHP: partsList.reduce((s, p) => s + p.totalValUSD * 57, 0),
    displayList: partsList,
    all: partsList
  };

  const sitesList = (rawData.sites || []).map((s, idx) => ({
    id: `site-${idx}`,
    siteName: s.siteName,
    shortName: s.siteName.replace('MOBILECARE - ', ''),
    region: 'Metro Manila',
    isMM: true,
    totalUnits: s.totalUnits,
    totalValUSD: s.totalValUSD,
    totalValPHP: s.totalValPHP,
    distinctPartsCount: s.distinctPartsCount,
    topPart: s.topParts?.[0] || null,
    pctShare: ((s.totalUnits || 1) / (rawData.totalUnits || 8295)) * 100
  }));

  const masterSitesReport = {
    totalSitesCount: sitesList.length,
    grandTotalUnits: sitesList.reduce((s, x) => s + x.totalUnits, 0),
    grandTotalValUSD: sitesList.reduce((s, x) => s + x.totalValUSD, 0),
    displayList: sitesList,
    all: sitesList,
    topSite: sitesList[0]
  };

  const sitePartsReport = {
    matchedSite: sitesList[0],
    totalPartsCount: partsList.length,
    siteTotalUnits: 820,
    siteTotalValUSD: 154000,
    siteTotalValPHP: 154000 * 57,
    displayList: partsList,
    all: partsList
  };

  // 1. Test Excel Export - Top Parts (Current Tab)
  {
    const { workbook, buffer, filename } = await exportDashboardReportToExcel({
      activeTab: 'top-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      reportCategory: 'ALL',
      reportSearch: '',
      periodLabel: 'September 2026',
      exportMode: 'current'
    });

    assert.ok(workbook, 'Workbook should be created');
    assert.ok(buffer && buffer.byteLength > 0, 'Buffer should have positive byte length');
    assert.ok(filename.includes('Top_iPhone_Parts_Report'), `Filename should reflect report type: ${filename}`);

    const partsSheet = workbook.getWorksheet('Top iPhone Parts');
    assert.ok(partsSheet, 'Top iPhone Parts worksheet should exist');
    assert.strictEqual(partsSheet.getCell('A1').value.includes('National iPhone Parts Ranking'), true, 'A1 should have title banner');

    const summarySheet = workbook.getWorksheet('Executive Overview');
    assert.ok(summarySheet, 'Executive Overview worksheet should exist');
    console.log('  ✓ PASS: exportDashboardReportToExcel (Top Parts active view) creates valid multi-sheet workbook');
  }

  // 2. Test Excel Export - Service Hubs (Current Tab)
  {
    const { workbook, buffer, filename } = await exportDashboardReportToExcel({
      activeTab: 'top-sites',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      periodLabel: 'September 2026',
      exportMode: 'current'
    });

    assert.ok(workbook, 'Workbook should be created');
    assert.ok(buffer && buffer.byteLength > 0, 'Buffer should have positive byte length');
    assert.ok(filename.includes('Service_Hubs_Network_Report'), `Filename should reflect service hubs: ${filename}`);

    const sitesSheet = workbook.getWorksheet('Service Hubs Network');
    assert.ok(sitesSheet, 'Service Hubs Network worksheet should exist');
    console.log('  ✓ PASS: exportDashboardReportToExcel (Service Hubs active view) creates valid workbook');
  }

  // 3. Test Excel Export - Site Specific Parts (Current Tab)
  {
    const { workbook, buffer, filename } = await exportDashboardReportToExcel({
      activeTab: 'site-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      selectedSiteName: 'MOBILECARE - NEWPOINT MALL',
      periodLabel: 'September 2026',
      exportMode: 'current'
    });

    assert.ok(workbook, 'Workbook should be created');
    assert.ok(buffer && buffer.byteLength > 0, 'Buffer should have positive byte length');
    assert.ok(filename.includes('Branch_Report_MOBILECARE___NEWPOINT_MALL'), `Filename should include branch name: ${filename}`);
    console.log('  ✓ PASS: exportDashboardReportToExcel (Branch Parts active view) creates valid branch workbook');
  }

  // 4. Test Excel Export - Full Master Package (All Tabs)
  {
    const { workbook, buffer, filename } = await exportDashboardReportToExcel({
      activeTab: 'top-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      selectedSiteName: 'MOBILECARE - NEWPOINT MALL',
      periodLabel: 'September 2026',
      exportMode: 'all'
    });

    assert.ok(workbook, 'Full package workbook should be created');
    assert.ok(buffer && buffer.byteLength > 0, 'Full package buffer should have positive byte length');
    assert.ok(filename.includes('Dashboard_Master_Intelligence_Package'), `Filename should reflect master package: ${filename}`);

    assert.ok(workbook.getWorksheet('Executive Overview'), 'Sheet 1: Executive Overview must exist');
    assert.ok(workbook.getWorksheet('Top iPhone Parts'), 'Sheet 2: Top iPhone Parts must exist');
    assert.ok(workbook.getWorksheet('Service Hubs Network'), 'Sheet 3: Service Hubs Network must exist');
    assert.ok(workbook.getWorksheet('Branch - NEWPOINT MALL'), 'Sheet 4: Branch specific sheet must exist');
    console.log('  ✓ PASS: exportDashboardReportToExcel (Full Package) includes all 4 distinct intelligence sheets');
  }

  // 5. Test PDF Export - Top Parts View
  {
    const { doc, filename } = exportDashboardReportToPDF({
      activeTab: 'top-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      periodLabel: 'September 2026',
      exportMode: 'current',
      supervisorSettings: { supervisor_name: 'Anjo Alcazar', supervisor_title: 'MDC Supervisor of DC' }
    });

    assert.ok(doc, 'PDF Document should be returned');
    assert.ok(filename.includes('Top_iPhone_Parts_Report'), `Filename should match: ${filename}`);
    const pageCount = doc.internal.getNumberOfPages();
    assert.ok(pageCount >= 1, `PDF should have at least 1 page, got: ${pageCount}`);
    console.log('  ✓ PASS: exportDashboardReportToPDF (Top Parts) builds valid landscape corporate PDF');
  }

  // 6. Test PDF Export - Service Hubs View
  {
    const { doc, filename } = exportDashboardReportToPDF({
      activeTab: 'top-sites',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      periodLabel: 'September 2026',
      exportMode: 'current',
      supervisorSettings: { supervisor_name: 'Anjo Alcazar', supervisor_title: 'MDC Supervisor of DC' }
    });

    assert.ok(doc, 'PDF Document should be returned');
    assert.ok(filename.includes('Service_Hubs_Report'), `Filename should match: ${filename}`);
    console.log('  ✓ PASS: exportDashboardReportToPDF (Service Hubs) builds valid corporate PDF');
  }

  // 7. Test PDF Export - Branch Parts View
  {
    const { doc, filename } = exportDashboardReportToPDF({
      activeTab: 'site-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      selectedSiteName: 'MOBILECARE - NEWPOINT MALL',
      periodLabel: 'September 2026',
      exportMode: 'current',
      supervisorSettings: { supervisor_name: 'Anjo Alcazar', supervisor_title: 'MDC Supervisor of DC' }
    });

    assert.ok(doc, 'PDF Document should be returned');
    assert.ok(filename.includes('Branch_Report'), `Filename should match: ${filename}`);
    console.log('  ✓ PASS: exportDashboardReportToPDF (Branch Parts) builds valid corporate PDF');
  }

  // 8. Test DC In-Stock Snapshot Inventory Exports
  {
    const sampleInventory = [
      {
        part_number: '661-21991',
        description: 'Battery, iPhone 13',
        category: 'BATTERY',
        units: [{ serial_number: 'F8Y123456789' }, { serial_number: 'F8Y123456780' }],
        maxDaysInDc: 5,
        latest_serial: 'F8Y123456789'
      },
      {
        part_number: '661-22369',
        description: 'Display, iPhone 13 Pro Max',
        category: 'DISPLAY',
        units: [{ serial_number: 'G9P123456789' }],
        maxDaysInDc: 2,
        latest_serial: 'G9P123456789'
      }
    ];

    const excelRes = await exportDcInventoryToExcel(sampleInventory, { filter: 'ALL', search: '' });
    assert.ok(excelRes.workbook, 'DC inventory workbook created');
    assert.ok(excelRes.buffer && excelRes.buffer.byteLength > 0, 'Buffer valid');

    const pdfRes = exportDcInventoryToPDF(sampleInventory, { filter: 'ALL', search: '' });
    assert.ok(pdfRes.doc, 'DC inventory PDF created');
    console.log('  ✓ PASS: exportDcInventoryToExcel and exportDcInventoryToPDF generate valid in-stock records');
  }

  // 9. Test Defensive PeriodLabel Object Handling (e.g. { year: 2026, month: 9, label: 'September 2026' })
  {
    const objectPeriod = { year: 2026, month: 9, label: 'September 2026' };
    const excelRes = await exportDashboardReportToExcel({
      activeTab: 'top-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      periodLabel: objectPeriod,
      exportMode: 'all'
    });
    assert.ok(excelRes.workbook, 'Excel export should handle object periodLabel seamlessly');
    assert.ok(!excelRes.filename.includes('[object Object]'), `Filename should not contain [object Object]: ${excelRes.filename}`);

    const pdfRes = exportDashboardReportToPDF({
      activeTab: 'top-parts',
      masterPartsReport,
      masterSitesReport,
      sitePartsReport,
      masterSummary,
      periodLabel: objectPeriod,
      exportMode: 'current'
    });
    assert.ok(pdfRes.doc, 'PDF export should handle object periodLabel seamlessly');
    assert.ok(!pdfRes.filename.includes('[object Object]'), `PDF Filename should not contain [object Object]: ${pdfRes.filename}`);
    console.log('  ✓ PASS: Excel and PDF exports defensively handle object periodLabel ({ year, month, label }) without error');
  }

  console.log('====================================================');
  console.log('ALL DASHBOARD REPORTS EXPORT TESTS PASSED (100%)');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
