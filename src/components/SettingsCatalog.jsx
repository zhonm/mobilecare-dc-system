import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import mobilecareNoBGLogo from '../assets/mobilecareNoBGLogo.png';
import {
  Settings,
  Plus,
  Database,
  Copy,
  Check,
  Smartphone,
  MapPin,
  Users,
  Edit2,
  Trash2,
  Search,
  X,
  AlertTriangle,
  Save,
  Building2,
  Phone,
  User,
  RefreshCw,
  ShieldCheck,
  FileText,
  Zap,
  Server,
  CheckCircle2,
  ArrowDownCircle,
  Boxes,
  FileCode,
  HardDrive,
  Layers,
  Globe,
  Activity,
} from 'lucide-react';

const getCategoryBadgeStyle = (catName = '') => {
  const name = String(catName || '').toUpperCase();
  if (name.includes('BATTERY')) return { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' };
  if (name.includes('DISPLAY')) return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' };
  if (name.includes('CAMERA')) return { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' };
  if (name.includes('BACK') || name.includes('GLASS')) return { bg: '#fffbeb', text: '#b45309', border: '#fde68a' };
  if (name.includes('REAR') || name.includes('MID')) return { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe' };
  return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' };
};

export default function SettingsCatalog() {
  const {
    parts = [],
    categories = [],
    sites = [],
    inventoryUnits = [],
    shipments = [],
    usersList = [],
    forecastItems = [],
    allocations = [],
    purchaseOrders = [],
    uploadAuditLogs = [],
    scanLogs = [],
    savePart,
    deletePart,
    saveSite,
    deleteSite,
    refreshSitesFromCloud,
    syncAllDataToCloud,
    forceGlobalCloudSyncAndPurge,
    testDatabaseConnection,
    autoRefreshData,
    lastSyncedAt,
    realtimeConnected,
    isAutoRefreshing,
    currentUser,
    showToast,
    supervisorSettings,
    saveSupervisorSettings
  } = useApp();
  const [activeTab, setActiveTab] = useState('parts'); // 'parts' | 'sites' | 'categories' | 'supervisor' | 'sql'
  const [copied, setCopied] = useState(false);
  const [isRefreshingSites, setIsRefreshingSites] = useState(false);

  // Supabase Cloud Database Window State
  const [isGlobalSyncing, setIsGlobalSyncing] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isTestingLatency, setIsTestingLatency] = useState(false);
  const [dbLatency, setDbLatency] = useState(null);
  const [_dbRowCount, setDbRowCount] = useState(null);
  const [_lastSyncResult, setLastSyncResult] = useState(null);
  const [isSchemaExpanded, setIsSchemaExpanded] = useState(false);

  // Supervisor Form State
  const [supervisorName, setSupervisorName] = useState(supervisorSettings?.supervisor_name || 'Anjo Alcazar');
  const [supervisorTitle, setSupervisorTitle] = useState(supervisorSettings?.supervisor_title || 'MDC Supervisor of DC');
  const [guardOnDutyDefault, setGuardOnDutyDefault] = useState(supervisorSettings?.guard_on_duty || '');

  // Search & Filter State
  const [partSearch, setPartSearch] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');

  // New Part Form State
  const [newPn, setNewPn] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newModel, setNewModel] = useState('iPhone 15');
  const [newCatId, setNewCatId] = useState(categories[0]?.id || 'cat-battery');
  const [newStockPrice, setNewStockPrice] = useState(150);
  const [showAddPartCard, setShowAddPartCard] = useState(true);

  // Edit Part Modal State
  const [editingPart, setEditingPart] = useState(null);

  // Delete Part Modal State
  const [deletingPart, setDeletingPart] = useState(null);

  // ── Site Management State ──────────────────────────────────────────────────
  const [siteSearch, setSiteSearch] = useState('');
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);
  const [editingSite, setEditingSite] = useState(null);

  const BLANK_SITE = {
    code: '', name: '', region: 'Metro Manila', address: '',
    contact_person: '', contact_phone: '', is_dc: false
  };
  const [newSite, setNewSite] = useState(BLANK_SITE);
  const [deletingSite, setDeletingSite] = useState(null);

  const filteredSites = useMemo(() => {
    const valid = (sites || []).filter(s =>
      !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
      !String(s.address || '').toUpperCase().includes('SM ILOILO')
    );
    if (!siteSearch.trim()) return valid;
    const q = siteSearch.toLowerCase();
    return valid.filter(s =>
      (s.code || '').toLowerCase().includes(q) ||
      (s.name || '').toLowerCase().includes(q) ||
      (s.region || '').toLowerCase().includes(q) ||
      (s.address || '').toLowerCase().includes(q)
    );
  }, [sites, siteSearch]);

  const handleAddSite = (e) => {
    e.preventDefault();
    let cleanCode = newSite.code.trim().toUpperCase();
    if (cleanCode === 'APPILO') cleanCode = 'APP ILO';
    if (!cleanCode || !newSite.name.trim()) {
      showToast('Branch code and name are required', 'error');
      return;
    }
    if (sites.some(s => s.code.toUpperCase() === cleanCode)) {
      showToast(`Branch code "${cleanCode}" already exists`, 'error');
      return;
    }
    saveSite({ ...newSite, code: cleanCode, name: newSite.name.trim() });
    setNewSite(BLANK_SITE);
    setShowAddSiteModal(false);
  };

  const handleSaveEditSite = (e) => {
    e.preventDefault();
    if (!editingSite || !editingSite.name.trim()) {
      showToast('Branch name is required', 'error');
      return;
    }
    saveSite({ ...editingSite, name: editingSite.name.trim() });
    setEditingSite(null);
  };

  // Shared region options
  const REGION_OPTIONS = ['Metro Manila', 'Cebu', 'Davao', 'Pampanga', 'Laguna', 'Batangas', 'Bulacan', 'Quezon City', 'Other'];


  const partNumberCounts = useMemo(() => {
    const counts = {};
    (parts || []).forEach(p => {
      const pn = p.part_number?.trim().toUpperCase();
      if (pn) counts[pn] = (counts[pn] || 0) + 1;
    });
    return counts;
  }, [parts]);

  const handleAddPart = (e) => {
    e.preventDefault();
    const cleanPn = newPn.trim().toUpperCase();
    const cleanDesc = newDesc.trim();
    if (!cleanPn || !cleanDesc) {
      showToast('Part number and description are required', 'error');
      return;
    }

    // Validate BOTH Part Number and Description
    const exactExists = (parts || []).some(p =>
      p.part_number?.trim().toUpperCase() === cleanPn &&
      p.description?.trim().toLowerCase() === cleanDesc.toLowerCase()
    );
    if (exactExists) {
      showToast(`Part "${cleanPn}" with description "${cleanDesc}" already exists in the catalog`, 'error');
      return;
    }

    const pnCount = (parts || []).filter(p => p.part_number?.trim().toUpperCase() === cleanPn).length;

    savePart({
      part_number: cleanPn,
      description: cleanDesc,
      iphone_model: newModel.trim() || 'iPhone',
      category_id: newCatId,
      stocking_price: parseFloat(newStockPrice) || 0,
      is_active: true
    });
    setNewPn('');
    setNewDesc('');

    if (pnCount > 0) {
      showToast(`Added description variant for ${cleanPn} (${cleanDesc})`, 'success');
    }
  };

  const handleSaveEditPart = (e) => {
    e.preventDefault();
    if (!editingPart || !editingPart.part_number.trim() || !editingPart.description.trim()) {
      showToast('Part number and description are required', 'error');
      return;
    }
    const cleanPn = editingPart.part_number.trim().toUpperCase();
    const cleanDesc = editingPart.description.trim();

    // Check if another part has both identical part number and identical description
    const duplicate = (parts || []).some(p =>
      p.id !== editingPart.id &&
      p.part_number?.trim().toUpperCase() === cleanPn &&
      p.description?.trim().toLowerCase() === cleanDesc.toLowerCase()
    );
    if (duplicate) {
      showToast(`Another part with number "${cleanPn}" and description "${cleanDesc}" already exists`, 'error');
      return;
    }

    savePart({
      ...editingPart,
      part_number: cleanPn,
      description: cleanDesc,
      iphone_model: editingPart.iphone_model?.trim() || 'iPhone',
      stocking_price: parseFloat(editingPart.stocking_price) || 0
    });
    setEditingPart(null);
  };

  const handleConfirmDeletePart = () => {
    if (!deletingPart) return;
    deletePart(deletingPart);
    setDeletingPart(null);
  };

  const handleConfirmDeleteSite = async () => {
    if (!deletingSite) return;
    await deleteSite(deletingSite.id, deletingSite.code);
    setDeletingSite(null);
  };

  // Execute Force Global Sync & Purge Peer Cache
  const handleExecuteGlobalSync = async () => {
    setIsGlobalSyncing(true);
    setIsSyncModalOpen(false);
    try {
      const res = typeof forceGlobalCloudSyncAndPurge === 'function'
        ? await forceGlobalCloudSyncAndPurge()
        : await syncAllDataToCloud();
      if (res && res.success !== false) {
        setLastSyncResult({
          timestamp: new Date().toLocaleTimeString(),
          syncedBy: currentUser?.fullName || 'Superadmin',
          success: true
        });
      }
    } catch (err) {
      showToast(`Global sync error: ${err.message}`, 'error');
    } finally {
      setIsGlobalSyncing(false);
    }
  };

  // Ping Database Latency
  const handleTestDbPing = async () => {
    setIsTestingLatency(true);
    try {
      if (typeof testDatabaseConnection === 'function') {
        const res = await testDatabaseConnection();
        if (res.connected) {
          setDbLatency(res.latency);
          setDbRowCount(res.count);
          showToast(`Connected to PostgreSQL Cloud! Round-trip Latency: ${res.latency}ms`, 'success');
        } else {
          setDbLatency(null);
          showToast(`Database ping failed: ${res.error || 'Connection error'}`, 'error');
        }
      } else {
        showToast('Database ping utility is active.', 'info');
      }
    } catch (e) {
      showToast('Ping failed: ' + e.message, 'error');
    } finally {
      setIsTestingLatency(false);
    }
  };

  // Pull Fresh Cloud Snapshot
  const handlePullFreshCloudData = async () => {
    try {
      await autoRefreshData({ force: true, silent: false, isManual: true, reason: 'Manual Cloud Hard Pull' });
      showToast('Successfully fetched and refreshed latest state from Supabase PostgreSQL!', 'success');
    } catch (e) {
      showToast('Fetch error: ' + e.message, 'error');
    }
  };

  const copySqlSchema = () => {
    const sqlContent = `-- DC System Supabase Schema with Authentication & RBAC
-- (Refer to src/supabase/schema.sql for the complete script)`;
    navigator.clipboard.writeText(sqlContent);
    setCopied(true);
    showToast('SQL Schema script copied to clipboard!', 'success');
    setTimeout(() => setCopied(false), 3000);
  };

  // Filtered parts calculation
  const filteredParts = useMemo(() => {
    return (parts || []).filter(p => {
      if (selectedCategoryFilter !== 'ALL' && p.category_id !== selectedCategoryFilter) {
        return false;
      }
      if (partSearch.trim()) {
        const q = partSearch.toLowerCase().trim();
        const pnMatch = p.part_number?.toLowerCase().includes(q);
        const descMatch = p.description?.toLowerCase().includes(q);
        const modelMatch = p.iphone_model?.toLowerCase().includes(q);
        if (!pnMatch && !descMatch && !modelMatch) return false;
      }
      return true;
    });
  }, [parts, partSearch, selectedCategoryFilter]);

  return (
    <div className="settings-view" style={{ maxWidth: '1240px', margin: '0 auto', paddingBottom: '30px' }}>
      {/* Sub-Tabs Ribbon Navigation */}
      <div
        style={{
          background: '#ffffff',
          padding: '6px',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          marginBottom: '22px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          overflowX: 'auto'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('parts')}
          style={{
            background: activeTab === 'parts' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
            color: activeTab === 'parts' ? '#ffffff' : '#475569',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: activeTab === 'parts' ? 700 : 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            boxShadow: activeTab === 'parts' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
          }}
        >
          <Smartphone size={15} />
          <span>Parts Master Catalog</span>
          <span
            style={{
              background: activeTab === 'parts' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
              color: activeTab === 'parts' ? '#ffffff' : '#475569',
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 700
            }}
          >
            {parts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sites')}
          style={{
            background: activeTab === 'sites' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
            color: activeTab === 'sites' ? '#ffffff' : '#475569',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: activeTab === 'sites' ? 700 : 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            boxShadow: activeTab === 'sites' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
          }}
        >
          <MapPin size={15} />
          <span>Service Sites &amp; Branches</span>
          <span
            style={{
              background: activeTab === 'sites' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
              color: activeTab === 'sites' ? '#ffffff' : '#475569',
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 700
            }}
          >
            {sites.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          style={{
            background: activeTab === 'categories' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
            color: activeTab === 'categories' ? '#ffffff' : '#475569',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: activeTab === 'categories' ? 700 : 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            boxShadow: activeTab === 'categories' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
          }}
        >
          <Settings size={15} />
          <span>Part Categories</span>
          <span
            style={{
              background: activeTab === 'categories' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
              color: activeTab === 'categories' ? '#ffffff' : '#475569',
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 700
            }}
          >
            {categories.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('supervisor')}
          style={{
            background: activeTab === 'supervisor' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
            color: activeTab === 'supervisor' ? '#ffffff' : '#475569',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: activeTab === 'supervisor' ? 700 : 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            boxShadow: activeTab === 'supervisor' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
          }}
        >
          <FileText size={15} />
          <span>Supervisor &amp; Declaration Form</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sql')}
          style={{
            background: activeTab === 'sql' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
            color: activeTab === 'sql' ? '#ffffff' : '#475569',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: '12.5px',
            fontWeight: activeTab === 'sql' ? 700 : 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            whiteSpace: 'nowrap',
            boxShadow: activeTab === 'sql' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
          }}
        >
          <Database size={15} />
          <span>Supabase Cloud Database</span>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: realtimeConnected ? '#10b981' : '#f59e0b',
              display: 'inline-block',
              boxShadow: realtimeConnected ? '0 0 6px #10b981' : 'none'
            }}
          />
        </button>
      </div>

      {/* 1. Parts Catalog Tab */}
      {activeTab === 'parts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Add Part Card */}
          <div className="card" style={{ padding: '18px 22px', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showAddPartCard ? '16px' : 0, borderBottom: showAddPartCard ? '1px solid #f1f5f9' : 'none', paddingBottom: showAddPartCard ? '12px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Plus size={16} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700, color: '#0f172a' }}>Add New Part to Master Catalog</h4>
                  <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>Register an authorized Apple component SKU, model compatibility, and dual-tier pricing</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddPartCard(!showAddPartCard)}
                className="btn btn-secondary btn-sm"
                style={{ padding: '5px 12px', fontSize: '11.5px', color: '#475569', fontWeight: 600 }}
              >
                {showAddPartCard ? 'Collapse Form' : '+ Expand Form'}
              </button>
            </div>

            {showAddPartCard && (
              <form onSubmit={handleAddPart}>
                {/* Row 1: Part Info */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#475569' }}>
                      Part Number (P/N) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      placeholder="e.g. 661-36918"
                      value={newPn}
                      onChange={(e) => setNewPn(e.target.value)}
                      required
                      style={{ height: '38px', fontSize: '13px' }}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#475569' }}>
                      Description <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Battery, iPhone 15 Pro Max"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      required
                      style={{ height: '38px', fontSize: '13px' }}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#475569' }}>
                      iPhone Model
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. iPhone 15 Pro Max"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      style={{ height: '38px', fontSize: '13px' }}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#475569' }}>
                      Category
                    </label>
                    <select
                      className="form-select"
                      value={newCatId}
                      onChange={(e) => setNewCatId(e.target.value)}
                      style={{ height: '38px', fontSize: '13px' }}
                    >
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Pricing & Action */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', alignItems: 'flex-end', background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#475569' }}>
                      Stocking Price ($)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontWeight: 600, fontSize: '13px' }}>$</span>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input font-mono"
                        placeholder="0.00"
                        value={newStockPrice}
                        onChange={(e) => setNewStockPrice(e.target.value)}
                        style={{ paddingLeft: '24px', height: '38px', fontSize: '13px', fontWeight: 600, color: '#047857' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', height: '38px' }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                        border: 'none',
                        fontWeight: 600,
                        fontSize: '13px',
                        boxShadow: '0 2px 4px rgba(2,132,199,0.2)'
                      }}
                    >
                      <Plus size={15} />
                      <span>Add Part to Catalog</span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Parts Master Catalog Table Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            {/* Toolbar Header */}
            <div
              style={{
                padding: '16px 20px',
                background: '#ffffff',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '14px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: '#f0f9ff', color: '#0284c7', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Smartphone size={20} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                      Parts Master Catalog
                    </h3>
                    <span
                      style={{
                        background: '#e0f2fe',
                        color: '#0369a1',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 700
                      }}
                    >
                      {filteredParts.length} of {parts.length} Parts
                    </span>
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                    Standardized Apple component SKUs, stock prices, and category definitions
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Search Bar */}
                <div style={{ position: 'relative', width: '240px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Search P/N, model, desc..."
                    value={partSearch}
                    onChange={(e) => setPartSearch(e.target.value)}
                    className="form-input"
                    style={{ paddingLeft: '32px', paddingRight: partSearch ? '28px' : '10px', height: '36px', fontSize: '12.5px', width: '100%', borderRadius: '6px' }}
                  />
                  {partSearch && (
                    <button
                      type="button"
                      onClick={() => setPartSearch('')}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Category Filter */}
                <select
                  className="form-select"
                  style={{ height: '36px', fontSize: '12.5px', width: '170px', borderRadius: '6px' }}
                  value={selectedCategoryFilter}
                  onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                >
                  <option value="ALL">All Categories ({parts.length})</option>
                  {categories.map(c => {
                    const count = parts.filter(p => p.category_id === c.id).length;
                    return (
                      <option key={c.id} value={c.id}>{c.name} ({count})</option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Table Content */}
            {filteredParts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                <Smartphone size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                <p style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No parts match your criteria</p>
                <p style={{ margin: 0, fontSize: '12.5px', color: '#94a3b8' }}>Try adjusting your search query or selecting a different category.</p>
                {partSearch && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setPartSearch(''); setSelectedCategoryFilter('ALL'); }}
                    style={{ marginTop: '12px' }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f8fafc' }}>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ width: '45px', textAlign: 'center', padding: '10px 8px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>#</th>
                      <th style={{ width: '130px', textAlign: 'left', padding: '10px 14px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Part Number</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Description</th>
                      <th style={{ width: '130px', textAlign: 'left', padding: '10px 14px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>iPhone Model</th>
                      <th style={{ width: '120px', textAlign: 'center', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Category</th>
                      <th style={{ width: '110px', textAlign: 'right', padding: '10px 14px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Stock Price</th>
                      <th style={{ width: '90px', textAlign: 'center', padding: '10px 8px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Status</th>
                      <th style={{ width: '90px', textAlign: 'center', padding: '10px 10px', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParts.map((p, i) => {
                      const cat = categories.find(c => c.id === p.category_id);
                      const isVariant = partNumberCounts[p.part_number?.toUpperCase()] > 1;
                      const catBadge = getCategoryBadgeStyle(cat?.name);
                      return (
                        <tr
                          key={p.id || `${p.part_number}-${p.description}-${i}`}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            transition: 'background-color 0.1s ease',
                            background: i % 2 === 0 ? '#ffffff' : '#fafafa'
                          }}
                        >
                          <td className="font-mono" style={{ textAlign: 'center', fontSize: '11.5px', color: '#94a3b8' }}>
                            {i + 1}
                          </td>
                          <td className="font-mono" style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span>{p.part_number}</span>
                              {isVariant && (
                                <span
                                  style={{
                                    fontSize: '9.5px',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontWeight: 700,
                                    background: '#fef3c7',
                                    color: '#92400e',
                                    border: '1px solid #fde68a'
                                  }}
                                  title="Multiple descriptions exist in catalog for this Part Number"
                                >
                                  Variant
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 500, color: '#1e293b', fontSize: '13px' }}>
                            {p.description}
                          </td>
                          <td style={{ padding: '12px 14px', color: '#475569', fontSize: '12.5px' }}>
                            <span style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', color: '#334155', fontWeight: 500 }}>
                              {p.iphone_model || 'iPhone'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '12px 10px' }}>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '3px 9px',
                                borderRadius: '6px',
                                background: catBadge.bg,
                                color: catBadge.text,
                                border: `1px solid ${catBadge.border}`,
                                display: 'inline-block',
                                textTransform: 'uppercase',
                                letterSpacing: '0.02em'
                              }}
                            >
                              {cat?.name || 'Part'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '12px 14px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#047857', fontSize: '13px' }}>
                            ${parseFloat(p.stocking_price || 0).toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                padding: '3px 8px',
                                borderRadius: '12px',
                                background: p.is_active !== false ? '#ecfdf5' : '#f1f5f9',
                                color: p.is_active !== false ? '#059669' : '#64748b',
                                border: `1px solid ${p.is_active !== false ? '#a7f3d0' : '#e2e8f0'}`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: p.is_active !== false ? '#10b981' : '#94a3b8' }} />
                              <span>{p.is_active !== false ? 'Active' : 'Inactive'}</span>
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', padding: '12px 10px' }}>
                            <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setEditingPart({ ...p })}
                                title="Edit Part details and prices"
                                style={{ padding: '4px 7px', fontSize: '11.5px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                              >
                                <Edit2 size={13} color="#0284c7" />
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setDeletingPart(p)}
                                title="Delete Part from catalog"
                                style={{ padding: '4px 7px', fontSize: '11.5px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                              >
                                <Trash2 size={13} color="#ef4444" />
                              </button>
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
        </div>
      )}

      {/* --- Modal: Edit Part Dialog --- */}
      {editingPart && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditingPart(null); }}>
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                  <Edit2 size={18} />
                </div>
                <div>
                  <h3 style={{ color: '#fff', fontSize: '16.5px', margin: 0 }}>
                    Edit Part: {editingPart.part_number}
                  </h3>
                  <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Update catalog pricing, description, model, and category
                  </p>
                </div>
              </div>
              <button onClick={() => setEditingPart(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditPart}>
              <div className="modal-body" style={{ padding: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Part Number (P/N) *</label>
                    <input
                      type="text"
                      className="form-input font-mono"
                      value={editingPart.part_number}
                      onChange={(e) => setEditingPart({ ...editingPart, part_number: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">iPhone Model</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editingPart.iphone_model || ''}
                      onChange={(e) => setEditingPart({ ...editingPart, iphone_model: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Description *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingPart.description}
                    onChange={(e) => setEditingPart({ ...editingPart, description: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', marginBottom: '14px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Category</label>
                    <select
                      className="form-select"
                      value={editingPart.category_id}
                      onChange={(e) => setEditingPart({ ...editingPart, category_id: e.target.value })}
                    >
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Stock Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input font-mono"
                      value={editingPart.stocking_price}
                      onChange={(e) => setEditingPart({ ...editingPart, stocking_price: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                  <input
                    type="checkbox"
                    id="part-active-check"
                    checked={editingPart.is_active !== false}
                    onChange={(e) => setEditingPart({ ...editingPart, is_active: e.target.checked })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="part-active-check" style={{ fontSize: '13px', cursor: 'pointer', margin: 0, fontWeight: 500 }}>
                    Active in Catalog & Operations
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingPart(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Save size={15} />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Modal: Confirm Delete Part --- */}
      {deletingPart && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDeletingPart(null); }}>
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ background: '#991b1b', color: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="#fca5a5" />
                <h3 style={{ color: '#fff', fontSize: '16px', margin: 0, fontWeight: 700 }}>Confirm Part Deletion</h3>
              </div>
              <button onClick={() => setDeletingPart(null)} style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ fontSize: '13.5px', color: '#1e293b', margin: '0 0 14px' }}>
                Are you sure you want to permanently delete part <strong className="font-mono" style={{ color: '#b91c1c' }}>{deletingPart.part_number}</strong>?
              </p>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '8px', fontSize: '12.5px', marginBottom: '14px' }}>
                <div style={{ marginBottom: '4px' }}><strong>Part Number:</strong> <span className="font-mono">{deletingPart.part_number}</span></div>
                <div style={{ marginBottom: '4px' }}><strong>Description:</strong> {deletingPart.description}</div>
                <div style={{ marginBottom: '4px' }}><strong>iPhone Model:</strong> {deletingPart.iphone_model || 'iPhone'}</div>
                <div><strong>Stock Price:</strong> ${deletingPart.stocking_price || 0}</div>
              </div>
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '11px 14px', borderRadius: '8px', fontSize: '12px', color: '#991b1b', lineHeight: 1.5 }}>
                <strong>Accidental Deletion Protection:</strong> This component will be removed from master catalog indexing. This deletion will be <strong>permanently logged in the system Audit Trail</strong>.
              </div>
            </div>
            <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setDeletingPart(null)}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmDeletePart} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={13} />
                <span>Yes, Permanently Delete Part</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Sites Tab */}
      {activeTab === 'sites' && (
        <div>
          {/* Toolbar */}
          <div className="card" style={{ marginBottom: '16px', padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '7px', borderRadius: '7px', display: 'inline-flex' }}>
                  <Building2 size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                    Service Sites &amp; Branches
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {filteredSites.length} of {sites.length} branches shown
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Search */}
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Search branch, code, region, address…"
                    value={siteSearch}
                    onChange={e => setSiteSearch(e.target.value)}
                    style={{ paddingLeft: '28px', paddingRight: '10px', paddingTop: '7px', paddingBottom: '7px',
                      fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '5px', width: '240px' }}
                  />
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  title="Sync and pull latest site addresses from Cloud DB or apply directory defaults"
                  disabled={isRefreshingSites}
                  onClick={async () => {
                    setIsRefreshingSites(true);
                    await refreshSitesFromCloud();
                    setIsRefreshingSites(false);
                  }}
                >
                  <RefreshCw size={13} className={isRefreshingSites ? 'spin-animation' : ''} />
                  <span>{isRefreshingSites ? 'Syncing…' : 'Sync / Pull Cloud DB'}</span>
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => { setNewSite(BLANK_SITE); setShowAddSiteModal(true); }}
                >
                  <Plus size={14} /><span>Add New Branch</span>
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-container" style={{ maxHeight: '580px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Code</th>
                    <th>Site / Branch Name</th>
                    <th style={{ width: 130 }}>Region</th>
                    <th>Address</th>
                    <th style={{ width: 90 }}>Contact</th>
                    <th style={{ width: 140 }}>Type</th>
                    <th style={{ width: 80, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSites.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                        {siteSearch ? `No branches match "${siteSearch}"` : 'No branches configured.'}
                      </td>
                    </tr>
                  ) : (
                    filteredSites.map(s => (
                      <tr key={s.id}>
                        <td className="font-mono"><strong>{s.code}</strong></td>
                        <td style={{ fontWeight: 600, fontSize: '13px' }}>{s.name}</td>
                        <td>
                          <span className={`badge ${s.region === 'Metro Manila' ? 'badge-primary' : 'badge-warning'}`}>
                            {s.region}
                          </span>
                        </td>
                        <td style={{ fontSize: '12px', color: '#475569', maxWidth: '220px' }}>
                          {s.address || <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>No address set</span>}
                        </td>
                        <td style={{ fontSize: '12px', color: '#64748b' }}>
                          {s.contact_person && <div style={{ fontWeight: 600 }}>{s.contact_person}</div>}
                          {s.contact_phone && <div style={{ color: '#94a3b8' }}>{s.contact_phone}</div>}
                          {!s.contact_person && !s.contact_phone && <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>—</span>}
                        </td>
                        <td>
                          <span className={`badge ${s.is_dc ? 'badge-success' : 'badge-neutral'}`}>
                            {s.is_dc ? 'Distribution Center' : 'Service Branch'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              title="Edit branch"
                              onClick={() => setEditingSite({ ...s })}
                              style={{ padding: '4px 8px' }}
                            >
                              <Edit2 size={12} />
                              <span>Edit</span>
                            </button>
                            {!s.is_dc && (
                              <button
                                className="btn btn-danger btn-sm"
                                title="Delete branch"
                                onClick={() => setDeletingSite(s)}
                                style={{ padding: '4px 7px' }}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Delete Branch Confirmation Modal ──────────────────────────── */}
          {deletingSite && (
            <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setDeletingSite(null); }}>
              <div className="modal-content" style={{ maxWidth: '480px' }}>
                <div className="modal-header" style={{ background: '#991b1b', color: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertTriangle size={20} color="#fca5a5" />
                    <h3 style={{ color: '#fff', fontSize: '16px', margin: 0, fontWeight: 700 }}>Confirm Branch Deletion</h3>
                  </div>
                  <button onClick={() => setDeletingSite(null)} style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body" style={{ padding: '20px' }}>
                  <p style={{ margin: '0 0 14px', fontSize: '13.5px', color: '#1e293b' }}>
                    Are you sure you want to permanently delete service branch <strong style={{ color: '#b91c1c' }}>{deletingSite.name}</strong>?
                  </p>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '8px', fontSize: '12.5px', marginBottom: '14px' }}>
                    <div style={{ marginBottom: '4px' }}><strong>Branch Code:</strong> <span className="font-mono">{deletingSite.code}</span></div>
                    <div style={{ marginBottom: '4px' }}><strong>Branch Name:</strong> {deletingSite.name}</div>
                    <div style={{ marginBottom: '4px' }}><strong>Region:</strong> {deletingSite.region || 'Metro Manila'}</div>
                    <div><strong>Address:</strong> {deletingSite.address || deletingSite.full_address || '—'}</div>
                  </div>
                  <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '11px 14px', borderRadius: '8px', fontSize: '12px', color: '#991b1b', lineHeight: 1.5 }}>
                    <strong>Accidental Deletion Protection:</strong> This branch will be removed from all active matrices, allocations, and site catalogs. This deletion will be <strong>permanently logged in the system Audit Trail</strong>.
                  </div>
                </div>
                <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setDeletingSite(null)}>Cancel</button>
                  <button className="btn btn-danger btn-sm" onClick={handleConfirmDeleteSite} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Trash2 size={13} />
                    <span>Yes, Permanently Delete Branch</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Add Branch Modal ─────────────────────────────────────────── */}
          {showAddSiteModal && (
            <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowAddSiteModal(false); }}>
              <div className="modal-content" style={{ maxWidth: '560px' }}>
                <div className="modal-header" style={{ background: '#0f172a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                      <Plus size={18} />
                    </div>
                    <div>
                      <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>Add New Branch</h3>
                      <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0' }}>
                        Create a new service site or distribution center
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setShowAddSiteModal(false)}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleAddSite}>
                  <div className="modal-body" style={{ padding: '20px' }}>
                    {/* Code + Name */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px', marginBottom: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Branch Code *</label>
                        <input type="text" className="form-input font-mono"
                          placeholder="e.g. APP-BHS"
                          value={newSite.code}
                          onChange={e => setNewSite({ ...newSite, code: e.target.value })}
                          required style={{ textTransform: 'uppercase' }} />
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Unique short code (auto-uppercased)</div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Branch / Site Name *</label>
                        <input type="text" className="form-input"
                          placeholder="e.g. MOBILECARE – APP GREENBELT 3"
                          value={newSite.name}
                          onChange={e => setNewSite({ ...newSite, name: e.target.value })}
                          required />
                      </div>
                    </div>

                    {/* Region + Type */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Region</label>
                        <select className="form-select"
                          value={newSite.region}
                          onChange={e => setNewSite({ ...newSite, region: e.target.value })}>
                          {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Branch Type</label>
                        <select className="form-select"
                          value={newSite.is_dc ? 'dc' : 'branch'}
                          onChange={e => setNewSite({ ...newSite, is_dc: e.target.value === 'dc' })}>
                          <option value="branch">Service Branch</option>
                          <option value="dc">Distribution Center</option>
                        </select>
                      </div>
                    </div>

                    {/* Address */}
                    <div className="form-group" style={{ marginBottom: '14px' }}>
                      <label className="form-label"><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />Address</label>
                      <textarea className="form-input" rows={2}
                        placeholder="Full branch address, Philippines"
                        value={newSite.address}
                        onChange={e => setNewSite({ ...newSite, address: e.target.value })}
                        style={{ resize: 'none' }} />
                    </div>

                    {/* Contact */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label"><User size={12} style={{ display: 'inline', marginRight: '4px' }} />Contact Person</label>
                        <input type="text" className="form-input"
                          placeholder="Branch manager name"
                          value={newSite.contact_person}
                          onChange={e => setNewSite({ ...newSite, contact_person: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label"><Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />Contact Phone</label>
                        <input type="text" className="form-input"
                          placeholder="+63 9XX XXX XXXX"
                          value={newSite.contact_phone}
                          onChange={e => setNewSite({ ...newSite, contact_phone: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: '1px solid #e2e8f0' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddSiteModal(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      <Plus size={14} /><span>Add Branch</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ── Edit Branch Modal ────────────────────────────────────────── */}
          {editingSite && (
            <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setEditingSite(null); }}>
              <div className="modal-content" style={{ maxWidth: '560px' }}>
                <div className="modal-header" style={{ background: '#0f172a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: '#38bdf8', padding: '6px', borderRadius: '6px', color: '#0f172a' }}>
                      <Edit2 size={18} />
                    </div>
                    <div>
                      <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>Edit Branch: {editingSite.code}</h3>
                      <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0' }}>
                        Update address, contact details, region, and branch type
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setEditingSite(null)}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleSaveEditSite}>
                  <div className="modal-body" style={{ padding: '20px' }}>
                    {/* Code (read-only) + Name */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px', marginBottom: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Branch Code</label>
                        <input type="text" className="form-input font-mono"
                          value={editingSite.code} readOnly
                          style={{ background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' }} />
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Code cannot be changed</div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Branch / Site Name *</label>
                        <input type="text" className="form-input"
                          value={editingSite.name}
                          onChange={e => setEditingSite({ ...editingSite, name: e.target.value })}
                          required />
                      </div>
                    </div>

                    {/* Region + Type */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Region</label>
                        <select className="form-select"
                          value={editingSite.region || 'Metro Manila'}
                          onChange={e => setEditingSite({ ...editingSite, region: e.target.value })}>
                          {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Branch Type</label>
                        <select className="form-select"
                          value={editingSite.is_dc ? 'dc' : 'branch'}
                          onChange={e => setEditingSite({ ...editingSite, is_dc: e.target.value === 'dc' })}>
                          <option value="branch">Service Branch</option>
                          <option value="dc">Distribution Center</option>
                        </select>
                      </div>
                    </div>

                    {/* Address */}
                    <div className="form-group" style={{ marginBottom: '14px' }}>
                      <label className="form-label"><MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />Address</label>
                      <textarea className="form-input" rows={2}
                        placeholder="Full branch address, Philippines"
                        value={editingSite.address || ''}
                        onChange={e => setEditingSite({ ...editingSite, address: e.target.value })}
                        style={{ resize: 'none' }} />
                    </div>

                    {/* Contact */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label"><User size={12} style={{ display: 'inline', marginRight: '4px' }} />Contact Person</label>
                        <input type="text" className="form-input"
                          placeholder="Branch manager name"
                          value={editingSite.contact_person || ''}
                          onChange={e => setEditingSite({ ...editingSite, contact_person: e.target.value })} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label"><Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />Contact Phone</label>
                        <input type="text" className="form-input"
                          placeholder="+63 9XX XXX XXXX"
                          value={editingSite.contact_phone || ''}
                          onChange={e => setEditingSite({ ...editingSite, contact_phone: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: '1px solid #e2e8f0' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSite(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary btn-sm">
                      <Save size={14} /><span>Save Changes</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}


      {/* 3. Categories Tab */}
      {activeTab === 'categories' && (
        <div className="card">
          <h3 style={{ marginBottom: '14px' }}>Extensible Part Categories</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
            {categories.map(c => (
              <div
                key={c.id}
                style={{
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  background: 'var(--bg-primary)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong>{c.name}</strong>
                  <span className="font-mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.code}</span>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  Serialized: <strong>{c.is_serialized ? 'Yes (Part # + Serial)' : 'No'}</strong>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  Requires IMEI: <strong>{c.has_imei ? 'Yes' : 'No (Battery/Display)'}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Supervisor & Declaration Form Settings Tab */}
      {activeTab === 'supervisor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={20} color="var(--primary)" />
                  <h3 style={{ margin: 0 }}>MDC Supervisor & Declaration Form Directive</h3>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Configure the default Distribution Center supervisor assignment and declaration form auto-population rules.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    saveSupervisorSettings({
                      supervisor_name: supervisorName.trim() || 'Anjo Alcazar',
                      supervisor_title: supervisorTitle.trim() || 'MDC Supervisor of DC',
                      guard_on_duty: guardOnDutyDefault.trim()
                    });
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Save size={13} />
                  <span>Save Supervisor Details</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
              {/* Supervisor Info Card */}
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 14px 0', fontSize: '13.5px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <User size={15} color="var(--primary)" />
                  <span>Supervisor Assignment & Identity</span>
                </h4>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label font-bold" style={{ fontSize: '12px' }}>
                    MDC Supervisor Name <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Anjo Alcazar"
                    value={supervisorName}
                    onChange={(e) => setSupervisorName(e.target.value)}
                    style={{ fontSize: '13px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'block' }}>
                    Default supervisor for all packing lists and declaration forms (Fixed to Anjo Alcazar).
                  </span>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>
                    Supervisor Position / Role Title
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. MDC Supervisor of DC"
                    value={supervisorTitle}
                    onChange={(e) => setSupervisorTitle(e.target.value)}
                    style={{ fontSize: '13px' }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '4px' }}>
                  <label className="form-label" style={{ fontSize: '12px' }}>
                    Default Guard on Duty (Optional)
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. SG. Roberto Cruz"
                    value={guardOnDutyDefault}
                    onChange={(e) => setGuardOnDutyDefault(e.target.value)}
                    style={{ fontSize: '13px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'block' }}>
                    Can be left blank if guard on duty physically signs upon pickup.
                  </span>
                </div>
              </div>

              {/* Physical / Manual Wet Signature Policy Card */}
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 14px 0', fontSize: '13.5px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={15} color="var(--primary)" />
                  <span>Physical Wet Signature Policy</span>
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
                  <p style={{ margin: 0 }}>
                    In compliance with internal operational protocols, electronic signatures (e-signatures) are disabled.
                  </p>
                  <p style={{ margin: 0 }}>
                    When the <strong>Packing List & Site Transfer Declaration Form PDF</strong> is generated and printed, an underline is provided above the supervisor’s printed name for a manual wet-ink signature.
                  </p>
                  <div style={{ marginTop: '12px', padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '11.5px', color: '#1e40af' }}>
                    ℹ️ <strong>Manual Sign-Off:</strong> Ensure DC supervisor physically reviews, verifies, and wet-signs Page 2 of the printed document prior to handover to logistics / courier rider.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Live Declaration Form Mockup Preview */}
          <div className="card" style={{ background: '#ffffff', border: '1px solid #cbd5e1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <FileText size={16} color="var(--primary)" />
              <h4 style={{ margin: 0, fontSize: '13px', color: '#0f172a' }}>
                Live Declaration Form Layout (Page 2 Preview)
              </h4>
            </div>

            <div
              style={{
                background: '#ffffff',
                border: '1px solid #94a3b8',
                borderRadius: '4px',
                padding: '24px',
                maxWidth: '720px',
                margin: '0 auto',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
                <img
                  src={mobilecareNoBGLogo}
                  alt="Mobile Care"
                  style={{ height: '28px', width: 'auto', objectFit: 'contain' }}
                />
                <div style={{ fontSize: '12pt', fontWeight: 800, color: '#0f172a', letterSpacing: '0.02em' }}>
                  BUSINESS DISTRIBUTION CENTER
                </div>
              </div>

              {/* Grid 2 Columns */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', marginBottom: '40px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <div style={{ fontSize: '9pt', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>TRANSFER TO (SITE)</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600, paddingBottom: '3px', borderBottom: '1px solid #64748b' }}>
                      SERVICE HUB / BRANCH NAME
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '9pt', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>TYPE OF COURIER</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600, paddingBottom: '3px', borderBottom: '1px solid #64748b' }}>
                      LALAMOVE / LITE EXPRESS / UTILITY
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '9pt', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>BOOKING ID / AIRWAY BILL:</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600, paddingBottom: '3px', borderBottom: '1px solid #64748b' }}>
                      TRK-20260827-001
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '9pt', fontWeight: 800, color: '#0f172a', marginBottom: '3px' }}>COURIER NAME AND SIGNATURE</div>
                    <div style={{ fontSize: '10pt', fontWeight: 600, paddingBottom: '3px', borderBottom: '1px solid #64748b', color: '#64748b' }}>
                      [Courier Rider Name & Physical Signature Line]
                    </div>
                  </div>
                </div>

                {/* ID HERE Box */}
                <div style={{ border: '2px solid #0f172a', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                  <div style={{ fontSize: '14pt', fontWeight: 800, color: '#0f172a', letterSpacing: '0.05em' }}>ID HERE</div>
                </div>
              </div>

              {/* Bottom Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                <div>
                  <div style={{ fontSize: '9.5pt', fontWeight: 800, color: '#0f172a', marginBottom: '2px' }}>MDC - SUPERVISOR</div>
                  <div style={{ position: 'relative', borderBottom: '1px solid #64748b', minHeight: '38px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{ fontSize: '9pt', fontWeight: 800, color: '#0f172a', zIndex: 1, paddingBottom: '2px' }}>{supervisorName.toUpperCase()}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <div style={{ fontSize: '9.5pt', fontWeight: 800, color: '#0f172a', marginBottom: '2px' }}>GUARD ON DUTY:</div>
                    <div style={{ fontSize: '9.5pt', minHeight: '18px', paddingBottom: '2px', borderBottom: '1px solid #64748b', color: '#64748b' }}>
                      {guardOnDutyDefault || '[Guard on duty signature]'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '9.5pt', fontWeight: 800, color: '#0f172a', marginBottom: '2px' }}>DATE PICKED UP:</div>
                    <div style={{ fontSize: '9.5pt', minHeight: '18px', paddingBottom: '2px', borderBottom: '1px solid #64748b' }}>
                      {new Date().toLocaleDateString('en-US')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Enhanced Supabase PostgreSQL Cloud Database Center */}
      {activeTab === 'sql' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Card 1: System Health, Connection & Operational Control Hub */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              color: '#ffffff',
              border: '1px solid #334155',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.15)'
            }}
          >
            {/* Top row: Title + Live Status Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ background: '#0284c7', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Server size={22} color="#fff" />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
                      Supabase PostgreSQL Cloud Database
                    </h3>
                    <p style={{ margin: '3px 0 0 0', fontSize: '12.5px', color: '#94a3b8' }}>
                      Authoritative multi-station cloud synchronization & global peer cache purge control
                    </p>
                  </div>
                </div>
              </div>

              {/* Status Pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    background: realtimeConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: realtimeConnected ? '#34d399' : '#fbbf24',
                    border: `1px solid ${realtimeConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: realtimeConnected ? '#10b981' : '#f59e0b',
                      boxShadow: realtimeConnected ? '0 0 8px #10b981' : 'none'
                    }}
                  />
                  {realtimeConnected ? 'Realtime WebSocket Connected' : 'Connecting to Realtime Room...'}
                </span>

                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '20px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)'
                  }}
                >
                  <Database size={13} />
                  PostgreSQL Hosted DB
                </span>
              </div>
            </div>

            {/* Middle Row: Metrics Strips */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                marginBottom: '22px',
                padding: '14px',
                background: 'rgba(15, 23, 42, 0.6)',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Cloud Provider
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#f8fafc', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Supabase / AWS AP-SE</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Database Ping Latency
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: dbLatency !== null ? (dbLatency < 100 ? '#4ade80' : '#facc15') : '#94a3b8', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Activity size={14} />
                  <span>{dbLatency !== null ? `${dbLatency} ms (Active)` : 'Click "Ping DB" below'}</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Last Synchronized
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
                  {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : 'Just now'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Sync Authority
                </div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#f8fafc', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <ShieldCheck size={14} color="#38bdf8" />
                  <span>{currentUser?.fullName || 'Superadmin User'}</span>
                </div>
              </div>
            </div>

            {/* Bottom Row: Primary Action Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {/* 1. Primary Action: Force Global Sync */}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsSyncModalOpen(true)}
                  disabled={isGlobalSyncing}
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    borderColor: '#059669',
                    padding: '9px 18px',
                    fontWeight: 800,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  <RefreshCw size={15} className={isGlobalSyncing ? 'animate-spin' : ''} />
                  <span>{isGlobalSyncing ? 'Syncing & Purging Peer Caches...' : "Force Global Sync & Purge All Users' Cache"}</span>
                </button>

                {/* 2. Pull Fresh from Cloud */}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePullFreshCloudData}
                  disabled={isGlobalSyncing || isAutoRefreshing}
                  style={{
                    background: '#1e293b',
                    color: '#38bdf8',
                    borderColor: '#38bdf8',
                    padding: '9px 14px',
                    fontWeight: 700,
                    fontSize: '12.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <ArrowDownCircle size={15} />
                  <span>Pull Latest from Cloud</span>
                </button>

                {/* 3. Latency Ping */}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleTestDbPing}
                  disabled={isTestingLatency}
                  style={{
                    background: '#1e293b',
                    color: '#e2e8f0',
                    borderColor: '#475569',
                    padding: '9px 14px',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Zap size={14} color="#f59e0b" />
                  <span>{isTestingLatency ? 'Pinging...' : 'Ping DB Latency'}</span>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={copySqlSchema}
                  style={{
                    background: '#1e293b',
                    color: '#cbd5e1',
                    borderColor: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  <span>{copied ? 'SQL Copied!' : 'Copy Schema SQL'}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsSchemaExpanded(!isSchemaExpanded)}
                  style={{
                    background: '#1e293b',
                    color: '#cbd5e1',
                    borderColor: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <FileCode size={14} />
                  <span>{isSchemaExpanded ? 'Hide Schema DDL' : 'View Schema DDL'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Synchronized Database Entities Matrix */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>
                  Synchronized PostgreSQL Tables & Operational Registries
                </h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  All 10 core system tables actively tracked, versioned, and broadcast across user sessions
                </p>
              </div>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', fontWeight: 700 }}>
                100% Schema Compliant
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {[
                { name: 'Parts Catalog', table: 'parts', count: parts?.length || 0, unit: 'SKUs', desc: 'Component P/Ns, descriptions & prices', icon: Boxes, color: '#0284c7' },
                { name: 'Service Sites & Branches', table: 'sites', count: sites?.length || 0, unit: 'locations', desc: 'DC & retail service branches', icon: MapPin, color: '#10b981' },
                { name: 'Component Categories', table: 'part_categories', count: categories?.length || 0, unit: 'categories', desc: 'Battery, Display, Camera, etc.', icon: Layers, color: '#8b5cf6' },
                { name: 'Serialized Inventory Stock', table: 'inventory_units', count: inventoryUnits?.length || 0, unit: 'units', desc: 'Active in-stock & assigned serials', icon: HardDrive, color: '#f59e0b' },
                { name: 'Shipments & Manifests', table: 'shipments', count: shipments?.length || 0, unit: 'manifests', desc: 'Outbound dispatch packing lists', icon: Globe, color: '#06b6d4' },
                { name: 'Demand Forecasting', table: 'forecast_entries', count: forecastItems?.length || 0, unit: 'forecasts', desc: 'Linear regression model entries', icon: Activity, color: '#ec4899' },
                { name: 'Multi-Site Allocations', table: 'allocation_items', count: allocations?.length || 0, unit: 'splits', desc: 'Hamilton-Hare branch allocations', icon: RefreshCw, color: '#14b8a6' },
                { name: 'Purchase Orders', table: 'purchase_orders', count: purchaseOrders?.length || 0, unit: 'orders', desc: 'DC vendor replenishment orders', icon: Server, color: '#6366f1' },
                { name: 'User Profiles & Roles', table: 'profiles', count: usersList?.length || 0, unit: 'accounts', desc: 'Staff credentials & access scopes', icon: Users, color: '#3b82f6' },
                { name: 'Audit Trail Logs', table: 'scan_logs', count: (uploadAuditLogs?.length || 0) + (scanLogs?.length || 0), unit: 'logs', desc: 'Hardware scanner & upload audits', icon: ShieldCheck, color: '#64748b' }
              ].map((ent, idx) => {
                const IconComponent = ent.icon;
                return (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '14px',
                      background: 'var(--bg-card)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px'
                    }}
                  >
                    <div
                      style={{
                        background: `${ent.color}15`,
                        color: ent.color,
                        padding: '8px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <IconComponent size={18} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                        <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                          {ent.name}
                        </strong>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: ent.color,
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          {ent.count} {ent.unit}
                        </span>
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', lineHeight: 1.3 }}>
                        {ent.desc}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="font-mono" style={{ fontSize: '10.5px', color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: '3px' }}>
                          public.{ent.table}
                        </span>
                        <span style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <CheckCircle2 size={11} /> Synced
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card 3: Expandable PostgreSQL Schema Definition (DDL) */}
          {isSchemaExpanded && (
            <div className="card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileCode size={16} color="var(--primary)" />
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800 }}>
                    PostgreSQL DDL Schema (src/supabase/schema.sql)
                  </h4>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={copySqlSchema}>
                  {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                  <span>{copied ? 'Copied' : 'Copy All SQL'}</span>
                </button>
              </div>

              <div
                style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  padding: '16px',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11.5px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  border: '1px solid #334155'
                }}
              >
                <pre style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1', margin: 0 }}>
{`-- ============================================================================
-- MDC SYSTEM 2: Distribution Center Parts Allocation, Inventory & Reporting
-- Supabase / PostgreSQL Schema Definition with Hardened Security, RBAC & RPCs
-- ============================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Custom Enums
CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'planner', 'warehouse_staff', 'logistics_staff', 'technician', 'site_staff', 'management_viewer', 'parts_management', 'user');
CREATE TYPE inventory_status AS ENUM ('in_stock', 'allocated', 'packed', 'shipped', 'delivered', 'received', 'damaged', 'returned');
CREATE TYPE po_status AS ENUM ('draft', 'submitted', 'partially_received', 'received', 'closed');
CREATE TYPE shipment_status AS ENUM ('draft', 'packing', 'ready_for_dispatch', 'pending_pickup', 'shipped', 'in_transit', 'delivered', 'received_confirmed', 'discrepancy', 'cancelled');

-- 3. Core Tables
-- public.profiles (Linked to auth.users, internal RBAC, site assignment)
-- public.user_page_permissions (Granular per-user page access permissions)
-- public.part_categories (BATTERY, DISPLAY, CAMERA, BACK_GLASS, MID_REAR)
-- public.parts (Part Numbers, descriptions, prices, safety stock percentage)
-- public.sites (26 retail/service branches + Distribution Center)
-- public.inventory_units (Serialized unit tracking with assignment status)
-- public.shipments & public.shipment_items (Outbound manifest records)
-- public.parts_requests (Branch parts request workflows & approval states)
-- public.saved_records (Live Master State & Audit Registries)`}
                </pre>
              </div>
            </div>
          )}

          {/* Modal: Confirmation for Global Force Sync & Peer Cache Purge */}
          {isSyncModalOpen && (
            <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsSyncModalOpen(false); }}>
              <div className="modal-content" style={{ maxWidth: '520px', width: '95%' }}>
                <div className="modal-header" style={{ background: '#065f46' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: '#10b981', padding: '6px', borderRadius: '6px', color: '#fff' }}>
                      <RefreshCw size={20} />
                    </div>
                    <div>
                      <h3 style={{ color: '#fff', fontSize: '15.5px', margin: 0, fontWeight: 800 }}>
                        Confirm Global Cloud Sync & Cache Purge
                      </h3>
                      <p style={{ color: '#a7f3d0', fontSize: '11.5px', margin: '2px 0 0 0' }}>
                        Enterprise-wide database refresh across all logged-in devices
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setIsSyncModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#a7f3d0', cursor: 'pointer', padding: '4px' }}>
                    <X size={20} />
                  </button>
                </div>

                <div className="modal-body" style={{ padding: '20px' }}>
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px' }}>
                    <p style={{ margin: 0, fontSize: '12.5px', color: '#92400e', lineHeight: 1.45 }}>
                      <strong>Important Notice:</strong> Clicking confirm will execute the following operations immediately:
                    </p>
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px', fontSize: '12px', color: '#92400e', lineHeight: 1.4 }}>
                      <li><strong>Push Master Data:</strong> Upserts all latest Parts, Sites, Categories, Inventory Units, Shipments, and User Accounts to Supabase PostgreSQL.</li>
                      <li><strong>Realtime Network Broadcast:</strong> Transmits a <code>GLOBAL_FORCE_CACHE_REFRESH</code> event across WebSocket and local buses.</li>
                      <li><strong>Peer Cache Invalidation:</strong> All active sessions (PMG Specialists, Branch staff, Admins) will purge their local operational cache and reload the fresh database state without being logged out.</li>
                    </ul>
                  </div>

                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0 }}>
                    Are you sure you want to proceed with this global synchronization?
                  </p>
                </div>

                <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setIsSyncModalOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleExecuteGlobalSync}
                    style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      borderColor: '#059669',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <RefreshCw size={14} />
                    <span>Confirm & Broadcast Global Sync</span>
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
