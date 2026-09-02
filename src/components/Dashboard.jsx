import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Boxes,
  TrendingUp,
  Truck,
  ArrowUpRight,
  Barcode,
  PackageCheck,
  ShieldCheck,
  Search,
  Building2,
  ChevronRight,
  Calendar,
  Check,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Package,
  MapPin,
  BarChart3,
  SlidersHorizontal,
  Layers,
  Sparkles,
  Smartphone,
  ChevronDown
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';
import { generatePackingListPDF } from '../utils/pdfGenerator';
import {
  getMasterlistSummary,
  getMasterlistParts,
  getMasterlistSites,
  getMasterlistPartsForSite,
  IPHONE_CATEGORIES,
  getCategoryBadge
} from '../utils/rawMasterlistScanner';

const USD_TO_PHP_RATE = 57;

// Helper function to calculate calendar days a part has been in DC stock
function calculateDaysInDc(dateString) {
  if (!dateString) return 0;
  const receivedDate = new Date(dateString);
  if (isNaN(receivedDate.getTime())) return 0;
  const now = new Date();
  const diffMs = now.getTime() - receivedDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export default function Dashboard() {
  const {
    inventoryUnits = [],
    shipments = [],
    parts = [],
    sites = [],
    forecastItems = [],
    repairUsageRecords = [],
    currentUser,
    activePeriod,
    setActiveTab,
    isAutoRefreshing,
    autoRefreshData,
    activePackDraft,
    supervisorSettings
  } = useApp();

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW & FILTER STATES
  // ─────────────────────────────────────────────────────────────────────────
  const [reportTab, setReportTab] = useState('top-parts'); // 'top-parts' | 'top-sites' | 'site-parts'
  const [selectedSiteName, setSelectedSiteName] = useState('MOBILECARE - NEWPOINT MALL');
  const [reportCategory, setReportCategory] = useState('ALL');
  const [reportSearch, setReportSearch] = useState('');
  const [reportSortBy, setReportSortBy] = useState('units'); // 'units' | 'valuation' | 'name'
  const [reportLimit, setReportLimit] = useState(10); // 10 | 25 | 50 | 'ALL'

  // DC Snapshot Table State
  const [tableSearch, setTableSearch] = useState('');
  const [activeSnapshotFilter, setActiveSnapshotFilter] = useState('ALL');

  // ─────────────────────────────────────────────────────────────────────────
  // DC WAREHOUSE INVENTORY TELEMETRY & 4-DAY AGING
  // ─────────────────────────────────────────────────────────────────────────
  const packedSerialsSet = useMemo(() => {
    const set = new Set();
    if (activePackDraft?.items && Array.isArray(activePackDraft.items)) {
      activePackDraft.items.forEach(it => {
        const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
        if (s) set.add(s);
      });
    }
    (shipments || []).forEach(sh => {
      if (sh.items && Array.isArray(sh.items)) {
        sh.items.forEach(it => {
          const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
          if (s) set.add(s);
        });
      }
    });
    return set;
  }, [activePackDraft, shipments]);

  const availableInStockUnits = useMemo(() => {
    return (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      if (cleanSerial && packedSerialsSet.has(cleanSerial)) return false;
      const isDc = u.current_site_id === 'site-dc' || 
                   u.site_code === 'DC-MDC' || 
                   u.site_code === 'DC' || 
                   (!u.current_site_id && !u.site_code) ||
                   (sites.find(s => s.id === u.current_site_id || s.code === u.current_site_id)?.is_dc ?? false);
      return (u.status === 'in_stock' || !u.status) && isDc;
    });
  }, [inventoryUnits, packedSerialsSet, sites]);

  const { agingUnits, freshUnits } = useMemo(() => {
    const aging = [];
    const fresh = [];
    availableInStockUnits.forEach(u => {
      const days = calculateDaysInDc(u.received_at || u.created_at || u.intake_date || u.date);
      if (days >= 4) {
        aging.push({ ...u, daysInDc: days });
      } else {
        fresh.push({ ...u, daysInDc: days });
      }
    });
    return { agingUnits: aging, freshUnits: fresh };
  }, [availableInStockUnits]);

  const packedUnits = useMemo(() => {
    return (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      return u.status === 'packed' || u.status === 'shipped' || u.status === 'allocated' || (cleanSerial && packedSerialsSet.has(cleanSerial));
    });
  }, [inventoryUnits, packedSerialsSet]);

  // ─────────────────────────────────────────────────────────────────────────
  // IPHONE MASTERLIST SCANNED QUERIES (8,295 REPAIRS, 415 SKUs, 28 HUBS)
  // ─────────────────────────────────────────────────────────────────────────
  const masterSummary = useMemo(() => getMasterlistSummary(), [repairUsageRecords]);

  const masterPartsReport = useMemo(() => {
    return getMasterlistParts({
      category: reportCategory,
      search: reportSearch,
      limit: reportLimit,
      sortBy: reportSortBy
    });
  }, [reportCategory, reportSearch, reportLimit, reportSortBy, repairUsageRecords]);

  const masterSitesReport = useMemo(() => {
    return getMasterlistSites({
      search: reportSearch,
      limit: reportLimit
    });
  }, [reportSearch, reportLimit, repairUsageRecords]);

  const sitePartsReport = useMemo(() => {
    return getMasterlistPartsForSite(selectedSiteName, {
      category: reportCategory,
      search: reportSearch,
      limit: reportLimit,
      sortBy: reportSortBy
    });
  }, [selectedSiteName, reportCategory, reportSearch, reportLimit, reportSortBy, repairUsageRecords]);

  // Category Distribution for Donut Chart
  const categoryChartData = useMemo(() => {
    const raw = masterSummary.categoryStats || {};
    const colors = {
      'Battery': '#059669',
      'Display': '#0284c7',
      'Rear System & Logic': '#7c3aed',
      'Camera': '#db2777',
      'Back Glass': '#0d9488',
      'Component': '#475569'
    };

    return Object.entries(raw).map(([cat, count]) => ({
      name: cat,
      count,
      color: colors[cat] || '#64748b'
    })).sort((a, b) => b.count - a.count);
  }, [masterSummary]);

  // Top 8 Sites for Bar Chart
  const topSitesChartData = useMemo(() => {
    return masterSitesReport.all.slice(0, 8).map(s => ({
      name: s.shortName.length > 12 ? s.shortName.substring(0, 12) + '...' : s.shortName,
      fullName: s.shortName,
      'iPhone Units': s.totalUnits,
      'Valuation ($k)': Math.round(s.totalValUSD / 1000)
    }));
  }, [masterSitesReport]);

  // DC Stock Grouped Snapshot Table
  const groupedInventory = useMemo(() => {
    const map = new Map();
    availableInStockUnits.forEach(u => {
      const pn = String(u.part_number || '').toUpperCase();
      const days = calculateDaysInDc(u.received_at || u.created_at || u.intake_date || u.date);

      if (!map.has(pn)) {
        const partObj = parts.find(p => p.part_number?.toUpperCase() === pn);
        map.set(pn, {
          part_number: pn,
          description: u.description || partObj?.description || 'iPhone Replacement Component',
          category: partObj?.category_id || 'GENERAL',
          units: [],
          maxDaysInDc: days,
          agingCount: 0,
          freshCount: 0,
          latest_serial: u.serial_number
        });
      }
      const entry = map.get(pn);
      entry.units.push(u);
      if (days >= 4) {
        entry.agingCount++;
      } else {
        entry.freshCount++;
      }
      if (days > entry.maxDaysInDc) {
        entry.maxDaysInDc = days;
      }
    });

    let list = Array.from(map.values()).sort((a, b) => {
      if (b.agingCount !== a.agingCount) return b.agingCount - a.agingCount;
      return b.units.length - a.units.length;
    });

    if (activeSnapshotFilter !== 'ALL') {
      list = list.filter(item => {
        const desc = String(item.description).toUpperCase();
        if (activeSnapshotFilter === 'DISPLAY') return desc.includes('DISPLAY') || desc.includes('SCREEN');
        if (activeSnapshotFilter === 'BATTERY') return desc.includes('BATTERY');
        if (activeSnapshotFilter === 'CAMERA') return desc.includes('CAMERA');
        if (activeSnapshotFilter === 'AGING') return item.agingCount > 0;
        return true;
      });
    }

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase().trim();
      list = list.filter(item =>
        item.part_number.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.latest_serial?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [availableInStockUnits, parts, activeSnapshotFilter, tableSearch]);

  const recentShipments = (shipments || []).slice(0, 6);

  return (
    <div className="dashboard-view" style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      
      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 1. EXECUTIVE OPERATIONS HEADER BANNER                              */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
          color: '#ffffff',
          padding: '22px 28px',
          border: '1px solid #334155',
          borderRadius: '12px',
          boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.4)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Smartphone size={20} color="#38bdf8" />
                <h2 style={{ color: '#fff', fontSize: '21px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                  Distribution Center Operations • iPhone Intelligence
                </h2>
              </div>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <ShieldCheck size={13} />
                {currentUser?.role ? currentUser.role.toUpperCase() : 'SUPERADMIN'}
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
              Fixably / GSX Raw Masterlist: <strong style={{ color: '#38bdf8' }}>{masterSummary.totalUnits.toLocaleString()} iPhone Repairs</strong> • <strong style={{ color: '#f1f5f9' }}>{masterSummary.totalDistinctParts} Active iPhone SKUs</strong> across <strong style={{ color: '#f1f5f9' }}>{masterSummary.totalSites} Service Hubs</strong>
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'Dashboard manual refresh' })}
              disabled={isAutoRefreshing}
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid #334155',
                color: '#38bdf8',
                padding: '6px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Refresh Telemetry'}</span>
            </button>

            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid #334155',
                padding: '6px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#cbd5e1'
              }}
            >
              <Calendar size={14} color="#38bdf8" />
              <span>{typeof activePeriod === 'string' ? activePeriod : (activePeriod?.label || 'September 2026')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4-Day Aging Alert Banner if units exist */}
      {agingUnits.length > 0 && (
        <div
          style={{
            background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
            border: '1px solid #fde68a',
            borderRadius: '10px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.08)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#f59e0b', color: '#fff', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>DC Aging Alert: {agingUnits.length} Part{agingUnits.length > 1 ? 's' : ''} Stagnant in DC Warehouse for ≥ 4 Days</span>
                <span className="badge" style={{ background: '#f59e0b', color: '#fff', fontSize: '11px', fontWeight: 700 }}>
                  Priority Dispatch
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#b45309', marginTop: '2px' }}>
                These parts have exceeded the 4-day retention threshold. Please pack and dispatch them for site delivery.
              </div>
            </div>
          </div>

          <button
            className="btn btn-primary btn-sm"
            onClick={() => setActiveTab('scan-out')}
            style={{
              background: '#d97706',
              borderColor: '#b45309',
              fontWeight: 700,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <PackageCheck size={14} />
            <span>Pack Outbound Shipments (F2)</span>
          </button>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 2. EXECUTIVE 4-CARD SUMMARY METRICS ROW                           */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '18px'
        }}
      >
        {/* Card 1: DC Available In-Stock */}
        <div
          className="kpi-card"
          style={{
            borderLeft: `4px solid ${agingUnits.length > 0 ? '#f59e0b' : '#0284c7'}`,
            cursor: 'pointer'
          }}
          onClick={() => setActiveTab('scan-in')}
          title="Click to open Receive Scan-In Station"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">DC In-Stock Inventory</span>
            <div style={{ padding: '8px', background: agingUnits.length > 0 ? '#fef3c7' : '#e0f2fe', borderRadius: '8px', color: agingUnits.length > 0 ? '#f59e0b' : '#0284c7' }}>
              <Boxes size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {availableInStockUnits.length.toLocaleString()} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>units</span>
          </div>
          <div className="kpi-sub">
            {availableInStockUnits.length === 0 ? (
              <span style={{ color: '#047857', fontWeight: 600 }}>Clean Pipeline (0 in DC)</span>
            ) : agingUnits.length > 0 ? (
              <span style={{ color: '#b45309', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} /> {agingUnits.length} Aging (≥4d in DC) • {freshUnits.length} Fresh
              </span>
            ) : (
              <span style={{ color: '#047857', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={12} /> All {availableInStockUnits.length} Units Fresh (&lt;4d in DC)
              </span>
            )}
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(availableInStockUnits.length * 5, 100)}%`, background: agingUnits.length > 0 ? '#f59e0b' : '#0284c7' }} />
          </div>
        </div>

        {/* Card 2: Total iPhone Master Demand */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #10b981',
            cursor: 'pointer'
          }}
          onClick={() => {
            setReportTab('top-parts');
          }}
          title="Click to view all iPhone Top Parts"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Total iPhone Demand</span>
            <div style={{ padding: '8px', background: '#dcfce7', borderRadius: '8px', color: '#10b981' }}>
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {masterSummary.totalUnits.toLocaleString()} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>units</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#047857', fontWeight: 700 }}>
              ${(masterSummary.totalValuationUSD / 1000000).toFixed(2)}M
            </span>{' '}
            (₱{(masterSummary.totalValuationPHP / 1000000).toFixed(1)}M) • {masterSummary.totalDistinctParts} iPhone SKUs
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: '#10b981' }} />
          </div>
        </div>

        {/* Card 3: Outbound Shipments */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #f59e0b',
            cursor: 'pointer'
          }}
          onClick={() => setActiveTab('shipments')}
          title="Click to view Outbound Shipments"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Outbound Shipments</span>
            <div style={{ padding: '8px', background: '#fef3c7', borderRadius: '8px', color: '#f59e0b' }}>
              <Truck size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {(shipments || []).length} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>manifests</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#b45309', fontWeight: 700 }}>
              {packedUnits.length} in queue
            </span>{' '}
            • Dispatched via Lalamove / Lite Exp
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(shipments.length * 10, 100)}%`, background: '#f59e0b' }} />
          </div>
        </div>

        {/* Card 4: Service Hubs Network */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #8b5cf6',
            cursor: 'pointer'
          }}
          onClick={() => {
            setReportTab('top-sites');
          }}
          title="Click to view all Service Hubs"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Service Hubs Network</span>
            <div style={{ padding: '8px', background: '#ede9fe', borderRadius: '8px', color: '#8b5cf6' }}>
              <Building2 size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {masterSummary.totalSites} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>branches</span>
          </div>
          <div className="kpi-sub">
            Top Hub:{' '}
            <span style={{ color: '#6d28d9', fontWeight: 700 }}>
              {masterSitesReport.topSite
                ? `${masterSitesReport.topSite.shortName} (${masterSitesReport.topSite.totalUnits.toLocaleString()} units)`
                : 'No hub data'}
            </span>
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: '#8b5cf6' }} />
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 3. MANAGER DISTRIBUTION INTELLIGENCE & REPORTS CENTER             */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '24px',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          background: '#ffffff',
          boxShadow: '0 4px 16px -2px rgba(0, 0, 0, 0.05)'
        }}
      >
        {/* Header & Main Navigation Tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '18px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ background: '#eff6ff', color: '#0284c7', padding: '8px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BarChart3 size={20} color="#0284c7" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  Distribution Intelligence • iPhone Masterlist Reports
                </h3>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  Calculated from Fixably/GSX raw records with live stocking prices and branch demand metrics
                </p>
              </div>
            </div>
          </div>

          {/* 3 Clean Report Views with Lucide Icons (No Emojis) */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0', gap: '4px' }}>
            <button
              type="button"
              onClick={() => setReportTab('top-parts')}
              style={{
                border: 'none',
                background: reportTab === 'top-parts' ? '#0f172a' : 'transparent',
                color: reportTab === 'top-parts' ? '#ffffff' : '#475569',
                padding: '7px 16px',
                borderRadius: '7px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
                boxShadow: reportTab === 'top-parts' ? '0 2px 6px rgba(15, 23, 42, 0.25)' : 'none'
              }}
            >
              <Smartphone size={15} />
              <span>Top iPhone Parts ({masterSummary.totalDistinctParts})</span>
            </button>

            <button
              type="button"
              onClick={() => setReportTab('top-sites')}
              style={{
                border: 'none',
                background: reportTab === 'top-sites' ? '#0f172a' : 'transparent',
                color: reportTab === 'top-sites' ? '#ffffff' : '#475569',
                padding: '7px 16px',
                borderRadius: '7px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
                boxShadow: reportTab === 'top-sites' ? '0 2px 6px rgba(15, 23, 42, 0.25)' : 'none'
              }}
            >
              <Building2 size={15} />
              <span>Service Hubs ({masterSummary.totalSites})</span>
            </button>

            <button
              type="button"
              onClick={() => setReportTab('site-parts')}
              style={{
                border: 'none',
                background: reportTab === 'site-parts' ? '#0f172a' : 'transparent',
                color: reportTab === 'site-parts' ? '#ffffff' : '#475569',
                padding: '7px 16px',
                borderRadius: '7px',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s ease',
                boxShadow: reportTab === 'site-parts' ? '0 2px 6px rgba(15, 23, 42, 0.25)' : 'none'
              }}
            >
              <Layers size={15} />
              <span>All Parts Per Site</span>
            </button>
          </div>
        </div>

        {/* Clean iPhone Category Filter Pills (No Emojis) */}
        {reportTab !== 'top-sites' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#64748b', marginRight: '4px', whiteSpace: 'nowrap' }}>
              Filter Category:
            </span>
            {IPHONE_CATEGORIES.map(cat => {
              const isSelected = reportCategory === cat.key;
              const count = cat.key === 'ALL' ? masterSummary.totalUnits : (masterSummary.categoryStats[cat.key] || 0);
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setReportCategory(cat.key)}
                  style={{
                    border: '1px solid',
                    borderColor: isSelected ? '#0284c7' : '#cbd5e1',
                    background: isSelected ? '#0284c7' : '#ffffff',
                    color: isSelected ? '#ffffff' : '#334155',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: isSelected ? 700 : 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.12s ease'
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap' }}>{cat.label}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, background: isSelected ? 'rgba(255,255,255,0.22)' : '#f1f5f9', color: isSelected ? '#ffffff' : '#64748b', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                    {count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Filter Controls Bar: Search, Sort, Limit */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
          {/* Left Side: Search Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: '12px', top: '10px', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder={reportTab === 'top-sites' ? 'Search service branch...' : 'Search iPhone part number or model description...'}
                value={reportSearch}
                onChange={(e) => setReportSearch(e.target.value)}
                style={{
                  padding: '7px 14px 7px 34px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  width: '320px',
                  background: '#f8fafc',
                  color: '#0f172a'
                }}
              />
            </div>
          </div>

          {/* Right Side: Sort & Limit Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Sort By Controls */}
            {reportTab !== 'top-sites' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>Sort by:</span>
                <select
                  value={reportSortBy}
                  onChange={(e) => setReportSortBy(e.target.value)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <option value="units">Demand Volume (High to Low)</option>
                  <option value="valuation">Total Spend (High to Low)</option>
                  <option value="name">Model Name (A to Z)</option>
                </select>
              </div>
            )}

            {/* Display Limit Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#475569', whiteSpace: 'nowrap' }}>
              <span style={{ fontWeight: 600 }}>Rows:</span>
              {[10, 25, 50, 'ALL'].map(lim => (
                <button
                  key={lim}
                  onClick={() => setReportLimit(lim)}
                  style={{
                    border: '1px solid',
                    borderColor: reportLimit === lim ? '#0284c7' : '#cbd5e1',
                    background: reportLimit === lim ? '#e0f2fe' : '#ffffff',
                    color: reportLimit === lim ? '#0369a1' : '#475569',
                    padding: '3px 10px',
                    borderRadius: '5px',
                    fontSize: '11.5px',
                    fontWeight: reportLimit === lim ? 700 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {lim === 'ALL' ? 'All' : lim}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* VIEW 1: TOP IPHONE PARTS (NATIONAL MASTERLIST RANKING)            */}
        {/* ───────────────────────────────────────────────────────────────── */}
        {reportTab === 'top-parts' && (
          <div>
            {/* Top Parts Summary Bar */}
            <div
              style={{
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 18px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                  National iPhone Parts Ranking
                </span>
                <span className="badge badge-primary">{masterPartsReport.totalCount} Parts Found</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                <div>
                  Total Demand: <strong style={{ color: '#0284c7', fontFamily: 'var(--font-mono)' }}>{masterPartsReport.totalFilteredUnits.toLocaleString()} units</strong>
                </div>
                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />
                <div>
                  Valuation:{' '}
                  <strong style={{ color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                    ${masterPartsReport.totalFilteredValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </strong>{' '}
                  <span style={{ color: '#64748b' }}>(₱{masterPartsReport.totalFilteredValPHP.toLocaleString(undefined, { maximumFractionDigits: 0 })})</span>
                </div>
              </div>
            </div>

            {/* Clean, Legible Table (No DC In-Stock / Action Columns) */}
            {masterPartsReport.displayList.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                <Package size={28} color="#94a3b8" style={{ marginBottom: '6px' }} />
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No matching iPhone parts found</div>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>Try adjusting your search query or category filter.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table className="table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ width: '60px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>RANK</th>
                      <th style={{ width: '140px', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>PART NUMBER</th>
                      <th style={{ minWidth: '240px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>IPHONE MODEL & DESCRIPTION</th>
                      <th style={{ width: '180px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>CATEGORY</th>
                      <th style={{ width: '140px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>STOCK PRICE</th>
                      <th style={{ width: '150px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL DEMAND</th>
                      <th style={{ width: '160px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL VALUATION</th>
                      <th style={{ width: '140px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>SHARE OF DEMAND</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masterPartsReport.displayList.map((item, idx) => {
                      const badge = getCategoryBadge(item.category);
                      return (
                        <tr
                          key={item.part_number}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                            transition: 'background 0.1s ease'
                          }}
                        >
                          {/* Rank */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {idx < 3 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  background: idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#64748b',
                                  color: '#ffffff',
                                  fontWeight: 800,
                                  fontSize: '11px'
                                }}
                              >
                                {idx + 1}
                              </span>
                            ) : (
                              <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>#{idx + 1}</span>
                            )}
                          </td>

                          {/* Part Number */}
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#0f172a', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {item.part_number}
                          </td>

                          {/* Description */}
                          <td style={{ padding: '13px 14px' }}>
                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13.5px' }}>
                              {item.description}
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                              Allocated / consumed across {item.sitesCount} service branches
                            </div>
                          </td>

                          {/* Category Badge - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: badge.bg,
                                color: badge.text,
                                border: `1px solid ${badge.border}`,
                                padding: '5px 12px',
                                borderRadius: '6px',
                                fontWeight: 700,
                                fontSize: '11.5px',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {badge.name}
                            </span>
                          </td>

                          {/* Stocking Price - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>${item.priceUSD}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>₱{(item.priceUSD * USD_TO_PHP_RATE).toLocaleString()}</div>
                          </td>

                          {/* Total Demand - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: '#f0f9ff',
                                color: '#0369a1',
                                border: '1px solid #bae6fd',
                                padding: '5px 14px',
                                borderRadius: '6px',
                                fontWeight: 800,
                                fontSize: '13px',
                                fontFamily: 'var(--font-mono)',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.totalUnits.toLocaleString()} units
                            </span>
                          </td>

                          {/* Total Valuation - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                              ${item.totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              ₱{item.totalValPHP.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                          </td>

                          {/* Share of Demand */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                              <div style={{ width: '45px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(item.pctShare * 6, 100)}%`, height: '100%', background: '#0284c7' }} />
                              </div>
                              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                                {item.pctShare.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* VIEW 2: ALL SERVICE HUBS (28 BRANCHES RANKING)                    */}
        {/* ───────────────────────────────────────────────────────────────── */}
        {reportTab === 'top-sites' && (
          <div>
            {/* Summary Bar */}
            <div
              style={{
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 18px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                  28 Service Branches iPhone Ranking
                </span>
                <span className="badge badge-primary">{masterSitesReport.totalSitesCount} Branches</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                <div>
                  Top Branch: <strong style={{ color: '#0284c7' }}>{masterSitesReport.topSite?.shortName} ({masterSitesReport.topSite?.totalUnits} units)</strong>
                </div>
                <div style={{ width: '1px', height: '16px', background: '#cbd5e1' }} />
                <div>
                  Total Network Demand:{' '}
                  <strong style={{ color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                    {masterSitesReport.grandTotalUnits.toLocaleString()} units
                  </strong>
                </div>
              </div>
            </div>

            {/* Sites Table */}
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table className="table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ width: '60px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>RANK</th>
                    <th style={{ minWidth: '220px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>SERVICE BRANCH NAME</th>
                    <th style={{ width: '130px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>REGION</th>
                    <th style={{ width: '140px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>IPHONE UNITS</th>
                    <th style={{ width: '130px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>DISTINCT SKUS</th>
                    <th style={{ width: '160px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL VALUATION</th>
                    <th style={{ minWidth: '240px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>TOP CONSUMED IPHONE PART</th>
                    <th style={{ width: '130px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>NETWORK SHARE</th>
                    <th style={{ width: '110px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>VIEW</th>
                  </tr>
                </thead>
                <tbody>
                  {masterSitesReport.displayList.map((site, idx) => (
                    <tr
                      key={site.siteName}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                        transition: 'background 0.1s ease'
                      }}
                    >
                      {/* Rank */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        {idx < 3 ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              background: idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#64748b',
                              color: '#ffffff',
                              fontWeight: 800,
                              fontSize: '11px'
                            }}
                          >
                            {idx + 1}
                          </span>
                        ) : (
                          <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>#{idx + 1}</span>
                        )}
                      </td>

                      {/* Branch Name */}
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13.5px' }}>
                          {site.shortName}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                          {site.siteName}
                        </div>
                      </td>

                      {/* Region */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            background: site.isMM ? '#f0f9ff' : '#ecfdf5',
                            color: site.isMM ? '#0369a1' : '#047857',
                            border: site.isMM ? '1px solid #bae6fd' : '1px solid #a7f3d0',
                            padding: '4px 10px',
                            borderRadius: '5px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            display: 'inline-block',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {site.region}
                        </span>
                      </td>

                      {/* Total Units */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            background: '#f0f9ff',
                            color: '#0369a1',
                            border: '1px solid #bae6fd',
                            padding: '5px 14px',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '13px',
                            fontFamily: 'var(--font-mono)',
                            display: 'inline-block',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {site.totalUnits.toLocaleString()} units
                        </span>
                      </td>

                      {/* Distinct SKUs */}
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#475569', padding: '13px 14px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                        {site.distinctPartsCount} SKUs
                      </td>

                      {/* Total Valuation */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 800, color: '#059669', fontSize: '13px' }}>${site.totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>₱{site.totalValPHP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      </td>

                      {/* Top Part */}
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                          {site.topPart ? `${site.topPart.description || site.topPart.part_number} (${site.topPart.units} units)` : '—'}
                        </div>
                      </td>

                      {/* Share Bar */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                          <div style={{ width: '45px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(site.pctShare * 8, 100)}%`, height: '100%', background: '#0284c7' }} />
                          </div>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                            {site.pctShare.toFixed(1)}%
                          </span>
                        </div>
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 600 }}
                          onClick={() => {
                            setSelectedSiteName(site.siteName);
                            setReportTab('site-parts');
                          }}
                          title={`Explore all iPhone parts for ${site.shortName}`}
                        >
                          View Parts
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────── */}
        {/* VIEW 3: ALL IPHONE PARTS PER SITE (ENLARGED PROMINENT SITE PICKER)*/}
        {/* ───────────────────────────────────────────────────────────────── */}
        {reportTab === 'site-parts' && (
          <div>
            {/* Prominent, Enlarged Site Selector Banner */}
            <div
              style={{
                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                padding: '18px 22px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
              }}
            >
              {/* Left Side: Large Dropdown Picker */}
              <div style={{ flex: '1 1 340px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Select Service Branch:
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    className="form-select"
                    value={selectedSiteName}
                    onChange={(e) => setSelectedSiteName(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '2px solid #0284c7',
                      fontSize: '14.5px',
                      fontWeight: 800,
                      color: '#0f172a',
                      background: '#ffffff',
                      width: '100%',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(2, 132, 199, 0.12)'
                    }}
                  >
                    {masterSitesReport.all.map(s => (
                      <option key={s.siteName} value={s.siteName}>
                        {s.shortName} • {s.totalUnits} iPhone units ({s.region})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Right Side: 3 Prominent Branch Metrics */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                    Branch Demand
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#0284c7', fontFamily: 'var(--font-mono)' }}>
                    {sitePartsReport.siteTotalUnits.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>units</span>
                  </div>
                </div>

                <div style={{ width: '1px', height: '36px', background: '#cbd5e1' }} />

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                    Total Branch Spend
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669', fontFamily: 'var(--font-mono)' }}>
                    ${sitePartsReport.siteTotalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>(₱{(sitePartsReport.siteTotalValPHP / 1000000).toFixed(2)}M)</span>
                  </div>
                </div>

                <div style={{ width: '1px', height: '36px', background: '#cbd5e1' }} />

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                    Active SKUs
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#7c3aed', fontFamily: 'var(--font-mono)' }}>
                    {sitePartsReport.totalPartsCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>parts</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Branch Parts Table (No DC In-Stock / Action Columns) */}
            {sitePartsReport.displayList.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                <Package size={28} color="#94a3b8" style={{ marginBottom: '6px' }} />
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No matching iPhone parts found for this branch</div>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>Try adjusting your search query or category filter.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table className="table" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ width: '60px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>RANK</th>
                      <th style={{ width: '140px', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>PART NUMBER</th>
                      <th style={{ minWidth: '240px', padding: '12px 14px', color: '#475569', fontWeight: 700 }}>IPHONE MODEL & DESCRIPTION</th>
                      <th style={{ width: '180px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>CATEGORY</th>
                      <th style={{ width: '140px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>STOCK PRICE</th>
                      <th style={{ width: '150px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>BRANCH DEMAND</th>
                      <th style={{ width: '160px', textAlign: 'right', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>TOTAL BRANCH COST</th>
                      <th style={{ width: '140px', textAlign: 'center', padding: '12px 14px', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>BRANCH SHARE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sitePartsReport.displayList.map((item, idx) => {
                      const badge = getCategoryBadge(item.category);
                      return (
                        <tr
                          key={item.part_number}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                            transition: 'background 0.1s ease'
                          }}
                        >
                          {/* Rank */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {idx < 3 ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '50%',
                                  background: idx === 0 ? '#0f172a' : idx === 1 ? '#475569' : '#64748b',
                                  color: '#ffffff',
                                  fontWeight: 800,
                                  fontSize: '11px'
                                }}
                              >
                                {idx + 1}
                              </span>
                            ) : (
                              <span style={{ color: '#64748b', fontWeight: 700, fontSize: '12px' }}>#{idx + 1}</span>
                            )}
                          </td>

                          {/* Part Number */}
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#0f172a', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            {item.part_number}
                          </td>

                          {/* Description */}
                          <td style={{ padding: '13px 14px' }}>
                            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13.5px' }}>
                              {item.description}
                            </div>
                          </td>

                          {/* Category Badge - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: badge.bg,
                                color: badge.text,
                                border: `1px solid ${badge.border}`,
                                padding: '5px 12px',
                                borderRadius: '6px',
                                fontWeight: 700,
                                fontSize: '11.5px',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {badge.name}
                            </span>
                          </td>

                          {/* Stocking Price - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>${item.priceUSD}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>₱{(item.priceUSD * USD_TO_PHP_RATE).toLocaleString()}</div>
                          </td>

                          {/* Branch Demand - No Wrap */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                background: '#f0f9ff',
                                color: '#0369a1',
                                border: '1px solid #bae6fd',
                                padding: '5px 14px',
                                borderRadius: '6px',
                                fontWeight: 800,
                                fontSize: '13px',
                                fontFamily: 'var(--font-mono)',
                                display: 'inline-block',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.units.toLocaleString()} units
                            </span>
                          </td>

                          {/* Total Cost - No Wrap */}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                              ${item.totalValUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              ₱{(item.totalValUSD * USD_TO_PHP_RATE).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                          </td>

                          {/* Branch Share */}
                          <td style={{ textAlign: 'center', padding: '13px 14px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                              <div style={{ width: '45px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(item.pctShare * 4, 100)}%`, height: '100%', background: '#0284c7' }} />
                              </div>
                              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                                {item.pctShare.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 4. ANALYTICS ROW: CATEGORY DISTRIBUTION & TOP HUBS DEMAND BARS     */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: '20px' }}>
        {/* Left: Category Breakdown Donut */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>iPhone Demand by Category</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Distribution of 8,295 iPhone repairs across component families
              </p>
            </div>
            <span className="badge badge-primary">8,295 Repairs</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '230px' }}>
            <div style={{ width: '50%', height: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="count"
                  >
                    {categoryChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} repairs`, name]}
                    contentStyle={{ background: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Custom Legend */}
            <div style={{ width: '48%', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '230px', overflowY: 'auto' }}>
              {categoryChartData.map(item => {
                const pct = Math.round((item.count / 8295) * 100);
                return (
                  <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{item.name}</span>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      <strong>{item.count.toLocaleString()}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Top 8 Hubs Demand Bar Chart */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Top Service Hubs iPhone Demand</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Highest repair volume service branches for iPhone
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setReportTab('top-sites')}>
              <span>View All 28 Hubs</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          <div style={{ height: '230px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSitesChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value, name) => [name === 'Valuation ($k)' ? `$${value}k` : `${value} units`, name]}
                  contentStyle={{ background: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11.5px', paddingTop: '6px' }} />
                <Bar dataKey="iPhone Units" fill="#0284c7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Valuation ($k)" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 5. QUICK WORKSTATION LAUNCHPAD                                    */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div>
        <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} color="var(--primary)" />
          Quick Workstation Launchpad
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          
          <div
            onClick={() => setActiveTab('scan-in')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#0284c7', color: '#fff', borderRadius: '10px' }}>
              <Barcode size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Receive Scan-In (F1)</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Barcode intake & spreadsheet manifest</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => setActiveTab('scan-out')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#059669', color: '#fff', borderRadius: '10px' }}>
              <PackageCheck size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Pack Scan-Out (F2)</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Generate outbound shipments & PDF</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => setActiveTab('shipments')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#d97706', color: '#fff', borderRadius: '10px' }}>
              <Truck size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Outbound Shipments</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Branch dispatches & Lalamove/Lite Exp</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          <div
            onClick={() => setActiveTab('allocation')}
            className="card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px solid var(--border-light)',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ padding: '12px', background: '#7c3aed', color: '#fff', borderRadius: '10px' }}>
              <Building2 size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>Allocation Matrix</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Branch demand & weekly splitting</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 6. LIVE OUTBOUND SHIPMENTS FEED                                   */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Recent Outbound Shipments</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Exported manifests dispatched for branch delivery
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('shipments')}>
            <span>View All Shipments ({shipments?.length || 0})</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        {recentShipments.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <Truck size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No Outbound Shipments Generated Yet</div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 12px' }}>
              Scan serialized parts in Pack Scan-Out to generate delivery manifests for service branches.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('scan-out')}>
              Open Pack Scan-Out (F2)
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' }}>
            {recentShipments.map(sh => {
              const destSite = sites.find(s => s.id === sh.site_id || s.code === sh.site_id) || {};
              return (
                <div
                  key={sh.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: '#ffffff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                      {sh.invoice_ref || sh.shipment_number}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                      To: <strong>{destSite.name || sh.site_name || 'Service Hub'}</strong> • {sh.items?.length || 0} units
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      className="badge"
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        background: (sh.status === 'received_confirmed' || sh.status === 'delivered') ? '#ecfdf5' : (sh.status === 'shipped' || sh.status === 'in_transit') ? '#f0f9ff' : (sh.status === 'pending_pickup' ? '#fffbeb' : '#f1f5f9'),
                        color: (sh.status === 'received_confirmed' || sh.status === 'delivered') ? '#047857' : (sh.status === 'shipped' || sh.status === 'in_transit') ? '#0369a1' : (sh.status === 'pending_pickup' ? '#b45309' : '#475569'),
                        border: (sh.status === 'received_confirmed' || sh.status === 'delivered') ? '1px solid #a7f3d0' : (sh.status === 'shipped' || sh.status === 'in_transit') ? '1px solid #bae6fd' : (sh.status === 'pending_pickup' ? '1px solid #fde68a' : '1px solid #e2e8f0')
                      }}
                    >
                      {sh.status === 'pending_pickup' ? 'Pending Pickup' : (sh.status === 'received_confirmed' ? 'Received' : (sh.status ? sh.status.replace('_', ' ') : 'Draft'))}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 8px', fontSize: '11.5px' }}
                      onClick={() => generatePackingListPDF(sh, sh.items, destSite, {
                        supervisorName: supervisorSettings?.supervisor_name || 'Anjo Alcazar',
                        supervisorTitle: supervisorSettings?.supervisor_title || 'MDC Supervisor of DC',
                        guardOnDuty: sh.guard_on_duty || supervisorSettings?.guard_on_duty,
                        pickupDate: sh.pickup_date || sh.shipment_date
                      })}
                      title="Download Outbound Shipment Manifest PDF"
                    >
                      PDF
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────── */}
      {/* 7. LIVE DC STOCK INVENTORY SNAPSHOT TABLE                         */}
      {/* ───────────────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>DC Stock Inventory Snapshot</h3>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <Check size={11} style={{ display: 'inline', marginRight: '3px' }} />
                Real-Time Synced
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Aggregated stock counts by part SKU currently available in Distribution Center with 4-day retention tracking
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
              {['ALL', 'DISPLAY', 'BATTERY', 'CAMERA', 'AGING'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveSnapshotFilter(f)}
                  style={{
                    border: 'none',
                    background: activeSnapshotFilter === f ? (f === 'AGING' ? '#f59e0b' : '#0284c7') : 'transparent',
                    color: activeSnapshotFilter === f ? '#fff' : '#64748b',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {f === 'AGING' ? `Aging (${agingUnits.length})` : f}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search part or serial..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                style={{
                  padding: '5px 10px 5px 30px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12px',
                  width: '200px'
                }}
              />
            </div>
          </div>
        </div>

        {groupedInventory.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
            <Boxes size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No matching parts found in DC stock</div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 14px' }}>
              Scan barcodes or import parts manifest to register inventory into DC stock.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('scan-in')}>
              Receive Parts (F1)
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <table className="table" style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ width: '50px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>#</th>
                  <th style={{ width: '140px', padding: '10px 12px', whiteSpace: 'nowrap' }}>PART NUMBER</th>
                  <th style={{ padding: '10px 12px' }}>DESCRIPTION</th>
                  <th style={{ width: '130px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>CATEGORY</th>
                  <th style={{ width: '110px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>IN-STOCK</th>
                  <th style={{ width: '160px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>DC AGING STATUS</th>
                  <th style={{ width: '170px', textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>RECENT SERIAL</th>
                </tr>
              </thead>
              <tbody>
                {groupedInventory.map((item, idx) => (
                  <tr key={item.part_number} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                    <td style={{ textAlign: 'center', color: '#64748b', padding: '10px 12px', whiteSpace: 'nowrap' }}>{idx + 1}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0f172a', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {item.part_number}
                    </td>
                    <td style={{ color: '#334155', padding: '10px 12px' }}>
                      {item.description}
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span className="badge" style={{ background: '#f1f5f9', color: '#475569', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {String(item.category).replace('cat-', '').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span className="badge badge-primary" style={{ fontWeight: 800, fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {item.units.length} units
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {item.maxDaysInDc >= 4 ? (
                        <span
                          className="badge"
                          style={{
                            background: '#fffbeb',
                            color: '#b45309',
                            border: '1px solid #fde68a',
                            fontWeight: 700,
                            fontSize: '11px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <AlertTriangle size={11} /> {item.maxDaysInDc}d in DC (Aging)
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{
                            background: '#ecfdf5',
                            color: '#047857',
                            border: '1px solid #a7f3d0',
                            fontWeight: 600,
                            fontSize: '11px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <CheckCircle2 size={11} /> {item.maxDaysInDc}d in DC (Fresh)
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#475569', padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {item.latest_serial || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
