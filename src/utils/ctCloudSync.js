export const CT_CLOUD_RECORD_ID = 'master_consumables_tools_state_registry';
export const CT_CLOUD_RECORD_TYPE = 'consumables_tools_state';
export const CT_REALTIME_CHANNEL = 'mdc-ct-realtime-sync';
export const CT_LOCAL_BROADCAST_CHANNEL = 'mdc_ct_local_sync';
export const CT_CLOUD_UPDATED_AT_KEY = 'mdc_ct_cloud_updated_at';

/**
 * Generates a unique client/tab identifier for realtime echo suppression.
 * @returns {string}
 */
export function generateCtClientId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `ct-client-${Date.now().toString(36)}-${rand}`;
}

/**
 * Builds the serialized Consumables & Tools state snapshot stored in Supabase `saved_records`.
 * @param {object} state
 * @param {object} meta
 * @returns {object}
 */
export function buildCtSnapshotPayload(state = {}, meta = {}) {
  const updatedAt = meta.updatedAt || new Date().toISOString();
  return {
    version: 1,
    clientId: meta.clientId || null,
    updatedAt,
    updatedBy: meta.actorName || 'System',
    reason: meta.reason || 'state_update',
    catalog: Array.isArray(state.catalog) ? state.catalog : [],
    orders: Array.isArray(state.orders) ? state.orders : [],
    stock: Array.isArray(state.stock) ? state.stock : [],
    toolAssets: Array.isArray(state.toolAssets) ? state.toolAssets : [],
    movements: Array.isArray(state.movements) ? state.movements : [],
    shipments: Array.isArray(state.shipments) ? state.shipments : []
  };
}

/**
 * Normalizes a remote `snapshot_data` payload into Consumables & Tools state collections.
 * Returns null when the payload is missing or not a valid object.
 * @param {unknown} snapshotData
 * @returns {object|null}
 */
export function extractCtStateFromSnapshot(snapshotData) {
  if (!snapshotData || typeof snapshotData !== 'object' || Array.isArray(snapshotData)) {
    return null;
  }
  const hasAnyCollection =
    Array.isArray(snapshotData.catalog) ||
    Array.isArray(snapshotData.orders) ||
    Array.isArray(snapshotData.stock) ||
    Array.isArray(snapshotData.toolAssets) ||
    Array.isArray(snapshotData.movements) ||
    Array.isArray(snapshotData.shipments);

  if (!hasAnyCollection) return null;

  return {
    catalog: Array.isArray(snapshotData.catalog) ? snapshotData.catalog : [],
    orders: Array.isArray(snapshotData.orders) ? snapshotData.orders : [],
    stock: Array.isArray(snapshotData.stock) ? snapshotData.stock : [],
    toolAssets: Array.isArray(snapshotData.toolAssets) ? snapshotData.toolAssets : [],
    movements: Array.isArray(snapshotData.movements) ? snapshotData.movements : [],
    shipments: Array.isArray(snapshotData.shipments) ? snapshotData.shipments : [],
    updatedAt: snapshotData.updatedAt || null,
    clientId: snapshotData.clientId || null,
    updatedBy: snapshotData.updatedBy || null,
    reason: snapshotData.reason || null
  };
}

/**
 * Determines whether an incoming remote snapshot should overwrite the current local state.
 * Suppresses echoes from the same client and ignores older timestamps.
 * @param {object} params
 * @returns {boolean}
 */
export function shouldApplyRemoteCtSnapshot({
  remoteUpdatedAt,
  localUpdatedAt,
  remoteClientId,
  localClientId,
  force = false
} = {}) {
  if (remoteClientId && localClientId && remoteClientId === localClientId) {
    return false;
  }
  if (force || !localUpdatedAt) {
    return true;
  }
  if (!remoteUpdatedAt) {
    return false;
  }
  const remoteMs = Date.parse(remoteUpdatedAt);
  const localMs = Date.parse(localUpdatedAt);
  if (Number.isNaN(remoteMs) || Number.isNaN(localMs)) {
    return remoteUpdatedAt !== localUpdatedAt;
  }
  return remoteMs >= localMs;
}

/**
 * Fetches the shared Consumables & Tools state snapshot from Supabase `saved_records`.
 * Uses a lightweight `updated_at` header check first when `localUpdatedAt` is provided
 * so unchanged payloads incur ~100 bytes instead of downloading full `snapshot_data`.
 * @param {object|null} supabaseClient
 * @param {object} options
 * @returns {Promise<{ ok: boolean, data: object|null, updatedAt: string|null, skippedUnchanged?: boolean, error?: string }>}
 */
export async function fetchCtSnapshotFromSupabase(supabaseClient, { localUpdatedAt = null, force = false } = {}) {
  if (!supabaseClient) {
    return { ok: false, data: null, updatedAt: null, error: 'Supabase client unavailable' };
  }
  try {
    if (localUpdatedAt && !force) {
      const { data: header, error: headerErr } = await supabaseClient
        .from('saved_records')
        .select('id, updated_at')
        .eq('id', CT_CLOUD_RECORD_ID)
        .maybeSingle();

      if (headerErr) {
        return { ok: false, data: null, updatedAt: null, error: headerErr.message || 'Header check failed' };
      }
      if (!header) {
        return { ok: true, data: null, updatedAt: null };
      }
      if (header.updated_at && header.updated_at === localUpdatedAt) {
        return { ok: true, data: null, updatedAt: header.updated_at, skippedUnchanged: true };
      }
    }

    const { data, error } = await supabaseClient
      .from('saved_records')
      .select('id, snapshot_data, updated_at, saved_by_name')
      .eq('id', CT_CLOUD_RECORD_ID)
      .maybeSingle();

    if (error) {
      return { ok: false, data: null, updatedAt: null, error: error.message || 'Fetch failed' };
    }
    if (!data || !data.snapshot_data) {
      return { ok: true, data: null, updatedAt: null };
    }
    const extracted = extractCtStateFromSnapshot(data.snapshot_data);
    return {
      ok: true,
      data: extracted,
      updatedAt: extracted?.updatedAt || data.updated_at || null
    };
  } catch (err) {
    return { ok: false, data: null, updatedAt: null, error: err?.message || 'Unexpected fetch error' };
  }
}

/**
 * Persists the shared Consumables & Tools state snapshot to Supabase `saved_records`.
 * @param {object|null} supabaseClient
 * @param {object} state
 * @param {object} meta
 * @returns {Promise<{ ok: boolean, updatedAt?: string, error?: string }>}
 */
export async function pushCtSnapshotToSupabase(supabaseClient, state, meta = {}) {
  if (!supabaseClient) {
    return { ok: false, error: 'Supabase client unavailable' };
  }
  const updatedAt = meta.updatedAt || new Date().toISOString();
  const nowDate = new Date(updatedAt);
  const snapshotData = buildCtSnapshotPayload(state, { ...meta, updatedAt });

  try {
    const { error } = await supabaseClient
      .from('saved_records')
      .upsert(
        {
          id: CT_CLOUD_RECORD_ID,
          record_type: CT_CLOUD_RECORD_TYPE,
          period_label: 'Consumables & Tools Live State',
          period_year: nowDate.getFullYear(),
          period_month: nowDate.getMonth() + 1,
          period_week: 1,
          notes: 'Synchronized Consumables & Service Tools Center state across all users',
          saved_by_name: meta.actorName || 'System',
          snapshot_data: snapshotData,
          updated_at: updatedAt
        },
        { onConflict: 'id' }
      );

    if (error) {
      return { ok: false, error: error.message || 'Upsert failed' };
    }
    return { ok: true, updatedAt };
  } catch (err) {
    return { ok: false, error: err?.message || 'Unexpected push error' };
  }
}
