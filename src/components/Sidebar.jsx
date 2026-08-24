import { useState } from 'react';
import { useApp } from '../context/AppContext';
import mobileCareLogo from '../assets/mobilecare_logo.png';
import {
  LayoutDashboard,
  UploadCloud,
  TrendingUp,
  BookmarkCheck,
  BookmarkPlus,
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
  X
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
    sites
  } = useApp();

  const [navSearch, setNavSearch] = useState('');

  const openPOsCount = purchaseOrders.filter(p => p.status !== 'closed' && p.status !== 'received').length;
  const pendingShipmentsCount = shipments.filter(s => s.status === 'draft' || s.status === 'packing').length;

  const userSite = sites.find(s => s.id === currentUser?.siteId);

  const navItems = [
    { id: 'dashboard', label: 'DC Overview', icon: LayoutDashboard, section: 'Core' },
    { id: 'import', label: 'Fixably / GSX Data Import', icon: UploadCloud, section: 'Planning' },
    { id: 'forecast', label: 'Demand Forecasting', icon: TrendingUp, section: 'Planning' },
    { id: 'records', label: 'Saved Period Records', icon: BookmarkCheck, section: 'Planning' },
    { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart, badge: openPOsCount, section: 'Planning' },
    { id: 'scan-in', label: 'Receive Scan-In', icon: Barcode, hotkey: 'F1', section: 'Warehouse Operations' },
    { id: 'intake-records', label: 'DC Intake Records', icon: BookmarkPlus, section: 'Warehouse Operations' },
    { id: 'allocation', label: 'Allocation Matrix', icon: Split, section: 'Warehouse Operations' },
    { id: 'scan-out', label: 'Pack Scan-Out', icon: PackageCheck, hotkey: 'F2', badge: pendingShipmentsCount, section: 'Warehouse Operations' },
    { id: 'shipments', label: 'Shipments & Packing Lists', icon: Truck, section: 'Distribution' },
    { id: 'reports', label: 'Stock Transfer Reports', icon: FileSpreadsheet, section: 'Reports & Analytics' },
    { id: 'forecast-reports', label: 'Forecasting Reports', icon: BarChart3, section: 'Reports & Analytics' },
    { id: 'audit', label: 'Serialized Audit Log', icon: History, section: 'Traceability' },
    { id: 'settings', label: 'Parts & Site Catalog', icon: Settings, section: 'Admin' },
    { id: 'user-access', label: 'User Access Management', icon: Users, section: 'Admin' }
  ];

  // Filter items by permitted access & search query
  const visibleItems = navItems.filter(item => {
    if (!canAccess(item.id)) return false;
    if (!navSearch.trim()) return true;
    const q = navSearch.toLowerCase().trim();
    return item.label.toLowerCase().includes(q) || item.section.toLowerCase().includes(q);
  });

  const sections = ['Core', 'Planning', 'Warehouse Operations', 'Distribution', 'Reports & Analytics', 'Traceability', 'Admin'];

  return (
    <aside className="sidebar">
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <h2>DC System</h2>
            <span className="sidebar-pro-pill">PRO</span>
          </div>
          <p className="sidebar-subtitle">
            <span className="sidebar-status-dot" title="Live Database Synchronization Active"></span>
            Mobile Care Services Phils.
          </p>
        </div>
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
              <span className="user-role-badge">
                {currentUser?.role?.replace('_', ' ')}
              </span>
              {userSite && (
                <span className="user-site-code">
                  • {userSite.code}
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
  );
}
