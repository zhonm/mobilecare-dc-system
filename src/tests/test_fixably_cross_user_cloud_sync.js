import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Fixably Inventory Cross-User Cloud Sync & Realtime Broadcast');
console.log('========================================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

// ── Test 1: useCloudSync registers master_fixably_inventory_snapshot in registries ─
runTest('useCloudSync.js includes master_fixably_inventory_snapshot in PMG, SYSTEM, and HEAVY doc IDs', () => {
  const syncFile = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf8');

  // Verify PMG_DOC_IDS includes master_fixably_inventory_snapshot
  const pmgMatch = syncFile.match(/const PMG_DOC_IDS = \[([\s\S]*?)\];/);
  assert.ok(pmgMatch, 'PMG_DOC_IDS array must exist');
  assert.ok(
    pmgMatch[1].includes("'master_fixably_inventory_snapshot'"),
    'PMG_DOC_IDS must include master_fixably_inventory_snapshot for branch user sync'
  );

  // Verify SYSTEM_DOC_IDS includes master_fixably_inventory_snapshot
  const sysMatch = syncFile.match(/const SYSTEM_DOC_IDS = \[([\s\S]*?)\];/);
  assert.ok(sysMatch, 'SYSTEM_DOC_IDS array must exist');
  assert.ok(
    sysMatch[1].includes("'master_fixably_inventory_snapshot'"),
    'SYSTEM_DOC_IDS must include master_fixably_inventory_snapshot'
  );

  // Verify HEAVY_DOC_IDS includes master_fixably_inventory_snapshot for egress defense
  const heavyMatch = syncFile.match(/const HEAVY_DOC_IDS = \[([\s\S]*?)\];/);
  assert.ok(heavyMatch, 'HEAVY_DOC_IDS array must exist');
  assert.ok(
    heavyMatch[1].includes("'master_fixably_inventory_snapshot'"),
    'HEAVY_DOC_IDS must include master_fixably_inventory_snapshot'
  );
});

// ── Test 2: useCloudSync implements egress defense and hydration for Fixably snapshot
runTest('useCloudSync.js implements conditional egress check and hydrates fixably snapshot from dbSavedRecords', () => {
  const syncFile = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf8');

  // Verify conditional egress check
  assert.ok(
    syncFile.includes("heavyHeaders.find(h => h.id === 'master_fixably_inventory_snapshot')"),
    'Must check remote header for master_fixably_inventory_snapshot egress optimization'
  );

  // Verify hydration section 8d
  assert.ok(
    syncFile.includes("dbSavedRecords.find(r => r.id === 'master_fixably_inventory_snapshot')"),
    'Must find and hydrate master_fixably_inventory_snapshot from saved_records'
  );
  assert.ok(
    syncFile.includes("dbStorage.setItem('mdc_fixably_snapshot', cloudSnap)"),
    'Must hydrate cloud snapshot into dbStorage'
  );
});

// ── Test 3: useCloudSync broadcasts and listens for FIXABLY_SNAPSHOT_UPDATED ────────
runTest('useCloudSync.js routes FIXABLY_SNAPSHOT_UPDATED as global alert and handles realtime broadcast', () => {
  const syncFile = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf8');

  // Verify broadcastCloudEvent global alert routing
  assert.ok(
    syncFile.includes("'FIXABLY_SNAPSHOT_UPDATED'"),
    'Must include FIXABLY_SNAPSHOT_UPDATED in isGlobalAlert'
  );

  // Verify realtime handler triggers autoRefreshData
  assert.ok(
    syncFile.includes("bType === 'FIXABLY_SNAPSHOT_UPDATED'"),
    'Must handle FIXABLY_SNAPSHOT_UPDATED event in realtime subscription'
  );
});

// ── Test 4: FixablyInventoryDashboard persists to Supabase Cloud & broadcasts ────────
runTest('FixablyInventoryDashboard.jsx pushes snapshot to Supabase saved_records and broadcasts update', () => {
  const dashFile = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');

  assert.ok(
    /supabase\s*\.from\(['"]saved_records['"]\)\s*\.upsert/.test(dashFile),
    'Must upsert snapshot to Supabase saved_records'
  );
  assert.ok(
    dashFile.includes("id: 'master_fixably_inventory_snapshot'"),
    'Must use id master_fixably_inventory_snapshot for cloud record'
  );
  assert.ok(
    dashFile.includes("broadcastCloudEvent('FIXABLY_SNAPSHOT_UPDATED'"),
    'Must call broadcastCloudEvent with FIXABLY_SNAPSHOT_UPDATED'
  );
});

// ── Test 5: FixablyInventoryDashboard falls back to Supabase Cloud on load ───────────
runTest('FixablyInventoryDashboard.jsx falls back to Supabase saved_records on initial load', () => {
  const dashFile = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');

  assert.ok(
    dashFile.includes("supabase\n              .from('saved_records')\n              .select('*')\n              .eq('id', 'master_fixably_inventory_snapshot')") ||
    dashFile.includes(".from('saved_records')") && dashFile.includes(".eq('id', 'master_fixably_inventory_snapshot')"),
    'loadInitialData must query Supabase saved_records if local storage has no snapshot'
  );
});

// ── Test 6: FixablyInventoryDashboard subscribes to Realtime updates ─────────────────
runTest('FixablyInventoryDashboard.jsx listens to Realtime postgres_changes and BroadcastChannel', () => {
  const dashFile = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');

  assert.ok(
    dashFile.includes("BroadcastChannel('mdc_sync_bus')"),
    'Must listen on mdc_sync_bus for cross-tab updates'
  );
  assert.ok(
    dashFile.includes("filter: 'id=eq.master_fixably_inventory_snapshot'"),
    'Must subscribe to postgres_changes for master_fixably_inventory_snapshot'
  );
});

// ── Test 7: RequestParts passes broadcastCloudEvent to FixablyInventoryDashboard ─────
runTest('RequestParts.jsx passes broadcastCloudEvent prop to FixablyInventoryDashboard', () => {
  const reqPartsFile = fs.readFileSync(path.join(projectRoot, 'src/components/RequestParts.jsx'), 'utf8');

  const matches = [...reqPartsFile.matchAll(/<FixablyInventoryDashboard[\s\S]*?\/>/g)];
  assert.ok(matches.length >= 2, 'Must have at least 2 instances of FixablyInventoryDashboard in RequestParts');
  matches.forEach((m, idx) => {
    assert.ok(
      m[0].includes('broadcastCloudEvent={broadcastCloudEvent}'),
      `Instance ${idx + 1} of FixablyInventoryDashboard must receive broadcastCloudEvent prop`
    );
  });
});

console.log('========================================================================');
console.log(`CROSS-USER CLOUD SYNC RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('========================================================================');

if (failedTests > 0) {
  process.exit(1);
}
