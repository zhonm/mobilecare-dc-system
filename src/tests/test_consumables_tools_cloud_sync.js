import assert from 'node:assert/strict';
import {
  CT_CLOUD_RECORD_ID,
  CT_CLOUD_RECORD_TYPE,
  buildCtSnapshotPayload,
  extractCtStateFromSnapshot,
  shouldApplyRemoteCtSnapshot,
  fetchCtSnapshotFromSupabase,
  pushCtSnapshotToSupabase
} from '../utils/ctCloudSync.js';

console.log('====================================================');
console.log('TEST SUITE: Consumables & Tools Cloud Sync');
console.log('====================================================');

// 1. Snapshot build & extraction round-trip
const sampleState = {
  catalog: [{ id: 'cat-1', part_number: '923-04894', description: 'Display Adhesive', item_kind: 'consumable' }],
  orders: [{ id: 'ord-1', po_number: 'SVC20260150-MOA', site_code: 'APP MOA', items: [] }],
  stock: [{ id: 'stk-1', part_number: '923-04894', site_code: 'DC-MDC', qty_on_hand: 12 }],
  toolAssets: [{ id: 'tool-1', asset_tag: 'MDC-TL-0001', serial_number: 'SN123', status: 'available' }],
  movements: [{ id: 'mov-1', action: 'received', part_number: '923-04894', quantity: 12 }],
  shipments: [{ id: 'shp-1', packing_list_number: 'CT-PL-202611-0001', to_site_code: 'APP MOA', items: [] }]
};

const snapshot = buildCtSnapshotPayload(sampleState, {
  clientId: 'ct-client-a',
  actorName: 'Zhon Manaois',
  reason: 'ct_shipment_created',
  updatedAt: '2026-11-14T13:00:00.000Z'
});

assert.equal(snapshot.version, 1);
assert.equal(snapshot.clientId, 'ct-client-a');
assert.equal(snapshot.updatedBy, 'Zhon Manaois');
assert.equal(snapshot.reason, 'ct_shipment_created');

const extracted = extractCtStateFromSnapshot(snapshot);
assert.ok(extracted);
assert.equal(extracted.catalog.length, 1);
assert.equal(extracted.orders.length, 1);
assert.equal(extracted.stock[0].qty_on_hand, 12);
assert.equal(extracted.toolAssets[0].serial_number, 'SN123');
assert.equal(extracted.movements.length, 1);
assert.equal(extracted.shipments[0].packing_list_number, 'CT-PL-202611-0001');
assert.equal(extractCtStateFromSnapshot(null), null);
assert.equal(extractCtStateFromSnapshot({}), null);

// 2. Echo suppression & timestamp ordering
assert.equal(
  shouldApplyRemoteCtSnapshot({
    remoteUpdatedAt: '2026-11-14T13:05:00.000Z',
    localUpdatedAt: '2026-11-14T13:00:00.000Z',
    remoteClientId: 'ct-client-a',
    localClientId: 'ct-client-a'
  }),
  false,
  'Must suppress self-echo even with newer timestamp'
);

assert.equal(
  shouldApplyRemoteCtSnapshot({
    remoteUpdatedAt: '2026-11-14T12:55:00.000Z',
    localUpdatedAt: '2026-11-14T13:00:00.000Z',
    remoteClientId: 'ct-client-b',
    localClientId: 'ct-client-a'
  }),
  false,
  'Must ignore stale remote snapshot'
);

assert.equal(
  shouldApplyRemoteCtSnapshot({
    remoteUpdatedAt: '2026-11-14T13:05:00.000Z',
    localUpdatedAt: '2026-11-14T13:00:00.000Z',
    remoteClientId: 'ct-client-b',
    localClientId: 'ct-client-a'
  }),
  true,
  'Must accept newer snapshot from another client'
);

assert.equal(
  shouldApplyRemoteCtSnapshot({
    remoteUpdatedAt: '2026-11-14T13:00:00.000Z',
    localUpdatedAt: null,
    remoteClientId: 'ct-client-b',
    localClientId: 'ct-client-a'
  }),
  true,
  'Must accept initial remote snapshot when localUpdatedAt is null'
);

// 3. Push & Fetch against mock Supabase saved_records table
const storedRows = new Map();
const mockSupabase = {
  from(table) {
    assert.equal(table, 'saved_records');
    return {
      async upsert(row, opts) {
        assert.equal(opts?.onConflict, 'id');
        assert.equal(row.id, CT_CLOUD_RECORD_ID);
        assert.equal(row.record_type, CT_CLOUD_RECORD_TYPE);
        storedRows.set(row.id, row);
        return { error: null };
      },
      select() {
        return {
          eq(col, val) {
            assert.equal(col, 'id');
            return {
              async maybeSingle() {
                return { data: storedRows.get(val) || null, error: null };
              }
            };
          }
        };
      }
    };
  }
};

const emptyFetch = await fetchCtSnapshotFromSupabase(mockSupabase);
assert.equal(emptyFetch.ok, true);
assert.equal(emptyFetch.data, null);

const pushRes = await pushCtSnapshotToSupabase(mockSupabase, sampleState, {
  clientId: 'ct-client-a',
  actorName: 'Zhon Manaois',
  reason: 'ct_received',
  updatedAt: '2026-11-14T13:10:00.000Z'
});
assert.equal(pushRes.ok, true);
assert.equal(pushRes.updatedAt, '2026-11-14T13:10:00.000Z');

const filledFetch = await fetchCtSnapshotFromSupabase(mockSupabase);
assert.equal(filledFetch.ok, true);
assert.ok(filledFetch.data);
assert.equal(filledFetch.updatedAt, '2026-11-14T13:10:00.000Z');
assert.equal(filledFetch.data.shipments[0].packing_list_number, 'CT-PL-202611-0001');
assert.equal(filledFetch.data.toolAssets[0].asset_tag, 'MDC-TL-0001');

// 4. Null Supabase guard
const noClientFetch = await fetchCtSnapshotFromSupabase(null);
assert.equal(noClientFetch.ok, false);
const noClientPush = await pushCtSnapshotToSupabase(null, sampleState);
assert.equal(noClientPush.ok, false);

console.log('ALL CONSUMABLES & TOOLS CLOUD SYNC TESTS PASSED!');
