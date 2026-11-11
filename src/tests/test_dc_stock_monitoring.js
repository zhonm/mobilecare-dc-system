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
  buildSlotChunksForCloud,
  hydrateSlotChunksFromCloud,
  computeSlotContentHash
} from '../services/dcMonitoringStorageService.js';

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
}

runTests().catch((err) => {
  console.error('❌ FAIL:', err);
  process.exit(1);
});
