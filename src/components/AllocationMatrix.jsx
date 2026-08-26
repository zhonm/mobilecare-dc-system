import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { exportAllocationToExcel } from '../utils/excelParser';
import { exportAllocationToPDF, printAllocationMatrixDirect } from '../utils/pdfGenerator';
import { calculateWeeklySplit, calculateProportionalAllocation } from '../utils/allocationEngine';
import { CANONICAL_SITE_CODES } from '../constants/config';
import SaveRecordModal from './SaveRecordModal';
import ClearDataConfirmationModal from './ClearDataConfirmationModal';
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
  RefreshCw,
  Calendar,
  RotateCcw
} from 'lucide-react';

export default function AllocationMatrix() {
  const {
    allocations,
    setAllocations,
    forecastItems,
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

  // Auto-sync / generate initial allocations from forecastItems if allocations array is empty
  useEffect(() => {
    if ((!allocations || allocations.length === 0) && forecastItems && forecastItems.length > 0 && setAllocations) {
      const activeServiceSites = (sites || []).filter(s =>
        !s.is_dc &&
        !s.code?.toUpperCase().includes('DC') &&
        s.code !== 'DC-MDC'
      );
      if (activeServiceSites.length === 0) return;

      const generated = forecastItems.map((fi, rIdx) => {
        const fiQty = fi.final_forecast !== undefined ? fi.final_forecast : (fi.computed_forecast || 0);
        const fiPrice = fi.stocking_price || (fi.description?.toLowerCase().includes('display') ? 279 : 99);
        const fiDemands = activeServiceSites.map(s => ({ siteId: s.id, historicalDemand: 1 }));
        const fiResults = calculateProportionalAllocation(fiQty, fiDemands);
        const sq = {};
        let tAlloc = 0;
        fiResults.forEach(res => {
          sq[res.siteId] = res.allocatedQty;
          const siteObj = activeServiceSites.find(s => s.id === res.siteId);
          if (siteObj?.code) sq[siteObj.code] = res.allocatedQty;
          tAlloc += res.allocatedQty;
        });
        const tCost = tAlloc * fiPrice;
        const fiSplit = calculateWeeklySplit(tAlloc, tCost, rIdx + 3);
        return {
          part_id: fi.part_id,
          part_number: fi.part_number,
          description: fi.description,
          category_id: fi.category_id || (fi.description?.toLowerCase().includes('display') ? 'cat-display' : 'cat-battery'),
          forecasted_qty: fiQty,
          stocking_price: fiPrice,
          exchange_price: fi.exchange_price || 0,
          total_allocated_qty: tAlloc,
          total_stock_cost: tCost,
          w1_qty: fiSplit.w1_qty,
          w2_qty: fiSplit.w2_qty,
          w3_qty: fiSplit.w3_qty,
          w4_qty: fiSplit.w4_qty,
          w1_cost: fiSplit.w1_cost,
          w2_cost: fiSplit.w2_cost,
          w3_cost: fiSplit.w3_cost,
          w4_cost: fiSplit.w4_cost,
          site_quantities: sq
        };
      });

      setAllocations(generated);
      try { localStorage.setItem('mdc_allocations', JSON.stringify(generated)); } catch (e) {}
    }
  }, [allocations, forecastItems, sites, setAllocations]);

  // View Mode: 'sheet' (Master) | 'week-1' | 'week-2' | 'week-3' | 'week-4' | 'shares'
  const [activeViewMode, setActiveViewMode] = useState('sheet');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);

  const isWeeklyView = activeViewMode.startsWith('week-');
  const selectedWeekNum = isWeeklyView ? parseInt(activeViewMode.replace('week-', ''), 10) : 1;

  // Sort and filter service sites to match canonical Google Sheet order
  const nonDcSites = useMemo(() => {
    return (sites || []).filter(s =>
      !s.is_dc &&
      !s.code.toUpperCase().includes('DC') &&
      !s.code.toUpperCase().includes('MOBILEC') &&
      !s.name.toLowerCase().includes('distribution') &&
      s.code !== 'DC-MDC'
    );
  }, [sites]);

  const orderedServiceSites = useMemo(() => {
    return [...nonDcSites].sort((a, b) => {
      const idxA = CANONICAL_SITE_CODES.findIndex(c => c.includes(a.code) || a.code.includes(c) || a.name.includes(c));
      const idxB = CANONICAL_SITE_CODES.findIndex(c => c.includes(b.code) || b.code.includes(b) || b.name.includes(c));
      if (idxA >= 0 && idxB >= 0) return idxA - idxB;
      if (idxA >= 0) return -1;
      if (idxB >= 0) return 1;
      return a.code.localeCompare(b.code);
    }).filter((s, idx, arr) => arr.findIndex(x => x.code === s.code) === idx);
  }, [nonDcSites]);

  // Filter items by category
  const filteredAllocations = useMemo(() => {
    return (allocations || []).filter(item => {
      const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
      const catId = (item.category_id || part?.category_id || '').toLowerCase();
      const desc = (item.description || part?.description || '').toLowerCase();

      if (selectedCategory === 'ALL') return true;
      if (selectedCategory === 'BATTERY') return catId.includes('battery') || desc.includes('battery') || desc.includes('batt');
      if (selectedCategory === 'DISPLAY') return catId.includes('display') || desc.includes('display') || desc.includes('screen');
      if (selectedCategory === 'CAMERA') return catId.includes('camera') || desc.includes('camera') || desc.includes('cam');
      if (selectedCategory === 'BACK_GLASS') return catId.includes('backglass') || desc.includes('back') || desc.includes('rear glass');
      return true;
    });
  }, [allocations, parts, selectedCategory]);

  // Split into Displays, Batteries, and Other
  const displayItems = useMemo(() => {
    return filteredAllocations.filter(item => {
      const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
      const catId = (item.category_id || part?.category_id || '').toLowerCase();
      const desc = (item.description || part?.description || '').toLowerCase();
      return catId.includes('display') || desc.includes('display') || desc.includes('screen');
    });
  }, [filteredAllocations, parts]);

  const batteryItems = useMemo(() => {
    return filteredAllocations.filter(item => {
      const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
      const catId = (item.category_id || part?.category_id || '').toLowerCase();
      const desc = (item.description || part?.description || '').toLowerCase();
      return !displayItems.includes(item) && (catId.includes('battery') || desc.includes('battery') || desc.includes('batt'));
    });
  }, [filteredAllocations, parts, displayItems]);

  const otherItems = useMemo(() => {
    return filteredAllocations.filter(item => !displayItems.includes(item) && !batteryItems.includes(item));
  }, [filteredAllocations, displayItems, batteryItems]);

  // Calculate Group Summaries
  const calculateGroupTotals = useCallback((items, fallbackPrice = 150) => {
    let totalAlloc = 0;
    let totalCost = 0;
    let w1Qty = 0, w2Qty = 0, w3Qty = 0, w4Qty = 0;
    let w1Cost = 0, w2Cost = 0, w3Cost = 0, w4Cost = 0;
    const siteTotals = {};
    const siteW1Totals = {};
    const siteW2Totals = {};
    const siteW3Totals = {};
    const siteW4Totals = {};
    const siteW1Costs = {};
    const siteW2Costs = {};
    const siteW3Costs = {};
    const siteW4Costs = {};

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

        const bSplit = calculateWeeklySplit(branchQty, branchQty * stockPrice, rIdx + 3);
        siteW1Totals[s.id] = (siteW1Totals[s.id] || 0) + (bSplit.w1_qty || 0);
        siteW2Totals[s.id] = (siteW2Totals[s.id] || 0) + (bSplit.w2_qty || 0);
        siteW3Totals[s.id] = (siteW3Totals[s.id] || 0) + (bSplit.w3_qty || 0);
        siteW4Totals[s.id] = (siteW4Totals[s.id] || 0) + (bSplit.w4_qty || 0);

        siteW1Costs[s.id] = (siteW1Costs[s.id] || 0) + (bSplit.w1_cost || 0);
        siteW2Costs[s.id] = (siteW2Costs[s.id] || 0) + (bSplit.w2_cost || 0);
        siteW3Costs[s.id] = (siteW3Costs[s.id] || 0) + (bSplit.w3_cost || 0);
        siteW4Costs[s.id] = (siteW4Costs[s.id] || 0) + (bSplit.w4_cost || 0);
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
      perSite: siteTotals,
      siteW1Totals,
      siteW2Totals,
      siteW3Totals,
      siteW4Totals,
      siteW1Costs,
      siteW2Costs,
      siteW3Costs,
      siteW4Costs
    };
  }, [parts, orderedServiceSites]);

  const displayTotals = useMemo(() => calculateGroupTotals(displayItems, 279), [displayItems, calculateGroupTotals]);
  const batteryTotals = useMemo(() => calculateGroupTotals(batteryItems, 99), [batteryItems, calculateGroupTotals]);
  const otherTotals = useMemo(() => calculateGroupTotals(otherItems, 100), [otherItems, calculateGroupTotals]);

  const grandGroupTotals = useMemo(() => ({
    totalAlloc: displayTotals.totalAlloc + batteryTotals.totalAlloc + otherTotals.totalAlloc,
    totalCost: displayTotals.totalCost + batteryTotals.totalCost + otherTotals.totalCost,
    totalW1: displayTotals.w1Qty + batteryTotals.w1Qty + otherTotals.w1Qty,
    totalW2: displayTotals.w2Qty + batteryTotals.w2Qty + otherTotals.w2Qty,
    totalW3: displayTotals.w3Qty + batteryTotals.w3Qty + otherTotals.w3Qty,
    totalW4: displayTotals.w4Qty + batteryTotals.w4Qty + otherTotals.w4Qty,
    totalW1Cost: displayTotals.w1Cost + batteryTotals.w1Cost + otherTotals.w1Cost,
    totalW2Cost: displayTotals.w2Cost + batteryTotals.w2Cost + otherTotals.w2Cost,
    totalW3Cost: displayTotals.w3Cost + batteryTotals.w3Cost + otherTotals.w3Cost,
    totalW4Cost: displayTotals.w4Cost + batteryTotals.w4Cost + otherTotals.w4Cost
  }), [displayTotals, batteryTotals, otherTotals]);

  const totalAllocatedAllParts = grandGroupTotals.totalAlloc;
  const grandTotalCost = grandGroupTotals.totalCost;

  // Compute Grand Total site quantities per site
  const siteTotals = useMemo(() => {
    const totals = {};
    orderedServiceSites.forEach(s => {
      totals[s.id] = (displayTotals.siteTotals[s.id] || 0) + (batteryTotals.siteTotals[s.id] || 0) + (otherTotals.siteTotals[s.id] || 0);
    });
    return totals;
  }, [orderedServiceSites, displayTotals, batteryTotals, otherTotals]);

  // Compute Weekly Site Totals
  const weeklySiteTotals = useMemo(() => {
    const w1 = {}, w2 = {}, w3 = {}, w4 = {};
    orderedServiceSites.forEach(s => {
      w1[s.id] = (displayTotals.siteW1Totals[s.id] || 0) + (batteryTotals.siteW1Totals[s.id] || 0) + (otherTotals.siteW1Totals[s.id] || 0);
      w2[s.id] = (displayTotals.siteW2Totals[s.id] || 0) + (batteryTotals.siteW2Totals[s.id] || 0) + (otherTotals.siteW2Totals[s.id] || 0);
      w3[s.id] = (displayTotals.siteW3Totals[s.id] || 0) + (batteryTotals.siteW3Totals[s.id] || 0) + (otherTotals.siteW3Totals[s.id] || 0);
      w4[s.id] = (displayTotals.siteW4Totals[s.id] || 0) + (batteryTotals.siteW4Totals[s.id] || 0) + (otherTotals.siteW4Totals[s.id] || 0);
    });
    return { 1: w1, 2: w2, 3: w3, 4: w4 };
  }, [orderedServiceSites, displayTotals, batteryTotals, otherTotals]);

  // Compute Weekly Site Costs
  const weeklySiteCosts = useMemo(() => {
    const w1 = {}, w2 = {}, w3 = {}, w4 = {};
    orderedServiceSites.forEach(s => {
      w1[s.id] = (displayTotals.siteW1Costs[s.id] || 0) + (batteryTotals.siteW1Costs[s.id] || 0) + (otherTotals.siteW1Costs[s.id] || 0);
      w2[s.id] = (displayTotals.siteW2Costs[s.id] || 0) + (batteryTotals.siteW2Costs[s.id] || 0) + (otherTotals.siteW2Costs[s.id] || 0);
      w3[s.id] = (displayTotals.siteW3Costs[s.id] || 0) + (batteryTotals.siteW3Costs[s.id] || 0) + (otherTotals.siteW3Costs[s.id] || 0);
      w4[s.id] = (displayTotals.siteW4Costs[s.id] || 0) + (batteryTotals.siteW4Costs[s.id] || 0) + (otherTotals.siteW4Costs[s.id] || 0);
    });
    return { 1: w1, 2: w2, 3: w3, 4: w4 };
  }, [orderedServiceSites, displayTotals, batteryTotals, otherTotals]);

  // Compute Grand Total Cost per site
  const siteCostTotals = useMemo(() => {
    const costs = {};
    allocations.forEach(item => {
      const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
      const price = item.stocking_price || part?.stocking_price || 0;
      orderedServiceSites.forEach(s => {
        const qty = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
        costs[s.id] = (costs[s.id] || 0) + (qty * price);
      });
    });
    return costs;
  }, [allocations, parts, orderedServiceSites]);

  const handleExport = () => {
    if (filteredAllocations.length === 0) {
      showToast('No allocations available to export', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    exportAllocationToExcel(filteredAllocations, orderedServiceSites, currentPeriodLabel);
    showToast(`Exported Multi-Sheet Allocation Workbook (${currentPeriodLabel}) to Excel`, 'success');
  };

  const handleDownloadPDF = () => {
    if (filteredAllocations.length === 0) {
      showToast('No allocations available to export', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    exportAllocationToPDF(filteredAllocations, orderedServiceSites, currentPeriodLabel);
    showToast(`Exported Allocation Matrix (${currentPeriodLabel}) to PDF`, 'success');
  };

  const handlePrint = () => {
    if (filteredAllocations.length === 0) {
      showToast('No allocations available to print', 'warning');
      return;
    }
    const currentPeriodLabel = activePeriod?.label || 'September 2026';
    printAllocationMatrixDirect(filteredAllocations, orderedServiceSites, currentPeriodLabel);
  };

  // Render a Single Part Row (Unified across Master and Weekly Views)
  const renderItemRow = (item, commodityLabel, index, excelRowNumber = 3) => {
    const part = parts.find(p => p.id === item.part_id || p.part_number === item.part_number);
    const fallbackPrice = commodityLabel === 'DISPLAY' ? 279 : 99;
    const stockPrice = item.stocking_price || part?.stocking_price || fallbackPrice;
    const totalStockPrice = (item.total_allocated_qty || 0) * stockPrice;
    const split = calculateWeeklySplit(item.total_allocated_qty, totalStockPrice, excelRowNumber);
    const isOrderRequired = (item.total_allocated_qty || 0) > 0;

    // For Weekly view
    const rowWeekQty = split[`w${selectedWeekNum}_qty`] || 0;
    const rowWeekCost = split[`w${selectedWeekNum}_cost`] || 0;
    const isZeroWeek = isWeeklyView && rowWeekQty === 0;
    const rowBg = (!isWeeklyView && isOrderRequired) || (isWeeklyView && !isZeroWeek) ? '#ffffff' : '#fef2f2';

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

        {/* 26 Site Branch Quantities: Weekly vs Master vs Shares */}
        {isWeeklyView ? (
          orderedServiceSites.map(s => {
            const bMonthly = item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0;
            const bSplit = calculateWeeklySplit(bMonthly, bMonthly * stockPrice, excelRowNumber);
            const bWeekQty = bSplit[`w${selectedWeekNum}_qty`] || 0;
            const hasQty = bWeekQty > 0;

            return (
              <td key={s.id} style={{ textAlign: 'center', padding: '4px 2px' }}>
                {hasQty ? (
                  <span style={{
                    background: '#dcfce7',
                    color: '#15803d',
                    border: '1px solid #86efac',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontWeight: 700,
                    fontSize: '11px',
                    display: 'inline-block',
                    minWidth: '22px'
                  }}>
                    {bWeekQty}
                  </span>
                ) : (
                  <span style={{ color: '#94a3b8', fontSize: '11px' }}>0</span>
                )}
              </td>
            );
          })
        ) : activeViewMode === 'shares' ? (
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

        {/* Total Parts (or Week N Total) */}
        <td style={{
          textAlign: 'center',
          fontWeight: 800,
          fontFamily: 'var(--font-mono)',
          fontSize: '12.5px',
          background: (isWeeklyView ? rowWeekQty > 0 : isOrderRequired) ? '#e0f2fe' : '#fee2e2',
          color: (isWeeklyView ? rowWeekQty > 0 : isOrderRequired) ? '#0369a1' : '#b91c1c'
        }}>
          {isWeeklyView ? rowWeekQty : (item.total_allocated_qty || 0)}
        </td>

        {/* Total Stock Price (or Week N Value) */}
        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#0f172a' }}>
          ${(isWeeklyView ? rowWeekCost : totalStockPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>

        {/* 4-Week Split Breakdown (Only shown in Master Allocation View) */}
        {!isWeeklyView && (
          <>
            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w1_qty}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w1_cost.toFixed(2)}</td>
            
            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w2_qty}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w2_cost.toFixed(2)}</td>
            
            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w3_qty}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w3_cost.toFixed(2)}</td>
            
            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#334155', background: '#f8fafc' }}>{split.w4_qty}</td>
            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0f172a', background: '#f8fafc', fontWeight: 600 }}>${split.w4_cost.toFixed(2)}</td>
          </>
        )}

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
              background: (isWeeklyView ? rowWeekQty > 0 : isOrderRequired) ? '#dcfce7' : '#f1f5f9',
              color: (isWeeklyView ? rowWeekQty > 0 : isOrderRequired) ? '#15803d' : '#64748b',
              border: (isWeeklyView ? rowWeekQty > 0 : isOrderRequired) ? '1px solid #86efac' : '1px solid #cbd5e1'
            }}
          >
            {isWeeklyView
              ? (rowWeekQty > 0 ? `WEEK ${selectedWeekNum} ACTIVE` : 'NO DISPATCH')
              : (isOrderRequired ? 'ORDER REQUIRED' : 'NO NEED TO ORDER')}
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
                    {isWeeklyView ? `Week ${selectedWeekNum} Allocation Matrix` : 'Master Parts Allocation Matrix'}
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
                  {isWeeklyView
                    ? `Week ${selectedWeekNum} scheduled branch dispatches matching unified Master Allocation table layout.`
                    : 'Multi-site proportional distribution across 26 branches matching Google Sheet Master Allocation structure.'}
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
              <span>Export Excel (Multi-Sheet)</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDownloadPDF}
              disabled={filteredAllocations.length === 0}
              title="Download landscape corporate PDF of Allocation Matrix"
              style={{ fontWeight: 600, padding: '6px 14px' }}
            >
              <FileText size={14} />
              <span>Download PDF</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePrint}
              disabled={filteredAllocations.length === 0}
              title="Print formatted Allocation Matrix directly"
              style={{ fontWeight: 600, padding: '6px 14px' }}
            >
              <Printer size={14} />
              <span>Print Matrix</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowClearModal(true)}
              title="Clear all allocation and forecasting records to empty state"
              style={{ fontWeight: 600, padding: '6px 14px', color: '#b91c1c' }}
            >
              <RotateCcw size={14} />
              <span>Clear Data</span>
            </button>
          </div>
        </div>

        {/* Multi-Tab View Switcher Matching Google Sheets Tabs (Master, Week 1, Week 2, Week 3, Week 4, Shares) */}
        <div style={{
          display: 'flex',
          gap: '6px',
          marginTop: '16px',
          padding: '4px',
          background: '#f1f5f9',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          flexWrap: 'wrap'
        }}>
          <button
            className={`btn btn-sm ${activeViewMode === 'sheet' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveViewMode('sheet')}
            style={{ border: 'none', fontSize: '12px', padding: '6px 14px', fontWeight: 600 }}
          >
            📊 Master Allocation
          </button>

          <button
            className={`btn btn-sm ${activeViewMode === 'week-1' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveViewMode('week-1')}
            style={{
              border: 'none',
              fontSize: '12px',
              padding: '6px 14px',
              fontWeight: 600,
              background: activeViewMode === 'week-1' ? '#0284c7' : '#ffffff',
              color: activeViewMode === 'week-1' ? '#ffffff' : '#0f172a'
            }}
          >
            📦 Week 1 <span style={{ fontSize: '11px', opacity: 0.85, marginLeft: '4px' }}>({grandGroupTotals.totalW1} units)</span>
          </button>

          <button
            className={`btn btn-sm ${activeViewMode === 'week-2' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveViewMode('week-2')}
            style={{
              border: 'none',
              fontSize: '12px',
              padding: '6px 14px',
              fontWeight: 600,
              background: activeViewMode === 'week-2' ? '#0284c7' : '#ffffff',
              color: activeViewMode === 'week-2' ? '#ffffff' : '#0f172a'
            }}
          >
            📦 Week 2 <span style={{ fontSize: '11px', opacity: 0.85, marginLeft: '4px' }}>({grandGroupTotals.totalW2} units)</span>
          </button>

          <button
            className={`btn btn-sm ${activeViewMode === 'week-3' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveViewMode('week-3')}
            style={{
              border: 'none',
              fontSize: '12px',
              padding: '6px 14px',
              fontWeight: 600,
              background: activeViewMode === 'week-3' ? '#0284c7' : '#ffffff',
              color: activeViewMode === 'week-3' ? '#ffffff' : '#0f172a'
            }}
          >
            📦 Week 3 <span style={{ fontSize: '11px', opacity: 0.85, marginLeft: '4px' }}>({grandGroupTotals.totalW3} units)</span>
          </button>

          <button
            className={`btn btn-sm ${activeViewMode === 'week-4' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveViewMode('week-4')}
            style={{
              border: 'none',
              fontSize: '12px',
              padding: '6px 14px',
              fontWeight: 600,
              background: activeViewMode === 'week-4' ? '#0284c7' : '#ffffff',
              color: activeViewMode === 'week-4' ? '#ffffff' : '#0f172a'
            }}
          >
            📦 Week 4 <span style={{ fontSize: '11px', opacity: 0.85, marginLeft: '4px' }}>({grandGroupTotals.totalW4} units)</span>
          </button>

          <button
            className={`btn btn-sm ${activeViewMode === 'shares' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveViewMode('shares')}
            style={{ border: 'none', fontSize: '12px', padding: '6px 14px', fontWeight: 600 }}
          >
            📈 Site Share %
          </button>
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
                  {isWeeklyView ? `Week ${selectedWeekNum} Allocated Units` : 'Total Parts Allocated'}
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: '#0369a1', fontFamily: 'var(--font-mono)' }}>
                  {isWeeklyView
                    ? grandGroupTotals[`totalW${selectedWeekNum}`].toLocaleString()
                    : totalAllocatedAllParts.toLocaleString()}{' '}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>units</span>
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
                  {isWeeklyView ? `Week ${selectedWeekNum} Stock Valuation` : 'Total Master Value'}
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', fontFamily: 'var(--font-mono)' }}>
                  $
                  {isWeeklyView
                    ? grandGroupTotals[`totalW${selectedWeekNum}Cost`].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {isWeeklyView && (
              <div className="matrix-kpi-card">
                <div className="matrix-kpi-icon-wrap" style={{ background: '#ede9fe', color: '#7c3aed' }}>
                  <Calendar size={22} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                    Scheduled Dispatch
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#6d28d9' }}>
                    Week {selectedWeekNum} of {activePeriod?.label || 'September 2026'}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty State or Matrix Grid */}
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
            No Allocations Generated Yet
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
        /* -------------------------------------------------------------------------------- */
        /* UNIFIED ALLOCATION MATRIX TABLE (Master Allocation + Week 1, 2, 3, 4)           */
        /* -------------------------------------------------------------------------------- */
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
                    {isWeeklyView ? `Week ${selectedWeekNum} Total` : 'Total Parts'}
                  </th>
                  <th style={{ position: 'sticky', top: 0, background: '#0284c7', color: '#ffffff', textAlign: 'right', zIndex: 12, minWidth: '110px', fontWeight: 700 }}>
                    {isWeeklyView ? `Week ${selectedWeekNum} Price` : 'Total Stock Price'}
                  </th>

                  {/* 4-Week Columns (Only on Master Allocation View) */}
                  {!isWeeklyView && (
                    <>
                      <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W1 Qty</th>
                      <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W1 Total</th>
                      <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W2 Qty</th>
                      <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W2 Total</th>
                      <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W3 Qty</th>
                      <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W3 Total</th>
                      <th style={{ position: 'sticky', top: 0, background: '#334155', color: '#f8fafc', textAlign: 'center', zIndex: 12, minWidth: '45px', fontSize: '10.5px' }}>W4 Qty</th>
                      <th style={{ position: 'sticky', top: 0, background: '#1e293b', color: '#38bdf8', textAlign: 'right', zIndex: 12, minWidth: '85px', fontSize: '10.5px' }}>W4 Total</th>
                    </>
                  )}

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
                      <td colSpan={orderedServiceSites.length + (isWeeklyView ? 6 : 14)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Smartphone size={16} color="#0284c7" />
                          <span>DISPLAY COMMODITY {isWeeklyView ? `(WEEK ${selectedWeekNum})` : ''}</span>
                          <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                            {displayItems.length} Parts
                          </span>
                        </div>
                      </td>
                    </tr>
                    {displayItems.map((item, idx) => renderItemRow(item, 'DISPLAY', idx, idx + 3))}
                    
                    {/* DISPLAY SUB-TOTAL */}
                    <tr style={{ background: '#f0f9ff', fontWeight: 700, borderTop: '2px solid #bae6fd', borderBottom: '2px solid #bae6fd' }}>
                      <td className="matrix-col-sticky-1 matrix-subtotal-td" style={{ background: '#f0f9ff', textAlign: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', background: '#0284c7', color: '#ffffff' }}>DISPLAY</span>
                      </td>
                      <td className="matrix-col-sticky-2 font-mono matrix-subtotal-td" style={{ background: '#f0f9ff', color: '#0369a1', fontSize: '11px', fontWeight: 800 }}>
                        SUB-TOTAL
                      </td>
                      <td className="matrix-col-sticky-3 matrix-subtotal-td" style={{ background: '#f0f9ff', color: '#0369a1', fontSize: '11.5px', fontWeight: 700 }}>
                        {displayItems.length} Parts Sub-Total {isWeeklyView ? `(Week ${selectedWeekNum})` : ''}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '11px', color: '#64748b', background: '#f0f9ff' }}>—</td>
                      {orderedServiceSites.map(s => (
                        <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#0369a1', fontSize: '11px', fontWeight: 700, background: '#f0f9ff' }}>
                          {isWeeklyView ? (displayTotals[`siteW${selectedWeekNum}Totals`]?.[s.id] || 0) : (displayTotals.perSite[s.id] || 0)}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', background: '#e0f2fe', color: '#0369a1', fontSize: '12.5px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                        {isWeeklyView ? displayTotals[`totalW${selectedWeekNum}`] : displayTotals.totalQty}
                      </td>
                      <td style={{ textAlign: 'right', color: '#0369a1', fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '11.5px', background: '#f0f9ff' }}>
                        ${(isWeeklyView ? displayTotals[`totalW${selectedWeekNum}Cost`] : displayTotals.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      {!isWeeklyView && (
                        <>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW1}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW1Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW2}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW2Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW3}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW3Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>{displayTotals.totalW4}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff' }}>${displayTotals.totalW4Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </>
                      )}
                      <td style={{ background: '#f0f9ff' }}></td>
                    </tr>
                  </>
                )}

                {/* BATTERY SECTION */}
                {batteryItems.length > 0 && (
                  <>
                    <tr className="matrix-category-header">
                      <td colSpan={orderedServiceSites.length + (isWeeklyView ? 6 : 14)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <BatteryCharging size={16} color="#15803d" />
                          <span>BATTERY COMMODITY {isWeeklyView ? `(WEEK ${selectedWeekNum})` : ''}</span>
                          <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                            {batteryItems.length} Parts
                          </span>
                        </div>
                      </td>
                    </tr>
                    {batteryItems.map((item, idx) => renderItemRow(item, 'BATTERY', idx, idx + 25))}
                    
                    {/* BATTERY SUB-TOTAL */}
                    <tr style={{ background: '#f0fdf4', fontWeight: 700, borderTop: '2px solid #bbf7d0', borderBottom: '2px solid #bbf7d0' }}>
                      <td className="matrix-col-sticky-1 matrix-subtotal-td" style={{ background: '#f0fdf4', textAlign: 'center' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', background: '#16a34a', color: '#ffffff' }}>BATTERY</span>
                      </td>
                      <td className="matrix-col-sticky-2 font-mono matrix-subtotal-td" style={{ background: '#f0fdf4', color: '#15803d', fontSize: '11px', fontWeight: 800 }}>
                        SUB-TOTAL
                      </td>
                      <td className="matrix-col-sticky-3 matrix-subtotal-td" style={{ background: '#f0fdf4', color: '#15803d', fontSize: '11.5px', fontWeight: 700 }}>
                        {batteryItems.length} Parts Sub-Total {isWeeklyView ? `(Week ${selectedWeekNum})` : ''}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '11px', color: '#64748b', background: '#f0fdf4' }}>—</td>
                      {orderedServiceSites.map(s => (
                        <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#15803d', fontSize: '11px', fontWeight: 700, background: '#f0fdf4' }}>
                          {isWeeklyView ? (batteryTotals[`siteW${selectedWeekNum}Totals`]?.[s.id] || 0) : (batteryTotals.perSite[s.id] || 0)}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', background: '#dcfce7', color: '#15803d', fontSize: '12.5px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                        {isWeeklyView ? batteryTotals[`totalW${selectedWeekNum}`] : batteryTotals.totalQty}
                      </td>
                      <td style={{ textAlign: 'right', color: '#15803d', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '11.5px', background: '#f0fdf4' }}>
                        ${(isWeeklyView ? batteryTotals[`totalW${selectedWeekNum}Cost`] : batteryTotals.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      {!isWeeklyView && (
                        <>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW1}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW1Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW2}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW2Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW3}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW3Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>{batteryTotals.totalW4}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#15803d', fontWeight: 700, background: '#f0fdf4' }}>${batteryTotals.totalW4Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </>
                      )}
                      <td style={{ background: '#f0fdf4' }}></td>
                    </tr>
                  </>
                )}

                {/* OTHER ITEMS */}
                {otherItems.length > 0 && (
                  <>
                    <tr className="matrix-category-header">
                      <td colSpan={orderedServiceSites.length + (isWeeklyView ? 6 : 14)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Layers size={16} color="#64748b" />
                          <span>OTHER COMMODITIES {isWeeklyView ? `(WEEK ${selectedWeekNum})` : ''}</span>
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
                    {isWeeklyView ? `WEEK ${selectedWeekNum} TOTAL PARTS PER SITE` : 'TOTAL PARTS PER SITE'}
                  </td>
                  <td style={{ textAlign: 'right', color: '#64748b', fontSize: '11px' }}>—</td>
                  {orderedServiceSites.map(s => (
                    <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#38bdf8', fontSize: '11.5px', fontWeight: 800 }}>
                      {isWeeklyView ? (weeklySiteTotals[selectedWeekNum]?.[s.id] || 0) : (siteTotals[s.id] || 0)}
                    </td>
                  ))}
                  <td style={{ textAlign: 'center', background: '#0284c7', color: '#ffffff', fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                    {isWeeklyView ? grandGroupTotals[`totalW${selectedWeekNum}`] : totalAllocatedAllParts}
                  </td>
                  <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    —
                  </td>
                  {!isWeeklyView && (
                    <>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW1}</td>
                      <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW2}</td>
                      <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW3}</td>
                      <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#38bdf8', fontWeight: 800 }}>{grandGroupTotals.totalW4}</td>
                      <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: '10px' }}>—</td>
                    </>
                  )}
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: '#0284c7', color: '#ffffff' }}>
                      {isWeeklyView ? `WEEK ${selectedWeekNum} PLAN` : 'TOTAL PLAN'}
                    </span>
                  </td>
                </tr>

                {/* 2. Total Cost Breakdown per Site Row */}
                <tr className="matrix-footer-row-2">
                  <td className="matrix-footer-sticky-1" style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '2px 5px', borderRadius: '3px', background: '#64748b', color: '#ffffff' }}>COST</span>
                  </td>
                  <td className="matrix-footer-sticky-2 font-mono" style={{ color: '#cbd5e1', fontSize: '10.5px', fontWeight: 700 }}>
                    VALUATION
                  </td>
                  <td className="matrix-footer-sticky-3" style={{ color: '#e2e8f0', fontSize: '11px', fontWeight: 700 }}>
                    {isWeeklyView ? `WEEK ${selectedWeekNum} COST BREAKDOWN` : 'TOTAL COST BREAKDOWN'}
                  </td>
                  <td style={{ textAlign: 'right', color: '#64748b', fontSize: '10px' }}>—</td>
                  {orderedServiceSites.map(s => (
                    <td key={s.id} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: '#e2e8f0', fontWeight: 600, padding: '6px 2px' }}>
                      ${Math.round(isWeeklyView ? (weeklySiteCosts[selectedWeekNum]?.[s.id] || 0) : (siteCostTotals[s.id] || 0)).toLocaleString()}
                    </td>
                  ))}
                  <td style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    —
                  </td>
                  <td style={{ textAlign: 'right', background: '#0369a1', color: '#ffffff', fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                    ${(isWeeklyView ? grandGroupTotals[`totalW${selectedWeekNum}Cost`] : grandTotalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  {!isWeeklyView && (
                    <>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W1</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW1Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W2</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW2Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W3</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW3Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#94a3b8' }}>W4</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#38bdf8', fontWeight: 800 }}>${grandGroupTotals.totalW4Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </>
                  )}
                  <td style={{ textAlign: 'center', color: '#64748b', fontSize: '10.5px' }}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Save Record Modal Dialog */}
      {showSaveModal && (
        <SaveRecordModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          defaultType="allocation"
        />
      )}

      {/* High-Security Clear Data Confirmation Modal */}
      {showClearModal && (
        <ClearDataConfirmationModal
          isOpen={showClearModal}
          onClose={() => setShowClearModal(false)}
          title="Clear Master Allocation Matrix & Operational Data"
        />
      )}
    </div>
  );
}
