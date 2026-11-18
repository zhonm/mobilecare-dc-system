import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseKgbUsedFile,
  computeKgbContentHash
} from '../utils/kgbConsumptionEngine.js';
import {
  scanKgbMasterlistData,
  getMasterlistSummary,
  getMasterlistParts,
  getMasterlistSites,
  getAllPartsServiceHubsRanking,
  getMasterlistPartsForSite
} from '../utils/rawMasterlistScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Dashboard Distribution Intelligence — Unified KGB Source');
console.log('========================================================================');

// ── Test 1: parseKgbUsedFile deduplication & deterministic contentHash ──────
const sampleKgbCsv = [
  'Order id,Location Name,GSX Repair Number,GSX Repair Strategy,Current GSX Status,Repair Closed Date,Product Code,Product Description,Product KGB,Product KBB',
  '2001001,MOBILECARE - VERTIS NORTH,G700001,CIN,SCOM,11/15/2026,661-21991,"Battery, iPhone 13",KGBSER001,KBB001',
  '2001001,MOBILECARE - VERTIS NORTH,G700001,CIN,SCOM,11/15/2026,661-21991,"Battery, iPhone 13",KGBSER001,KBB001', // exact duplicate serial
  '2001002,MOBILECARE - BGC HIGH STREET,G700002,CIN,SPCM,11/16/2026,661-22309,"Display, iPhone 13 Pro Max",KGBSER002,KBB002',
  '2001003,MOBILECARE - VERTIS NORTH,G700003,CIN,SCOM,11/16/2026,661-21991,"Battery, iPhone 13",KGBSER003,KBB003',
  '2001004,MOBILECARE - CEBU,G700004,CIN,SCOM,11/16/2026,ZP661-50233,"iPad (A16) Wi-Fi",KGBIPAD01,KBB004' // non-iPhone part
].join('\n');

const hash1 = computeKgbContentHash(sampleKgbCsv);
const hash2 = computeKgbContentHash(sampleKgbCsv);
assert.strictEqual(hash1, hash2, 'Content hash must be deterministic');
assert.ok(hash1.startsWith('kgb-'), 'Content hash must have expected prefix');

const parsed = await parseKgbUsedFile(sampleKgbCsv);
assert.strictEqual(parsed.success, true, 'KGB CSV must parse successfully');
assert.strictEqual(parsed.duplicatesInFileCount, 1, 'Must filter 1 duplicate row within KGB CSV');
assert.strictEqual(parsed.validRowCount, 4, 'Must retain 4 unique parsed rows');
assert.strictEqual(parsed.contentHash, hash1, 'Parse result must carry deterministic contentHash');
console.log('  ✓ PASS: parseKgbUsedFile deduplicates identical rows and computes deterministic hash');

// ── Test 2: scanKgbMasterlistData & Daily Trend Aggregation ─────────────────
// Also test cross-record deduplication when an extra duplicate object is passed
const recordsWithDup = [
  ...parsed.records,
  { ...parsed.records[0] }
];
const scanned = scanKgbMasterlistData(recordsWithDup, {
  sourceFileName: 'DC Stock Monitoring - KGB Used (1).csv',
  sourceUpdatedAt: '2026-11-17T08:00:00.000Z',
  contentHash: parsed.contentHash
});

assert.ok(scanned, 'scanKgbMasterlistData must return a valid object');
assert.strictEqual(scanned.source, 'UNIFIED_KGB_USED', 'Source must be UNIFIED_KGB_USED');
assert.strictEqual(scanned.totalUnits, 3, 'Must count 3 unique iPhone parts (excluding iPad & duplicate)');
assert.strictEqual(scanned.duplicatesRemoved, 1, 'Must report 1 duplicate removed during scan');
assert.strictEqual(scanned.totalDistinctParts, 2, 'Must detect 2 distinct iPhone SKUs');
assert.strictEqual(scanned.totalSites, 2, 'Must detect 2 active iPhone service hubs');
assert.strictEqual(scanned.dailyTrends.length, 2, 'Must aggregate 2 active dates (Nov 15 and Nov 16)');
assert.strictEqual(scanned.dailyTrends[0].date, '2026-11-15');
assert.strictEqual(scanned.dailyTrends[0].units, 1);
assert.strictEqual(scanned.dailyTrends[1].date, '2026-11-16');
assert.strictEqual(scanned.dailyTrends[1].units, 2);
assert.strictEqual(scanned.dailyTrendSummary.latestUnits, 2);
assert.strictEqual(scanned.dailyTrendSummary.dayOverDayPct, 100);
console.log('  ✓ PASS: scanKgbMasterlistData aggregates iPhone parts, hubs, and daily trends accurately');

// ── Test 3: Compatibility with Masterlist Report Helpers ────────────────────
const summary = getMasterlistSummary(scanned);
assert.strictEqual(summary.totalUnits, 3);
assert.strictEqual(summary.totalDistinctParts, 2);
assert.strictEqual(summary.totalSites, 2);

const partsRep = getMasterlistParts({ category: 'ALL', limit: 'ALL', sortBy: 'units' }, scanned);
assert.strictEqual(partsRep.totalCount, 2);
assert.strictEqual(partsRep.displayList[0].part_number, '661-21991');
assert.strictEqual(partsRep.displayList[0].totalUnits, 2);

const sitesRep = getMasterlistSites({ limit: 'ALL' }, scanned);
assert.strictEqual(sitesRep.totalSitesCount, 2);
assert.strictEqual(sitesRep.topSite.siteName, 'MOBILECARE - VERTIS NORTH');

const sitePartsRep = getMasterlistPartsForSite('MOBILECARE - VERTIS NORTH', { category: 'ALL', limit: 'ALL' }, scanned);
assert.strictEqual(sitePartsRep.siteTotalUnits, 2);

// Regression test: getMasterlistSummary / Parts / Sites must NEVER fall back to monthly baseline
// when activePeriod is e.g. "November 2026" and KGB report has periodLabel "Daily KGB Used Report"
const novPeriod = { month: 11, year: 2026, label: 'November 2026' };
const novSummary = getMasterlistSummary(scanned, novPeriod);
assert.strictEqual(novSummary.totalUnits, 3, 'Must use KGB scanned data even when activePeriod is November 2026');
const novParts = getMasterlistParts({ category: 'ALL', limit: 'ALL' }, scanned, novPeriod);
assert.strictEqual(novParts.totalCount, 2, 'getMasterlistParts must not fall back to monthly data');
const novSites = getMasterlistSites({ limit: 'ALL' }, scanned, novPeriod);
assert.strictEqual(novSites.totalSitesCount, 2, 'getMasterlistSites must not fall back to monthly data');
const emptyKgb = {
  source: 'UNIFIED_KGB_USED',
  periodLabel: 'Daily KGB Used Report',
  totalUnits: 0,
  totalValUSD: 0,
  totalValPHP: 0,
  totalDistinctParts: 0,
  totalSites: 0,
  categoryStats: {},
  sites: [],
  partsSummary: []
};
assert.strictEqual(getMasterlistSummary(emptyKgb, novPeriod).totalUnits, 0, 'Empty UNIFIED_KGB_USED must stay 0 instead of falling back to monthly baseline');
console.log('  ✓ PASS: Masterlist report helpers (summary, parts, sites, site-parts) work seamlessly');

// ── Test 4: Dashboard.jsx & FixablyInventoryDashboard.jsx Structural Checks ─
const dashboardSrc = fs.readFileSync(path.join(projectRoot, 'src/components/Dashboard.jsx'), 'utf8');
assert.ok(dashboardSrc.includes('mdc_uploaded_slot_kgb_used'), 'Dashboard.jsx must read mdc_uploaded_slot_kgb_used');
assert.ok(dashboardSrc.includes('mdc_kgb_masterlist_cache'), 'Dashboard.jsx must cache scanned KGB masterlist in IndexedDB');
assert.ok(dashboardSrc.includes('scanKgbMasterlistData'), 'Dashboard.jsx must use scanKgbMasterlistData');
assert.ok(dashboardSrc.includes('Last Data Refresh:'), 'Dashboard.jsx must display Last Data Refresh date and time');
assert.ok(dashboardSrc.includes('KGB Used Report Verified'), 'Dashboard.jsx must show KGB validation status');
assert.ok(dashboardSrc.includes('Daily iPhone Parts Consumption Trend'), 'Dashboard.jsx must render Daily Trend Analysis section');
assert.ok(!dashboardSrc.includes('getActiveMasterlist(null, activePeriod)'), 'Dashboard.jsx must not fall back to monthly getActiveMasterlist');

// Verify all-parts service hubs ranking includes non-iPhone parts, revenue, and income
assert.ok(scanned.allPartsSummary, 'scanKgbMasterlistData must include allPartsSummary');
assert.strictEqual(scanned.allPartsSummary.totalUnits, 4, 'All-parts summary must include the iPad part (4 total units)');
assert.strictEqual(scanned.allPartsSummary.iphoneUnits, 3, 'All-parts summary must track 3 iPhone units');
assert.strictEqual(scanned.allPartsSummary.nonIphoneUnits, 1, 'All-parts summary must track 1 non-iPhone unit');
const allHubsByDemand = getAllPartsServiceHubsRanking({ sortBy: 'demand', limit: 'ALL' }, scanned);
const allHubsByRevenue = getAllPartsServiceHubsRanking({ sortBy: 'revenue', limit: 'ALL' }, scanned);
const allHubsByIncome = getAllPartsServiceHubsRanking({ sortBy: 'income', limit: 'ALL' }, scanned);
assert.strictEqual(allHubsByDemand.grandTotalUnits, 4, 'All-parts hubs ranking must total 4 units across all parts');
assert.ok(allHubsByRevenue.grandTotalRevenueUSD > 0, 'All-parts hubs ranking must compute positive revenue');
assert.ok(allHubsByIncome.grandTotalIncomeUSD > 0, 'All-parts hubs ranking must compute positive income');
assert.ok(allHubsByRevenue.topByRevenue, 'All-parts hubs ranking must expose topByRevenue');
assert.ok(allHubsByIncome.topByIncome, 'All-parts hubs ranking must expose topByIncome');

// Verify new section order: Daily Trend -> Category & Top Hubs -> Distribution Intelligence -> ... -> Consumables & Service Tools Center at bottom
const idxTrend = dashboardSrc.indexOf('Daily iPhone Parts Consumption Trend');
const idxCategory = dashboardSrc.indexOf('iPhone Demand by Category');
const idxTopHubs = dashboardSrc.indexOf('Top Service Hubs • All Parts Demand &amp; Revenue');
const idxDistIntel = dashboardSrc.indexOf('Distribution Intelligence • iPhone Masterlist Reports');
const idxSnapshot = dashboardSrc.indexOf('DC Stock Inventory Snapshot');
const idxConsumables = dashboardSrc.indexOf('Consumables &amp; Service Tools Center');
assert.ok(
  idxTrend > 0 && idxTrend < idxCategory && idxCategory < idxTopHubs && idxTopHubs < idxDistIntel && idxDistIntel < idxSnapshot && idxSnapshot < idxConsumables,
  'Dashboard.jsx must place Daily Trend at top, Category & Top Hubs directly below it, above Distribution Intelligence, and Consumables & Service Tools Center at the bottom'
);

const fixablySrc = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');
assert.ok(fixablySrc.includes('computeKgbContentHash'), 'FixablyInventoryDashboard.jsx must compute KGB content hash');
assert.ok(fixablySrc.includes('Duplicate KGB Report Detected'), 'FixablyInventoryDashboard.jsx must warn on duplicate KGB report upload');
assert.ok(fixablySrc.includes("new BroadcastChannel('mdc_kgb_sync')"), 'FixablyInventoryDashboard.jsx must broadcast KGB sync updates');

const cloudSyncSrc = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf8');
assert.ok(cloudSyncSrc.includes('mdc_kgb_cloud_synced'), 'useCloudSync.js must dispatch mdc_kgb_cloud_synced for other admin users');
assert.ok(cloudSyncSrc.includes("dbStorage.setItem('master_kgb_upload_history_registry'"), 'useCloudSync.js must persist master_kgb_upload_history_registry to IndexedDB');
assert.ok(cloudSyncSrc.includes('master_dashboard_kgb_intelligence'), 'useCloudSync.js must hydrate master_dashboard_kgb_intelligence for exact multi-user parity');
assert.ok(dashboardSrc.includes('mdc_kgb_cloud_synced'), 'Dashboard.jsx must listen for mdc_kgb_cloud_synced');
assert.ok(dashboardSrc.includes('mdc_cloud_kgb_masterlist'), 'Dashboard.jsx must prioritize canonical mdc_cloud_kgb_masterlist');
console.log('  ✓ PASS: Dashboard.jsx, FixablyInventoryDashboard.jsx, and useCloudSync.js cross-admin sync verified');

console.log('========================================================================');
console.log('ALL DASHBOARD UNIFIED KGB MASTERLIST TESTS PASSED (100%)');
console.log('========================================================================');
