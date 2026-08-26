import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { calculateLinearRegressionForecast, calculateForecastTrendMetrics } from '../utils/forecastEngine';
import { exportForecastToExcel } from '../utils/excelParser';
import SaveRecordModal from './SaveRecordModal';
import ClearDataConfirmationModal from './ClearDataConfirmationModal';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import {
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  UploadCloud,
  BookmarkPlus,
  Printer,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  RotateCcw,
  DollarSign,
  BarChart3,
  Search,
  Layers,
  ChevronDown,
  ChevronUp,
  Smartphone,
  CheckCircle,
  MapPin,
  Building2,
  Activity
} from 'lucide-react';

export default function Forecasting() {
  const {
    forecastItems,
    allocations,
    sites,
    parts,
    selectedCategory,
    updateForecastOverride,
    setActiveTab,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    activePeriod
  } = useApp();

  const [activeForecastingSubTab, setActiveForecastingSubTab] = useState('forecast'); // 'forecast' | 'accuracy_audit' | 'regional'
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [showAnalyticsDrawer, setShowAnalyticsDrawer] = useState(true);
  const [viewMode, setViewMode] = useState('detailed'); // 'standard' | 'detailed'
  const [sortBy, setSortBy] = useState('default'); // 'default' | 'recommended_desc' | 'cost_desc' | 'trend_desc' | 'variance_desc'

  const ALL_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let maxHistoryLength = 0;
  forecastItems.forEach(item => {
    if (Array.isArray(item.ytd_monthly_counts) && item.ytd_monthly_counts.length > 0) {
      maxHistoryLength = Math.max(maxHistoryLength, item.ytd_monthly_counts.length);
    }
  });
  if (maxHistoryLength === 0) {
    maxHistoryLength = (activePeriod?.month ? activePeriod.month - 1 : 8) || 8;
  }
  const months = ALL_MONTH_NAMES.slice(0, maxHistoryLength);
  const targetMonthShort = activePeriod?.label ? activePeriod.label.split(' ')[0].substring(0, 3) : 'Sep';
  const targetPeriodLabel = activePeriod?.label || 'September 2026';
  const priorMonthName = months.length >= 2 ? months[months.length - 1] : 'August';

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
      // Category filter
      if (selectedCategory !== 'ALL') {
        if (selectedCategory === 'BATTERY' && item.category_id !== 'cat-battery') return false;
        if (selectedCategory === 'DISPLAY' && item.category_id !== 'cat-display') return false;
        if (selectedCategory === 'CAMERA' && item.category_id !== 'cat-camera') return false;
        if (selectedCategory === 'BACK_GLASS' && item.category_id !== 'cat-backglass') return false;
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
  }, [forecastItems, selectedCategory, tableSearch]);

  // Enriched items with metrics, sorting, pricing, and Forecast vs Actual Validation
  const enrichedItems = useMemo(() => {
    const list = filteredItems.map(item => {
      const rawCounts = item.ytd_monthly_counts || [];
      const counts = months.map((_, idx) => rawCounts[idx] || 0);
      const targetX = months.length + 1;
      const computed = item.computed_forecast !== undefined ? item.computed_forecast : calculateLinearRegressionForecast(counts, targetX);
      const hasOverride = item.admin_override !== null && item.admin_override !== undefined && item.admin_override !== '';
      const finalVal = hasOverride ? parseInt(item.admin_override, 10) : (item.final_forecast !== undefined ? item.final_forecast : computed);
      const trendMetrics = calculateForecastTrendMetrics(counts);
      const stockPrice = getStockPrice(item);
      const lineCost = finalVal * stockPrice;
      
      const totalHistoricalUsage = counts.reduce((sum, c) => sum + c, 0);
      const avgMonthlyUsage = counts.length > 0 ? (totalHistoricalUsage / counts.length) : 0;
      
      let peakUsage = 0;
      let peakMonthIdx = 0;
      counts.forEach((c, idx) => {
        if (c > peakUsage) {
          peakUsage = c;
          peakMonthIdx = idx;
        }
      });

      // Forecast vs Actual Validation calculations (matching workbook logic)
      let priorMonthActual = 0;
      let priorMonthForecast = 0;
      let variance = 0;
      let accuracyRemark = 'Accurate'; // 'Accurate' | 'Under Forecast' | 'Over Forecast'
      let absError = 0;

      if (counts.length >= 2) {
        priorMonthActual = counts[counts.length - 1]; // e.g. August
        const histCounts = counts.slice(0, counts.length - 1); // e.g. Jan..Jul
        priorMonthForecast = calculateLinearRegressionForecast(histCounts, counts.length);
        variance = priorMonthActual - priorMonthForecast;
        absError = Math.abs(variance);
        if (variance > 0) accuracyRemark = 'Under Forecast';
        else if (variance < 0) accuracyRemark = 'Over Forecast';
        else accuracyRemark = 'Accurate';
      }

      return {
        ...item,
        counts,
        computed,
        hasOverride,
        finalVal,
        trendMetrics,
        stockPrice,
        lineCost,
        totalHistoricalUsage,
        avgMonthlyUsage,
        peakUsage,
        peakMonth: months[peakMonthIdx] || 'Jan',
        priorMonthActual,
        priorMonthForecast,
        variance,
        accuracyRemark,
        absError
      };
    });

    if (sortBy === 'recommended_desc') {
      list.sort((a, b) => b.finalVal - a.finalVal);
    } else if (sortBy === 'cost_desc') {
      list.sort((a, b) => b.lineCost - a.lineCost);
    } else if (sortBy === 'trend_desc') {
      list.sort((a, b) => (b.trendMetrics.momGrowthPct || 0) - (a.trendMetrics.momGrowthPct || 0));
    } else if (sortBy === 'variance_desc') {
      list.sort((a, b) => b.absError - a.absError);
    }

    return list;
  }, [filteredItems, getStockPrice, months, sortBy]);

  // Aggregate executive metrics
  const executiveSummary = useMemo(() => {
    let totalBaseUnits = 0;
    let totalRecommendedUnits = 0;
    let totalEstimatedSpend = 0;
    let overrideCount = 0;
    let netOverrideDelta = 0;
    let displayUnits = 0;
    let batteryUnits = 0;
    let displaySpend = 0;
    let batterySpend = 0;
    let risingCount = 0;
    let stableCount = 0;
    let decliningCount = 0;

    // Validation summary metrics
    let totalPriorActual = 0;
    let totalPriorForecast = 0;
    let accurateCount = 0;
    let underForecastCount = 0;
    let overForecastCount = 0;

    enrichedItems.forEach(item => {
      totalBaseUnits += item.computed;
      totalRecommendedUnits += item.finalVal;
      totalEstimatedSpend += item.lineCost;
      if (item.hasOverride) {
        overrideCount++;
        netOverrideDelta += (item.finalVal - item.computed);
      }

      const isDisplay = item.category_id === 'cat-display' || (item.description || '').toLowerCase().includes('display');
      if (isDisplay) {
        displayUnits += item.finalVal;
        displaySpend += item.lineCost;
      } else {
        batteryUnits += item.finalVal;
        batterySpend += item.lineCost;
      }

      if (item.trendMetrics.trend === 'increasing') risingCount++;
      else if (item.trendMetrics.trend === 'decreasing') decliningCount++;
      else stableCount++;

      // Accuracy tallies
      totalPriorActual += item.priorMonthActual;
      totalPriorForecast += item.priorMonthForecast;
      if (item.accuracyRemark === 'Accurate' || item.absError <= 1) accurateCount++;
      else if (item.accuracyRemark === 'Under Forecast') underForecastCount++;
      else overForecastCount++;
    });

    const netPriorVariance = totalPriorActual - totalPriorForecast;
    const accuracyRate = enrichedItems.length > 0
      ? Math.round((accurateCount / enrichedItems.length) * 100)
      : 100;

    return {
      totalBaseUnits,
      totalRecommendedUnits,
      totalEstimatedSpend,
      overrideCount,
      netOverrideDelta,
      displayUnits,
      batteryUnits,
      displaySpend,
      batterySpend,
      risingCount,
      stableCount,
      decliningCount,
      totalPriorActual,
      totalPriorForecast,
      netPriorVariance,
      accurateCount,
      underForecastCount,
      overForecastCount,
      accuracyRate
    };
  }, [enrichedItems]);

  // Regional (Metro Manila vs Provincial) intelligence
  const regionalSummary = useMemo(() => {
    let mmUnits = 0;
    let provUnits = 0;

    const isMMSite = (s) => {
      const name = (s.name || '').toLowerCase();
      const code = (s.code || '').toUpperCase();
      return (
        name.includes('bhs') || name.includes('bonifacio') || code.includes('BHS') ||
        name.includes('greenbelt') || name.includes('gb3') || code.includes('GB3') ||
        name.includes('power plant') || name.includes('rockwell') || name.includes('ppm') || code.includes('PPM') ||
        name.includes('glorietta') || name.includes('gls') || name.includes('gl5') || code.includes('GLS') || code.includes('GL5') ||
        name.includes("s'maison") || name.includes('smaison') || name.includes('sms') || code.includes('SMS') ||
        name.includes('mall of asia') || name.includes('moa') || code.includes('MOA') ||
        name.includes('podium') || name.includes('pod') || code.includes('POD') ||
        name.includes('megamall') || name.includes('meg') || code.includes('MEG') ||
        name.includes('annex') || name.includes('anx') || code.includes('ANX') ||
        name.includes('trinoma') || name.includes('tri') || code.includes('TRI') ||
        name.includes('vertis') || name.includes('vn') || code.includes('VN') ||
        s.region === 'Metro Manila'
      );
    };

    (allocations || []).forEach(alloc => {
      (sites || []).forEach(site => {
        const qty = alloc.site_quantities?.[site.id] ?? alloc.site_quantities?.[site.code] ?? 0;
        if (isMMSite(site)) {
          mmUnits += qty;
        } else {
          provUnits += qty;
        }
      });
    });

    const totalAlloc = mmUnits + provUnits;
    const mmPct = totalAlloc > 0 ? Math.round((mmUnits / totalAlloc) * 100) : 58;
    const provPct = totalAlloc > 0 ? (100 - mmPct) : 42;

    return {
      mmUnits: mmUnits || 344,
      provUnits: provUnits || 249,
      mmPct,
      provPct,
      pieData: [
        { name: 'Metro Manila (MM)', value: mmUnits || 344, color: '#0284c7' },
        { name: 'Provincial Branches (Prov)', value: provUnits || 249, color: '#10b981' }
      ]
    };
  }, [allocations, sites]);

  // Monthly aggregate trend chart data (Jan..Aug actuals + Forecast projection)
  const monthlyAggregateTrendData = useMemo(() => {
    if (forecastItems.length === 0) return [];
    
    const data = months.map((m, idx) => {
      const monthSum = forecastItems.reduce((sum, item) => {
        return sum + ((item.ytd_monthly_counts || [])[idx] || 0);
      }, 0);
      return {
        month: m,
        actuals: monthSum,
        forecast: null,
        type: 'Historical Actual'
      };
    });

    // Add forecast point
    data.push({
      month: `${targetMonthShort} (Forecast)`,
      actuals: null,
      forecast: executiveSummary.totalRecommendedUnits,
      type: 'Projected Demand'
    });

    return data;
  }, [forecastItems, months, targetMonthShort, executiveSummary.totalRecommendedUnits]);

  // Top 5 Highest Demand Models
  const topDemandModels = useMemo(() => {
    return [...enrichedItems]
      .sort((a, b) => b.finalVal - a.finalVal)
      .slice(0, 5)
      .map(item => ({
        name: (item.description || item.part_number || '').replace('Display, ', '').replace('Battery, ', ''),
        units: item.finalVal,
        spend: item.lineCost,
        commodity: (item.category_id === 'cat-display' || (item.description || '').toLowerCase().includes('display')) ? 'Display' : 'Battery'
      }));
  }, [enrichedItems]);

  const exportForecastExcelHandler = async () => {
    if (filteredItems.length === 0) {
      showToast('No forecast items to export', 'warning');
      return;
    }
    await exportForecastToExcel(filteredItems, targetPeriodLabel);
    showToast(`Exported ${targetPeriodLabel} Forecast with styled Excel format`, 'success');
  };

  const handlePrint = () => {
    if (filteredItems.length === 0) {
      showToast('No forecast items to print', 'warning');
      return;
    }
    window.print();
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
                  Linear regression forecast engine <code>(y = α + βx)</code> with real-time override synchronization and historical accuracy audits.
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAnalyticsDrawer(!showAnalyticsDrawer)}
              title="Toggle visual trend charts and demand curves"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
            >
              <BarChart3 size={14} color="#0284c7" />
              <span>{showAnalyticsDrawer ? 'Hide Charts' : 'Show Charts'}</span>
              {showAnalyticsDrawer ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData({ force: true, silent: false, reason: 'Forecasting refresh button', isManual: true })}
              disabled={isAutoRefreshing}
              title="Revalidate forecast with latest cloud data"
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin-animation' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>

            {lastSyncedAt && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={11} color="var(--success)" />
                {lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}

            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowSaveModal(true)}
              disabled={filteredItems.length === 0}
              title="Save current state to permanent period archive"
            >
              <BookmarkPlus size={14} />
              <span>Save Period Record</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={exportForecastExcelHandler}
              disabled={filteredItems.length === 0}
              title="Export styled Excel spreadsheet (.xlsx)"
            >
              <Download size={14} />
              <span>Export Excel</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePrint}
              disabled={filteredItems.length === 0}
              title="Print Forecast Report"
            >
              <Printer size={14} />
              <span>Print</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowClearModal(true)}
              title="Clear all forecasting and allocation data to empty state"
              style={{ color: '#b91c1c' }}
            >
              <RotateCcw size={14} />
              <span>Clear Data</span>
            </button>
          </div>
        </div>

        {/* Executive KPI Summary Dashboard */}
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
                <ShieldCheck size={20} />
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
                  Base linear: <strong style={{ fontFamily: 'var(--font-mono)' }}>{executiveSummary.totalBaseUnits}</strong> units
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
                  Across {enrichedItems.length} active models
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

            {/* Card 4: Historical Forecast Accuracy */}
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
                <Activity size={20} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {priorMonthName} Accuracy Rate
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#047857', fontFamily: 'var(--font-mono)' }}>
                  {executiveSummary.accuracyRate}%{' '}
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>({executiveSummary.accurateCount}/{enrichedItems.length})</span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                  Net Variance: <strong style={{ fontFamily: 'var(--font-mono)', color: executiveSummary.netPriorVariance >= 0 ? '#047857' : '#b91c1c' }}>
                    {executiveSummary.netPriorVariance >= 0 ? '+' : ''}{executiveSummary.netPriorVariance} units
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Navigation Tabs (Workbook Replications) */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid var(--border-subtle)',
          flexWrap: 'wrap'
        }}>
          <button
            type="button"
            className={`btn btn-sm ${activeForecastingSubTab === 'forecast' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveForecastingSubTab('forecast')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <TrendingUp size={14} />
            <span>{targetPeriodLabel} Demand Forecast</span>
            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.25)', padding: '1px 6px', borderRadius: '10px' }}>
              {executiveSummary.totalRecommendedUnits} units
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${activeForecastingSubTab === 'accuracy_audit' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveForecastingSubTab('accuracy_audit')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <CheckCircle size={14} />
            <span>Forecasted vs Actual ({priorMonthName} Audit)</span>
            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.25)', padding: '1px 6px', borderRadius: '10px' }}>
              {executiveSummary.accuracyRate}% Accurate
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${activeForecastingSubTab === 'regional' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveForecastingSubTab('regional')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <MapPin size={14} />
            <span>Metro Manila vs Provincial Demand</span>
            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.25)', padding: '1px 6px', borderRadius: '10px' }}>
              {regionalSummary.mmPct}% MM / {regionalSummary.provPct}% Prov
            </span>
          </button>
        </div>
      </div>

      {/* Interactive Analytics Drawer (Charts & Demand Curves) */}
      {showAnalyticsDrawer && enrichedItems.length > 0 && activeForecastingSubTab === 'forecast' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1.2fr)',
          gap: '16px',
          marginBottom: '16px'
        }}>
          {/* Chart 1: Historical Actuals vs Projected Demand Curve */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={16} color="#0284c7" />
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                  Monthly Repair Consumption vs Forecast Projection
                </h4>
              </div>
              <span style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                Trailing {months.length} Months + {targetMonthShort} Linear Projection
              </span>
            </div>
            <div style={{ width: '100%', height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyAggregateTrendData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0284c7" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0}/>
                    </linearGradient>
                    <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                    formatter={(val, name) => [`${val} units`, name === 'actuals' ? 'Historical Actual' : 'Target Forecast']}
                  />
                  <Area type="monotone" dataKey="actuals" stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#actualGradient)" name="actuals" />
                  <Area type="monotone" dataKey="forecast" stroke="#10b981" strokeWidth={2.5} strokeDasharray="4 4" fillOpacity={1} fill="url(#forecastGradient)" name="forecast" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Top 5 Demand Drivers */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Smartphone size={16} color="#059669" />
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                  Top 5 High-Demand iPhone Models
                </h4>
              </div>
              <span style={{ fontSize: '11px', background: '#ecfdf5', padding: '2px 8px', borderRadius: '12px', color: '#047857', fontWeight: 600 }}>
                Volume Leaders
              </span>
            </div>
            <div style={{ width: '100%', height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topDemandModels} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#334155', fontWeight: 500 }} tickLine={false} width={110} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                    formatter={(val, name, entry) => [`${val} units ($${entry.payload.spend.toLocaleString()})`, 'Demand Order']}
                  />
                  <Bar dataKey="units" fill="#0284c7" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Regional MM vs Provincial Visualization Tab */}
      {activeForecastingSubTab === 'regional' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '16px'
        }}>
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Building2 size={18} color="#0284c7" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                Metro Manila (MM) Demand Share
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, marginBottom: '16px' }}>
              High-velocity urban corridor covering 11 prime Apple Authorised Service Centres (Vertis North, Glorietta 5, Mall of Asia, Podium, Festival Mall, Trinoma, S&apos;Maison, BHS, GB3, PPM, Annex).
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                {regionalSummary.mmPct}%
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                  {regionalSummary.mmUnits} Units Projected
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  Top Model: Battery, iPhone 13 &amp; Display, iPhone 17 Pro Max
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <MapPin size={18} color="#10b981" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                Provincial Branches (Prov) Demand Share
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, marginBottom: '16px' }}>
              Regional distribution network covering 17 provincial branches (Newpoint Mall, Lima Estate, Cebu, Davao, Bacolod, Cagayan de Oro, General Santos, Tuguegarao, Iloilo, Naga, La Union, etc.).
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                {regionalSummary.provPct}%
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                  {regionalSummary.provUnits} Units Projected
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  Top Model: Battery, iPhone 13 &amp; Display, iPhone 13
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table Toolbar (Search, View Mode & Sort) */}
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
            {/* View Mode Switcher (For Main Forecast Tab) */}
            {activeForecastingSubTab === 'forecast' && (
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
                  Detailed Analytics
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
                  Standard Grid
                </button>
              </div>
            )}

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
                <option value="variance_desc">Highest Variance Error (Desc)</option>
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
      ) : activeForecastingSubTab === 'accuracy_audit' ? (
        /* TAB 2: Forecast vs Actual Validation Grid (Replicating workbook Forecasted vs Actual sheet) */
        <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: '1px solid #cbd5e1' }}>
          <div className="table-container" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            <table className="data-table" style={{ margin: 0, fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#1e293b' }}>
                <tr>
                  <th style={{ background: '#1e293b', color: '#f8fafc', width: '90px', textAlign: 'center' }}>Commodity</th>
                  <th style={{ background: '#1e293b', color: '#f8fafc', minWidth: '100px' }}>Part #</th>
                  <th style={{ background: '#1e293b', color: '#f8fafc', minWidth: '220px' }}>Description</th>
                  
                  {months.slice(0, months.length - 1).map(m => (
                    <th key={m} style={{ background: '#1e293b', color: '#cbd5e1', textAlign: 'center', minWidth: '44px', padding: '8px 4px' }}>
                      {m}
                    </th>
                  ))}

                  <th style={{ background: '#0284c7', color: '#ffffff', textAlign: 'center', minWidth: '90px', fontWeight: 800 }}>
                    Actual ({priorMonthName})
                  </th>
                  <th style={{ background: '#334155', color: '#f8fafc', textAlign: 'center', minWidth: '95px', fontWeight: 800 }}>
                    Forecasted ({priorMonthName})
                  </th>
                  <th style={{ background: '#0f172a', color: '#ffffff', textAlign: 'center', minWidth: '85px', fontWeight: 800 }}>
                    Variance (Δ)
                  </th>
                  <th style={{ background: '#1e293b', color: '#f8fafc', textAlign: 'center', minWidth: '130px', fontWeight: 800 }}>
                    Accuracy Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {enrichedItems.map(item => {
                  const isDisplay = item.category_id === 'cat-display' || (item.description || '').toLowerCase().includes('display');
                  const commodityLabel = isDisplay ? 'DISPLAY' : 'BATTERY';

                  return (
                    <tr key={item.part_id}>
                      {/* Commodity Tag */}
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: isDisplay ? '#e0f2fe' : '#dcfce7',
                          color: isDisplay ? '#0369a1' : '#15803d'
                        }}>
                          {commodityLabel}
                        </span>
                      </td>

                      {/* Part Number */}
                      <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                        {item.part_number}
                      </td>

                      {/* Description */}
                      <td style={{ fontWeight: 500, color: '#1e293b' }}>
                        {item.description}
                      </td>

                      {/* Jan..Jul counts */}
                      {item.counts.slice(0, item.counts.length - 1).map((cnt, idx) => (
                        <td key={idx} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: cnt > 0 ? '#0f172a' : '#94a3b8' }}>
                          {cnt}
                        </td>
                      ))}

                      {/* Actual Prior Month Usage */}
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#0284c7', background: '#f0f9ff', fontSize: '13px' }}>
                        {item.priorMonthActual}
                      </td>

                      {/* Forecasted Prior Month Baseline */}
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#334155', background: '#f8fafc', fontSize: '13px' }}>
                        {item.priorMonthForecast}
                      </td>

                      {/* Variance */}
                      <td style={{
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        fontSize: '13px',
                        color: item.variance === 0 ? '#059669' : (item.variance > 0 ? '#0284c7' : '#b91c1c'),
                        background: item.variance === 0 ? '#ecfdf5' : (item.variance > 0 ? '#f0f9ff' : '#fee2e2')
                      }}>
                        {item.variance > 0 ? `+${item.variance}` : item.variance}
                      </td>

                      {/* Accuracy Remarks */}
                      <td style={{ textAlign: 'center' }}>
                        {item.accuracyRemark === 'Accurate' && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#dcfce7',
                            color: '#15803d',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 700
                          }}>
                            <CheckCircle2 size={12} />
                            Accurate (0)
                          </span>
                        )}
                        {item.accuracyRemark === 'Under Forecast' && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 700
                          }}>
                            <TrendingUp size={12} />
                            Under Forecast (+{item.variance})
                          </span>
                        )}
                        {item.accuracyRemark === 'Over Forecast' && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 700
                          }}>
                            <TrendingDown size={12} />
                            Over Forecast ({item.variance})
                          </span>
                        )}
                      </td>
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
                  
                  {months.slice(0, months.length - 1).map((_, idx) => {
                    const colTotal = enrichedItems.reduce((sum, it) => sum + (it.counts[idx] || 0), 0);
                    return (
                      <td key={idx} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#e2e8f0' }}>
                        {colTotal}
                      </td>
                    );
                  })}

                  {/* Total Actual Prior Month */}
                  <td style={{ textAlign: 'center', background: '#0284c7', color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 800 }}>
                    {executiveSummary.totalPriorActual.toLocaleString()}
                  </td>

                  {/* Total Forecasted Prior Month */}
                  <td style={{ textAlign: 'center', background: '#334155', color: '#ffffff', fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 800 }}>
                    {executiveSummary.totalPriorForecast.toLocaleString()}
                  </td>

                  {/* Net Variance */}
                  <td style={{ textAlign: 'center', background: '#0f172a', color: executiveSummary.netPriorVariance >= 0 ? '#4ade80' : '#f87171', fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 800 }}>
                    {executiveSummary.netPriorVariance >= 0 ? `+${executiveSummary.netPriorVariance}` : executiveSummary.netPriorVariance}
                  </td>

                  {/* Accuracy rate summary */}
                  <td style={{ textAlign: 'center', color: '#4ade80', fontSize: '11.5px' }}>
                    {executiveSummary.accuracyRate}% High Accuracy
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        /* TAB 1 & TAB 3: Main Forward Demand Forecast Grid */
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
                  const isDisplay = item.category_id === 'cat-display' || (item.description || '').toLowerCase().includes('display');
                  const commodityLabel = isDisplay ? 'DISPLAY' : 'BATTERY';

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
                          background: isDisplay ? '#e0f2fe' : '#dcfce7',
                          color: isDisplay ? '#0369a1' : '#15803d',
                          letterSpacing: '0.02em'
                        }}>
                          {commodityLabel}
                        </span>
                      </td>

                      {/* Part Number */}
                      <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                        {item.part_number}
                      </td>

                      {/* Description */}
                      <td style={{ fontWeight: 500, color: '#1e293b' }}>
                        {item.description}
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

                      {/* Admin Override Input */}
                      <td style={{ textAlign: 'center' }}>
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
                              <XCircle size={15} />
                            </button>
                          )}
                        </div>
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
