import { useState } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { isExplicitlyCleared, canUserDeleteRecord } from '../utils/appContextHelpers';
import { generateAllocationsFromForecasts } from '../utils/allocationEngine';

export function usePeriodRecordsAndReports({
  currentUser,
  forecastItems = [],
  setForecastItems,
  allocations = [],
  setAllocations,
  parts = [],
  setParts,
  sites = [],
  setSites,
  _activePeriod,
  setActivePeriod,
  setActiveTab,
  showToast,
  broadcastCloudEvent,
  logDeletionAudit,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [savedRecords, setSavedRecords] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_saved_records');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [stockTransferReports, setStockTransferReports] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_stock_transfer_reports');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [stockTransferMetadata, setStockTransferMetadata] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_stock_transfer_metadata');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const savePeriodRecord = async ({
    recordType = 'both',
    periodLabel,
    periodYear,
    periodMonth,
    periodWeek = null,
    notes = ''
  }) => {
    if (recordType === 'forecast' && (!forecastItems || forecastItems.length === 0)) {
      showToast('Cannot save record: Forecast matrix has no items.', 'error');
      return { success: false, error: 'Forecast table is empty' };
    }

    if (recordType === 'allocation' && (!allocations || allocations.length === 0)) {
      showToast('Cannot save record: Allocation matrix has no items.', 'error');
      return { success: false, error: 'Allocation table is empty' };
    }

    if (recordType === 'both' && (!forecastItems || forecastItems.length === 0) && (!allocations || allocations.length === 0)) {
      showToast('Cannot save record: Both Forecast and Allocation tables are empty.', 'error');
      return { success: false, error: 'Both tables are empty' };
    }

    const cleanLabel = (periodLabel || '').trim();
    if (!cleanLabel) {
      showToast('Please provide a name or label for this period record.', 'warning');
      return { success: false, error: 'Missing period label' };
    }

    const totalForecastUnits = (forecastItems || []).reduce((sum, item) => sum + (item.final_forecast || item.computed_forecast || 0), 0);
    const totalAllocatedUnits = (allocations || []).reduce((sum, item) => sum + (item.total_allocated_qty || 0), 0);
    const activeSitesCount = (sites || []).filter(s => !s.is_dc).length;

    let grandTotalValue = 0;
    (allocations || []).forEach(item => {
      const part = (parts || []).find(p => p.id === item.part_id || p.part_number === item.part_number);
      const price = part?.stocking_price || (item.description?.toLowerCase().includes('display') ? 280 : 150);
      grandTotalValue += (item.total_allocated_qty || 0) * price;
    });

    const snapshotData = {
      forecastItems: recordType !== 'allocation' ? JSON.parse(JSON.stringify(forecastItems || [])) : [],
      allocations: recordType !== 'forecast' ? JSON.parse(JSON.stringify(allocations || [])) : [],
      parts: JSON.parse(JSON.stringify(parts || [])),
      sites: JSON.parse(JSON.stringify(sites || [])),
      summary: {
        totalForecastUnits,
        totalAllocatedUnits,
        totalForecastParts: recordType !== 'allocation' ? (forecastItems || []).length : 0,
        totalAllocatedParts: recordType !== 'forecast' ? (allocations || []).length : 0,
        totalSites: activeSitesCount,
        grandTotalValue
      }
    };

    const newRecordId = `rec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newRecord = {
      id: newRecordId,
      record_type: recordType,
      period_label: cleanLabel,
      period_year: parseInt(periodYear) || new Date().getFullYear(),
      period_month: parseInt(periodMonth) || (new Date().getMonth() + 1),
      period_week: periodWeek ? parseInt(periodWeek) : null,
      notes: (notes || '').trim(),
      saved_by_name: currentUser?.fullName || 'Warehouse Operations',
      saved_by_user_id: currentUser?.id && !currentUser.id.startsWith('usr-') ? currentUser.id : null,
      snapshot_data: snapshotData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    setSavedRecords(prev => [newRecord, ...prev]);
    dbStorage.putSavedRecord(newRecord);

    try {
      const currentSaved = [newRecord, ...savedRecords].slice(0, 50);
      localStorage.setItem('mdc_saved_records', JSON.stringify(currentSaved));
    } catch (e) {
      console.warn('LocalStorage save notice for saved records:', e);
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase.from('saved_records').upsert({
          id: newRecord.id,
          record_type: newRecord.record_type,
          period_label: newRecord.period_label,
          period_year: newRecord.period_year,
          period_month: newRecord.period_month,
          period_week: newRecord.period_week,
          notes: newRecord.notes,
          saved_by_name: newRecord.saved_by_name,
          saved_by_user_id: newRecord.saved_by_user_id,
          snapshot_data: newRecord.snapshot_data,
          created_at: newRecord.created_at,
          updated_at: newRecord.updated_at
        }, { onConflict: 'id' });
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('PERIOD_RECORD_SAVED', { recordId: newRecord.id, label: newRecord.period_label });
      } catch (dbErr) {
        console.error('Supabase saved_records cloud sync error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('SAVED_RECORD_UPSERT', {
            id: newRecord.id,
            record_type: newRecord.record_type,
            period_label: newRecord.period_label,
            snapshot_data: newRecord.snapshot_data,
            updated_at: new Date().toISOString()
          });
        }
        if (broadcastCloudEvent) broadcastCloudEvent('PERIOD_RECORD_SAVED', { recordId: newRecord.id, label: newRecord.period_label });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('PERIOD_RECORD_SAVED', { recordId: newRecord.id, label: newRecord.period_label });
    }

    showToast(`Saved period record: "${newRecord.period_label}" permanently to database`, 'success');
    return { success: true, record: newRecord };
  };

  const restorePeriodRecord = (recordId, options = { restoreForecast: true, restoreAllocation: true }) => {
    const record = savedRecords.find(r => r.id === recordId);
    if (!record) {
      showToast('Record not found', 'error');
      return { success: false, error: 'Record not found' };
    }

    dbStorage.removeItem('mdc_is_cleared');
    try { localStorage.removeItem('mdc_is_cleared'); } catch (e) {}

    const snap = record.snapshot_data || {};

    if (snap.parts && snap.parts.length > 0 && setParts) {
      setParts(prev => {
        const map = new Map((prev || []).map(p => [p.part_number, p]));
        snap.parts.forEach(p => {
          if (!map.has(p.part_number)) map.set(p.part_number, p);
        });
        const merged = Array.from(map.values());
        dbStorage.setItem('mdc_parts', merged);
        try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
        return merged;
      });
    }

    if (snap.sites && snap.sites.length > 0 && setSites) {
      setSites(prev => {
        const map = new Map((prev || []).map(s => [s.code, s]));
        snap.sites.forEach(s => {
          if (!map.has(s.code)) map.set(s.code, s);
        });
        const merged = Array.from(map.values());
        dbStorage.setItem('mdc_sites', merged);
        try { localStorage.setItem('mdc_sites', JSON.stringify(merged)); } catch (e) {}
        return merged;
      });
    }

    let restoredCountDesc = [];

    if (options.restoreForecast && snap.forecastItems && snap.forecastItems.length > 0 && setForecastItems) {
      setForecastItems(snap.forecastItems);
      dbStorage.setItem('mdc_forecast', snap.forecastItems);
      try {
        localStorage.setItem('mdc_forecast', JSON.stringify(snap.forecastItems));
      } catch (e) {}
      restoredCountDesc.push(`${snap.forecastItems.length} forecasts`);
    }

    if (options.restoreAllocation && snap.allocations && snap.allocations.length > 0 && setAllocations) {
      setAllocations(snap.allocations);
      dbStorage.setItem('mdc_allocations', snap.allocations);
      try {
        localStorage.setItem('mdc_allocations', JSON.stringify(snap.allocations));
      } catch (e) {}
      restoredCountDesc.push(`${snap.allocations.length} allocations`);
    } else if (snap.forecastItems && snap.forecastItems.length > 0 && setAllocations) {
      const generated = generateAllocationsFromForecasts(snap.forecastItems, sites);
      if (generated.length > 0) {
        setAllocations(generated);
        dbStorage.setItem('mdc_allocations', generated);
        try {
          localStorage.setItem('mdc_allocations', JSON.stringify(generated));
        } catch (e) {}
        restoredCountDesc.push(`${generated.length} allocations`);
      }
    }

    if (record.period_month || record.period_year || record.period_label) {
      const restoredPeriod = {
        month: record.period_month || 9,
        year: record.period_year || 2026,
        label: record.period_label || `Period ${record.period_month || 9} ${record.period_year || 2026}`
      };
      if (setActivePeriod) setActivePeriod(restoredPeriod);
      dbStorage.setItem('mdc_active_period', restoredPeriod);
      try { localStorage.setItem('mdc_active_period', JSON.stringify(restoredPeriod)); } catch (e) {}
    }

    const descStr = restoredCountDesc.length > 0 ? ` (${restoredCountDesc.join(', ')})` : '';
    showToast(`Loaded record "${record.period_label}" into live working tables${descStr}!`, 'success');

    if (setActiveTab) {
      if (options.restoreForecast && !options.restoreAllocation) {
        setActiveTab('forecast');
      } else if (options.restoreAllocation && !options.restoreForecast) {
        setActiveTab('allocation');
      } else if (snap.forecastItems && snap.forecastItems.length > 0) {
        setActiveTab('forecast');
      } else if (snap.allocations && snap.allocations.length > 0) {
        setActiveTab('allocation');
      }
    }

    return { success: true };
  };

  const deletePeriodRecord = async (recordId) => {
    const record = savedRecords.find(r => r.id === recordId);
    if (!record) {
      return { success: false, error: 'Record not found' };
    }

    // Authority Rule: Only the user who originally saved the record has permission to delete it
    if (!canUserDeleteRecord(record, currentUser)) {
      const creatorName = record.saved_by_name || 'the original creator';
      showToast(`Permission Denied: Only ${creatorName} can delete this saved period record.`, 'error');
      return { success: false, error: `Permission Denied: Only ${creatorName} can delete this record.` };
    }

    if (logDeletionAudit) {
      await logDeletionAudit({
        entityType: 'Period Snapshot',
        entityId: recordId,
        entityLabel: record.period_label || `Snapshot ${recordId}`,
        summary: {
          period_year: record.period_year,
          period_month: record.period_month,
          record_type: record.record_type,
          forecastPartsCount: record.snapshot_data?.forecastItems?.length || 0,
          allocationsCount: record.snapshot_data?.allocations?.length || 0,
          notes: record.notes
        },
        reason: 'Deleted by administrator from saved period archives'
      });
    }

    const nextList = savedRecords.filter(r => r.id !== recordId);
    setSavedRecords(nextList);
    dbStorage.deleteSavedRecord(recordId);

    try {
      localStorage.setItem('mdc_saved_records', JSON.stringify(nextList.slice(0, 50)));
    } catch (e) {
      console.warn('LocalStorage delete error:', e);
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase.from('saved_records').delete().eq('id', recordId);
        if (error) {
          await supabase.from('saved_records').update({ notes: '__DELETED__', snapshot_data: { isDeleted: true }, updated_at: new Date().toISOString() }).eq('id', recordId);
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('PERIOD_RECORD_DELETED', { recordId });
      } catch (dbErr) {
        console.error('Supabase delete saved_record error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) enqueueOfflineAction('SAVED_RECORD_DELETE', { id: recordId });
        if (broadcastCloudEvent) broadcastCloudEvent('PERIOD_RECORD_DELETED', { recordId });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('PERIOD_RECORD_DELETED', { recordId });
    }

    showToast(`Permanently deleted record "${record.period_label}" & logged to Audit Trail`, 'info');
    return { success: true };
  };

  const importStockTransfersReport = async (records, metadata) => {
    setStockTransferReports(records);
    setStockTransferMetadata(metadata);
    try {
      localStorage.setItem('mdc_stock_transfer_reports', JSON.stringify(records));
      localStorage.setItem('mdc_stock_transfer_metadata', JSON.stringify(metadata));
    } catch (e) {}
    await Promise.all([
      dbStorage.setItem('mdc_stock_transfer_reports', records),
      dbStorage.setItem('mdc_stock_transfer_metadata', metadata)
    ]);

    if (supabase) {
      try {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        await supabase.from('saved_records').upsert({
          id: 'master_stock_transfers_report_registry',
          record_type: 'stock_transfer_report',
          period_label: metadata?.fileName || 'Reports - Stock Transfers',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master Fixably stock transfer movement dataset',
          snapshot_data: {
            records,
            metadata
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      } catch (err) {
        console.warn('Sync stock transfers to Supabase error:', err);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_TRANSFERS_UPDATED', { count: records.length, metadata, table: 'saved_records' });
    }

    showToast(`Successfully imported ${records.length.toLocaleString()} stock transfer records`, 'success');
  };

  const clearStockTransfersReport = async () => {
    setStockTransferReports([]);
    setStockTransferMetadata(null);
    try {
      localStorage.removeItem('mdc_stock_transfer_reports');
      localStorage.removeItem('mdc_stock_transfer_metadata');
    } catch (e) {}
    await Promise.all([
      dbStorage.setItem('mdc_stock_transfer_reports', []),
      dbStorage.setItem('mdc_stock_transfer_metadata', null)
    ]);

    if (supabase) {
      try {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        await supabase.from('saved_records').upsert({
          id: 'master_stock_transfers_report_registry',
          record_type: 'stock_transfer_report',
          period_label: 'Cleared Stock Transfers',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: '__CLEARED__',
          snapshot_data: {
            records: [],
            metadata: null
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      } catch (err) {
        console.warn('Clear stock transfers from Supabase error:', err);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_TRANSFERS_CLEARED', { table: 'saved_records' });
    }

    showToast('Cleared stock transfer reports data', 'info');
  };

  return {
    savedRecords,
    setSavedRecords,
    stockTransferReports,
    setStockTransferReports,
    stockTransferMetadata,
    setStockTransferMetadata,
    savePeriodRecord,
    restorePeriodRecord,
    deletePeriodRecord,
    importStockTransfersReport,
    clearStockTransfersReport
  };
}
