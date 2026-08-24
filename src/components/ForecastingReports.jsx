import { useState, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import {
  parseUniversalExcel,
  exportForecastingReportToExcel,
  downloadSampleFixablyForecastingTemplate
} from '../utils/excelParser';
import {
  exportForecastingReportToPDF,
  printForecastingReportDirect
} from '../utils/pdfGenerator';
import {
  calculateLinearRegressionForecast
} from '../utils/forecastEngine';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart as PieIcon,
  Layers,
  Download,
  Printer,
  FileSpreadsheet,
  UploadCloud,
  Search,
  Building2,
  DollarSign,
  Package,
  Activity,
  RotateCcw,
  ArrowUpRight,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Boxes
} from 'lucide-react';

// ── Commodity Color Palette ───────────────────────────────────────────────────
const COMMODITY_COLORS = {
  BATTERY: '#15803d',
  DISPLAY: '#0284c7',
  CAMERA: '#7c3aed',
  BACK_GLASS: '#0d9488',
  OTHER: '#64748b'
};

// ── Custom Tooltips ──────────────────────────────────────────────────────────
const CustomBarTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div style={{
      background: '#0f172a', color: '#fff', padding: '12px 16px',
      borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      border: '1px solid #334155', minWidth: '220px'
    }}>
      <p style={{ fontWeight: 800, marginBottom: '2px', color: '#38bdf8', fontFamily: 'monospace', fontSize: '13px' }}>
        {data.partNumber || payload[0]?.name}
      </p>
      {data.description && (
        <p style={{ fontSize: '11px', color: '#cbd5e1', margin: '0 0 8px 0' }}>
          {data.description}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '5px 12px', fontSize: '11.5px', borderTop: '1px solid #334155', paddingTop: '8px' }}>
        {data.commodity && (
          <>
            <span style={{ color: '#94a3b8' }}>Component:</span>
            <strong style={{ color: data.commodityColor || '#38bdf8' }}>{data.commodity}</strong>
          </>
        )}
        {data.model && (
          <>
            <span style={{ color: '#94a3b8' }}>iPhone Model:</span>
            <strong style={{ color: '#f8fafc' }}>{data.model}</strong>
          </>
        )}
        <span style={{ color: '#94a3b8' }}>Recommended:</span>
        <strong style={{ color: '#38bdf8' }}>{data.qty?.toLocaleString()} units</strong>
        <span style={{ color: '#94a3b8' }}>Est. Cost:</span>
        <strong style={{ color: '#10b981' }}>${data.cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
      </div>
    </div>
  );
};

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background: '#0f172a', color: '#fff', padding: '10px 14px',
      borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      border: '1px solid #334155'
    }}>
      <p style={{ fontWeight: 700, color: d.payload?.color || '#38bdf8', marginBottom: '4px' }}>{d.name}</p>
      <p style={{ margin: 0 }}>Forecasted Demand: <strong>{d.value?.toLocaleString()} units</strong></p>
      <p style={{ margin: 0 }}>Share of Total: <strong>{d.payload?.pct?.toFixed(1)}%</strong></p>
    </div>
  );
};

function SectionHeader({ icon: Icon, title, subtitle, color = '#0284c7' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
      <div style={{ background: `${color}18`, color, padding: '7px', borderRadius: '7px', display: 'inline-flex' }}>
        <Icon size={18} />
      </div>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>{title}</div>
        {subtitle && <div style={{ fontSize: '11.5px', color: '#64748b' }}>{subtitle}</div>}
      </div>
    </div>
  );
}

export default function ForecastingReports() {
  const {
    forecastItems,
    allocations,
    sites,
    parts,
    activePeriod,
    showToast,
    clearAllData
  } = useApp();

  const fileInputRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Custom uploaded dataset state (if user uploads a specific Fixably file directly on this report)
  const [uploadedDataset, setUploadedDataset] = useState(null);
  const [dataSourceMode, setDataSourceMode] = useState('active'); // 'active' | 'uploaded'

  // View Mode tabs
  const [viewMode, setViewMode] = useState('overview'); // overview | ledger | branch-demand | regression
  const [topPartsView, setTopPartsView] = useState('list'); // 'list' | 'chart'

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [modelFilter, setModelFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const ALL_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ── Intelligent Stock Price Resolver ───────────────────────────────────────
  const getPartStockPrice = useCallback((item) => {
    if (!item) return 100;
    if (typeof item.stocking_price === 'number' && item.stocking_price > 0) {
      return item.stocking_price;
    }
    const cleanPN = String(item.part_number || '').trim().toUpperCase();
    const matchedPart = (parts || []).find(p =>
      (p.part_number && p.part_number.toUpperCase() === cleanPN) ||
      (p.id && (p.id === item.part_id || p.id === item.id))
    );
    if (matchedPart?.stocking_price && Number(matchedPart.stocking_price) > 0) {
      return Number(matchedPart.stocking_price);
    }
    // Fallback based on commodity
    const desc = String(item.description || item.part_name || '').toLowerCase();
    if (desc.includes('display')) return 279;
    if (desc.includes('battery')) return 89;
    if (desc.includes('camera')) return 129;
    if (desc.includes('glass') || desc.includes('back')) return 99;
    if (desc.includes('rear') || desc.includes('mid')) return 119;
    return 100;
  }, [parts]);

  // ── Sourced Data Resolution ────────────────────────────────────────────────
  const activeDatasetItems = useMemo(() => {
    if (dataSourceMode === 'uploaded' && uploadedDataset?.forecastItems) {
      return uploadedDataset.forecastItems;
    }
    return forecastItems || [];
  }, [dataSourceMode, uploadedDataset, forecastItems]);

  const activeAllocations = useMemo(() => {
    if (dataSourceMode === 'uploaded' && uploadedDataset?.allocations) {
      return uploadedDataset.allocations;
    }
    return allocations || [];
  }, [dataSourceMode, uploadedDataset, allocations]);

  // Determine history months
  let maxHistoryLength = 0;
  activeDatasetItems.forEach(item => {
    if (Array.isArray(item.ytd_monthly_counts) && item.ytd_monthly_counts.length > 0) {
      maxHistoryLength = Math.max(maxHistoryLength, item.ytd_monthly_counts.length);
    }
  });
  if (maxHistoryLength === 0) {
    maxHistoryLength = (activePeriod?.month ? activePeriod.month - 1 : 8) || 8;
  }
  const historyMonths = ALL_MONTH_NAMES.slice(0, maxHistoryLength);
  const currentPeriodLabel = activePeriod?.label || `${ALL_MONTH_NAMES[maxHistoryLength] || 'Sep'} 2026`;

  // 26 Service Branches list (excluding Central DC)
  const serviceBranches = useMemo(() => {
    return (sites || []).filter(s => !s.is_dc);
  }, [sites]);

  // ── Handle File Ingestion directly on the Report ──────────────────────────
  const handleFileUpload = async (file) => {
    if (!file) return;
    setIsProcessing(true);
    try {
      const result = await parseUniversalExcel(file, sites, parts);
      if (result.success) {
        setUploadedDataset({
          fileName: file.name,
          uploadedAt: new Date(),
          forecastItems: result.payload?.forecastItems || result.payload?.allocations || [],
          allocations: result.payload?.allocations || [],
          summary: result.summary || {}
        });
        setDataSourceMode('uploaded');
        setCurrentPage(1);
        showToast(`Parsed Fixably Masterlist "${file.name}" with ${result.summary?.partsCount || result.summary?.totalRows || 0} part models!`, 'success');
      } else {
        showToast(result.error || 'Failed to parse Fixably file', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(`Error processing file: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); };
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFileUpload(f);
  };

  // ── Available iPhone Models for Filter ────────────────────────────────────
  const availableModels = useMemo(() => {
    const set = new Set();
    activeDatasetItems.forEach(it => {
      if (it.iphone_model) set.add(it.iphone_model);
      else if (it.description && it.description.includes('iPhone')) {
        const m = it.description.match(/iPhone\s+[0-9]+(?:\s+(?:Pro|Max|Plus|mini|e))*/i);
        if (m) set.add(m[0]);
      }
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [activeDatasetItems]);

  // ── Filtered Records ───────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return activeDatasetItems.filter(item => {
      // Category filter
      if (categoryFilter !== 'ALL') {
        const desc = (item.description || '').toLowerCase();
        const cat = (item.category_id || '').toLowerCase();
        if (categoryFilter === 'BATTERY' && !desc.includes('battery') && cat !== 'cat-battery') return false;
        if (categoryFilter === 'DISPLAY' && !desc.includes('display') && cat !== 'cat-display') return false;
        if (categoryFilter === 'CAMERA' && !desc.includes('camera') && cat !== 'cat-camera') return false;
        if (categoryFilter === 'BACK_GLASS' && !desc.includes('glass') && !desc.includes('back') && cat !== 'cat-backglass') return false;
      }

      // iPhone Model filter
      if (modelFilter !== 'ALL') {
        const itemModel = item.iphone_model || '';
        const itemDesc = item.description || '';
        if (!itemModel.toLowerCase().includes(modelFilter.toLowerCase()) && !itemDesc.toLowerCase().includes(modelFilter.toLowerCase())) {
          return false;
        }
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const pn = (item.part_number || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const model = (item.iphone_model || '').toLowerCase();
        if (!pn.includes(q) && !desc.includes(q) && !model.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [activeDatasetItems, categoryFilter, modelFilter, searchQuery]);

  // ── Multi-Dimensional Analytics Computations ───────────────────────────────
  const analytics = useMemo(() => {
    let totalRecommendedUnits = 0;
    let totalBaselineUnits = 0;
    let totalStockValuation = 0;
    let overrideCount = 0;

    let batteryUnits = 0, displayUnits = 0, cameraUnits = 0, backGlassUnits = 0, otherUnits = 0;
    const modelMap = {};
    const monthlySum = new Array(historyMonths.length).fill(0);

    filteredItems.forEach(it => {
      const counts = historyMonths.map((_, idx) => (it.ytd_monthly_counts || [])[idx] || 0);
      counts.forEach((c, idx) => { monthlySum[idx] += c; });

      const targetX = historyMonths.length + 1;
      const computed = it.computed_forecast !== undefined ? it.computed_forecast : calculateLinearRegressionForecast(counts, targetX);
      const hasOverride = it.admin_override !== null && it.admin_override !== undefined && it.admin_override !== '';
      const finalVal = hasOverride ? parseInt(it.admin_override, 10) : (it.final_forecast !== undefined ? it.final_forecast : computed);
      const price = getPartStockPrice(it);

      totalBaselineUnits += computed;
      totalRecommendedUnits += finalVal;
      totalStockValuation += (finalVal * price);
      if (hasOverride) overrideCount++;

      // Commodity Aggregation
      const desc = (it.description || '').toLowerCase();
      if (desc.includes('battery')) batteryUnits += finalVal;
      else if (desc.includes('display')) displayUnits += finalVal;
      else if (desc.includes('camera')) cameraUnits += finalVal;
      else if (desc.includes('glass') || desc.includes('back')) backGlassUnits += finalVal;
      else otherUnits += finalVal;

      // Model Aggregation
      const modelKey = it.iphone_model || (it.description?.match(/iPhone\s+[0-9]+(?:\s+(?:Pro|Max|Plus|mini|e))*/i)?.[0]) || 'Other Model';
      if (!modelMap[modelKey]) {
        modelMap[modelKey] = { model: modelKey, qty: 0, val: 0, skus: 0 };
      }
      modelMap[modelKey].qty += finalVal;
      modelMap[modelKey].val += (finalVal * price);
      modelMap[modelKey].skus += 1;
    });

    // 1. Commodity Share Pie Chart Data
    const commodityPie = [
      { name: 'Battery', value: batteryUnits, color: COMMODITY_COLORS.BATTERY },
      { name: 'Display', value: displayUnits, color: COMMODITY_COLORS.DISPLAY },
      { name: 'Camera', value: cameraUnits, color: COMMODITY_COLORS.CAMERA },
      { name: 'Back Glass', value: backGlassUnits, color: COMMODITY_COLORS.BACK_GLASS },
      { name: 'Other', value: otherUnits, color: COMMODITY_COLORS.OTHER }
    ].filter(d => d.value > 0).map(d => ({
      ...d,
      pct: totalRecommendedUnits > 0 ? (d.value / totalRecommendedUnits) * 100 : 0
    }));

    // 2. Historical vs Forecast Curve
    const trendCurve = historyMonths.map((mName, idx) => ({
      month: mName,
      actual: monthlySum[idx],
      isForecast: false
    }));
    trendCurve.push({
      month: currentPeriodLabel.split(' ')[0],
      forecast: totalRecommendedUnits,
      isForecast: true
    });

    // 3. Top Forecasted Parts with Component and iPhone Model
    const topPartsChart = [...filteredItems]
      .map(it => {
        const base = it.computed_forecast ?? 0;
        const finalVal = it.final_forecast ?? base;
        const price = getPartStockPrice(it);

        // Extract Component / Commodity
        const desc = (it.description || '').toLowerCase();
        let commodity = 'Part';
        let commodityColor = '#0284c7';
        if (desc.includes('battery')) {
          commodity = 'Battery';
          commodityColor = COMMODITY_COLORS.BATTERY;
        } else if (desc.includes('display')) {
          commodity = 'Display';
          commodityColor = COMMODITY_COLORS.DISPLAY;
        } else if (desc.includes('camera')) {
          commodity = 'Camera';
          commodityColor = COMMODITY_COLORS.CAMERA;
        } else if (desc.includes('glass') || desc.includes('back')) {
          commodity = 'Back Glass';
          commodityColor = COMMODITY_COLORS.BACK_GLASS;
        } else if (desc.includes('rear') || desc.includes('mid')) {
          commodity = 'Mid/Rear';
          commodityColor = '#d97706';
        }

        // Extract iPhone Model
        const model = it.iphone_model || it.description?.match(/iPhone\s+[0-9]+(?:\s+(?:Pro|Max|Plus|mini|e))*/i)?.[0] || 'iPhone';

        return {
          partNumber: it.part_number,
          description: it.description || '',
          commodity,
          commodityColor,
          model,
          displayLabel: `${it.part_number} • ${commodity} (${model})`,
          qty: finalVal,
          cost: finalVal * price
        };
      })
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    // 4. Model Family Donut
    const modelFamilyData = Object.values(modelMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8);

    // 5. Canonical Branch Allocations Matrix Summary (26 MobileCare Service Hubs)
    const branchMap = new Map();
    serviceBranches.forEach(s => {
      branchMap.set(s.id, {
        id: s.id,
        code: s.code,
        name: s.name,
        region: s.region || 'Metro Manila',
        totalUnits: 0,
        totalVal: 0
      });
    });

    activeAllocations.forEach(alloc => {
      const siteQtys = alloc.site_quantities || {};
      const allocPrice = getPartStockPrice(alloc);

      Object.entries(siteQtys).forEach(([siteKey, q]) => {
        const qty = Number(q) || 0;
        if (qty > 0) {
          // Resolve canonical branch
          const cleanKey = String(siteKey).trim().toUpperCase();
          const matchedBranch = serviceBranches.find(s =>
            s.id === siteKey ||
            s.code.toUpperCase() === cleanKey ||
            s.name.toUpperCase() === cleanKey ||
            cleanKey.includes(s.code.toUpperCase()) ||
            s.code.toUpperCase().includes(cleanKey.replace(/^(SITE-|ASP-|APP-)/, ''))
          );

          if (matchedBranch) {
            const entry = branchMap.get(matchedBranch.id);
            if (entry) {
              entry.totalUnits += qty;
              entry.totalVal += (qty * allocPrice);
            }
          }
        }
      });
    });

    const siteAllocationsList = Array.from(branchMap.values())
      .sort((a, b) => b.totalUnits - a.totalUnits)
      .map(s => ({
        ...s,
        pct: totalRecommendedUnits > 0 ? (s.totalUnits / totalRecommendedUnits) * 100 : 0
      }));

    return {
      totalSKUs: filteredItems.length,
      totalRecommendedUnits,
      totalBaselineUnits,
      totalStockValuation,
      overrideCount,
      commodityPie,
      trendCurve,
      topPartsChart,
      modelFamilyData,
      siteAllocationsList
    };
  }, [filteredItems, historyMonths, currentPeriodLabel, activeAllocations, serviceBranches, getPartStockPrice]);

  // ── Pagination Calculation for Ledger ───────────────────────────────────────
  const totalPages = Math.ceil(filteredItems.length / pageSize) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  // ── Export Handlers ────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    if (filteredItems.length === 0) {
      showToast('No forecasting data to export', 'warning');
      return;
    }
    await exportForecastingReportToExcel(filteredItems, analytics.siteAllocationsList, { periodLabel: currentPeriodLabel });
    showToast(`Exported Fixably Forecasting Excel Report for ${currentPeriodLabel}!`, 'success');
  };

  const handleExportPDF = () => {
    if (filteredItems.length === 0) {
      showToast('No forecasting data to export', 'warning');
      return;
    }
    exportForecastingReportToPDF(filteredItems, { periodLabel: currentPeriodLabel });
    showToast(`Exported Fixably Forecasting PDF Report for ${currentPeriodLabel}!`, 'success');
  };

  const handlePrint = () => {
    if (filteredItems.length === 0) {
      showToast('No forecasting data to print', 'warning');
      return;
    }
    printForecastingReportDirect(filteredItems, { periodLabel: currentPeriodLabel });
  };

  return (
    <div className="forecasting-reports-view" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* ── Top Hero & Control Card ────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ background: '#eff6ff', color: '#0284c7', padding: '8px', borderRadius: '8px' }}>
                <TrendingUp size={22} />
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Fixably Forecasting Reports & Analytics
                </h2>
                <p style={{ fontSize: '12.5px', color: '#64748b', margin: '2px 0 0 0' }}>
                  Enterprise demand forecasting analytics & regression intelligence — powered by Fixably Masterlist raw repair data
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
            />

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              title="Upload any raw Fixably masterlist or repair CSV/Excel file"
            >
              <UploadCloud size={15} />
              <span>{isProcessing ? 'Processing Masterlist...' : 'Upload Fixably Masterlist'}</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => downloadSampleFixablyForecastingTemplate('xlsx')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Download sample template"
            >
              <FileSpreadsheet size={15} />
              <span>Sample Template</span>
            </button>

            <div style={{ width: '1px', height: '22px', background: '#cbd5e1', margin: '0 4px' }} />

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExportExcel}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', borderColor: '#86efac' }}
              title="Export Multi-Tab Excel Workbook"
            >
              <FileSpreadsheet size={15} />
              <span>Export Excel</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExportPDF}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0284c7', borderColor: '#bae6fd' }}
              title="Download Landscape PDF Document"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePrint}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Print formatted executive forecast"
            >
              <Printer size={15} />
              <span>Print</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setUploadedDataset(null);
                setDataSourceMode('active');
                clearAllData();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#b91c1c' }}
              title="Clear all forecasting and reporting records to clean empty state"
            >
              <RotateCcw size={15} />
              <span>Clear Data</span>
            </button>
          </div>
        </div>

        {/* Data Source Indicator & Drag-and-Drop Hint */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            background: isDragging ? '#eff6ff' : '#f8fafc',
            border: isDragging ? '2px dashed #0284c7' : '1px dashed #cbd5e1',
            borderRadius: '8px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#475569' }}>
            <Sparkles size={16} color="#0284c7" />
            <span>
              {dataSourceMode === 'uploaded'
                ? <span>Viewing custom uploaded Fixably file: <strong style={{ color: '#0f172a' }}>{uploadedDataset?.fileName}</strong> ({analytics.totalSKUs} SKUs)</span>
                : <span>Sourced from active planning dataset: <strong style={{ color: '#0f172a' }}>{currentPeriodLabel}</strong> ({analytics.totalSKUs} SKUs)</span>}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {uploadedDataset && dataSourceMode === 'uploaded' && (
              <button
                type="button"
                onClick={() => setDataSourceMode('active')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0284c7',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                Switch back to Active Ingested Dataset
              </button>
            )}
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Drag and drop .xlsx/.csv masterlists anywhere here
            </span>
          </div>
        </div>
      </div>

      {/* ── Executive KPI Summary Grid ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div className="card" style={{ padding: '16px 18px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Recommended Demand</span>
            <div style={{ background: '#eff6ff', color: '#0284c7', padding: '5px', borderRadius: '6px' }}><Package size={16} /></div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {analytics.totalRecommendedUnits.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b' }}>units</span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#16a34a', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowUpRight size={13} />
            <span>Baseline Regression: {analytics.totalBaselineUnits.toLocaleString()} units</span>
          </div>
        </div>

        <div className="card" style={{ padding: '16px 18px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Projected Stock Value</span>
            <div style={{ background: '#f0fdf4', color: '#15803d', padding: '5px', borderRadius: '6px' }}><DollarSign size={16} /></div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            ${analytics.totalStockValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
            Est. ₱{(analytics.totalStockValuation * 57).toLocaleString(undefined, { maximumFractionDigits: 0 })} PHP
          </div>
        </div>

        <div className="card" style={{ padding: '16px 18px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Covered Part Models</span>
            <div style={{ background: '#faf5ff', color: '#7c3aed', padding: '5px', borderRadius: '6px' }}><Layers size={16} /></div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {analytics.totalSKUs} <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b' }}>SKUs</span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
            iPhone 13 to iPhone 17 Pro Max
          </div>
        </div>

        <div className="card" style={{ padding: '16px 18px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Service Hubs Demand</span>
            <div style={{ background: '#fef3c7', color: '#b45309', padding: '5px', borderRadius: '6px' }}><Building2 size={16} /></div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
            {serviceBranches.length || 26} <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748b' }}>Branches</span>
          </div>
          <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
            26 Service Hubs • 1 DC Central Warehouse
          </div>
        </div>
      </div>

      {/* ── Filter Bar & View Mode Navigation ──────────────────────────────── */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '14px' }}>
          {/* View Mode Switcher Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
            {[
              { id: 'overview', label: 'Executive Overview', icon: BarChart3 },
              { id: 'ledger', label: 'Forecast Master Ledger', icon: FileSpreadsheet },
              { id: 'branch-demand', label: 'Branch Demand Matrix', icon: Building2 },
              { id: 'regression', label: 'Regression & Safety Buffers', icon: Activity }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = viewMode === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setViewMode(tab.id)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: '6px',
                    border: 'none',
                    background: isActive ? '#ffffff' : 'transparent',
                    color: isActive ? '#0f172a' : '#64748b',
                    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Icon size={14} color={isActive ? '#0284c7' : '#94a3b8'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Search */}
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search part #, description, model..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ paddingLeft: '32px', height: '34px', fontSize: '12px', width: '100%' }}
            />
          </div>
        </div>

        {/* Secondary Filter Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
          {/* Commodity Category Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Commodity:</span>
            {['ALL', 'BATTERY', 'DISPLAY', 'CAMERA', 'BACK_GLASS'].map(cat => {
              const isActive = categoryFilter === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => { setCategoryFilter(cat); setCurrentPage(1); }}
                  style={{
                    padding: '3px 9px',
                    fontSize: '11px',
                    fontWeight: isActive ? 700 : 500,
                    borderRadius: '5px',
                    border: isActive ? '1px solid #0284c7' : '1px solid #e2e8f0',
                    background: isActive ? '#0284c7' : '#f8fafc',
                    color: isActive ? '#ffffff' : '#475569',
                    cursor: 'pointer'
                  }}
                >
                  {cat.replace('_', ' ')}
                </button>
              );
            })}
          </div>

          {/* iPhone Model Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Model:</span>
            <select
              value={modelFilter}
              onChange={(e) => { setModelFilter(e.target.value); setCurrentPage(1); }}
              style={{
                padding: '3px 8px',
                fontSize: '11.5px',
                borderRadius: '5px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#0f172a'
              }}
            >
              {availableModels.map(m => (
                <option key={m} value={m}>{m === 'ALL' ? 'All iPhone Models' : m}</option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '11.5px', color: '#64748b' }}>
            Showing <strong>{filteredItems.length}</strong> of <strong>{activeDatasetItems.length}</strong> part models
          </div>
        </div>
      </div>

      {/* ── View Mode: 1. Executive Overview ──────────────────────────────── */}
      {viewMode === 'overview' && (
        activeDatasetItems.length === 0 ? (
          <div className="card" style={{ padding: '48px 24px', textAlign: 'center', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <div style={{ width: '54px', height: '54px', borderRadius: '50%', background: '#f0f9ff', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <UploadCloud size={28} />
            </div>
            <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
              No Active Forecasting Dataset
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '520px', margin: '0 auto 20px auto', lineHeight: 1.5 }}>
              The system is currently in a clean empty state. Upload a Fixably Masterlist file above or import forecasting data from Planning to generate executive reports and branch demand matrices.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '13px' }}
            >
              <UploadCloud size={15} />
              <span>Upload Fixably Masterlist File</span>
            </button>
          </div>
        ) : (
          <div>
            {/* Row 1: Historical Demand vs Forecast Curve & Commodity Share Pie */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div className="card" style={{ padding: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <SectionHeader
                  icon={TrendingUp}
                  title="Historical Usage Trend vs. Forecast Curve"
                  subtitle="Aggregated repair consumption across Jan–Aug with projected target month"
                  color="#0284c7"
                />
              <div style={{ height: '280px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.trendCurve} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0284c7" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip content={<CustomBarTooltip />} />
                    <Area type="monotone" dataKey="actual" name="Historical Usage" stroke="#0284c7" strokeWidth={2} fillOpacity={1} fill="url(#colorActual)" />
                    <Area type="monotone" dataKey="forecast" name="Recommended Forecast" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorForecast)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card" style={{ padding: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <SectionHeader
                icon={PieIcon}
                title="Commodity Distribution Share"
                subtitle="Breakdown of forecasted parts by commodity family"
                color="#7c3aed"
              />
              <div style={{ height: '240px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analytics.commodityPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                    >
                      {analytics.commodityPie.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" formatter={(value) => <span style={{ fontSize: '11px', color: '#475569' }}>{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Row 2: Top 10 High-Demand Parts & Top iPhone Models */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: '20px' }}>
            <div className="card" style={{ padding: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                <SectionHeader
                  icon={BarChart3}
                  title="Top 10 High-Demand Parts"
                  subtitle="Highest replenishment volume by Part #, Component & iPhone Model"
                  color="#0284c7"
                />

                {/* View Switcher Pills: Ranked List vs Graphical Chart */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setTopPartsView('list')}
                    style={{
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: topPartsView === 'list' ? 700 : 500,
                      borderRadius: '4px',
                      border: 'none',
                      background: topPartsView === 'list' ? '#ffffff' : 'transparent',
                      color: topPartsView === 'list' ? '#0284c7' : '#64748b',
                      boxShadow: topPartsView === 'list' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Ranked UI
                  </button>
                  <button
                    type="button"
                    onClick={() => setTopPartsView('chart')}
                    style={{
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: topPartsView === 'chart' ? 700 : 500,
                      borderRadius: '4px',
                      border: 'none',
                      background: topPartsView === 'chart' ? '#ffffff' : 'transparent',
                      color: topPartsView === 'chart' ? '#0284c7' : '#64748b',
                      boxShadow: topPartsView === 'chart' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Bar Chart
                  </button>
                </div>
              </div>

              {topPartsView === 'list' ? (
                /* Modern Spacious Ranked UI List */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {analytics.topPartsChart.map((it, idx) => {
                    const maxTopQty = analytics.topPartsChart[0]?.qty || 1;
                    const barPercent = Math.min(100, (it.qty / maxTopQty) * 100);
                    const isTopThree = idx < 3;

                    return (
                      <div
                        key={it.partNumber || idx}
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #f1f5f9',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {/* Top Row: Rank, Part Number, Component Badge, iPhone Model, and Recommended Quantity */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {/* Rank Badge */}
                            <span style={{
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              background: isTopThree ? (idx === 0 ? '#fef3c7' : '#f1f5f9') : '#f1f5f9',
                              color: isTopThree ? (idx === 0 ? '#b45309' : '#475569') : '#64748b',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '11px',
                              fontWeight: 800
                            }}>
                              {idx + 1}
                            </span>

                            {/* Part Number Badge */}
                            <span style={{
                              fontFamily: 'var(--font-mono, monospace)',
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: '#0284c7',
                              background: '#eff6ff',
                              border: '1px solid #dbeafe',
                              padding: '2px 7px',
                              borderRadius: '4px'
                            }}>
                              {it.partNumber}
                            </span>

                            {/* Component Badge */}
                            <span style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: it.commodity === 'Battery' ? '#f0fdf4' : (it.commodity === 'Display' ? '#eff6ff' : '#faf5ff'),
                              color: it.commodityColor || '#0284c7',
                              border: `1px solid ${it.commodityColor}30`
                            }}>
                              {it.commodity}
                            </span>

                            {/* iPhone Model */}
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                              {it.model}
                            </span>
                          </div>

                          {/* Right: Units & Valuation */}
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                              {it.qty.toLocaleString()} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>units</span>
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '8px' }}>
                              (${it.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                            </span>
                          </div>
                        </div>

                        {/* Bottom Row: Proportional Progress Bar */}
                        <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '9999px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${barPercent}%`,
                              height: '100%',
                              background: it.commodityColor || '#0284c7',
                              borderRadius: '9999px',
                              transition: 'width 0.4s ease'
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Graphical Bar Chart View */
                <div style={{ height: '340px', width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.topPartsChart} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis
                        dataKey="partNumber"
                        type="category"
                        width={90}
                        tick={{ fontSize: 10.5, fill: '#0f172a', fontFamily: 'monospace', fontWeight: 600 }}
                      />
                      <Tooltip content={<CustomBarTooltip />} />
                      <Bar dataKey="qty" name="Recommended Qty" radius={[0, 4, 4, 0]}>
                        {analytics.topPartsChart.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.commodityColor || '#0284c7'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
              <SectionHeader
                icon={Boxes}
                title="Demand by iPhone Family"
                subtitle="Total units required per device series"
                color="#15803d"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                {analytics.modelFamilyData.map((m, idx) => {
                  const pct = analytics.totalRecommendedUnits > 0 ? (m.qty / analytics.totalRecommendedUnits) * 100 : 0;
                  return (
                    <div key={idx} style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                        <strong style={{ color: '#0f172a' }}>{m.model}</strong>
                        <span style={{ color: '#0284c7', fontWeight: 700 }}>{m.qty.toLocaleString()} units ({pct.toFixed(1)}%)</span>
                      </div>
                      <div style={{ width: '100%', height: '5px', background: '#e2e8f0', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: '#0284c7', borderRadius: '9999px' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* ── View Mode: 2. Master Forecast Ledger ───────────────────────────── */}
      {viewMode === 'ledger' && (
        <div className="card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                Part-Level Demand Forecasting Ledger
              </h3>
              <p style={{ fontSize: '11.5px', color: '#64748b', margin: '2px 0 0 0' }}>
                Historical monthly consumption actuals vs. Linear regression base and recommended replenishment quantities
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11.5px', color: '#64748b' }}>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
                style={{ fontSize: '11.5px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', margin: 0, fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#fff' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '40px' }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Part Number</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Description & Model</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Commodity</th>
                  {historyMonths.map(m => (
                    <th key={m} style={{ padding: '10px 6px', textAlign: 'center', width: '38px', color: '#94a3b8' }}>{m}</th>
                  ))}
                  <th style={{ padding: '10px 10px', textAlign: 'center', background: '#1e293b' }}>Base</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', background: '#1e293b' }}>Override</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center', background: '#0284c7', color: '#fff' }}>Final</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stocking Price</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={10 + historyMonths.length} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                      No forecast parts match the selected filters.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((it, idx) => {
                    const globalIdx = (currentPage - 1) * pageSize + idx + 1;
                    const monthly = it.ytd_monthly_counts || [];
                    const base = it.computed_forecast ?? 0;
                    const hasOverride = it.admin_override !== null && it.admin_override !== undefined && it.admin_override !== '';
                    const finalVal = hasOverride ? parseInt(it.admin_override, 10) : (it.final_forecast ?? base);
                    const price = getPartStockPrice(it);
                    const totalCost = finalVal * price;

                    return (
                      <tr key={it.id || it.part_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>{globalIdx}</td>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: '#0284c7' }}>
                            {it.part_number}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{it.description}</div>
                          {it.iphone_model && <div style={{ fontSize: '11px', color: '#64748b' }}>{it.iphone_model}</div>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: it.description?.toLowerCase().includes('battery') ? '#f0fdf4' : '#eff6ff',
                            color: it.description?.toLowerCase().includes('battery') ? '#15803d' : '#0284c7'
                          }}>
                            {it.description?.toLowerCase().includes('battery') ? 'Battery' : 'Display'}
                          </span>
                        </td>
                        {historyMonths.map((_, mIdx) => (
                          <td key={mIdx} style={{ textAlign: 'center', fontSize: '11px', color: '#475569' }}>
                            {monthly[mIdx] || 0}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center', fontWeight: 600, color: '#475569', background: '#f8fafc' }}>
                          {base}
                        </td>
                        <td style={{ textAlign: 'center', color: hasOverride ? '#b45309' : '#94a3b8', background: '#f8fafc', fontWeight: hasOverride ? 700 : 400 }}>
                          {hasOverride ? it.admin_override : '—'}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#0284c7', background: '#eff6ff', fontSize: '13px' }}>
                          {finalVal}
                        </td>
                        <td style={{ textAlign: 'right', color: '#475569', fontWeight: 600 }}>
                          ${price.toFixed(2)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                          ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, filteredItems.length)}</strong> of <strong>{filteredItems.length}</strong> items
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ padding: '4px 8px' }}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: '12px', color: '#0f172a', fontWeight: 600 }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ padding: '4px 8px' }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Mode: 3. Branch Demand Matrix ─────────────────────────────── */}
      {viewMode === 'branch-demand' && (
        <div className="card" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              Service Branch Allocation Demand Matrix
            </h3>
            <p style={{ fontSize: '11.5px', color: '#64748b', margin: '2px 0 0 0' }}>
              Projected demand volume, estimated inventory cost, and share of total DC distribution across all 26 MobileCare branch service hubs
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', margin: 0, fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#fff' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '40px' }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Branch Code</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Branch Name</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Region</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Total Demand Units</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Projected Stock Value</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Share of DC Demand</th>
                </tr>
              </thead>
              <tbody>
                {analytics.siteAllocationsList.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                      No branch allocations found for the active dataset.
                    </td>
                  </tr>
                ) : (
                  analytics.siteAllocationsList.map((site, idx) => (
                    <tr key={site.id || site.code || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>{idx + 1}</td>
                      <td>
                        <span style={{
                          fontFamily: 'var(--font-mono, monospace)',
                          fontWeight: 700,
                          background: '#eff6ff',
                          color: '#0284c7',
                          padding: '2px 6px',
                          borderRadius: '4px'
                        }}>
                          {site.code}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>{site.name}</td>
                      <td>
                        <span style={{ fontSize: '11px', color: '#475569', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                          {site.region || 'Metro Manila'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                        {site.totalUnits.toLocaleString()} units
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#15803d' }}>
                        ${site.totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: '#0284c7' }}>{(site.pct || 0).toFixed(1)}%</span>
                          <div style={{ width: '45px', height: '5px', background: '#e2e8f0', borderRadius: '9999px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, site.pct || 0)}%`, height: '100%', background: '#0284c7' }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── View Mode: 4. Regression & Safety Buffers ─────────────────────── */}
      {viewMode === 'regression' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
          <div className="card" style={{ padding: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
            <SectionHeader
              icon={Activity}
              title="Statistical Regression & Safety Stock Buffer Matrix"
              subtitle="Analysis of consumption variance, trend direction, and suggested safety buffers"
              color="#0d9488"
            />

            <div style={{ overflowX: 'auto', marginTop: '12px' }}>
              <table className="table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#0f172a', color: '#fff' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Part Number</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Avg Monthly Usage</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Trend Direction</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Baseline Forecast</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>+5% Safety Buffer</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>+10% Surge Buffer</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', background: '#0284c7' }}>Recommended PO</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.slice(0, 50).map(it => {
                    const monthly = it.ytd_monthly_counts || [];
                    const avg = monthly.length > 0 ? (monthly.reduce((a, b) => a + b, 0) / monthly.length).toFixed(1) : 0;
                    const base = it.computed_forecast ?? 0;
                    const finalVal = it.final_forecast ?? base;
                    const buffer5 = Math.ceil(finalVal * 1.05);
                    const buffer10 = Math.ceil(finalVal * 1.10);
                    const isTrendingUp = base >= avg;

                    return (
                      <tr key={it.part_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{it.part_number}</td>
                        <td style={{ fontWeight: 600, color: '#0f172a' }}>{it.description}</td>
                        <td style={{ textAlign: 'center', color: '#475569' }}>{avg} / mo</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: isTrendingUp ? '#15803d' : '#b45309',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            {isTrendingUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                            <span>{isTrendingUp ? 'Growing' : 'Stable / Soft'}</span>
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: '#475569' }}>{base}</td>
                        <td style={{ textAlign: 'center', color: '#0284c7' }}>{buffer5}</td>
                        <td style={{ textAlign: 'center', color: '#7c3aed' }}>{buffer10}</td>
                        <td style={{ textAlign: 'center', fontWeight: 800, color: '#0f172a', background: '#f8fafc' }}>{finalVal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
