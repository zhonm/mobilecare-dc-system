import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { unmarkDeletedSerials } from './deletionRegistryService';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';

export const executeSaveUnitsToSupabase = async ({
  units,
  currentUser,
  setCloudSyncStatus
}) => {
  if (!supabase || !units || units.length === 0) return;
  await unmarkDeletedSerials(units.map(u => u.serial_number));
  setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
  try {
    let defaultCatId = null;
    const { data: dbCats } = await supabase.from('part_categories').select('id').limit(1);
    if (dbCats && dbCats.length > 0) {
      defaultCatId = dbCats[0].id;
    } else {
      const { data: newCat } = await supabase
        .from('part_categories')
        .insert({ name: 'General Parts', code: 'GEN' })
        .select('id')
        .single();
      defaultCatId = newCat?.id;
    }

    const { data: existingParts } = await supabase.from('parts').select('id, part_number');
    const existingPartsMap = new Map((existingParts || []).map(p => [p.part_number?.toUpperCase(), p.id]));

    const missingParts = [];
    units.forEach(u => {
      const pn = (u.part_number || 'UNKNOWN').toUpperCase();
      if (!existingPartsMap.has(pn) && !missingParts.some(mp => mp.part_number === pn)) {
        missingParts.push({
          part_number: pn,
          description: u.description || 'Service Replacement Part',
          category_id: defaultCatId
        });
      }
    });

    if (missingParts.length > 0) {
      const { data: insertedParts } = await supabase.from('parts').insert(missingParts).select('id, part_number');
      (insertedParts || []).forEach(ip => {
        existingPartsMap.set(ip.part_number.toUpperCase(), ip.id);
      });
    }

    const dbRows = units.map(u => {
      const pn = (u.part_number || 'UNKNOWN').toUpperCase();
      const partId = existingPartsMap.get(pn) || u.part_id;
      return {
        serial_number: String(u.serial_number || '').trim().toUpperCase(),
        part_id: partId,
        current_site_id: u.current_site_id || 'site-dc',
        status: u.status || 'in_stock',
        box_number: u.box_number || 1,
        notes: u.intake_assignment || u.notes || 'MDC - Forecasting',
        received_at: u.received_at || new Date().toISOString(),
        received_by_name: currentUser?.fullName || u.received_by || 'Warehouse Staff',
        updated_at: new Date().toISOString()
      };
    }).filter(r => Boolean(r.serial_number));

    const { error: upsertErr } = await supabase.from('inventory_units').upsert(dbRows, { onConflict: 'serial_number' });
    if (upsertErr) {
      console.warn('Direct inventory_units table notice:', upsertErr.message);
    }

    await supabase.from('saved_records').upsert({
      id: 'live_master_dc_inventory',
      record_type: 'master_inventory',
      period_label: 'Live Master DC Inventory',
      period_year: new Date().getFullYear(),
      period_month: new Date().getMonth() + 1,
      notes: 'Master operational serialized inventory snapshot synchronized across all users',
      saved_by_name: currentUser?.fullName || 'Warehouse Staff',
      snapshot_data: { units },
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    await supabase.from('saved_records').upsert({
      id: LIVE_MASTER_RECORD_ID,
      record_type: 'both',
      period_label: 'Master Operational Data',
      period_year: new Date().getFullYear(),
      period_month: new Date().getMonth() + 1,
      notes: 'Active live warehouse operational state',
      saved_by_name: currentUser?.fullName || 'Warehouse Staff',
      snapshot_data: { isCleared: false },
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

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

  const validAssignment = newAssignment === 'DC - CRBR' ? 'DC - CRBR' : 'MDC - Forecasting';

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
    try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedUnits)); } catch (e) {}
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

      await supabase.from('saved_records').upsert({
        id: 'live_master_dc_inventory',
        record_type: 'master_inventory',
        period_label: 'Live Master DC Inventory',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master operational serialized inventory snapshot synchronized across all users',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { units: updatedUnits },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      await supabase.from('saved_records').upsert({
        id: 'master_dc_intakes_registry',
        record_type: 'intake_registry',
        period_label: 'Master DC Intakes Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master operational intake batches synchronized across all users',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { records: updatedIntakes },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      broadcastCloudEvent('UNIT_SAVED', { serialNumber: targetSerial, assignment: validAssignment });
    } catch (e) {
      console.warn('Update assignment cloud notice:', e.message);
      setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
    }
  }

  showToast(`Updated ${targetSerial} assignment to "${validAssignment}"`, 'info');
};
