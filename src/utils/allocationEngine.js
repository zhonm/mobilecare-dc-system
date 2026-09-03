import {
  CANONICAL_SITE_CODES,
  CANONICAL_SITE_LIST,
  CANONICAL_DISPLAY_DESCS,
  CANONICAL_BATTERY_DESCS,
  CANONICAL_BATTERY_SHARE_DESCS
} from '../constants/config.js';

// Number of Display rows in the canonical Excel block.
// Excel layout: Displays at rows 3..(3+N_DISPLAY_ROWS-1), one subtotal row, then Batteries.
// Used to offset rowIndex in calculateWeeklySplit so Battery items use the correct
// ISEVEN(ROW()) parity (matching the live Excel workbook).
const _N_DISPLAY_ROWS = CANONICAL_DISPLAY_DESCS.length;
import { displayShares, batteryShares } from '../data/canonicalShares.js';
import { calculateItemForecast, roundExcel } from './forecastEngine.js';

/**
 * Allocation Engine for Multi-Site Distribution
 * Implements:
 *   - Option A: Bit-for-Bit Excel Parity Allocation (replicates live Excel cumulative 2D windowed sum down column)
 *   - Option B: Corrected Self-Consistent 2D Cumulative Allocation (strictly model's own empirical site shares)
 *   - Hamilton-Hare Proportional Quota Allocation
 *   - Verified 4-Week Alternating Parity Split
 *   - Order Remark Generation ("NO NEED TO ORDER" / "ORDER REQUIRED")
 *   - Per-part empirical and canonical multi-site demand resolution
 */

/**
 * Resolves per-branch demand weights for a given part according to strict 3-tier priority:
 * 1. Real empirical historical shares for this exact part from historical site_quantities / site_counts (>0 sum)
 * 2. Per-part canonical shares from canonicalShares.js (displayShares / batteryShares) matched by model index
 * 3. Uniform split across active service sites (1 / activeSites.length)
 *
 * NOTE: CANONICAL_SITE_WEIGHTS is deprecated for allocation purposes and is never used.
 *
 * @param {Object} partOrForecastItem - Part or forecast item with description/part_number/site_quantities
 * @param {Array} activeServiceSites - Array of active branch site objects
 * @param {Object} [existingAlloc=null] - Optional existing allocation row
 * @returns {Array<{siteId: string, historicalDemand: number}>}
 */
export function resolvePartSiteDemands(partOrForecastItem, activeServiceSites = [], existingAlloc = null) {
  if (!Array.isArray(activeServiceSites) || activeServiceSites.length === 0) {
    return [];
  }

  // Priority 1: Real empirical shares for this exact part from historical site_quantities / site_counts
  const sources = [
    partOrForecastItem?.site_counts,
    partOrForecastItem?.site_quantities,
    existingAlloc?.site_counts,
    existingAlloc?.site_quantities
  ];

  for (const src of sources) {
    if (src && typeof src === 'object' && Object.keys(src).length > 0) {
      let totalCount = 0;
      const demands = activeServiceSites.map(s => {
        const val = src[s.id] ?? src[s.code] ?? (s.name ? src[s.name] : undefined);
        const count = typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : 0;
        totalCount += count;
        return { siteId: s.id, historicalDemand: count };
      });

      if (totalCount > 0) {
        return demands;
      }
    }
  }

  // Priority 2: Fall back to per-part canonical shares in canonicalShares.js
  const desc = (partOrForecastItem?.description || existingAlloc?.description || '').trim();
  const lowerDesc = desc.toLowerCase();
  let rowShares = null;

  if (lowerDesc.includes('display') || lowerDesc.includes('screen')) {
    const dIdx = CANONICAL_DISPLAY_DESCS.findIndex(d => d.toLowerCase() === lowerDesc || d === desc);
    if (dIdx >= 0 && displayShares && displayShares[dIdx]) {
      rowShares = displayShares[dIdx];
    }
  } else if (lowerDesc.includes('battery') || lowerDesc.includes('batt')) {
    let bIdx = CANONICAL_BATTERY_SHARE_DESCS.findIndex(d => d.toLowerCase() === lowerDesc || d === desc);
    if (bIdx < 0) {
      bIdx = CANONICAL_BATTERY_DESCS.findIndex(d => d.toLowerCase() === lowerDesc || d === desc);
    }
    if (bIdx >= 0 && batteryShares && batteryShares[bIdx]) {
      rowShares = batteryShares[bIdx];
    }
  }

  if (rowShares && Array.isArray(rowShares) && rowShares.length > 0) {
    let totalCanonicalShare = 0;
    const demands = activeServiceSites.map((s, sIdx) => {
      // Find matching column index in canonical site order (code match has highest priority)
      let siteColIdx = CANONICAL_SITE_LIST.findIndex(cs => cs.code === s.code);
      if (siteColIdx < 0) {
        siteColIdx = CANONICAL_SITE_CODES.indexOf(s.code);
      }
      if (siteColIdx < 0 && s.name) {
        siteColIdx = CANONICAL_SITE_LIST.findIndex(cs =>
          cs.name && (cs.name.includes(s.name) || s.name.includes(cs.name))
        );
      }
      if (siteColIdx < 0) {
        siteColIdx = sIdx;
      }

      const share = (siteColIdx >= 0 && siteColIdx < rowShares.length) ? (rowShares[siteColIdx] || 0) : 0;
      totalCanonicalShare += share;
      return { siteId: s.id, historicalDemand: share };
    });

    if (totalCanonicalShare > 0) {
      return demands;
    }
  }

  // Priority 3: Fall back to uniform split across active branches (demand = 1 for each active branch)
  return activeServiceSites.map(s => ({ siteId: s.id, historicalDemand: 1 }));
}

/**
 * Calculates proportional allocation for a part to active sites using resolved per-part demand weights.
 * Guarantees sum(allocations) strictly equals round(targetQty) with zero drift.
 *
 * @param {number} targetQty
 * @param {Object} partOrForecastItem
 * @param {Array} activeServiceSites
 * @param {Object} [existingAlloc=null]
 * @returns {Array<{siteId: string, sharePct: number, allocatedQty: number}>}
 */
export function allocatePartToSites(targetQty, partOrForecastItem, activeServiceSites = [], existingAlloc = null) {
  const siteDemands = resolvePartSiteDemands(partOrForecastItem, activeServiceSites, existingAlloc);
  return calculateProportionalAllocation(targetQty, siteDemands);
}

/**
 * Lightweight consistency check verifying active branch count matches canonical share columns
 * @param {Array} sitesList
 * @returns {{isValid: boolean, activeCount: number, expectedCount: number, message?: string}}
 */
export function validateSiteSharesConsistency(sitesList = []) {
  const activeServiceSites = (sitesList || []).filter(s =>
    !s.is_dc &&
    !s.code?.toUpperCase().includes('DC') &&
    !s.code?.toUpperCase().includes('MOBILEC') &&
    !s.name?.toLowerCase().includes('distribution') &&
    s.code !== 'DC-MDC'
  );
  const expectedCount = displayShares?.[0]?.length || CANONICAL_SITE_CODES.length;
  const activeCount = activeServiceSites.length;
  const isValid = activeCount === expectedCount;
  if (!isValid && typeof console !== 'undefined') {
    console.warn(`[Allocation Consistency Warning] Active branches count (${activeCount}) does not match canonical matrix columns (${expectedCount}).`);
  }
  return {
    isValid,
    activeCount,
    expectedCount,
    message: isValid ? undefined : `Active branches count (${activeCount}) does not match canonical matrix columns (${expectedCount})`
  };
}

/**
 * Option A — Bit-for-Bit Excel Parity Allocation
 * Replicates the confirmed formula behavior in the live reference Excel workbook:
 * =IF($C{row}<=0, 0, MAX(0, ROUND($C{row} * SUM($H${baseShareRow}:Col{shareRow}), 0) - ROUND($C{row} * (SUM($H${baseShareRow}:Col{shareRow}) - Col{shareRow}), 0)))
 *
 * For the i-th part (0-indexed) within its commodity block (Battery or Display),
 * and each site column c (0 to numCols - 1):
 *   sumBlock(i, c) = sum of shares[r][c'] for r = 0..i and c' = 0..c
 *   cellShare      = shares[i][c]
 *   alloc(i, c)    = max(0, round(forecastQty * sumBlock) - round(forecastQty * (sumBlock - cellShare)))
 *
 * @param {number} forecastQty - Monthly forecasted units for this part
 * @param {number[][]} shareMatrix - 2D matrix of branch shares [row][col] for the commodity block
 * @param {number} matrixRowIdx - 0-based index of this part within its commodity block
 * @returns {number[]} Array of allocated integer units per branch
 */
export function calculateOptionAAllocation(forecastQty, shareMatrix, matrixRowIdx) {
  if (!shareMatrix || shareMatrix.length === 0 || matrixRowIdx < 0 || matrixRowIdx >= shareMatrix.length) {
    return [];
  }

  const numCols = shareMatrix[0]?.length || 0;
  if (numCols === 0) return [];

  const targetQty = Math.max(0, Math.round(forecastQty || 0));
  if (targetQty <= 0) {
    return new Array(numCols).fill(0);
  }

  const allocs = [];
  for (let c = 0; c < numCols; c++) {
    let sumBlock = 0;
    for (let r = 0; r <= matrixRowIdx; r++) {
      for (let cp = 0; cp <= c; cp++) {
        sumBlock += (shareMatrix[r] ? (shareMatrix[r][cp] || 0) : 0);
      }
    }
    const cellShare = shareMatrix[matrixRowIdx] ? (shareMatrix[matrixRowIdx][c] || 0) : 0;
    const term1 = roundExcel(targetQty * sumBlock);
    const term2 = roundExcel(targetQty * (sumBlock - cellShare));
    const alloc = Math.max(0, term1 - term2);
    allocs.push(alloc);
  }

  return allocs;
}

/**
 * Option B — Corrected, Self-Consistent 2D Cumulative Allocation
 * Calculates Proportional Branch Quota Allocation where each part is strictly allocated
 * using ONLY its own model-level empirical site shares.
 * Guarantees that sum(site allocations) strictly equals round(forecastQty) with zero drift.
 *
 * @param {number} forecastQty - Monthly forecasted units for this model
 * @param {number[][]} shareMatrix - 2D matrix of branch shares [row][col]
 * @param {number} matrixRowIdx - Zero-based index of this model in shareMatrix
 * @returns {number[]} Array of integer allocated units per branch
 */
export function calculate2DCumulativeAllocation(forecastQty, shareMatrix, matrixRowIdx) {
  if (!shareMatrix || shareMatrix.length === 0 || matrixRowIdx < 0 || matrixRowIdx >= shareMatrix.length) {
    return [];
  }

  const rawRowShares = shareMatrix[matrixRowIdx];
  if (!rawRowShares || rawRowShares.length === 0) return [];
  const numCols = rawRowShares.length;

  const targetQty = Math.max(0, Math.round(forecastQty || 0));
  if (targetQty <= 0) {
    return new Array(numCols).fill(0);
  }

  // Calculate sum of shares for this model row
  const sumShares = rawRowShares.reduce((s, v) => s + (v || 0), 0);
  const rowShares = sumShares > 0 ? rawRowShares : new Array(numCols).fill(1 / numCols);
  const totalRowShare = sumShares > 0 ? sumShares : 1;

  const result = [];
  let cumulativeShare = 0;

  for (let c = 0; c < numCols; c++) {
    const prevCumulative = cumulativeShare;
    cumulativeShare += (rowShares[c] || 0) / totalRowShare;

    // Enforce 1.0 boundary at final column to prevent floating point residual
    if (c === numCols - 1) {
      cumulativeShare = 1.0;
    }

    const alloc = Math.max(
      0,
      roundExcel(targetQty * cumulativeShare) - roundExcel(targetQty * prevCumulative)
    );
    result.push(alloc);
  }

  return result;
}

/** Alias for Option B */
export const calculateOptionBAllocation = calculate2DCumulativeAllocation;

/**
 * Calculates fair proportional allocation across sites given an array of site demands.
 * Guarantees that sum(allocations) exactly equals totalReceivedQty.
 *
 * @param {number} totalReceivedQty - Total monthly forecasted quantity / available stock to allocate
 * @param {Array<{siteId: string, historicalDemand: number, orderedQty?: number}>} siteDemands
 * @returns {Array<{siteId: string, sharePct: number, allocatedQty: number}>}
 */
export function calculateProportionalAllocation(totalReceivedQty, siteDemands = []) {
  if (totalReceivedQty <= 0 || !siteDemands || siteDemands.length === 0) {
    return siteDemands.map(s => ({
      siteId: s.siteId,
      sharePct: 0,
      allocatedQty: 0
    }));
  }

  const targetQty = Math.max(0, Math.round(totalReceivedQty));
  if (targetQty === 0) {
    return siteDemands.map(s => ({
      siteId: s.siteId,
      sharePct: 0,
      allocatedQty: 0
    }));
  }

  const totalDemand = siteDemands.reduce((sum, s) => sum + (s.historicalDemand || 0), 0);

  // If no demand history across any site, distribute evenly
  if (totalDemand === 0) {
    let cumulativeDemandShare = 0;
    const uniformShare = 1 / siteDemands.length;
    return siteDemands.map((s, idx) => {
      const prevCum = cumulativeDemandShare;
      cumulativeDemandShare = (idx + 1) * uniformShare;
      const allocatedQty = Math.max(
        0,
        Math.round(targetQty * cumulativeDemandShare) - Math.round(targetQty * prevCum)
      );
      return {
        siteId: s.siteId,
        sharePct: uniformShare,
        allocatedQty
      };
    });
  }

  // Exact Excel Cumulative Rounding Formula
  let cumulativeShare = 0;
  const totalSites = siteDemands.length;
  return siteDemands.map((s, idx) => {
    const demand = s.historicalDemand || 0;
    const sharePct = demand / totalDemand;
    const prevCumulativeShare = cumulativeShare;
    cumulativeShare += sharePct;

    // Enforce 1.0 boundary at final site to prevent floating-point residual
    if (idx === totalSites - 1) {
      cumulativeShare = 1.0;
    }

    const allocatedQty = Math.max(
      0,
      roundExcel(targetQty * cumulativeShare) - roundExcel(targetQty * prevCumulativeShare)
    );

    return {
      siteId: s.siteId,
      sharePct,
      allocatedQty
    };
  });
}

/**
 * Calculates 4-Week Split matching verified Excel formula:
 * =LET(p, AI, c, AJ, uc, IF(p>0, c/p, 0), b, INT(p/4), rem, MOD(p, 4), dir, ISEVEN(ROW()),
 *      w1p, b + IF(dir, IF(rem>=1, 1, 0), 0),
 *      w2p, b + IF(dir, IF(rem>=2, 1, 0), IF(rem=3, 1, 0)),
 *      w3p, b + IF(dir, IF(rem=3, 1, 0), IF(rem>=2, 1, 0)),
 *      w4p, p - w1p - w2p - w3p,
 *      w1c, w1p * uc, w2c, w2p * uc, w3c, w3p * uc, w4c, c - w1c - w2c - w3c,
 *      [w1p, w1c, w2p, w2c, w3p, w3c, w4p, w4c])
 *
 * Row parity:
 *   Display block starts at row 3 (odd -> dir is false)
 *   Battery block starts at row 25 (odd -> dir is false)
 *
 * @param {number} totalQty - Total monthly quantity allocated to a site
 * @param {number} totalCostOrRowIndex - Total stock cost for the row, or row index if 2 params passed
 * @param {number|null} maybeRowIndex - Row index for alternating direction parity (1-based or 0-based)
 * @returns {{week1: number, week2: number, week3: number, week4: number, w1_qty: number, w2_qty: number, w3_qty: number, w4_qty: number, w1_cost: number, w2_cost: number, w3_cost: number, w4_cost: number}}
 */
export function calculateWeeklySplit(totalQty, totalCostOrRowIndex = 0, maybeRowIndex = null) {
  const p = Math.max(0, Math.round(totalQty || 0));
  const totalCost = typeof totalCostOrRowIndex === 'number' && maybeRowIndex !== null ? totalCostOrRowIndex : 0;
  const rowIndex = maybeRowIndex !== null ? maybeRowIndex : (typeof totalCostOrRowIndex === 'number' ? totalCostOrRowIndex : 0);

  const uc = p > 0 && totalCost > 0 ? totalCost / p : 0;
  if (p === 0) {
    return {
      week1: 0, week2: 0, week3: 0, week4: 0,
      w1_qty: 0, w2_qty: 0, w3_qty: 0, w4_qty: 0,
      w1_cost: 0, w2_cost: 0, w3_cost: 0, w4_cost: 0
    };
  }

  const b = Math.floor(p / 4);
  const rem = p % 4;
  const isEven = rowIndex % 2 === 0;

  const w1 = b + (isEven ? (rem >= 1 ? 1 : 0) : 0);
  const w2 = b + (isEven ? (rem >= 2 ? 1 : 0) : (rem === 3 ? 1 : 0));
  const w3 = b + (isEven ? (rem === 3 ? 1 : 0) : (rem >= 2 ? 1 : 0));
  const w4 = p - w1 - w2 - w3;

  const w1c = w1 * uc;
  const w2c = w2 * uc;
  const w3c = w3 * uc;
  const w4c = totalCost > 0 ? totalCost - w1c - w2c - w3c : 0;

  return {
    week1: w1,
    week2: w2,
    week3: w3,
    week4: w4,
    w1_qty: w1,
    w2_qty: w2,
    w3_qty: w3,
    w4_qty: w4,
    w1_cost: w1c,
    w2_cost: w2c,
    w3_cost: w3c,
    w4_cost: w4c
  };
}

/**
 * Generates the operational order remark:
 * IF(total_allocated_qty == 0, "NO NEED TO ORDER", "ORDER REQUIRED")
 *
 * @param {number} totalAllocatedQty
 * @returns {'NO NEED TO ORDER' | 'ORDER REQUIRED'}
 */
export function getOrderRemark(totalAllocatedQty) {
  return (totalAllocatedQty || 0) === 0 ? 'NO NEED TO ORDER' : 'ORDER REQUIRED';
}

/**
 * Computes summary totals and remarks across an array of allocation rows
 * @param {Array} allocationItems
 * @returns {Object}
 */
export function calculateAllocationTotalsAndRemarks(allocationItems = []) {
  const summary = {
    totalForecastUnits: 0,
    totalAllocatedUnits: 0,
    totalStockCost: 0,
    w1_qty: 0,
    w1_cost: 0,
    w2_qty: 0,
    w2_cost: 0,
    w3_qty: 0,
    w3_cost: 0,
    w4_qty: 0,
    w4_cost: 0,
    siteTotals: {},
    siteCosts: {}
  };

  (allocationItems || []).forEach(item => {
    summary.totalForecastUnits += item.forecasted_qty || 0;
    summary.totalAllocatedUnits += item.total_allocated_qty || 0;
    summary.totalStockCost += item.total_stock_cost || 0;
    summary.w1_qty += item.w1_qty || 0;
    summary.w1_cost += item.w1_cost || 0;
    summary.w2_qty += item.w2_qty || 0;
    summary.w2_cost += item.w2_cost || 0;
    summary.w3_qty += item.w3_qty || 0;
    summary.w3_cost += item.w3_cost || 0;
    summary.w4_qty += item.w4_qty || 0;
    summary.w4_cost += item.w4_cost || 0;

    const price = item.stocking_price || 0;
    if (item.site_quantities) {
      Object.entries(item.site_quantities).forEach(([siteKey, qty]) => {
        summary.siteTotals[siteKey] = (summary.siteTotals[siteKey] || 0) + (qty || 0);
        summary.siteCosts[siteKey] = (summary.siteCosts[siteKey] || 0) + ((qty || 0) * price);
      });
    }
  });

  return summary;
}

/**
 * Helper to determine if an item belongs to the Display category
 * @param {Object} item
 * @returns {boolean}
 */
export function isDisplayCategoryOrDesc(item) {
  if (!item) return false;
  if (item.category_id === 'cat-display') return true;
  const desc = (item.description || '').toLowerCase();
  const cat = (item.category_id || '').toLowerCase();
  return desc.includes('display') && !cat.includes('battery') && !desc.includes('battery');
}

/**
 * Calculates Excel ISEVEN(ROW()) row parity offset based on commodity category.
 * Display block starts at row 3 (offset +3).
 * Battery block starts at row 25 (offset +4 due to subtotal separator row).
 * @param {Object} item
 * @returns {number}
 */
export function getRowParityOffset(item) {
  return isDisplayCategoryOrDesc(item) ? 3 : 4;
}

/**
 * Generates or synchronizes allocations from an array of forecastItems across service sites
 * @param {Array} forecastList
 * @param {Array} sitesList
 * @param {string} activeModel
 * @param {Array} existingAllocations
 * @returns {Array}
 */
export function generateAllocationsFromForecasts(forecastList = [], sitesList = [], activeModel = 'linear', existingAllocations = []) {
  if (!Array.isArray(forecastList) || forecastList.length === 0) return [];
  const activeServiceSites = (sitesList || []).filter(s =>
    !s.is_dc &&
    !s.code?.toUpperCase().includes('DC') &&
    !s.code?.toUpperCase().includes('MOBILEC') &&
    !s.name?.toLowerCase().includes('distribution') &&
    s.code !== 'DC-MDC'
  );
  if (activeServiceSites.length === 0) return [];

  validateSiteSharesConsistency(sitesList);

  return forecastList.map((fi, rIdx) => {
    // Authoritative Single Source of Truth for forecast quantity:
    // Read from final_forecast / computed_forecast directly, or compute using calculateItemForecast
    const fiQty = fi.final_forecast !== undefined && fi.final_forecast !== null
      ? fi.final_forecast
      : (fi.computed_forecast !== undefined && fi.computed_forecast !== null
          ? fi.computed_forecast
          : calculateItemForecast(fi, activeModel));
    const fiPrice = fi.stocking_price || (isDisplayCategoryOrDesc(fi) ? 279 : 99);

    const existingAlloc = (existingAllocations || []).find(a =>
      a.part_id === fi.part_id ||
      a.part_number === fi.part_number ||
      (a.description && fi.description && a.description.trim().toLowerCase() === fi.description.trim().toLowerCase())
    );

    const fiResults = allocatePartToSites(fiQty, fi, activeServiceSites, existingAlloc);
    const sq = {};
    let tAlloc = 0;
    fiResults.forEach(res => {
      sq[res.siteId] = res.allocatedQty;
      const siteObj = activeServiceSites.find(s => s.id === res.siteId);
      if (siteObj?.code) sq[siteObj.code] = res.allocatedQty;
      tAlloc += res.allocatedQty;
    });

    const tCost = tAlloc * fiPrice;
    const rowParityOffset = getRowParityOffset(fi);
    const fiSplit = calculateWeeklySplit(tAlloc, tCost, rIdx + rowParityOffset);

    return {
      part_id: fi.part_id,
      part_number: fi.part_number,
      description: fi.description,
      category_id: fi.category_id || (isDisplayCategoryOrDesc(fi) ? 'cat-display' : 'cat-battery'),
      forecasted_qty: fiQty,
      stocking_price: fiPrice,
      exchange_price: fi.exchange_price || existingAlloc?.exchange_price || 0,
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
      site_quantities: sq,
      remarks: getOrderRemark(tAlloc)
    };
  });
}
