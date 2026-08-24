import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { safeUUID, canUserDeleteRecord } from '../utils/appContextHelpers';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';

export function useIntakeRecords({
  currentUser,
  showToast,
  broadcastCloudEvent,
  logDeletionAudit,
  setInventoryUnits,
  unmarkDeletedSerials,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [dcIntakeRecords, setDcIntakeRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_dc_intake_records');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(dcIntakeRecords));
    } catch (e) {
      console.warn('LocalStorage save notice for dc_intake_records:', e);
    }
  }, [dcIntakeRecords]);

  const unmarkDeletedIntakeIds = async (idsToKeep) => {
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

  const registerDeletedIntakeId = async (recordId) => {
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

  // Helper to generate standardized sequential intake record ID e.g. "MDC202600015"
  const generateNextIntakeRecordId = (targetDate = new Date()) => {
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
    return `${yearPrefix}${String(nextSeq).padStart(5, '0')}`;
  };

  // Save a completed scan-in batch as an intake record
  const saveIntakeRecord = async (recordData) => {
    const cleanDate = recordData.intake_date || recordData.intakeDate || new Date().toISOString().split('T')[0];
    const nextId = (recordData.id || recordData.recordId || recordData.record_id || generateNextIntakeRecordId(cleanDate)).trim().toUpperCase();
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

    try {
      localStorage.removeItem('mdc_is_cleared');
      dbStorage.removeItem('mdc_is_cleared');
    } catch (e) {}

    await unmarkDeletedIntakeIds([newRecord.id]);
    if (Array.isArray(newRecord.items) && newRecord.items.length > 0 && unmarkDeletedSerials) {
      await unmarkDeletedSerials(newRecord.items.map(it => it.serial_number));
    }

    let currentRecords = dcIntakeRecords;
    if (!currentRecords || currentRecords.length === 0) {
      try {
        const saved = localStorage.getItem('mdc_dc_intake_records');
        if (saved) currentRecords = JSON.parse(saved);
      } catch (e) {}
    }

    const existingFiltered = (currentRecords || []).filter(r => r.id !== nextId);
    const nextList = [newRecord, ...existingFiltered];

    setDcIntakeRecords(nextList);
    try {
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextList));
    } catch (e) {
      console.warn('LocalStorage save notice for dc_intake_records:', e);
    }
    dbStorage.setItem('mdc_dc_intake_records', nextList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
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
            snapshot_data: {
              isCleared: false
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {}

        try {
          await supabase.from('dc_intake_records').upsert({
            id: newRecord.id,
            record_name: newRecord.record_name,
            intake_date: newRecord.intake_date,
            po_id: newRecord.po_id,
            po_number: newRecord.po_number,
            supplier_name: newRecord.supplier_name,
            notes: newRecord.notes,
            items: newRecord.items,
            total_units: newRecord.total_units,
            total_value: newRecord.total_value,
            saved_by_id: safeUUID(newRecord.saved_by_id),
            saved_by_name: newRecord.saved_by_name,
            created_at: newRecord.created_at,
            updated_at: newRecord.updated_at
          }, { onConflict: 'id' });
        } catch (tableErr) {
          console.warn('Direct dc_intake_records table notice:', tableErr.message);
        }

        const intakeYear = new Date(newRecord.intake_date || new Date()).getFullYear() || new Date().getFullYear();
        const intakeMonth = (new Date(newRecord.intake_date || new Date()).getMonth() + 1) || (new Date().getMonth() + 1);

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

        await supabase.from('saved_records').upsert({
          id: 'master_dc_intakes_registry',
          record_type: 'intake_registry',
          period_label: 'Master DC Intakes Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master operational intake batches synchronized across all users',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: {
            records: nextList
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
      } catch (dbErr) {
        console.error('Supabase dc_intake_records sync error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) enqueueOfflineAction('INTAKE_UPSERT', newRecord);
        if (broadcastCloudEvent) broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
    }

    showToast(`Saved DC Intake Record "${newRecord.record_name}" with ${newRecord.total_units} units to database!`, 'success');
    return { success: true, record: newRecord };
  };

  // Delete a saved intake record
  const deleteIntakeRecord = async (recordId) => {
    const target = (dcIntakeRecords || []).find(r => r.id === recordId);
    if (!target) return { success: false, error: 'Record not found' };

    // Authority Rule: Only the user who originally saved the record has permission to delete it
    if (!canUserDeleteRecord(target, currentUser)) {
      const creatorName = target.saved_by_name || 'the original creator';
      showToast(`Permission Denied: Only ${creatorName} can delete this intake record.`, 'error');
      return { success: false, error: `Permission Denied: Only ${creatorName} can delete this record.` };
    }

    const serialsInBatch = (target?.items || []).map(it => String(it.serial_number || '').trim().toUpperCase()).filter(Boolean);

    if (serialsInBatch.length > 0) {
      try {
        const localDeleted = JSON.parse(localStorage.getItem('mdc_deleted_unit_serials') || '[]');
        const updatedDeleted = Array.from(new Set([...localDeleted, ...serialsInBatch]));
        localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(updatedDeleted));
      } catch (e) {}

      if (setInventoryUnits) {
        setInventoryUnits(prev => {
          const filtered = (prev || []).filter(u => !serialsInBatch.includes(String(u.serial_number || '').toUpperCase()));
          try { localStorage.setItem('mdc_inventory', JSON.stringify(filtered)); } catch (e) {}
          dbStorage.setItem('mdc_inventory', filtered);
          return filtered;
        });
      }
    }

    await registerDeletedIntakeId(recordId);

    let currentRecords = dcIntakeRecords;
    if (!currentRecords || currentRecords.length === 0) {
      try {
        const saved = localStorage.getItem('mdc_dc_intake_records');
        if (saved) currentRecords = JSON.parse(saved);
      } catch (e) {}
    }
    const nextRecords = (currentRecords || []).filter(r => r.id !== recordId);

    setDcIntakeRecords(nextRecords);
    try {
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords));
    } catch (e) {}
    dbStorage.setItem('mdc_dc_intake_records', nextRecords);

    if (logDeletionAudit) {
      await logDeletionAudit({
        entityType: 'DC Intake Record',
        entityId: recordId,
        entityLabel: target?.record_name || (target?.intake_number ? `Intake #${target.intake_number}` : `Intake Record ${recordId}`),
        summary: {
          itemsCount: target?.items?.length || target?.total_units || 0,
          poNumber: target?.po_number || target?.poNumber || 'N/A',
          intakeDate: target?.intake_date,
          originalSavedBy: target?.saved_by_name || 'Warehouse Staff'
        },
        reason: 'Deleted by warehouse staff / administrator'
      });
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        if (serialsInBatch.length > 0) {
          try { await supabase.from('inventory_units').update({ is_deleted: true }).in('serial_number', serialsInBatch); } catch (e) {}
          try { await supabase.from('inventory_units').delete().in('serial_number', serialsInBatch); } catch (e) {}
        }

        try {
          const { error: delErr } = await supabase.from('dc_intake_records').delete().eq('id', recordId);
          if (delErr) {
            await supabase.from('dc_intake_records').update({ notes: '__DELETED__', items: [], updated_at: new Date().toISOString() }).eq('id', recordId);
          }
        } catch (e) {}
        await supabase.from('saved_records').delete().eq('id', recordId);

        await supabase.from('saved_records').upsert({
          id: 'master_dc_intakes_registry',
          record_type: 'intake_registry',
          period_label: 'Master DC Intakes Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master operational intake batches synchronized across all users',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: {
            records: nextRecords
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('INTAKE_DELETED', { recordId });
      } catch (e) {
        console.error('Supabase deleteIntakeRecord error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) enqueueOfflineAction('INTAKE_DELETE', { recordId });
        if (broadcastCloudEvent) broadcastCloudEvent('INTAKE_DELETED', { recordId });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('INTAKE_DELETED', { recordId });
    }

    showToast(`Deleted Intake Record "${target?.record_name || recordId}"`, 'info');
    return { success: true };
  };

  return {
    dcIntakeRecords,
    setDcIntakeRecords,
    generateNextIntakeRecordId,
    saveIntakeRecord,
    deleteIntakeRecord,
    unmarkDeletedIntakeIds,
    registerDeletedIntakeId
  };
}
