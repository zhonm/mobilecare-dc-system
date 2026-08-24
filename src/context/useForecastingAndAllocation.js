import { useState } from 'react';
import { calculateRecommendedOrder } from '../utils/forecastEngine';
import { calculateProportionalAllocation, calculateWeeklySplit } from '../utils/allocationEngine';
import { isExplicitlyCleared } from '../utils/appContextHelpers';

export function useForecastingAndAllocation({
  parts = [],
  sites = [],
  showToast
}) {
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
    setForecastItems(prev => prev.map(item => {
      if (item.part_id === partId || item.part_number === partId) {
        const override = overrideVal === '' || overrideVal === null ? null : parseInt(overrideVal);
        const finalForecast = override !== null ? override : item.computed_forecast;
        const rec = calculateRecommendedOrder(item.computed_forecast, 0.05, override);
        return {
          ...item,
          admin_override: override,
          final_forecast: finalForecast,
          recommended_order: rec.recommendedOrder
        };
      }
      return item;
    }));
  };

  const updateSiteAllocation = (partId, siteIdOrCode, newQty) => {
    setAllocations(prev => prev.map(item => {
      if (item.part_id === partId || item.part_number === partId) {
        const foundSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
        const sId = foundSite?.id || siteIdOrCode;
        const sCode = foundSite?.code || siteIdOrCode;
        const val = Math.max(0, parseInt(newQty) || 0);

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
    }));
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
      if (exists) {
        return prev.map(a => (a.part_id === partId || a.part_number === partId) ? newAllocObj : a);
      }
      return [...prev, newAllocObj];
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
