import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite, isUUID, getCleanDisplaySerial } from '../utils/appContextHelpers';
import { isProvincialSite, isDisplayOrBatteryForIPhone13Plus, resolveCanonicalIPhoneModel } from '../utils/partResolver';
import { getCategoryForPart, getCategoryBadgeStyle } from '../utils/categoryFilter';
import { defaultPartsCatalog } from '../data/defaultCatalog';
import * as XLSX from 'xlsx';
import { formatTo12HourTime, formatTo12HourDateTime } from '../utils/dateUtils';
import { formatCourierWithMode, buildSerialDictionary, healShipmentItem, getShipmentRiderName } from '../utils/shipmentHelpers';
import StatusChangeLoadingModal from './StatusChangeLoadingModal';
import ConfirmReceiveModal from './ConfirmReceiveModal';
import AllStocksImportModal from './AllStocksImportModal';
import SerialDossierModal from './SerialDossierModal';
import { searchSerialsWithFullDetails } from '../utils/serialTracker';
import {
  Inbox,
  Send,
  UploadCloud,
  Plus,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  ShieldCheck,
  Building2,
  Package,
  Boxes,
  FileSpreadsheet,
  TrendingDown,
  Calendar,
  Check,
  X,
  Info,
  Lock,
  Unlock,
  MessageSquare,
  Wrench,
  History,
  RotateCcw,
  Zap,
  Trash2,
  Edit3,
  Truck,
  PackageCheck,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MapPin,
  Smartphone,
  SearchX,
  Copy,
  Mail,
  Phone,
  Globe,
  Barcode
} from 'lucide-react';

const REASON_PRESETS = [
  'Customer Repair Backlog (Immediate Need)',
  'Branch Buffer Stock Exhausted',
  'Emergency ASP Work Order / Walk-in',
  'Warranty Replacement Awaiting Part',
  'VIP / Corporate Fleet Repair',
  'Quarterly Buffer Replenishment'
];

export default function RequestParts({ defaultTab = 'requests_table', _embeddedMode = false, onNavigateToStation = null }) {
  const {
    activeTab: globalActiveTab,
    setActiveTab: setGlobalActiveTab,
    currentUser,
    sites = [],
    parts = [],
    categories = [],
    inventoryUnits = [],
    partsRequests = [],
    shipments = [],
    repairUsageRecords = [],
    confirmSiteReceive,
    submitPartsRequest,
    submitBatchPartsRequests,
    cancelPartsRequest,
    updatePartsRequestStatus,
    getStockOnHandForSite,
    getAllSitesStockSummary,
    getUsedPartsForSite,
    getUsedUnitsLog,
    markUnitAsUsed,
    unmarkUnitAsUsed,
    deleteScanInUnit,
    clearSiteParts,
    updateUnitDetails,
    fetchPartsRequests,
    isLoadingPartsRequests,
    showToast,
    isAutoRefreshing,
    autoRefreshData,
    pmgSubTab,
    setPmgSubTab,
    setParts,
    batchAddScanInUnits,
    supervisorSettings,
    broadcastCloudEvent
  } = useApp();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importModalFileType, setImportModalFileType] = useState('csv');
  const [inspectedSerialDetails, setInspectedSerialDetails] = useState(null);
  const [copiedSerial, setCopiedSerial] = useState(null);

  const isSuperadmin = currentUser?.role === 'superadmin' || currentUser?.role === 'SUPERADMIN';
  const isPmgUser = currentUser?.role === 'parts_management';
  const isAdmin = isSuperadmin || currentUser?.role === 'admin' || currentUser?.isSuperAdmin;
  const canRestore = isAdmin;
  const currentUserSiteRef = currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode || currentUser?.site_code;

  // User site resolution (Superadmin is explicitly Central DC, not retail branches)
  const userSiteObj = useMemo(() => {
    if (isSuperadmin || currentUser?.siteId === 'site-dc') {
      return sites.find(s => s.id === 'site-dc' || s.code === 'DC-MDC' || s.code === 'DC') || { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center (DC)' };
    }
    return sites.find(s => s.id === currentUserSiteRef || s.code === currentUserSiteRef) || sites[0] || {};
  }, [sites, currentUserSiteRef, isSuperadmin, currentUser?.siteId]);

  // Selected site filter
  const [selectedSiteId, setSelectedSiteId] = useState(() => {
    if (!isSuperadmin && currentUserSiteRef) {
      return currentUserSiteRef;
    }
    return 'ALL';
  });

  const activeSiteObj = useMemo(() => {
    if (selectedSiteId === 'ALL') {
      return { id: 'ALL', code: 'ALL', name: 'All Branch Sites' };
    }
    return sites.find(s => s.id === selectedSiteId || s.code === selectedSiteId) || userSiteObj;
  }, [sites, selectedSiteId, userSiteObj]);

  const branchSitesCount = useMemo(() => (sites || []).filter(s => !s.is_dc && s.is_active !== false).length, [sites]);

  // Active Sub-Tab: 'requests_table' | 'stock_on_hand' | 'all_stocks' | 'usage_history'
  const [activeTab, setActiveTab] = useState(() => {
    if (defaultTab === 'all_stocks') return 'all_stocks';
    return pmgSubTab || defaultTab || 'requests_table';
  });

  const prevDefaultTabRef = useRef(defaultTab);
  useEffect(() => {
    if (prevDefaultTabRef.current !== defaultTab) {
      prevDefaultTabRef.current = defaultTab;
      if (defaultTab === 'all_stocks') {
        setActiveTab('all_stocks');
        if (setPmgSubTab && pmgSubTab !== 'all_stocks') {
          setPmgSubTab('all_stocks');
        }
      } else if (defaultTab) {
        setActiveTab(defaultTab);
        if (setPmgSubTab) {
          setPmgSubTab(defaultTab);
        }
      }
    } else if (pmgSubTab && pmgSubTab !== activeTab) {
      if (defaultTab === 'all_stocks' && pmgSubTab !== 'all_stocks') {
        if (setPmgSubTab) setPmgSubTab('all_stocks');
      } else {
        setActiveTab(pmgSubTab);
      }
    }
  }, [defaultTab, pmgSubTab, activeTab, setPmgSubTab]);

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    if (setPmgSubTab) {
      setPmgSubTab(newTab);
    }
    try {
      localStorage.setItem('mdc_parts_subtab', newTab);
    } catch (e) {}
    if (newTab === 'all_stocks' && setGlobalActiveTab && globalActiveTab !== 'all-stocks') {
      setGlobalActiveTab('all-stocks');
    } else if (newTab !== 'all_stocks' && setGlobalActiveTab && globalActiveTab === 'all-stocks') {
      setGlobalActiveTab('request-parts');
    }
  };

  const [copiedWaybill, setCopiedWaybill] = useState(null);

  const handleCopyWaybill = (rawTracking) => {
    if (!rawTracking) return;
    const clean = String(rawTracking).replace(/^#\s*/, '').trim();
    if (!clean) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clean);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = clean;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedWaybill(clean);
      showToast?.(`Copied Waybill #${clean} to clipboard!`, 'success');
      setTimeout(() => setCopiedWaybill(null), 2000);
    } catch (err) {
      console.error('Failed to copy waybill:', err);
      showToast?.('Failed to copy Waybill to clipboard', 'error');
    }
  };

  // Listen for quick action events triggered from PmgSidebar
  useEffect(() => {
    const handleOpenReq = () => {
      setActiveTab('requests_table');
      if (setPmgSubTab) setPmgSubTab('requests_table');
      setIsFormOpen(true);
    };

    const handleOpenUsed = () => {
      setActiveTab('usage_history');
      if (setPmgSubTab) setPmgSubTab('usage_history');
      setIsMarkUsedModalOpen(true);
    };

    window.addEventListener('mdc:open-request-form', handleOpenReq);
    window.addEventListener('mdc:open-mark-used', handleOpenUsed);

    return () => {
      window.removeEventListener('mdc:open-request-form', handleOpenReq);
      window.removeEventListener('mdc:open-mark-used', handleOpenUsed);
    };
  }, [setPmgSubTab]);

  // Multi-Item Form State for New Replenishment Request (Strictly iPhone 13+ Displays & Batteries)
  const createEmptyRequestRow = () => ({
    id: `req-row-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    partNumber: '',
    partSearch: '',
    quantity: 1,
    showDropdown: false
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [requestRows, setRequestRows] = useState([
    {
      id: 'req-row-init-1',
      partNumber: '',
      partSearch: '',
      quantity: 1,
      showDropdown: false
    }
  ]);
  const [formPriority, setFormPriority] = useState('normal');
  const [formReason, setFormReason] = useState(REASON_PRESETS[0]);
  const [formNotes, setFormNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formCategoryFilter, setFormCategoryFilter] = useState('ALL'); // 'ALL' | 'display' | 'battery'
  const [formModelFilter, setFormModelFilter] = useState('ALL'); // 'ALL' | '17' | '16' | '15' | '14' | '13'

  const addRequestRow = (initialPn = '', initialSearch = '', initialQty = 1) => {
    setRequestRows(prev => [
      ...prev,
      {
        id: `req-row-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        partNumber: initialPn,
        partSearch: initialSearch,
        quantity: initialQty,
        showDropdown: false
      }
    ]);
  };

  const removeRequestRow = (rowId) => {
    setRequestRows(prev => {
      if (prev.length <= 1) {
        return [createEmptyRequestRow()];
      }
      return prev.filter(r => r.id !== rowId);
    });
  };

  const updateRequestRow = (rowId, updates) => {
    setRequestRows(prev => prev.map(r => r.id === rowId ? { ...r, ...updates } : r));
  };

  // Mark Part as Used Modal State (PMG Repair Consumption Feature)
  const [isMarkUsedModalOpen, setIsMarkUsedModalOpen] = useState(false);
  const [markUsedPartPn, setMarkUsedPartPn] = useState('');
  const [markUsedSerials, setMarkUsedSerials] = useState([]);
  const [serialSearchFilter, setSerialSearchFilter] = useState('');
  const [markUsedWorkOrder, setMarkUsedWorkOrder] = useState('');
  const [markUsedNotes, setMarkUsedNotes] = useState('');
  const [isSubmittingMarkUsed, setIsSubmittingMarkUsed] = useState(false);
  const [usedHistorySubTab, setUsedHistorySubTab] = useState('live_log'); // 'live_log' | 'aggregated_data'
  const [usedLogSearchQuery, setUsedLogSearchQuery] = useState('');

  // Table Search & Filter State
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState('ALL');
  const [stockViewMode, setStockViewMode] = useState('grouped'); // 'grouped' | 'flat'
  const [stockDeviceFilter, setStockDeviceFilter] = useState('ALL');
  const [collapsedDevices, setCollapsedDevices] = useState({});
  const [isIncomingShipmentsCollapsed, setIsIncomingShipmentsCollapsed] = useState(false);

  // Multi-Site All Stocks Tab State
  const [allStocksRegionTab, setAllStocksRegionTab] = useState(() => {
    if (userSiteObj && isProvincialSite(userSiteObj)) return 'provincial';
    return 'metro_manila';
  });
  const [allStocksSelectedSiteId, setAllStocksSelectedSiteId] = useState('');
  const [allStocksSiteFilter, _setAllStocksSiteFilter] = useState('ALL');
  const [allStocksSearchQuery, setAllStocksSearchQuery] = useState('');
  const [expandedPartKey, setExpandedPartKey] = useState(null);

  // Status Action Modal State (For Superadmin Approvals / Denials)
  const [actionModalRequest, setActionModalRequest] = useState(null);
  const [actionTargetStatus, setActionTargetStatus] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [actionQtyFulfilled, setActionQtyFulfilled] = useState(1);

  // Unit Delete & Edit Modal State (Branch & Multi-Site Parts Management)
  const [unitToDelete, setUnitToDelete] = useState(null);
  const [isDeletingUnit, setIsDeletingUnit] = useState(false);
  const [deletionReason, setDeletionReason] = useState('Defective / Damaged Part');
  const [customDeletionReason, setCustomDeletionReason] = useState('');
  const [unitToEdit, setUnitToEdit] = useState(null);
  const [editBoxNumber, setEditBoxNumber] = useState(1);
  const [editWorkOrder, setEditWorkOrder] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Clear Site Parts Modal State
  const [clearPartsModalState, setClearPartsModalState] = useState(null);
  const [isClearingSiteParts, setIsClearingSiteParts] = useState(false);

  // Superadmin Site Receipt Confirmation Modal State
  const [receiveModalState, setReceiveModalState] = useState(null);
  const [statusLoadingState, setStatusLoadingState] = useState(null);

  const handleOpenReceiveModal = (shipment) => {
    if (!shipment) return;
    const isShipped = shipment.status === 'shipped' || shipment.status === 'in_transit';
    if (!isShipped) {
      alert('Package cannot be confirmed until it has been dispatched/shipped from Central DC.');
      return;
    }
    const destSite = sites.find(st => st.id === shipment.site_id || st.code === shipment.site_code) || activeSiteObj;
    const isSuper = currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin;
    // For Superadmin users, field remains blank and must be completed before confirming receipt.
    // For PMG accounts (and site users), auto-fill with their login name.
    const initialReceiver = isSuper ? '' : (currentUser?.fullName || currentUser?.name || `${destSite.code || 'Branch'} Staff`);
    setReceiveModalState({
      shipment,
      site: destSite,
      receivedByName: initialReceiver,
      receivedDate: new Date().toISOString().split('T')[0],
      receivedCondition: 'Good Condition (All parts intact & verified)',
      receivingNotes: `Confirmed physical receipt of shipment manifest #${shipment.invoice_ref || shipment.shipment_number} at ${destSite.name || 'Branch'}.`
    });
  };

  const handleConfirmSiteReceiveSubmit = async (payload = {}) => {
    if (!receiveModalState) return;

    const trimmedReceiver = String(payload?.receivedByName || receiveModalState.receivedByName || '').trim();
    if (!trimmedReceiver) {
      showToast?.('Please enter the name of the staff member who received the package.', 'warning');
      return;
    }

    const targetShipment = receiveModalState.shipment;
    const isShipped = targetShipment?.status === 'shipped' || targetShipment?.status === 'in_transit';
    if (!isShipped) {
      alert('Package cannot be confirmed until it has been dispatched/shipped from Central DC.');
      return;
    }
    const targetSite = receiveModalState.site;
    const invRef = targetShipment?.invoice_ref || targetShipment?.shipment_number || 'Shipment';
    const siteName = targetSite?.name || targetShipment?.site_name || '';

    setStatusLoadingState({
      isOpen: true,
      title: 'Confirming Site Package Receipt...',
      invoiceRef: invRef,
      siteName: siteName,
      targetStatus: 'Received Confirmed & Stock Added',
      isConfirmReceive: true
    });

    const startTime = Date.now();
    try {
      if (typeof confirmSiteReceive === 'function') {
        await confirmSiteReceive(
          targetShipment.id,
          {
            receivedByName: trimmedReceiver,
            receivedDate: payload?.receivedDate || receiveModalState.receivedDate,
            receivedCondition: payload?.receivedCondition || receiveModalState.receivedCondition,
            receivingNotes: payload?.receivingNotes || receiveModalState.receivingNotes,
            signedPlDriveLink: payload?.signedPlDriveLink,
            signedPlFileId: payload?.signedPlFileId,
            signedPlFilename: payload?.signedPlFilename,
            siteFolder: payload?.siteFolder
          },
          { partsRequests, updatePartsRequestStatus }
        );
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 350) {
        await new Promise(r => setTimeout(r, 350 - elapsed));
      }

      setReceiveModalState(null);
    } catch (err) {
      console.error('Error confirming site receipt:', err);
    } finally {
      setStatusLoadingState(null);
    }
  };

  const { serialDict, partsMapByPn } = useMemo(() => {
    return buildSerialDictionary({
      inventoryUnits,
      parts,
      shipments
    });
  }, [inventoryUnits, parts, shipments]);

  // Derive Incoming & In-Transit Shipments for this branch (Awaiting Superadmin confirmation)
  const incomingShipments = useMemo(() => {
    const userResolved = resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
    const targetSiteId = isSuperadmin && selectedSiteId !== 'ALL' ? selectedSiteId : userResolved.id;
    const targetSiteCode = isSuperadmin && selectedSiteId !== 'ALL'
      ? (sites.find(s => s.id === selectedSiteId)?.code || selectedSiteId)
      : (activeSiteObj?.code || userResolved.code);

    const filtered = (shipments || []).filter(sh => {
      if (!sh.items || sh.items.length === 0) return false;
      const isPending = sh.status === 'pending_pickup' || sh.status === 'shipped' || sh.status === 'in_transit' || sh.status === 'draft';
      if (!isPending) return false;

      if (selectedSiteId === 'ALL' && isSuperadmin) return true;

      const shSite = resolveSite(sh.site_id || sh.site_code || sh.siteId || sh.siteCode, sites);
      const matchesSite = (shSite.id && (shSite.id === targetSiteId || shSite.id === targetSiteCode)) ||
                          (shSite.code && targetSiteCode && shSite.code.toUpperCase() === String(targetSiteCode).toUpperCase()) ||
                          (sh.site_id && (sh.site_id === targetSiteId || sh.site_id === targetSiteCode)) ||
                          (sh.site_code && (sh.site_code === targetSiteCode || sh.site_code === targetSiteId));
      return matchesSite;
    });

    return filtered.map(sh => {
      const healedItems = (sh.items || []).map(it => healShipmentItem(it, serialDict, partsMapByPn));
      const resolvedRider = getShipmentRiderName(sh, shipments);
      return {
        ...sh,
        items: healedItems,
        pickup_by_name: resolvedRider || sh.pickup_by_name || sh.courier_name || '',
        courier_name: resolvedRider || sh.courier_name || sh.pickup_by_name || ''
      };
    });
  }, [shipments, isSuperadmin, selectedSiteId, currentUser, sites, activeSiteObj, serialDict, partsMapByPn]);

  const handleConfirmDeleteUnit = async () => {
    if (!unitToDelete) return;
    setIsDeletingUnit(true);
    try {
      const finalReason = deletionReason === 'OTHER'
        ? (customDeletionReason.trim() || 'Inventory unit removed from stock by user')
        : (deletionReason || 'Inventory unit removed from stock by user');
      const res = await deleteScanInUnit(unitToDelete, finalReason);
      if (res && res.success !== false) {
        showToast(`Successfully deleted unit #${unitToDelete.serial_number || unitToDelete.serialNumber}`, 'success');
        setUnitToDelete(null);
        setDeletionReason('Defective / Damaged Part');
        setCustomDeletionReason('');
      }
    } finally {
      setIsDeletingUnit(false);
    }
  };

  const openEditUnitModal = (u) => {
    setUnitToEdit(u);
    setEditBoxNumber(u.box_number || u.boxNumber || 1);
    setEditWorkOrder(u.work_order_number || '');
    setEditNotes(u.notes || '');
  };

  const handleConfirmEditUnit = async (e) => {
    if (e) e.preventDefault();
    if (!unitToEdit) return;
    setIsSubmittingEdit(true);
    try {
      const serial = unitToEdit.serial_number || unitToEdit.serialNumber;
      const res = await updateUnitDetails(serial, {
        box_number: parseInt(editBoxNumber, 10) || 1,
        work_order_number: editWorkOrder,
        notes: editNotes
      });
      if (res && res.success) {
        setUnitToEdit(null);
      }
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleOpenClearPartsModal = (siteId, siteCode, siteName = '') => {
    const isAll = siteId === 'ALL';
    const count = isAll
      ? (inventoryUnits || []).filter(u => {
        const sId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
        const sCode = String(u.site_code || u.siteCode || '').toUpperCase();
        return sId !== 'site-dc' && sCode !== 'DC-MDC' && sCode !== 'DC' && !u.is_dc;
      }).length
      : ((multiSiteStockData || []).find(s => s.siteId === siteId || s.siteCode === siteCode)?.totalInStock || 0);
    setClearPartsModalState({
      siteId,
      siteCode,
      siteName: siteName || (isAll ? 'All Retail Branches' : (siteCode || 'Branch')),
      count,
      isAllSites: isAll
    });
  };

  const handleConfirmClearParts = async () => {
    if (!clearPartsModalState || typeof clearSiteParts !== 'function') return;
    setIsClearingSiteParts(true);
    try {
      await clearSiteParts({
        siteId: clearPartsModalState.isAllSites ? null : clearPartsModalState.siteId,
        siteCode: clearPartsModalState.isAllSites ? null : clearPartsModalState.siteCode,
        clearAllSites: clearPartsModalState.isAllSites,
        reason: `Cleared old shipped parts for ${clearPartsModalState.siteName} prior to Excel import`
      });
      setClearPartsModalState(null);
    } catch (err) {
      showToast?.('Error clearing parts: ' + err.message, 'error');
    } finally {
      setIsClearingSiteParts(false);
    }
  };

  // Derive Stock On Hand for current site
  const siteStockData = useMemo(() => {
    return getStockOnHandForSite(selectedSiteId);
  }, [getStockOnHandForSite, selectedSiteId]);

  // Derive Multi-Site Stocks with Granular Serial Privacy (Excluding Central DC stocks)
  // The compiler cannot preserve this conditional memo, which intentionally gates
  // the expensive network summary until the All Stocks tab is visible.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const multiSiteStockData = useMemo(() => {
    // Network-wide serialized detail is expensive; compute it only when the tab is visible.
    if (activeTab !== 'all_stocks') return [];
    if (typeof getAllSitesStockSummary === 'function') {
      const all = getAllSitesStockSummary(allStocksSiteFilter) || [];
      return all.filter(s => s.siteId !== 'site-dc' && s.siteCode !== 'DC-MDC' && s.siteCode !== 'DC');
    }
    return [];
  }, [activeTab, getAllSitesStockSummary, allStocksSiteFilter]);

  // Derive Used Parts historical consumption
  const siteUsageData = useMemo(() => {
    return getUsedPartsForSite(selectedSiteId);
  }, [getUsedPartsForSite, selectedSiteId]);

  // Filtered Parts Requests (Only Superadmin sees all requests; Site staff see only their own)
  const filteredRequests = useMemo(() => {
    return partsRequests.filter(req => {
      // 1. Site isolation: Non-superadmin users ONLY see their site
      if (!isSuperadmin) {
        const matchesSite = req.site_id === currentUser?.siteId ||
                            req.site_code === userSiteObj.code ||
                            req.requested_by === currentUser?.id;
        if (!matchesSite) return false;
      } else if (selectedSiteId && selectedSiteId !== 'ALL') {
        const matchesSite = req.site_id === selectedSiteId ||
                            req.site_code === activeSiteObj.code;
        if (!matchesSite) return false;
      }

      // 2. Status filter
      if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;

      // 3. Priority filter
      if (priorityFilter !== 'ALL' && req.priority !== priorityFilter) return false;

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const num = String(req.request_number || '').toLowerCase();
        const pn = String(req.part_number || '').toLowerCase();
        const desc = String(req.part_description || '').toLowerCase();
        const user = String(req.requested_by_name || '').toLowerCase();
        const reason = String(req.reason || '').toLowerCase();
        return num.includes(q) || pn.includes(q) || desc.includes(q) || user.includes(q) || reason.includes(q);
      }

      return true;
    });
  }, [partsRequests, isSuperadmin, currentUser, userSiteObj, selectedSiteId, activeSiteObj, statusFilter, priorityFilter, searchQuery]);

  // KPI Metrics Calculation
  const metrics = useMemo(() => {
    const relevant = isSuperadmin
      ? (selectedSiteId && selectedSiteId !== 'ALL'
          ? partsRequests.filter(r => r.site_id === selectedSiteId || r.site_code === activeSiteObj.code)
          : partsRequests)
      : partsRequests.filter(r => r.site_id === currentUser?.siteId || r.site_code === userSiteObj.code);

    const pending = relevant.filter(r => r.status === 'pending').length;
    const approved = relevant.filter(r => r.status === 'approved').length;
    const fulfilled = relevant.filter(r => r.status === 'fulfilled' || r.status === 'partially_fulfilled').length;
    const totalOnHands = siteStockData.totalInStock || 0;

    return { pending, approved, fulfilled, totalOnHands, totalRequests: relevant.length };
  }, [partsRequests, isSuperadmin, selectedSiteId, activeSiteObj, currentUser, userSiteObj, siteStockData]);

  // Combined Universal Apple Parts Catalog (Default Catalog + Context Catalog)
  const masterPartsCatalog = useMemo(() => {
    const map = new Map();
    (defaultPartsCatalog || []).forEach(p => {
      if (p?.part_number) map.set(p.part_number.trim().toUpperCase(), p);
    });
    (parts || []).forEach(p => {
      if (p?.part_number) {
        const key = p.part_number.trim().toUpperCase();
        const existing = map.get(key);
        map.set(key, { ...existing, ...p });
      }
    });
    return Array.from(map.values());
  }, [parts]);

  // Central DC Stock summary for parts availability reference
  const dcStockSummary = useMemo(() => {
    const dcStock = (typeof getStockOnHandForSite === 'function')
      ? (getStockOnHandForSite('site-dc') || getStockOnHandForSite('DC-MDC') || {})
      : {};
    return dcStock?.partsSummary || {};
  }, [getStockOnHandForSite]);

  // Restricted Catalog for Replenishment Requests (Strictly iPhone 13+ Displays & Batteries)
  const requestEligibleCatalog = useMemo(() => {
    return masterPartsCatalog.filter(p => isDisplayOrBatteryForIPhone13Plus(p));
  }, [masterPartsCatalog]);

  // Helper to filter eligible parts for each request row based on search query, category, and model
  const getMatchingPartsForRow = (searchTerm) => {
    let list = requestEligibleCatalog;

    // 1. Category Filter: 'ALL' | 'display' | 'battery'
    if (formCategoryFilter === 'display') {
      list = list.filter(p => {
        const cat = String(p.category_id || p.category || '').toLowerCase();
        const desc = String(p.description || '').toLowerCase();
        return cat.includes('display') || desc.includes('display');
      });
    } else if (formCategoryFilter === 'battery') {
      list = list.filter(p => {
        const cat = String(p.category_id || p.category || '').toLowerCase();
        const desc = String(p.description || '').toLowerCase();
        return cat.includes('battery') || desc.includes('battery');
      });
    }

    // 2. iPhone Model Filter: 'ALL' | '17' | '16' | '15' | '14' | '13'
    if (formModelFilter !== 'ALL') {
      list = list.filter(p => {
        const model = String(p.iphone_model || p.model || p.description || '').toLowerCase();
        return model.includes(`iphone ${formModelFilter.toLowerCase()}`);
      });
    }

    // 3. Search Query Filter
    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(p =>
        p.part_number?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.iphone_model?.toLowerCase().includes(q)
      );
    }

    return list.slice(0, 100);
  };

  // Open Form with Pre-selected Part from Stock View (Appends or increments in multi-part request)
  const handleQuickRequestPart = (partNumber, sourceSiteName = null) => {
    if (isSuperadmin) {
      showToast('Superadmins cannot request parts. Only PMG branch users can request parts.', 'info');
      return;
    }

    const partObj = masterPartsCatalog.find(p => p.part_number?.toUpperCase() === partNumber?.toUpperCase());
    if (partObj && !isDisplayOrBatteryForIPhone13Plus(partObj)) {
      showToast('Parts replenishment is restricted strictly to Displays and Batteries for iPhone 13 and newer.', 'warning');
      return;
    }

    const partSearchText = partObj ? `${partObj.part_number} — ${partObj.description}` : partNumber;

    setRequestRows(prev => {
      const existingIdx = prev.findIndex(r => r.partNumber?.toUpperCase() === partNumber?.toUpperCase());
      if (existingIdx >= 0) {
        return prev.map((r, i) => i === existingIdx ? { ...r, quantity: r.quantity + 1 } : r);
      }
      if (prev.length === 1 && !prev[0].partNumber) {
        return [{ ...prev[0], partNumber, partSearch: partSearchText, quantity: 1, showDropdown: false }];
      }
      return [
        ...prev,
        {
          id: `req-row-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          partNumber,
          partSearch: partSearchText,
          quantity: 1,
          showDropdown: false
        }
      ];
    });

    if (sourceSiteName) {
      setFormNotes(prev => prev ? `${prev} | Transfer from ${sourceSiteName}` : `Stock transfer requested from ${sourceSiteName}`);
    }
    setIsFormOpen(true);
    setActiveTab('requests_table');
  };

  // Submit Multi-Part Replenishment Request Handler
  const handleSubmitNewRequest = async (e) => {
    e.preventDefault();
    if (isSuperadmin) {
      showToast('Superadmin accounts cannot submit replenishment requests. Only PMG branch users can request parts.', 'error');
      return;
    }

    const selectedRows = requestRows.filter(r => r.partNumber?.trim());
    if (selectedRows.length === 0) {
      showToast('Please select at least one Apple Part to request.', 'error');
      return;
    }

    // Verify all selected parts are in-scope (iPhone 13+ Displays & Batteries)
    for (const r of selectedRows) {
      const partObj = masterPartsCatalog.find(p => p.part_number?.toUpperCase() === r.partNumber.toUpperCase());
      if (!isDisplayOrBatteryForIPhone13Plus(partObj || { part_number: r.partNumber, description: r.partSearch })) {
        showToast(`Request blocked: "${r.partNumber}" is not an authorized iPhone 13+ Display or Battery.`, 'error');
        return;
      }
    }

    const items = selectedRows.map(r => {
      const partObj = masterPartsCatalog.find(p => p.part_number?.toUpperCase() === r.partNumber.toUpperCase()) || {
        id: `part-${r.partNumber.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
        part_number: r.partNumber.toUpperCase(),
        description: r.partSearch.includes('—') ? r.partSearch.split('—')[1].trim() : 'Apple Replacement Part'
      };
      return {
        partId: partObj.id,
        partNumber: partObj.part_number,
        description: partObj.description,
        quantity: Math.max(1, parseInt(r.quantity, 10) || 1)
      };
    });

    setIsSubmitting(true);
    try {
      const submitFn = typeof submitBatchPartsRequests === 'function' ? submitBatchPartsRequests : submitPartsRequest;
      const res = await submitFn({
        siteId: currentUser?.siteId || selectedSiteId,
        items,
        priority: formPriority,
        reason: formReason,
        notes: formNotes
      });

      if (res && res.success) {
        setIsFormOpen(false);
        setRequestRows([{
          id: `req-row-init-${Date.now()}`,
          partNumber: '',
          partSearch: '',
          quantity: 1,
          showDropdown: false
        }]);
        setFormPriority('normal');
        setFormNotes('');
        setFormReason(REASON_PRESETS[0]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status Action Modal Handler (Superadmin Approval / Rejection)
  const openActionModal = (request, status) => {
    setActionModalRequest(request);
    setActionTargetStatus(status);
    setActionNotes(request.notes || '');
    setActionQtyFulfilled(request.quantity_requested || 1);
  };

  const handleExecuteStatusAction = async () => {
    if (!actionModalRequest || !actionTargetStatus) return;
    const res = await updatePartsRequestStatus(actionModalRequest.id, {
      status: actionTargetStatus,
      quantityFulfilled: actionTargetStatus === 'fulfilled' ? actionQtyFulfilled : undefined,
      notes: actionNotes
    });
    if (res && res.success) {
      setActionModalRequest(null);
    }
  };

  // Export Table to XLSX
  const handleExportRequestsToXlsx = () => {
    if (filteredRequests.length === 0) {
      showToast('No requests available to export', 'warning');
      return;
    }

    const rows = filteredRequests.map(r => ({
      'Request Number': r.request_number,
      'Date Created': new Date(r.created_at).toLocaleDateString(),
      'Site Code': r.site_code || activeSiteObj.code,
      'Site Name': r.site_name || activeSiteObj.name,
      'Part Number': r.part_number,
      'Description': r.part_description,
      'Quantity Requested': r.quantity_requested,
      'Quantity Fulfilled': r.quantity_fulfilled || 0,
      'Priority': String(r.priority || 'normal').toUpperCase(),
      'Status': String(r.status || 'pending').toUpperCase(),
      'Requested By': r.requested_by_name,
      'Reason': r.reason,
      'Notes': r.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Parts Requests');
    const fileName = `Parts_Requests_${activeSiteObj.code || 'MDC'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Exported ${rows.length} request records to ${fileName}`, 'success');
  };

  const handleExportStockOnHandToXlsx = () => {
    if (stockRows.length === 0) {
      showToast?.('No stock records to export for this branch', 'warning');
      return;
    }

    const rows = stockRows.map(r => ({
      'Branch Site': `${activeSiteObj.name} (${activeSiteObj.code})`,
      'Part Number': r.partNumber,
      'Description': r.description,
      'Compatible Model': r.model,
      'Category': r.category || 'General',
      'Available On-Hand Stock': r.inStock || 0,
      'Allocated Units': r.allocated || 0,
      'In-Transit / Packed Units': r.packed || 0
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Branch Stock');
    const fileName = `Branch_Stock_${activeSiteObj.code || 'MDC'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast?.(`Exported ${rows.length} stock items to ${fileName}`, 'success');
  };

  // Available In-Stock serial numbers for the selected part in Mark as Used modal
  const availableSerialsForMarkUsed = useMemo(() => {
    if (!markUsedPartPn) return [];
    const targetSiteId = isSuperadmin && selectedSiteId !== 'ALL' ? selectedSiteId : (currentUser?.siteId || userSiteObj.id);
    const targetSiteCode = userSiteObj.code;

    return (inventoryUnits || []).filter(u => {
      const cleanPN = String(u.part_number || u.partNumber || '').trim().toUpperCase();
      if (cleanPN !== markUsedPartPn.toUpperCase()) return false;
      if (String(u.status || 'in_stock').toLowerCase() !== 'in_stock') return false;

      const uSiteId = u.current_site_id || u.siteId;
      const uSiteCode = u.site_code || u.siteCode;
      return (uSiteId && (uSiteId === targetSiteId || uSiteId === targetSiteCode)) ||
             (uSiteCode && (uSiteCode === targetSiteCode || uSiteCode === targetSiteId));
    });
  }, [inventoryUnits, markUsedPartPn, isSuperadmin, selectedSiteId, currentUser, userSiteObj]);

  // Available or searched serials based on the search/paste bar input
  const displayedSerials = useMemo(() => {
    const rawTokens = (serialSearchFilter || '')
      .split(/[\s,;\n\r]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (rawTokens.length === 0) {
      // Empty search bar: show all available in-stock branch serials
      return availableSerialsForMarkUsed.map(u => ({
        serial_number: String(u.serial_number || '').trim().toUpperCase(),
        box_number: u.box_number || 1,
        inStock: true,
        source: 'branch_stock'
      }));
    }

    // User entered or pasted token(s)
    const results = [];
    const seen = new Set();

    // 1. Search in branch in-stock units
    availableSerialsForMarkUsed.forEach(u => {
      const sn = String(u.serial_number || '').trim().toUpperCase();
      const isMatch = rawTokens.some(t => sn.includes(t));
      if (isMatch) {
        results.push({
          serial_number: sn,
          box_number: u.box_number || 1,
          inStock: true,
          source: 'branch_stock'
        });
        seen.add(sn);
      }
    });

    // 2. If user pasted specific serial numbers not currently in branch list
    rawTokens.forEach(token => {
      if (!seen.has(token) && token.length >= 3) {
        results.push({
          serial_number: token,
          box_number: 1,
          inStock: false,
          source: 'pasted_manual'
        });
        seen.add(token);
      }
    });

    return results;
  }, [availableSerialsForMarkUsed, serialSearchFilter]);

  const handleToggleMarkUsedSerial = (serial) => {
    const clean = String(serial || '').trim().toUpperCase();
    if (!clean) return;
    setMarkUsedSerials(prev =>
      prev.includes(clean) ? prev.filter(s => s !== clean) : [...prev, clean]
    );
  };

  const handleSelectAllDisplayedSerials = () => {
    const all = displayedSerials
      .map(u => String(u.serial_number || '').trim().toUpperCase())
      .filter(Boolean);
    setMarkUsedSerials(prev => Array.from(new Set([...prev, ...all])));
  };

  const handleDeselectAllSerials = () => {
    setMarkUsedSerials([]);
  };

  const handlePasteInSearchBar = (e) => {
    const pastedText = e.clipboardData?.getData('text') || '';
    if (!pastedText.trim()) return;

    const tokens = pastedText
      .split(/[\s,;\n\r]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

    if (tokens.length > 0) {
      // Automatically check the pasted serial(s) so user sees them checked immediately
      setMarkUsedSerials(prev => Array.from(new Set([...prev, ...tokens])));
    }
  };

  // Open Mark as Used Modal
  const openMarkUsedModal = (partNumber = '', prefillSerial = '') => {
    setMarkUsedPartPn(partNumber);
    setMarkUsedSerials(prefillSerial ? [String(prefillSerial).trim().toUpperCase()] : []);
    setSerialSearchFilter('');
    setMarkUsedWorkOrder('');
    setMarkUsedNotes('');
    setIsMarkUsedModalOpen(true);
  };

  // Submit Mark as Used Action (Batch supported)
  const handleConfirmMarkAsUsed = async (e) => {
    if (e) e.preventDefault();

    let serialsToProcess = [...markUsedSerials];
    if (serialsToProcess.length === 0 && serialSearchFilter.trim()) {
      const tokens = serialSearchFilter
        .split(/[\s,;\n\r]+/)
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      if (tokens.length > 0) {
        serialsToProcess = tokens;
      }
    }

    if (serialsToProcess.length === 0) {
      showToast('Please paste, search, or check at least one serial number to consume.', 'error');
      return;
    }

    setIsSubmittingMarkUsed(true);
    let successCount = 0;
    const errors = [];

    try {
      const siteId = userSiteObj?.id || currentUser?.siteId;
      for (const sn of serialsToProcess) {
        try {
          const res = await markUnitAsUsed({
            serialNumber: sn,
            partNumber: markUsedPartPn,
            siteId,
            workOrderNumber: markUsedWorkOrder,
            notes: markUsedNotes
          });
          if (res && res.success !== false) {
            successCount++;
          } else if (res && res.error) {
            errors.push(`${sn}: ${res.error}`);
          }
        } catch (err) {
          errors.push(`${sn}: ${err.message || 'Failed'}`);
        }
      }

      if (successCount > 0) {
        if (serialsToProcess.length > 1) {
          showToast(`Successfully recorded ${successCount} parts as USED in repair order ${markUsedWorkOrder || 'N/A'}.`, 'success');
        }
        setIsMarkUsedModalOpen(false);
        setMarkUsedSerials([]);
        setSerialSearchFilter('');
        setMarkUsedWorkOrder('');
        setMarkUsedNotes('');
      } else if (errors.length > 0) {
        showToast(`Failed to record: ${errors.join('; ')}`, 'error');
      }
    } finally {
      setIsSubmittingMarkUsed(false);
    }
  };

  // Live Used Units Log (status === 'used')
  const liveUsedUnitsLog = useMemo(() => {
    const siteFilter = selectedSiteId === 'ALL' && isSuperadmin ? 'ALL' : (selectedSiteId || userSiteObj.id || currentUser?.siteId);
    const units = typeof getUsedUnitsLog === 'function' ? getUsedUnitsLog(siteFilter) : [];
    if (!usedLogSearchQuery.trim()) return units;
    const q = usedLogSearchQuery.toLowerCase().trim();
    return units.filter(u => {
      const pn = String(u.part_number || '').toLowerCase();
      const desc = String(u.description || '').toLowerCase();
      const sn = String(u.serial_number || '').toLowerCase();
      const wo = String(u.work_order_number || '').toLowerCase();
      const tech = String(u.used_by_name || u.used_by || '').toLowerCase();
      const notes = String(u.usage_notes || u.notes || '').toLowerCase();
      return pn.includes(q) || desc.includes(q) || sn.includes(q) || wo.includes(q) || tech.includes(q) || notes.includes(q);
    });
  }, [getUsedUnitsLog, selectedSiteId, isSuperadmin, userSiteObj, currentUser, usedLogSearchQuery]);

  // Export Live Used Log to Excel
  const handleExportLiveUsedLogToXlsx = () => {
    if (liveUsedUnitsLog.length === 0) {
      showToast('No used parts records found to export.', 'warning');
      return;
    }
    const rows = liveUsedUnitsLog.map((u, idx) => ({
      '#': idx + 1,
      'Site Location': u.site_code || u.site_name || resolveSite(u.current_site_id || u.site_id || u.siteId, sites)?.code || activeSiteObj?.code || 'BRANCH',
      'Part Number': u.part_number,
      'Description': u.description || 'Apple Replacement Part',
      'Serial Number': u.serial_number,
      'Work Order #': u.work_order_number || 'N/A',
      'Used By (Technician)': u.used_by_name || u.used_by || 'Branch Specialist',
      'Used Date': u.used_at ? new Date(u.used_at).toLocaleDateString() : 'N/A',
      'Used Time': u.used_at ? formatTo12HourTime(u.used_at) : 'N/A',
      'Usage Notes': u.usage_notes || u.notes || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Used Parts Log');
    const fileName = `Used_Parts_Log_${activeSiteObj.code || 'BRANCH'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Exported ${rows.length} used parts records to ${fileName}`, 'success');
  };

  // Map of active parts in the parts master catalog
  const activeCatalogPartsMap = useMemo(() => {
    const map = new Map();
    (parts || []).forEach(p => {
      const pn = String(p.part_number || '').trim().toUpperCase();
      if (pn && p.is_active !== false && p.status !== 'inactive') {
        map.set(pn, p);
      }
    });
    return map;
  }, [parts]);

  // Stock on Hand Table Filtered Rows (Active catalog parts with in-stock inventory only)
  const stockRows = (() => {
    const items = Object.values(siteStockData.partsSummary || {});
    return items.map(it => {
      const pnClean = String(it.partNumber || '').trim().toUpperCase();
      const catalogPart = activeCatalogPartsMap.get(pnClean);
      const cleanModel = resolveCanonicalIPhoneModel(
        it.model || catalogPart?.iphone_model,
        it.description || catalogPart?.description
      );
      return {
        ...it,
        model: cleanModel
      };
    }).filter(it => {
      const pnClean = String(it.partNumber || '').trim().toUpperCase();

      // 1. MUST be an active part in the system's parts master catalog
      const catalogPart = activeCatalogPartsMap.get(pnClean);
      if (!catalogPart) return false;

      // 2. Strict In-Stock check: If out of stock, do NOT display on the page
      if ((it.inStock || 0) <= 0) return false;

      // 3. Category Filter
      if (stockCategoryFilter !== 'ALL') {
        const itemCat = String(it.category || '').toUpperCase();
        if (stockCategoryFilter === 'DISPLAY' && !itemCat.includes('DISP')) return false;
        if (stockCategoryFilter === 'BATTERY' && !itemCat.includes('BATT')) return false;
        if (stockCategoryFilter === 'OTHER' && (itemCat.includes('DISP') || itemCat.includes('BATT'))) return false;
      }

      // 4. Device Filter
      if (stockDeviceFilter !== 'ALL') {
        if (it.model !== stockDeviceFilter) return false;
      }

      // 5. Search Query Filter
      if (stockSearchQuery.trim()) {
        const q = stockSearchQuery.toLowerCase().trim();
        const qClean = q.replace(/[^a-z0-9]/gi, '');
        const pn = (it.partNumber || '').toLowerCase();
        const pnClean = pn.replace(/[^a-z0-9]/gi, '');
        const desc = (it.description || '').toLowerCase();
        const model = (it.model || '').toLowerCase();

        const directMatch = pn.includes(q) || desc.includes(q) || model.includes(q) || (qClean && qClean.length >= 3 && pnClean.includes(qClean));
        if (directMatch) return true;

        // Also check if any unit of this SKU matches the serial search
        if (qClean && qClean.length >= 3) {
          const hasMatchingUnit = (siteStockData.units || []).some(u => {
            const upn = String(u.part_number || u.partNumber || '').trim().toUpperCase();
            if (upn !== pnClean) return false;
            const sn = String(u.serial_number || u.serialNumber || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
            return sn.includes(qClean);
          });
          if (hasMatchingUnit) return true;
        }

        return false;
      }
      return true;
    }).sort((a, b) => (b.inStock || 0) - (a.inStock || 0) || a.partNumber.localeCompare(b.partNumber));
  })();

  // Category counts for active in-stock parts only
  const stockCategoryCounts = useMemo(() => {
    const all = Object.values(siteStockData.partsSummary || {}).filter(it => {
      const pnClean = String(it.partNumber || '').trim().toUpperCase();
      const catalogPart = activeCatalogPartsMap.get(pnClean);
      if (!catalogPart) return false;
      return (it.inStock || 0) > 0;
    });

    let displays = 0;
    let batteries = 0;
    let other = 0;

    all.forEach(item => {
      const cat = String(item.category || '').toUpperCase();
      if (cat.includes('DISP')) displays++;
      else if (cat.includes('BATT')) batteries++;
      else other++;
    });

    return {
      total: all.length,
      displays,
      batteries,
      other,
      inStock: all.length,
      outOfStock: 0
    };
  }, [siteStockData, activeCatalogPartsMap]);

  // Available unique device models in current site stock (active in-stock parts only)
  const allStockDeviceModels = useMemo(() => {
    const set = new Set();
    Object.values(siteStockData.partsSummary || {}).forEach(it => {
      const pnClean = String(it.partNumber || '').trim().toUpperCase();
      const catalogPart = activeCatalogPartsMap.get(pnClean);
      if (!catalogPart) return;
      if ((it.inStock || 0) <= 0) return;
      const m = resolveCanonicalIPhoneModel(it.model || catalogPart.iphone_model, it.description || catalogPart.description);
      if (m) set.add(m);
    });

    const getModelSortWeight = (name) => {
      const m = name.toLowerCase();
      const numMatch = m.match(/iphone\s*(\d+)/i);
      const num = numMatch ? parseInt(numMatch[1], 10) : (m.includes('iphone') ? 990 : 1000);
      let subWeight = 0;
      if (m.includes('mini')) subWeight = 1;
      else if (m.includes('plus')) subWeight = 2;
      else if (m.includes('pro max')) subWeight = 4;
      else if (m.includes('pro')) subWeight = 3;
      else if (m.includes('air')) subWeight = 5;
      else if (m.includes('ultra')) subWeight = 6;

      if (m.includes('universal') || m.includes('other')) return 9999;
      // Standalone "iPhone Air" without a generation number belongs to iPhone 17 era (175)
      if (m.includes('air') && !numMatch) return 175;
      return num * 10 + subWeight;
    };

    return Array.from(set).sort((a, b) => {
      const wA = getModelSortWeight(a);
      const wB = getModelSortWeight(b);
      if (wA !== wB) return wA - wB;
      return a.localeCompare(b);
    });
  }, [siteStockData, activeCatalogPartsMap]);

  // Group stock rows by device model (for organized Model page view)
  const groupedStockByDevice = useMemo(() => {
    const groups = {};

    const filteredRows = stockDeviceFilter === 'ALL'
      ? stockRows
      : stockRows.filter(r => (r.model || 'Universal / Multi-Model') === stockDeviceFilter);

    filteredRows.forEach(row => {
      const model = (row.model || 'Universal / Multi-Model').trim();
      if (!groups[model]) {
        groups[model] = {
          model,
          rows: [],
          totalInStock: 0,
          totalAllocated: 0,
          totalPacked: 0
        };
      }
      groups[model].rows.push(row);
      groups[model].totalInStock += (row.inStock || 0);
      groups[model].totalAllocated += (row.allocated || 0);
      groups[model].totalPacked += (row.packed || 0);
    });

    const getModelSortWeight = (name) => {
      const m = name.toLowerCase();
      const numMatch = m.match(/iphone\s*(\d+)/i);
      const num = numMatch ? parseInt(numMatch[1], 10) : (m.includes('iphone') ? 990 : 1000);
      let subWeight = 0;
      if (m.includes('mini')) subWeight = 1;
      else if (m.includes('plus')) subWeight = 2;
      else if (m.includes('pro max')) subWeight = 4;
      else if (m.includes('pro')) subWeight = 3;
      else if (m.includes('air')) subWeight = 5;
      else if (m.includes('ultra')) subWeight = 6;

      if (m.includes('universal') || m.includes('other')) return 9999;
      // Standalone "iPhone Air" without a generation number belongs to iPhone 17 era (175)
      if (m.includes('air') && !numMatch) return 175;
      return num * 10 + subWeight;
    };

    const sortedGroups = Object.values(groups).sort((a, b) => {
      const wA = getModelSortWeight(a.model);
      const wB = getModelSortWeight(b.model);
      if (wA !== wB) return wA - wB;
      return a.model.localeCompare(b.model);
    });

    sortedGroups.forEach(g => {
      g.rows.sort((a, b) => {
        const catA = String(a.category || '').toUpperCase();
        const catB = String(b.category || '').toUpperCase();
        if (catA !== catB) return catA.localeCompare(catB);
        return (b.inStock || 0) - (a.inStock || 0) || a.partNumber.localeCompare(b.partNumber);
      });
    });

    return sortedGroups;
  }, [stockRows, stockDeviceFilter]);

  const toggleDeviceCollapse = (modelName) => {
    setCollapsedDevices(prev => ({
      ...prev,
      [modelName]: !prev[modelName]
    }));
  };

  const expandAllDevices = () => {
    setCollapsedDevices({});
  };

  const collapseAllDevices = () => {
    const next = {};
    groupedStockByDevice.forEach(g => {
      next[g.model] = true;
    });
    setCollapsedDevices(next);
  };

  // Regional Site Classification (Metro Manila vs Provincial vs DC)
  const { metroManilaSites, provincialSites } = useMemo(() => {
    const mm = [];
    const prov = [];
    (sites || []).forEach(s => {
      if (s.is_dc || s.code === 'DC-MDC' || s.code === 'DC' || s.id === 'site-dc') {
        return;
      } else if (isProvincialSite(s)) {
        prov.push(s);
      } else {
        mm.push(s);
      }
    });
    return { metroManilaSites: mm, provincialSites: prov };
  }, [sites]);

  // Calculate Region Stock Totals (Branch ASPs only)
  const regionStockTotals = useMemo(() => {
    let mmUnits = 0;
    let provUnits = 0;
    (multiSiteStockData || []).forEach(summary => {
      const s = sites.find(x => x.id === summary.siteId || x.code === summary.siteCode);
      if (s?.is_dc || s?.code === 'DC-MDC' || s?.code === 'DC' || summary.siteId === 'site-dc') {
        return;
      } else if (isProvincialSite(s)) {
        provUnits += (summary.totalInStock || 0);
      } else {
        mmUnits += (summary.totalInStock || 0);
      }
    });
    return { mmUnits, provUnits, dcUnits: 0 };
  }, [multiSiteStockData, sites]);

  // Current sites list for the active region tab (Branch ASPs only)
  const currentRegionSites = useMemo(() => {
    if (allStocksRegionTab === 'provincial') return provincialSites;
    return metroManilaSites;
  }, [allStocksRegionTab, metroManilaSites, provincialSites]);

  // Effective selected site in All Stocks view (Branch ASPs only, never Central DC)
  const currentActiveMultiSite = useMemo(() => {
    if (allStocksSelectedSiteId && allStocksSelectedSiteId !== 'site-dc' && allStocksSelectedSiteId !== 'DC-MDC') {
      const match = currentRegionSites.find(s => s.id === allStocksSelectedSiteId || s.code === allStocksSelectedSiteId);
      if (match) return match;
    }
    const ownInRegion = currentRegionSites.find(s => s.id === currentUser?.siteId || s.code === userSiteObj?.code);
    return ownInRegion || currentRegionSites[0] || null;
  }, [allStocksSelectedSiteId, currentRegionSites, currentUser?.siteId, userSiteObj?.code]);

  // Full Stock summary for currentActiveMultiSite
  const currentActiveMultiSiteStock = useMemo(() => {
    if (!currentActiveMultiSite) return null;
    const summary = (multiSiteStockData || []).find(
      s => s.siteId === currentActiveMultiSite.id || s.siteCode === currentActiveMultiSite.code
    );
    return summary || {
      siteId: currentActiveMultiSite.id,
      siteCode: currentActiveMultiSite.code,
      siteName: currentActiveMultiSite.name,
      totalInStock: 0,
      parts: []
    };
  }, [currentActiveMultiSite, multiSiteStockData]);

  // Filtered parts table rows for the selected site
  const activeSiteStockRows = useMemo(() => {
    if (!currentActiveMultiSiteStock) return [];
    let partsList = currentActiveMultiSiteStock.parts || [];
    if (allStocksSearchQuery.trim()) {
      const q = allStocksSearchQuery.toLowerCase().trim();
      partsList = partsList.filter(p =>
        p.partNumber?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.model?.toLowerCase().includes(q)
      );
    }
    return partsList;
  }, [currentActiveMultiSiteStock, allStocksSearchQuery]);

  // Serial Number Location Tracker across network for Superadmins / Admins
  const allStocksSerialSearchResults = useMemo(() => {
    const q = allStocksSearchQuery?.trim();
    if (!q || q.length < 3) return [];

    const resolvedSerials = searchSerialsWithFullDetails(q, {
      inventoryUnits,
      shipments,
      repairUsageRecords,
      sites,
      parts
    }, 12);

    return resolvedSerials.filter(sd => {
      if (isSuperadmin || isAdmin) return true;
      return (
        sd.siteId === currentUser?.siteId ||
        sd.siteCode === userSiteObj?.code ||
        sd.linkedShipment?.site_id === currentUser?.siteId ||
        sd.linkedShipment?.site_code === userSiteObj?.code
      );
    });
  }, [allStocksSearchQuery, inventoryUnits, shipments, repairUsageRecords, sites, parts, isSuperadmin, isAdmin, currentUser, userSiteObj]);

  // Network-wide availability search results across ALL branches
  const networkPartSearchResults = useMemo(() => {
    if (!allStocksSearchQuery.trim()) return null;
    const q = allStocksSearchQuery.toLowerCase().trim();
    const matches = [];

    (multiSiteStockData || []).forEach(summary => {
      const siteObj = sites.find(s => s.id === summary.siteId || s.code === summary.siteCode) || {};
      const isProv = isProvincialSite(siteObj);
      const isDc = siteObj.is_dc || siteObj.code === 'DC-MDC' || siteObj.code === 'DC' || summary.siteId === 'site-dc' || summary.siteCode === 'DC-MDC' || summary.siteCode === 'DC';
      // Central DC stocks are strictly excluded from All Stocks network search
      if (isDc) return;
      const regionLabel = isProv ? 'Provincial' : 'Metro Manila';
      const regionKey = isProv ? 'provincial' : 'metro_manila';

      (summary.parts || []).forEach(partItem => {
        const isMatch = partItem.partNumber?.toLowerCase().includes(q) ||
                        partItem.description?.toLowerCase().includes(q) ||
                        partItem.model?.toLowerCase().includes(q);
        if (isMatch && partItem.inStock > 0) {
          matches.push({
            siteId: summary.siteId,
            siteCode: summary.siteCode,
            siteName: summary.siteName,
            regionKey,
            regionLabel,
            isProv,
            isDc: false,
            isOwnSite: summary.isOwnSite,
            partNumber: partItem.partNumber,
            description: partItem.description,
            model: partItem.model,
            inStock: partItem.inStock
          });
        }
      });
    });

    return matches.sort((a, b) => b.inStock - a.inStock || a.siteCode.localeCompare(b.siteCode));
  }, [allStocksSearchQuery, multiSiteStockData, sites]);

  // Flattened Multi-Site Parts Rows for All Stocks Tab fallback/count
  const _flattenedAllStocksRows = useMemo(() => {
    const all = [];
    (multiSiteStockData || []).forEach(siteSummary => {
      const isDcSite = siteSummary.siteId === 'site-dc' || siteSummary.siteCode === 'DC-MDC' || siteSummary.siteCode === 'DC';
      // Central DC stocks are strictly excluded from All Stocks multi-site rows
      if (isDcSite) return;

      (siteSummary.parts || []).forEach(partItem => {
        if (allStocksSearchQuery.trim()) {
          const q = allStocksSearchQuery.toLowerCase().trim();
          const matches = partItem.partNumber.toLowerCase().includes(q) ||
                          partItem.description.toLowerCase().includes(q) ||
                          partItem.model.toLowerCase().includes(q) ||
                          siteSummary.siteName.toLowerCase().includes(q) ||
                          siteSummary.siteCode.toLowerCase().includes(q);
          if (!matches) return;
        }
        const isDc = isSuperadmin || currentUser?.siteId === 'site-dc' || userSiteObj?.code === 'DC-MDC' || userSiteObj?.code === 'DC';
        const isUserSameSite = !isDc && Boolean(
          currentUser?.siteId && (
            siteSummary.siteId === currentUser.siteId ||
            siteSummary.siteCode === currentUser.siteId ||
            siteSummary.siteCode === userSiteObj?.code ||
            siteSummary.siteId === userSiteObj?.id
          )
        );

        all.push({
          ...partItem,
          siteId: siteSummary.siteId,
          siteCode: siteSummary.siteCode,
          siteName: siteSummary.siteName,
          isOwnSite: siteSummary.isOwnSite,
          isUserSameSite
        });
      });
    });
    return all.sort((a, b) => b.inStock - a.inStock || a.siteCode.localeCompare(b.siteCode));
  }, [multiSiteStockData, allStocksSearchQuery, currentUser, userSiteObj, isSuperadmin]);

  // Dynamic header configuration based on active view and role
  const viewHeaderMeta = useMemo(() => {
    switch (activeTab) {
      case 'stock_on_hand':
        return {
          icon: Package,
          iconBg: '#eff6ff',
          iconColor: '#0284c7',
          title: 'Branch Stock On Hand',
          subtitle: `Live physical inventory, verified serialized units, and arriving shipments for ${activeSiteObj.name || activeSiteObj.code}`,
          badgeText: activeSiteObj.name || activeSiteObj.code || 'Service Center',
          badgeIcon: Building2
        };
      case 'all_stocks':
        return {
          icon: Globe,
          iconBg: '#eef2ff',
          iconColor: '#4f46e5',
          title: 'All Stocks & Multi-Site Inventory',
          subtitle: 'Directory-wide stock visibility across all MobileCare Authorized Service Points',
          badgeText: 'Network Directory',
          badgeIcon: Globe
        };
      case 'usage_history':
        return {
          icon: Wrench,
          iconBg: '#ecfdf5',
          iconColor: '#059669',
          title: 'Parts Consumption Log',
          subtitle: `Serialized audit history of parts installed in repair work orders at ${activeSiteObj.name || activeSiteObj.code}`,
          badgeText: activeSiteObj.name || activeSiteObj.code || 'Service Center',
          badgeIcon: Building2
        };
      case 'requests_table':
      default:
        return {
          icon: Inbox,
          iconBg: '#eff6ff',
          iconColor: '#0284c7',
          title: isSuperadmin ? 'Branch Parts Requests & Replenishment Review' : 'Parts Requests & Replenishment',
          subtitle: isSuperadmin
            ? 'Master DC replenishment governance • Review, approve, and manage branch replenishment orders'
            : 'Request iPhone displays and batteries from Central DC, and monitor shipment fulfillment status',
          badgeText: activeSiteObj.name || activeSiteObj.code || 'Service Center',
          badgeIcon: Building2
        };
    }
  }, [activeTab, isSuperadmin, activeSiteObj]);

  // Dynamic KPI cards configuration tailored per view
  const kpiCards = useMemo(() => {
    switch (activeTab) {
      case 'stock_on_hand':
        return [
          {
            id: 'stock-units',
            label: 'Branch Stock On Hand',
            value: siteStockData.totalInStock,
            unit: 'units in stock',
            subtext: `${stockCategoryCounts.total} unique part numbers in stock`,
            icon: Package,
            accent: '#0284c7',
            iconBg: '#e0f2fe',
            iconColor: '#0284c7'
          },
          {
            id: 'stock-incoming',
            label: 'Incoming Shipments',
            value: incomingShipments.length,
            unit: 'manifests in-transit',
            subtext: `${incomingShipments.reduce((acc, s) => acc + (s.items?.length || 0), 0)} parts en route from DC`,
            icon: Truck,
            accent: '#f59e0b',
            iconBg: '#fef3c7',
            iconColor: '#d97706'
          },
          {
            id: 'stock-used',
            label: 'Parts Consumed',
            value: liveUsedUnitsLog.length,
            unit: 'lifetime units',
            subtext: 'Installed in customer repairs',
            icon: Wrench,
            accent: '#10b981',
            iconBg: '#dcfce7',
            iconColor: '#059669'
          },
          {
            id: 'stock-health',
            label: 'Stock Health',
            value: 'Verified',
            unit: 'active status',
            subtext: 'Granular serial tracking protected',
            icon: ShieldCheck,
            accent: '#8b5cf6',
            iconBg: '#ede9fe',
            iconColor: '#7c3aed'
          }
        ];
      case 'all_stocks':
        return [
          {
            id: 'all-network',
            label: 'Total Network Inventory',
            value: regionStockTotals.mmUnits + regionStockTotals.provUnits,
            unit: 'units across ASPs',
            subtext: 'Physical branch on-hand stock',
            icon: Globe,
            accent: '#0284c7',
            iconBg: '#e0f2fe',
            iconColor: '#0284c7'
          },
          {
            id: 'all-mm',
            label: 'Metro Manila ASPs',
            value: regionStockTotals.mmUnits,
            unit: 'units on-hand',
            subtext: `${metroManilaSites.length} Metro Manila service points`,
            icon: Building2,
            accent: '#3b82f6',
            iconBg: '#dbeafe',
            iconColor: '#2563eb'
          },
          {
            id: 'all-prov',
            label: 'Provincial ASPs',
            value: regionStockTotals.provUnits,
            unit: 'units on-hand',
            subtext: `${provincialSites.length} Provincial service points`,
            icon: MapPin,
            accent: '#f59e0b',
            iconBg: '#fef3c7',
            iconColor: '#d97706'
          }
        ];
      case 'usage_history': {
        const displayCount = liveUsedUnitsLog.filter(u =>
          (u.description || u.part_number || '').toLowerCase().includes('disp') ||
          (u.part_category || '').toLowerCase().includes('disp')
        ).length;
        const batteryCount = liveUsedUnitsLog.filter(u =>
          (u.description || u.part_number || '').toLowerCase().includes('batt') ||
          (u.part_category || '').toLowerCase().includes('batt')
        ).length;
        return [
          {
            id: 'usage-total',
            label: 'Total Consumed Units',
            value: liveUsedUnitsLog.length,
            unit: 'parts recorded',
            subtext: 'Serialized repair installations',
            icon: Wrench,
            accent: '#10b981',
            iconBg: '#dcfce7',
            iconColor: '#059669'
          },
          {
            id: 'usage-displays',
            label: 'Display Assemblies',
            value: displayCount,
            unit: 'screens consumed',
            subtext: 'Screen repair work orders',
            icon: Smartphone,
            accent: '#0284c7',
            iconBg: '#e0f2fe',
            iconColor: '#0284c7'
          },
          {
            id: 'usage-batteries',
            label: 'Batteries Consumed',
            value: batteryCount,
            unit: 'batteries consumed',
            subtext: 'Battery replacement work orders',
            icon: Zap,
            accent: '#f59e0b',
            iconBg: '#fef3c7',
            iconColor: '#d97706'
          },
          {
            id: 'usage-skus',
            label: 'Distinct Part Numbers',
            value: new Set(liveUsedUnitsLog.map(u => u.part_number).filter(Boolean)).size,
            unit: 'unique SKUs',
            subtext: 'Serviced display & battery models',
            icon: Boxes,
            accent: '#8b5cf6',
            iconBg: '#ede9fe',
            iconColor: '#7c3aed'
          }
        ];
      }
      case 'requests_table':
      default:
        return [
          {
            id: 'req-pending',
            label: 'Pending Review',
            value: metrics.pending,
            unit: 'open requests',
            subtext: isSuperadmin ? 'Requires Superadmin approval' : 'Awaiting DC Superadmin approval',
            icon: Clock,
            accent: '#f59e0b',
            iconBg: '#fef3c7',
            iconColor: '#d97706'
          },
          {
            id: 'req-approved',
            label: 'Approved & In-Packing',
            value: metrics.approved,
            unit: 'approved requests',
            subtext: 'Queued for DC dispatch batch',
            icon: ShieldCheck,
            accent: '#8b5cf6',
            iconBg: '#ede9fe',
            iconColor: '#7c3aed'
          },
          {
            id: 'req-fulfilled',
            label: 'Fulfilled Requests',
            value: metrics.fulfilled,
            unit: 'completed',
            subtext: 'Dispatched / Shipped to site',
            icon: CheckCircle2,
            accent: '#10b981',
            iconBg: '#dcfce7',
            iconColor: '#059669'
          },
          {
            id: 'req-branch-stock',
            label: 'Branch Stock On Hand',
            value: siteStockData.totalInStock,
            unit: 'units in stock',
            subtext: `${stockCategoryCounts.total} unique part numbers in stock`,
            icon: Package,
            accent: '#0284c7',
            iconBg: '#e0f2fe',
            iconColor: '#0284c7'
          }
        ];
    }
  }, [
    activeTab,
    metrics,
    siteStockData,
    stockCategoryCounts.total,
    incomingShipments,
    liveUsedUnitsLog,
    regionStockTotals,
    metroManilaSites.length,
    provincialSites.length,
    isSuperadmin
  ]);

  const HeaderIcon = viewHeaderMeta.icon;
  const BadgeIcon = viewHeaderMeta.badgeIcon;

  return (
    <div className="request-parts-container" style={{ maxWidth: '1360px', margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Header Hero Banner */}
      <div
        className="card"
        style={{
          marginBottom: '20px',
          background: '#ffffff',
          color: '#0f172a',
          padding: '20px 24px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: viewHeaderMeta.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: viewHeaderMeta.iconColor }}>
                <HeaderIcon size={20} />
              </div>
              <h2 style={{ color: '#0f172a', fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                {viewHeaderMeta.title}
              </h2>
              <span
                style={{
                  background: '#f0f9ff',
                  color: '#0284c7',
                  border: '1px solid #bae6fd',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <BadgeIcon size={13} />
                {viewHeaderMeta.badgeText}
              </span>
            </div>
            <p style={{ color: '#64748b', fontSize: '13px', margin: 0, lineHeight: 1.4 }}>
              {viewHeaderMeta.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Site Picker (Superadmin Only) */}
            {isSuperadmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Building2 size={14} color="#64748b" />
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Branch:</span>
                <select
                  className="form-select"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  style={{
                    background: '#ffffff',
                    color: '#0f172a',
                    borderColor: '#cbd5e1',
                    fontSize: '12.5px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    minWidth: '190px',
                    fontWeight: 600
                  }}
                >
                  <option value="ALL">All Branch Sites (Master DC)</option>
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sync / Refresh Button */}
            <button
              className="btn btn-secondary"
              style={{
                background: '#ffffff',
                color: '#334155',
                borderColor: '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                borderRadius: '6px'
              }}
              onClick={() => {
                if (autoRefreshData) {
                  autoRefreshData({
                    force: true,
                    silent: false,
                    isManual: true,
                    reason: 'All stocks multi-site live refresh',
                    tables: ['parts_requests', 'parts', 'inventory_units', 'saved_records']
                  });
                } else if (typeof fetchPartsRequests === 'function') {
                  fetchPartsRequests({ force: true });
                }
              }}
              disabled={isLoadingPartsRequests || isAutoRefreshing}
              title="Refresh live data from cloud database"
            >
              <RefreshCw size={14} className={isLoadingPartsRequests || isAutoRefreshing ? 'spin' : ''} />
              <span>{isLoadingPartsRequests ? 'Syncing…' : 'Sync'}</span>
            </button>

            {/* View-Specific Primary Actions */}
            {activeTab === 'requests_table' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportRequestsToXlsx}
                  style={{ background: '#ffffff', color: '#047857', borderColor: '#a7f3d0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600 }}
                  title="Export parts requests to Excel"
                >
                  <FileSpreadsheet size={14} color="#059669" />
                  <span>Export to Excel</span>
                </button>
                {!isSuperadmin && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setIsFormOpen(prev => !prev)}
                    style={{ background: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                  >
                    {isFormOpen ? <X size={16} /> : <Plus size={16} />}
                    <span>{isFormOpen ? 'Close Form' : 'New Request'}</span>
                  </button>
                )}
              </>
            )}

            {activeTab === 'stock_on_hand' && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleExportStockOnHandToXlsx}
                  style={{ background: '#ffffff', color: '#047857', borderColor: '#a7f3d0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, borderRadius: '6px' }}
                  title="Export current branch stock on hand to Excel"
                >
                  <FileSpreadsheet size={14} color="#059669" />
                  <span>Export Excel</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openMarkUsedModal()}
                  style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12.5px', borderRadius: '6px', boxShadow: '0 1px 2px rgba(5, 150, 105, 0.2)' }}
                  title="Record part consumed in customer repair"
                >
                  <Wrench size={14} />
                  <span>Record Part Used</span>
                </button>
                {isPmgUser && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      if (onNavigateToStation) {
                        onNavigateToStation();
                      } else if (setGlobalActiveTab) {
                        setGlobalActiveTab('scan-in');
                      }
                    }}
                    style={{ background: '#ffffff', color: '#0f172a', borderColor: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, borderRadius: '6px' }}
                    title="Open Receive Scan-In Station"
                  >
                    <Barcode size={14} />
                    <span>Receive Scan-In</span>
                  </button>
                )}
              </>
            )}

            {activeTab === 'usage_history' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openMarkUsedModal()}
                style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                title="Record part consumed in customer repair"
              >
                <Wrench size={14} />
                <span>Record Part Used</span>
              </button>
            )}

            {activeTab === 'all_stocks' && !isSuperadmin && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  handleTabChange('requests_table');
                  setIsFormOpen(true);
                }}
                style={{ background: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                title="Create a new parts replenishment requisition"
              >
                <Plus size={16} />
                <span>New Request</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Top Summary KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
          marginBottom: '20px'
        }}
      >
        {kpiCards.map(card => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              className="card"
              style={{
                padding: '16px 18px',
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '10px',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px -2px rgba(15, 23, 42, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.04)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {card.label}
                </span>
                <div style={{ padding: '6px', background: card.iconBg, color: card.iconColor, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={16} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                  {card.value}{' '}
                  <span style={{ fontSize: '12.5px', fontWeight: 500, color: '#64748b' }}>{card.unit}</span>
                </div>
                <div style={{ fontSize: '11.5px', color: card.iconColor, marginTop: '5px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: card.iconColor }} />
                  {card.subtext}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. New Parts Request Submission Form Modal / Collapsible Section (Strictly PMG Users) */}
      {!isSuperadmin && isFormOpen && (
        <div
          className="card"
          style={{
            marginBottom: '20px',
            border: '2px solid #0284c7',
            background: '#ffffff',
            boxShadow: '0 10px 25px -5px rgba(2, 132, 199, 0.1)',
            padding: '24px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Send size={18} color="#0284c7" />
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                Submit New Parts Replenishment Request to DC Superadmin
              </h3>
            </div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Requesting Branch: <strong>{activeSiteObj.name} ({activeSiteObj.code})</strong>
            </span>
          </div>

          <form onSubmit={handleSubmitNewRequest}>
            {/* Catalog Filter Controls: Restricted strictly to iPhone 13+ Displays & Batteries */}
            <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Filter size={13} color="#0284c7" />
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Authorized Replenishment Catalog: iPhone 13+ Displays &amp; Batteries Only
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Smartphone size={13} color="#64748b" />
                  <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Device Model:</span>
                  <select
                    className="form-select"
                    value={formModelFilter}
                    onChange={(e) => setFormModelFilter(e.target.value)}
                    style={{ fontSize: '11.5px', padding: '3px 8px', height: '28px', width: 'auto' }}
                  >
                    <option value="ALL">All Models (13+)</option>
                    <option value="17">iPhone 17 Series</option>
                    <option value="16">iPhone 16 Series</option>
                    <option value="15">iPhone 15 Series</option>
                    <option value="14">iPhone 14 Series</option>
                    <option value="13">iPhone 13 Series</option>
                  </select>
                </div>
              </div>

              {/* Category Pills (Displays & Batteries only) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {[
                  { id: 'ALL', label: 'All In-Scope (Displays & Batteries)' },
                  { id: 'display', label: 'Displays Only' },
                  { id: 'battery', label: 'Batteries Only' }
                ].map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setFormCategoryFilter(cat.id)}
                    style={{
                      cursor: 'pointer',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: formCategoryFilter === cat.id ? 700 : 500,
                      background: formCategoryFilter === cat.id ? '#0284c7' : '#ffffff',
                      color: formCategoryFilter === cat.id ? '#ffffff' : '#475569',
                      border: formCategoryFilter === cat.id ? '1px solid #0284c7' : '1px solid #cbd5e1',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Multi-Part Requested Line Items */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label className="form-label" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
                  Requested Parts Line Items ({requestRows.length})
                </label>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                  Add multiple displays or batteries in this single request submission
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {requestRows.map((row, index) => {
                  const selectedPart = row.partNumber
                    ? masterPartsCatalog.find(p => p.part_number?.toUpperCase() === row.partNumber.toUpperCase())
                    : null;
                  const matchingParts = getMatchingPartsForRow(row.partSearch);
                  const branchAvail = selectedPart ? (siteStockData.partsSummary[selectedPart.part_number]?.inStock || 0) : 0;
                  const dcAvail = selectedPart ? (dcStockSummary[selectedPart.part_number]?.inStock || 0) : 0;

                  return (
                    <div
                      key={row.id}
                      style={{
                        padding: '14px',
                        borderRadius: '8px',
                        border: selectedPart ? '1px solid #bae6fd' : '1px solid #e2e8f0',
                        background: selectedPart ? '#f0f9ff' : '#f8fafc',
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              background: '#0284c7',
                              color: '#ffffff',
                              fontSize: '11px',
                              fontWeight: 700,
                              borderRadius: '4px',
                              padding: '2px 8px'
                            }}
                          >
                            Part #{index + 1}
                          </span>
                          {selectedPart && (
                            <span className="badge badge-primary" style={{ fontSize: '11px' }}>
                              {selectedPart.iphone_model || 'iPhone'} • {selectedPart.part_number}
                            </span>
                          )}
                        </div>

                        {requestRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRequestRow(row.id)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              color: '#ef4444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '12px',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}
                            title="Remove this part row"
                          >
                            <Trash2 size={14} />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'start' }}>
                        {/* Searchable Part Dropdown */}
                        <div style={{ position: 'relative' }}>
                          <div style={{ position: 'relative' }}>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Search iPhone 13+ Display or Battery (e.g. 661-37213, iPhone 17 Battery)..."
                              value={row.partSearch}
                              onChange={(e) => {
                                updateRequestRow(row.id, {
                                  partSearch: e.target.value,
                                  showDropdown: true
                                });
                              }}
                              onFocus={() => updateRequestRow(row.id, { showDropdown: true })}
                              required
                            />
                            {row.partSearch && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateRequestRow(row.id, {
                                    partSearch: '',
                                    partNumber: '',
                                    showDropdown: false
                                  });
                                }}
                                style={{
                                  position: 'absolute',
                                  right: '8px',
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  color: '#94a3b8'
                                }}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>

                          {/* Dropdown Menu */}
                          {row.showDropdown && matchingParts.length > 0 && (
                            <div
                              style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                maxHeight: '250px',
                                overflowY: 'auto',
                                background: '#ffffff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15)',
                                zIndex: 60,
                                marginTop: '4px'
                              }}
                            >
                              <div style={{ padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                                <span>Showing <strong>{matchingParts.length}</strong> eligible Displays &amp; Batteries</span>
                                <span>Click part to select</span>
                              </div>
                              {matchingParts.map(p => {
                                const rowDcAvail = dcStockSummary[p.part_number]?.inStock || 0;
                                const rowBranchAvail = siteStockData.partsSummary[p.part_number]?.inStock || 0;
                                const isSelected = row.partNumber === p.part_number;

                                return (
                                  <div
                                    key={p.id || p.part_number}
                                    onClick={() => {
                                      updateRequestRow(row.id, {
                                        partNumber: p.part_number,
                                        partSearch: `${p.part_number} — ${p.description}`,
                                        showDropdown: false
                                      });
                                    }}
                                    style={{
                                      padding: '9px 12px',
                                      cursor: 'pointer',
                                      borderBottom: '1px solid #f1f5f9',
                                      transition: 'background 0.1s ease',
                                      background: isSelected ? '#f0f9ff' : '#ffffff'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? '#f0f9ff' : '#ffffff'}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                      <strong style={{ fontSize: '12.5px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>{p.part_number}</strong>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span className="badge" style={{ fontSize: '10px', background: '#f1f5f9' }}>{p.iphone_model || 'iPhone'}</span>
                                        <span
                                          className="badge"
                                          style={{
                                            fontSize: '10px',
                                            background: rowDcAvail > 0 ? '#dcfce7' : '#f1f5f9',
                                            color: rowDcAvail > 0 ? '#15803d' : '#64748b'
                                          }}
                                        >
                                          DC Stock: {rowDcAvail}
                                        </span>
                                      </div>
                                    </div>
                                    <div style={{ fontSize: '11.5px', color: '#334155', marginTop: '2px' }}>{p.description}</div>
                                    {rowBranchAvail > 0 && (
                                      <div style={{ fontSize: '10px', color: '#0369a1', marginTop: '2px' }}>
                                        Your Branch On-Hand: {rowBranchAvail} units
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Quantity Stepper */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '130px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontWeight: 700, height: '38px' }}
                            onClick={() => updateRequestRow(row.id, { quantity: Math.max(1, row.quantity - 1) })}
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            max="500"
                            className="form-input"
                            style={{ width: '56px', textAlign: 'center', fontWeight: 700, fontSize: '14px', height: '38px', padding: '4px' }}
                            value={row.quantity}
                            onChange={(e) => updateRequestRow(row.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                            required
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontWeight: 700, height: '38px' }}
                            onClick={() => updateRequestRow(row.id, { quantity: row.quantity + 1 })}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Selected Part Details pill bar */}
                      {selectedPart && (
                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '11px', color: '#475569', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ color: '#0f172a', fontWeight: 600 }}>{selectedPart.description}</span>
                          <span>•</span>
                          <span>Branch On-Hand: <strong>{branchAvail} units</strong></span>
                          <span>•</span>
                          <span style={{ color: dcAvail > 0 ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                            Central DC Stock: {dcAvail} units available
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Another Part Button */}
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => addRequestRow()}
                  className="btn btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    width: '100%',
                    justifyContent: 'center',
                    border: '1.5px dashed #0284c7',
                    background: '#f0f9ff',
                    color: '#0284c7',
                    fontWeight: 700,
                    padding: '10px',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                >
                  <Plus size={16} />
                  <span>+ Add Another Part to Request</span>
                </button>
              </div>
            </div>

            {/* Request Summary Banner */}
            {requestRows.some(r => r.partNumber) && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '18px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                    Request Batch Summary:
                  </span>
                  <span className="badge badge-primary" style={{ fontSize: '11px' }}>
                    {requestRows.filter(r => r.partNumber).length} distinct part{requestRows.filter(r => r.partNumber).length > 1 ? 's' : ''} • {requestRows.filter(r => r.partNumber).reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 1), 0)} total units
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {requestRows.filter(r => r.partNumber).map((r, i) => (
                    <span
                      key={r.id || i}
                      style={{
                        fontSize: '11.5px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: '#334155'
                      }}
                    >
                      <strong>{r.quantity}x</strong> {r.partSearch.includes('—') ? r.partSearch.split('—')[1].trim() : r.partNumber} ({r.partNumber})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Urgency Priority */}
            <div style={{ marginBottom: '16px' }}>
              <label className="form-label">Urgency Priority</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                {[
                  { id: 'normal', label: 'Normal', color: '#0284c7', bg: '#e0f2fe' },
                  { id: 'urgent', label: 'Urgent', color: '#d97706', bg: '#fef3c7' },
                  { id: 'critical', label: 'Critical', color: '#dc2626', bg: '#fee2e2' }
                ].map(prio => (
                  <button
                    key={prio.id}
                    type="button"
                    onClick={() => setFormPriority(prio.id)}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      border: formPriority === prio.id ? `2px solid ${prio.color}` : '1px solid #cbd5e1',
                      background: formPriority === prio.id ? prio.bg : '#ffffff',
                      color: formPriority === prio.id ? prio.color : '#475569',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    {prio.id === 'critical' && <Flame size={13} />}
                    {prio.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason & Additional Notes */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '18px' }}>
              <div className="form-group">
                <label className="form-label">Replenishment Reason</label>
                <select
                  className="form-select"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                >
                  {REASON_PRESETS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Notes / Work Order Reference (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Repair #R2026-4412, urgent customer waiting..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                />
              </div>
            </div>

            {/* Form Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsFormOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || requestRows.filter(r => r.partNumber).length === 0}
                style={{
                  background: '#0284c7',
                  minWidth: '180px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  justifyContent: 'center',
                  fontWeight: 700
                }}
              >
                {isSubmitting ? <RefreshCw size={15} className="spin" /> : <Send size={15} />}
                <span>
                  {isSubmitting
                    ? 'Submitting Request...'
                    : `Submit Request (${requestRows.filter(r => r.partNumber).reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 1), 0)} Units) to DC Superadmin`}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. TAB 1: Parts Requests List */}
      {activeTab === 'requests_table' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
          
          {/* Filters Bar */}
          <div style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '32px', fontSize: '12.5px', borderRadius: '8px' }}
                  placeholder="Filter requests by part #, requester, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Status Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Status:</span>
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '5px 10px', width: 'auto', borderRadius: '6px' }}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="fulfilled">Fulfilled</option>
                  <option value="partially_fulfilled">Partially Fulfilled</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              {/* Priority Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Priority:</span>
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '5px 10px', width: 'auto', borderRadius: '6px' }}
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="ALL">All Priorities</option>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              {/* Export to Excel Button */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportRequestsToXlsx}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px', borderRadius: '6px' }}
                title="Export filtered parts requests to Excel"
              >
                <FileSpreadsheet size={14} color="#059669" />
                <span>Export to Excel</span>
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredRequests.length === 0 ? (
              <div style={{ padding: '64px 24px', textAlign: 'center', background: '#fafbfc' }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: '#f1f5f9',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94a3b8',
                  marginBottom: '14px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)'
                }}>
                  <Inbox size={28} />
                </div>
                <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '16px', fontWeight: 700 }}>
                  {partsRequests.length === 0 ? 'No Parts Requests Yet' : 'No Matching Requests Found'}
                </h4>
                <p style={{ margin: '0 auto 18px', fontSize: '13px', color: '#64748b', maxWidth: '420px', lineHeight: 1.5 }}>
                  {partsRequests.length === 0
                    ? (isSuperadmin
                        ? 'No parts replenishment requests have been submitted by branch locations yet.'
                        : 'Your branch has not submitted any parts replenishment requests yet. Click below to submit your first requisition to Central DC.')
                    : 'No requests match your current search query or filter selection. Try adjusting your filters above.'}
                </p>
                {!isSuperadmin && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setIsFormOpen(true)}
                    style={{ background: '#0284c7', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, padding: '8px 18px', borderRadius: '6px' }}
                  >
                    <Plus size={15} />
                    <span>Create New Request</span>
                  </button>
                )}
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: '150px' }}>Request # &amp; Date</th>
                    <th style={{ minWidth: '220px' }}>Part Details</th>
                    <th style={{ textAlign: 'center', width: '100px' }}>Quantity</th>
                    <th style={{ textAlign: 'center', width: '100px' }}>Priority</th>
                    <th style={{ minWidth: '160px' }}>Requester &amp; Branch</th>
                    <th style={{ minWidth: '220px' }}>Reason &amp; Admin Reply</th>
                    <th style={{ textAlign: 'center', width: '120px' }}>Status</th>
                    <th style={{ textAlign: 'center', minWidth: '130px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map(req => {
                    const isOwnRequest = req.requested_by === currentUser?.id || req.requested_by_name === currentUser?.fullName;
                    const canCancel = req.status === 'pending' && (isOwnRequest || isSuperadmin);

                    const getStatusBadge = (st) => {
                      switch (st) {
                        case 'pending': return { bg: '#fef3c7', text: '#d97706', border: '#fde68a', label: 'PENDING' };
                        case 'approved': return { bg: '#ede9fe', text: '#7c3aed', border: '#ddd6fe', label: 'APPROVED' };
                        case 'fulfilled': return { bg: '#dcfce7', text: '#059669', border: '#bbf7d0', label: 'FULFILLED' };
                        case 'partially_fulfilled': return { bg: '#e0f2fe', text: '#0284c7', border: '#bae6fd', label: 'PARTIAL' };
                        case 'rejected': return { bg: '#fee2e2', text: '#dc2626', border: '#fecaca', label: 'REJECTED' };
                        case 'cancelled': return { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0', label: 'CANCELLED' };
                        default: return { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0', label: st?.toUpperCase() || 'UNKNOWN' };
                      }
                    };

                    const statusInfo = getStatusBadge(req.status);

                    const getPriorityBadge = (pr) => {
                      if (pr === 'critical') return { bg: '#fee2e2', text: '#dc2626', icon: Flame, label: 'CRITICAL' };
                      if (pr === 'urgent') return { bg: '#fef3c7', text: '#d97706', icon: AlertTriangle, label: 'URGENT' };
                      return { bg: '#e0f2fe', text: '#0284c7', icon: Info, label: 'NORMAL' };
                    };
                    const priorityInfo = getPriorityBadge(req.priority);
                    const PriorityIcon = priorityInfo.icon;

                    return (
                      <tr key={req.id}>
                        <td>
                          <div>
                            <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                              {req.request_number}
                            </strong>
                            <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                              <Calendar size={11} />
                              <span>{new Date(req.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                              {req.part_number}
                            </div>
                            <div style={{ fontSize: '12px', color: '#334155', marginTop: '1px' }}>
                              {req.part_description || 'Service Replacement Part'}
                            </div>
                          </div>
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                            {req.quantity_requested}
                          </div>
                          {req.quantity_fulfilled > 0 && (
                            <div style={{ fontSize: '10.5px', color: '#059669', fontWeight: 600 }}>
                              {req.quantity_fulfilled} fulfilled
                            </div>
                          )}
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <span
                            className="badge"
                            style={{
                              background: priorityInfo.bg,
                              color: priorityInfo.text,
                              fontWeight: 700,
                              fontSize: '10.5px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <PriorityIcon size={11} />
                            <span>{priorityInfo.label}</span>
                          </span>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7', fontSize: '12px', fontWeight: 700 }}>
                              {(req.requested_by_name || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>
                                {req.requested_by_name}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                {req.site_code || activeSiteObj.code} • {req.site_name || activeSiteObj.name}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: req.notes ? '6px' : '0' }}>
                            {req.reason || 'Branch Replenishment'}
                          </div>
                          {req.notes && (
                            <div style={{
                              background: req.status === 'rejected' ? '#fef2f2' : req.status === 'approved' ? '#f0fdf4' : '#eff6ff',
                              border: `1px solid ${req.status === 'rejected' ? '#fca5a5' : req.status === 'approved' ? '#86efac' : '#93c5fd'}`,
                              borderLeft: `4px solid ${req.status === 'rejected' ? '#dc2626' : req.status === 'approved' ? '#16a34a' : '#0284c7'}`,
                              borderRadius: '6px',
                              padding: '6px 10px',
                              marginTop: '4px',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                            }}>
                              <div style={{
                                fontSize: '10.5px',
                                fontWeight: 800,
                                color: req.status === 'rejected' ? '#b91c1c' : req.status === 'approved' ? '#15803d' : '#1d4ed8',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                marginBottom: '2px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.4px'
                              }}>
                                <MessageSquare size={11} />
                                <span>{req.reviewed_by_name ? `Superadmin Reply (${req.reviewed_by_name})` : 'Superadmin Reply / Note'}:</span>
                              </div>
                              <div style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                color: req.status === 'rejected' ? '#991b1b' : req.status === 'approved' ? '#166534' : '#1e40af',
                                lineHeight: 1.35
                              }}>
                                “{req.notes}”
                              </div>
                            </div>
                          )}
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <span
                            className="badge"
                            style={{
                              background: statusInfo.bg,
                              color: statusInfo.text,
                              border: `1px solid ${statusInfo.border}`,
                              fontWeight: 700,
                              fontSize: '11px'
                            }}
                          >
                            {statusInfo.label}
                          </span>
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            
                            {/* Requester / Staff Cancel Action */}
                            {canCancel && (
                              <button
                                className="btn btn-sm btn-secondary"
                                style={{ fontSize: '11px', padding: '3px 8px', color: '#dc2626', borderColor: '#fecaca', background: '#fee2e2' }}
                                onClick={() => {
                                  if (window.confirm(`Are you sure you want to cancel request ${req.request_number}?`)) {
                                    cancelPartsRequest(req.id, 'Cancelled by staff');
                                  }
                                }}
                                title="Cancel this pending parts request"
                              >
                                <X size={12} />
                                <span>Cancel</span>
                              </button>
                            )}

                            {/* Superadmin Authority Controls */}
                            {isSuperadmin && req.status === 'pending' && (
                              <>
                                <button
                                  className="btn btn-sm btn-primary"
                                  style={{ fontSize: '11px', padding: '3px 8px', background: '#059669' }}
                                  onClick={() => openActionModal(req, 'approved')}
                                  title="Approve parts request (Superadmin authority)"
                                >
                                  <Check size={12} />
                                  <span>Approve</span>
                                </button>
                                <button
                                  className="btn btn-sm btn-secondary"
                                  style={{ fontSize: '11px', padding: '3px 8px', color: '#dc2626' }}
                                  onClick={() => openActionModal(req, 'rejected')}
                                  title="Deny / Reject parts request (Superadmin authority)"
                                >
                                  <X size={12} />
                                  <span>Deny</span>
                                </button>
                              </>
                            )}

                            {isSuperadmin && req.status === 'approved' && (
                              <button
                                className="btn btn-sm btn-primary"
                                style={{ fontSize: '11px', padding: '3px 8px', background: '#0284c7' }}
                                onClick={() => openActionModal(req, 'fulfilled')}
                                title="Mark request as fulfilled / dispatched"
                              >
                                <Package size={12} />
                                <span>Fulfill</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}


      {/* 6. TAB 2: Branch Stock on Hand View */}
      {activeTab === 'stock_on_hand' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* Incoming / In-Transit Shipments Card (Dedicated Card, Separated from Catalog) */}
          {incomingShipments.length > 0 && (
            <div
              className="card"
              style={{
                borderRadius: '12px',
                border: '1px solid #bae6fd',
                background: '#ffffff',
                boxShadow: '0 2px 8px -2px rgba(2, 132, 199, 0.08)',
                overflow: 'hidden',
                padding: 0
              }}
            >
              <div
                style={{
                  padding: '14px 20px',
                  background: 'linear-gradient(90deg, #f0f9ff 0%, #f8fafc 100%)',
                  borderBottom: isIncomingShipmentsCollapsed ? 'none' : '1px solid #e0f2fe',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#0284c7', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Truck size={17} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                        Incoming Shipments &amp; Arriving Packages
                      </h4>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: '#e0f2fe',
                          color: '#0369a1',
                          border: '1px solid #bae6fd'
                        }}
                      >
                        {incomingShipments.length} Manifest{incomingShipments.length > 1 ? 's' : ''} • {incomingShipments.reduce((acc, s) => acc + (s.items?.length || 0), 0)} Parts
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: incomingShipments.some(s => s.status === 'shipped' || s.status === 'in_transit') ? '#f0fdf4' : '#fffbeb',
                          color: incomingShipments.some(s => s.status === 'shipped' || s.status === 'in_transit') ? '#166534' : '#b45309',
                          border: `1px solid ${incomingShipments.some(s => s.status === 'shipped' || s.status === 'in_transit') ? '#bbf7d0' : '#fde68a'}`,
                          fontWeight: 700,
                          fontSize: '11px'
                        }}
                      >
                        {incomingShipments.some(s => s.status === 'shipped' || s.status === 'in_transit') ? 'Ongoing Delivery (Awaiting Receipt Confirmation)' : 'Packed (Awaiting DC Dispatch)'}
                      </span>
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                      Parts are packed and dispatched from DC. Confirm physical arrival to activate stock immediately.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setIsIncomingShipmentsCollapsed(prev => !prev)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '12px',
                      color: '#475569',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>{isIncomingShipmentsCollapsed ? `Show Shipments (${incomingShipments.length})` : 'Collapse'}</span>
                  </button>
                </div>
              </div>

              {!isIncomingShipmentsCollapsed && (
                <div style={{ padding: '16px 20px', background: '#fafbfc' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
                    {incomingShipments.map(sh => {
                      const destSite = sites.find(s => s.id === sh.site_id || s.code === sh.site_code) || activeSiteObj;
                      const itemCount = sh.items?.length || 0;
                      const isShipped = sh.status === 'shipped' || sh.status === 'in_transit';
                      return (
                        <div
                          key={sh.id}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '14px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '12px',
                            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                                  {sh.invoice_ref || sh.shipment_number}
                                </strong>
                                <span className="badge" style={{
                                  fontSize: '10.5px',
                                  background: isShipped ? '#e0f2fe' : (sh.status === 'draft' || sh.status === 'packing' ? '#f1f5f9' : '#fef3c7'),
                                  color: isShipped ? '#0369a1' : (sh.status === 'draft' || sh.status === 'packing' ? '#475569' : '#b45309'),
                                  border: `1px solid ${isShipped ? '#bae6fd' : (sh.status === 'draft' || sh.status === 'packing' ? '#cbd5e1' : '#fde68a')}`
                                }}>
                                  {isShipped ? 'In Transit' : (sh.status === 'draft' || sh.status === 'packing' ? 'Draft' : 'Ready for Pickup')}
                                </span>
                              </div>
                              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#0f172a', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
                                {itemCount} item{itemCount !== 1 ? 's' : ''}
                              </span>
                            </div>

                            <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <MapPin size={12} color="#94a3b8" />
                                <span>Destination: <strong style={{ color: '#1e293b' }}>{destSite.name} ({destSite.code})</strong></span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Truck size={12} color="#94a3b8" />
                                <span>
                                  Courier:{' '}
                                  <strong style={{ color: '#1e293b' }}>
                                    {formatCourierWithMode(sh.carrier || sh.courier || 'Lite Express', sh.shipping_mode)}{' '}
                                    {sh.tracking_number ? (
                                      <span
                                        className="font-mono"
                                        onClick={() => handleCopyWaybill(sh.tracking_number)}
                                        style={{
                                          cursor: 'pointer',
                                          fontWeight: 600,
                                          color: copiedWaybill === String(sh.tracking_number).replace(/^#\s*/, '').trim() ? '#15803d' : '#0284c7',
                                          padding: '1px 5px',
                                          borderRadius: '3px',
                                          background: '#f8fafc',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                          transition: 'background-color 0.15s ease'
                                        }}
                                        title="Click to copy Waybill number"
                                      >
                                        #{sh.tracking_number}
                                        {copiedWaybill === String(sh.tracking_number).replace(/^#\s*/, '').trim() ? (
                                          <Check size={11} strokeWidth={2.5} color="#15803d" />
                                        ) : (
                                          <Copy size={10} color="#64748b" style={{ opacity: 0.7 }} />
                                        )}
                                      </span>
                                    ) : ''}
                                  </strong>
                                </span>
                              </div>
                              <div>Packed by: <span style={{ color: '#1e293b' }}>{sh.prepared_by_name || 'Warehouse Staff'}</span></div>
                            </div>

                            {/* Part numbers preview */}
                            <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {(sh.items || []).slice(0, 4).map((it, idx) => (
                                <span key={idx} style={{ fontSize: '11px', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 7px', borderRadius: '4px', color: '#334155', fontFamily: 'var(--font-mono)' }}>
                                  {it.part_number}
                                </span>
                              ))}
                              {itemCount > 4 && (
                                <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center', padding: '2px 4px' }}>
                                  +{itemCount - 4} more
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '12px', marginTop: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b' }}>
                              <Package size={14} color="#059669" />
                              <span>{isShipped ? 'Physical arrival verification required to activate stock' : 'Package being prepared for dispatch'}</span>
                            </div>

                            {isShipped ? (
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                                  color: '#ffffff',
                                  border: '1px solid #047857',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '8px',
                                  fontSize: '13.5px',
                                  fontWeight: 700,
                                  padding: '10px 20px',
                                  borderRadius: '8px',
                                  boxShadow: '0 4px 12px rgba(5, 150, 105, 0.32), 0 1px 2px rgba(0,0,0,0.06)',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  minHeight: '40px',
                                  letterSpacing: '0.01em'
                                }}
                                onClick={() => handleOpenReceiveModal(sh)}
                                title="Confirm physical arrival of this package and activate parts in branch inventory"
                              >
                                <PackageCheck size={18} strokeWidth={2.4} />
                                <span>Confirm Site Package</span>
                              </button>
                            ) : (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#b45309', fontWeight: 600, padding: '6px 12px', background: '#fffbeb', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                                <Clock size={14} />
                                <span>Awaiting DC Dispatch</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main Inventory Catalog Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)', background: '#ffffff' }}>
            
            {/* Toolbar: Search, Category Filters, Status Filter */}
            <div style={{ padding: '14px 20px', background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                
                {/* Search Bar */}
                <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: '440px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: stockSearchQuery ? '#0284c7' : '#94a3b8', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    className="form-input"
                    style={{
                      width: '100%',
                      paddingLeft: '34px',
                      paddingRight: stockSearchQuery ? '32px' : '12px',
                      fontSize: '12.5px',
                      height: '34px',
                      borderRadius: '7px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff'
                    }}
                    placeholder="Search part number, description, or model..."
                    value={stockSearchQuery}
                    onChange={(e) => setStockSearchQuery(e.target.value)}
                  />
                  {stockSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setStockSearchQuery('')}
                      style={{ position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                      title="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Right Controls: Device Filter, Status Filter & SKU Count Pill */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap' }}>
                  {/* Device Model Dropdown */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>Device:</span>
                    <select
                      className="form-select"
                      style={{
                        fontSize: '12px',
                        padding: '4px 10px',
                        height: '34px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontWeight: 600,
                        color: '#1e293b',
                        background: '#ffffff',
                        cursor: 'pointer',
                        maxWidth: '170px'
                      }}
                      value={stockDeviceFilter}
                      onChange={(e) => setStockDeviceFilter(e.target.value)}
                    >
                      <option value="ALL">All Devices ({allStockDeviceModels.length})</option>
                      {allStockDeviceModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  {/* Active In-Stock Indicator */}
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 10px',
                    background: '#ecfdf5',
                    color: '#065f46',
                    border: '1px solid #a7f3d0',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#059669' }} />
                    <span>Active In-Stock</span>
                  </div>

                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '12px',
                    whiteSpace: 'nowrap'
                  }}>
                    <span style={{ color: '#64748b' }}>Showing:</span>
                    <strong style={{ color: '#0f172a', fontWeight: 700 }}>{stockRows.length}</strong>
                    <span style={{ color: '#64748b' }}>{stockRows.length === 1 ? 'SKU' : 'SKUs'}</span>
                    {stockRows.length !== stockCategoryCounts.total && (
                      <span style={{ color: '#94a3b8', fontSize: '11px' }}>({stockCategoryCounts.total} total)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Category Filter Tabs & View Controls */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', paddingTop: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '4px', whiteSpace: 'nowrap' }}>
                    Category:
                  </span>
                  {[
                    { id: 'ALL', label: 'All Parts', count: stockCategoryCounts.total },
                    { id: 'DISPLAY', label: 'Displays', count: stockCategoryCounts.displays },
                    { id: 'BATTERY', label: 'Batteries', count: stockCategoryCounts.batteries },
                    { id: 'OTHER', label: 'Other Components', count: stockCategoryCounts.other }
                  ].map(cat => {
                    const isActive = stockCategoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setStockCategoryFilter(cat.id)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: isActive ? 700 : 500,
                          border: isActive ? '1px solid #0284c7' : '1px solid #e2e8f0',
                          background: isActive ? '#f0f9ff' : '#ffffff',
                          color: isActive ? '#0284c7' : '#475569',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span>{cat.label}</span>
                        <span
                          style={{
                            fontSize: '10.5px',
                            padding: '1px 6px',
                            borderRadius: '999px',
                            background: isActive ? '#bae6fd' : '#f1f5f9',
                            color: isActive ? '#0369a1' : '#64748b',
                            fontWeight: 700
                          }}
                        >
                          {cat.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* View Mode Toggle: Group by Device vs Flat List */}
                  <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '2px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <button
                      type="button"
                      onClick={() => setStockViewMode('grouped')}
                      style={{
                        padding: '3px 10px',
                        fontSize: '11.5px',
                        fontWeight: stockViewMode === 'grouped' ? 700 : 500,
                        background: stockViewMode === 'grouped' ? '#ffffff' : 'transparent',
                        color: stockViewMode === 'grouped' ? '#0284c7' : '#64748b',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        boxShadow: stockViewMode === 'grouped' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'
                      }}
                      title="Group parts by Apple device model"
                    >
                      <Smartphone size={12} />
                      <span>Group by Device</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockViewMode('flat')}
                      style={{
                        padding: '3px 10px',
                        fontSize: '11.5px',
                        fontWeight: stockViewMode === 'flat' ? 700 : 500,
                        background: stockViewMode === 'flat' ? '#ffffff' : 'transparent',
                        color: stockViewMode === 'flat' ? '#0284c7' : '#64748b',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        boxShadow: stockViewMode === 'flat' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'
                      }}
                      title="View all parts in a flat table"
                    >
                      <Boxes size={12} />
                      <span>Flat List</span>
                    </button>
                  </div>

                  {stockViewMode === 'grouped' && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        type="button"
                        onClick={expandAllDevices}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '5px',
                          color: '#475569',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '3px 8px',
                          cursor: 'pointer'
                        }}
                      >
                        Expand All
                      </button>
                      <button
                        type="button"
                        onClick={collapseAllDevices}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: '5px',
                          color: '#475569',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '3px 8px',
                          cursor: 'pointer'
                        }}
                      >
                        Collapse All
                      </button>
                    </div>
                  )}

                  {(stockSearchQuery || stockCategoryFilter !== 'ALL' || stockDeviceFilter !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => {
                        setStockSearchQuery('');
                        setStockCategoryFilter('ALL');
                        setStockDeviceFilter('ALL');
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#dc2626',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: '4px 8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <RotateCcw size={11} />
                      <span>Reset Filters</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Table Area */}
            <div className="table-container" style={{ overflowX: 'auto' }}>
              {stockRows.length === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                  <Package size={40} color="#cbd5e1" style={{ marginBottom: '12px' }} />
                  <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px', fontWeight: 700 }}>
                    No Active In-Stock Parts Found
                  </h4>
                  <p style={{ margin: '0 0 16px', fontSize: '13px' }}>
                    {stockSearchQuery || stockCategoryFilter !== 'ALL' || stockDeviceFilter !== 'ALL'
                      ? 'Try clearing your search query or selecting a different category or device filter.'
                      : `There are currently no active catalog parts in stock recorded for ${activeSiteObj.name}.`}
                  </p>
                  {(stockSearchQuery || stockCategoryFilter !== 'ALL' || stockDeviceFilter !== 'ALL') && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setStockSearchQuery('');
                        setStockCategoryFilter('ALL');
                        setStockDeviceFilter('ALL');
                      }}
                    >
                      Clear All Filters
                    </button>
                  )}
                </div>
              ) : (
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: '160px' }}>
                        Part Number
                      </th>
                      <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: '240px' }}>
                        Part Description
                      </th>
                      <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', width: '140px' }}>
                        Available Stock
                      </th>
                      <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', width: '100px' }}>
                        Allocated
                      </th>
                      <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', width: '110px' }}>
                        In-Transit
                      </th>
                      <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', width: '160px' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Render helper for standard row */}
                    {(() => {
                      const isDc = isSuperadmin || currentUser?.siteId === 'site-dc' || userSiteObj?.code === 'DC-MDC' || userSiteObj?.code === 'DC';
                      const isUserSameSite = !isDc && Boolean(
                        currentUser?.siteId && (
                          selectedSiteId === currentUser.siteId ||
                          selectedSiteId === userSiteObj?.id ||
                          activeSiteObj?.code === userSiteObj?.code ||
                          activeSiteObj?.id === userSiteObj?.id
                        )
                      );

                      const renderRow = (row, isNested = false) => (
                        <tr
                          key={row.partNumber}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            transition: 'background-color 0.12s ease',
                            backgroundColor: '#ffffff'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
                        >
                          <td style={{ padding: '12px 16px', paddingLeft: isNested ? '28px' : '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {isNested && (
                                <span style={{ color: '#0284c7', fontSize: '12px', fontWeight: 700, userSelect: 'none' }}>↳</span>
                              )}
                              <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                {row.partNumber}
                              </strong>
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12.5px', color: '#1e293b', fontWeight: 500 }}>
                            {row.description}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {row.inStock > 0 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  background: '#ecfdf5',
                                  color: '#065f46',
                                  border: '1px solid #a7f3d0',
                                  fontWeight: 800,
                                  fontSize: '12px',
                                  padding: '3px 10px',
                                  borderRadius: '999px'
                                }}
                              >
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#059669' }} />
                                <span>{row.inStock} units</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: '#fef2f2',
                                  color: '#991b1b',
                                  border: '1px solid #fecaca',
                                  fontWeight: 600,
                                  fontSize: '11.5px',
                                  padding: '2px 8px',
                                  borderRadius: '999px'
                                }}
                              >
                                <span>0 units (OOS)</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', color: row.allocated > 0 ? '#0f172a' : '#94a3b8', fontWeight: row.allocated > 0 ? 700 : 400 }}>
                            {row.allocated || '—'}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {row.packed > 0 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: '#eff6ff',
                                  color: '#0284c7',
                                  border: '1px solid #bae6fd',
                                  borderRadius: '6px',
                                  padding: '2px 8px',
                                  fontSize: '11px',
                                  fontWeight: 700
                                }}
                                title={`${row.packed} unit(s) packed / en route from Central DC`}
                              >
                                <Truck size={11} />
                                <span>{row.packed} in-transit</span>
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {isUserSameSite ? (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {row.inStock > 0 ? (
                                  <>
                                    <span
                                      className="badge"
                                      style={{
                                        background: '#f0fdf4',
                                        color: '#166534',
                                        border: '1px solid #bbf7d0',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        padding: '3px 8px'
                                      }}
                                      title="This part is currently in your branch inventory"
                                    >
                                      <CheckCircle2 size={11} color="#16a34a" />
                                      <span>In Stock</span>
                                    </span>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      style={{
                                        fontSize: '11.5px',
                                        padding: '4px 8px',
                                        color: '#059669',
                                        borderColor: '#86efac',
                                        background: '#f0fdf4',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontWeight: 700,
                                        borderRadius: '6px'
                                      }}
                                      onClick={() => openMarkUsedModal(row.partNumber)}
                                      title={`Record #${row.partNumber} as used in a repair work order`}
                                    >
                                      <Wrench size={11} />
                                      <span>Mark Used</span>
                                    </button>
                                  </>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                    {row.packed > 0 ? (
                                      <span
                                        className="badge"
                                        style={{
                                          background: '#eff6ff',
                                          color: '#0284c7',
                                          border: '1px solid #bfdbfe',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                          padding: '3px 8px'
                                        }}
                                        title={`${row.packed} unit(s) are packed / in transit for this branch. Protected from zero-stock auto-cleaning.`}
                                      >
                                        <Truck size={11} color="#0284c7" />
                                        <span>{row.packed} In Transit</span>
                                      </span>
                                    ) : (
                                      <span
                                        className="badge"
                                        style={{
                                          background: '#fee2e2',
                                          color: '#dc2626',
                                          border: '1px solid #fecaca',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                          padding: '3px 8px'
                                        }}
                                        title="Out of stock at this branch. Part record remains permanently preserved in catalog."
                                      >
                                        <AlertTriangle size={11} color="#dc2626" />
                                        <span>Out of Stock</span>
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      style={{ fontSize: '11.5px', padding: '4px 8px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff', borderRadius: '6px', fontWeight: 600 }}
                                      onClick={() => handleQuickRequestPart(row.partNumber)}
                                      title="Create replenishment request for this part"
                                    >
                                      <Plus size={11} />
                                      <span>Request</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '11.5px', padding: '4px 10px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff', borderRadius: '6px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleQuickRequestPart(row.partNumber)}
                                title="Create replenishment request for this part"
                              >
                                <Plus size={12} />
                                <span>Request</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );

                      if (stockViewMode === 'grouped') {
                        return groupedStockByDevice.map(group => {
                          const isCollapsed = Boolean(collapsedDevices[group.model]);
                          return (
                            <Fragment key={group.model}>
                              {/* Device Group Header Banner */}
                              <tr
                                style={{
                                  background: 'linear-gradient(90deg, #f0f9ff 0%, #f8fafc 100%)',
                                  borderTop: '2px solid #bae6fd',
                                  borderBottom: isCollapsed ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                                  borderLeft: '4px solid #0284c7'
                                }}
                              >
                                <td colSpan={6} style={{ padding: '9px 16px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    {/* Left: Device Icon, Model Title & Parts Count */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <div style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '7px',
                                        background: '#0284c7',
                                        color: '#ffffff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 1px 3px rgba(2, 132, 199, 0.25)'
                                      }}>
                                        <Smartphone size={15} />
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
                                          {group.model}
                                        </span>
                                        <span style={{
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          color: '#0369a1',
                                          background: '#e0f2fe',
                                          border: '1px solid #bae6fd',
                                          padding: '2px 8px',
                                          borderRadius: '12px'
                                        }}>
                                          {group.rows.length} {group.rows.length === 1 ? 'Part SKU' : 'Part SKUs'}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Right: Stock Badges & Collapse Toggle */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '5px',
                                          background: group.totalInStock > 0 ? '#ecfdf5' : '#fef2f2',
                                          color: group.totalInStock > 0 ? '#065f46' : '#991b1b',
                                          border: group.totalInStock > 0 ? '1px solid #a7f3d0' : '1px solid #fecaca',
                                          fontWeight: 700,
                                          fontSize: '11.5px',
                                          padding: '3px 10px',
                                          borderRadius: '999px'
                                        }}
                                      >
                                        {group.totalInStock > 0 && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#059669' }} />}
                                        <span>{group.totalInStock} units in stock</span>
                                      </span>

                                      {group.totalPacked > 0 && (
                                        <span style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          background: '#eff6ff',
                                          color: '#0284c7',
                                          border: '1px solid #bae6fd',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          padding: '3px 8px',
                                          borderRadius: '999px'
                                        }}>
                                          <Truck size={11} />
                                          <span>{group.totalPacked} in-transit</span>
                                        </span>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => toggleDeviceCollapse(group.model)}
                                        style={{
                                          background: '#ffffff',
                                          border: '1px solid #cbd5e1',
                                          borderRadius: '6px',
                                          cursor: 'pointer',
                                          padding: '3px 8px',
                                          color: '#475569',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          fontSize: '11px',
                                          fontWeight: 600
                                        }}
                                        title={isCollapsed ? `Expand ${group.model}` : `Collapse ${group.model}`}
                                      >
                                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                        <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>

                              {/* Child Rows for this Device */}
                              {!isCollapsed && group.rows.map(row => renderRow(row, true))}
                            </Fragment>
                          );
                        });
                      }

                      // Flat list view
                      return stockRows.map(row => renderRow(row, false));
                    })()}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 7. TAB 3: All Stocks & Multi-Site Inventory with Regional Tabs and Part Number Availability Search */}
      {activeTab === 'all_stocks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          {/* Top Search Bar & Telemetry Status Card */}
          <div className="card" style={{ padding: '16px 20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '280px' }}>
                <div style={{ position: 'relative', width: '100%', maxWidth: '440px' }}>
                  <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#0284c7' }} />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: '36px', paddingRight: allStocksSearchQuery ? '30px' : '12px', fontSize: '13px', height: '38px', borderRadius: '8px' }}
                    placeholder="Search serial # (e.g. F8Y6272C...), part #, model, or branch..."
                    value={allStocksSearchQuery}
                    onChange={(e) => setAllStocksSearchQuery(e.target.value)}
                  />
                  {allStocksSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setAllStocksSearchQuery('')}
                      style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
                      title="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '5px', background: '#e0f2fe', padding: '6px 12px', borderRadius: '6px', fontWeight: 600 }}>
                  <ShieldCheck size={14} color="#0284c7" />
                  <span>Network Multi-Site Visibility</span>
                </div>
                <div style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px', background: '#f1f5f9', padding: '6px 12px', borderRadius: '6px' }}>
                  {isSuperadmin || isAdmin ? (
                    <>
                      <Barcode size={13} color="#0284c7" />
                      <span>Serial Tracking: <strong style={{ color: '#0369a1' }}>Full Network</strong></span>
                    </>
                  ) : (
                    <>
                      <Lock size={13} color="#0284c7" />
                      <span>Serial Privacy: <strong>Enforced</strong></span>
                    </>
                  )}
                </div>

                {/* Separate Import Options for XLSX and CSV */}
                {(isSuperadmin || isPmgUser || isAdmin) && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        fontSize: '11.5px',
                        padding: '6px 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontWeight: 700,
                        color: '#ffffff',
                        border: '1px solid #0284c7',
                        background: '#0284c7',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(2, 132, 199, 0.15)'
                      }}
                      onClick={() => {
                        setImportModalFileType('xlsx');
                        setIsImportModalOpen(true);
                      }}
                      title="Import All Stocks via Excel Workbook (.xlsx)"
                    >
                      <FileSpreadsheet size={13} color="#ffffff" />
                      <span>Import XLSX</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        fontSize: '11.5px',
                        padding: '6px 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontWeight: 700,
                        color: '#ffffff',
                        border: '1px solid #059669',
                        background: '#059669',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        boxShadow: '0 1px 2px rgba(5, 150, 105, 0.15)'
                      }}
                      onClick={() => {
                        setImportModalFileType('csv');
                        setIsImportModalOpen(true);
                      }}
                      title="Import & Update All Parts via Fixably / GSX Inventory Value CSV (.csv)"
                    >
                      <UploadCloud size={13} color="#ffffff" />
                      <span>Import CSV (GSX)</span>
                    </button>
                  </div>
                )}
                {isSuperadmin && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      fontSize: '11.5px',
                      padding: '6px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 700,
                      color: '#dc2626',
                      border: '1px solid #fca5a5',
                      background: '#fff1f2',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    onClick={() => handleOpenClearPartsModal('ALL', 'ALL', 'All Retail Branches')}
                    title={`Clear old parts across all ${branchSitesCount} retail branch sites prior to Excel import`}
                  >
                    <Trash2 size={13} color="#dc2626" />
                    <span>Clear All Sites Parts</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Network-Wide Search Result Panel (Serial Location Tracker & Part Availability) */}
          {allStocksSearchQuery.trim() && (
            <div
              className="card"
              style={{
                padding: '20px',
                background: '#ffffff',
                border: '2px solid #0284c7',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 8px 20px -4px rgba(2, 132, 199, 0.15)'
              }}
            >
              {/* Top Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ padding: '7px', background: '#e0f2fe', borderRadius: '8px', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {allStocksSerialSearchResults.length > 0 ? <Barcode size={18} /> : <Search size={18} />}
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '15px', color: '#0f172a', fontWeight: 800 }}>
                      {allStocksSerialSearchResults.length > 0
                        ? `Exact Serial Location Tracker for "${allStocksSearchQuery}"`
                        : `Network Stock Availability for "${allStocksSearchQuery}"`}
                    </h4>
                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                      {allStocksSerialSearchResults.length > 0
                        ? `${allStocksSerialSearchResults.length} serial record${allStocksSerialSearchResults.length === 1 ? '' : 's'} located across service points`
                        : `${networkPartSearchResults?.length || 0} stock location${(networkPartSearchResults?.length || 0) === 1 ? '' : 's'} found`}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {allStocksSerialSearchResults.length > 0 && (
                    <span className="badge" style={{ background: '#dcfce7', color: '#15803d', fontWeight: 800, fontSize: '11.5px', padding: '4px 10px' }}>
                      🎯 {allStocksSerialSearchResults.length} Serial Located
                    </span>
                  )}
                  {networkPartSearchResults && networkPartSearchResults.length > 0 && (
                    <span className="badge badge-primary" style={{ fontSize: '11.5px', padding: '4px 10px' }}>
                      {networkPartSearchResults.length} Part Location{networkPartSearchResults.length === 1 ? '' : 's'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                    onClick={() => setAllStocksSearchQuery('')}
                  >
                    Close Search
                  </button>
                </div>
              </div>

              {/* SECTION A: Exact Serial Number Location Matches (Superadmin / Network Tracker) */}
              {allStocksSerialSearchResults.length > 0 && (
                <div style={{ marginBottom: (networkPartSearchResults && networkPartSearchResults.length > 0) ? '24px' : '0' }}>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={14} color="#0284c7" />
                    <span>Exact Branch Location Tracker (Real-Time Physical Location):</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '14px' }}>
                    {allStocksSerialSearchResults.map((serialMatch, sIdx) => {
                      const siteObj = sites.find(s => s.id === serialMatch.siteId || s.code === serialMatch.siteCode);
                      const isProv = isProvincialSite(siteObj);
                      const regKey = isProv ? 'provincial' : 'metro_manila';
                      const isCopied = copiedSerial === serialMatch.serialNumber;

                      const statusBadge = serialMatch.isUsed
                        ? { bg: '#fef2f2', color: '#b91c1c', border: '#fca5a5', text: `Used in Repair (WO: ${serialMatch.workOrderNumber})` }
                        : serialMatch.statusKey === 'in_transit'
                        ? { bg: '#fffbeb', color: '#b45309', border: '#fcd34d', text: 'In Transit via Dispatch' }
                        : serialMatch.isDcSite
                        ? { bg: '#f3e8ff', color: '#7e22ce', border: '#d8b4fe', text: 'In Stock at Central DC' }
                        : { bg: '#f0fdf4', color: '#15803d', border: '#86efac', text: 'In Stock at Branch' };

                      return (
                        <div
                          key={`serial-match-${serialMatch.serialNumber}-${sIdx}`}
                          style={{
                            border: '2px solid #38bdf8',
                            borderRadius: '10px',
                            padding: '16px',
                            background: 'linear-gradient(135deg, #f0f9ff 0%, #ffffff 100%)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '12px',
                            boxShadow: '0 4px 12px rgba(2, 132, 199, 0.08)'
                          }}
                        >
                          <div>
                            {/* Top Badges */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  background: statusBadge.bg,
                                  color: statusBadge.color,
                                  border: `1px solid ${statusBadge.border}`
                                }}
                              >
                                {statusBadge.text}
                              </span>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  background: serialMatch.isDcSite ? '#e9d5ff' : (isProv ? '#fef3c7' : '#e0f2fe'),
                                  color: serialMatch.isDcSite ? '#6b21a8' : (isProv ? '#92400e' : '#0369a1')
                                }}
                              >
                                {serialMatch.isDcSite ? 'Central DC' : (isProv ? 'Provincial ASP' : 'Metro Manila ASP')}
                              </span>
                            </div>

                            {/* Exact Location Header */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                              <Building2 size={18} color="#0284c7" style={{ marginTop: '2px', flexShrink: 0 }} />
                              <div>
                                <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                                  {serialMatch.siteCode} — {serialMatch.siteName}
                                </div>
                                <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                  <MapPin size={11} color="#94a3b8" />
                                  <span>{siteObj?.full_address || siteObj?.address || 'Standard Authorized Service Facility'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Serial Number Pill with Copy Button */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: '#ffffff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '6px',
                                padding: '6px 10px',
                                margin: '8px 0',
                                fontFamily: 'var(--font-mono)'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Barcode size={15} color="#0284c7" />
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', letterSpacing: '0.04em' }}>
                                  {serialMatch.serialNumber}
                                </span>
                              </div>
                              <button
                                type="button"
                                style={{
                                  border: 'none',
                                  background: isCopied ? '#dcfce7' : '#f1f5f9',
                                  color: isCopied ? '#15803d' : '#475569',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                onClick={() => {
                                  if (navigator?.clipboard) {
                                    navigator.clipboard.writeText(serialMatch.serialNumber);
                                    setCopiedSerial(serialMatch.serialNumber);
                                    setTimeout(() => setCopiedSerial(null), 2000);
                                    showToast?.(`Copied serial #${serialMatch.serialNumber} to clipboard`, 'info');
                                  }
                                }}
                                title="Copy Serial Number"
                              >
                                {isCopied ? <Check size={11} /> : <Copy size={11} />}
                                <span>{isCopied ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>

                            {/* Part Telemetry */}
                            <div style={{ fontSize: '12px', color: '#1e293b', fontWeight: 600 }}>
                              <span style={{ color: '#0284c7', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{serialMatch.partNumber}</span>
                              <span style={{ margin: '0 6px', color: '#cbd5e1' }}>•</span>
                              <span>{serialMatch.description}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                              <span>Model: <strong>{serialMatch.iphoneModel || 'Universal Component'}</strong></span>
                              <span style={{ margin: '0 6px', color: '#cbd5e1' }}>•</span>
                              <span>Arrival: <strong>{serialMatch.siteArrivalStatus || 'Active'}</strong></span>
                              {serialMatch.boxNumber && (
                                <>
                                  <span style={{ margin: '0 6px', color: '#cbd5e1' }}>•</span>
                                  <span>Box: <strong>#{serialMatch.boxNumber}</strong></span>
                                </>
                              )}
                            </div>

                            {/* Used in repair extra telemetry */}
                            {serialMatch.isUsed && (
                              <div style={{ marginTop: '6px', padding: '6px 8px', background: '#fff1f2', borderRadius: '4px', fontSize: '11px', color: '#9f1239' }}>
                                <strong>Work Order:</strong> {serialMatch.workOrderNumber}
                                {serialMatch.dateUsedFormatted && <span> • <strong>Date Used:</strong> {serialMatch.dateUsedFormatted}</span>}
                                {serialMatch.usedByName && <span> • <strong>Specialist:</strong> {serialMatch.usedByName}</span>}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '11px', padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}
                              onClick={() => setInspectedSerialDetails(serialMatch)}
                            >
                              <History size={12} />
                              <span>View Dossier</span>
                            </button>

                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '11.5px', padding: '5px 12px', background: '#0284c7', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700 }}
                              onClick={() => {
                                setAllStocksRegionTab(regKey);
                                setAllStocksSelectedSiteId(serialMatch.siteId);
                                showToast?.(`Navigated to ${serialMatch.siteCode} (${serialMatch.siteName})`, 'info');
                              }}
                            >
                              <MapPin size={12} />
                              <span>Locate at Branch</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION B: Network Part Availability Matches */}
              {networkPartSearchResults && networkPartSearchResults.length > 0 && (
                <div>
                  {allStocksSerialSearchResults.length > 0 && (
                    <div style={{ fontSize: '12px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                      <Package size={14} color="#0284c7" />
                      <span>General Part Number Availability (Stock Counts by Branch):</span>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' }}>
                    {networkPartSearchResults.map((match, idx) => (
                      <div
                        key={`${match.siteId}-${match.partNumber}-${idx}`}
                        style={{
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          background: match.isOwnSite ? '#f0fdf4' : '#f8fafc',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '10px'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span
                              className="badge"
                              style={{
                                fontSize: '10.5px',
                                background: match.isDc ? '#f3e8ff' : (match.isProv ? '#fef3c7' : '#e0f2fe'),
                                color: match.isDc ? '#7e22ce' : (match.isProv ? '#b45309' : '#0369a1'),
                                fontWeight: 700
                              }}
                            >
                              {match.regionLabel}
                            </span>
                            <span
                              className="badge"
                              style={{
                                background: '#dcfce7',
                                color: '#15803d',
                                fontWeight: 800,
                                fontSize: '11.5px',
                                padding: '2px 8px'
                              }}
                            >
                              {match.inStock} units in stock
                            </span>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                            {match.siteCode} — {match.siteName}
                          </div>
                          <div style={{ fontSize: '12px', color: '#0284c7', fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: '4px' }}>
                            {match.partNumber}
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '2px' }}>
                            {match.description}
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => {
                              setAllStocksRegionTab(match.regionKey);
                              setAllStocksSelectedSiteId(match.siteId);
                            }}
                          >
                            <ChevronRight size={12} />
                            <span>View Site Stock</span>
                          </button>
                          {!isSuperadmin && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '11px', padding: '4px 10px', background: '#0284c7', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              onClick={() => handleQuickRequestPart(match.partNumber, match.siteName)}
                            >
                              <Send size={11} />
                              <span>Request Transfer</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION C: Clean Empty State when neither serial nor part matches exist */}
              {allStocksSerialSearchResults.length === 0 && (!networkPartSearchResults || networkPartSearchResults.length === 0) && (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b' }}>
                  <SearchX size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
                  <p style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    No branch stock or serial number found matching &quot;{allStocksSearchQuery}&quot;.
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                    Verify the serial number or part SKU, or submit a replenishment request directly to DC Superadmin.
                  </p>
                  {!isSuperadmin && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: '12px', background: '#0284c7' }}
                      onClick={() => handleQuickRequestPart(allStocksSearchQuery.trim())}
                    >
                      <Plus size={13} />
                      <span>Request from DC Superadmin</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Region Tabs (Metro Manila vs Provincial Sites) */}
          <div className="card" style={{ padding: '6px 8px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {/* Metro Manila Sites Tab */}
              <button
                type="button"
                onClick={() => {
                  setAllStocksRegionTab('metro_manila');
                  const firstMm = metroManilaSites.find(s => s.id === currentUser?.siteId || s.code === userSiteObj?.code) || metroManilaSites[0];
                  if (firstMm) setAllStocksSelectedSiteId(firstMm.id);
                }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '12px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  background: allStocksRegionTab === 'metro_manila'
                    ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)'
                    : '#f8fafc',
                  color: allStocksRegionTab === 'metro_manila' ? '#ffffff' : '#334155',
                  boxShadow: allStocksRegionTab === 'metro_manila' ? '0 4px 12px rgba(2, 132, 199, 0.25)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Building2 size={18} color={allStocksRegionTab === 'metro_manila' ? '#ffffff' : '#0284c7'} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: '13.5px' }}>Metro Manila Sites</div>
                    <div style={{ fontSize: '11px', opacity: 0.85 }}>{metroManilaSites.length} Authorized Service Points</div>
                  </div>
                </div>
                <span
                  style={{
                    background: allStocksRegionTab === 'metro_manila' ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0',
                    color: allStocksRegionTab === 'metro_manila' ? '#ffffff' : '#0f172a',
                    padding: '3px 10px',
                    borderRadius: '999px',
                    fontSize: '11.5px',
                    fontWeight: 800
                  }}
                >
                  {regionStockTotals.mmUnits} units
                </span>
              </button>

              {/* Provincial Sites Tab */}
              <button
                type="button"
                onClick={() => {
                  setAllStocksRegionTab('provincial');
                  const firstProv = provincialSites.find(s => s.id === currentUser?.siteId || s.code === userSiteObj?.code) || provincialSites[0];
                  if (firstProv) setAllStocksSelectedSiteId(firstProv.id);
                }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '12px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  background: allStocksRegionTab === 'provincial'
                    ? 'linear-gradient(135deg, #d97706 0%, #b45309 100%)'
                    : '#f8fafc',
                  color: allStocksRegionTab === 'provincial' ? '#ffffff' : '#334155',
                  boxShadow: allStocksRegionTab === 'provincial' ? '0 4px 12px rgba(217, 119, 6, 0.25)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <MapPin size={18} color={allStocksRegionTab === 'provincial' ? '#ffffff' : '#d97706'} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, fontSize: '13.5px' }}>Provincial Sites</div>
                    <div style={{ fontSize: '11px', opacity: 0.85 }}>{provincialSites.length} Regional Service Points</div>
                  </div>
                </div>
                <span
                  style={{
                    background: allStocksRegionTab === 'provincial' ? 'rgba(255, 255, 255, 0.25)' : '#e2e8f0',
                    color: allStocksRegionTab === 'provincial' ? '#ffffff' : '#0f172a',
                    padding: '3px 10px',
                    borderRadius: '999px',
                    fontSize: '11.5px',
                    fontWeight: 800
                  }}
                >
                  {regionStockTotals.provUnits} units
                </span>
              </button>
            </div>

            {/* Individual Site Selector Chips under the Active Region */}
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>Select Site to View Available Stocks:</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {currentRegionSites.map(site => {
                  const isSelected = currentActiveMultiSite?.id === site.id || currentActiveMultiSite?.code === site.code;
                  const isUserOwn = site.id === currentUser?.siteId || site.code === userSiteObj?.code;
                  const siteSummary = (multiSiteStockData || []).find(s => s.siteId === site.id || s.siteCode === site.code);
                  const inStockUnits = siteSummary?.totalInStock || 0;

                  // Check if search matches parts at this site
                  const hasSearchMatch = Boolean(
                    allStocksSearchQuery.trim() &&
                    siteSummary?.parts?.some(p => {
                      const q = allStocksSearchQuery.toLowerCase().trim();
                      return p.partNumber?.toLowerCase().includes(q) ||
                             p.description?.toLowerCase().includes(q) ||
                             p.model?.toLowerCase().includes(q);
                    })
                  );

                  return (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => setAllStocksSelectedSiteId(site.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: isSelected
                          ? (allStocksRegionTab === 'provincial' ? '2px solid #d97706' : '2px solid #0284c7')
                          : (hasSearchMatch ? '2px solid #10b981' : '1px solid #cbd5e1'),
                        background: isSelected
                          ? (allStocksRegionTab === 'provincial' ? '#fffbeb' : '#f0f9ff')
                          : (hasSearchMatch ? '#ecfdf5' : '#ffffff'),
                        color: isSelected
                          ? (allStocksRegionTab === 'provincial' ? '#92400e' : '#0369a1')
                          : '#1e293b',
                        cursor: 'pointer',
                        fontWeight: isSelected ? 800 : 500,
                        fontSize: '12px',
                        transition: 'all 0.1s ease'
                      }}
                    >
                      <span>{site.code}</span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>({site.name.replace('MOBILECARE - ', '').replace('MOBILE CARE SERVICES PHILS. INC. - ', '')})</span>
                      <span
                        style={{
                          background: inStockUnits > 0 ? (isSelected ? '#0284c7' : '#e2e8f0') : '#fee2e2',
                          color: inStockUnits > 0 ? (isSelected ? '#ffffff' : '#0f172a') : '#dc2626',
                          borderRadius: '999px',
                          padding: '1px 6px',
                          fontSize: '10px',
                          fontWeight: 700
                        }}
                      >
                        {inStockUnits}
                      </span>
                      {isUserOwn && (
                        <span style={{ background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700 }}>
                          Your Branch
                        </span>
                      )}
                      {hasSearchMatch && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} title="Has parts matching your search" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Active Site Header & Available Stocks Table Card */}
          {currentActiveMultiSite ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-lg)', background: '#ffffff' }}>
              
              {/* Selected Site Detail Banner with Full Supervisor Details */}
              <div style={{ padding: '18px 22px', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                  <div style={{ flex: 1, minWidth: '280px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <Building2 size={20} color="#0284c7" />
                      <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                        {currentActiveMultiSite.name}
                      </h3>
                      <span className="badge badge-primary" style={{ fontSize: '11px', fontWeight: 700 }}>
                        {currentActiveMultiSite.code}
                      </span>
                      {currentActiveMultiSite.ship_to && (
                        <span className="badge" style={{ fontSize: '11px', background: '#e0e7ff', color: '#3730a3', fontWeight: 700 }}>
                          GSX Ship-To: {currentActiveMultiSite.ship_to}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={13} color="#94a3b8" />
                      <span>{currentActiveMultiSite.full_address || currentActiveMultiSite.address || 'Standard Authorized Service Facility'}</span>
                    </div>

                    {/* Supervisor Contact Details (Displayed in Full) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#1e293b' }}>
                        <span style={{ color: '#64748b', fontSize: '11.5px', fontWeight: 600 }}>Branch Supervisor:</span>
                        <strong>{currentActiveMultiSite.contact_person || 'Assigned Branch Supervisor'}</strong>
                      </div>

                      {currentActiveMultiSite.contact_phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Phone size={13} color="#0284c7" />
                          <a
                            href={`tel:${currentActiveMultiSite.contact_phone}`}
                            style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 600, fontSize: '12px' }}
                            title="Call Branch Supervisor"
                          >
                            {currentActiveMultiSite.contact_phone}
                          </a>
                        </div>
                      )}

                      {currentActiveMultiSite.contact_email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Mail size={13} color="#0284c7" />
                          <a
                            href={`mailto:${currentActiveMultiSite.contact_email}`}
                            style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 600, fontSize: '12px', wordBreak: 'break-all' }}
                            title="Email Branch Supervisor"
                          >
                            {currentActiveMultiSite.contact_email}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick Site Stock Stats */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ background: '#ffffff', padding: '10px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Available Units</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: currentActiveMultiSiteStock.totalInStock > 0 ? '#15803d' : '#dc2626' }}>
                        {currentActiveMultiSiteStock.totalInStock}
                      </div>
                    </div>
                    <div style={{ background: '#ffffff', padding: '10px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Unique Parts</div>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7' }}>
                        {currentActiveMultiSiteStock.parts?.length || 0}
                      </div>
                    </div>
                    {isSuperadmin && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{
                          fontSize: '11px',
                          padding: '10px 14px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontWeight: 700,
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          background: '#fff1f2',
                          borderRadius: '8px',
                          cursor: 'pointer'
                        }}
                        onClick={() => handleOpenClearPartsModal(currentActiveMultiSite?.id, currentActiveMultiSite?.code, currentActiveMultiSite?.name)}
                        title={`Clear old shipped parts from ${currentActiveMultiSite?.code || 'site'} prior to Excel import`}
                      >
                        <Trash2 size={13} color="#dc2626" />
                        <span>Clear Site Parts</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Site Stock Table */}
              <div className="table-container" style={{ overflowX: 'auto' }}>
                {activeSiteStockRows.length === 0 ? (
                  <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                    <Boxes size={36} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                    <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px' }}>No Inventory Records for this Site</h4>
                    <p style={{ margin: 0, fontSize: '12.5px' }}>
                      {allStocksSearchQuery.trim()
                        ? `No parts match "${allStocksSearchQuery}" at ${currentActiveMultiSite.code}.`
                        : `${currentActiveMultiSite.code} currently has no serialized parts registered in stock.`}
                    </p>
                  </div>
                ) : (
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ minWidth: '160px' }}>Part Number</th>
                        <th style={{ minWidth: '240px' }}>Description &amp; Model</th>
                        <th style={{ textAlign: 'center', width: '130px' }}>Available Stock</th>
                        <th style={{ minWidth: '220px' }}>Serial Details &amp; Privacy</th>
                        <th style={{ textAlign: 'center', width: '140px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSiteStockRows.map((row, idx) => {
                        const rowKey = `${currentActiveMultiSite.id}-${row.partNumber}-${idx}`;
                        const isExpanded = expandedPartKey === rowKey;
                        const isOwnSite = currentActiveMultiSite.id === currentUser?.siteId ||
                          currentActiveMultiSite.id === currentUser?.site_id ||
                          currentActiveMultiSite.code === userSiteObj?.code ||
                          currentActiveMultiSite.code === currentUser?.siteCode ||
                          currentActiveMultiSite.code === currentUser?.site_code;
                        const canSeeFullDetails = isSuperadmin || isOwnSite || Boolean(row.canViewDetails);

                        const inStockUnits = (row.serializedUnits || []).filter(u => {
                          const s = String(u.status || '').toLowerCase();
                          return s === 'in_stock' || s === 'available';
                        });
                        const usedUnits = (row.serializedUnits || []).filter(u => {
                          const s = String(u.status || '').toLowerCase();
                          return s === 'used' || s === 'consumed';
                        });
                        const otherUnits = (row.serializedUnits || []).filter(u => {
                          const s = String(u.status || '').toLowerCase();
                          return s !== 'in_stock' && s !== 'available' && s !== 'used' && s !== 'consumed';
                        });

                        return (
                          <Fragment key={rowKey}>
                            <tr style={{ background: isOwnSite ? '#f8fafc' : '#ffffff', borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9' }}>
                              <td style={{ verticalAlign: 'top', padding: '12px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                                    {row.partNumber}
                                  </strong>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(row.partNumber);
                                      showToast(`Copied ${row.partNumber} to clipboard`, 'info');
                                    }}
                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px' }}
                                    title="Copy part number"
                                  >
                                    <Copy size={11} />
                                  </button>
                                </div>
                              </td>

                              <td style={{ verticalAlign: 'top', padding: '12px 16px' }}>
                                <div style={{ fontSize: '12.5px', color: '#1e293b', fontWeight: 600 }}>
                                  {row.description}
                                </div>
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span>{row.model}</span>
                                  {(() => {
                                    const catObj = getCategoryForPart({ ...row, category_id: row.category_id || row.categoryId }, categories);
                                    const rawCat = row.category_name || row.category;
                                    const displayCategory = (!isUUID(rawCat) && rawCat) || catObj?.name;
                                    if (!displayCategory) return null;
                                    const badgeStyle = getCategoryBadgeStyle(catObj?.code || row.categoryCode || displayCategory);
                                    return (
                                      <span
                                        className="badge"
                                        style={{
                                          fontSize: '10px',
                                          padding: '1px 6px',
                                          background: badgeStyle.bg,
                                          color: badgeStyle.color,
                                          border: `1px solid ${badgeStyle.border}`
                                        }}
                                      >
                                        {displayCategory}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </td>

                              <td style={{ verticalAlign: 'top', textAlign: 'center', padding: '12px 16px' }}>
                                <span
                                  className="badge"
                                  style={{
                                    background: row.inStock > 0 ? '#dcfce7' : '#fee2e2',
                                    color: row.inStock > 0 ? '#059669' : '#dc2626',
                                    fontWeight: 800,
                                    fontSize: '12px',
                                    padding: '4px 10px'
                                  }}
                                >
                                  {row.inStock} units
                                </span>
                              </td>

                              <td style={{ verticalAlign: 'top', padding: '12px 16px' }}>
                                {canSeeFullDetails ? (
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#059669', fontWeight: 600 }}>
                                        <Unlock size={12} />
                                        <span>Full Visibility ({row.serializedUnits?.length || 0} units)</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="btn btn-xs btn-secondary"
                                        style={{
                                          fontSize: '11px',
                                          padding: '2px 8px',
                                          borderRadius: '5px',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          fontWeight: 600,
                                          background: isExpanded ? '#0284c7' : '#ffffff',
                                          color: isExpanded ? '#ffffff' : '#334155',
                                          borderColor: isExpanded ? '#0284c7' : '#cbd5e1'
                                        }}
                                        onClick={() => setExpandedPartKey(isExpanded ? null : rowKey)}
                                      >
                                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                        <span>{isExpanded ? 'Hide Serials' : 'View Serials'}</span>
                                      </button>
                                    </div>

                                    {/* Status highlight summary pill tags on the row */}
                                    {row.serializedUnits && row.serializedUnits.length > 0 && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
                                        <span style={{
                                          fontSize: '10px',
                                          fontWeight: 700,
                                          color: '#15803d',
                                          background: '#dcfce7',
                                          border: '1px solid #86efac',
                                          padding: '1px 6px',
                                          borderRadius: '4px',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px'
                                        }}>
                                          <CheckCircle2 size={10} color="#16a34a" />
                                          <span>{inStockUnits.length} In Stock</span>
                                        </span>
                                        {usedUnits.length > 0 && (
                                          <span style={{
                                            fontSize: '10px',
                                            fontWeight: 700,
                                            color: '#b45309',
                                            background: '#fef3c7',
                                            border: '1px solid #fde68a',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px'
                                          }}>
                                            <Wrench size={10} color="#d97706" />
                                            <span>{usedUnits.length} Used</span>
                                          </span>
                                        )}
                                        {otherUnits.length > 0 && (
                                          <span style={{
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            color: '#475569',
                                            background: '#f1f5f9',
                                            border: '1px solid #e2e8f0',
                                            padding: '1px 6px',
                                            borderRadius: '4px'
                                          }}>
                                            {otherUnits.length} Other
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#64748b' }}>
                                    <Lock size={13} color="#94a3b8" />
                                    <span style={{ fontStyle: 'italic' }}>
                                      {`Serials restricted to ${currentActiveMultiSite.code} authorized staff`}
                                    </span>
                                  </div>
                                )}
                              </td>

                              <td style={{ verticalAlign: 'top', textAlign: 'center', padding: '12px 16px' }}>
                                {!isSuperadmin ? (
                                  isOwnSite ? (
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      style={{ fontSize: '11px', padding: '4px 10px', color: '#059669', borderColor: '#a7f3d0', background: '#ecfdf5' }}
                                      onClick={() => {
                                        setMarkUsedPartPn(row.partNumber);
                                        setIsMarkUsedModalOpen(true);
                                      }}
                                      title="Mark this part as consumed in a repair work order"
                                    >
                                      <Wrench size={11} />
                                      <span>Mark Used</span>
                                    </button>
                                  ) : (
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      style={{ fontSize: '11px', padding: '4px 10px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff' }}
                                      onClick={() => handleQuickRequestPart(row.partNumber, currentActiveMultiSite.name)}
                                      title={`Request replenishment/transfer for ${row.partNumber} from ${currentActiveMultiSite.name}`}
                                    >
                                      <Send size={11} />
                                      <span>Request Transfer</span>
                                    </button>
                                  )
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>
                                    Master DC View
                                  </span>
                                )}
                              </td>
                            </tr>

                            {/* Expanded Serials Sub-Row */}
                            {isExpanded && canSeeFullDetails && (
                              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                                <td colSpan={5} style={{ padding: '14px 20px' }}>
                                  <div style={{
                                    background: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    boxShadow: '0 2px 8px -2px rgba(15, 23, 42, 0.06)',
                                    padding: '16px'
                                  }}>
                                    {/* Header bar of expanded section */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#f0f9ff', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Boxes size={16} />
                                        </div>
                                        <div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                                              Serialized Inventory: {row.partNumber}
                                            </span>
                                            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                                              ({row.serializedUnits?.length || 0} total units recorded)
                                            </span>
                                          </div>
                                          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                                            {row.description} — {currentActiveMultiSite.name} ({currentActiveMultiSite.code})
                                          </span>
                                        </div>
                                      </div>

                                      {/* Status Breakdown Pills & Copy Action */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span style={{
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          color: '#15803d',
                                          background: '#dcfce7',
                                          border: '1px solid #86efac',
                                          padding: '3px 10px',
                                          borderRadius: '999px',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px'
                                        }}>
                                          <CheckCircle2 size={12} color="#16a34a" />
                                          <span>{inStockUnits.length} In Stock</span>
                                        </span>

                                        {usedUnits.length > 0 && (
                                          <span style={{
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#b45309',
                                            background: '#fef3c7',
                                            border: '1px solid #fde68a',
                                            padding: '3px 10px',
                                            borderRadius: '999px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                          }}>
                                            <Wrench size={12} color="#d97706" />
                                            <span>{usedUnits.length} Used / Consumed</span>
                                          </span>
                                        )}

                                        {otherUnits.length > 0 && (
                                          <span style={{
                                            fontSize: '11px',
                                            fontWeight: 700,
                                            color: '#475569',
                                            background: '#f1f5f9',
                                            border: '1px solid #cbd5e1',
                                            padding: '3px 10px',
                                            borderRadius: '999px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                          }}>
                                            <span>{otherUnits.length} Other</span>
                                          </span>
                                        )}

                                        <button
                                          type="button"
                                          onClick={() => {
                                            const allSerials = (row.serializedUnits || []).map(u => u.serialNumber).filter(Boolean).join('\n');
                                            navigator.clipboard.writeText(allSerials);
                                            showToast(`Copied ${row.serializedUnits.length} serials to clipboard`, 'success');
                                          }}
                                          className="btn btn-secondary btn-xs"
                                          style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '5px', display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}
                                          title="Copy all serials to clipboard"
                                        >
                                          <Copy size={11} />
                                          <span>Copy All Serials</span>
                                        </button>
                                      </div>
                                    </div>

                                    {/* Units Responsive Grid with clean scroll */}
                                    <div style={{
                                      marginTop: '14px',
                                      maxHeight: '440px',
                                      overflowY: 'auto',
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                                      gap: '10px',
                                      padding: '2px'
                                    }}>
                                      {(row.serializedUnits || []).map((u, uIdx) => {
                                        const isAddedByCurUser = isSuperadmin || Boolean(currentUser?.id && (u.added_by_user_id === currentUser?.id || u.received_by_id === currentUser?.id));
                                        const canManageUnit = isSuperadmin || isOwnSite || isAddedByCurUser;
                                        const isMaskedUnit = u.isMasked || (!isSuperadmin && !isOwnSite && !isAddedByCurUser);
                                        const statusLower = String(u.status || '').toLowerCase();
                                        const isInStock = statusLower === 'in_stock' || statusLower === 'available';
                                        const isUsed = statusLower === 'used' || statusLower === 'consumed';

                                        return (
                                          <div
                                            key={u.id || uIdx}
                                            style={{
                                              padding: '10px 12px',
                                              borderRadius: '8px',
                                              background: isInStock ? '#ffffff' : '#fffbeb',
                                              border: `1px solid ${isInStock ? '#bbf7d0' : '#fde68a'}`,
                                              borderLeft: `4px solid ${isInStock ? '#16a34a' : (isUsed ? '#d97706' : '#94a3b8')}`,
                                              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '6px'
                                            }}
                                          >
                                            {/* Line 1: Status Badge + Serial Number + Copy + Actions */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                                {/* Prominently Highlight IN STOCK vs USED */}
                                                {isInStock ? (
                                                  <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: 800,
                                                    color: '#15803d',
                                                    background: '#dcfce7',
                                                    border: '1px solid #86efac',
                                                    padding: '2px 7px',
                                                    borderRadius: '4px',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    letterSpacing: '0.04em',
                                                    flexShrink: 0
                                                  }}>
                                                    <CheckCircle2 size={11} color="#16a34a" />
                                                    <span>IN STOCK</span>
                                                  </span>
                                                ) : isUsed ? (
                                                  <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: 800,
                                                    color: '#92400e',
                                                    background: '#fef3c7',
                                                    border: '1px solid #fcd34d',
                                                    padding: '2px 7px',
                                                    borderRadius: '4px',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '3px',
                                                    letterSpacing: '0.04em',
                                                    flexShrink: 0
                                                  }}>
                                                    <Wrench size={11} color="#d97706" />
                                                    <span>USED</span>
                                                  </span>
                                                ) : (
                                                  <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: 700,
                                                    color: '#475569',
                                                    background: '#f1f5f9',
                                                    border: '1px solid #cbd5e1',
                                                    padding: '2px 7px',
                                                    borderRadius: '4px',
                                                    letterSpacing: '0.04em',
                                                    flexShrink: 0
                                                  }}>
                                                    {String(u.status || 'OTHER').toUpperCase()}
                                                  </span>
                                                )}

                                                {/* Serial Number */}
                                                {isMaskedUnit ? (
                                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ fontFamily: 'var(--font-mono)', color: '#94a3b8', fontSize: '11.5px', letterSpacing: '0.05em' }}>••••••••••••••••</span>
                                                    <span className="badge" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '9px', padding: '1px 4px', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                                      <Lock size={9} /> Protected
                                                    </span>
                                                  </span>
                                                ) : (
                                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '12px', color: '#0f172a', letterSpacing: '0.02em' }}>
                                                      {u.serialNumber}
                                                    </span>
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        navigator.clipboard.writeText(u.serialNumber);
                                                        showToast(`Copied ${u.serialNumber}`, 'info');
                                                      }}
                                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: '2px', display: 'flex', alignItems: 'center' }}
                                                      title="Copy serial number"
                                                    >
                                                      <Copy size={11} />
                                                    </button>
                                                  </div>
                                                )}
                                              </div>

                                              {/* Actions (Edit/Delete) */}
                                              {canManageUnit && !isMaskedUnit && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                                  <button
                                                    type="button"
                                                    className="btn btn-secondary btn-xs"
                                                    style={{ padding: '2px 6px', fontSize: '10.5px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                                    onClick={() => openEditUnitModal(u)}
                                                    title="Update box number or work order notes"
                                                  >
                                                    <Edit3 size={11} />
                                                    <span>Edit</span>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    className="btn btn-secondary btn-xs"
                                                    style={{ padding: '2px 6px', fontSize: '10.5px', color: '#ef4444', borderColor: '#fca5a5', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                                    onClick={() => setUnitToDelete(u)}
                                                    title="Delete unit from this branch"
                                                  >
                                                    <Trash2 size={11} />
                                                    <span>Delete</span>
                                                  </button>
                                                </div>
                                              )}
                                            </div>

                                            {/* Line 2: Box, Work Order, Notes */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#64748b', flexWrap: 'wrap', marginTop: '2px' }}>
                                              <span style={{ background: '#f1f5f9', color: '#334155', fontWeight: 600, padding: '1px 6px', borderRadius: '4px' }}>
                                                Box #{u.boxNumber || 1}
                                              </span>
                                              {u.work_order_number && (
                                                <span style={{ color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                                  WO: {u.work_order_number}
                                                </span>
                                              )}
                                              {u.notes && (
                                                <span style={{ color: '#64748b', fontStyle: 'italic' }}>
                                                  {u.notes}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* 8. TAB 4: Used Parts Historical Usage & Live Consumed Units Log */}
      {activeTab === 'usage_history' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', background: '#f8fafc' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={18} color="#059669" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  Used Parts & Repair Consumption — {activeSiteObj.name}
                </h3>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                Live serialized tracking of parts consumed in branch repair work orders and historical consumption datasets.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Sub-tab pills */}
              <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '8px', padding: '3px', gap: '2px' }}>
                <button
                  type="button"
                  onClick={() => setUsedHistorySubTab('live_log')}
                  style={{
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: usedHistorySubTab === 'live_log' ? '#ffffff' : 'transparent',
                    color: usedHistorySubTab === 'live_log' ? '#0f172a' : '#64748b',
                    boxShadow: usedHistorySubTab === 'live_log' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Zap size={12} color="#059669" />
                  <span>Live Consumed Log ({liveUsedUnitsLog.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUsedHistorySubTab('aggregated_data')}
                  style={{
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: usedHistorySubTab === 'aggregated_data' ? '#ffffff' : 'transparent',
                    color: usedHistorySubTab === 'aggregated_data' ? '#0f172a' : '#64748b',
                    boxShadow: usedHistorySubTab === 'aggregated_data' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <History size={12} color="#0284c7" />
                  <span>Historical Summary ({siteUsageData.summaryList.length})</span>
                </button>
              </div>

              {usedHistorySubTab === 'live_log' ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  onClick={handleExportLiveUsedLogToXlsx}
                  title="Export Live Used Parts to Excel"
                >
                  <FileSpreadsheet size={13} />
                  <span>Export Log (.xlsx)</span>
                </button>
              ) : null}

              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700 }}
                onClick={() => openMarkUsedModal()}
                title="Record part used/consumed in repair"
              >
                <Wrench size={13} />
                <span>Record Part Used</span>
              </button>
            </div>
          </div>

          {/* Sub-View 1: Live Used Units Log */}
          {usedHistorySubTab === 'live_log' && (
            <div>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    className="form-input"
                    style={{ paddingLeft: '32px', fontSize: '12.5px' }}
                    placeholder="Search by serial #, part #, work order, technician..."
                    value={usedLogSearchQuery}
                    onChange={(e) => setUsedLogSearchQuery(e.target.value)}
                  />
                </div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Showing <strong>{liveUsedUnitsLog.length}</strong> consumed serialized parts
                </span>
              </div>

              <div className="table-container" style={{ overflowX: 'auto' }}>
                {liveUsedUnitsLog.length === 0 ? (
                  <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                    <Wrench size={36} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                    <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px' }}>No Parts Recorded as Used Yet</h4>
                    <p style={{ margin: '0 0 16px', fontSize: '12.5px' }}>
                      When PMG technicians consume parts during repair work orders, mark them here to update real-time stock levels.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ background: '#059669', borderColor: '#059669' }}
                      onClick={() => openMarkUsedModal()}
                    >
                      <Wrench size={13} />
                      <span>Record First Used Part</span>
                    </button>
                  </div>
                ) : (
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                        <th style={{ minWidth: '100px' }}>Site Location</th>
                        <th style={{ minWidth: '150px' }}>Part Number</th>
                        <th style={{ minWidth: '220px' }}>Part Description</th>
                        <th style={{ minWidth: '180px' }}>Serial Number</th>
                        <th style={{ minWidth: '150px' }}>Work Order / Repair #</th>
                        <th style={{ minWidth: '150px' }}>Date & Time Used</th>
                        <th style={{ minWidth: '140px' }}>Used By</th>
                        <th style={{ minWidth: '180px' }}>Usage Notes</th>
                        {canRestore && <th style={{ width: '110px', textAlign: 'center' }}>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {liveUsedUnitsLog.map((u, idx) => (
                        <tr key={u.id || u.serial_number || idx}>
                          <td style={{ textAlign: 'center', fontSize: '11.5px', color: '#94a3b8' }}>
                            {idx + 1}
                          </td>
                          <td>
                            <span
                              className="badge"
                              style={{
                                background: '#fffbeb',
                                color: '#b45309',
                                border: '1px solid #fde68a',
                                fontSize: '11px',
                                fontWeight: 700
                              }}
                            >
                              {u.site_code || u.site_name || resolveSite(u.current_site_id || u.site_id || u.siteId, sites)?.code || activeSiteObj?.code || 'BRANCH'}
                            </span>
                          </td>
                          <td>
                            <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                              {u.part_number}
                            </strong>
                          </td>
                          <td style={{ fontSize: '12.5px', color: '#1e293b' }}>
                            {u.description || 'Apple Replacement Part'}
                          </td>
                          <td>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700,
                                fontSize: '12px',
                                background: '#f1f5f9',
                                padding: '3px 7px',
                                borderRadius: '4px',
                                color: '#0f172a',
                                border: '1px solid #cbd5e1'
                              }}
                            >
                                {getCleanDisplaySerial(u.serial_number, u)}
                            </span>
                          </td>
                          <td>
                            {u.work_order_number ? (
                              <span
                                className="badge"
                                style={{
                                  background: '#e0f2fe',
                                  color: '#0369a1',
                                  border: '1px solid #bae6fd',
                                  fontSize: '11.5px',
                                  fontWeight: 700
                                }}
                              >
                                {u.work_order_number}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '11.5px' }}>
                                General Repair
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: '12px', color: '#475569' }}>
                            {u.used_at ? formatTo12HourDateTime(u.used_at) : 'Recent'}
                          </td>
                          <td style={{ fontSize: '12px', color: '#0f172a', fontWeight: 600 }}>
                            {u.used_by_name || u.used_by || 'Branch Specialist'}
                          </td>
                          <td style={{ fontSize: '12px', color: '#64748b' }}>
                            {u.usage_notes || u.notes || '—'}
                          </td>
                          {canRestore && (
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{
                                  fontSize: '11px',
                                  padding: '3px 8px',
                                  color: '#475569',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}
                                onClick={() => {
                                  if (window.confirm(`Restore serial ${getCleanDisplaySerial(u.serial_number, u)} back to In-Stock status?`)) {
                                    unmarkUnitAsUsed(u.serial_number);
                                  }
                                }}
                                title="Undo: Revert this part back to In-Stock inventory"
                              >
                                <RotateCcw size={11} />
                                <span>Revert</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Sub-View 2: Aggregated Historical Datasets */}
          {usedHistorySubTab === 'aggregated_data' && (
            <div className="table-container" style={{ overflowX: 'auto' }}>
              {siteUsageData.summaryList.length === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                  <TrendingDown size={36} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                  <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px' }}>No Historical Usage Records</h4>
                  <p style={{ margin: 0, fontSize: '12.5px' }}>
                    No repair usage records are associated with {activeSiteObj.name}.
                  </p>
                </div>
              ) : (
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ minWidth: '160px' }}>Part Number</th>
                      <th style={{ minWidth: '260px' }}>Part Description</th>
                      <th style={{ textAlign: 'center', width: '130px' }}>Total Consumed</th>
                      <th style={{ minWidth: '220px' }}>Monthly Consumption Breakdown</th>
                      <th style={{ textAlign: 'center', width: '120px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteUsageData.summaryList.map(item => (
                      <tr key={item.partNumber}>
                        <td>
                          <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                            {item.partNumber}
                          </strong>
                        </td>
                        <td style={{ fontSize: '12.5px', color: '#1e293b' }}>
                          {item.description || 'Apple Replacement Part'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge badge-primary" style={{ fontSize: '12px', fontWeight: 800 }}>
                            {item.totalUsed} used
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {Object.entries(item.byMonth || {}).map(([mo, cnt]) => (
                              <span
                                key={mo}
                                style={{
                                  fontSize: '11px',
                                  background: '#f1f5f9',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  color: '#334155'
                                }}
                              >
                                {mo}: <strong>{cnt}</strong>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11px', padding: '3px 8px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff' }}
                            onClick={() => handleQuickRequestPart(item.partNumber)}
                          >
                            <Plus size={12} />
                            <span>Request</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* 9. Status Action Modal (Superadmin Review & Authority) */}
      {actionModalRequest && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActionModalRequest(null);
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '480px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              padding: '24px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  {actionTargetStatus === 'approved' ? 'Approve Parts Request (Superadmin)' : actionTargetStatus === 'rejected' ? 'Deny Parts Request (Superadmin)' : 'Fulfill Parts Request'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActionModalRequest(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '12.5px', border: '1px solid #e2e8f0' }}>
              <div>Request #: <strong>{actionModalRequest.request_number}</strong></div>
              <div>Part: <strong>{actionModalRequest.part_number}</strong> — {actionModalRequest.part_description}</div>
              <div>Quantity: <strong>{actionModalRequest.quantity_requested} units</strong></div>
              <div>Requesting Branch: <strong>{actionModalRequest.site_name}</strong></div>
              <div>Requester: <strong>{actionModalRequest.requested_by_name}</strong></div>
            </div>

            {actionTargetStatus === 'fulfilled' && (
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label">Quantity Fulfilled</label>
                <input
                  type="number"
                  min="1"
                  max={actionModalRequest.quantity_requested}
                  className="form-input"
                  value={actionQtyFulfilled}
                  onChange={(e) => setActionQtyFulfilled(parseInt(e.target.value, 10) || 1)}
                />
              </div>
            )}

            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Superadmin Review Notes / Instructions</label>
              <textarea
                className="form-input"
                rows="3"
                placeholder="Add approval notes or denial reason for the requesting branch..."
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActionModalRequest(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExecuteStatusAction}
                style={{
                  background: actionTargetStatus === 'approved' ? '#059669' : actionTargetStatus === 'rejected' ? '#dc2626' : '#0284c7'
                }}
              >
                Confirm {actionTargetStatus === 'rejected' ? 'DENY' : actionTargetStatus.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Record Used Part / Repair Consumption Modal */}
      {isMarkUsedModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmittingMarkUsed) setIsMarkUsedModalOpen(false);
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '580px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              padding: '24px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ background: '#dcfce7', padding: '6px', borderRadius: '8px', display: 'flex' }}>
                  <Wrench size={18} color="#059669" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    Record Part(s) as Used / Consumed
                  </h3>
                  <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>
                    Branch: <strong>{activeSiteObj.name} ({activeSiteObj.code})</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMarkUsedModalOpen(false)}
                disabled={isSubmittingMarkUsed}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleConfirmMarkAsUsed}>
              {/* Part Number Selection */}
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Apple Part Number *</label>
                <select
                  className="form-input"
                  value={markUsedPartPn}
                  onChange={(e) => {
                    setMarkUsedPartPn(e.target.value);
                    setMarkUsedSerials([]);
                    setSerialSearchFilter('');
                  }}
                  required
                >
                  <option value="">-- Select Part in Branch Stock --</option>
                  {stockRows.filter(r => r.inStock > 0).map(r => (
                    <option key={r.partNumber} value={r.partNumber}>
                      {r.partNumber} — {r.description} ({r.inStock} in stock)
                    </option>
                  ))}
                  {/* Also include all other parts in catalog in case of ad-hoc scan */}
                  {parts.filter(p => !stockRows.some(r => r.partNumber === p.part_number && r.inStock > 0)).map(p => (
                    <option key={p.id || p.part_number} value={p.part_number}>
                      {p.part_number} — {p.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Bar & Check Serials */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 700, fontSize: '12.5px' }}>
                    Serial Number Search & Selection *
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {availableSerialsForMarkUsed.length > 0 && (
                      <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600, background: '#ecfdf5', padding: '2px 7px', borderRadius: '4px' }}>
                        {availableSerialsForMarkUsed.length} available in branch
                      </span>
                    )}
                    {markUsedSerials.length > 0 && (
                      <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>
                        {markUsedSerials.length} checked
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary Search & Paste Bar */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <Search size={16} color="#64748b" style={{ position: 'absolute', left: '12px', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Paste or type serial number here..."
                    value={serialSearchFilter}
                    onChange={(e) => setSerialSearchFilter(e.target.value)}
                    onPaste={handlePasteInSearchBar}
                    autoFocus
                    style={{
                      paddingLeft: '36px',
                      paddingRight: serialSearchFilter ? '32px' : '12px',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      height: '42px',
                      borderRadius: '8px',
                      border: '1.5px solid #2563eb',
                      background: '#f8fafc',
                      boxShadow: '0 1px 3px rgba(37, 99, 235, 0.08)'
                    }}
                  />
                  {serialSearchFilter && (
                    <button
                      type="button"
                      onClick={() => setSerialSearchFilter('')}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#94a3b8',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    {serialSearchFilter.trim() ? (
                      <span>Showing matching serials for: <strong>"{serialSearchFilter.trim()}"</strong></span>
                    ) : (
                      <span>Paste serial from GSX/Dispatch, or select from branch stock:</span>
                    )}
                  </span>
                  {displayedSerials.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={handleSelectAllDisplayedSerials}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#2563eb',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        Check All ({displayedSerials.length})
                      </button>
                      {markUsedSerials.length > 0 && (
                        <>
                          <span>•</span>
                          <button
                            type="button"
                            onClick={handleDeselectAllSerials}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              padding: 0
                            }}
                          >
                            Uncheck All
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Serials List with Checkbox */}
                <div style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  background: '#ffffff',
                  maxHeight: '175px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '6px'
                }}>
                  {displayedSerials.map((item) => {
                    const isChecked = markUsedSerials.includes(item.serial_number);
                    return (
                      <div
                        key={item.serial_number}
                        onClick={() => handleToggleMarkUsedSerial(item.serial_number)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          border: isChecked ? '1.5px solid #059669' : '1px solid #f1f5f9',
                          background: isChecked ? '#ecfdf5' : '#ffffff',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          {/* Checkbox */}
                          <div style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '4px',
                            border: isChecked ? '1.5px solid #059669' : '1.5px solid #94a3b8',
                            background: isChecked ? '#059669' : '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            flexShrink: 0
                          }}>
                            {isChecked && <Check size={12} strokeWidth={3} />}
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12.5px',
                              fontWeight: isChecked ? 700 : 600,
                              color: isChecked ? '#065f46' : '#0f172a',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>
                              {getCleanDisplaySerial(item.serial_number, item)}
                            </div>
                            <div style={{ fontSize: '10.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1px' }}>
                              <span>Box {item.box_number || 1}</span>
                              <span>•</span>
                              {item.inStock ? (
                                <span style={{ color: '#059669', fontWeight: 600 }}>In Branch Stock</span>
                              ) : (
                                <span style={{ color: '#d97706', fontWeight: 600 }}>Pasted / Manual Serial</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Tag */}
                        <div style={{ flexShrink: 0, marginLeft: '8px' }}>
                          {isChecked ? (
                            <span style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              color: '#059669',
                              background: '#dcfce7',
                              padding: '2px 8px',
                              borderRadius: '4px'
                            }}>
                              Checked to Consume
                            </span>
                          ) : (
                            <span style={{
                              fontSize: '10.5px',
                              fontWeight: 500,
                              color: '#94a3b8',
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              padding: '2px 7px',
                              borderRadius: '4px'
                            }}>
                              Click to Check
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {displayedSerials.length === 0 && (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                      <p style={{ margin: '0 0 6px 0', fontWeight: 600, color: '#334155' }}>
                        No serial matching "{serialSearchFilter}"
                      </p>
                      {serialSearchFilter.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            const custom = serialSearchFilter.trim().toUpperCase();
                            setMarkUsedSerials(prev => Array.from(new Set([...prev, custom])));
                          }}
                          className="btn btn-secondary"
                          style={{ fontSize: '11px', padding: '4px 10px' }}
                        >
                          Check "{serialSearchFilter.trim().toUpperCase()}" as Custom Serial
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Checked Serials Notification */}
                {markUsedSerials.length > 0 ? (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span style={{ fontSize: '11.5px', color: '#166534', fontWeight: 600 }}>
                        {markUsedSerials.length} serial{markUsedSerials.length > 1 ? 's' : ''} checked for consumption: <strong>{markUsedSerials.join(', ')}</strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeselectAllSerials}
                      style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div style={{
                    marginTop: '8px',
                    padding: '7px 10px',
                    background: '#fffbeb',
                    border: '1px dashed #fcd34d',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#92400e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <AlertTriangle size={13} color="#d97706" style={{ flexShrink: 0 }} />
                    <span>Paste your serial in the search bar above and check it to proceed.</span>
                  </div>
                )}
              </div>

              {/* Work Order / Repair Reference */}
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Repair Work Order / GSX Reference #</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. WO-2026-8812 or GSX-994812"
                  value={markUsedWorkOrder}
                  onChange={(e) => setMarkUsedWorkOrder(e.target.value)}
                />
              </div>

              {/* Usage Notes */}
              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label className="form-label">Usage Notes / Repair Summary</label>
                <textarea
                  className="form-input"
                  rows="2"
                  placeholder="e.g. Rear camera replaced on iPhone 15 Pro, customer pickup completed"
                  value={markUsedNotes}
                  onChange={(e) => setMarkUsedNotes(e.target.value)}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsMarkUsedModalOpen(false)}
                  disabled={isSubmittingMarkUsed}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    background: '#059669',
                    borderColor: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 700
                  }}
                  disabled={isSubmittingMarkUsed || (markUsedSerials.length === 0 && !serialSearchFilter.trim())}
                >
                  <Check size={14} />
                  <span>
                    {isSubmittingMarkUsed
                      ? 'Recording...'
                      : markUsedSerials.length > 1
                      ? `Confirm ${markUsedSerials.length} Parts Used`
                      : 'Confirm Part Used'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. Delete Confirmation Modal for Branch Unit */}
      {unitToDelete && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }} onClick={(e) => { if (e.target === e.currentTarget) setUnitToDelete(null); }}>
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Trash2 size={18} color="#ef4444" />
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>Delete Stock Unit</h3>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setUnitToDelete(null)}
                disabled={isDeletingUnit}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 0' }}>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
                Are you sure you want to delete this part unit from branch stock? This action cannot be undone.
              </p>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#64748b' }}>Serial Number:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0f172a' }}>{getCleanDisplaySerial(unitToDelete.serial_number || unitToDelete.serialNumber, unitToDelete)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#64748b' }}>Part Number:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0284c7' }}>{unitToDelete.part_number || unitToDelete.partNumber}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Branch / Location:</span>
                  <span style={{ fontWeight: 600 }}>{unitToDelete.site_code || unitToDelete.siteCode || 'Branch'}</span>
                </div>
              </div>

              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '5px' }}>
                  Reason for Deletion:
                </label>
                <select
                  className="form-select"
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                  style={{ width: '100%', fontSize: '12.5px', marginBottom: '8px' }}
                >
                  <option value="Defective / Damaged Part">Defective / Damaged Part</option>
                  <option value="Wrong Serial Scanned">Wrong Serial Scanned</option>
                  <option value="Barcode Mismatch">Barcode Mismatch</option>
                  <option value="Return to Supplier / Vendor">Return to Supplier / Vendor</option>
                  <option value="OTHER">Other Reason (Specify)</option>
                </select>
                {deletionReason === 'OTHER' && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter reason for deletion..."
                    value={customDeletionReason}
                    onChange={(e) => setCustomDeletionReason(e.target.value)}
                    style={{ width: '100%', fontSize: '12px' }}
                    autoFocus
                  />
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setUnitToDelete(null)}
                disabled={isDeletingUnit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#ef4444', borderColor: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                onClick={handleConfirmDeleteUnit}
                disabled={isDeletingUnit}
              >
                <Trash2 size={14} />
                <span>{isDeletingUnit ? 'Deleting...' : 'Delete Unit'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Edit Unit Details Modal */}
      {unitToEdit && (
        <div className="modal-backdrop" style={{ zIndex: 9999 }} onClick={(e) => { if (e.target === e.currentTarget) setUnitToEdit(null); }}>
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Edit3 size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>Edit Stock Unit Details</h3>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setUnitToEdit(null)}
                disabled={isSubmittingEdit}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleConfirmEditUnit} style={{ padding: '16px 0 0' }}>
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#0369a1' }}>Serial Number:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0f172a' }}>{getCleanDisplaySerial(unitToEdit.serial_number || unitToEdit.serialNumber, unitToEdit)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#0369a1' }}>Part Number:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0284c7' }}>{unitToEdit.part_number || unitToEdit.partNumber}</strong>
                </div>
              </div>

              {/* Box Number */}
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Box / Bin Number</label>
                <input
                  type="number"
                  min="1"
                  max="999"
                  className="form-input"
                  value={editBoxNumber}
                  onChange={(e) => setEditBoxNumber(e.target.value)}
                  required
                />
              </div>

              {/* Repair Work Order Reference */}
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Repair Work Order / GSX Reference #</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. WO-2026-9041"
                  value={editWorkOrder}
                  onChange={(e) => setEditWorkOrder(e.target.value)}
                />
              </div>

              {/* Usage / Branch Notes */}
              <div className="form-group" style={{ marginBottom: '18px' }}>
                <label className="form-label">Unit Notes / Storage Location</label>
                <textarea
                  className="form-input"
                  rows="2"
                  placeholder="e.g. Assigned to Bay 2, awaiting customer pickup"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setUnitToEdit(null)}
                  disabled={isSubmittingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: '#0284c7', borderColor: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                  disabled={isSubmittingEdit}
                >
                  <Check size={14} />
                  <span>{isSubmittingEdit ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9.5 Clear Site Parts Modal (Superadmin Only) */}
      {isSuperadmin && clearPartsModalState && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="modal-dialog" style={{ background: '#ffffff', borderRadius: '12px', maxWidth: '500px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)', border: '1px solid #fecaca', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ padding: '6px', background: '#fee2e2', borderRadius: '8px', color: '#dc2626' }}>
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#991b1b' }}>
                    {clearPartsModalState.isAllSites ? 'Clear All Retail Sites Parts' : `Clear Parts — ${clearPartsModalState.siteName}`}
                  </h3>
                  <div style={{ fontSize: '11px', color: '#b91c1c' }}>
                    {clearPartsModalState.isAllSites ? 'Network-wide branch inventory purge' : `Target: ${clearPartsModalState.siteCode}`}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClearPartsModalState(null)}
                disabled={isClearingSiteParts}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
                {clearPartsModalState.isAllSites ? (
                  <>
                    Are you sure you want to clear <strong>all {clearPartsModalState.count} parts</strong> across all {branchSitesCount} retail branch sites?
                    <div style={{ marginTop: '6px', color: '#64748b', fontSize: '11.5px' }}>
                      This will remove previous stock previously shipped by DC to all retail sites, creating a clean slate for importing updated inventory records (CSV / XLSX). <em>Central DC stock is strictly preserved.</em>
                    </div>
                  </>
                ) : (
                  <>
                    Are you sure you want to clear <strong>{clearPartsModalState.count} parts</strong> from <strong>{clearPartsModalState.siteName} ({clearPartsModalState.siteCode})</strong>?
                    <div style={{ marginTop: '6px', color: '#64748b', fontSize: '11.5px' }}>
                      This will remove previous DC-shipped stock for this branch so you can import the latest records without duplicates.
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '11.5px', color: '#92400e' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>Cleared parts will be removed from local storage and cloud database. You can import new records anytime.</span>
                </div>
                <div style={{ borderTop: '1px dashed #fcd34d', paddingTop: '6px', fontSize: '11px', color: '#78350f', fontWeight: 600 }}>
                  ✓ <strong>Shipment Records Protected:</strong> All DC shipments, packing lists, dispatches, and delivery logs are 100% preserved. The clear feature applies strictly to site inventory parts.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isClearingSiteParts}
                  onClick={() => setClearPartsModalState(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{
                    background: '#dc2626',
                    borderColor: '#dc2626',
                    color: '#ffffff',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 16px'
                  }}
                  disabled={isClearingSiteParts}
                  onClick={handleConfirmClearParts}
                >
                  {isClearingSiteParts ? (
                    <>
                      <RefreshCw size={13} className="spin" />
                      <span>Clearing Parts...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={13} />
                      <span>Confirm Clear Parts</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 10. Site Receipt Confirmation Modal with Signed PL Upload & Google Drive Auto-Sync */}
      <ConfirmReceiveModal
        isOpen={Boolean(receiveModalState)}
        shipment={receiveModalState?.shipment}
        site={receiveModalState?.site}
        shipments={shipments}
        currentUser={currentUser}
        isSuperadmin={isSuperadmin}
        supervisorSettings={supervisorSettings}
        onClose={() => setReceiveModalState(null)}
        onConfirmed={handleConfirmSiteReceiveSubmit}
        showToast={showToast}
      />

      {/* Lightweight Status Transition / Confirm Package Loading Screen */}
      <StatusChangeLoadingModal {...statusLoadingState} />

      {/* 11. All Stocks & Multi-Site XLSX / CSV Import Modal */}
      <AllStocksImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        defaultFileType={importModalFileType}
        sites={sites}
        parts={parts}
        setParts={setParts}
        inventoryUnits={inventoryUnits}
        batchAddScanInUnits={batchAddScanInUnits}
        clearSiteParts={clearSiteParts}
        isSuperadmin={isSuperadmin}
        showToast={showToast}
        broadcastCloudEvent={broadcastCloudEvent}
        onSuccess={() => {
          if (typeof autoRefreshData === 'function') autoRefreshData();
          if (typeof fetchPartsRequests === 'function') fetchPartsRequests();
        }}
      />

      {/* 12. Serial Number Intelligence Dossier Modal */}
      {inspectedSerialDetails && (
        <SerialDossierModal
          serialDetails={inspectedSerialDetails}
          onClose={() => setInspectedSerialDetails(null)}
          onNavigateTab={(tab) => {
            if (tab === 'all-stocks' && inspectedSerialDetails?.siteId) {
              const sObj = sites.find(s => s.id === inspectedSerialDetails.siteId || s.code === inspectedSerialDetails.siteCode);
              const rKey = isProvincialSite(sObj) ? 'provincial' : 'metro_manila';
              setAllStocksRegionTab(rKey);
              setAllStocksSelectedSiteId(inspectedSerialDetails.siteId);
            }
          }}
        />
      )}
    </div>
  );
}
