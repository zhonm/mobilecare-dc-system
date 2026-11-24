import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { OFFICIAL_BRANCH_DIRECTORY } from '../constants/branchDirectory.js';
import {
  computeFileSha256,
  parseReportRefList,
  parseUsdPrice,
  resolveSiteCodeFromValue,
  parseSpreadsheetRows,
  detectDuplicateSpreadsheetImport,
  detectBatchDuplicateSpreadsheetImports,
  validateSpreadsheetImportDraft,
  getSiteColorTheme
} from '../utils/ctSpreadsheetImporter.js';
import { buildCtConsolidatedAuditExcelBuffer } from '../utils/ctExcelExporter.js';

async function runTests() {
  console.log('Running CT CSV/XLSX Spreadsheet Import tests...');

  // 1. USD Price parsing
  assert.equal(parseUsdPrice('$145.50'), 145.5);
  assert.equal(parseUsdPrice('USD 24.10'), 24.1);
  assert.equal(parseUsdPrice(22), 22);
  assert.equal(parseUsdPrice(''), 0);

  // 2. Site detection from explicit Site column & filename (never false Northeast Square)
  const sites = [
    { site_code: 'DC-MDC', site_name: 'Distribution Center' },
    { site_code: 'ASP NES', site_name: 'MOBILECARE - NORTHEAST SQUARE' },
    { site_code: 'APP MEG', site_name: 'MOBILECARE - APP MEGAMALL' },
    { site_code: 'APP RM', site_name: 'MOBILECARE - APP MAGNOLIA' },
    { site_code: 'ASP ABR', site_name: 'MOBILECARE - ABREEZA' }
  ];
  assert.equal(resolveSiteCodeFromValue('APP MAGNOLIA', sites, ''), 'APP RM');
  assert.equal(resolveSiteCodeFromValue('SM MEGAMALL', sites, ''), 'APP MEG');
  assert.equal(resolveSiteCodeFromValue('', sites, 'ABREEZA.xlsx'), 'ASP ABR');
  assert.equal(resolveSiteCodeFromValue('0001745440', sites, ''), 'APP MEG');
  assert.equal(resolveSiteCodeFromValue('UNKNOWN BRANCH', sites, 'UNKNOWN.csv'), '');

  // 3. Parse structured Gemini CSV/XLSX rows as 100% source of truth + multi-Report Ref for single site
  const oldInaccurateCatalog = [
    {
      id: 'old-1',
      part_number: '077-01158',
      description: 'OLD WRONG CATALOG DESCRIPTION',
      item_kind: 'consumable',
      unit_cost: 999
    }
  ];

  const rows = [
    {
      'Report Ref': 'SG02858846',
      'Receiving Site': 'APP MAGNOLIA',
      'Document Date': '2026-11-13',
      'Part Number': '077-01158',
      'Description': 'SVC,IPHONE DUO,KIT,CVL0 FIXTURE',
      'Type': 'Tool',
      'Qty': 1,
      'USD Price': '$145.50',
      'Serial Numbers': 'SN123456'
    },
    {
      'Report Ref': 'SG02858912',
      'Receiving Site': 'APP MAGNOLIA',
      'Document Date': '2026-11-13',
      'Part Number': '923-15257',
      'Description': 'SVC,IPHONE DUO ADHESIVE BTH,30PK',
      'Type': 'Consumable',
      'Qty': 3,
      'USD Price': '24.10'
    }
  ];

  const parsed = parseSpreadsheetRows(rows, {
    filename: 'APP. MAGNOLIA.xlsx',
    catalogItems: oldInaccurateCatalog,
    sites
  });

  // 100% CSV/XLSX source of truth (must NOT overwrite with old catalog description/type/price)
  assert.equal(parsed.detectedSiteCode, 'APP RM');
  assert.deepEqual(parsed.reportRefs, ['SG02858846', 'SG02858912']);
  assert.equal(parsed.reportRef, 'SG02858846, SG02858912');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].part_number, '077-01158');
  assert.equal(parsed.items[0].description, 'SVC,IPHONE DUO,KIT,CVL0 FIXTURE');
  assert.equal(parsed.items[0].item_kind, 'tool');
  assert.equal(parsed.items[0].unit_cost, 145.5);
  assert.deepEqual(parsed.items[0].serial_numbers, ['SN123456']);

  assert.equal(parsed.items[1].part_number, '923-15257');
  assert.equal(parsed.items[1].item_kind, 'consumable');
  assert.equal(parsed.items[1].quantity, 3);
  assert.equal(parsed.items[1].unit_cost, 24.1);

  // 4. Duplicate detection (SHA-256 + individual Report Ref overlap + intra-batch)
  const hash1 = await computeFileSha256(new TextEncoder().encode('csv-bytes-1'));
  const existingImports = [
    {
      id: 'imp-1',
      filename: 'APP. MAGNOLIA.xlsx',
      file_hash: hash1,
      report_ref: 'SG02858846, SG02858912',
      report_refs: ['SG02858846', 'SG02858912'],
      status: 'completed',
      imported_by_name: 'Zhon Manaois',
      imported_at: '2026-11-24T07:00:00.000Z'
    }
  ];

  const dupByIndividualRef = detectDuplicateSpreadsheetImport({
    fileHash: 'different-hash',
    filename: 'OTHER.csv',
    reportRef: 'SG02858912',
    existingImports
  });
  assert.equal(dupByIndividualRef.isDuplicate, true);
  assert.equal(dupByIndividualRef.matchType, 'report_ref');

  const batchDup = detectBatchDuplicateSpreadsheetImports(
    [
      { id: 'b1', filename: 'A.csv', fileHash: 'h-a', reportRef: 'SG00001111' },
      { id: 'b2', filename: 'B.csv', fileHash: 'h-a', reportRef: 'SG00002222' }
    ],
    existingImports
  );
  assert.equal(batchDup.b1.isDuplicate, false);
  assert.equal(batchDup.b2.isDuplicate, true);
  assert.equal(batchDup.b2.matchType, 'batch_file_hash');

  // 5. Validation rules (including pricing validation)
  const badPriceDraft = validateSpreadsheetImportDraft({
    reportRef: 'SG02858846',
    siteCode: 'APP RM',
    documentDate: '2026-11-13',
    items: [
      { id: 'r1', selected: true, part_number: '077-01158', description: 'Fixture', item_kind: 'tool', quantity: 1, unit_cost: -5, serial_numbers: [] }
    ],
    duplicateCheck: { isDuplicate: false }
  });
  assert.equal(badPriceDraft.valid, false);
  assert.ok(badPriceDraft.rowErrors.r1.some(e => e.includes('USD Price')));

  const validDraft = validateSpreadsheetImportDraft({
    reportRef: parsed.reportRef,
    siteCode: parsed.detectedSiteCode,
    documentDate: parsed.documentDate,
    items: parsed.items,
    duplicateCheck: { isDuplicate: false }
  });
  assert.equal(validDraft.valid, true);
  assert.equal(validDraft.toolCount, 1);
  assert.equal(validDraft.consumableQty, 3);

  assert.deepEqual(parseReportRefList('SG10001, SG10002; SG10001'), ['SG10001', 'SG10002']);

  // 6. Multi-site single CSV/XLSX: per-row site detection across multiple branches
  const multiSiteRows = [
    {
      'Report Ref': 'SG02858846',
      'Receiving Site': 'APP MAGNOLIA',
      'Part Number': '077-01158',
      'Description': 'CVL0 Fixture',
      'Type': 'Tool',
      'Qty': 1,
      'USD Price': 145.5
    },
    {
      'Report Ref': 'SG02857736',
      'Receiving Site': 'ABREEZA',
      'Part Number': '923-15257',
      'Description': 'Adhesive 30PK',
      'Type': 'Consumable',
      'Qty': 2,
      'USD Price': 24.1
    },
    {
      'Report Ref': 'SG02859999',
      'Receiving Site': 'SM MEGAMALL',
      'Part Number': '661-64073',
      'Description': 'Sled Close',
      'Type': 'Tool',
      'Qty': 1,
      'USD Price': 22
    }
  ];

  const multiParsed = parseSpreadsheetRows(multiSiteRows, {
    filename: 'CONSOLIDATED_SITES.xlsx',
    catalogItems: [],
    sites
  });
  assert.equal(multiParsed.isMultiSite, true);
  assert.deepEqual(multiParsed.detectedSites, ['APP RM', 'ASP ABR', 'APP MEG']);
  assert.equal(multiParsed.items[0].site_code, 'APP RM');
  assert.equal(multiParsed.items[1].site_code, 'ASP ABR');
  assert.equal(multiParsed.items[2].site_code, 'APP MEG');

  const multiValid = validateSpreadsheetImportDraft({
    reportRef: multiParsed.reportRef,
    siteCode: '',
    documentDate: multiParsed.documentDate,
    items: multiParsed.items,
    duplicateCheck: { isDuplicate: false }
  });
  assert.equal(multiValid.valid, true);

  // 7. Duplicate Shipment Guard (HAWB + Delivery + PN) & Price Mismatch & Partial Scan Detector
  const guardRows = [
    {
      'Site Code': 'ZAMBOANGA',
      'Ship-To ID': '0001128342',
      'Report Ref / Doc #': 'SG02845039',
      'HAWB #': '5723179512',
      'Delivery #': 'QBU2684674',
      'Part Number': '661-64073',
      'Description': 'SVC, IPHONE DUO, SLED CLOSE',
      'Type': 'Consumable',
      'Qty': 1,
      'USD Price': 22.0,
      'Line Total USD': 22.0
    },
    {
      // Exact duplicate shipment row (same HAWB + Delivery + PN) -> must be skipped
      'Site Code': 'ZAMBOANGA',
      'Ship-To ID': '0001128342',
      'Report Ref / Doc #': 'SG02845039',
      'HAWB #': '5723179512',
      'Delivery #': 'QBU2684674',
      'Part Number': '661-64073',
      'Description': 'SVC, IPHONE DUO, SLED CLOSE',
      'Type': 'Consumable',
      'Qty': 1,
      'USD Price': 22.0,
      'Line Total USD': 22.0
    },
    {
      // Price mismatch row (2 * 22 != 99) + Missing Invoice Ref + Partial Scan Note
      'Site Code': 'SM CITY ILOILO',
      'HAWB #': '3022928274',
      'Delivery #': 'QBV2348961',
      'Part Number': '923-16065',
      'Description': 'SCREW KIT',
      'Type': 'Consumable',
      'Qty': 2,
      'USD Price': 22.0,
      'Line Total USD': 99.0,
      'Notes': 'Packing List Page 1 of 3 only (Pages 2-3 not uploaded)'
    }
  ];
  const allDirSites = Object.entries(OFFICIAL_BRANCH_DIRECTORY).map(([code, d]) => ({
    site_code: code,
    site_name: d.name
  }));
  const guardParsed = parseSpreadsheetRows(guardRows, {
    filename: 'GUARD_TEST.csv',
    catalogItems: [],
    sites: allDirSites
  });
  assert.equal(guardParsed.duplicateRowsSkipped, 1);
  assert.equal(guardParsed.items.length, 2);
  assert.equal(guardParsed.items[0].site_code, 'ASP ZAM');
  assert.equal(guardParsed.items[1].site_code, 'ASP ILO');
  assert.equal(guardParsed.items[1].missing_invoice_ref, true);
  assert.equal(guardParsed.items[1].price_mismatch, true);
  assert.equal(guardParsed.partialScanAlerts.length, 1);

  // 8. Live Audit Excel Generation on MOBILECARE_CONSOLIDATED_IPHONE_DUO_IMPORT-v2.csv (31 Tools, 151 Consumables, =SUM formulas)
  if (fs.existsSync('./MOBILECARE_CONSOLIDATED_IPHONE_DUO_IMPORT-v2.csv')) {
    const csvBuf = fs.readFileSync('./MOBILECARE_CONSOLIDATED_IPHONE_DUO_IMPORT-v2.csv');
    const csvWb = XLSX.read(csvBuf, { type: 'buffer' });
    const csvRows = XLSX.utils.sheet_to_json(csvWb.Sheets[csvWb.SheetNames[0]], { defval: '' });
    const liveParsed = parseSpreadsheetRows(csvRows, {
      filename: 'MOBILECARE_CONSOLIDATED_IPHONE_DUO_IMPORT-v2.csv',
      catalogItems: [],
      sites: allDirSites
    });
    assert.equal(liveParsed.items.length, 182);
    assert.equal(liveParsed.partialScanAlerts.length, 2); // SM City Iloilo + Festive Walk Iloilo

    const excelBuf = await buildCtConsolidatedAuditExcelBuffer({
      items: liveParsed.items,
      sites: allDirSites,
      generatedBy: 'Audit Test'
    });
    const auditWb = new ExcelJS.Workbook();
    await auditWb.xlsx.load(excelBuf);
    assert.deepEqual(
      auditWb.worksheets.map(w => w.name),
      ['Summary by Site', 'Summary by Part Number', 'All Line Items']
    );

    const summaryWs = auditWb.getWorksheet('Summary by Site');
    const totalRow = summaryWs.getRow(summaryWs.rowCount);
    assert.equal(totalRow.getCell(1).value, 'TOTAL');
    assert.ok(String(totalRow.getCell(3).value?.formula || '').startsWith('SUM('));
    assert.equal(totalRow.getCell(3).value?.result, 31, 'Tools Grand Total must be 31');
    assert.equal(totalRow.getCell(4).value?.result, 151, 'Consumables Grand Total must be 151');
    assert.equal(totalRow.getCell(5).value?.result, 182, 'Total Units Grand Total must be 182');

    // Verify fallback pastel color works for unknown future sites
    const futureTheme = getSiteColorTheme('ASP FUTURE-99');
    assert.ok(futureTheme.excelFill.startsWith('FF'));
  }

  console.log('✅ All CT CSV/XLSX Spreadsheet Import tests passed!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
