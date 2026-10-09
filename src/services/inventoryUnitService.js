import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { unmarkDeletedSerials } from './deletionRegistryService';
import { getPartCategory, resolvePartCategoryUUID } from '../utils/categoryFilter';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue';
import { saveInventoryToLocalStorage, isUUID } from '../utils/appContextHelpers';

export const executeSaveUnitsToSupabase = async ({
  units,
  currentUser,
  setCloudSyncStatus
}) => {
  if (!supabase || !units || units.length === 0) return;
  await unmarkDeletedSerials(units.map(u => u.serial_number));
  setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
  try {
    const { data: dbCats } = await supabase.from('part_categories').select('id, code');
    const catMap = new Map((dbCats || []).map(c => [c.code, c.id]));
    const defaultCatId = dbCats?.[0]?.id || null;

    const { data: existingParts } = await supabase.from('parts').select('id, part_number');
    const existingPartsMap = new Map((existingParts || []).map(p => [p.part_number?.toUpperCase(), p.id]));

    const missingParts = [];
    units.forEach(u => {
      const pn = (u.part_number || 'UNKNOWN').toUpperCase();
      if (!existingPartsMap.has(pn) && !missingParts.some(mp => mp.part_number === pn)) {
        const catCode = getPartCategory({ part_number: pn, description: u.description });
        const rawCatId = catMap.get(catCode) || defaultCatId;
        const partCatUuid = (rawCatId && isUUID(rawCatId))
          ? rawCatId
          : resolvePartCategoryUUID({ part_number: pn, description: u.description });
        missingParts.push({
          part_number: pn,
          description: u.description || 'Service Replacement Part',
          ...(partCatUuid && isUUID(partCatUuid) ? { category_id: partCatUuid } : {})
        });
      }
    });

    if (missingParts.length > 0) {
      const { data: insertedParts } = await supabase.from('parts').insert(missingParts).select('id, part_number');
      (insertedParts || []).forEach(ip => {
        existingPartsMap.set(ip.part_number.toUpperCase(), ip.id);
      });
    }

    const VALID_DB_STATUSES = new Set(['in_stock', 'allocated', 'packed', 'shipped', 'delivered', 'received', 'damaged', 'returned']);
    const dbRows = units.map(u => {
      const pn = (u.part_number || 'UNKNOWN').toUpperCase();
      const partId = existingPartsMap.get(pn) || u.part_id;
      const assign = u.intake_assignment || u.notes || 'MDC - Forecasting';
      const dbStatus = VALID_DB_STATUSES.has(u.status) ? u.status : (u.status === 'outtake' ? 'returned' : 'in_stock');
      const metaPayload = {
        lifecycle_status: u.status || 'in_stock',
        work_order_number: u.work_order_number || null,
        usage_notes: u.usage_notes || null,
        used_at: u.used_at || null,
        outtake_at: u.outtake_at || null,
        outtake_reason: u.outtake_reason || null,
        transferred_at: u.transferred_at || null,
        transfer_slip_number: u.transfer_slip_number || null,
        transferred_to_site_code: u.transferred_to_site_code || null,
        site_code: u.site_code || null,
        site_name: u.site_name || null
      };
      const encodedNotes = `${assign} | __META__:${JSON.stringify(metaPayload)}`;

      return {
        serial_number: String(u.serial_number || '').trim().toUpperCase(),
        part_id: partId,
        current_site_id: u.current_site_id || 'site-dc',
        status: dbStatus,
        box_number: u.box_number || 1,
        notes: encodedNotes,
        received_at: u.received_at || new Date().toISOString(),
        received_by_name: currentUser?.fullName || u.received_by || 'Warehouse Staff',
        updated_at: new Date().toISOString()
      };
    }).filter(r => Boolean(r.serial_number));

    for (let i = 0; i < dbRows.length; i += 100) {
      const chunk = dbRows.slice(i, i + 100);
      try {
        const { error: upsertErr } = await supabase.from('inventory_units').upsert(chunk, { onConflict: 'serial_number' });
        if (upsertErr) {
          console.warn('Direct inventory_units table notice:', upsertErr.message);
        }
      } catch (err) {
        console.warn('inventory_units chunk error:', err.message);
      }
    }

    // Debounce & sequentialize singleton master snapshots to eliminate ShareLock contention
    queuedSavedRecordsUpsert({
      id: 'live_master_dc_inventory',
      record_type: 'master_inventory',
      period_label: 'Live Master DC Inventory',
      period_year: new Date().getFullYear(),
      period_month: new Date().getMonth() + 1,
      notes: 'Master operational serialized inventory snapshot synchronized across all users',
      saved_by_name: currentUser?.fullName || 'Warehouse Staff',
      snapshot_data: { units },
      updated_at: new Date().toISOString()
    }, { debounceMs: 1200 });

    const isDcUnit = (item) => {
      const sId = String(item.current_site_id || item.site_id || item.siteId || '').toLowerCase();
      const sCode = String(item.site_code || item.siteCode || '').toUpperCase();
      return sId === 'site-dc' || sCode === 'DC-MDC' || sCode === 'DC' || (!sId && !sCode && item.is_dc);
    };
    const branchUnits = units.filter(u => !isDcUnit(u));
    if (branchUnits.length > 0) {
      queuedSavedRecordsUpsert({
        id: 'master_branch_inventory_registry',
        record_type: 'branch_inventory',
        period_label: 'Master Retail Branch Inventory',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        period_week: 1,
        notes: 'Master In-Stock multi-site inventory across all MobileCare ASP service points',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { units: branchUnits },
        updated_at: new Date().toISOString()
      }, { debounceMs: 1200 });
    }

    setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
  } catch (e) {
    console.error('saveUnitsToSupabase error:', e.message);
    setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
  }
};

export const executeUpdateUnitAssignment = async ({
  unitOrSerial,
  newAssignment,
  _inventoryUnits,
  setInventoryUnits,
  _dcIntakeRecords,
  setDcIntakeRecords,
  currentUser,
  setCloudSyncStatus,
  broadcastCloudEvent,
  showToast
}) => {
  const targetSerial = typeof unitOrSerial === 'string'
    ? unitOrSerial.trim().toUpperCase()
    : String(unitOrSerial?.serial_number || unitOrSerial?.serialNumber || '').trim().toUpperCase();

  if (!targetSerial) return;

  const validAssignment = newAssignment === 'SVNR - Service Non-Repair' || String(newAssignment).includes('SVNR')
    ? 'SVNR - Service Non-Repair'
    : newAssignment === 'DC - CRBR' || String(newAssignment).includes('CRBR')
    ? 'DC - CRBR'
    : 'MDC - Forecasting';

  let updatedUnits = [];
  setInventoryUnits(prev => {
    updatedUnits = (prev || []).map(u => {
      const cleanS = String(u.serial_number || '').trim().toUpperCase();
      if (cleanS === targetSerial) {
        return {
          ...u,
          intake_assignment: validAssignment,
          notes: validAssignment
        };
      }
      return u;
    });
    try { saveInventoryToLocalStorage(updatedUnits); } catch (e) {}
    dbStorage.setItem('mdc_inventory', updatedUnits);
    return updatedUnits;
  });

  let updatedIntakes = [];
  setDcIntakeRecords(prev => {
    updatedIntakes = (prev || []).map(rec => {
      if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').trim().toUpperCase() === targetSerial)) {
        const nextItems = rec.items.map(it => {
          if (String(it.serial_number || '').trim().toUpperCase() === targetSerial) {
            return { ...it, intake_assignment: validAssignment, notes: validAssignment };
          }
          return it;
        });
        return { ...rec, items: nextItems };
      }
      return rec;
    });
    try { localStorage.setItem('mdc_dc_intake_records', JSON.stringify(updatedIntakes)); } catch (e) {}
    dbStorage.setItem('mdc_dc_intake_records', updatedIntakes);
    return updatedIntakes;
  });

  if (supabase) {
    setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
    try {
      try {
        await supabase.from('inventory_units').update({
          notes: validAssignment,
          updated_at: new Date().toISOString()
        }).eq('serial_number', targetSerial);
      } catch (e) {}

      queuedSavedRecordsUpsert({
        id: 'live_master_dc_inventory',
        record_type: 'master_inventory',
        period_label: 'Live Master DC Inventory',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master operational serialized inventory snapshot synchronized across all users',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { units: updatedUnits },
        updated_at: new Date().toISOString()
      }, { debounceMs: 1000 });

      queuedSavedRecordsUpsert({
        id: 'master_dc_intakes_registry',
        record_type: 'intake_registry',
        period_label: 'Master DC Intakes Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master operational intake batches synchronized across all users',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { records: updatedIntakes },
        updated_at: new Date().toISOString()
      }, { debounceMs: 1000 });

      setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      broadcastCloudEvent('UNIT_SAVED', { serialNumber: targetSerial, assignment: validAssignment });
    } catch (e) {
      console.warn('Update assignment cloud notice:', e.message);
      setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
    }
  }

  showToast(`Updated ${targetSerial} assignment to "${validAssignment}"`, 'info');
};
