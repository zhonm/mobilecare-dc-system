import {
  filterAnomaliesWinsorized,
  calculateWeightedMovingAverageForecast,
  calculateLinearRegressionForecast,
  calculateHoltsLinearForecast,
  calculateCrostonForecast,
  calculateForecastByModel,
  calculateForecastVariance,
  calculateRecommendedOrder,
  calculateFourWeekFinancialAllocation
} from '../utils/forecastEngine.js';
import { calculateProportionalAllocation } from '../utils/allocationEngine.js';
import { CANONICAL_SITE_WEIGHTS } from '../constants/config.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('====================================================');
console.log('TEST SUITE: WMA & Anomaly Filtering Forecasting Engine');
console.log('====================================================');

// 1. Winsorization Anomaly Filtering Test
const batteryUsageWithJulySpike = [25, 28, 30, 29, 32, 31, 85, 34]; // Jan-Aug, July has spike 85
const filterRes = filterAnomaliesWinsorized(batteryUsageWithJulySpike, 1.5);
assert(filterRes.hasAnomaly === true, 'Correctly flagged statistical anomaly in historical usage');
assert(filterRes.anomalyIndices.includes(6), 'Correctly isolated index 6 (July) as the anomalous spike month');
assert(filterRes.cleanedValues[6] < 85, `Smoothed July spike from 85 down to ${filterRes.cleanedValues[6]}`);

// 2. 4-Month Weighted Moving Average (WMA) Calculation
const wmaForecast = calculateWeightedMovingAverageForecast(batteryUsageWithJulySpike);
const rawLinearForecast = calculateLinearRegressionForecast(batteryUsageWithJulySpike, 9);
assert(wmaForecast > 0, `WMA forecast computed valid positive integer: ${wmaForecast}`);
assert(wmaForecast < rawLinearForecast, `WMA forecast (${wmaForecast}) is robustly damped against spike compared to unbuffered linear regression (${rawLinearForecast})`);

// 3. Normal Consistent Series without Spikes
const steadySeries = [50, 52, 48, 51, 53, 50, 52, 54];
const steadyFilter = filterAnomaliesWinsorized(steadySeries);
assert(steadyFilter.hasAnomaly === false, 'No false-positive anomaly detected on stable baseline');
const steadyWma = calculateWeightedMovingAverageForecast(steadySeries);
assert(steadyWma >= 51 && steadyWma <= 55, `Consistent steady series projected accurately (actual: ${steadyWma})`);

// 4. Model Dispatcher & Direct Method Tests
const linForecast = calculateForecastByModel(steadySeries, 'linear', { targetX: 9 });
assert(linForecast >= 50 && linForecast <= 60, `Linear model correctly dispatched (forecast: ${linForecast})`);

const directHolt = calculateHoltsLinearForecast(steadySeries);
assert(directHolt >= 50 && directHolt <= 60, `Direct Holt helper functions properly (forecast: ${directHolt})`);

const crostonForecast = calculateCrostonForecast([0, 2, 0, 0, 3, 0, 0, 4]);
assert(crostonForecast >= 1, `Croston SBA method handled intermittent demand (forecast: ${crostonForecast})`);

// 5. Forecast Variance & Recommended Order Tests
const accVar = calculateForecastVariance(50, 50);
assert(accVar.remarks === 'Accurate' && accVar.variance === 0, 'Variance: exact match categorized as Accurate');

const underVar = calculateForecastVariance(60, 50);
assert(underVar.remarks === 'Under Forecast' && underVar.variance === 10, 'Variance: Actual > Forecast categorized as Under Forecast (+10)');

const overVar = calculateForecastVariance(40, 50);
assert(overVar.remarks === 'Over Forecast' && overVar.variance === -10, 'Variance: Actual < Forecast categorized as Over Forecast (-10)');

const recOrder = calculateRecommendedOrder(100, 0.05);
assert(recOrder.recommendedOrder === 105 && recOrder.safetyUnits === 5, `Recommended order calculated correctly with 5% safety buffer: ${recOrder.recommendedOrder}`);

// 6. 4-Week Financial Distribution Pipeline
const weeklySplit = calculateFourWeekFinancialAllocation(25, 89.50);
const sumWeeklyUnits = weeklySplit.w1_qty + weeklySplit.w2_qty + weeklySplit.w3_qty + weeklySplit.w4_qty;
assert(sumWeeklyUnits === 25, `4-week quantity sum strictly equals 25 units (${weeklySplit.w1_qty}+${weeklySplit.w2_qty}+${weeklySplit.w3_qty}+${weeklySplit.w4_qty})`);
const sumWeeklyCost = Math.round((weeklySplit.w1_cost + weeklySplit.w2_cost + weeklySplit.w3_cost + weeklySplit.w4_cost) * 100) / 100;
assert(sumWeeklyCost === weeklySplit.totalCost, `4-week cost sum strictly balances to total: $${weeklySplit.totalCost}`);

// 7. Allocation Model Synchronization & Quota Parity Test
const mockSites = Object.keys(CANONICAL_SITE_WEIGHTS).map(k => ({
  siteId: `ASP-${k}`,
  historicalDemand: CANONICAL_SITE_WEIGHTS[k] * 100
}));

// Test allocation with WMA vs Linear
const sampleMonthlyHistory = [47, 44, 46, 33, 25, 34, 27, 33];
const wmaVal = calculateForecastByModel(sampleMonthlyHistory, 'wma');
const linVal = calculateForecastByModel(sampleMonthlyHistory, 'linear', { targetX: 9 });

const wmaAlloc = calculateProportionalAllocation(wmaVal, mockSites);
const linAlloc = calculateProportionalAllocation(linVal, mockSites);

const sumWmaAlloc = wmaAlloc.reduce((s, a) => s + a.allocatedQty, 0);
const sumLinAlloc = linAlloc.reduce((s, a) => s + a.allocatedQty, 0);

assert(sumWmaAlloc === wmaVal, `WMA model allocation sum (${sumWmaAlloc}) strictly matches forecast quantity (${wmaVal})`);
assert(sumLinAlloc === linVal, `Linear model allocation sum (${sumLinAlloc}) strictly matches forecast quantity (${linVal})`);

console.log('====================================================');
console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');
if (failed > 0) process.exit(1);
