import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import UserAccessManagement from './UserAccessManagement';
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
  RefreshCw
} from 'lucide-react';

export default function SettingsCatalog() {
  const {
    parts,
    categories,
    sites,
    savePart,
    deletePart,
    saveSite,
    refreshSitesFromCloud,
    syncAllDataToCloud,
    currentUser,
    showToast
  } = useApp();
  const [activeTab, setActiveTab] = useState('parts'); // 'parts' | 'sites' | 'categories' | 'users' | 'sql'
  const [copied, setCopied] = useState(false);
  const [isRefreshingSites, setIsRefreshingSites] = useState(false);

  // Search & Filter State
  const [partSearch, setPartSearch] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');

  // New Part Form State
  const [newPn, setNewPn] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newModel, setNewModel] = useState('iPhone 15');
  const [newCatId, setNewCatId] = useState(categories[0]?.id || 'cat-battery');
  const [newStockPrice, setNewStockPrice] = useState(150);
  const [newExchangePrice, setNewExchangePrice] = useState(100);

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

  const filteredSites = useMemo(() => {
    if (!siteSearch.trim()) return sites;
    const q = siteSearch.toLowerCase();
    return sites.filter(s =>
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
      exchange_price: parseFloat(newExchangePrice) || 0,
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
      stocking_price: parseFloat(editingPart.stocking_price) || 0,
      exchange_price: parseFloat(editingPart.exchange_price) || 0
    });
    setEditingPart(null);
  };

  const handleConfirmDeletePart = () => {
    if (!deletingPart) return;
    deletePart(deletingPart);
    setDeletingPart(null);
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
    <div className="settings-view" style={{ maxWidth: '1150px', margin: '0 auto' }}>
      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button
          className={`btn ${activeTab === 'parts' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('parts')}
        >
          <Smartphone size={15} />
          <span>Parts Master Catalog ({parts.length})</span>
        </button>
        <button
          className={`btn ${activeTab === 'sites' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('sites')}
        >
          <MapPin size={15} />
          <span>Service Sites & Branches ({sites.length})</span>
        </button>
        <button
          className={`btn ${activeTab === 'categories' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('categories')}
        >
          <Settings size={15} />
          <span>Part Categories ({categories.length})</span>
        </button>
        {currentUser?.role === 'superadmin' && (
          <button
            className={`btn ${activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={15} />
            <span>User Access Control</span>
          </button>
        )}
        <button
          className={`btn ${activeTab === 'sql' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('sql')}
        >
          <Database size={15} />
          <span>Supabase SQL Schema</span>
        </button>
      </div>

      {/* 1. Parts Catalog Tab */}
      {activeTab === 'parts' && (
        <div>
          {/* Add Part Card */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Plus size={18} color="var(--primary)" />
              <h3 style={{ margin: 0 }}>Add New Part to Catalog</h3>
            </div>
            <form onSubmit={handleAddPart}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Part Number (P/N) *</label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    placeholder="e.g. 661-36918"
                    value={newPn}
                    onChange={(e) => setNewPn(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Description *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Battery, iPhone 15 Pro Max"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">iPhone Model</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. iPhone 15 Pro Max"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Category</label>
                  <select
                    className="form-select"
                    value={newCatId}
                    onChange={(e) => setNewCatId(e.target.value)}
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
                    className="form-input"
                    value={newStockPrice}
                    onChange={(e) => setNewStockPrice(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Exchange Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={newExchangePrice}
                    onChange={(e) => setNewExchangePrice(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={15} />
                  <span>Add Part to Catalog</span>
                </button>
              </div>
            </form>
          </div>

          {/* Parts Master Catalog Table with Search and Filters */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0 }}>Parts Master Catalog</h3>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Manage part pricing, commodity categories, and active stock definitions ({filteredParts.length} of {parts.length} parts)
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Search Bar */}
                <div style={{ position: 'relative', width: '220px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search P/N, model, desc..."
                    value={partSearch}
                    onChange={(e) => setPartSearch(e.target.value)}
                    className="form-input"
                    style={{ paddingLeft: '30px', height: '36px', fontSize: '12.5px', width: '100%' }}
                  />
                </div>

                {/* Category Filter */}
                <select
                  className="form-select"
                  style={{ height: '36px', fontSize: '12.5px', width: '160px' }}
                  value={selectedCategoryFilter}
                  onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                >
                  <option value="ALL">All Categories</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {filteredParts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 20px', color: '#94a3b8', border: '1px dashed #e2e8f0', borderRadius: 'var(--radius-md)' }}>
                <Smartphone size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
                <p style={{ margin: 0, fontSize: '13.5px' }}>No parts match your search or filter criteria.</p>
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: '550px', overflowY: 'auto' }}>
                <table className="data-table" style={{ fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '45px' }}>#</th>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th>iPhone Model</th>
                      <th>Category</th>
                      <th style={{ textAlign: 'right' }}>Stock Price ($)</th>
                      <th style={{ textAlign: 'right' }}>Exchange Price ($)</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'right', width: '120px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParts.map((p, i) => {
                      const cat = categories.find(c => c.id === p.category_id);
                      const isVariant = partNumberCounts[p.part_number?.toUpperCase()] > 1;
                      return (
                        <tr key={p.id || `${p.part_number}-${p.description}-${i}`}>
                          <td className="font-mono" style={{ fontSize: '12px', color: '#64748b' }}>{i + 1}</td>
                          <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <span>{p.part_number}</span>
                              {isVariant && (
                                <span
                                  className="badge badge-warning"
                                  title="Multiple descriptions exist in catalog for this Part Number"
                                  style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}
                                >
                                  Variant
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ fontWeight: 500 }}>{p.description}</td>
                          <td style={{ color: '#475569' }}>{p.iphone_model || 'iPhone'}</td>
                          <td>
                            <span className="badge badge-neutral" style={{ fontSize: '11px' }}>{cat?.name || 'Part'}</span>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#047857' }}>
                            ${p.stocking_price || 0}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#475569' }}>
                            ${p.exchange_price || 0}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className={`badge ${p.is_active !== false ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '10.5px' }}>
                              {p.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setEditingPart({ ...p })}
                                title="Edit Part details and prices"
                                style={{ padding: '4px 8px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <Edit2 size={12} />
                                <span>Edit</span>
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => setDeletingPart(p)}
                                title="Delete Part from catalog"
                                style={{ padding: '4px 8px', fontSize: '11.5px' }}
                              >
                                <Trash2 size={12} />
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

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
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

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Exchange Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input font-mono"
                      value={editingPart.exchange_price || 0}
                      onChange={(e) => setEditingPart({ ...editingPart, exchange_price: e.target.value })}
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
          <div className="modal-content" style={{ maxWidth: '460px' }}>
            <div className="modal-header" style={{ background: '#991b1b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="#fff" />
                <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>Delete Part from Catalog?</h3>
              </div>
              <button onClick={() => setDeletingPart(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ fontSize: '13.5px', color: 'var(--text-main)', marginBottom: '12px' }}>
                Are you sure you want to delete part <strong className="font-mono">{deletingPart.part_number}</strong>?
              </p>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: 'var(--radius-md)', fontSize: '12.5px', marginBottom: '12px' }}>
                <div><strong>Description:</strong> {deletingPart.description}</div>
                <div><strong>iPhone Model:</strong> {deletingPart.iphone_model || 'iPhone'}</div>
                <div><strong>Stock Price:</strong> ${deletingPart.stocking_price || 0}</div>
              </div>
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '12px', color: '#991b1b' }}>
                <strong>Warning:</strong> This will remove this part definition from the master catalog across the system.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeletingPart(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmDeletePart}>
                Yes, Delete Part
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
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Edit branch"
                            onClick={() => setEditingSite({ ...s })}
                            style={{ padding: '4px 10px' }}
                          >
                            <Edit2 size={13} />
                            <span>Edit</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

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

      {/* 4. User Access Management Tab (for Superadmin) */}
      {activeTab === 'users' && (
        <UserAccessManagement />
      )}

      {/* 5. Supabase SQL Schema Tab */}
      {activeTab === 'sql' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3>Supabase PostgreSQL Cloud Database</h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Sync all local master data (Parts, Sites, Serialized Inventory, Categories, Users) to Supabase cloud.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn btn-primary"
                onClick={syncAllDataToCloud}
                style={{ background: '#10b981', borderColor: '#059669' }}
              >
                <Database size={14} />
                <span>Sync Local Data to Cloud DB</span>
              </button>
              <button className="btn btn-secondary" onClick={copySqlSchema}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy Schema SQL'}</span>
              </button>
            </div>
          </div>

          <div
            style={{
              background: '#0f172a',
              color: '#38bdf8',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              maxHeight: '380px',
              overflowY: 'auto'
            }}
          >
            <pre style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>
{`-- The complete schema is located at: src/supabase/schema.sql
-- Tables created:
-- 1. profiles (linked to auth.users, includes has_set_password, is_active)
-- 2. user_page_permissions (granular per-user page access matrix)
-- 3. part_categories (BATTERY, DISPLAY, CAMERA, BACK_GLASS, MID_REAR)
-- 4. parts (Part Numbers, descriptions, prices, safety stock)
-- 5. sites (26 retail/service branches + DC)
-- 6. repair_usage_records (GSX / Fixably raw ETL records)
-- 7. forecast_cycles & forecast_entries (Linear regression forecasts)
-- 8. purchase_orders & po_items (DC vendor replenishment)
-- 9. inventory_units (Serialized unit tracking)
-- 10. allocation_cycles & allocation_items (Multi-site Hamilton-Hare splits)
-- 11. shipments & shipment_items (Manifests matching Packing List.png)
-- 12. scan_logs (Hardware HID barcode scanner audit events)`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
