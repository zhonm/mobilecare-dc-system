import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import { safeUUID } from '../utils/appContextHelpers.js';
import { unmarkDeletedIntakeIds, unmarkDeletedSerials, registerDeletedIntakeId } from './deletionRegistryService.js';
import { LIVE_MASTER_RECORD_ID } from '../constants/config.js';

export const generateNextIntakeRecordId = (targetDate = new Date(), dcIntakeRecords = []) => {
  let year = 2026;
  if (targetDate instanceof Date && !isNaN(targetDate)) {
    year = targetDate.getFullYear();
  } else if (typeof targetDate === 'string') {
    const parsed = new Date(targetDate);
    if (!isNaN(parsed)) year = parsed.getFullYear();
  }

  const yearPrefix = `MDC${year}`;
  const matchingRecords = (dcIntakeRecords || []).filter(r => r.id && r.id.startsWith(yearPrefix));

  let maxSeq = 0;
  matchingRecords.forEach(r => {
    const numPart = r.id.replace(yearPrefix, '').split('-')[0];
    const seq = parseInt(numPart, 10);
    if (!isNaN(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  });

  const nextSeq = maxSeq + 1;
  const candidate = `${yearPrefix}${String(nextSeq).padStart(5, '0')}`;
  
  const existingIds = new Set((dcIntakeRecords || []).map(r => r.id));
  if (existingIds.has(candidate)) {
    return `${candidate}-${Date.now().toString().slice(-4)}`;
  }
  return candidate;
};

export const executeSaveIntakeRecord = async ({
  recordData,
  dcIntakeRecords,
  setDcIntakeRecords,
  currentUser,
  setCloudSyncStatus,
  broadcastCloudEvent,
  enqueueOfflineAction,
  showToast
}) => {
  const cleanDate = recordData.intake_date || recordData.intakeDate || new Date().toISOString().split('T')[0];
  const nextId = (recordData.id || recordData.recordId || recordData.record_id || generateNextIntakeRecordId(cleanDate, dcIntakeRecords)).trim().toUpperCase();
  const nextName = (recordData.record_name || recordData.recordName || `Intake Batch ${nextId}`).trim();
  const rawItems = recordData.items || [];
  const totalUnits = recordData.total_units || recordData.totalUnits || (rawItems.length > 0 ? rawItems.length : 0);
  const totalValue = recordData.total_value || recordData.totalValue || rawItems.reduce((acc, it) => acc + Number(it.stocking_price || it.price || 99), 0);

  const newRecord = {
    id: nextId,
    record_name: nextName,
    intake_date: cleanDate,
    po_id: recordData.po_id || recordData.poId || null,
    po_number: recordData.po_number || recordData.poNumber || 'Direct Receiving',
    supplier_name: recordData.supplier_name || recordData.supplierName || recordData.supplier || 'Apple Authorized Logistics',
    notes: recordData.notes || '',
    items: rawItems,
    total_units: totalUnits,
    total_value: totalValue,
    saved_by_id: currentUser?.id || 'usr-system',
    saved_by_name: currentUser?.fullName || 'Warehouse Staff',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Clear any previous isCleared flag & unmark ID & item serials from local and cloud deletion sets
  try {
    localStorage.removeItem('mdc_is_cleared');
    dbStorage.removeItem('mdc_is_cleared');
  } catch (e) {}
  await unmarkDeletedIntakeIds([newRecord.id]);
  if (Array.isArray(newRecord.items) && newRecord.items.length > 0) {
    await unmarkDeletedSerials(newRecord.items.map(it => it.serial_number));
  }

  // Calculate nextList synchronously upfront so cloud sync never receives an empty array
  const existingFiltered = (dcIntakeRecords || []).filter(r => r.id !== nextId);
  const nextList = [newRecord, ...existingFiltered];

  setDcIntakeRecords(nextList);
  try {
    localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextList));
  } catch (e) {
    console.warn('LocalStorage save notice for dc_intake_records:', e);
  }
  dbStorage.setItem('mdc_dc_intake_records', nextList);

  // Multi-channel Realtime Cloud Sync to Supabase
  if (supabase) {
    setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
    try {
      try {
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
      } catch (e) {}

      // Channel 1: Upsert to direct dc_intake_records table
      try {
        const directRow = {
          id: String(newRecord.id),
          record_name: String(newRecord.record_name || newRecord.id),
          intake_date: newRecord.intake_date || new Date().toISOString().split('T')[0],
          po_id: safeUUID(newRecord.po_id),
          po_number: newRecord.po_number || null,
          supplier: newRecord.supplier_name || newRecord.supplier || 'Direct Barcode Intake',
          total_units: parseInt(newRecord.total_units || (newRecord.items ? newRecord.items.length : 0), 10) || 0,
          saved_by_name: newRecord.saved_by_name || currentUser?.fullName || 'Warehouse Staff',
          saved_by_user_id: safeUUID(newRecord.saved_by_user_id || newRecord.saved_by_id || currentUser?.id),
          notes: newRecord.notes || null,
          category_breakdown: newRecord.category_breakdown || {},
          items: Array.isArray(newRecord.items) ? newRecord.items : [],
          created_at: newRecord.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const { error: directErr } = await supabase.from('dc_intake_records').upsert(directRow, { onConflict: 'id' });
        if (directErr) {
          console.error('Supabase direct dc_intake_records upsert error:', directErr);
        }
      } catch (tableErr) {
        console.warn('Direct dc_intake_records table notice:', tableErr.message);
      }

      const intakeYear = new Date(newRecord.intake_date || new Date()).getFullYear() || new Date().getFullYear();
      const intakeMonth = (new Date(newRecord.intake_date || new Date()).getMonth() + 1) || (new Date().getMonth() + 1);

      // Channel 2: Upsert individual batch document in saved_records
      await supabase.from('saved_records').upsert({
        id: newRecord.id,
        record_type: 'intake_batch',
        period_label: newRecord.record_name,
        period_year: intakeYear,
        period_month: intakeMonth,
        notes: newRecord.notes,
        saved_by_name: newRecord.saved_by_name,
        snapshot_data: newRecord,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      // Channel 3: Upsert complete master intake registry in saved_records (synced to all users in realtime)
      await supabase.from('saved_records').upsert({
        id: 'master_dc_intakes_registry',
        record_type: 'intake_registry',
        period_label: 'Master DC Intakes Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master operational intake batches synchronized across all users',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { records: nextList },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
    } catch (dbErr) {
      console.error('Supabase dc_intake_records sync error:', dbErr.message);
      setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      enqueueOfflineAction('INTAKE_UPSERT', newRecord);
      broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
    }
  } else {
    broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
  }

  showToast(`Saved Parts History Record "${newRecord.record_name}" with ${newRecord.total_units} units to database!`, 'success');
  return { success: true, record: newRecord };
};

export const executeDeleteIntakeRecord = async ({
  recordId,
  dcIntakeRecords,
  setDcIntakeRecords,
  _setInventoryUnits,
  logDeletionAudit,
  currentUser,
  setCloudSyncStatus,
  broadcastCloudEvent,
  showToast
}) => {
  const cleanRecId = String(recordId || '').trim();
  const cleanRecIdUpper = cleanRecId.toUpperCase();
  const target = (dcIntakeRecords || []).find(r => String(r.id || '').trim().toUpperCase() === cleanRecIdUpper);
  const targetName = target?.record_name ? String(target.record_name).trim() : '';
  const targetNameUpper = targetName.toUpperCase();

  const nextRecords = (dcIntakeRecords || []).filter(r => {
    const rId = String(r.id || '').trim().toUpperCase();
    const rName = String(r.record_name || '').trim().toUpperCase();
    return rId !== cleanRecIdUpper && (targetNameUpper ? rName !== targetNameUpper : true);
  });

  // 1. Register intake ID in deleted registry and remove from state
  await registerDeletedIntakeId(recordId);
  if (targetName && targetName !== cleanRecId) {
    await registerDeletedIntakeId(targetName);
  }

  setDcIntakeRecords(nextRecords);
  try {
    localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords));
  } catch (e) {}
  dbStorage.setItem('mdc_dc_intake_records', nextRecords);

  // 2. Log deletion audit with user accountability
  if (logDeletionAudit) {
    await logDeletionAudit({
      entityType: 'DC Intake Record',
      entityId: recordId,
      entityLabel: target?.record_name || (target?.intake_number ? `Intake #${target.intake_number}` : `Parts History Record ${recordId}`),
      summary: {
        itemsCount: target?.items?.length || target?.total_units || 0,
        poNumber: target?.po_number || target?.poNumber || 'N/A',
        intakeDate: target?.intake_date,
        originalSavedBy: target?.saved_by_name || 'Warehouse Staff'
      },
      reason: 'Deleted by warehouse staff / administrator'
    });
  }

  // 3. Delete / Soft-Delete from Supabase cloud database
  if (supabase) {
    setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
    try {
      try {
        const { error: delErr } = await supabase.from('dc_intake_records').delete().eq('id', cleanRecId);
        if (delErr) {
          await supabase.from('dc_intake_records').update({ notes: '__DELETED__', items: [], updated_at: new Date().toISOString() }).eq('id', cleanRecId);
        }
      } catch (e) {}

      if (targetName && targetName !== cleanRecId) {
        try {
          await supabase.from('dc_intake_records').delete().eq('id', targetName);
        } catch (e) {}
      }

      try {
        await supabase.from('dc_intake_records').delete().eq('record_name', cleanRecId);
        if (targetName) await supabase.from('dc_intake_records').delete().eq('record_name', targetName);
      } catch (e) {}

      try {
        await supabase.from('saved_records').delete().eq('id', cleanRecId);
        if (targetName && targetName !== cleanRecId) {
          await supabase.from('saved_records').delete().eq('id', targetName);
        }
      } catch (e) {}

      await supabase.from('saved_records').upsert({
        id: 'master_dc_intakes_registry',
        record_type: 'intake_registry',
        period_label: 'Master DC Intakes Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master operational intake batches synchronized across all users',
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        snapshot_data: { records: nextRecords },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      broadcastCloudEvent('INTAKE_DELETED', { recordId });
    } catch (e) {
      console.warn('Delete intake cloud notice:', e.message);
      setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      broadcastCloudEvent('INTAKE_DELETED', { recordId });
    }
  } else {
    broadcastCloudEvent('INTAKE_DELETED', { recordId });
  }

  showToast(`Deleted Parts Saved History Record "${target?.record_name || recordId}". In-stock parts remain available in DC inventory.`, 'info');
  return { success: true };
};
