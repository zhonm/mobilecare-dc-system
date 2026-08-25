import { useState, useRef } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';
import { calculateRecommendedOrder } from '../utils/forecastEngine';
import { calculateProportionalAllocation, calculateWeeklySplit } from '../utils/allocationEngine';
import { isExplicitlyCleared } from '../utils/appContextHelpers';

export function useForecastingAndAllocation({
  parts = [],
  sites = [],
  showToast,
  broadcastCloudEvent,
  setCloudSyncStatus
}) {
  const syncTimeoutRef = useRef(null);

  const [forecastItems, setForecastItems] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_forecast');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [allocations, setAllocations] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_allocations');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const updateForecastOverride = (partId, overrideVal) => {
    const rawVal = String(overrideVal).trim();
    const override = rawVal === '' || overrideVal === null || isNaN(parseInt(rawVal, 10)) ? null : Math.max(0, parseInt(rawVal, 10));

    // Record local modification timestamp to protect UI from realtime echo
    try {
      localStorage.setItem('mdc_last_override_time', String(Date.now()));
    } catch (e) {}

    const activeServiceSites = (sites || []).filter(s =>
      !s.is_dc &&
      !s.code?.toUpperCase().includes('DC') &&
      s.code !== 'DC-MDC'
    );

    // 1. Synchronously compute next forecast items
    let currentForecasts = [];
    try {
      const localSaved = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
      currentForecasts = (forecastItems && forecastItems.length > 0) ? forecastItems : (Array.isArray(localSaved) ? localSaved : []);
    } catch (e) {
      currentForecasts = forecastItems || [];
    }

    const updatedForecastItems = currentForecasts.map(item => {
      if (
        item.part_id === partId ||
        item.part_number === partId ||
        item.id === partId ||
        (item.description && partId && item.description.trim().toLowerCase() === String(partId).trim().toLowerCase())
      ) {
        const computed = item.computed_forecast !== undefined ? item.computed_forecast : 0;
        const finalForecast = override !== null ? override : computed;
        return {
          ...item,
          admin_override: override, // null when cancelled, or integer
          final_forecast: finalForecast,
          recommended_order: finalForecast
        };
      }
      return item;
    });

    // 2. Synchronously compute next allocations
    const targetItem = updatedForecastItems.find(i =>
      i.part_id === partId || i.part_number === partId || i.id === partId || (i.description && partId && i.description.trim().toLowerCase() === String(partId).trim().toLowerCase())
    );
    const targetPart = parts.find(p =>
      p.id === partId || p.part_number === partId || p.part_number === targetItem?.part_number
    );

    const finalForecastVal = override !== null
      ? override
      : (targetItem?.computed_forecast !== undefined ? targetItem.computed_forecast : 0);
    const targetQty = finalForecastVal;

    const partNum = targetItem?.part_number || targetPart?.part_number || partId;
    const desc = targetItem?.description || targetPart?.description || 'Service Replacement Part';
    const stockingPrice = targetItem?.stocking_price || targetPart?.stocking_price || (desc.toLowerCase().includes('display') ? 279 : 99);
    const categoryId = targetItem?.category_id || targetPart?.category_id || (desc.toLowerCase().includes('display') ? 'cat-display' : 'cat-battery');

    let currentAllocations = [];
    try {
      const localAllocSaved = JSON.parse(localStorage.getItem('mdc_allocations') || '[]');
      currentAllocations = (allocations && allocations.length > 0) ? allocations : (Array.isArray(localAllocSaved) ? localAllocSaved : []);
    } catch (e) {
      currentAllocations = allocations || [];
    }

    // If allocations is empty, initialize all rows from updatedForecastItems
    if (currentAllocations.length === 0 && updatedForecastItems.length > 0) {
      currentAllocations = updatedForecastItems.map((fi, rIdx) => {
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
    }

    const matchIdx = currentAllocations.findIndex(a =>
      a.part_id === partId ||
      a.part_number === partId ||
      a.part_number === partNum ||
      (a.description && desc && a.description.trim().toLowerCase() === desc.trim().toLowerCase())
    );

    let updatedAllocations = [];
    if (matchIdx >= 0) {
      updatedAllocations = currentAllocations.map((alloc, idx) => {
        if (idx === matchIdx) {
          const currentSiteQty = alloc.site_quantities || {};
          const siteDemands = activeServiceSites.map(s => ({
            siteId: s.id,
            historicalDemand: (currentSiteQty[s.id] ?? currentSiteQty[s.code] ?? 0) > 0
              ? (currentSiteQty[s.id] ?? currentSiteQty[s.code])
              : 1
          }));

          const allocatedResults = calculateProportionalAllocation(targetQty, siteDemands);
          const newSiteQuantities = {};
          let totalAlloc = 0;
          allocatedResults.forEach(res => {
            newSiteQuantities[res.siteId] = res.allocatedQty;
            const siteObj = activeServiceSites.find(s => s.id === res.siteId);
            if (siteObj?.code) newSiteQuantities[siteObj.code] = res.allocatedQty;
            totalAlloc += res.allocatedQty;
          });

          const totalCost = totalAlloc * stockingPrice;
          const split = calculateWeeklySplit(totalAlloc, totalCost, idx + 3);

          return {
            ...alloc,
            forecasted_qty: targetQty,
            total_allocated_qty: totalAlloc,
            total_stock_cost: totalCost,
            w1_qty: split.w1_qty,
            w2_qty: split.w2_qty,
            w3_qty: split.w3_qty,
            w4_qty: split.w4_qty,
            w1_cost: split.w1_cost,
            w2_cost: split.w2_cost,
            w3_cost: split.w3_cost,
            w4_cost: split.w4_cost,
            site_quantities: newSiteQuantities
          };
        }
        return alloc;
      });
    } else if (targetQty >= 0) {
      const siteDemands = activeServiceSites.map(s => ({ siteId: s.id, historicalDemand: 1 }));
      const allocatedResults = calculateProportionalAllocation(targetQty, siteDemands);
      const newSiteQuantities = {};
      let totalAlloc = 0;
      allocatedResults.forEach(res => {
        newSiteQuantities[res.siteId] = res.allocatedQty;
        const siteObj = activeServiceSites.find(s => s.id === res.siteId);
        if (siteObj?.code) newSiteQuantities[siteObj.code] = res.allocatedQty;
        totalAlloc += res.allocatedQty;
      });

      const totalCost = totalAlloc * stockingPrice;
      const split = calculateWeeklySplit(totalAlloc, totalCost, currentAllocations.length + 3);

      const newAllocObj = {
        part_id: targetItem?.part_id || targetPart?.id || partId,
        part_number: partNum,
        description: desc,
        category_id: categoryId,
        forecasted_qty: targetQty,
        stocking_price: stockingPrice,
        exchange_price: targetItem?.exchange_price || targetPart?.exchange_price || 0,
        total_allocated_qty: totalAlloc,
        total_stock_cost: totalCost,
        w1_qty: split.w1_qty,
        w2_qty: split.w2_qty,
        w3_qty: split.w3_qty,
        w4_qty: split.w4_qty,
        w1_cost: split.w1_cost,
        w2_cost: split.w2_cost,
        w3_cost: split.w3_cost,
        w4_cost: split.w4_cost,
        site_quantities: newSiteQuantities
      };
      updatedAllocations = [...currentAllocations, newAllocObj];
    } else {
      updatedAllocations = currentAllocations;
    }

    // 3. Commit state and local storage immediately
    setForecastItems(updatedForecastItems);
    try { localStorage.setItem('mdc_forecast', JSON.stringify(updatedForecastItems)); } catch (e) {}
    dbStorage.setItem('mdc_forecast', updatedForecastItems);

    setAllocations(updatedAllocations);
    try { localStorage.setItem('mdc_allocations', JSON.stringify(updatedAllocations)); } catch (e) {}
    dbStorage.setItem('mdc_allocations', updatedAllocations);

    // 4. Debounce cloud upsert to prevent typing flicker / echo
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(async () => {
      if (supabase) {
        try {
          await supabase.from('saved_records').upsert({
            id: LIVE_MASTER_RECORD_ID,
            record_type: 'both',
            period_label: 'Master Operational Data',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Active live warehouse operational state',
            snapshot_data: {
              forecastItems: updatedForecastItems,
              allocations: updatedAllocations
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {
          console.warn('Sync override to cloud error:', e);
        }
      }

      if (broadcastCloudEvent) {
        broadcastCloudEvent('MASTER_DATA_UPDATED', { period: 'Current' });
      }
    }, 400);
  };

  const updateSiteAllocation = (partId, siteIdOrCode, newQty) => {
    let nextAllocations = [];
    setAllocations(prev => {
      nextAllocations = (prev || []).map(item => {
        if (item.part_id === partId || item.part_number === partId) {
          const foundSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
          const sId = foundSite?.id || siteIdOrCode;
          const sCode = foundSite?.code || siteIdOrCode;
          const val = Math.max(0, parseInt(newQty, 10) || 0);

          const updatedSiteQty = {
            ...(item.site_quantities || {}),
            [sId]: val,
            ...(sCode ? { [sCode]: val } : {})
          };

          const activeServiceSites = (sites || []).filter(s => !s.is_dc);
          const newTotal = activeServiceSites.reduce((sum, s) => {
            return sum + (updatedSiteQty[s.id] ?? updatedSiteQty[s.code] ?? 0);
          }, 0);

          const totalCost = newTotal * (item.stocking_price || 0);
          const split = calculateWeeklySplit(newTotal, totalCost);
          return {
            ...item,
            site_quantities: updatedSiteQty,
            total_allocated_qty: newTotal,
            total_stock_cost: totalCost,
            w1_qty: split.w1_qty,
            w2_qty: split.w2_qty,
            w3_qty: split.w3_qty,
            w4_qty: split.w4_qty,
            w1_cost: split.w1_cost,
            w2_cost: split.w2_cost,
            w3_cost: split.w3_cost,
            w4_cost: split.w4_cost
          };
        }
        return item;
      });
      try { localStorage.setItem('mdc_allocations', JSON.stringify(nextAllocations)); } catch (e) {}
      dbStorage.setItem('mdc_allocations', nextAllocations);
      return nextAllocations;
    });

    if (supabase) {
      (async () => {
        try {
          await supabase.from('saved_records').upsert({
            id: LIVE_MASTER_RECORD_ID,
            record_type: 'both',
            period_label: 'Master Operational Data',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Active live warehouse operational state',
            snapshot_data: {
              forecastItems,
              allocations: nextAllocations
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {}
      })();
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('MASTER_DATA_UPDATED', { period: 'Current' });
    }
  };

  const runAutoAllocation = (partId, availableStock) => {
    const part = parts.find(p => p.id === partId || p.part_number === partId);
    if (!part) return;

    const siteDemands = sites.filter(s => !s.is_dc).map(s => {
      const currentAlloc = allocations.find(a => a.part_id === partId || a.part_number === partId);
      const histDemand = currentAlloc?.site_quantities?.[s.id] || 1;
      return {
        siteId: s.id,
        historicalDemand: histDemand
      };
    });

    const allocatedResults = calculateProportionalAllocation(availableStock, siteDemands);
    const siteQuantities = {};
    allocatedResults.forEach(res => {
      siteQuantities[res.siteId] = res.allocatedQty;
    });

    const totalCost = availableStock * (part.stocking_price || 0);
    const split = calculateWeeklySplit(availableStock, totalCost);

    setAllocations(prev => {
      const exists = prev.some(a => a.part_id === partId || a.part_number === partId);
      const newAllocObj = {
        part_id: part.id || partId,
        part_number: part.part_number,
        description: part.description,
        category_id: part.category_id,
        stocking_price: part.stocking_price,
        exchange_price: part.exchange_price,
        total_allocated_qty: availableStock,
        total_stock_cost: totalCost,
        w1_qty: split.w1_qty,
        w2_qty: split.w2_qty,
        w3_qty: split.w3_qty,
        w4_qty: split.w4_qty,
        w1_cost: split.w1_cost,
        w2_cost: split.w2_cost,
        w3_cost: split.w3_cost,
        w4_cost: split.w4_cost,
        site_quantities: siteQuantities
      };
      const updated = exists
        ? prev.map(a => (a.part_id === partId || a.part_number === partId) ? newAllocObj : a)
        : [...prev, newAllocObj];
      try { localStorage.setItem('mdc_allocations', JSON.stringify(updated)); } catch (e) {}
      dbStorage.setItem('mdc_allocations', updated);
      return updated;
    });

    showToast(`Auto-allocated ${availableStock} units of ${part.description} across ${siteDemands.length} sites`, 'success');
  };

  return {
    forecastItems,
    setForecastItems,
    allocations,
    setAllocations,
    updateForecastOverride,
    updateSiteAllocation,
    runAutoAllocation
  };
}
