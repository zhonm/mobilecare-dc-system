/**
 * Forecasting Engine for Apple Parts Usage
 * Implements 4-Month Weighted Moving Average (WMA) with Winsorized Anomaly Filtering
 * and OLS Linear Regression (FORECAST.LINEAR) — plain, no pre-filtering.
 *
 * Active models: 'wma' (4MO WMA) | 'linear' (FORECAST.LINEAR)
 *
 * IMPORTANT — Winsorization and model separation:
 *   • 'wma'    — Winsorized anomaly filtering ON by default.  Prevents isolated
 *                promotional/seasonal spikes (e.g. July 2026 battery surge) from
 *                distorting the 4-month weighted window.
 *   • 'linear' — Winsorized filtering OFF by default.  The Google Sheet reference
 *                uses Excel FORECAST.LINEAR with no pre-processing; applying
 *                Winsorization here causes systematic divergence from the sheet.
 *                Pass { filterAnomalies: true } explicitly only if you specifically
 *                want spike-dampening on top of linear regression.
 */

// ── Default Parameters ────────────────────────────────────────────────────────
export const DEFAULT_WMA_WEIGHTS_4M = [0.10, 0.20, 0.30, 0.40]; // May: 10%, Jun: 20%, Jul: 30%, Aug: 40%
export const DEFAULT_ANOMALY_SIGMA_THRESHOLD = 1.5;

/** Safe numeric coercion — preserves real zeros, maps NaN/undefined/null/strings to 0 */
export const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Safe numeric rounding that replicates Excel's half-up rational rounding
 * and achieves parity with Excel's 15-significant-digit arithmetic.
 *
 * ── Why toFixed(9) ────────────────────────────────────────────────────────
 * IEEE 754 double precision represents some fractions imprecisely.  For example:
 *   11 × (15/22)  =  165/22  =  7.5  exactly in mathematics
 * but JavaScript's binary FP computes it as 7.4999999999999991.
 * Excel operates with 15 significant decimal digits and obtains 7.5 → rounds to 8.
 *
 * toFixed(9) serialises the value to 9 decimal places, stripping the 10th-16th
 * digit noise introduced by FP representation.  The result is then re-parsed
 * and passed to Math.round:
 *   7.4999999999999991 → '7.500000000' → 7.5 → Math.round → 8   ✓ matches Excel
 *   3.0000000000000004 → '3.000000000' → 3.0 → Math.round → 3   ✓ strips residual
 *   2.5                → '2.500000000' → 2.5 → Math.round → 3   ✓ half-up
 *
 * ── When NOT to use ───────────────────────────────────────────────────────
 * Do NOT use roundExcel for values whose mathematical result is genuinely
 * X.4999… (truly less than a half-integer).  In the allocation context all
 * rounding is applied to products of integer qty × rational share, so the
 * mathematical result is always rational and the toFixed(9) representation
 * is reliable.
 *
 * @param {number} val
 * @returns {number}
 */
export function roundExcel(val) {
  const n = toNum(val);
  return Math.round(Number(n.toFixed(9)));
}


/**
 * Detects and dampens statistical anomalies (Winsorization).
 * Prevents isolated promotional/seasonal volume spikes (e.g. July 2026 battery surge)
 * from artificially skewing subsequent month projections.
 *
 * @param {number[]} yValues - Array of monthly usage numbers
 * @param {number} sigmaThreshold - Standard deviation multiplier threshold (default: 1.5)
 * @returns {{
 *   cleanedValues: number[],
 *   hasAnomaly: boolean,
 *   anomalyIndices: number[],
 *   anomalyDetails: Array<{ index: number, originalValue: number, smoothedValue: number, threshold: number }>
 * }}
 */
export function filterAnomaliesWinsorized(yValues = [], sigmaThreshold = DEFAULT_ANOMALY_SIGMA_THRESHOLD) {
  if (!yValues || yValues.length < 3) {
    return {
      cleanedValues: [...yValues],
      hasAnomaly: false,
      anomalyIndices: [],
      anomalyDetails: []
    };
  }

  const numericVals = yValues.map(v => toNum(v));
  const n = numericVals.length;

  const mean = numericVals.reduce((sum, v) => sum + v, 0) / n;
  const variance = numericVals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // If variance is negligible, return original values
  if (stdDev < 1.0) {
    return {
      cleanedValues: numericVals,
      hasAnomaly: false,
      anomalyIndices: [],
      anomalyDetails: []
    };
  }

  const upperCap = Math.round(mean + sigmaThreshold * stdDev);
  const anomalyIndices = [];
  const anomalyDetails = [];

  const cleanedValues = numericVals.map((val, idx) => {
    // Only filter upward spikes for months prior to the latest month, or if significantly above historical norm
    if (val > upperCap && (idx < n - 1 || val > mean + sigmaThreshold * stdDev)) {
      anomalyIndices.push(idx);
      anomalyDetails.push({
        index: idx,
        originalValue: val,
        smoothedValue: upperCap,
        threshold: upperCap
      });
      return upperCap;
    }
    return val;
  });

  return {
    cleanedValues,
    hasAnomaly: anomalyIndices.length > 0,
    anomalyIndices,
    anomalyDetails
  };
}

/**
 * Option 1: 4-Month Weighted Moving Average (WMA) Forecast Engine with Anomaly Filtering
 * 
 * Formula:
 *   Y_hat = sum(w_i * Y_i) / sum(w_i)
 *
 * @param {number[]} yValues - Array of historical monthly counts [Jan, Feb, ..., Current]
 * @param {number[]} customWeights - Optional custom weight array (default: [0.10, 0.20, 0.30, 0.40])
 * @param {object} options - Options { filterAnomalies: boolean, sigmaThreshold: number }
 * @returns {number} Forecasted integer demand (rounded, minimum 0)
 */
export function calculateWeightedMovingAverageForecast(
  yValues = [],
  customWeights = DEFAULT_WMA_WEIGHTS_4M,
  options = { filterAnomalies: true, sigmaThreshold: DEFAULT_ANOMALY_SIGMA_THRESHOLD }
) {
  if (!yValues || yValues.length === 0) return 0;

  let valuesToUse = yValues.map(v => toNum(v));

  // Apply Winsorized anomaly filtering if enabled
  if (options.filterAnomalies !== false) {
    const filterResult = filterAnomaliesWinsorized(valuesToUse, options.sigmaThreshold || DEFAULT_ANOMALY_SIGMA_THRESHOLD);
    valuesToUse = filterResult.cleanedValues;
  }

  const weights = (customWeights && customWeights.length > 0) ? customWeights : DEFAULT_WMA_WEIGHTS_4M;
  const windowSize = weights.length;
  
  // Slice the trailing window (up to windowSize months)
  const slicedValues = valuesToUse.slice(-windowSize);
  const actualK = slicedValues.length;

  if (actualK === 0) return 0;

  // Align weights to available months
  const activeWeights = weights.slice(-actualK);
  const sumWeights = activeWeights.reduce((sum, w) => sum + w, 0);

  if (sumWeights === 0) {
    const avg = slicedValues.reduce((sum, v) => sum + v, 0) / actualK;
    return Math.max(0, Math.round(avg));
  }

  let weightedSum = 0;
  for (let i = 0; i < actualK; i++) {
    weightedSum += activeWeights[i] * slicedValues[i];
  }

  const rawForecast = weightedSum / sumWeights;
  return Math.max(0, Math.round(rawForecast));
}

/**
 * Option 2: OLS Linear Regression Forecast — replicates Excel/Google Sheets FORECAST.LINEAR.
 *
 * Formula:
 *   FORECAST.LINEAR(targetX, known_y, known_x)
 *   where known_x = [1, 2, …, n] and known_y = monthly usage counts.
 *
 * ── Google Sheet parity ───────────────────────────────────────────────────────
 *   The Google Sheet reference ("Battery & Display Allocation") uses the native
 *   FORECAST.LINEAR function with NO anomaly pre-filtering.  Enabling Winsorization
 *   here caused ~40% of forecasts to diverge from the sheet (e.g. July 2026 battery
 *   surge was capped, pulling the slope down and producing values 5-15% too low).
 *
 *   Winsorization defaults to OFF for the linear model.  The WMA model retains it
 *   because the 4-month window is much more sensitive to single-month spikes.
 *
 * ── x-value indexing ─────────────────────────────────────────────────────────
 *   x-values are 1-indexed from the first real data point — no leading-zero padding
 *   is applied here (that would drag the slope down artificially).
 *
 * @param {number[]} yValues  - Array of historical monthly counts (actual data only)
 * @param {number}   targetX  - Target month index (default: n+1, i.e. next month)
 * @param {object}   options  - { filterAnomalies?: boolean, sigmaThreshold?: number }
 *                              filterAnomalies defaults to FALSE for linear model.
 * @returns {number} Forecasted integer demand (JS Math.round, minimum 0)
 */
export function calculateLinearRegressionForecast(yValues = [], targetX = null, options = {}) {
  if (!yValues || yValues.length === 0) return 0;

  let valuesToUse = yValues.map(v => toNum(v));

  // ── Winsorization: OFF by default for linear, matches Google Sheet FORECAST.LINEAR ──
  // Pass { filterAnomalies: true } explicitly only when spike-dampening is desired
  // on top of regression (e.g. experimental use — not the GS-parity production path).
  if (options.filterAnomalies === true) {
    const filterResult = filterAnomaliesWinsorized(valuesToUse, options.sigmaThreshold || DEFAULT_ANOMALY_SIGMA_THRESHOLD);
    valuesToUse = filterResult.cleanedValues;
  }

  const n = valuesToUse.length;
  const target = targetX !== null ? targetX : n + 1;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = valuesToUse[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    const avg = sumY / n;
    return Math.max(0, Math.round(avg));
  }

  // OLS slope (beta) and intercept (alpha)
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const rawForecast = intercept + slope * target;
  return Math.max(0, Math.round(rawForecast));
}


/**
 * Holt's Linear Trend Exponential Smoothing Forecast Engine
 * Level: L_t = alpha * Y_t + (1 - alpha) * (L_{t-1} + T_{t-1})
 * Trend: T_t = beta * (L_t - L_{t-1}) + (1 - beta) * T_{t-1}
 * Forecast: Y_hat_{t+m} = L_t + m * T_t
 * @deprecated Not exposed in UI — kept for library completeness only.
 */
export function calculateHoltsLinearForecast(yValues = [], alpha = 0.3, beta = 0.1) {
  if (!yValues || yValues.length === 0) return 0;
  const n = yValues.length;
  if (n === 1) return Math.max(0, Math.round(yValues[0]));

  let level = toNum(yValues[0]);
  let trend = toNum(yValues[1]) - toNum(yValues[0]);

  for (let t = 1; t < n; t++) {
    const y = toNum(yValues[t]);
    const prevLevel = level;
    level = alpha * y + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const forecast = level + trend;
  return Math.max(0, Math.round(forecast));
}

/**
 * Croston's Syntetos-Boylan Approximation (SBA) for Intermittent / Lumpy Demand
 * @deprecated Not exposed in UI — kept for library completeness only.
 */
export function calculateCrostonForecast(yValues = [], alpha = 0.1) {
  if (!yValues || yValues.length === 0) return 0;
  const n = yValues.length;

  let demandSize = 0;
  let interval = 1;
  let periodsSinceLastDemand = 0;
  let firstDemandFound = false;

  for (let t = 0; t < n; t++) {
    const y = toNum(yValues[t]);
    periodsSinceLastDemand++;

    if (y > 0) {
      if (!firstDemandFound) {
        demandSize = y;
        interval = 1;
        firstDemandFound = true;
      } else {
        demandSize = alpha * y + (1 - alpha) * demandSize;
        interval = alpha * periodsSinceLastDemand + (1 - alpha) * interval;
      }
      periodsSinceLastDemand = 0;
    }
  }

  if (!firstDemandFound || interval === 0) return 0;

  const sbaForecast = (1 - alpha / 2) * (demandSize / interval);
  return Math.max(0, Math.round(sbaForecast));
}

/**
 * Master Forecast Dispatcher
 * Dispatches calculation based on selected model strategy.
 *
 * Winsorization is model-aware:
 *   • linear — always passes filterAnomalies: false regardless of what the caller
 *               supplied, so the result matches Google Sheet FORECAST.LINEAR exactly.
 *   • wma    — passes caller-supplied options (filterAnomalies: true by default).
 *
 * @param {number[]} yValues - Monthly historical counts
 * @param {'wma'|'linear'} modelType - Active model type (default: 'linear')
 * @param {object} options - Calculation options & category info
 * @returns {number} Forecast demand
 */
export function calculateForecastByModel(yValues = [], modelType = 'linear', options = {}) {
  if (!yValues || yValues.length === 0) return 0;

  switch (modelType) {
    case 'wma':
    case 'wma_4m':
      return calculateWeightedMovingAverageForecast(yValues, options.weights || DEFAULT_WMA_WEIGHTS_4M, {
        ...options,
        filterAnomalies: options.filterAnomalies !== false
      });

    case 'linear':
    case 'forecast_linear':
    default:
      // Default to Linear regression — matches Google Sheet FORECAST.LINEAR as the primary system baseline
      return calculateLinearRegressionForecast(yValues, options.targetX, {
        ...options,
        filterAnomalies: false
      });
  }
}


/**
 * Standardized Forecast Calculation for an item.
 *
 * ── Linear Regression path ────────────────────────────────────────────────────
 *   Raw ytd_monthly_counts are used DIRECTLY with no leading-zero padding and no
 *   Winsorized pre-filtering.  This exactly replicates the Google Sheet formula:
 *     FORECAST.LINEAR(n+1, known_y, known_x)
 *   where known_x = [1,2,...,n] and known_y are the actual recorded monthly counts.
 *
 *   Disabling Winsorization is the key parity fix: previously the filter was on by
 *   default, which capped anomaly months (e.g. July 2026 battery surge) and caused
 *   ~40% of forecasts to diverge from the reference sheet values.
 *
 * ── WMA path ─────────────────────────────────────────────────────────────────
 *   Right-aligned zero-padding to historyLength is preserved for WMA.  Winsorization
 *   stays ON — the 4-month window is far more sensitive to single-month spikes than
 *   the full-history OLS line.
 *
 * @param {object} item - Forecast item containing ytd_monthly_counts, category_id, description
 * @param {string} modelType - Active model algorithm ('wma'|'linear')
 * @param {number|null} [historyLength=null] - Optional history window length override. When omitted or null, dynamically uses full item history.
 * @returns {number} Integer forecast demand
 */
export function calculateItemForecast(item, modelType = 'linear', historyLength = null) {
  if (!item) return 0;
  const rawCounts = Array.isArray(item.ytd_monthly_counts) ? item.ytd_monthly_counts : [];

  // Slice historical counts according to active historyLength window if specified
  const effectiveCounts = (typeof historyLength === 'number' && historyLength > 0 && historyLength < rawCounts.length)
    ? rawCounts.slice(0, historyLength)
    : rawCounts;

  // ── Linear Regression: plain FORECAST.LINEAR — no Winsorization, no zero-padding ──
  if (modelType === 'linear' || modelType === 'forecast_linear') {
    const actualCounts = effectiveCounts.map(v => toNum(v));
    if (actualCounts.length === 0) return 0;
    const targetX = actualCounts.length + 1;
    return calculateLinearRegressionForecast(actualCounts, targetX, {
      filterAnomalies: false,   // must stay false — matches Google Sheet FORECAST.LINEAR
      categoryId: item.category_id,
      description: item.description
    });
  }

  // ── WMA (and all other models): right-align with leading zeros + Winsorization ──
  const targetLen = (typeof historyLength === 'number' && historyLength > 0)
    ? historyLength
    : (effectiveCounts.length > 0 ? effectiveCounts.length : 4);
  const offset = targetLen - effectiveCounts.length;
  const counts = Array.from({ length: targetLen }, (_, idx) => {
    const dataIdx = idx - offset;
    return dataIdx >= 0 && dataIdx < effectiveCounts.length ? (toNum(effectiveCounts[dataIdx])) : 0;
  });
  const targetX = targetLen + 1;
  return calculateForecastByModel(counts, modelType, {
    targetX,
    filterAnomalies: true,
    categoryId: item.category_id,
    description: item.description
  });
}


/**
 * Calculates trend direction and metrics over historical monthly numbers
 * @param {number[]} yValues 
 * @returns {{ slope: number, trend: 'increasing'|'decreasing'|'stable', momGrowthPct: number, average: number, hasAnomaly: boolean, anomalyIndices: number[] }}
 */
export function calculateForecastTrendMetrics(yValues = []) {
  if (!yValues || yValues.length === 0) {
    return { slope: 0, trend: 'stable', momGrowthPct: 0, average: 0, hasAnomaly: false, anomalyIndices: [] };
  }

  const n = yValues.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = toNum(yValues[i]);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const avg = sumY / n;
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;

  let trend = 'stable';
  if (slope > 0.35) trend = 'increasing';
  else if (slope < -0.35) trend = 'decreasing';

  // Month-over-month growth of the last 2 recorded periods
  let momGrowthPct = 0;
  if (n >= 2) {
    const last = toNum(yValues[n - 1]);
    const prev = toNum(yValues[n - 2]);
    if (prev > 0) {
      momGrowthPct = Math.round(((last - prev) / prev) * 100);
    } else if (last > 0) {
      momGrowthPct = Math.min(last * 100, 999); // Scale by actual magnitude, cap at 999% to prevent UI overflow
    }
  }

  // Check for statistical anomaly in historical data
  const anomalyInfo = filterAnomaliesWinsorized(yValues);

  return {
    slope: Math.round(slope * 100) / 100,
    trend,
    momGrowthPct,
    average: Math.round(avg * 10) / 10,
    hasAnomaly: anomalyInfo.hasAnomaly,
    anomalyIndices: anomalyInfo.anomalyIndices
  };
}

/**
 * Calculates rolling N-month linear regression or average
 */
export function calculateRollingForecast(yValues = [], windowSize = 4) {
  if (!yValues || yValues.length === 0) return 0;
  const sliced = yValues.slice(-windowSize);
  return calculateLinearRegressionForecast(sliced, sliced.length + 1);
}

/**
 * Calculates forecast variance and accuracy category
 */
export function calculateForecastVariance(actual, forecasted) {
  const actualNum = toNum(actual);
  const forecastNum = toNum(forecasted);
  const variance = actualNum - forecastNum;
  
  let remarks = 'Accurate';
  if (variance > 0) remarks = 'Under Forecast';
  else if (variance < 0) remarks = 'Over Forecast';
  
  const pctError = forecastNum > 0 ? ((actualNum - forecastNum) / forecastNum) * 100 : 0;
  return {
    variance,
    remarks,
    pctError: Math.round(pctError),
    isAccurate: remarks === 'Accurate' || Math.abs(variance) <= 1
  };
}

/**
 * Calculates recommended order with safety stock buffer
 */
export function calculateRecommendedOrder(baseForecast, safetyStockPct = 0.05, override = null) {
  const effectiveForecast = override !== null && override !== undefined && override !== '' 
    ? Number(override) 
    : baseForecast;
  
  const safetyUnits = Math.round(effectiveForecast * safetyStockPct);
  const recommendedOrder = Math.max(0, effectiveForecast + safetyUnits);
  
  return {
    effectiveForecast,
    safetyUnits,
    recommendedOrder
  };
}

/**
 * Splits total monthly demand and financial cost evenly across a 4-week pipeline (W1-W4)
 * with exact cent balancing on Week 4.
 */
export function calculateFourWeekFinancialAllocation(totalUnits, unitPrice) {
  const safeUnits = Math.max(0, toNum(totalUnits));
  const safePrice = Math.max(0, toNum(unitPrice));
  const totalCost = Math.round(safeUnits * safePrice * 100) / 100;

  // Base unit split
  const baseQtyPerWeek = Math.floor(safeUnits / 4);
  const remainderQty = safeUnits % 4;

  const w1_qty = baseQtyPerWeek + (remainderQty >= 1 ? 1 : 0);
  const w2_qty = baseQtyPerWeek + (remainderQty >= 2 ? 1 : 0);
  const w3_qty = baseQtyPerWeek + (remainderQty >= 3 ? 1 : 0);
  const w4_qty = baseQtyPerWeek;

  const w1_cost = Math.round(w1_qty * safePrice * 100) / 100;
  const w2_cost = Math.round(w2_qty * safePrice * 100) / 100;
  const w3_cost = Math.round(w3_qty * safePrice * 100) / 100;
  const w4_cost = Math.round((totalCost - (w1_cost + w2_cost + w3_cost)) * 100) / 100;

  return {
    totalUnits: safeUnits,
    unitPrice: safePrice,
    totalCost: Math.round(totalCost * 100) / 100,
    w1_qty,
    w2_qty,
    w3_qty,
    w4_qty,
    w1_cost,
    w2_cost,
    w3_cost,
    w4_cost
  };
}

