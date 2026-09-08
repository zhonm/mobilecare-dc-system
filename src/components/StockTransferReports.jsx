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
  Activity,
  RefreshCw,
  ChevronDown,
  MapPin,
  Truck,
  Sparkles,
  Boxes,
  ArrowUpRight,
  ShieldCheck,
  Zap
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
      .replace(/[-_]MSPI[-_]Owned/gi, ' (MSPI)')
      .replace(/MSPI[-_]Owned/gi, ' (MSPI)')
      .replace(/\(APP\)[-_]MSPI[-_]Owned/gi, 'APP')
      .replace(/[-_]SERVICE[-_]HUB/gi, ' Service Hub')
      .replace(/SERVICE[-_]HUB/gi, ' Service Hub')
      .replace(/DC[-_]MSPI/gi, 'DC')
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
  }, [autoRefreshData, importStockTransfersReport, stockTransferReports]);

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
    let batteryVal = 0, displayVal = 0, cameraVal = 0, otherVal = 0;
    const routeMap = {};
    const partMap = {};
    const originMap = {};
    const destMap = {};
    const monthMap = {};
    let mmShipments = 0, provShipments = 0;

    filteredRecords.forEach(r => {
      const q = Number(r.transfer_quantity) || 1;
      const v = getRecordValuation(r, parts);
      const desc = (r.product_name || '').toLowerCase();
      totalUnits += q;
      totalVal += v;

      if (desc.includes('battery')) {
        battery += q;
        batteryVal += v;
      } else if (desc.includes('display') || desc.includes('screen')) {
        display += q;
        displayVal += v;
      } else if (desc.includes('camera')) {
        camera += q;
        cameraVal += v;
      } else {
        other += q;
        otherVal += v;
      }

      // Regional courier classification
      const dest = r.to_stock || 'Unknown';
      const isProv = /(cebu|davao|iloilo|bacolod|pampanga|clark|baguio|dagupan|lipa|batangas|palawan|gensan|cagayan|laoag|naga|legazpi|tarlac|subic|marilao|cabanatuan|lucena|roxas|tacloban|butuan|tagum|zamboanga|newpoint|nep|lanang|lima|la union|\b(ceb|dav|ilo|bac|pam|cla|bag|dag|lip|bat|pal|gen|cdo)\b)/i.test(dest);
      if (isProv) provShipments++;
      else mmShipments++;

      // Route aggregation
      const rk = `${r.from_stock || 'DC'} → ${r.to_stock || 'Branch'}`;
      if (!routeMap[rk]) routeMap[rk] = { from: r.from_stock || 'DC', to: r.to_stock || 'Branch', count: 0, qty: 0, val: 0 };
      routeMap[rk].count++;
      routeMap[rk].qty += q;
      routeMap[rk].val += v;

      // Part aggregation
      const pk = r.product_code || 'UNKNOWN';
      if (!partMap[pk]) partMap[pk] = {
        code: pk,
        name: r.product_name || '',
        category: desc.includes('battery') ? 'BATTERY' : (desc.includes('display') || desc.includes('screen')) ? 'DISPLAY' : desc.includes('camera') ? 'CAMERA' : 'OTHER',
        count: 0,
        qty: 0,
        val: 0
      };
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

    const totalTransfers = filteredRecords.length;
    const totalValPHP = totalVal * 57;

    // Courier fee estimates
    const totalFeePHP = (mmShipments * 180) + (provShipments * 350);
    const totalFeeUSD = totalFeePHP / 57;
    const mmPct = totalTransfers > 0 ? (mmShipments / totalTransfers) * 100 : 0;
    const provPct = totalTransfers > 0 ? (provShipments / totalTransfers) * 100 : 0;

    // Top N charts data
    const topRoutesChart = allRoutes.slice(0, 10).map(rt => ({
      name: formatRouteDisplayName(rt.from, rt.to),
      fullName: `${rt.from} → ${rt.to}`,
      from: rt.from,
      to: rt.to,
      qty: rt.qty,
      val: rt.val,
      count: rt.count,
      pctOfTotal: totalUnits > 0 ? (rt.qty / totalUnits) * 100 : 0
    }));

    const topPartsChart = allParts.slice(0, 10).map(p => ({
      name: p.code,
      label: p.name.length > 28 ? p.name.substring(0, 28) + '…' : p.name,
      fullName: p.name,
      category: p.category,
      qty: p.qty,
      val: p.val,
      pctOfTotal: totalUnits > 0 ? (p.qty / totalUnits) * 100 : 0
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

    // Commodity pie & breakdown
    const commodityPie = [
      { name: 'Battery', value: battery, val: batteryVal, color: COMMODITY_COLORS.BATTERY },
      { name: 'Display', value: display, val: displayVal, color: COMMODITY_COLORS.DISPLAY },
      { name: 'Camera', value: camera, val: cameraVal, color: COMMODITY_COLORS.CAMERA },
      { name: 'Other', value: other, val: otherVal, color: COMMODITY_COLORS.OTHER }
    ].filter(d => d.value > 0).map(d => ({
      ...d,
      pct: (d.value / (totalUnits || 1)) * 100,
      valPct: (d.val / (totalVal || 1)) * 100
    }));

    // Operational dynamic insights
    const topOrigin = topOriginsChart[0] ? topOriginsChart[0].name : 'Primary DC';
    const topOriginQty = topOriginsChart[0] ? topOriginsChart[0].qty : 0;
    const topOriginPct = topOriginsChart[0] && totalUnits > 0 ? ((topOriginsChart[0].qty / totalUnits) * 100).toFixed(1) : '0';
    const topDest = topDestsChart[0] ? topDestsChart[0].name : 'Branch Hub';
    const topDestQty = topDestsChart[0] ? topDestsChart[0].qty : 0;
    const topDestPct = topDestsChart[0] && totalUnits > 0 ? ((topDestsChart[0].qty / totalUnits) * 100).toFixed(1) : '0';
    const dominantCommodity = commodityPie.slice().sort((a, b) => b.value - a.value)[0];

    return {
      totalTransfers,
      totalUnits,
      totalVal,
      totalValPHP,
      battery, display, camera, other,
      batteryVal, displayVal, cameraVal, otherVal,
      uniqueOrigins: Object.keys(originMap).length,
      uniqueDests: Object.keys(destMap).length,
      allRoutes,
      allParts,
      topRoutesChart,
      topPartsChart,
      topOriginsChart,
      topDestsChart,
      monthlyTrend,
      commodityPie,
      mmShipments,
      provShipments,
      totalFeePHP,
      totalFeeUSD,
      mmPct,
      provPct,
      topOrigin,
      topOriginQty,
      topOriginPct,
      topDest,
      topDestQty,
      topDestPct,
      dominantCommodity
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
  const isFiltered = filteredRecords.length < stockTransferReports.length;

  const handleExportExcel = async (scope = 'all') => {
    const recordsToExport = (scope === 'filtered' && isFiltered) ? filteredRecords : stockTransferReports;
    if (!recordsToExport.length) { showToast('No records to export', 'warning'); return; }
    await exportStockTransfersToExcel(recordsToExport, stockTransferMetadata);
    showToast(
      scope === 'filtered'
        ? `Exported filtered view (${recordsToExport.length} transfers) to Excel`
        : `Exported comprehensive report (${recordsToExport.length} transfers, 4 sheets) to Excel`,
      'success'
    );
  };

  const handleExportPDF = (scope = 'all') => {
    const recordsToExport = (scope === 'filtered' && isFiltered) ? filteredRecords : stockTransferReports;
    if (!recordsToExport.length) { showToast('No records to export', 'warning'); return; }
    exportStockTransfersToPDF(recordsToExport, stockTransferMetadata);
    showToast(
      scope === 'filtered'
        ? `Exported filtered PDF (${recordsToExport.length} transfers)`
        : `Exported comprehensive PDF (${recordsToExport.length} transfers)`,
      'success'
    );
  };

  const handlePrint = (scope = 'all') => {
    const recordsToExport = (scope === 'filtered' && isFiltered) ? filteredRecords : stockTransferReports;
    if (!recordsToExport.length) { showToast('No records to print', 'warning'); return; }
    printStockTransfersDirect(recordsToExport, stockTransferMetadata);
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

      {/* ── 1. EXECUTIVE SUMMARY VIEW (DEFAULT) ── */}
      {viewMode === 'overview' && (
        <ExecutiveSummaryView analytics={analytics} setViewMode={setViewMode} />
      )}

      {/* ── 2. TRANSFERS LEDGER VIEW ── */}
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

      {/* ── 3. ROUTE ANALYTICS VIEW ── */}
      {viewMode === 'routes' && <RoutesView analytics={analytics} />}

      {/* ── 4. BRANCH MATRIX & COURIERS VIEW ── */}
      {viewMode === 'matrix' && <BranchMatrixCouriersView filteredRecords={filteredRecords} />}
    </div>
  );
}

// ── Filter & Navigation Bar ───────────────────────────────────────────────────
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
    <div className="card" style={{ padding: '12px 16px', marginBottom: '18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Primary Row: Tab Pills & Quick Search */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* View Tabs */}
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '3px', border: '1px solid #e2e8f0', gap: '2px' }}>
            {[
              { id: 'overview', label: 'Executive Summary', icon: Sparkles },
              { id: 'ledger',   label: 'Transfers Ledger', icon: FileText },
              { id: 'routes',   label: 'Route Analytics', icon: TrendingUp },
              { id: 'matrix',   label: 'Branch Matrix & Couriers', icon: Building2 }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = viewMode === tab.id;
              return (
                <button
                  key={tab.id}
                  className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setViewMode(tab.id); setCurrentPage(1); }}
                  style={{
                    border: 'none',
                    fontSize: '12px',
                    padding: '6px 14px',
                    fontWeight: isActive ? 700 : 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: '6px'
                  }}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Search */}
          <div style={{ position: 'relative', width: '280px', minWidth: '220px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search part #, serial, hub…"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: '12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        {/* Secondary Row: Commodity Pills & Hub Selects */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
          {/* Commodity Category Segmented Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Commodity:</span>
            <div style={{ display: 'flex', background: '#f8fafc', padding: '2px', borderRadius: '6px', border: '1px solid #e2e8f0', gap: '2px' }}>
              {[
                { id: 'ALL', label: 'All Items' },
                { id: 'BATTERY', label: `Battery (${analytics.battery})` },
                { id: 'DISPLAY', label: `Display (${analytics.display})` },
                { id: 'CAMERA', label: `Camera (${analytics.camera})` },
                { id: 'OTHER', label: `Other (${analytics.other})` }
              ].map(cat => {
                const isSelected = categoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => { setCategoryFilter(cat.id); setCurrentPage(1); }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: isSelected ? 700 : 500,
                      borderRadius: '4px',
                      border: 'none',
                      background: isSelected ? '#0284c7' : 'transparent',
                      color: isSelected ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hub Selects & Page Size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>From:</span>
              <select
                value={fromFilter}
                onChange={e => { setFromFilter(e.target.value); setCurrentPage(1); }}
                style={{ padding: '4px 8px', fontSize: '11.5px', borderRadius: '4px', border: '1px solid #cbd5e1', maxWidth: '140px' }}
              >
                <option value="ALL">All Origins ({uniqueFromStocks.length})</option>
                {uniqueFromStocks.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>To:</span>
              <select
                value={toFilter}
                onChange={e => { setToFilter(e.target.value); setCurrentPage(1); }}
                style={{ padding: '4px 8px', fontSize: '11.5px', borderRadius: '4px', border: '1px solid #cbd5e1', maxWidth: '140px' }}
              >
                <option value="ALL">All Hubs ({uniqueToStocks.length})</option>
                {uniqueToStocks.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Page size (ledger view only) */}
            {viewMode === 'ledger' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
                <span style={{ color: '#64748b' }}>Show:</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)); setCurrentPage(1); }}
                  style={{ padding: '4px 8px', fontSize: '11.5px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                >
                  {[25, 50, 100, 250].map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="ALL">All ({filteredRecords.length})</option>
                </select>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Header Bar ────────────────────────────────────────────────────────────────
function HeaderBar({ isProcessing, filteredRecords, handleExportExcel, handleExportPDF, handlePrint,
  stockTransferMetadata, stockTransferReports, setShowClearConfirm, fileInputRef, isAutoRefreshing, autoRefreshData, canEdit, isReadOnly }) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const isFiltered = filteredRecords.length < stockTransferReports.length;

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', position: 'relative' }}>
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

          {/* Export Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!stockTransferReports.length}
              style={{ fontWeight: 700, color: '#15803d', borderColor: '#86efac', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Export Stock Transfers"
            >
              <Download size={13} />
              <span>Export &amp; Share</span>
              <ChevronDown size={12} style={{ transform: showExportMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
            </button>

            {showExportMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  width: '280px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                  zIndex: 100,
                  overflow: 'hidden',
                  padding: '6px'
                }}
              >
                <div style={{ padding: '4px 10px 6px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Complete Dataset ({stockTransferReports.length.toLocaleString()} Transfers)
                </div>

                <button
                  type="button"
                  onClick={() => { setShowExportMenu(false); handleExportExcel('all'); }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    background: 'none',
                    border: 'none',
                    borderRadius: '6px',
                    textAlign: 'left',
                    fontSize: '12.5px',
                    color: '#0f172a',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0fdf4'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <FileSpreadsheet size={16} color="#15803d" />
                  <div>
                    <div>Export Master Workbook (.xlsx)</div>
                    <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 400 }}>4 sheets: Ledger, routes, parts, timeline</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setShowExportMenu(false); handleExportPDF('all'); }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    background: 'none',
                    border: 'none',
                    borderRadius: '6px',
                    textAlign: 'left',
                    fontSize: '12.5px',
                    color: '#0f172a',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f9ff'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <Download size={16} color="#0284c7" />
                  <div>
                    <div>Download Complete PDF (.pdf)</div>
                    <div style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 400 }}>All records across multi-page document</div>
                  </div>
                </button>

                {isFiltered && (
                  <>
                    <div style={{ height: '1px', background: '#e2e8f0', margin: '6px 0' }} />
                    <div style={{ padding: '4px 10px 4px', fontSize: '10px', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Active Filter ({filteredRecords.length.toLocaleString()} of {stockTransferReports.length.toLocaleString()} Transfers)
                    </div>

                    <button
                      type="button"
                      onClick={() => { setShowExportMenu(false); handleExportExcel('filtered'); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '6px 10px',
                        background: 'none',
                        border: 'none',
                        borderRadius: '6px',
                        textAlign: 'left',
                        fontSize: '12px',
                        color: '#334155',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fffbeb'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <FileSpreadsheet size={14} color="#d97706" />
                      <span>Export Filtered Ledger (.xlsx)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setShowExportMenu(false); handleExportPDF('filtered'); }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '6px 10px',
                        background: 'none',
                        border: 'none',
                        borderRadius: '6px',
                        textAlign: 'left',
                        fontSize: '12px',
                        color: '#334155',
                        fontWeight: 500,
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fffbeb'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <Download size={14} color="#d97706" />
                      <span>Download Filtered PDF (.pdf)</span>
                    </button>
                  </>
                )}

                <div style={{ height: '1px', background: '#e2e8f0', margin: '6px 0' }} />

                <button
                  type="button"
                  onClick={() => { setShowExportMenu(false); handlePrint(isFiltered ? 'filtered' : 'all'); }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '7px 10px',
                    background: 'none',
                    border: 'none',
                    borderRadius: '6px',
                    textAlign: 'left',
                    fontSize: '12px',
                    color: '#475569',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <Printer size={14} color="#475569" />
                  <span>Print Report ({isFiltered ? `${filteredRecords.length} Filtered` : 'All'})</span>
                </button>
              </div>
            )}
          </div>

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

// ── Hero KPI Cards ────────────────────────────────────────────────────────────
function KpiCards({ analytics }) {
  return (
    <div className="matrix-kpi-grid" style={{ marginBottom: '20px' }}>
      {[
        {
          icon: Package,
          color: '#0284c7',
          bg: '#e0f2fe',
          label: 'Total Stock Transfers',
          value: `${analytics.totalTransfers.toLocaleString()}`,
          sub: 'inter-hub movement events'
        },
        {
          icon: Layers,
          color: '#4338ca',
          bg: '#e0e7ff',
          label: 'Physical Units Moved',
          value: `${analytics.totalUnits.toLocaleString()}`,
          sub: analytics.totalTransfers > 0 ? `Avg ${(analytics.totalUnits / analytics.totalTransfers).toFixed(2)} units / transfer` : 'transferred stock'
        },
        {
          icon: DollarSign,
          color: '#15803d',
          bg: '#dcfce7',
          label: 'Total Valuation',
          value: `$${analytics.totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          sub: `≈ ₱${analytics.totalValPHP.toLocaleString(undefined, { maximumFractionDigits: 0 })} (est. PHP)`
        },
        {
          icon: Building2,
          color: '#92400e',
          bg: '#fef3c7',
          label: 'Logistics Hub Network',
          value: `${analytics.uniqueOrigins} → ${analytics.uniqueDests}`,
          sub: 'origins → receiving hubs'
        }
      ].map(({ icon: Icon, color, bg, label, value, sub }) => (
        <div key={label} className="matrix-kpi-card" style={{ transition: 'all 0.2s ease', border: '1px solid #e2e8f0' }}>
          <div className="matrix-kpi-icon-wrap" style={{ background: bg, color }}><Icon size={22} /></div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>{label}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>{value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 1. EXECUTIVE SUMMARY VIEW ─────────────────────────────────────────────────
function ExecutiveSummaryView({ analytics, setViewMode }) {
  const {
    totalUnits,
    battery, display, camera, other,
    batteryVal, displayVal, cameraVal, otherVal,
    topRoutesChart,
    topPartsChart,
    mmShipments,
    provShipments,
    totalFeePHP,
    totalFeeUSD,
    mmPct,
    provPct,
    topOrigin,
    topOriginQty,
    topOriginPct,
    topDest,
    topDestQty,
    topDestPct,
    dominantCommodity
  } = analytics;

  const bPct = totalUnits > 0 ? (battery / totalUnits) * 100 : 0;
  const dPct = totalUnits > 0 ? (display / totalUnits) * 100 : 0;
  const cPct = totalUnits > 0 ? (camera / totalUnits) * 100 : 0;
  const oPct = totalUnits > 0 ? (other / totalUnits) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Section A: Visual Commodity Volume & Valuation Distribution ── */}
      <div className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
          <ChartSectionHeading
            icon={Boxes}
            title="Commodity Volume & Valuation Distribution"
            subtitle="Breakdown of physical units and inventory valuation transferred across core parts families"
            color="#0284c7"
          />
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', background: '#e0f2fe', color: '#0369a1' }}>
            {totalUnits.toLocaleString()} Total Units Transferred
          </span>
        </div>

        {/* Stacked Segmented Horizontal Bar */}
        <div style={{
          width: '100%',
          height: '24px',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          background: '#f1f5f9',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
          marginBottom: '16px'
        }}>
          {battery > 0 && (
            <div
              style={{
                width: `${bPct}%`,
                background: COMMODITY_COLORS.BATTERY,
                height: '100%',
                transition: 'width 0.4s ease'
              }}
              title={`Battery: ${battery.toLocaleString()} units (${bPct.toFixed(1)}%)`}
            />
          )}
          {display > 0 && (
            <div
              style={{
                width: `${dPct}%`,
                background: COMMODITY_COLORS.DISPLAY,
                height: '100%',
                transition: 'width 0.4s ease'
              }}
              title={`Display: ${display.toLocaleString()} units (${dPct.toFixed(1)}%)`}
            />
          )}
          {camera > 0 && (
            <div
              style={{
                width: `${cPct}%`,
                background: COMMODITY_COLORS.CAMERA,
                height: '100%',
                transition: 'width 0.4s ease'
              }}
              title={`Camera: ${camera.toLocaleString()} units (${cPct.toFixed(1)}%)`}
            />
          )}
          {other > 0 && (
            <div
              style={{
                width: `${oPct}%`,
                background: COMMODITY_COLORS.OTHER,
                height: '100%',
                transition: 'width 0.4s ease'
              }}
              title={`Other: ${other.toLocaleString()} units (${oPct.toFixed(1)}%)`}
            />
          )}
        </div>

        {/* 4 Commodity Legend / Stat Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {[
            {
              name: 'Battery Assemblies',
              count: battery,
              pct: bPct,
              val: batteryVal,
              color: COMMODITY_COLORS.BATTERY,
              bg: '#f0fdf4',
              border: '#bbf7d0'
            },
            {
              name: 'Display Panels',
              count: display,
              pct: dPct,
              val: displayVal,
              color: COMMODITY_COLORS.DISPLAY,
              bg: '#f0f9ff',
              border: '#bae6fd'
            },
            {
              name: 'Camera Modules',
              count: camera,
              pct: cPct,
              val: cameraVal,
              color: COMMODITY_COLORS.CAMERA,
              bg: '#faf5ff',
              border: '#e9d5ff'
            },
            {
              name: 'Other Components',
              count: other,
              pct: oPct,
              val: otherVal,
              color: COMMODITY_COLORS.OTHER,
              bg: '#f8fafc',
              border: '#e2e8f0'
            }
          ].map(c => (
            <div
              key={c.name}
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: '8px',
                padding: '12px 14px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.color }} />
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{c.name}</span>
                </div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: c.color }}>{c.pct.toFixed(1)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                  {c.count.toLocaleString()} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>units</span>
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                  ${c.val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section B: Two-Column Operational Focus ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>

        {/* Column 1: Top Movement Corridors (Lanes) */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <ChartSectionHeading
              icon={ArrowRight}
              title="Key Logistics Movement Corridors"
              subtitle="Top 5 highest-volume inter-hub transfer routes"
              color="#0284c7"
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setViewMode('routes')}
              style={{ fontSize: '11.5px', padding: '4px 10px', color: '#0284c7' }}
            >
              <span>All Routes</span> <ArrowUpRight size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {topRoutesChart.slice(0, 5).map((rt, idx) => {
              const maxQty = topRoutesChart[0]?.qty || 1;
              const barWidth = Math.max((rt.qty / maxQty) * 100, 4);
              return (
                <div
                  key={rt.name}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        width: '20px', height: '20px', borderRadius: '50%', background: idx === 0 ? '#0284c7' : '#e2e8f0',
                        color: idx === 0 ? '#fff' : '#475569', fontSize: '11px', fontWeight: 800,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {idx + 1}
                      </span>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a' }}>
                        {rt.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                        {rt.qty.toLocaleString()} <span style={{ fontSize: '10.5px', fontWeight: 500, color: '#64748b' }}>units</span>
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#15803d', fontFamily: 'var(--font-mono)' }}>
                        ${rt.val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>

                  {/* Horizontal Traffic Bar */}
                  <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${barWidth}%`,
                      height: '100%',
                      background: idx === 0 ? 'linear-gradient(90deg, #0284c7, #38bdf8)' : '#94a3b8',
                      borderRadius: '3px'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Top Demand Drivers (Parts) */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <ChartSectionHeading
              icon={Package}
              title="Top Transferred Part Numbers"
              subtitle="Top 5 highest-velocity SKUs dispatched across all branches"
              color="#7c3aed"
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setViewMode('ledger')}
              style={{ fontSize: '11.5px', padding: '4px 10px', color: '#7c3aed' }}
            >
              <span>View Ledger</span> <ArrowUpRight size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {topPartsChart.slice(0, 5).map((p, idx) => {
              const badgeColor = p.category === 'BATTERY' ? '#15803d' : p.category === 'DISPLAY' ? '#0284c7' : p.category === 'CAMERA' ? '#7c3aed' : '#64748b';
              const badgeBg = p.category === 'BATTERY' ? '#dcfce7' : p.category === 'DISPLAY' ? '#e0f2fe' : p.category === 'CAMERA' ? '#faf5ff' : '#f1f5f9';

              return (
                <div
                  key={p.name}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <span style={{
                      width: '20px', height: '20px', borderRadius: '50%', background: idx === 0 ? '#7c3aed' : '#e2e8f0',
                      color: idx === 0 ? '#fff' : '#475569', fontSize: '11px', fontWeight: 800,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      {idx + 1}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                          {p.name}
                        </span>
                        <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: badgeBg, color: badgeColor }}>
                          {p.category}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                        {p.fullName || p.label}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                      {p.qty.toLocaleString()} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b' }}>units</span>
                    </div>
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#15803d', fontFamily: 'var(--font-mono)' }}>
                      ${p.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* ── Section C: Regional Logistics Split & Executive Guidance ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>

        {/* Regional Logistics & Courier Split Card */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <ChartSectionHeading
              icon={Truck}
              title="Regional Logistics & Courier Split"
              subtitle="Metro Manila vs. Provincial service hub dispatches & shipping expense"
              color="#15803d"
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setViewMode('matrix')}
              style={{ fontSize: '11.5px', padding: '4px 10px', color: '#15803d' }}
            >
              <span>Courier Matrix</span> <ArrowUpRight size={13} />
            </button>
          </div>

          {/* Regional Progress Meter */}
          <div style={{ width: '100%', height: '14px', borderRadius: '6px', overflow: 'hidden', display: 'flex', background: '#f1f5f9', marginBottom: '14px' }}>
            <div style={{ width: `${mmPct}%`, background: '#0284c7' }} title={`Metro Manila: ${mmPct.toFixed(1)}%`} />
            <div style={{ width: `${provPct}%`, background: '#15803d' }} title={`Provincial: ${provPct.toFixed(1)}%`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div style={{ padding: '12px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #bae6fd' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>
                <MapPin size={13} /> Metro Manila Hubs
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {mmShipments.toLocaleString()} <span style={{ fontSize: '11.5px', color: '#64748b' }}>({mmPct.toFixed(1)}%)</span>
              </div>
              <div style={{ fontSize: '11px', color: '#0369a1', marginTop: '2px', fontWeight: 600 }}>
                Est. Courier: ₱{(mmShipments * 180).toLocaleString()} (@ ₱180)
              </div>
            </div>

            <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>
                <Truck size={13} /> Provincial Hubs
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {provShipments.toLocaleString()} <span style={{ fontSize: '11.5px', color: '#64748b' }}>({provPct.toFixed(1)}%)</span>
              </div>
              <div style={{ fontSize: '11px', color: '#15803d', marginTop: '2px', fontWeight: 600 }}>
                Est. Courier: ₱{(provShipments * 350).toLocaleString()} (@ ₱350)
              </div>
            </div>
          </div>

          <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Total Estimated Delivery Expenses:</span>
            <div style={{ textAlign: 'right' }}>
              <strong style={{ fontSize: '14px', color: '#dc2626', fontFamily: 'var(--font-mono)' }}>₱{totalFeePHP.toLocaleString()}</strong>
              <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px' }}>(${totalFeeUSD.toFixed(2)} USD)</span>
            </div>
          </div>
        </div>

        {/* Executive Logistics & Operational Highlights Card */}
        <div className="card" style={{ padding: '22px' }}>
          <ChartSectionHeading
            icon={ShieldCheck}
            title="Operational Takeaways & Logistics Guidance"
            subtitle="Automated high-level intelligence derived from the current stock transfer dataset"
            color="#92400e"
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px', color: '#334155' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '4px', borderRadius: '50%', marginTop: '1px' }}><ArrowRight size={14} /></div>
              <div>
                <strong>Primary Distribution Source:</strong> The main sending origin is <strong>{topOrigin}</strong>, dispatching <strong>{Number(topOriginQty).toLocaleString()} units</strong> ({topOriginPct}% of total network volume).
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ background: '#dcfce7', color: '#15803d', padding: '4px', borderRadius: '50%', marginTop: '1px' }}><Building2 size={14} /></div>
              <div>
                <strong>Highest Inflow Hub:</strong> The top receiving service branch is <strong>{topDest}</strong>, accounting for <strong>{Number(topDestQty).toLocaleString()} units</strong> ({topDestPct}% of all arrivals).
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ background: '#faf5ff', color: '#7c3aed', padding: '4px', borderRadius: '50%', marginTop: '1px' }}><Package size={14} /></div>
              <div>
                <strong>Dominant Commodity:</strong> <strong>{dominantCommodity?.name || 'Battery'}</strong> represents the highest physical transfer volume ({dominantCommodity?.value?.toLocaleString() || 0} units, {dominantCommodity?.pct?.toFixed(1) || 0}% share).
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ background: '#fef3c7', color: '#92400e', padding: '4px', borderRadius: '50%', marginTop: '1px' }}><Zap size={14} /></div>
              <div>
                <strong>Logistics Network Balance:</strong> Movement consists of <strong>{mmPct.toFixed(1)}% Metro Manila</strong> transfers and <strong>{provPct.toFixed(1)}% Provincial</strong> dispatches across {analytics.uniqueDests} destination branches.
              </div>
            </div>
          </div>
        </div>

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

// ── 3. ROUTE ANALYTICS VIEW ───────────────────────────────────────────────────
function RoutesView({ analytics }) {
  const { topOriginsChart, topDestsChart, monthlyTrend, allRoutes, totalUnits, totalVal } = analytics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Row 1: Monthly Trend Area Chart */}
      <div className="card" style={{ padding: '20px' }}>
        <ChartSectionHeading
          icon={Activity}
          title="Monthly Transfer Volume & Valuation Trend"
          subtitle="How inter-branch stock movement frequency and valuation has evolved over time"
          color="#0284c7"
        />
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
          <NoDataPlaceholder message="Not enough monthly data to display trend curve." />
        )}
      </div>

      {/* Row 2: Top Origins & Top Destinations */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '16px' }}>
        {/* Top Sending Origins */}
        <div className="card" style={{ padding: '20px' }}>
          <ChartSectionHeading icon={Building2} title="Top Sending Origins (by Volume)"
            subtitle="Which hubs dispatch the most stock" color="#92400e" />
          {topOriginsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topOriginsChart} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
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

        {/* Top Receiving Destinations */}
        <div className="card" style={{ padding: '20px' }}>
          <ChartSectionHeading icon={TrendingUp} title="Top Receiving Destinations (by Volume)"
            subtitle="Which hubs receive the most stock" color="#15803d" />
          {topDestsChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topDestsChart} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
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

      {/* Row 3: All Routes Detailed Summary Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
        <div style={{ padding: '14px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>All Transfer Movement Routes</h4>
          <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: '#64748b' }}>
            Comprehensive list of active movement corridors ranked by volume ({allRoutes.length} distinct routes)
          </p>
        </div>
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

    </div>
  );
}

// ── 4. BRANCH MATRIX & COURIERS VIEW ──────────────────────────────────────────
function BranchMatrixCouriersView({ filteredRecords }) {
  const [subTab, setSubTab] = useState('matrix'); // matrix | courier

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sub Tab Switcher */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button
          className={`btn btn-sm ${subTab === 'matrix' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('matrix')}
          style={{ fontSize: '12px', padding: '6px 14px', fontWeight: subTab === 'matrix' ? 700 : 500 }}
        >
          <Building2 size={14} /> <span>Site-by-Part Matrix</span>
        </button>
        <button
          className={`btn btn-sm ${subTab === 'courier' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('courier')}
          style={{ fontSize: '12px', padding: '6px 14px', fontWeight: subTab === 'courier' ? 700 : 500 }}
        >
          <Truck size={14} /> <span>Courier Shipping Fee Tracker</span>
        </button>
      </div>

      {subTab === 'matrix' && <SitePartMatrixView filteredRecords={filteredRecords} />}
      {subTab === 'courier' && <CourierFeeView filteredRecords={filteredRecords} />}
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
      const isProv = /(cebu|davao|iloilo|bacolod|pampanga|clark|baguio|dagupan|lipa|batangas|palawan|gensan|cagayan|laoag|naga|legazpi|tarlac|subic|marilao|cabanatuan|lucena|roxas|tacloban|butuan|tagum|zamboanga|newpoint|nep|lanang|lima|la union|\b(ceb|dav|ilo|bac|pam|cla|bag|dag|lip|bat|pal|gen|cdo)\b)/i.test(dest);
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
