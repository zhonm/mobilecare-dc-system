import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite } from '../utils/appContextHelpers';
import mobileCareLogo from '../assets/mobilecare_logo.png';
import {
  Inbox,
  Barcode,
  Globe,
  Package,
  Wrench,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  Search,
  X
} from 'lucide-react';

export default function PmgSidebar() {
  const {
    activeTab,
    setActiveTab,
    pmgSubTab,
    setPmgSubTab,
    currentUser,
    signOut,
    sites = [],
    partsRequests = [],
    getStockOnHandForSite,
    inventoryUnits = [],
    isAutoRefreshing
  } = useApp();

  const [navSearch, setNavSearch] = useState('');

  // Resolve user site object with universal resolver
  const userSite = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [sites, currentUser?.siteId, currentUser?.site_id, currentUser?.siteCode]);

  // Compute live branch stock and requests metrics for sidebar widget
  const branchStock = useMemo(() => {
    if (typeof getStockOnHandForSite === 'function') {
      return getStockOnHandForSite(userSite.id);
    }
    const units = (inventoryUnits || []).filter(u => {
      const uSiteId = u.current_site_id || u.siteId;
      const uSiteCode = u.site_code || u.siteCode;
      return (uSiteId === userSite.id || uSiteCode === userSite.code) && String(u.status || '').toLowerCase() === 'in_stock';
    });
    return { totalInStock: units.length };
  }, [getStockOnHandForSite, userSite, inventoryUnits]);

  // Requests metrics for this branch
  const branchRequests = useMemo(() => {
    return (partsRequests || []).filter(r =>
      r.site_id === userSite.id ||
      r.site_code === userSite.code ||
      r.requested_by === currentUser?.id
    );
  }, [partsRequests, userSite, currentUser?.id]);

  const pendingCount = branchRequests.filter(r => r.status === 'pending').length;

  // PMG Navigation Items
  const pmgNavItems = [
    {
      id: 'requests',
      label: 'Parts Requests',
      section: 'Branch Operations',
      icon: Inbox,
      badge: pendingCount,
      badgeColor: '#f59e0b',
      onClick: () => {
        setActiveTab('request-parts');
        if (setPmgSubTab) setPmgSubTab('requests_table');
      },
      isActive: activeTab === 'request-parts' && pmgSubTab === 'requests_table'
    },
    {
      id: 'stock',
      label: 'Branch Stock On Hand',
      section: 'Branch Operations',
      icon: Package,
      badge: branchStock.totalInStock,
      badgeColor: '#0284c7',
      onClick: () => {
        setActiveTab('request-parts');
        if (setPmgSubTab) setPmgSubTab('stock_on_hand');
      },
      isActive: activeTab === 'request-parts' && pmgSubTab === 'stock_on_hand'
    },
    {
      id: 'scan-in',
      label: 'Receive Scan-In',
      section: 'Branch Operations',
      icon: Barcode,
      onClick: () => {
        setActiveTab('scan-in');
      },
      isActive: activeTab === 'scan-in'
    },
    {
      id: 'used-parts',
      label: 'Parts Consumption Log',
      section: 'Branch Operations',
      icon: Wrench,
      onClick: () => {
        setActiveTab('request-parts');
        if (setPmgSubTab) setPmgSubTab('usage_history');
      },
      isActive: activeTab === 'request-parts' && pmgSubTab === 'usage_history'
    },
    {
      id: 'all-stocks',
      label: 'All Stocks & Multi-Site',
      section: 'Network Visibility',
      icon: Globe,
      onClick: () => {
        setActiveTab('all-stocks');
        if (setPmgSubTab) setPmgSubTab('all_stocks');
      },
      isActive: activeTab === 'all-stocks' || (activeTab === 'request-parts' && pmgSubTab === 'all_stocks')
    }
  ];

  const filteredNavItems = pmgNavItems.filter(it => {
    if (!navSearch.trim()) return true;
    const q = navSearch.toLowerCase().trim();
    return it.label.toLowerCase().includes(q) || it.section.toLowerCase().includes(q);
  });

  const sections = ['Branch Operations', 'Network Visibility'];

  return (
    <aside className="sidebar pmg-sidebar">
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
            <h2>MobileCare</h2>
            <span className="pmg-role-badge">PMG</span>
          </div>
          <p className="sidebar-subtitle">
            <span className="sidebar-status-dot" title="Live Database Synchronization Active"></span>
            Branch Operations Portal
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

      {/* Navigation Links */}
      <div className="sidebar-nav custom-scrollbar" style={{ flex: 1 }}>
        {filteredNavItems.length === 0 ? (
          <div className="sidebar-no-results">
            No matching navigation items
          </div>
        ) : (
          sections.map(secName => {
            const items = filteredNavItems.filter(item => item.section === secName);
            if (items.length === 0) return null;

            return (
              <div key={secName} className="nav-section-group">
                <div className="nav-section-title">{secName}</div>
                {items.map(item => {
                  const Icon = item.icon;
                  const isActive = item.isActive;
                  return (
                    <div
                      key={item.id}
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      onClick={item.onClick}
                    >
                      <div className="nav-item-left">
                        <Icon size={16} className={`nav-icon ${isActive ? 'active-icon' : ''}`} />
                        <span className="nav-label">{item.label}</span>
                      </div>
                      <div className="nav-item-right">
                        {item.hotkey && <span className="nav-hotkey">{item.hotkey}</span>}
                        {typeof item.badge === 'number' && item.badge > 0 && (
                          <span
                            className="nav-badge"
                            style={{ background: item.badgeColor || '#0284c7' }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Branch Information Card */}
      <div className="pmg-info-card">
        <div className="pmg-info-row">
          <span className="pmg-info-label">Branch Code:</span>
          <span className="pmg-info-val font-mono">{userSite.code}</span>
        </div>
        <div className="pmg-info-row">
          <span className="pmg-info-label">Security:</span>
          <span className="pmg-info-val" style={{ color: '#10b981' }}>Serial Privacy Protected</span>
        </div>
        <div className="pmg-info-row">
          <span className="pmg-info-label">Sync Status:</span>
          <span className="pmg-info-val" style={{ color: isAutoRefreshing ? '#38bdf8' : '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle2 size={10} />
            {isAutoRefreshing ? 'Syncing...' : 'Connected'}
          </span>
        </div>
      </div>

      {/* Modernized User Profile Footer */}
      <div className="sidebar-footer">
        <div className="user-profile-card">
          <div className="user-avatar-wrapper">
            <div className="user-avatar" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' }}>
              <ShieldCheck size={16} color="#ffffff" />
            </div>
            <span className="user-online-ring"></span>
          </div>

          <div className="user-info-text">
            <h4 title={currentUser?.fullName || 'User'}>
              {currentUser?.fullName || 'User'}
            </h4>
            <div className="user-role-position" title={currentUser?.rolePosition || 'Parts Management Specialist'}>
              {currentUser?.rolePosition || 'Parts Management Specialist'}
            </div>
            <div className="user-tags-row">
              <span className="user-role-badge user-role-pmg">
                PMG SPECIALIST
              </span>
              <span className="user-site-code">
                <span className="user-dot-sep">•</span>
                <span>{userSite.code}</span>
              </span>
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