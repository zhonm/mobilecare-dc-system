import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite } from '../utils/appContextHelpers';
import mobileCareLogo from '../assets/mobilecare_logo.png';
import {
  LayoutDashboard,
  UploadCloud,
  TrendingUp,
  BookmarkCheck,
  ShoppingCart,
  Barcode,
  Split,
  PackageCheck,
  Truck,
  FileSpreadsheet,
  BarChart3,
  History,
  Settings,
  ShieldCheck,
  Users,
  LogOut,
  Search,
  X,
  Inbox
} from 'lucide-react';

export default function Sidebar() {
  const {
    activeTab,
    setActiveTab,
    currentUser,
    canAccess,
    signOut,
    purchaseOrders,
    shipments,
    partsRequests,
    sites = [],
    isMobileNavOpen,
    setIsMobileNavOpen
  } = useApp();

  const [navSearch, setNavSearch] = useState('');

  const openPOsCount = purchaseOrders.filter(p => p.status !== 'closed' && p.status !== 'received').length;
  const pendingShipmentsCount = shipments.filter(s => s.status === 'draft' || s.status === 'packing').length;
  const pendingRequestsCount = (partsRequests || []).filter(r => r.status === 'pending').length;

  const userSite = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [sites, currentUser?.siteId, currentUser?.site_id, currentUser?.siteCode]);

  const navItems = [
    // 1. Planning & Allocation (Placed prominently at top)
    { id: 'dashboard', label: 'DC Overview', icon: LayoutDashboard, section: 'Planning & Allocation' },
    { id: 'forecast', label: 'Demand Forecasting', icon: TrendingUp, section: 'Planning & Allocation' },
    { id: 'allocation', label: 'Allocation Matrix', icon: Split, section: 'Planning & Allocation' },
    { id: 'import', label: 'Fixably / GSX Data Import', icon: UploadCloud, section: 'Planning & Allocation' },
    { id: 'records', label: 'Saved Period Records', icon: BookmarkCheck, section: 'Planning & Allocation' },
    { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart, badge: openPOsCount, section: 'Planning & Allocation' },

    // 2. Operations & Logistics (Combined Arrival, Intake, Scan-Out & Shipments)
    { id: 'request-parts', label: 'Parts Requests', icon: Inbox, badge: pendingRequestsCount, section: 'Operations & Logistics' },
    { id: 'scan-in', label: 'Receive Scan-In', icon: Barcode, section: 'Operations & Logistics' },
    { id: 'scan-out', label: 'Pack Scan-Out', icon: PackageCheck, badge: pendingShipmentsCount, section: 'Operations & Logistics' },
    { id: 'shipments', label: 'Outbound Shipments', icon: Truck, section: 'Operations & Logistics' },

    // 3. Reports & Traceability
    { id: 'forecast-reports', label: 'Forecasting Reports', icon: BarChart3, section: 'Reports & Traceability' },
    { id: 'reports', label: 'Stock Transfer Reports', icon: FileSpreadsheet, section: 'Reports & Traceability' },
    { id: 'audit', label: 'Serialized Audit Log', icon: History, section: 'Reports & Traceability' },

    // 4. Administration
    { id: 'settings', label: 'Parts & Site Catalog', icon: Settings, section: 'Administration' },
    { id: 'user-access', label: 'User Access Management', icon: Users, section: 'Administration' }
  ];

  // Filter items by permitted access & search query
  const visibleItems = navItems.filter(item => {
    if (!canAccess(item.id)) return false;
    if (!navSearch.trim()) return true;
    const q = navSearch.toLowerCase().trim();
    return item.label.toLowerCase().includes(q) || item.section.toLowerCase().includes(q);
  });

  const sections = [
    'Planning & Allocation',
    'Operations & Logistics',
    'Reports & Traceability',
    'Administration'
  ];

  return (
    <>
      {isMobileNavOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setIsMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${isMobileNavOpen ? 'mobile-open' : ''}`}>
        {/* Brand Header */}
        <div className="sidebar-header">
          <div className="sidebar-logo-img-wrapper">
            <img
              src={mobileCareLogo}
              alt="Mobile Care"
              className="sidebar-logo-img"
            />
          </div>
          <div className="sidebar-brand">
            <h2>DC System</h2>
            <p className="sidebar-subtitle">
              <span className="sidebar-status-dot" title="Live Database Synchronization Active"></span>
              Mobile Care Services Phils.
            </p>
          </div>
          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

      {/* Quick Search Bar */}
      <div className="sidebar-search-container">
        <div className="sidebar-search-input-wrapper">
          <Search size={13} className="sidebar-search-icon" />
          <input
            type="text"
            placeholder="Search menu..."
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            className="sidebar-search-input"
          />
          {navSearch && (
            <button
              type="button"
              onClick={() => setNavSearch('')}
              className="sidebar-search-clear-btn"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Navigation Menu */}
      <div className="sidebar-nav custom-scrollbar">
        {visibleItems.length === 0 ? (
          <div className="sidebar-no-results">
            No matching navigation items
          </div>
        ) : (
          sections.map(secName => {
            const items = visibleItems.filter(item => item.section === secName);
            if (items.length === 0) return null;

            return (
              <div key={secName} className="nav-section-group">
                <div className="nav-section-title">{secName}</div>
                {items.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <div className="nav-item-left">
                        <Icon size={17} className={`nav-icon ${isActive ? 'active-icon' : ''}`} />
                        <span className="nav-label">{item.label}</span>
                      </div>
                      <div className="nav-item-right">
                        {item.hotkey && <span className="nav-hotkey">{item.hotkey}</span>}
                        {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Modernized User Profile Footer */}
      <div className="sidebar-footer">
        <div className="user-profile-card">
          <div className="user-avatar-wrapper">
            <div className="user-avatar">
              <ShieldCheck size={16} color="#38bdf8" />
            </div>
            <span className="user-online-ring"></span>
          </div>

          <div className="user-info-text">
            <h4 title={currentUser?.fullName || 'User'}>
              {currentUser?.fullName || 'User'}
            </h4>
            <div className="user-role-position" title={currentUser?.rolePosition || 'DC Operations'}>
              {currentUser?.rolePosition || (currentUser?.role === 'superadmin' ? 'Superadmin' : currentUser?.role === 'admin' ? 'Operations Lead' : 'DC Specialist')}
            </div>
            <div className="user-tags-row">
              <span className={`user-role-badge user-role-${currentUser?.role || 'user'}`}>
                {currentUser?.role === 'superadmin' ? 'SUPERADMIN' : currentUser?.role === 'parts_management' ? 'PMG SPECIALIST' : currentUser?.role?.replace('_', ' ')}
              </span>
              {userSite && (
                <span className="user-site-code">
                  <span className="user-dot-sep">•</span>
                  <span>{userSite.code}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="sidebar-signout-btn"
        >
          <LogOut size={14} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
    </>
  );
}
