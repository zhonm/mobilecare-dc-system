import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  Boxes,
  TrendingUp,
  Truck,
  ArrowUpRight,
  Barcode,
  PackageCheck,
  ShieldCheck,
  Search,
  Building2,
  ChevronRight,
  Calendar,
  Check,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Package,
  BarChart3,
  Layers,
  Sparkles,
  Smartphone,
  FileSpreadsheet,
  Download,
  Upload,
  ChevronDown,
  FileText,
  X,
  Wrench
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine
} from 'recharts';
import { generatePackingListPDF } from '../utils/pdfGenerator';
import {
  exportDashboardReportToExcel,
  exportDashboardReportToPDF,
  exportDcInventoryToExcel,
  exportDcInventoryToPDF
} from '../utils/dashboardReportExporter';
import { captureChartsFromContainer } from '../utils/pdfChartCapture';
import {
  getMasterlistSummary,
  getMasterlistParts,
  getMasterlistSites,
  getAllPartsServiceHubsRanking,
  getMasterlistPartsForSite,
  scanMasterlistData,
  scanKgbMasterlistData,
  setActiveScannedMasterlist,
  IPHONE_CATEGORIES,
  getCategoryBadge
} from '../utils/rawMasterlistScanner';
import {
  parseKgbUsedFile,
  KGB_UPLOAD_HISTORY_DOC_ID,
  DASHBOARD_KGB_INTELLIGENCE_DOC_ID
} from '../utils/kgbConsumptionEngine';
import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage';
import { parseUniversalExcel } from '../utils/excelParser';
import { isPartMatchingCategoryFilter, getCategoryForPart } from '../utils/categoryFilter';
import {
  filterActiveOutboundShipments,
  calculateActiveQueuePartsCount,
  getShipmentRiderName,
  resolveItemStockingPrice
} from '../utils/shipmentHelpers';
import { filterAvailableDcInStockUnits } from '../utils/appContextHelpers';

const USD_TO_PHP_RATE = 57;

// Helper function to calculate calendar days a part has been in DC stock
function calculateDaysInDc(dateString) {
  if (!dateString) return 0;
  const receivedDate = new Date(dateString);
  if (isNaN(receivedDate.getTime())) return 0;
  const now = new Date();
  const diffMs = now.getTime() - receivedDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Module-level in-memory cache so navigating away from DC Overview and back
// preserves KGB Distribution Intelligence immediately without resetting to 0.
let cachedDashboardKgbData = null;
let cachedDashboardKgbStatus = null;

export default function Dashboard() {
  const {
    inventoryUnits = [],
    shipments = [],
    parts = [],
    sites = [],
    categories = [],
    currentUser,
    activePeriod,
    setActivePeriod,
    setActiveTab,
    setShipmentsFilterStatus,
    isAutoRefreshing,
    autoRefreshData,
    isInventoryLoaded,
    activePackDraft,
    supervisorSettings,
    showToast,
    masterlistData,
    setMasterlistData,
    repairUsageRecords = [],
    applyParsedDataset,
    selectedCategories = ['BATTERY', 'DISPLAY'],
    ctOrders = [],
    ctStock = [],
    ctToolAssets = [],
    ctShipments = [],
    ctMovements = [],
    ctSyncStatus
  } = useApp();

  const ctDashboardSummary = useMemo(() => {
    const openOrders = (ctOrders || []).filter(o => o.status === 'ordered' || o.status === 'partially_received').length;
    const consumablesOnHand = (ctStock || []).reduce((sum, s) => sum + (Number(s.qty_on_hand) || 0), 0);
    const lowStockSkus = (ctStock || []).filter(s => {
      const qty = Number(s.qty_on_hand) || 0;
      const min = Number(s.min_stock_threshold ?? 2);
      return qty > 0 && qty <= min;
    }).length;
    const toolsTotal = (ctToolAssets || []).length;
    const toolsAvailable = (ctToolAssets || []).filter(t => t.status === 'available').length;
    const toolsInUse = (ctToolAssets || []).filter(t => t.status === 'in_use').length;
    const activeShipments = (ctShipments || []).filter(s => s.status !== 'delivered' && s.status !== 'cancelled').length;
    const deliveredShipments = (ctShipments || []).filter(s => s.status === 'delivered').length;
    return {
      openOrders,
      consumablesOnHand,
      lowStockSkus,
      toolsTotal,
      toolsAvailable,
      toolsInUse,
      activeShipments,
      totalShipments: (ctShipments || []).length,
      deliveredShipments,
      movementsCount: (ctMovements || []).length
    };
  }, [ctOrders, ctStock, ctToolAssets, ctShipments, ctMovements]);

  const isSuperadmin = Boolean(currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin);
  // PDF Download Selection Modal State (Superadmin exclusive)
  const [pdfSelectModalState, setPdfSelectModalState] = useState(null);

  const handleRequestPrintOrPDF = (shipmentObj, items, siteObj, customOptions = {}) => {
    const includeDeclaration = isSuperadmin
      ? (customOptions?.includeDeclarationForm !== undefined ? customOptions.includeDeclarationForm : true)
      : false;

    const targetShipment = (shipments || []).find(s => s.id === shipmentObj?.id) || shipmentObj;
    const resolvedRider = customOptions.pickupByName || getShipmentRiderName(targetShipment, shipments) || getShipmentRiderName(shipmentObj, shipments);

    const pdfOptions = {
      supervisorName: supervisorSettings?.supervisor_name || targetShipment?.verified_by_name || shipmentObj?.verified_by_name || 'Anjo Alcazar',
      supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
      guardOnDuty: targetShipment?.guard_on_duty || shipmentObj?.guard_on_duty || supervisorSettings?.guard_on_duty,
      pickupDate: targetShipment?.pickup_date || targetShipment?.shipment_date || shipmentObj?.pickup_date || shipmentObj?.shipment_date,
      pickupByName: resolvedRider,
      allShipments: shipments,
      parts: parts,
      ...customOptions,
      includeDeclarationForm: includeDeclaration
    };

    const sourceItems = items && items.length > 0 ? items : (targetShipment?.items || shipmentObj?.items || []);
    generatePackingListPDF(targetShipment, sourceItems, siteObj || {}, pdfOptions);
    if (includeDeclaration) {
      showToast?.(`Downloaded 2-Page PDF (Packing List + Declaration Form) for ${targetShipment?.invoice_ref || shipmentObj?.invoice_ref || 'manifest'}`, 'info');
    } else {
      showToast?.(`Downloaded Packing List PDF (PL Only) for ${targetShipment?.invoice_ref || shipmentObj?.invoice_ref || 'manifest'}`, 'info');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW & FILTER STATES
  // ─────────────────────────────────────────────────────────────────────────
  const [reportTab, setReportTab] = useState('top-parts'); // 'top-parts' | 'top-sites' | 'site-parts'
  const [selectedSiteName, setSelectedSiteName] = useState('');
  const [reportCategory, setReportCategory] = useState('ALL');
  const [reportSearch, setReportSearch] = useState('');
  const [reportSortBy, setReportSortBy] = useState('units'); // 'units' | 'valuation' | 'name'
  const [reportLimit, setReportLimit] = useState(10); // 10 | 25 | 50 | 'ALL'

  // DC Snapshot Table State
  const [tableSearch, setTableSearch] = useState('');
  const [activeSnapshotFilter, setActiveSnapshotFilter] = useState('ALL');

  // Masterlist Direct Ingestion State
  const fileInputRef = useRef(null);
  const distributionIntelligenceRef = useRef(null);
  const [isUploadingMasterlist, setIsUploadingMasterlist] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // DC WAREHOUSE INVENTORY TELEMETRY & 4-DAY AGING
  // ─────────────────────────────────────────────────────────────────────────
  // Active Outbound Shipments: strictly pending or shipped/in_transit (Received shipments excluded)
  const activeShipments = useMemo(() => {
    return filterActiveOutboundShipments(shipments);
  }, [shipments]);

  // Active queue parts count: parts in active draft + parts in pending/shipped shipments (excludes received)
  const activeQueueUnitsCount = useMemo(() => {
    return calculateActiveQueuePartsCount(activePackDraft, activeShipments);
  }, [activePackDraft, activeShipments]);

  // Available physical IN-STOCK units in DC Warehouse (fully synchronized with DC Stock Records & Scan-In Station)
  const availableInStockUnits = useMemo(() => {
    return filterAvailableDcInStockUnits({
      inventoryUnits,
      activePackDraft,
      shipments,
      sites
    });
  }, [inventoryUnits, activePackDraft, shipments, sites]);

  // Total DC Warehouse Stock Valuation in USD (calculated directly using Apple stocking prices & parts catalog)
  const totalDcStockValuationUSD = useMemo(() => {
    return (availableInStockUnits || []).reduce((sum, u) => {
      const price = resolveItemStockingPrice(u, parts);
      return sum + (Number(price) || 0);
    }, 0);
  }, [availableInStockUnits, parts]);

  const { agingUnits, freshUnits } = useMemo(() => {
    const aging = [];
    const fresh = [];
    availableInStockUnits.forEach(u => {
      const days = calculateDaysInDc(u.received_at || u.created_at || u.intake_date || u.date);
      if (days >= 4) {
        aging.push({ ...u, daysInDc: days });
      } else {
        fresh.push({ ...u, daysInDc: days });
      }
    });
    return { agingUnits: aging, freshUnits: fresh };
  }, [availableInStockUnits]);

  // ─────────────────────────────────────────────────────────────────────────
  // DISTRIBUTION INTELLIGENCE: UNIFIED FIXABLY MULTI-FILE INGESTION CENTER
  // (Sourced from Slot 2: GSX KGB Used Report — Daily Operational Data)
  // ─────────────────────────────────────────────────────────────────────────
  const [kgbMasterlistData, setKgbMasterlistDataState] = useState(() => cachedDashboardKgbData);
  const [kgbIngestionStatus, setKgbIngestionStatusState] = useState(() => (
    cachedDashboardKgbStatus || {
      status: 'loading', // 'loading' | 'verified' | 'pending' | 'registry_synced' | 'missing' | 'error'
      fileName: '',
      updatedAt: null,
      rowCount: 0,
      duplicatesRemoved: 0,
      errorMessage: null
    }
  ));
  const setKgbMasterlistData = useCallback((val) => {
    const next = typeof val === 'function' ? val(cachedDashboardKgbData) : val;
    cachedDashboardKgbData = next;
    setKgbMasterlistDataState(next);
  }, []);
  const setKgbIngestionStatus = useCallback((val) => {
    setKgbIngestionStatusState((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      cachedDashboardKgbStatus = next;
      return next;
    });
  }, []);
  const [dailyTrendRange, setDailyTrendRange] = useState('14D');

  const loadKgbMasterlist = useCallback(async (forceRefresh = false) => {
    try {
      const periodLabel = typeof activePeriod === 'string'
        ? activePeriod
        : (activePeriod?.label || 'Daily KGB Used Report');

      const [slotKgb, cloudKgb, cachedKgb, uploadHistory, altUploadHistory, gsxRecords, gsxMeta] = await Promise.all([
        dbStorage.getItem('mdc_uploaded_slot_kgb_used').catch(() => null),
        dbStorage.getItem('mdc_cloud_kgb_masterlist').catch(() => null),
        dbStorage.getItem('mdc_kgb_masterlist_cache').catch(() => null),
        dbStorage.getItem(KGB_UPLOAD_HISTORY_DOC_ID).catch(() => null),
        dbStorage.getItem('mdc_kgb_upload_history').catch(() => null),
        dbStorage.getItem('mdc_gsx_used_records').catch(() => null),
        dbStorage.getItem('mdc_gsx_used_meta').catch(() => null)
      ]);

      const resolvedHistory = (Array.isArray(uploadHistory) && uploadHistory.length > 0)
        ? uploadHistory
        : (Array.isArray(altUploadHistory) && altUploadHistory.length > 0 ? altUploadHistory : []);
      const latestHist = resolvedHistory[0] || null;

      // Validation Check: If Slot 2 has a validation error
      if (slotKgb && slotKgb.error) {
        setKgbMasterlistData(null);
        setKgbIngestionStatus({
          status: 'error',
          fileName: slotKgb.name || 'GSX KGB Used Report',
          updatedAt: slotKgb.updatedAt || null,
          rowCount: 0,
          duplicatesRemoved: 0,
          errorMessage: slotKgb.error
        });
        return;
      }

      const slotHasContent = Boolean(slotKgb && slotKgb.valid && slotKgb.content);
      const slotTs = slotHasContent && slotKgb.updatedAt ? new Date(slotKgb.updatedAt).getTime() : 0;
      const initialCloudTs = cloudKgb?.sourceUpdatedAt ? new Date(cloudKgb.sourceUpdatedAt).getTime() : 0;

      // Fast non-blocking hydration from IndexedDB before querying Supabase,
      // so slow/timed-out cloud queries never blank out the dashboard on page navigation.
      if (cloudKgb && cloudKgb.totalUnits > 0 && (!slotHasContent || initialCloudTs >= slotTs)) {
        setKgbMasterlistData(cloudKgb);
        setKgbIngestionStatus({
          status: 'verified',
          fileName: cloudKgb.sourceFileName || latestHist?.fileName || 'GSX KGB Used Report',
          updatedAt: cloudKgb.sourceUpdatedAt || latestHist?.uploadDate || null,
          rowCount: cloudKgb.totalRawRows || 0,
          duplicatesRemoved: cloudKgb.duplicatesRemoved || 0,
          errorMessage: null
        });
      } else if (cachedKgb && cachedKgb.source === 'UNIFIED_KGB_USED' && cachedKgb.totalUnits > 0) {
        setKgbMasterlistData(cachedKgb);
        setKgbIngestionStatus({
          status: slotKgb?.pendingUpload ? 'pending' : 'verified',
          fileName: cachedKgb.sourceFileName || latestHist?.fileName || 'GSX KGB Used Report',
          updatedAt: cachedKgb.sourceUpdatedAt || latestHist?.uploadDate || null,
          rowCount: slotKgb?.rowCount || cachedKgb.totalRawRows || 0,
          duplicatesRemoved: cachedKgb.duplicatesRemoved || 0,
          errorMessage: null
        });
      }

      let resolvedCloudKgb = cloudKgb;
      if (supabase) {
        try {
          // Lightweight 50-byte header check so stale local caches always detect newer cloud uploads
          const { data: remoteHeader, error: hdrErr } = await supabase
            .from('saved_records')
            .select('id, updated_at')
            .eq('id', DASHBOARD_KGB_INTELLIGENCE_DOC_ID)
            .maybeSingle();

          const localCloudTs = resolvedCloudKgb?.sourceUpdatedAt ? new Date(resolvedCloudKgb.sourceUpdatedAt).getTime() : 0;
          const remoteTs = remoteHeader?.updated_at ? new Date(remoteHeader.updated_at).getTime() : 0;

          if (!hdrErr && remoteHeader && (!resolvedCloudKgb || forceRefresh || remoteTs > localCloudTs || (resolvedCloudKgb.sourceDocId && resolvedCloudKgb.sourceDocId !== DASHBOARD_KGB_INTELLIGENCE_DOC_ID))) {
            const { data: remoteIntelDoc, error: remoteIntelErr } = await supabase
              .from('saved_records')
              .select('snapshot_data, updated_at')
              .eq('id', DASHBOARD_KGB_INTELLIGENCE_DOC_ID)
              .maybeSingle();
            if (!remoteIntelErr && remoteIntelDoc?.snapshot_data && remoteIntelDoc.snapshot_data.totalUnits > 0) {
              resolvedCloudKgb = {
                ...remoteIntelDoc.snapshot_data,
                sourceDocId: DASHBOARD_KGB_INTELLIGENCE_DOC_ID,
                sourceUpdatedAt: remoteIntelDoc.snapshot_data.sourceUpdatedAt || remoteIntelDoc.updated_at || new Date().toISOString()
              };
              dbStorage.setItem('mdc_cloud_kgb_masterlist', resolvedCloudKgb, { skipLocalStorage: true }).catch(() => {});
            }
          } else if (!hdrErr && !remoteHeader && !resolvedCloudKgb) {
            // Secondary cloud fallback: check rec-fifo_gsx_used_registry if canonical doc is not yet published
            const { data: fifoGsxDoc } = await supabase
              .from('saved_records')
              .select('snapshot_data, updated_at')
              .eq('id', 'rec-fifo_gsx_used_registry')
              .maybeSingle();
            const fifoRecs = fifoGsxDoc?.snapshot_data?.records;
            if (Array.isArray(fifoRecs) && fifoRecs.length > 0) {
              const fifoMeta = fifoGsxDoc.snapshot_data.metadata || {};
              const scannedFifo = scanKgbMasterlistData(fifoRecs, {
                periodLabel,
                sourceFileName: fifoMeta.fileName || latestHist?.fileName || 'GSX KGB Used Report',
                sourceUpdatedAt: fifoMeta.uploadedAt || fifoGsxDoc.updated_at || latestHist?.uploadDate || new Date().toISOString()
              });
              if (scannedFifo && scannedFifo.totalUnits > 0) {
                scannedFifo.sourceDocId = 'rec-fifo_gsx_used_registry';
                resolvedCloudKgb = scannedFifo;
                dbStorage.setItem('mdc_cloud_kgb_masterlist', resolvedCloudKgb, { skipLocalStorage: true }).catch(() => {});
              }
            }
          }
        } catch (remoteErr) {
          console.debug('[Dashboard] Direct cloud KGB intelligence fetch note:', remoteErr?.message || remoteErr);
        }
      }

      const cloudTs = resolvedCloudKgb?.sourceUpdatedAt ? new Date(resolvedCloudKgb.sourceUpdatedAt).getTime() : 0;

      // Priority 1: Canonical Cloud KGB Intelligence Snapshot (when present & at least as fresh as local Slot 2)
      // Ensures every admin user (including Private Mode / fresh browsers) sees identical metrics.
      if (resolvedCloudKgb && resolvedCloudKgb.totalUnits > 0 && (!slotHasContent || cloudTs >= slotTs)) {
        setKgbMasterlistData(resolvedCloudKgb);
        setKgbIngestionStatus({
          status: 'verified',
          fileName: resolvedCloudKgb.sourceFileName || latestHist?.fileName || 'GSX KGB Used Report',
          updatedAt: resolvedCloudKgb.sourceUpdatedAt || latestHist?.uploadDate || null,
          rowCount: resolvedCloudKgb.totalRawRows || 0,
          duplicatesRemoved: resolvedCloudKgb.duplicatesRemoved || 0,
          errorMessage: null
        });
        return;
      }

      // Priority 2: Local Slot 2 (GSX KGB Used Report) in Unified Fixably Multi-File Ingestion Center
      if (slotHasContent) {
        const slotUpdatedAt = slotKgb.updatedAt || latestHist?.uploadDate || new Date().toISOString();
        const isPending = Boolean(slotKgb.pendingUpload);

        const publishKgbIntelligenceIfNewer = (intelObj) => {
          if (!supabase || isPending || !intelObj || intelObj.totalUnits <= 0) return;
          if (!resolvedCloudKgb || slotTs > cloudTs) {
            dbStorage.setItem('mdc_cloud_kgb_masterlist', intelObj, { skipLocalStorage: true }).catch(() => {});
            supabase.from('saved_records').upsert({
              id: DASHBOARD_KGB_INTELLIGENCE_DOC_ID,
              record_type: 'dashboard_kgb_intelligence',
              period_label: 'Dashboard KGB Intelligence',
              period_year: new Date().getFullYear(),
              period_month: new Date().getMonth() + 1,
              notes: `Canonical KGB Used Report snapshot (${intelObj.sourceFileName || 'GSX KGB Used Report'})`,
              saved_by_name: currentUser?.fullName || currentUser?.name || currentUser?.email || 'Super Admin',
              snapshot_data: intelObj,
              updated_at: slotUpdatedAt
            }, { onConflict: 'id' }).then(({ error }) => {
              if (error) console.warn('[Dashboard] Background KGB intelligence publish warning:', error.message);
            }).catch(() => {});
          }
        };

        // Fast Cache Path: Avoid re-parsing 18k+ CSV rows if cache matches current slot timestamp & file
        if (
          !forceRefresh &&
          cachedKgb &&
          cachedKgb.source === 'UNIFIED_KGB_USED' &&
          cachedKgb.sourceUpdatedAt === slotUpdatedAt &&
          cachedKgb.sourceFileName === (slotKgb.name || 'GSX KGB Used Report') &&
          cachedKgb.totalUnits > 0
        ) {
          publishKgbIntelligenceIfNewer(cachedKgb);
          setKgbMasterlistData(cachedKgb);
          setKgbIngestionStatus({
            status: isPending ? 'pending' : 'verified',
            fileName: cachedKgb.sourceFileName,
            updatedAt: slotUpdatedAt,
            rowCount: slotKgb.rowCount || cachedKgb.totalRawRows || 0,
            duplicatesRemoved: cachedKgb.duplicatesRemoved || 0,
            errorMessage: null
          });
          return;
        }

        const parsed = await parseKgbUsedFile(slotKgb.content);
        if (parsed.success && Array.isArray(parsed.records) && parsed.records.length > 0) {
          const scanned = scanKgbMasterlistData(parsed.records, {
            periodLabel,
            sourceFileName: slotKgb.name || 'GSX KGB Used Report',
            sourceUpdatedAt: slotUpdatedAt,
            contentHash: parsed.contentHash || slotKgb.contentHash || ''
          });
          if (scanned) {
            scanned.duplicatesRemoved = (scanned.duplicatesRemoved || 0) + (parsed.duplicatesInFileCount || 0);
            dbStorage.setItem('mdc_kgb_masterlist_cache', scanned, { skipLocalStorage: true }).catch(() => {});
            publishKgbIntelligenceIfNewer(scanned);
            setKgbMasterlistData(scanned);
            setKgbIngestionStatus({
              status: isPending ? 'pending' : 'verified',
              fileName: scanned.sourceFileName,
              updatedAt: slotUpdatedAt,
              rowCount: parsed.validRowCount || slotKgb.rowCount || 0,
              duplicatesRemoved: scanned.duplicatesRemoved || 0,
              errorMessage: null
            });
            return;
          }
        }
      }

      // Priority 3: Synced GSX Used Records from Unified Ingestion Center (when available)
      const fallbackRecords = (Array.isArray(gsxRecords) && gsxRecords.length > 0) ? gsxRecords : null;

      if (fallbackRecords && fallbackRecords.length > 0) {
        const regUpdatedAt = gsxMeta?.uploadedAt || latestHist?.uploadDate || null;
        const regFileName = gsxMeta?.fileName || latestHist?.fileName || 'Synced GSX KGB Used Report';

        if (
          !forceRefresh &&
          cachedKgb &&
          cachedKgb.source === 'UNIFIED_KGB_USED' &&
          cachedKgb.sourceUpdatedAt === regUpdatedAt &&
          cachedKgb.totalRawRows === fallbackRecords.length &&
          cachedKgb.totalUnits > 0
        ) {
          setKgbMasterlistData(cachedKgb);
          setKgbIngestionStatus({
            status: 'registry_synced',
            fileName: regFileName,
            updatedAt: regUpdatedAt,
            rowCount: fallbackRecords.length,
            duplicatesRemoved: cachedKgb.duplicatesRemoved || 0,
            errorMessage: null
          });
          return;
        }

        const scanned = scanKgbMasterlistData(fallbackRecords, {
          periodLabel,
          sourceFileName: regFileName,
          sourceUpdatedAt: regUpdatedAt
        });
        if (scanned && scanned.totalUnits > 0) {
          dbStorage.setItem('mdc_kgb_masterlist_cache', scanned, { skipLocalStorage: true }).catch(() => {});
          setKgbMasterlistData(scanned);
          setKgbIngestionStatus({
            status: 'registry_synced',
            fileName: regFileName,
            updatedAt: regUpdatedAt,
            rowCount: fallbackRecords.length,
            duplicatesRemoved: scanned.duplicatesRemoved || 0,
            errorMessage: null
          });
          return;
        }
      }

      // No KGB Used Report uploaded yet
      setKgbMasterlistData(null);
      setKgbIngestionStatus({
        status: 'missing',
        fileName: '',
        updatedAt: null,
        rowCount: 0,
        duplicatesRemoved: 0,
        errorMessage: null
      });
    } catch (err) {
      console.error('[Dashboard] Failed to load Unified KGB Used Report:', err);
      setKgbIngestionStatus(prev => ({
        ...prev,
        status: 'error',
        errorMessage: err?.message || 'Unable to load KGB Used Report.'
      }));
    }
  }, [activePeriod, currentUser?.email, currentUser?.fullName, currentUser?.name, setKgbIngestionStatus, setKgbMasterlistData]);

  useEffect(() => {
    loadKgbMasterlist(false);
  }, [loadKgbMasterlist, isInventoryLoaded]);

  useEffect(() => {
    const handleStorage = (e) => {
      if (
        e.key === 'mdc_uploaded_slot_kgb_used_ts' ||
        e.key === 'mdc_uploaded_slot_kgb_used'
      ) {
        loadKgbMasterlist(true);
      }
    };
    const handleCloudKgbSynced = () => {
      loadKgbMasterlist(true);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('mdc_kgb_cloud_synced', handleCloudKgbSynced);

    let kgbChannel = null;
    let fifoChannel = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        kgbChannel = new BroadcastChannel('mdc_kgb_sync');
        kgbChannel.onmessage = (event) => {
          if (event?.data?.type === 'KGB_USED_UPDATED') {
            loadKgbMasterlist(true);
          }
        };
        fifoChannel = new BroadcastChannel('mdc_fifo_audit_sync');
        fifoChannel.onmessage = (event) => {
          if (event?.data?.slotKey === 'kgb_used' || event?.data?.clearedAll) {
            loadKgbMasterlist(true);
          }
        };
      } catch (_) {}
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('mdc_kgb_cloud_synced', handleCloudKgbSynced);
      try { kgbChannel?.close(); } catch (_) {}
      try { fifoChannel?.close(); } catch (_) {}
    };
  }, [loadKgbMasterlist]);

  const activeMasterlist = useMemo(() => {
    if (kgbMasterlistData && kgbMasterlistData.totalUnits !== undefined) {
      return kgbMasterlistData;
    }
    return {
      source: 'UNIFIED_KGB_USED',
      periodLabel: typeof activePeriod === 'string' ? activePeriod : (activePeriod?.label || 'Daily KGB Used Report'),
      totalRecords: 0,
      totalUnits: 0,
      totalValUSD: 0,
      totalValPHP: 0,
      totalDistinctParts: 0,
      totalSites: 0,
      categoryStats: {
        'Battery': 0,
        'Display': 0,
        'Rear System & Logic': 0,
        'Camera': 0,
        'Back Glass': 0,
        'Component': 0
      },
      sites: [],
      partsSummary: [],
      topParts: [],
      dailyTrends: [],
      dailyTrendSummary: {}
    };
  }, [kgbMasterlistData, activePeriod]);

  const visibleDailyTrends = useMemo(() => {
    const all = activeMasterlist?.dailyTrends || [];
    if (dailyTrendRange === '14D') return all.slice(-14);
    if (dailyTrendRange === '30D') return all.slice(-30);
    return all;
  }, [activeMasterlist, dailyTrendRange]);

  const masterSummary = useMemo(() => getMasterlistSummary(activeMasterlist, activePeriod), [activeMasterlist, activePeriod]);

  const masterPartsReport = useMemo(() => {
    return getMasterlistParts({
      category: reportCategory,
      categories: selectedCategories,
      search: reportSearch,
      limit: reportLimit,
      sortBy: reportSortBy
    }, activeMasterlist, activePeriod);
  }, [reportCategory, selectedCategories, reportSearch, reportLimit, reportSortBy, activeMasterlist, activePeriod]);

  const masterSitesReport = useMemo(() => {
    return getMasterlistSites({
      search: reportSearch,
      limit: reportLimit,
      categories: selectedCategories
    }, activeMasterlist, activePeriod);
  }, [reportSearch, reportLimit, selectedCategories, activeMasterlist, activePeriod]);

  // Default to the top site by demand volume (which is at the top of the dropdown list, e.g. VERTIS NORTH)
  const topSiteName = masterSitesReport.topSite?.siteName || masterSitesReport.all?.[0]?.siteName || '';
  const effectiveSelectedSite = (selectedSiteName && masterSitesReport.all?.some(s => s.siteName === selectedSiteName))
    ? selectedSiteName
    : topSiteName;

  useEffect(() => {
    if (topSiteName && (!selectedSiteName || !masterSitesReport.all?.some(s => s.siteName === selectedSiteName))) {
      setSelectedSiteName(topSiteName);
    }
  }, [topSiteName, selectedSiteName, masterSitesReport.all]);

  const sitePartsReport = useMemo(() => {
    return getMasterlistPartsForSite(effectiveSelectedSite, {
      category: reportCategory,
      categories: selectedCategories,
      search: reportSearch,
      limit: reportLimit,
      sortBy: reportSortBy
    }, activeMasterlist, activePeriod);
  }, [effectiveSelectedSite, reportCategory, selectedCategories, reportSearch, reportLimit, reportSortBy, activeMasterlist, activePeriod]);

  // Category Distribution for Donut Chart
  const categoryChartData = useMemo(() => {
    const raw = masterSummary.categoryStats || {};
    const colors = {
      'Battery': '#10b981',
      'Display': '#0284c7',
      'Rear System & Logic': '#6366f1',
      'Camera': '#ec4899',
      'Back Glass': '#14b8a6',
      'Component': '#64748b'
    };

    return Object.entries(raw).map(([cat, count]) => ({
      name: cat,
      count,
      color: colors[cat] || '#64748b'
    })).sort((a, b) => b.count - a.count);
  }, [masterSummary]);

  const [hubRankBy, setHubRankBy] = useState('demand'); // 'demand' | 'revenue' | 'income'

  const allPartsHubsReport = useMemo(() => {
    return getAllPartsServiceHubsRanking({
      sortBy: hubRankBy,
      limit: 'ALL'
    }, activeMasterlist, activePeriod);
  }, [hubRankBy, activeMasterlist, activePeriod]);

  const allPartsHubsTableReport = useMemo(() => {
    return getAllPartsServiceHubsRanking({
      sortBy: hubRankBy,
      search: reportSearch,
      limit: reportLimit
    }, activeMasterlist, activePeriod);
  }, [hubRankBy, reportSearch, reportLimit, activeMasterlist, activePeriod]);

  // Top 8 Sites for Bar Chart (All Parts Demand, Revenue & Income)
  const topSitesChartData = useMemo(() => {
    return (allPartsHubsReport?.all || []).slice(0, 8).map(s => {
      const label = s.shortName || s.siteName || 'Branch';
      return {
        name: label.length > 12 ? label.substring(0, 12) + '...' : label,
        fullName: label,
        region: s.region,
        'Total Parts': s.totalUnits || 0,
        'Revenue ($k)': Math.round((s.totalRevenueUSD || 0) / 1000),
        'Income ($k)': Math.round((s.totalIncomeUSD || 0) / 1000),
        iphoneUnits: s.iphoneUnits || 0,
        nonIphoneUnits: s.nonIphoneUnits || 0,
        totalRevenueUSD: s.totalRevenueUSD || 0,
        totalRevenuePHP: s.totalRevenuePHP || 0,
        totalIncomeUSD: s.totalIncomeUSD || 0,
        totalIncomePHP: s.totalIncomePHP || 0
      };
    });
  }, [allPartsHubsReport]);

  // DC Stock Grouped Snapshot Table
  const groupedInventory = useMemo(() => {
    const map = new Map();
    availableInStockUnits.forEach(u => {
      const pn = String(u.part_number || '').toUpperCase();
      const days = calculateDaysInDc(u.received_at || u.created_at || u.intake_date || u.date);

      if (!map.has(pn)) {
        const partObj = parts.find(p => p.part_number?.toUpperCase() === pn);
        const description = u.description || partObj?.description || 'iPhone Replacement Component';
        const catObj = getCategoryForPart({
          part_number: pn,
          description,
          category_id: partObj?.category_id || u.category_id || u.category
        }, categories);
        const stockPriceUSD = resolveItemStockingPrice(u, parts);

        map.set(pn, {
          part_number: pn,
          description,
          category: catObj?.name || 'General',
          category_name: catObj?.name || 'General',
          category_code: catObj?.code || 'GENERAL',
          category_id: catObj?.id || partObj?.category_id || 'cat-other',
          stockPriceUSD,
          units: [],
          maxDaysInDc: days,
          agingCount: 0,
          freshCount: 0,
          latest_serial: u.serial_number
        });
      }
      const entry = map.get(pn);
      entry.units.push(u);
      if (days >= 4) {
        entry.agingCount++;
      } else {
        entry.freshCount++;
      }
      if (days > entry.maxDaysInDc) {
        entry.maxDaysInDc = days;
      }
    });

    let list = Array.from(map.values()).map(entry => {
      const totalValUSD = entry.stockPriceUSD * entry.units.length;
      return {
        ...entry,
        totalValUSD,
        totalValPHP: totalValUSD * USD_TO_PHP_RATE
      };
    }).sort((a, b) => {
      if (b.agingCount !== a.agingCount) return b.agingCount - a.agingCount;
      return b.units.length - a.units.length;
    });

    if (activeSnapshotFilter !== 'ALL') {
      list = list.filter(item => {
        const desc = String(item.description).toUpperCase();
        if (activeSnapshotFilter === 'DISPLAY') return desc.includes('DISPLAY') || desc.includes('SCREEN') || item.category_code === 'DISPLAY';
        if (activeSnapshotFilter === 'BATTERY') return desc.includes('BATTERY') || item.category_code === 'BATTERY';
        if (activeSnapshotFilter === 'CAMERA') return desc.includes('CAMERA') || item.category_code === 'CAMERA';
        if (activeSnapshotFilter === 'AGING') return item.agingCount > 0;
        return true;
      });
    } else if (Array.isArray(selectedCategories) && selectedCategories.length > 0 && selectedCategories.length < 5) {
      list = list.filter(item => isPartMatchingCategoryFilter(item, selectedCategories));
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter(item =>
        item.part_number.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q) ||
        item.latest_serial?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [availableInStockUnits, parts, categories, selectedCategories, activeSnapshotFilter, tableSearch]);

  const filteredSnapshotValuationUSD = useMemo(() => {
    return (groupedInventory || []).reduce((sum, item) => sum + (item.totalValUSD || 0), 0);
  }, [groupedInventory]);

  const recentShipments = (activeShipments || []).slice(0, 6);

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD REPORT EXPORT HANDLERS (XLSX & PDF)
  // ─────────────────────────────────────────────────────────────────────────
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const handleExportExcel = async (mode = 'current') => {
    try {
      setIsExportingExcel(true);
      const tabTitle =
        reportTab === 'top-parts'
          ? 'Top iPhone Parts'
          : reportTab === 'top-sites'
          ? 'Service Hubs Network'
          : `Branch Parts (${effectiveSelectedSite})`;

      const currentPeriodLabel = typeof activePeriod === 'string'
        ? activePeriod
        : (activePeriod?.label || `${new Date().toLocaleString('en-US', { month: 'long' })} ${new Date().getFullYear()}`);

      const partsReportToExport = mode === 'all'
        ? getMasterlistParts({ category: 'ALL', categories: null, search: '', limit: 'ALL', sortBy: 'units' }, activeMasterlist, activePeriod)
        : masterPartsReport;

      const sitesReportToExport = mode === 'all'
        ? getAllPartsServiceHubsRanking({ sortBy: hubRankBy, search: '', limit: 'ALL' }, activeMasterlist, activePeriod)
        : (reportTab === 'top-sites' ? allPartsHubsTableReport : allPartsHubsReport);

      let chartImages = [];
      try {
        chartImages = await captureChartsFromContainer(
          typeof document !== 'undefined' ? (document.querySelector('.dashboard-page') || document.body) : null
        );
      } catch {
        chartImages = [];
      }

      await exportDashboardReportToExcel({
        activeTab: reportTab,
        masterPartsReport: partsReportToExport,
        masterSitesReport: sitesReportToExport,
        sitePartsReport,
        masterSummary,
        selectedSiteName: effectiveSelectedSite,
        reportCategory: mode === 'all' ? 'ALL' : reportCategory,
        reportSearch: mode === 'all' ? '' : reportSearch,
        periodLabel: currentPeriodLabel,
        exportMode: mode,
        chartImages
      });

      showToast?.(
        mode === 'all'
          ? `Complete Masterlist Intelligence Package (${partsReportToExport.totalCount} SKUs, ${sitesReportToExport.totalSitesCount} sites) exported to Excel (.xlsx)`
          : `${tabTitle} exported to Excel (.xlsx)`,
        'success'
      );
    } catch (err) {
      console.error('Error exporting dashboard report to Excel:', err);
      showToast?.('Failed to export Excel report: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportPDF = async (mode = 'current') => {
    try {
      setIsExportingPDF(true);
      const tabTitle =
        reportTab === 'top-parts'
          ? 'Top iPhone Parts'
          : reportTab === 'top-sites'
          ? 'Service Hubs Network'
          : `Branch Parts (${effectiveSelectedSite})`;

      const currentPeriodLabel = typeof activePeriod === 'string'
        ? activePeriod
        : (activePeriod?.label || `${new Date().toLocaleString('en-US', { month: 'long' })} ${new Date().getFullYear()}`);

      const partsReportToExport = mode === 'all'
        ? getMasterlistParts({ category: 'ALL', categories: null, search: '', limit: 'ALL', sortBy: 'units' }, activeMasterlist, activePeriod)
        : masterPartsReport;

      const sitesReportToExport = mode === 'all'
        ? getAllPartsServiceHubsRanking({ sortBy: hubRankBy, search: '', limit: 'ALL' }, activeMasterlist, activePeriod)
        : (reportTab === 'top-sites' ? allPartsHubsTableReport : allPartsHubsReport);

      const chartImages = await captureChartsFromContainer(
        typeof document !== 'undefined' ? (document.querySelector('.dashboard-page') || document.body) : null
      );

      exportDashboardReportToPDF({
        activeTab: reportTab,
        masterPartsReport: partsReportToExport,
        masterSitesReport: sitesReportToExport,
        sitePartsReport,
        masterSummary,
        selectedSiteName: effectiveSelectedSite,
        reportCategory: mode === 'all' ? 'ALL' : reportCategory,
        reportSearch: mode === 'all' ? '' : reportSearch,
        periodLabel: currentPeriodLabel,
        exportMode: mode,
        supervisorSettings,
        chartImages
      });

      showToast?.(
        mode === 'all'
          ? `Complete Masterlist PDF (${partsReportToExport.totalCount} SKUs, ${sitesReportToExport.totalSitesCount} sites) exported`
          : `${tabTitle} exported to Corporate PDF`,
        'success'
      );
    } catch (err) {
      console.error('Error generating dashboard PDF report:', err);
      showToast?.('Failed to generate PDF report: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setIsExportingPDF(false);
    }
  };

  const handleExportDcInventoryExcel = async () => {
    try {
      await exportDcInventoryToExcel(groupedInventory, {
        filter: activeSnapshotFilter,
        search: tableSearch
      });
      showToast?.('DC Warehouse Stock Inventory exported to Excel (.xlsx)', 'success');
    } catch (err) {
      console.error('Error exporting DC Inventory:', err);
      showToast?.('Failed to export DC inventory: ' + (err.message || 'Unknown error'), 'error');
    }
  };

  const handleExportDcInventoryPDF = () => {
    try {
      exportDcInventoryToPDF(groupedInventory, {
        filter: activeSnapshotFilter,
        search: tableSearch,
        supervisorSettings
      });
      showToast?.('DC Warehouse Stock Inventory exported to PDF', 'success');
    } catch (err) {
      console.error('Error exporting DC Inventory PDF:', err);
      showToast?.('Failed to generate DC inventory PDF: ' + (err.message || 'Unknown error'), 'error');
    }
  };

  const handleQuickMasterlistUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCleared = typeof window !== 'undefined' && localStorage.getItem('mdc_is_cleared') === 'true';
    const hasData = !isCleared && Boolean(
      (masterlistData && masterlistData.totalUnits > 0) ||
      (repairUsageRecords && repairUsageRecords.length > 0)
    );

    if (hasData) {
      showToast?.('Upload Locked: Existing operational data detected. Please delete current data in Fixably & GSX Data Import before uploading a new dataset.', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setIsUploadingMasterlist(true);
      const parsed = await parseUniversalExcel(file);

      // Determine rows/records to scan
      let rowsToScan = [];
      if (parsed.payload?.records && parsed.payload.records.length > 0) {
        rowsToScan = parsed.payload.records;
      } else if (parsed.records && parsed.records.length > 0) {
        rowsToScan = parsed.records;
      } else if (parsed.rawMasterlistRecords && parsed.rawMasterlistRecords.length > 0) {
        rowsToScan = parsed.rawMasterlistRecords;
      } else if (parsed.rawMasterlistRows && parsed.rawMasterlistRows.length > 0) {
        rowsToScan = parsed.rawMasterlistRows;
      } else if (parsed.rawUsageRows && parsed.rawUsageRows.length > 0) {
        rowsToScan = parsed.rawUsageRows;
      } else if (parsed.allocationRows && parsed.allocationRows.length > 0) {
        rowsToScan = parsed.allocationRows;
      }

      // Dynamically resolve target period from uploaded file (October, November, etc.)
      const monthNamesList = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const nowDate = new Date();
      const rawPeriodLabel = typeof activePeriod === 'string'
        ? activePeriod
        : (activePeriod?.label || `${monthNamesList[nowDate.getMonth()]} ${nowDate.getFullYear()}`);
      const matchedMonthIdx = monthNamesList.findIndex(m => rawPeriodLabel.toLowerCase().includes(m.toLowerCase()));
      const yearMatch = rawPeriodLabel.match(/\b(202[0-9]|203[0-9])\b/);

      const detectedPeriod = parsed.detectedPeriod || (
        typeof activePeriod === 'object' && activePeriod?.label
          ? {
              ...activePeriod,
              month: matchedMonthIdx !== -1 ? matchedMonthIdx + 1 : (activePeriod.month || nowDate.getMonth() + 1),
              year: yearMatch ? parseInt(yearMatch[1], 10) : (activePeriod.year || nowDate.getFullYear())
            }
          : {
              month: matchedMonthIdx !== -1 ? matchedMonthIdx + 1 : nowDate.getMonth() + 1,
              year: yearMatch ? parseInt(yearMatch[1], 10) : nowDate.getFullYear(),
              label: rawPeriodLabel
            }
      );
      const periodLabel = detectedPeriod.label || (typeof activePeriod === 'string' ? activePeriod : activePeriod?.label) || 'Current Period';

      const scanned = scanMasterlistData(rowsToScan, {
        periodLabel
      });

      if (scanned && scanned.totalUnits > 0) {
        setMasterlistData(scanned);
        setActiveScannedMasterlist(scanned);
        if (setActivePeriod) {
          setActivePeriod(detectedPeriod);
        }
        // Write masterlist data AND timestamps so cloud sync guards correctly
        // see local as the freshest copy (prevents reversion on refresh)
        const uploadTimestamp = new Date().toISOString();
        try {
          localStorage.setItem('mdc_masterlist_data', JSON.stringify(scanned));
          localStorage.setItem('mdc_active_period', JSON.stringify(detectedPeriod));
          // Mark when the masterlist was last locally updated (used by cloud sync egress guard)
          localStorage.setItem('mdc_masterlist_updated_at', uploadTimestamp);
          // Mark recent local override so hydration skips overwriting for 5 minutes
          localStorage.setItem('mdc_last_override_time', Date.now().toString());
        } catch (_) {}

        // Always sync to Supabase so all users get the updated masterlist on refresh
        // (previously only synced for admin/superadmin — non-admin uploads were lost on refresh)
        if (applyParsedDataset) {
          try {
            await applyParsedDataset(parsed, {
              period: periodLabel,
              target_month: periodLabel,
              period_month: detectedPeriod.month,
              period_year: detectedPeriod.year,
              filename: file.name
            });
          } catch (syncErr) {
            console.warn('Pipeline background sync notice:', syncErr);
          }
        }

        showToast?.(
          `Masterlist loaded successfully: ${scanned.totalUnits.toLocaleString()} units, ${scanned.totalDistinctParts} SKUs across ${scanned.totalSites} hubs`,
          'success'
        );
      } else {
        showToast?.('No valid iPhone repair records found in the uploaded file.', 'error');
      }
    } catch (err) {
      console.error('Error importing masterlist file:', err);
      showToast?.('Failed to import masterlist: ' + (err.message || 'File read error'), 'error');
    } finally {
      setIsUploadingMasterlist(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="dashboard-view" style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      
      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 1. EXECUTIVE OPERATIONS HEADER BANNER                              */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
          color: '#ffffff',
          padding: '22px 28px',
          border: '1px solid #334155',
          borderRadius: '12px',
          boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.4)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Smartphone size={20} color="#38bdf8" />
                <h2 style={{ color: '#fff', fontSize: '21px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                  Distribution Center Operations
                </h2>
              </div>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <ShieldCheck size={13} />
                {currentUser?.role ? currentUser.role.toUpperCase() : 'SUPERADMIN'}
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
              Unified Fixably KGB Used Report: <strong style={{ color: '#38bdf8' }}>{masterSummary.totalUnits.toLocaleString()} iPhone Repairs</strong> • <strong style={{ color: '#f1f5f9' }}>{masterSummary.totalDistinctParts} Active iPhone SKUs</strong> across <strong style={{ color: '#f1f5f9' }}>{masterSummary.totalSites} Service Hubs</strong>
              {kgbIngestionStatus.updatedAt && (
                <span style={{ color: '#cbd5e1', marginLeft: '8px', fontSize: '12px' }}>
                  • Refreshed {new Date(kgbIngestionStatus.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".xlsx,.xls,.csv"
              onChange={handleQuickMasterlistUpload}
            />

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingMasterlist}
              title="Upload Fixably/GSX raw masterlist or allocation file (.xlsx / .csv) to dynamically update dashboard analytics"
              style={{
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#38bdf8',
                padding: '6px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isUploadingMasterlist ? 'not-allowed' : 'pointer'
              }}
            >
              <Upload size={13} className={isUploadingMasterlist ? 'spin' : ''} />
              <span>{isUploadingMasterlist ? 'Importing Masterlist...' : 'Import Masterlist File'}</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, isManual: true, reason: 'Dashboard manual refresh' })}
              disabled={isAutoRefreshing}
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid #334155',
                color: '#38bdf8',
                padding: '6px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Refresh Telemetry'}</span>
            </button>

            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid #334155',
                padding: '6px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#cbd5e1'
              }}
            >
              <Calendar size={14} color="#38bdf8" />
              <span>{typeof activePeriod === 'string' ? activePeriod : (activePeriod?.label || `${new Date().toLocaleString('en-US', { month: 'long' })} ${new Date().getFullYear()}`)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4-Day Aging Alert Banner if units exist */}
      {agingUnits.length > 0 && (
        <div
          style={{
            background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
            border: '1px solid #fde68a',
            borderRadius: '10px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.08)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#f59e0b', color: '#fff', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#92400e', display: 'flex', alignItems: 'center' }}>
                <span>DC Aging Alert: {agingUnits.length} Part{agingUnits.length > 1 ? 's' : ''} in DC Warehouse for ≥ 4 Days</span>
              </div>
              <div style={{ fontSize: '12px', color: '#b45309', marginTop: '3px' }}>
                <strong>Operational Visibility Notice:</strong> These parts have been on-hand in DC for 4 or more days. All inventory records remain 100% permanent, safe, and intact (no parts are ever deleted by the system). Please pack and dispatch them for site delivery as needed.
              </div>
            </div>
          </div>

          <button
            className="btn btn-primary btn-sm"
            onClick={() => setActiveTab('scan-out')}
            style={{
              background: '#d97706',
              borderColor: '#b45309',
              fontWeight: 700,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <PackageCheck size={14} />
            <span>Pack Outbound Shipments</span>
          </button>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 2. EXECUTIVE 4-CARD SUMMARY METRICS ROW                           */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '18px'
        }}
      >
        {/* Card 1: DC Available In-Stock */}
        <div
          className="kpi-card"
          style={{
            borderLeft: `4px solid ${agingUnits.length > 0 ? '#f59e0b' : '#0284c7'}`,
            cursor: 'pointer'
          }}
          onClick={() => setActiveTab('scan-in')}
          title="Click to open Receive Scan-In Station"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">DC In-Stock Inventory</span>
            <div style={{ padding: '8px', background: agingUnits.length > 0 ? '#fef3c7' : '#e0f2fe', borderRadius: '8px', color: agingUnits.length > 0 ? '#f59e0b' : '#0284c7' }}>
              <Boxes size={20} />
            </div>
          </div>
          <div
            className="kpi-value"
            style={{
              color: '#0f172a',
              fontSize: '30px',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <div>
              {availableInStockUnits.length.toLocaleString()} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>{availableInStockUnits.length === 1 ? 'unit' : 'units'}</span>
            </div>
            <div
              style={{
                fontSize: '20px',
                fontWeight: 800,
                color: '#047857',
                fontFamily: 'var(--font-sans)',
                letterSpacing: '-0.01em'
              }}
            >
              ${totalDcStockValuationUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>USD</span>
            </div>
          </div>
          <div className="kpi-sub">
            {availableInStockUnits.length === 0 ? (
              <span style={{ color: '#047857', fontWeight: 600 }}>Clean Pipeline (0 in DC • $0.00 USD)</span>
            ) : (
              <>
                <span style={{ color: '#047857', fontWeight: 700 }}>
                  ${totalDcStockValuationUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </span>{' '}
                <span style={{ color: '#64748b', fontWeight: 500 }}>
                  (₱{(totalDcStockValuationUSD * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })})
                </span>
                {' '}•{' '}
                {agingUnits.length > 0 ? (
                  <span
                    style={{ color: '#b45309', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    title="Operational awareness alert only: All parts records remain 100% permanent and intact."
                  >
                    <Clock size={12} /> {agingUnits.length} Aging (≥4d in DC) • {freshUnits.length} Fresh
                  </span>
                ) : (
                  <span style={{ color: '#047857', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={12} /> All {availableInStockUnits.length} Units Fresh (&lt;4d in DC)
                  </span>
                )}
              </>
            )}
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(availableInStockUnits.length * 5, 100)}%`, background: agingUnits.length > 0 ? '#f59e0b' : '#0284c7' }} />
          </div>
        </div>

        {/* Card 2: Total iPhone Master Demand */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #10b981',
            cursor: 'pointer'
          }}
          onClick={() => {
            setReportTab('top-parts');
          }}
          title="Click to view all iPhone Top Parts"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Total Parts Used</span>
            <div style={{ padding: '8px', background: '#dcfce7', borderRadius: '8px', color: '#10b981' }}>
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {masterSummary.totalUnits.toLocaleString()} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>units</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#047857', fontWeight: 700 }}>
              ${(masterSummary.totalValuationUSD / 1000000).toFixed(2)}M
            </span>{' '}
            (₱{(masterSummary.totalValuationPHP / 1000000).toFixed(1)}M) • {masterSummary.totalDistinctParts} iPhone SKUs
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: '#10b981' }} />
          </div>
        </div>

        {/* Card 3: Outbound Shipments */}
        <div
          className="kpi-card"
          style={{
            borderLeft: `4px solid ${activeShipments.length > 0 ? '#f59e0b' : '#10b981'}`,
            cursor: 'pointer'
          }}
          onClick={() => {
            if (setShipmentsFilterStatus) setShipmentsFilterStatus('shipped');
            setActiveTab('shipments');
          }}
          title="Click to view In-Transit Outbound Shipments"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Outbound Shipments</span>
            <div style={{ padding: '8px', background: activeShipments.length > 0 ? '#fef3c7' : '#ecfdf5', borderRadius: '8px', color: activeShipments.length > 0 ? '#f59e0b' : '#059669' }}>
              <Truck size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {activeShipments.length} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>{activeShipments.length === 1 ? 'shipment' : 'shipments'}</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: activeShipments.length > 0 || activeQueueUnitsCount > 0 ? '#b45309' : '#059669', fontWeight: 700 }}>
              {activeQueueUnitsCount} {activeQueueUnitsCount === 1 ? 'part' : 'parts'} in queue
            </span>{' '}
            • {activeShipments.length > 0 ? 'Dispatched via Lalamove / Lite Exp' : 'All shipments received at sites'}
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(activeShipments.length * 20, 100)}%`, background: activeShipments.length > 0 ? '#f59e0b' : '#10b981' }} />
          </div>
        </div>

        {/* Card 4: Service Hubs Network */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #8b5cf6',
            cursor: 'pointer'
          }}
          onClick={() => {
            setReportTab('top-sites');
          }}
          title="Click to view all Service Hubs"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Service Hubs Network</span>
            <div style={{ padding: '8px', background: '#ede9fe', borderRadius: '8px', color: '#8b5cf6' }}>
              <Building2 size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {masterSummary.totalSites} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>branches</span>
          </div>
          <div className="kpi-sub">
            Top Hub:{' '}
            <span style={{ color: '#6d28d9', fontWeight: 700 }}>
              {masterSitesReport.topSite
                ? `${masterSitesReport.topSite.shortName} (${masterSitesReport.topSite.totalUnits.toLocaleString()} units)`
                : 'No hub data'}
            </span>
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: '#8b5cf6' }} />
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 2B. DAILY TREND ANALYSIS (FROM DAILY KGB USED REPORT)             */}
      {/* ───────────────────────────────────────────────────────────────── */}
      {visibleDailyTrends.length > 0 && (
        <div
          className="card"
          style={{
            padding: '22px 24px',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 6px 16px -4px rgba(15, 23, 42, 0.04)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <TrendingUp size={18} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                    Daily iPhone Parts Consumption Trend
                  </h3>
                  <span
                    className="badge"
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 9px',
                      borderRadius: '999px',
                      background: '#eff6ff',
                      color: '#0369a1',
                      border: '1px solid #bae6fd'
                    }}
                  >
                    {activeMasterlist.dailyTrendSummary?.totalActiveDays || visibleDailyTrends.length} Active Days
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '3px 0 0 0' }}>
                  Daily operational repair volume tracked from Repair Closed Date in the GSX KGB Used Report
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '9px', border: '1px solid #e2e8f0', gap: '2px' }}>
              {[
                { key: '14D', label: '14 Days' },
                { key: '30D', label: '30 Days' },
                { key: 'ALL', label: 'All Days' }
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDailyTrendRange(opt.key)}
                  style={{
                    border: 'none',
                    background: dailyTrendRange === opt.key ? '#0f172a' : 'transparent',
                    color: dailyTrendRange === opt.key ? '#ffffff' : '#475569',
                    padding: '6px 13px',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4 Compact Daily Summary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderTop: '3px solid #0284c7', borderRadius: '10px', padding: '11px 14px' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Latest Day ({activeMasterlist.dailyTrendSummary?.latestLabel || '—'})
              </div>
              <div style={{ fontSize: '21px', fontWeight: 800, color: '#0284c7', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {(activeMasterlist.dailyTrendSummary?.latestUnits || 0).toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>units</span>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderTop: '3px solid #6366f1', borderRadius: '10px', padding: '11px 14px' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                7-Day Daily Avg
              </div>
              <div style={{ fontSize: '21px', fontWeight: 800, color: '#0f172a', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {(activeMasterlist.dailyTrendSummary?.avgDailyUnits7d || 0).toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>units/day</span>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderTop: '3px solid #10b981', borderRadius: '10px', padding: '11px 14px' }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Peak Day ({activeMasterlist.dailyTrendSummary?.peakDay?.label || '—'})
              </div>
              <div style={{ fontSize: '21px', fontWeight: 800, color: '#059669', marginTop: '4px', fontVariantNumeric: 'tabular-nums' }}>
                {(activeMasterlist.dailyTrendSummary?.peakDay?.units || 0).toLocaleString()} <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>units</span>
              </div>
            </div>
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderTop: `3px solid ${
                  activeMasterlist.dailyTrendSummary?.dayOverDayPct == null
                    ? '#94a3b8'
                    : activeMasterlist.dailyTrendSummary.dayOverDayPct >= 0
                      ? '#10b981'
                      : '#ef4444'
                }`,
                borderRadius: '10px',
                padding: '11px 14px'
              }}
            >
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Day-over-Day
              </div>
              <div
                style={{
                  fontSize: '21px',
                  fontWeight: 800,
                  marginTop: '4px',
                  fontVariantNumeric: 'tabular-nums',
                  color: activeMasterlist.dailyTrendSummary?.dayOverDayPct == null
                    ? '#64748b'
                    : activeMasterlist.dailyTrendSummary.dayOverDayPct >= 0
                      ? '#059669'
                      : '#dc2626'
                }}
              >
                {activeMasterlist.dailyTrendSummary?.dayOverDayPct == null
                  ? '—'
                  : `${activeMasterlist.dailyTrendSummary.dayOverDayPct >= 0 ? '+' : ''}${activeMasterlist.dailyTrendSummary.dayOverDayPct}%`}
              </div>
            </div>
          </div>

          <div style={{ height: '250px', width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visibleDailyTrends} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="kgbDailyUnitsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.28} />
                    <stop offset="65%" stopColor="#38bdf8" stopOpacity={0.08} />
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  width={42}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => Number(v).toLocaleString()}
                />
                {activeMasterlist.dailyTrendSummary?.avgDailyUnits7d > 0 && (
                  <ReferenceLine
                    y={activeMasterlist.dailyTrendSummary.avgDailyUnits7d}
                    stroke="#6366f1"
                    strokeDasharray="4 4"
                    strokeOpacity={0.65}
                    label={{
                      value: `7d Avg: ${activeMasterlist.dailyTrendSummary.avgDailyUnits7d}`,
                      position: 'insideTopRight',
                      fill: '#6366f1',
                      fontSize: 10.5,
                      fontWeight: 700
                    }}
                  />
                )}
                <Tooltip
                  cursor={{ stroke: '#0284c7', strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0]?.payload || {};
                    return (
                      <div
                        style={{
                          background: '#0f172a',
                          color: '#f8fafc',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.25)',
                          border: '1px solid #334155',
                          fontSize: '12px',
                          minWidth: '185px'
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '6px', borderBottom: '1px solid #334155', paddingBottom: '4px' }}>
                          {row.date || row.label} • {row.activeSites || 0} active hubs
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '2px' }}>
                          <span style={{ color: '#94a3b8' }}>iPhone Parts Used</span>
                          <strong style={{ color: '#38bdf8' }}>{Number(row.units || 0).toLocaleString()} units</strong>
                        </div>
                        {typeof row.valuationUSD === 'number' && row.valuationUSD > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
                            <span style={{ color: '#94a3b8' }}>Est. Valuation</span>
                            <strong style={{ color: '#34d399' }}>${Number(row.valuationUSD).toLocaleString()}</strong>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="units"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  fill="url(#kgbDailyUnitsGrad)"
                  dot={visibleDailyTrends.length <= 16 ? { r: 3, fill: '#ffffff', stroke: '#0284c7', strokeWidth: 2 } : false}
                  activeDot={{ r: 5, fill: '#0284c7', stroke: '#ffffff', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 2C. ANALYTICS ROW: CATEGORY DISTRIBUTION & TOP HUBS DEMAND BARS   */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="dashboard-analytics-grid">
        {/* Left: Category Breakdown Donut */}
        <div
          className="card"
          style={{
            padding: '22px 24px',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 6px 16px -4px rgba(15, 23, 42, 0.04)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Layers size={17} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  iPhone Demand by Category
                </h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
                  Distribution of {masterSummary.totalUnits.toLocaleString()} iPhone repairs across component families
                </p>
              </div>
            </div>
            <span
              className="badge badge-primary"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '999px',
                background: '#eff6ff',
                color: '#0369a1',
                border: '1px solid #bae6fd',
                whiteSpace: 'nowrap'
              }}
            >
              {masterSummary.totalUnits.toLocaleString()} Repairs
            </span>
          </div>

          <div className="dashboard-category-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', minHeight: '245px' }}>
            <div style={{ width: '48%', height: '235px', minWidth: 0, position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={86}
                    paddingAngle={2.5}
                    cornerRadius={4}
                    dataKey="count"
                    isAnimationActive={false}
                  >
                    {categoryChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="#ffffff" strokeWidth={2} />
                    ))}
                  </Pie>
                  <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" fill="#0f172a" fontSize={18} fontWeight={800}>
                    {masterSummary.totalUnits.toLocaleString()}
                  </text>
                  <text x="50%" y="57%" textAnchor="middle" dominantBaseline="central" fill="#64748b" fontSize={10} fontWeight={700}>
                    TOTAL UNITS
                  </text>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const item = payload[0]?.payload || {};
                      const totalDemand = masterSummary.totalUnits || 1;
                      const pct = ((Number(item.count || 0) / totalDemand) * 100).toFixed(1);
                      return (
                        <div
                          style={{
                            background: '#0f172a',
                            color: '#f8fafc',
                            padding: '9px 13px',
                            borderRadius: '9px',
                            boxShadow: '0 10px 25px rgba(15, 23, 42, 0.25)',
                            border: '1px solid #334155',
                            fontSize: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '3px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.color }} />
                            <span>{item.name}</span>
                          </div>
                          <div style={{ color: '#cbd5e1' }}>
                            <strong style={{ color: '#ffffff' }}>{Number(item.count || 0).toLocaleString()}</strong> repairs ({pct}%)
                          </div>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Custom Legend with Proportional Share Bars */}
            <div style={{ width: '52%', display: 'flex', flexDirection: 'column', gap: '9px', maxHeight: '240px', overflowY: 'auto', paddingRight: '2px' }}>
              {categoryChartData.map(item => {
                const totalDemand = masterSummary.totalUnits || 1;
                const pct = Math.round((item.count / totalDemand) * 100);
                return (
                  <div
                    key={item.name}
                    data-chart-legend-item="true"
                    data-legend-label={`${item.name} (${pct}%)`}
                    data-legend-color={item.color}
                    style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                      </div>
                      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        <strong style={{ color: '#0f172a' }}>{item.count.toLocaleString()}</strong>{' '}
                        <span style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>({pct}%)</span>
                      </div>
                    </div>
                    <div style={{ height: '4px', width: '100%', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(pct, 2)}%`, background: item.color, borderRadius: '999px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Top 8 Hubs All-Parts Demand, Revenue & Income Bar Chart */}
        <div
          className="card"
          style={{
            padding: '22px 24px',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 6px 16px -4px rgba(15, 23, 42, 0.04)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={17} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  Top Service Hubs • All Parts Demand &amp; Revenue
                </h3>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
                  All-parts demand ({allPartsHubsReport.grandTotalUnits.toLocaleString()} units), revenue &amp; income per branch
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', background: '#f1f5f9', padding: '2px', borderRadius: '8px', border: '1px solid #e2e8f0', gap: '2px' }}>
                {[
                  { key: 'demand', label: 'Demand' },
                  { key: 'revenue', label: 'Revenue' }
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setHubRankBy(opt.key)}
                    style={{
                      border: 'none',
                      background: hubRankBy === opt.key ? '#0f172a' : 'transparent',
                      color: hubRankBy === opt.key ? '#ffffff' : '#475569',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setReportTab('top-sites');
                  setReportLimit('ALL');
                  setTimeout(() => {
                    distributionIntelligenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 50);
                }}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <span>View All {allPartsHubsReport.totalSitesCount || masterSitesReport?.totalSitesCount || 28} Hubs</span>
                <ArrowUpRight size={13} />
              </button>
            </div>
          </div>

          {/* Top Performer Highlight Strip */}
          {allPartsHubsReport.topByDemand && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '7px 10px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>
                  #1 Parts Demand
                </div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {allPartsHubsReport.topByDemand.shortName}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#0284c7', fontVariantNumeric: 'tabular-nums' }}>
                  {allPartsHubsReport.topByDemand.totalUnits.toLocaleString()} units
                </div>
              </div>

              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '7px 10px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
                  #1 Revenue
                </div>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {allPartsHubsReport.topByRevenue?.shortName || '—'}
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>
                  ${Math.round(allPartsHubsReport.topByRevenue?.totalRevenueUSD || 0).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          <div style={{ height: '220px', width: '100%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSitesChartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }} barGap={3} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={48}
                  tick={{ fontSize: 10.5, fill: '#475569', fontWeight: 600 }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis
                  width={42}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => Number(v).toLocaleString()}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0]?.payload || {};
                    return (
                      <div
                        style={{
                          background: '#0f172a',
                          color: '#f8fafc',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.25)',
                          border: '1px solid #334155',
                          fontSize: '12px',
                          minWidth: '215px'
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '6px', borderBottom: '1px solid #334155', paddingBottom: '4px' }}>
                          {row.fullName || row.name}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '3px' }}>
                          <span style={{ color: '#94a3b8' }}>Total Parts Demand</span>
                          <strong style={{ color: '#38bdf8' }}>{Number(row['Total Parts'] || 0).toLocaleString()} units</strong>
                        </div>
                        {row.nonIphoneUnits > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '4px', fontSize: '11px', color: '#94a3b8' }}>
                            <span>iPhone / Other Parts</span>
                            <span>{Number(row.iphoneUnits || 0).toLocaleString()} / {Number(row.nonIphoneUnits || 0).toLocaleString()}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '3px' }}>
                          <span style={{ color: '#94a3b8' }}>Revenue Generated</span>
                          <strong style={{ color: '#34d399' }}>
                            ${Math.round(row.totalRevenueUSD || 0).toLocaleString()} (₱{Math.round(row.totalRevenuePHP || 0).toLocaleString()})
                          </strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
                          <span style={{ color: '#94a3b8' }}>Income Generated</span>
                          <strong style={{ color: '#a5b4fc' }}>
                            ${Math.round(row.totalIncomeUSD || 0).toLocaleString()} (₱{Math.round(row.totalIncomePHP || 0).toLocaleString()})
                          </strong>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11.5px', paddingTop: '2px' }} />
                <Bar dataKey="Total Parts" fill="#0284c7" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                <Bar dataKey="Revenue ($k)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 3. MANAGER DISTRIBUTION INTELLIGENCE & REPORTS CENTER             */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        ref={distributionIntelligenceRef}
        className="card"
        style={{
          padding: '24px',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          scrollMarginTop: '16px',
          background: '#ffffff',
          boxShadow: '0 4px 16px -2px rgba(0, 0, 0, 0.05)'
        }}
      >
        {/* Header & Main Navigation Tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '18px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ background: '#eff6ff', color: '#0284c7', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BarChart3 size={20} color="#0284c7" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                    Distribution Intelligence • iPhone Masterlist Reports
                  </h3>
                  {kgbIngestionStatus.status === 'verified' || kgbIngestionStatus.status === 'registry_synced' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#ecfdf5',
                        color: '#047857',
                        border: '1px solid #a7f3d0'
                      }}
                    >
                      <CheckCircle2 size={12} />
                      KGB Used Report Verified
                    </span>
                  ) : kgbIngestionStatus.status === 'pending' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#fffbeb',
                        color: '#b45309',
                        border: '1px solid #fde68a'
                      }}
                    >
                      <Clock size={12} />
                      Pending Upload Processing
                    </span>
                  ) : kgbIngestionStatus.status === 'missing' || kgbIngestionStatus.status === 'error' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: '#fef2f2',
                        color: '#b91c1c',
                        border: '1px solid #fecaca'
                      }}
                    >
                      <AlertTriangle size={12} />
                      {kgbIngestionStatus.status === 'error' ? 'KGB Report Error' : 'KGB Report Required'}
                    </span>
                  ) : null}
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
                  Sourced from Unified Fixably Multi-File Ingestion Center (Slot 2: GSX KGB Used Report) • Daily operational consumption &amp; branch demand
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '6px', fontSize: '11.5px', color: '#475569' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                    <Clock size={12} color="#0284c7" />
                    Last Data Refresh:{' '}
                    <strong style={{ color: '#0f172a' }}>
                      {kgbIngestionStatus.updatedAt
                        ? new Date(kgbIngestionStatus.updatedAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })
                        : 'Not yet uploaded'}
                    </strong>
                  </span>
                  {kgbIngestionStatus.fileName && (
                    <span style={{ color: '#64748b' }}>
                      • File: <strong style={{ color: '#334155' }}>{kgbIngestionStatus.fileName}</strong>
                    </span>
                  )}
                  {kgbIngestionStatus.duplicatesRemoved > 0 && (
                    <span style={{ color: '#047857', fontWeight: 600 }}>
                      • {kgbIngestionStatus.duplicatesRemoved.toLocaleString()} duplicate row{kgbIngestionStatus.duplicatesRemoved === 1 ? '' : 's'} filtered
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3 Clean Report Views with Lucide Icons (No Emojis) */}
          <div
            className="responsive-tabs-scroll"
            style={{
              display: 'flex',
              background: '#f1f5f9',
              padding: '4px',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              gap: '4px',
              maxWidth: '100%',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              flexShrink: 0
            }}
          >
            <button
              type="button"
              onClick={() => setReportTab('top-parts')}
              style={{
                border: 'none',
                background: reportTab === 'top-parts' ? '#0f172a' : 'transparent',
                color: reportTab === 'top-parts' ? '#ffffff' : '#475569',
                padding: '7px 16px',
                borderRadius: '7px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                boxShadow: reportTab === 'top-parts' ? '0 2px 6px rgba(15, 23, 42, 0.25)' : 'none'
              }}
            >
              <Smartphone size={15} />
              <span>Top iPhone Parts ({masterPartsReport.totalCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setReportTab('top-sites')}
              style={{
                border: 'none',
                background: reportTab === 'top-sites' ? '#0f172a' : 'transparent',
                color: reportTab === 'top-sites' ? '#ffffff' : '#475569',
                padding: '7px 16px',
                borderRadius: '7px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                boxShadow: reportTab === 'top-sites' ? '0 2px 6px rgba(15, 23, 42, 0.25)' : 'none'
              }}
            >
              <Building2 size={15} />
              <span>Service Hubs ({masterSitesReport.totalSitesCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setReportTab('site-parts')}
              style={{
                border: 'none',
                background: reportTab === 'site-parts' ? '#0f172a' : 'transparent',
                color: reportTab === 'site-parts' ? '#ffffff' : '#475569',
                padding: '7px 16px',
                borderRadius: '7px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
                boxShadow: reportTab === 'site-parts' ? '0 2px 6px rgba(15, 23, 42, 0.25)' : 'none'
              }}
            >
              <Layers size={15} />
              <span>All Parts Per Site ({sitePartsReport.totalPartsCount})</span>
            </button>
          </div>
        </div>

        {/* Validation Check Banner for Unified Fixably KGB Used Report */}
        {(kgbIngestionStatus.status === 'missing' || kgbIngestionStatus.status === 'error' || kgbIngestionStatus.status === 'pending') && (
          <div
            style={{
              background: kgbIngestionStatus.status === 'pending' ? '#fffbeb' : '#fef2f2',
              border: `1px solid ${kgbIngestionStatus.status === 'pending' ? '#fde68a' : '#fecaca'}`,
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangle size={18} color={kgbIngestionStatus.status === 'pending' ? '#d97706' : '#dc2626'} />
              <div style={{ fontSize: '12.5px', color: kgbIngestionStatus.status === 'pending' ? '#92400e' : '#991b1b' }}>
                {kgbIngestionStatus.status === 'pending' ? (
                  <>
                    <strong>KGB Used Report Pending Processing:</strong>{' '}
                    <span>
                      &ldquo;{kgbIngestionStatus.fileName}&rdquo; is staged in Slot 2 of the Unified Fixably Multi-File Ingestion Center. Click <strong>Upload &amp; Process</strong> or <strong>Sync Consumption</strong> to finalize daily sync.
                    </span>
                  </>
                ) : kgbIngestionStatus.status === 'error' ? (
                  <>
                    <strong>KGB Used Report Validation Failed:</strong>{' '}
                    <span>{kgbIngestionStatus.errorMessage || 'Please re-upload a valid GSX KGB Used Report in Slot 2.'}</span>
                  </>
                ) : (
                  <>
                    <strong>No Daily KGB Used Report Uploaded:</strong>{' '}
                    <span>Upload the latest GSX KGB Used Report in <strong>All Stocks &amp; Inventory → Unified Fixably Multi-File Ingestion Center (Slot 2)</strong> to populate daily Distribution Intelligence reports.</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('all-stocks')}
              style={{
                border: 'none',
                background: kgbIngestionStatus.status === 'pending' ? '#d97706' : '#dc2626',
                color: '#ffffff',
                padding: '7px 14px',
                borderRadius: '7px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap'
              }}
            >
              <Upload size={13} />
              <span>Open Unified Ingestion Center</span>
            </button>
          </div>
        )}

        {/* VIEW 3 TOP SELECTOR: Prominent, Enlarged Site Selector Banner placed at the top */}
        {reportTab === 'site-parts' && (
          <div
            style={{
              background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
              border: '1px solid #cbd5e1',
              borderRadius: '10px',
              padding: '16px 20px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
            }}
          >
            {/* Left Side: Large Dropdown Picker */}
            <div style={{ flex: '1 1 340px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '6px' }}>
                Select Service Branch:
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  className="form-select"
                  value={effectiveSelectedSite}
                  onChange={(e) => setSelectedSiteName(e.target.value)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '2px solid #0284c7',
                    fontSize: '14.5px',
                    fontWeight: 800,
                    color: '#0f172a',
                    background: '#ffffff',
                    width: '100%',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.12)'
                  }}
                >
                  {masterSitesReport.all.map(s => (
                    <option key={s.siteName} value={s.siteName}>
                      {s.shortName} • {s.totalUnits} iPhone units ({s.region})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Right Side: 3 Prominent Branch Metrics */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                  Branch Demand
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7', fontFamily: 'var(--font-sans)' }}>
                  {sitePartsReport.siteTotalUnits.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>units</span>
                </div>
              </div>

              <div style={{ width: '1px', height: '36px', background: '#cbd5e1' }} />

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                  Total Branch Spend
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669', fontFamily: 'var(--font-sans)' }}>
                  ${sitePartsReport.siteTotalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>(₱{(sitePartsReport.siteTotalValPHP / 1000000).toFixed(2)}M)</span>
                </div>
              </div>

              <div style={{ width: '1px', height: '36px', background: '#cbd5e1' }} />

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                  Active SKUs
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#7c3aed', fontFamily: 'var(--font-sans)' }}>
                  {sitePartsReport.totalPartsCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>parts</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clean iPhone Category Filter Pills (shown for parts views, hidden on Service Hubs) */}
        {reportTab !== 'top-sites' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', marginRight: '4px', whiteSpace: 'nowrap' }}>
              Filter Category:
            </span>

            {IPHONE_CATEGORIES.map(cat => {
              const isSelected = reportCategory === cat.key;
              const count = cat.key === 'ALL'
                ? (Array.isArray(selectedCategories) && selectedCategories.length < 5
                    ? masterPartsReport.totalFilteredUnits
                    : masterSummary.totalUnits)
                : (masterSummary.categoryStats[cat.key] || 0);

              const pillLabel = cat.key === 'ALL'
                ? (Array.isArray(selectedCategories) && selectedCategories.length < 5
                    ? 'All Active Categories'
                    : 'All iPhone Parts')
                : cat.label;

              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setReportCategory(cat.key)}
                  style={{
                    border: '1px solid',
                    borderColor: isSelected ? '#0284c7' : '#cbd5e1',
                    background: isSelected ? '#0284c7' : '#ffffff',
                    color: isSelected ? '#ffffff' : '#334155',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: isSelected ? 700 : 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.12s ease'
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap' }}>{pillLabel}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, background: isSelected ? 'rgba(255,255,255,0.22)' : '#f1f5f9', color: isSelected ? '#ffffff' : '#64748b', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filter Controls Bar: Search, Sort, Limit */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
          {/* Left Side: Search Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '320px' }}>
              <Search size={15} style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder={reportTab === 'top-sites' ? 'Search service branch...' : 'Search iPhone part number or model description...'}
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
                style={{
                  padding: '7px 14px 7px 34px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  width: '100%',
                  background: '#f8fafc',
                  color: '#0f172a'
                }}
              />
            </div>
          </div>

          {/* Right Side: Sort & Limit Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Sort By Controls */}
            {reportTab !== 'top-sites' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>Sort by:</span>
                <select
                  value={reportSortBy}
                  onChange={(e) => setReportSortBy(e.target.value)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <option value="units">Demand Volume (High to Low)</option>
                  <option value="valuation">Total Spend (High to Low)</option>
                  <option value="name">Model Name (A to Z)</option>
                </select>
              </div>
            )}

            {/* Display Limit Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
              <span style={{ fontWeight: 600 }}>Rows:</span>
              {[10, 25, 50, 'ALL'].map(lim => (
                <button
                  key={lim}
                  onClick={() => setReportLimit(lim)}
                  style={{
                    border: '1px solid',
                    borderColor: reportLimit === lim ? '#0284c7' : '#cbd5e1',
                    background: reportLimit === lim ? '#e0f2fe' : '#ffffff',
                    color: reportLimit === lim ? '#0369a1' : '#475569',
                    padding: '3px 10px',
                    borderRadius: '5px',
                    fontSize: '11.5px',
                    fontWeight: reportLimit === lim ? 700 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {lim === 'ALL' ? 'All' : lim}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div style={{ width: '1px', height: '22px', background: '#cbd5e1', margin: '0 2px' }} />

            {/* Export Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportExcel('current')}
                disabled={isExportingExcel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#15803d',
                  borderColor: '#86efac',
                  background: '#f0fdf4',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isExportingExcel ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Export active report view to formatted Excel (.xlsx)"
              >
                <FileSpreadsheet size={14} />
                <span>{isExportingExcel ? 'Exporting...' : 'Export XLSX'}</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('current')}
                disabled={isExportingPDF}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#0284c7',
                  borderColor: '#bae6fd',
                  background: '#f0f9ff',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: isExportingPDF ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Download active report view as Corporate PDF"
              >
                <Download size={14} />
                <span>{isExportingPDF ? 'Generating...' : 'Export PDF'}</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportExcel('all')}
                disabled={isExportingExcel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  color: '#475569',
                  borderColor: '#cbd5e1',
                  background: '#ffffff',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: isExportingExcel ? 'not-allowed' : 'pointer'
                }}
                title={`Export Complete Multi-Sheet Masterlist Package (All ${masterSummary.totalDistinctParts} Parts + ${masterSummary.totalSites} Hubs + Summary) to Excel (.xlsx)`}
              >
                <Layers size={13} />
                <span>Full Package</span>
              </button>
            </div>
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* VIEW 1: TOP IPHONE PARTS (NATIONAL MASTERLIST RANKING)            */}
        {/* ───────────────────────────────────────────────────────────────── */}
        {reportTab === 'top-parts' && (
          <div>
            {/* Top Parts Summary Bar */}
            <div
              style={{
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 18px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                  National iPhone Parts Ranking
                </span>
                <span className="badge badge-primary">{masterPartsReport.totalCount} Parts Found</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12.5px', flexWrap: 'wrap' }}>
                <div>
                  Total Demand: <strong style={{ color: '#0284c7', fontFamily: 'var(--font-sans)' }}>{masterPartsReport.totalFilteredUnits.toLocaleString()} units</strong>
                </div>
                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />
                <div>
                  Valuation:{' '}
                  <strong style={{ color: '#10b981', fontFamily: 'var(--font-sans)' }}>
                    ${masterPartsReport.totalFilteredValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </strong>{' '}
                  <span style={{ color: '#64748b' }}>(₱{masterPartsReport.totalFilteredValPHP.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
                </div>
              </div>
            </div>

            {/* Clean, Legible Table (No DC In-Stock / Action Columns) */}
            {masterPartsReport.displayList.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                <Package size={28} color="#94a3b8" style={{ marginBottom: '6px' }} />
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No matching iPhone parts found</div>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>Try adjusting your search query or category filter.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table className="table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ width: '60px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>RANK</th>
                      <th style={{ width: '140px', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>PART NUMBER</th>
                      <th style={{ minWidth: '240px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>IPHONE MODEL & DESCRIPTION</th>
                      <th style={{ width: '180px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>CATEGORY</th>
                      <th style={{ width: '140px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>STOCK PRICE</th>
                      <th style={{ width: '150px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL DEMAND</th>
                      <th style={{ width: '160px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL VALUATION</th>
                      <th style={{ width: '140px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>SHARE OF DEMAND</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masterPartsReport.displayList.map((item, idx) => {
                      const badge = getCategoryBadge(item.category);
                      return (
                        <tr
                          key={item.part_number}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                            transition: 'background 0.1s ease'
                          }}
                        >
                          {/* Rank */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {idx < 3 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  background: idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#64748b',
                                  color: '#ffffff',
                                  fontWeight: 800,
                                  fontSize: '11px'
                                }}
                              >
                                {idx + 1}
                              </span>
                            ) : (
                              <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>#{idx + 1}</span>
                            )}
                          </td>

                          {/* Part Number */}
                          <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, color: '#0f172a', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {item.part_number}
                          </td>

                          {/* Description */}
                          <td style={{ padding: '13px 14px' }}>
                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13.5px' }}>
                              {item.description}
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                              Allocated / consumed across {item.sitesCount} service branches
                            </div>
                          </td>

                          {/* Category Badge - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: badge.bg,
                                color: badge.text,
                                border: `1px solid ${badge.border}`,
                                padding: '5px 12px',
                                borderRadius: '6px',
                                fontWeight: 700,
                                fontSize: '11.5px',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {badge.name}
                            </span>
                          </td>

                          {/* Stocking Price - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>${item.priceUSD}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>₱{(item.priceUSD * USD_TO_PHP_RATE).toLocaleString()}</div>
                          </td>

                          {/* Total Demand - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: '#f0f9ff',
                                color: '#0369a1',
                                border: '1px solid #bae6fd',
                                padding: '5px 14px',
                                borderRadius: '6px',
                                fontWeight: 800,
                                fontSize: '13px',
                                fontFamily: 'var(--font-sans)',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.totalUnits.toLocaleString()} units
                            </span>
                          </td>

                          {/* Total Valuation - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                              ${item.totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              ₱{item.totalValPHP.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                          </td>

                          {/* Share of Demand */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                              <div style={{ width: '45px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(item.pctShare * 6, 100)}%`, height: '100%', background: '#0284c7' }} />
                              </div>
                              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', fontFamily: 'var(--font-sans)' }}>
                                {item.pctShare.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* VIEW 2: ALL SERVICE HUBS (ALL PARTS DEMAND, REVENUE & INCOME)     */}
        {/* ───────────────────────────────────────────────────────────────── */}
        {reportTab === 'top-sites' && (
          <div>
            {/* Summary Bar */}
            <div
              style={{
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 18px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                  Service Branches All-Parts Performance Ranking
                </span>
                <span className="badge badge-primary">{allPartsHubsTableReport.totalSitesCount} Branches</span>
                <div style={{ display: 'flex', background: '#ffffff', padding: '2px', borderRadius: '7px', border: '1px solid #cbd5e1', gap: '2px', marginLeft: '4px' }}>
                  {[
                    { key: 'demand', label: 'Demand' },
                    { key: 'revenue', label: 'Revenue' }
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setHubRankBy(opt.key)}
                      style={{
                        border: 'none',
                        background: hubRankBy === opt.key ? '#0f172a' : 'transparent',
                        color: hubRankBy === opt.key ? '#ffffff' : '#475569',
                        padding: '3px 9px',
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12.5px', flexWrap: 'wrap' }}>
                <div>
                  Total Parts:{' '}
                  <strong style={{ color: '#0284c7' }}>
                    {allPartsHubsTableReport.grandTotalUnits.toLocaleString()} units
                  </strong>
                </div>
                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />
                <div>
                  Network Revenue:{' '}
                  <strong style={{ color: '#059669' }}>
                    ${Math.round(allPartsHubsTableReport.grandTotalRevenueUSD).toLocaleString()}
                  </strong>
                </div>
                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />
                <div>
                  Network Income:{' '}
                  <strong style={{ color: '#4f46e5' }}>
                    ${Math.round(allPartsHubsTableReport.grandTotalIncomeUSD).toLocaleString()}
                  </strong>
                </div>
              </div>
            </div>

            {/* Sites Table */}
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table className="table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ width: '60px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>RANK</th>
                    <th style={{ minWidth: '210px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>SERVICE BRANCH NAME</th>
                    <th style={{ width: '120px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>REGION</th>
                    <th style={{ width: '150px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>ALL PARTS DEMAND</th>
                    <th style={{ width: '120px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>DISTINCT SKUS</th>
                    <th style={{ width: '160px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>REVENUE GENERATED</th>
                    <th style={{ width: '155px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>INCOME GENERATED</th>
                    <th style={{ minWidth: '210px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>TOP CONSUMED PART</th>
                    <th style={{ width: '125px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>NETWORK SHARE</th>
                    <th style={{ width: '105px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>VIEW</th>
                  </tr>
                </thead>
                <tbody>
                  {allPartsHubsTableReport.displayList.map((site, idx) => (
                    <tr
                      key={site.siteName}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                        transition: 'background 0.1s ease'
                      }}
                    >
                      {/* Rank */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        {idx < 3 ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              background: idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#64748b',
                              color: '#ffffff',
                              fontWeight: 800,
                              fontSize: '11px'
                            }}
                          >
                            {idx + 1}
                          </span>
                        ) : (
                          <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>#{idx + 1}</span>
                        )}
                      </td>

                      {/* Branch Name */}
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13.5px' }}>
                          {site.shortName}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                          {site.siteName}
                        </div>
                      </td>

                      {/* Region */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            background: site.isMM ? '#f0f9ff' : '#ecfdf5',
                            color: site.isMM ? '#0369a1' : '#047857',
                            border: site.isMM ? '1px solid #bae6fd' : '1px solid #a7f3d0',
                            padding: '4px 10px',
                            borderRadius: '5px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            display: 'inline-block',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {site.region}
                        </span>
                      </td>

                      {/* Total Units (All Parts) */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            background: '#f0f9ff',
                            color: '#0369a1',
                            border: '1px solid #bae6fd',
                            padding: '5px 12px',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '13px',
                            fontFamily: 'var(--font-sans)',
                            display: 'inline-block',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {site.totalUnits.toLocaleString()} units
                        </span>
                        {site.nonIphoneUnits > 0 && (
                          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '3px' }}>
                            {site.iphoneUnits.toLocaleString()} iPhone • {site.nonIphoneUnits.toLocaleString()} Other
                          </div>
                        )}
                      </td>

                      {/* Distinct SKUs */}
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#475569', padding: '13px 14px', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>
                        {site.distinctPartsCount} SKUs
                      </td>

                      {/* Revenue Generated */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                          ${Math.round(site.totalRevenueUSD || 0).toLocaleString()}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          ₱{Math.round(site.totalRevenuePHP || 0).toLocaleString()}
                        </div>
                      </td>

                      {/* Income Generated */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 800, color: '#4f46e5', fontSize: '13px' }}>
                          ${Math.round(site.totalIncomeUSD || 0).toLocaleString()}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          ₱{Math.round(site.totalIncomePHP || 0).toLocaleString()}
                        </div>
                      </td>

                      {/* Top Part */}
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                          {site.topPart ? `${site.topPart.description || site.topPart.part_number} (${site.topPart.units} units)` : '—'}
                        </div>
                      </td>

                      {/* Share Bar */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                          <div style={{ width: '45px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(site.pctShare * 8, 100)}%`, height: '100%', background: '#0284c7' }} />
                          </div>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', fontFamily: 'var(--font-sans)' }}>
                            {site.pctShare.toFixed(1)}%
                          </span>
                        </div>
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 600 }}
                          onClick={() => {
                            setSelectedSiteName(site.siteName);
                            setReportTab('site-parts');
                          }}
                          title={`Explore all iPhone parts for ${site.shortName}`}
                        >
                          View Parts
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* VIEW 3: ALL IPHONE PARTS PER SITE TABLE                           */}
        {/* ───────────────────────────────────────────────────────────────── */}
        {reportTab === 'site-parts' && (
          <div>
            {/* Branch Parts Table (No DC In-Stock / Action Columns) */}
            {sitePartsReport.displayList.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                <Package size={28} color="#94a3b8" style={{ marginBottom: '6px' }} />
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No matching iPhone parts found for this branch</div>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>Try adjusting your search query or category filter.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table className="table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ width: '60px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>RANK</th>
                      <th style={{ width: '140px', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>PART NUMBER</th>
                      <th style={{ minWidth: '240px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>IPHONE MODEL & DESCRIPTION</th>
                      <th style={{ width: '180px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>CATEGORY</th>
                      <th style={{ width: '140px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>STOCK PRICE</th>
                      <th style={{ width: '150px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>BRANCH DEMAND</th>
                      <th style={{ width: '160px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL BRANCH COST</th>
                      <th style={{ width: '140px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>BRANCH SHARE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sitePartsReport.displayList.map((item, idx) => {
                      const badge = getCategoryBadge(item.category);
                      return (
                        <tr
                          key={item.part_number}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                            transition: 'background 0.1s ease'
                          }}
                        >
                          {/* Rank */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {idx < 3 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  background: idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#64748b',
                                  color: '#ffffff',
                                  fontWeight: 800,
                                  fontSize: '11px'
                                }}
                              >
                                {idx + 1}
                              </span>
                            ) : (
                              <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>#{idx + 1}</span>
                            )}
                          </td>

                          {/* Part Number */}
                          <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, color: '#0f172a', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {item.part_number}
                          </td>

                          {/* Description */}
                          <td style={{ padding: '13px 14px' }}>
                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13.5px' }}>
                              {item.description}
                            </div>
                          </td>

                          {/* Category Badge - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: badge.bg,
                                color: badge.text,
                                border: `1px solid ${badge.border}`,
                                padding: '5px 12px',
                                borderRadius: '6px',
                                fontWeight: 700,
                                fontSize: '11.5px',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {badge.name}
                            </span>
                          </td>

                          {/* Stocking Price - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>${item.priceUSD}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>₱{(item.priceUSD * USD_TO_PHP_RATE).toLocaleString()}</div>
                          </td>

                          {/* Branch Demand - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: '#f0f9ff',
                                color: '#0369a1',
                                border: '1px solid #bae6fd',
                                padding: '5px 14px',
                                borderRadius: '6px',
                                fontWeight: 800,
                                fontSize: '13px',
                                fontFamily: 'var(--font-sans)',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.units.toLocaleString()} units
                            </span>
                          </td>

                          {/* Total Cost - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                              ${item.totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              ₱{(item.totalValUSD * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                          </td>

                          {/* Branch Share */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                              <div style={{ width: '45px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(item.pctShare * 4, 100)}%`, height: '100%', background: '#0284c7' }} />
                              </div>
                              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', fontFamily: 'var(--font-sans)' }}>
                                {item.pctShare.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 5. QUICK WORKSTATION LAUNCHPAD                                    */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div>
        <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} color="var(--primary)" />
          Quick Workstation Launchpad
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          
          <div
            onClick={() => setActiveTab('scan-in')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#0284c7', color: '#fff', borderRadius: '10px' }}>
              <Barcode size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Receive Scan-In</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Barcode intake & spreadsheet manifest</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => setActiveTab('scan-out')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#059669', color: '#fff', borderRadius: '10px' }}>
              <PackageCheck size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Pack Scan-Out</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Generate outbound shipments & PDF</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => {
              if (setShipmentsFilterStatus) setShipmentsFilterStatus('shipped');
              setActiveTab('shipments');
            }}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#d97706', color: '#fff', borderRadius: '10px' }}>
              <Truck size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Outbound Shipments</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Branch dispatches & Lalamove/Lite Exp</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => setActiveTab('allocation')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#7c3aed', color: '#fff', borderRadius: '10px' }}>
              <Building2 size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Allocation Matrix</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Branch demand &amp; weekly splitting</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => setActiveTab('consumables-tools')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#0f172a', color: '#38bdf8', borderRadius: '10px' }}>
              <Wrench size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Consumables &amp; Tools</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Non-repair supplies, tools &amp; PLs</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 6. LIVE OUTBOUND SHIPMENTS FEED                                   */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Recent Outbound Shipments</h3>
              {activeShipments.length > 0 && (
                <span className="badge" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', fontSize: '11px', fontWeight: 700 }}>
                  {activeShipments.length} Active
                </span>
              )}
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              {activeShipments.length > 0
                ? 'Active manifests dispatched or pending branch delivery'
                : 'All outbound manifests have been received and confirmed by destination sites'}
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('shipments')}>
            <span>View All Shipments ({shipments?.length || 0})</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        {recentShipments.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: (shipments || []).length > 0 ? '#ecfdf5' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              {(shipments || []).length > 0 ? (
                <CheckCircle2 size={26} color="#059669" />
              ) : (
                <Truck size={26} color="#94a3b8" />
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
              {(shipments || []).length > 0 ? 'All Outbound Shipments Received' : 'No Outbound Shipments Generated Yet'}
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px auto 16px', maxWidth: '440px' }}>
              {(shipments || []).length > 0
                ? 'All outbound delivery manifests have been successfully received and confirmed by destination service branches.'
                : 'Scan serialized parts in Pack Scan-Out to generate delivery manifests for service branches.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
              {(shipments || []).length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('shipments')}>
                  View Received Shipments
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('scan-out')}>
                Open Pack Scan-Out
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
            {recentShipments.map(sh => {
              const destSite = sites.find(s => s.id === sh.site_id || s.code === sh.site_id) || {};
              const isShipped = sh.status === 'shipped' || sh.status === 'in_transit';
              const isPending = sh.status === 'pending_pickup' || sh.status === 'pending';
              const badgeLabel = isPending ? 'Pending Pickup' : (isShipped ? 'In Transit / Shipped' : (sh.status ? sh.status.replace('_', ' ') : 'Draft'));
              return (
                <div
                  key={sh.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '12px 14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                    minWidth: 0,
                    overflow: 'hidden'
                  }}
                >
                  {/* Top Row: Shipment Identifier and Status Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '13px',
                        color: '#0f172a',
                        fontFamily: 'var(--font-sans)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0
                      }}
                      title={sh.invoice_ref || sh.shipment_number}
                    >
                      {sh.invoice_ref || sh.shipment_number}
                    </div>
                    <span
                      className="badge"
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        background: isShipped ? '#f0f9ff' : (isPending ? '#fffbeb' : '#f1f5f9'),
                        color: isShipped ? '#0369a1' : (isPending ? '#b45309' : '#475569'),
                        border: isShipped ? '1px solid #bae6fd' : (isPending ? '1px solid #fde68a' : '1px solid #e2e8f0'),
                        flexShrink: 0,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {badgeLabel}
                    </span>
                  </div>

                  {/* Bottom Row: Destination Details & Contained PDF Download Button */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '8px', minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        flex: 1
                      }}
                      title={`To: ${destSite.name || sh.site_name || 'Service Hub'} • ${sh.items?.length || sh.total_units || 0} units`}
                    >
                      To: <strong>{destSite.name || sh.site_name || 'Service Hub'}</strong> • {sh.items?.length || sh.total_units || 0} units
                    </div>

                    <button
                      className="btn btn-secondary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 11px',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        flexShrink: 0,
                        borderRadius: '6px',
                        lineHeight: 1.2,
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        if (isSuperadmin) {
                          setPdfSelectModalState({ shipment: sh, items: sh.items, site: destSite });
                        } else {
                          handleRequestPrintOrPDF(sh, sh.items, destSite, { includeDeclarationForm: false });
                        }
                      }}
                      title={isSuperadmin ? "Select document download: PL Only or PL + Declaration Form" : "Download Packing List PDF (PL Only)"}
                    >
                      <Download size={13} />
                      <span>PDF</span>
                      {isSuperadmin && <ChevronDown size={11} style={{ marginLeft: '-1px', opacity: 0.75 }} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 7. LIVE DC STOCK INVENTORY SNAPSHOT TABLE                         */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>DC Stock Inventory Snapshot</h3>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <Check size={11} style={{ display: 'inline', marginRight: '3px' }} />
                Real-Time Synced
              </span>
              <span
                className="badge"
                style={{
                  background: '#f0fdf4',
                  color: '#15803d',
                  border: '1px solid #86efac',
                  fontWeight: 700,
                  fontSize: '11.5px',
                  padding: '3px 8px'
                }}
              >
                {activeSnapshotFilter !== 'ALL' || tableSearch.trim()
                  ? `Filtered Value: $${filteredSnapshotValuationUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
                  : `Total Valuation: $${totalDcStockValuationUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Aggregated stock counts and USD valuations by part SKU currently available in Distribution Center with aging visibility tracking (all inventory records remain 100% permanent and intact)
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
              {['ALL', 'DISPLAY', 'BATTERY', 'CAMERA', 'AGING'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveSnapshotFilter(f)}
                  style={{
                    border: 'none',
                    background: activeSnapshotFilter === f ? (f === 'AGING' ? '#f59e0b' : '#0284c7') : 'transparent',
                    color: activeSnapshotFilter === f ? '#fff' : '#64748b',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {f === 'AGING' ? `Aging (${agingUnits.length})` : f}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search part or serial..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                style={{
                  padding: '5px 10px 5px 30px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12px',
                  width: '200px'
                }}
              />
            </div>

            <div style={{ width: '1px', height: '20px', background: '#cbd5e1', margin: '0 2px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportDcInventoryExcel}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#15803d',
                  borderColor: '#86efac',
                  background: '#f0fdf4',
                  padding: '4px 8px',
                  borderRadius: '5px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="Export DC In-Stock Snapshot to Excel (.xlsx)"
              >
                <FileSpreadsheet size={13} />
                <span>XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportDcInventoryPDF}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#0284c7',
                  borderColor: '#bae6fd',
                  background: '#f0f9ff',
                  padding: '4px 8px',
                  borderRadius: '5px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="Export DC In-Stock Snapshot to PDF"
              >
                <Download size={13} />
                <span>PDF</span>
              </button>
            </div>
          </div>
        </div>

        {groupedInventory.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <Boxes size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No matching parts found in DC stock</div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 14px' }}>
              Scan barcodes or import parts manifest to register inventory into DC stock.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('scan-in')}>
              Receive Parts
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <table className="table" style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ width: '50px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>#</th>
                  <th style={{ width: '130px', padding: '10px 12px', whiteSpace: 'nowrap' }}>PART NUMBER</th>
                  <th style={{ padding: '10px 12px' }}>DESCRIPTION</th>
                  <th style={{ width: '120px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>CATEGORY</th>
                  <th style={{ width: '125px', textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap' }}>STOCK PRICE</th>
                  <th style={{ width: '110px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>IN-STOCK</th>
                  <th style={{ width: '140px', textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap' }}>TOTAL VALUE</th>
                  <th style={{ width: '160px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>DC AGING STATUS</th>
                  <th style={{ width: '160px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>RECENT SERIAL</th>
                </tr>
              </thead>
              <tbody>
                {groupedInventory.map((item, idx) => {
                  const badge = getCategoryBadge(item.category_name || item.category);
                  return (
                    <tr key={item.part_number} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                      <td style={{ textAlign: 'center', color: '#64748b', padding: '10px 12px', whiteSpace: 'nowrap' }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: '#0f172a', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {item.part_number}
                      </td>
                      <td style={{ color: '#334155', padding: '10px 12px' }}>
                        {item.description}
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span
                          className="badge"
                          style={{
                            background: badge.bg,
                            color: badge.text || badge.color,
                            border: `1px solid ${badge.border}`,
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontWeight: 700,
                            fontSize: '11px',
                            display: 'inline-block',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {badge.name || item.category_name || item.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '12.5px' }}>
                          ${item.stockPriceUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                          ₱{(item.stockPriceUSD * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-primary" style={{ fontWeight: 800, fontSize: '12px', whiteSpace: 'nowrap' }}>
                          {item.units.length} {item.units.length === 1 ? 'unit' : 'units'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-sans)', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 800, color: '#059669', fontSize: '12.5px' }}>
                          ${item.totalValUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                          ₱{(item.totalValUSD * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {item.maxDaysInDc >= 4 ? (
                          <span
                            className="badge"
                            style={{
                              background: '#fffbeb',
                              color: '#b45309',
                              border: '1px solid #fde68a',
                              fontWeight: 700,
                              fontSize: '11px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <AlertTriangle size={11} /> {item.maxDaysInDc}d in DC (Aging Notice)
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              fontWeight: 600,
                              fontSize: '11px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <CheckCircle2 size={11} /> {item.maxDaysInDc}d in DC (Fresh)
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-sans)', fontSize: '11.5px', color: '#475569', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {item.latest_serial || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f8fafc', borderTop: '2px solid #cbd5e1', fontWeight: 800 }}>
                  <td colSpan={4} style={{ padding: '12px 14px', textAlign: 'right', color: '#334155', fontSize: '12px' }}>
                    TOTAL PHYSICAL DC STOCK:
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 14px', color: '#64748b', fontSize: '11px', whiteSpace: 'nowrap' }}>
                    —
                  </td>
                  <td style={{ textAlign: 'center', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <span className="badge" style={{ background: '#0284c7', color: '#fff', fontWeight: 800, fontSize: '12px' }}>
                      {groupedInventory.reduce((acc, it) => acc + it.units.length, 0).toLocaleString()} units
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 14px', color: '#059669', fontFamily: 'var(--font-sans)', fontSize: '13px', whiteSpace: 'nowrap' }}>
                    ${filteredSnapshotValuationUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td colSpan={2} style={{ padding: '12px 14px', textAlign: 'center', color: '#64748b', fontSize: '11px' }}>
                    {agingUnits.length > 0 ? `${agingUnits.length} Aging • ${freshUnits.length} Fresh` : `All Units Fresh`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 8. CONSUMABLES & SERVICE TOOLS LIVE OVERVIEW                      */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '22px 24px',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 6px 16px -4px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', background: '#0f172a', color: '#38bdf8', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Wrench size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  Consumables &amp; Service Tools Center
                </h3>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 9px',
                    borderRadius: '999px',
                    background: ctSyncStatus?.isSyncing ? '#fef3c7' : '#ecfdf5',
                    color: ctSyncStatus?.isSyncing ? '#b45309' : '#047857',
                    border: `1px solid ${ctSyncStatus?.isSyncing ? '#fde68a' : '#a7f3d0'}`
                  }}
                >
                  {ctSyncStatus?.isSyncing ? 'Syncing Cloud...' : 'Live Cloud Synced'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
                Real-time non-repair consumables stock, serialized tool assets, packing lists &amp; cross-site movement ledger
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setActiveTab('consumables-tools')}
            >
              Open CT Center
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
          <div
            onClick={() => setActiveTab('ct-receiving')}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              cursor: 'pointer'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>
              Open CT Orders
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
              {ctDashboardSummary.openOrders}
            </div>
            <div style={{ fontSize: '11.5px', color: '#78350f' }}>
              Pending or partial PO deliveries
            </div>
          </div>

          <div
            onClick={() => setActiveTab('consumables-tools')}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              cursor: 'pointer'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
              Consumables On Hand
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
              {ctDashboardSummary.consumablesOnHand.toLocaleString()}
            </div>
            <div style={{ fontSize: '11.5px', color: ctDashboardSummary.lowStockSkus > 0 ? '#b45309' : '#64748b' }}>
              {ctDashboardSummary.lowStockSkus > 0
                ? `${ctDashboardSummary.lowStockSkus} SKU(s) at or below min threshold`
                : 'Stocked across active sites'}
            </div>
          </div>

          <div
            onClick={() => setActiveTab('consumables-tools')}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              cursor: 'pointer'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase' }}>
              Tracked Tool Units
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
              {ctDashboardSummary.toolsTotal}
            </div>
            <div style={{ fontSize: '11.5px', color: '#1e40af' }}>
              {ctDashboardSummary.toolsAvailable} available • {ctDashboardSummary.toolsInUse} in use
            </div>
          </div>

          <div
            onClick={() => setActiveTab('ct-movements')}
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              cursor: 'pointer'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
              CT Shipments &amp; Archive
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
              {ctDashboardSummary.totalShipments}
            </div>
            <div style={{ fontSize: '11.5px', color: '#065f46' }}>
              {ctDashboardSummary.activeShipments} in transit • {ctDashboardSummary.deliveredShipments} delivered
            </div>
          </div>
        </div>
      </div>

      {/* --- Superadmin PDF Download Options Modal --- */}
      {pdfSelectModalState && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPdfSelectModalState(null);
          }}
        >
          <div
            className="modal-content"
            style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                padding: '18px 22px',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#2563eb',
                    flexShrink: 0
                  }}
                >
                  <Download size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                    Select Document Download
                  </h3>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                    <span>Manifest: <strong style={{ color: '#0f172a' }}>{pdfSelectModalState.shipment?.invoice_ref || pdfSelectModalState.shipment?.shipment_number || 'Manifest'}</strong></span>
                    <span style={{ margin: '0 6px' }}>•</span>
                    <span>Destination: <strong style={{ color: '#0f172a' }}>{pdfSelectModalState.site?.name || pdfSelectModalState.shipment?.site_name || 'Service Hub'}</strong></span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPdfSelectModalState(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                Choose which document format you would like to download for this outbound shipment:
              </p>

              {/* Option 1: Packing List Only */}
              <div
                onClick={() => {
                  handleRequestPrintOrPDF(
                    pdfSelectModalState.shipment,
                    pdfSelectModalState.items,
                    pdfSelectModalState.site,
                    { includeDeclarationForm: false }
                  );
                  setPdfSelectModalState(null);
                }}
                style={{
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  background: '#ffffff',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.background = '#f8faff';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: '#eff6ff',
                    border: '1px solid #dbeafe',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#2563eb',
                    flexShrink: 0,
                    marginTop: '2px'
                  }}
                >
                  <FileText size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      Packing List (PL Only)
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#2563eb',
                        background: '#eff6ff',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        border: '1px solid #bfdbfe'
                      }}
                    >
                      Manifest Only
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.45 }}>
                    Standard warehouse dispatch manifest containing part numbers, descriptions, serial numbers, models, and quantities.
                  </p>
                  <div style={{ marginTop: '10px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12.5px', fontWeight: 600, color: '#2563eb' }}>
                    <span>Download PL Only</span>
                    <span style={{ fontSize: '14px' }}>→</span>
                  </div>
                </div>
              </div>

              {/* Option 2: Both PL & Declaration Form */}
              <div
                onClick={() => {
                  handleRequestPrintOrPDF(
                    pdfSelectModalState.shipment,
                    pdfSelectModalState.items,
                    pdfSelectModalState.site,
                    { includeDeclarationForm: true }
                  );
                  setPdfSelectModalState(null);
                }}
                style={{
                  border: '1.5px solid #bbf7d0',
                  borderRadius: '10px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  background: '#fcfdfb',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#16a34a';
                  e.currentTarget.style.background = '#f0fdf4';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(22, 163, 74, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#bbf7d0';
                  e.currentTarget.style.background = '#fcfdfb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: '#dcfce7',
                    border: '1px solid #bbf7d0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#15803d',
                    flexShrink: 0,
                    marginTop: '2px'
                  }}
                >
                  <Layers size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      Both (PL &amp; Declaration Form)
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#15803d',
                        background: '#f0fdf4',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        border: '1px solid #bbf7d0'
                      }}
                    >
                      Official Package
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.45 }}>
                    Complete corporate shipment package containing both the Packing List manifest and the official MDC Site Transfer Declaration Form.
                  </p>
                  <div style={{ marginTop: '10px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12.5px', fontWeight: 600, color: '#15803d' }}>
                    <span>Download Both (PL + Declaration)</span>
                    <span style={{ fontSize: '14px' }}>→</span>
                  </div>
                </div>
              </div>

              {/* Superadmin Restricted Notice */}
              <div
                style={{
                  padding: '10px 14px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>
                  <strong>Superadmin Exclusive:</strong> PMG users cannot view or download the Declaration Form in the system and are restricted to Packing List (PL Only).
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                padding: '12px 22px',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc'
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPdfSelectModalState(null)}
                style={{
                  fontSize: '13px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
