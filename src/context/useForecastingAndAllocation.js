import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';
import {
  calculateProportionalAllocation,
  calculateWeeklySplit,
  generateAllocationsFromForecasts,
  allocatePartToSites,
  resolvePartSiteDemands,
  getOrderRemark
} from '../utils/allocationEngine';
import { calculateForecastByModel, calculateItemForecast } from '../utils/forecastEngine';
import { isExplicitlyCleared } from '../utils/appContextHelpers';

export function useForecastingAndAllocation({
  parts = [],
  sites = [],
  showToast,
  broadcastCloudEvent
}) {
  const syncTimeoutRef = useRef(null);

  const [forecastingModel, setForecastingModel] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_forecasting_model');
      if (saved && ['wma', 'linear'].includes(saved)) {
        return saved;
      }
      return 'linear';
    } catch {
      return 'linear';
    }
  });

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
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      // If allocations is empty but forecast is present in localStorage, generate immediately
      const savedForecast = localStorage.getItem('mdc_forecast');
      if (savedForecast) {
        const parsedF = JSON.parse(savedForecast);
        if (Array.isArray(parsedF) && parsedF.length > 0) {
          const generated = generateAllocationsFromForecasts(parsedF, sites, 'linear');
          if (generated.length > 0) return generated;
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  // Self-healing synchronization: if allocations is empty but forecastItems has data, auto-generate allocations
  useEffect(() => {
    if ((!allocations || allocations.length === 0) && forecastItems && forecastItems.length > 0 && sites && sites.length > 0) {
      const generated = generateAllocationsFromForecasts(forecastItems, sites, forecastingModel);
      if (generated.length > 0) {
        setAllocations(generated);
        try { localStorage.setItem('mdc_allocations', JSON.stringify(generated)); } catch (e) {}
        dbStorage.setItem('mdc_allocations', generated);
      }
    }
  }, [allocations, forecastItems, sites, forecastingModel]);

  // Realtime multi-tab/window bus listener for calculation model changes
  useEffect(() => {
    let bus = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        bus = new BroadcastChannel('mdc_sync_bus');
        bus.onmessage = (ev) => {
          if (ev.data && ev.data.type === 'CALCULATION_MODEL_CHANGED' && ev.data.payload?.model) {
            const incoming = ev.data.payload.model;
            if (['wma', 'linear'].includes(incoming)) {
              setForecastingModel(incoming);
              try { localStorage.setItem('mdc_forecasting_model', incoming); } catch (e) {}
            }
          }
        };
      }
    } catch (e) {}
    return () => {
      if (bus) {
        try { bus.close(); } catch (e) {}
      }
    };
  }, []);

  const changeForecastingModel = useCallback((newModel, options = {}) => {
    if (!['wma', 'linear', 'holt', 'croston'].includes(newModel)) return;

    setForecastingModel(newModel);
    try {
      localStorage.setItem('mdc_forecasting_model', newModel);
    } catch (e) {}

    const activeServiceSites = (sites || []).filter(s =>
      !s.is_dc &&
      !s.code?.toUpperCase().includes('DC') &&
      s.code !== 'DC-MDC'
    );

    let currentForecasts = forecastItems || [];
    if (currentForecasts.length === 0) {
      try {
        currentForecasts = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
      } catch {
        currentForecasts = [];
      }
    }

    if (currentForecasts.length === 0) return;

    // 1. Synchronously re-compute all forecast items using the selected mathematical model
    const updatedForecastItems = currentForecasts.map(item => {
      const rawCounts = item.ytd_monthly_counts || [];
      const counts = rawCounts.slice(0, 8);
      const targetX = (counts.length || 8) + 1;

      let computed;
      if (counts.length === 0) {
        computed = item.final_forecast !== undefined ? item.final_forecast : (item.computed_forecast || 0);
      } else {
        computed = calculateForecastByModel(counts, newModel, {
          targetX,
          // Linear model must NOT use Winsorization — it must match Google Sheet FORECAST.LINEAR.
          // WMA keeps Winsorization ON because the 4-month window is spike-sensitive.
          filterAnomalies: newModel !== 'linear',
          categoryId: item.category_id,
          description: item.description
        });
      }

      const hasOverride = item.admin_override !== null && item.admin_override !== undefined && item.admin_override !== '';
      const finalVal = hasOverride ? parseInt(item.admin_override, 10) : computed;

      return {
        ...item,
        computed_forecast: computed,
        final_forecast: finalVal,
        recommended_order: finalVal
      };
    });

    // 2. Synchronously re-compute all allocations across active branches
    let currentAllocations = allocations || [];
    if (currentAllocations.length === 0) {
      try {
        currentAllocations = JSON.parse(localStorage.getItem('mdc_allocations') || '[]');
      } catch {
        currentAllocations = [];
      }
    }

    const updatedAllocations = updatedForecastItems.map((fi, rIdx) => {
      const existingAlloc = currentAllocations.find(a =>
        a.part_id === fi.part_id ||
        a.part_number === fi.part_number ||
        (a.description && fi.description && a.description.trim().toLowerCase() === fi.description.trim().toLowerCase())
      );

      const targetQty = fi.final_forecast !== undefined ? fi.final_forecast : (fi.computed_forecast || 0);
      const stockingPrice = fi.stocking_price || existingAlloc?.stocking_price || (fi.description?.toLowerCase().includes('display') ? 279 : 99);

      const allocatedResults = allocatePartToSites(targetQty, fi, activeServiceSites, existingAlloc);
      const newSiteQuantities = {};
      let totalAlloc = 0;
      allocatedResults.forEach(res => {
        newSiteQuantities[res.siteId] = res.allocatedQty;
        const siteObj = activeServiceSites.find(s => s.id === res.siteId);
        if (siteObj?.code) newSiteQuantities[siteObj.code] = res.allocatedQty;
        totalAlloc += res.allocatedQty;
      });

      const totalCost = totalAlloc * stockingPrice;
      const fiSplit = calculateWeeklySplit(totalAlloc, totalCost, rIdx + 3);

      return {
        part_id: fi.part_id,
        part_number: fi.part_number,
        description: fi.description,
        category_id: fi.category_id || (fi.description?.toLowerCase().includes('display') ? 'cat-display' : 'cat-battery'),
        forecasted_qty: targetQty,
        stocking_price: stockingPrice,
        exchange_price: fi.exchange_price || existingAlloc?.exchange_price || 0,
        total_allocated_qty: totalAlloc,
        total_stock_cost: totalCost,
        w1_qty: fiSplit.w1_qty,
        w2_qty: fiSplit.w2_qty,
        w3_qty: fiSplit.w3_qty,
        w4_qty: fiSplit.w4_qty,
        w1_cost: fiSplit.w1_cost,
        w2_cost: fiSplit.w2_cost,
        w3_cost: fiSplit.w3_cost,
        w4_cost: fiSplit.w4_cost,
        site_quantities: newSiteQuantities
      };
    });

    setForecastItems(updatedForecastItems);
    try { localStorage.setItem('mdc_forecast', JSON.stringify(updatedForecastItems)); } catch (e) {}
    dbStorage.setItem('mdc_forecast', updatedForecastItems);

    setAllocations(updatedAllocations);
    try { localStorage.setItem('mdc_allocations', JSON.stringify(updatedAllocations)); } catch (e) {}
    dbStorage.setItem('mdc_allocations', updatedAllocations);

    if (supabase) {
      (async () => {
        try {
          await supabase.from('saved_records').upsert({
            id: LIVE_MASTER_RECORD_ID,
            record_type: 'both',
            period_label: 'Master Operational Data',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: `Live state recalculated via ${newModel} model`,
            snapshot_data: {
              forecastItems: updatedForecastItems,
              allocations: updatedAllocations,
              forecastingModel: newModel
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

          if (broadcastCloudEvent) {
            broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records', model: newModel });
          }
        } catch (e) {
          console.warn('Sync model update to cloud error:', e);
        }
      })();
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('CALCULATION_MODEL_CHANGED', { model: newModel });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records', model: newModel });
    }

    const MODEL_NAMES = {
      wma: '4-Month Weighted Moving Average (Spike Filtered)',
      linear: 'Linear Regression (FORECAST.LINEAR)'
    };

    if (!options.silent && showToast) {
      showToast(`Calculation model updated to ${MODEL_NAMES[newModel] || newModel}. Forecasts and branch allocations synchronized.`, 'success');
    }
  }, [allocations, broadcastCloudEvent, forecastItems, showToast, sites]);

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
    let currentForecasts;
    try {
      const localSaved = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
      currentForecasts = (forecastItems && forecastItems.length > 0) ? forecastItems : (Array.isArray(localSaved) ? localSaved : []);
    } catch {
      currentForecasts = forecastItems || [];
    }

    const updatedForecastItems = currentForecasts.map(item => {
      if (
        item.part_id === partId ||
        item.part_number === partId ||
        item.id === partId ||
        (item.description && partId && item.description.trim().toLowerCase() === String(partId).trim().toLowerCase())
      ) {
        const computed = calculateItemForecast(item, forecastingModel);
        // If override matches computed baseline, clear override to null
        const isBackToCalculated = override !== null && override === computed;
        const effectiveOverride = isBackToCalculated ? null : override;
        const finalForecast = effectiveOverride !== null ? effectiveOverride : computed;

        return {
          ...item,
          computed_forecast: computed,
          admin_override: effectiveOverride, // null when cancelled or matching calculation
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

    const finalForecastVal = targetItem?.final_forecast !== undefined
      ? targetItem.final_forecast
      : (targetItem?.computed_forecast !== undefined ? targetItem.computed_forecast : 0);
    const targetQty = finalForecastVal;

    const partNum = targetItem?.part_number || targetPart?.part_number || partId;
    const desc = targetItem?.description || targetPart?.description || 'Service Replacement Part';
    const stockingPrice = targetItem?.stocking_price || targetPart?.stocking_price || (desc.toLowerCase().includes('display') ? 279 : 99);
    const categoryId = targetItem?.category_id || targetPart?.category_id || (desc.toLowerCase().includes('display') ? 'cat-display' : 'cat-battery');

    let currentAllocations;
    try {
      const localAllocSaved = JSON.parse(localStorage.getItem('mdc_allocations') || '[]');
      currentAllocations = (allocations && allocations.length > 0) ? allocations : (Array.isArray(localAllocSaved) ? localAllocSaved : []);
    } catch {
      currentAllocations = allocations || [];
    }

    // If allocations is empty, initialize all rows from updatedForecastItems
    if (currentAllocations.length === 0 && updatedForecastItems.length > 0) {
      currentAllocations = updatedForecastItems.map((fi, rIdx) => {
        const fiQty = fi.final_forecast !== undefined ? fi.final_forecast : (fi.computed_forecast || 0);
        const fiPrice = fi.stocking_price || (fi.description?.toLowerCase().includes('display') ? 279 : 99);
        const fiResults = allocatePartToSites(fiQty, fi, activeServiceSites, null);
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
          const isReset = override === null;
          const allocatedResults = allocatePartToSites(targetQty, alloc, activeServiceSites, isReset ? null : alloc);
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
      const partTarget = targetItem || targetPart || { part_id: partId, part_number: partNum, description: desc };
      const allocatedResults = allocatePartToSites(targetQty, partTarget, activeServiceSites, null);
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
    const rawVal = String(newQty).trim();
    const parsedVal = rawVal === '' ? 0 : Math.max(0, parseInt(rawVal, 10) || 0);

    // Record local modification timestamp to protect UI from remote echo
    try {
      localStorage.setItem('mdc_last_override_time', String(Date.now()));
    } catch (e) {}

    const activeServiceSites = (sites || []).filter(s =>
      !s.is_dc &&
      !s.code?.toUpperCase().includes('DC') &&
      !s.code?.toUpperCase().includes('MOBILEC') &&
      !s.name?.toLowerCase().includes('distribution') &&
      s.code !== 'DC-MDC'
    );

    // 1. Get current allocations list (fallback to localStorage or generate from forecastItems if empty)
    let currentAllocations = allocations;
    if (!currentAllocations || currentAllocations.length === 0) {
      try {
        const saved = JSON.parse(localStorage.getItem('mdc_allocations') || '[]');
        if (Array.isArray(saved) && saved.length > 0) currentAllocations = saved;
      } catch (e) {}
    }

    if (!currentAllocations || currentAllocations.length === 0) {
      let currentForecasts = forecastItems;
      if (!currentForecasts || currentForecasts.length === 0) {
        try {
          const savedF = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
          if (Array.isArray(savedF)) currentForecasts = savedF;
        } catch (e) {}
      }
      if (currentForecasts && currentForecasts.length > 0) {
        currentAllocations = generateAllocationsFromForecasts(currentForecasts, sites, forecastingModel);
      } else {
        currentAllocations = [];
      }
    }

    const cleanTargetId = String(partId || '').trim().toLowerCase();
    const foundSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
    const sId = foundSite?.id || siteIdOrCode;
    const sCode = foundSite?.code || siteIdOrCode;

    let targetPartTotalQty = 0;
    let targetPartNumber = null;
    let targetPartDescription = null;

    // 2. Synchronously update the matching allocation item
    const updatedAllocations = currentAllocations.map((item, rIdx) => {
      const matches =
        item.part_id === partId ||
        item.part_number === partId ||
        item.id === partId ||
        (cleanTargetId && String(item.part_id || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(item.part_number || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(item.id || '').toLowerCase() === cleanTargetId) ||
        (item.description && cleanTargetId && item.description.trim().toLowerCase() === cleanTargetId);

      if (matches) {
        targetPartNumber = item.part_number;
        targetPartDescription = item.description;

        const updatedSiteQty = {
          ...(item.site_quantities || {}),
          [sId]: parsedVal,
          ...(sCode ? { [sCode]: parsedVal } : {})
        };

        // Calculate sum of active non-DC sites
        const newTotal = activeServiceSites.reduce((sum, s) => {
          return sum + (updatedSiteQty[s.id] ?? updatedSiteQty[s.code] ?? 0);
        }, 0);

        targetPartTotalQty = newTotal;
        const stockingPrice = item.stocking_price || (item.description?.toLowerCase().includes('display') ? 279 : 99);
        const totalCost = newTotal * stockingPrice;
        const split = calculateWeeklySplit(newTotal, totalCost, rIdx + 3);

        return {
          ...item,
          site_quantities: updatedSiteQty,
          total_allocated_qty: newTotal,
          forecasted_qty: newTotal,
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

    // 3. Synchronously adapt forecastItems to adopt the updated total allocation
    let currentForecasts = forecastItems;
    if (!currentForecasts || currentForecasts.length === 0) {
      try {
        const savedF = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
        if (Array.isArray(savedF)) currentForecasts = savedF;
      } catch (e) {}
    }

    const updatedForecastItems = (currentForecasts || []).map(fi => {
      const matches =
        fi.part_id === partId ||
        fi.part_number === partId ||
        fi.id === partId ||
        (targetPartNumber && fi.part_number === targetPartNumber) ||
        (cleanTargetId && String(fi.part_id || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(fi.part_number || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(fi.id || '').toLowerCase() === cleanTargetId) ||
        (fi.description && targetPartDescription && fi.description.trim().toLowerCase() === targetPartDescription.trim().toLowerCase());

      if (matches) {
        const computed = calculateItemForecast(fi, forecastingModel);
        // If the adjusted site allocation total returns to the original computed forecast,
        // clear the admin override (set to null), so it naturally returns to the original calculation!
        const isBackToCalculated = targetPartTotalQty === computed;
        const newOverride = isBackToCalculated ? null : targetPartTotalQty;

        return {
          ...fi,
          computed_forecast: computed,
          admin_override: newOverride,
          final_forecast: targetPartTotalQty,
          recommended_order: targetPartTotalQty
        };
      }
      return fi;
    });

    // 4. Commit to React state, localStorage, and IndexedDB immediately
    setAllocations(updatedAllocations);
    try { localStorage.setItem('mdc_allocations', JSON.stringify(updatedAllocations)); } catch (e) {}
    dbStorage.setItem('mdc_allocations', updatedAllocations);

    if (updatedForecastItems.length > 0) {
      setForecastItems(updatedForecastItems);
      try { localStorage.setItem('mdc_forecast', JSON.stringify(updatedForecastItems)); } catch (e) {}
      dbStorage.setItem('mdc_forecast', updatedForecastItems);
    }

    // 5. Debounce cloud upsert to prevent typing flicker & race conditions
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
            notes: 'Active live warehouse operational state (site allocation updated)',
            snapshot_data: {
              forecastItems: updatedForecastItems,
              allocations: updatedAllocations,
              forecastingModel
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {
          console.warn('Sync site allocation to cloud error:', e);
        }
      }

      if (broadcastCloudEvent) {
        broadcastCloudEvent('ALLOCATION_UPDATED', { partId, siteId: sId, qty: parsedVal });
        broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records' });
      }
    }, 400);
  };

  const runAutoAllocation = (partId, availableStock) => {
    const part = parts.find(p => p.id === partId || p.part_number === partId);
    if (!part) return;

    const activeServiceSites = (sites || []).filter(s =>
      !s.is_dc &&
      !s.code?.toUpperCase().includes('DC') &&
      !s.code?.toUpperCase().includes('MOBILEC') &&
      !s.name?.toLowerCase().includes('distribution') &&
      s.code !== 'DC-MDC'
    );
    const currentAlloc = allocations.find(a => a.part_id === partId || a.part_number === partId);

    const allocatedResults = allocatePartToSites(availableStock, part, activeServiceSites, currentAlloc);
    const siteQuantities = {};
    allocatedResults.forEach(res => {
      siteQuantities[res.siteId] = res.allocatedQty;
      const siteObj = activeServiceSites.find(s => s.id === res.siteId);
      if (siteObj?.code) siteQuantities[siteObj.code] = res.allocatedQty;
    });

    const totalCost = availableStock * (part.stocking_price || 0);
    const idx = allocations.findIndex(a => a.part_id === partId || a.part_number === partId);
    const split = calculateWeeklySplit(availableStock, totalCost, (idx >= 0 ? idx : allocations.length) + 3);

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

    showToast(`Auto-allocated ${availableStock} units of ${part.description} across ${activeServiceSites.length} sites`, 'success');
  };

  const resetPartAllocation = (partId) => {
    const cleanTargetId = String(partId || '').trim().toLowerCase();
    const activeServiceSites = (sites || []).filter(s =>
      !s.is_dc &&
      !s.code?.toUpperCase().includes('DC') &&
      !s.code?.toUpperCase().includes('MOBILEC') &&
      !s.name?.toLowerCase().includes('distribution') &&
      s.code !== 'DC-MDC'
    );

    let currentForecasts = forecastItems;
    if (!currentForecasts || currentForecasts.length === 0) {
      try {
        const savedF = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
        if (Array.isArray(savedF)) currentForecasts = savedF;
      } catch (e) {}
    }

    const targetFi = (currentForecasts || []).find(fi =>
      fi.part_id === partId ||
      fi.part_number === partId ||
      fi.id === partId ||
      (cleanTargetId && String(fi.part_id || '').toLowerCase() === cleanTargetId) ||
      (cleanTargetId && String(fi.part_number || '').toLowerCase() === cleanTargetId) ||
      (cleanTargetId && String(fi.id || '').toLowerCase() === cleanTargetId)
    );

    const computedQty = targetFi ? calculateItemForecast(targetFi, forecastingModel) : 0;
    const targetPrice = targetFi?.stocking_price || (targetFi?.description?.toLowerCase().includes('display') ? 279 : 99);

    const allocatedResults = allocatePartToSites(computedQty, targetFi || { part_id: partId }, activeServiceSites, null);
    const newSiteQuantities = {};
    let totalAlloc = 0;
    allocatedResults.forEach(res => {
      newSiteQuantities[res.siteId] = res.allocatedQty;
      const siteObj = activeServiceSites.find(s => s.id === res.siteId);
      if (siteObj?.code) newSiteQuantities[siteObj.code] = res.allocatedQty;
      totalAlloc += res.allocatedQty;
    });

    const updatedForecastItems = (currentForecasts || []).map(fi => {
      const matches =
        fi.part_id === partId ||
        fi.part_number === partId ||
        fi.id === partId ||
        (cleanTargetId && String(fi.part_id || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(fi.part_number || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(fi.id || '').toLowerCase() === cleanTargetId);

      if (matches) {
        return {
          ...fi,
          computed_forecast: computedQty,
          admin_override: null,
          final_forecast: computedQty,
          recommended_order: computedQty
        };
      }
      return fi;
    });

    let currentAllocations = allocations;
    if (!currentAllocations || currentAllocations.length === 0) {
      try {
        const saved = JSON.parse(localStorage.getItem('mdc_allocations') || '[]');
        if (Array.isArray(saved) && saved.length > 0) currentAllocations = saved;
      } catch (e) {}
    }

    const updatedAllocations = (currentAllocations || []).map((alloc, rIdx) => {
      const matches =
        alloc.part_id === partId ||
        alloc.part_number === partId ||
        alloc.id === partId ||
        (cleanTargetId && String(alloc.part_id || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(alloc.part_number || '').toLowerCase() === cleanTargetId) ||
        (cleanTargetId && String(alloc.id || '').toLowerCase() === cleanTargetId);

      if (matches) {
        const totalCost = totalAlloc * targetPrice;
        const split = calculateWeeklySplit(totalAlloc, totalCost, rIdx + 3);
        return {
          ...alloc,
          forecasted_qty: computedQty,
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

    setForecastItems(updatedForecastItems);
    try { localStorage.setItem('mdc_forecast', JSON.stringify(updatedForecastItems)); } catch (e) {}
    dbStorage.setItem('mdc_forecast', updatedForecastItems);

    setAllocations(updatedAllocations);
    try { localStorage.setItem('mdc_allocations', JSON.stringify(updatedAllocations)); } catch (e) {}
    dbStorage.setItem('mdc_allocations', updatedAllocations);

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      if (supabase) {
        try {
          await supabase.from('saved_records').upsert({
            id: LIVE_MASTER_RECORD_ID,
            record_type: 'both',
            period_label: 'Master Operational Data',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Active live warehouse operational state (part allocation reset)',
            snapshot_data: {
              forecastItems: updatedForecastItems,
              allocations: updatedAllocations,
              forecastingModel
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {}
      }
      if (broadcastCloudEvent) {
        broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records' });
      }
    }, 400);

    if (showToast) {
      showToast(`Reset ${targetFi?.part_number || partId} allocations back to original calculation (${computedQty} units)`, 'success');
    }
  };

  const resetAllAllocationsToCalculation = () => {
    let currentForecasts = forecastItems;
    if (!currentForecasts || currentForecasts.length === 0) {
      try {
        const savedF = JSON.parse(localStorage.getItem('mdc_forecast') || '[]');
        if (Array.isArray(savedF)) currentForecasts = savedF;
      } catch (e) {}
    }
    if (!currentForecasts || currentForecasts.length === 0) return;

    const updatedForecastItems = currentForecasts.map(fi => {
      const computed = calculateItemForecast(fi, forecastingModel);
      return {
        ...fi,
        computed_forecast: computed,
        admin_override: null,
        final_forecast: computed,
        recommended_order: computed
      };
    });

    const regeneratedAllocations = generateAllocationsFromForecasts(updatedForecastItems, sites, forecastingModel);

    setForecastItems(updatedForecastItems);
    try { localStorage.setItem('mdc_forecast', JSON.stringify(updatedForecastItems)); } catch (e) {}
    dbStorage.setItem('mdc_forecast', updatedForecastItems);

    setAllocations(regeneratedAllocations);
    try { localStorage.setItem('mdc_allocations', JSON.stringify(regeneratedAllocations)); } catch (e) {}
    dbStorage.setItem('mdc_allocations', regeneratedAllocations);

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      if (supabase) {
        try {
          await supabase.from('saved_records').upsert({
            id: LIVE_MASTER_RECORD_ID,
            record_type: 'both',
            period_label: 'Master Operational Data',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Active live warehouse operational state (all allocations reset)',
            snapshot_data: {
              forecastItems: updatedForecastItems,
              allocations: regeneratedAllocations,
              forecastingModel
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (e) {}
      }
      if (broadcastCloudEvent) {
        broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records' });
      }
    }, 400);

    if (showToast) {
      showToast('All allocations and forecasts reset to original algorithmic calculations', 'success');
    }
  };

  return {
    forecastingModel,
    setForecastingModel,
    changeForecastingModel,
    forecastItems,
    setForecastItems,
    allocations,
    setAllocations,
    updateForecastOverride,
    updateSiteAllocation,
    runAutoAllocation,
    resetPartAllocation,
    resetAllAllocationsToCalculation
  };
}
