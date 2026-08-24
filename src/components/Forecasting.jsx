import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { calculateLinearRegressionForecast, calculateForecastTrendMetrics } from '../utils/forecastEngine';
import { exportForecastToExcel } from '../utils/excelParser';
import SaveRecordModal from './SaveRecordModal';
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
  Sliders,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';

export default function Forecasting() {
  const {
    forecastItems,
    selectedCategory,
    updateForecastOverride,
    setActiveTab,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    activePeriod,
    clearAllData
  } = useApp();

  const [showSaveModal, setShowSaveModal] = useState(false);

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

  // Filter items by category
  const filteredItems = useMemo(() => {
    return forecastItems.filter(item => {
      if (selectedCategory === 'ALL') return true;
      if (selectedCategory === 'BATTERY') return item.category_id === 'cat-battery';
      if (selectedCategory === 'DISPLAY') return item.category_id === 'cat-display';
      if (selectedCategory === 'CAMERA') return item.category_id === 'cat-camera';
      if (selectedCategory === 'BACK_GLASS') return item.category_id === 'cat-backglass';
      return true;
    });
  }, [forecastItems, selectedCategory]);

  // High level metrics
  const metrics = useMemo(() => {
    let totalBase = 0;
    let totalRecommended = 0;
    let overrideCount = 0;

    filteredItems.forEach(item => {
      const counts = months.map((_, idx) => (item.ytd_monthly_counts || [])[idx] || 0);
      const targetX = months.length + 1;
      const computed = item.computed_forecast !== undefined ? item.computed_forecast : calculateLinearRegressionForecast(counts, targetX);
      const hasOverride = item.admin_override !== null && item.admin_override !== undefined && item.admin_override !== '';
      const finalVal = hasOverride ? parseInt(item.admin_override, 10) : (item.final_forecast !== undefined ? item.final_forecast : computed);
      
      totalBase += computed;
      totalRecommended += finalVal;
      if (hasOverride) overrideCount++;
    });

    return { totalBase, totalRecommended, overrideCount };
  }, [filteredItems, months]);

  const exportForecastExcelHandler = async () => {
    if (filteredItems.length === 0) {
      showToast('No forecast items to export', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    await exportForecastToExcel(filteredItems, currentPeriodLabel);
    showToast(`Exported ${currentPeriodLabel} Forecast with styled Excel format`, 'success');
  };

  const handlePrint = () => {
    if (filteredItems.length === 0) {
      showToast('No forecast items to print', 'warning');
      return;
    }
    window.print();
  };

  return (
    <div className="forecasting-view" style={{ maxWidth: '1300px', margin: '0 auto' }}>
      {/* Header with Title and Actions */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <TrendingUp size={20} color="var(--primary)" />
              <h2 style={{ fontSize: '18px', margin: 0 }}>
                {activePeriod?.label || 'September 2026'} Demand Forecasting
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
              Calculates projected monthly usage with linear regression: <code>y = α + βx</code> plus standard safety stock buffer.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData({ force: true, silent: false, reason: 'Forecasting refresh button' })}
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
              onClick={clearAllData}
              title="Clear all forecasting and allocation data to empty state"
              style={{ color: '#b91c1c' }}
            >
              <RotateCcw size={14} />
              <span>Clear Data</span>
            </button>
          </div>
        </div>

        {/* Quick Summary Strip */}
        {filteredItems.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '14px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={15} color="var(--primary)" />
              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Base Projected:</span>
              <strong style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{metrics.totalBase.toLocaleString()} units</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={15} color="var(--success)" />
              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Recommended Order (w/ Buffer):</span>
              <strong style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>
                {metrics.totalRecommended.toLocaleString()} units
              </strong>
            </div>
            {metrics.overrideCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sliders size={15} color="var(--accent-orange)" />
                <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Active Admin Overrides:</span>
                <span
                  style={{
                    background: 'var(--accent-orange-light)',
                    color: 'var(--accent-orange)',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11.5px',
                    fontWeight: 700
                  }}
                >
                  {metrics.overrideCount} model{metrics.overrideCount > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Record Modal Dialog */}
      {showSaveModal && (
        <SaveRecordModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          defaultType="forecast"
        />
      )}

      {/* Empty State or Forecasting Grid */}
      {filteredItems.length === 0 ? (
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
            No Demand Forecasts Yet
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 20px', lineHeight: 1.5 }}>
            Upload a raw Fixably / GSX service usage file (<code>.csv</code> or <code>.xlsx</code>) or a forecasting workbook in Data Import to automatically compute linear regression forecasts across parts.
          </p>
          <button className="btn btn-primary" onClick={() => setActiveTab('import')}>
            <UploadCloud size={16} />
            <span>Go to Fixably / GSX Data Import</span>
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part Number</th>
                <th>Part Description</th>
                <th>Trend</th>
                {months.map(m => (
                  <th key={m} style={{ textAlign: 'center' }}>{m}</th>
                ))}
                <th style={{ textAlign: 'center', background: '#f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                    <span>{targetMonthShort} Forecast</span>
                    <TrendingUp size={13} color="var(--primary)" />
                  </div>
                </th>
                <th style={{ textAlign: 'center' }}>Admin Override</th>
                <th style={{ textAlign: 'center', background: '#ecfdf5', color: '#065f46' }}>Recommended Order</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => {
                const rawCounts = item.ytd_monthly_counts || [];
                const counts = months.map((_, idx) => rawCounts[idx] || 0);
                const targetX = months.length + 1;
                const computed = item.computed_forecast !== undefined ? item.computed_forecast : calculateLinearRegressionForecast(counts, targetX);
                const hasOverride = item.admin_override !== null && item.admin_override !== undefined && item.admin_override !== '';
                const finalOrder = hasOverride ? parseInt(item.admin_override, 10) : (item.final_forecast !== undefined ? item.final_forecast : computed);
                const trendMetrics = calculateForecastTrendMetrics(counts);

                return (
                  <tr key={item.part_id}>
                    <td className="font-mono"><strong>{item.part_number}</strong></td>
                    <td>{item.description}</td>
                    <td style={{ textAlign: 'center' }}>
                      {trendMetrics.trend === 'increasing' && (
                        <span
                          title={`Upward trend: +${trendMetrics.momGrowthPct}% MoM`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                            color: '#15803d',
                            background: '#dcfce7',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600
                          }}
                        >
                          <TrendingUp size={12} />
                          +{trendMetrics.momGrowthPct}%
                        </span>
                      )}
                      {trendMetrics.trend === 'decreasing' && (
                        <span
                          title={`Downward trend: ${trendMetrics.momGrowthPct}% MoM`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                            color: '#b91c1c',
                            background: '#fee2e2',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600
                          }}
                        >
                          <TrendingDown size={12} />
                          {trendMetrics.momGrowthPct}%
                        </span>
                      )}
                      {trendMetrics.trend === 'stable' && (
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
                            fontSize: '11px',
                            fontWeight: 600
                          }}
                        >
                          <Minus size={12} />
                          Stable
                        </span>
                      )}
                    </td>
                    {counts.map((cnt, idx) => (
                      <td key={idx} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                        {cnt}
                      </td>
                    ))}
                    <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', background: '#f8fafc' }}>
                      {computed}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number"
                          className="forecast-override-input"
                          placeholder={String(computed)}
                          value={hasOverride ? item.admin_override : ''}
                          onChange={(e) => updateForecastOverride(item.part_id, e.target.value)}
                          style={{ width: '70px', textAlign: 'center' }}
                        />
                        {hasOverride && (
                          <button
                            type="button"
                            onClick={() => updateForecastOverride(item.part_id, '')}
                            title="Reset override to algorithmic calculation"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'flex'
                            }}
                          >
                            <XCircle size={15} color="#ef4444" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', background: '#f0fdf4', color: '#15803d', fontSize: '15px' }}>
                      {finalOrder}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
