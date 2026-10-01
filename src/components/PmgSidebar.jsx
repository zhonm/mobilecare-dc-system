import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { resolveSite } from '../utils/appContextHelpers';
import mobileCareLogo from '../assets/mobilecareNoBGLogo.png';
import {
  Inbox,
  Globe,
  Wrench,
  LogOut,
  ShieldCheck,
  X,
  MessageSquare,
  ChevronRight,
  Building2,
  FileSpreadsheet,
  PackageCheck
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
    isAutoRefreshing,
    isMobileNavOpen,
    setIsMobileNavOpen
  } = useApp();

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

  // PMG Navigation Items with rich subtitles and enlarged layout
  const pmgNavItems = [
    {
      id: 'requests',
      label: 'Parts Requests',
      description: 'Requisitions & fulfillment',
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
      id: 'stock-receive',
      label: 'Stock On Hand & Receive',
      description: 'Branch stock & scan-in station',
      section: 'Branch Operations',
      icon: PackageCheck,
      badge: branchStock.totalInStock,
      badgeColor: '#0284c7',
      onClick: () => {
        setActiveTab('scan-in');
        if (setPmgSubTab) setPmgSubTab('stock_on_hand');
      },
      isActive: activeTab === 'scan-in' || (activeTab === 'request-parts' && pmgSubTab === 'stock_on_hand')
    },
    {
      id: 'site-monitoring',
      label: 'Site Stock Monitoring',
      description: 'Excel parts usage & stock tracking',
      section: 'Branch Operations',
      icon: FileSpreadsheet,
      badge: branchStock.totalInStock,
      badgeColor: '#059669',
      onClick: () => {
        setActiveTab('request-parts');
        if (setPmgSubTab) setPmgSubTab('site_monitoring');
      },
      isActive: activeTab === 'request-parts' && pmgSubTab === 'site_monitoring'
    },
    {
      id: 'used-parts',
      label: 'Parts Consumption Log',
      description: 'Technician usage history',
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
      description: 'Network-wide parts visibility',
      section: 'Network Visibility',
      icon: Globe,
      onClick: () => {
        setActiveTab('all-stocks');
        if (setPmgSubTab) setPmgSubTab('all_stocks');
      },
      isActive: activeTab === 'all-stocks' || (activeTab === 'request-parts' && pmgSubTab === 'all_stocks')
    },
    {
      id: 'feedback',
      label: 'Developer Contact',
      description: 'Direct support & feedback',
      section: 'Support & Help',
      icon: MessageSquare,
      onClick: () => {
        setActiveTab('feedback');
      },
      isActive: activeTab === 'feedback'
    }
  ];

  const sections = ['Branch Operations', 'Network Visibility', 'Support & Help'];

  return (
    <>
      {isMobileNavOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setIsMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar pmg-sidebar floating-sidebar ${isMobileNavOpen ? 'mobile-open' : ''}`}>
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
              <div className="sidebar-brand-title-row">
                <h2 className="sidebar-brand-title">DC System</h2>
                <span className="pmg-role-badge">PMG PORTAL</span>
              </div>
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

        {/* Enriched & Enlarged Navigation Items */}
        <div className="sidebar-nav custom-scrollbar" style={{ flex: 1 }}>
          {sections.map(secName => {
            const items = pmgNavItems.filter(item => item.section === secName);
            if (items.length === 0) return null;

            return (
              <div key={secName} className="pmg-nav-section">
                <div className="pmg-nav-section-title">
                  <span>{secName}</span>
                  <span className="pmg-nav-section-line" />
                </div>
                {items.map(item => {
                  const Icon = item.icon;
                  const isActive = item.isActive;
                  return (
                    <div
                      key={item.id}
                      className={`pmg-nav-card ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        if (typeof item.onClick === 'function') item.onClick();
                        setIsMobileNavOpen(false);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (typeof item.onClick === 'function') item.onClick();
                          setIsMobileNavOpen(false);
                        }
                      }}
                      title={`${item.label} — ${item.description}`}
                    >
                      <div className="pmg-nav-card-left">
                        <div className="pmg-nav-icon-tile">
                          <Icon size={19} />
                        </div>
                        <div className="pmg-nav-text-col">
                          <span className="pmg-nav-card-title">{item.label}</span>
                          <span className="pmg-nav-card-desc">{item.description}</span>
                        </div>
                      </div>
                      <div className="pmg-nav-card-right">
                        {typeof item.badge === 'number' && item.badge > 0 && (
                          <span
                            className="pmg-nav-pill-badge"
                            style={item.badgeColor ? { background: `${item.badgeColor}25`, borderColor: `${item.badgeColor}66`, color: item.badgeColor } : undefined}
                          >
                            {item.badge}
                          </span>
                        )}
                        <ChevronRight size={14} className="pmg-nav-chevron" />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Branch Station & Operational Telemetry Card */}
        <div className="pmg-station-card">
          <div className="pmg-station-header">
            <div className="pmg-station-badge">
              <Building2 size={12} />
              <span>{userSite.code || 'BRANCH'} STATION</span>
            </div>
            <div className="pmg-station-status" style={{ color: isAutoRefreshing ? '#38bdf8' : '#10b981' }}>
              <span className={`status-dot ${isAutoRefreshing ? 'dot-blue' : 'dot-green'}`} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Connected'}</span>
            </div>
          </div>

          <div className="pmg-station-grid">
            <div className="pmg-station-metric">
              <span className="pmg-station-metric-label">Stock Units</span>
              <span className="pmg-station-metric-val font-mono" style={{ color: '#38bdf8' }}>
                {branchStock.totalInStock}
              </span>
            </div>
            <div className="pmg-station-metric">
              <span className="pmg-station-metric-label">Pending Reqs</span>
              <span className="pmg-station-metric-val font-mono" style={{ color: pendingCount > 0 ? '#f59e0b' : '#94a3b8' }}>
                {pendingCount}
              </span>
            </div>
          </div>

          <div className="pmg-station-footer-row" style={{ justifyContent: 'center' }}>
            <span className="font-mono" style={{ fontSize: '10.5px', color: '#94a3b8' }}>
              {userSite.name || 'MobileCare'}
            </span>
          </div>
        </div>

        {/* User Details Footer at the Bottom to Prevent Accidental Sign-Outs */}
        <div className="sidebar-footer pmg-sidebar-footer">
          <div className="user-profile-card">
            <div className="user-avatar-wrapper">
              <div className="user-avatar" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' }}>
                <ShieldCheck size={18} color="#ffffff" />
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
            title="Sign Out of PMG Portal"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}