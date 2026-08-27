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
  Layers,
  Sparkles,
  Search,
  Building2,
  ChevronRight,
  Calendar,
  Check,
  RefreshCw
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
import { CATEGORY_COLORS } from '../constants/config';

export default function Dashboard() {
  const {
    inventoryUnits,
    forecastItems,
    shipments,
    dcIntakeRecords,
    parts,
    sites,
    currentUser,
    activePeriod,
    setActiveTab,
    isAutoRefreshing,
    autoRefreshData,
    selectedCategory,
    activePackDraft
  } = useApp();

  const [tableSearch, setTableSearch] = useState('');
  const [activeSnapshotFilter, setActiveSnapshotFilter] = useState('ALL');

  // Filter parts based on global top header category
  const isUnfiltered = !selectedCategory || selectedCategory === 'ALL';
  const filteredParts = useMemo(() => {
    return (parts || []).filter(p => {
      if (isUnfiltered) return true;
      const cat = String(p.category_id || '').toUpperCase();
      const desc = String(p.description || '').toUpperCase();
      if (selectedCategory === 'BATTERY') return cat.includes('BATTERY') || desc.includes('BATTERY');
      if (selectedCategory === 'DISPLAY') return cat.includes('DISPLAY') || desc.includes('DISPLAY') || desc.includes('SCREEN');
      if (selectedCategory === 'CAMERA') return cat.includes('CAMERA') || desc.includes('CAMERA');
      if (selectedCategory === 'BACK_GLASS') return cat.includes('BACKGLASS') || cat.includes('BACK_GLASS') || desc.includes('BACK GLASS') || desc.includes('REAR');
      return true;
    });
  }, [parts, selectedCategory, isUnfiltered]);

  const filteredPartNumbers = useMemo(() => new Set(filteredParts.map(p => p.part_number?.trim().toUpperCase())), [filteredParts]);
  const filteredPartIds = useMemo(() => new Set(filteredParts.map(p => p.id)), [filteredParts]);

  // Serials that are currently in an active packing list draft or saved/dispatched shipments
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

  // Active in-stock units
  const availableInStockUnits = useMemo(() => {
    return (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      if (cleanSerial && packedSerialsSet.has(cleanSerial)) return false;
      if (u.status === 'packed' || u.status === 'shipped' || u.status === 'dispatched' || u.status === 'allocated') return false;
      const isStock = u.status === 'in_stock' || (!u.status && u.current_site_id === 'site-dc');
      if (!isStock) return false;
      if (isUnfiltered) return true;
      const cleanPN = String(u.part_number || '').trim().toUpperCase();
      return filteredPartNumbers.has(cleanPN) || filteredPartIds.has(u.part_id);
    });
  }, [inventoryUnits, packedSerialsSet, isUnfiltered, filteredPartNumbers, filteredPartIds]);

  const packedUnits = useMemo(() => {
    return (inventoryUnits || []).filter(u => {
      const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
      return u.status === 'packed' || u.status === 'shipped' || u.status === 'allocated' || (cleanSerial && packedSerialsSet.has(cleanSerial));
    });
  }, [inventoryUnits, packedSerialsSet]);

  // Total forecast
  const totalForecast = useMemo(() => {
    return (forecastItems || [])
      .filter(f => isUnfiltered || filteredPartNumbers.has(f.part_number?.trim().toUpperCase()) || filteredPartIds.has(f.part_id))
      .reduce((sum, f) => sum + (f.final_forecast || f.computed_forecast || 0), 0);
  }, [forecastItems, isUnfiltered, filteredPartNumbers, filteredPartIds]);

  // Category distribution data for charts
  const categoryStats = useMemo(() => {
    const counts = { DISPLAY: 0, BATTERY: 0, CAMERA: 0, BACK_GLASS: 0, OTHER: 0 };
    availableInStockUnits.forEach(u => {
      const pn = String(u.part_number || '').toUpperCase();
      const desc = String(u.description || '').toUpperCase();
      const part = parts.find(p => p.part_number?.toUpperCase() === pn);
      const cat = String(part?.category_id || '').toUpperCase();

      if (cat.includes('DISPLAY') || desc.includes('DISPLAY') || desc.includes('SCREEN')) {
        counts.DISPLAY++;
      } else if (cat.includes('BATTERY') || desc.includes('BATTERY')) {
        counts.BATTERY++;
      } else if (cat.includes('CAMERA') || desc.includes('CAMERA')) {
        counts.CAMERA++;
      } else if (cat.includes('BACKGLASS') || cat.includes('BACK_GLASS') || desc.includes('BACK GLASS')) {
        counts.BACK_GLASS++;
      } else {
        counts.OTHER++;
      }
    });

    const chartData = [
      { name: 'Displays', key: 'DISPLAY', count: counts.DISPLAY, color: CATEGORY_COLORS.DISPLAY },
      { name: 'Batteries', key: 'BATTERY', count: counts.BATTERY, color: CATEGORY_COLORS.BATTERY },
      { name: 'Cameras', key: 'CAMERA', count: counts.CAMERA, color: CATEGORY_COLORS.CAMERA },
      { name: 'Back Glass', key: 'BACK_GLASS', count: counts.BACK_GLASS, color: CATEGORY_COLORS.BACK_GLASS },
      { name: 'Mid/Rear', key: 'OTHER', count: counts.OTHER, color: CATEGORY_COLORS.MID_REAR }
    ].filter(item => item.count > 0 || availableInStockUnits.length === 0);

    return { counts, chartData };
  }, [availableInStockUnits, parts]);

  // Demand vs Stock Comparison Data
  const demandComparisonData = useMemo(() => {
    const categories = [
      { name: 'Displays', catKey: 'DISPLAY' },
      { name: 'Batteries', catKey: 'BATTERY' },
      { name: 'Cameras', catKey: 'CAMERA' },
      { name: 'Back Glass', catKey: 'BACK_GLASS' }
    ];

    return categories.map(c => {
      // Stock count
      const inStock = categoryStats.counts[c.catKey] || 0;

      // Forecast count
      const forecastCount = (forecastItems || []).filter(f => {
        const desc = String(f.description || '').toUpperCase();
        const cat = String(f.category_id || '').toUpperCase();
        if (c.catKey === 'DISPLAY') return cat.includes('DISPLAY') || desc.includes('DISPLAY');
        if (c.catKey === 'BATTERY') return cat.includes('BATTERY') || desc.includes('BATTERY');
        if (c.catKey === 'CAMERA') return cat.includes('CAMERA') || desc.includes('CAMERA');
        if (c.catKey === 'BACK_GLASS') return cat.includes('BACKGLASS') || desc.includes('BACK GLASS');
        return false;
      }).reduce((sum, it) => sum + (it.final_forecast || it.computed_forecast || 0), 0);

      return {
        category: c.name,
        'In Stock': inStock,
        'Demand Forecast': forecastCount || (inStock > 0 ? inStock * 2 : 10)
      };
    });
  }, [categoryStats, forecastItems]);

  // Grouped Stock Inventory by Part Number for Snapshot Table
  const groupedInventory = useMemo(() => {
    const map = new Map();
    availableInStockUnits.forEach(u => {
      const pn = String(u.part_number || '').toUpperCase();
      if (!map.has(pn)) {
        const partObj = parts.find(p => p.part_number?.toUpperCase() === pn);
        map.set(pn, {
          part_number: pn,
          description: u.description || partObj?.description || 'Service Replacement Part',
          category: partObj?.category_id || 'GENERAL',
          units: [],
          latest_received_at: u.received_at,
          latest_serial: u.serial_number
        });
      }
      const entry = map.get(pn);
      entry.units.push(u);
      if (new Date(u.received_at || 0) > new Date(entry.latest_received_at || 0)) {
        entry.latest_received_at = u.received_at;
        entry.latest_serial = u.serial_number;
      }
    });

    let list = Array.from(map.values()).sort((a, b) => b.units.length - a.units.length);

    if (activeSnapshotFilter !== 'ALL') {
      list = list.filter(item => {
        const desc = String(item.description).toUpperCase();
        const cat = String(item.category).toUpperCase();
        if (activeSnapshotFilter === 'DISPLAY') return cat.includes('DISPLAY') || desc.includes('DISPLAY');
        if (activeSnapshotFilter === 'BATTERY') return cat.includes('BATTERY') || desc.includes('BATTERY');
        if (activeSnapshotFilter === 'CAMERA') return cat.includes('CAMERA') || desc.includes('CAMERA');
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

  const coveragePct = totalForecast > 0
    ? Math.min(Math.round((availableInStockUnits.length / totalForecast) * 100), 100)
    : (availableInStockUnits.length > 0 ? 100 : 0);

  const totalIntakeUnitsReceived = (dcIntakeRecords || []).reduce((sum, r) => sum + (r.total_units || (r.items ? r.items.length : 0)), 0);
  const recentIntakes = (dcIntakeRecords || []).slice(0, 5);
  const recentShipments = (shipments || []).slice(0, 5);

  return (
    <div className="dashboard-view" style={{ animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* 1. Executive Operations Header Banner */}
      <div
        className="card"
        style={{
          marginBottom: '22px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          border: '1px solid #334155',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.4)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h2 style={{ color: '#fff', fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                Distribution Center Operations
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
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
              Logged in as <strong style={{ color: '#f1f5f9' }}>{currentUser?.fullName || 'Zhon Manaois'}</strong> {currentUser?.rolePosition ? `(${currentUser.rolePosition})` : ''} • Mobile Care Services Phils. Inc. Central Distribution Hub
            </p>
          </div>

          {/* System Telemetry Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'Dashboard manual refresh' })}
              disabled={isAutoRefreshing}
              title="Force reload all operational data from database"
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
              <span>{isAutoRefreshing ? 'Syncing...' : 'Refresh'}</span>
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

      {/* 2. Elevated Top KPI Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '18px',
          marginBottom: '24px'
        }}
      >
        {/* KPI 1: DC Available In-Stock */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #0284c7',
            cursor: 'pointer',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease'
          }}
          onClick={() => setActiveTab('scan-in')}
          title="Click to open Receive Scan-In Station"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">DC In-Stock Inventory</span>
            <div style={{ padding: '8px', background: '#e0f2fe', borderRadius: '8px', color: '#0284c7' }}>
              <Boxes size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {availableInStockUnits.length.toLocaleString()} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>units</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#0284c7', fontWeight: 700 }}>
              {categoryStats.counts.DISPLAY} Displays
            </span>{' '}
            • {categoryStats.counts.BATTERY} Batteries • {categoryStats.counts.CAMERA} Cameras
          </div>
          {/* Visual Mini Capacity Bar */}
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(availableInStockUnits.length * 3, 100)}%`, background: '#0284c7' }} />
          </div>
        </div>

        {/* KPI 2: Total Demand Forecast */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #10b981',
            cursor: 'pointer'
          }}
          onClick={() => setActiveTab('forecast')}
          title="Click to open Demand Forecasting"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Monthly Demand Target</span>
            <div style={{ padding: '8px', background: '#dcfce7', borderRadius: '8px', color: '#10b981' }}>
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {totalForecast.toLocaleString()} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>units</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#047857', fontWeight: 700 }}>
              {coveragePct}% Covered
            </span>{' '}
            across 26 Service Hubs
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${coveragePct}%`, background: '#10b981' }} />
          </div>
        </div>

        {/* KPI 3: Inbound Batches & Intake Manifests */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #8b5cf6',
            cursor: 'pointer'
          }}
          onClick={() => setActiveTab('intake-records')}
          title="Click to view DC Intake Records"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Intake Records Saved</span>
            <div style={{ padding: '8px', background: '#ede9fe', borderRadius: '8px', color: '#8b5cf6' }}>
              <Barcode size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {(dcIntakeRecords || []).length} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>manifests</span>
          </div>
          <div className="kpi-sub">
            <span style={{ color: '#6d28d9', fontWeight: 700 }}>
              {totalIntakeUnitsReceived.toLocaleString()} units
            </span>{' '}
            received & database persisted
          </div>
          <div style={{ height: '4px', width: '100%', background: '#e2e8f0', borderRadius: '4px', marginTop: '6px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: '#8b5cf6' }} />
          </div>
        </div>

        {/* KPI 4: Outbound Packing Lists */}
        <div
          className="kpi-card"
          style={{
            borderLeft: '4px solid #f59e0b',
            cursor: 'pointer'
          }}
          onClick={() => setActiveTab('shipments')}
          title="Click to view Outbound Packing Lists"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="kpi-title">Outbound Packing Lists</span>
            <div style={{ padding: '8px', background: '#fef3c7', borderRadius: '8px', color: '#f59e0b' }}>
              <Truck size={20} />
            </div>
          </div>
          <div className="kpi-value" style={{ color: '#0f172a', fontSize: '32px' }}>
            {(shipments || []).length} <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 500 }}>shipments</span>
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
      </div>

      {/* 3. Analytics Intelligence Row: Category Breakdown Donut & Stock vs Demand Bar Chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: '20px', marginBottom: '24px' }}>
        {/* Left Chart: Stock by Category Donut */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>DC Stock by Category</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Live distribution of available parts in warehouse
              </p>
            </div>
            <span className="badge badge-primary">{availableInStockUnits.length} Total Units</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '220px' }}>
            <div style={{ width: '55%', height: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryStats.chartData.length > 0 ? categoryStats.chartData : [{ name: 'Empty', count: 1, color: '#e2e8f0' }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={3}
                    dataKey="count"
                  >
                    {categoryStats.chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} units`, name]}
                    contentStyle={{ background: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Custom Legend & Count Stats */}
            <div style={{ width: '42%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {categoryStats.chartData.map(item => {
                const pct = availableInStockUnits.length > 0 ? Math.round((item.count / availableInStockUnits.length) * 100) : 0;
                return (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: item.color }} />
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{item.name}</span>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      <strong>{item.count}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Chart: Demand vs Stock Fulfillment */}
        <div className="card" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Stock vs Monthly Demand Target</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Inventory readiness versus forecasted consumption
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('allocation')}>
              <span>Allocation Matrix</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          <div style={{ height: '220px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={demandComparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11.5px', paddingTop: '6px' }} />
                <Bar dataKey="In Stock" fill="#0284c7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Demand Forecast" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 4. Quick Workstation Launchpad */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} color="var(--primary)" />
          Quick Workstation Launchpad
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          
          {/* Tile 1: Scan-In Station */}
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

          {/* Tile 2: Pack Scan-Out */}
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
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Generate corporate packing list & PDF</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          {/* Tile 3: DC Intake Records */}
          <div
            onClick={() => setActiveTab('intake-records')}
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
              <Layers size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>DC Parts Stock Records</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Review saved batches & in-stock manifests</div>
            </div>
            <ChevronRight size={16} color="#94a3b8" />
          </div>

          {/* Tile 4: Allocation Matrix */}
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
            <div style={{ padding: '12px', background: '#0284c7', color: '#fff', borderRadius: '10px' }}>
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

      {/* 5. 2-Column Live Operational Feeds: Intake Records & Recent Shipments */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px', marginBottom: '24px' }}>
        
        {/* Left Column: DC Intake Records (Live Batches) */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Recent DC Parts Stock Records</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Batches scanned and saved into permanent cloud storage
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('intake-records')}>
              <span>View All ({dcIntakeRecords?.length || 0})</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          {recentIntakes.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <Barcode size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No Intake Records Saved Yet</div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 12px' }}>
                Scan parts in the Receive station and save an intake record batch.
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('scan-in')}>
                Receive Scan-In (F1)
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentIntakes.map(rec => (
                <div
                  key={rec.id}
                  onClick={() => setActiveTab('intake-records')}
                  style={{
                    padding: '12px 14px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: '13px', color: '#0f172a', fontFamily: 'var(--font-mono)' }}>{rec.id}</strong>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#334155' }}>{rec.record_name}</span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                      {rec.intake_date} • Saved by {rec.saved_by_name || 'Warehouse Staff'}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 700, fontSize: '12px' }}>
                      {rec.total_units || rec.items?.length || 0} units
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Recent Outbound Shipments / Packing Lists */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Recent Packing Lists</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Exported manifests for branch delivery
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('shipments')}>
              <span>View All ({shipments?.length || 0})</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          {recentShipments.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
              <Truck size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a' }}>No Packing Lists Generated Yet</div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 12px' }}>
                Scan serialized parts to generate delivery manifests for service branches.
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('scan-out')}>
                Open Pack Scan-Out (F2)
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentShipments.map(sh => {
                const destSite = sites.find(s => s.id === sh.site_id) || {};
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
                      background: '#ffffff'
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
                      <span className="badge badge-success" style={{ fontSize: '11px' }}>{sh.status}</span>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        onClick={() => generatePackingListPDF(sh, sh.items, destSite)}
                        title="Download Google Sheets styled PDF"
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
      </div>

      {/* 6. Live DC Stock Inventory Snapshot Table */}
      <div className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>DC Stock Inventory Snapshot</h3>
              <span className="badge" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
                <Check size={11} style={{ display: 'inline', marginRight: '3px' }} />
                Real-Time Synced
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Aggregated stock counts by part SKU currently available in Distribution Center
            </p>
          </div>

          {/* Table Filters & Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
              {['ALL', 'DISPLAY', 'BATTERY', 'CAMERA'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveSnapshotFilter(f)}
                  style={{
                    border: 'none',
                    background: activeSnapshotFilter === f ? '#0284c7' : 'transparent',
                    color: activeSnapshotFilter === f ? '#fff' : '#64748b',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {f}
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
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                  <th style={{ width: '140px' }}>PART NUMBER</th>
                  <th>DESCRIPTION</th>
                  <th style={{ width: '130px', textAlign: 'center' }}>CATEGORY</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>IN-STOCK</th>
                  <th style={{ width: '170px', textAlign: 'center' }}>RECENT SERIAL</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {groupedInventory.map((item, idx) => (
                  <tr key={item.part_number} style={{ transition: 'background 0.1s ease' }}>
                    <td style={{ textAlign: 'center', color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0f172a' }}>
                      {item.part_number}
                    </td>
                    <td style={{ color: '#334155' }}>
                      {item.description}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge" style={{ background: '#f1f5f9', color: '#475569', fontSize: '11px' }}>
                        {String(item.category).replace('cat-', '').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge badge-primary" style={{ fontWeight: 800, fontSize: '12px' }}>
                        {item.units.length} units
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#475569' }}>
                      {item.latest_serial || '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => setActiveTab('scan-out')}
                        title="Add to packing list"
                      >
                        Pack Part
                      </button>
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

