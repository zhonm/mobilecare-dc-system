import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Building2,
  Package,
  AlertTriangle,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  UploadCloud,
  Download,
  Search,
  X,
  Copy,
  ChevronRight,
  ChevronLeft,
  Layers,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
  Trash2,
  Boxes,
  Check,
  TrendingDown,
  ShieldAlert,
  Zap,
  Lock,
  ArrowRightLeft,
  Barcode
} from 'lucide-react';
import dbStorage from '../utils/dbStorage.js';
import { supabase } from '../supabase/client.js';
import { resolveSite } from '../utils/appContextHelpers.js';
import { isProvincialSite } from '../utils/partResolver.js';
import { resolveSerialFullDetails } from '../utils/serialTracker.js';
import { syncFixablyTransfersToHistory, loadLocalTransferHistory } from '../services/transferHistoryService.js';
import SerialDossierModal from './SerialDossierModal.jsx';
import MovementHistoryModal from './MovementHistoryModal.jsx';
import {
  validateFixablyFile,
  reconcileFixablyMultiFile,
  compactFixablySnapshot,
  hydrateFixablySnapshot,
  extractTextContent,
  exportDeadStockToCsv,
  exportDeadStockToExcel,
  exportInvestigationToCsv,
  exportInvestigationToExcel,
  exportSiteToExcel,
  AGING_BRACKETS
} from '../utils/fixablyInventoryEngine.js';

export default function FixablyInventoryDashboard({
  currentUser = null,
  sites = [],
  parts = [],
  _parts = [],
  inventoryUnits = [],
  _inventoryUnits = [],
  batchAddScanInUnits = null,
  clearSiteParts = null,
  showToast = null,
  broadcastCloudEvent = null,
  snapshot: propSnapshot = null,
  setSnapshot: propSetSnapshot = null,
  initialViewMode = 'all_stocks',
  initialSelectedSiteId = null
}) {
  const effectiveInventoryUnits = inventoryUnits?.length ? inventoryUnits : _inventoryUnits;
  const isSuperadmin = Boolean(currentUser?.role === 'superadmin' || currentUser?.role === 'SUPERADMIN' || currentUser?.isSuperAdmin);
  const isPmgUser = currentUser?.role === 'parts_management';

  // Resolve user assigned branch
  const userAssignedSite = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [currentUser?.siteId, currentUser?.site_id, currentUser?.siteCode, sites]);

  const userSiteCodeClean = useMemo(() => {
    const raw = userAssignedSite?.code || currentUser?.siteCode || '';
    return raw.toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
  }, [userAssignedSite?.code, currentUser?.siteCode]);

  // 1. Core State: strictly lock viewMode to 'multi_site' or 'site_transfers' for non-superadmins
  const [viewMode, setViewMode] = useState(() => {
    if (!isSuperadmin) return 'multi_site';
    return initialViewMode || 'all_stocks';
  });

  // Synchronize viewMode when initialViewMode prop changes via Sidebar navigation
  useEffect(() => {
    if (!isSuperadmin) {
      setViewMode('multi_site');
    } else if (initialViewMode) {
      setViewMode(initialViewMode);
    }
  }, [isSuperadmin, initialViewMode]);

  // Guard against illegal viewMode states for non-superadmins
  useEffect(() => {
    if (!isSuperadmin && viewMode === 'all_stocks') {
      setViewMode('multi_site');
    }
  }, [isSuperadmin, viewMode]);

  const [localSnapshot, setLocalSnapshot] = useState(propSnapshot || null);
  const snapshotTimestampRef = useRef(propSnapshot?.timestamp || '');

  // Keep snapshotTimestampRef synchronized whenever localSnapshot updates
  useEffect(() => {
    if (localSnapshot?.timestamp) {
      snapshotTimestampRef.current = localSnapshot.timestamp;
    }
  }, [localSnapshot?.timestamp]);

  const setSnapshot = useCallback((val) => {
    if (val?.timestamp) {
      snapshotTimestampRef.current = val.timestamp;
    }
    setLocalSnapshot(val);
    if (typeof propSetSnapshot === 'function') {
      propSetSnapshot(val);
    }
  }, [propSetSnapshot]);

  // Synchronize from parent propSnapshot ONLY if propSnapshot is newer or equal
  useEffect(() => {
    if (propSnapshot) {
      const incomingMs = propSnapshot.timestamp ? new Date(propSnapshot.timestamp).getTime() : 0;
      const currentMs = snapshotTimestampRef.current ? new Date(snapshotTimestampRef.current).getTime() : 0;
      if (incomingMs >= currentMs || !currentMs) {
        snapshotTimestampRef.current = propSnapshot.timestamp || '';
        setLocalSnapshot(propSnapshot);
      }
    }
  }, [propSnapshot]);

  // Evaluate active snapshot by timestamp to guarantee newly uploaded data is never shadowed
  const snapshot = useMemo(() => {
    if (!propSnapshot) return localSnapshot;
    if (!localSnapshot) return propSnapshot;
    const propMs = propSnapshot.timestamp ? new Date(propSnapshot.timestamp).getTime() : 0;
    const localMs = localSnapshot.timestamp ? new Date(localSnapshot.timestamp).getTime() : 0;
    return localMs > propMs ? localSnapshot : propSnapshot;
  }, [propSnapshot, localSnapshot]);

  const [isLoading, setIsLoading] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(null);
  const [isDropzoneOpen, setIsDropzoneOpen] = useState(false);
  const [syncWithAppInventory, setSyncWithAppInventory] = useState(true);

  // 2. 3-Slot File Ingestion State (User Uploads Only)
  const [slots, setSlots] = useState({
    site_stock: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, validationDetails: null },
    kgb_used: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, validationDetails: null },
    stock_transfer: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, validationDetails: null }
  });
  const [activeSlotDrag, setActiveSlotDrag] = useState(null);

  // Hidden file inputs for each of the 3 slots
  const siteStockInputRef = useRef(null);
  const kgbInputRef = useRef(null);
  const stockTransferInputRef = useRef(null);

  // 3. All Stocks Master Table Filters
  const [masterSearch, setMasterSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [agingFilter, setAgingFilter] = useState('ALL');
  const [classificationFilter, setClassificationFilter] = useState('ALL');
  const [investigationFilter, setInvestigationFilter] = useState('ALL'); // 'ALL' | 'INVESTIGATION_ONLY' | 'CLEAN_ONLY'
  const [transferFilter, setTransferFilter] = useState('ALL'); // 'ALL' | 'TRANSFERRED_ONLY' | 'SITE_TO_SITE_ONLY' | 'DC_TRANSFERS_ONLY'
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [copiedSerial, setCopiedSerial] = useState(null);

  // 3b. Site Transfers & Movement Ledger View State
  const [transfersSubTab, setTransfersSubTab] = useState('site_to_site'); // 'site_to_site' | 'all_movements' | 'adjustments' | 'activity_logs'
  const [transfersSearch, setTransfersSearch] = useState('');
  const [transfersFromFilter, setTransfersFromFilter] = useState('ALL');
  const [transfersToFilter, setTransfersToFilter] = useState('ALL');
  const [transfersTypeFilter, setTransfersTypeFilter] = useState('ALL');
  const [transfersPage, setTransfersPage] = useState(1);
  const [inspectedMovementUnit, setInspectedMovementUnit] = useState(null);
  const [activityLogs, setActivityLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_fixably_activity_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const appendActivityLog = useCallback((entry) => {
    const newLog = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      userName: currentUser?.fullName || currentUser?.name || 'Zhon Manacis',
      userEmail: currentUser?.email || 'admin@mobilecare.ph',
      userRole: currentUser?.role || 'superadmin',
      ...entry
    };
    setActivityLogs(prev => {
      const updated = [newLog, ...(Array.isArray(prev) ? prev : [])].slice(0, 100);
      try {
        localStorage.setItem('mdc_fixably_activity_logs', JSON.stringify(updated));
        dbStorage.setItem('mdc_fixably_activity_logs', updated);
      } catch (e) {}
      return updated;
    });
    return newLog;
  }, [currentUser?.email, currentUser?.fullName, currentUser?.name, currentUser?.role]);

  // 4. Multi-Site View State
  const [selectedRegion, setSelectedRegion] = useState(() => {
    if (isPmgUser && userAssignedSite && isProvincialSite(userAssignedSite)) {
      return 'provincial';
    }
    return 'metro_manila';
  });
  const [selectedSiteCode, setSelectedSiteCode] = useState(() => {
    if (isPmgUser && userSiteCodeClean) {
      return userSiteCodeClean;
    }
    if (initialSelectedSiteId) {
      const match = sites.find(s => s.id === initialSelectedSiteId || s.code === initialSelectedSiteId);
      if (match) return match.code.replace(/^(ASP|APP)\s+/, '');
    }
    return 'BHS';
  });
  const [segmentedTab, setSegmentedTab] = useState('dead_stock'); // 'dead_stock' | 'non_moving' | 'slow_moving' | 'active_stock' | 'investigation' | 'part_aggregations' | 'all_stock'
  const [expandedPartPn, setExpandedPartPn] = useState(null);

  // 5. Cross-Site Part Number & Serial Number Search & Autocomplete State
  const [partSearchInput, setPartSearchInput] = useState('');
  const [partSearchQuery, setPartSearchQuery] = useState('');
  const [selectedSerialUnit, setSelectedSerialUnit] = useState(null);
  const [highlightedSerial, setHighlightedSerial] = useState(null);
  const [inspectedSerialDetails, setInspectedSerialDetails] = useState(null);
  const [isPartDropdownOpen, setIsPartDropdownOpen] = useState(false);
  const [highlightedPartIndex, setHighlightedPartIndex] = useState(-1);
  const [branchFilterQuery, setBranchFilterQuery] = useState('');
  const partSearchContainerRef = useRef(null);

  // Close autocomplete dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (partSearchContainerRef.current && !partSearchContainerRef.current.contains(e.target)) {
        setIsPartDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // format file size helper
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Push compact snapshot to Supabase Cloud (<2MB) and broadcast to peers
  const syncSnapshotToCloud = useCallback(async (snapToSync) => {
    if (!supabase || !snapToSync?.items?.length) return false;
    try {
      const compact = compactFixablySnapshot(snapToSync);
      const effectiveTimestamp = snapToSync.timestamp || compact.timestamp || new Date().toISOString();
      const cloudPayload = {
        id: 'master_fixably_inventory_snapshot',
        record_type: 'fixably_snapshot',
        period_label: 'Master Fixably Inventory Snapshot',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        snapshot_data: compact,
        saved_by_name: currentUser?.fullName || currentUser?.email || 'System',
        updated_at: effectiveTimestamp
      };
      const { error: cloudErr } = await supabase
        .from('saved_records')
        .upsert(cloudPayload, { onConflict: 'id' });

      if (cloudErr) {
        console.warn('Cloud sync error for master_fixably_inventory_snapshot:', cloudErr);
        return false;
      }

      try {
        localStorage.setItem('mdc_fixably_snapshot_timestamp', effectiveTimestamp);
        localStorage.setItem('mdc_fixably_updated_at', effectiveTimestamp);
        await dbStorage.setItem('mdc_fixably_updated_at', effectiveTimestamp);
      } catch (e) {}

      if (typeof broadcastCloudEvent === 'function') {
        broadcastCloudEvent('FIXABLY_SNAPSHOT_UPDATED', {
          timestamp: effectiveTimestamp,
          totalUnits: snapToSync.items.length
        });
      }
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bus = new BroadcastChannel('mdc_sync_bus');
        bus.postMessage({
          type: 'FIXABLY_SNAPSHOT_UPDATED',
          payload: { snapshot: snapToSync, timestamp: effectiveTimestamp }
        });
        bus.close();
      }
      return true;
    } catch (e) {
      console.warn('syncSnapshotToCloud exception:', e);
      return false;
    }
  }, [broadcastCloudEvent, currentUser?.email, currentUser?.fullName]);

  // Helper to convert existing snapshot items into CSV text when Slot 1 raw text is unavailable
  const serializeSnapshotItemsToCsv = useCallback((items) => {
    if (!Array.isArray(items) || items.length === 0) return '';
    const escapeCsv = (val) => {
      const str = String(val ?? '');
      return (str.includes(',') || str.includes('"') || str.includes('\n'))
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };
    const header = 'Stock Name,Part Number,Description,Quantity,Serial Number,IMEI,Part Value,Last Received Date';
    const rows = items
      .filter(it => !it.synthesizedFromTransfer)
      .map(it => [
        escapeCsv(it.originalStockName || it.stockName || `${it.cleanSiteCode || String(it.siteCode || '').replace(/^(ASP|APP)\s+/, '')}_MSPI-Owned`),
        escapeCsv(it.partNumber),
        escapeCsv(it.description),
        escapeCsv(1),
        escapeCsv(it.serialNumber),
        escapeCsv(it.imei || ''),
        escapeCsv(it.partValue || it.totalValue || 0),
        escapeCsv(it.originalReceivedDate || it.lastReceivedDate || '')
      ].join(','));
    return [header, ...rows].join('\n');
  }, []);

  // Load initial data from Storage and automatically reconcile uploaded Stock Transfers
  useEffect(() => {
    let isMounted = true;

    async function loadInitialData() {
      setIsLoading(true);
      try {
        // 0. Hydrate persistent activity logs
        try {
          let savedLogs = await dbStorage.getItem('mdc_fixably_activity_logs');
          if (!Array.isArray(savedLogs) || savedLogs.length === 0) {
            const rawLogs = localStorage.getItem('mdc_fixably_activity_logs');
            if (rawLogs) savedLogs = JSON.parse(rawLogs);
          }
          if (Array.isArray(savedLogs) && isMounted) {
            setActivityLogs(savedLogs);
          }
        } catch (e) {}

        // 1. Hydrate persistent uploaded slots from IndexedDB
        let [savedSiteStock, savedKgb, savedTransfer] = await Promise.all([
          dbStorage.getItem('mdc_uploaded_slot_site_stock'),
          dbStorage.getItem('mdc_uploaded_slot_kgb_used'),
          dbStorage.getItem('mdc_uploaded_slot_stock_transfer')
        ]);

        if (savedSiteStock?.content) {
          try {
            const v = await validateFixablyFile(savedSiteStock.content, 'site_stock');
            if (v.valid && v.rowCount) {
              savedSiteStock.rowCount = v.rowCount;
              savedSiteStock.validationDetails = v.validationDetails;
            }
          } catch (e) {}
        }

        if (savedTransfer?.content) {
          try {
            const vt = await validateFixablyFile(savedTransfer.content, 'stock_transfer');
            if (vt.valid) {
              savedTransfer.rowCount = vt.rowCount;
              savedTransfer.validationDetails = vt.validationDetails;
            }
          } catch (e) {}
        }

        if (savedSiteStock || savedKgb || savedTransfer) {
          if (isMounted) {
            setSlots({
              site_stock: savedSiteStock ? { ...savedSiteStock, file: null, valid: true } : { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, updatedAt: null },
              kgb_used: savedKgb ? { ...savedKgb, file: null, valid: true } : { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, updatedAt: null },
              stock_transfer: savedTransfer ? { ...savedTransfer, file: null, valid: true } : { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, updatedAt: null }
            });
          }
        }

        let cached = await dbStorage.getItem('mdc_fixably_snapshot');

        // Secondary fallback to localStorage
        if (!cached || !cached.items || cached.items.length === 0) {
          try {
            const rawLocal = localStorage.getItem('mdc_fixably_snapshot');
            if (rawLocal) cached = JSON.parse(rawLocal);
          } catch (e) {}
        }

        // Tertiary fallback to permanent saved records archive
        if (!cached || !cached.items || cached.items.length === 0) {
          try {
            const savedRecs = await dbStorage.getAllSavedRecords();
            const snapRec = savedRecs.find(r => r.id === 'master_fixably_inventory_snapshot' || r.record_type === 'fixably_snapshot');
            if (snapRec && snapRec.snapshot && snapRec.snapshot.items?.length > 0) {
              cached = snapRec.snapshot;
              await dbStorage.setItem('mdc_fixably_snapshot', cached);
            }
          } catch (e) {}
        }

        // Check if any uploaded slot file (Site Stock, KGB, or Stock Transfer) is newer than the snapshot,
        // or if the cached snapshot lacks stock transfer records
        const siteSlotMs = savedSiteStock?.updatedAt ? new Date(savedSiteStock.updatedAt).getTime() : 0;
        const kgbSlotMs = savedKgb?.updatedAt ? new Date(savedKgb.updatedAt).getTime() : 0;
        const transferSlotMs = savedTransfer?.updatedAt ? new Date(savedTransfer.updatedAt).getTime() : 0;
        const maxSlotMs = Math.max(siteSlotMs, kgbSlotMs, transferSlotMs);
        const cachedUpdatedAt = cached?.timestamp ? new Date(cached.timestamp).getTime() : 0;
        const isAnySlotStrictlyNewer = Boolean(maxSlotMs && (!cachedUpdatedAt || maxSlotMs > cachedUpdatedAt));
        const isMissingTransferRecords = Boolean(
          cached?.items?.length > 0 &&
          (!Array.isArray(cached.transfers) || cached.transfers.length === 0)
        );

        const needsDiscrepancyHeal = Boolean(
          savedSiteStock?.content &&
          cached?.items &&
          savedSiteStock.rowCount &&
          cached.items.length !== savedSiteStock.rowCount &&
          isAnySlotStrictlyNewer
        );

        // Use strictly the Stock Transfer file uploaded by the user in Slot 3
        const effectiveTransferContent = savedTransfer?.content || null;

        const effectiveSiteStockContent = savedSiteStock?.content || (
          (isAnySlotStrictlyNewer || isMissingTransferRecords) && cached?.items?.length > 0
            ? serializeSnapshotItemsToCsv(cached.items)
            : null
        );

        // Auto-reconcile from saved slots or cached items whenever a newer slot (including Stock Transfer) exists or transfers are missing
        if (
          (needsDiscrepancyHeal || isAnySlotStrictlyNewer || isMissingTransferRecords || !cached || !cached.items || cached.items.length === 0) &&
          effectiveSiteStockContent
        ) {
          try {
            const autoReconciled = await reconcileFixablyMultiFile({
              siteStockContent: effectiveSiteStockContent,
              kgbUsedContent: savedKgb?.content || null,
              stockTransferContent: effectiveTransferContent,
              options: { sites, currentDate: new Date('2026-10-09T00:00:00Z'), expandQuantity: true }
            });

            if (autoReconciled.success && autoReconciled.items?.length > 0) {
              cached = autoReconciled;
              await dbStorage.setItem('mdc_fixably_snapshot', cached);
              try {
                localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(compactFixablySnapshot(cached)));
                localStorage.setItem('mdc_fixably_snapshot_timestamp', cached.timestamp);
              } catch (e) {}
              await dbStorage.putSavedRecord({
                id: 'master_fixably_inventory_snapshot',
                record_type: 'fixably_snapshot',
                snapshot: cached,
                created_at: cached.timestamp || new Date().toISOString()
              });
              if (Array.isArray(cached.transfers) && cached.transfers.length > 0) {
                syncFixablyTransfersToHistory(cached.transfers, currentUser?.email || 'Auto-Sync').catch(() => {});
              }
              await syncSnapshotToCloud(cached);
            }
          } catch (autoRecErr) {
            console.warn('Auto-reconcile from saved slots error:', autoRecErr);
          }
        }

        // Render available local/cached snapshot immediately for instant UI feedback without blank screen
        if (cached && cached.items && cached.items.length > 0) {
          cached = hydrateFixablySnapshot(cached, sites);
          if (Array.isArray(cached.transfers) && cached.transfers.length > 0) {
            syncFixablyTransfersToHistory(cached.transfers, currentUser?.email || 'Auto-Sync').catch(() => {});
          }
          if (isMounted) {
            setSnapshot(cached);
            setIsLoading(false);
            setIsDropzoneOpen(false);
          }
        }

        // Supabase Cloud Multi-User Synchronization: Ensure latest cloud snapshot overrides stale local cache
        if (supabase) {
          try {
            const { data: cloudRec, error: cloudErr } = await supabase
              .from('saved_records')
              .select('*')
              .eq('id', 'master_fixably_inventory_snapshot')
              .maybeSingle();

            if (!cloudErr && cloudRec?.snapshot_data && Array.isArray(cloudRec.snapshot_data.items) && cloudRec.snapshot_data.items.length > 0) {
              const cloudTimestamp = cloudRec.updated_at || cloudRec.snapshot_data?.timestamp || '';
              const cloudMs = cloudTimestamp ? new Date(cloudTimestamp).getTime() : 0;
              const localTimestamp = cached?.timestamp || snapshotTimestampRef.current || localStorage.getItem('mdc_fixably_snapshot_timestamp') || '';
              const localMs = localTimestamp ? new Date(localTimestamp).getTime() : 0;

              // Only apply cloud snapshot if cloud is strictly newer AND local slot files weren't uploaded more recently
              if ((!cached || !cached.items || cached.items.length === 0 || (cloudMs > 0 && cloudMs > localMs)) && cloudMs > maxSlotMs) {
                console.info('[FixablyDashboard] Synchronizing with newer cloud snapshot:', cloudTimestamp, 'vs local:', localTimestamp);
                let cloudHydrated = hydrateFixablySnapshot(cloudRec.snapshot_data, sites);
                if (cloudTimestamp && !cloudHydrated.timestamp) {
                  cloudHydrated.timestamp = cloudTimestamp;
                }
                // If cloud snapshot is missing transfers, enrich it with available transfer content
                if ((!Array.isArray(cloudHydrated.transfers) || cloudHydrated.transfers.length === 0) && (savedTransfer?.content || effectiveTransferContent)) {
                  const enrichedCloud = await reconcileFixablyMultiFile({
                    siteStockContent: savedSiteStock?.content || serializeSnapshotItemsToCsv(cloudHydrated.items),
                    kgbUsedContent: savedKgb?.content || null,
                    stockTransferContent: savedTransfer?.content || effectiveTransferContent,
                    options: { sites, currentDate: new Date('2026-10-09T00:00:00Z'), expandQuantity: true }
                  });
                  if (enrichedCloud.success && enrichedCloud.items?.length > 0) {
                    cloudHydrated = enrichedCloud;
                  }
                }
                cached = cloudHydrated;
                await dbStorage.setItem('mdc_fixably_snapshot', cloudHydrated);
                try {
                  localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(compactFixablySnapshot(cloudHydrated)));
                  localStorage.setItem('mdc_fixably_snapshot_timestamp', cloudTimestamp || cloudHydrated.timestamp || '');
                  localStorage.setItem('mdc_fixably_updated_at', cloudTimestamp || cloudHydrated.timestamp || '');
                  await dbStorage.setItem('mdc_fixably_updated_at', cloudTimestamp || cloudHydrated.timestamp || '');
                } catch (e) {}
                await dbStorage.putSavedRecord({
                  id: 'master_fixably_inventory_snapshot',
                  record_type: 'fixably_snapshot',
                  snapshot: cloudHydrated,
                  created_at: cloudTimestamp || cloudHydrated.timestamp || new Date().toISOString()
                });
                if (Array.isArray(cloudHydrated.transfers) && cloudHydrated.transfers.length > 0) {
                  syncFixablyTransfersToHistory(cloudHydrated.transfers, currentUser?.email || 'Cloud-Sync').catch(() => {});
                }
                if (isMounted) {
                  setSnapshot(cloudHydrated);
                  setIsLoading(false);
                  setIsDropzoneOpen(false);
                }
                return;
              }
            }
          } catch (cloudFetchErr) {
            console.warn('Fixably cloud synchronization check note:', cloudFetchErr);
          }
        }

        // Quaternary fallback: if local cache was already populated and cloud was not newer, we are done
        if (cached && cached.items && cached.items.length > 0) {
          return;
        }

        // Quinary auto-seed fallback: ONLY if no local, cloud, or user-uploaded file exists
        if ((!cached || !cached.items || cached.items.length === 0) && !savedSiteStock?.content && typeof fetch !== 'undefined') {
          try {
            const resp = await fetch('/output.csv');
            if (resp.ok) {
              const csvText = await resp.text();
              if (csvText && csvText.includes('Stock Name')) {
                let kgbText = null;
                let transferText = null;
                try {
                  const kResp = await fetch('/kgb_used.csv');
                  if (kResp.ok) kgbText = await kResp.text();
                } catch (e) {}
                try {
                  const tResp = await fetch('/stock_transfer.csv');
                  if (tResp.ok) transferText = await tResp.text();
                } catch (e) {}

                const autoReconciled = await reconcileFixablyMultiFile({
                  siteStockContent: csvText,
                  kgbUsedContent: kgbText,
                  stockTransferContent: transferText,
                  options: { sites, currentDate: new Date('2026-10-09T00:00:00Z') }
                });

                if (autoReconciled.success && autoReconciled.items?.length > 0) {
                  cached = autoReconciled;
                  await dbStorage.setItem('mdc_fixably_snapshot', cached);
                  try {
                    localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(cached));
                    localStorage.setItem('mdc_fixably_snapshot_timestamp', cached.timestamp);
                  } catch (e) {}
                  if (Array.isArray(cached.transfers) && cached.transfers.length > 0) {
                    syncFixablyTransfersToHistory(cached.transfers, 'System Auto-Seed').catch(() => {});
                  }
                  await syncSnapshotToCloud(cached);
                }
              }
            }
          } catch (autoSeedErr) {
            console.warn('Auto-seed note:', autoSeedErr);
          }
        }

        if (cached && cached.items && cached.items.length > 0) {
          cached = hydrateFixablySnapshot(cached, sites);
          if (isMounted) {
            setSnapshot(cached);
            setIsLoading(false);
            setIsDropzoneOpen(false);
          }
          return;
        }

        // If no snapshot exists yet, open upload center automatically
        if (isMounted) {
          setIsDropzoneOpen(true);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Error loading initial Fixably data:', err);
        if (isMounted) setIsLoading(false);
      }
    }

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [sites, syncSnapshotToCloud, setSnapshot, serializeSnapshotItemsToCsv, currentUser?.email]);

  // Real-time multi-user & cross-device snapshot synchronization listener
  useEffect(() => {
    let bus = null;
    let realtimeChannel = null;

    const handleApplySyncedSnapshot = (incomingSnapshot) => {
      if (incomingSnapshot && Array.isArray(incomingSnapshot.items) && incomingSnapshot.items.length > 0) {
        const incomingMs = incomingSnapshot.timestamp ? new Date(incomingSnapshot.timestamp).getTime() : 0;
        const currentMs = snapshotTimestampRef.current ? new Date(snapshotTimestampRef.current).getTime() : 0;
        if (currentMs > 0 && incomingMs > 0 && incomingMs < currentMs) {
          console.log('[FixablyDashboard] Ignoring older incoming snapshot:', incomingSnapshot.timestamp, 'vs active:', snapshotTimestampRef.current);
          return;
        }
        setSnapshot(incomingSnapshot);
        setIsDropzoneOpen(false);
        setIsLoading(false);
      }
    };

    // 1. Cross-tab BroadcastChannel listener
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        bus = new BroadcastChannel('mdc_sync_bus');
        bus.onmessage = async (ev) => {
          if (ev.data?.type === 'FIXABLY_SNAPSHOT_UPDATED') {
            if (ev.data?.payload?.snapshot) {
              handleApplySyncedSnapshot(ev.data.payload.snapshot);
            } else {
              const latest = await dbStorage.getItem('mdc_fixably_snapshot');
              if (latest?.items?.length > 0) {
                handleApplySyncedSnapshot(latest);
              }
            }
          } else if (ev.data?.type === 'FIXABLY_SNAPSHOT_CLEARED') {
            setSnapshot(null);
            setIsDropzoneOpen(true);
          }
        };
      }
    } catch (e) {}

    // 2. Storage event listener (fallback for other tabs in same browser)
    const handleStorageEvent = (e) => {
      if (e.key === 'mdc_fixably_snapshot' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          handleApplySyncedSnapshot(parsed);
        } catch (err) {}
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageEvent);
    }

    // 3. Supabase Realtime Channel: Instantly receives snapshot when another user uploads
    if (supabase) {
      const channelId = `fixably_sync_${Math.random().toString(36).substring(7)}`;
      realtimeChannel = supabase
        .channel(channelId)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'saved_records',
            filter: 'id=eq.master_fixably_inventory_snapshot'
          },
          async (payload) => {
            if (payload.eventType === 'DELETE') {
              setSnapshot(null);
              setIsDropzoneOpen(true);
              return;
            }
            let snapData = payload.new?.snapshot_data;
            let remoteTimestamp = payload.new?.updated_at || snapData?.timestamp || '';

            // If snapshot_data is missing or omitted by Supabase Realtime (due to TOAST / message size limits)
            if (!snapData || !Array.isArray(snapData.items) || snapData.items.length === 0) {
              try {
                const { data: fullCloudRec, error: cloudErr } = await supabase
                  .from('saved_records')
                  .select('*')
                  .eq('id', 'master_fixably_inventory_snapshot')
                  .maybeSingle();
                if (!cloudErr && fullCloudRec?.snapshot_data && Array.isArray(fullCloudRec.snapshot_data.items)) {
                  snapData = fullCloudRec.snapshot_data;
                  remoteTimestamp = fullCloudRec.updated_at || snapData.timestamp || remoteTimestamp;
                }
              } catch (fetchErr) {
                console.warn('Realtime fetch full snapshot error:', fetchErr);
              }
            }

            if (snapData && Array.isArray(snapData.items) && snapData.items.length > 0) {
              const remoteMs = remoteTimestamp ? new Date(remoteTimestamp).getTime() : 0;
              const currentMs = snapshotTimestampRef.current ? new Date(snapshotTimestampRef.current).getTime() : 0;
              if (currentMs > 0 && remoteMs > 0 && remoteMs < currentMs) {
                console.log('[FixablyDashboard Realtime] Ignoring older cloud payload:', remoteTimestamp, 'vs active:', snapshotTimestampRef.current);
                return;
              }
              const newSnapshot = hydrateFixablySnapshot(snapData, sites);
              if (remoteTimestamp && !newSnapshot.timestamp) {
                newSnapshot.timestamp = remoteTimestamp;
              }
              await dbStorage.setItem('mdc_fixably_snapshot', newSnapshot);
              try {
                localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(newSnapshot));
                localStorage.setItem('mdc_fixably_snapshot_timestamp', remoteTimestamp || newSnapshot.timestamp || '');
                localStorage.setItem('mdc_fixably_updated_at', remoteTimestamp || newSnapshot.timestamp || '');
                await dbStorage.setItem('mdc_fixably_updated_at', remoteTimestamp || newSnapshot.timestamp || '');
              } catch (e) {}
              await dbStorage.putSavedRecord({
                id: 'master_fixably_inventory_snapshot',
                record_type: 'fixably_snapshot',
                snapshot: newSnapshot,
                created_at: remoteTimestamp || newSnapshot.timestamp || new Date().toISOString()
              });
              handleApplySyncedSnapshot(newSnapshot);
            }
          }
        )
        .on(
          'broadcast',
          { event: 'mdc_sync' },
          async (msg) => {
            const evType = msg?.payload?.type;
            if (evType === 'FIXABLY_SNAPSHOT_UPDATED') {
              const sender = msg?.payload?.senderId;
              const curId = String(currentUser?.id || '').trim();
              if (curId && (sender === curId || sender === currentUser?.email)) return;
              try {
                const { data: cloudRec } = await supabase
                  .from('saved_records')
                  .select('*')
                  .eq('id', 'master_fixably_inventory_snapshot')
                  .maybeSingle();
                if (cloudRec?.snapshot_data && Array.isArray(cloudRec.snapshot_data.items)) {
                  const remoteTimestamp = cloudRec.updated_at || cloudRec.snapshot_data.timestamp || '';
                  const remoteMs = remoteTimestamp ? new Date(remoteTimestamp).getTime() : 0;
                  const currentMs = snapshotTimestampRef.current ? new Date(snapshotTimestampRef.current).getTime() : 0;
                  if (currentMs > 0 && remoteMs > 0 && remoteMs < currentMs) return;
                  const newSnapshot = hydrateFixablySnapshot(cloudRec.snapshot_data, sites);
                  if (remoteTimestamp && !newSnapshot.timestamp) newSnapshot.timestamp = remoteTimestamp;
                  await dbStorage.setItem('mdc_fixably_snapshot', newSnapshot);
                  try {
                    localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(newSnapshot));
                    localStorage.setItem('mdc_fixably_snapshot_timestamp', remoteTimestamp || newSnapshot.timestamp || '');
                    localStorage.setItem('mdc_fixably_updated_at', remoteTimestamp || newSnapshot.timestamp || '');
                    await dbStorage.setItem('mdc_fixably_updated_at', remoteTimestamp || newSnapshot.timestamp || '');
                  } catch (e) {}
                  handleApplySyncedSnapshot(newSnapshot);
                }
              } catch (e) {}
            }
          }
        )
        .subscribe();
    }

    // 4. Tab visibility and focus listener: auto-sync if dashboard was in background while another user uploaded
    const handleVisibilityOrFocus = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && supabase) {
        try {
          const { data: cloudRec } = await supabase
            .from('saved_records')
            .select('id, updated_at')
            .eq('id', 'master_fixably_inventory_snapshot')
            .maybeSingle();
          if (cloudRec?.updated_at) {
            const cloudMs = new Date(cloudRec.updated_at).getTime();
            const currentMs = snapshotTimestampRef.current ? new Date(snapshotTimestampRef.current).getTime() : 0;
            if (cloudMs > 0 && cloudMs > currentMs) {
              const { data: fullDoc } = await supabase
                .from('saved_records')
                .select('*')
                .eq('id', 'master_fixably_inventory_snapshot')
                .maybeSingle();
              if (fullDoc?.snapshot_data?.items) {
                const refreshed = hydrateFixablySnapshot(fullDoc.snapshot_data, sites);
                if (fullDoc.updated_at && !refreshed.timestamp) refreshed.timestamp = fullDoc.updated_at;
                await dbStorage.setItem('mdc_fixably_snapshot', refreshed);
                try {
                  localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(refreshed));
                  localStorage.setItem('mdc_fixably_snapshot_timestamp', fullDoc.updated_at);
                  localStorage.setItem('mdc_fixably_updated_at', fullDoc.updated_at);
                } catch (e) {}
                handleApplySyncedSnapshot(refreshed);
              }
            }
          }
        } catch (e) {}
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }

    return () => {
      if (bus) bus.close();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageEvent);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
      if (realtimeChannel && supabase) {
        supabase.removeChannel(realtimeChannel).catch(() => {});
      }
    };
  }, [sites, setSnapshot, currentUser?.email, currentUser?.id]);

  // Core reconciliation & synchronization runner (usable both from automatic upload trigger and manual button)
  const executeReconciliationAndSync = useCallback(async ({
    siteStockText,
    kgbText,
    transferText,
    sourceLabel = 'Manual Multi-File Sync',
    uploadedFileName = '',
    closeDropzoneOnSuccess = true
  }) => {
    setIsParsing(true);
    setParseProgress({ stage: 'Reading files and validating schemas...', percent: 15 });

    try {
      setParseProgress({ stage: 'Indexing KGB closed repairs, DC transfers & site-to-site movements...', percent: 45 });
      await new Promise(r => setTimeout(r, 40));

      const reconciled = await reconcileFixablyMultiFile({
        siteStockContent: siteStockText,
        kgbUsedContent: kgbText,
        stockTransferContent: transferText,
        options: { sites, currentDate: new Date('2026-10-09T00:00:00Z'), expandQuantity: true }
      });

      if (!reconciled.success) {
        await appendActivityLog({
          actionType: 'RECONCILIATION_ERROR',
          status: 'ERROR',
          fileName: uploadedFileName || 'Multi-File Upload',
          summary: reconciled.error || 'Reconciliation failed.',
          affectedRecords: 0
        });
        showToast?.(reconciled.error || 'Reconciliation failed.', 'error');
        setIsParsing(false);
        setParseProgress(null);
        return null;
      }

      setParseProgress({ stage: 'Calculating aging metrics, transfer chains & branch health...', percent: 75 });
      await new Promise(r => setTimeout(r, 40));

      const effectiveTs = reconciled.timestamp || new Date().toISOString();
      if (!reconciled.timestamp) {
        reconciled.timestamp = effectiveTs;
      }
      snapshotTimestampRef.current = effectiveTs;

      // Multi-Tier Persistence: IndexedDB App State, LocalStorage, and Permanent Archive
      await dbStorage.setItem('mdc_fixably_snapshot', reconciled);
      try {
        localStorage.setItem('mdc_fixably_snapshot', JSON.stringify(compactFixablySnapshot(reconciled)));
        localStorage.setItem('mdc_fixably_snapshot_timestamp', effectiveTs);
        localStorage.setItem('mdc_fixably_updated_at', effectiveTs);
        await dbStorage.setItem('mdc_fixably_updated_at', effectiveTs);
        const existingBatches = (await dbStorage.getItem('inventory_sync_batches')) || [];
        const updatedBatches = [
          reconciled.batchSummary,
          ...(Array.isArray(existingBatches) ? existingBatches.slice(0, 19) : [])
        ];
        await dbStorage.setItem('inventory_sync_batches', updatedBatches);

        // Permanent archival backup in STORE_SAVED_RECORDS (immune to cache clearance)
        await dbStorage.putSavedRecord({
          id: 'master_fixably_inventory_snapshot',
          record_type: 'fixably_snapshot',
          snapshot: reconciled,
          created_at: effectiveTs
        });
      } catch (e) {
        console.warn('Fixably snapshot backup note:', e);
      }

      // Synchronize all parsed Fixably stock transfers into the global Part Transfer History Ledger
      let historySyncResult = { addedCount: 0, totalHistoryCount: 0 };
      if (Array.isArray(reconciled.transfers) && reconciled.transfers.length > 0) {
        try {
          historySyncResult = await syncFixablyTransfersToHistory(
            reconciled.transfers,
            currentUser?.fullName || currentUser?.name || currentUser?.email || 'System Administrator'
          );
        } catch (histErr) {
          console.warn('Transfer history sync warning:', histErr);
        }
      }

      // Immediately anchor UI state so it displays the newly processed inventory & transfers
      setSnapshot(reconciled);
      if (closeDropzoneOnSuccess) {
        setIsDropzoneOpen(false);
      }

      // Cloud Persistence & Realtime Broadcast: Sync compact snapshot (<2MB) to Supabase Cloud
      await syncSnapshotToCloud(reconciled);

      // Synchronize with application active stock (inventoryUnits)
      if (syncWithAppInventory && typeof batchAddScanInUnits === 'function') {
        setParseProgress({ stage: 'Synchronizing transferred & active stock with application database...', percent: 90 });
        try {
          const validUnits = reconciled.items.map(it => ({
            ...it,
            part_number: it.partNumber,
            serial_number: it.serialNumber,
            site_code: it.siteCode,
            current_site_id: it.siteId,
            current_owner: it.currentOwner,
            movement_history: it.movementHistory,
            transfer_count: it.transferCount,
            latest_transfer_date: it.latestTransfer?.receivedDate || it.lastReceivedDate || null,
            lastReceivedDate: it.lastReceivedDate,
            status: 'VALID',
            lifecycle_status: 'in_stock'
          }));
          await batchAddScanInUnits(validUnits, null, 'Branch Stock', 'ALL', 'ALL', 'All Retail Branches', {
            replaceExistingBranchStock: false
          });
        } catch (syncErr) {
          console.warn('Batch add sync warning:', syncErr);
        }
      }

      // Record detailed activity log entry
      const trStats = reconciled.transferStats || {};
      await appendActivityLog({
        actionType: sourceLabel,
        status: 'SUCCESS',
        fileName: uploadedFileName || slots.stock_transfer?.name || slots.site_stock?.name || 'Multi-File Upload',
        summary: `Synced ${reconciled.items.length.toLocaleString()} inventory units across ${reconciled.sites.length} branches. Processed ${(trStats.totalTransfers || 0).toLocaleString()} stock transfers (${(trStats.siteToSiteCount || 0).toLocaleString()} site-to-site, ${(trStats.relocatedCount || 0) + (trStats.synthesizedTransferUnitsCount || 0)} relocated/synthesized active units).`,
        affectedRecords: reconciled.items.length,
        transferRecordsCount: trStats.totalTransfers || 0,
        siteToSiteCount: trStats.siteToSiteCount || 0,
        relocatedUnitsCount: (trStats.relocatedCount || 0) + (trStats.synthesizedTransferUnitsCount || 0),
        historyAddedCount: historySyncResult.addedCount || 0,
        validationSummary: reconciled.validationSummary || null
      });

      const siteToSiteMsg = trStats.siteToSiteCount
        ? `, ${trStats.siteToSiteCount.toLocaleString()} site-to-site transfers (${(trStats.relocatedCount || 0) + (trStats.synthesizedTransferUnitsCount || 0)} relocated units)`
        : '';

      showToast?.(
        `Successfully synced ${reconciled.items.length.toLocaleString()} units across ${reconciled.sites.length} sites${siteToSiteMsg}!`,
        'success'
      );
      return reconciled;
    } catch (err) {
      console.error('Multi-file intake error:', err);
      await appendActivityLog({
        actionType: sourceLabel,
        status: 'ERROR',
        fileName: uploadedFileName || 'Multi-File Upload',
        summary: `Error processing files: ${err.message}`,
        affectedRecords: 0
      });
      showToast?.(`Error processing files: ${err.message}`, 'error');
      return null;
    } finally {
      setIsParsing(false);
      setParseProgress(null);
    }
  }, [
    sites,
    appendActivityLog,
    showToast,
    currentUser?.fullName,
    currentUser?.name,
    currentUser?.email,
    setSnapshot,
    syncSnapshotToCloud,
    syncWithAppInventory,
    batchAddScanInUnits,
    slots.stock_transfer?.name,
    slots.site_stock?.name
  ]);

  // Handle slot file assignment, validation, persistent storage, and real-time auto-reconciliation
  const handleSlotFileChange = async (slotKey, file) => {
    if (!file) return;
    try {
      const textContent = await extractTextContent(file, slotKey);
      const validation = await validateFixablyFile(textContent, slotKey);
      if (!validation.valid) {
        setSlots(prev => ({
          ...prev,
          [slotKey]: {
            file,
            name: file.name,
            size: file.size,
            rowCount: 0,
            valid: false,
            error: validation.error,
            validationDetails: null,
            content: null,
            updatedAt: null
          }
        }));
        await appendActivityLog({
          actionType: `FILE_VALIDATION_FAILED (${slotKey.toUpperCase()})`,
          status: 'ERROR',
          fileName: file.name,
          fileSize: file.size,
          summary: validation.error,
          affectedRecords: 0
        });
        showToast?.(validation.error, 'error');
        return;
      }

      const nowIso = new Date().toISOString();
      const slotData = {
        name: file.name,
        size: file.size,
        rowCount: validation.rowCount,
        valid: true,
        error: null,
        validationDetails: validation.validationDetails || null,
        content: textContent,
        updatedAt: nowIso
      };

      const nextSlots = {
        ...slots,
        [slotKey]: {
          ...slotData,
          file
        }
      };

      setSlots(nextSlots);

      // Automatically persist to IndexedDB so uploaded files survive page refreshes, logouts, & restarts
      await dbStorage.setItem('mdc_uploaded_slot_' + slotKey, slotData);

      const vDetails = validation.validationDetails;
      const warnSuffix = vDetails?.warnings?.length ? ` (${vDetails.warnings.join(' ')})` : '';
      await appendActivityLog({
        actionType: `FILE_UPLOADED (${slotKey.toUpperCase()})`,
        status: vDetails?.warnings?.length ? 'WARNING' : 'SUCCESS',
        fileName: file.name,
        fileSize: file.size,
        summary: `Uploaded & validated ${file.name}: ${validation.rowCount.toLocaleString()} valid records${vDetails?.siteToSiteCount ? `, ${vDetails.siteToSiteCount.toLocaleString()} site-to-site transfers` : ''}.${warnSuffix}`,
        affectedRecords: validation.rowCount,
        siteToSiteCount: vDetails?.siteToSiteCount || 0,
        validationSummary: vDetails || null
      });

      showToast?.(`Verified & saved ${file.name} (${validation.rowCount.toLocaleString()} rows)${warnSuffix}`, 'success');

      // Automatically process and sync in real time whenever Site Stock or Stock Transfer is uploaded!
      const effectiveSiteStockText =
        nextSlots.site_stock?.content ||
        (snapshot?.items?.length > 0 ? serializeSnapshotItemsToCsv(snapshot.items) : null);

      if (effectiveSiteStockText) {
        await executeReconciliationAndSync({
          siteStockText: effectiveSiteStockText,
          kgbText: nextSlots.kgb_used?.content || null,
          transferText: nextSlots.stock_transfer?.content || null,
          sourceLabel: `Auto-Sync on ${slotKey === 'stock_transfer' ? 'Stock Transfer' : slotKey === 'site_stock' ? 'Site Stock' : 'KGB Used'} Upload`,
          uploadedFileName: file.name,
          closeDropzoneOnSuccess: false
        });
      }
    } catch (err) {
      setSlots(prev => ({
        ...prev,
        [slotKey]: {
          file,
          name: file.name,
          size: file.size,
          rowCount: 0,
          valid: false,
          error: err.message,
          validationDetails: null,
          content: null,
          updatedAt: null
        }
      }));
      await appendActivityLog({
        actionType: `FILE_UPLOAD_EXCEPTION (${slotKey.toUpperCase()})`,
        status: 'ERROR',
        fileName: file.name,
        fileSize: file.size,
        summary: `File validation failed: ${err.message}`,
        affectedRecords: 0
      });
      showToast?.(`File validation failed: ${err.message}`, 'error');
    }
  };

  // Clear specific slot from state and IndexedDB
  const handleClearSlot = async (slotKey) => {
    setSlots(prev => ({
      ...prev,
      [slotKey]: {
        file: null,
        name: '',
        size: 0,
        rowCount: 0,
        valid: false,
        error: null,
        content: null,
        updatedAt: null
      }
    }));
    try {
      await dbStorage.removeItem('mdc_uploaded_slot_' + slotKey);
    } catch (e) {}
  };

  // Clear all slots from state and IndexedDB
  const handleClearAllSlots = async () => {
    setSlots({
      site_stock: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, updatedAt: null },
      kgb_used: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, updatedAt: null },
      stock_transfer: { file: null, name: '', size: 0, rowCount: 0, valid: false, error: null, content: null, updatedAt: null }
    });
    try {
      await Promise.all([
        dbStorage.removeItem('mdc_uploaded_slot_site_stock'),
        dbStorage.removeItem('mdc_uploaded_slot_kgb_used'),
        dbStorage.removeItem('mdc_uploaded_slot_stock_transfer')
      ]);
    } catch (e) {}
  };

  // Process & Reconcile Multi-File Sync
  const handleProcessMultiFile = async () => {
    const effectiveSiteStock =
      slots.site_stock.file ||
      slots.site_stock.content ||
      (snapshot?.items?.length > 0 ? serializeSnapshotItemsToCsv(snapshot.items) : null);

    if (!effectiveSiteStock) {
      showToast?.('Site Stocks (output.csv) is required.', 'error');
      return;
    }
    if (slots.site_stock.error) {
      showToast?.(`Slot 1 Error: ${slots.site_stock.error}`, 'error');
      return;
    }

    await executeReconciliationAndSync({
      siteStockText: effectiveSiteStock,
      kgbText: slots.kgb_used.file || slots.kgb_used.content || null,
      transferText: slots.stock_transfer.file || slots.stock_transfer.content || null,
      sourceLabel: 'Manual Multi-File Reconciliation',
      uploadedFileName: slots.stock_transfer?.name || slots.site_stock?.name || 'Multi-File Upload',
      closeDropzoneOnSuccess: true
    });
  };

  // Drag and drop helper for individual slots
  const handleSlotDragOver = (e, slotKey) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlotDrag(slotKey);
  };

  const handleSlotDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlotDrag(null);
  };

  const handleSlotDrop = (e, slotKey) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlotDrag(null);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleSlotFileChange(slotKey, files[0]);
    }
  };

  // Filtered Master Items for All Stocks Page
  const filteredMasterItems = useMemo(() => {
    if (!snapshot?.items) return [];

    const activeMatches = snapshot.items.filter(item => {
      // 1. Site Filter
      if (siteFilter !== 'ALL') {
        const itemSite = String(item.siteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
        const targetSite = siteFilter.toUpperCase().replace(/^(ASP|APP)\s+/, '');
        if (itemSite !== targetSite) return false;
      }

      // 2. Aging Filter
      if (agingFilter !== 'ALL') {
        if (item.agingBracket !== agingFilter) return false;
      }

      // 3. Classification Filter
      if (classificationFilter !== 'ALL') {
        if (item.stockType !== classificationFilter) return false;
      }

      // 4. Investigation Status Filter
      if (investigationFilter === 'INVESTIGATION_ONLY' && !item.isInvestigation) {
        return false;
      }
      if (investigationFilter === 'CLEAN_ONLY' && item.isInvestigation) {
        return false;
      }

      // 5. Stock Transfer / Movement Filter
      if (transferFilter === 'SITE_TO_SITE_ONLY') {
        if (!(item.siteToSiteCount > 0 || item.relocatedByTransfer || item.synthesizedFromTransfer)) return false;
      } else if (transferFilter === 'TRANSFERRED_ONLY') {
        if (!(item.transferCount > 0 || item.isDcTransfer || item.relocatedByTransfer || item.synthesizedFromTransfer)) return false;
      } else if (transferFilter === 'RELOCATED_ONLY') {
        if (!(item.relocatedByTransfer || item.synthesizedFromTransfer)) return false;
      }

      // 6. Search query (includes serial, part, branch, movement trail, owner, previous branch)
      if (masterSearch.trim()) {
        const q = masterSearch.toLowerCase().trim();
        const pn = String(item.partNumber || '').toLowerCase();
        const desc = String(item.description || '').toLowerCase();
        const sn = String(item.serialNumber || '').toLowerCase();
        const site = String(item.siteCode || '').toLowerCase();
        const siteNm = String(item.siteName || '').toLowerCase();
        const orderId = String(item.investigationDetails?.orderId || '').toLowerCase();
        const trail = String(item.movementTrail || '').toLowerCase();
        const owner = String(item.currentOwner || '').toLowerCase();
        const prevSite = String(item.previousSiteCode || '').toLowerCase();
        if (
          !pn.includes(q) &&
          !desc.includes(q) &&
          !sn.includes(q) &&
          !site.includes(q) &&
          !siteNm.includes(q) &&
          !orderId.includes(q) &&
          !trail.includes(q) &&
          !owner.includes(q) &&
          !prevSite.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });

    // When a search query is entered, also surface matching historical/consumed transfer records
    // from snapshot.transfers that are not in active on-hand snapshot.items
    if (masterSearch.trim().length >= 3 && Array.isArray(snapshot?.transfers) && snapshot.transfers.length > 0) {
      const q = masterSearch.toLowerCase().trim();
      const seenActiveSerials = new Set(
        snapshot.items.map(it => String(it.serialNumber || '').trim().toUpperCase()).filter(Boolean)
      );
      const transferBySerial = new Map();
      snapshot.transfers.forEach(tr => {
        const sn = String(tr.serialNumber || tr.serial_number || '').trim().toUpperCase();
        if (!sn || seenActiveSerials.has(sn)) return;
        const pn = String(tr.productCode || tr.part_number || '').toLowerCase();
        const desc = String(tr.productName || tr.description || '').toLowerCase();
        const fromSite = String(tr.fromSiteCode || '').toLowerCase();
        const toSite = String(tr.toSiteCode || '').toLowerCase();
        if (
          sn.toLowerCase().includes(q) ||
          pn.includes(q) ||
          desc.includes(q) ||
          `${fromSite} -> ${toSite}`.includes(q) ||
          `${fromSite} → ${toSite}`.includes(q)
        ) {
          if (!transferBySerial.has(sn)) transferBySerial.set(sn, []);
          transferBySerial.get(sn).push(tr);
        }
      });

      const historicalTransferItems = [];
      for (const [sn, trList] of transferBySerial.entries()) {
        const latestTr = trList[trList.length - 1];
        const destCode = String(latestTr.toSiteCode || 'BRANCH').toUpperCase();
        if (siteFilter !== 'ALL') {
          const targetSite = siteFilter.toUpperCase().replace(/^(ASP|APP)\s+/, '');
          if (destCode !== targetSite && String(latestTr.fromSiteCode || '').toUpperCase() !== targetSite) continue;
        }
        const movementSites = [];
        trList.forEach((t, idx) => {
          if (idx === 0 && t.fromSiteCode) movementSites.push(t.fromSiteCode);
          if (t.toSiteCode && movementSites[movementSites.length - 1] !== t.toSiteCode) {
            movementSites.push(t.toSiteCode);
          }
        });
        historicalTransferItems.push({
          id: `hist-xfer-${sn}`,
          partNumber: latestTr.productCode || 'N/A',
          description: latestTr.productName || 'Transferred Service Part',
          siteCode: latestTr.toSiteName || destCode,
          cleanSiteCode: destCode,
          siteName: latestTr.toSiteName || `MOBILECARE - ${destCode}`,
          stockType: latestTr.isDcToSite ? 'DC Stock' : 'MSPI-Owned / C/I REP',
          serialNumber: sn,
          quantity: 1,
          lastReceivedDate: latestTr.receivedDate || '—',
          agingDays: 0,
          agingBracket: 'IN_STOCK',
          statusLabel: 'Historical / Consumed',
          badgeColor: '#6d28d9',
          badgeBg: '#f5f3ff',
          partValue: Number(latestTr.transferValue || 0),
          totalValue: Number(latestTr.transferValue || 0),
          isTransferred: true,
          transferCount: trList.length,
          siteToSiteCount: trList.filter(t => t.isSiteToSite).length,
          relocatedByTransfer: Boolean(latestTr.isSiteToSite),
          previousSiteCode: latestTr.fromSiteCode || null,
          movementHistory: movementSites,
          movementTrail: movementSites.join(' → '),
          currentOwner: latestTr.currentOwner || `${destCode}_MSPI-OWNED`,
          latestTransfer: latestTr,
          isHistoricalTransferRecord: true
        });
      }

      return [...activeMatches, ...historicalTransferItems];
    }

    return activeMatches;
  }, [snapshot, siteFilter, agingFilter, classificationFilter, investigationFilter, transferFilter, masterSearch]);

  // Pagination for Master Table
  const paginatedMasterItems = useMemo(() => {
    if (rowsPerPage === 'ALL') return filteredMasterItems;
    const start = (currentPage - 1) * rowsPerPage;
    return filteredMasterItems.slice(start, start + rowsPerPage);
  }, [filteredMasterItems, currentPage, rowsPerPage]);

  const totalPages = useMemo(() => {
    if (rowsPerPage === 'ALL' || rowsPerPage <= 0) return 1;
    return Math.ceil(filteredMasterItems.length / rowsPerPage) || 1;
  }, [filteredMasterItems, rowsPerPage]);

  // Helper to match site against current user's assigned site (supports codes like 'ANX', 'APP ANX', 'APP THE ANNEX', 'THE ANNEX')
  const isSiteMatchingUser = useCallback((siteCodeOrObj) => {
    if (!userSiteCodeClean) return false;
    const rawCode = typeof siteCodeOrObj === 'string'
      ? siteCodeOrObj
      : (siteCodeOrObj?.siteCode || siteCodeOrObj?.code || siteCodeOrObj?.siteName || siteCodeOrObj?.name || '');
    const clean = rawCode.toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
    if (clean && clean === userSiteCodeClean) return true;
    if ((clean === 'ANX' || clean === 'THE ANNEX') && (userSiteCodeClean === 'ANX' || userSiteCodeClean === 'THE ANNEX')) return true;
    if (userAssignedSite?.id && siteCodeOrObj?.id && userAssignedSite.id === siteCodeOrObj.id) return true;
    if (userAssignedSite?.id && siteCodeOrObj?.siteId && userAssignedSite.id === siteCodeOrObj.siteId) return true;
    return false;
  }, [userSiteCodeClean, userAssignedSite?.id]);

  // Current Site Data for Multi-Site Page
  const currentSiteData = useMemo(() => {
    if (!snapshot?.sites) return null;
    const target = selectedSiteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');
    return snapshot.sites.find(s => {
      const clean = s.siteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');
      return clean === target || (clean === 'ANX' && target === 'THE ANNEX') || (clean === 'THE ANNEX' && target === 'ANX');
    }) || snapshot.sites[0] || null;
  }, [snapshot, selectedSiteCode]);

  // Filtered part aggregations for the currently viewed site based on branchFilterQuery
  const displayedPartAggregations = useMemo(() => {
    if (!currentSiteData?.metrics?.partAggregations) return [];
    const q = String(branchFilterQuery || '').trim().toLowerCase();
    if (!q) return currentSiteData.metrics.partAggregations;

    return currentSiteData.metrics.partAggregations.filter(partRow => {
      const pn = String(partRow.partNumber || '').toLowerCase();
      const desc = String(partRow.partDescription || '').toLowerCase();
      const hasSerial = (partRow.serials || []).some(s => String(s).toLowerCase().includes(q));
      return pn.includes(q) || desc.includes(q) || hasSerial;
    });
  }, [currentSiteData?.metrics?.partAggregations, branchFilterQuery]);

  // Check if current viewed site is assigned to the active user
  const isCurrentSiteAssignedToUser = useMemo(() => {
    if (!currentSiteData) return false;
    return isSiteMatchingUser(currentSiteData);
  }, [currentSiteData, isSiteMatchingUser]);

  // User's assigned branch data from snapshot (used for PMG metrics scoping)
  const userSiteData = useMemo(() => {
    if (!snapshot?.sites || !userSiteCodeClean) return null;
    return snapshot.sites.find(s => isSiteMatchingUser(s)) || null;
  }, [snapshot?.sites, userSiteCodeClean, isSiteMatchingUser]);

  // Metrics to display on the top summary cards:
  // Superadmin sees system-wide network metrics across all service sites.
  // PMG users strictly see ONLY metrics for their designated assigned site!
  const displayMetrics = useMemo(() => {
    if (!isSuperadmin && isPmgUser) {
      if (userSiteData) {
        const m = userSiteData.metrics?.total || {};
        const siteVal = userSiteData.totalValue || userSiteData.items?.reduce((sum, it) => sum + (Number(it.partValue) || 99), 0) || 0;
        return {
          isScopedToBranch: true,
          branchName: userSiteData.siteName || (userSiteCodeClean ? `ASP ${userSiteCodeClean}` : 'Assigned Branch'),
          branchCode: userSiteData.siteCode || userSiteCodeClean || 'BRANCH',
          totalUnits: userSiteData.totalUnits || 0,
          totalValue: siteVal,
          uniqueParts: userSiteData.uniquePartsCount || userSiteData.metrics?.partAggregations?.length || 0,
          sitesCount: 1,
          investigationCount: userSiteData.investigationCount || 0,
          agingCounts: {
            [AGING_BRACKETS.DEAD_STOCK]: m.dead || 0,
            [AGING_BRACKETS.NON_MOVING]: m.nonMoving || 0,
            [AGING_BRACKETS.SLOW_MOVING]: m.slow || 0,
            [AGING_BRACKETS.IN_STOCK]: m.inStock || 0
          },
          deadStockPercent: m.deadPercent || '0.0',
          nonMovingPercent: m.nonMovingPercent || '0.0',
          slowMovingPercent: m.slowMovingPercent || '0.0',
          inStockPercent: m.inStockPercent || '0.0'
        };
      }
      return {
        isScopedToBranch: true,
        branchName: userSiteCodeClean ? `ASP ${userSiteCodeClean}` : 'Assigned Branch',
        branchCode: userSiteCodeClean || 'BRANCH',
        totalUnits: 0,
        totalValue: 0,
        uniqueParts: 0,
        sitesCount: 1,
        investigationCount: 0,
        agingCounts: {
          [AGING_BRACKETS.DEAD_STOCK]: 0,
          [AGING_BRACKETS.NON_MOVING]: 0,
          [AGING_BRACKETS.SLOW_MOVING]: 0,
          [AGING_BRACKETS.IN_STOCK]: 0
        },
        deadStockPercent: '0.0',
        nonMovingPercent: '0.0',
        slowMovingPercent: '0.0',
        inStockPercent: '0.0'
      };
    }

    // Default: system-wide network analytics for Superadmins
    return {
      isScopedToBranch: false,
      totalUnits: snapshot?.globalMetrics?.totalUnits || 0,
      totalValue: snapshot?.globalMetrics?.totalValue || 0,
      uniqueParts: snapshot?.globalMetrics?.uniqueParts || 0,
      sitesCount: snapshot?.globalMetrics?.sitesCount || 0,
      investigationCount: snapshot?.globalMetrics?.investigationCount || snapshot?.investigationItems?.length || 0,
      agingCounts: snapshot?.globalMetrics?.agingCounts || {},
      deadStockPercent: snapshot?.globalMetrics?.deadStockPercent || '0.0',
      nonMovingPercent: snapshot?.globalMetrics?.nonMovingPercent || '0.0',
      slowMovingPercent: snapshot?.globalMetrics?.slowMovingPercent || '0.0',
      inStockPercent: snapshot?.globalMetrics?.inStockPercent || '0.0'
    };
  }, [isSuperadmin, isPmgUser, userSiteData, userSiteCodeClean, snapshot?.globalMetrics, snapshot?.investigationItems]);

  // Auto-switch to part aggregations or all stock if a PMG user views another site
  useEffect(() => {
    if (!isSuperadmin && isPmgUser && !isCurrentSiteAssignedToUser) {
      if (['dead_stock', 'non_moving', 'slow_moving', 'active_stock', 'investigation'].includes(segmentedTab)) {
        setSegmentedTab('part_aggregations');
      }
    }
  }, [isSuperadmin, isPmgUser, isCurrentSiteAssignedToUser, segmentedTab]);

  // Serial privacy rule: Superadmins see all serials; PMG users can ONLY view serials of their assigned site
  const canViewCurrentSiteSerials = isSuperadmin || !isPmgUser || isCurrentSiteAssignedToUser;

  // Sanitized items for site export (strictly prevents other-site serial leaks into Excel/CSV)
  const itemsForBranchExport = useMemo(() => {
    if (!currentSiteData?.items) return [];
    if (canViewCurrentSiteSerials) return currentSiteData.items;
    return currentSiteData.items.map(it => ({
      ...it,
      serialNumber: '[RESTRICTED]',
      partSerial: '[RESTRICTED]'
    }));
  }, [currentSiteData?.items, canViewCurrentSiteSerials]);

  // Available Sites grouped by region
  const { metroManilaSitesList, provincialSitesList } = useMemo(() => {
    if (!snapshot?.sites) return { metroManilaSitesList: [], provincialSitesList: [] };

    const provCodes = new Set(['ABR', 'CDO', 'CEB', 'COT', 'CBO', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM']);

    const mm = [];
    const prov = [];

    snapshot.sites.forEach(s => {
      const clean = s.siteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');
      if (provCodes.has(clean)) {
        prov.push(s);
      } else {
        mm.push(s);
      }
    });

    return { metroManilaSitesList: mm, provincialSitesList: prov };
  }, [snapshot]);

  // Copy helper
  const handleCopy = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSerial(text);
    showToast?.(`Copied ${label || text} to clipboard`, 'info');
    setTimeout(() => setCopiedSerial(null), 2000);
  };

  // 6. Cross-Site Part Number Search Computations
  // Catalog of all unique active part numbers across the network with total units & stocking site counts
  const activePartCatalog = useMemo(() => {
    const map = new Map();
    // Gather from snapshot.items (Fixably ground truth)
    if (Array.isArray(snapshot?.items)) {
      snapshot.items.forEach(it => {
        const pn = String(it.partNumber || '').trim();
        if (!pn) return;
        const cleanPn = pn.toUpperCase();
        if (!map.has(cleanPn)) {
          map.set(cleanPn, {
            partNumber: it.partNumber || cleanPn,
            description: it.description || it.partDescription || '',
            totalUnits: 0,
            sitesSet: new Set()
          });
        }
        const entry = map.get(cleanPn);
        entry.totalUnits += 1;
        const site = it.siteCode || it.siteName || '';
        if (site) entry.sitesSet.add(site);
        if (!entry.description && (it.description || it.partDescription)) {
          entry.description = it.description || it.partDescription;
        }
      });
    }

    // Also incorporate active parts list from props/context
    const partsArray = parts?.length > 0 ? parts : _parts;
    if (Array.isArray(partsArray)) {
      partsArray.forEach(p => {
        const pn = String(p.part_number || p.partNumber || '').trim();
        if (!pn) return;
        const cleanPn = pn.toUpperCase();
        if (!map.has(cleanPn)) {
          map.set(cleanPn, {
            partNumber: p.part_number || p.partNumber || cleanPn,
            description: p.description || p.part_description || '',
            totalUnits: 0,
            sitesSet: new Set()
          });
        } else {
          const entry = map.get(cleanPn);
          if (!entry.description && (p.description || p.part_description)) {
            entry.description = p.description || p.part_description;
          }
        }
      });
    }

    return Array.from(map.values())
      .map(entry => ({
        ...entry,
        siteCount: entry.sitesSet.size
      }))
      .sort((a, b) => {
        if (b.totalUnits !== a.totalUnits) return b.totalUnits - a.totalUnits;
        return a.partNumber.localeCompare(b.partNumber);
      });
  }, [snapshot?.items, parts, _parts]);

  // Total serialized units in the snapshot
  const totalSerializedUnits = useMemo(() => {
    if (!Array.isArray(snapshot?.items)) return 0;
    return snapshot.items.filter(it => it.serialNumber && !it.serialNumber.startsWith('Non-serialized')).length;
  }, [snapshot?.items]);

  // Autocomplete matching serial numbers based on user search input
  const matchingSerials = useMemo(() => {
    const raw = String(partSearchInput || '').trim();
    if (!raw || raw.length < 2) return [];
    const q = raw.toUpperCase();
    const qClean = q.replace(/[^A-Z0-9]/g, '');

    if (!Array.isArray(snapshot?.items)) return [];

    const matches = [];
    const seen = new Set();

    for (const it of snapshot.items) {
      const sn = String(it.serialNumber || it.serial_number || '').trim();
      if (!sn || sn.startsWith('Non-serialized')) continue;
      const snClean = sn.toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (sn.toUpperCase().includes(q) || (qClean && snClean.includes(qClean))) {
        const key = `${sn.toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push(it);
          if (matches.length >= 25) break;
        }
      }
    }

    if (matches.length < 25 && Array.isArray(snapshot?.transfers)) {
      for (const tr of snapshot.transfers) {
        const sn = String(tr.serialNumber || tr.serial_number || '').trim();
        if (!sn || sn.startsWith('Non-serialized')) continue;
        const snClean = sn.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (sn.toUpperCase().includes(q) || (qClean && snClean.includes(qClean))) {
          const key = `${sn.toUpperCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              serialNumber: sn,
              partNumber: tr.productCode || tr.part_number || 'N/A',
              description: tr.productName || tr.description || 'Transferred Part',
              siteCode: tr.toSiteName || tr.toSiteCode || 'BRANCH',
              siteName: tr.toSiteName || `MOBILECARE - ${tr.toSiteCode || 'BRANCH'}`,
              agingDays: 0,
              statusLabel: 'Historical / Consumed',
              badgeBg: '#f5f3ff',
              badgeColor: '#6d28d9',
              stockType: tr.isSiteToSite ? 'Site-to-Site Transfer' : 'Transfer Ledger',
              lastReceivedDate: tr.receivedDate || '',
              isHistoricalTransferRecord: true
            });
            if (matches.length >= 25) break;
          }
        }
      }
    }

    matches.sort((a, b) => {
      const snA = String(a.serialNumber || '').toUpperCase();
      const snB = String(b.serialNumber || '').toUpperCase();
      if (snA === q) return -1;
      if (snB === q) return 1;
      if (snA.startsWith(q) && !snB.startsWith(q)) return -1;
      if (!snA.startsWith(q) && snB.startsWith(q)) return 1;
      return snA.localeCompare(snB);
    });

    return matches;
  }, [snapshot?.items, snapshot?.transfers, partSearchInput]);

  // Autocomplete filtered list based on user search input
  const filteredPartCatalog = useMemo(() => {
    const raw = String(partSearchInput || '').trim();
    if (!raw) return activePartCatalog.slice(0, 40);
    const q = raw.toUpperCase();
    const qClean = q.replace(/[^A-Z0-9]/g, '');

    return activePartCatalog.filter(p => {
      const pn = p.partNumber.toUpperCase();
      const pnClean = pn.replace(/[^A-Z0-9]/g, '');
      const desc = (p.description || '').toUpperCase();
      return pn.includes(q) || (qClean && pnClean.includes(qClean)) || desc.includes(q);
    }).slice(0, 40);
  }, [activePartCatalog, partSearchInput]);

  // Serial unit located by exact serial search query or user selection
  const locatedSerialUnit = useMemo(() => {
    if (selectedSerialUnit) return selectedSerialUnit;
    const query = String(partSearchQuery || partSearchInput || '').trim().toUpperCase();
    if (!query || query.length < 3) return null;
    const queryClean = query.replace(/[^A-Z0-9]/g, '');

    if (!Array.isArray(snapshot?.items)) return null;

    const exact = snapshot.items.find(it => {
      const sn = String(it.serialNumber || it.serial_number || '').trim().toUpperCase();
      const snClean = sn.replace(/[^A-Z0-9]/g, '');
      return sn === query || (queryClean && snClean === queryClean);
    });

    if (exact) return exact;

    if (Array.isArray(snapshot?.transfers)) {
      const matchedTrs = snapshot.transfers.filter(tr => {
        const sn = String(tr.serialNumber || tr.serial_number || '').trim().toUpperCase();
        const snClean = sn.replace(/[^A-Z0-9]/g, '');
        return sn === query || (queryClean && snClean === queryClean);
      });
      if (matchedTrs.length > 0) {
        const latestTr = matchedTrs[matchedTrs.length - 1];
        return {
          serialNumber: latestTr.serialNumber || latestTr.serial_number,
          partNumber: latestTr.productCode || latestTr.part_number || 'N/A',
          description: latestTr.productName || latestTr.description || 'Transferred Part',
          siteCode: latestTr.toSiteName || latestTr.toSiteCode || 'BRANCH',
          siteName: latestTr.toSiteName || `MOBILECARE - ${latestTr.toSiteCode || 'BRANCH'}`,
          agingDays: 0,
          statusLabel: 'Historical / Consumed',
          badgeBg: '#f5f3ff',
          badgeColor: '#6d28d9',
          stockType: latestTr.isSiteToSite ? 'Site-to-Site Transfer' : 'Transfer Ledger',
          lastReceivedDate: latestTr.receivedDate || '',
          isHistoricalTransferRecord: true
        };
      }
    }

    return null;
  }, [selectedSerialUnit, partSearchQuery, partSearchInput, snapshot?.items, snapshot?.transfers]);

  // Available stock per site for the currently searched part number or located serial
  const partStockBySite = useMemo(() => {
    const query = String(partSearchQuery || '').trim().toUpperCase();
    if (!query) return null;

    // If query matches a serial or if serial was located, resolve to its part number
    const matchedSerial = locatedSerialUnit || (Array.isArray(snapshot?.items)
      ? snapshot.items.find(it => {
          const sn = String(it.serialNumber || it.serial_number || '').trim().toUpperCase();
          const clean = sn.replace(/[^A-Z0-9]/g, '');
          const qClean = query.replace(/[^A-Z0-9]/g, '');
          return sn === query || (qClean && clean === qClean);
        })
      : null);

    const targetPartQuery = matchedSerial ? String(matchedSerial.partNumber || '').trim().toUpperCase() : query;
    const queryClean = targetPartQuery.replace(/[^A-Z0-9]/g, '');

    const provCodes = new Set(['ABR', 'CDO', 'CEB', 'COT', 'CBO', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM']);

    // Find all matching items across all sites
    const matchingItems = (snapshot?.items || []).filter(it => {
      const itPn = String(it.partNumber || '').trim().toUpperCase();
      const itPnClean = itPn.replace(/[^A-Z0-9]/g, '');
      return itPn === targetPartQuery || (queryClean && itPnClean === queryClean);
    });

    const catalogEntry = activePartCatalog.find(p => {
      const pPn = p.partNumber.toUpperCase();
      return pPn === targetPartQuery || (queryClean && pPn.replace(/[^A-Z0-9]/g, '') === queryClean);
    });

    const partDescription = matchedSerial?.description || matchingItems[0]?.description || catalogEntry?.description || '';
    const canonicalPartNumber = matchedSerial?.partNumber || catalogEntry?.partNumber || matchingItems[0]?.partNumber || targetPartQuery;

    // Group items by site
    const siteStockMap = new Map();

    matchingItems.forEach(it => {
      const rawSiteCode = String(it.siteCode || '').trim();
      const cleanSiteCode = rawSiteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');

      if (!siteStockMap.has(cleanSiteCode)) {
        const siteObj = (snapshot?.sites || []).find(s => {
          const sc = String(s.siteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
          return sc === cleanSiteCode;
        }) || (sites || []).find(s => {
          const sc = String(s.code || s.site_code || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
          return sc === cleanSiteCode;
        });

        const isProv = provCodes.has(cleanSiteCode) || isProvincialSite(siteObj || { code: cleanSiteCode, name: it.siteName });

        siteStockMap.set(cleanSiteCode, {
          siteCode: it.siteCode || cleanSiteCode,
          cleanCode: cleanSiteCode,
          siteName: it.siteName || siteObj?.siteName || siteObj?.name || `Service Branch ${cleanSiteCode}`,
          region: isProv ? 'provincial' : 'metro_manila',
          totalUnits: 0,
          dcStockUnits: 0,
          mspiOwnedUnits: 0,
          agingBrackets: {
            inStock: 0,
            slow: 0,
            nonMoving: 0,
            dead: 0
          }
        });
      }

      const sEntry = siteStockMap.get(cleanSiteCode);
      sEntry.totalUnits += 1;
      if (it.stockType === 'DC_STOCK' || it.stockType === 'DC Stock') {
        sEntry.dcStockUnits += 1;
      } else {
        sEntry.mspiOwnedUnits += 1;
      }

      if (it.agingBracket === 'IN_STOCK') sEntry.agingBrackets.inStock += 1;
      else if (it.agingBracket === 'SLOW_MOVING') sEntry.agingBrackets.slow += 1;
      else if (it.agingBracket === 'NON_MOVING') sEntry.agingBrackets.nonMoving += 1;
      else if (it.agingBracket === 'DEAD_STOCK') sEntry.agingBrackets.dead += 1;
    });

    const sitesWithStock = Array.from(siteStockMap.values()).sort((a, b) => b.totalUnits - a.totalUnits);

    return {
      searchedPartNumber: canonicalPartNumber,
      partDescription,
      totalNetworkUnits: matchingItems.length,
      sitesCount: sitesWithStock.length,
      sitesWithStock,
      locatedSerial: matchedSerial
    };
  }, [partSearchQuery, snapshot?.items, snapshot?.sites, sites, activePartCatalog, locatedSerialUnit]);

  const handleSelectSerial = useCallback((unit) => {
    if (!unit) return;
    setSelectedSerialUnit(unit);
    setPartSearchInput(unit.serialNumber);
    setPartSearchQuery(unit.serialNumber);
    setIsPartDropdownOpen(false);

    // Auto-navigate to the branch site
    const cleanSiteCode = String(unit.siteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
    const siteObj = (snapshot?.sites || []).find(s => {
      const sc = String(s.siteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
      return sc === cleanSiteCode;
    }) || (sites || []).find(s => {
      const sc = String(s.code || s.site_code || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
      return sc === cleanSiteCode;
    });

    const provCodes = new Set(['ABR', 'CDO', 'CEB', 'COT', 'CBO', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM']);
    const isProv = provCodes.has(cleanSiteCode) || isProvincialSite(siteObj || { code: cleanSiteCode, name: unit.siteName });

    setSelectedRegion(isProv ? 'provincial' : 'metro_manila');
    setSelectedSiteCode(cleanSiteCode);
    setSegmentedTab('part_aggregations');
    setExpandedPartPn(unit.partNumber);
    setHighlightedSerial(unit.serialNumber);

    showToast?.(`Located serial ${unit.serialNumber} at ${unit.siteName || unit.siteCode}`, 'success');

    setTimeout(() => {
      const el = document.getElementById(`serial-chip-${unit.serialNumber}`) || document.getElementById('branch-stock-section');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }, [snapshot?.sites, sites, showToast]);

  const handleSelectSiteFromSearch = useCallback((site) => {
    if (!site) return;
    if (site.region) {
      setSelectedRegion(site.region);
    }
    const cleanCode = site.cleanCode || String(site.siteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '');
    setSelectedSiteCode(cleanCode);
    setSegmentedTab('part_aggregations');

    const searchedPn = partStockBySite?.searchedPartNumber || String(partSearchQuery || partSearchInput || '').trim();
    if (searchedPn) {
      setExpandedPartPn(searchedPn);
      setBranchFilterQuery(searchedPn);
    }

    showToast?.(`Selected ${site.siteCode || cleanCode} (${site.totalUnits} on-hand for Part #${searchedPn || site.cleanCode})`, 'info');

    setTimeout(() => {
      const el = document.getElementById('branch-stock-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  }, [showToast, partStockBySite?.searchedPartNumber, partSearchQuery, partSearchInput]);
  useEffect(() => {
    setCurrentPage(1);
  }, [masterSearch, siteFilter, agingFilter, classificationFilter, investigationFilter, rowsPerPage]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '360px', gap: '14px' }}>
        <RefreshCw size={36} color="#0284c7" className="animate-spin" />
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Loading Inventory Snapshot...</div>
        <div style={{ fontSize: '12px', color: '#64748b' }}>Checking local cache and inventory sync state</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>

      {/* 1. Executive Page Header */}
      <div
        className="card"
        style={{
          padding: '20px 24px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          
          <div style={{ flex: 1, minWidth: '280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #eff6ff 0%, #e0f2fe 100%)',
                  border: '1px solid #bae6fd',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                {viewMode === 'multi_site' ? (
                  <Building2 size={22} color="#0284c7" />
                ) : (
                  <Layers size={22} color="#0284c7" />
                )}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                    {(!isSuperadmin && isPmgUser)
                      ? 'Branch Inventory Health & Multi-Site Stock'
                      : viewMode === 'multi_site'
                      ? 'Multi-Site Inventory Dashboard'
                      : 'All Stocks & Inventory'}
                  </h2>
                  {snapshot && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        background: '#ecfdf5',
                        color: '#047857',
                        border: '1px solid #a7f3d0'
                      }}
                    >
                      <CheckCircle2 size={12} color="#059669" />
                      <span>Live Reconciled</span>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  {snapshot ? (
                    <>
                      <span>
                        Source: <strong style={{ color: '#334155', fontWeight: 600 }}>{snapshot.fileName || 'output.csv'}</strong>
                      </span>
                      <span style={{ color: '#cbd5e1' }}>•</span>
                      <span>
                        Updated {new Date(snapshot.timestamp).toLocaleDateString()} at {new Date(snapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ color: '#cbd5e1' }}>•</span>
                      <span style={{ color: '#0f172a', fontWeight: 600 }}>
                        {(!isSuperadmin && isPmgUser)
                          ? `${displayMetrics.totalUnits.toLocaleString()} Branch Units (${(snapshot.globalMetrics?.totalUnits || snapshot.items?.length || 0).toLocaleString()} Network)`
                          : `${(snapshot.globalMetrics?.totalUnits || snapshot.items?.length || 0).toLocaleString()} Units across ${snapshot.sites?.length || 0} Service Points`}
                      </span>
                    </>
                  ) : (
                    <span>Network-wide on-hand inventory visibility, Fixably aging health &amp; stock transfer reconciliation</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Utility Controls (No duplicate navigation buttons) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {!isSuperadmin && isPmgUser && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '7px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
                <Building2 size={15} color="#0284c7" />
                <span style={{ fontWeight: 600, color: '#475569' }}>Assigned Branch:</span>
                <strong style={{ color: '#0284c7', fontWeight: 800 }}>{userSiteCodeClean ? `ASP ${userSiteCodeClean}` : 'PMG Branch'}</strong>
              </div>
            )}

            {isSuperadmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setIsDropzoneOpen(prev => !prev)}
                  style={{
                    height: '36px',
                    padding: '0 14px',
                    fontSize: '12.5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                    fontWeight: 700,
                    color: isDropzoneOpen ? '#ffffff' : '#0f172a',
                    border: isDropzoneOpen ? '1px solid #0284c7' : '1px solid #cbd5e1',
                    background: isDropzoneOpen ? '#0284c7' : '#ffffff',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <UploadCloud size={15} color={isDropzoneOpen ? '#ffffff' : '#0284c7'} />
                  <span>{isDropzoneOpen ? 'Close Data Sync' : 'Sync / Upload Files'}</span>
                </button>

                {snapshot && (
                  <button
                    type="button"
                    onClick={() => exportDeadStockToExcel(snapshot.items, 'NETWORK')}
                    style={{
                      height: '36px',
                      padding: '0 14px',
                      fontSize: '12.5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600,
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                      transition: 'all 0.15s ease'
                    }}
                    title="Export network dead stock (≥ 180 days) to Excel"
                  >
                    <Download size={14} color="#64748b" />
                    <span>Export Dead Stock</span>
                  </button>
                )}

                {snapshot && snapshot.investigationItems?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => exportInvestigationToExcel(snapshot.investigationItems, 'NETWORK')}
                    style={{
                      height: '36px',
                      padding: '0 14px',
                      fontSize: '12.5px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 600,
                      color: '#be123c',
                      border: '1px solid #fecdd3',
                      background: '#fff1f2',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    title="Export flagged investigation items (closed GSX repairs) to Excel"
                  >
                    <ShieldAlert size={14} color="#e11d48" />
                    <span>Export Flagged ({snapshot.investigationItems.length})</span>
                  </button>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 2. Unified 3-Slot Upload Center (No demo workspace defaults) */}
      {isDropzoneOpen && (
        <div
          className="card"
          style={{
            padding: '24px',
            background: '#ffffff',
            border: '2px solid #0284c7',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(2, 132, 199, 0.12)'
          }}
        >
          {/* Hidden file inputs */}
          <input
            type="file"
            ref={siteStockInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) handleSlotFileChange('site_stock', e.target.files[0]);
              e.target.value = '';
            }}
            accept=".csv,.xlsx,.xls,.txt"
            style={{ display: 'none' }}
          />
          <input
            type="file"
            ref={kgbInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) handleSlotFileChange('kgb_used', e.target.files[0]);
              e.target.value = '';
            }}
            accept=".csv,.xlsx,.xls,.txt"
            style={{ display: 'none' }}
          />
          <input
            type="file"
            ref={stockTransferInputRef}
            onChange={(e) => {
              if (e.target.files?.[0]) handleSlotFileChange('stock_transfer', e.target.files[0]);
              e.target.value = '';
            }}
            accept=".csv,.xlsx,.xls,.txt"
            style={{ display: 'none' }}
          />

          {/* Header of Upload Center */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UploadCloud size={22} color="#0284c7" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                  Unified Fixably Multi-File Ingestion Center
                </h3>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  Select or drop CSV / XLSX export files to automatically validate, reconcile branch inventory, and sync stock transfers in real time.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsDropzoneOpen(false)}
              style={{ border: 'none', background: '#f1f5f9', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* The 3 Drop Slots Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            
            {/* SLOT 1: Site Stocks (output.csv) [Required] */}
            <div
              onDragOver={(e) => handleSlotDragOver(e, 'site_stock')}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, 'site_stock')}
              onClick={() => !slots.site_stock.valid && siteStockInputRef.current?.click()}
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: activeSlotDrag === 'site_stock' ? '2px dashed #0284c7' : slots.site_stock.valid ? '2px solid #10b981' : slots.site_stock.error ? '2px solid #ef4444' : '2px dashed #cbd5e1',
                background: activeSlotDrag === 'site_stock' ? '#f0f9ff' : slots.site_stock.valid ? '#f0fdf4' : slots.site_stock.error ? '#fef2f2' : '#f8fafc',
                cursor: slots.site_stock.valid ? 'default' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Package size={17} color={slots.site_stock.valid ? '#16a34a' : '#0284c7'} />
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Slot 1: Site Stocks</strong>
                </div>
                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: slots.site_stock.valid ? '#dcfce7' : '#fee2e2', color: slots.site_stock.valid ? '#15803d' : '#b91c1c' }}>
                  REQUIRED
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px' }}>
                Expected: <code style={{ fontWeight: 700, color: '#0284c7' }}>output.csv / .xlsx</code> (Stock Name, Part Number, Serial, Last Received Date)
              </div>

              {slots.site_stock.valid ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #86efac', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span>{slots.site_stock.name}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>
                      {formatFileSize(slots.site_stock.size)} • {slots.site_stock.rowCount.toLocaleString()} inventory units
                      {slots.site_stock.updatedAt && (
                        <span style={{ color: '#047857', fontWeight: 600 }}> • Saved {new Date(slots.site_stock.updatedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        siteStockInputRef.current?.click();
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        border: '1px solid #86efac',
                        background: '#f0fdf4',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        color: '#15803d'
                      }}
                      title="Replace / Update File"
                    >
                      <RefreshCw size={11} />
                      <span>Replace</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearSlot('site_stock');
                      }}
                      style={{ border: 'none', background: '#fee2e2', borderRadius: '4px', padding: '5px', cursor: 'pointer', color: '#dc2626' }}
                      title="Remove file"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : slots.site_stock.error ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                    <AlertTriangle size={14} color="#dc2626" />
                    <span>Validation Error</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#991b1b' }}>{slots.site_stock.error}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      siteStockInputRef.current?.click();
                    }}
                    style={{ marginTop: '8px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Select Replacement File
                  </button>
                </div>
              ) : (
                <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', padding: '18px 10px', textAlign: 'center', background: '#ffffff' }}>
                  <UploadCloud size={24} color="#0284c7" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0284c7' }}>Select or drop CSV / XLSX</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Fixably branch on-hand stock export</div>
                </div>
              )}
            </div>

            {/* SLOT 2: KGB Used Report (kgb_used.csv) [Recommended] */}
            <div
              onDragOver={(e) => handleSlotDragOver(e, 'kgb_used')}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, 'kgb_used')}
              onClick={() => !slots.kgb_used.valid && kgbInputRef.current?.click()}
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: activeSlotDrag === 'kgb_used' ? '2px dashed #0284c7' : slots.kgb_used.valid ? '2px solid #10b981' : slots.kgb_used.error ? '2px solid #ef4444' : '2px dashed #cbd5e1',
                background: activeSlotDrag === 'kgb_used' ? '#f0f9ff' : slots.kgb_used.valid ? '#f0fdf4' : slots.kgb_used.error ? '#fef2f2' : '#f8fafc',
                cursor: slots.kgb_used.valid ? 'default' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldAlert size={17} color={slots.kgb_used.valid ? '#16a34a' : '#ea580c'} />
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Slot 2: GSX KGB Used Report</strong>
                </div>
                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: slots.kgb_used.valid ? '#dcfce7' : '#e0e7ff', color: slots.kgb_used.valid ? '#15803d' : '#3730a3' }}>
                  RECOMMENDED
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px' }}>
                Expected: <code style={{ fontWeight: 700, color: '#0284c7' }}>kgb_used.csv / .xlsx</code> (Order ID, Product KGB, Repair Closed Date)
              </div>

              {slots.kgb_used.valid ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #86efac', borderRadius: '8px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span>{slots.kgb_used.name}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>
                      {formatFileSize(slots.kgb_used.size)} • {slots.kgb_used.rowCount.toLocaleString()} repair log rows
                      {slots.kgb_used.updatedAt && (
                        <span style={{ color: '#047857', fontWeight: 600 }}> • Saved {new Date(slots.kgb_used.updatedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        kgbInputRef.current?.click();
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        border: '1px solid #86efac',
                        background: '#f0fdf4',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        color: '#15803d'
                      }}
                      title="Replace / Update File"
                    >
                      <RefreshCw size={11} />
                      <span>Replace</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearSlot('kgb_used');
                      }}
                      style={{ border: 'none', background: '#fee2e2', borderRadius: '4px', padding: '5px', cursor: 'pointer', color: '#dc2626' }}
                      title="Remove file"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : slots.kgb_used.error ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                    <AlertTriangle size={14} color="#dc2626" />
                    <span>Validation Error</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#991b1b' }}>{slots.kgb_used.error}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      kgbInputRef.current?.click();
                    }}
                    style={{ marginTop: '8px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Select Replacement File
                  </button>
                </div>
              ) : (
                <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', padding: '18px 10px', textAlign: 'center', background: '#ffffff' }}>
                  <UploadCloud size={24} color="#ea580c" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#ea580c' }}>Select or drop CSV / XLSX</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>GSX closed repair consumed parts</div>
                </div>
              )}
            </div>

            {/* SLOT 3: Stock Transfers (stock_transfer.csv) [Recommended] */}
            <div
              onDragOver={(e) => handleSlotDragOver(e, 'stock_transfer')}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, 'stock_transfer')}
              onClick={() => !slots.stock_transfer.valid && stockTransferInputRef.current?.click()}
              style={{
                padding: '16px',
                borderRadius: '10px',
                border: activeSlotDrag === 'stock_transfer' ? '2px dashed #0284c7' : slots.stock_transfer.valid ? '2px solid #10b981' : slots.stock_transfer.error ? '2px solid #ef4444' : '2px dashed #cbd5e1',
                background: activeSlotDrag === 'stock_transfer' ? '#f0f9ff' : slots.stock_transfer.valid ? '#f0fdf4' : slots.stock_transfer.error ? '#fef2f2' : '#f8fafc',
                cursor: slots.stock_transfer.valid ? 'default' : 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ArrowRightLeft size={17} color={slots.stock_transfer.valid ? '#16a34a' : '#6d28d9'} />
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Slot 3: Stock Transfers</strong>
                </div>
                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: slots.stock_transfer.valid ? '#dcfce7' : '#e0e7ff', color: slots.stock_transfer.valid ? '#15803d' : '#3730a3' }}>
                  AUTO-SYNC
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#475569', marginBottom: '12px' }}>
                Expected: <code style={{ fontWeight: 700, color: '#0284c7' }}>stock_transfer.csv / .xlsx</code> (From Stock, To Stock, Serial Number)
              </div>

              {slots.stock_transfer.valid ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #86efac', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CheckCircle2 size={15} color="#16a34a" />
                        <span>{slots.stock_transfer.name}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#4b5563', marginTop: '2px' }}>
                        {formatFileSize(slots.stock_transfer.size)} • {slots.stock_transfer.rowCount.toLocaleString()} transfer records
                        {slots.stock_transfer.updatedAt && (
                          <span style={{ color: '#047857', fontWeight: 600 }}> • Saved {new Date(slots.stock_transfer.updatedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          stockTransferInputRef.current?.click();
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          border: '1px solid #86efac',
                          background: '#f0fdf4',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          color: '#15803d'
                        }}
                        title="Replace / Update File"
                      >
                        <RefreshCw size={11} />
                        <span>Replace</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearSlot('stock_transfer');
                        }}
                        style={{ border: 'none', background: '#fee2e2', borderRadius: '4px', padding: '5px', cursor: 'pointer', color: '#dc2626' }}
                        title="Remove file"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                  {(slots.stock_transfer.validationDetails || snapshot?.transferStats) && (
                    <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #bbf7d0', display: 'flex', gap: '6px', flexWrap: 'wrap', fontSize: '10.5px' }}>
                      <span style={{ background: '#f5f3ff', color: '#6d28d9', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        {(slots.stock_transfer.validationDetails?.siteToSiteCount ?? snapshot?.transferStats?.siteToSiteCount ?? 0).toLocaleString()} Site-to-Site
                      </span>
                      <span style={{ background: '#eff6ff', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                        {(slots.stock_transfer.validationDetails?.dcToSiteCount ?? snapshot?.transferStats?.dcToSiteCount ?? 0).toLocaleString()} DC Transfers
                      </span>
                      {(slots.stock_transfer.validationDetails?.duplicateCount > 0 || slots.stock_transfer.validationDetails?.missingFieldsCount > 0) && (
                        <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                          {slots.stock_transfer.validationDetails.duplicateCount || 0} dup / {slots.stock_transfer.validationDetails.missingFieldsCount || 0} skipped
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : slots.stock_transfer.error ? (
                <div style={{ background: '#ffffff', border: '1.5px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                    <AlertTriangle size={14} color="#dc2626" />
                    <span>Validation Error</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#991b1b' }}>{slots.stock_transfer.error}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      stockTransferInputRef.current?.click();
                    }}
                    style={{ marginTop: '8px', border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Select Replacement File
                  </button>
                </div>
              ) : (
                <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '8px', padding: '18px 10px', textAlign: 'center', background: '#ffffff' }}>
                  <UploadCloud size={24} color="#6d28d9" style={{ margin: '0 auto 6px' }} />
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#6d28d9' }}>Select or drop CSV / XLSX</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>DC &amp; Site-to-Site stock transfers</div>
                </div>
              )}
            </div>

          </div>

          {/* Action Toolbar & Progress */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleClearAllSlots}
                disabled={isParsing}
                style={{ fontSize: '12px', padding: '7px 14px', background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Clear All Slots
              </button>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#334155', cursor: 'pointer', fontWeight: 600, marginLeft: '6px' }}>
                <input
                  type="checkbox"
                  checked={syncWithAppInventory}
                  onChange={(e) => setSyncWithAppInventory(e.target.checked)}
                />
                <span>Sync with App Active Stock (Branch Inventory)</span>
              </label>
            </div>

            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProcessMultiFile}
                disabled={isParsing || !slots.site_stock.valid || Boolean(slots.site_stock.error)}
                style={{
                  padding: '9px 24px',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)'
                }}
              >
                {isParsing ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    <span>Processing &amp; Reconciling...</span>
                  </>
                ) : (
                  <>
                    <Zap size={15} />
                    <span>Process &amp; Sync Inventory</span>
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Parsing progress bar */}
          {isParsing && parseProgress && (
            <div style={{ marginTop: '16px', background: '#f0f9ff', padding: '12px 16px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#0369a1', fontWeight: 700, marginBottom: '6px' }}>
                <span>{parseProgress.stage}</span>
                <span>{parseProgress.percent}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0f2fe', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${parseProgress.percent}%`, height: '100%', background: '#0284c7', transition: 'width 0.2s ease' }} />
              </div>
            </div>
          )}

        </div>
      )}

      {/* 3. Global Summary KPI Cards (Balanced 4-Column Executive Grid) */}
      {(displayMetrics || snapshot?.globalMetrics) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '14px'
          }}
        >
          {/* Card 1: Total Active Value */}
          <div
            className="card"
            style={{
              padding: '18px 20px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderTop: '3px solid #0284c7',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Active Inventory Value
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f0f9ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Boxes size={16} color="#0284c7" />
              </div>
            </div>
            <div style={{ fontSize: '23px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              ${Number(displayMetrics.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>
              {displayMetrics.isScopedToBranch ? `Assigned Branch (${displayMetrics.branchCode})` : `Across ${displayMetrics.sitesCount} service points`}
            </div>
          </div>

          {/* Card 2: Total Units On-Hand */}
          <div
            className="card"
            onClick={() => {
              if (isSuperadmin) {
                setViewMode('all_stocks');
                setAgingFilter('ALL');
                setInvestigationFilter('ALL');
                setTransferFilter('ALL');
              } else {
                if (userSiteCodeClean) setSelectedSiteCode(userSiteCodeClean);
                setSegmentedTab('all_stock');
              }
            }}
            style={{
              padding: '18px 20px',
              background: '#ffffff',
              border: (viewMode === 'all_stocks' && agingFilter === 'ALL' && investigationFilter === 'ALL' && transferFilter === 'ALL') ? '2px solid #0284c7' : '1px solid #e2e8f0',
              borderTop: '3px solid #10b981',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
            title={displayMetrics.isScopedToBranch ? 'Click to view branch on-hand units' : 'Click to view all on-hand units'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Total Units On-Hand
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Package size={16} color="#059669" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '23px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {displayMetrics.totalUnits.toLocaleString()}
              </div>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#059669', background: '#ecfdf5', padding: '2px 7px', borderRadius: '999px' }}>
                {displayMetrics.uniqueParts} SKUs
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>
              {displayMetrics.isScopedToBranch ? 'Active branch catalog' : 'Click to view all on-hand stock'}
            </div>
          </div>

          {/* Card 3: Dead Stock (>= 180 days) */}
          <div
            className="card"
            onClick={() => {
              if (isSuperadmin) {
                setViewMode('all_stocks');
                setAgingFilter(prev => prev === AGING_BRACKETS.DEAD_STOCK ? 'ALL' : AGING_BRACKETS.DEAD_STOCK);
              } else {
                if (userSiteCodeClean) setSelectedSiteCode(userSiteCodeClean);
                setSegmentedTab('dead_stock');
              }
            }}
            style={{
              padding: '18px 20px',
              background: agingFilter === AGING_BRACKETS.DEAD_STOCK ? '#fff1f2' : '#ffffff',
              border: agingFilter === AGING_BRACKETS.DEAD_STOCK ? '2px solid #e11d48' : '1px solid #e2e8f0',
              borderTop: '3px solid #e11d48',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
            title={displayMetrics.isScopedToBranch ? 'Click to view branch Dead Stock (≥ 180 days)' : 'Click to filter to Dead Stock (≥ 180 days)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Dead Stock (≥ 180d)
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fff1f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <AlertTriangle size={16} color="#e11d48" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '23px', fontWeight: 800, color: '#be123c', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {displayMetrics.agingCounts[AGING_BRACKETS.DEAD_STOCK]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#be123c', background: '#ffe4e6', padding: '2px 7px', borderRadius: '999px' }}>
                {displayMetrics.deadStockPercent}%
              </span>
            </div>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: agingFilter === AGING_BRACKETS.DEAD_STOCK ? '#be123c' : '#64748b' }}>
              {agingFilter === AGING_BRACKETS.DEAD_STOCK ? 'Filter active • Click to reset' : 'Action required (RMA pull-out)'}
            </div>
          </div>

          {/* Card 4: Non-Moving (90 - 179 days) */}
          <div
            className="card"
            onClick={() => {
              if (isSuperadmin) {
                setViewMode('all_stocks');
                setAgingFilter(prev => prev === AGING_BRACKETS.NON_MOVING ? 'ALL' : AGING_BRACKETS.NON_MOVING);
              } else {
                if (userSiteCodeClean) setSelectedSiteCode(userSiteCodeClean);
                setSegmentedTab('non_moving');
              }
            }}
            style={{
              padding: '18px 20px',
              background: agingFilter === AGING_BRACKETS.NON_MOVING ? '#fff7ed' : '#ffffff',
              border: agingFilter === AGING_BRACKETS.NON_MOVING ? '2px solid #ea580c' : '1px solid #e2e8f0',
              borderTop: '3px solid #ea580c',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
            title={displayMetrics.isScopedToBranch ? 'Click to view branch Non-Moving Stock (90–179 days)' : 'Click to filter to Non-Moving Stock (90–179 days)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Non-Moving (90–179d)
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Clock size={16} color="#ea580c" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '23px', fontWeight: 800, color: '#c2410c', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {displayMetrics.agingCounts[AGING_BRACKETS.NON_MOVING]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#c2410c', background: '#ffedd5', padding: '2px 7px', borderRadius: '999px' }}>
                {displayMetrics.nonMovingPercent}%
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: agingFilter === AGING_BRACKETS.NON_MOVING ? '#c2410c' : '#64748b', fontWeight: 600 }}>
              {agingFilter === AGING_BRACKETS.NON_MOVING ? 'Filter active • Click to reset' : 'Pre-aging inventory tier'}
            </div>
          </div>

          {/* Card 5: Slow-Moving (60 - 89 days) */}
          <div
            className="card"
            onClick={() => {
              if (isSuperadmin) {
                setViewMode('all_stocks');
                setAgingFilter(prev => prev === AGING_BRACKETS.SLOW_MOVING ? 'ALL' : AGING_BRACKETS.SLOW_MOVING);
              } else {
                if (userSiteCodeClean) setSelectedSiteCode(userSiteCodeClean);
                setSegmentedTab('slow_moving');
              }
            }}
            style={{
              padding: '18px 20px',
              background: agingFilter === AGING_BRACKETS.SLOW_MOVING ? '#fffbeb' : '#ffffff',
              border: agingFilter === AGING_BRACKETS.SLOW_MOVING ? '2px solid #d97706' : '1px solid #e2e8f0',
              borderTop: '3px solid #d97706',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
            title={displayMetrics.isScopedToBranch ? 'Click to view branch Slow-Moving Stock (60–89 days)' : 'Click to filter to Slow-Moving Stock (60–89 days)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Slow-Moving (60–89d)
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <TrendingDown size={16} color="#d97706" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '23px', fontWeight: 800, color: '#b45309', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {displayMetrics.agingCounts[AGING_BRACKETS.SLOW_MOVING]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '2px 7px', borderRadius: '999px' }}>
                {displayMetrics.slowMovingPercent}%
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: agingFilter === AGING_BRACKETS.SLOW_MOVING ? '#b45309' : '#64748b', fontWeight: 600 }}>
              {agingFilter === AGING_BRACKETS.SLOW_MOVING ? 'Filter active • Click to reset' : 'Monitor branch rotation'}
            </div>
          </div>

          {/* Card 6: In Stock / Active (< 60 days) */}
          <div
            className="card"
            onClick={() => {
              if (isSuperadmin) {
                setViewMode('all_stocks');
                setAgingFilter(prev => prev === AGING_BRACKETS.IN_STOCK ? 'ALL' : AGING_BRACKETS.IN_STOCK);
              } else {
                if (userSiteCodeClean) setSelectedSiteCode(userSiteCodeClean);
                setSegmentedTab('active_stock');
              }
            }}
            style={{
              padding: '18px 20px',
              background: agingFilter === AGING_BRACKETS.IN_STOCK ? '#f0fdf4' : '#ffffff',
              border: agingFilter === AGING_BRACKETS.IN_STOCK ? '2px solid #16a34a' : '1px solid #e2e8f0',
              borderTop: '3px solid #16a34a',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
            title={displayMetrics.isScopedToBranch ? 'Click to view branch Active In-Stock (< 60 days)' : 'Click to filter to Active In-Stock (< 60 days)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                Active Stock (&lt; 60d)
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircle2 size={16} color="#16a34a" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '23px', fontWeight: 800, color: '#15803d', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {displayMetrics.agingCounts[AGING_BRACKETS.IN_STOCK]?.toLocaleString() || 0}
              </div>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '2px 7px', borderRadius: '999px' }}>
                {displayMetrics.inStockPercent}%
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: agingFilter === AGING_BRACKETS.IN_STOCK ? '#15803d' : '#64748b', fontWeight: 600 }}>
              {agingFilter === AGING_BRACKETS.IN_STOCK ? 'Filter active • Click to reset' : 'Healthy active rotation'}
            </div>
          </div>

          {/* Card 7: KGB Closed Repairs */}
          <div
            className="card"
            onClick={() => {
              if (isSuperadmin) {
                setViewMode('all_stocks');
                setInvestigationFilter(prev => prev === 'INVESTIGATION_ONLY' ? 'ALL' : 'INVESTIGATION_ONLY');
              } else {
                if (userSiteCodeClean) setSelectedSiteCode(userSiteCodeClean);
                setSegmentedTab('investigation');
              }
            }}
            style={{
              padding: '18px 20px',
              background: investigationFilter === 'INVESTIGATION_ONLY' ? '#fff1f2' : '#ffffff',
              border: investigationFilter === 'INVESTIGATION_ONLY' ? '2px solid #e11d48' : '1px solid #e2e8f0',
              borderTop: '3px solid #f43f5e',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
            title={displayMetrics.isScopedToBranch ? 'Click to view branch parts flagged in closed repairs' : 'Click to filter on-hand parts consumed in GSX repairs'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                KGB Closed Repairs
              </span>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fff1f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ShieldAlert size={16} color="#e11d48" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '23px', fontWeight: 800, color: '#be123c', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {displayMetrics.investigationCount.toLocaleString()}
              </div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#be123c', background: '#ffe4e6', padding: '2px 7px', borderRadius: '999px' }}>
                FLAGGED
              </span>
            </div>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: investigationFilter === 'INVESTIGATION_ONLY' ? '#be123c' : '#64748b' }}>
              {investigationFilter === 'INVESTIGATION_ONLY' ? 'Filter active • Click to reset' : 'On-hand parts matched in GSX'}
            </div>
          </div>

          {/* Card 8: Site Transfers & Stock Movements */}
          {isSuperadmin && (
            <div
              className="card"
              onClick={() => {
                setViewMode(prev => prev === 'site_transfers' ? 'all_stocks' : 'site_transfers');
                setTransfersSubTab('site_to_site');
              }}
              style={{
                padding: '18px 20px',
                background: viewMode === 'site_transfers' ? '#f5f3ff' : '#ffffff',
                border: viewMode === 'site_transfers' ? '2px solid #6d28d9' : '1px solid #e2e8f0',
                borderTop: '3px solid #6d28d9',
                borderRadius: '12px',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '8px',
                transition: 'all 0.15s ease'
              }}
              title="Click to toggle between On-Hand Stock Directory and Site Transfers & Movement Ledger"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                  Site Transfers
                </span>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <ArrowRightLeft size={16} color="#6d28d9" />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <div style={{ fontSize: '23px', fontWeight: 800, color: '#5b21b6', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {(snapshot?.siteToSiteTransfers?.length || snapshot?.transferStats?.siteToSiteCount || 0).toLocaleString()}
                </div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#6d28d9', background: '#ede9fe', padding: '2px 7px', borderRadius: '999px' }}>
                  SITE-TO-SITE
                </span>
              </div>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: viewMode === 'site_transfers' ? '#6d28d9' : '#64748b' }}>
                {(snapshot?.transfers?.length || snapshot?.transferStats?.totalTransfers || 0).toLocaleString()} total movements • {viewMode === 'site_transfers' ? 'Viewing Ledger' : 'View Ledger'}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: "ALL STOCKS" MASTER DIRECTORY TABLE (Clean Integrated Workspace)  */}
      {/* ========================================================================= */}
      {viewMode === 'all_stocks' && isSuperadmin && (
        <div
          className="card"
          style={{
            padding: 0,
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            background: '#ffffff',
            boxShadow: '0 2px 12px rgba(15, 23, 42, 0.04)'
          }}
        >
          {/* Integrated Workspace Tab Header (Replaces Duplicate Top Page Switcher) */}
          <div
            style={{
              padding: '0 24px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', overflowX: 'auto' }}>
              <button
                type="button"
                onClick={() => setViewMode('all_stocks')}
                style={{
                  padding: '15px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '2.5px solid #0284c7',
                  color: '#0284c7',
                  fontSize: '13.5px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Package size={16} />
                <span>On-Hand Stock Directory</span>
                <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, background: '#e0f2fe', color: '#0369a1' }}>
                  {(snapshot?.items?.length || 0).toLocaleString()}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode('site_transfers');
                  setTransfersSubTab('site_to_site');
                }}
                style={{
                  padding: '15px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '2.5px solid transparent',
                  color: '#64748b',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s ease'
                }}
              >
                <ArrowRightLeft size={16} />
                <span>Site Transfers &amp; Movement Ledger</span>
                <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: '#f5f3ff', color: '#6d28d9' }}>
                  {(snapshot?.siteToSiteTransfers?.length || snapshot?.transferStats?.siteToSiteCount || 0).toLocaleString()} Site-to-Site
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode('site_transfers');
                  setTransfersSubTab('activity_logs');
                }}
                style={{
                  padding: '15px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '2.5px solid transparent',
                  color: '#64748b',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s ease'
                }}
              >
                <Clock size={15} />
                <span>Upload &amp; Sync Audit Log</span>
                {activityLogs.length > 0 && (
                  <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: '#f1f5f9', color: '#475569' }}>
                    {activityLogs.length}
                  </span>
                )}
              </button>
            </div>

            {/* Quick Summary Pills */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }}>
              <span style={{ padding: '4px 10px', borderRadius: '999px', background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', fontSize: '11.5px', fontWeight: 700 }}>
                DC Stock: {filteredMasterItems.filter(i => i.stockType === 'DC Stock').length.toLocaleString()}
              </span>
              <span style={{ padding: '4px 10px', borderRadius: '999px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '11.5px', fontWeight: 700 }}>
                MSPI-Owned: {filteredMasterItems.filter(i => i.stockType !== 'DC Stock').length.toLocaleString()}
              </span>
              <span
                onClick={() => {
                  setViewMode('site_transfers');
                  setTransfersSubTab('site_to_site');
                }}
                style={{ padding: '4px 10px', borderRadius: '999px', background: '#faf5ff', color: '#5b21b6', border: '1px solid #e9d5ff', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}
                title="Click to inspect Site-to-Site Transfer Ledger"
              >
                Relocated: {filteredMasterItems.filter(i => i.siteToSiteCount > 0 || i.relocatedByTransfer || i.synthesizedFromTransfer).length.toLocaleString()}
              </span>
              {filteredMasterItems.filter(i => i.isInvestigation).length > 0 && (
                <span style={{ padding: '4px 10px', borderRadius: '999px', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', fontSize: '11.5px', fontWeight: 700 }}>
                  Flagged: {filteredMasterItems.filter(i => i.isInvestigation).length.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {/* Structured Filter Toolbar */}
          <div style={{ padding: '18px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {/* Row 1: Expansive Search Input + Result Count + Reset */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <div style={{ position: 'relative', flex: '1 1 360px', maxWidth: '640px' }}>
                <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{
                    width: '100%',
                    paddingLeft: '40px',
                    paddingRight: masterSearch ? '34px' : '12px',
                    fontSize: '13px',
                    height: '40px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontWeight: 500,
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)'
                  }}
                  placeholder="Search by part number, description, serial number, branch code, or movement trail..."
                  value={masterSearch}
                  onChange={(e) => setMasterSearch(e.target.value)}
                />
                {masterSearch && (
                  <button
                    type="button"
                    onClick={() => setMasterSearch('')}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  Showing <strong style={{ color: '#0f172a', fontWeight: 800 }}>{filteredMasterItems.length.toLocaleString()}</strong> of {(snapshot?.items?.length || 0).toLocaleString()} units
                </div>

                {(masterSearch || siteFilter !== 'ALL' || agingFilter !== 'ALL' || classificationFilter !== 'ALL' || investigationFilter !== 'ALL' || transferFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setMasterSearch('');
                      setSiteFilter('ALL');
                      setAgingFilter('ALL');
                      setClassificationFilter('ALL');
                      setInvestigationFilter('ALL');
                      setTransferFilter('ALL');
                    }}
                    style={{
                      fontSize: '12px',
                      padding: '0 12px',
                      height: '34px',
                      fontWeight: 700,
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#dc2626',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                    title="Reset all active filters"
                  >
                    <X size={13} />
                    <span>Clear Filters</span>
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: 6-Column Uniform Filter Grid with Stacked Micro-Labels */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '12px'
              }}
            >
              {/* Branch Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Branch Location
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', padding: '0 10px', height: '38px', borderRadius: '8px', border: siteFilter !== 'ALL' ? '1.5px solid #0284c7' : '1px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                  value={siteFilter}
                  onChange={(e) => setSiteFilter(e.target.value)}
                >
                  <option value="ALL">All Branches ({snapshot?.sites?.length || 0})</option>
                  {snapshot?.sites?.map(s => (
                    <option key={s.siteCode} value={s.siteCode}>
                      {s.siteCode} ({s.totalUnits})
                    </option>
                  ))}
                </select>
              </div>

              {/* Aging Bracket Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Aging Bracket
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', padding: '0 10px', height: '38px', borderRadius: '8px', border: agingFilter !== 'ALL' ? '1.5px solid #0284c7' : '1px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                  value={agingFilter}
                  onChange={(e) => setAgingFilter(e.target.value)}
                >
                  <option value="ALL">All Aging Brackets</option>
                  <option value={AGING_BRACKETS.DEAD_STOCK}>Dead Stock (≥ 180d)</option>
                  <option value={AGING_BRACKETS.NON_MOVING}>Non-Moving (90–179d)</option>
                  <option value={AGING_BRACKETS.SLOW_MOVING}>Slow-Moving (60–89d)</option>
                  <option value={AGING_BRACKETS.IN_STOCK}>Active Stock (&lt; 60d)</option>
                </select>
              </div>

              {/* Stock Classification Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Stock Ownership
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', padding: '0 10px', height: '38px', borderRadius: '8px', border: classificationFilter !== 'ALL' ? '1.5px solid #0284c7' : '1px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                  value={classificationFilter}
                  onChange={(e) => setClassificationFilter(e.target.value)}
                >
                  <option value="ALL">All Stock Types</option>
                  <option value="DC Stock">DC Stock</option>
                  <option value="MSPI-Owned / C/I REP">MSPI-Owned / C/I REP</option>
                </select>
              </div>

              {/* Stock Movement / Transfer Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Transfer Movement
                </label>
                <select
                  className="form-select"
                  style={{
                    width: '100%',
                    fontSize: '12.5px',
                    padding: '0 10px',
                    height: '38px',
                    borderRadius: '8px',
                    border: transferFilter !== 'ALL' ? '1.5px solid #6d28d9' : '1px solid #cbd5e1',
                    background: transferFilter !== 'ALL' ? '#f5f3ff' : '#ffffff',
                    color: transferFilter !== 'ALL' ? '#6d28d9' : '#0f172a',
                    fontWeight: 600
                  }}
                  value={transferFilter}
                  onChange={(e) => setTransferFilter(e.target.value)}
                >
                  <option value="ALL">All Movements</option>
                  <option value="SITE_TO_SITE_ONLY">
                    Site-to-Site Transferred ({snapshot?.items?.filter(i => i.siteToSiteCount > 0 || i.relocatedByTransfer || i.synthesizedFromTransfer).length || 0})
                  </option>
                  <option value="RELOCATED_ONLY">
                    Relocated / Post-Cutoff ({snapshot?.items?.filter(i => i.relocatedByTransfer || i.synthesizedFromTransfer).length || 0})
                  </option>
                  <option value="TRANSFERRED_ONLY">
                    All Transferred Units ({snapshot?.items?.filter(i => i.transferCount > 0 || i.isDcTransfer).length || 0})
                  </option>
                </select>
              </div>

              {/* GSX Repair Audit Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  GSX Repair Audit
                </label>
                <select
                  className="form-select"
                  style={{
                    width: '100%',
                    fontSize: '12.5px',
                    padding: '0 10px',
                    height: '38px',
                    borderRadius: '8px',
                    border: investigationFilter === 'INVESTIGATION_ONLY' ? '1.5px solid #e11d48' : '1px solid #cbd5e1',
                    background: investigationFilter === 'INVESTIGATION_ONLY' ? '#fff1f2' : '#ffffff',
                    color: investigationFilter === 'INVESTIGATION_ONLY' ? '#be123c' : '#0f172a',
                    fontWeight: 600
                  }}
                  value={investigationFilter}
                  onChange={(e) => setInvestigationFilter(e.target.value)}
                >
                  <option value="ALL">All Audit Statuses</option>
                  <option value="INVESTIGATION_ONLY">Flagged in Closed Repairs ({snapshot?.investigationItems?.length || snapshot?.globalMetrics?.investigationCount || 0})</option>
                  <option value="CLEAN_ONLY">Verified Clean Stock</option>
                </select>
              </div>

              {/* Rows Per Page */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Page Size
                </label>
                <select
                  className="form-select"
                  style={{ width: '100%', fontSize: '12.5px', padding: '0 10px', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 600, color: '#0f172a' }}
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                >
                  <option value={25}>25 rows / page</option>
                  <option value={50}>50 rows / page</option>
                  <option value={100}>100 rows / page</option>
                  <option value={200}>200 rows / page</option>
                  <option value="ALL">Show All Rows</option>
                </select>
              </div>
            </div>
          </div>

          {/* Master Table: High-Visibility Dark Sticky Header & High-Contrast Typography */}
          <div className="table-container" style={{ overflowX: 'auto', maxHeight: '720px' }}>
            {paginatedMasterItems.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
                <Boxes size={40} color="#94a3b8" style={{ marginBottom: '10px' }} />
                <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '16px', fontWeight: 800 }}>No Inventory Records Match Your Filter</h4>
                <p style={{ margin: 0, fontSize: '13px' }}>Try broadening your search query or resetting the dropdown filters.</p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #0284c7' }}>
                    <th style={{ width: '50px', textAlign: 'center', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>#</th>
                    <th style={{ minWidth: '150px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                    <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Description</th>
                    <th style={{ width: '110px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Branch</th>
                    <th style={{ width: '140px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Classification</th>
                    <th style={{ minWidth: '175px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Serial Number</th>
                    <th style={{ minWidth: '210px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Movement History &amp; Owner</th>
                    <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Last Received</th>
                    <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Aging &amp; Status</th>
                    <th style={{ minWidth: '180px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>GSX / Dispatch Status</th>
                    <th style={{ width: '110px', textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedMasterItems.map((item, idx) => {
                    const rowNumber = rowsPerPage === 'ALL' ? idx + 1 : (currentPage - 1) * rowsPerPage + idx + 1;
                    const isCopied = copiedSerial === item.serialNumber;
                    const isEven = idx % 2 === 1;
                    const isSiteTransferred = Boolean(item.siteToSiteCount > 0 || item.relocatedByTransfer || item.synthesizedFromTransfer);
                    const movementTrailText = item.movementTrail || (item.isDcTransfer ? `DC → ${item.cleanSiteCode || item.siteCode}` : `${item.cleanSiteCode || item.siteCode}`);
                    const currentOwnerText = item.currentOwner || `${item.cleanSiteCode || item.siteCode}_MSPI-OWNED`;

                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: '1px solid #e2e8f0',
                          background: item.isInvestigation ? '#fff5f5' : isSiteTransferred ? '#faf5ff' : isEven ? '#f8fafc' : '#ffffff',
                          transition: 'background-color 0.1s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#e0f2fe';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = item.isInvestigation ? '#fff5f5' : isSiteTransferred ? '#faf5ff' : isEven ? '#f8fafc' : '#ffffff';
                        }}
                      >
                        <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 700, verticalAlign: 'middle', padding: '12px 10px', whiteSpace: 'nowrap' }}>
                          {rowNumber}
                        </td>
                        
                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#0284c7', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', fontWeight: 700 }}>
                              {item.partNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.partNumber, 'Part Number')}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                              title="Copy Part Number"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px' }}>
                          <div style={{ color: '#0f172a', fontWeight: 500, fontSize: '13px', lineHeight: 1.4, minWidth: '220px' }}>
                            {item.description}
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                            <span
                              onClick={() => {
                                setSelectedSiteCode(item.cleanSiteCode || item.siteCode.replace(/^(ASP|APP)\s+/, ''));
                                setViewMode('multi_site');
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '4px 9px',
                                borderRadius: '6px',
                                background: isSiteTransferred ? '#ede9fe' : '#f1f5f9',
                                color: isSiteTransferred ? '#5b21b6' : '#1e293b',
                                fontWeight: 800,
                                fontSize: '11.5px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                border: isSiteTransferred ? '1px solid #c4b5fd' : '1px solid #e2e8f0',
                                transition: 'background-color 0.15s ease'
                              }}
                              title="Click to view branch in Multi-Site dashboard"
                            >
                              {item.siteCode}
                            </span>
                            {item.previousSiteCode && item.previousSiteCode !== (item.cleanSiteCode || item.siteCode.replace(/^(ASP|APP)\s+/, '')) && (
                              <span style={{ fontSize: '10px', color: '#6d28d9', fontWeight: 700 }}>
                                From {item.previousSiteCode}
                              </span>
                            )}
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '3px 9px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              background: item.stockType === 'DC Stock' ? '#f5f3ff' : '#f0f9ff',
                              color: item.stockType === 'DC Stock' ? '#6d28d9' : '#0369a1',
                              border: item.stockType === 'DC Stock' ? '1px solid #ddd6fe' : '1px solid #bae6fd'
                            }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.stockType === 'DC Stock' ? '#8b5cf6' : '#0284c7' }} />
                            {item.stockType}
                          </span>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {item.serialNumber ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                onClick={() => {
                                  const details = resolveSerialFullDetails(item.serialNumber, {
                                    inventoryUnits: effectiveInventoryUnits,
                                    fixablyItems: snapshot?.items || [],
                                    fixablyTransfers: snapshot?.transfers || [],
                                    sites,
                                    parts
                                  });
                                  if (details) setInspectedSerialDetails(details);
                                }}
                                style={{
                                  fontSize: '12px',
                                  color: '#0f172a',
                                  background: '#f8fafc',
                                  border: '1px solid #cbd5e1',
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  fontWeight: 700,
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                  letterSpacing: '0.02em',
                                  cursor: 'pointer'
                                }}
                                title="Click to inspect full Serial Dossier & Ownership History"
                              >
                                {item.serialNumber}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(item.serialNumber, 'Serial')}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: isCopied ? '#16a34a' : '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                title="Copy Serial Number"
                              >
                                {isCopied ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '11.5px', fontStyle: 'italic' }}>Non-serialized (Qty: {item.quantity})</span>
                          )}
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <div
                            onClick={() => setInspectedMovementUnit({
                              ...item,
                              serial_number: item.serialNumber,
                              part_number: item.partNumber,
                              site_code: item.siteCode,
                              current_owner: currentOwnerText,
                              movement_history: item.movementHistory
                            })}
                            style={{ cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', gap: '3px' }}
                            title="Click to inspect chronological Stock Transfer & Movement Timeline"
                          >
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '5px',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  background: isSiteTransferred ? '#ede9fe' : item.transferCount > 0 ? '#eff6ff' : '#f1f5f9',
                                  color: isSiteTransferred ? '#5b21b6' : item.transferCount > 0 ? '#0369a1' : '#475569',
                                  border: isSiteTransferred ? '1px solid #c4b5fd' : item.transferCount > 0 ? '1px solid #bae6fd' : '1px solid #e2e8f0'
                                }}
                              >
                                <ArrowRightLeft size={11} />
                                <span>{movementTrailText}</span>
                              </span>
                              {(item.transferCount > 0) && (
                                <span style={{ fontSize: '10.5px', fontWeight: 800, color: isSiteTransferred ? '#6d28d9' : '#0284c7' }}>
                                  ({item.transferCount} {item.transferCount === 1 ? 'transfer' : 'transfers'})
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                              Owner: {currentOwnerText}
                            </span>
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', fontSize: '12px', color: '#475569', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', whiteSpace: 'nowrap' }}>
                          {item.lastReceivedDate || '—'}
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 9px',
                                borderRadius: '6px',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                background: item.badgeBg,
                                color: item.badgeColor,
                                border: item.agingBracket === AGING_BRACKETS.DEAD_STOCK ? '1px solid #fca5a5'
                                  : item.agingBracket === AGING_BRACKETS.NON_MOVING ? '1px solid #fdba74'
                                  : item.agingBracket === AGING_BRACKETS.SLOW_MOVING ? '1px solid #fde047'
                                  : '1px solid #86efac'
                              }}
                              title={item.statusLabel}
                            >
                              {item.agingBracket === AGING_BRACKETS.DEAD_STOCK && <AlertTriangle size={12} color="#dc2626" />}
                              {item.agingBracket === AGING_BRACKETS.NON_MOVING && <Clock size={12} color="#ea580c" />}
                              {item.agingBracket === AGING_BRACKETS.SLOW_MOVING && <TrendingDown size={12} color="#d97706" />}
                              {item.agingBracket === AGING_BRACKETS.IN_STOCK && <CheckCircle2 size={12} color="#16a34a" />}
                              <span>
                                {item.agingBracket === AGING_BRACKETS.DEAD_STOCK
                                  ? `Dead Stock (${item.agingDays}d)`
                                  : item.agingBracket === AGING_BRACKETS.NON_MOVING
                                  ? `Non-Moving (${item.agingDays}d)`
                                  : item.agingBracket === AGING_BRACKETS.SLOW_MOVING
                                  ? `Slow-Moving (${item.agingDays}d)`
                                  : `In Stock (${item.agingDays}d)`}
                              </span>
                            </span>

                            {item.agingBracket === AGING_BRACKETS.DEAD_STOCK && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  border: '1px solid #fca5a5',
                                  whiteSpace: 'nowrap'
                                }}
                                title="Action Required: RMA pull-out or site reallocation"
                              >
                                Action Req.
                              </span>
                            )}
                          </div>
                        </td>

                        <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                          {item.isInvestigation ? (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: '#fff1f2',
                                color: '#be123c',
                                border: '1px solid #fecdd3'
                              }}
                              title={`Closed GSX Repair Order #${item.investigationDetails?.orderId || ''} (${item.investigationDetails?.gsxStatus || 'SCOM'}) closed on ${item.investigationDetails?.repairClosedDate || ''} at ${item.investigationDetails?.locationName || ''}`}
                            >
                              <ShieldAlert size={12} color="#e11d48" />
                              <span>Order #{item.investigationDetails?.orderId} ({item.investigationDetails?.gsxStatus || 'SCOM'})</span>
                            </div>
                          ) : (
                            <span style={{ color: '#059669', fontSize: '11.5px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Check size={13} color="#059669" />
                              <span>Verified Clean</span>
                            </span>
                          )}
                        </td>

                        <td style={{ verticalAlign: 'middle', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', color: '#0f172a', padding: '12px 16px', whiteSpace: 'nowrap' }}>
                          ${(item.totalValue || item.partValue || 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Controls with High Contrast */}
          {rowsPerPage !== 'ALL' && totalPages > 1 && (
            <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', color: '#334155', fontWeight: 600 }}>
                Page <strong style={{ color: '#0f172a' }}>{currentPage}</strong> of <strong style={{ color: '#0f172a' }}>{totalPages}</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  style={{ fontSize: '12px', padding: '5px 10px', fontWeight: 700 }}
                >
                  First
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  style={{ fontSize: '12px', padding: '5px 8px' }}
                >
                  <ChevronLeft size={14} />
                </button>

                <span style={{ fontSize: '12.5px', padding: '0 10px', fontWeight: 800, color: '#0f172a' }}>
                  {currentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  style={{ fontSize: '12px', padding: '5px 8px' }}
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  style={{ fontSize: '12px', padding: '5px 10px', fontWeight: 700 }}
                >
                  Last
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: SITE TRANSFERS, MOVEMENT HISTORY & ACTIVITY AUDIT LEDGER          */}
      {/* ========================================================================= */}
      {viewMode === 'site_transfers' && isSuperadmin && (() => {
        const allTransfersList = Array.isArray(snapshot?.transfers) ? snapshot.transfers : [];
        const siteToSiteList = Array.isArray(snapshot?.siteToSiteTransfers)
          ? snapshot.siteToSiteTransfers
          : allTransfersList.filter(t => t.isSiteToSite);
        const adjustmentList = [
          ...(Array.isArray(snapshot?.adjustmentTransfers) ? snapshot.adjustmentTransfers : allTransfersList.filter(t => t.isAdjustment)),
          ...(Array.isArray(snapshot?.returnToDcTransfers) ? snapshot.returnToDcTransfers : allTransfersList.filter(t => t.isReturnToDc))
        ];

        const activeSourceList =
          transfersSubTab === 'site_to_site'
            ? siteToSiteList
            : transfersSubTab === 'adjustments'
            ? adjustmentList
            : allTransfersList;

        // Sort newest receivedDate first so recent transfers (e.g. 2026-10-27 BHS -> POD) appear at the top
        const sortedTransfers = [...activeSourceList].sort((a, b) => {
          const da = a.receivedDate || '';
          const db = b.receivedDate || '';
          if (da !== db) return db.localeCompare(da);
          return (b.rowIndex || 0) - (a.rowIndex || 0);
        });

        const uniqueFromCodes = Array.from(new Set(activeSourceList.map(t => t.fromSiteCode).filter(Boolean))).sort();
        const uniqueToCodes = Array.from(new Set(activeSourceList.map(t => t.toSiteCode).filter(Boolean))).sort();

        const filteredTransfers = sortedTransfers.filter(tr => {
          if (transfersFromFilter !== 'ALL' && tr.fromSiteCode !== transfersFromFilter) return false;
          if (transfersToFilter !== 'ALL' && tr.toSiteCode !== transfersToFilter) return false;
          if (transfersTypeFilter !== 'ALL' && tr.transferType !== transfersTypeFilter) return false;
          if (transfersSearch.trim()) {
            const q = transfersSearch.toLowerCase().trim();
            const sn = String(tr.serialNumber || '').toLowerCase();
            const pn = String(tr.productCode || '').toLowerCase();
            const desc = String(tr.productName || '').toLowerCase();
            const fromSt = String(tr.fromStock || '').toLowerCase();
            const toSt = String(tr.toStock || '').toLowerCase();
            const fromNm = String(tr.fromSiteName || '').toLowerCase();
            const toNm = String(tr.toSiteName || '').toLowerCase();
            if (
              !sn.includes(q) &&
              !pn.includes(q) &&
              !desc.includes(q) &&
              !fromSt.includes(q) &&
              !toSt.includes(q) &&
              !fromNm.includes(q) &&
              !toNm.includes(q)
            ) {
              return false;
            }
          }
          return true;
        });

        const trRowsPerPage = 50;
        const trTotalPages = Math.max(1, Math.ceil(filteredTransfers.length / trRowsPerPage));
        const safeTrPage = Math.min(transfersPage, trTotalPages);
        const paginatedTransfers = filteredTransfers.slice((safeTrPage - 1) * trRowsPerPage, safeTrPage * trRowsPerPage);

        const activeItemBySerial = new Map();
        (snapshot?.items || []).forEach(it => {
          if (it.serialNumber) activeItemBySerial.set(it.serialNumber.toUpperCase(), it);
        });

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Integrated Workspace Card with Top Navigation Tabs */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '14px', background: '#ffffff', boxShadow: '0 2px 12px rgba(15, 23, 42, 0.04)' }}>
              <div
                style={{
                  padding: '0 24px',
                  background: '#ffffff',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', overflowX: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => setViewMode('all_stocks')}
                    style={{
                      padding: '15px 4px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '2.5px solid transparent',
                      color: '#64748b',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Package size={16} />
                    <span>On-Hand Stock Directory</span>
                    <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: '#f1f5f9', color: '#475569' }}>
                      {(snapshot?.items?.length || 0).toLocaleString()}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('site_transfers');
                      if (transfersSubTab === 'activity_logs') setTransfersSubTab('site_to_site');
                    }}
                    style={{
                      padding: '15px 4px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: transfersSubTab !== 'activity_logs' ? '2.5px solid #6d28d9' : '2.5px solid transparent',
                      color: transfersSubTab !== 'activity_logs' ? '#6d28d9' : '#64748b',
                      fontSize: '13.5px',
                      fontWeight: transfersSubTab !== 'activity_logs' ? 800 : 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <ArrowRightLeft size={16} />
                    <span>Site Transfers &amp; Movement Ledger</span>
                    <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 800, background: '#ede9fe', color: '#6d28d9' }}>
                      {siteToSiteList.length.toLocaleString()} Site-to-Site
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('site_transfers');
                      setTransfersSubTab('activity_logs');
                    }}
                    style={{
                      padding: '15px 4px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: transfersSubTab === 'activity_logs' ? '2.5px solid #0f172a' : '2.5px solid transparent',
                      color: transfersSubTab === 'activity_logs' ? '#0f172a' : '#64748b',
                      fontSize: '13.5px',
                      fontWeight: transfersSubTab === 'activity_logs' ? 800 : 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Clock size={15} />
                    <span>Upload &amp; Sync Audit Log</span>
                    {activityLogs.length > 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: '#f1f5f9', color: '#475569' }}>
                        {activityLogs.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Top Summary Banner for Stock Transfers & Validation */}
              <div style={{ padding: '18px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
                <div style={{ padding: '14px 16px', background: '#ffffff', border: '1px solid #e2e8f0', borderLeft: '3px solid #6d28d9', borderRadius: '10px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Site-to-Site Transfer Records
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {siteToSiteList.length.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                    {siteToSiteList.length > 0 && sortedTransfers[0]
                      ? `Latest: ${sortedTransfers[0].fromSiteCode} → ${sortedTransfers[0].toSiteCode} (${sortedTransfers[0].receivedDate})`
                      : 'Branch-to-branch stock movements'}
                  </div>
                </div>

                <div style={{ padding: '14px 16px', background: '#ffffff', border: '1px solid #e2e8f0', borderLeft: '3px solid #0284c7', borderRadius: '10px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Total Stock Movement Ledger
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {allTransfersList.length.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                    {(snapshot?.transferStats?.dcToSiteCount ?? snapshot?.transferStats?.dcTransfersCount ?? snapshot?.dcToSiteTransfers?.length ?? 0).toLocaleString()} DC-to-Site • {siteToSiteList.length.toLocaleString()} Site-to-Site
                  </div>
                </div>

                <div style={{ padding: '14px 16px', background: '#ffffff', border: '1px solid #e2e8f0', borderLeft: '3px solid #16a34a', borderRadius: '10px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Active Relocated / Synced Units
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {(snapshot?.items?.filter(i => i.siteToSiteCount > 0 || i.relocatedByTransfer || i.synthesizedFromTransfer).length || 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                    Reflected in active destination branch stock
                  </div>
                </div>

                <div style={{ padding: '14px 16px', background: '#ffffff', border: '1px solid #e2e8f0', borderLeft: '3px solid #d97706', borderRadius: '10px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Adjustments, Repair &amp; DC Returns
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {adjustmentList.length.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>
                    {(snapshot?.transferStats?.adjustmentsCount || 0).toLocaleString()} Repair/Adj • {(snapshot?.transferStats?.returnToDcCount || 0).toLocaleString()} Return to DC
                  </div>
                </div>
              </div>

              <div style={{ padding: '14px 24px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '2px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => { setTransfersSubTab('site_to_site'); setTransfersPage(1); }}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: transfersSubTab === 'site_to_site' ? 800 : 600,
                      background: transfersSubTab === 'site_to_site' ? '#6d28d9' : 'transparent',
                      color: transfersSubTab === 'site_to_site' ? '#ffffff' : '#334155',
                      cursor: 'pointer'
                    }}
                  >
                    Site-to-Site Transfers ({siteToSiteList.length.toLocaleString()})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTransfersSubTab('all_movements'); setTransfersPage(1); }}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: transfersSubTab === 'all_movements' ? 800 : 600,
                      background: transfersSubTab === 'all_movements' ? '#0284c7' : 'transparent',
                      color: transfersSubTab === 'all_movements' ? '#ffffff' : '#334155',
                      cursor: 'pointer'
                    }}
                  >
                    All Stock Movement History ({allTransfersList.length.toLocaleString()})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTransfersSubTab('adjustments'); setTransfersPage(1); }}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: transfersSubTab === 'adjustments' ? 800 : 600,
                      background: transfersSubTab === 'adjustments' ? '#d97706' : 'transparent',
                      color: transfersSubTab === 'adjustments' ? '#ffffff' : '#334155',
                      cursor: 'pointer'
                    }}
                  >
                    Inventory Adjustments &amp; DC Returns ({adjustmentList.length.toLocaleString()})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransfersSubTab('activity_logs')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: transfersSubTab === 'activity_logs' ? 800 : 600,
                      background: transfersSubTab === 'activity_logs' ? '#0f172a' : 'transparent',
                      color: transfersSubTab === 'activity_logs' ? '#ffffff' : '#334155',
                      cursor: 'pointer'
                    }}
                  >
                    Upload &amp; Sync Activity Logs ({activityLogs.length})
                  </button>
                </div>

                {transfersSubTab !== 'activity_logs' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', minWidth: '240px' }}>
                      <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#6d28d9' }} />
                      <input
                        type="text"
                        className="form-input"
                        style={{ paddingLeft: '32px', height: '34px', fontSize: '12.5px', borderRadius: '7px', border: '1.5px solid #cbd5e1', fontWeight: 600 }}
                        placeholder="Search serial, part #, branch (e.g. BHS, POD)..."
                        value={transfersSearch}
                        onChange={(e) => { setTransfersSearch(e.target.value); setTransfersPage(1); }}
                      />
                    </div>

                    <select
                      className="form-select"
                      style={{ height: '34px', fontSize: '12px', padding: '4px 8px', borderRadius: '7px', border: '1.5px solid #cbd5e1', fontWeight: 600 }}
                      value={transfersFromFilter}
                      onChange={(e) => { setTransfersFromFilter(e.target.value); setTransfersPage(1); }}
                    >
                      <option value="ALL">From: All Sources</option>
                      {uniqueFromCodes.map(c => (
                        <option key={c} value={c}>From: {c}</option>
                      ))}
                    </select>

                    <select
                      className="form-select"
                      style={{ height: '34px', fontSize: '12px', padding: '4px 8px', borderRadius: '7px', border: '1.5px solid #cbd5e1', fontWeight: 600 }}
                      value={transfersToFilter}
                      onChange={(e) => { setTransfersToFilter(e.target.value); setTransfersPage(1); }}
                    >
                      <option value="ALL">To: All Destinations</option>
                      {uniqueToCodes.map(c => (
                        <option key={c} value={c}>To: {c}</option>
                      ))}
                    </select>

                    {(transfersSearch || transfersFromFilter !== 'ALL' || transfersToFilter !== 'ALL' || transfersTypeFilter !== 'ALL') && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          setTransfersSearch('');
                          setTransfersFromFilter('ALL');
                          setTransfersToFilter('ALL');
                          setTransfersTypeFilter('ALL');
                          setTransfersPage(1);
                        }}
                        style={{ height: '34px', fontSize: '12px', fontWeight: 700 }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Sub-Tab Content: Activity Logs vs Transfer Ledger Table */}
              {transfersSubTab === 'activity_logs' ? (
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                        File Upload, Validation &amp; Synchronization Audit Log
                      </h4>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        Tracks who uploaded each file, when it was uploaded, validation results, and how many inventory &amp; transfer records were updated.
                      </div>
                    </div>
                  </div>

                  {activityLogs.length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                      No upload activity logs recorded yet in this browser session. Upload a file in the 3-Slot Ingestion Center to log validation &amp; sync events.
                    </div>
                  ) : (
                    <div className="table-container" style={{ overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#0f172a', color: '#ffffff' }}>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800 }}>Timestamp</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800 }}>Uploaded By</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800 }}>Action / Event</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800 }}>File Name</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800 }}>Records Affected &amp; Details</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 800 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activityLogs.map((log) => (
                            <tr key={log.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', fontWeight: 600 }}>
                                {new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString()}
                              </td>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                <div style={{ fontWeight: 700, color: '#0f172a' }}>{log.uploadedBy}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>{log.userEmail} ({log.userRole})</div>
                              </td>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 700, color: '#1e293b' }}>
                                {log.actionType}
                              </td>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#0284c7', fontWeight: 700 }}>
                                {log.fileName}
                              </td>
                              <td style={{ padding: '10px 12px', color: '#334155', lineHeight: 1.4 }}>
                                {log.summary}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <span
                                  style={{
                                    padding: '3px 8px',
                                    borderRadius: '999px',
                                    fontSize: '10.5px',
                                    fontWeight: 800,
                                    background: log.status === 'ERROR' ? '#fee2e2' : log.status === 'WARNING' ? '#fef3c7' : '#dcfce7',
                                    color: log.status === 'ERROR' ? '#b91c1c' : log.status === 'WARNING' ? '#b45309' : '#15803d'
                                  }}
                                >
                                  {log.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ padding: '10px 20px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#475569' }}>
                    <div>
                      Showing <strong style={{ color: '#0f172a' }}>{filteredTransfers.length.toLocaleString()}</strong> transfer transactions
                      {transfersSubTab === 'site_to_site' && sortedTransfers[0] && (
                        <span style={{ marginLeft: '8px', color: '#6d28d9', fontWeight: 700 }}>
                          • Sorted newest first (Latest: {sortedTransfers[0].fromStock} → {sortedTransfers[0].toStock})
                        </span>
                      )}
                    </div>
                    {snapshot?.validationSummary?.stockTransfer?.warnings?.length > 0 && (
                      <div style={{ color: '#b45309', fontWeight: 700, fontSize: '11.5px' }}>
                        Validation Note: {snapshot.validationSummary.stockTransfer.warnings.join(' ')}
                      </div>
                    )}
                  </div>

                  <div className="table-container" style={{ overflowX: 'auto', maxHeight: '680px' }}>
                    {paginatedTransfers.length === 0 ? (
                      <div style={{ padding: '50px 20px', textAlign: 'center', color: '#64748b' }}>
                        <ArrowRightLeft size={36} color="#94a3b8" style={{ marginBottom: '8px' }} />
                        <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '15px', fontWeight: 800 }}>No Matching Stock Transfer Records</h4>
                        <p style={{ margin: 0, fontSize: '12.5px' }}>Try clearing your search or selecting another transfer category tab.</p>
                      </div>
                    ) : (
                      <table className="data-table" style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#0f172a', color: '#ffffff', borderBottom: '2px solid #6d28d9' }}>
                            <th style={{ padding: '11px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>#</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>Received Date</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>Transaction Type</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>From Stock (Origin)</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>To Stock (Destination)</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>Product Code &amp; Description</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>Serial Number</th>
                            <th style={{ padding: '11px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>Current Stock Status</th>
                            <th style={{ padding: '11px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 800, position: 'sticky', top: 0, background: '#0f172a', zIndex: 10 }}>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedTransfers.map((tr, idx) => {
                            const rowNum = (safeTrPage - 1) * trRowsPerPage + idx + 1;
                            const activeUnit = activeItemBySerial.get(String(tr.serialNumber || '').toUpperCase());
                            const isSiteToSite = tr.isSiteToSite;

                            return (
                              <tr
                                key={tr.id || `${tr.serialNumber}-${idx}`}
                                style={{
                                  borderBottom: '1px solid #e2e8f0',
                                  background: isSiteToSite ? '#faf5ff' : idx % 2 === 1 ? '#f8fafc' : '#ffffff'
                                }}
                              >
                                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
                                  {rowNum}
                                </td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0f172a' }}>
                                  {tr.receivedDate || '—'}
                                </td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                  <span
                                    style={{
                                      padding: '3px 8px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      background: isSiteToSite ? '#ede9fe' : tr.isAdjustment ? '#fef3c7' : tr.isReturnToDc ? '#fee2e2' : '#e0f2fe',
                                      color: isSiteToSite ? '#5b21b6' : tr.isAdjustment ? '#b45309' : tr.isReturnToDc ? '#b91c1c' : '#0369a1',
                                      border: isSiteToSite ? '1px solid #c4b5fd' : '1px solid #cbd5e1'
                                    }}
                                  >
                                    {tr.transferType}
                                  </span>
                                </td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 800, color: '#334155' }}>{tr.fromSiteCode}</div>
                                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{tr.fromStock}</div>
                                </td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 800, color: isSiteToSite ? '#5b21b6' : '#0284c7' }}>
                                    <span>→ {tr.toSiteCode}</span>
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{tr.toStock}</div>
                                </td>
                                <td style={{ padding: '10px 12px' }}>
                                  <div style={{ fontWeight: 800, color: '#0284c7', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{tr.productCode}</div>
                                  <div style={{ fontSize: '12px', color: '#0f172a', fontWeight: 500 }}>{tr.productName}</div>
                                </td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span
                                      onClick={() => {
                                        const details = resolveSerialFullDetails(tr.serialNumber, {
                                          inventoryUnits: effectiveInventoryUnits,
                                          fixablyItems: snapshot?.items || [],
                                          fixablyTransfers: snapshot?.transfers || [],
                                          sites,
                                          parts
                                        });
                                        if (details) setInspectedSerialDetails(details);
                                      }}
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '12px',
                                        fontWeight: 800,
                                        color: '#0f172a',
                                        background: '#f8fafc',
                                        border: '1px solid #cbd5e1',
                                        padding: '3px 8px',
                                        borderRadius: '5px',
                                        cursor: 'pointer'
                                      }}
                                      title="Click to inspect full Serial Dossier & Ownership Trail"
                                    >
                                      {tr.serialNumber}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setInspectedMovementUnit({
                                        serialNumber: tr.serialNumber,
                                        serial_number: tr.serialNumber,
                                        partNumber: tr.productCode,
                                        part_number: tr.productCode,
                                        description: tr.productName,
                                        siteCode: activeUnit?.siteCode || tr.toSiteCode,
                                        siteName: activeUnit?.siteName || tr.toSiteName,
                                        currentOwner: activeUnit?.currentOwner || tr.currentOwner,
                                        movementHistory: activeUnit?.movementHistory || [tr.fromSiteCode, tr.toSiteCode]
                                      })}
                                      style={{
                                        border: '1px solid #c4b5fd',
                                        background: '#ede9fe',
                                        color: '#5b21b6',
                                        borderRadius: '4px',
                                        padding: '2px 6px',
                                        fontSize: '10.5px',
                                        fontWeight: 800,
                                        cursor: 'pointer'
                                      }}
                                      title="View Movement Timeline"
                                    >
                                      Timeline
                                    </button>
                                  </div>
                                </td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                  {activeUnit ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#15803d', fontWeight: 800, fontSize: '11.5px' }}>
                                        <CheckCircle2 size={12} color="#16a34a" />
                                        <span>In Stock at {activeUnit.siteCode}</span>
                                      </span>
                                      {activeUnit.movementTrail && (
                                        <span style={{ fontSize: '10.5px', color: '#6d28d9', fontWeight: 700 }}>
                                          Trail: {activeUnit.movementTrail}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                                      Historical / Consumed
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                                  ${Number(tr.transferValue || 0).toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {trTotalPages > 1 && (
                    <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                        Page <strong>{safeTrPage}</strong> of <strong>{trTotalPages}</strong>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={safeTrPage <= 1}
                          onClick={() => setTransfersPage(p => Math.max(1, p - 1))}
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={safeTrPage >= trTotalPages}
                          onClick={() => setTransfersPage(p => Math.min(trTotalPages, p + 1))}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* VIEW 2: "MULTI-SITE" BRANCH AGING & HEALTH DASHBOARD */}
      {/* ========================================================================= */}
      {viewMode === 'multi_site' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* ========================================================================= */}
          {/* CROSS-SITE PART NUMBER AVAILABILITY SEARCH BAR & AUTOCOMPLETE */}
          {/* ========================================================================= */}
          <div
            className="card"
            style={{
              padding: '18px 22px',
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
              position: 'relative'
            }}
          >
            {/* Header with Title, Description, and Catalog Count Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={18} color="#0284c7" />
                  <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                    Search Stock Availability by Part Number or Serial #
                  </h3>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  Lookup any active Apple part number or search a serial number to view immediate branch location and on-hand quantities across all authorized service branch sites.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background: '#f0f9ff',
                    color: '#0369a1',
                    border: '1px solid #bae6fd'
                  }}
                >
                  {activePartCatalog.length.toLocaleString()} Active Parts • {totalSerializedUnits.toLocaleString()} Serials
                </span>
              </div>
            </div>

            {/* Interactive Search Bar with Autocomplete Dropdown */}
            <div ref={partSearchContainerRef} style={{ position: 'relative' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#f8fafc',
                  border: isPartDropdownOpen ? '2px solid #0284c7' : '1.5px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '4px 12px',
                  transition: 'all 0.15s ease',
                  boxShadow: isPartDropdownOpen ? '0 0 0 3px rgba(2, 132, 199, 0.12)' : 'none'
                }}
              >
                <Search size={18} color={isPartDropdownOpen ? '#0284c7' : '#94a3b8'} style={{ flexShrink: 0, marginRight: '10px' }} />
                <input
                  type="text"
                  value={partSearchInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPartSearchInput(val);
                    setIsPartDropdownOpen(true);
                    setHighlightedPartIndex(-1);
                    if (!val.trim()) {
                      setSelectedSerialUnit(null);
                      setPartSearchQuery('');
                    }
                  }}
                  onFocus={() => setIsPartDropdownOpen(true)}
                  onKeyDown={(e) => {
                    const totalItems = matchingSerials.length + filteredPartCatalog.length;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setHighlightedPartIndex(prev => Math.min(prev + 1, totalItems - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlightedPartIndex(prev => Math.max(prev - 1, 0));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (highlightedPartIndex >= 0) {
                        if (highlightedPartIndex < matchingSerials.length) {
                          handleSelectSerial(matchingSerials[highlightedPartIndex]);
                          return;
                        } else {
                          const pIdx = highlightedPartIndex - matchingSerials.length;
                          if (filteredPartCatalog[pIdx]) {
                            const sel = filteredPartCatalog[pIdx];
                            setSelectedSerialUnit(null);
                            setPartSearchInput(sel.partNumber);
                            setPartSearchQuery(sel.partNumber);
                            setIsPartDropdownOpen(false);
                            return;
                          }
                        }
                      }

                      // If not explicitly highlighted, check if serial matches
                      if (matchingSerials.length > 0) {
                        handleSelectSerial(matchingSerials[0]);
                        return;
                      }

                      if (filteredPartCatalog.length > 0) {
                        const sel = filteredPartCatalog[0];
                        setSelectedSerialUnit(null);
                        setPartSearchInput(sel.partNumber);
                        setPartSearchQuery(sel.partNumber);
                        setIsPartDropdownOpen(false);
                        return;
                      }

                      if (partSearchInput.trim()) {
                        setSelectedSerialUnit(null);
                        setPartSearchQuery(partSearchInput.trim());
                        setIsPartDropdownOpen(false);
                      }
                    } else if (e.key === 'Escape') {
                      setIsPartDropdownOpen(false);
                    }
                  }}
                  placeholder="Type or scan Serial # (e.g. G9QHQ...), Part Number (e.g. 661-44797), or description..."
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    color: '#0f172a',
                    padding: '8px 0'
                  }}
                />
                {partSearchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSerialUnit(null);
                      setHighlightedSerial(null);
                      setPartSearchInput('');
                      setPartSearchQuery('');
                      setIsPartDropdownOpen(false);
                      setHighlightedPartIndex(-1);
                    }}
                    style={{
                      background: '#e2e8f0',
                      border: 'none',
                      borderRadius: '50%',
                      width: '22px',
                      height: '22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: '#475569',
                      marginLeft: '8px'
                    }}
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Autocomplete Dropdown List */}
              {isPartDropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    zIndex: 1000,
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    boxShadow: '0 12px 30px -4px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(226, 232, 240, 0.8)',
                    maxHeight: '360px',
                    overflowY: 'auto'
                  }}
                  className="custom-scrollbar"
                >
                  {/* SECTION A: Matching Serial Numbers */}
                  {matchingSerials.length > 0 && (
                    <div>
                      <div style={{ padding: '8px 14px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', fontSize: '11px', fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Barcode size={13} color="#15803d" />
                          Matching Serial Numbers ({matchingSerials.length})
                        </span>
                        <span style={{ fontSize: '10px', color: '#166534', fontWeight: 700 }}>Direct Branch Location</span>
                      </div>
                      {matchingSerials.map((unit, idx) => {
                        const isHighlighted = idx === highlightedPartIndex;
                        const isSelected = selectedSerialUnit?.serialNumber === unit.serialNumber;

                        return (
                          <div
                            key={`sn-${unit.serialNumber}-${unit.siteCode}-${idx}`}
                            onClick={() => handleSelectSerial(unit)}
                            onMouseEnter={() => setHighlightedPartIndex(idx)}
                            style={{
                              padding: '10px 14px',
                              borderBottom: '1px solid #f1f5f9',
                              cursor: 'pointer',
                              background: isSelected ? '#f0f9ff' : (isHighlighted ? '#f0fdf4' : '#ffffff'),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              transition: 'background 0.1s ease'
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a', fontFamily: 'monospace' }}>
                                  {unit.serialNumber}
                                </span>
                                <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', background: unit.badgeBg || '#fee2e2', color: unit.badgeColor || '#dc2626' }}>
                                  {unit.agingDays}d {unit.statusLabel || ''}
                                </span>
                                <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: '#f1f5f9', color: '#475569' }}>
                                  {unit.stockType || 'Stock'}
                                </span>
                                {isSelected && (
                                  <span style={{ fontSize: '10px', fontWeight: 800, background: '#16a34a', color: '#ffffff', padding: '1px 6px', borderRadius: '4px' }}>
                                    Selected Serial
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <strong style={{ color: '#0284c7' }}>{unit.partNumber}</strong> — {unit.description || 'Apple Service Component'}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              <span style={{ fontSize: '11px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', background: '#0f172a', color: '#ffffff' }}>
                                {unit.siteCode}
                              </span>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                {unit.siteName || ''}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* SECTION B: Matching Part Number Catalog */}
                  {filteredPartCatalog.length > 0 && (
                    <div>
                      <div style={{ padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Active Part Number Catalog</span>
                        <span>{filteredPartCatalog.length} Matching Results</span>
                      </div>
                      {filteredPartCatalog.map((item, idx) => {
                        const globalIdx = matchingSerials.length + idx;
                        const isHighlighted = globalIdx === highlightedPartIndex;
                        const isSelected = !selectedSerialUnit && partSearchQuery.toUpperCase() === item.partNumber.toUpperCase();

                        return (
                          <div
                            key={item.partNumber}
                            onClick={() => {
                              setSelectedSerialUnit(null);
                              setPartSearchInput(item.partNumber);
                              setPartSearchQuery(item.partNumber);
                              setIsPartDropdownOpen(false);
                            }}
                            onMouseEnter={() => setHighlightedPartIndex(globalIdx)}
                            style={{
                              padding: '10px 14px',
                              borderBottom: '1px solid #f1f5f9',
                              cursor: 'pointer',
                              background: isSelected ? '#f0f9ff' : (isHighlighted ? '#f8fafc' : '#ffffff'),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              transition: 'background 0.1s ease'
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0284c7', fontFamily: 'monospace' }}>
                                  {item.partNumber}
                                </span>
                                {isSelected && (
                                  <span style={{ fontSize: '10px', fontWeight: 800, background: '#0284c7', color: '#ffffff', padding: '1px 6px', borderRadius: '4px' }}>
                                    Active Query
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {item.description || 'Apple Service Component'}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  background: item.totalUnits > 0 ? '#ecfdf5' : '#fee2e2',
                                  color: item.totalUnits > 0 ? '#065f46' : '#991b1b',
                                  border: item.totalUnits > 0 ? '1px solid #a7f3d0' : '1px solid #fecdd3'
                                }}
                              >
                                {item.totalUnits} on-hand
                              </span>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  background: '#f1f5f9',
                                  color: '#334155'
                                }}
                              >
                                {item.siteCount} {item.siteCount === 1 ? 'site' : 'sites'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Empty State */}
                  {matchingSerials.length === 0 && filteredPartCatalog.length === 0 && (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                      No active part numbers or serials matching <code style={{ color: '#0f172a', fontWeight: 700 }}>"{partSearchInput}"</code>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RESULTS PANEL: When a part number or serial is searched */}
            {partStockBySite && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '16px',
                  background: '#f8fafc',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '10px'
                }}
              >
                {/* Dedicated Serial Located Card */}
                {partStockBySite.locatedSerial && (
                  <div
                    style={{
                      marginBottom: '16px',
                      padding: '14px 18px',
                      background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
                      border: '2px solid #86efac',
                      borderRadius: '10px',
                      boxShadow: '0 4px 12px rgba(22, 163, 74, 0.08)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#16a34a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)' }}>
                          <Barcode size={22} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Serial Number Located
                            </span>
                            <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                              {partStockBySite.locatedSerial.serialNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(partStockBySite.locatedSerial.serialNumber, 'Serial')}
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#16a34a', padding: '2px' }}
                              title="Copy serial"
                            >
                              <Copy size={13} />
                            </button>
                            <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', background: partStockBySite.locatedSerial.badgeBg || '#fee2e2', color: partStockBySite.locatedSerial.badgeColor || '#dc2626' }}>
                              {partStockBySite.locatedSerial.agingDays}d {partStockBySite.locatedSerial.statusLabel || ''}
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: '#ffffff', color: '#1e293b', border: '1px solid #cbd5e1' }}>
                              {partStockBySite.locatedSerial.stockType || 'Stock'}
                            </span>
                          </div>

                          <div style={{ fontSize: '13px', color: '#334155', marginTop: '4px' }}>
                            Part: <strong style={{ color: '#0284c7', fontFamily: 'monospace' }}>{partStockBySite.locatedSerial.partNumber}</strong> — {partStockBySite.locatedSerial.description || partStockBySite.partDescription || 'Apple Genuine Component'}
                          </div>

                          <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <MapPin size={13} color="#0284c7" />
                            <span>Currently on-hand at: <strong style={{ color: '#0f172a' }}>{partStockBySite.locatedSerial.siteCode}</strong> — {partStockBySite.locatedSerial.siteName || `Branch ${partStockBySite.locatedSerial.siteCode}`}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleSelectSerial(partStockBySite.locatedSerial)}
                          style={{
                            padding: '8px 14px',
                            background: '#16a34a',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)'
                          }}
                        >
                          <Building2 size={13} />
                          <span>Jump to {partStockBySite.locatedSerial.siteCode} Stock &amp; Highlight</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const sd = resolveSerialFullDetails(partStockBySite.locatedSerial.serialNumber, {
                              inventoryUnits: snapshot?.items || [],
                              shipments: [],
                              repairUsageRecords: [],
                              sites,
                              parts,
                              fixablyItems: snapshot?.items || [],
                              fixablyTransfers: snapshot?.transfers || []
                            });
                            if (sd) setInspectedSerialDetails(sd);
                          }}
                          style={{
                            padding: '8px 14px',
                            background: '#ffffff',
                            color: '#0369a1',
                            border: '1.5px solid #0284c7',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <Zap size={13} />
                          <span>Serial Dossier</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Result Summary Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid #cbd5e1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Package size={20} color="#0284c7" />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                          {partStockBySite.searchedPartNumber}
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 800, background: '#0284c7', color: '#ffffff', padding: '2px 8px', borderRadius: '999px' }}>
                          {partStockBySite.totalNetworkUnits} Total Units On-Hand
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 700, background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe', padding: '2px 8px', borderRadius: '999px' }}>
                          Available at {partStockBySite.sitesCount} {partStockBySite.sitesCount === 1 ? 'Branch Site' : 'Branch Sites'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '2px' }}>
                        {partStockBySite.partDescription || 'Apple Genuine Service Part'}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSerialUnit(null);
                      setHighlightedSerial(null);
                      setPartSearchInput('');
                      setPartSearchQuery('');
                      setIsPartDropdownOpen(false);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '6px 12px',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#64748b',
                      cursor: 'pointer'
                    }}
                  >
                    <X size={13} />
                    <span>Clear Search</span>
                  </button>
                </div>

                {/* Branch Stock Availability Listing */}
                {partStockBySite.sitesWithStock.length === 0 ? (
                  <div style={{ padding: '28px 16px', textAlign: 'center', background: '#ffffff', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                    <AlertTriangle size={32} color="#d97706" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
                    <div style={{ fontSize: '14.5px', fontWeight: 800, color: '#0f172a' }}>
                      No Available Stock for Part #{partStockBySite.searchedPartNumber}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>
                      Currently 0 on-hand units across all 26 authorized service locations. You may create a parts requisition or check alternative part numbers.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
                    {partStockBySite.sitesWithStock.map(site => {
                      const isCurrentSelected = selectedSiteCode.toUpperCase() === site.cleanCode.toUpperCase();

                      return (
                        <div
                          key={site.siteCode}
                          style={{
                            background: '#ffffff',
                            border: isCurrentSelected ? '2px solid #0284c7' : '1px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '12px 14px',
                            boxShadow: isCurrentSelected ? '0 4px 12px rgba(2, 132, 199, 0.15)' : '0 1px 3px rgba(15, 23, 42, 0.04)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ background: '#0f172a', color: '#ffffff', padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 800 }}>
                                  {site.siteCode}
                                </span>
                                <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: site.region === 'metro_manila' ? '#eff6ff' : '#fffbeb', color: site.region === 'metro_manila' ? '#0369a1' : '#b45309' }}>
                                  {site.region === 'metro_manila' ? 'Metro Manila' : 'Provincial'}
                                </span>
                              </div>

                              <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '999px' }}>
                                {site.totalUnits} {site.totalUnits === 1 ? 'unit' : 'units'} on-hand
                              </span>
                            </div>

                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                              {site.siteName}
                            </div>

                            <div style={{ display: 'flex', gap: '10px', fontSize: '11.5px', color: '#64748b', marginBottom: '10px' }}>
                              <span>DC Stock: <strong style={{ color: '#0f172a' }}>{site.dcStockUnits}</strong></span>
                              <span>•</span>
                              <span>MSPI-Owned: <strong style={{ color: '#0f172a' }}>{site.mspiOwnedUnits}</strong></span>
                              {site.agingBrackets.dead > 0 && (
                                <>
                                  <span>•</span>
                                  <span style={{ color: '#dc2626', fontWeight: 700 }}>{site.agingBrackets.dead} dead</span>
                                </>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSelectSiteFromSearch(site)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              borderRadius: '6px',
                              border: isCurrentSelected ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                              background: isCurrentSelected ? '#0284c7' : '#f8fafc',
                              color: isCurrentSelected ? '#ffffff' : '#0369a1',
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <Building2 size={13} />
                            <span>{isCurrentSelected ? 'Currently Viewing This Branch' : `View ${site.siteCode} Stock →`}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Site Navigation Card: Region tabs & Branch Selector Chips */}
          <div className="card" style={{ padding: '18px 22px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)' }}>
            
            {/* Region Tabs (Metro Manila vs Provincial) */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedRegion('metro_manila');
                  if (metroManilaSitesList.length > 0 && !metroManilaSitesList.some(s => s.siteCode.includes(selectedSiteCode))) {
                    setSelectedSiteCode(metroManilaSitesList[0].siteCode.replace(/^(ASP|APP)\s+/, ''));
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '11px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  background: selectedRegion === 'metro_manila' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#f8fafc',
                  color: selectedRegion === 'metro_manila' ? '#ffffff' : '#1e293b',
                  boxShadow: selectedRegion === 'metro_manila' ? '0 4px 10px rgba(2, 132, 199, 0.25)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={18} color={selectedRegion === 'metro_manila' ? '#ffffff' : '#0284c7'} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: '13.5px' }}>Metro Manila Sites</div>
                    <div style={{ fontSize: '11.5px', opacity: 0.9 }}>{metroManilaSitesList.length} Authorized Service Points</div>
                  </div>
                </div>
                <span style={{ background: selectedRegion === 'metro_manila' ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0', color: selectedRegion === 'metro_manila' ? '#ffffff' : '#0f172a', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800 }}>
                  {metroManilaSitesList.reduce((acc, s) => acc + s.totalUnits, 0).toLocaleString()} units
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedRegion('provincial');
                  if (provincialSitesList.length > 0 && !provincialSitesList.some(s => s.siteCode.includes(selectedSiteCode))) {
                    setSelectedSiteCode(provincialSitesList[0].siteCode.replace(/^(ASP|APP)\s+/, ''));
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '11px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  background: selectedRegion === 'provincial' ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' : '#f8fafc',
                  color: selectedRegion === 'provincial' ? '#ffffff' : '#1e293b',
                  boxShadow: selectedRegion === 'provincial' ? '0 4px 10px rgba(217, 119, 6, 0.25)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={18} color={selectedRegion === 'provincial' ? '#ffffff' : '#d97706'} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: '13.5px' }}>Provincial Sites</div>
                    <div style={{ fontSize: '11.5px', opacity: 0.9 }}>{provincialSitesList.length} Regional Service Points</div>
                  </div>
                </div>
                <span style={{ background: selectedRegion === 'provincial' ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0', color: selectedRegion === 'provincial' ? '#ffffff' : '#0f172a', padding: '3px 10px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800 }}>
                  {provincialSitesList.reduce((acc, s) => acc + s.totalUnits, 0).toLocaleString()} units
                </span>
              </button>
            </div>

            {/* Individual Branch Selector Chips with Crisp Contrast */}
            <div style={{ paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                {(!isSuperadmin && isPmgUser) ? 'Select Site to View Available Inventory:' : 'Select Site to View Health & Inventory Aging:'}
              </div>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(selectedRegion === 'metro_manila' ? metroManilaSitesList : provincialSitesList).map(site => {
                  const cleanCode = site.siteCode.replace(/^(ASP|APP)\s+/, '');
                  const isSelected = selectedSiteCode.toUpperCase() === cleanCode.toUpperCase();
                  const isSiteAssignedToUser = isSiteMatchingUser(site);
                  const showSiteHealthMetrics = isSuperadmin || isSiteAssignedToUser;
                  const deadCount = showSiteHealthMetrics ? (site.metrics?.dcStock?.dead + site.metrics?.mspiOwned?.dead || 0) : 0;
                  const invCount = showSiteHealthMetrics ? (site.investigationCount || site.metrics?.segmentedLists?.investigation?.length || 0) : 0;

                  return (
                    <button
                      key={site.siteCode}
                      type="button"
                      onClick={() => {
                        setSelectedSiteCode(cleanCode);
                        setTimeout(() => {
                          const el = document.getElementById('branch-stock-section');
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }, 50);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 12px',
                        borderRadius: '6px',
                        border: isSelected
                          ? (selectedRegion === 'provincial' ? '2px solid #d97706' : '2px solid #0284c7')
                          : '1.5px solid #cbd5e1',
                        background: isSelected
                          ? (selectedRegion === 'provincial' ? '#fffbeb' : '#f0f9ff')
                          : '#ffffff',
                        color: isSelected
                          ? (selectedRegion === 'provincial' ? '#92400e' : '#0369a1')
                          : '#0f172a',
                        cursor: 'pointer',
                        fontWeight: isSelected ? 800 : 600,
                        fontSize: '12.5px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{site.siteCode}</span>
                      <span
                        style={{
                          background: site.totalUnits > 0 ? (isSelected ? '#0284c7' : '#e2e8f0') : '#fee2e2',
                          color: site.totalUnits > 0 ? (isSelected ? '#ffffff' : '#0f172a') : '#dc2626',
                          borderRadius: '999px',
                          padding: '1px 6px',
                          fontSize: '11px',
                          fontWeight: 700
                        }}
                      >
                        {site.totalUnits}
                      </span>
                      {deadCount > 0 && (
                        <span
                          style={{
                            background: '#fee2e2',
                            color: '#dc2626',
                            border: '1px solid #fecdd3',
                            borderRadius: '999px',
                            padding: '1px 5px',
                            fontSize: '10px',
                            fontWeight: 800
                          }}
                          title={`${deadCount} dead stock units requiring pull-out`}
                        >
                          {deadCount} dead
                        </span>
                      )}
                      {invCount > 0 && (
                        <span
                          style={{
                            background: '#fff1f2',
                            color: '#be123c',
                            border: '1px solid #fecdd3',
                            borderRadius: '999px',
                            padding: '1px 5px',
                            fontSize: '10px',
                            fontWeight: 800
                          }}
                          title={`${invCount} serials flagged in closed repairs`}
                        >
                          {invCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Selected Site Detail Banner */}
          {currentSiteData && (
            <div id="branch-stock-section" className="card" style={{ padding: '18px 22px', background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <Building2 size={22} color="#0284c7" />
                    <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                      {currentSiteData.siteName}
                    </h3>
                    <span className="badge badge-primary" style={{ fontSize: '11.5px', fontWeight: 800 }}>
                      {currentSiteData.siteCode}
                    </span>
                    {currentSiteData.shipTo && (
                      <span className="badge" style={{ fontSize: '11.5px', background: '#e0e7ff', color: '#3730a3', fontWeight: 700, border: '1px solid #c7d2fe' }}>
                        Ship-To: {currentSiteData.shipTo}
                      </span>
                    )}
                    {currentSiteData.investigationCount > 0 && (isSuperadmin || isCurrentSiteAssignedToUser) && (
                      <span className="badge" style={{ fontSize: '11.5px', background: '#fff1f2', color: '#be123c', border: '1.5px solid #fecdd3', fontWeight: 800 }}>
                        {currentSiteData.investigationCount} Closed Repair Matches
                      </span>
                    )}
                    {isPmgUser && (
                      canViewCurrentSiteSerials ? (
                        <span className="badge" style={{ fontSize: '11.5px', background: '#ecfdf5', color: '#065f46', border: '1.5px solid #a7f3d0', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <CheckCircle2 size={12} color="#059669" /> Assigned Branch: Full Serial Access
                        </span>
                      ) : (
                        <span className="badge" style={{ fontSize: '11.5px', background: '#fef3c7', color: '#92400e', border: '1.5px solid #fde68a', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <Lock size={12} color="#d97706" /> Other Branch: Serials Masked
                        </span>
                      )
                    )}
                  </div>

                  <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={14} color="#64748b" />
                    <span>{currentSiteData.address || 'Standard Authorized Service Facility'}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0f172a' }}>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Branch Supervisor:</span>
                      <strong>{currentSiteData.supervisor}</strong>
                    </div>

                    {currentSiteData.phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Phone size={13} color="#0284c7" />
                        <a href={`tel:${currentSiteData.phone}`} style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 700 }}>
                          {currentSiteData.phone}
                        </a>
                      </div>
                    )}

                    {currentSiteData.email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Mail size={13} color="#0284c7" />
                        <a href={`mailto:${currentSiteData.email}`} style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 700 }}>
                          {currentSiteData.email}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Action Exports: Dead Stock & Investigation exports restricted to Superadmin or assigned site staff */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {(isSuperadmin || isCurrentSiteAssignedToUser) && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          const deadItems = currentSiteData.metrics.segmentedLists.deadStock;
                          if (deadItems.length === 0) {
                            showToast?.(`No dead stock found for ${currentSiteData.siteCode}.`, 'info');
                            return;
                          }
                          exportDeadStockToCsv(itemsForBranchExport, currentSiteData.siteCode);
                          showToast?.(`Exported ${deadItems.length} dead stock items for ${currentSiteData.siteCode}`, 'success');
                        }}
                        style={{
                          fontSize: '12px',
                          padding: '8px 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontWeight: 700,
                          color: '#dc2626',
                          border: '1.5px solid #f87171',
                          background: '#fff1f2',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                        title="Export Dead Stock CSV for RMA logistics"
                      >
                        <Download size={13} color="#dc2626" />
                        <span>Dead Stock CSV</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          exportDeadStockToExcel(itemsForBranchExport, currentSiteData.siteCode);
                          showToast?.(`Exported Dead Stock Excel workbook for ${currentSiteData.siteCode}`, 'success');
                        }}
                        style={{
                          fontSize: '12px',
                          padding: '8px 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontWeight: 700,
                          color: '#ea580c',
                          border: '1.5px solid #fb923c',
                          background: '#fff7ed',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                        title="Export Dead Stock Excel (.xlsx)"
                      >
                        <FileSpreadsheet size={13} color="#ea580c" />
                        <span>Dead Stock Excel</span>
                      </button>

                      {currentSiteData.investigationCount > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            exportInvestigationToExcel(itemsForBranchExport, currentSiteData.siteCode);
                            showToast?.(`Exported ${currentSiteData.investigationCount} flagged items to Excel for ${currentSiteData.siteCode}`, 'success');
                          }}
                          style={{
                            fontSize: '12px',
                            padding: '8px 12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontWeight: 700,
                            color: '#be123c',
                            border: '1.5px solid #fecdd3',
                            background: '#ffe4e6',
                            borderRadius: '6px',
                            cursor: 'pointer'
                          }}
                          title="Export items flagged in closed repairs to Excel"
                        >
                          <ShieldAlert size={13} color="#be123c" />
                          <span>Investigation XLSX</span>
                        </button>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      exportSiteToExcel(currentSiteData, itemsForBranchExport);
                      showToast?.(`Exported complete multi-tab inventory workbook for ${currentSiteData.siteCode}`, 'success');
                    }}
                    style={{
                      fontSize: '12px',
                      padding: '8px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 700,
                      color: '#0284c7',
                      border: '1.5px solid #0284c7',
                      background: '#f0f9ff',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    title="Export complete site inventory workbook with aging breakdown"
                  >
                    <FileSpreadsheet size={13} color="#0284c7" />
                    <span>Site XLSX</span>
                  </button>

                  {isSuperadmin && typeof clearSiteParts === 'function' && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to clear old site parts for ${currentSiteData.siteCode}?`)) {
                          clearSiteParts({ siteId: currentSiteData.siteId, siteCode: currentSiteData.siteCode });
                          showToast?.(`Cleared parts for ${currentSiteData.siteCode}`, 'info');
                        }
                      }}
                      style={{
                        fontSize: '11.5px',
                        padding: '8px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontWeight: 700,
                        color: '#64748b',
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                      title="Clear old parts prior to fresh intake"
                    >
                      <Trash2 size={13} color="#94a3b8" />
                      <span>Clear Site</span>
                    </button>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* SITE KPI HEALTH SUMMARY TABLE: Visible ONLY for Superadmin OR User's Assigned Branch */}
          {currentSiteData?.metrics && (
            (isSuperadmin || isCurrentSiteAssignedToUser) ? (
              <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1.5px solid #cbd5e1', borderRadius: '12px', background: '#ffffff', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)' }}>
                <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Boxes size={18} color="#0284c7" />
                    <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                      Inventory Aging &amp; Health Summary ({currentSiteData.siteCode})
                    </h4>
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>
                    Parity Model matching <code style={{ fontWeight: 700, color: '#0284c7' }}>SIte Stocks (Fixably).xlsx</code>
                  </div>
                </div>

                <div className="table-container" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #0284c7' }}>
                        <th style={{ minWidth: '180px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Stock Classification</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#fca5a5', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Dead Stock (≥ 180d)</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#fdba74', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Non-Moving (90–179d)</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#fde047', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Slow-Moving (60–89d)</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#86efac', padding: '12px 10px', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>In Stock (&lt; 60d)</th>
                        <th style={{ textAlign: 'center', fontWeight: 900, background: '#0f172a', color: '#ffffff', padding: '12px 10px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Total Units</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#fca5a5', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>Dead %</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#fdba74', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>Non-Moving %</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#fde047', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>Slow %</th>
                        <th style={{ textAlign: 'center', background: '#0f172a', color: '#86efac', padding: '12px 10px', fontSize: '11px', fontWeight: 800, whiteSpace: 'nowrap' }}>In Stock %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* DC Stock Row */}
                      <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ fontWeight: 800, color: '#6d28d9', padding: '12px 14px' }}>
                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#8b5cf6', marginRight: '6px' }} />
                          DC Stock
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.dead}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#ea580c', padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.nonMoving}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#d97706', padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.slow}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#16a34a', padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.inStock}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 900, background: '#f8fafc', color: '#0f172a', padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.units}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.deadPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#ea580c', fontWeight: 600, padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.nonMovingPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#d97706', fontWeight: 600, padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.slowPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 700, padding: '12px 10px' }}>
                          {currentSiteData.metrics.dcStock.inStockPercent}
                        </td>
                      </tr>

                      {/* MSPI-Owned / C/I REP Row */}
                      <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1' }}>
                        <td style={{ fontWeight: 800, color: '#0369a1', padding: '12px 14px' }}>
                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#0284c7', marginRight: '6px' }} />
                          MSPI-Owned / C/I REP
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.dead}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#ea580c', padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.nonMoving}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#d97706', padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.slow}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 700, color: '#16a34a', padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.inStock}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 900, background: '#f1f5f9', color: '#0f172a', padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.units}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#dc2626', background: '#fff1f2', padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.deadPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#ea580c', fontWeight: 600, padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.nonMovingPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#d97706', fontWeight: 600, padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.slowPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 700, padding: '12px 10px' }}>
                          {currentSiteData.metrics.mspiOwned.inStockPercent}
                        </td>
                      </tr>

                      {/* COMBINED TOTAL Row */}
                      <tr style={{ background: '#f1f5f9', fontWeight: 900, borderTop: '2px solid #94a3b8' }}>
                        <td style={{ color: '#0f172a', padding: '12px 14px' }}>COMBINED TOTAL</td>
                        <td style={{ textAlign: 'center', color: '#dc2626', background: '#ffe4e6', padding: '12px 10px', fontWeight: 900 }}>
                          {currentSiteData.metrics.total.dead}
                        </td>
                        <td style={{ textAlign: 'center', color: '#ea580c', padding: '12px 10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.total.nonMoving}
                        </td>
                        <td style={{ textAlign: 'center', color: '#d97706', padding: '12px 10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.total.slow}
                        </td>
                        <td style={{ textAlign: 'center', color: '#16a34a', padding: '12px 10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.total.inStock}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: '14px', color: '#0f172a', background: '#e2e8f0', padding: '12px 10px', fontWeight: 900 }}>
                          {currentSiteData.metrics.total.units}
                        </td>
                        <td style={{ textAlign: 'center', color: '#dc2626', background: '#ffe4e6', padding: '12px 10px', fontWeight: 900 }}>
                          {currentSiteData.metrics.total.deadPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#ea580c', padding: '12px 10px', fontWeight: 700 }}>
                          {currentSiteData.metrics.total.nonMovingPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#d97706', padding: '12px 10px', fontWeight: 700 }}>
                          {currentSiteData.metrics.total.slowPercent}
                        </td>
                        <td style={{ textAlign: 'center', color: '#16a34a', padding: '12px 10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.total.inStockPercent}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div
                className="card"
                style={{
                  padding: '16px 20px',
                  background: '#f8fafc',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
                }}
              >
                <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Lock size={18} color="#0284c7" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                    Cross-Branch Inventory Query: {currentSiteData.siteCode} ({currentSiteData.siteName || 'Service Branch'})
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    Part availability and stock quantities are visible below for requisitions and stock queries. Aging health and dead stock metrics are restricted to the designated branch staff and Superadmin.
                  </div>
                </div>
                <span className="badge" style={{ fontSize: '11px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', fontWeight: 700 }}>
                  Stock Only Mode
                </span>
              </div>
            )
          )}

          {/* SEGMENTED LISTS & SUB-TABS */}
          {currentSiteData?.metrics && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1.5px solid #cbd5e1', borderRadius: '12px', background: '#ffffff', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)' }}>
              
              {/* Segmented Sub-Tab Header with Branch Filter */}
              <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1, minWidth: '280px' }}>
                  {/* Aging & Investigation Sub-Tabs strictly for Superadmin or Assigned Site */}
                  {(isSuperadmin || isCurrentSiteAssignedToUser) && (
                    <>
                      {/* Tab 1: Dead Stock */}
                      <button
                        type="button"
                        onClick={() => setSegmentedTab('dead_stock')}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: segmentedTab === 'dead_stock' ? 800 : 600,
                          background: segmentedTab === 'dead_stock' ? '#fff1f2' : 'transparent',
                          color: segmentedTab === 'dead_stock' ? '#dc2626' : '#64748b',
                          borderBottom: segmentedTab === 'dead_stock' ? '2px solid #dc2626' : '2px solid transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <AlertTriangle size={13} color={segmentedTab === 'dead_stock' ? '#dc2626' : '#94a3b8'} />
                        <span>Dead Stock (≥ 180d)</span>
                        <span style={{ background: '#fecdd3', color: '#be123c', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.segmentedLists.deadStock.length}
                        </span>
                      </button>

                      {/* Tab 2: Non-Moving */}
                      <button
                        type="button"
                        onClick={() => setSegmentedTab('non_moving')}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: segmentedTab === 'non_moving' ? 800 : 600,
                          background: segmentedTab === 'non_moving' ? '#fff7ed' : 'transparent',
                          color: segmentedTab === 'non_moving' ? '#ea580c' : '#64748b',
                          borderBottom: segmentedTab === 'non_moving' ? '2px solid #ea580c' : '2px solid transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <Clock size={13} color={segmentedTab === 'non_moving' ? '#ea580c' : '#94a3b8'} />
                        <span>Non-Moving (90–179d)</span>
                        <span style={{ background: '#fed7aa', color: '#c2410c', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.segmentedLists.nonMoving.length}
                        </span>
                      </button>

                      {/* Tab 3: Slow-Moving */}
                      <button
                        type="button"
                        onClick={() => setSegmentedTab('slow_moving')}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: segmentedTab === 'slow_moving' ? 800 : 600,
                          background: segmentedTab === 'slow_moving' ? '#fffbeb' : 'transparent',
                          color: segmentedTab === 'slow_moving' ? '#d97706' : '#64748b',
                          borderBottom: segmentedTab === 'slow_moving' ? '2px solid #d97706' : '2px solid transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <TrendingDown size={13} color={segmentedTab === 'slow_moving' ? '#d97706' : '#94a3b8'} />
                        <span>Slow-Moving (60–89d)</span>
                        <span style={{ background: '#fde68a', color: '#b45309', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.segmentedLists.slowMoving.length}
                        </span>
                      </button>

                      {/* Tab 4: Active Stock */}
                      <button
                        type="button"
                        onClick={() => setSegmentedTab('active_stock')}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: segmentedTab === 'active_stock' ? 800 : 600,
                          background: segmentedTab === 'active_stock' ? '#f0fdf4' : 'transparent',
                          color: segmentedTab === 'active_stock' ? '#16a34a' : '#64748b',
                          borderBottom: segmentedTab === 'active_stock' ? '2px solid #16a34a' : '2px solid transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <CheckCircle2 size={13} color={segmentedTab === 'active_stock' ? '#16a34a' : '#94a3b8'} />
                        <span>Active Stock (&lt; 60d)</span>
                        <span style={{ background: '#bbf7d0', color: '#15803d', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                          {currentSiteData.metrics.segmentedLists.activeStock.length}
                        </span>
                      </button>

                      {/* Tab 5: Dispatch / For Investigation */}
                      <button
                        type="button"
                        onClick={() => setSegmentedTab('investigation')}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '6px',
                          border: 'none',
                          fontSize: '12px',
                          fontWeight: segmentedTab === 'investigation' ? 800 : 600,
                          background: segmentedTab === 'investigation' ? '#fff1f2' : 'transparent',
                          color: segmentedTab === 'investigation' ? '#be123c' : '#64748b',
                          borderBottom: segmentedTab === 'investigation' ? '2px solid #be123c' : '2px solid transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <ShieldAlert size={13} color={segmentedTab === 'investigation' ? '#be123c' : '#94a3b8'} />
                        <span>Investigation / Cross-Used Serials</span>
                        <span
                          style={{
                            background: currentSiteData.metrics.segmentedLists.investigation.length > 0 ? '#fecdd3' : '#e2e8f0',
                            color: currentSiteData.metrics.segmentedLists.investigation.length > 0 ? '#be123c' : '#475569',
                            padding: '1px 6px',
                            borderRadius: '999px',
                            fontSize: '10px',
                            fontWeight: 800
                          }}
                        >
                          {currentSiteData.metrics.segmentedLists.investigation.length}
                        </span>
                      </button>
                    </>
                  )}

                  {/* Tab 6: Part Aggregations */}
                  <button
                    type="button"
                    onClick={() => setSegmentedTab('part_aggregations')}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: segmentedTab === 'part_aggregations' ? 800 : 600,
                      background: segmentedTab === 'part_aggregations' ? '#eff6ff' : 'transparent',
                      color: segmentedTab === 'part_aggregations' ? '#0284c7' : '#64748b',
                      borderBottom: segmentedTab === 'part_aggregations' ? '2px solid #0284c7' : '2px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Boxes size={13} color={segmentedTab === 'part_aggregations' ? '#0284c7' : '#94a3b8'} />
                    <span>Part Aggregations (On-Hand Summary)</span>
                    <span style={{ background: '#bae6fd', color: '#0369a1', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                      {currentSiteData.metrics.partAggregations.length} parts
                    </span>
                  </button>

                  {/* Tab 7: All Site Stock */}
                  <button
                    type="button"
                    onClick={() => setSegmentedTab('all_stock')}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: segmentedTab === 'all_stock' ? 800 : 600,
                      background: segmentedTab === 'all_stock' ? '#f1f5f9' : 'transparent',
                      color: segmentedTab === 'all_stock' ? '#0f172a' : '#64748b',
                      borderBottom: segmentedTab === 'all_stock' ? '2px solid #0f172a' : '2px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Layers size={13} color={segmentedTab === 'all_stock' ? '#0f172a' : '#94a3b8'} />
                    <span>All Site Stock</span>
                    <span style={{ background: '#e2e8f0', color: '#0f172a', padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800 }}>
                      {currentSiteData.items.length} units
                    </span>
                  </button>
                </div>

                {/* Quick Branch Stock Search / Filter Input */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '4px 10px',
                    minWidth: '220px',
                    maxWidth: '340px',
                    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)'
                  }}
                >
                  <Search size={14} color="#0284c7" style={{ marginRight: '6px', flexShrink: 0 }} />
                  <input
                    type="text"
                    value={branchFilterQuery}
                    onChange={(e) => setBranchFilterQuery(e.target.value)}
                    placeholder="Filter branch parts or serials..."
                    style={{
                      border: 'none',
                      background: 'transparent',
                      outline: 'none',
                      fontSize: '12px',
                      width: '100%',
                      color: '#0f172a',
                      fontWeight: 600
                    }}
                  />
                  {branchFilterQuery && (
                    <button
                      type="button"
                      onClick={() => setBranchFilterQuery('')}
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'flex', alignItems: 'center' }}
                      title="Clear filter"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Tab Content Display */}
              <div className="table-container" style={{ overflowX: 'auto', maxHeight: '680px' }}>
                
                {/* 5.1 Part Aggregations View */}
                {segmentedTab === 'part_aggregations' ? (
                  <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #0284c7' }}>
                        <th style={{ minWidth: '160px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                        <th style={{ minWidth: '240px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Description</th>
                        <th style={{ textAlign: 'center', width: '150px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Total Serials</th>
                        <th style={{ textAlign: 'center', width: '110px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>DC Stock</th>
                        <th style={{ minWidth: '110px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>MSPI-Owned</th>
                        <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>
                          {(isSuperadmin || isCurrentSiteAssignedToUser) ? 'Aging Breakdown' : 'Stock Availability'}
                        </th>
                        <th style={{ textAlign: 'center', width: '120px', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedPartAggregations.map((partRow, pIdx) => {
                        const hasMatchingSerialInBranchFilter = branchFilterQuery && (partRow.serials || []).some(s => String(s).toLowerCase().includes(branchFilterQuery.toLowerCase().trim()));
                        const isExpanded = expandedPartPn === partRow.partNumber || Boolean(hasMatchingSerialInBranchFilter);
                        const isEven = pIdx % 2 === 1;

                        return (
                          <React.Fragment key={partRow.partNumber}>
                            <tr
                              style={{
                                borderBottom: isExpanded ? 'none' : '1px solid #e2e8f0',
                                background: isExpanded ? '#f0f9ff' : isEven ? '#f8fafc' : '#ffffff'
                              }}
                            >
                              <td style={{ verticalAlign: 'middle', padding: '11px 14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800 }}>
                                    {partRow.partNumber}
                                  </strong>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(partRow.partNumber, 'Part Number')}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                  >
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </td>

                              <td style={{ verticalAlign: 'middle', fontWeight: 600, color: '#0f172a', padding: '11px 14px' }}>
                                {partRow.partDescription}
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '11px 10px' }}>
                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '999px', fontWeight: 800, fontSize: '12px', border: '1px solid #7dd3fc' }}>
                                  {partRow.totalSerialsOnHand} UNITS
                                </span>
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#6d28d9', padding: '11px 10px' }}>
                                {partRow.dcStockCount}
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: '#0369a1', padding: '11px 10px' }}>
                                {partRow.mspiCount}
                              </td>

                              <td style={{ verticalAlign: 'middle', padding: '11px 14px' }}>
                                {(isSuperadmin || isCurrentSiteAssignedToUser) ? (
                                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {partRow.deadCount > 0 && (
                                      <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecdd3', fontSize: '10.5px', fontWeight: 800 }}>
                                        {partRow.deadCount} Dead
                                      </span>
                                    )}
                                    {partRow.nonMovingCount > 0 && (
                                      <span className="badge" style={{ background: '#ffedd5', color: '#ea580c', border: '1px solid #fed7aa', fontSize: '10.5px', fontWeight: 800 }}>
                                        {partRow.nonMovingCount} Non-Moving
                                      </span>
                                    )}
                                    {partRow.slowCount > 0 && (
                                      <span className="badge" style={{ background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a', fontSize: '10.5px', fontWeight: 800 }}>
                                        {partRow.slowCount} Slow
                                      </span>
                                    )}
                                    {partRow.inStockCount > 0 && (
                                      <span className="badge" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', fontSize: '10.5px', fontWeight: 800 }}>
                                        {partRow.inStockCount} Active
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="badge" style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', fontSize: '11px', fontWeight: 700 }}>
                                    {partRow.totalSerialsOnHand} In Branch Stock
                                  </span>
                                )}
                              </td>

                              <td style={{ textAlign: 'center', verticalAlign: 'middle', padding: '11px 10px' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => setExpandedPartPn(isExpanded ? null : partRow.partNumber)}
                                  style={{
                                    fontSize: '11.5px',
                                    padding: '5px 12px',
                                    fontWeight: 800,
                                    color: isExpanded ? '#dc2626' : '#0284c7',
                                    background: isExpanded ? '#fff1f2' : '#ffffff',
                                    border: isExpanded ? '1.5px solid #fecdd3' : '1.5px solid #0284c7',
                                    borderRadius: '6px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  {isExpanded ? 'Hide Serials' : `Serials (${partRow.serials.length})`}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded serial listing row */}
                            {isExpanded && (
                              <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #cbd5e1' }}>
                                <td colSpan={7} style={{ padding: '14px 20px' }}>
                                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span>Serials in Stock for {partRow.partNumber} ({partRow.serials.length} units):</span>
                                    {!canViewCurrentSiteSerials && (
                                      <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, background: '#e2e8f0', padding: '2px 8px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <Lock size={11} color="#64748b" /> Serial numbers restricted to assigned site staff
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {currentSiteData.items
                                      .filter(it => it.partNumber === partRow.partNumber)
                                      .map((unit, sIdx) => {
                                        const isHighlighted = (highlightedSerial && String(unit.serialNumber || '').toUpperCase() === String(highlightedSerial).toUpperCase()) ||
                                          (branchFilterQuery && String(unit.serialNumber || '').toLowerCase().includes(branchFilterQuery.toLowerCase().trim()));

                                        return (
                                          <div
                                            key={`${unit.serialNumber || 'noserial'}-${sIdx}`}
                                            id={`serial-chip-${unit.serialNumber}`}
                                            style={{
                                              background: isHighlighted ? '#fef08a' : '#ffffff',
                                              border: isHighlighted
                                                ? '2px solid #ca8a04'
                                                : (unit.isInvestigation && (isSuperadmin || isCurrentSiteAssignedToUser))
                                                ? '1.5px solid #f87171'
                                                : '1.5px solid #cbd5e1',
                                              borderRadius: '6px',
                                              padding: '4px 8px',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '6px',
                                              fontSize: '12px',
                                              boxShadow: isHighlighted ? '0 0 0 3px rgba(234, 179, 8, 0.4)' : 'none',
                                              transition: 'all 0.2s ease'
                                            }}
                                          >
                                            <code style={{ color: isHighlighted ? '#854d0e' : (unit.isInvestigation && (isSuperadmin || isCurrentSiteAssignedToUser)) ? '#be123c' : '#0f172a', fontWeight: 800 }}>
                                              {!canViewCurrentSiteSerials ? (
                                                <span style={{ color: '#64748b', fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                  <Lock size={10} color="#94a3b8" /> ••••••••••••
                                                </span>
                                              ) : (
                                                unit.serialNumber || 'NON-SERIALIZED'
                                              )}
                                            </code>
                                            {(isSuperadmin || isCurrentSiteAssignedToUser) && (
                                              <span style={{ fontSize: '10.5px', padding: '1px 5px', borderRadius: '4px', background: unit.badgeBg, color: unit.badgeColor, fontWeight: 800 }}>
                                                {unit.agingDays}d
                                              </span>
                                            )}
                                            {(isSuperadmin || isCurrentSiteAssignedToUser) && unit.isInvestigation && (
                                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: '#ffe4e6', color: '#9f1239', fontWeight: 800 }}>
                                                KGB Used
                                              </span>
                                            )}
                                            {canViewCurrentSiteSerials && unit.serialNumber && (
                                              <button
                                                type="button"
                                                onClick={() => handleCopy(unit.serialNumber, 'Serial')}
                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '1px' }}
                                                title="Copy serial"
                                              >
                                                <Copy size={11} />
                                              </button>
                                            )}
                                            {canViewCurrentSiteSerials && unit.serialNumber && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const sd = resolveSerialFullDetails(unit.serialNumber, {
                                                    inventoryUnits: snapshot?.items || [],
                                                    shipments: [],
                                                    repairUsageRecords: [],
                                                    sites,
                                                    parts,
                                                    fixablyItems: snapshot?.items || []
                                                  });
                                                  if (sd) setInspectedSerialDetails(sd);
                                                }}
                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#0284c7', padding: '1px' }}
                                                title="View serial dossier"
                                              >
                                                <Zap size={11} />
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : segmentedTab === 'investigation' ? (
                  /* 5.2 Dedicated Dispatch / For Investigation Tab */
                  (() => {
                    const invList = currentSiteData.metrics.segmentedLists.investigation;

                    if (invList.length === 0) {
                      return (
                        <div style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>
                          <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 8px' }} />
                          <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '16px', fontWeight: 800 }}>
                            No Dispatched / Closed GSX Contradictions for {currentSiteData.siteCode}
                          </h4>
                          <p style={{ margin: 0, fontSize: '13px' }}>
                            None of the on-hand units at this site match repairs in the KGB Used Report. All serials are verified clean.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div>
                        {/* Sub-header with export actions */}
                        <div style={{ padding: '12px 18px', background: '#fff1f2', borderBottom: '1.5px solid #fecdd3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ShieldAlert size={18} color="#be123c" />
                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#be123c' }}>
                              {invList.length} Units Flagged in Closed GSX Repairs (Investigation Required)
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => exportInvestigationToCsv(itemsForBranchExport, currentSiteData.siteCode)}
                              style={{
                                fontSize: '11.5px',
                                padding: '5px 12px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontWeight: 700,
                                color: '#be123c',
                                background: '#ffffff',
                                border: '1.5px solid #fecdd3',
                                borderRadius: '5px',
                                cursor: 'pointer'
                              }}
                            >
                              <Download size={12} color="#be123c" />
                              <span>Export Investigation CSV</span>
                            </button>

                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => exportInvestigationToExcel(itemsForBranchExport, currentSiteData.siteCode)}
                              style={{
                                fontSize: '11.5px',
                                padding: '5px 12px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                fontWeight: 700,
                                color: '#be123c',
                                background: '#ffffff',
                                border: '1.5px solid #fecdd3',
                                borderRadius: '5px',
                                cursor: 'pointer'
                              }}
                            >
                              <FileSpreadsheet size={12} color="#be123c" />
                              <span>Export Investigation Excel</span>
                            </button>
                          </div>
                        </div>

                        <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid #0284c7' }}>
                              <th style={{ width: '45px', textAlign: 'center', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>#</th>
                              <th style={{ minWidth: '150px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                              <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Description</th>
                              <th style={{ minWidth: '170px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>
                                Transferred Serial {!canViewCurrentSiteSerials && <span style={{ fontSize: '10px', color: '#fca5a5', textTransform: 'none', fontWeight: 600 }}>(Restricted)</span>}
                              </th>
                              <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Stock Type</th>
                              <th style={{ minWidth: '130px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Order Number</th>
                              <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Closed Date</th>
                              <th style={{ minWidth: '180px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Used By (Location)</th>
                              <th style={{ width: '100px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>GSX Status</th>
                              <th style={{ width: '110px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Last Received</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invList.map((unit, uIdx) => (
                              <tr key={unit.id} style={{ borderBottom: '1px solid #e2e8f0', background: '#fff5f5' }}>
                                <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 700, verticalAlign: 'middle', padding: '11px 10px' }}>
                                  {uIdx + 1}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800 }}>{unit.partNumber}</strong>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(unit.partNumber, 'Part Number')}
                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                    >
                                      <Copy size={12} />
                                    </button>
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', fontWeight: 600, color: '#0f172a', padding: '11px 12px' }}>
                                  {unit.description}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  {!canViewCurrentSiteSerials ? (
                                    <span style={{
                                      fontSize: '11.5px',
                                      color: '#64748b',
                                      background: '#f1f5f9',
                                      border: '1px solid #cbd5e1',
                                      padding: '3px 8px',
                                      borderRadius: '5px',
                                      fontWeight: 600,
                                      fontStyle: 'italic',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}>
                                      <Lock size={11} color="#94a3b8" />
                                      •••••••••••• (Restricted)
                                    </span>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <code style={{ fontSize: '12px', color: '#9f1239', background: '#ffe4e6', border: '1.5px solid #fecdd3', padding: '3px 8px', borderRadius: '5px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                                        {unit.serialNumber}
                                      </code>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(unit.serialNumber, 'Serial')}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                        title="Copy Serial Number"
                                      >
                                        <Copy size={12} />
                                      </button>
                                    </div>
                                  )}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '3px 8px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 800,
                                      background: unit.stockType === 'DC Stock' ? '#ede9fe' : '#e0f2fe',
                                      color: unit.stockType === 'DC Stock' ? '#6d28d9' : '#0369a1',
                                      border: unit.stockType === 'DC Stock' ? '1.5px solid #c4b5fd' : '1.5px solid #7dd3fc'
                                    }}
                                  >
                                    {unit.stockType}
                                  </span>
                                </td>

                                <td style={{ verticalAlign: 'middle', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)', padding: '11px 12px' }}>
                                  {unit.investigationDetails?.orderId || '—'}
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#1e293b', fontWeight: 600, padding: '11px 12px' }}>
                                  {unit.investigationDetails?.repairClosedDate || '—'}
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#0f172a', fontWeight: 700, padding: '11px 12px' }}>
                                  {unit.investigationDetails?.locationName || currentSiteData.siteName}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '11px 12px' }}>
                                  <span className="badge" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 800 }}>
                                    {unit.investigationDetails?.gsxStatus || 'SCOM'}
                                  </span>
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#475569', fontWeight: 600, padding: '11px 12px' }}>
                                  {unit.lastReceivedDate || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                ) : (
                  /* 5.3 Segmented Lists View (Dead Stock, Non-Moving, Slow-Moving, Active Stock, All Stock) */
                  (() => {
                    const activeList =
                      segmentedTab === 'dead_stock'
                        ? currentSiteData.metrics.segmentedLists.deadStock
                        : segmentedTab === 'non_moving'
                        ? currentSiteData.metrics.segmentedLists.nonMoving
                        : segmentedTab === 'slow_moving'
                        ? currentSiteData.metrics.segmentedLists.slowMoving
                        : segmentedTab === 'active_stock'
                        ? currentSiteData.metrics.segmentedLists.activeStock
                        : currentSiteData.items;

                    if (activeList.length === 0) {
                      return (
                        <div style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>
                          <CheckCircle2 size={36} color="#10b981" style={{ margin: '0 auto 8px' }} />
                          <h4 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: '16px', fontWeight: 800 }}>
                            No Items in this Aging Bracket
                          </h4>
                          <p style={{ margin: 0, fontSize: '13px' }}>
                            {currentSiteData.siteCode} has 0 parts classified in this bracket.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <table className="data-table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #0284c7' }}>
                            <th style={{ width: '50px', textAlign: 'center', padding: '12px 10px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>#</th>
                            <th style={{ minWidth: '150px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Number</th>
                            <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Description</th>
                            <th style={{ width: '130px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Classification</th>
                            <th style={{ minWidth: '175px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>
                              Serial Number {!canViewCurrentSiteSerials && <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'none', fontWeight: 600 }}>(Restricted)</span>}
                            </th>
                            <th style={{ width: '120px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Last Received</th>
                            <th style={{ minWidth: '220px', padding: '12px 14px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>
                              {(isSuperadmin || isCurrentSiteAssignedToUser) ? 'Aging & Status' : 'Stock Availability'}
                            </th>
                            <th style={{ width: '110px', textAlign: 'right', padding: '12px 16px', fontSize: '11px', fontWeight: 800, background: '#0f172a', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #0284c7', whiteSpace: 'nowrap' }}>Part Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeList.map((unit, uIdx) => {
                            const isEven = uIdx % 2 === 1;

                            return (
                              <tr
                                key={unit.id}
                                style={{
                                  borderBottom: '1px solid #e2e8f0',
                                  background: isEven ? '#f8fafc' : '#ffffff',
                                  transition: 'background-color 0.1s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#e0f2fe';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = isEven ? '#f8fafc' : '#ffffff';
                                }}
                              >
                                <td style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 700, verticalAlign: 'middle', padding: '12px 10px', whiteSpace: 'nowrap' }}>
                                  {uIdx + 1}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: '#0284c7', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', fontWeight: 700 }}>{unit.partNumber}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(unit.partNumber, 'Part Number')}
                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                    >
                                      <Copy size={12} />
                                    </button>
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px' }}>
                                  <div style={{ color: '#0f172a', fontWeight: 500, fontSize: '13px', lineHeight: 1.4, minWidth: '220px' }}>
                                    {unit.description}
                                  </div>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                      padding: '3px 9px',
                                      borderRadius: '6px',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                      background: unit.stockType === 'DC Stock' ? '#f5f3ff' : '#f0f9ff',
                                      color: unit.stockType === 'DC Stock' ? '#6d28d9' : '#0369a1',
                                      border: unit.stockType === 'DC Stock' ? '1px solid #ddd6fe' : '1px solid #bae6fd'
                                    }}
                                  >
                                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: unit.stockType === 'DC Stock' ? '#8b5cf6' : '#0284c7' }} />
                                    {unit.stockType}
                                  </span>
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  {!canViewCurrentSiteSerials ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{
                                        fontSize: '11.5px',
                                        color: '#64748b',
                                        background: '#f1f5f9',
                                        border: '1px solid #cbd5e1',
                                        padding: '3px 8px',
                                        borderRadius: '5px',
                                        fontWeight: 600,
                                        fontStyle: 'italic',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                      }}>
                                        <Lock size={11} color="#94a3b8" />
                                        •••••••••••• (Restricted)
                                      </span>
                                    </div>
                                  ) : unit.serialNumber ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{
                                        fontSize: '12px',
                                        color: '#0f172a',
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        padding: '3px 8px',
                                        borderRadius: '5px',
                                        fontWeight: 600,
                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                        letterSpacing: '0.02em'
                                      }}>
                                        {unit.serialNumber}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(unit.serialNumber, 'Serial')}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        <Copy size={12} />
                                      </button>
                                    </div>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '11.5px', fontStyle: 'italic' }}>Non-serialized</span>
                                  )}
                                </td>

                                <td style={{ verticalAlign: 'middle', fontSize: '12.5px', color: '#475569', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  {unit.lastReceivedDate || '—'}
                                </td>

                                <td style={{ verticalAlign: 'middle', padding: '12px 14px', whiteSpace: 'nowrap' }}>
                                  {(isSuperadmin || isCurrentSiteAssignedToUser) ? (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '5px',
                                          padding: '3px 9px',
                                          borderRadius: '6px',
                                          fontSize: '11.5px',
                                          fontWeight: 700,
                                          whiteSpace: 'nowrap',
                                          background: unit.badgeBg,
                                          color: unit.badgeColor,
                                          border: unit.agingBracket === AGING_BRACKETS.DEAD_STOCK ? '1px solid #fca5a5'
                                            : unit.agingBracket === AGING_BRACKETS.NON_MOVING ? '1px solid #fdba74'
                                            : unit.agingBracket === AGING_BRACKETS.SLOW_MOVING ? '1px solid #fde047'
                                            : '1px solid #86efac'
                                        }}
                                        title={unit.statusLabel}
                                      >
                                        {unit.agingBracket === AGING_BRACKETS.DEAD_STOCK && <AlertTriangle size={12} color="#dc2626" />}
                                        {unit.agingBracket === AGING_BRACKETS.NON_MOVING && <Clock size={12} color="#ea580c" />}
                                        {unit.agingBracket === AGING_BRACKETS.SLOW_MOVING && <TrendingDown size={12} color="#d97706" />}
                                        {unit.agingBracket === AGING_BRACKETS.IN_STOCK && <CheckCircle2 size={12} color="#16a34a" />}
                                        <span>
                                          {unit.agingBracket === AGING_BRACKETS.DEAD_STOCK
                                            ? `Dead Stock (${unit.agingDays}d)`
                                            : unit.agingBracket === AGING_BRACKETS.NON_MOVING
                                            ? `Non-Moving (${unit.agingDays}d)`
                                            : unit.agingBracket === AGING_BRACKETS.SLOW_MOVING
                                            ? `Slow-Moving (${unit.agingDays}d)`
                                            : `In Stock (${unit.agingDays}d)`}
                                        </span>
                                      </span>

                                      {unit.agingBracket === AGING_BRACKETS.DEAD_STOCK && (
                                        <span
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            fontSize: '10px',
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.04em',
                                            background: '#fee2e2',
                                            color: '#b91c1c',
                                            border: '1px solid #fca5a5',
                                            whiteSpace: 'nowrap'
                                          }}
                                          title="Action Required: RMA pull-out or site reallocation"
                                        >
                                          Action Req.
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        padding: '3px 9px',
                                        borderRadius: '6px',
                                        fontSize: '11.5px',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap',
                                        background: '#ecfdf5',
                                        color: '#15803d',
                                        border: '1px solid #86efac'
                                      }}
                                      title="Part is in physical stock at this branch and available for requisition/transfer"
                                    >
                                      <CheckCircle2 size={12} color="#16a34a" />
                                      <span>In Stock / Available</span>
                                    </span>
                                  )}
                                </td>

                                <td style={{ verticalAlign: 'middle', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '13px', color: '#0f172a', padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  ${(unit.totalValue || unit.partValue || 0).toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()
                )}

              </div>
            </div>
          )}

        </div>
      )}

      {/* Serial Dossier Intelligence Modal */}
      {inspectedSerialDetails && (
        <SerialDossierModal
          serialDetails={inspectedSerialDetails}
          onClose={() => setInspectedSerialDetails(null)}
        />
      )}

      {/* Chronological Stock Movement & Ownership Timeline Modal */}
      {inspectedMovementUnit && (
        <MovementHistoryModal
          unit={inspectedMovementUnit}
          sites={sites}
          transferHistory={loadLocalTransferHistory()}
          onClose={() => setInspectedMovementUnit(null)}
        />
      )}

    </div>
  );
}
