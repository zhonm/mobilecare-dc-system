/**
 * MDC SYSTEM 2: Operational Data Archiving Manager
 *
 * Automatically partitions and manages lifecycle archiving for:
 * 1. Closed Shipments (received_confirmed / delivered older than 60 days)
 * 2. Completed DC Intake Batches (older than 60 days)
 *
 * Active sync queries only pull active operational records, drastically slashing
 * PostgREST egress and query payload sizes while keeping historical data safe and accessible on demand.
 */

import { supabase } from '../supabase/client.js';
import { parseDcIntakeRecordFromDb } from './appContextHelpers.js';

export const ARCHIVE_CUTOFF_DAYS = 60; // 60 days default rolling operational window

/**
 * Returns Date object representing the archive threshold (default 60 days ago).
 */
export function getArchiveCutoffDate(days = ARCHIVE_CUTOFF_DAYS) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Returns 'YYYY-MM-DD' ISO date string for the archive threshold.
 */
export function getArchiveCutoffIso(days = ARCHIVE_CUTOFF_DAYS) {
  return getArchiveCutoffDate(days).toISOString().split('T')[0];
}

/**
 * Determines whether a shipment is archived.
 *
 * Rules:
 * - If already explicitly flagged `is_archived === true`, return true.
 * - Open or in-transit manifests (draft, pending_pickup, shipped, in_transit) are NEVER archived.
 * - Only closed manifests (received_confirmed or delivered) whose shipment_date or created_at
 *   is older than cutoffDays are archived.
 */
export function isShipmentArchived(shipment, cutoffDays = ARCHIVE_CUTOFF_DAYS) {
  if (!shipment) return false;
  if (shipment.is_archived === true) return true;

  const rawStatus = String(shipment.status || '').trim().toLowerCase();
  const isClosed = rawStatus === 'received_confirmed' ||
    rawStatus === 'delivered' ||
    rawStatus.includes('confirm');

  // Open / active in-transit shipments are NEVER archived
  if (!isClosed) return false;

  const rawDate = shipment.shipment_date || shipment.shipmentDate || shipment.created_at;
  if (!rawDate) return false;

  const targetTime = new Date(rawDate).getTime();
  if (isNaN(targetTime)) return false;

  const cutoffTime = getArchiveCutoffDate(cutoffDays).getTime();
  return targetTime < cutoffTime;
}

/**
 * Determines whether a DC intake batch record is archived.
 *
 * Rules:
 * - If explicitly flagged `is_archived === true`, return true.
 * - If intake_date or created_at is older than cutoffDays, return true.
 */
export function isIntakeRecordArchived(record, cutoffDays = ARCHIVE_CUTOFF_DAYS) {
  if (!record) return false;
  if (record.is_archived === true) return true;

  const rawDate = record.intake_date || record.intakeDate || record.created_at;
  if (!rawDate) return false;

  const targetTime = new Date(rawDate).getTime();
  if (isNaN(targetTime)) return false;

  const cutoffTime = getArchiveCutoffDate(cutoffDays).getTime();
  return targetTime < cutoffTime;
}

/**
 * Partitions an array of shipments into active and archived sets.
 */
export function partitionActiveAndArchivedShipments(shipments = [], cutoffDays = ARCHIVE_CUTOFF_DAYS) {
  const active = [];
  const archived = [];

  (shipments || []).forEach(sh => {
    if (isShipmentArchived(sh, cutoffDays)) {
      archived.push({ ...sh, is_archived: true });
    } else {
      active.push(sh);
    }
  });

  return { active, archived };
}

/**
 * Partitions an array of DC intake records into active and archived sets.
 */
export function partitionActiveAndArchivedIntakes(records = [], cutoffDays = ARCHIVE_CUTOFF_DAYS) {
  const active = [];
  const archived = [];

  (records || []).forEach(rec => {
    if (isIntakeRecordArchived(rec, cutoffDays)) {
      archived.push({ ...rec, is_archived: true });
    } else {
      active.push(rec);
    }
  });

  return { active, archived };
}

/**
 * On-demand fetcher: Retrieves historical archived shipments (>60 days) from Supabase.
 * Keeps normal periodic sync queries lean while allowing historical auditing on demand.
 */
export async function fetchArchivedShipmentsFromCloud({
  limit = 100,
  siteId = null,
  client = supabase
} = {}) {
  if (!client) return [];
  const cutoffIsoDate = getArchiveCutoffIso(ARCHIVE_CUTOFF_DAYS);

  try {
    let query = client
      .from('shipments')
      .select('*, shipment_items(*)')
      .in('status', ['received_confirmed', 'delivered'])
      .lt('shipment_date', cutoffIsoDate)
      .order('shipment_date', { ascending: false })
      .limit(limit);

    if (siteId) {
      query = query.eq('site_id', siteId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('fetchArchivedShipmentsFromCloud warning:', error.message);
      return [];
    }
    return (data || []).map(sh => ({ ...sh, is_archived: true }));
  } catch (err) {
    console.warn('fetchArchivedShipmentsFromCloud error:', err);
    return [];
  }
}

/**
 * On-demand fetcher: Retrieves historical archived DC intake batches (>60 days) from Supabase.
 * Keeps normal periodic sync queries lean while allowing historical auditing on demand.
 */
export async function fetchArchivedIntakesFromCloud({
  limit = 100,
  client = supabase
} = {}) {
  if (!client) return [];
  const cutoffIsoDate = getArchiveCutoffIso(ARCHIVE_CUTOFF_DAYS);

  try {
    const { data, error } = await client
      .from('dc_intake_records')
      .select('*')
      .lt('intake_date', cutoffIsoDate)
      .order('intake_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('fetchArchivedIntakesFromCloud warning:', error.message);
      return [];
    }

    return (data || []).map(rec => {
      const parsed = parseDcIntakeRecordFromDb(rec);
      return { ...parsed, is_archived: true };
    });
  } catch (err) {
    console.warn('fetchArchivedIntakesFromCloud error:', err);
    return [];
  }
}
