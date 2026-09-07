import { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import dbStorage from '../utils/dbStorage';
import {
  parseStockTransfersReportFile,
  exportStockTransfersToExcel,
  downloadSampleStockTransfersTemplate
} from '../utils/excelParser';
import {
  exportStockTransfersToPDF,
  printStockTransfersDirect
} from '../utils/pdfGenerator';
import { resolvePartInfo } from '../utils/partResolver';
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
  FileSpreadsheet,
  UploadCloud,
  Download,
  Printer,
  FileText,
  Search,
  ArrowRight,
  TrendingUp,
  Package,
  DollarSign,
  Building2,
  Layers,
  Trash2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  BarChart2,
  PieChart as PieIcon,
  Activity,
  RefreshCw
} from 'lucide-react';

// ── Colour palette ──────────────────────────────────────────────────────────
const CHART_COLORS = [
  '#0284c7', '#15803d', '#92400e', '#7c3aed', '#0891b2',
  '#be123c', '#b45309', '#0d9488', '#4338ca', '#c2410c',
  '#1d4ed8', '#059669', '#d97706', '#9333ea', '#0f766e'
];

const COMMODITY_COLORS = {
  BATTERY: '#15803d',
  DISPLAY: '#0284c7',
  CAMERA: '#7c3aed',
  OTHER: '#64748b'
};

// ── Formatting Helpers ───────────────────────────────────────────────────────
function getRecordValuation(r, partsCatalog = []) {
  let v = Number(r.transfer_value);
  if (!isNaN(v) && v > 0) return v;
  const q = Number(r.transfer_quantity) || 1;
  const desc = (r.product_name || '').toLowerCase();
  const isDisplay = desc.includes('display') || desc.includes('screen');
  const isBattery = desc.includes('battery');
  const isCamera = desc.includes('camera');
  const isBackGlass = desc.includes('back glass') || desc.includes('rear system') || desc.includes('mid');

  const resolved = resolvePartInfo(r.product_code, partsCatalog);
  if (resolved && Number(resolved.stocking_price) > 0) {
    return Number(resolved.stocking_price) * q;
  }
  if (isDisplay) return 279 * q;
  if (isBattery) return 99 * q;
  if (isCamera) return 149 * q;
  if (isBackGlass) return 129 * q;
  return 89 * q;
}

function formatCurrencyTick(v) {
  if (v === 0) return '$0';
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `$${v}`;
}

function formatRouteDisplayName(from = '', to = '') {
  const clean = (str) => {
    return String(str || '')
      .replace(/_MSPI-Owned/gi, ' (MSPI)')
      .replace(/\(APP\)-MSPI-Owned/gi, 'APP')
      .replace(/SERVICE_HUB/gi, 'Service Hub')
      .replace(/DC_MSPI/gi, 'DC')
      .trim();
  };
  const fromClean = clean(from);
  const toClean = clean(to);
  const combined = `${fromClean} → ${toClean}`;
  return combined.length > 28 ? `${combined.substring(0, 26)}…` : combined;
}

// ── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const fullName = payload[0]?.payload?.fullName || payload[0]?.payload?.label || label;
  return (
    <div style={{
      background: '#0f172a', color: '#fff', padding: '10px 14px',
      borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      border: '1px solid #334155'
    }}>
      <p style={{ fontWeight: 700, marginBottom: '6px', color: '#38bdf8', fontSize: '13px' }}>{fullName}</p>
      {payload.map((p, i) => {
        const isVal = p.dataKey === 'val' || p.name?.toLowerCase().includes('val') || p.name?.toLowerCase().includes('price') || p.name?.toLowerCase().includes('cost');
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', margin: '4px 0' }}>
            <span style={{ color: p.color || (isVal ? '#34d399' : '#38bdf8'), fontWeight: 600 }}>{p.name}:</span>
            <strong style={{ fontFamily: 'var(--font-mono, monospace)', color: '#fff' }}>
              {isVal
                ? `$${Number(p.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : Number(p.value || 0).toLocaleString()}
            </strong>
          </div>
        );
      })}
    </div>
  );
};

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background: '#0f172a', color: '#fff', padding: '10px 14px',
      borderRadius: '6px', fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.35)'
    }}>
      <p style={{ fontWeight: 700, color: d.color || '#38bdf8', marginBottom: '4px' }}>{d.name}</p>
      <p style={{ margin: 0 }}>Units: <strong>{d.value?.toLocaleString()}</strong></p>
      <p style={{ margin: 0 }}>Share: <strong>{d.payload?.pct?.toFixed(1)}%</strong></p>
    </div>
  );
};

// ── Section heading helper ───────────────────────────────────────────────────
function ChartSectionHeading({ icon: Icon, title, subtitle, color = '#0284c7' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
      <div style={{ background: `${color}1a`, color, padding: '7px', borderRadius: '7px', display: 'inline-flex' }}>
        <Icon size={18} />
      </div>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>{title}</div>
        {subtitle && <div style={{ fontSize: '11.5px', color: '#64748b' }}>{subtitle}</div>}
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function StockTransferReports() {
  const {
    stockTransferReports,
    stockTransferMetadata,
    parts,
    importStockTransfersReport,
    clearStockTransfersReport,
    showToast,
    isAutoRefreshing,
    autoRefreshData,
    canEdit,
    isReadOnly
  } = useApp();

  const fileInputRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // View Mode tabs
  const [viewMode, setViewMode] = useState('overview'); // overview | ledger | routes | parts

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [fromFilter, setFromFilter] = useState('ALL');
  const [toFilter, setToFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Unique lists for filter dropdowns
  const uniqueFromStocks = useMemo(() => {
    const s = new Set();
    stockTransferReports.forEach(r => { if (r.from_stock) s.add(r.from_stock); });
    return Array.from(s).sort();
  }, [stockTransferReports]);

  const uniqueToStocks = useMemo(() => {
    const s = new Set();
    stockTransferReports.forEach(r => { if (r.to_stock) s.add(r.to_stock); });
    return Array.from(s).sort();
  }, [stockTransferReports]);

  // Smart On-Mount Hydration: If local state is empty, check IndexedDB first, then trigger targeted cloud sync
  useEffect(() => {
    if (!stockTransferReports || stockTransferReports.length === 0) {
      let isMounted = true;
      (async () => {
        try {
          const [cachedReports, cachedMeta] = await Promise.all([
            dbStorage.getItem('mdc_stock_transfer_reports'),
            dbStorage.getItem('mdc_stock_transfer_metadata')
          ]);
          if (isMounted && Array.isArray(cachedReports) && cachedReports.length > 0) {
            importStockTransfersReport(cachedReports, cachedMeta);
            return;
          }
        } catch (e) {}

        if (isMounted) {
          autoRefreshData({
            force: true,
            silent: true,
            isManual: true,
            reason: 'StockTransferReports tab initial mount sync',
            tables: ['saved_records']
          });
        }
      })();
      return () => { isMounted = false; };
    }
  }, []);

  // ── File Upload ────────────────────────────────────────────────────────────
  const handleFileUpload = async (file) => {
    if (!file) return;
    setIsProcessing(true);
    try {
      const result = await parseStockTransfersReportFile(file);
      if (result.success) {
        await importStockTransfersReport(result.records, result.metadata);
        setCurrentPage(1);
      } else {
        showToast(result.error || 'Failed to parse Stock Transfers file', 'error');
      }
    } catch (err) {
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

  // ── Filtered Dataset ───────────────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    return stockTransferReports.filter(r => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (![r.product_code, r.product_name, r.serial_number, r.from_stock, r.to_stock, r.transfer_received_date]
          .some(v => (v || '').toLowerCase().includes(q))) return false;
      }
      if (fromFilter !== 'ALL' && r.from_stock !== fromFilter) return false;
      if (toFilter !== 'ALL' && r.to_stock !== toFilter) return false;
      if (categoryFilter !== 'ALL') {
        const d = (r.product_name || '').toLowerCase();
        if (categoryFilter === 'BATTERY' && !d.includes('battery')) return false;
        if (categoryFilter === 'DISPLAY' && !d.includes('display')) return false;
        if (categoryFilter === 'CAMERA' && !d.includes('camera')) return false;
        if (categoryFilter === 'OTHER' && (d.includes('battery') || d.includes('display') || d.includes('camera'))) return false;
      }
      return true;
    });
  }, [stockTransferReports, searchQuery, fromFilter, toFilter, categoryFilter]);

  // ── Analytics ──────────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    let totalUnits = 0, totalVal = 0;
    let battery = 0, display = 0, camera = 0, other = 0;
    const routeMap = {};
    const partMap = {};
    const originMap = {};
    const destMap = {};
    const monthMap = {};

    filteredRecords.forEach(r => {
      const q = Number(r.transfer_quantity) || 1;
      const v = getRecordValuation(r, parts);
      const desc = (r.product_name || '').toLowerCase();
      totalUnits += q;
      totalVal += v;

      if (desc.includes('battery')) battery += q;
      else if (desc.includes('display') || desc.includes('screen')) display += q;
      else if (desc.includes('camera')) camera += q;
      else other += q;

      // Route aggregation
      const rk = `${r.from_stock || 'DC'} → ${r.to_stock || 'Branch'}`;
      if (!routeMap[rk]) routeMap[rk] = { from: r.from_stock || 'DC', to: r.to_stock || 'Branch', count: 0, qty: 0, val: 0 };
      routeMap[rk].count++;
      routeMap[rk].qty += q;
      routeMap[rk].val += v;

      // Part aggregation
      const pk = r.product_code || 'UNKNOWN';
      if (!partMap[pk]) partMap[pk] = { code: pk, name: r.product_name || '', count: 0, qty: 0, val: 0 };
      partMap[pk].count++;
      partMap[pk].qty += q;
      partMap[pk].val += v;

      // Origin aggregation
      if (r.from_stock) {
        originMap[r.from_stock] = (originMap[r.from_stock] || 0) + q;
      }
      // Destination aggregation
      if (r.to_stock) {
        destMap[r.to_stock] = (destMap[r.to_stock] || 0) + q;
      }

      // Monthly trend
      if (r.transfer_received_date) {
        const mo = r.transfer_received_date.substring(0, 7); // YYYY-MM
        if (!monthMap[mo]) monthMap[mo] = { month: mo, qty: 0, val: 0, count: 0 };
        monthMap[mo].qty += q;
        monthMap[mo].val += v;
        monthMap[mo].count++;
      }
    });

    const allRoutes = Object.values(routeMap).sort((a, b) => b.qty - a.qty);
    const allParts  = Object.values(partMap).sort((a, b) => b.qty - a.qty);

    // Top N charts data
    const topRoutesChart = allRoutes.slice(0, 10).map(rt => ({
      name: formatRouteDisplayName(rt.from, rt.to),
      fullName: `${rt.from} → ${rt.to}`,
      from: rt.from,
      to: rt.to,
      qty: rt.qty,
      val: rt.val,
      count: rt.count
    }));

    const topPartsChart = allParts.slice(0, 10).map(p => ({
      name: p.code,
      label: p.name.length > 28 ? p.name.substring(0, 28) + '…' : p.name,
      qty: p.qty,
      val: p.val
    }));

    const topOriginsChart = Object.entries(originMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => ({ name: k, qty: v }));

    const topDestsChart = Object.entries(destMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => ({ name: k, qty: v }));

    const monthlyTrend = Object.values(monthMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, monthLabel: m.month }));

    // Commodity pie
    const commodityPie = [
      { name: 'Battery', value: battery, color: COMMODITY_COLORS.BATTERY },
      { name: 'Display', value: display, color: COMMODITY_COLORS.DISPLAY },
      { name: 'Camera', value: camera, color: COMMODITY_COLORS.CAMERA },
      { name: 'Other', value: other, color: COMMODITY_COLORS.OTHER }
    ].filter(d => d.value > 0).map(d => ({ ...d, pct: (d.value / (totalUnits || 1)) * 100 }));

    return {
      totalTransfers: filteredRecords.length,
      totalUnits, totalVal,
      battery, display, camera, other,
      uniqueOrigins: Object.keys(originMap).length,
      uniqueDests: Object.keys(destMap).length,
      allRoutes, allParts,
      topRoutesChart, topPartsChart,
      topOriginsChart, topDestsChart,
      monthlyTrend, commodityPie
    };
  }, [filteredRecords, parts]);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = pageSize === 'ALL' ? 1 : Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    if (pageSize === 'ALL') return filteredRecords;
    const s = (currentPage - 1) * pageSize;
    return filteredRecords.slice(s, s + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // ── Export Handlers ────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    if (!filteredRecords.length) { showToast('No records to export', 'warning'); return; }
    await exportStockTransfersToExcel(filteredRecords, stockTransferMetadata);
    showToast('Exported to Excel (.xlsx)', 'success');
  };
  const handleExportPDF = () => {
    if (!filteredRecords.length) { showToast('No records to export', 'warning'); return; }
    exportStockTransfersToPDF(filteredRecords, stockTransferMetadata);
  };
  const handlePrint = () => {
    if (!filteredRecords.length) { showToast('No records to print', 'warning'); return; }
    printStockTransfersDirect(filteredRecords, stockTransferMetadata);
  };



  // ── Empty drop zone ────────────────────────────────────────────────────────
  if (stockTransferReports.length === 0) {
    return (
      <div className="stock-transfers-view">
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />
        <HeaderBar {...{ isProcessing, filteredRecords, handleExportExcel, handleExportPDF, handlePrint,
          stockTransferMetadata, stockTransferReports, setShowClearConfirm, fileInputRef, isAutoRefreshing, autoRefreshData }} />
        <div
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          style={{
            textAlign: 'center', padding: '70px 20px',
            border: isDragging ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
            background: isDragging ? '#f0f9ff' : '#ffffff',
            borderRadius: '10px', transition: 'all 0.2s'
          }}
        >
          <div style={{ width: '68px', height: '68px', borderRadius: '50%', background: '#e0f2fe', color: '#0284c7',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '18px' }}>
            <UploadCloud size={34} />
          </div>
          <h3 style={{ fontSize: '19px', color: '#0f172a', fontWeight: 800, marginBottom: '10px' }}>
            Upload Fixably Stock Transfers Report
          </h3>
          <p style={{ fontSize: '13.5px', color: '#64748b', maxWidth: '500px', margin: '0 auto 22px', lineHeight: 1.6 }}>
            Drag &amp; drop <strong>"Reports – Stock Transfers.xlsx"</strong> or click to select. The report parses automatically and saves to the database.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              style={{ padding: '9px 24px', fontSize: '13px' }}
            >
              <UploadCloud size={16} /><span>Choose File to Import</span>
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => autoRefreshData({ force: true, silent: false, isManual: true, reason: 'Reports empty state sync', tables: ['saved_records'] })}
              disabled={isAutoRefreshing}
              style={{ padding: '9px 20px', fontSize: '13px' }}
            >
              <RefreshCw size={15} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing…' : 'Sync from Cloud'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Full dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="stock-transfers-view">
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />

      <HeaderBar {...{ isProcessing, filteredRecords, handleExportExcel, handleExportPDF, handlePrint,
        stockTransferMetadata, stockTransferReports, setShowClearConfirm, fileInputRef, isAutoRefreshing, autoRefreshData, canEdit, isReadOnly }} />

      {/* Clear Confirm Modal */}
      {showClearConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div className="card" style={{ maxWidth: '420px', width: '100%', padding: '26px', textAlign: 'center' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#fee2e2', color: '#ef4444',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <Trash2 size={24} />
            </div>
            <h3 style={{ fontSize: '17px', marginBottom: '10px' }}>Clear Report Data?</h3>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, marginBottom: '22px' }}>
              This will remove all active stock transfer records from the database. You can re-upload any time.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={async () => { await clearStockTransfersReport(); setShowClearConfirm(false); }}>
                Yes, Clear Report Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <KpiCards analytics={analytics} />

      {/* Filter + View Switcher */}
      <FilterBar
        viewMode={viewMode}
        setViewMode={setViewMode}
        setCurrentPage={setCurrentPage}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        fromFilter={fromFilter}
        setFromFilter={setFromFilter}
        uniqueFromStocks={uniqueFromStocks}
        toFilter={toFilter}
        setToFilter={setToFilter}
        uniqueToStocks={uniqueToStocks}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        analytics={analytics}
        pageSize={pageSize}
        setPageSize={setPageSize}
        filteredRecords={filteredRecords}
      />

      {/* ── OVERVIEW / CHARTS VIEW ── */}
      {viewMode === 'overview' && <ChartsView analytics={analytics} />}

      {/* ── LEDGER VIEW ── */}
      {viewMode === 'ledger' && (
        <LedgerView
          paginatedRecords={paginatedRecords}
          filteredRecords={filteredRecords}
          analytics={analytics}
          parts={parts}
          pageSize={pageSize}
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
        />
      )}

      {/* ── ROUTES VIEW ── */}
      {viewMode === 'routes' && <RoutesView analytics={analytics} />}

      {/* ── SITE-BY-PART MATRIX VIEW ── */}
      {viewMode === 'matrix' && <SitePartMatrixView filteredRecords={filteredRecords} />}

      {/* ── COURIER SHIPPING FEE TRACKER VIEW ── */}
      {viewMode === 'courier' && <CourierFeeView filteredRecords={filteredRecords} />}

      {/* ── PARTS VIEW ── */}
      {viewMode === 'parts' && <PartsView analytics={analytics} />}
    </div>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────────
function FilterBar({
  viewMode,
  setViewMode,
  setCurrentPage,
  searchQuery,
  setSearchQuery,
  fromFilter,
  setFromFilter,
  uniqueFromStocks,
  toFilter,
  setToFilter,
  uniqueToStocks,
  categoryFilter,
  setCategoryFilter,
  analytics,
  pageSize,
  setPageSize,
  filteredRecords
}) {
  return (
    <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
        {/* View tabs */}
        <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '6px', padding: '3px', border: '1px solid #e2e8f0' }}>
          {[
            { id: 'overview', label: '📊 Charts & Graphs' },
            { id: 'ledger',   label: '📋 Transfers Ledger' },
            { id: 'routes',   label: '🔁 Route Routes' },
            { id: 'matrix',   label: '🏢 Site-by-Part Matrix' },
            { id: 'courier',  label: '🚚 Courier Fee Tracker' },
            { id: 'parts',    label: '📦 Part Movers' }
          ].map(tab => (
            <button
              key={tab.id}
              className={`btn btn-sm ${viewMode === tab.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setViewMode(tab.id); setCurrentPage(1); }}
              style={{ border: 'none', fontSize: '11.5px', padding: '5px 12px', fontWeight: 600 }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search part #, serial, hub…"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            style={{ width: '100%', padding: '6px 10px 6px 28px', fontSize: '12px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
          />
        </div>

        {/* Filters */}
        {[
          { label: 'From:', value: fromFilter, onChange: v => { setFromFilter(v); setCurrentPage(1); },
            options: [{ value: 'ALL', label: `All Origins (${uniqueFromStocks.length})` }, ...uniqueFromStocks.map(s => ({ value: s, label: s }))] },
          { label: 'To:', value: toFilter, onChange: v => { setToFilter(v); setCurrentPage(1); },
            options: [{ value: 'ALL', label: `All Destinations (${uniqueToStocks.length})` }, ...uniqueToStocks.map(s => ({ value: s, label: s }))] },
          { label: 'Type:', value: categoryFilter, onChange: v => { setCategoryFilter(v); setCurrentPage(1); },
            options: [
              { value: 'ALL', label: 'All Commodities' },
              { value: 'BATTERY', label: `Battery (${analytics.battery})` },
              { value: 'DISPLAY', label: `Display (${analytics.display})` },
              { value: 'CAMERA', label: `Camera (${analytics.camera})` },
              { value: 'OTHER', label: `Other (${analytics.other})` }
            ] }
        ].map(({ label, value, onChange, options }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
            <span style={{ color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
            <select
              value={value}
              onChange={e => onChange(e.target.value)}
              style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #cbd5e1', maxWidth: '140px' }}
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ))}

        {/* Page size (ledger only) */}
        {viewMode === 'ledger' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>Show:</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)); setCurrentPage(1); }}
              style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
            >
              {[25, 50, 100, 250].map(n => <option key={n} value={n}>{n}</option>)}
              <option value="ALL">All ({filteredRecords.length})</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Header Bar ────────────────────────────────────────────────────────────────
function HeaderBar({ isProcessing, filteredRecords, handleExportExcel, handleExportPDF, handlePrint,
  stockTransferMetadata, stockTransferReports, setShowClearConfirm, fileInputRef, isAutoRefreshing, autoRefreshData, canEdit, isReadOnly }) {
  return (
    <div className="card" style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '8px', borderRadius: '8px', display: 'inline-flex' }}>
            <FileSpreadsheet size={24} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a', fontWeight: 800 }}>Fixably Stock Transfer Reports</h3>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Inter-branch &amp; service hub stock movement analytics — powered by Fixably data
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {autoRefreshData && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData({ force: true, silent: false, isManual: true, reason: 'Reports manual sync', tables: ['saved_records'] })}
              disabled={isAutoRefreshing}
              title="Sync latest stock transfers from cloud database"
              style={{ fontWeight: 600 }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing…' : 'Sync DB'}</span>
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={isProcessing} style={{ fontWeight: 700 }}>
              <UploadCloud size={14} /><span>{isProcessing ? 'Processing…' : 'Upload File (XLSX/CSV)'}</span>
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleExportExcel} disabled={!filteredRecords.length} style={{ fontWeight: 700, color: '#15803d', borderColor: '#86efac' }}>
            <Download size={13} /><span>Export Excel (XLSX)</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportPDF} disabled={!filteredRecords.length} style={{ fontWeight: 600, color: '#0284c7', borderColor: '#bae6fd' }}>
            <FileText size={13} /><span>PDF</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handlePrint} disabled={!filteredRecords.length}>
            <Printer size={13} /><span>Print</span>
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => downloadSampleStockTransfersTemplate('xlsx')}>
            <HelpCircle size={13} /><span>Template</span>
          </button>
          {canEdit && stockTransferReports.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowClearConfirm(true)}
              style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
              <Trash2 size={13} /><span>Clear</span>
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

      {stockTransferMetadata && stockTransferReports.length > 0 && (
        <div style={{ marginTop: '14px', padding: '9px 14px', background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: '6px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px',
              fontWeight: 700, fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={11} /> Saved in Database
            </span>
            <span style={{ color: '#334155', fontWeight: 600 }}>
              Active: <strong>{stockTransferMetadata.fileName || 'Reports – Stock Transfers.xlsx'}</strong>
            </span>
            <span style={{ color: '#64748b' }}>•</span>
            <span style={{ color: '#64748b' }}>
              {stockTransferMetadata.uploadedAt
                ? new Date(stockTransferMetadata.uploadedAt).toLocaleString() : 'System Default'}
            </span>
          </div>
          <div style={{ color: '#0369a1', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {stockTransferReports.length.toLocaleString()} records loaded
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function KpiCards({ analytics }) {
  return (
    <div className="matrix-kpi-grid" style={{ marginBottom: '20px' }}>
      {[
        { icon: Package, color: '#0284c7', bg: '#e0f2fe', label: 'Total Transfers', value: `${analytics.totalTransfers.toLocaleString()}`, sub: 'movement events' },
        { icon: Layers, color: '#334155', bg: '#f1f5f9', label: 'Total Units Moved', value: `${analytics.totalUnits.toLocaleString()}`, sub: 'physical units' },
        { icon: DollarSign, color: '#15803d', bg: '#dcfce7', label: 'Total Valuation', value: `$${analytics.totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: 'transfer value' },
        { icon: Building2, color: '#92400e', bg: '#fef3c7', label: 'Active Hubs', value: `${analytics.uniqueOrigins} → ${analytics.uniqueDests}`, sub: 'origins → destinations' }
      ].map(({ icon: Icon, color, bg, label, value, sub }) => (
        <div key={label} className="matrix-kpi-card">
          <div className="matrix-kpi-icon-wrap" style={{ background: bg, color }}><Icon size={22} /></div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>{label}</div>
            <div style={{ fontSize: '19px', fontWeight: 800, color, fontFamily: 'var(--font-mono)' }}>{value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Charts View ───────────────────────────────────────────────────────────────
function ChartsView({ analytics }) {
  const { topRoutesChart, topPartsChart, topOriginsChart, topDestsChart, monthlyTrend, commodityPie } = analytics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Row 1: Monthly Trend (full width) */}
      <div className="card" style={{ padding: '20px' }}>
        <ChartSectionHeading icon={Activity} title="Monthly Transfer Volume & Valuation Trend"
          subtitle="How stock movement frequency and value has changed over time" color="#0284c7" />
        {monthlyTrend.length >= 2 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={monthlyTrend} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradQty" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradVal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis yAxisId="qty" domain={[0, 'auto']} tick={{ fontSize: 11, fill: '#0284c7', fontWeight: 600 }} tickFormatter={v => v.toLocaleString()} />
              <YAxis yAxisId="val" orientation="right" domain={[0, 'auto']} tick={{ fontSize: 11, fill: '#10b981', fontWeight: 600 }}
                tickFormatter={formatCurrencyTick} />
              <Tooltip content={<CustomBarTooltip />} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: '12px', paddingBottom: '12px' }} />
              <Area yAxisId="qty" type="monotone" dataKey="qty" name="Units Transferred"
                stroke="#0284c7" fill="url(#gradQty)" strokeWidth={2.5} dot={{ r: 4, fill: '#0284c7' }} />
              <Area yAxisId="val" type="monotone" dataKey="val" name="Valuation ($)"
                stroke="#10b981" fill="url(#gradVal)" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <NoDataPlaceholder message="Not enough monthly data to show trend. Upload a file with multiple months of transfers." />
        )}
      </div>

      {/* Row 2: Commodity Pie + Top Origins Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '16px' }}>
        {/* Commodity distribution pie */}
        <div className="card" style={{ padding: '20px' }}>
          <ChartSectionHeading icon={PieIcon} title="Commodity Breakdown"
            subtitle="Units transferred by part type" color="#7c3aed" />
          {commodityPie.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={commodityPie} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                    paddingAngle={3} dataKey="value" nameKey="name">
                    {commodityPie.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="#fff" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '10px' }}>
                {commodityPie.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px' }}>
                    <div style={{ width: '11px', height: '11px', borderRadius: '50%', background: d.color }} />
                    <span style={{ fontWeight: 600, color: '#334155' }}>{d.name}</span>
                    <span style={{ color: '#64748b' }}>({d.pct.toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <NoDataPlaceholder message="No commodity data to display." />
          )}
        </div>

        {/* Top Origin Hubs */}
        <div className="card" style={{ padding: '20px' }}>
          <ChartSectionHeading icon={Building2} title="Top Sending Origins (by Volume)"
            subtitle="Which hubs are dispatching the most stock" color="#92400e" />
          {topOriginsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topOriginsChart} layout="vertical" margin={{ top: 0, right: 50, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#92400e', fontWeight: 700 }} width={110} />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="qty" name="Units Sent" radius={[0, 4, 4, 0]}>
                  {topOriginsChart.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <NoDataPlaceholder message="No origin data." />}
        </div>
      </div>

      {/* Row 3: Top Routes + Top Destinations */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Top Routes */}
        <div className="card" style={{ padding: '20px' }}>
          <ChartSectionHeading icon={ArrowRight} title="Top Transfer Routes (by Volume)"
            subtitle="Highest-traffic inter-hub movement paths" color="#0369a1" />
          {topRoutesChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topRoutesChart.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 50, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9.5, fill: '#0369a1', fontWeight: 700 }} width={130} />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="qty" name="Units Moved" radius={[0, 4, 4, 0]}>
                  {topRoutesChart.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={`hsl(${210 + i * 12}, 75%, ${52 - i * 3}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <NoDataPlaceholder message="No route data." />}
        </div>

        {/* Top Destination Hubs */}
        <div className="card" style={{ padding: '20px' }}>
          <ChartSectionHeading icon={TrendingUp} title="Top Receiving Destinations (by Volume)"
            subtitle="Which hubs are receiving the most stock" color="#15803d" />
          {topDestsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topDestsChart} layout="vertical" margin={{ top: 0, right: 50, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#15803d', fontWeight: 700 }} width={110} />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="qty" name="Units Received" radius={[0, 4, 4, 0]}>
                  {topDestsChart.map((_, i) => (
                    <Cell key={i} fill={`hsl(${145 + i * 8}, 68%, ${42 - i * 2}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <NoDataPlaceholder message="No destination data." />}
        </div>
      </div>

      {/* Row 4: Top Parts (full width column chart) */}
      <div className="card" style={{ padding: '20px' }}>
        <ChartSectionHeading icon={Package} title="Top 10 Transferred Parts (by Units)"
          subtitle="Highest-volume part numbers across all routes" color="#334155" />
        {topPartsChart.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={topPartsChart} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#0f172a', fontWeight: 700 }}
                angle={-30} textAnchor="end" interval={0} />
              <YAxis domain={[0, 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={v => v.toLocaleString()} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = topPartsChart.find(p => p.name === label);
                  return (
                    <div style={{ background: '#0f172a', color: '#fff', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', border: '1px solid #334155' }}>
                      <p style={{ fontWeight: 700, color: '#38bdf8', marginBottom: '4px' }}>{label}</p>
                      {d && <p style={{ color: '#94a3b8', fontSize: '11px', margin: '0 0 6px' }}>{d.label}</p>}
                      <p style={{ margin: '2px 0' }}>Units: <strong>{payload[0]?.value?.toLocaleString()}</strong></p>
                      {d && <p style={{ margin: '2px 0', color: '#34d399' }}>Value: <strong>${d.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="qty" name="Units" radius={[4, 4, 0, 0]}>
                {topPartsChart.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder message="No parts data." />}
      </div>

      {/* Row 5: Transfer Count vs Value Comparison */}
      <div className="card" style={{ padding: '20px' }}>
        <ChartSectionHeading icon={BarChart2} title="Top Routes — Quantity vs. Valuation Comparison"
          subtitle="Side-by-side view of units moved versus the dollar value transferred per route" color="#7c3aed" />
        {topRoutesChart.length > 0 ? (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={topRoutesChart.slice(0, 8)} margin={{ top: 15, right: 35, left: 15, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: '#334155', fontWeight: 600 }}
                angle={-25}
                textAnchor="end"
                interval={0}
                height={65}
              />
              <YAxis
                yAxisId="qty"
                domain={[0, 'auto']}
                tick={{ fontSize: 11, fill: '#0284c7', fontWeight: 600 }}
                tickFormatter={v => v.toLocaleString()}
              />
              <YAxis
                yAxisId="val"
                orientation="right"
                domain={[0, 'auto']}
                tick={{ fontSize: 11, fill: '#10b981', fontWeight: 600 }}
                tickFormatter={formatCurrencyTick}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ fontSize: '12px', paddingBottom: '16px' }}
              />
              <Bar yAxisId="qty" dataKey="qty" name="Units Moved" fill="#0284c7" radius={[4, 4, 0, 0]} barSize={22} />
              <Bar yAxisId="val" dataKey="val" name="Valuation ($)" fill="#10b981" radius={[4, 4, 0, 0]} barSize={22} />
            </BarChart>
          </ResponsiveContainer>
        ) : <NoDataPlaceholder message="No route data." />}
      </div>
    </div>
  );
}

// ── No Data Placeholder ────────────────────────────────────────────────────────
function NoDataPlaceholder({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: '13px' }}>
      <BarChart2 size={32} style={{ marginBottom: '10px', opacity: 0.35 }} />
      <p style={{ margin: 0 }}>{message}</p>
    </div>
  );
}

// ── Ledger View ───────────────────────────────────────────────────────────────
function LedgerView({ paginatedRecords, filteredRecords, analytics, parts, pageSize, currentPage, totalPages, setCurrentPage }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="matrix-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              {['#', 'Date', 'From Stock', 'To Stock', 'Part #', 'Product', 'Qty', 'Serial', 'Value'].map((h, i) => (
                <th key={h} style={{
                  background: i === 2 ? '#1e293b' : i === 3 ? '#1e293b' : i === 6 ? '#0284c7' : '#0f172a',
                  color: i === 2 ? '#fef3c7' : i === 3 ? '#dcfce7' : '#ffffff',
                  textAlign: [5, 8].includes(i) ? (i === 8 ? 'right' : 'left') : 'center',
                  width: [40, 100, 140, 140, 110, 220, 55, 160, 100][i]
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRecords.map((r, idx) => {
              const absIdx = pageSize === 'ALL' ? idx + 1 : (currentPage - 1) * pageSize + idx + 1;
              const isDisplay = (r.product_name || '').toLowerCase().includes('display');
              const isBattery = (r.product_name || '').toLowerCase().includes('battery');
              const rowVal = getRecordValuation(r, parts);
              return (
                <tr key={r.id || idx} style={{ background: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                  <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>{absIdx}</td>
                  <td style={{ textAlign: 'center', fontSize: '11px', color: '#475569' }}>{r.transfer_received_date || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#fef3c7', color: '#92400e' }}>{r.from_stock}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: '#dcfce7', color: '#15803d' }}>{r.to_stock}</span>
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '11.5px' }}>{r.product_code}</td>
                  <td style={{ textAlign: 'left', fontSize: '11.5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                        background: isDisplay ? '#e0f2fe' : isBattery ? '#dcfce7' : '#f1f5f9',
                        color: isDisplay ? '#0369a1' : isBattery ? '#15803d' : '#64748b' }}>
                        {isDisplay ? 'DISPLAY' : isBattery ? 'BATTERY' : 'PART'}
                      </span>
                      <span>{r.product_name}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', background: '#e0f2fe', color: '#0369a1', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{r.transfer_quantity || 1}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#334155' }}>{r.serial_number || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '11.5px', paddingRight: '10px', color: '#15803d' }}>
                    ${rowVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#0f172a', color: '#fff', fontWeight: 800 }}>
              <td colSpan={6} style={{ textAlign: 'right', padding: '10px 14px', fontSize: '12px' }}>
                TOTAL ({filteredRecords.length.toLocaleString()} records):
              </td>
              <td style={{ textAlign: 'center', background: '#0284c7', fontFamily: 'var(--font-mono)' }}>{analytics.totalUnits.toLocaleString()}</td>
              <td />
              <td style={{ textAlign: 'right', color: '#38bdf8', fontFamily: 'var(--font-mono)', paddingRight: '10px' }}>
                ${analytics.totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {pageSize !== 'ALL' && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 18px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '12px' }}>
          <span style={{ color: '#64748b' }}>
            Showing <strong>{(currentPage - 1) * pageSize + 1}</strong>–<strong>{Math.min(currentPage * pageSize, filteredRecords.length)}</strong> of <strong>{filteredRecords.length.toLocaleString()}</strong>
          </span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} style={{ padding: '4px 10px' }}>
              <ChevronLeft size={13} /><span>Prev</span>
            </button>
            <span style={{ fontWeight: 700, padding: '0 8px' }}>Page {currentPage} / {totalPages}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} style={{ padding: '4px 10px' }}>
              <span>Next</span><ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Routes View ───────────────────────────────────────────────────────────────
function RoutesView({ analytics }) {
  const { allRoutes, totalUnits, totalVal } = analytics;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="matrix-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 50, textAlign: 'center', background: '#0f172a', color: '#fff' }}>#</th>
              <th style={{ width: 220, background: '#0f172a', color: '#fef3c7' }}>From Stock</th>
              <th style={{ width: 40, textAlign: 'center', background: '#0f172a', color: '#94a3b8' }}>→</th>
              <th style={{ width: 220, background: '#0f172a', color: '#dcfce7' }}>To Stock</th>
              <th style={{ textAlign: 'center', background: '#0f172a', color: '#fff' }}>Events</th>
              <th style={{ textAlign: 'center', background: '#0284c7', color: '#fff' }}>Units Moved</th>
              <th style={{ textAlign: 'right', background: '#0f172a', color: '#fff' }}>Valuation</th>
            </tr>
          </thead>
          <tbody>
            {allRoutes.map((rt, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>{i + 1}</td>
                <td><span style={{ fontSize: '11.5px', fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '4px' }}>{rt.from}</span></td>
                <td style={{ textAlign: 'center' }}><ArrowRight size={13} color="#94a3b8" /></td>
                <td><span style={{ fontSize: '11.5px', fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px' }}>{rt.to}</span></td>
                <td style={{ textAlign: 'center', color: '#475569', fontFamily: 'var(--font-mono)' }}>{rt.count} transfers</td>
                <td style={{ textAlign: 'center', background: '#e0f2fe', color: '#0369a1', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{rt.qty.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: '#15803d', fontWeight: 700, fontFamily: 'var(--font-mono)', paddingRight: '10px' }}>
                  ${rt.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#0f172a', color: '#fff', fontWeight: 800 }}>
              <td colSpan={4} style={{ textAlign: 'right', padding: '10px 14px', fontSize: '12px' }}>TOTAL ({allRoutes.length} distinct routes):</td>
              <td style={{ textAlign: 'center' }}>{allRoutes.reduce((s, r) => s + r.count, 0)}</td>
              <td style={{ textAlign: 'center', background: '#0284c7' }}>{totalUnits.toLocaleString()}</td>
              <td style={{ textAlign: 'right', color: '#38bdf8', paddingRight: '10px' }}>
                ${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Parts View ────────────────────────────────────────────────────────────────
function PartsView({ analytics }) {
  const { allParts, totalUnits, totalVal } = analytics;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="matrix-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 50, textAlign: 'center', background: '#0f172a', color: '#fff' }}>#</th>
              <th style={{ width: 130, textAlign: 'center', background: '#0f172a', color: '#fff' }}>Part #</th>
              <th style={{ minWidth: 240, background: '#0f172a', color: '#fff' }}>Description</th>
              <th style={{ textAlign: 'center', background: '#0f172a', color: '#fff' }}>Events</th>
              <th style={{ textAlign: 'center', background: '#0284c7', color: '#fff' }}>Units</th>
              <th style={{ textAlign: 'right', background: '#0f172a', color: '#fff' }}>Valuation</th>
            </tr>
          </thead>
          <tbody>
            {allParts.map((p, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>{i + 1}</td>
                <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{p.code}</td>
                <td style={{ fontSize: '12px' }}>{p.name}</td>
                <td style={{ textAlign: 'center', color: '#475569', fontFamily: 'var(--font-mono)' }}>{p.count}</td>
                <td style={{ textAlign: 'center', background: '#e0f2fe', color: '#0369a1', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{p.qty.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: '#15803d', fontWeight: 700, fontFamily: 'var(--font-mono)', paddingRight: '10px' }}>
                  ${p.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#0f172a', color: '#fff', fontWeight: 800 }}>
              <td colSpan={3} style={{ textAlign: 'right', padding: '10px 14px', fontSize: '12px' }}>TOTAL ({allParts.length} parts):</td>
              <td style={{ textAlign: 'center' }}>{allParts.reduce((s, p) => s + p.count, 0)}</td>
              <td style={{ textAlign: 'center', background: '#0284c7' }}>{totalUnits.toLocaleString()}</td>
              <td style={{ textAlign: 'right', color: '#38bdf8', paddingRight: '10px' }}>
                ${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Site-by-Part Matrix View ──────────────────────────────────────────────────
function SitePartMatrixView({ filteredRecords }) {
  const { matrixData, siteColumns } = useMemo(() => {
    const sitesSet = new Set();
    const partMap = {};

    filteredRecords.forEach(r => {
      const dest = r.to_stock || 'Unknown';
      const pCode = r.product_code || 'Unknown';
      const pName = r.product_name || '';
      const qty = Number(r.transfer_quantity) || 1;

      sitesSet.add(dest);

      if (!partMap[pCode]) {
        partMap[pCode] = {
          code: pCode,
          name: pName,
          totalQty: 0,
          sites: {}
        };
      }
      partMap[pCode].totalQty += qty;
      partMap[pCode].sites[dest] = (partMap[pCode].sites[dest] || 0) + qty;
    });

    const siteColumns = Array.from(sitesSet).sort();
    const matrixData = Object.values(partMap).sort((a, b) => b.totalQty - a.totalQty);

    return { matrixData, siteColumns };
  }, [filteredRecords]);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
      <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Site-by-Part Transfer Matrix</h4>
        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
          Cross-tabulation of parts dispatched to each receiving service branch ({siteColumns.length} receiving hubs)
        </p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="matrix-table" style={{ width: '100%', fontSize: '11.5px' }}>
          <thead>
            <tr>
              <th style={{ width: 45, textAlign: 'center', background: '#0f172a', color: '#fff' }}>#</th>
              <th style={{ width: 120, background: '#0f172a', color: '#fff' }}>Part Number</th>
              <th style={{ minWidth: 200, background: '#0f172a', color: '#fff' }}>Description</th>
              <th style={{ width: 75, textAlign: 'center', background: '#0284c7', color: '#fff' }}>Total</th>
              {siteColumns.map(site => (
                <th key={site} style={{ textAlign: 'center', minWidth: '90px', background: '#1e293b', color: '#f8fafc' }}>
                  {site.replace(/_MSPI-Owned|SERVICE_HUB/gi, '').trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixData.map((row, idx) => (
              <tr key={row.code} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                <td style={{ textAlign: 'center', color: '#94a3b8' }}>{idx + 1}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0284c7' }}>{row.code}</td>
                <td style={{ fontWeight: 600, color: '#1e293b' }}>{row.name}</td>
                <td style={{ textAlign: 'center', background: '#e0f2fe', color: '#0369a1', fontWeight: 800 }}>{row.totalQty}</td>
                {siteColumns.map(site => {
                  const val = row.sites[site] || 0;
                  return (
                    <td key={site} style={{
                      textAlign: 'center',
                      fontWeight: val > 0 ? 700 : 400,
                      color: val > 0 ? '#0f172a' : '#cbd5e1',
                      background: val > 0 ? '#f0fdf4' : 'transparent'
                    }}>
                      {val > 0 ? val : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Courier Delivery Fee Tracker ──────────────────────────────────────────────
function CourierFeeView({ filteredRecords }) {
  const courierStats = useMemo(() => {
    let totalShipments = filteredRecords.length;
    let mmShipments = 0;
    let provShipments = 0;
    const branchBreakdown = {};

    filteredRecords.forEach(r => {
      const dest = r.to_stock || 'Unknown';
      const isProv = /cebu|davao|iloilo|bacolod|pampanga|clark|baguio|dagupan|lipa|batangas|palawan|gensan|cagayan/i.test(dest);
      const feePHP = isProv ? 350 : 180; // Flat estimate: ₱180 NCR, ₱350 Provincial
      const feeUSD = feePHP / 57;

      if (isProv) provShipments++;
      else mmShipments++;

      if (!branchBreakdown[dest]) {
        branchBreakdown[dest] = {
          name: dest,
          isProv,
          shipments: 0,
          totalFeePHP: 0,
          totalFeeUSD: 0,
          units: 0
        };
      }
      branchBreakdown[dest].shipments += 1;
      branchBreakdown[dest].totalFeePHP += feePHP;
      branchBreakdown[dest].totalFeeUSD += feeUSD;
      branchBreakdown[dest].units += (Number(r.transfer_quantity) || 1);
    });

    const totalFeePHP = (mmShipments * 180) + (provShipments * 350);
    const totalFeeUSD = totalFeePHP / 57;

    return {
      totalShipments,
      mmShipments,
      provShipments,
      totalFeePHP,
      totalFeeUSD,
      branchList: Object.values(branchBreakdown).sort((a, b) => b.totalFeePHP - a.totalFeePHP)
    };
  }, [filteredRecords]);

  return (
    <div className="card" style={{ padding: '20px', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
        <div style={{ background: '#0284c71a', color: '#0284c7', padding: '8px', borderRadius: '8px' }}>
          <Package size={20} />
        </div>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>Courier Delivery & Shipping Fee Tracker</h4>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
            Estimated courier dispatch fees per service hub transfer (Metro Manila: ₱180/pkg • Provincial: ₱350/pkg)
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Total Transfer Dispatches</span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
            {courierStats.totalShipments.toLocaleString()} <span style={{ fontSize: '12px', color: '#64748b' }}>events</span>
          </div>
        </div>

        <div style={{ padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#1d4ed8', textTransform: 'uppercase' }}>Metro Manila Dispatches</span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1e40af', marginTop: '4px' }}>
            {courierStats.mmShipments.toLocaleString()} <span style={{ fontSize: '12px', color: '#1d4ed8' }}>@ ₱180</span>
          </div>
        </div>

        <div style={{ padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#166534', textTransform: 'uppercase' }}>Provincial Dispatches</span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
            {courierStats.provShipments.toLocaleString()} <span style={{ fontSize: '12px', color: '#166534' }}>@ ₱350</span>
          </div>
        </div>

        <div style={{ padding: '14px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#991b1b', textTransform: 'uppercase' }}>Est. Total Shipping Fees</span>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626', marginTop: '4px' }}>
            ₱{courierStats.totalFeePHP.toLocaleString()} <span style={{ fontSize: '12px', color: '#991b1b' }}>(${(courierStats.totalFeeUSD).toFixed(2)})</span>
          </div>
        </div>
      </div>

      <div className="table-responsive" style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#0f172a', color: '#fff', height: '34px' }}>
              <th style={{ padding: '6px 12px', textAlign: 'left' }}>Destination Hub</th>
              <th style={{ padding: '6px 12px', textAlign: 'center' }}>Region Tier</th>
              <th style={{ padding: '6px 12px', textAlign: 'center' }}>Shipments Count</th>
              <th style={{ padding: '6px 12px', textAlign: 'center' }}>Total Units</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Est. Courier Cost (PHP)</th>
              <th style={{ padding: '6px 12px', textAlign: 'right' }}>Est. Courier Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {courierStats.branchList.map(b => (
              <tr key={b.name} style={{ borderBottom: '1px solid #f1f5f9', height: '34px' }}>
                <td style={{ padding: '6px 12px', fontWeight: 700, color: '#0f172a' }}>{b.name}</td>
                <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                    background: b.isProv ? '#fef3c7' : '#e0f2fe',
                    color: b.isProv ? '#92400e' : '#0369a1'
                  }}>
                    {b.isProv ? 'Provincial (₱350)' : 'Metro Manila (₱180)'}
                  </span>
                </td>
                <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700 }}>{b.shipments}</td>
                <td style={{ padding: '6px 12px', textAlign: 'center', fontWeight: 700, color: '#0284c7' }}>{b.units}</td>
                <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 800, color: '#15803d' }}>
                  ₱{b.totalFeePHP.toLocaleString()}
                </td>
                <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>
                  ${b.totalFeeUSD.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
