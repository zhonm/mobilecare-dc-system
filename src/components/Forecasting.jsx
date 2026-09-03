import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  calculateItemForecast,
  calculateForecastTrendMetrics,
  filterAnomaliesWinsorized
} from '../utils/forecastEngine';
import { exportForecastToExcel } from '../utils/excelParser';
import { getPartCategory, getCategoryBadgeStyle } from '../utils/categoryFilter';
import { clearOperationalLocalStorage } from '../utils/cacheManager';
import SaveRecordModal from './SaveRecordModal';
import ClearDataConfirmationModal from './ClearDataConfirmationModal';
import {
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  UploadCloud,
  BookmarkPlus,
  RefreshCw,
  XCircle,
  RotateCcw,
  DollarSign,
  BarChart3,
  Search,
  Layers,
  Sparkles,
  Sliders,
  Boxes
} from 'lucide-react';

export default function Forecasting() {
  const {
    forecastItems,
    parts,
    selectedCategory,
    selectedCategories,
    isPartMatchingCategoryFilter,
    updateForecastOverride,
    setActiveTab,
    isAutoRefreshing,
    autoRefreshData,
    showToast,
    activePeriod,
    forecastingModel,
    changeForecastingModel,
    canEdit,
    isReadOnly
  } = useApp();

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [viewMode, setViewMode] = useState('detailed'); // 'standard' | 'detailed'
  const [sortBy, setSortBy] = useState('default'); // 'default' | 'recommended_desc' | 'cost_desc' | 'trend_desc'

  const ALL_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let maxHistoryLength = 0;
  forecastItems.forEach(item => {
    if (Array.isArray(item.ytd_monthly_counts) && item.ytd_monthly_counts.length > 0) {
      maxHistoryLength = Math.max(maxHistoryLength, item.ytd_monthly_counts.length);
    }
  });

  // Calculate the correct history month count based on actual loaded data, fallback to activePeriod
  const historyMonthCount = maxHistoryLength > 0
    ? maxHistoryLength
    : ((activePeriod?.month && activePeriod.month > 1) ? (activePeriod.month - 1) : 8);

  const months = ALL_MONTH_NAMES.slice(0, historyMonthCount);
  const targetPeriodLabel = (() => {
    if (activePeriod?.label && !activePeriod.label.toLowerCase().includes('master')) {
      return activePeriod.label;
    }
    const monthIdx = (activePeriod?.month && activePeriod.month >= 1 && activePeriod.month <= 12)
      ? (activePeriod.month - 1)
      : (historyMonthCount < 12 ? historyMonthCount : 8);
    const mName = ALL_MONTH_NAMES[monthIdx] || 'September';
    return `${mName} ${activePeriod?.year || 2026}`;
  })();
  const targetMonthShort = targetPeriodLabel.split(' ')[0].substring(0, 3);

  // Stock price resolver helper
  const getStockPrice = useCallback((item) => {
    if (typeof item.stocking_price === 'number' && item.stocking_price > 0) {
      return item.stocking_price;
    }
    const matched = (parts || []).find(p =>
      (p.part_number && p.part_number.toUpperCase() === String(item.part_number || '').trim().toUpperCase()) ||
      (p.id && (p.id === item.part_id || p.id === item.id))
    );
    if (matched?.stocking_price && Number(matched.stocking_price) > 0) {
      return Number(matched.stocking_price);
    }
    const isDisplay = item.category_id === 'cat-display' || (item.description || '').toLowerCase().includes('display');
    return isDisplay ? 279 : 99;
  }, [parts]);

  // Filter items by category & search query
  const filteredItems = useMemo(() => {
    return forecastItems.filter(item => {
      // Category multi-select filter
      if (isPartMatchingCategoryFilter && selectedCategories) {
        if (!isPartMatchingCategoryFilter(item, selectedCategories)) return false;
      } else if (selectedCategory !== 'ALL') {
        if (selectedCategory === 'BATTERY' && item.category_id !== 'cat-battery') return false;
        if (selectedCategory === 'DISPLAY' && item.category_id !== 'cat-display') return false;
        if (selectedCategory === 'CAMERA' && item.category_id !== 'cat-camera') return false;
        if (selectedCategory === 'BACK_GLASS' && item.category_id !== 'cat-backglass') return false;
        if (selectedCategory === 'MID_REAR' && item.category_id !== 'cat-midrear') return false;
      }
      // Search filter
      if (tableSearch.trim()) {
        const q = tableSearch.toLowerCase().trim();
        const matchPN = String(item.part_number || '').toLowerCase().includes(q);
        const matchDesc = String(item.description || '').toLowerCase().includes(q);
        if (!matchPN && !matchDesc) return false;
      }
      return true;
    });
  }, [forecastItems, selectedCategories, isPartMatchingCategoryFilter, selectedCategory, tableSearch]);

  // Enriched items with metrics, sorting, pricing, and Forecast vs Actual Validation
  const enrichedItems = useMemo(() => {
    const list = filteredItems.map(item => {
      const rawCounts = item.ytd_monthly_counts || [];
      // Take exact historical monthly usage aligned with months
      const counts = months.map((_, idx) => (idx < rawCounts.length ? (Number(rawCounts[idx]) || 0) : 0));
      
      const parsedOverride = (item.admin_override !== null && item.admin_override !== undefined && item.admin_override !== '')
        ? parseInt(item.admin_override, 10)
        : null;
      // An override is active if the user explicitly provided an admin override value
      const hasOverride = parsedOverride !== null && !isNaN(parsedOverride);
      const computed = calculateItemForecast(item, forecastingModel);
      const finalVal = hasOverride ? parsedOverride : computed;
      const trendMetrics = calculateForecastTrendMetrics(counts);
      const stockPrice = getStockPrice(item);
      const lineCost = finalVal * stockPrice;
      
      const totalHistoricalUsage = counts.reduce((sum, c) => sum + c, 0);
      const avgMonthlyUsage = counts.length > 0 ? (totalHistoricalUsage / counts.length) : 0;
      
      let peakUsage = 0;
      return {
        ...item,
        counts,
        computed,
        hasOverride,
        finalVal,
        trendMetrics,
        stockPrice,
        lineCost,
        avgMonthlyUsage,
        peakUsage,
        hasAnomaly: filterAnomaliesWinsorized(counts).hasAnomaly
      };
    });

    if (sortBy === 'recommended_desc') {
      list.sort((a, b) => b.finalVal - a.finalVal);
    } else if (sortBy === 'cost_desc') {
      list.sort((a, b) => b.lineCost - a.lineCost);
    } else if (sortBy === 'trend_desc') {
      list.sort((a, b) => (b.trendMetrics.momGrowthPct || 0) - (a.trendMetrics.momGrowthPct || 0));
    }

    return list;
  }, [filteredItems, months, forecastingModel, getStockPrice, sortBy]);

  // Aggregate executive metrics
  const executiveSummary = useMemo(() => {
    let totalBaseUnits = 0;
    let totalRecommendedUnits = 0;
    let totalEstimatedSpend = 0;
    let overrideCount = 0;
    let displayUnits = 0;
    let batteryUnits = 0;
    let displaySpend = 0;
    let batterySpend = 0;

    enrichedItems.forEach(item => {
      totalBaseUnits += item.computed;
      totalRecommendedUnits += item.finalVal;
      totalEstimatedSpend += item.lineCost;
      if (item.hasOverride) overrideCount++;

      const cat = getPartCategory(item);
      if (cat === 'DISPLAY') {
        displayUnits += item.finalVal;
        displaySpend += item.lineCost;
      } else if (cat === 'BATTERY') {
        batteryUnits += item.finalVal;
        batterySpend += item.lineCost;
      }
    });

    return {
      totalBaseUnits,
      totalRecommendedUnits,
      totalEstimatedSpend,
      overrideCount,
      displayUnits,
      batteryUnits,
      displaySpend,
      batterySpend
    };
  }, [enrichedItems]);

  const exportForecastExcelHandler = async () => {
    if (filteredItems.length === 0) {
      showToast('No forecast items to export', 'warning');
      return;
    }
    await exportForecastToExcel(filteredItems, targetPeriodLabel);
    showToast(`Exported ${targetPeriodLabel} Forecast with styled Excel format`, 'success');
  };

  return (
    <div className="forecasting-view" style={{ maxWidth: '1440px', margin: '0 auto' }}>
      {/* Header & Controls Toolbar */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: '#e0f2fe',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <TrendingUp size={18} />
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                  {targetPeriodLabel} Demand Forecasting &amp; Planning
                </h2>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px', marginBottom: 0 }}>
                  {forecastingModel === 'wma' ? (
                    <span>4-Month Weighted Moving Average <code>(WMA [0.10, 0.20, 0.30, 0.40])</code> with anomaly spike filtering and real-time override synchronization.</span>
                  ) : (
                    <span>Linear regression forecast engine <code>(y = α + βx)</code> with real-time override synchronization.</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Direct Link to Dedicated Reports Page */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setActiveTab('forecast-reports');
                showToast('Switched to Forecasting Reports & Analytics', 'info');
              }}
              title="Open full executive reports, backtesting audit, and branch matrix"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#0284c7' }}
            >
              <BarChart3 size={14} />
              <span>Reports &amp; Analytics</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                await clearOperationalLocalStorage({ keepSession: true });
                try { localStorage.removeItem('mdc_last_override_time'); } catch (e) {}
                autoRefreshData({ force: true, silent: false, reason: 'Forecasting refresh button', isManual: true });
              }}
              disabled={isAutoRefreshing}
              title="Revalidate forecast with latest cloud data"
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin-animation' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>

            {canEdit && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowSaveModal(true)}
                disabled={filteredItems.length === 0}
                title="Save current state to permanent period archive"
              >
                <BookmarkPlus size={14} />
                <span>Save Period Record</span>
              </button>
            )}

            <button
              className="btn btn-secondary btn-sm"
              onClick={exportForecastExcelHandler}
              disabled={filteredItems.length === 0}
              title="Export styled Excel spreadsheet (.xlsx)"
              style={{ fontWeight: 700, color: '#15803d', borderColor: '#86efac' }}
            >
              <Download size={14} />
              <span>Export Excel (XLSX)</span>
            </button>

            {canEdit && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowClearModal(true)}
                title="Clear all forecasting and allocation data to empty state"
                style={{ color: '#b91c1c' }}
              >
                <RotateCcw size={14} />
                <span>Clear Data</span>
              </button>
            )}

            {isReadOnly && (
              <span
                className="badge"
                style={{
                  background: '#f0fdf4',
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  fontSize: '11px',
                  padding: '4px 8px',
                  fontWeight: 600
                }}
              >
                View &amp; Export Mode
              </span>
            )}
          </div>
        </div>

        {/* Operational KPI Summary Dashboard */}
        {enrichedItems.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '12px',
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-subtle)'
          }}>
            {/* Card 1: Total Recommended Units */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: '#ecfdf5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <TrendingUp size={20} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Recommended Order
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#047857', fontFamily: 'var(--font-mono)' }}>
                  {executiveSummary.totalRecommendedUnits.toLocaleString()}{' '}
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>units</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                  Base forecast: <strong style={{ fontFamily: 'var(--font-mono)' }}>{executiveSummary.totalBaseUnits}</strong> units
                </div>
              </div>
            </div>

            {/* Card 2: Estimated Procurement Spend */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: '#f0f9ff',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <DollarSign size={20} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Total Valuation
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#0369a1', fontFamily: 'var(--font-mono)' }}>
                  ${executiveSummary.totalEstimatedSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                  Est. ₱{(executiveSummary.totalEstimatedSpend * 57).toLocaleString(undefined, { maximumFractionDigits: 0 })} PHP
                </div>
              </div>
            </div>

            {/* Card 3: Commodity Mix */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: '#f5f3ff',
                color: '#7c3aed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Layers size={20} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Commodity Mix
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b', marginTop: '3px' }}>
                  <span style={{ color: '#0284c7' }}>{executiveSummary.displayUnits} Displays</span> •{' '}
                  <span style={{ color: '#059669' }}>{executiveSummary.batteryUnits} Batteries</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                  ${executiveSummary.displaySpend.toLocaleString()} vs ${executiveSummary.batterySpend.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Card 4: Covered Models & Overrides */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: '#ecfdf5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Boxes size={20} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Covered SKUs
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                  {enrichedItems.length}{' '}
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>models</span>
                </div>
                <div style={{ fontSize: '11px', color: executiveSummary.overrideCount > 0 ? '#ea580c' : '#64748b', marginTop: '1px', fontWeight: executiveSummary.overrideCount > 0 ? 600 : 400 }}>
                  {executiveSummary.overrideCount > 0 ? `${executiveSummary.overrideCount} manual overrides applied` : '100% Algorithmic'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table Toolbar (Search, View Mode, Model & Sort) */}
      <div className="card" style={{ marginBottom: '12px', padding: '12px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '260px', maxWidth: '400px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Search part # or iPhone model..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 12px 7px 32px',
                  fontSize: '12.5px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              {tableSearch && (
                <button
                  type="button"
                  onClick={() => setTableSearch('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer'
                  }}
                >
                  <XCircle size={14} />
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* View Mode Switcher */}
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={() => setViewMode('detailed')}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '4px',
                  border: 'none',
                  background: viewMode === 'detailed' ? '#ffffff' : 'transparent',
                  color: viewMode === 'detailed' ? '#0f172a' : '#64748b',
                  boxShadow: viewMode === 'detailed' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  cursor: 'pointer'
                }}
              >
                Detailed Columns
              </button>
              <button
                type="button"
                onClick={() => setViewMode('standard')}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '4px',
                  border: 'none',
                  background: viewMode === 'standard' ? '#ffffff' : 'transparent',
                  color: viewMode === 'standard' ? '#0f172a' : '#64748b',
                  boxShadow: viewMode === 'standard' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  cursor: 'pointer'
                }}
              >
                Compact Grid
              </button>
            </div>

            {/* Model Engine Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Sliders size={13} color="#0284c7" />
                <span>Model:</span>
              </span>
              <select
                value={forecastingModel}
                onChange={(e) => changeForecastingModel(e.target.value)}
                style={{
                  padding: '5px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid #0284c7',
                  background: '#f0f9ff',
                  color: '#0369a1',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer'
                }}
                title="Choose mathematical forecasting algorithm (automatically syncs with Allocation Matrix)"
              >
                <option value="linear">Linear Regression (FORECAST.LINEAR - Default)</option>
                <option value="wma">4-Mo WMA (Spike Filtered)</option>
              </select>
            </div>

            {/* Sort Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  padding: '5px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="default">Default Order</option>
                <option value="recommended_desc">Highest Order Units (Desc)</option>
                <option value="cost_desc">Highest Valuation ($ Desc)</option>
                <option value="trend_desc">Highest MoM Growth (Desc)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Save Record Modal Dialog */}
      {showSaveModal && (
        <SaveRecordModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          defaultType="forecast"
        />
      )}

      {/* High-Security Clear Data Confirmation Modal */}
      {showClearModal && (
        <ClearDataConfirmationModal
          isOpen={showClearModal}
          onClose={() => setShowClearModal(false)}
          title="Clear Forecasting & Allocation Operational Data"
        />
      )}

      {/* Empty State */}
      {enrichedItems.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-strong)' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <TrendingUp size={30} />
          </div>
          <h3 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--text-main)' }}>
            No Demand Forecasts Found
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 20px', lineHeight: 1.5 }}>
            {tableSearch ? 'No models match your search query. Try clearing the search box.' : 'Upload a raw Fixably / GSX service usage file (.csv or .xlsx) or a forecasting workbook in Data Import.'}
          </p>
          {tableSearch ? (
            <button className="btn btn-secondary" onClick={() => setTableSearch('')}>
              Clear Search Filter
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setActiveTab('import')}>
              <UploadCloud size={16} />
              <span>Go to Fixably / GSX Data Import</span>
            </button>
          )}
        </div>
      ) : (
        /* Main Forward Demand Forecast Operational Grid */
        <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: '1px solid #cbd5e1' }}>
          <div className="table-container" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            <table className="data-table" style={{ margin: 0, fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#1e293b' }}>
                <tr>
                  <th style={{ background: '#1e293b', color: '#f8fafc', width: '90px', textAlign: 'center' }}>Commodity</th>
                  <th style={{ background: '#1e293b', color: '#f8fafc', minWidth: '100px' }}>Part #</th>
                  <th style={{ background: '#1e293b', color: '#f8fafc', minWidth: '220px' }}>Description</th>
                  <th style={{ background: '#1e293b', color: '#f8fafc', textAlign: 'center', width: '90px' }}>Trend</th>
                  
                  {months.map(m => (
                    <th key={m} style={{ background: '#1e293b', color: '#cbd5e1', textAlign: 'center', minWidth: '46px', padding: '8px 4px' }}>
                      {m}
                    </th>
                  ))}

                  {viewMode === 'detailed' && (
                    <>
                      <th style={{ background: '#0f172a', color: '#94a3b8', textAlign: 'center', minWidth: '65px', fontSize: '11px' }} title="Trailing monthly average usage">
                        Avg/Mo
                      </th>
                      <th style={{ background: '#0f172a', color: '#94a3b8', textAlign: 'center', minWidth: '70px', fontSize: '11px' }} title="Highest single-month usage recorded">
                        Peak
                      </th>
                      <th style={{ background: '#0f172a', color: '#94a3b8', textAlign: 'right', minWidth: '75px', fontSize: '11px' }}>
                        Unit Price
                      </th>
                    </>
                  )}

                  <th style={{ background: '#0369a1', color: '#ffffff', textAlign: 'center', minWidth: '95px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <span>{targetMonthShort} Forecast</span>
                      <TrendingUp size={12} />
                    </div>
                  </th>
                  <th style={{ background: '#334155', color: '#f8fafc', textAlign: 'center', minWidth: '110px' }}>
                    Admin Override
                  </th>
                  <th style={{ background: '#059669', color: '#ffffff', textAlign: 'center', minWidth: '100px', fontWeight: 800 }}>
                    Recommended Order
                  </th>

                  {viewMode === 'detailed' && (
                    <th style={{ background: '#047857', color: '#ffffff', textAlign: 'right', minWidth: '105px', fontWeight: 800 }}>
                      Total Spend ($)
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {enrichedItems.map(item => {
                  const catCode = getPartCategory(item);
                  const badgeStyle = getCategoryBadgeStyle(catCode);

                  return (
                    <tr key={item.part_id} style={{ background: item.hasOverride ? '#fffbeb' : '#ffffff' }}>
                      {/* Commodity Tag */}
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: badgeStyle.bg,
                          color: badgeStyle.color,
                          border: `1px solid ${badgeStyle.border}`,
                          letterSpacing: '0.02em'
                        }}>
                          {badgeStyle.label}
                        </span>
                      </td>

                      {/* Part Number */}
                      <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                        {item.part_number}
                      </td>

                      {/* Description */}
                      <td style={{ fontWeight: 500, color: '#1e293b' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span>{item.description}</span>
                          {item.hasAnomaly && (
                            <span
                              title="Statistical volume spike detected in history and smoothed via Winsorization"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                background: '#fef3c7',
                                color: '#b45309',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700
                              }}
                            >
                              <Sparkles size={10} />
                              Spike Filtered
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Trend Badge */}
                      <td style={{ textAlign: 'center' }}>
                        {item.trendMetrics.trend === 'increasing' && (
                          <span
                            title={`Upward consumption velocity: +${item.trendMetrics.momGrowthPct}% MoM`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              color: '#15803d',
                              background: '#dcfce7',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10.5px',
                              fontWeight: 700
                            }}
                          >
                            <TrendingUp size={11} />
                            +{item.trendMetrics.momGrowthPct}%
                          </span>
                        )}
                        {item.trendMetrics.trend === 'decreasing' && (
                          <span
                            title={`Downward consumption velocity: ${item.trendMetrics.momGrowthPct}% MoM`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              color: '#b91c1c',
                              background: '#fee2e2',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10.5px',
                              fontWeight: 700
                            }}
                          >
                            <TrendingDown size={11} />
                            {item.trendMetrics.momGrowthPct}%
                          </span>
                        )}
                        {item.trendMetrics.trend === 'stable' && (
                          <span
                            title="Stable consumption pattern"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              color: '#64748b',
                              background: '#f1f5f9',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10.5px',
                              fontWeight: 600
                            }}
                          >
                            <Minus size={11} />
                            Stable
                          </span>
                        )}
                      </td>

                      {/* Historical Monthly Counts */}
                      {item.counts.map((cnt, idx) => (
                        <td key={idx} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: cnt > 0 ? '#0f172a' : '#94a3b8' }}>
                          {cnt}
                        </td>
                      ))}

                      {/* Detailed Columns */}
                      {viewMode === 'detailed' && (
                        <>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#475569', fontSize: '11.5px' }}>
                            {item.avgMonthlyUsage.toFixed(1)}
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#64748b', fontSize: '11px' }}>
                            <strong>{item.peakUsage}</strong> ({item.peakMonth})
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', fontWeight: 600 }}>
                            ${item.stockPrice.toFixed(2)}
                          </td>
                        </>
                      )}

                      {/* Computed Linear Regression Forecast */}
                      <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', background: '#f8fafc', color: '#0369a1', fontSize: '13px' }}>
                        {item.computed}
                      </td>

                      {/* Admin Override Input / Badge */}
                      <td style={{ textAlign: 'center' }}>
                        {canEdit ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="number"
                              className="forecast-override-input"
                              placeholder={String(item.computed)}
                              value={item.hasOverride ? item.admin_override : ''}
                              onChange={(e) => updateForecastOverride(item.part_id, e.target.value)}
                              style={{
                                width: '68px',
                                textAlign: 'center',
                                padding: '4px',
                                borderRadius: '4px',
                                border: item.hasOverride ? '1.5px solid #ea580c' : '1px solid #cbd5e1',
                                background: item.hasOverride ? '#fff7ed' : '#ffffff',
                                fontWeight: item.hasOverride ? 700 : 400,
                                color: item.hasOverride ? '#c2410c' : '#0f172a'
                              }}
                            />
                            {item.hasOverride && (
                              <button
                                type="button"
                                onClick={() => updateForecastOverride(item.part_id, '')}
                                title="Reset override to algorithmic calculation"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#ef4444',
                                  cursor: 'pointer',
                                  padding: '2px',
                                  display: 'flex'
                                }}
                              >
                                <RotateCcw size={12} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {item.hasOverride ? (
                              <span
                                className="badge"
                                style={{
                                  background: '#fff7ed',
                                  color: '#c2410c',
                                  border: '1px solid #fdba74',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  fontSize: '11.5px'
                                }}
                                title="Admin override value"
                              >
                                {item.admin_override} (Overridden)
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Recommended Order */}
                      <td style={{
                        textAlign: 'center',
                        fontWeight: 800,
                        fontFamily: 'var(--font-mono)',
                        background: '#f0fdf4',
                        color: '#15803d',
                        fontSize: '14px'
                      }}>
                        {item.finalVal}
                      </td>

                      {/* Total Spend */}
                      {viewMode === 'detailed' && (
                        <td style={{
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          color: '#0f172a',
                          background: '#f0fdf4',
                          fontSize: '12px'
                        }}>
                          ${item.lineCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>

              {/* Table Footer with Summary Subtotals */}
              <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 10, background: '#0f172a', color: '#f8fafc', fontWeight: 700 }}>
                <tr>
                  <td colSpan={3} style={{ background: '#0f172a', color: '#f8fafc', padding: '10px 12px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    GRAND TOTAL ({enrichedItems.length} Models)
                  </td>
                  <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>—</td>
                  
                  {months.map((_, idx) => {
                    const colTotal = enrichedItems.reduce((sum, it) => sum + (it.counts[idx] || 0), 0);
                    return (
                      <td key={idx} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#e2e8f0' }}>
                        {colTotal}
                      </td>
                    );
                  })}

                  {viewMode === 'detailed' && (
                    <>
                      <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>—</td>
                      <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '11px' }}>—</td>
                    </>
                  )}

                  {/* Computed Base Total */}
                  <td style={{ textAlign: 'center', background: '#0369a1', color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800 }}>
                    {executiveSummary.totalBaseUnits.toLocaleString()}
                  </td>

                  {/* Overrides indicator */}
                  <td style={{ textAlign: 'center', color: executiveSummary.overrideCount > 0 ? '#fb923c' : '#94a3b8', fontSize: '11px' }}>
                    {executiveSummary.overrideCount > 0 ? `${executiveSummary.overrideCount} active` : 'Exact'}
                  </td>

                  {/* Final Recommended Order Total */}
                  <td style={{ textAlign: 'center', background: '#059669', color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 800 }}>
                    {executiveSummary.totalRecommendedUnits.toLocaleString()}
                  </td>

                  {/* Total Spend */}
                  {viewMode === 'detailed' && (
                    <td style={{ textAlign: 'right', background: '#047857', color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 800 }}>
                      ${executiveSummary.totalEstimatedSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
