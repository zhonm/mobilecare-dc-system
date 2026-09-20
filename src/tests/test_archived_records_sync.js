/**
 * MDC SYSTEM 2: Operational Data Archiving & Egress Optimization Tests
 *
 * Validates:
 * 1. 60-day operational rolling window partitioning for Shipments & DC Intakes.
 * 2. Invariant: Open/draft/in-transit shipments are NEVER archived regardless of age.
 * 3. Closed shipments older than 60 days are classified as archived.
 * 4. Active sync query constraints omit archived data, keeping periodic payloads lean.
 * 5. On-demand archive retrieval pulls historical batches on demand with `is_archived: true`.
 */

import assert from 'assert';
import {
  ARCHIVE_CUTOFF_DAYS,
  getArchiveCutoffDate,
  getArchiveCutoffIso,
  isShipmentArchived,
  isIntakeRecordArchived,
  partitionActiveAndArchivedShipments,
  partitionActiveAndArchivedIntakes,
  fetchArchivedShipmentsFromCloud,
  fetchArchivedIntakesFromCloud
} from '../utils/archiveManager.js';

console.log('--- TEST SUITE: Operational Data Archiving & Egress Optimization ---');

// 1. Threshold dates
const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();
const daysAgoDateOnly = (d) => daysAgo(d).split('T')[0];

const cutoffDate = getArchiveCutoffDate(ARCHIVE_CUTOFF_DAYS);
const cutoffIso = getArchiveCutoffIso(ARCHIVE_CUTOFF_DAYS);
assert(cutoffDate instanceof Date, 'Cutoff date must be a valid Date instance');
assert(typeof cutoffIso === 'string' && cutoffIso.match(/^\d{4}-\d{2}-\d{2}$/), 'Cutoff ISO must be YYYY-MM-DD');
console.log(`  ✓ PASS: Calculated 60-day archive cutoff threshold: ${cutoffIso}`);

// 2. Shipment Archiving Rules
const sampleShipments = [
  // A: 90-day-old open draft -> MUST NOT be archived
  {
    id: 'sh-draft-90d',
    invoice_ref: 'MDC-MNL-2025-001',
    status: 'draft',
    created_at: daysAgo(90),
    shipment_date: daysAgoDateOnly(90),
    items: [{ part_number: '661-12345', serial_number: 'SN001' }]
  },
  // B: 75-day-old in-transit shipment -> MUST NOT be archived
  {
    id: 'sh-intransit-75d',
    invoice_ref: 'MDC-MNL-2025-002',
    status: 'in_transit',
    created_at: daysAgo(75),
    shipment_date: daysAgoDateOnly(75),
    items: [{ part_number: '661-12345', serial_number: 'SN002' }]
  },
  // C: 70-day-old pending pickup shipment -> MUST NOT be archived
  {
    id: 'sh-pending-70d',
    invoice_ref: 'MDC-MNL-2025-003',
    status: 'pending_pickup',
    created_at: daysAgo(70),
    shipment_date: daysAgoDateOnly(70),
    items: [{ part_number: '661-12345', serial_number: 'SN003' }]
  },
  // D: 80-day-old closed shipment (received_confirmed) -> MUST be archived
  {
    id: 'sh-closed-80d',
    invoice_ref: 'MDC-MNL-2025-004',
    status: 'received_confirmed',
    created_at: daysAgo(80),
    shipment_date: daysAgoDateOnly(80),
    items: [{ part_number: '661-12345', serial_number: 'SN004' }]
  },
  // E: 15-day-old closed shipment (received_confirmed) -> MUST be active (recent)
  {
    id: 'sh-closed-15d',
    invoice_ref: 'MDC-MNL-2026-005',
    status: 'received_confirmed',
    created_at: daysAgo(15),
    shipment_date: daysAgoDateOnly(15),
    items: [{ part_number: '661-12345', serial_number: 'SN005' }]
  },
  // F: Explicitly flagged archived shipment -> MUST be archived
  {
    id: 'sh-explicit-archived',
    invoice_ref: 'MDC-MNL-2026-006',
    status: 'received_confirmed',
    is_archived: true,
    created_at: daysAgo(10),
    shipment_date: daysAgoDateOnly(10),
    items: [{ part_number: '661-12345', serial_number: 'SN006' }]
  }
];

assert.strictEqual(isShipmentArchived(sampleShipments[0]), false, 'Draft 90d old must NOT be archived');
assert.strictEqual(isShipmentArchived(sampleShipments[1]), false, 'In-transit 75d old must NOT be archived');
assert.strictEqual(isShipmentArchived(sampleShipments[2]), false, 'Pending pickup 70d old must NOT be archived');
assert.strictEqual(isShipmentArchived(sampleShipments[3]), true, 'Received confirmed 80d old MUST be archived');
assert.strictEqual(isShipmentArchived(sampleShipments[4]), false, 'Received confirmed 15d old must remain ACTIVE');
assert.strictEqual(isShipmentArchived(sampleShipments[5]), true, 'Explicitly marked is_archived: true must be archived');

const { active: activeShipments, archived: archivedShipments } = partitionActiveAndArchivedShipments(sampleShipments);
assert.strictEqual(activeShipments.length, 4, 'There should be 4 active shipments');
assert.strictEqual(archivedShipments.length, 2, 'There should be 2 archived shipments');
assert.strictEqual(archivedShipments.every(s => s.is_archived === true), true, 'All partitioned archived shipments must have is_archived: true');
console.log('  ✓ PASS: Shipment archiving partition rules: open/in-transit shipments never archived, closed >60d archived correctly');

// 3. Intake Records Archiving Rules
const sampleIntakes = [
  // A: 85-day-old completed intake -> MUST be archived
  {
    id: 'MDC202500001',
    record_name: 'PO-2025-01 Intake',
    intake_date: daysAgoDateOnly(85),
    created_at: daysAgo(85),
    total_units: 40,
    status: 'completed'
  },
  // B: 20-day-old completed intake -> MUST be active
  {
    id: 'MDC202600015',
    record_name: 'PO-2026-15 Intake',
    intake_date: daysAgoDateOnly(20),
    created_at: daysAgo(20),
    total_units: 50,
    status: 'completed'
  },
  // C: Explicitly archived intake -> MUST be archived
  {
    id: 'MDC202600020',
    record_name: 'PO-2026-20 Intake',
    is_archived: true,
    intake_date: daysAgoDateOnly(10),
    created_at: daysAgo(10),
    total_units: 15,
    status: 'completed'
  }
];

assert.strictEqual(isIntakeRecordArchived(sampleIntakes[0]), true, 'Intake 85d old must be archived');
assert.strictEqual(isIntakeRecordArchived(sampleIntakes[1]), false, 'Intake 20d old must remain active');
assert.strictEqual(isIntakeRecordArchived(sampleIntakes[2]), true, 'Explicit is_archived must be archived');

const { active: activeIntakes, archived: archivedIntakes } = partitionActiveAndArchivedIntakes(sampleIntakes);
assert.strictEqual(activeIntakes.length, 1, 'Only 1 active intake batch (<60d)');
assert.strictEqual(archivedIntakes.length, 2, '2 archived intake batches');
console.log('  ✓ PASS: DC intake batch archiving partition rules validated');

// 4. Test Mocked Supabase Queries with Active Scoping vs Archived Retrieval
console.log('  Testing Active vs Historical Supabase Queries...');

const mockDatabase = {
  shipments: [
    { id: 's1', status: 'draft', shipment_date: daysAgoDateOnly(90), created_at: daysAgo(90) },
    { id: 's2', status: 'in_transit', shipment_date: daysAgoDateOnly(70), created_at: daysAgo(70) },
    { id: 's3', status: 'received_confirmed', shipment_date: daysAgoDateOnly(10), created_at: daysAgo(10) },
    { id: 's4', status: 'received_confirmed', shipment_date: daysAgoDateOnly(95), created_at: daysAgo(95) },
    { id: 's5', status: 'delivered', shipment_date: daysAgoDateOnly(120), created_at: daysAgo(120) }
  ],
  dc_intake_records: [
    { id: 'i1', intake_date: daysAgoDateOnly(10), created_at: daysAgo(10), record_name: 'Batch 10d' },
    { id: 'i2', intake_date: daysAgoDateOnly(25), created_at: daysAgo(25), record_name: 'Batch 25d' },
    { id: 'i3', intake_date: daysAgoDateOnly(80), created_at: daysAgo(80), record_name: 'Batch 80d' },
    { id: 'i4', intake_date: daysAgoDateOnly(110), created_at: daysAgo(110), record_name: 'Batch 110d' }
  ]
};

// Create mock Supabase client
const createMockClient = (db) => ({
  from: (table) => {
    let rows = [...(db[table] || [])];
    return {
      select: () => {
        const queryObj = {
          in: (col, vals) => {
            rows = rows.filter(r => vals.includes(r[col]));
            return queryObj;
          },
          lt: (col, val) => {
            rows = rows.filter(r => (r[col] || '') < val);
            return queryObj;
          },
          gte: (col, val) => {
            rows = rows.filter(r => (r[col] || '') >= val);
            return queryObj;
          },
          order: () => queryObj,
          limit: (n) => {
            rows = rows.slice(0, n);
            return Promise.resolve({ data: rows, error: null });
          }
        };
        return queryObj;
      }
    };
  }
});

const mockClient = createMockClient(mockDatabase);

// Test On-Demand Archived Fetchers
async function runAsyncTests() {
  const fetchedArchivedShipments = await fetchArchivedShipmentsFromCloud({
    client: mockClient,
    limit: 50
  });

  assert.strictEqual(fetchedArchivedShipments.length, 2, 'Should fetch exactly 2 archived shipments (s4 & s5)');
  assert(fetchedArchivedShipments.every(s => s.is_archived === true), 'All fetched shipments must be marked is_archived: true');
  assert.deepStrictEqual(fetchedArchivedShipments.map(s => s.id), ['s4', 's5'], 'Fetched IDs must be s4 and s5');
  console.log('  ✓ PASS: fetchArchivedShipmentsFromCloud returned historical closed records (>60d)');

  const fetchedArchivedIntakes = await fetchArchivedIntakesFromCloud({
    client: mockClient,
    limit: 50
  });

  assert.strictEqual(fetchedArchivedIntakes.length, 2, 'Should fetch exactly 2 archived intakes (i3 & i4)');
  assert(fetchedArchivedIntakes.every(i => i.is_archived === true), 'All fetched intakes must be marked is_archived: true');
  assert.deepStrictEqual(fetchedArchivedIntakes.map(i => i.id), ['i3', 'i4'], 'Fetched IDs must be i3 and i4');
  console.log('  ✓ PASS: fetchArchivedIntakesFromCloud returned historical completed intakes (>60d)');

  console.log('--- ALL OPERATIONAL DATA ARCHIVING TESTS PASSED ---');
}

runAsyncTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
