/**
 * Forecasting Engine for Apple Parts Usage
 * Replicates and extends Excel's FORECAST.LINEAR formula
 */

/**
 * Calculates linear regression forecast given an array of historical numbers
 * Equivalent to FORECAST.LINEAR(targetX, yValues, xValues)
 *
 * @param {number[]} yValues - Array of historical monthly counts [Jan, Feb, ..., Current]
 * @param {number} targetX - Target month index (e.g. 8 for August when history is Jan-Jul)
 * @returns {number} Forecasted integer demand (rounded, minimum 0)
 */
export function calculateLinearRegressionForecast(yValues = [], targetX = null) {
  if (!yValues || yValues.length === 0) return 0;
  
  const n = yValues.length;
  const target = targetX !== null ? targetX : n + 1;
  
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = Number(yValues[i]) || 0;
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

  // Slope (beta) and Intercept (alpha)
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const rawForecast = intercept + slope * target;
  return Math.max(0, Math.round(rawForecast));
}

/**
 * Calculates trend direction and metrics over historical monthly numbers
 * @param {number[]} yValues 
 * @returns {{ slope: number, trend: 'increasing'|'decreasing'|'stable', momGrowthPct: number, average: number }}
 */
export function calculateForecastTrendMetrics(yValues = []) {
  if (!yValues || yValues.length === 0) {
    return { slope: 0, trend: 'stable', momGrowthPct: 0, average: 0 };
  }

  const n = yValues.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = Number(yValues[i]) || 0;
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
    const last = Number(yValues[n - 1]) || 0;
    const prev = Number(yValues[n - 2]) || 0;
    if (prev > 0) {
      momGrowthPct = Math.round(((last - prev) / prev) * 100);
    } else if (last > 0) {
      momGrowthPct = 100;
    }
  }

  return {
    slope: Math.round(slope * 100) / 100,
    trend,
    momGrowthPct,
    average: Math.round(avg * 10) / 10
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
  const variance = actual - forecasted;
  let remarks = 'Accurate';
  if (variance > 0) remarks = 'Under Forecast';
  else if (variance < 0) remarks = 'Over Forecast';
  
  const pctError = forecasted > 0 ? ((actual - forecasted) / forecasted) * 100 : 0;
  return { variance, remarks, pctError: Math.round(pctError) };
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
