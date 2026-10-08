import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite, isDraftSupersededOrFulfilled } from '../utils/appContextHelpers';
import mobileCareLogo from '../assets/mobilecareNoBGLogo.png';
import {
  LayoutDashboard,
  UploadCloud,
  TrendingUp,
  ShoppingCart,
  Barcode,
  Split,
  PackageCheck,
  Truck,
  BarChart3,
  History,
  Settings,
  ShieldCheck,
  Users,
  LogOut,
  X,
  Inbox,
  GitCompare,
  Globe,
  ChevronDown,
  ChevronRight,
  Package
} from 'lucide-react';

export default function Sidebar() {
  const {
    activeTab,
    setActiveTab,
    pmgSubTab,
    setPmgSubTab,
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

  const openPOsCount = purchaseOrders.filter(p => p.status !== 'closed' && p.status !== 'received').length;
  const pendingShipmentsCount = useMemo(() => {
    return (shipments || []).filter(s => {
      if (!s || !Array.isArray(s.items) || s.items.length === 0) return false;
      const st = String(s.status || '').toLowerCase().trim();
      if (st !== 'draft' && st !== 'packing' && st !== 'pending_pickup') return false;
      if (s.is_superseded || st === 'completed_superseded') return false;
      if (isDraftSupersededOrFulfilled(s, shipments, sites)) return false;
      return true;
    }).length;
  }, [shipments, sites]);
  const pendingRequestsCount = (partsRequests || []).filter(r => r.status === 'pending').length;

  const userSite = useMemo(() => {
    return resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  }, [sites, currentUser?.siteId, currentUser?.site_id, currentUser?.siteCode]);

  const isPartsActive = activeTab === 'request-parts' || activeTab === 'all-stocks';

  const [isPartsDropdownOpen, setIsPartsDropdownOpen] = useState(() => isPartsActive);

  // Automatically open dropdown when inside any parts sub-page, and close when accessing any other page
  useEffect(() => {
    if (isPartsActive) {
      setIsPartsDropdownOpen(true);
    } else {
      setIsPartsDropdownOpen(false);
    }
  }, [isPartsActive]);

  const handleDropdownParentClick = (_item) => {
    if (!isPartsActive) {
      setIsPartsDropdownOpen(true);
      setActiveTab('request-parts');
      if (setPmgSubTab) setPmgSubTab(pmgSubTab || 'requests_table');
      setIsMobileNavOpen(false);
    } else {
      setIsPartsDropdownOpen(prev => !prev);
    }
  };

  const handleChevronToggle = (e) => {
    e.stopPropagation();
    setIsPartsDropdownOpen(prev => !prev);
  };

  const handleSubItemClick = (child) => {
    if (child.id === 'all-stocks') {
      setActiveTab('all-stocks');
      if (setPmgSubTab) setPmgSubTab('all_stocks');
      try { localStorage.setItem('mdc_parts_subtab', 'all_stocks'); } catch (e) {}
    } else {
      setActiveTab(child.id);
      if (setPmgSubTab && child.subTab) {
        setPmgSubTab(child.subTab);
        try { localStorage.setItem('mdc_parts_subtab', child.subTab); } catch (e) {}
      }
    }
    setIsMobileNavOpen(false);
  };

  const isChildActive = (child) => {
    if (child.id === 'all-stocks') {
      return activeTab === 'all-stocks' || (activeTab === 'request-parts' && pmgSubTab === 'all_stocks');
    }
    if (child.id === 'request-parts') {
      if (activeTab !== 'request-parts') return false;
      if (child.subTab === 'requests_table') {
        return !pmgSubTab || pmgSubTab === 'requests_table';
      }
      return pmgSubTab === child.subTab;
    }
    return activeTab === child.id;
  };

  const navItems = [
    // 1. Planning & Allocation (Placed prominently at top)
    { id: 'dashboard', label: 'DC Overview', icon: LayoutDashboard, section: 'Planning & Allocation' },
    { id: 'forecast', label: 'Demand Forecasting', icon: TrendingUp, section: 'Planning & Allocation' },
    { id: 'allocation', label: 'Allocation Matrix', icon: Split, section: 'Planning & Allocation' },
    { id: 'import', label: 'Fixably / GSX Data Import', icon: UploadCloud, section: 'Planning & Allocation' },
    { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart, badge: openPOsCount, section: 'Planning & Allocation' },

    // 2. Operations & Logistics (Combined Arrival, Intake, Scan-Out, Shipments, & Parts Inventory)
    {
      id: 'parts-group',
      label: 'Parts Requests & Stock',
      icon: Inbox,
      badge: pendingRequestsCount,
      section: 'Operations & Logistics',
      isDropdown: true,
      children: [
        {
          id: 'request-parts',
          subTab: 'requests_table',
          label: 'Parts Requests',
          icon: Inbox,
          badge: pendingRequestsCount
        },
        {
          id: 'request-parts',
          subTab: 'stock_on_hand',
          label: 'Branch Stock',
          icon: Package
        },
        {
          id: 'all-stocks',
          subTab: 'all_stocks',
          label: 'All Stocks & Multi-Site',
          icon: Globe
        },
        {
          id: 'request-parts',
          subTab: 'usage_history',
          label: 'Used Parts History',
          icon: History
        }
      ]
    },
    { id: 'scan-in', label: 'Receive Scan-In', icon: Barcode, section: 'Operations & Logistics' },
    { id: 'scan-out', label: 'Pack Scan-Out', icon: PackageCheck, badge: pendingShipmentsCount, section: 'Operations & Logistics' },
    { id: 'shipments', label: 'Outbound Shipments', icon: Truck, section: 'Operations & Logistics' },

    // 3. Reports & Traceability
    { id: 'forecast-reports', label: 'Forecasting Reports', icon: BarChart3, section: 'Reports & Traceability' },
    { id: 'site-transfers-fifo', label: 'Site Transfers & FIFO Audit', icon: GitCompare, section: 'Reports & Traceability' },
    { id: 'audit', label: 'Serialized Audit Log', icon: History, section: 'Reports & Traceability' },

    // 4. Administration
    { id: 'settings', label: 'Settings', icon: Settings, section: 'Administration' },
    { id: 'user-access', label: 'User Access Management', icon: Users, section: 'Administration' }
  ];

  // Filter items by permitted access
  const visibleItems = navItems.filter(item => {
    if (item.isDropdown) {
      return item.children.some(child => canAccess(child.id));
    }
    return canAccess(item.id);
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
          <div className="sidebar-brand-wrapper">
            <div className="sidebar-logo-card">
              <img
                src={mobileCareLogo}
                alt="Mobile Care"
                className="sidebar-logo-img"
              />
            </div>
            <div className="sidebar-brand-info">
              <h2 className="sidebar-brand-title">DC System</h2>
              <div className="sidebar-company-row">
                <span className="sidebar-status-dot" title="Live Database Synchronization Active"></span>
                <span className="sidebar-company-name">Mobile Care Services Inc.</span>
              </div>
            </div>
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

        {/* Navigation Menu */}
        <div className="sidebar-nav custom-scrollbar">
          {sections.map(secName => {
            const items = visibleItems.filter(item => item.section === secName);
            if (items.length === 0) return null;

            return (
              <div key={secName} className="nav-section-group">
                <div className="nav-section-title">{secName}</div>
                {items.map(item => {
                  if (item.isDropdown) {
                    const visibleChildren = item.children ? item.children.filter(child => canAccess(child.id)) : [];
                    if (visibleChildren.length === 0) return null;

                    const isDropdownActive = visibleChildren.some(child => isChildActive(child));

                    return (
                      <div key={item.id} className="nav-dropdown-wrapper">
                        <div
                          className={`nav-item nav-dropdown-header ${isDropdownActive ? 'active-group' : ''}`}
                          onClick={() => handleDropdownParentClick(item)}
                          title={`${item.label} (Click to ${isPartsDropdownOpen ? 'collapse' : 'expand'})`}
                        >
                          <div className="nav-item-left">
                            <item.icon size={17} className={`nav-icon ${isDropdownActive ? 'active-icon' : ''}`} />
                            <span className="nav-label">{item.label}</span>
                          </div>
                          <div className="nav-item-right">
                            {(!isPartsDropdownOpen && item.badge > 0) && (
                              <span className="nav-badge">{item.badge}</span>
                            )}
                            <button
                              type="button"
                              className="nav-dropdown-chevron-btn"
                              onClick={handleChevronToggle}
                              aria-label={isPartsDropdownOpen ? 'Collapse menu' : 'Expand menu'}
                            >
                              {isPartsDropdownOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </div>
                        </div>

                        {isPartsDropdownOpen && (
                          <div className="nav-sub-menu">
                            {visibleChildren.map(child => {
                              const ChildIcon = child.icon;
                              const isChildItemActive = isChildActive(child);
                              return (
                                <div
                                  key={`${child.id}-${child.subTab || child.id}`}
                                  className={`nav-sub-item ${isChildItemActive ? 'active' : ''}`}
                                  onClick={() => handleSubItemClick(child)}
                                >
                                  <div className="nav-item-left">
                                    <ChildIcon size={14} className={`nav-icon ${isChildItemActive ? 'active-icon' : ''}`} />
                                    <span className="nav-label">{child.label}</span>
                                  </div>
                                  <div className="nav-item-right">
                                    {child.badge > 0 && <span className="nav-badge">{child.badge}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        setIsPartsDropdownOpen(false);
                        setActiveTab(item.id);
                        setIsMobileNavOpen(false);
                      }}
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
          })}
      </div>

      {/* Modernized User Profile Footer */}
      <div className="sidebar-footer">
        <div className="user-profile-card">
          <div className="user-avatar-wrapper">
            <div className="user-avatar">
              <ShieldCheck size={18} color="#38bdf8" />
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
