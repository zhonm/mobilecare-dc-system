import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import dbStorage from '../utils/dbStorage';
import { supabase } from '../supabase/client';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue';
import {
  parseGsxKbbKgbsUsedFile,
  reconcileSiteTransfers,
  isIPhone13AndUp
} from '../utils/siteTransfersReconciler';
import {
  parseStockTransfersReportFile,
  exportSiteTransfersFifoAuditToExcel
} from '../utils/excelParser';
import {
  FileSpreadsheet,
  UploadCloud,
  Download,
  Printer,
  FileText,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Building2,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Package,
  Boxes,
  Compass
} from 'lucide-react';

export default function SiteTransfersFifoReport() {
  const {
    parts,
    showToast,
    setCurrentPage: setAppPage,
    canEdit,
    broadcastCloudEvent
  } = useApp();

  // Dual file state
  const [transfersData, setTransfersData] = useState([]);
  const [transfersMeta, setTransfersMeta] = useState(null);
  const [gsxData, setGsxData] = useState([]);
  const [gsxMeta, setGsxMeta] = useState(null);

  const [isProcessingTransfers, setIsProcessingTransfers] = useState(false);
  const [isProcessingGsx, setIsProcessingGsx] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [lastCloudSyncTime, setLastCloudSyncTime] = useState(null);

  const transferInputRef = useRef(null);
  const gsxInputRef = useRef(null);
  const isSyncingRef = useRef(false);

  // Active view tab: scorecard | unused | fifo | ledger | discrepancies
  const [activeTab, setActiveTab] = useState('scorecard');

  // Filters
  const [selectedSite, setSelectedSite] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL'); // ALL | IN_STOCK | USED
  const [selectedFifo, setSelectedFifo] = useState('ALL');     // ALL | COMPLIANT | VIOLATION
  const [selectedCommodity, setSelectedCommodity] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Document Registry Constants (Prefixed with 'rec-' for RLS clearance and schema compatibility)
  const FIFO_TRANSFERS_DOC_ID = 'rec-fifo_site_transfers_registry';
  const FIFO_GSX_DOC_ID = 'rec-fifo_gsx_used_registry';

  // Compact payload sanitizer for Stock Transfers (reduces payload by 60%+ to save Supabase storage/egress)
  const sanitizeTransfersForCloud = useCallback((records) => {
    return (records || [])
      .map(r => ({
        transfer_received_date: r.transfer_received_date || '',
        from_stock: r.from_stock || '',
        to_stock: r.to_stock || '',
        product_code: r.product_code || '',
        product_name: r.product_name || r.part_description || '',
        serial_number: (r.serial_number || '').trim().toUpperCase(),
        transfer_quantity: Number(r.transfer_quantity) || 1,
        transfer_value: Number(r.transfer_value) || 0
      }))
      .filter(r => isIPhone13AndUp(r.product_name));
  }, []);

  // Compact payload sanitizer for GSX Used Report (keeps only serialized KGB repair fields)
  const sanitizeGsxForCloud = useCallback((records) => {
    return (records || [])
      .filter(r => Boolean(r.product_kgb) && String(r.product_kgb).trim().toUpperCase() !== 'N/A')
      .map(r => ({
        order_id: String(r.order_id || '').trim(),
        location_name: String(r.location_name || '').trim(),
        repair_closed_date: String(r.repair_closed_date || '').trim(),
        product_code: String(r.product_code || '').trim(),
        product_description: String(r.product_description || '').trim(),
        product_kgb: String(r.product_kgb || '').trim().toUpperCase()
      }));
  }, []);

  // Upload Stock Transfers to Supabase saved_records registry
  const uploadTransfersToCloud = useCallback(async (records, metadata) => {
    if (!supabase) return;
    const now = new Date();
    const nowIso = now.toISOString();
    const cleanRecords = sanitizeTransfersForCloud(records);
    try {
      await queuedSavedRecordsUpsert({
        id: FIFO_TRANSFERS_DOC_ID,
        record_type: 'stock_transfer_report',
        period_label: metadata?.fileName || 'Fixably Stock Transfers',
        period_year: now.getFullYear(),
        period_month: now.getMonth() + 1,
        notes: 'Master site transfers for FIFO audit (iPhone 13 & up)',
        snapshot_data: {
          records: cleanRecords,
          metadata: {
            ...metadata,
            totalRows: cleanRecords.length,
            syncedAt: nowIso
          }
        },
        updated_at: nowIso
      }, { immediate: true });
      await dbStorage.setItem('mdc_fifo_transfers_updated_at', nowIso);
      try { localStorage.setItem('mdc_fifo_transfers_updated_at', nowIso); } catch (_) {}
      if (broadcastCloudEvent) {
        broadcastCloudEvent('FIFO_AUDIT_UPDATED', { subType: 'transfers', updatedAt: nowIso, count: cleanRecords.length });
        broadcastCloudEvent('MASTER_DATA_UPDATED', { subType: 'transfers', updatedAt: nowIso });
      }
      try {
        const bc = new BroadcastChannel('mdc_fifo_audit_sync');
        bc.postMessage({ type: 'FIFO_AUDIT_UPDATED', subType: 'transfers', updatedAt: nowIso });
        bc.close();
      } catch (_) {}
    } catch (err) {
      console.warn('[FIFO Audit Sync] Error syncing transfers to Supabase:', err.message);
    }
  }, [broadcastCloudEvent, sanitizeTransfersForCloud]);

  // Upload GSX Used Report to Supabase saved_records registry
  const uploadGsxToCloud = useCallback(async (records, metadata) => {
    if (!supabase) return;
    const now = new Date();
    const nowIso = now.toISOString();
    const cleanRecords = sanitizeGsxForCloud(records);
    try {
      await queuedSavedRecordsUpsert({
        id: FIFO_GSX_DOC_ID,
        record_type: 'stock_transfer_report',
        period_label: metadata?.fileName || 'GSX KBB/KGBs Used Report',
        period_year: now.getFullYear(),
        period_month: now.getMonth() + 1,
        notes: 'GSX used KGB parts for FIFO audit',
        snapshot_data: {
          records: cleanRecords,
          metadata: {
            ...metadata,
            totalRows: cleanRecords.length,
            syncedAt: nowIso
          }
        },
        updated_at: nowIso
      }, { immediate: true });
      await dbStorage.setItem('mdc_fifo_gsx_updated_at', nowIso);
      try { localStorage.setItem('mdc_fifo_gsx_updated_at', nowIso); } catch (_) {}
      if (broadcastCloudEvent) {
        broadcastCloudEvent('FIFO_AUDIT_UPDATED', { subType: 'gsx', updatedAt: nowIso, count: cleanRecords.length });
        broadcastCloudEvent('MASTER_DATA_UPDATED', { subType: 'gsx', updatedAt: nowIso });
      }
      try {
        const bc = new BroadcastChannel('mdc_fifo_audit_sync');
        bc.postMessage({ type: 'FIFO_AUDIT_UPDATED', subType: 'gsx', updatedAt: nowIso });
        bc.close();
      } catch (_) {}
    } catch (err) {
      console.warn('[FIFO Audit Sync] Error syncing GSX to Supabase:', err.message);
    }
  }, [broadcastCloudEvent, sanitizeGsxForCloud]);

  // Clear cloud audit registry on Supabase
  const clearCloudAudit = useCallback(async () => {
    if (!supabase) return;
    const now = new Date();
    const nowIso = now.toISOString();
    try {
      await Promise.all([
        queuedSavedRecordsUpsert({
          id: FIFO_TRANSFERS_DOC_ID,
          record_type: 'stock_transfer_report',
          period_label: 'Fixably Stock Transfers',
          period_year: now.getFullYear(),
          period_month: now.getMonth() + 1,
          notes: '__CLEARED__',
          snapshot_data: { records: [], metadata: null },
          updated_at: nowIso
        }, { immediate: true }),
        queuedSavedRecordsUpsert({
          id: FIFO_GSX_DOC_ID,
          record_type: 'stock_transfer_report',
          period_label: 'GSX KBB/KGBs Used Report',
          period_year: now.getFullYear(),
          period_month: now.getMonth() + 1,
          notes: '__CLEARED__',
          snapshot_data: { records: [], metadata: null },
          updated_at: nowIso
        }, { immediate: true })
      ]);
      await Promise.all([
        dbStorage.setItem('mdc_fifo_transfers_updated_at', nowIso),
        dbStorage.setItem('mdc_fifo_gsx_updated_at', nowIso)
      ]);
      try {
        localStorage.setItem('mdc_fifo_transfers_updated_at', nowIso);
        localStorage.setItem('mdc_fifo_gsx_updated_at', nowIso);
      } catch (_) {}
      if (broadcastCloudEvent) {
        broadcastCloudEvent('FIFO_AUDIT_CLEARED', { updatedAt: nowIso });
        broadcastCloudEvent('MASTER_DATA_CLEARED', { subType: 'fifo_audit', updatedAt: nowIso });
      }
      try {
        const bc = new BroadcastChannel('mdc_fifo_audit_sync');
        bc.postMessage({ type: 'FIFO_AUDIT_CLEARED', updatedAt: nowIso });
        bc.close();
      } catch (_) {}
    } catch (err) {
      console.warn('[FIFO Audit Sync] Error clearing cloud audit:', err.message);
    }
  }, [broadcastCloudEvent]);

  // Zero-Egress Cloud Synchronization:
  // Checks only tiny headers (~150 bytes total) first. Only downloads full payload if remote updated_at is newer or local data is missing.
  const syncFromCloud = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!supabase || isSyncingRef.current) return;
    isSyncingRef.current = true;
    if (!silent) setIsCloudSyncing(true);

    try {
      // 1. Egress Defense: Query only lightweight headers (~150 bytes egress)
      const { data: headers, error: headErr } = await supabase
        .from('saved_records')
        .select('id, notes, updated_at, period_label')
        .in('id', [FIFO_TRANSFERS_DOC_ID, FIFO_GSX_DOC_ID]);

      if (headErr) {
        console.warn('[FIFO Audit Sync] Header query notice:', headErr.message);
        return;
      }

      const trfHeader = headers?.find(h => h.id === FIFO_TRANSFERS_DOC_ID);
      const gsxHeader = headers?.find(h => h.id === FIFO_GSX_DOC_ID);

      const [localTrfUpdated, localGsxUpdated, localTrfCached, localGsxCached, localCleared] = await Promise.all([
        dbStorage.getItem('mdc_fifo_transfers_updated_at'),
        dbStorage.getItem('mdc_fifo_gsx_updated_at'),
        dbStorage.getItem('mdc_site_transfers_records'),
        dbStorage.getItem('mdc_gsx_used_records'),
        dbStorage.getItem('mdc_site_transfers_cleared')
      ]);

      const hasLocalTrf = Array.isArray(localTrfCached) && localTrfCached.length > 0;
      const hasLocalGsx = Array.isArray(localGsxCached) && localGsxCached.length > 0;

      const isTrfCleared = trfHeader?.notes === '__CLEARED__';
      const isGsxCleared = gsxHeader?.notes === '__CLEARED__';

      // Handle cleared status from cloud
      if (isTrfCleared && trfHeader.updated_at !== localTrfUpdated) {
        setTransfersData([]);
        setTransfersMeta(null);
        await Promise.all([
          dbStorage.removeItem('mdc_site_transfers_records'),
          dbStorage.removeItem('mdc_site_transfers_meta'),
          dbStorage.setItem('mdc_fifo_transfers_updated_at', trfHeader.updated_at || ''),
          dbStorage.setItem('mdc_site_transfers_cleared', true)
        ]);
      }

      if (isGsxCleared && gsxHeader.updated_at !== localGsxUpdated) {
        setGsxData([]);
        setGsxMeta(null);
        await Promise.all([
          dbStorage.removeItem('mdc_gsx_used_records'),
          dbStorage.removeItem('mdc_gsx_used_meta'),
          dbStorage.setItem('mdc_fifo_gsx_updated_at', gsxHeader.updated_at || '')
        ]);
      }

      // Determine what actually needs downloading
      const needTrf = !isTrfCleared && trfHeader && (
        force ||
        !hasLocalTrf ||
        trfHeader.updated_at !== localTrfUpdated
      );

      const needGsx = !isGsxCleared && gsxHeader && (
        force ||
        !hasLocalGsx ||
        gsxHeader.updated_at !== localGsxUpdated
      );

      // If neither is needed, EGRESS = 0 bytes!
      if (!needTrf && !needGsx) {
        // Auto-seed: If local has files on this device, but remote is missing or older, seed to cloud
        if ((!trfHeader || trfHeader.notes === '__CLEARED__') && hasLocalTrf && !localCleared) {
          const meta = await dbStorage.getItem('mdc_site_transfers_meta');
          await uploadTransfersToCloud(localTrfCached, meta);
        }
        if ((!gsxHeader || gsxHeader.notes === '__CLEARED__') && hasLocalGsx && !localCleared) {
          const meta = await dbStorage.getItem('mdc_gsx_used_meta');
          await uploadGsxToCloud(localGsxCached, meta);
        }
        setLastCloudSyncTime(new Date());
        return;
      }

      const docIdsToFetch = [];
      if (needTrf) docIdsToFetch.push(FIFO_TRANSFERS_DOC_ID);
      if (needGsx) docIdsToFetch.push(FIFO_GSX_DOC_ID);

      if (docIdsToFetch.length > 0) {
        const { data: fullDocs, error: docErr } = await supabase
          .from('saved_records')
          .select('id, snapshot_data, notes, updated_at')
          .in('id', docIdsToFetch);

        if (docErr) throw docErr;

        for (const doc of (fullDocs || [])) {
          if (doc.id === FIFO_TRANSFERS_DOC_ID && doc.snapshot_data) {
            const recs = Array.isArray(doc.snapshot_data.records) ? doc.snapshot_data.records : [];
            const meta = doc.snapshot_data.metadata || null;
            setTransfersData(recs);
            setTransfersMeta(meta);
            await Promise.all([
              dbStorage.setItem('mdc_site_transfers_records', recs),
              dbStorage.setItem('mdc_site_transfers_meta', meta),
              dbStorage.setItem('mdc_fifo_transfers_updated_at', doc.updated_at || ''),
              dbStorage.removeItem('mdc_site_transfers_cleared')
            ]);
          } else if (doc.id === FIFO_GSX_DOC_ID && doc.snapshot_data) {
            const recs = Array.isArray(doc.snapshot_data.records) ? doc.snapshot_data.records : [];
            const meta = doc.snapshot_data.metadata || null;
            setGsxData(recs);
            setGsxMeta(meta);
            await Promise.all([
              dbStorage.setItem('mdc_gsx_used_records', recs),
              dbStorage.setItem('mdc_gsx_used_meta', meta),
              dbStorage.setItem('mdc_fifo_gsx_updated_at', doc.updated_at || ''),
              dbStorage.removeItem('mdc_site_transfers_cleared')
            ]);
          }
        }
      }

      setLastCloudSyncTime(new Date());
    } catch (err) {
      console.warn('[FIFO Audit Sync] Sync error:', err.message);
    } finally {
      isSyncingRef.current = false;
      setIsCloudSyncing(false);
    }
  }, [uploadTransfersToCloud, uploadGsxToCloud]);

  // Initial Load: IndexedDB local cache first (0ms instant render), then lightweight cloud sync check
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [cachedGsx, cachedGsxMeta, cachedTrf, cachedTrfMeta, wasCleared] = await Promise.all([
          dbStorage.getItem('mdc_gsx_used_records'),
          dbStorage.getItem('mdc_gsx_used_meta'),
          dbStorage.getItem('mdc_site_transfers_records'),
          dbStorage.getItem('mdc_site_transfers_meta'),
          dbStorage.getItem('mdc_site_transfers_cleared')
        ]);
        if (isMounted && !wasCleared) {
          if (Array.isArray(cachedGsx) && cachedGsx.length > 0) {
            setGsxData(cachedGsx);
            setGsxMeta(cachedGsxMeta || null);
          }
          if (Array.isArray(cachedTrf) && cachedTrf.length > 0) {
            setTransfersData(cachedTrf);
            setTransfersMeta(cachedTrfMeta || null);
          }
        }
      } catch (e) {
        console.warn('Could not load cached reconciliation datasets', e);
      }
      // Follow-up with cloud sync check (checks headers, downloads if newer or missing on this device)
      if (isMounted) {
        syncFromCloud({ force: false, silent: true });
      }
    })();

    // Realtime WebSocket & Cross-Tab Listeners
    let realtimeChannel = null;
    if (supabase) {
      realtimeChannel = supabase.channel('mdc_fifo_audit_realtime_room')
        .on('broadcast', { event: 'mdc_sync' }, (payload) => {
          const p = payload?.payload;
          if (p && (p.type === 'FIFO_AUDIT_UPDATED' || p.type === 'FIFO_AUDIT_CLEARED' || p.type === 'MASTER_DATA_UPDATED')) {
            syncFromCloud({ force: false, silent: true });
          }
        })
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'saved_records',
          filter: `id=eq.${FIFO_TRANSFERS_DOC_ID}`
        }, () => {
          syncFromCloud({ force: false, silent: true });
        })
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'saved_records',
          filter: `id=eq.${FIFO_GSX_DOC_ID}`
        }, () => {
          syncFromCloud({ force: false, silent: true });
        })
        .subscribe();
    }

    let bc = null;
    try {
      bc = new BroadcastChannel('mdc_fifo_audit_sync');
      bc.onmessage = () => {
        syncFromCloud({ force: false, silent: true });
      };
    } catch (_) {}

    return () => {
      isMounted = false;
      if (realtimeChannel && supabase) {
        supabase.removeChannel(realtimeChannel);
      }
      if (bc) bc.close();
    };
  }, [syncFromCloud]);

  // Handle Transfers file upload
  const handleTransfersUpload = async (file) => {
    if (!file) return;
    setIsProcessingTransfers(true);
    try {
      const res = await parseStockTransfersReportFile(file);
      if (res.success) {
        const cleanRecords = sanitizeTransfersForCloud(res.records);
        const meta = {
          ...res.metadata,
          totalRows: cleanRecords.length
        };
        setTransfersData(cleanRecords);
        setTransfersMeta(meta);
        await Promise.all([
          dbStorage.setItem('mdc_site_transfers_records', cleanRecords),
          dbStorage.setItem('mdc_site_transfers_meta', meta),
          dbStorage.removeItem('mdc_site_transfers_cleared')
        ]);
        // Push to Supabase and broadcast to all users
        await uploadTransfersToCloud(cleanRecords, meta);
        showToast(`Loaded and cloud-synced ${cleanRecords.length.toLocaleString()} stock transfer records`, 'success');
        setCurrentPage(1);
      } else {
        showToast(res.error || 'Failed to parse Stock Transfers file', 'error');
      }
    } catch (err) {
      showToast(`Error processing Transfers file: ${err.message}`, 'error');
    } finally {
      setIsProcessingTransfers(false);
      if (transferInputRef.current) transferInputRef.current.value = '';
    }
  };

  // Handle GSX KBB/KGBs Used report upload
  const handleGsxUpload = async (file) => {
    if (!file) return;
    setIsProcessingGsx(true);
    try {
      const res = await parseGsxKbbKgbsUsedFile(file);
      if (res.success) {
        const cleanRecords = sanitizeGsxForCloud(res.records);
        const meta = {
          ...res.metadata,
          totalRows: cleanRecords.length
        };
        setGsxData(cleanRecords);
        setGsxMeta(meta);
        await Promise.all([
          dbStorage.setItem('mdc_gsx_used_records', cleanRecords),
          dbStorage.setItem('mdc_gsx_used_meta', meta),
          dbStorage.removeItem('mdc_site_transfers_cleared')
        ]);
        // Push to Supabase and broadcast to all users
        await uploadGsxToCloud(cleanRecords, meta);
        showToast(`Loaded and cloud-synced ${cleanRecords.length.toLocaleString()} GSX used part records`, 'success');
        setCurrentPage(1);
      } else {
        showToast(res.error || 'Failed to parse GSX report', 'error');
      }
    } catch (err) {
      showToast(`Error processing GSX file: ${err.message}`, 'error');
    } finally {
      setIsProcessingGsx(false);
      if (gsxInputRef.current) gsxInputRef.current.value = '';
    }
  };

  // Clear datasets
  const handleClearAll = async () => {
    if (!window.confirm('Clear uploaded Stock Transfer and GSX reports from this audit workspace? Both reports will be removed across all connected accounts and devices.')) return;
    setTransfersData([]);
    setTransfersMeta(null);
    setGsxData([]);
    setGsxMeta(null);
    setSelectedSite('ALL');
    setSelectedStatus('ALL');
    setSelectedFifo('ALL');
    setSelectedCommodity('ALL');
    setSearchQuery('');
    setCurrentPage(1);
    if (transferInputRef.current) transferInputRef.current.value = '';
    if (gsxInputRef.current) gsxInputRef.current.value = '';

    const nowIso = new Date().toISOString();
    await Promise.all([
      dbStorage.removeItem('mdc_site_transfers_records'),
      dbStorage.removeItem('mdc_site_transfers_meta'),
      dbStorage.removeItem('mdc_gsx_used_records'),
      dbStorage.removeItem('mdc_gsx_used_meta'),
      dbStorage.setItem('mdc_site_transfers_cleared', true),
      dbStorage.setItem('mdc_fifo_transfers_updated_at', nowIso),
      dbStorage.setItem('mdc_fifo_gsx_updated_at', nowIso)
    ]);
    try {
      localStorage.removeItem('mdc_site_transfers_records');
      localStorage.removeItem('mdc_site_transfers_meta');
      localStorage.removeItem('mdc_gsx_used_records');
      localStorage.removeItem('mdc_gsx_used_meta');
      localStorage.setItem('mdc_site_transfers_cleared', 'true');
      localStorage.setItem('mdc_fifo_transfers_updated_at', nowIso);
      localStorage.setItem('mdc_fifo_gsx_updated_at', nowIso);
    } catch (_) {}

    // Cloud sync the clear action to all devices
    await clearCloudAudit();

    showToast('Audit workspace and cloud cache cleared across all accounts.', 'info');
  };

  // Master reconciliation memo
  const reconciliation = useMemo(() => {
    return reconcileSiteTransfers(transfersData, gsxData, parts);
  }, [transfersData, gsxData, parts]);

  const { records, sitesScorecard, kpis, orphanGsxRecords } = reconciliation;

  // Filtered dataset
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (selectedSite !== 'ALL' && r.current_site.code !== selectedSite) {
        return false;
      }
      if (selectedStatus === 'IN_STOCK' && r.is_used) return false;
      if (selectedStatus === 'USED' && !r.is_used) return false;

      if (selectedFifo === 'COMPLIANT' && r.fifo_status !== 'FIFO_COMPLIANT') return false;
      if (selectedFifo === 'VIOLATION' && !r.fifo_status.includes('VIOLATION')) return false;

      if (selectedCommodity !== 'ALL') {
        const desc = (r.product_name || '').toLowerCase();
        if (selectedCommodity === 'DISPLAY' && !desc.includes('display') && !desc.includes('screen')) return false;
        if (selectedCommodity === 'BATTERY' && !desc.includes('battery')) return false;
        if (selectedCommodity === 'CAMERA' && !desc.includes('camera')) return false;
        if (selectedCommodity === 'BACK_GLASS' && !desc.includes('back glass') && !desc.includes('rear system')) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hit = [
          r.serial_number,
          r.product_code,
          r.product_name,
          r.current_site.name,
          r.current_site.code,
          r.from_stock,
          r.gsx_order_id,
          r.gsx_repair_number,
          r.gsx_location_name
        ].some(v => String(v || '').toLowerCase().includes(q));
        if (!hit) return false;
      }

      return true;
    });
  }, [records, selectedSite, selectedStatus, selectedFifo, selectedCommodity, searchQuery]);

  // Tab-specific filtered lists
  const unusedRecords = useMemo(() => {
    return filteredRecords.filter(r => !r.is_used);
  }, [filteredRecords]);

  const fifoViolations = useMemo(() => {
    return filteredRecords.filter(r => r.fifo_status.includes('VIOLATION'));
  }, [filteredRecords]);

  const discrepancies = useMemo(() => {
    return filteredRecords.filter(r => r.is_cross_site_discrepancy);
  }, [filteredRecords]);

  // Pagination calculation
  const targetList = useMemo(() => {
    if (activeTab === 'unused') return unusedRecords;
    if (activeTab === 'fifo') return fifoViolations;
    if (activeTab === 'discrepancies') return discrepancies;
    return filteredRecords;
  }, [activeTab, unusedRecords, fifoViolations, discrepancies, filteredRecords]);

  const totalPages = Math.ceil(targetList.length / pageSize) || 1;
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return targetList.slice(start, start + pageSize);
  }, [targetList, currentPage, pageSize]);

  // Excel Export
  const handleExportExcel = async () => {
    try {
      await exportSiteTransfersFifoAuditToExcel({
        records,
        sitesScorecard,
        kpis,
        orphanGsxRecords,
        fileName: 'MDC_MultiSite_Stock_Transfers_FIFO_Audit'
      });
      showToast('Exported multi-sheet FIFO Audit package', 'success');
    } catch (e) {
      showToast(`Export failed: ${e.message}`, 'error');
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: '1600px', margin: '0 auto', paddingBottom: '60px' }}>

      {/* ── Top Header Banner ──────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '20px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '20px 24px',
        borderRadius: '12px',
        color: '#fff',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            width: '46px',
            height: '46px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)'
          }}>
            <Boxes size={24} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                Multi-Site Stock Transfers & FIFO Compliance Audit
              </h2>
              <span style={{
                background: '#0284c726',
                color: '#38bdf8',
                border: '1px solid #0284c74d',
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700
              }}>
                iPhone 13 & Up • All Sites & DC
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Reconciles Fixably stock movements with Apple GSX repair consumption to verify FIFO adherence and pinpoint idle stock (iPhone 13 & newer).
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              showToast('Checking cloud sync with Supabase...', 'info');
              await syncFromCloud({ force: true });
              showToast('Cloud data up to date', 'success');
            }}
            disabled={isCloudSyncing}
            title="Realtime Cloud Sync across all accounts & devices (Zero-egress protected)"
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#38bdf8',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <RefreshCw size={13} style={{ animation: isCloudSyncing ? 'spin 1s linear infinite' : 'none' }} />
            <span>{isCloudSyncing ? 'Syncing Cloud...' : 'Cloud Synced'}</span>
            {lastCloudSyncTime && (
              <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '2px' }}>
                ({new Date(lastCloudSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
              </span>
            )}
          </button>

          {records.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleExportExcel}
                style={{
                  background: '#15803d',
                  borderColor: '#166534',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Download size={14} />
                <span>Export Multi-Sheet Excel</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => window.print()}
                style={{
                  background: '#334155',
                  borderColor: '#475569',
                  color: '#f1f5f9',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Printer size={14} />
                <span>Print Report</span>
              </button>
            </>
          )}

          {canEdit && (transfersData.length > 0 || gsxData.length > 0 || transfersMeta || gsxMeta) && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleClearAll}
              style={{
                background: '#991b1b',
                borderColor: '#7f1d1d',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <RefreshCw size={13} />
              <span>Clear Audit</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Dual Upload Cards ──────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '16px', marginBottom: '20px' }}>

        {/* Card 1: Fixably Stock Transfers Report */}
        <div className="card" style={{
          padding: '18px 20px',
          border: '1.5px dashed',
          borderColor: transfersMeta ? '#10b981' : '#cbd5e1',
          background: transfersMeta ? '#f0fdf4' : '#fff',
          borderRadius: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                background: transfersMeta ? '#dcfce7' : '#f1f5f9',
                color: transfersMeta ? '#15803d' : '#0284c7',
                padding: '8px',
                borderRadius: '8px'
              }}>
                <FileSpreadsheet size={20} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                  1. Stock Transfer Report
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  Fixably export (iPhone 13 & newer models)
                </div>
              </div>
            </div>
            {transfersMeta && (
              <span className="badge badge-success" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={12} /> Ready
              </span>
            )}
          </div>

          {transfersMeta ? (
            <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 12px', border: '1px solid #bbf7d0', fontSize: '12px' }}>
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {transfersMeta.fileName}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '11.5px' }}>
                <span>
                  <strong>{reconciliation.kpis.totalTransfers.toLocaleString()}</strong> iPhone 13+ records
                  {transfersData.length > reconciliation.kpis.totalTransfers && (
                    <span style={{ color: '#94a3b8', marginLeft: '4px' }}>
                      ({(transfersData.length - reconciliation.kpis.totalTransfers).toLocaleString()} older models excluded)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => transferInputRef.current?.click()}
                  style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', fontWeight: 700 }}
                >
                  Replace File
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => transferInputRef.current?.click()}
              style={{
                cursor: 'pointer',
                textAlign: 'center',
                padding: '16px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                transition: 'all 0.2s'
              }}
            >
              <UploadCloud size={24} color="#0284c7" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                {isProcessingTransfers ? 'Processing Transfers...' : 'Upload Stock Transfer Report (.xlsx or .csv)'}
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                Click to browse or drag and drop Fixably export (iPhone 13 & up)
              </div>
            </div>
          )}
          <input
            ref={transferInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTransfersUpload(f); }}
          />
        </div>

        {/* Card 2: GSX KBB / KGBs Used Report */}
        <div className="card" style={{
          padding: '18px 20px',
          border: '1.5px dashed',
          borderColor: gsxMeta ? '#10b981' : '#cbd5e1',
          background: gsxMeta ? '#f0fdf4' : '#fff',
          borderRadius: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                background: gsxMeta ? '#dcfce7' : '#f1f5f9',
                color: gsxMeta ? '#15803d' : '#7c3aed',
                padding: '8px',
                borderRadius: '8px'
              }}>
                <FileText size={20} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                  2. GSX KBB/KGBs Used Report
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  Apple GSX custom report containing used KGB serials
                </div>
              </div>
            </div>
            {gsxMeta && (
              <span className="badge badge-success" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={12} /> Ready
              </span>
            )}
          </div>

          {gsxMeta ? (
            <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 12px', border: '1px solid #bbf7d0', fontSize: '12px' }}>
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {gsxMeta.fileName}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '11.5px' }}>
                <span><strong>{gsxData.length.toLocaleString()}</strong> GSX repair rows loaded</span>
                <button
                  type="button"
                  onClick={() => gsxInputRef.current?.click()}
                  style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontWeight: 700 }}
                >
                  Replace File
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => gsxInputRef.current?.click()}
              style={{
                cursor: 'pointer',
                textAlign: 'center',
                padding: '16px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                transition: 'all 0.2s'
              }}
            >
              <UploadCloud size={24} color="#7c3aed" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                {isProcessingGsx ? 'Processing GSX Report...' : 'Upload GSX KBB/KGBs Used Report (.xlsx or .csv)'}
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                Click to browse or drag and drop GSX custom export
              </div>
            </div>
          )}
          <input
            ref={gsxInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGsxUpload(f); }}
          />
        </div>
      </div>

      {/* ── KPI Metric Cards ──────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '14px',
        marginBottom: '20px'
      }}>
        {/* Total Serials */}
        <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#0284c71a', color: '#0284c7', padding: '12px', borderRadius: '10px' }}>
            <Package size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Serials Monitored
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
              {kpis.totalSerials.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              From {kpis.totalTransfers.toLocaleString()} site transfers
            </div>
          </div>
        </div>

        {/* Used in Repairs */}
        <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#15803d1a', color: '#15803d', padding: '12px', borderRadius: '10px' }}>
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Used in Repairs
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d' }}>
              {kpis.usedCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
              {kpis.usedRate}% of all parts consumed
            </div>
          </div>
        </div>

        {/* In Stock (Unused) */}
        <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#d977061a', color: '#d97706', padding: '12px', borderRadius: '10px' }}>
            <Boxes size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              In Stock Across Sites
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#d97706' }}>
              {kpis.inStockCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Est. value: <strong>${kpis.inStockValue.toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* FIFO Compliance Rate */}
        <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: kpis.fifoComplianceRate >= 90 ? '#16a34a1a' : '#dc26261a',
            color: kpis.fifoComplianceRate >= 90 ? '#16a34a' : '#dc2626',
            padding: '12px',
            borderRadius: '10px'
          }}>
            {kpis.fifoComplianceRate >= 90 ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              FIFO Compliance
            </div>
            <div style={{
              fontSize: '22px',
              fontWeight: 800,
              color: kpis.fifoComplianceRate >= 90 ? '#16a34a' : '#dc2626'
            }}>
              {kpis.fifoComplianceRate}%
            </div>
            <div style={{ fontSize: '11px', color: kpis.fifoViolationsCount > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
              {kpis.fifoViolationsCount} out-of-order violations
            </div>
          </div>
        </div>

        {/* Cross-Site Leakage / Discrepancies */}
        <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#7c3aed1a', color: '#7c3aed', padding: '12px', borderRadius: '10px' }}>
            <Activity size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Cross-Site Usage
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#7c3aed' }}>
              {kpis.crossSiteDiscrepanciesCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Used at branch != transfer target
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab Navigation & Action Bar ───────────────────────────────────── */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '3px', border: '1px solid #e2e8f0', gap: '2px', flexWrap: 'wrap' }}>
            {[
              { id: 'scorecard', label: 'Branch FIFO Scorecard', icon: Building2, count: sitesScorecard.length },
              { id: 'unused', label: 'Unused Stocks (In-Stock)', icon: Boxes, count: kpis.inStockCount, color: '#d97706' },
              { id: 'fifo', label: 'FIFO Violations Audit', icon: AlertTriangle, count: kpis.fifoViolationsCount, color: '#dc2626' },
              { id: 'ledger', label: 'Reconciliation Ledger', icon: FileText, count: kpis.totalSerials },
              { id: 'discrepancies', label: 'Cross-Site Discrepancies', icon: Activity, count: kpis.crossSiteDiscrepanciesCount, color: '#7c3aed' }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setActiveTab(tab.id); setCurrentPage(1); }}
                  style={{
                    border: 'none',
                    fontSize: '12px',
                    padding: '6px 14px',
                    fontWeight: isActive ? 700 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: '6px'
                  }}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span style={{
                      background: isActive ? '#fff' : (tab.color || '#64748b'),
                      color: isActive ? '#0284c7' : '#fff',
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '999px',
                      fontWeight: 700,
                      marginLeft: '2px'
                    }}>
                      {tab.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick Search */}
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search serial, part, site, order..."
              className="form-control form-control-sm"
              style={{ paddingLeft: '32px', fontSize: '12px', height: '34px', borderRadius: '6px' }}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Secondary Filter Row (Only shown for table views) */}
        {activeTab !== 'scorecard' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            paddingTop: '12px',
            marginTop: '12px',
            borderTop: '1px solid #f1f5f9',
            fontSize: '12px'
          }}>
            {/* Branch Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Branch:</span>
              <select
                className="form-select form-select-sm"
                value={selectedSite}
                onChange={(e) => { setSelectedSite(e.target.value); setCurrentPage(1); }}
                style={{ fontSize: '12px', height: '30px', borderRadius: '6px', maxWidth: '200px' }}
              >
                <option value="ALL">All Branches ({sitesScorecard.length})</option>
                {sitesScorecard.map(s => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.shortName} ({s.totalReceived})
                  </option>
                ))}
              </select>
            </div>

            {/* Status Selector */}
            {activeTab === 'ledger' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Status:</span>
                <select
                  className="form-select form-select-sm"
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
                  style={{ fontSize: '12px', height: '30px', borderRadius: '6px' }}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="IN_STOCK">In Stock (Unused)</option>
                  <option value="USED">Used in GSX Repair</option>
                </select>
              </div>
            )}

            {/* FIFO Filter */}
            {activeTab === 'ledger' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>FIFO:</span>
                <select
                  className="form-select form-select-sm"
                  value={selectedFifo}
                  onChange={(e) => { setSelectedFifo(e.target.value); setCurrentPage(1); }}
                  style={{ fontSize: '12px', height: '30px', borderRadius: '6px' }}
                >
                  <option value="ALL">All FIFO States</option>
                  <option value="COMPLIANT">FIFO Compliant Only</option>
                  <option value="VIOLATION">FIFO Violations Only</option>
                </select>
              </div>
            )}

            {/* Commodity Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Commodity:</span>
              <select
                className="form-select form-select-sm"
                value={selectedCommodity}
                onChange={(e) => { setSelectedCommodity(e.target.value); setCurrentPage(1); }}
                style={{ fontSize: '12px', height: '30px', borderRadius: '6px' }}
              >
                <option value="ALL">All Commodities</option>
                <option value="DISPLAY">Display / Screen</option>
                <option value="BATTERY">Battery</option>
                <option value="CAMERA">Camera</option>
                <option value="BACK_GLASS">Back Glass / Rear System</option>
              </select>
            </div>

            {/* Clear Filters Button */}
            {(selectedSite !== 'ALL' || selectedStatus !== 'ALL' || selectedFifo !== 'ALL' || selectedCommodity !== 'ALL' || searchQuery) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedSite('ALL');
                  setSelectedStatus('ALL');
                  setSelectedFifo('ALL');
                  setSelectedCommodity('ALL');
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                style={{ fontSize: '11px', padding: '3px 10px', height: '30px', color: '#dc2626', borderColor: '#fca5a5' }}
              >
                Reset Filters
              </button>
            )}

            <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '11.5px' }}>
              Showing <strong>{targetList.length.toLocaleString()}</strong> of {records.length.toLocaleString()} items
            </span>
          </div>
        )}
      </div>

      {/* ── TAB 1: Branch FIFO Scorecard Matrix ────────────────────────────── */}
      {activeTab === 'scorecard' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                Branch Performance Matrix & FIFO Scorecards
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Summary of stock consumption, idle parts, and FIFO adherence across all {sitesScorecard.length} branches. Click any branch to inspect.
              </p>
            </div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Sorted by Total Parts Received
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12.5px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569' }}>Branch</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Total Received</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Used in Repairs</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>In Stock (Unused)</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>In-Stock Value</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>FIFO Compliant</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>FIFO Violations</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Compliance %</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Cross-Site Used</th>
                  <th style={{ padding: '10px 14px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sitesScorecard.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No transfer data loaded yet. Please upload both the Stock Transfer Report and GSX Used Report above.
                    </td>
                  </tr>
                ) : (
                  sitesScorecard.map((site) => {
                    const isHighRisk = site.complianceRate < 75;
                    const isModerateRisk = site.complianceRate >= 75 && site.complianceRate < 90;

                    return (
                      <tr key={site.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                              fontWeight: 800,
                              fontFamily: 'Consolas, monospace',
                              background: '#f1f5f9',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11.5px',
                              color: '#0f172a'
                            }}>
                              {site.code}
                            </span>
                            <div>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>{site.shortName}</div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{site.name}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 700 }}>
                          {site.totalReceived.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>
                          {site.usedCount.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: '#d97706', fontWeight: 700 }}>
                          {site.inStockCount.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600 }}>
                          ${site.inStockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>
                          {site.fifoCompliantCount.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          {site.fifoViolationsCount > 0 ? (
                            <span style={{
                              background: '#fee2e2',
                              color: '#dc2626',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '11.5px',
                              fontWeight: 700
                            }}>
                              {site.fifoViolationsCount}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>0</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '3px 9px',
                            borderRadius: '999px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            background: isHighRisk ? '#fee2e2' : isModerateRisk ? '#fef3c7' : '#dcfce7',
                            color: isHighRisk ? '#dc2626' : isModerateRisk ? '#b45309' : '#15803d'
                          }}>
                            {site.complianceRate}%
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', color: site.crossSiteCount > 0 ? '#7c3aed' : '#94a3b8', fontWeight: 600 }}>
                          {site.crossSiteCount}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setSelectedSite(site.code);
                              setActiveTab('ledger');
                              setCurrentPage(1);
                            }}
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 2: Unused Stocks (In-Stock Site by Site) ───────────────────── */}
      {activeTab === 'unused' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                Unused Stocks & Idle Parts Monitoring
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Transferred parts that have not been recorded as consumed in GSX repairs. Parallels the Google Sheet <em>“UNUSED SERIAL OF SITE TO SITE T”</em>.
              </p>
            </div>
            <span style={{
              background: '#fef3c7',
              color: '#b45309',
              padding: '4px 10px',
              borderRadius: '999px',
              fontSize: '11.5px',
              fontWeight: 700
            }}>
              {unusedRecords.length.toLocaleString()} Idle Serials Across Sites
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 14px' }}>Holding Site</th>
                  <th style={{ padding: '10px 14px' }}>Part Number</th>
                  <th style={{ padding: '10px 14px' }}>Part Description</th>
                  <th style={{ padding: '10px 14px' }}>Serial Number</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Received Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Days In Stock</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Aging Status</th>
                  <th style={{ padding: '10px 14px' }}>Transfer Route</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Valuation</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No unused parts match the selected filters.
                    </td>
                  </tr>
                ) : (
                  paginatedList.map(r => {
                    const isOld = r.days_in_stock > 60;
                    const isModerate = r.days_in_stock >= 30 && r.days_in_stock <= 60;

                    return (
                      <tr key={r.serial_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                          <span style={{
                            background: '#f1f5f9',
                            color: '#0f172a',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontFamily: 'Consolas, monospace',
                            marginRight: '6px'
                          }}>
                            {r.current_site.code}
                          </span>
                          {r.current_site.shortName}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                          {r.product_code}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{r.product_name}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0284c7' }}>
                          {r.serial_number}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{r.transfer_received_date}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>
                          {r.days_in_stock}d
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: isOld ? '#fee2e2' : isModerate ? '#fef3c7' : '#dcfce7',
                            color: isOld ? '#dc2626' : isModerate ? '#b45309' : '#15803d'
                          }}>
                            {r.aging_bucket}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#64748b', fontSize: '11px' }}>
                          {r.from_stock} → {r.to_stock}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>
                          ${r.unit_price.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
            setCurrentPage={setCurrentPage}
            totalItems={targetList.length}
          />
        </div>
      )}

      {/* ── TAB 3: FIFO Violations Audit ──────────────────────────────────── */}
      {activeTab === 'fifo' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>
                FIFO Out-of-Order Violations Audit Log
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Sites consumed newer inventory while older parts of the exact same SKU sat idle or were used out of sequence.
              </p>
            </div>
            <span style={{
              background: '#fee2e2',
              color: '#dc2626',
              padding: '4px 10px',
              borderRadius: '999px',
              fontSize: '11.5px',
              fontWeight: 700
            }}>
              {fifoViolations.length.toLocaleString()} Violations Detected
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 14px' }}>Site Location</th>
                  <th style={{ padding: '10px 14px' }}>Part Number</th>
                  <th style={{ padding: '10px 14px' }}>Part Description</th>
                  <th style={{ padding: '10px 14px' }}>Consumed Serial</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Arrived</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Used Date</th>
                  <th style={{ padding: '10px 14px' }}>Violation Type</th>
                  <th style={{ padding: '10px 14px' }}>Older Stock That Was Skipped</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#15803d' }}>
                      <CheckCircle2 size={28} color="#15803d" style={{ margin: '0 auto 8px' }} />
                      <div style={{ fontWeight: 700 }}>Zero FIFO Violations Found</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>All parts consumed strictly in First In, First Out order.</div>
                    </td>
                  </tr>
                ) : (
                  paginatedList.map(r => {
                    const olderSerials = r.fifo_violation_reasons || [];
                    const isIdle = r.fifo_status === 'FIFO_VIOLATION_OLDER_IN_STOCK';

                    return (
                      <tr key={r.serial_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                          <span style={{
                            background: '#f1f5f9',
                            color: '#0f172a',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontFamily: 'Consolas, monospace',
                            marginRight: '6px'
                          }}>
                            {r.current_site.code}
                          </span>
                          {r.current_site.shortName}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                          {r.product_code}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{r.product_name}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#dc2626' }}>
                          {r.serial_number}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{r.transfer_received_date}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>{r.repair_closed_date}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            background: isIdle ? '#fee2e2' : '#fef3c7',
                            color: isIdle ? '#dc2626' : '#b45309'
                          }}>
                            {isIdle ? 'Older Stock Left Idle' : 'Used Out of Sequence'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {olderSerials.slice(0, 3).map((old, oIdx) => (
                              <div key={oIdx} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                                  {old.olderSerial}
                                </span>
                                <span style={{ color: '#64748b' }}>
                                  (Arrived: {old.olderArrival}{old.olderDaysInStock !== undefined ? `, idle ${old.olderDaysInStock}d` : ''})
                                </span>
                              </div>
                            ))}
                            {olderSerials.length > 3 && (
                              <span style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                                + {olderSerials.length - 3} more older serials
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
            setCurrentPage={setCurrentPage}
            totalItems={targetList.length}
          />
        </div>
      )}

      {/* ── TAB 4: Master Reconciliation Ledger ───────────────────────────── */}
      {activeTab === 'ledger' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                Complete Reconciled Inventory Ledger
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Every serialized transfer matched with GSX repair consumption.
              </p>
            </div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Showing {filteredRecords.length.toLocaleString()} total audited serials
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 14px' }}>Serial Number</th>
                  <th style={{ padding: '10px 14px' }}>Part Number</th>
                  <th style={{ padding: '10px 14px' }}>Description</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Received Date</th>
                  <th style={{ padding: '10px 14px' }}>Holding Site</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Usage Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Repair Closed</th>
                  <th style={{ padding: '10px 14px' }}>GSX Location</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>FIFO Status</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Days</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No records match the selected filters.
                    </td>
                  </tr>
                ) : (
                  paginatedList.map(r => {
                    const isVio = r.fifo_status.includes('VIOLATION');
                    const isUsed = r.is_used;

                    return (
                      <tr key={r.serial_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                          {r.serial_number}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                          {r.product_code}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{r.product_name}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{r.transfer_received_date}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                          <span style={{
                            background: '#f1f5f9',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontFamily: 'Consolas, monospace',
                            marginRight: '6px'
                          }}>
                            {r.current_site.code}
                          </span>
                          {r.current_site.shortName}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: isUsed ? '#dcfce7' : '#fef3c7',
                            color: isUsed ? '#15803d' : '#b45309'
                          }}>
                            {isUsed ? 'Used in GSX' : 'In Stock'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          {r.repair_closed_date || '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '11.5px', color: r.is_cross_site_discrepancy ? '#7c3aed' : '#0f172a', fontWeight: r.is_cross_site_discrepancy ? 700 : 400 }}>
                          {r.gsx_location_name || '—'}
                          {r.is_cross_site_discrepancy && (
                            <span style={{
                              marginLeft: '6px',
                              background: '#f3e8ff',
                              color: '#7c3aed',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontSize: '10px'
                            }}>
                              Cross-Site
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            background: isVio ? '#fee2e2' : isUsed ? '#dcfce7' : '#f1f5f9',
                            color: isVio ? '#dc2626' : isUsed ? '#15803d' : '#64748b'
                          }}>
                            {isVio ? 'FIFO Violation' : isUsed ? 'FIFO Compliant' : 'In Stock'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>
                          {r.days_in_stock}d
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
            setCurrentPage={setCurrentPage}
            totalItems={targetList.length}
          />
        </div>
      )}

      {/* ── TAB 5: Cross-Site & Discrepancies ─────────────────────────────── */}
      {activeTab === 'discrepancies' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#7c3aed' }}>
                Cross-Site Consumption Discrepancies
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Parts that were transferred to one branch in Fixably, but consumed in a repair logged at a different branch in GSX.
              </p>
            </div>
            <span style={{
              background: '#f3e8ff',
              color: '#7c3aed',
              padding: '4px 10px',
              borderRadius: '999px',
              fontSize: '11.5px',
              fontWeight: 700
            }}>
              {discrepancies.length.toLocaleString()} Cross-Site Mismatches
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 14px' }}>Serial Number</th>
                  <th style={{ padding: '10px 14px' }}>Part Number</th>
                  <th style={{ padding: '10px 14px' }}>Description</th>
                  <th style={{ padding: '10px 14px' }}>Designated Transfer Target</th>
                  <th style={{ padding: '10px 14px' }}>Actual Consuming GSX Site</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Transfer Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Used Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#15803d' }}>
                      <CheckCircle2 size={28} color="#15803d" style={{ margin: '0 auto 8px' }} />
                      <div style={{ fontWeight: 700 }}>Zero Cross-Site Discrepancies Found</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>All parts were consumed at their designated transfer locations.</div>
                    </td>
                  </tr>
                ) : (
                  paginatedList.map(r => (
                    <tr key={r.serial_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                        {r.serial_number}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                        {r.product_code}
                      </td>
                      <td style={{ padding: '10px 14px' }}>{r.product_name}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#dc2626' }}>
                        <span style={{
                          background: '#fee2e2',
                          color: '#dc2626',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontFamily: 'Consolas, monospace',
                          marginRight: '6px'
                        }}>
                          {r.current_site.code}
                        </span>
                        {r.current_site.name}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: '#15803d' }}>
                        <span style={{
                          background: '#dcfce7',
                          color: '#15803d',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontFamily: 'Consolas, monospace',
                          marginRight: '6px'
                        }}>
                          {r.gsx_site?.code || 'GSX'}
                        </span>
                        {r.gsx_location_name}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>{r.transfer_received_date}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600 }}>{r.repair_closed_date}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontFamily: 'Consolas, monospace' }}>
                        {r.gsx_order_id}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
            setCurrentPage={setCurrentPage}
            totalItems={targetList.length}
          />
        </div>
      )}

    </div>
  );
}

// ── Reusable Pagination Bar ───────────────────────────────────────────────────
function PaginationBar({
  currentPage,
  totalPages,
  pageSize,
  setPageSize,
  setCurrentPage,
  totalItems
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 20px',
      background: '#f8fafc',
      borderTop: '1px solid #e2e8f0',
      flexWrap: 'wrap',
      gap: '12px',
      fontSize: '12px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#64748b' }}>Rows per page:</span>
        <select
          className="form-select form-select-sm"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
          style={{ width: '70px', height: '28px', fontSize: '12px' }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={250}>250</option>
        </select>
        <span style={{ color: '#64748b', marginLeft: '6px' }}>
          Total {totalItems.toLocaleString()} records
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={currentPage <= 1}
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          style={{ height: '28px', padding: '0 8px', display: 'flex', alignItems: 'center' }}
        >
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontWeight: 600, color: '#0f172a' }}>
          Page {currentPage} of {totalPages || 1}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={currentPage >= totalPages}
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          style={{ height: '28px', padding: '0 8px', display: 'flex', alignItems: 'center' }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
