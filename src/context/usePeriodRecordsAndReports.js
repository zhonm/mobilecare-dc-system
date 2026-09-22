import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';

export function usePeriodRecordsAndReports({
  currentUser: _currentUser,
  showToast,
  broadcastCloudEvent,
  setCloudSyncStatus
}) {
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

  // IndexedDB startup hydration for stock transfers
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [cachedReports, cachedMeta] = await Promise.all([
          dbStorage.getItem('mdc_stock_transfer_reports'),
          dbStorage.getItem('mdc_stock_transfer_metadata')
        ]);
        if (isMounted) {
          if (Array.isArray(cachedReports) && cachedReports.length > 0) {
            setStockTransferReports(prev => (prev && prev.length > 0 ? prev : cachedReports));
          }
          if (cachedMeta) {
            setStockTransferMetadata(prev => prev || cachedMeta);
          }
        }
      } catch (err) {
        console.warn('Error hydrating stock transfers from IndexedDB:', err);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  const importStockTransfersReport = async (records, metadata) => {
    const nowIso = new Date().toISOString();
    setStockTransferReports(records);
    setStockTransferMetadata(metadata);
    try {
      localStorage.setItem('mdc_stock_transfer_metadata', JSON.stringify(metadata));
      localStorage.setItem('mdc_stock_transfer_updated_at', nowIso);
      localStorage.setItem('mdc_stock_transfer_reports', JSON.stringify(records));
    } catch (e) {
      console.debug('LocalStorage quota note for stock transfers:', e);
    }
    await Promise.all([
      dbStorage.setItem('mdc_stock_transfer_reports', records),
      dbStorage.setItem('mdc_stock_transfer_metadata', metadata),
      dbStorage.setItem('mdc_stock_transfer_updated_at', nowIso)
    ]);

    if (supabase) {
      try {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        const { error } = await supabase.from('saved_records').upsert({
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
          updated_at: nowIso
        }, { onConflict: 'id' });
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      } catch (err) {
        console.warn('Sync stock transfers to Supabase error:', err);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_TRANSFERS_UPDATED', { count: records.length, metadata, updatedAt: nowIso, table: 'saved_records' });
    }

    showToast(`Successfully imported ${records.length.toLocaleString()} stock transfer records`, 'success');
  };

  const clearStockTransfersReport = async () => {
    const nowIso = new Date().toISOString();
    setStockTransferReports([]);
    setStockTransferMetadata(null);
    try {
      localStorage.removeItem('mdc_stock_transfer_reports');
      localStorage.removeItem('mdc_stock_transfer_metadata');
      localStorage.removeItem('mdc_stock_transfer_updated_at');
    } catch (e) {}
    await Promise.all([
      dbStorage.setItem('mdc_stock_transfer_reports', []),
      dbStorage.setItem('mdc_stock_transfer_metadata', null),
      dbStorage.setItem('mdc_stock_transfer_updated_at', nowIso)
    ]);

    if (supabase) {
      try {
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        const { error } = await supabase.from('saved_records').upsert({
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
          updated_at: nowIso
        }, { onConflict: 'id' });
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      } catch (err) {
        console.warn('Clear stock transfers from Supabase error:', err);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('STOCK_TRANSFERS_CLEARED', { updatedAt: nowIso, table: 'saved_records' });
    }

    showToast('Cleared stock transfer reports data', 'info');
  };

  return {
    stockTransferReports,
    setStockTransferReports,
    stockTransferMetadata,
    setStockTransferMetadata,
    importStockTransfersReport,
    clearStockTransfersReport
  };
}
