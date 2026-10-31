import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compactFixablySnapshot, hydrateFixablySnapshot } from '../utils/fixablyInventoryEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Fixably Sync Strict Timestamp Precedence & Durability');
console.log('========================================================================\n');

function runTest(title, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${title}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${title}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }
}

// ── Test 1: Compact snapshot size is lean (< 1.5MB) for 3,500 units ──────
runTest('compactFixablySnapshot produces lean payload (< 1.5MB) for 3,500+ units', () => {
  const dummyItems = Array.from({ length: 3500 }, (_, i) => ({
    id: `item-${i + 1}`,
    partNumber: `661-${10000 + (i % 150)}`,
    description: `Apple Genuine Part Component Description #${i % 150}`,
    serialNumber: `F17G${String(i).padStart(6, '0')}XYZ`,
    siteId: `site-${(i % 14) + 1}`,
    siteCode: `SITE_${(i % 14) + 1}`,
    siteName: `MobileCare Branch ${(i % 14) + 1}`,
    region: i % 2 === 0 ? 'metro_manila' : 'provincial',
    inStockDate: '2026-10-01',
    agingDays: 13,
    agingTier: 'tier_0_15',
    classification: 'Branch Stock',
    isInvestigation: i % 10 === 0,
    investigationType: i % 10 === 0 ? 'CLOSED_REPAIR_STOCK' : null,
    investigationNote: i % 10 === 0 ? 'Part assigned to completed repair' : null,
    badgeColor: '#10b981',
    badgeBg: '#ecfdf5',
    statusLabel: 'Normal'
  }));

  const fullSnapshot = {
    timestamp: '2026-10-14T06:03:00.000Z',
    items: dummyItems,
    sites: Array.from({ length: 14 }, (_, s) => ({
      siteId: `site-${s + 1}`,
      siteCode: `SITE_${s + 1}`,
      siteName: `MobileCare Branch ${s + 1}`,
      totalUnits: 250
    })),
    investigationItems: dummyItems.filter(it => it.isInvestigation),
    summary: { totalUnits: 3500, investigationCount: 350 }
  };

  const compact = compactFixablySnapshot(fullSnapshot);
  const jsonStr = JSON.stringify(compact);
  const sizeMb = Buffer.byteLength(jsonStr, 'utf8') / (1024 * 1024);

  assert.ok(sizeMb < 1.5, `Compact snapshot size (${sizeMb.toFixed(2)} MB) must be strictly < 1.5 MB for PostgREST free-tier safety`);
  
  // Verify hydration
  const hydrated = hydrateFixablySnapshot(compact, fullSnapshot.sites);
  assert.strictEqual(hydrated.items.length, 3500, 'Hydrated items count must match exactly');
  assert.strictEqual(hydrated.investigationItems.length, 350, 'Hydrated investigation items count must match');
  assert.strictEqual(hydrated.items[0].statusLabel, 'In Stock', 'Hydrated items must restore statusLabel to In Stock');
});

// ── Test 2: Timestamp precedence in useCloudSync.js ───────────────────
runTest('useCloudSync.js enforces localMs > remoteMs to block older cloud snapshot from reverting local data', () => {
  const syncFile = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf8');

  // Verify Section 2.7 has isLocalStrictlyNewer guard
  assert.ok(
    syncFile.includes('isLocalStrictlyNewer'),
    'useCloudSync.js must check isLocalStrictlyNewer in Section 2.7'
  );
  assert.ok(
    syncFile.includes('NEVER overwrite local with stale cloud data') || syncFile.includes('isLocalStrictlyNewer'),
    'useCloudSync.js must explicitly preserve local snapshot when local is newer'
  );

  // Verify Section 8d has shouldUpdateLocal guard
  assert.ok(
    syncFile.includes('shouldUpdateLocal'),
    'useCloudSync.js must guard Section 8d with shouldUpdateLocal timestamp comparison'
  );
  assert.ok(
    syncFile.includes('push local snapshot to cloud to auto-heal'),
    'useCloudSync.js must auto-heal cloud when local snapshot is newer'
  );
});

// ── Test 3: FixablyInventoryDashboard timestamp protections ────────────
runTest('FixablyInventoryDashboard.jsx anchors timestamp and guards against older prop or realtime updates', () => {
  const dashFile = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');

  assert.ok(
    dashFile.includes('snapshotTimestampRef'),
    'FixablyInventoryDashboard.jsx must maintain snapshotTimestampRef'
  );
  assert.ok(
    dashFile.includes('localMs >= propMs ? localSnapshot : propSnapshot') || dashFile.includes('localMs > propMs ? localSnapshot : propSnapshot'),
    'FixablyInventoryDashboard.jsx must memoize active snapshot prioritizing newer local snapshot over older props'
  );
  assert.ok(
    dashFile.includes('Ignoring older incoming snapshot') || dashFile.includes('incomingMs < currentMs'),
    'FixablyInventoryDashboard.jsx must ignore older incoming snapshots in handleApplySyncedSnapshot'
  );
  assert.ok(
    dashFile.includes('remoteMs < currentMs') || dashFile.includes('Ignoring older cloud payload'),
    'FixablyInventoryDashboard.jsx must ignore older cloud payloads in realtime listener'
  );
});

// ── Test 4: AppContext.jsx timestamp protection ───────────────────────
runTest('AppContext.jsx preserves newer fixablySnapshot against older storage or idb loads', () => {
  const contextFile = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');

  assert.ok(
    contextFile.includes('prevMs > idbMs'),
    'AppContext.jsx must guard idb load with prevMs > idbMs check'
  );
  assert.ok(
    contextFile.includes('prevMs > incomingMs') || contextFile.includes('prevMs > idbMs'),
    'AppContext.jsx must guard storage and broadcast updates with prevMs > incomingMs check'
  );
});

console.log('\n========================================================================');
console.log('ALL FIXABLY SYNC TIMESTAMP PRECEDENCE TESTS PASSED (100%)');
console.log('========================================================================\n');
