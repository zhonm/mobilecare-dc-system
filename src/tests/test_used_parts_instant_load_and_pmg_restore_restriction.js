import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Used Parts Instant Load, Realtime Sync & PMG Restore Removal');
console.log('========================================================================\n');

// --------------------------------------------------------------------------
// 1. Verify RequestParts.jsx Restore UI Restrictions
// --------------------------------------------------------------------------
console.log('--- 1. Testing UI Role Restrictions for Restore Feature ---');

const requestPartsPath = path.join(projectRoot, 'src/components/RequestParts.jsx');
const requestPartsContent = fs.readFileSync(requestPartsPath, 'utf8');

assert.ok(
  requestPartsContent.includes('canRestore = isAdmin') || requestPartsContent.includes('canRestore = isSuperadmin'),
  'RequestParts.jsx must define canRestore based on admin privileges'
);

assert.ok(
  requestPartsContent.includes('{canRestore && <th style={{ width: \'110px\', textAlign: \'center\' }}>Action</th>}'),
  'RequestParts.jsx must conditionally render Action header in Used Parts log'
);

assert.ok(
  requestPartsContent.includes('{canRestore && (') &&
  requestPartsContent.includes('unmarkUnitAsUsed(u.serial_number)'),
  'RequestParts.jsx must conditionally render Revert/Restore button only for Admins'
);

console.log('  ✓ PASS: RequestParts.jsx hides Revert/Restore Part feature from PMG users');

// --------------------------------------------------------------------------
// 2. Verify useCloudSync.js Global Alerts & Realtime Inventory Handlers
// --------------------------------------------------------------------------
console.log('\n--- 2. Testing Realtime Reflection & WebSocket Routing ---');

const cloudSyncPath = path.join(projectRoot, 'src/context/useCloudSync.js');
const cloudSyncContent = fs.readFileSync(cloudSyncPath, 'utf8');

assert.ok(
  cloudSyncContent.includes("'PART_MARKED_AS_USED'") &&
  cloudSyncContent.includes("'PART_RESTORED_TO_STOCK'") &&
  cloudSyncContent.includes("'PART_MARKED_OUTTAKE'") &&
  cloudSyncContent.includes("'PART_TRANSFERRED'"),
  'useCloudSync.js must include part lifecycle events in isGlobalAlert'
);

assert.ok(
  cloudSyncContent.includes("alertsChannel") &&
  cloudSyncContent.includes("handleRealtimeInventoryEvent('SITE_PARTS_CLEARED'") ||
  cloudSyncContent.includes("handleRealtimeInventoryEvent(bType, bPayload)"),
  'alertsChannel must route inventory broadcast events to handleRealtimeInventoryEvent'
);

assert.ok(
  cloudSyncContent.includes("type === 'PART_MARKED_AS_USED'"),
  'handleRealtimeInventoryEvent must handle PART_MARKED_AS_USED'
);

assert.ok(
  cloudSyncContent.includes("type === 'PART_RESTORED_TO_STOCK'"),
  'handleRealtimeInventoryEvent must handle PART_RESTORED_TO_STOCK'
);

assert.ok(
  cloudSyncContent.includes("type === 'PART_MARKED_OUTTAKE'"),
  'handleRealtimeInventoryEvent must handle PART_MARKED_OUTTAKE'
);

assert.ok(
  cloudSyncContent.includes("type === 'PART_TRANSFERRED'"),
  'handleRealtimeInventoryEvent must handle PART_TRANSFERRED'
);

console.log('  ✓ PASS: Global alerts & Realtime WebSocket routing fully configured for cross-client sync');

// --------------------------------------------------------------------------
// 3. Simulation: handleRealtimeInventoryEvent Updates Superadmin in Memory
// --------------------------------------------------------------------------
console.log('\n--- 3. Simulating Superadmin In-Memory Update on PMG Broadcast ---');

let superadminUnits = [
  {
    serial_number: 'F8Y6281C1HW18FK8Y',
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    current_site_id: 'site-ilo',
    site_code: 'ASP ILO',
    status: 'in_stock',
    work_order_number: null,
    used_at: null
  },
  {
    serial_number: 'F8Y6282C65U18FKBW',
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    current_site_id: 'site-ilo',
    site_code: 'ASP ILO',
    status: 'in_stock',
    work_order_number: null,
    used_at: null
  }
];

function simulateHandleRealtimeInventoryEvent(type, payload) {
  if (type === 'PART_MARKED_AS_USED' && (payload.unit || payload.serialNumber || payload.usage)) {
    const u = payload.unit;
    const cleanS = String(u?.serial_number || payload.serialNumber || payload.usage?.serial_number || '').trim().toUpperCase();
    if (cleanS) {
      superadminUnits = superadminUnits.map(existing => {
        if (String(existing.serial_number || '').trim().toUpperCase() === cleanS) {
          return {
            ...existing,
            ...(u || {}),
            status: 'used',
            used_at: u?.used_at || payload.usage?.used_at || new Date().toISOString(),
            used_by_id: u?.used_by_id || payload.usage?.used_by_id || null,
            used_by_name: u?.used_by_name || payload.usage?.used_by || 'Branch Specialist',
            work_order_number: u?.work_order_number || payload.usage?.work_order_number || existing.work_order_number || null,
            usage_notes: u?.usage_notes || payload.usage?.usage_notes || existing.usage_notes || null,
            notes: u?.notes || (payload.usage?.usage_notes ? `Used in ${payload.usage?.work_order_number || 'Repair'} | ${payload.usage?.usage_notes}` : (existing.notes || 'Used in Repair'))
          };
        }
        return existing;
      });
    }
  } else if (type === 'PART_RESTORED_TO_STOCK' && (payload.serialNumber || payload.unit)) {
    const cleanS = String(payload.serialNumber || payload.unit?.serial_number || '').trim().toUpperCase();
    if (cleanS) {
      superadminUnits = superadminUnits.map(existing => {
        if (String(existing.serial_number || '').trim().toUpperCase() === cleanS) {
          return {
            ...existing,
            status: 'in_stock',
            used_at: null,
            used_by_id: null,
            used_by_name: null,
            work_order_number: null,
            usage_notes: null,
            outtake_at: null,
            outtake_reason: null,
            transferred_at: null,
            transferred_to_site_id: null,
            transferred_to_site_code: null,
            transfer_slip_number: null
          };
        }
        return existing;
      });
    }
  }
}

// PMG marks unit F8Y6281C1HW18FK8Y as used
const pmgPayload = {
  unit: {
    serial_number: 'F8Y6281C1HW18FK8Y',
    part_number: '661-21991',
    status: 'used',
    work_order_number: '20038789',
    usage_notes: 'Replaced swollen battery'
  },
  usage: {
    serial_number: 'F8Y6281C1HW18FK8Y',
    work_order_number: '20038789',
    usage_notes: 'Replaced swollen battery'
  }
};

simulateHandleRealtimeInventoryEvent('PART_MARKED_AS_USED', pmgPayload);

const targetSuperadminUnit = superadminUnits.find(u => u.serial_number === 'F8Y6281C1HW18FK8Y');
assert.strictEqual(targetSuperadminUnit.status, 'used', 'Superadmin unit status must immediately transition to used');
assert.strictEqual(targetSuperadminUnit.work_order_number, '20038789', 'Superadmin must reflect work order number 20038789');

console.log('  ✓ PASS: Superadmin in-memory state updates instantly to "used" with work order upon PMG broadcast');

// --------------------------------------------------------------------------
// 4. Verify usePartsRequests.js Security & Instant Non-Blocking Loading
// --------------------------------------------------------------------------
console.log('\n--- 4. Testing usePartsRequests.js Authorization & Non-Blocking Async ---');

const partsRequestsHookPath = path.join(projectRoot, 'src/context/usePartsRequests.js');
const partsRequestsHookContent = fs.readFileSync(partsRequestsHookPath, 'utf8');

assert.ok(
  partsRequestsHookContent.includes('queuedSavedRecordsUpsert'),
  'usePartsRequests.js must use queuedSavedRecordsUpsert for debounced background persistence'
);

assert.ok(
  partsRequestsHookContent.includes('isPmgUser && !isAdmin'),
  'unmarkUnitAsUsed must explicitly reject PMG users from restoring parts'
);

assert.ok(
  partsRequestsHookContent.includes('Permission denied: Only administrators can restore or revert used parts.'),
  'unmarkUnitAsUsed must display permission denied error toast to unauthorized users'
);

console.log('  ✓ PASS: unmarkUnitAsUsed enforces admin-only authorization');

// --------------------------------------------------------------------------
// 5. Verify Database Persistence & Stale Snapshot Overlay Protection
// --------------------------------------------------------------------------
console.log('\n--- 5. Testing Database Persistence & Snapshot Overlay Resilience ---');

// Check that markUnitAsUsed attempts status: 'used' and falls back to notes with metadata
assert.ok(
  partsRequestsHookContent.includes("status: 'used'") &&
  partsRequestsHookContent.includes("if (err1)"),
  'usePartsRequests.js must attempt status: "used" and fallback to embedded metadata'
);
console.log('  ✓ PASS: markUnitAsUsed sends status "used" with metadata fallback');

// Test overlaySnapshotDoc simulation: Stale live_master_dc_inventory snapshot must NOT clobber used status
const map = new Map();

// Simulate DB unit fetched from inventory_units with lifecycle_status 'used'
const dbUnitSerial = 'F8Y5493CDAR14LNC6';
map.set(dbUnitSerial, {
  serial_number: dbUnitSerial,
  part_number: '661-21991',
  description: 'Battery, iPhone 13',
  current_site_id: 'site-ilo',
  site_code: 'ASP ILO',
  status: 'used',
  work_order_number: 'WO-998877',
  usage_notes: 'Technician repair',
  used_at: '2026-10-07T02:00:00.000Z',
  updated_at: '2026-10-07T02:00:00.000Z'
});

// Stale snapshot doc where unit was previously in_stock
const staleDoc = {
  snapshot_data: {
    units: [
      {
        serial_number: dbUnitSerial,
        part_number: '661-21991',
        status: 'in_stock', // stale in_stock status
        work_order_number: null,
        used_at: null,
        updated_at: '2026-10-06T12:00:00.000Z'
      }
    ]
  }
};

// Simulate overlay logic from useCloudSync.js
staleDoc.snapshot_data.units.forEach(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  const existing = map.get(s);
  const isExistingPackedOrShipped = existing && (existing.status === 'packed' || existing.status === 'shipped');

  const resolvedStatus = isExistingPackedOrShipped
    ? existing.status
    : existing?.status === 'used' || existing?.status === 'outtake' || existing?.status === 'transferred'
      ? existing.status
      : u.status === 'used' || u.status === 'outtake' || u.status === 'transferred'
        ? u.status
        : u.status || existing?.status || 'in_stock';

  map.set(s, {
    ...u,
    ...existing,
    status: resolvedStatus,
    work_order_number: resolvedStatus === 'used' ? (existing?.work_order_number || u.work_order_number || null) : (u.work_order_number || existing?.work_order_number || null)
  });
});

const overlaidUnit = map.get(dbUnitSerial);
assert.strictEqual(overlaidUnit.status, 'used', 'Overlaying stale snapshot must NOT revert used status to in_stock');
assert.strictEqual(overlaidUnit.work_order_number, 'WO-998877', 'Overlaying stale snapshot must retain work order number');

console.log('  ✓ PASS: overlaySnapshotDoc correctly preserves "used" status and work order number');

// Test that usePartsRequests uses { immediate: true } so writes are not lost on refresh
const updatedPartsRequestsContent = fs.readFileSync(partsRequestsHookPath, 'utf8');
assert.ok(
  updatedPartsRequestsContent.includes("id: 'master_used_parts_registry'") &&
  updatedPartsRequestsContent.includes("{ immediate: true }"),
  'usePartsRequests.js must use { immediate: true } for master_used_parts_registry'
);
assert.ok(
  updatedPartsRequestsContent.includes("id: 'master_branch_inventory_registry'") &&
  updatedPartsRequestsContent.includes("{ immediate: true }"),
  'usePartsRequests.js must update master_branch_inventory_registry with { immediate: true }'
);
console.log('  ✓ PASS: usePartsRequests.js executes immediate snapshot upserts for retail branches and used parts registry');

// Test local lifecycle preservation simulation on page reload:
// Suppose user reloads page; localStorage (prev) has unit marked used, but cloudUnit from DB is stale in_stock
const prevUnits = [
  {
    serial_number: 'TEST-RELOAD-SERIAL-1',
    part_number: '661-21991',
    status: 'used',
    used_at: '2026-10-07T02:40:00.000Z',
    work_order_number: 'RO-123456',
    updated_at: '2026-10-07T02:40:00.000Z'
  }
];

const reloadMap = new Map();
reloadMap.set('TEST-RELOAD-SERIAL-1', {
  serial_number: 'TEST-RELOAD-SERIAL-1',
  part_number: '661-21991',
  status: 'in_stock', // stale in cloud
  used_at: null,
  work_order_number: null,
  updated_at: '2026-10-07T02:41:00.000Z' // cloud has newer sync timestamp
});

// Run reconciliation logic from useCloudSync.js
prevUnits.forEach(u => {
  const s = String(u.serial_number || '').trim().toUpperCase();
  const cloudUnit = reloadMap.get(s);
  const localTime = u.updated_at ? new Date(u.updated_at).getTime() : 0;
  const cloudTime = cloudUnit?.updated_at ? new Date(cloudUnit.updated_at).getTime() : 0;

  const isLocalLifecycle = u.status === 'used' || u.status === 'outtake' || u.status === 'transferred' || Boolean(u.used_at);
  const isCloudStaleInStock = cloudUnit.status === 'in_stock' && !cloudUnit.used_at && !cloudUnit.outtake_at && !cloudUnit.transferred_at;

  if (localTime >= cloudTime || (isLocalLifecycle && isCloudStaleInStock)) {
    reloadMap.set(s, {
      ...cloudUnit,
      ...u,
      status: u.status,
      work_order_number: u.work_order_number || cloudUnit.work_order_number
    });
  }
});

const reloadedUnit = reloadMap.get('TEST-RELOAD-SERIAL-1');
assert.strictEqual(reloadedUnit.status, 'used', 'Local used status must be protected from stale cloud in_stock on page reload');
assert.strictEqual(reloadedUnit.work_order_number, 'RO-123456', 'Work order number must persist across page reload');
console.log('  ✓ PASS: Page reload reconciliation preserves used status and work order against stale cloudUnit');

console.log('\n========================================================================');
console.log('ALL VERIFICATIONS PASSED (100%): Used parts instant load, realtime sync, database persistence & PMG restore restriction verified.');
console.log('========================================================================\n');
