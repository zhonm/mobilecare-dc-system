import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { clearOperationalLocalStorage } from '../utils/cacheManager';
import { Search, Barcode, PackageCheck, RefreshCw, Calendar, Menu } from 'lucide-react';
import HeaderCategoryFilter from './HeaderCategoryFilter';
import { formatTo12HourTime } from '../utils/dateUtils';

export default function Header() {
  const {
    activeTab,
    setActiveTab,
    cloudSyncStatus,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    setIsCommandPaletteOpen,
    isSupabaseConfigured,
    realtimeConnected,
    offlineQueue,
    processOfflineSyncQueue: _processOfflineSyncQueue,
    activePeriod,
    canAccess,
    isMobileNavOpen,
    setIsMobileNavOpen,
    currentUser,
    pmgSubTab
  } = useApp();

  const handleManualSync = async () => {
    try {
      // Clear any stale local storage cache while keeping session
      await clearOperationalLocalStorage({ keepSession: true });
      try { localStorage.removeItem('mdc_last_override_time'); } catch (e) {}
      if (autoRefreshData) {
        await autoRefreshData({ force: true, silent: false, isManual: true, reason: 'Header manual sync' });
      }
    } catch (err) {
      console.error('Manual sync error:', err);
      showToast('Error syncing with cloud database', 'error');
    }
  };

  const tabConfig = {
    dashboard: { title: 'DC Overview & Analytics', section: 'Core', showCategories: true },
    import: { title: 'Fixably & GSX Data Import', section: 'Planning', showCategories: false },
    forecast: { title: 'Demand Forecasting & POs', section: 'Planning', showCategories: true },
    orders: { title: 'Purchase Orders', section: 'Planning', showCategories: false },
    'scan-in': { 
      title: 'Receive Scan-In', 
      section: currentUser?.role === 'parts_management' ? 'Branch Operations' : 'Warehouse Operations', 
      showCategories: false 
    },
    'intake-records': { title: 'DC Parts Stock Records', section: 'Warehouse Operations', showCategories: false },
    allocation: { title: 'Inventory Allocation Matrix', section: 'Planning', showCategories: true },
    'scan-out': { title: 'Pack Scan-Out & Manifest', section: 'Warehouse Operations', showCategories: false },
    shipments: { title: 'Outbound Shipments', section: 'Distribution', showCategories: false },
    reports: { title: 'Stock Transfer Reports', section: 'Reports & Analytics', showCategories: true },
    'site-transfers-fifo': { title: 'Site Transfers & FIFO Audit', section: 'Reports & Analytics', showCategories: false },
    'forecast-reports': { title: 'Forecasting Reports & Analytics', section: 'Reports & Analytics', showCategories: true },
    audit: { title: 'Serialized Audit Trail', section: 'Traceability', showCategories: false },
    settings: { title: 'Settings', section: 'Admin', showCategories: true },
    'user-access': { title: 'User Access Management', section: 'Admin', showCategories: false },
    'request-parts': currentUser?.role === 'parts_management'
      ? (pmgSubTab === 'stock_on_hand'
          ? { title: 'Branch Stock On Hand', section: 'Branch Operations', showCategories: false }
          : pmgSubTab === 'usage_history'
            ? { title: 'Parts Consumption Log', section: 'Branch Operations', showCategories: false }
            : { title: 'Parts Requests', section: 'Branch Operations', showCategories: false })
      : { title: 'Parts Requests & Replenishment', section: 'Operations & Logistics', showCategories: false },
    'all-stocks': { 
      title: 'All Stocks & Multi-Site', 
      section: 'Network Visibility', 
      showCategories: false 
    },
    feedback: {
      title: 'Developer Direct Support',
      section: 'Support & Help',
      showCategories: false
    }
  };

  const currentMeta = tabConfig[activeTab] || { title: 'MobileCare DC System', section: 'Operations', showCategories: false };

  const formattedSyncTime = lastSyncedAt
    ? formatTo12HourTime(lastSyncedAt)
    : 'Just now';

  const [networkOnline, setNetworkOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [probeOnline, setProbeOnline] = useState(null);

  useEffect(() => {
    const handleOnline = () => {
      setNetworkOnline(true);
      setProbeOnline(true);
    };
    const handleOffline = () => {
      setNetworkOnline(false);
      checkConnectivity();
    };

    const checkConnectivity = async () => {
      if (typeof window === 'undefined') return;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${window.location.origin}/favicon.ico?_t=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        setProbeOnline(res.ok || res.status < 500);
      } catch (e) {
        setProbeOnline(false);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // If browser navigator reports offline on mount, verify with probe to bypass Chromium false negatives
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      checkConnectivity();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Multi-tier resilient online status:
  // 1. Supabase Realtime WebSocket connected -> 100% Online
  // 2. Cloud DB reported online -> 100% Online
  // 3. Active HTTP probe succeeded -> 100% Online
  // 4. Browser reports online and cloud sync has not failed -> Online
  const isEffectivelyOnline = Boolean(
    realtimeConnected ||
    cloudSyncStatus?.isOnline === true ||
    probeOnline === true ||
    (networkOnline && cloudSyncStatus?.isOnline !== false)
  );
  const isOffline = !isEffectivelyOnline;

  const currentSystemYear = new Date().getFullYear();
  const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });
  const displayPeriod = (() => {
    if (!activePeriod) return `${currentMonthName} ${currentSystemYear}`;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const pYear = activePeriod.year || currentSystemYear;
    if (activePeriod.label && !activePeriod.label.toLowerCase().includes('master')) {
      return activePeriod.label;
    }
    if (activePeriod.month && activePeriod.month >= 1 && activePeriod.month <= 12) {
      return `${monthNames[activePeriod.month - 1]} ${pYear}`;
    }
    return `${currentMonthName} ${pYear}`;
  })();

  return (
    <header className="header-bar">
      {/* Left: Hamburger, Section Breadcrumb, Page Title & Category Filters */}
      <div className="header-left">
        <button
          type="button"
          className={`header-mobile-toggle-btn ${isMobileNavOpen ? 'active' : ''}`}
          onClick={() => setIsMobileNavOpen(prev => !prev)}
          aria-label="Toggle navigation menu"
          title={isMobileNavOpen ? 'Close Menu' : 'Open Menu'}
        >
          <Menu size={20} />
        </button>

        <div className="header-title-container">
          <div className="header-section-breadcrumb">
            <span>{currentMeta.section}</span>
          </div>
          <h1 className="header-page-title" title={currentMeta.title}>
            <span>{currentMeta.title}</span>
          </h1>
        </div>

        {/* Global Part Category Multi-Select Filter Popover */}
        {currentMeta.showCategories && <HeaderCategoryFilter />}
      </div>

      {/* Right: Active Period, Live Sync Badge, Global ⌘K Search, Force Sync & Scan Switcher */}
      <div className="header-right">
        {/* Active Data Collection Period Display */}
        <div className="header-period-badge" title={`Data Collection Period: ${displayPeriod}`}>
          <Calendar size={13} className="period-icon" />
          <span className="period-label">Period:</span>
          <strong className="period-value">{displayPeriod}</strong>
        </div>

        {/* Live Cloud DB Auto-Refresh & Auto-Save Indicator */}
        <div
          className={`header-sync-badge ${
            !isSupabaseConfigured
              ? 'sync-local'
              : isOffline
              ? 'sync-offline'
              : isAutoRefreshing
              ? 'sync-refreshing'
              : cloudSyncStatus?.isSaving
              ? 'sync-saving'
              : 'sync-online'
          }`}
          onClick={handleManualSync}
          style={{ cursor: 'pointer' }}
          title={
            !isSupabaseConfigured
              ? 'Supabase credentials missing — local fallback mode active'
              : isOffline
              ? `Offline mode active. ${offlineQueue?.length || 0} change(s) queued for sync.`
              : isAutoRefreshing
              ? 'Synchronizing latest data from cloud database...'
              : cloudSyncStatus?.isSaving
              ? 'Saving changes to database...'
              : `Connected to Supabase Realtime. Verified at ${formattedSyncTime}. Click to refresh.`
          }
        >
          {!isSupabaseConfigured ? (
            <>
              <span className="status-dot dot-red" />
              <span>Local Mode</span>
            </>
          ) : isOffline ? (
            <>
              <RefreshCw size={12} className="spin" color="#d97706" />
              <span>Offline {offlineQueue && offlineQueue.length > 0 ? `(${offlineQueue.length})` : ''}</span>
            </>
          ) : isAutoRefreshing ? (
            <>
              <RefreshCw size={12} className="spin" color="#0284c7" />
              <span className="sync-text-full">Syncing...</span>
              <span className="sync-text-short">Sync</span>
            </>
          ) : cloudSyncStatus?.isSaving ? (
            <>
              <RefreshCw size={12} className="spin" color="#d97706" />
              <span className="sync-text-full">Saving...</span>
              <span className="sync-text-short">Save</span>
            </>
          ) : offlineQueue && offlineQueue.length > 0 ? (
            <>
              <RefreshCw size={12} className="spin" color="#0284c7" />
              <span>{offlineQueue.length} pending</span>
            </>
          ) : (
            <>
              <span className="status-dot dot-green" />
              <span className="sync-text-full">{realtimeConnected ? 'Live Realtime Synced' : 'Cloud Synced'}</span>
              <span className="sync-text-short">Synced</span>
            </>
          )}
        </div>

        {/* Mobile Search Icon Button */}
        <button
          type="button"
          className="header-mobile-search-btn"
          onClick={() => setIsCommandPaletteOpen(true)}
          title="Search parts, serials (Cmd+K)"
          aria-label="Search"
        >
          <Search size={16} />
        </button>

        {/* Global Command Palette / Search Trigger */}
        <button
          type="button"
          className="header-search-btn search-input-box"
          onClick={() => setIsCommandPaletteOpen(true)}
          title="Open Command Palette & Global Search (Cmd+K / Ctrl+K)"
          aria-label="Search parts, serials"
        >
          <div className="header-search-left">
            <Search size={15} className="header-search-icon" />
            <span className="header-search-placeholder">Search parts, serials...</span>
          </div>
          <kbd className="header-search-shortcut">⌘K</kbd>
        </button>

        {/* Quick Scan Switcher Group */}
        {(canAccess('scan-in') || canAccess('scan-out')) && (
          <div className="header-scan-switcher">
            {canAccess('scan-in') && (
              <button
                className={`header-scan-btn ${activeTab === 'scan-in' ? 'active' : ''}`}
                onClick={() => setActiveTab('scan-in')}
                title="Receive Scan-In"
              >
                <Barcode size={13} />
                <span className="scan-text-full">Scan-In</span>
                <span className="scan-text-short">In</span>
              </button>
            )}
            {canAccess('scan-out') && (
              <button
                className={`header-scan-btn ${activeTab === 'scan-out' ? 'active' : ''}`}
                onClick={() => setActiveTab('scan-out')}
                title="Pack Scan-Out"
              >
                <PackageCheck size={13} />
                <span className="scan-text-full">Scan-Out</span>
                <span className="scan-text-short">Out</span>
              </button>
            )}
          </div>
        )}
      </div>

    </header>
  );
}
