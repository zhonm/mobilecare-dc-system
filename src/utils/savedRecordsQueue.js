import { supabase } from '../supabase/client.js';

/**
 * High-Performance Debounced & Serialized Queue for Singleton `saved_records` Rows
 * 
 * Problem Solved:
 * When barcode scanners or multiple concurrent users scan, edit, or delete units,
 * rapid successive calls issue `INSERT ... ON CONFLICT (id) DO UPDATE` on the EXACT
 * SAME row in `saved_records` (e.g. 'live_master_dc_inventory', 'master_dc_intakes_registry',
 * 'deleted_unit_serials_registry').
 * 
 * In PostgreSQL, concurrent ON CONFLICT DO UPDATE calls on the same target row force subsequent
 * transactions to wait for the first transaction's lock:
 * `process <PID> still waiting for ShareLock on transaction <XID> after 1000ms`.
 * Once statement_timeout expires (default 15s in PostgREST), all queued statements are canceled
 * with error 57014.
 * 
 * Solution:
 * 1. Debouncing: Collapses bursts of rapid writes (e.g., 20 scans in 3 seconds) into ONE trailing upsert.
 * 2. Mutex / Serialization: Guarantees that only ONE write per target row is in-flight at any time.
 * 3. Zero-loss: If an update arrives while a write is currently in-flight, it is scheduled to run
 *    immediately after the current write completes with the latest snapshot data.
 */

// Track debounce timers per record ID
const debounceTimers = new Map();

// Track in-flight promises per record ID to guarantee sequential execution (mutex)
const inFlightPromises = new Map();

// Track the latest pending payload per record ID
const pendingPayloads = new Map();

// Track pending resolve callbacks per record ID
const pendingResolvers = new Map();

// Track custom Supabase clients per record ID (if passed)
const pendingClients = new Map();

// Default debounce cooldown in milliseconds
const DEFAULT_DEBOUNCE_MS = 1200;

/**
 * Core internal worker that executes the Supabase upsert sequentially
 */
async function executeSequentialUpsert(recordId) {
  const payload = pendingPayloads.get(recordId);
  if (!payload) return { success: true, skipped: true };

  pendingPayloads.delete(recordId);
  const client = pendingClients.get(recordId) || supabase;
  pendingClients.delete(recordId);

  if (!client) {
    return { success: false, error: 'Supabase client not configured' };
  }

  try {
    const { error } = await client.from('saved_records').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn(`[SavedRecordsQueue] Upsert notice for ${recordId}:`, error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    console.warn(`[SavedRecordsQueue] Network/catch notice for ${recordId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Queues an upsert for a `saved_records` document with trailing debounce and sequential locking.
 * Supports both signatures:
 * - queuedSavedRecordsUpsert(payload, options)
 * - queuedSavedRecordsUpsert(supabaseClient, payload, options)
 * 
 * @param {Object} arg1 The row payload OR supabase client
 * @param {Object} [arg2] The row payload (if arg1 is client) OR options
 * @param {Object} [arg3] The options (if arg1 is client)
 * @returns {Promise<{ success: boolean }>}
 */
export function queuedSavedRecordsUpsert(arg1, arg2 = {}, arg3 = {}) {
  let client = supabase;
  let payload = arg1;
  let options = arg2;

  if (arg1 && (typeof arg1.from === 'function' || arg1.supabaseUrl)) {
    client = arg1;
    payload = arg2;
    options = arg3;
  }

  if (!payload || !payload.id) {
    return Promise.resolve({ success: false, error: 'Invalid payload: missing id' });
  }

  const { debounceMs = DEFAULT_DEBOUNCE_MS, immediate = false } = options || {};
  const recordId = String(payload.id).trim();

  if (client) {
    pendingClients.set(recordId, client);
  }

  // Always retain the latest payload for this record ID
  pendingPayloads.set(recordId, {
    ...payload,
    id: recordId,
    updated_at: payload.updated_at || new Date().toISOString()
  });

  // Clear any existing pending debounce timer for this record ID
  if (debounceTimers.has(recordId)) {
    clearTimeout(debounceTimers.get(recordId));
    debounceTimers.delete(recordId);
  }

  return new Promise((resolve) => {
    if (!pendingResolvers.has(recordId)) {
      pendingResolvers.set(recordId, []);
    }
    pendingResolvers.get(recordId).push(resolve);

    const triggerExecution = () => {
      // Grab all waiting resolvers up to this trigger
      const currentResolvers = pendingResolvers.get(recordId) || [];
      pendingResolvers.delete(recordId);

      const notifyAll = (res) => {
        currentResolvers.forEach((r) => {
          try { r(res); } catch (e) {}
        });
      };

      // Chain onto existing in-flight promise for this record ID to guarantee mutual exclusion (mutex)
      const currentInFlight = inFlightPromises.get(recordId) || Promise.resolve();

      const nextPromise = currentInFlight
        .then(async () => {
          // If there is still a pending payload, execute it now
          if (pendingPayloads.has(recordId)) {
            const res = await executeSequentialUpsert(recordId);
            notifyAll(res);
          } else {
            notifyAll({ success: true, skipped: true });
          }
        })
        .catch(async (err) => {
          console.warn(`[SavedRecordsQueue] Previous run error for ${recordId}:`, err);
          if (pendingPayloads.has(recordId)) {
            const res = await executeSequentialUpsert(recordId);
            notifyAll(res);
          } else {
            notifyAll({ success: false, error: err.message });
          }
        })
        .finally(() => {
          if (inFlightPromises.get(recordId) === nextPromise) {
            inFlightPromises.delete(recordId);
          }
        });

      inFlightPromises.set(recordId, nextPromise);
    };

    if (immediate) {
      triggerExecution();
    } else {
      const timer = setTimeout(() => {
        debounceTimers.delete(recordId);
        triggerExecution();
      }, debounceMs);
      debounceTimers.set(recordId, timer);
    }
  });
}

/**
 * Immediately flushes any pending debounced writes for all or a specific record ID
 */
export async function flushSavedRecordsQueue(recordId = null) {
  if (recordId) {
    if (debounceTimers.has(recordId)) {
      clearTimeout(debounceTimers.get(recordId));
      debounceTimers.delete(recordId);
    }
    const payload = pendingPayloads.get(recordId);
    if (!payload) return [{ success: true, skipped: true }];
    const res = await queuedSavedRecordsUpsert(payload, { immediate: true });
    return [res];
  }

  const promises = [];
  for (const [recId, timer] of debounceTimers.entries()) {
    clearTimeout(timer);
    debounceTimers.delete(recId);
    const payload = pendingPayloads.get(recId);
    if (payload) {
      promises.push(queuedSavedRecordsUpsert(payload, { immediate: true }));
    }
  }
  return Promise.all(promises);
}

/**
 * Returns diagnostic stats about current queue state
 */
export function getSavedRecordsQueueStats() {
  return {
    pendingCount: pendingPayloads.size,
    pendingDebounceCount: debounceTimers.size,
    pendingDebounceIds: Array.from(debounceTimers.keys()),
    inFlightCount: inFlightPromises.size,
    inFlightIds: Array.from(inFlightPromises.keys()),
    pendingPayloadCount: pendingPayloads.size,
    pendingPayloadIds: Array.from(pendingPayloads.keys())
  };
}

export const getSavedRecordsQueueStatus = getSavedRecordsQueueStats;
