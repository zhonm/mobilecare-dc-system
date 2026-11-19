import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  excelDateToISO,
  diffIsoDays,
  classifyTatCategory,
  calculateDcAgingStatus,
  ingestDcMonitoringFile,
  ingestCompleteWorkbookFile,
  computeDcStockMonitoringAnalytics
} from '../utils/dcStockMonitoringEngine.js';
import {
  buildDcMonitoringExcelBuffer,
  buildSdrRepTatPdfDocument
} from '../utils/dcStockMonitoringExporter.js';
import { ALL_PAGES, PAGE_TITLES } from '../constants/navigation.js';
import {
  ROLE_PRESETS,
  resolveEffectivePermittedPages,
  encodePermittedPagesForStorage,
  extractRevokedDefaultModules
} from '../constants/roles.js';
import {
  DC_MONITORING_ALL_SLOT_IDS,
  ALL_STOCKS_LINKED_SLOT_IDS,
  ALL_STOCKS_SLOT_MAPPINGS,
  buildSlotChunksForCloud,
  hydrateSlotChunksFromCloud,
  computeSlotContentHash,
  pullAvailableFixablySlotsFromAllStocks,
  syncAllStocksSlotsToDcMonitoring
} from '../services/dcMonitoringStorageService.js';
import dbStorage from '../utils/dbStorage.js';

async function runTests() {
  console.log('TEST SUITE: DC Stock Monitoring, Ingestion & SDR/RepTAT Parity');

  // ── 1. UTC Excel Serial Date & TAT Helpers ───────────────────────────────
  assert.strictEqual(excelDateToISO(46055), '2026-02-02', 'Excel serial 46055 must map strictly to 2026-02-02 UTC');
  assert.strictEqual(excelDateToISO(46027), '2026-01-05', 'Excel serial 46027 must map strictly to 2026-01-05 UTC');
  assert.strictEqual(diffIsoDays('2026-02-06', '2026-02-06'), 0);
  assert.strictEqual(diffIsoDays('2026-02-02', '2026-02-21'), 19);
  assert.strictEqual(classifyTatCategory(0), 'SDR');
  assert.strictEqual(classifyTatCategory(-2), 'SDR');
  assert.strictEqual(classifyTatCategory(2), '1–3 Days');
  assert.strictEqual(classifyTatCategory(6), '4–6 Days');
  assert.strictEqual(classifyTatCategory(9), '7–9 Days');
  assert.strictEqual(classifyTatCategory(12), '10–12 Days');
  assert.strictEqual(classifyTatCategory(15), '13–15 Days');
  assert.strictEqual(classifyTatCategory(16), '16+ Days');

  const deadAging = calculateDcAgingStatus('2026-01-05', '2026-07-05');
  assert.strictEqual(deadAging.bucket, 'Dead Stock');
  assert.ok(deadAging.daysElapsed >= 180);
  console.log('  ✓ PASS: UTC Excel date conversion, TAT buckets, and aging helpers');

  // ── 2. CSV Schema Validation & Error Handling ────────────────────────────
  const badRes = await ingestDcMonitoringFile('sdr_current', 'Foo,Bar,Baz\n1,2,3');
  assert.strictEqual(badRes.validationLog.status, 'error');
  assert.ok(badRes.validationLog.errors.length > 0);

  const validSdrCsv = [
    'Order ID,Received (date),Closed (date),Location name,Status,Device description,Device warranty name',
    '20099901,2026-05-01,2026-05-01,MOBILECARE - VERTIS NORTH,Order Picked Up,iPhone 15 Pro,Apple Limited Warranty',
    '20099902,2026-05-01,2026-05-04,MOBILECARE - GLORIETTA 5,Order Picked Up,iPhone 13,Out Of Warranty (No Coverage)'
  ].join('\n');
  const goodSdrCsvRes = await ingestDcMonitoringFile('sdr_current', validSdrCsv);
  assert.strictEqual(goodSdrCsvRes.validationLog.status, 'valid');
  assert.strictEqual(goodSdrCsvRes.records.length, 2);
  console.log('  ✓ PASS: CSV/XLSX schema validator & error reporting');

  // ── 3. Standalone same-day-repair-2026-2026-11-11.xlsx Ingestion ──────────
  const sdrFilePath = path.resolve('DC Stock Monitoring Files/same-day-repair-2026-2026-11-11.xlsx');
  assert.ok(fs.existsSync(sdrFilePath), 'Expected reference file same-day-repair-2026-2026-11-11.xlsx');
  const sdrBuf = new Uint8Array(fs.readFileSync(sdrFilePath));
  const standaloneSdr = await ingestDcMonitoringFile('sdr_current', sdrBuf);
  assert.strictEqual(standaloneSdr.validationLog.status, 'valid');
  assert.strictEqual(standaloneSdr.records.length, 12811, 'Standalone SDR export should contain 12,811 order rows');
  console.log(`  ✓ PASS: Standalone SDR XLSX ingested (${standaloneSdr.records.length.toLocaleString()} orders)`);

  // ── 4. Complete Workbook Import & Exact Google Sheets Parity Checks ──────
  const wbFilePath = path.resolve('DC Stock Monitoring Files/DC Stock Monitoring.xlsx');
  assert.ok(fs.existsSync(wbFilePath), 'Expected reference workbook DC Stock Monitoring.xlsx');
  const wbBuf = new Uint8Array(fs.readFileSync(wbFilePath));
  const wbResult = await ingestCompleteWorkbookFile(wbBuf);

  assert.strictEqual(Object.keys(wbResult.datasets).length, 6, 'All 6 input sheets should auto-split from workbook');
  assert.strictEqual(wbResult.extras.shippingCosts.length, 8, 'Should extract 8 Lalamove monthly rows from Stock Transfer');
  assert.ok(Object.keys(wbResult.extras.nonSerialRemarks).length >= 15, 'Should import Excel cell remarks from Non-Serial Repair');

  const analytics = computeDcStockMonitoringAnalytics(wbResult.datasets, {
    referenceDate: '2026-11-11',
    inventoryYearFilter: '2026',
    shippingCosts: wbResult.extras.shippingCosts
  });

  // DC Transfers exact parity
  assert.strictEqual(analytics.kpis.dcTransferSerialCount, 2961, 'DC Transfer unique serial count parity (2,961)');
  const febVol = analytics.transferAnalytics.monthlyTransferVolume.find(m => m.month === 'February')?.count;
  const augVol = analytics.transferAnalytics.monthlyTransferVolume.find(m => m.month === 'August')?.count;
  assert.strictEqual(febVol, 415, 'February DC transfer volume parity (415)');
  assert.strictEqual(augVol, 905, 'August DC transfer volume parity (905)');

  // Shipping Cost exact parity
  assert.strictEqual(Number(analytics.kpis.totalShippingCostPhp.toFixed(2)), 76450.87, 'Shipping cost total parity (₱76,450.87)');

  // Sales (DC) exact parity
  assert.strictEqual(analytics.kpis.salesOrderCount, 2085, 'Sales (DC) order row count parity (2,085)');
  assert.strictEqual(Number(analytics.kpis.totalDcSalesPhp.toFixed(2)), 8991643.11, 'Sales (DC) total revenue parity (₱8,991,643.11)');

  // Warranty Breakdown (DC) exact category parity
  const getWCount = (name) => analytics.warrantyDc.breakdown.find(w => w.warranty === name)?.count || 0;
  assert.strictEqual(getWCount('Apple Limited Warranty'), 244, 'Warranty Apple Limited Warranty parity (244)');
  assert.strictEqual(getWCount('Customer Satisfaction (CS) Code'), 31, 'Warranty CS Code parity (31)');
  assert.strictEqual(getWCount('Out Of Warranty (No Coverage)'), 1650, 'Warranty OOW parity (1,650)');
  assert.strictEqual(getWCount('AppleCare Protection Plan'), 12, 'Warranty AppleCare parity (12)');

  // SDR (DC) & RepTAT Breakdown exact parity
  assert.strictEqual(analytics.kpis.dcSdrCount, 1166, 'DC Stock SDR exact count parity (1,166)');
  assert.strictEqual(analytics.kpis.dcRepTatMatchedCount, 2059, 'DC Used RepTAT matched count parity (2,059)');
  assert.strictEqual(analytics.sdrAndRepTat.dcStock.tatBreakdown.find(t => t.category === '1–3 Days')?.count, 551);
  assert.strictEqual(analytics.sdrAndRepTat.dcStock.tatBreakdown.find(t => t.category === '4–6 Days')?.count, 117);
  assert.strictEqual(analytics.sdrAndRepTat.dcStock.tatBreakdown.find(t => t.category === '7–9 Days')?.count, 58);
  assert.strictEqual(analytics.sdrAndRepTat.dcStock.tatBreakdown.find(t => t.category === '10–12 Days')?.count, 51);
  assert.strictEqual(analytics.sdrAndRepTat.dcStock.tatBreakdown.find(t => t.category === '13–15 Days')?.count, 24);
  assert.strictEqual(analytics.sdrAndRepTat.dcStock.tatBreakdown.find(t => t.category === '16+ Days')?.count, 92);

  // SDR (2025) Baseline exact parity
  assert.strictEqual(analytics.kpis.baseline2025SdrCount, 680, 'SDR (2025) baseline SDR count parity (680)');
  assert.strictEqual(analytics.kpis.baseline2025Total, 6532, 'SDR (2025) completed order total parity (6,532)');

  // Exceptions & Queues exact parity
  assert.strictEqual(analytics.kpis.doaAllCount, 217, 'DOA All rows parity (217)');
  assert.strictEqual(analytics.kpis.doaDcCount, 6, 'DOA DC Stock rows parity (6)');
  assert.strictEqual(analytics.kpis.gprCount, 37, 'GPR queue parity (37)');
  assert.strictEqual(analytics.kpis.undispatchedCinCount, 1865, 'Undispatched CIN DC parity (1,865)');
  assert.strictEqual(analytics.kpis.unusedS2SCount, 25, 'Unused S2S transfer serials parity (25)');
  assert.ok(analytics.kpis.nonSerialRepairCount > 0, 'Non-Serial repairs populated with automated cross-checks');
  console.log('  ✓ PASS: Full Google Sheets / Excel workbook formula & numeric parity verified');

  // ── 5. Automated Report Generation (Excel & PDF) ─────────────────────────
  const xlsxBuffer = await buildDcMonitoringExcelBuffer(analytics, wbResult.extras.nonSerialRemarks);
  assert.ok(xlsxBuffer && xlsxBuffer.byteLength > 10000, 'ExcelJS export buffer generated cleanly');
  const pdfDoc = buildSdrRepTatPdfDocument(analytics);
  const pdfOut = pdfDoc.output('arraybuffer');
  assert.ok(pdfOut && pdfOut.byteLength > 2000, 'jsPDF SDR & RepTAT report generated cleanly');
  console.log('  ✓ PASS: Automated ExcelJS (.xlsx) and jsPDF (.pdf) generation verified');

  // ── 6. Routing, Navigation & RBAC Registration Checks ────────────────────
  assert.ok(ALL_PAGES.some(p => p.id === 'dc-stock-monitoring'), 'dc-stock-monitoring registered in ALL_PAGES');
  assert.ok(PAGE_TITLES['dc-stock-monitoring'], 'dc-stock-monitoring has PAGE_TITLES entry');
  assert.ok(ROLE_PRESETS.superadmin.includes('dc-stock-monitoring'), 'superadmin can access dc-stock-monitoring');
  assert.ok(ROLE_PRESETS.admin.includes('dc-stock-monitoring'), 'admin can access dc-stock-monitoring');
  assert.ok(ROLE_PRESETS.user.includes('dc-stock-monitoring'), 'user can access dc-stock-monitoring');
  assert.ok(!ROLE_PRESETS.parts_management.includes('dc-stock-monitoring'), 'parts_management excludes dc-stock-monitoring');
  console.log('  ✓ PASS: Navigation & RBAC registration checks passed');

  // ── 7. Legacy Admin Upgrade & Explicit Revocation Resolution ─────────────
  const legacyAdminPerms = [
    'dashboard', 'forecast', 'allocation', 'scan-in',
    'site-transfers-fifo', 'forecast-reports', 'orders'
  ];
  const upgradedAdminPerms = resolveEffectivePermittedPages('admin', legacyAdminPerms);
  assert.ok(
    upgradedAdminPerms.includes('dc-stock-monitoring'),
    'Existing admin accounts saved before dc-stock-monitoring rollout must automatically receive access'
  );

  // Explicit revocation by Superadmin must stick and never expose raw sentinel strings
  const cleanRevokedList = upgradedAdminPerms.filter(p => p !== 'dc-stock-monitoring');
  const encodedRevoked = encodePermittedPagesForStorage('admin', cleanRevokedList);
  assert.ok(encodedRevoked.includes('!dc-stock-monitoring'), 'Storage encoding records explicit admin module revocation');
  assert.deepStrictEqual(extractRevokedDefaultModules(encodedRevoked), ['dc-stock-monitoring']);

  const rehydratedAfterRevoke = resolveEffectivePermittedPages('admin', encodedRevoked);
  assert.ok(!rehydratedAfterRevoke.includes('dc-stock-monitoring'), 'Explicitly revoked admin access must stay revoked');
  assert.ok(!rehydratedAfterRevoke.includes('!dc-stock-monitoring'), 'UI/session permittedPages must strip sentinel markers');

  // Re-granting restores clean permission without marker
  const regrantedEncoded = encodePermittedPagesForStorage('admin', [...rehydratedAfterRevoke, 'dc-stock-monitoring']);
  assert.ok(!regrantedEncoded.includes('!dc-stock-monitoring'));
  assert.ok(resolveEffectivePermittedPages('admin', regrantedEncoded).includes('dc-stock-monitoring'));
  console.log('  ✓ PASS: Legacy admin auto-grant & explicit revocation persistence verified');

  // ── 8. Lossless Cloud Columnar Packing, Chunking & Integrity Checks ─────
  const cloudStamp = '2026-11-11T09:30:00.000Z';
  for (const slotId of DC_MONITORING_ALL_SLOT_IDS) {
    const origRows = wbResult.datasets[slotId] || [];
    assert.ok(origRows.length > 0, `Expected parsed rows for ${slotId}`);
    const chunks = buildSlotChunksForCloud(slotId, origRows, cloudStamp);
    assert.ok(chunks.length >= 1, `${slotId} must produce at least 1 cloud chunk`);
    for (const chunk of chunks) {
      const payloadBytes = JSON.stringify(chunk).length;
      assert.ok(payloadBytes < 1400000, `${chunk.id} serialized JSON size (${payloadBytes}) must stay bounded`);
    }
    const hydrated = hydrateSlotChunksFromCloud(slotId, chunks, cloudStamp, chunks.length);
    assert.deepStrictEqual(hydrated, origRows, `${slotId} cloud chunk rehydration must match original rows losslessly`);
  }

  // Verify partial or timestamp-mismatched chunks are safely rejected
  const sampleChunks = buildSlotChunksForCloud('kgb_used', wbResult.datasets.kgb_used, cloudStamp);
  if (sampleChunks.length > 1) {
    assert.strictEqual(
      hydrateSlotChunksFromCloud('kgb_used', sampleChunks.slice(0, 1), cloudStamp, sampleChunks.length),
      null,
      'Incomplete chunk set must return null instead of partial corrupted data'
    );
  }
  assert.strictEqual(
    hydrateSlotChunksFromCloud('site_stock', buildSlotChunksForCloud('site_stock', wbResult.datasets.site_stock, cloudStamp), '2099-01-01T00:00:00.000Z', 1),
    null,
    'Timestamp mismatch across chunks must be rejected'
  );
  console.log('  ✓ PASS: Lossless multi-chunk cloud serialization & corruption guards verified');

  // ── 9. Realtime Signal Guard & Multi-Admin Cloud Sync Wiring ─────────────
  const dcUpdatedBroadcast = {
    slotIds: ['site_stock', 'sdr_current'],
    updatedAt: cloudStamp,
    updatedBy: 'Zhon Manaois',
    senderId: 'usr-zhon',
    count: wbResult.datasets.site_stock.length + wbResult.datasets.sdr_current.length
  };
  assert.ok(JSON.stringify(dcUpdatedBroadcast).length < 45000, 'DC_MONITORING_UPDATED payload must stay < 45KB');
  assert.strictEqual('records' in dcUpdatedBroadcast || 'snapshot_data' in dcUpdatedBroadcast, false);

  const cloudSyncSrc = fs.readFileSync(path.resolve('src/context/useCloudSync.js'), 'utf8');
  const authSrc = fs.readFileSync(path.resolve('src/context/useAuth.js'), 'utf8');
  const userMgmtSrc = fs.readFileSync(path.resolve('src/context/useUserManagement.js'), 'utf8');
  const dcPageSrc = fs.readFileSync(path.resolve('src/components/DcStockMonitoring.jsx'), 'utf8');

  assert.ok(cloudSyncSrc.includes("'DC_MONITORING_UPDATED'"), 'useCloudSync must route DC_MONITORING_UPDATED globally');
  assert.ok(cloudSyncSrc.includes("'DC_MONITORING_CLEARED'"), 'useCloudSync must route DC_MONITORING_CLEARED globally');
  assert.ok(cloudSyncSrc.includes('resolveEffectivePermittedPages'), 'useCloudSync must resolve legacy admin permissions');
  assert.ok(authSrc.includes('resolveEffectivePermittedPages'), 'useAuth must resolve legacy admin permissions');
  assert.ok(userMgmtSrc.includes('encodePermittedPagesForStorage'), 'useUserManagement must encode explicit admin revocations');
  assert.ok(dcPageSrc.includes('syncDcMonitoringFromCloud'), 'DcStockMonitoring must run cloud sync');
  assert.ok(dcPageSrc.includes('mdc:dc_monitoring_cloud_signal'), 'DcStockMonitoring must react to global Realtime alerts');
  assert.ok(!dcPageSrc.includes("table: 'saved_records'"), 'DcStockMonitoring must NOT open redundant postgres_changes channel on excluded saved_records table');

  // Content hash determinism & change detection for egress-safe uploads
  const siteStockHash1 = computeSlotContentHash('site_stock', wbResult.datasets.site_stock);
  const siteStockHash2 = computeSlotContentHash('site_stock', wbResult.datasets.site_stock);
  const modifiedSiteStock = [
    { ...wbResult.datasets.site_stock[0], quantity: (wbResult.datasets.site_stock[0]?.quantity || 0) + 1 },
    ...wbResult.datasets.site_stock.slice(1)
  ];
  const siteStockHashModified = computeSlotContentHash('site_stock', modifiedSiteStock);
  assert.strictEqual(siteStockHash1, siteStockHash2, 'Identical datasets must produce matching content hashes');
  assert.notStrictEqual(siteStockHash1, siteStockHashModified, 'Modified dataset must produce distinct content hash');
  console.log('  ✓ PASS: Multi-admin Realtime, Free-Tier egress dedup & cloud sync wiring verified');

  // ── 10. All Stocks & Inventory <-> DC Monitoring Auto-Sync Bridge ───────
  const prevWindow = globalThis.window;
  const memStore = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
      setItem: (k, v) => { memStore.set(k, String(v)); },
      removeItem: (k) => { memStore.delete(k); }
    }
  };
  try {
  assert.deepStrictEqual(
    ALL_STOCKS_LINKED_SLOT_IDS,
    ['site_stock', 'kgb_used', 'stock_transfer'],
    'Exactly the 3 Fixably slots must be linked to All Stocks & Inventory'
  );
  assert.strictEqual(ALL_STOCKS_SLOT_MAPPINGS.length, 3);

  const sampleSiteStockCsv = [
    'Stock name,Stock type,Part number,Part description,Part serial,Last received date,Quantity,Part value,Total value',
    'ASP - Vertis North,DC Stock,661-36863,Battery iPhone 15,SN-SYNC-001,2026-11-18,1,5000,5000'
  ].join('\n');
  const sampleKgbCsv = [
    'Order ID,Location name,GSX repair number,Repair closed date,Product code,Product description,Product KGB,Product KBB',
    '20111001,MOBILECARE - VERTIS NORTH,G12345678,2026-11-18,661-36863,Battery iPhone 15,SN-SYNC-001,SN-OLD-001'
  ].join('\n');
  const sampleTransferCsv = [
    'Transfer received date,From stock,To stock,Product code,Product name,Transfer quantity,Serial number,Transfer value',
    '2026-11-18,DC Stock,ASP - Vertis North,661-36863,Battery iPhone 15,1,SN-SYNC-001,5000'
  ].join('\n');

  const t1 = '2026-11-19T01:00:00.000Z';
  const t2 = '2026-11-19T02:00:00.000Z';
  const t3 = '2026-11-19T03:00:00.000Z';

  // Seed 2 finalized slots and 1 pending (unstaged) slot in All Stocks cache
  await dbStorage.setItem('mdc_uploaded_slot_site_stock', {
    name: 'Custom reports - Inventory Value.csv',
    content: sampleSiteStockCsv,
    rowCount: 1,
    updatedAt: t1,
    pendingUpload: false
  });
  await dbStorage.setItem('mdc_uploaded_slot_kgb_used', {
    name: 'Custom reports - GSX KBB KGBs Used.csv',
    content: sampleKgbCsv,
    rowCount: 1,
    updatedAt: t1,
    pendingUpload: true
  });
  await dbStorage.setItem('mdc_uploaded_slot_stock_transfer', {
    name: 'Custom reports - Stock Transfers.csv',
    content: sampleTransferCsv,
    rowCount: 1,
    updatedAt: t1,
    pendingUpload: false
  });

  // Auto-sync should pull only finalized slots (site_stock + stock_transfer) and skip pendingUpload=true (kgb_used)
  const autoRes1 = await syncAllStocksSlotsToDcMonitoring({
    currentState: { datasets: {}, validationLogs: {}, slotMeta: {}, clearedAt: null },
    userName: 'Test Admin',
    skipCloud: true,
    force: false,
    includePending: false
  });
  assert.strictEqual(autoRes1.changed, true);
  assert.deepStrictEqual(autoRes1.pulledSlotIds.sort(), ['site_stock', 'stock_transfer']);
  assert.strictEqual(autoRes1.state.validationLogs.site_stock.source, 'All Stocks & Inventory');
  assert.strictEqual(autoRes1.state.datasets.site_stock.length, 1);
  assert.strictEqual(autoRes1.allStocksStatuses.kgb_used.pendingUpload, true);

  // Re-running auto-sync with identical timestamps must be a no-op (no redundant reparsing/writes)
  const autoResNoop = await syncAllStocksSlotsToDcMonitoring({
    currentState: autoRes1.state,
    userName: 'Test Admin',
    skipCloud: true,
    force: false
  });
  assert.strictEqual(autoResNoop.changed, false);
  assert.strictEqual(autoResNoop.pulledCount, 0);

  // Finalizing KGB Used in All Stocks at newer timestamp t2 must automatically pull only kgb_used
  await dbStorage.setItem('mdc_uploaded_slot_kgb_used', {
    name: 'Custom reports - GSX KBB KGBs Used.csv',
    content: sampleKgbCsv,
    rowCount: 1,
    updatedAt: t2,
    pendingUpload: false
  });
  const autoRes2 = await syncAllStocksSlotsToDcMonitoring({
    currentState: autoRes1.state,
    userName: 'Test Admin',
    skipCloud: true,
    force: false
  });
  assert.strictEqual(autoRes2.changed, true);
  assert.deepStrictEqual(autoRes2.pulledSlotIds, ['kgb_used']);
  assert.strictEqual(autoRes2.state.datasets.kgb_used.length, 1);

  // Cleared workspace at t3 must NOT auto-resurrect older t1/t2 All Stocks files unless forced
  const clearedGuardRes = await pullAvailableFixablySlotsFromAllStocks({
    currentDatasets: {},
    currentSlotMeta: {},
    clearedAt: t3,
    force: false
  });
  assert.strictEqual(clearedGuardRes.pulledCount, 0, 'Cleared workspace must not auto-resurrect older All Stocks slots');

  // Verify cross-module wiring in FixablyInventoryDashboard, DcStockMonitoring, and IngestionCenterPanel
  const fixablySrc = fs.readFileSync(path.resolve('src/components/FixablyInventoryDashboard.jsx'), 'utf8');
  const ingestionSrc = fs.readFileSync(path.resolve('src/components/dc-monitoring/IngestionCenterPanel.jsx'), 'utf8');
  assert.ok(fixablySrc.includes('syncAllStocksSlotsToDcMonitoring'), 'FixablyInventoryDashboard must push uploaded Fixably slots to DC Monitoring');
  assert.ok(dcPageSrc.includes('syncAllStocksSlotsToDcMonitoring'), 'DcStockMonitoring must auto-sync connected Fixably slots from All Stocks');
  assert.ok(ingestionSrc.includes('ALL_STOCKS_LINKED_SLOT_IDS'), 'IngestionCenterPanel must distinguish linked All Stocks slots from manual DC slots');
  assert.ok(ingestionSrc.includes('Update in All Stocks'), 'IngestionCenterPanel must provide direct navigation to All Stocks & Inventory');

  // Clean up test keys from local in-memory dbStorage
  await dbStorage.removeItem('mdc_uploaded_slot_site_stock');
  await dbStorage.removeItem('mdc_uploaded_slot_kgb_used');
  await dbStorage.removeItem('mdc_uploaded_slot_stock_transfer');
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
  console.log('  ✓ PASS: All Stocks & Inventory <-> DC Monitoring live auto-sync bridge verified');
}

runTests().catch((err) => {
  console.error('❌ FAIL:', err);
  process.exit(1);
});
