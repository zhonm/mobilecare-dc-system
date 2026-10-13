import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import dbStorage from '../utils/dbStorage';
import { supabase } from '../supabase/client';
import { queuedSavedRecordsUpsert } from '../utils/savedRecordsQueue';
import {
  parseGsxKbbKgbsUsedFile,
  parseFifoMonitoringWorkbook,
  reconcileSiteTransfers,
  normalizeDate,
  APPLE_STOCKING_PRICE_COUNT
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
  Clock,
  DollarSign,
  Layers,
  BookOpen,
  Sparkles,
  Database
} from 'lucide-react';

export default function SiteTransfersFifoReport() {
  const {
    parts,
    showToast,
    canEdit,
    broadcastCloudEvent
  } = useApp();

  // Dual file + custom price overrides state
  const [transfersData, setTransfersData] = useState([]);
  const [transfersMeta, setTransfersMeta] = useState(null);
  const [gsxData, setGsxData] = useState([]);
  const [gsxMeta, setGsxMeta] = useState(null);
  const [customPriceMap, setCustomPriceMap] = useState(null);

  const [isProcessingTransfers, setIsProcessingTransfers] = useState(false);
  const [isProcessingGsx, setIsProcessingGsx] = useState(false);
  const [isProcessingWorkbook, setIsProcessingWorkbook] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [lastCloudSyncTime, setLastCloudSyncTime] = useState(null);

  const transferInputRef = useRef(null);
  const gsxInputRef = useRef(null);
  const workbookInputRef = useRef(null);
  const isSyncingRef = useRef(false);

  // Active view tab: scorecard | branch_sheet | aging | fifo | ledger | discrepancies | guide
  const [activeTab, setActiveTab] = useState('scorecard');
  const [inspectedBranchCode, setInspectedBranchCode] = useState('BHS');
  const [branchSubTable, setBranchSubTable] = useState('ALL'); // ALL | LEDGER | VIOLATIONS | NON_MOVING | SLOW_MOVING

  // Reconciliation Policy Controls (Default = Exact Excel Parity)
  const [dcStocksOnly, setDcStocksOnly] = useState(true);
  const [agingPolicy, setAgingPolicy] = useState('EXCEL_PARITY'); // EXCEL_PARITY | UNIFORM_61_31 | UNIFORM_90_60
  const [referenceDate, setReferenceDate] = useState('2026-10-13');

  // Filters
  const [selectedSite, setSelectedSite] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL'); // ALL | IN_STOCK | USED
  const [selectedFifo, setSelectedFifo] = useState('ALL');     // ALL | COMPLIANT | VIOLATION
  const [selectedAging, setSelectedAging] = useState('ALL');   // ALL | NON_MOVING | SLOW_MOVING | ACTIVE
  const [selectedCommodity, setSelectedCommodity] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Document Registry Constants (Prefixed with 'rec-' for RLS clearance and schema compatibility)
  const FIFO_TRANSFERS_DOC_ID = 'rec-fifo_site_transfers_registry';
  const FIFO_GSX_DOC_ID = 'rec-fifo_gsx_used_registry';

  // Compact payload sanitizer for Stock Transfers (preserves all serialized transfers including DC iPhone 12 parts)
  const sanitizeTransfersForCloud = useCallback((records) => {
    return (records || [])
      .map(r => ({
        transfer_received_date: normalizeDate(r.transfer_received_date) || '',
        from_stock: String(r.from_stock || '').trim(),
        to_stock: String(r.to_stock || '').trim(),
        product_code: String(r.product_code || '').trim().toUpperCase(),
        product_name: String(r.product_name || r.part_description || '').trim(),
        serial_number: String(r.serial_number || '').trim().toUpperCase(),
        transfer_quantity: Number(r.transfer_quantity) || 1,
        transfer_value: Number(r.transfer_value) || 0
      }))
      .filter(r => Boolean(r.serial_number) && r.serial_number !== 'N/A' && r.serial_number !== '-');
  }, []);

  // Compact payload sanitizer for GSX Used Report (keeps only serialized KGB repair fields)
  const sanitizeGsxForCloud = useCallback((records) => {
    return (records || [])
      .filter(r => Boolean(r.product_kgb) && String(r.product_kgb).trim().toUpperCase() !== 'N/A')
      .map(r => ({
        order_id: String(r.order_id || '').trim(),
        location_name: String(r.location_name || '').trim(),
        repair_closed_date: normalizeDate(r.repair_closed_date) || '',
        product_code: String(r.product_code || '').trim().toUpperCase(),
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
        notes: 'Master site transfers for FIFO & DC Aging Stocks audit',
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
        notes: 'GSX used KGB parts for FIFO & DC Aging Stocks audit',
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

  // Zero-Egress Cloud Synchronization
  const syncFromCloud = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!supabase || isSyncingRef.current) return;
    isSyncingRef.current = true;
    if (!silent) setIsCloudSyncing(true);

    try {
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

      if (!needTrf && !needGsx) {
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

  // Initial Load: IndexedDB local cache first, then lightweight cloud sync check
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
      if (isMounted) {
        syncFromCloud({ force: false, silent: true });
      }
    })();

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

  // Handle 1-Click Full Monitoring Workbook upload (loads Stock Transfer + KGB Used + Sheet35 simultaneously)
  const handleFullWorkbookUpload = async (file) => {
    if (!file) return;
    setIsProcessingWorkbook(true);
    try {
      const res = await parseFifoMonitoringWorkbook(file);
      if (res.success && (res.transfers.length > 0 || res.gsxRecords.length > 0)) {
        if (res.transfers.length > 0) {
          const cleanTrf = sanitizeTransfersForCloud(res.transfers);
          const trfMeta = {
            fileName: `${file.name} (Stock Transfer)`,
            uploadedAt: new Date().toISOString(),
            totalRows: cleanTrf.length
          };
          setTransfersData(cleanTrf);
          setTransfersMeta(trfMeta);
          await Promise.all([
            dbStorage.setItem('mdc_site_transfers_records', cleanTrf),
            dbStorage.setItem('mdc_site_transfers_meta', trfMeta),
            dbStorage.removeItem('mdc_site_transfers_cleared')
          ]);
          await uploadTransfersToCloud(cleanTrf, trfMeta);
        }
        if (res.gsxRecords.length > 0) {
          const cleanGsx = sanitizeGsxForCloud(res.gsxRecords);
          const gMeta = {
            fileName: `${file.name} (KGB Used)`,
            uploadedAt: new Date().toISOString(),
            totalRows: cleanGsx.length
          };
          setGsxData(cleanGsx);
          setGsxMeta(gMeta);
          await Promise.all([
            dbStorage.setItem('mdc_gsx_used_records', cleanGsx),
            dbStorage.setItem('mdc_gsx_used_meta', gMeta),
            dbStorage.removeItem('mdc_site_transfers_cleared')
          ]);
          await uploadGsxToCloud(cleanGsx, gMeta);
        }
        if (res.customPrices && Object.keys(res.customPrices).length > 0) {
          setCustomPriceMap(res.customPrices);
        }
        showToast(
          `Loaded full FIFO Monitoring Workbook: ${res.transfers.length.toLocaleString()} transfers & ${res.gsxRecords.length.toLocaleString()} KGB repair records`,
          'success'
        );
        setCurrentPage(1);
      } else {
        showToast(res.error || 'Workbook did not contain recognizable Stock Transfer or KGB Used sheets.', 'error');
      }
    } catch (err) {
      showToast(`Error processing workbook: ${err.message}`, 'error');
    } finally {
      setIsProcessingWorkbook(false);
      if (workbookInputRef.current) workbookInputRef.current.value = '';
    }
  };

  // Handle Transfers file upload (Slot 1)
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

  // Handle GSX KBB/KGBs Used report upload (Slot 2)
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
    setCustomPriceMap(null);
    setSelectedSite('ALL');
    setSelectedStatus('ALL');
    setSelectedFifo('ALL');
    setSelectedAging('ALL');
    setSelectedCommodity('ALL');
    setSearchQuery('');
    setCurrentPage(1);
    if (transferInputRef.current) transferInputRef.current.value = '';
    if (gsxInputRef.current) gsxInputRef.current.value = '';
    if (workbookInputRef.current) workbookInputRef.current.value = '';

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

    await clearCloudAudit();
    showToast('Audit workspace and cloud cache cleared across all accounts.', 'info');
  };

  // Master reconciliation memo (replicates exact Excel formulas & 4-table branch structures)
  const reconciliation = useMemo(() => {
    return reconcileSiteTransfers(transfersData, gsxData, parts, {
      dcStocksOnly,
      preserveDuplicateTransfers: true,
      agingPolicy,
      referenceDate,
      customPriceMap
    });
  }, [transfersData, gsxData, parts, dcStocksOnly, agingPolicy, referenceDate, customPriceMap]);

  const { records, sitesScorecard, kpis, orphanGsxRecords, validations } = reconciliation;

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

      if (selectedAging === 'NON_MOVING' && r.aging_category !== 'NON_MOVING') return false;
      if (selectedAging === 'SLOW_MOVING' && r.aging_category !== 'SLOW_MOVING') return false;
      if (selectedAging === 'ACTIVE' && r.aging_category !== 'ACTIVE') return false;

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
          r.to_stock,
          r.serial_used_by_label,
          r.gsx_order_id,
          r.gsx_repair_number,
          r.gsx_location_name,
          r.remarks,
          r.aging_status_label
        ].some(v => String(v || '').toLowerCase().includes(q));
        if (!hit) return false;
      }

      return true;
    });
  }, [records, selectedSite, selectedStatus, selectedFifo, selectedAging, selectedCommodity, searchQuery]);

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

  // Currently inspected branch for the 4-Table Excel Sheet view
  const inspectedBranch = useMemo(() => {
    return sitesScorecard.find(s => s.code === inspectedBranchCode) || sitesScorecard[0] || null;
  }, [sitesScorecard, inspectedBranchCode]);

  // Pagination calculation
  const targetList = useMemo(() => {
    if (activeTab === 'aging') return unusedRecords;
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
        fileName: 'FIFO_and_DC_Stocks_Aging_Monitoring_Audit'
      });
      showToast('Exported 31-sheet FIFO & DC Aging Stocks Audit workbook', 'success');
    } catch (e) {
      showToast(`Export failed: ${e.message}`, 'error');
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: '1640px', margin: '0 auto', paddingBottom: '60px' }}>

      {/* ── Top Header Banner ──────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '18px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '20px 24px',
        borderRadius: '12px',
        color: '#fff',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            width: '48px',
            height: '48px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)'
          }}>
            <Boxes size={24} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                FIFO & (DC Stocks Only) Aging Stocks Monitoring
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
                26 PMG Branches • Sheet35 Pricing ({APPLE_STOCKING_PRICE_COUNT.toLocaleString()} SKUs)
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Automated Fixably Stock Transfer + Apple GSX KGB Consumption & Aging Valuation Engine — 100% formula parity with the official Excel monitoring workbook.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* 1-Click Full Workbook Upload Button */}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => workbookInputRef.current?.click()}
            disabled={isProcessingWorkbook}
            style={{
              background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
              borderColor: '#1d4ed8',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Sparkles size={14} />
            <span>{isProcessingWorkbook ? 'Parsing Workbook...' : '1-Click Upload Full .xlsx Workbook'}</span>
          </button>
          <input
            ref={workbookInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFullWorkbookUpload(f); }}
          />

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
                <span>Export 4-Table Excel</span>
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
                <span>Print</span>
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

      {/* ── 3 Data Sources Specification Cards ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px', marginBottom: '16px' }}>

        {/* Source 1: Fixably Stock Transfers Report */}
        <div className="card" style={{
          padding: '16px 18px',
          border: '1.5px dashed',
          borderColor: transfersMeta ? '#10b981' : '#cbd5e1',
          background: transfersMeta ? '#f0fdf4' : '#fff',
          borderRadius: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
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
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                  Source 1: Fixably Stock Transfer Report
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Excel sheet: <code>Stock Transfer</code> → filtered to <code>DC_MSPI-Owned</code>
                </div>
              </div>
            </div>
            {transfersMeta && (
              <span className="badge badge-success" style={{ fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                  <strong>{kpis.totalSerials.toLocaleString()}</strong> DC stock rows
                  {kpis.nonDcTransfersExcluded > 0 && (
                    <span style={{ color: '#94a3b8', marginLeft: '4px' }}>
                      ({kpis.nonDcTransfersExcluded.toLocaleString()} non-DC filtered)
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
                padding: '14px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0'
              }}
            >
              <UploadCloud size={22} color="#0284c7" style={{ margin: '0 auto 4px' }} />
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                {isProcessingTransfers ? 'Processing Transfers...' : 'Upload Stock Transfer Report (.xlsx / .csv)'}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                Columns: Transfer Received Date, From Stock, To Stock, Product Code, Product Name, Serial Number
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

        {/* Source 2: GSX KBB / KGBs Used Report */}
        <div className="card" style={{
          padding: '16px 18px',
          border: '1.5px dashed',
          borderColor: gsxMeta ? '#10b981' : '#cbd5e1',
          background: gsxMeta ? '#f0fdf4' : '#fff',
          borderRadius: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
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
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                  Source 2: GSX KBB / KGBs Used Report
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  Excel sheet: <code>KGB Used</code> → iPhone Display & Battery KGBs
                </div>
              </div>
            </div>
            {gsxMeta && (
              <span className="badge badge-success" style={{ fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
                <span>
                  <strong>{gsxData.length.toLocaleString()}</strong> KGB serials • <strong>{kpis.usedCount.toLocaleString()}</strong> matched
                </span>
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
                padding: '14px',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0'
              }}
            >
              <UploadCloud size={22} color="#7c3aed" style={{ margin: '0 auto 4px' }} />
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                {isProcessingGsx ? 'Processing GSX Report...' : 'Upload GSX KBB/KGBs Used Report (.xlsx / .csv)'}
              </div>
              <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                Columns: Order id, Location Name, Repair Closed Date, Product Code, Product Description, Product KGB
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

        {/* Source 3: Built-In Sheet35 Apple Service Price List */}
        <div className="card" style={{
          padding: '16px 18px',
          border: '1.5px solid #bae6fd',
          background: '#f0f9ff',
          borderRadius: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                background: '#e0f2fe',
                color: '#0284c7',
                padding: '8px',
                borderRadius: '8px'
              }}>
                <Database size={20} />
              </div>
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                  Source 3: Apple Stocking Price List (Sheet35)
                </div>
                <div style={{ fontSize: '11px', color: '#475569' }}>
                  Pre-loaded from <code>Sheet35!P2:S24490</code> (No manual upload required)
                </div>
              </div>
            </div>
            <span className="badge badge-info" style={{ fontSize: '10.5px', background: '#0284c7', color: '#fff', padding: '2px 8px', borderRadius: '999px' }}>
              Built-In
            </span>
          </div>

          <div style={{ background: '#fff', borderRadius: '8px', padding: '10px 12px', border: '1px solid #bae6fd', fontSize: '11.5px', color: '#334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span>Indexed Apple Part Numbers:</span>
              <strong>{APPLE_STOCKING_PRICE_COUNT.toLocaleString()} SKUs</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
              <span>Formula Replicated:</span>
              <code>XLOOKUP(PartNo, Sheet35!$P:$P, Sheet35!$S:$S, 0)</code>
            </div>
          </div>
        </div>
      </div>

      {/* ── Audit Scope & Aging Policy Bar ──────────────────────────────────── */}
      <div className="card" style={{
        padding: '10px 16px',
        marginBottom: '16px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Transfer Scope:</span>
            <select
              className="form-select form-select-sm"
              value={dcStocksOnly ? 'DC_ONLY' : 'ALL'}
              onChange={(e) => { setDcStocksOnly(e.target.value === 'DC_ONLY'); setCurrentPage(1); }}
              style={{ fontSize: '12px', height: '28px', borderRadius: '6px', fontWeight: 600 }}
            >
              <option value="DC_ONLY">DC Stocks Only (Excel Parity — From Stock contains &quot;DC&quot;)</option>
              <option value="ALL">All Transfers (Include Branch-to-Branch Repair Transfers)</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Aging Policy:</span>
            <select
              className="form-select form-select-sm"
              value={agingPolicy}
              onChange={(e) => { setAgingPolicy(e.target.value); setCurrentPage(1); }}
              style={{ fontSize: '12px', height: '28px', borderRadius: '6px', fontWeight: 600 }}
            >
              <option value="EXCEL_PARITY">Excel Workbook Parity (61/31d + BHS 90/60d)</option>
              <option value="UNIFORM_61_31">Uniform 61d Non-Moving / 31d Slow-Moving (All 26 Sites)</option>
              <option value="UNIFORM_90_60">Standard 90d Non-Moving / 60d Slow-Moving (All 26 Sites)</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Aging Reference Date:</span>
            <input
              type="date"
              className="form-control form-control-sm"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value || '2026-10-13')}
              style={{ fontSize: '12px', height: '28px', borderRadius: '6px', width: '135px' }}
            />
            {referenceDate !== '2026-10-13' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setReferenceDate('2026-10-13')}
                style={{ fontSize: '11px', height: '28px', padding: '0 8px' }}
              >
                Reset to Workbook Date (2026-10-13)
              </button>
            )}
          </div>
        </div>

        {validations && (validations.duplicateTransferSerialsCount > 0 || validations.missingPricePartsCount > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11.5px' }}>
            {validations.duplicateTransferSerialsCount > 0 && (
              <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                {validations.duplicateTransferSerialsCount} Duplicate DC Transfer Serials Preserved
              </span>
            )}
            {validations.missingPricePartsCount > 0 && (
              <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '999px', fontWeight: 600 }}>
                {validations.missingPricePartsCount} Part SKUs $0 in Sheet35
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── 7 Executive KPI Metric Cards ────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '12px',
        marginBottom: '18px'
      }}>
        {/* 1. DC Serials Monitored */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#0284c71a', color: '#0284c7', padding: '10px', borderRadius: '10px' }}>
            <Package size={20} />
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              DC Serials Monitored
            </div>
            <div style={{ fontSize: '21px', fontWeight: 800, color: '#0f172a' }}>
              {kpis.totalSerials.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {kpis.uniqueSerialsCount?.toLocaleString() || kpis.totalSerials.toLocaleString()} unique ({kpis.duplicateTransferRowsCount || 0} dup rows)
            </div>
          </div>
        </div>

        {/* 2. Used in Repairs */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#15803d1a', color: '#15803d', padding: '10px', borderRadius: '10px' }}>
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Used in GSX Repairs
            </div>
            <div style={{ fontSize: '21px', fontWeight: 800, color: '#15803d' }}>
              {kpis.usedCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
              {kpis.usedRate}% consumption rate
            </div>
          </div>
        </div>

        {/* 3. In Stock (Unused) */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#d977061a', color: '#d97706', padding: '10px', borderRadius: '10px' }}>
            <Boxes size={20} />
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              In Stock (Unused)
            </div>
            <div style={{ fontSize: '21px', fontWeight: 800, color: '#d97706' }}>
              {kpis.inStockCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Total Cost: <strong>${(kpis.inStockValue || 0).toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* 4. FIFO Compliance Rate */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: kpis.fifoComplianceRate >= 90 ? '#16a34a1a' : '#dc26261a',
            color: kpis.fifoComplianceRate >= 90 ? '#16a34a' : '#dc2626',
            padding: '10px',
            borderRadius: '10px'
          }}>
            {kpis.fifoComplianceRate >= 90 ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              FIFO Compliance
            </div>
            <div style={{
              fontSize: '21px',
              fontWeight: 800,
              color: kpis.fifoComplianceRate >= 90 ? '#16a34a' : '#dc2626'
            }}>
              {kpis.fifoComplianceRate}%
            </div>
            <div style={{ fontSize: '11px', color: kpis.fifoViolationsCount > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
              {kpis.fifoCompliantCount?.toLocaleString() || 0} OK • {kpis.fifoViolationsCount} Violations
            </div>
          </div>
        </div>

        {/* 5. Non-Moving Stock (Cost) */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', borderLeft: '3.5px solid #dc2626' }}>
          <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px', borderRadius: '10px' }}>
            <Clock size={20} />
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>
              Non-Moving (≥61d)
            </div>
            <div style={{ fontSize: '21px', fontWeight: 800, color: '#dc2626' }}>
              {(kpis.nonMovingCount || 0).toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 600 }}>units</span>
            </div>
            <div style={{ fontSize: '11px', color: '#991b1b', fontWeight: 700 }}>
              Cost: ${(kpis.nonMovingValue || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* 6. Slow-Moving Stock (Cost) */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', borderLeft: '3.5px solid #d97706' }}>
          <div style={{ background: '#fef3c7', color: '#b45309', padding: '10px', borderRadius: '10px' }}>
            <DollarSign size={20} />
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>
              Slow-Moving (31–60d)
            </div>
            <div style={{ fontSize: '21px', fontWeight: 800, color: '#b45309' }}>
              {(kpis.slowMovingCount || 0).toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 600 }}>units</span>
            </div>
            <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 700 }}>
              Cost: ${(kpis.slowMovingValue || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* 7. Cross-Site Leakage / Discrepancies */}
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#7c3aed1a', color: '#7c3aed', padding: '10px', borderRadius: '10px' }}>
            <Activity size={20} />
          </div>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Cross-Site Usage
            </div>
            <div style={{ fontSize: '21px', fontWeight: 800, color: '#7c3aed' }}>
              {kpis.crossSiteDiscrepanciesCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              &quot;Transferred to ...&quot; in Col D
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
              { id: 'scorecard', label: 'Branch Scorecard (26)', icon: Building2, count: sitesScorecard.length },
              { id: 'branch_sheet', label: 'Branch 4-Table Sheet', icon: Layers, count: inspectedBranch?.totalReceived || 0, color: '#0284c7' },
              { id: 'aging', label: 'DC Aging Stocks (Cost)', icon: Clock, count: (kpis.nonMovingCount || 0) + (kpis.slowMovingCount || 0), color: '#d97706' },
              { id: 'fifo', label: 'FIFO Violations', icon: AlertTriangle, count: kpis.fifoViolationsCount, color: '#dc2626' },
              { id: 'ledger', label: 'KGB Used Serials Ledger', icon: FileText, count: kpis.totalSerials },
              { id: 'discrepancies', label: 'Cross-Site & Validations', icon: Activity, count: kpis.crossSiteDiscrepanciesCount, color: '#7c3aed' },
              { id: 'guide', label: 'Data Spec & Recommendations', icon: BookOpen }
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
                    padding: '6px 12px',
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
          <div style={{ position: 'relative', width: '260px' }}>
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

        {/* Secondary Filter Row (Shown for filterable table views) */}
        {['aging', 'fifo', 'ledger', 'discrepancies'].includes(activeTab) && (
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
                style={{ fontSize: '12px', height: '30px', borderRadius: '6px', maxWidth: '210px' }}
              >
                <option value="ALL">All 26 Branches ({sitesScorecard.length})</option>
                {sitesScorecard.map(s => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.shortName} ({s.totalReceived})
                  </option>
                ))}
              </select>
            </div>

            {/* Aging Category Filter */}
            {(activeTab === 'aging' || activeTab === 'ledger') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Aging Tier:</span>
                <select
                  className="form-select form-select-sm"
                  value={selectedAging}
                  onChange={(e) => { setSelectedAging(e.target.value); setCurrentPage(1); }}
                  style={{ fontSize: '12px', height: '30px', borderRadius: '6px' }}
                >
                  <option value="ALL">All Unused Tiers ({kpis.inStockCount})</option>
                  <option value="NON_MOVING">Non-Moving Only ({kpis.nonMovingCount} • ${(kpis.nonMovingValue || 0).toLocaleString()})</option>
                  <option value="SLOW_MOVING">Slow-Moving Only ({kpis.slowMovingCount} • ${(kpis.slowMovingValue || 0).toLocaleString()})</option>
                  <option value="ACTIVE">Active &lt;31d ({kpis.activeStockCount} • ${(kpis.activeStockValue || 0).toLocaleString()})</option>
                </select>
              </div>
            )}

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

            {(selectedSite !== 'ALL' || selectedStatus !== 'ALL' || selectedFifo !== 'ALL' || selectedAging !== 'ALL' || selectedCommodity !== 'ALL' || searchQuery) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSelectedSite('ALL');
                  setSelectedStatus('ALL');
                  setSelectedFifo('ALL');
                  setSelectedAging('ALL');
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

      {/* ── TAB 1: Branch FIFO & Aging Scorecard (26 Branches) ─────────────── */}
      {activeTab === 'scorecard' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                26-Branch FIFO Compliance & DC Aging Stocks Scorecard
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Ordered in exact Excel tab sequence (<code>BHS</code> through <code>LAN</code>). Click <strong>4-Table Sheet</strong> on any row to view that branch&apos;s exact Excel worksheet tables.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#475569' }}>
              <span>Non-Moving Total: <strong style={{ color: '#dc2626' }}>${(kpis.nonMovingValue || 0).toLocaleString()}</strong></span>
              <span>Slow-Moving Total: <strong style={{ color: '#b45309' }}>${(kpis.slowMovingValue || 0).toLocaleString()}</strong></span>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>Branch Tab</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>DC Received</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Used</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>In Stock</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>FIFO OK</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Violations</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>FIFO %</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#991b1b', textAlign: 'center', background: '#fef2f2' }}>Non-Moving</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#991b1b', textAlign: 'right', background: '#fef2f2' }}>Non-Moving Cost</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#92400e', textAlign: 'center', background: '#fffbeb' }}>Slow-Moving</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#92400e', textAlign: 'right', background: '#fffbeb' }}>Slow-Moving Cost</th>
                  <th style={{ padding: '10px 10px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Cross-Site</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569', textAlign: 'center' }}>Sheet View</th>
                </tr>
              </thead>
              <tbody>
                {sitesScorecard.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No transfer data loaded yet. Upload the Full Monitoring Workbook (.xlsx) or both individual reports above.
                    </td>
                  </tr>
                ) : (
                  sitesScorecard.map((site) => {
                    const isHighRisk = site.complianceRate < 75;
                    const isModerateRisk = site.complianceRate >= 75 && site.complianceRate < 90;

                    return (
                      <tr key={site.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{
                              fontWeight: 800,
                              fontFamily: 'Consolas, monospace',
                              background: '#0f172a',
                              color: '#fff',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontSize: '11.5px'
                            }}>
                              {site.code}
                            </span>
                            <div>
                              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12px' }}>
                                {site.shortName}
                                {site.code === 'BHS' && agingPolicy === 'EXCEL_PARITY' && (
                                  <span style={{ marginLeft: '5px', fontSize: '10px', color: '#0284c7', fontWeight: 600 }}>(90/60d)</span>
                                )}
                              </div>
                              <div style={{ fontSize: '10.5px', color: '#64748b' }}>{site.name}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700 }}>
                          {site.totalReceived.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>
                          {site.usedCount.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', color: '#d97706', fontWeight: 700 }}>
                          {site.inStockCount.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>
                          {site.fifoCompliantCount.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          {site.fifoViolationsCount > 0 ? (
                            <span style={{
                              background: '#fee2e2',
                              color: '#dc2626',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '11px',
                              fontWeight: 700
                            }}>
                              {site.fifoViolationsCount}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>0</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: isHighRisk ? '#fee2e2' : isModerateRisk ? '#fef3c7' : '#dcfce7',
                            color: isHighRisk ? '#dc2626' : isModerateRisk ? '#b45309' : '#15803d'
                          }}>
                            {site.complianceRate}%
                          </span>
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, color: site.nonMovingCount > 0 ? '#dc2626' : '#94a3b8', background: '#fef2f240' }}>
                          {site.nonMovingCount || 0}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: site.nonMovingValue > 0 ? '#991b1b' : '#94a3b8', background: '#fef2f240' }}>
                          ${(site.nonMovingValue || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', fontWeight: 700, color: site.slowMovingCount > 0 ? '#b45309' : '#94a3b8', background: '#fffbeb40' }}>
                          {site.slowMovingCount || 0}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: site.slowMovingValue > 0 ? '#92400e' : '#94a3b8', background: '#fffbeb40' }}>
                          ${(site.slowMovingValue || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 10px', textAlign: 'center', color: site.crossSiteCount > 0 ? '#7c3aed' : '#94a3b8', fontWeight: 600 }}>
                          {site.crossSiteCount}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setInspectedBranchCode(site.code);
                              setBranchSubTable('ALL');
                              setActiveTab('branch_sheet');
                            }}
                            style={{ fontSize: '11px', padding: '3px 9px' }}
                          >
                            4-Table Sheet
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {sitesScorecard.length > 0 && (
                <tfoot style={{ background: '#0f172a', color: '#fff', fontWeight: 800 }}>
                  <tr>
                    <td style={{ padding: '11px 12px' }}>TOTAL ({sitesScorecard.length} BRANCHES)</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center' }}>{kpis.totalSerials.toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#4ade80' }}>{kpis.usedCount.toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#fbbf24' }}>{kpis.inStockCount.toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#4ade80' }}>{(kpis.fifoCompliantCount || 0).toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#f87171' }}>{kpis.fifoViolationsCount.toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center' }}>{kpis.fifoComplianceRate}%</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#f87171' }}>{(kpis.nonMovingCount || 0).toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'right', color: '#f87171' }}>${(kpis.nonMovingValue || 0).toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#fbbf24' }}>{(kpis.slowMovingCount || 0).toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'right', color: '#fbbf24' }}>${(kpis.slowMovingValue || 0).toLocaleString()}</td>
                    <td style={{ padding: '11px 10px', textAlign: 'center', color: '#c084fc' }}>{kpis.crossSiteDiscrepanciesCount.toLocaleString()}</td>
                    <td style={{ padding: '11px 12px' }}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 2: Branch 4-Table Excel Sheet Inspector ─────────────────────── */}
      {activeTab === 'branch_sheet' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Branch Tab Switcher & Summary Card (BHS..LAN) */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{
                    background: '#0f172a',
                    color: '#38bdf8',
                    fontFamily: 'Consolas, monospace',
                    fontWeight: 800,
                    fontSize: '12px',
                    padding: '3px 8px',
                    borderRadius: '6px'
                  }}>
                    SHEET: {inspectedBranch?.code || 'BHS'}
                  </span>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                    Excel Branch Worksheet Inspector — {inspectedBranch ? inspectedBranch.name : 'Select a Branch'}
                  </h3>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Displays all 4 worksheet tables from <code>FIFO &amp; (DC stocks only) Aging Stocks Monitoring.xlsx</code> in sequential order (<strong>Table 1 → Table 2 → Table 3 → Table 4</strong>).
                </p>
              </div>

              {/* Sub-Table Filter Buttons */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  { id: 'ALL', label: 'Show All 4 Tables (1 → 4)' },
                  { id: 'LEDGER', label: `Table 1: Master Ledger (${inspectedBranch?.ledgerRows?.length || 0})` },
                  { id: 'VIOLATIONS', label: `Table 2: FIFO Violations (${inspectedBranch?.violationRows?.length || 0})` },
                  { id: 'NON_MOVING', label: `Table 3: Non-Moving (${inspectedBranch?.nonMovingRows?.length || 0})` },
                  { id: 'SLOW_MOVING', label: `Table 4: Slow-Moving (${inspectedBranch?.slowMovingRows?.length || 0})` }
                ].map(btn => (
                  <button
                    key={btn.id}
                    type="button"
                    className={`btn btn-sm ${branchSubTable === btn.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setBranchSubTable(btn.id)}
                    style={{ fontSize: '11.5px', padding: '5px 11px', fontWeight: branchSubTable === btn.id ? 700 : 600 }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 26 Branch Pills (Ordered BHS..LAN) */}
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
              {sitesScorecard.map(s => {
                const isSel = s.code === inspectedBranch?.code;
                return (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => setInspectedBranchCode(s.code)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: isSel ? 800 : 600,
                      fontFamily: 'Consolas, monospace',
                      border: isSel ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                      background: isSel ? '#0284c7' : '#f8fafc',
                      color: isSel ? '#fff' : '#334155',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {s.code} ({s.totalReceived})
                  </button>
                );
              })}
            </div>

            {/* 4-Table Overview Strip (Sequential 1 -> 2 -> 3 -> 4) */}
            {inspectedBranch && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '10px',
                marginTop: '14px',
                paddingTop: '12px',
                borderTop: '1px solid #f1f5f9'
              }}>
                <div
                  onClick={() => setBranchSubTable(branchSubTable === 'LEDGER' ? 'ALL' : 'LEDGER')}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: branchSubTable === 'LEDGER' ? '#eff6ff' : '#f8fafc',
                    border: branchSubTable === 'LEDGER' ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
                    borderLeft: '4px solid #1e293b'
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    Table 1 • Excel Cols A–J
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    {inspectedBranch.ledgerRows?.length || 0} Branch Transfers
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    {inspectedBranch.usedCount} Used • {inspectedBranch.inStockCount} In Stock
                  </div>
                </div>

                <div
                  onClick={() => setBranchSubTable(branchSubTable === 'VIOLATIONS' ? 'ALL' : 'VIOLATIONS')}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: branchSubTable === 'VIOLATIONS' ? '#fef2f2' : '#f8fafc',
                    border: branchSubTable === 'VIOLATIONS' ? '1.5px solid #dc2626' : '1px solid #e2e8f0',
                    borderLeft: '4px solid #dc2626'
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase' }}>
                    Table 2 • Excel Cols L–T
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: inspectedBranch.fifoViolationsCount > 0 ? '#dc2626' : '#15803d', marginTop: '2px' }}>
                    {inspectedBranch.violationRows?.length || 0} FIFO Violations
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    Compliance Rate: <strong>{inspectedBranch.complianceRate}%</strong>
                  </div>
                </div>

                <div
                  onClick={() => setBranchSubTable(branchSubTable === 'NON_MOVING' ? 'ALL' : 'NON_MOVING')}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: branchSubTable === 'NON_MOVING' ? '#fef2f2' : '#f8fafc',
                    border: branchSubTable === 'NON_MOVING' ? '1.5px solid #991b1b' : '1px solid #e2e8f0',
                    borderLeft: '4px solid #991b1b'
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#991b1b', textTransform: 'uppercase' }}>
                    Table 3 • Excel Cols V–AA
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#991b1b', marginTop: '2px' }}>
                    {inspectedBranch.nonMovingRows?.length || 0} Non-Moving (≥{inspectedBranch.nonMovingThreshold || 61}d)
                  </div>
                  <div style={{ fontSize: '11px', color: '#991b1b', fontWeight: 700 }}>
                    Total Cost: ${(inspectedBranch.nonMovingValue || 0).toLocaleString()}
                  </div>
                </div>

                <div
                  onClick={() => setBranchSubTable(branchSubTable === 'SLOW_MOVING' ? 'ALL' : 'SLOW_MOVING')}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: branchSubTable === 'SLOW_MOVING' ? '#fffbeb' : '#f8fafc',
                    border: branchSubTable === 'SLOW_MOVING' ? '1.5px solid #b45309' : '1px solid #e2e8f0',
                    borderLeft: '4px solid #b45309'
                  }}
                >
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#b45309', textTransform: 'uppercase' }}>
                    Table 4 • Excel Cols AD–AI
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#b45309', marginTop: '2px' }}>
                    {inspectedBranch.slowMovingRows?.length || 0} Slow-Moving ({inspectedBranch.slowMovingThreshold || 31}–{(inspectedBranch.nonMovingThreshold || 61) - 1}d)
                  </div>
                  <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 700 }}>
                    Total Cost: ${(inspectedBranch.slowMovingValue || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {inspectedBranch && (
            <>
              {/* ── TABLE 1 (Cols A–J): Complete Branch DC Transfers & FIFO Status ── */}
              {(branchSubTable === 'ALL' || branchSubTable === 'LEDGER') && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    color: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        background: '#0284c7',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '11px',
                        padding: '4px 9px',
                        borderRadius: '6px',
                        letterSpacing: '0.03em'
                      }}>
                        TABLE 1 • COLS A–J
                      </span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '14px' }}>
                          {inspectedBranch.code} Master Branch Transfers &amp; FIFO Ledger
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Excel Formula: <code>SORT(FILTER(&apos;KGB Used Serials&apos;!A2:G, ISNUMBER(SEARCH(&quot;{inspectedBranch.code === 'COT' ? 'CBO' : inspectedBranch.code}&quot;, &apos;KGB Used Serials&apos;!C2:C))), 1, TRUE)</code>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11.5px' }}>
                      <span style={{ background: '#334155', padding: '4px 10px', borderRadius: '999px', fontWeight: 700 }}>
                        {inspectedBranch.ledgerRows?.length || 0} Total Rows
                      </span>
                      <span style={{ background: '#14532d', color: '#4ade80', padding: '4px 10px', borderRadius: '999px', fontWeight: 700 }}>
                        {inspectedBranch.usedCount} Used
                      </span>
                      <span style={{ background: '#78350f', color: '#fbbf24', padding: '4px 10px', borderRadius: '999px', fontWeight: 700 }}>
                        {inspectedBranch.inStockCount} In Stock
                      </span>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', maxHeight: '460px' }}>
                    <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 2, borderBottom: '2px solid #e2e8f0' }}>
                        <tr>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', width: '44px', textAlign: 'center', color: '#64748b' }}>#</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transfer Received Date</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>To Stock</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Serial Used by:</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Part Number</th>
                          <th style={{ padding: '10px 12px', minWidth: '200px' }}>Part Description</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transferred Serial</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>Repair Closed Date</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Order Number</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Remarks (Col I)</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Status (Col J)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inspectedBranch.ledgerRows || []).map((r, idx) => {
                          const isVio = r.remarks?.includes('Violation');
                          const isNonMov = r.aging_category === 'NON_MOVING';
                          const isSlowMov = r.aging_category === 'SLOW_MOVING';
                          return (
                            <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 1 ? '#fcfcfd' : '#fff' }}>
                              <td style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'Consolas, monospace' }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 600, color: '#334155' }}>
                                {r.transfer_received_date}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#475569' }}>
                                {r.to_stock}
                              </td>
                              <td style={{
                                padding: '8px 12px',
                                whiteSpace: 'nowrap',
                                color: r.is_cross_site_discrepancy ? '#7c3aed' : '#0f172a',
                                fontWeight: r.is_cross_site_discrepancy ? 700 : 400
                              }}>
                                {r.serial_used_by_label || '—'}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                                {r.product_code}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#1e293b' }}>
                                {r.product_name}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0284c7' }}>
                                {r.serial_number}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center', color: '#334155' }}>
                                {r.repair_closed_date || '—'}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', color: '#334155' }}>
                                {r.gsx_order_id || '—'}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: isVio ? '#fee2e2' : r.is_used ? '#dcfce7' : '#fef3c7',
                                  color: isVio ? '#dc2626' : r.is_used ? '#15803d' : '#b45309'
                                }}>
                                  {r.remarks}
                                </span>
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                {r.aging_status_label ? (
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    background: isNonMov ? '#fee2e2' : isSlowMov ? '#fef3c7' : '#f1f5f9',
                                    color: isNonMov ? '#dc2626' : isSlowMov ? '#b45309' : '#475569'
                                  }}>
                                    {r.aging_status_label}
                                  </span>
                                ) : (
                                  <span style={{ color: '#cbd5e1' }}>—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── TABLE 2 (Cols L–T): Filtered FIFO Violations ─────────────────── */}
              {(branchSubTable === 'ALL' || branchSubTable === 'VIOLATIONS') && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #fecaca' }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)',
                    color: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        background: '#7f1d1d',
                        color: '#fecaca',
                        fontWeight: 800,
                        fontSize: '11px',
                        padding: '4px 9px',
                        borderRadius: '6px',
                        letterSpacing: '0.03em'
                      }}>
                        TABLE 2 • COLS L–T
                      </span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '14px' }}>
                          {inspectedBranch.code} FIFO Violations Table
                        </div>
                        <div style={{ fontSize: '11px', color: '#fee2e2' }}>
                          Excel Formula: <code>FILTER(A2:I, ISNUMBER(SEARCH(&quot;FIFO Violation (Older Stock Exists)&quot;, I2:I)))</code>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ background: '#7f1d1d', color: '#fff', padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 800 }}>
                        {inspectedBranch.violationRows?.length || 0} Violations ({inspectedBranch.complianceRate}% Compliant)
                      </span>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', maxHeight: '380px' }}>
                    <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: '#fef2f2', position: 'sticky', top: 0, zIndex: 2, borderBottom: '2px solid #fecaca' }}>
                        <tr>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', width: '44px', textAlign: 'center', color: '#991b1b' }}>#</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transfer Received Date</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>To Stock</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Serial Used by:</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Part Number</th>
                          <th style={{ padding: '10px 12px', minWidth: '200px' }}>Part Description</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transferred Serial</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>Repair Closed Date</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Order Number</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inspectedBranch.violationRows || []).length === 0 ? (
                          <tr>
                            <td colSpan={10} style={{ textAlign: 'center', padding: '22px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>
                              ✓ 0 FIFO Violations at {inspectedBranch.code} — All repairs consumed strictly in FIFO order.
                            </td>
                          </tr>
                        ) : (
                          (inspectedBranch.violationRows || []).map((r, idx) => (
                            <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #fee2e2', background: idx % 2 === 1 ? '#fffafa' : '#fff' }}>
                              <td style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'Consolas, monospace' }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 600 }}>{r.transfer_received_date}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.to_stock}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.serial_used_by_label}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700 }}>{r.product_code}</td>
                              <td style={{ padding: '8px 12px' }}>{r.product_name}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#dc2626' }}>
                                {r.serial_number}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 600 }}>{r.repair_closed_date}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace' }}>{r.gsx_order_id}</td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: '#fee2e2',
                                  color: '#dc2626'
                                }}>
                                  {r.remarks}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── TABLE 3 (Cols V–AA): Filtered Non-Moving Stocks + Cost SUM ───── */}
              {(branchSubTable === 'ALL' || branchSubTable === 'NON_MOVING') && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #fca5a5' }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)',
                    color: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        background: '#450a0a',
                        color: '#fca5a5',
                        fontWeight: 800,
                        fontSize: '11px',
                        padding: '4px 9px',
                        borderRadius: '6px',
                        letterSpacing: '0.03em'
                      }}>
                        TABLE 3 • COLS V–AA
                      </span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '14px' }}>
                          {inspectedBranch.code} Non-Moving Stocks (≥{inspectedBranch.nonMovingThreshold || 61} Days Idle)
                        </div>
                        <div style={{ fontSize: '11px', color: '#fecaca' }}>
                          Excel Formula: <code>FILTER(A2:J, ISNUMBER(SEARCH(&quot;Non-Moving&quot;, J2:J)))</code> + <code>XLOOKUP(PartNo, Sheet35!$P:$P, Sheet35!$S:$S, 0)</code>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ background: '#450a0a', color: '#fecaca', padding: '4px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>
                        {inspectedBranch.nonMovingRows?.length || 0} Units
                      </span>
                      <span style={{ background: '#fff', color: '#991b1b', padding: '4px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 800 }}>
                        Total Cost: ${(inspectedBranch.nonMovingValue || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
                    <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: '#fef2f2', position: 'sticky', top: 0, zIndex: 2, borderBottom: '2px solid #fca5a5' }}>
                        <tr>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', width: '44px', textAlign: 'center', color: '#991b1b' }}>#</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transfer Received Date</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>To Stock</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Part Number</th>
                          <th style={{ padding: '10px 12px', minWidth: '220px' }}>Part Description</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transferred Serial</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Non-Moving Status</th>
                          <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>Cost (Stock Price)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inspectedBranch.nonMovingRows || []).length === 0 ? (
                          <tr>
                            <td colSpan={8} style={{ textAlign: 'center', padding: '22px', color: '#64748b' }}>
                              0 Non-Moving units at {inspectedBranch.code}
                            </td>
                          </tr>
                        ) : (
                          (inspectedBranch.nonMovingRows || []).map((r, idx) => (
                            <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #fee2e2', background: idx % 2 === 1 ? '#fffafa' : '#fff' }}>
                              <td style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'Consolas, monospace' }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 600, color: '#334155' }}>
                                {r.transfer_received_date}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#475569' }}>
                                {r.to_stock}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                                {r.product_code}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#1e293b' }}>
                                {r.product_name}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0284c7' }}>
                                {r.serial_number}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '2px 9px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: '#fee2e2',
                                  color: '#dc2626'
                                }}>
                                  {r.aging_status_label}
                                </span>
                              </td>
                              <td style={{ padding: '8px 14px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                ${(r.unit_price || 0).toLocaleString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {(inspectedBranch.nonMovingRows || []).length > 0 && (
                        <tfoot style={{ background: '#fef2f2', fontWeight: 800, borderTop: '2px solid #fca5a5' }}>
                          <tr>
                            <td colSpan={7} style={{ padding: '10px 12px', textAlign: 'right', color: '#991b1b' }}>
                              TOTAL NON-MOVING COST — SUM(AA2:AA):
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#991b1b', fontSize: '13px', whiteSpace: 'nowrap' }}>
                              ${(inspectedBranch.nonMovingValue || 0).toLocaleString()}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              )}

              {/* ── TABLE 4 (Cols AD–AI): Filtered Slow-Moving Stocks + Cost SUM ──── */}
              {(branchSubTable === 'ALL' || branchSubTable === 'SLOW_MOVING') && (
                <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #fcd34d' }}>
                  <div style={{
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #92400e 0%, #b45309 100%)',
                    color: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{
                        background: '#451a03',
                        color: '#fde68a',
                        fontWeight: 800,
                        fontSize: '11px',
                        padding: '4px 9px',
                        borderRadius: '6px',
                        letterSpacing: '0.03em'
                      }}>
                        TABLE 4 • COLS AD–AI
                      </span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '14px' }}>
                          {inspectedBranch.code} Slow-Moving Stocks ({inspectedBranch.slowMovingThreshold || 31}–{(inspectedBranch.nonMovingThreshold || 61) - 1} Days Idle)
                        </div>
                        <div style={{ fontSize: '11px', color: '#fef3c7' }}>
                          Excel Formula: <code>FILTER(A2:J, ISNUMBER(SEARCH(&quot;Slow-Moving&quot;, J2:J)))</code> + <code>XLOOKUP(PartNo, Sheet35!$P:$P, Sheet35!$S:$S, 0)</code>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ background: '#451a03', color: '#fef3c7', padding: '4px 11px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>
                        {inspectedBranch.slowMovingRows?.length || 0} Units
                      </span>
                      <span style={{ background: '#fff', color: '#92400e', padding: '4px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 800 }}>
                        Total Cost: ${(inspectedBranch.slowMovingValue || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto', maxHeight: '400px' }}>
                    <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: '#fffbeb', position: 'sticky', top: 0, zIndex: 2, borderBottom: '2px solid #fcd34d' }}>
                        <tr>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap', width: '44px', textAlign: 'center', color: '#92400e' }}>#</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transfer Received Date</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>To Stock</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Part Number</th>
                          <th style={{ padding: '10px 12px', minWidth: '220px' }}>Part Description</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Transferred Serial</th>
                          <th style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>Slow-Moving Status</th>
                          <th style={{ padding: '10px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>Cost (Stock Price)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inspectedBranch.slowMovingRows || []).length === 0 ? (
                          <tr>
                            <td colSpan={8} style={{ textAlign: 'center', padding: '22px', color: '#64748b' }}>
                              0 Slow-Moving units at {inspectedBranch.code}
                            </td>
                          </tr>
                        ) : (
                          (inspectedBranch.slowMovingRows || []).map((r, idx) => (
                            <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #fef3c7', background: idx % 2 === 1 ? '#fffdf7' : '#fff' }}>
                              <td style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'Consolas, monospace' }}>
                                {idx + 1}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontWeight: 600, color: '#334155' }}>
                                {r.transfer_received_date}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#475569' }}>
                                {r.to_stock}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                                {r.product_code}
                              </td>
                              <td style={{ padding: '8px 12px', color: '#1e293b' }}>
                                {r.product_name}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0284c7' }}>
                                {r.serial_number}
                              </td>
                              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '2px 9px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: '#fef3c7',
                                  color: '#b45309'
                                }}>
                                  {r.aging_status_label}
                                </span>
                              </td>
                              <td style={{ padding: '8px 14px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                ${(r.unit_price || 0).toLocaleString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {(inspectedBranch.slowMovingRows || []).length > 0 && (
                        <tfoot style={{ background: '#fffbeb', fontWeight: 800, borderTop: '2px solid #fcd34d' }}>
                          <tr>
                            <td colSpan={7} style={{ padding: '10px 12px', textAlign: 'right', color: '#92400e' }}>
                              TOTAL SLOW-MOVING COST — SUM(AI2:AI):
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', color: '#92400e', fontSize: '13px', whiteSpace: 'nowrap' }}>
                              ${(inspectedBranch.slowMovingValue || 0).toLocaleString()}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB 3: DC Aging Stocks (Non-Moving & Slow-Moving Valuation) ────── */}
      {activeTab === 'aging' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                DC Aging Stocks Monitoring (Non-Moving &amp; Slow-Moving Valuation)
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Unused DC-transferred parts valued via <code>Sheet35</code> Apple Stocking Price List. Click a tier badge to filter.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => { setSelectedAging('ALL'); setCurrentPage(1); }}
                style={{
                  background: selectedAging === 'ALL' ? '#0f172a' : '#f1f5f9',
                  color: selectedAging === 'ALL' ? '#fff' : '#334155',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                All Unused: {kpis.inStockCount.toLocaleString()} (${(kpis.inStockValue || 0).toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setSelectedAging('NON_MOVING'); setCurrentPage(1); }}
                style={{
                  background: selectedAging === 'NON_MOVING' ? '#dc2626' : '#fee2e2',
                  color: selectedAging === 'NON_MOVING' ? '#fff' : '#dc2626',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Non-Moving: {(kpis.nonMovingCount || 0).toLocaleString()} (${(kpis.nonMovingValue || 0).toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setSelectedAging('SLOW_MOVING'); setCurrentPage(1); }}
                style={{
                  background: selectedAging === 'SLOW_MOVING' ? '#b45309' : '#fef3c7',
                  color: selectedAging === 'SLOW_MOVING' ? '#fff' : '#b45309',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Slow-Moving: {(kpis.slowMovingCount || 0).toLocaleString()} (${(kpis.slowMovingValue || 0).toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setSelectedAging('ACTIVE'); setCurrentPage(1); }}
                style={{
                  background: selectedAging === 'ACTIVE' ? '#15803d' : '#dcfce7',
                  color: selectedAging === 'ACTIVE' ? '#fff' : '#15803d',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Active (&lt;31d): {(kpis.activeStockCount || 0).toLocaleString()} (${(kpis.activeStockValue || 0).toLocaleString()})
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ margin: 0, fontSize: '12px', width: '100%' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '10px 14px' }}>Holding Branch</th>
                  <th style={{ padding: '10px 14px' }}>To Stock</th>
                  <th style={{ padding: '10px 14px' }}>Part Number</th>
                  <th style={{ padding: '10px 14px' }}>Part Description</th>
                  <th style={{ padding: '10px 14px' }}>Transferred Serial</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Received Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Days Elapsed</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Excel Status (Col J)</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Cost (Stock Price)</th>
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
                  paginatedList.map((r, idx) => {
                    const isNonMoving = r.aging_category === 'NON_MOVING';
                    const isSlowMoving = r.aging_category === 'SLOW_MOVING';

                    return (
                      <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
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
                        <td style={{ padding: '10px 14px', color: '#475569' }}>{r.to_stock}</td>
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
                            background: isNonMoving ? '#fee2e2' : isSlowMoving ? '#fef3c7' : '#dcfce7',
                            color: isNonMoving ? '#dc2626' : isSlowMoving ? '#b45309' : '#15803d'
                          }}>
                            {r.aging_status_label || `Active (${r.days_in_stock} days)`}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>
                          ${(r.unit_price || 0).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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

      {/* ── TAB 4: FIFO Violations Audit ──────────────────────────────────── */}
      {activeTab === 'fifo' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>
                FIFO Violations Audit — &quot;FIFO Violation (Older Stock Exists)&quot;
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Exact replication of Column I formula: <code>COUNTIFS(D:D, PartNo, A:A, &quot;&lt;&quot;&amp;ReceivedDate, G:G, &quot;&quot;) &gt; 0</code> — repairs where a newer part was consumed while an older unit of the same Part Number received earlier at the same branch remains unused in stock.
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
                  <th style={{ padding: '10px 14px' }}>Branch</th>
                  <th style={{ padding: '10px 14px' }}>Part Number</th>
                  <th style={{ padding: '10px 14px' }}>Part Description</th>
                  <th style={{ padding: '10px 14px' }}>Consumed Serial</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Received Date</th>
                  <th style={{ padding: '10px 14px', textAlign: 'center' }}>Repair Closed Date</th>
                  <th style={{ padding: '10px 14px' }}>Order Number</th>
                  <th style={{ padding: '10px 14px' }}>Older Unused Stock Bypassed (Still In Stock)</th>
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
                  paginatedList.map((r, idx) => {
                    const olderSerials = r.fifo_violation_reasons || [];

                    return (
                      <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
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
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace' }}>{r.gsx_order_id}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {olderSerials.slice(0, 3).map((old, oIdx) => (
                              <div key={oIdx} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                                  {old.olderSerial}
                                </span>
                                <span style={{ color: '#64748b' }}>
                                  (Received: {old.olderArrival}{old.olderDaysInStock !== undefined ? `, idle ${old.olderDaysInStock}d` : ''})
                                </span>
                              </div>
                            ))}
                            {olderSerials.length > 3 && (
                              <span style={{ fontSize: '10.5px', color: '#64748b', fontStyle: 'italic' }}>
                                + {olderSerials.length - 3} more older in-stock serials
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

      {/* ── TAB 5: Master Reconciliation Ledger ('KGB Used Serials') ──────── */}
      {activeTab === 'ledger' && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                KGB Used Serials Master Reconciliation Ledger
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Replicates the <code>KGB Used Serials</code> worksheet (2,962 rows) plus branch FIFO Remarks &amp; Aging Status.
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
                  <th style={{ padding: '10px 12px' }}>Transfer Received Date</th>
                  <th style={{ padding: '10px 12px' }}>From Stock</th>
                  <th style={{ padding: '10px 12px' }}>To Stock</th>
                  <th style={{ padding: '10px 12px' }}>Serial Used by: (Col D)</th>
                  <th style={{ padding: '10px 12px' }}>Part Number</th>
                  <th style={{ padding: '10px 12px' }}>Part Description</th>
                  <th style={{ padding: '10px 12px' }}>Transferred Serial</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Repair Closed Date</th>
                  <th style={{ padding: '10px 12px' }}>Order Number</th>
                  <th style={{ padding: '10px 12px' }}>Remarks (Col I)</th>
                  <th style={{ padding: '10px 12px' }}>Status (Col J)</th>
                </tr>
              </thead>
              <tbody>
                {paginatedList.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      No records match the selected filters.
                    </td>
                  </tr>
                ) : (
                  paginatedList.map((r, idx) => {
                    const isVio = r.fifo_status.includes('VIOLATION');
                    const isUsed = r.is_used;

                    return (
                      <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '9px 12px' }}>{r.transfer_received_date}</td>
                        <td style={{ padding: '9px 12px', color: '#64748b', fontSize: '11px' }}>{r.from_stock}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 600 }}>{r.to_stock}</td>
                        <td style={{
                          padding: '9px 12px',
                          fontSize: '11.5px',
                          color: r.is_cross_site_discrepancy ? '#7c3aed' : '#0f172a',
                          fontWeight: r.is_cross_site_discrepancy ? 700 : 400
                        }}>
                          {r.serial_used_by_label || '—'}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                          {r.product_code}
                        </td>
                        <td style={{ padding: '9px 12px' }}>{r.product_name}</td>
                        <td style={{ padding: '9px 12px', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                          {r.serial_number}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                          {r.repair_closed_date || '—'}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: 'Consolas, monospace' }}>
                          {r.gsx_order_id || '—'}
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            background: isVio ? '#fee2e2' : isUsed ? '#dcfce7' : '#fef3c7',
                            color: isVio ? '#dc2626' : isUsed ? '#15803d' : '#b45309'
                          }}>
                            {r.remarks}
                          </span>
                        </td>
                        <td style={{
                          padding: '9px 12px',
                          fontWeight: 700,
                          fontSize: '11px',
                          color: r.aging_category === 'NON_MOVING' ? '#dc2626' : r.aging_category === 'SLOW_MOVING' ? '#b45309' : '#64748b'
                        }}>
                          {r.aging_status_label || (r.is_used ? '' : `Active (${r.days_in_stock}d)`)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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

      {/* ── TAB 6: Cross-Site Discrepancies & Automated Data Validations ──── */}
      {activeTab === 'discrepancies' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Automated Data Validation Summary Cards */}
          {validations && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '14px' }}>
              <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #f59e0b' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#0f172a', marginBottom: '4px' }}>
                  Validation Check 1: Duplicate DC Stock Transfer Serials ({validations.duplicateTransferSerialsCount})
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '8px' }}>
                  Serials transferred more than once from DC in Fixably. All rows are preserved to maintain exact parity with <code>KGB Used Serials</code> (2,962 rows).
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(validations.duplicateTransferSerials || []).map(sn => (
                    <span key={sn} style={{ fontFamily: 'Consolas, monospace', fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                      {sn}
                    </span>
                  ))}
                </div>
              </div>

              <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #0284c7' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#0f172a', marginBottom: '4px' }}>
                  Validation Check 2: Part Numbers Returning $0 in Sheet35 ({validations.missingPricePartsCount})
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '8px' }}>
                  Part numbers not present in <code>Sheet35!P2:P24490</code> (e.g., Adhesives/Screws or regional <code>661-XXXXX</code> display variants) where <code>XLOOKUP(..., 0)</code> evaluates to <code>$0</code>.
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxHeight: '64px', overflowY: 'auto' }}>
                  {(validations.missingPriceParts || []).map(pn => (
                    <span key={pn} style={{ fontFamily: 'Consolas, monospace', fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                      {pn}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#7c3aed' }}>
                  Cross-Site Consumption Discrepancies (&quot;Transferred to ...&quot;)
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Replicates <code>&apos;KGB Used Serials&apos;!D2</code> formula: <code>IF((cc &lt;&gt; &quot;&quot;) * ISERROR(SEARCH(standard_j, cc)), &quot;Transferred to &quot; &amp; cc, cc)</code>.
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
                    <th style={{ padding: '10px 14px' }}>To Stock (Col C)</th>
                    <th style={{ padding: '10px 14px' }}>Serial Used by: (Col D)</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Transfer Date</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Repair Closed Date</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Order Number</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedList.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#15803d' }}>
                        <CheckCircle2 size={28} color="#15803d" style={{ margin: '0 auto 8px' }} />
                        <div style={{ fontWeight: 700 }}>Zero Cross-Site Discrepancies Found</div>
                      </td>
                    </tr>
                  ) : (
                    paginatedList.map((r, idx) => (
                      <tr key={`${r.serial_number}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 700, color: '#0f172a' }}>
                          {r.serial_number}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                          {r.product_code}
                        </td>
                        <td style={{ padding: '10px 14px' }}>{r.product_name}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#dc2626' }}>
                          {r.to_stock}
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#7c3aed' }}>
                          {r.serial_used_by_label}
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
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              setPageSize={setPageSize}
              setCurrentPage={setCurrentPage}
              totalItems={targetList.length}
            />
          </div>
        </div>
      )}

      {/* ── TAB 7: Data Sources Spec & Process Enhancement Recommendations ── */}
      {activeTab === 'guide' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Section 1: Required Files & Data Sources */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              1. Required Files, Reports &amp; Data Sources Specification
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: '12.5px', color: '#475569' }}>
              To generate the exact same results as <code>FIFO &amp; (DC stocks only) Aging Stocks Monitoring.xlsx</code> without manual Excel work, the system ingests three data sources (either via <strong>1-Click Full Workbook Upload</strong> or via the two operational report slots):
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: '12px', margin: 0 }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>
                    <th style={{ padding: '10px 12px' }}>Data Source</th>
                    <th style={{ padding: '10px 12px' }}>Origin System / Report Name</th>
                    <th style={{ padding: '10px 12px' }}>Excel Sheet Name</th>
                    <th style={{ padding: '10px 12px' }}>Required Columns</th>
                    <th style={{ padding: '10px 12px' }}>Excel Filter &amp; Transformation Rule</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0284c7' }}>1. Stock Transfer Report</td>
                    <td style={{ padding: '10px 12px' }}>Fixably → <code>Custom reports - Stock Transfers</code></td>
                    <td style={{ padding: '10px 12px', fontFamily: 'Consolas, monospace' }}>Stock Transfer</td>
                    <td style={{ padding: '10px 12px' }}>
                      <code>Transfer Received Date</code>, <code>From Stock</code>, <code>To Stock</code>, <code>Product Code</code>, <code>Product Name</code>, <code>Transfer Quantity</code>, <code>Serial Number</code>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      Filtered via <code>ISNUMBER(SEARCH(&quot;DC&quot;, FromStock))</code> to isolate <strong>DC_MSPI-Owned</strong> transfers (2,962 rows from 3,473 raw rows).
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#7c3aed' }}>2. GSX KBB/KGBs Used Report</td>
                    <td style={{ padding: '10px 12px' }}>Fixably / Apple GSX → <code>Custom reports - GSX KBB / KGBs Used</code></td>
                    <td style={{ padding: '10px 12px', fontFamily: 'Consolas, monospace' }}>KGB Used</td>
                    <td style={{ padding: '10px 12px' }}>
                      <code>Order id</code>, <code>Location Name</code>, <code>Repair Closed Date</code>, <code>Product Code</code>, <code>Product Description</code>, <code>Product KGB</code>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      Filtered to rows where <code>Product Description</code> contains <code>IPHONE</code> and (<code>BATTERY</code> or <code>DISPLAY</code>), then matched by <code>Product KGB</code> serial number via <code>XLOOKUP</code>.
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#15803d' }}>3. Apple Service Price List</td>
                    <td style={{ padding: '10px 12px' }}>Apple GSX Stocking Price Catalog (Built-in)</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'Consolas, monospace' }}>Sheet35</td>
                    <td style={{ padding: '10px 12px' }}>
                      <code>Part Number</code>, <code>Description</code>, <code>Price Type</code> (<code>Stocking Price</code>), <code>Price</code>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      Pre-indexed in <code>src/data/appleStockingPrices.json</code> (5,532 SKUs) and looked up via <code>XLOOKUP(PartNo, Sheet35!$P:$P, Sheet35!$S:$S, 0)</code>.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Recommendations Beyond the Current Excel Workflow */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              2. Audit Findings &amp; Recommendations to Enhance the Process Beyond Excel
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '14px', fontSize: '12.5px' }}>
              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', borderLeft: '4px solid #dc2626' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  1. Standardize Aging Thresholds Across All 26 Branches (Fix BHS 90/60d Anomaly)
                </div>
                <div style={{ color: '#475569' }}>
                  In the Excel workbook, 25 of the 26 branch sheets use <code>&gt;=61 days</code> for Non-Moving and <code>&gt;=31 days</code> for Slow-Moving, whereas the <code>BHS</code> sheet uses <code>&gt;=90 days</code> and <code>&gt;=60 days</code>. Use the <strong>Aging Policy</strong> selector above to switch between <em>Excel Workbook Parity</em> and <em>Uniform 61/31d</em> (which reclassifies 47 BHS units worth $9,353 from Active/Slow-Moving into Slow/Non-Moving).
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  2. Separate Historical Sequence Violations from Currently-In-Stock Violations
                </div>
                <div style={{ color: '#475569' }}>
                  The Excel formula <code>COUNTIFS(D:D, PartNo, A:A, &quot;&lt;&quot;&amp;ReceivedDate, G:G, &quot;&quot;) &gt; 0</code> only flags a violation if the older bypassed part is <strong>still unused today</strong> (<code>G = &quot;&quot;</code>). If a branch skipped an older part last week and consumed that older part yesterday, Excel retroactively erases the violation. Our engine tracks both <code>FIFO_VIOLATION_OLDER_IN_STOCK</code> (Excel parity) and historical sequence order.
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', borderLeft: '4px solid #0284c7' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  3. Enrich Regional Part Numbers Missing in Sheet35 (19 SKUs)
                </div>
                <div style={{ color: '#475569' }}>
                  19 part numbers in the transfer ledger (such as regional display assemblies <code>661-35133</code>, <code>661-44650</code>, <code>661-44662</code>, <code>661-48957</code>, <code>661-57036</code>) are not listed in <code>Sheet35!P2:P24490</code> and therefore evaluate to <code>$0</code> in the Excel cost sum. Adding these regional part numbers to the master price catalog prevents under-reporting of aging inventory value.
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', borderLeft: '4px solid #7c3aed' }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  4. Eliminate Multi-Hop &amp; Unlogged Branch-to-Branch Transfers
                </div>
                <div style={{ color: '#475569' }}>
                  The workbook identified <strong>62 Cross-Site usages</strong> (<code>&quot;Transferred to ...&quot;</code>) where a DC part shipped to one branch was consumed in GSX by another branch (e.g., <code>CDO_MSPI-Owned</code> used by <code>ASP Centrio Mall</code>, or <code>BHS_MSPI-Owned</code> used by <code>APP The Podium</code>), plus <strong>5 duplicate DC transfer serials</strong>. Pre-issuing serial pick-lists in FIFO order before repair closure prevents cross-branch stock drift.
                </div>
              </div>
            </div>
          </div>
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
