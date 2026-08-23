import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { exportAllocationToExcel } from '../utils/excelParser';
import { exportAllocationToPDF, printAllocationMatrixDirect } from '../utils/pdfGenerator';
import { calculateWeeklySplit } from '../utils/allocationEngine';
import { CANONICAL_SITE_CODES } from '../constants/config';
import SaveRecordModal from './SaveRecordModal';
import {
  Split,
  Download,
  Printer,
  FileText,
  UploadCloud,
  Layers,
  DollarSign,
  Package,
  Building2,
  CheckCircle2,
  Smartphone,
  BatteryCharging,
  BookmarkPlus,
  RefreshCw
} from 'lucide-react';

export default function AllocationMatrix() {
  const {
    allocations,
    sites,
    parts,
    selectedCategory,
    updateSiteAllocation,
    setActiveTab,
    isAutoRefreshing,
    lastSyncedAt,
    autoRefreshData,
    showToast,
    activePeriod
  } = useApp();

  const [activeViewMode, setActiveViewMode] = useState('sheet'); // 'sheet' | 'shares'
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Sort and filter service sites to match canonical Google Sheet order
  const nonDcSites = sites.filter(s =>
    !s.is_dc &&
    !s.code.toUpperCase().includes('DC') &&
    !s.code.toUpperCase().includes('MOBILEC') &&
    !s.name.toLowerCase().includes('distribution') &&
    s.code !== 'DC-MDC'
  );

  const orderedServiceSites = [...nonDcSites].sort((a, b) => {
    const idxA = CANONICAL_SITE_CODES.findIndex(c => c.includes(a.code) || a.code.includes(c) || a.name.includes(c));
    const idxB = CANONICAL_SITE_CODES.findIndex(c => c.includes(b.code) || b.code.includes(b) || b.name.includes(c));
    if (idxA >= 0 && idxB >= 0) return idxA - idxB;
    if (idxA >= 0) return -1;
    if (idxB >= 0) return 1;
    return a.code.localeCompare(b.code);
  }).filter((s, idx, arr) => arr.findIndex(x => x.code === s.code) === idx);

  // Filter items by category
  const filteredAllocations = allocations.filter(item => {
    const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
    if (!part) return true;
    if (selectedCategory === 'ALL') return true;
    if (selectedCategory === 'BATTERY') return part.category_id === 'cat-battery';
    if (selectedCategory === 'DISPLAY') return part.category_id === 'cat-display';
    if (selectedCategory === 'CAMERA') return part.category_id === 'cat-camera';
    if (selectedCategory === 'BACK_GLASS') return part.category_id === 'cat-backglass';
    return true;
  });

  // Split into Displays, Batteries, and Other
  const displayItems = filteredAllocations.filter(item => {
    const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
    return (part?.category_id === 'cat-display') || item.category_id === 'cat-display' || item.description?.toLowerCase().includes('display') || item.description?.toLowerCase().includes('screen');
  });

  const batteryItems = filteredAllocations.filter(item => {
    const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
    return (part?.category_id === 'cat-battery') || item.category_id === 'cat-battery' || (!displayItems.includes(item) && (item.description?.toLowerCase().includes('battery') || item.description?.toLowerCase().includes('batt')));
  });

  const otherItems = filteredAllocations.filter(item => !displayItems.includes(item) && !batteryItems.includes(item));

  // Calculate Group Summaries
  const calculateGroupTotals = (items, fallbackPrice = 150) => {
    let totalAlloc = 0;
    let totalCost = 0;
    let w1Qty = 0, w2Qty = 0, w3Qty = 0, w4Qty = 0;
    let w1Cost = 0, w2Cost = 0, w3Cost = 0, w4Cost = 0;
    const siteTotals = {};

    items.forEach((item, rIdx) => {
      const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
      const stockPrice = item.stocking_price || part?.stocking_price || fallbackPrice;
      const qty = item.total_allocated_qty || 0;
      const rowCost = qty * stockPrice;
      const split = calculateWeeklySplit(qty, rowCost, rIdx + 3);

      totalAlloc += qty;
      totalCost += rowCost;
      w1Qty += split.w1_qty;
      w2Qty += split.w2_qty;
      w3Qty += split.w3_qty;
      w4Qty += split.w4_qty;
      w1Cost += split.w1_cost;
      w2Cost += split.w2_cost;
      w3Cost += split.w3_cost;
      w4Cost += split.w4_cost;

      orderedServiceSites.forEach(s => {
        const branchQty = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
        siteTotals[s.id] = (siteTotals[s.id] || 0) + branchQty;
      });
    });

    return {
      totalAlloc,
      totalQty: totalAlloc,
      totalCost,
      w1Qty,
      totalW1: w1Qty,
      w2Qty,
      totalW2: w2Qty,
      w3Qty,
      totalW3: w3Qty,
      w4Qty,
      totalW4: w4Qty,
      w1Cost,
      totalW1Cost: w1Cost,
      w2Cost,
      totalW2Cost: w2Cost,
      w3Cost,
      totalW3Cost: w3Cost,
      w4Cost,
      totalW4Cost: w4Cost,
      siteTotals,
      perSite: siteTotals
    };
  };

  const displayTotals = calculateGroupTotals(displayItems, 279);
  const batteryTotals = calculateGroupTotals(batteryItems, 99);
  const otherTotals = calculateGroupTotals(otherItems, 100);

  const grandGroupTotals = {
    totalAlloc: displayTotals.totalAlloc + batteryTotals.totalAlloc + otherTotals.totalAlloc,
    totalCost: displayTotals.totalCost + batteryTotals.totalCost + otherTotals.totalCost,
    totalW1: displayTotals.w1Qty + batteryTotals.w1Qty + otherTotals.w1Qty,
    totalW2: displayTotals.w2Qty + batteryTotals.w2Qty + otherTotals.w2Qty,
    totalW3: displayTotals.w3Qty + batteryTotals.w3Qty + otherTotals.w3Qty,
    totalW4: displayTotals.w4Qty + batteryTotals.w4Qty + otherTotals.w4Qty,
    w1Qty: displayTotals.w1Qty + batteryTotals.w1Qty + otherTotals.w1Qty,
    w2Qty: displayTotals.w2Qty + batteryTotals.w2Qty + otherTotals.w2Qty,
    w3Qty: displayTotals.w3Qty + batteryTotals.w3Qty + otherTotals.w3Qty,
    w4Qty: displayTotals.w4Qty + batteryTotals.w4Qty + otherTotals.w4Qty,
    totalW1Cost: displayTotals.w1Cost + batteryTotals.w1Cost + otherTotals.w1Cost,
    totalW2Cost: displayTotals.w2Cost + batteryTotals.w2Cost + otherTotals.w2Cost,
    totalW3Cost: displayTotals.w3Cost + batteryTotals.w3Cost + otherTotals.w3Cost,
    totalW4Cost: displayTotals.w4Cost + batteryTotals.w4Cost + otherTotals.w4Cost,
    w1Cost: displayTotals.w1Cost + batteryTotals.w1Cost + otherTotals.w1Cost,
    w2Cost: displayTotals.w2Cost + batteryTotals.w2Cost + otherTotals.w2Cost,
    w3Cost: displayTotals.w3Cost + batteryTotals.w3Cost + otherTotals.w3Cost,
    w4Cost: displayTotals.w4Cost + batteryTotals.w4Cost + otherTotals.w4Cost
  };

  const totalAllocatedAllParts = grandGroupTotals.totalAlloc;

  const siteTotals = {};
  orderedServiceSites.forEach(s => {
    siteTotals[s.id] = (displayTotals.siteTotals[s.id] || 0) + (batteryTotals.siteTotals[s.id] || 0) + (otherTotals.siteTotals[s.id] || 0);
  });

  const siteCostTotals = {};
  orderedServiceSites.forEach(s => {
    let sumCost = 0;
    filteredAllocations.forEach(item => {
      const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
      const isDisp = item.category_id === 'cat-display' || item.description?.toLowerCase().includes('display');
      const fallbackPrice = isDisp ? 279 : 99;
      const qty = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
      const price = item.stocking_price || part?.stocking_price || fallbackPrice;
      sumCost += qty * price;
    });
    siteCostTotals[s.id] = sumCost;
  });

  const grandTotalCost = grandGroupTotals.totalCost;

  const handleExport = async () => {
    if (filteredAllocations.length === 0) {
      showToast('No allocations available to export', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    await exportAllocationToExcel(filteredAllocations, orderedServiceSites, currentPeriodLabel);
    showToast(`Exported Master Allocation (${currentPeriodLabel}) with corporate colors and styles to Excel (.xlsx)`, 'success');
  };

  const handleDownloadPDF = () => {
    if (filteredAllocations.length === 0) {
      showToast('No allocations available to export', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    exportAllocationToPDF(filteredAllocations, orderedServiceSites, currentPeriodLabel);
    showToast(`Exported Master Allocation Matrix (${currentPeriodLabel}) to PDF`, 'success');
  };

  const handlePrint = () => {
    if (filteredAllocations.length === 0) {
      showToast('No allocations available to print', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    printAllocationMatrixDirect(filteredAllocations, orderedServiceSites, currentPeriodLabel);
  };

  const renderItemRow = (item, commodityLabel, index, excelRowNumber = 3) => {
    const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
    const fallbackPrice = commodityLabel === 'DISPLAY' ? 279 : 99;
    const stockPrice = item.stocking_price || part?.stocking_price || fallbackPrice;
    const totalStockPrice = (item.total_allocated_qty || 0) * stockPrice;
    const split = calculateWeeklySplit(item.total_allocated_qty, totalStockPrice, excelRowNumber);
    const isOrderRequired = (item.total_allocated_qty || 0) > 0;
    const rowBg = isOrderRequired ? '#ffffff' : '#fef2f2';

    return (
      <tr key={item.part_id || item.part_number} style={{ background: rowBg }}>
        {/* Sticky 1: Commodity Label */}
        <td className="matrix-col-sticky-1" style={{ background: rowBg, textAlign: 'center' }}>
          <span style={{
            display: 'inline-block',
            fontSize: '10.5px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '4px',
            background: commodityLabel === 'DISPLAY' ? '#e0f2fe' : commodityLabel === 'BATTERY' ? '#dcfce7' : '#f1f5f9',
            color: commodityLabel === 'DISPLAY' ? '#0369a1' : commodityLabel === 'BATTERY' ? '#15803d' : '#475569',
            letterSpacing: '0.02em'
          }}>
            {commodityLabel}
          </span>
        </td>

        {/* Sticky 2: Part # */}
        <td className="matrix-col-sticky-2 font-mono" style={{ background: rowBg, fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
          {item.part_number}
        </td>

        {/* Sticky 3: Description */}
        <td className="matrix-col-sticky-3" style={{ background: rowBg, color: '#1e293b', fontSize: '12px', fontWeight: 500 }}>
          {item.description}
        </td>

        {/* Stock Price */}
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
          ${stockPrice.toFixed(2)}
        </td>

        {/* 26 Site Branch Quantities or Shares */}
        {activeViewMode === 'shares' ? (
          orderedServiceSites.map(s => {
            const qty = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
            const share = item.total_allocated_qty > 0 ? ((qty / item.total_allocated_qty) * 100).toFixed(1) : '0.0';
            const hasShare = qty > 0;
            return (
              <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: hasShare ? 700 : 400, color: hasShare ? '#0284c7' : '#94a3b8' }}>
                {share}%
              </td>
            );
          })
        ) : (
          orderedServiceSites.map(s => {
            const qty = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
            const hasValue = qty > 0;
            return (
              <td key={s.id} style={{ textAlign: 'center', padding: '3px 2px' }}>
                <input
                  type="number"
                  className={`matrix-cell-input ${hasValue ? 'has-value' : 'is-zero'}`}
                  value={qty === 0 ? '' : qty}
                  placeholder="0"
                  onChange={(e) => updateSiteAllocation(item.part_id, s.id, e.target.value)}
                />
              </td>
            );
          })
        )}

        {/* Total Alloc */}
        <td style={{
          textAlign: 'center',
          fontWeight: 800,
          fontFamily: 'var(--font-mono)',
          fontSize: '12.5px',
          background: isOrderRequired ? '#e0f2fe' : '#fee2e2',
          color: isOrderRequired ? '#0369a1' : '#b91c1c'
        }}>
          {item.total_allocated_qty || 0}
        </td>

        {/* Total Value */}
        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#0f172a' }}>
          ${totalStockPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>

        {/* 4-Week Split: Parts Alloc & Total Price for each Week */}
        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w1_qty}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w1_cost.toFixed(2)}</td>
        
        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w2_qty}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w2_cost.toFixed(2)}</td>
        
        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w3_qty}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w3_cost.toFixed(2)}</td>
        
        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w4_qty}</td>
        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w4_cost.toFixed(2)}</td>

        {/* Remarks Badge */}
        <td style={{ textAlign: 'center' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: '999px',
              whiteSpace: 'nowrap',
              letterSpacing: '0.03em',
              display: 'inline-block',
              background: isOrderRequired ? '#dcfce7' : '#f1f5f9',
              color: isOrderRequired ? '#15803d' : '#64748b',
              border: isOrderRequired ? '1px solid #86efac' : '1px solid #cbd5e1'
            }}
          >
            {isOrderRequired ? 'ORDER REQUIRED' : 'NO NEED TO ORDER'}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div className="allocation-view" style={{ maxWidth: '100%' }}>
      {/* Header & Controls Card */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: '#e0f2fe',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Split size={18} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                    Master Parts Allocation Matrix
                  </h3>
                  <span
                    className="badge"
                    style={{
                      background: isAutoRefreshing ? '#f0f9ff' : '#ecfdf5',
                      color: isAutoRefreshing ? '#0284c7' : '#047857',
                      border: `1px solid ${isAutoRefreshing ? '#7dd3fc' : '#a7f3d0'}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11.5px',
                      padding: '3px 8px',
                      transition: 'all 0.2s ease'
                    }}
                    title={isAutoRefreshing ? "Auto-refreshing latest allocation matrix from database..." : "Allocation data is auto-refreshed on page visit and synchronized across all accounts"}
                  >
                    {isAutoRefreshing ? (
                      <>
                        <RefreshCw size={11} className="spin" />
                        <span>Auto-Refreshing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={11} />
                        <span>Live Synced</span>
                      </>
                    )}
                  </span>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, marginTop: '3px' }}>
                  Multi-site proportional distribution across 26 branches matching Google Sheet Master Allocation structure.
                  {lastSyncedAt && <span style={{ marginLeft: '8px', opacity: 0.8 }}>• Verified: {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Quick Manual Refresh Button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'AllocationMatrix manual refresh' })}
              disabled={isAutoRefreshing}
              title="Force reload latest allocation matrix from database"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, padding: '6px 14px' }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>

            {/* View Mode Switcher */}
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 'var(--radius-sm)', padding: '3px', border: '1px solid #e2e8f0' }}>
              <button
                className={`btn btn-sm ${activeViewMode === 'sheet' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveViewMode('sheet')}
                style={{ border: 'none', fontSize: '12px', padding: '5px 12px', fontWeight: 600 }}
                disabled={filteredAllocations.length === 0}
              >
                Full Master Matrix
              </button>
              <button
                className={`btn btn-sm ${activeViewMode === 'shares' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveViewMode('shares')}
                style={{ border: 'none', fontSize: '12px', padding: '5px 12px', fontWeight: 600 }}
                disabled={filteredAllocations.length === 0}
              >
                Site Share %
              </button>
            </div>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowSaveModal(true)}
              disabled={filteredAllocations.length === 0}
              title="Save current allocation matrix as a dated historical record"
              style={{ fontWeight: 600, padding: '6px 14px' }}
            >
              <BookmarkPlus size={14} />
              <span>Save as Record</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExport}
              disabled={filteredAllocations.length === 0}
              title="Download formatted Master Allocation Excel Spreadsheet (.xlsx)"
              style={{ fontWeight: 600, padding: '6px 14px' }}
            >
              <Download size={14} />
              <span>Export Excel</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDownloadPDF}
              disabled={filteredAllocations.length === 0}
              title="Download landscape corporate PDF of Master Allocation Matrix"
              style={{ fontWeight: 600, padding: '6px 14px' }}
            >
              <FileText size={14} />
              <span>Download PDF</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePrint}
              disabled={filteredAllocations.length === 0}
              title="Print formatted Master Allocation Matrix directly"
              style={{ fontWeight: 600, padding: '6px 14px' }}
            >
              <Printer size={14} />
              <span>Print Matrix</span>
            </button>
          </div>
        </div>

        {/* Save Record Modal Dialog */}
        {showSaveModal && (
          <SaveRecordModal
            isOpen={showSaveModal}
            onClose={() => setShowSaveModal(false)}
            defaultType="allocation"
          />
        )}

        {/* High Contrast KPI Summary Bar */}
        {filteredAllocations.length > 0 && (
          <div className="matrix-kpi-grid">
            <div className="matrix-kpi-card">
              <div className="matrix-kpi-icon-wrap" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <Package size={22} />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Total Parts Allocated
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: '#0369a1', fontFamily: 'var(--font-mono)' }}>
                  {totalAllocatedAllParts.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>units</span>
                </div>
              </div>
            </div>

            <div className="matrix-kpi-card">
              <div className="matrix-kpi-icon-wrap" style={{ background: '#f1f5f9', color: '#334155' }}>
                <Building2 size={22} />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Active Service Branches
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                  {orderedServiceSites.length} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>sites</span>
                </div>
              </div>
            </div>

            <div className="matrix-kpi-card">
              <div className="matrix-kpi-icon-wrap" style={{ background: '#dcfce7', color: '#15803d' }}>
                <DollarSign size={22} />
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Total Master Value
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', fontFamily: 'var(--font-mono)' }}>
                  ${grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Empty State or Master Matrix Grid */}
      {filteredAllocations.length === 0 ? (
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
            <Split size={30} />
          </div>
          <h3 style={{ fontSize: '18px', marginBottom: '8px', color: 'var(--text-main)' }}>
            No Master Allocations Yet
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 20px', lineHeight: 1.5 }}>
            Upload your masterlist / allocation file in Fixably / GSX Data Import to populate the 26-site allocation grid and 4-week splits.
          </p>
          <button className="btn btn-primary" onClick={() => setActiveTab('import')}>
            <UploadCloud size={16} />
            <span>Go to Fixably / GSX Data Import</span>
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: '1px solid #cbd5e1' }}>
          <div className="allocation-matrix-container">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th className="matrix-th-sticky-1" style={{ width: '80px', minWidth: '80px', textAlign: 'center' }}>
                    Commodity
                  </th>
                  <th className="matrix-th-sticky-2" style={{ width: '100px', minWidth: '100px' }}>
                    Part #
                  </th>
                  <th className="matrix-th-sticky-3" style={{ minWidth: '240px', maxWidth: '280px' }}>
                    Description
                  </th>
                  <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#f8fafc', textAlign: 'right', zIndex: 12, minWidth: '85px' }}>
                    Stock Price
                  </th>

                  {/* 26 Site Branch Headers */}
                  {orderedServiceSites.map(s => (
                    <th
                      key={s.id}
                      style={{
                        position: 'sticky',
                        top: 0,
                        background: '#0f172a',
                        color: '#38bdf8',
                        textAlign: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '10px 4px',
                        whiteSpace: 'nowrap',
                        zIndex: 12,
                        minWidth: '46px'
                      }}
                      title={s.name}
                    >
                      {s.code}
                    </th>
                  ))}

                  <th style={{ position: 'sticky', top: 0, background: '#0369a1', color: '#ffffff', textAlign: 'center', zIndex: 12, minWidth: '80px', fontWeight: 700 }}>
                    Total Parts
                  </th>
                  <th style={{ position: 'sticky', top: 0, background: '#0284c7', color: '#ffffff', textAlign: 'right', zIndex: 12, minWidth: '110px', fontWeight: 700 }}>
                    Total Stock Price
                  </th>
                  <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W1 Qty</th>
                  <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W1 Total</th>
                  <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W2 Qty</th>
                  <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W2 Total</th>
                  <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W3 Qty</th>
                  <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W3 Total</th>
                  <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W4 Qty</th>
                  <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W4 Total</th>
                  <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '140px' }}>
                    Remarks
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* DISPLAY SECTION */}
                {displayItems.length > 0 && (
                  <>
                    <tr className="matrix-category-header">
                      <td colSpan={orderedServiceSites.length + 14}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Smartphone size={16} color="#0284c7" />
                          <span>DISPLAY COMMODITY</span>
                          <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                            {displayItems.length} Parts
                          </span>
                        </div>
                      </td>
                    </tr>
                    {displayItems.map((item, idx) => renderItemRow(item, 'DISPLAY', idx, idx + 3))}
                    {/* DISPLAY SUB-TOTAL (Matching Excel Row 24) */}
                    <tr style={{ background: '#f0f9ff', fontWeight: 700, borderTop: '2px solid #bae6fd', borderBottom: '2px solid #bae6fd' }}>
                      <td className="matrix-col-sticky-1 matrix-subtotal-td" style={{ background: '#f0f9ff', textAlign: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', background: '#0284c7', color: '#ffffff' }}>DISPLAY</span>
                      </td>
                      <td className="matrix-col-sticky-2 font-mono matrix-subtotal-td" style={{ background: '#f0f9ff', color: '#0369a1', fontSize: '11px', fontWeight: 800 }}>
                        SUB-TOTAL
                      </td>
                      <td className="matrix-col-sticky-3 matrix-subtotal-td" style={{ background: '#f0f9ff', color: '#0369a1', fontSize: '11.5px', fontWeight: 700 }}>
                        {displayItems.length} Parts Sub-Total
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '11px', color: '#64748b', background: '#f0f9ff' }}>—</td>
                      {orderedServiceSites.map(s => (
                        <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#0369a1', fontSize: '11px', fontWeight: 700, background: '#f0f9ff' }}>
                          {displayTotals.perSite[s.id] || 0}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', background: '#e0f2fe', color: '#0369a1', fontSize: '12.5px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                        {displayTotals.totalQty}
                      </td>
                      <td style={{ textAlign: 'right', color: '#0369a1', fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '11.5px', background: '#f0f9ff' }}>
                        ${displayTotals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW1}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW1Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW2}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW2Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW3}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW3Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW4}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW4Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ background: '#f0f9ff' }}></td>
                    </tr>
                  </>
                )}

                {/* BATTERY SECTION */}
                {batteryItems.length > 0 && (
                  <>
                    <tr className="matrix-category-header">
                      <td colSpan={orderedServiceSites.length + 14}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <BatteryCharging size={16} color="#15803d" />
                          <span>BATTERY COMMODITY</span>
                          <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                            {batteryItems.length} Parts
                          </span>
                        </div>
                      </td>
                    </tr>
                    {batteryItems.map((item, idx) => renderItemRow(item, 'BATTERY', idx, idx + 25))}
                    {/* BATTERY SUB-TOTAL (Matching Excel Row 43) */}
                    <tr style={{ background: '#f0fdf4', fontWeight: 700, borderTop: '2px solid #bbf7d0', borderBottom: '2px solid #bbf7d0' }}>
                      <td className="matrix-col-sticky-1 matrix-subtotal-td" style={{ background: '#f0fdf4', textAlign: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', background: '#16a34a', color: '#ffffff' }}>BATTERY</span>
                      </td>
                      <td className="matrix-col-sticky-2 font-mono matrix-subtotal-td" style={{ background: '#f0fdf4', color: '#15803d', fontSize: '11px', fontWeight: 800 }}>
                        SUB-TOTAL
                      </td>
                      <td className="matrix-col-sticky-3 matrix-subtotal-td" style={{ background: '#f0fdf4', color: '#15803d', fontSize: '11.5px', fontWeight: 700 }}>
                        {batteryItems.length} Parts Sub-Total
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '11px', color: '#64748b', background: '#f0fdf4' }}>—</td>
                      {orderedServiceSites.map(s => (
                        <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#15803d', fontSize: '11px', fontWeight: 700, background: '#f0fdf4' }}>
                          {batteryTotals.perSite[s.id] || 0}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', background: '#dcfce7', color: '#15803d', fontSize: '12.5px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                        {batteryTotals.totalQty}
                      </td>
                      <td style={{ textAlign: 'right', color: '#15803d', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '11.5px', background: '#f0fdf4' }}>
                        ${batteryTotals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW1}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW1Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW2}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW2Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW3}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW3Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW4}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW4Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ background: '#f0fdf4' }}></td>
                    </tr>
                  </>
                )}

                {/* OTHER ITEMS */}
                {otherItems.length > 0 && (
                  <>
                    <tr className="matrix-category-header">
                      <td colSpan={orderedServiceSites.length + 14}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Layers size={16} color="#64748b" />
                          <span>OTHER COMMODITIES</span>
                          <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                            {otherItems.length} Parts
                          </span>
                        </div>
                      </td>
                    </tr>
                    {otherItems.map((item, idx) => renderItemRow(item, 'OTHER', idx + displayItems.length + batteryItems.length))}
                  </>
                )}
              </tbody>

              {/* FOOTER TOTAL ROWS WITH MAXIMUM CONTRAST & LEGIBILITY */}
              <tfoot>
                {/* 1. Total Parts per Site Row */}
                <tr className="matrix-footer-row-1">
                  <td className="matrix-footer-sticky-1" style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '2px 5px', borderRadius: '3px', background: '#38bdf8', color: '#0f172a' }}>TOTAL</span>
                  </td>
                  <td className="matrix-footer-sticky-2 font-mono" style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 800 }}>
                    PARTS
                  </td>
                  <td className="matrix-footer-sticky-3" style={{ color: '#f8fafc', fontSize: '11px', fontWeight: 800 }}>
                    TOTAL PARTS PER SITE
                  </td>
                  <td style={{ textAlign: 'right', color: '#64748b', fontSize: '11px' }}>—</td>
                  {orderedServiceSites.map(s => (
                    <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#38bdf8', fontSize: '11.5px', fontWeight: 800 }}>
                      {siteTotals[s.id] || 0}
                    </td>
                  ))}
                  <td style={{ textAlign: 'center', background: '#0284c7', color: '#ffffff', fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                    {totalAllocatedAllParts}
                  </td>
                  <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    —
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW1}</td>
                  <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW2}</td>
                  <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW3}</td>
                  <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW4}</td>
                  <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: '#0284c7', color: '#ffffff' }}>TOTAL PLAN</span>
                  </td>
                </tr>

                {/* 2. Total Cost Breakdown per Site Row - FULLY HIGH-CONTRAST & READABLE */}
                <tr className="matrix-footer-row-2">
                  <td className="matrix-footer-sticky-1" style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '2px 5px', borderRadius: '3px', background: '#64748b', color: '#ffffff' }}>COST</span>
                  </td>
                  <td className="matrix-footer-sticky-2 font-mono" style={{ color: '#cbd5e1', fontSize: '10.5px', fontWeight: 700 }}>
                    VALUATION
                  </td>
                  <td className="matrix-footer-sticky-3" style={{ color: '#e2e8f0', fontSize: '11px', fontWeight: 700 }}>
                    TOTAL COST BREAKDOWN
                  </td>
                  <td style={{ textAlign: 'right', color: '#64748b', fontSize: '10px' }}>—</td>
                  {orderedServiceSites.map(s => (
                    <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: '#e2e8f0', fontWeight: 600, padding: '6px 2px' }}>
                      ${Math.round(siteCostTotals[s.id] || 0).toLocaleString()}
                    </td>
                  ))}
                  <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    —
                  </td>
                  <td style={{ textAlign: 'right', background: '#0369a1', color: '#ffffff', fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    ${grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W1</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW1Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W2</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW2Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W3</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW3Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W4</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW4Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'center', color: '#64748b', fontSize: '10.5px' }}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
