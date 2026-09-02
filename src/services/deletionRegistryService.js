import { supabase } from '../supabase/client.js';

export const unmarkDeletedSerials = async (serialsToKeep) => {
  if (!serialsToKeep || serialsToKeep.length === 0) return;
  const serialSetToKeep = new Set(serialsToKeep.map(s => String(s).trim().toUpperCase()));
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
    const filtered = localDeleted.filter(s => !serialSetToKeep.has(String(s).trim().toUpperCase()));
    localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(filtered));
  } catch (e) {}

  if (supabase) {
    try {
      const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_unit_serials_registry').maybeSingle();
      if (reg?.snapshot_data?.deletedSerials && Array.isArray(reg.snapshot_data.deletedSerials)) {
        const updatedCloud = reg.snapshot_data.deletedSerials.filter(s => !serialSetToKeep.has(String(s).trim().toUpperCase()));
        await supabase.from('saved_records').upsert({
          id: 'deleted_unit_serials_registry',
          record_type: 'deletion_registry',
          period_label: 'Deleted Unit Serials Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { deletedSerials: updatedCloud },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      }
    } catch (e) {}
  }
};

export const unmarkDeletedIntakeIds = async (idsToKeep) => {
  if (!idsToKeep || idsToKeep.length === 0) return;
  const idSetToKeep = new Set(idsToKeep.map(id => String(id).trim().toUpperCase()));
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_intake_ids') || '[]');
    const filtered = localDeleted.filter(id => !idSetToKeep.has(String(id).trim().toUpperCase()));
    localStorage.setItem('mdc_deleted_intake_ids', JSON.stringify(filtered));
  } catch (e) {}

  if (supabase) {
    try {
      const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_intake_ids_registry').maybeSingle();
      if (reg?.snapshot_data?.deletedIds && Array.isArray(reg.snapshot_data.deletedIds)) {
        const updatedCloud = reg.snapshot_data.deletedIds.filter(id => !idSetToKeep.has(String(id).trim().toUpperCase()));
        await supabase.from('saved_records').upsert({
          id: 'deleted_intake_ids_registry',
          record_type: 'deletion_registry',
          period_label: 'Deleted Intake IDs Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { deletedIds: updatedCloud },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      }
    } catch (e) {}
  }
};

export const registerDeletedIntakeId = async (recordId) => {
  if (!recordId) return;
  const cleanId = String(recordId).trim().toUpperCase();
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_intake_ids') || '[]');
    const updated = Array.from(new Set([...localDeleted, cleanId]));
    localStorage.setItem('mdc_deleted_intake_ids', JSON.stringify(updated));
  } catch (e) {}

  if (supabase) {
    try {
      const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_intake_ids_registry').maybeSingle();
      const cloudDeleted = reg?.snapshot_data?.deletedIds || [];
      const updatedCloud = Array.from(new Set([...cloudDeleted, cleanId]));
      await supabase.from('saved_records').upsert({
        id: 'deleted_intake_ids_registry',
        record_type: 'deletion_registry',
        period_label: 'Deleted Intake IDs Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        snapshot_data: { deletedIds: updatedCloud },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    } catch (e) {}
  }
};

export const unmarkDeletedShipmentIds = async (idsToKeep) => {
  if (!idsToKeep || idsToKeep.length === 0) return;
  const idSetToKeep = new Set(idsToKeep.map(id => String(id || '').trim().toUpperCase()).filter(Boolean));
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
    const filtered = localDeleted.filter(id => !idSetToKeep.has(String(id || '').trim().toUpperCase()));
    localStorage.setItem('mdc_deleted_shipment_ids', JSON.stringify(filtered));
  } catch (e) {}

  if (supabase) {
    try {
      const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_shipment_ids_registry').maybeSingle();
      if (reg?.snapshot_data?.deletedIds && Array.isArray(reg.snapshot_data.deletedIds)) {
        const updatedCloud = reg.snapshot_data.deletedIds.filter(id => !idSetToKeep.has(String(id || '').trim().toUpperCase()));
        await supabase.from('saved_records').upsert({
          id: 'deleted_shipment_ids_registry',
          record_type: 'deletion_registry',
          period_label: 'Deleted Shipment IDs Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          snapshot_data: { deletedIds: updatedCloud },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      }
    } catch (e) {}
  }
};

export const registerDeletedShipmentId = async (recordId) => {
  if (!recordId) return;
  const cleanId = String(recordId).trim().toUpperCase();
  try {
    const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
    const updated = Array.from(new Set([...localDeleted, cleanId]));
    localStorage.setItem('mdc_deleted_shipment_ids', JSON.stringify(updated));
  } catch (e) {}

  if (supabase) {
    try {
      const { data: reg } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'deleted_shipment_ids_registry').maybeSingle();
      const cloudDeleted = reg?.snapshot_data?.deletedIds || [];
      const updatedCloud = Array.from(new Set([...cloudDeleted, cleanId]));
      await supabase.from('saved_records').upsert({
        id: 'deleted_shipment_ids_registry',
        record_type: 'deletion_registry',
        period_label: 'Deleted Shipment IDs Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        snapshot_data: { deletedIds: updatedCloud },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    } catch (e) {}
  }
};
