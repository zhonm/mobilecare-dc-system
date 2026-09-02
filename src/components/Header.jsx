import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { clearOperationalLocalStorage } from '../utils/cacheManager';
import { Search, Barcode, PackageCheck, RefreshCw, Calendar, Layers, ChevronDown } from 'lucide-react';

export default function Header() {
  const {
    activeTab,
    setActiveTab,
    selectedCategory,
    setSelectedCategory,
    categories,
    searchQuery,
    setSearchQuery,
    cloudSyncStatus,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    setIsCommandPaletteOpen,
    isSupabaseConfigured,
    realtimeConnected,
    offlineQueue,
    processOfflineSyncQueue,
    activePeriod,
    canAccess
  } = useApp();

  const [isSyncing, setIsSyncing] = useState(false);

  const handleManualSync = async () => {
    setIsSyncing(true);
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
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  const tabConfig = {
    dashboard: { title: 'DC Overview & Analytics', section: 'Core', showCategories: true },
    import: { title: 'Fixably & GSX Data Import', section: 'Planning', showCategories: false },
    forecast: { title: 'Demand Forecasting & POs', section: 'Planning', showCategories: true },
    records: { title: 'Saved Period Records', section: 'Planning', showCategories: false },
    orders: { title: 'Purchase Orders', section: 'Planning', showCategories: false },
    'scan-in': { title: 'Receive Scan-In', section: 'Warehouse Operations', showCategories: false },
    'intake-records': { title: 'DC Parts Stock Records', section: 'Warehouse Operations', showCategories: false },
    allocation: { title: 'Inventory Allocation Matrix', section: 'Planning', showCategories: true },
    'scan-out': { title: 'Pack Scan-Out & Manifest', section: 'Warehouse Operations', showCategories: false },
    shipments: { title: 'Outbound Shipments', section: 'Distribution', showCategories: false },
    reports: { title: 'Stock Transfer Reports', section: 'Reports & Analytics', showCategories: false },
    'forecast-reports': { title: 'Forecasting Reports & Analytics', section: 'Reports & Analytics', showCategories: true },
    audit: { title: 'Serialized Audit Trail', section: 'Traceability', showCategories: false },
    settings: { title: 'Parts Master Catalog', section: 'Admin', showCategories: true },
    'user-access': { title: 'User Access Management', section: 'Admin', showCategories: false }
  };

  const currentMeta = tabConfig[activeTab] || { title: 'MobileCare DC System', section: 'Operations', showCategories: false };

  const formattedSyncTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Just now';

  // Dynamic Month & Auto-Updating System Year Display (e.g. August 2026, September 2026)
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
      {/* Left: Section Breadcrumb, Page Title & Category Filters */}
      <div className="header-left">
        <div className="header-title-container">
          <div className="header-section-breadcrumb">
            <span>{currentMeta.section}</span>
          </div>
          <h1 className="header-page-title" title={currentMeta.title}>
            <span>{currentMeta.title}</span>
          </h1>
        </div>

        {/* Global Part Category Filter Dropdown (Space-efficient top bar selector) */}
        {currentMeta.showCategories && (
          <div className="header-category-dropdown-wrapper" title="Filter parts by hardware category">
            <div className="header-category-dropdown">
              <Layers size={13} className="header-category-icon" />
              <select
                className="header-category-select"
                value={selectedCategory || 'ALL'}
                onChange={(e) => setSelectedCategory(e.target.value)}
                aria-label="Filter parts by category"
              >
                <option value="ALL">Both (Battery & Display)</option>
                {categories && categories.length > 0 && categories.map(cat => (
                  <option key={cat.id} value={cat.code}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="header-category-chevron" />
            </div>
          </div>
        )}
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
              : !navigator.onLine
              ? 'sync-offline'
              : isAutoRefreshing
              ? 'sync-refreshing'
              : cloudSyncStatus?.isSaving
              ? 'sync-saving'
              : 'sync-online'
          }`}
          onClick={() => {
            if (isSupabaseConfigured) {
              autoRefreshData?.({ force: true, reason: 'Header badge manual sync' });
              processOfflineSyncQueue?.();
            }
          }}
          style={{ cursor: 'pointer' }}
          title={
            !isSupabaseConfigured
              ? 'Supabase credentials missing — local fallback mode active'
              : !navigator.onLine
              ? `Offline mode active. ${offlineQueue?.length || 0} change(s) queued for sync.`
              : isAutoRefreshing
              ? 'Synchronizing latest data from cloud database...'
              : cloudSyncStatus?.isSaving
              ? 'Saving changes to database...'
              : `Connected to Supabase Realtime. Verified at ${formattedSyncTime}`
          }
        >
          {!isSupabaseConfigured ? (
            <>
              <span className="status-dot dot-red" />
              <span>Local Mode</span>
            </>
          ) : !navigator.onLine ? (
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

        {/* Global Command Palette / Search Trigger */}
        <div
          className="search-input-box"
          onClick={() => setIsCommandPaletteOpen(true)}
          style={{ cursor: 'pointer' }}
          title="Open Command Palette & Global Search (Cmd+K / Ctrl+K)"
        >
          <Search size={14} />
          <input
            type="text"
            placeholder="Search parts, serials..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsCommandPaletteOpen(true)}
            readOnly
          />
          <kbd className="search-shortcut-badge">⌘K</kbd>
        </div>

        {/* Force Manual Cloud Sync Button */}
        <button
          className="header-icon-btn"
          onClick={handleManualSync}
          disabled={isSyncing || isAutoRefreshing}
          title="Force refresh data from Cloud Database"
        >
          <RefreshCw size={13} className={isSyncing || isAutoRefreshing ? 'spin' : ''} />
          <span className="btn-label-responsive">Sync DB</span>
        </button>

        {/* Quick F1 / F2 Switcher Group */}
        {(canAccess('scan-in') || canAccess('scan-out')) && (
          <div className="header-scan-switcher">
            {canAccess('scan-in') && (
              <button
                className={`header-scan-btn ${activeTab === 'scan-in' ? 'active' : ''}`}
                onClick={() => setActiveTab('scan-in')}
                title="Receive Scan-In (Shortcut: F1)"
              >
                <Barcode size={13} />
                <span className="scan-text-full">Scan-In (F1)</span>
                <span className="scan-text-short">In (F1)</span>
              </button>
            )}
            {canAccess('scan-out') && (
              <button
                className={`header-scan-btn ${activeTab === 'scan-out' ? 'active' : ''}`}
                onClick={() => setActiveTab('scan-out')}
                title="Pack Scan-Out (Shortcut: F2)"
              >
                <PackageCheck size={13} />
                <span className="scan-text-full">Scan-Out (F2)</span>
                <span className="scan-text-short">Out (F2)</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
