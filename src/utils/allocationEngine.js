/**
 * Allocation Engine for Multi-Site Distribution
 * Implements:
 *   - Option A: Bit-for-Bit Excel Parity Allocation (replicates live Excel cumulative 2D windowed sum down column)
 *   - Option B: Corrected Self-Consistent 2D Cumulative Allocation (strictly model's own empirical site shares)
 *   - Hamilton-Hare Proportional Quota Allocation
 *   - Verified 4-Week Alternating Parity Split
 *   - Order Remark Generation ("NO NEED TO ORDER" / "ORDER REQUIRED")
 */

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
    const alloc = Math.max(0, Math.round(targetQty * sumBlock) - Math.round(targetQty * (sumBlock - cellShare)));
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
      Math.round(targetQty * cumulativeShare) - Math.round(targetQty * prevCumulative)
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
  return siteDemands.map(s => {
    const demand = s.historicalDemand || 0;
    const sharePct = demand / totalDemand;
    const prevCumulativeShare = cumulativeShare;
    cumulativeShare += sharePct;

    const allocatedQty = Math.max(
      0,
      Math.round(targetQty * cumulativeShare) - Math.round(targetQty * prevCumulativeShare)
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
