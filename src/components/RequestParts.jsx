import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite, isUUID } from '../utils/appContextHelpers';
import { isProvincialSite, isDisplayOrBatteryForIPhone13Plus } from '../utils/partResolver';
import { getCategoryForPart, getCategoryBadgeStyle } from '../utils/categoryFilter';
import { defaultPartsCatalog } from '../data/defaultCatalog';
import * as XLSX from 'xlsx';
import { formatTo12HourTime, formatTo12HourDateTime } from '../utils/dateUtils';
import StatusChangeLoadingModal from './StatusChangeLoadingModal';
import {
  Inbox,
  Send,
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

export default function RequestParts({ defaultTab = 'requests_table' }) {
  const {
    currentUser,
    sites = [],
    parts = [],
    categories = [],
    inventoryUnits = [],
    partsRequests = [],
    shipments = [],
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
    updateUnitDetails,
    fetchPartsRequests,
    isLoadingPartsRequests,
    showToast,
    isAutoRefreshing,
    autoRefreshData,
    pmgSubTab,
    setPmgSubTab
  } = useApp();

  const isSuperadmin = currentUser?.role === 'superadmin';
  const isPmgUser = currentUser?.role === 'parts_management';

  // User site resolution (Superadmin is explicitly Central DC, not retail branches)
  const userSiteObj = useMemo(() => {
    if (isSuperadmin || currentUser?.siteId === 'site-dc') {
      return sites.find(s => s.id === 'site-dc' || s.code === 'DC-MDC' || s.code === 'DC') || { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center (DC)' };
    }
    return sites.find(s => s.id === currentUser?.siteId || s.code === currentUser?.siteId) || sites[0] || {};
  }, [sites, currentUser?.siteId, isSuperadmin]);

  // Selected site filter
  const [selectedSiteId, setSelectedSiteId] = useState(() => {
    if (!isSuperadmin && currentUser?.siteId) {
      return currentUser.siteId;
    }
    return 'ALL';
  });

  const activeSiteObj = useMemo(() => {
    if (selectedSiteId === 'ALL') {
      return { id: 'ALL', code: 'ALL', name: 'All Branch Sites' };
    }
    return sites.find(s => s.id === selectedSiteId || s.code === selectedSiteId) || userSiteObj;
  }, [sites, selectedSiteId, userSiteObj]);

  // Active Sub-Tab: 'requests_table' | 'stock_on_hand' | 'all_stocks' | 'usage_history'
  const [activeTab, setActiveTab] = useState(pmgSubTab || defaultTab);

  useEffect(() => {
    if (pmgSubTab) {
      setActiveTab(pmgSubTab);
    } else if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [pmgSubTab, defaultTab]);

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    if (setPmgSubTab) {
      setPmgSubTab(newTab);
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
  const [markUsedSerial, setMarkUsedSerial] = useState('');
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
  const [stockCategoryFilter, _setStockCategoryFilter] = useState('ALL');

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

  // Superadmin Site Receipt Confirmation Modal State
  const [receiveModalState, setReceiveModalState] = useState(null);
  const [isSubmittingReceive, setIsSubmittingReceive] = useState(false);
  const [statusLoadingState, setStatusLoadingState] = useState(null);

  const handleOpenReceiveModal = (shipment) => {
    const destSite = sites.find(st => st.id === shipment.site_id || st.code === shipment.site_code) || activeSiteObj;
    setReceiveModalState({
      shipment,
      site: destSite,
      receivedByName: currentUser?.fullName || (isSuperadmin ? 'Superadmin' : `${destSite.code || 'Branch'} Staff`),
      receivedDate: new Date().toISOString().split('T')[0],
      receivedCondition: 'Good Condition (All parts intact & verified)',
      receivingNotes: `Confirmed physical receipt of shipment manifest #${shipment.invoice_ref || shipment.shipment_number} at ${destSite.name || 'Branch'}.`
    });
  };

  const handleConfirmSiteReceiveSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!receiveModalState) return;

    const targetShipment = receiveModalState.shipment;
    const targetSite = receiveModalState.site;
    const invRef = targetShipment?.invoice_ref || targetShipment?.shipment_number || 'Shipment';
    const siteName = targetSite?.name || targetShipment?.site_name || '';

    setIsSubmittingReceive(true);
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
            receivedByName: receiveModalState.receivedByName,
            receivedDate: receiveModalState.receivedDate,
            receivedCondition: receiveModalState.receivedCondition,
            receivingNotes: receiveModalState.receivingNotes
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
      setIsSubmittingReceive(false);
      setStatusLoadingState(null);
    }
  };

  // Derive Incoming & In-Transit Shipments for this branch (Awaiting Superadmin confirmation)
  const incomingShipments = useMemo(() => {
    const userResolved = resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
    const targetSiteId = isSuperadmin && selectedSiteId !== 'ALL' ? selectedSiteId : userResolved.id;
    const targetSiteCode = isSuperadmin && selectedSiteId !== 'ALL'
      ? (sites.find(s => s.id === selectedSiteId)?.code || selectedSiteId)
      : (activeSiteObj?.code || userResolved.code);

    return (shipments || []).filter(sh => {
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
  }, [shipments, isSuperadmin, selectedSiteId, currentUser, sites, activeSiteObj]);

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

  // Derive Stock On Hand for current site
  const siteStockData = useMemo(() => {
    return getStockOnHandForSite(selectedSiteId);
  }, [getStockOnHandForSite, selectedSiteId]);

  // Derive Multi-Site Stocks with Granular Serial Privacy (Excluding Central DC stocks)
  const multiSiteStockData = useMemo(() => {
    if (typeof getAllSitesStockSummary === 'function') {
      const all = getAllSitesStockSummary(allStocksSiteFilter) || [];
      return all.filter(s => s.siteId !== 'site-dc' && s.siteCode !== 'DC-MDC' && s.siteCode !== 'DC');
    }
    return [];
  }, [getAllSitesStockSummary, allStocksSiteFilter]);

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

  // Open Mark as Used Modal
  const openMarkUsedModal = (partNumber = '', prefillSerial = '') => {
    setMarkUsedPartPn(partNumber);
    setMarkUsedSerial(prefillSerial);
    setMarkUsedWorkOrder('');
    setMarkUsedNotes('');
    setIsMarkUsedModalOpen(true);
  };

  // Submit Mark as Used Action
  const handleConfirmMarkAsUsed = async (e) => {
    if (e) e.preventDefault();
    if (!markUsedSerial) {
      showToast('Please select or enter the serial number of the used part.', 'error');
      return;
    }
    setIsSubmittingMarkUsed(true);
    try {
      const res = await markUnitAsUsed({
        serialNumber: markUsedSerial,
        partNumber: markUsedPartPn,
        siteId: userSiteObj.id || currentUser?.siteId,
        workOrderNumber: markUsedWorkOrder,
        notes: markUsedNotes
      });
      if (res && res.success) {
        setIsMarkUsedModalOpen(false);
        setMarkUsedSerial('');
        setMarkUsedWorkOrder('');
        setMarkUsedNotes('');
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
      'Part Number': u.part_number,
      'Description': u.description || 'Apple Replacement Part',
      'Serial Number': u.serial_number,
      'Work Order #': u.work_order_number || 'N/A',
      'Used By (Technician)': u.used_by_name || u.used_by || 'Branch Specialist',
      'Used Date': u.used_at ? new Date(u.used_at).toLocaleDateString() : 'N/A',
      'Used Time': u.used_at ? formatTo12HourTime(u.used_at) : 'N/A',
      'Branch Site': u.site_code || activeSiteObj.code,
      'Usage Notes': u.usage_notes || u.notes || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Used Parts Log');
    const fileName = `Used_Parts_Log_${activeSiteObj.code || 'BRANCH'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Exported ${rows.length} used parts records to ${fileName}`, 'success');
  };

  // Stock on Hand Table Filtered Rows
  const stockRows = useMemo(() => {
    const items = Object.values(siteStockData.partsSummary || {});
    return items.filter(it => {
      if (stockCategoryFilter !== 'ALL' && it.category !== stockCategoryFilter) return false;
      if (stockSearchQuery.trim()) {
        const q = stockSearchQuery.toLowerCase().trim();
        return it.partNumber.toLowerCase().includes(q) ||
               it.description.toLowerCase().includes(q) ||
               it.model.toLowerCase().includes(q);
      }
      return true;
    }).sort((a, b) => b.inStock - a.inStock || a.partNumber.localeCompare(b.partNumber));
  }, [siteStockData, stockCategoryFilter, stockSearchQuery]);

  // Regional Site Classification (Metro Manila vs Provincial vs DC)
  const { metroManilaSites, provincialSites, dcSite } = useMemo(() => {
    const mm = [];
    const prov = [];
    let dc = null;
    (sites || []).forEach(s => {
      if (s.is_dc || s.code === 'DC-MDC' || s.code === 'DC' || s.id === 'site-dc') {
        dc = s;
      } else if (isProvincialSite(s)) {
        prov.push(s);
      } else {
        mm.push(s);
      }
    });
    return { metroManilaSites: mm, provincialSites: prov, dcSite: dc };
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
  const flattenedAllStocksRows = useMemo(() => {
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
  }, [multiSiteStockData, allStocksSearchQuery, currentUser, userSiteObj, isSuperadmin, isPmgUser]);

  // Dynamic header configuration based on active view and role
  const viewHeaderMeta = useMemo(() => {
    switch (activeTab) {
      case 'stock_on_hand':
        return {
          icon: Package,
          iconBg: 'rgba(56, 189, 248, 0.2)',
          iconColor: '#38bdf8',
          title: 'Branch Stock On Hand',
          subtitle: `Live physical inventory, verified serialized units, and arriving shipments for ${activeSiteObj.name || activeSiteObj.code}`,
          badgeText: activeSiteObj.name || activeSiteObj.code || 'Service Center',
          badgeIcon: Building2
        };
      case 'all_stocks':
        return {
          icon: Globe,
          iconBg: 'rgba(129, 140, 248, 0.2)',
          iconColor: '#818cf8',
          title: 'All Stocks & Multi-Site Inventory',
          subtitle: 'Directory-wide stock visibility across all MobileCare Authorized Service Points',
          badgeText: 'Network Directory',
          badgeIcon: Globe
        };
      case 'usage_history':
        return {
          icon: Wrench,
          iconBg: 'rgba(52, 211, 153, 0.2)',
          iconColor: '#34d399',
          title: 'Parts Consumption Log',
          subtitle: `Serialized audit history of parts installed in repair work orders at ${activeSiteObj.name || activeSiteObj.code}`,
          badgeText: activeSiteObj.name || activeSiteObj.code || 'Service Center',
          badgeIcon: Building2
        };
      case 'requests_table':
      default:
        return {
          icon: Inbox,
          iconBg: 'rgba(56, 189, 248, 0.2)',
          iconColor: '#38bdf8',
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
            subtext: `${Object.keys(siteStockData.partsSummary || {}).length} unique part numbers`,
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
            subtext: `${Object.keys(siteStockData.partsSummary || {}).length} unique part numbers`,
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
    incomingShipments,
    liveUsedUnitsLog,
    regionStockTotals,
    metroManilaSites.length,
    provincialSites.length,
    dcStockSummary,
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
          background: 'linear-gradient(135deg, #090f1d 0%, #0f172a 45%, #1e293b 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.25)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: viewHeaderMeta.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: viewHeaderMeta.iconColor }}>
                <HeaderIcon size={20} />
              </div>
              <h2 style={{ color: '#fff', fontSize: '21px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                {viewHeaderMeta.title}
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
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
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0, lineHeight: 1.4 }}>
              {viewHeaderMeta.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Site Picker (Superadmin Only) */}
            {isSuperadmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>Branch:</span>
                <select
                  className="form-select"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  style={{
                    background: '#1e293b',
                    color: '#f8fafc',
                    borderColor: '#475569',
                    fontSize: '12.5px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    minWidth: '180px'
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
              style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={() => {
                fetchPartsRequests();
                if (autoRefreshData) autoRefreshData({ force: true, silent: false, reason: 'Parts requests refresh' });
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
                  style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}
                  title="Export parts requests to Excel"
                >
                  <FileSpreadsheet size={14} color="#34d399" />
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
                  className="btn btn-primary"
                  onClick={() => openMarkUsedModal()}
                  style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                  title="Record part consumed in customer repair"
                >
                  <Wrench size={14} />
                  <span>Record Part Used</span>
                </button>
                {isPmgUser && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setActiveTab('scan-in')}
                    style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', gap: '6px' }}
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
                borderLeft: `4px solid ${card.accent}`,
                background: '#ffffff',
                borderRadius: '10px',
                borderTop: '1px solid #e2e8f0',
                borderRight: '1px solid #e2e8f0',
                borderBottom: '1px solid #e2e8f0',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '8px',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {card.label}
                </span>
                <div style={{ padding: '6px', background: card.iconBg, color: card.iconColor, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={16} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {card.value}{' '}
                  <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>{card.unit}</span>
                </div>
                <div style={{ fontSize: '11px', color: card.iconColor, marginTop: '4px', fontWeight: 600 }}>
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

      {/* 4. Sub-Navigation Tabs (Rendered strictly for Superadmin / non-PMG roles; PMG users navigate cleanly via sidebar) */}
      {!isPmgUser && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'requests_table' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleTabChange('requests_table')}
              style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
            >
              <Inbox size={15} />
              <span>Parts Requests ({filteredRequests.length})</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'stock_on_hand' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleTabChange('stock_on_hand')}
              style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
            >
              <Package size={15} />
              <span>Branch Stock ({siteStockData.totalInStock})</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'all_stocks' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleTabChange('all_stocks')}
              style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
            >
              <Boxes size={15} />
              <span>All Stocks &amp; Multi-Site ({flattenedAllStocksRows.length})</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'usage_history' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleTabChange('usage_history')}
              style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
            >
              <TrendingDown size={15} />
              <span>Used Parts History ({siteUsageData.recordsCount})</span>
            </button>
          </div>

          {activeTab === 'requests_table' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportRequestsToXlsx}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
            >
              <FileSpreadsheet size={14} color="#059669" />
              <span>Export to Excel</span>
            </button>
          )}
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
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
          
          <div style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '32px', fontSize: '12.5px', borderRadius: '8px' }}
                  placeholder="Filter stock by part number or model..."
                  value={stockSearchQuery}
                  onChange={(e) => setStockSearchQuery(e.target.value)}
                />
                {stockSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setStockSearchQuery('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Showing stock for: <strong style={{ color: '#0f172a' }}>{activeSiteObj.name} ({activeSiteObj.code})</strong>
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '6px' }}
                onClick={() => openMarkUsedModal()}
                title="Record part used/consumed in customer repair"
              >
                <Wrench size={13} />
                <span>Record Part Used</span>
              </button>
            </div>
          </div>

          {/* Incoming / In-Transit Shipments Banner (Awaiting Superadmin Site Receipt Confirmation) */}
          {incomingShipments.length > 0 && (
            <div
              style={{
                margin: '16px 18px',
                padding: '16px 20px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
                border: '1px solid #bfdbfe',
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.06)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ padding: '6px', background: '#0284c7', color: '#fff', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Truck size={16} />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                      Incoming Shipments &amp; Arriving Packages ({incomingShipments.length} Manifest{incomingShipments.length > 1 ? 's' : ''} • {incomingShipments.reduce((acc, s) => acc + (s.items?.length || 0), 0)} Parts)
                    </h4>
                    <p style={{ margin: 0, fontSize: '11.5px', color: '#475569' }}>
                      Parts are packed and in-transit / dispatched from DC. Confirm physical package arrival at your branch below to activate stock immediately.
                    </p>
                  </div>
                </div>

                <span className="badge" style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', fontWeight: 700, fontSize: '11px' }}>
                  Awaiting Receipt Confirmation
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' }}>
                {incomingShipments.map(sh => {
                  const destSite = sites.find(s => s.id === sh.site_id || s.code === sh.site_code) || activeSiteObj;
                  const itemCount = sh.items?.length || 0;
                  return (
                    <div
                      key={sh.id}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '10px'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                              {sh.invoice_ref || sh.shipment_number}
                            </strong>
                            <span className="badge" style={{ fontSize: '10px', background: sh.status === 'shipped' ? '#e0f2fe' : '#fef3c7', color: sh.status === 'shipped' ? '#0369a1' : '#b45309' }}>
                              {sh.status === 'shipped' ? 'In Transit' : 'Packed / Ready for Pickup'}
                            </span>
                          </div>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#0f172a' }}>
                            {itemCount} item{itemCount !== 1 ? 's' : ''}
                          </span>
                        </div>

                        <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div>Destination: <strong style={{ color: '#334155' }}>{destSite.name} ({destSite.code})</strong></div>
                          <div>Courier / Tracking: <strong style={{ color: '#334155' }}>{sh.carrier || sh.courier || 'Lite Express'} {sh.tracking_number ? `• #${sh.tracking_number}` : ''}</strong></div>
                          <div>Packed by: <span style={{ color: '#334155' }}>{sh.prepared_by_name || 'Warehouse Staff'}</span></div>
                        </div>

                        {/* Part numbers preview */}
                        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {(sh.items || []).slice(0, 4).map((it, idx) => (
                            <span key={idx} style={{ fontSize: '10.5px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#475569', fontFamily: 'var(--font-mono)' }}>
                              {it.part_number}
                            </span>
                          ))}
                          {itemCount > 4 && (
                            <span style={{ fontSize: '10.5px', color: '#64748b', alignSelf: 'center' }}>
                              +{itemCount - 4} more
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '8px', marginTop: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          style={{ background: '#059669', borderColor: '#059669', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700 }}
                          onClick={() => handleOpenReceiveModal(sh)}
                          title="Confirm physical arrival of this package and activate parts in branch inventory"
                        >
                          <PackageCheck size={13} />
                          <span>Confirm Site Package</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {stockRows.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                <Package size={36} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px' }}>No Live Stock Found For This Branch</h4>
                <p style={{ margin: 0, fontSize: '12.5px' }}>
                  There are currently no serialized inventory units recorded in stock for {activeSiteObj.name}.
                </p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ minWidth: '160px' }}>Part Number</th>
                    <th style={{ minWidth: '240px' }}>Part Description</th>
                    <th style={{ width: '160px' }}>Compatible Model</th>
                    <th style={{ textAlign: 'center', width: '130px' }}>Available Stock</th>
                    <th style={{ textAlign: 'center', width: '110px' }}>Allocated</th>
                    <th style={{ textAlign: 'center', width: '110px' }}>Packed</th>
                    <th style={{ textAlign: 'center', width: '150px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map(row => {
                    const isDc = isSuperadmin || currentUser?.siteId === 'site-dc' || userSiteObj?.code === 'DC-MDC' || userSiteObj?.code === 'DC';
                    const isUserSameSite = !isDc && Boolean(
                      currentUser?.siteId && (
                        selectedSiteId === currentUser.siteId ||
                        selectedSiteId === userSiteObj?.id ||
                        activeSiteObj?.code === userSiteObj?.code ||
                        activeSiteObj?.id === userSiteObj?.id
                      )
                    );

                    return (
                      <tr key={row.partNumber}>
                        <td>
                          <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                            {row.partNumber}
                          </strong>
                        </td>
                        <td style={{ fontSize: '12.5px', color: '#1e293b' }}>
                          {row.description}
                        </td>
                        <td>
                          <span className="badge" style={{ background: '#f1f5f9', color: '#475569', fontSize: '11px' }}>
                            {row.model}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
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
                        <td style={{ textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                          {row.allocated || 0}
                        </td>
                        <td style={{ textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                          {row.packed || 0}
                        </td>
                        <td style={{ textAlign: 'center' }}>
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
                                      fontSize: '11px',
                                      padding: '3px 8px',
                                      color: '#059669',
                                      borderColor: '#86efac',
                                      background: '#f0fdf4',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      fontWeight: 700
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
                                    <>
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
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ fontSize: '11px', padding: '3px 8px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff' }}
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
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '11px', padding: '3px 8px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff' }}
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
                  })}
                </tbody>
              </table>
            )}
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
                    placeholder="Search part # (e.g. 661-22294), model, or branch name..."
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
                  <Lock size={13} color="#0284c7" />
                  <span>Serial Privacy: <strong>Enforced</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Network-Wide Part Number Search Availability Result Panel */}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ padding: '6px', background: '#e0f2fe', borderRadius: '6px', color: '#0284c7' }}>
                    <Search size={16} />
                  </div>
                  <h4 style={{ margin: 0, fontSize: '15px', color: '#0f172a', fontWeight: 800 }}>
                    Network Stock Availability for &quot;{allStocksSearchQuery}&quot;
                  </h4>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-primary" style={{ fontSize: '11.5px', padding: '4px 10px' }}>
                    {networkPartSearchResults?.length || 0} stock location{(networkPartSearchResults?.length || 0) === 1 ? '' : 's'} found
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onClick={() => setAllStocksSearchQuery('')}
                  >
                    Close Search
                  </button>
                </div>
              </div>

              {networkPartSearchResults && networkPartSearchResults.length > 0 ? (
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
              ) : (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b' }}>
                  <SearchX size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
                  <p style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    No branch currently has &quot;{allStocksSearchQuery}&quot; in available stock.
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                    You can submit a replenishment request directly to DC Superadmin to procure this part.
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

                        return (
                          <tr key={rowKey} style={{ background: isOwnSite ? '#f8fafc' : '#ffffff' }}>
                            <td>
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

                            <td>
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

                            <td style={{ textAlign: 'center' }}>
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

                            <td>
                              {canSeeFullDetails ? (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#059669', fontWeight: 600 }}>
                                    <Unlock size={12} />
                                    <span>Full Serial Visibility ({row.serializedUnits?.length || 0} units)</span>
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-secondary"
                                    style={{ fontSize: '10.5px', padding: '2px 6px', marginTop: '4px' }}
                                    onClick={() => setExpandedPartKey(isExpanded ? null : rowKey)}
                                  >
                                    {isExpanded ? 'Hide Serials' : 'View Serials'}
                                  </button>

                                  {isExpanded && row.serializedUnits && (
                                    <div style={{ marginTop: '8px', background: '#f1f5f9', padding: '8px', borderRadius: '6px', fontSize: '11px' }}>
                                      {row.serializedUnits.map(u => {
                                        const isAddedByCurUser = isSuperadmin || Boolean(currentUser?.id && (u.added_by_user_id === currentUser?.id || u.received_by_id === currentUser?.id));
                                        const canManageUnit = isSuperadmin || isOwnSite || isAddedByCurUser;
                                        const isMaskedUnit = u.isMasked || (!isSuperadmin && !isOwnSite && !isAddedByCurUser);

                                        return (
                                          <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #e2e8f0', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                              {isMaskedUnit ? (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                  <span style={{ fontFamily: 'var(--font-mono)', color: '#94a3b8', fontSize: '11px', letterSpacing: '0.04em' }}>••••••••••••••••</span>
                                                  <span className="badge" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '9px', padding: '1px 4px', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                                    <Lock size={9} /> Protected
                                                  </span>
                                                </span>
                                              ) : (
                                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#0f172a' }}>{u.serialNumber}</span>
                                              )}
                                              <span style={{ color: '#64748b' }}>Box: {u.boxNumber} • {u.status}</span>
                                              {u.work_order_number && (
                                                <span style={{ color: '#0284c7', background: '#e0f2fe', padding: '1px 5px', borderRadius: '3px', fontSize: '10px', fontWeight: 600 }}>
                                                  WO: {u.work_order_number}
                                                </span>
                                              )}
                                              {u.notes && <span style={{ color: '#64748b', fontStyle: 'italic' }}>({u.notes})</span>}
                                            </div>
                                            {canManageUnit && !isMaskedUnit && (
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <button
                                                  type="button"
                                                  className="btn btn-secondary btn-sm"
                                                  style={{ padding: '2px 6px', fontSize: '10.5px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                                  onClick={() => openEditUnitModal(u)}
                                                  title="Update box number or work order notes"
                                                >
                                                  <Edit3 size={11} />
                                                  <span>Edit</span>
                                                </button>
                                                <button
                                                  type="button"
                                                  className="btn btn-secondary btn-sm"
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
                                        );
                                      })}
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

                            <td style={{ textAlign: 'center' }}>
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
                        <th style={{ minWidth: '150px' }}>Part Number</th>
                        <th style={{ minWidth: '220px' }}>Part Description</th>
                        <th style={{ minWidth: '180px' }}>Serial Number</th>
                        <th style={{ minWidth: '150px' }}>Work Order / Repair #</th>
                        <th style={{ minWidth: '150px' }}>Date & Time Used</th>
                        <th style={{ minWidth: '140px' }}>Used By</th>
                        <th style={{ minWidth: '180px' }}>Usage Notes</th>
                        <th style={{ width: '110px', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveUsedUnitsLog.map((u, idx) => (
                        <tr key={u.id || u.serial_number || idx}>
                          <td style={{ textAlign: 'center', fontSize: '11.5px', color: '#94a3b8' }}>
                            {idx + 1}
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
                              {u.serial_number}
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
                                if (window.confirm(`Restore serial ${u.serial_number} back to In-Stock status?`)) {
                                  unmarkUnitAsUsed(u.serial_number);
                                }
                              }}
                              title="Undo: Revert this part back to In-Stock inventory"
                            >
                              <RotateCcw size={11} />
                              <span>Revert</span>
                            </button>
                          </td>
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
              maxWidth: '520px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              padding: '24px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ background: '#dcfce7', padding: '6px', borderRadius: '8px', display: 'flex' }}>
                  <Wrench size={18} color="#059669" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    Record Part as Used / Consumed
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
                    setMarkUsedSerial('');
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

              {/* Serial Number Selection or Input */}
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Serial Number *</span>
                  {availableSerialsForMarkUsed.length > 0 && (
                    <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600 }}>
                      {availableSerialsForMarkUsed.length} available serials in branch
                    </span>
                  )}
                </label>

                {availableSerialsForMarkUsed.length > 0 ? (
                  <select
                    className="form-input"
                    value={markUsedSerial}
                    onChange={(e) => setMarkUsedSerial(e.target.value)}
                    required
                    style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                  >
                    <option value="">-- Choose Serial Number to Consume --</option>
                    {availableSerialsForMarkUsed.map(u => (
                      <option key={u.id || u.serial_number} value={u.serial_number}>
                        {u.serial_number} (Box: {u.box_number || 1})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Scan or enter part serial number (e.g. C02..., G6T...)"
                    value={markUsedSerial}
                    onChange={(e) => setMarkUsedSerial(e.target.value.trim().toUpperCase())}
                    required
                    style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                  />
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
                  style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
                  disabled={isSubmittingMarkUsed || !markUsedSerial}
                >
                  <Check size={14} />
                  <span>{isSubmittingMarkUsed ? 'Recording...' : 'Confirm Part Used'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. Delete Confirmation Modal for Branch Unit */}
      {unitToDelete && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
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
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0f172a' }}>{unitToDelete.serial_number || unitToDelete.serialNumber}</strong>
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
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
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
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0f172a' }}>{unitToEdit.serial_number || unitToEdit.serialNumber}</strong>
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

      {/* 10. Superadmin Site Receipt Confirmation Modal */}
      {receiveModalState && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content" style={{ maxWidth: '580px', width: '100%' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', color: '#fff', padding: '16px 20px', borderRadius: '8px 8px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PackageCheck size={20} color="#38bdf8" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#fff' }}>
                  Confirm Site Package Receipt
                </h3>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setReceiveModalState(null)}
                disabled={isSubmittingReceive}
                style={{ color: '#94a3b8' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmSiteReceiveSubmit} style={{ padding: '20px' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '12px 14px', fontSize: '12.5px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#166534', fontWeight: 600 }}>Manifest Reference:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#0f172a' }}>
                    {receiveModalState.shipment.invoice_ref || receiveModalState.shipment.shipment_number}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#166534', fontWeight: 600 }}>Destination Branch:</span>
                  <strong style={{ color: '#0f172a' }}>
                    {receiveModalState.site?.name} ({receiveModalState.site?.code})
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#166534', fontWeight: 600 }}>Courier / Booking:</span>
                  <span style={{ color: '#334155' }}>
                    {receiveModalState.shipment.carrier || receiveModalState.shipment.courier || 'Lite Express'} {receiveModalState.shipment.tracking_number ? `(#${receiveModalState.shipment.tracking_number})` : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#166534', fontWeight: 600 }}>Total Parts in Package:</span>
                  <strong style={{ color: '#059669' }}>
                    {receiveModalState.shipment.items?.length || 0} units
                  </strong>
                </div>
              </div>

              {/* Items in Package */}
              <div style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ fontWeight: 700, fontSize: '12px', color: '#475569', marginBottom: '6px' }}>
                  Parts Included in Manifest ({receiveModalState.shipment.items?.length || 0})
                </label>
                <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', background: '#f8fafc', fontSize: '11.5px' }}>
                  {(receiveModalState.shipment.items || []).map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: idx < (receiveModalState.shipment.items.length - 1) ? '1px solid #e2e8f0' : 'none' }}>
                      <div>
                        <strong style={{ fontFamily: 'var(--font-mono)', color: '#0284c7' }}>{it.part_number}</strong>
                        <span style={{ color: '#64748b', marginLeft: '6px' }}>{it.description}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', color: '#0f172a', fontWeight: 600 }}>
                        {it.serial_number || it.serialNumber || 'Serialized Unit'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Received By Staff Name */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '12px' }}>
                  Confirmed Received By
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={receiveModalState.receivedByName}
                  onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivedByName: e.target.value }))}
                  required
                />
              </div>

              {/* Receipt Date */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '12px' }}>
                  Physical Receipt Date
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={receiveModalState.receivedDate}
                  onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivedDate: e.target.value }))}
                  required
                />
              </div>

              {/* Package Condition */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '12px' }}>
                  Package Condition &amp; Security Seal
                </label>
                <select
                  className="form-select"
                  value={receiveModalState.receivedCondition}
                  onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivedCondition: e.target.value }))}
                >
                  <option value="Good Condition (All parts intact & verified)">Good Condition (All parts intact &amp; verified)</option>
                  <option value="Minor Box Crease / Parts Intact">Minor Box Crease / Parts Intact</option>
                  <option value="Security Seal Verified & Complete">Security Seal Verified &amp; Complete</option>
                  <option value="Discrepancy / Inspected with Logistics">Discrepancy / Inspected with Logistics</option>
                </select>
              </div>

              {/* Receiving Notes */}
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '12px' }}>
                  Receiving Confirmation Notes
                </label>
                <textarea
                  className="form-input"
                  rows="2"
                  value={receiveModalState.receivingNotes}
                  onChange={(e) => setReceiveModalState(prev => ({ ...prev, receivingNotes: e.target.value }))}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setReceiveModalState(null)}
                  disabled={isSubmittingReceive}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: '#059669', borderColor: '#059669', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}
                  disabled={isSubmittingReceive}
                >
                  <PackageCheck size={16} />
                  <span>{isSubmittingReceive ? 'Confirming...' : 'Confirm Site Package Receipt'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightweight Status Transition / Confirm Package Loading Screen */}
      <StatusChangeLoadingModal {...statusLoadingState} />
    </div>
  );
}
