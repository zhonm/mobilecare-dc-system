import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import * as XLSX from 'xlsx';
import {
  Inbox,
  Send,
  Plus,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Flame,
  ShieldCheck,
  Building2,
  Package,
  Boxes,
  FileSpreadsheet,
  Trash2,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  Calendar,
  User,
  Check,
  X,
  Sparkles,
  Info,
  DollarSign,
  Layers,
  ArrowRight,
  Lock,
  Unlock,
  Eye,
  EyeOff
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
    partsRequests = [],
    submitPartsRequest,
    cancelPartsRequest,
    updatePartsRequestStatus,
    getStockOnHandForSite,
    getAllSitesStockSummary,
    getUsedPartsForSite,
    fetchPartsRequests,
    isLoadingPartsRequests,
    showToast,
    isAutoRefreshing,
    autoRefreshData
  } = useApp();

  const isSuperadmin = currentUser?.role === 'superadmin';
  const isAdmin = currentUser?.role === 'admin';
  const isFulfillment = ['superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff'].includes(currentUser?.role);

  // User site resolution
  const userSiteObj = useMemo(() => {
    return sites.find(s => s.id === currentUser?.siteId || s.code === currentUser?.siteId) || sites[0] || {};
  }, [sites, currentUser?.siteId]);

  // Selected site filter
  const [selectedSiteId, setSelectedSiteId] = useState(() => {
    if (!isSuperadmin && currentUser?.siteId) {
      return currentUser.siteId;
    }
    return currentUser?.siteId || sites[0]?.id || 'site-dc';
  });

  const activeSiteObj = useMemo(() => {
    return sites.find(s => s.id === selectedSiteId || s.code === selectedSiteId) || userSiteObj;
  }, [sites, selectedSiteId, userSiteObj]);

  // Active Sub-Tab: 'requests_table' | 'stock_on_hand' | 'all_stocks' | 'usage_history'
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  // Form State for New Request
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formPartPn, setFormPartPn] = useState('');
  const [formPartSearch, setFormPartSearch] = useState('');
  const [formQuantity, setFormQuantity] = useState(1);
  const [formPriority, setFormPriority] = useState('normal');
  const [formReason, setFormReason] = useState(REASON_PRESETS[0]);
  const [formNotes, setFormNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPartDropdown, setShowPartDropdown] = useState(false);

  // Table Search & Filter State
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState('ALL');

  // Multi-Site All Stocks Tab State
  const [allStocksSiteFilter, setAllStocksSiteFilter] = useState('ALL');
  const [allStocksSearchQuery, setAllStocksSearchQuery] = useState('');
  const [expandedPartKey, setExpandedPartKey] = useState(null);

  // Status Action Modal State (For Superadmin Approvals / Denials)
  const [actionModalRequest, setActionModalRequest] = useState(null);
  const [actionTargetStatus, setActionTargetStatus] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [actionQtyFulfilled, setActionQtyFulfilled] = useState(1);

  // Derive Stock On Hand for current site
  const siteStockData = useMemo(() => {
    return getStockOnHandForSite(selectedSiteId);
  }, [getStockOnHandForSite, selectedSiteId]);

  // Derive Multi-Site Stocks with Granular Serial Privacy
  const multiSiteStockData = useMemo(() => {
    if (typeof getAllSitesStockSummary === 'function') {
      return getAllSitesStockSummary(allStocksSiteFilter);
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

  // Selected Part Object for Form
  const selectedFormPart = useMemo(() => {
    if (!formPartPn) return null;
    return parts.find(p => p.part_number?.toUpperCase() === formPartPn.toUpperCase()) || null;
  }, [parts, formPartPn]);

  // Available Parts for Search Dropdown
  const matchingParts = useMemo(() => {
    if (!formPartSearch.trim()) return parts.slice(0, 15);
    const q = formPartSearch.toLowerCase().trim();
    return parts.filter(p =>
      p.part_number?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.iphone_model?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [parts, formPartSearch]);

  // Open Form with Pre-selected Part from Stock View
  const handleQuickRequestPart = (partNumber, sourceSiteName = null) => {
    setFormPartPn(partNumber);
    setFormPartSearch(partNumber);
    if (sourceSiteName) {
      setFormNotes(`Stock transfer requested from ${sourceSiteName}`);
    }
    setIsFormOpen(true);
    setActiveTab('requests_table');
  };

  // Submit Request Handler
  const handleSubmitNewRequest = async (e) => {
    e.preventDefault();
    if (!formPartPn) {
      showToast('Please select a valid Apple Part Number to request.', 'error');
      return;
    }

    const partObj = parts.find(p => p.part_number?.toUpperCase() === formPartPn.toUpperCase());
    if (!partObj) {
      showToast(`Part number "${formPartPn}" was not found in the master parts catalog.`, 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitPartsRequest({
        siteId: isSuperadmin ? selectedSiteId : (currentUser?.siteId || selectedSiteId),
        partId: partObj.id,
        quantity: formQuantity,
        priority: formPriority,
        reason: formReason,
        notes: formNotes
      });

      if (res && res.success) {
        setIsFormOpen(false);
        setFormPartPn('');
        setFormPartSearch('');
        setFormQuantity(1);
        setFormPriority('normal');
        setFormNotes('');
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

  // Flattened Multi-Site Parts Rows for All Stocks Tab
  const flattenedAllStocksRows = useMemo(() => {
    const all = [];
    (multiSiteStockData || []).forEach(siteSummary => {
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
        all.push({
          ...partItem,
          siteId: siteSummary.siteId,
          siteCode: siteSummary.siteCode,
          siteName: siteSummary.siteName,
          isOwnSite: siteSummary.isOwnSite
        });
      });
    });
    return all.sort((a, b) => b.inStock - a.inStock || a.siteCode.localeCompare(b.siteCode));
  }, [multiSiteStockData, allStocksSearchQuery]);

  return (
    <div className="request-parts-container" style={{ maxWidth: '1360px', margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Header Hero Banner */}
      <div
        className="card"
        style={{
          marginBottom: '20px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid #334155'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8' }}>
                <Inbox size={20} />
              </div>
              <h2 style={{ color: '#fff', fontSize: '21px', fontWeight: 800, margin: 0 }}>
                {activeTab === 'all_stocks' ? 'All Stocks & Multi-Site Inventory' : 'New Request of Parts & Site Stock'}
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Building2 size={13} />
                {activeSiteObj.name || activeSiteObj.code || 'Service Center'}
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
              Live branch stock visibility • Granular serial privacy • Superadmin replenishment governance
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
              style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.2)' }}
              onClick={() => {
                fetchPartsRequests();
                if (autoRefreshData) autoRefreshData({ force: true, silent: false, reason: 'Parts requests refresh' });
              }}
              disabled={isLoadingPartsRequests || isAutoRefreshing}
              title="Refresh parts requests and live stock from cloud database"
            >
              <RefreshCw size={14} className={isLoadingPartsRequests || isAutoRefreshing ? 'spin' : ''} />
              <span>{isLoadingPartsRequests ? 'Syncing…' : 'Sync'}</span>
            </button>

            {/* New Request Button */}
            <button
              className="btn btn-primary"
              onClick={() => setIsFormOpen(prev => !prev)}
              style={{ background: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
            >
              {isFormOpen ? <X size={16} /> : <Plus size={16} />}
              <span>{isFormOpen ? 'Close Form' : 'New Request'}</span>
            </button>
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
        <div className="card" style={{ padding: '16px 18px', borderLeft: '4px solid #0284c7', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Branch Stock On Hand</span>
            <div style={{ padding: '6px', background: '#e0f2fe', color: '#0284c7', borderRadius: '6px' }}>
              <Package size={16} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {siteStockData.totalInStock} <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>units in stock</span>
          </div>
          <div style={{ fontSize: '11px', color: '#0284c7', marginTop: '4px', fontWeight: 600 }}>
            {Object.keys(siteStockData.partsSummary || {}).length} unique part numbers
          </div>
        </div>

        <div className="card" style={{ padding: '16px 18px', borderLeft: '4px solid #f59e0b', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Pending Review</span>
            <div style={{ padding: '6px', background: '#fef3c7', color: '#d97706', borderRadius: '6px' }}>
              <Clock size={16} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {metrics.pending} <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>open requests</span>
          </div>
          <div style={{ fontSize: '11px', color: '#d97706', marginTop: '4px', fontWeight: 600 }}>
            {isSuperadmin ? 'Requires Superadmin approval' : 'Awaiting DC Superadmin approval'}
          </div>
        </div>

        <div className="card" style={{ padding: '16px 18px', borderLeft: '4px solid #8b5cf6', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Approved &amp; In-Packing</span>
            <div style={{ padding: '6px', background: '#ede9fe', color: '#7c3aed', borderRadius: '6px' }}>
              <ShieldCheck size={16} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {metrics.approved} <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>approved</span>
          </div>
          <div style={{ fontSize: '11px', color: '#7c3aed', marginTop: '4px', fontWeight: 600 }}>
            Queued for DC dispatch batch
          </div>
        </div>

        <div className="card" style={{ padding: '16px 18px', borderLeft: '4px solid #10b981', background: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Fulfilled Requests</span>
            <div style={{ padding: '6px', background: '#dcfce7', color: '#059669', borderRadius: '6px' }}>
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {metrics.fulfilled} <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>completed</span>
          </div>
          <div style={{ fontSize: '11px', color: '#059669', marginTop: '4px', fontWeight: 600 }}>
            Dispatched / Shipped to site
          </div>
        </div>
      </div>

      {/* 3. New Parts Request Submission Form Modal / Collapsible Section */}
      {isFormOpen && (
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              
              {/* Part Selector / Search */}
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Select Apple Part</span>
                  {selectedFormPart && (
                    <span style={{ color: '#0284c7', fontWeight: 600 }}>
                      Current Stock: {siteStockData.partsSummary[selectedFormPart.part_number]?.inStock || 0} units
                    </span>
                  )}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search part # or model (e.g. 661-37213, iPhone 15 Display)..."
                    value={formPartSearch}
                    onChange={(e) => {
                      setFormPartSearch(e.target.value);
                      setShowPartDropdown(true);
                    }}
                    onFocus={() => setShowPartDropdown(true)}
                    required
                  />
                  {formPartSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormPartSearch('');
                        setFormPartPn('');
                      }}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Autocomplete Dropdown */}
                {showPartDropdown && matchingParts.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      maxHeight: '220px',
                      overflowY: 'auto',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                      zIndex: 50,
                      marginTop: '4px'
                    }}
                  >
                    {matchingParts.map(p => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setFormPartPn(p.part_number);
                          setFormPartSearch(`${p.part_number} — ${p.description}`);
                          setShowPartDropdown(false);
                        }}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background 0.1s ease',
                          background: formPartPn === p.part_number ? '#f0f9ff' : '#ffffff'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.background = formPartPn === p.part_number ? '#f0f9ff' : '#ffffff'}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>{p.part_number}</strong>
                          <span className="badge" style={{ fontSize: '10.5px', background: '#f1f5f9' }}>{p.iphone_model || 'iPhone'}</span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>{p.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quantity Requested */}
              <div className="form-group">
                <label className="form-label">Quantity Needed</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '8px 14px', fontWeight: 700 }}
                    onClick={() => setFormQuantity(prev => Math.max(1, prev - 1))}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    className="form-input"
                    style={{ textAlign: 'center', fontWeight: 700, fontSize: '15px' }}
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '8px 14px', fontWeight: 700 }}
                    onClick={() => setFormQuantity(prev => prev + 1)}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Priority Selector */}
              <div className="form-group">
                <label className="form-label">Urgency Priority</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
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
                        padding: '8px',
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
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
                disabled={isSubmitting}
                style={{ background: '#0284c7', minWidth: '150px' }}
              >
                <Send size={15} />
                <span>{isSubmitting ? 'Submitting…' : 'Submit to DC Superadmin'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. Sub-Navigation Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${activeTab === 'requests_table' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('requests_table')}
            style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
          >
            <Inbox size={15} />
            <span>Parts Requests ({filteredRequests.length})</span>
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'stock_on_hand' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('stock_on_hand')}
            style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
          >
            <Package size={15} />
            <span>My Branch Stock ({siteStockData.totalInStock})</span>
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'all_stocks' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('all_stocks')}
            style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
          >
            <Boxes size={15} />
            <span>All Stocks &amp; Multi-Site ({flattenedAllStocksRows.length})</span>
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'usage_history' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('usage_history')}
            style={{ borderRadius: '6px 6px 0 0', padding: '8px 16px', fontWeight: 700 }}
          >
            <TrendingDown size={15} />
            <span>Used Parts History ({siteUsageData.recordsCount})</span>
          </button>
        </div>

        {activeTab === 'requests_table' && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportRequestsToXlsx}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
          >
            <FileSpreadsheet size={14} color="#059669" />
            <span>Export to Excel</span>
          </button>
        )}
      </div>

      {/* 5. TAB 1: Parts Requests List */}
      {activeTab === 'requests_table' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          {/* Filters Bar */}
          <div style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '320px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '32px', fontSize: '12.5px' }}
                  placeholder="Filter requests by part #, requester, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Status Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Status:</span>
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '4px 8px', width: 'auto' }}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Priority:</span>
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '4px 8px', width: 'auto' }}
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="ALL">All Priorities</option>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="table-container" style={{ overflowX: 'auto' }}>
            {filteredRequests.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                <Inbox size={36} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px' }}>No Parts Requests Found</h4>
                <p style={{ margin: 0, fontSize: '12.5px' }}>
                  {partsRequests.length === 0
                    ? 'No parts requests have been submitted yet. Click "New Request" to create one.'
                    : 'No requests match your selected filters.'}
                </p>
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
                    <th style={{ minWidth: '180px' }}>Reason &amp; Notes</th>
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
                      if (pr === 'critical') return { bg: '#fee2e2', text: '#dc2626', icon: Flame };
                      if (pr === 'urgent') return { bg: '#fef3c7', text: '#d97706', icon: AlertTriangle };
                      return { bg: '#e0f2fe', text: '#0284c7', icon: Info };
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
                            {req.priority?.toUpperCase() || 'NORMAL'}
                          </span>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <User size={13} color="#64748b" />
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
                          <div style={{ fontSize: '12px', color: '#1e293b' }}>
                            {req.reason}
                          </div>
                          {req.notes && (
                            <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', marginTop: '2px' }}>
                              “{req.notes}”
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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          <div style={{ padding: '14px 18px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '320px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '32px', fontSize: '12.5px' }}
                  placeholder="Filter stock by part number or model..."
                  value={stockSearchQuery}
                  onChange={(e) => setStockSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Showing stock for: <strong>{activeSiteObj.name} ({activeSiteObj.code})</strong>
              </span>
            </div>
          </div>

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
                    <th style={{ textAlign: 'center', width: '130px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map(row => (
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
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '11px', padding: '3px 8px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff' }}
                          onClick={() => handleQuickRequestPart(row.partNumber)}
                          title="Create replenishment request for this part"
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
        </div>
      )}

      {/* 7. TAB 3: All Stocks & Multi-Site Inventory with Granular Serial Privacy */}
      {activeTab === 'all_stocks' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
              <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '32px', fontSize: '12.5px' }}
                  placeholder="Search across all sites by part #, model, or branch..."
                  value={allStocksSearchQuery}
                  onChange={(e) => setAllStocksSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Filter size={13} color="#64748b" />
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Filter Branch:</span>
                <select
                  className="form-select"
                  style={{ fontSize: '12px', padding: '4px 10px', width: 'auto' }}
                  value={allStocksSiteFilter}
                  onChange={(e) => setAllStocksSiteFilter(e.target.value)}
                >
                  <option value="ALL">All Service Branches</option>
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px' }}>
                <Lock size={12} color="#0284c7" />
                <span>Serial Privacy: <strong>Active</strong></span>
              </div>
            </div>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            {flattenedAllStocksRows.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: '#64748b' }}>
                <Boxes size={36} color="#cbd5e1" style={{ marginBottom: '10px' }} />
                <h4 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '15px' }}>No Inventory Records Found</h4>
                <p style={{ margin: 0, fontSize: '12.5px' }}>
                  No inventory units match your current multi-site filter.
                </p>
              </div>
            ) : (
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ width: '180px' }}>Branch / Location</th>
                    <th style={{ minWidth: '160px' }}>Part Number</th>
                    <th style={{ minWidth: '220px' }}>Description &amp; Model</th>
                    <th style={{ textAlign: 'center', width: '130px' }}>Available Stock</th>
                    <th style={{ minWidth: '220px' }}>Serial Details &amp; Privacy</th>
                    <th style={{ textAlign: 'center', width: '140px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flattenedAllStocksRows.map((row, idx) => {
                    const rowKey = `${row.siteId}-${row.partNumber}-${idx}`;
                    const isExpanded = expandedPartKey === rowKey;
                    const canSeeFullDetails = row.canViewDetails || isSuperadmin;

                    return (
                      <tr key={rowKey} style={{ background: row.isOwnSite ? '#f8fafc' : '#ffffff' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Building2 size={14} color={row.isOwnSite ? '#0284c7' : '#64748b'} />
                            <div>
                              <strong style={{ fontSize: '12.5px', color: row.isOwnSite ? '#0284c7' : '#0f172a' }}>
                                {row.siteCode}
                              </strong>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>
                                {row.siteName}
                              </div>
                            </div>
                          </div>
                          {row.isOwnSite && (
                            <span className="badge" style={{ fontSize: '10px', background: '#e0f2fe', color: '#0284c7', marginTop: '3px' }}>
                              Your Branch
                            </span>
                          )}
                        </td>

                        <td>
                          <strong style={{ fontSize: '13px', color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                            {row.partNumber}
                          </strong>
                        </td>

                        <td>
                          <div style={{ fontSize: '12.5px', color: '#1e293b' }}>
                            {row.description}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            {row.model}
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
                                  {row.serializedUnits.map(u => (
                                    <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #e2e8f0' }}>
                                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{u.serialNumber}</span>
                                      <span style={{ color: '#64748b' }}>Box: {u.boxNumber} • {u.status}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#64748b' }}>
                              <Lock size={13} color="#94a3b8" />
                              <span style={{ fontStyle: 'italic' }}>
                                Serials restricted to {row.siteCode} owner
                              </span>
                            </div>
                          )}
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11px', padding: '4px 10px', color: '#0284c7', borderColor: '#bae6fd', background: '#f0f9ff' }}
                            onClick={() => handleQuickRequestPart(row.partNumber, row.siteName)}
                            title="Request replenishment for this part from DC"
                          >
                            <Send size={11} />
                            <span>Request Part</span>
                          </button>
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

      {/* 8. TAB 4: Used Parts Historical Usage */}
      {activeTab === 'usage_history' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                Historical Repair Consumption — {activeSiteObj.name}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                Aggregated actual parts consumed in repairs (GSX / Fixably usage datasets).
              </p>
            </div>
            <span className="badge badge-primary">{siteUsageData.summaryList.length} Consumed Parts</span>
          </div>

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

    </div>
  );
}
