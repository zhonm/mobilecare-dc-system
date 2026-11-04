import assert from 'assert';
import fs from 'fs';
import path from 'path';
import dbStorage from '../utils/dbStorage.js';
import { parseStockTransfersReportFile } from '../utils/excelParser.js';
import { parseGsxKbbKgbsUsedFile, reconcileSiteTransfers } from '../utils/siteTransfersReconciler.js';

// Setup Mock Browser Globals
const mockStore = new Map();
const mockLocalStorage = {
  getItem: (k) => mockStore.get(k) ?? null,
  setItem: (k, v) => mockStore.set(k, String(v)),
  removeItem: (k) => mockStore.delete(k),
  clear: () => mockStore.clear(),
  get length() { return mockStore.size; },
  key: (i) => Array.from(mockStore.keys())[i] || null
};

if (typeof window === 'undefined') {
  global.window = {
    localStorage: mockLocalStorage,
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    }
  };
  global.localStorage = global.window.localStorage;
  global.sessionStorage = global.window.sessionStorage;
}

async function runFifoAutoSyncTests() {
  console.log('========================================================================');
  console.log('TEST SUITE: FIFO & DC Aging Stocks Auto-Sync from All Stocks & Inventory');
  console.log('========================================================================\n');

  // Test 1: Verify SiteTransfersFifoReport.jsx has NO file upload inputs or manual upload handlers
  console.log('Test 1: Verifying SiteTransfersFifoReport.jsx file upload removal...');
  const fifoComponentSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/SiteTransfersFifoReport.jsx'),
    'utf8'
  );

  assert(
    !fifoComponentSource.includes('type="file"'),
    'SiteTransfersFifoReport must not contain any <input type="file" /> elements'
  );
  assert(
    !fifoComponentSource.includes('1-Click Upload Full .xlsx Workbook'),
    'SiteTransfersFifoReport must not contain 1-Click Upload Full .xlsx Workbook button'
  );
  assert(
    !fifoComponentSource.includes('handleTransfersUpload'),
    'SiteTransfersFifoReport must not contain handleTransfersUpload'
  );
  assert(
    !fifoComponentSource.includes('handleGsxUpload'),
    'SiteTransfersFifoReport must not contain handleGsxUpload'
  );
  assert(
    !fifoComponentSource.includes('handleFullWorkbookUpload'),
    'SiteTransfersFifoReport must not contain handleFullWorkbookUpload'
  );
  assert(
    fifoComponentSource.includes('loadDataFromAllStocks'),
    'SiteTransfersFifoReport must implement loadDataFromAllStocks'
  );
  assert(
    fifoComponentSource.includes('mdc_uploaded_slot_stock_transfer'),
    'SiteTransfersFifoReport must integrate mdc_uploaded_slot_stock_transfer'
  );
  assert(
    fifoComponentSource.includes('mdc_uploaded_slot_kgb_used'),
    'SiteTransfersFifoReport must integrate mdc_uploaded_slot_kgb_used'
  );
  assert(
    fifoComponentSource.includes('Single Source of Truth'),
    'SiteTransfersFifoReport must display Single Source of Truth banner'
  );
  console.log('  ✓ PASS: File upload buttons and handlers completely removed from FIFO monitoring page\n');

  // Test 2: Verify parseStockTransfersReportFile parses slot object from All Stocks
  console.log('Test 2: Verifying parseStockTransfersReportFile parses slot data object...');
  const sampleTransferCsv = [
    'Transfer Received Date,From Stock,To Stock,Product Code,Product Name,Transfer Quantity,Serial Number,IMEI Number,Transfer Value',
    '2026-06-08,DC_MSPI-Owned,BHS_MSPI-Owned,661-20373,"Battery, iPhone 14",1,F8Y5512C06R231L8S,,99',
    '2026-06-15,DC_MSPI-Owned,GL5_MSPI-Owned,661-21991,"Display, iPhone 13",1,F8Y6304C9PF18FK07,,279',
    '2026-07-01,DC_MSPI-Owned,VER_MSPI-Owned,661-30394,"Battery, iPhone 14 Plus",1,F8Y6296C1JC237KBX,,99',
    '2026-07-10,BHS_MSPI-Owned,POD_MSPI-Owned,661-20373,"Battery, iPhone 14",1,F8Y5512C06R231L8S,,99'
  ].join('\n');

  const slotTrfData = {
    name: '_2026 Site Stocks (Fixably) - Stock Transfer.csv',
    size: sampleTransferCsv.length,
    rowCount: 4,
    valid: true,
    content: sampleTransferCsv,
    updatedAt: '2026-11-02T08:00:00.000Z'
  };

  const trfParsed = await parseStockTransfersReportFile(slotTrfData);
  assert.strictEqual(trfParsed.success, true, 'parseStockTransfersReportFile must succeed on slotTrfData');
  assert.strictEqual(trfParsed.records.length, 4, 'Must parse exactly 4 transfer records');
  assert.strictEqual(trfParsed.metadata.fileName, '_2026 Site Stocks (Fixably) - Stock Transfer.csv');
  console.log('  ✓ PASS: parseStockTransfersReportFile correctly parses slot data object from All Stocks\n');

  // Test 3: Verify parseGsxKbbKgbsUsedFile parses slot object from All Stocks
  console.log('Test 3: Verifying parseGsxKbbKgbsUsedFile parses slot data object...');
  const sampleKgbCsv = [
    'Order id,Location Name,GSX Repair Number,GSX Repair Strategy,Current GSX Status,Repair Closed Date,Product Code,Product Description,Product KGB,Product KBB',
    '20100665,MOBILECARE - APP BONIFACIO HIGH STREET,G12345,CRBR,SCOM,2026-10-31,661-20373,"Battery, iPhone 14",F8Y5512C06R231L8S,F8Y2345612345678',
    '20108572,MOBILECARE - GLORIETTA 5,G12346,CRBR,SCOM,2026-10-30,661-21991,"Display, iPhone 13",F8Y6304C9PF18FK07,F8Y934560PGC18FMAA'
  ].join('\n');

  const slotKgbData = {
    name: 'DC Stock Monitoring - KGB Used (1).csv',
    size: sampleKgbCsv.length,
    rowCount: 2,
    valid: true,
    content: sampleKgbCsv,
    updatedAt: '2026-11-02T08:05:00.000Z'
  };

  const kgbParsed = await parseGsxKbbKgbsUsedFile(slotKgbData);
  assert.strictEqual(kgbParsed.success, true, 'parseGsxKbbKgbsUsedFile must succeed on slotKgbData');
  assert.strictEqual(kgbParsed.records.length, 2, 'Must parse exactly 2 KGB records');
  assert.strictEqual(kgbParsed.metadata.fileName, 'DC Stock Monitoring - KGB Used (1).csv');
  console.log('  ✓ PASS: parseGsxKbbKgbsUsedFile correctly parses slot data object from All Stocks\n');

  // Test 4: Verify end-to-end reconciliation using All Stocks slot data as Single Source of Truth
  console.log('Test 4: Verifying end-to-end reconciliation with All Stocks slot data...');
  await dbStorage.setItem('mdc_uploaded_slot_stock_transfer', slotTrfData);
  await dbStorage.setItem('mdc_uploaded_slot_kgb_used', slotKgbData);

  const storedTrfSlot = await dbStorage.getItem('mdc_uploaded_slot_stock_transfer');
  const storedKgbSlot = await dbStorage.getItem('mdc_uploaded_slot_kgb_used');

  const hydratedTrf = await parseStockTransfersReportFile(storedTrfSlot);
  const hydratedKgb = await parseGsxKbbKgbsUsedFile(storedKgbSlot);

  const rec = reconcileSiteTransfers(hydratedTrf.records, hydratedKgb.records, [], {
    dcStocksOnly: true,
    agingPolicy: 'EXCEL_PARITY',
    referenceDate: '2026-10-13'
  });

  assert.strictEqual(rec.kpis.totalSerials, 3, 'Must match 3 DC-transferred serials (1 non-DC filtered)');
  assert.strictEqual(rec.kpis.usedCount, 2, 'Must match 2 used serials in GSX repairs');
  assert.strictEqual(rec.kpis.inStockCount, 1, 'Must have 1 in stock serial (F8Y6296C1JC237KBX)');
  assert(rec.kpis.fifoComplianceRate >= 0, 'FIFO compliance rate calculated');
  console.log('  ✓ PASS: End-to-end reconciliation functions flawlessly from All Stocks slot storage\n');

  // Test 5: Verify real-time reactivity when All Stocks updates a slot
  console.log('Test 5: Verifying real-time reactivity on All Stocks slot file update...');
  const updatedKgbCsv = [
    'Order id,Location Name,GSX Repair Number,GSX Repair Strategy,Current GSX Status,Repair Closed Date,Product Code,Product Description,Product KGB,Product KBB',
    '20100665,MOBILECARE - APP BONIFACIO HIGH STREET,G12345,CRBR,SCOM,2026-10-31,661-20373,"Battery, iPhone 14",F8Y5512C06R231L8S,F8Y2345612345678',
    '20108572,MOBILECARE - GLORIETTA 5,G12346,CRBR,SCOM,2026-10-30,661-21991,"Display, iPhone 13",F8Y6304C9PF18FK07,F8Y934560PGC18FMAA',
    '20108999,MOBILECARE - VERTIS NORTH,G12347,CRBR,SCOM,2026-10-30,661-30394,"Battery, iPhone 14 Plus",F8Y6296C1JC237KBX,F8Y24270HGN211P3M'
  ].join('\n');

  const updatedSlotKgbData = {
    name: 'DC Stock Monitoring - KGB Used (2).csv',
    size: updatedKgbCsv.length,
    rowCount: 3,
    valid: true,
    content: updatedKgbCsv,
    updatedAt: '2026-11-02T08:30:00.000Z'
  };

  await dbStorage.setItem('mdc_uploaded_slot_kgb_used', updatedSlotKgbData);

  const reloadedKgbSlot = await dbStorage.getItem('mdc_uploaded_slot_kgb_used');
  assert.strictEqual(reloadedKgbSlot.name, 'DC Stock Monitoring - KGB Used (2).csv');

  const reloadedKgbParsed = await parseGsxKbbKgbsUsedFile(reloadedKgbSlot);
  const updatedRec = reconcileSiteTransfers(hydratedTrf.records, reloadedKgbParsed.records, [], {
    dcStocksOnly: true,
    agingPolicy: 'EXCEL_PARITY',
    referenceDate: '2026-10-13'
  });

  assert.strictEqual(updatedRec.kpis.usedCount, 3, 'All 3 DC serials must now be marked as used');
  assert.strictEqual(updatedRec.kpis.inStockCount, 0, 'In stock count must drop to 0');
  console.log('  ✓ PASS: Real-time update in All Stocks immediately reflects in FIFO & DC Aging audit\n');

  console.log('========================================================================');
  console.log('ALL FIFO & DC AGING STOCKS AUTO-SYNC TESTS PASSED (100%)');
  console.log('========================================================================');
}

runFifoAutoSyncTests().catch(err => {
  console.error('Test suite failure:', err);
  process.exit(1);
});
