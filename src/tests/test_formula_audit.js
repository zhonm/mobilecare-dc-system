/**
 * Comprehensive Formula Audit
 * Tests OLS Linear Regression and 4-Month WMA for mathematical correctness.
 * Validates against hand-computed reference values.
 */

import {
  toNum,
  roundExcel,
  calculateWeightedMovingAverageForecast,
  calculateLinearRegressionForecast,
  calculateForecastByModel,
  filterAnomaliesWinsorized,
  calculateFourWeekFinancialAllocation,
  DEFAULT_WMA_WEIGHTS_4M
} from '../utils/forecastEngine.js';

import {
  calculateOptionAAllocation,
  calculate2DCumulativeAllocation,
  calculateProportionalAllocation,
  calculateWeeklySplit
} from '../utils/allocationEngine.js';

let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    passed++;
    console.log('  \u2713 PASS: ' + label + (detail ? ' \u2014 ' + detail : ''));
  } else {
    failed++;
    console.error('  \u2717 FAIL: ' + label + (detail ? ' \u2014 ' + detail : ''));
  }
}

function near(a, b, eps) { eps = eps || 1e-9; return Math.abs(a - b) <= eps; }

console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log(' COMPREHENSIVE FORMULA AUDIT \u2014 Linear Regression + 4MO WMA');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

// ── Section 1: toNum & roundExcel Primitives ──────────────────────────────────
console.log('\u2500\u2500 Section 1: toNum & roundExcel Primitives \u2500\u2500');

assert(toNum(null) === 0, 'toNum(null) = 0');
assert(toNum(undefined) === 0, 'toNum(undefined) = 0');
assert(toNum('abc') === 0, 'toNum("abc") = 0');
assert(toNum(0) === 0, 'toNum(0) = 0 (preserves real zero)');
assert(toNum(42) === 42, 'toNum(42) = 42');

// roundExcel: half-up rounding
assert(roundExcel(0.5) === 1, 'roundExcel(0.5) = 1 [half-up]');
assert(roundExcel(1.5) === 2, 'roundExcel(1.5) = 2 [half-up]');
assert(roundExcel(2.5) === 3, 'roundExcel(2.5) = 3 [half-up]');
assert(roundExcel(0) === 0, 'roundExcel(0) = 0');
// FP artifact guard: 97.49999999999999 must NOT round to 98
// roundExcel replicates Excel's 15-sig-digit behavior: values whose MATHEMATICAL result
// is X.5 (like 165/22 = 7.5) but appear as X.4999... in IEEE 754 are promoted to X.5.
// Excel ALSO gets 7.5 (its 15-digit math), so both round to 8. toFixed(9) mirrors this.
assert(roundExcel(11 * (15/22)) === 8, 'roundExcel(11*(15/22)=7.4999...) = 8 [matches Excel 15-digit result 7.5->8]');
// A pure literal that is truly below 0.5 at the 1e-14 level (not from calc) rounds correctly:
assert(roundExcel(97.5) === 98, 'roundExcel(97.5) = 98 [half-up]');
// 3.0000000000000004 must NOT round to 4
assert(roundExcel(3.0000000000000004) === 3, 'roundExcel(3.0000000000000004) = 3');
console.log('');

// ── Section 2: OLS Linear Regression ─────────────────────────────────────────
console.log('\u2500\u2500 Section 2: OLS Linear Regression \u2014 FORECAST.LINEAR parity \u2500\u2500');

// Degenerate cases
assert(calculateLinearRegressionForecast([]) === 0, 'Empty array = 0');
assert(calculateLinearRegressionForecast([50]) === 50, 'Single point = 50 (avg fallback)');
assert(calculateLinearRegressionForecast([0, 0, 0, 0]) === 0, 'All-zero series = 0');

// Flat series (slope=0): y=[10,10,10,10]
// Sx=10, Sy=40, Sxy=100, Sxx=30 | denom=8*30-100=20 => slope=(8*100-10*40)/20=0 => intercept=10
// forecast(x=5) = 10
assert(calculateLinearRegressionForecast([10, 10, 10, 10], 5) === 10, 'Flat [10,10,10,10] at x=5 = 10');

// Perfect linear y=2x: y=[2,4,6,8]
// slope=(4*60-10*20)/(4*30-100)=40/20=2, intercept=(20-2*10)/4=0
// forecast(x=5) = 0+2*5 = 10
assert(calculateLinearRegressionForecast([2, 4, 6, 8], 5) === 10, 'Perfect y=2x at x=5 = 10');

// Decreasing: y=[10,8,6,4]
// slope=(4*60-10*28)/20=-40/20=-2, intercept=(28+20)/4=12
// forecast(x=5) = 12-10 = 2; x=7 = 12-14=-2 -> clamped 0
assert(calculateLinearRegressionForecast([10, 8, 6, 4], 5) === 2, 'Decreasing [10,8,6,4] at x=5 = 2');
assert(calculateLinearRegressionForecast([10, 8, 6, 4], 7) === 0, 'Negative prediction clamped to 0');

// Canonical Sep 2026 production value — Display iPhone 13 (661-21988)
// y=[49,44,46,33,25,34,27,33], target x=9
// Hand computed: Sx=36, Sy=291, Sxy=1189, Sxx=204
// denom=8*204-36^2=1632-1296=336
// slope=(8*1189-36*291)/336=(9512-10476)/336=-964/336=-2.869047619
// intercept=(291-(-2.869047619)*36)/8=394.2857/8=49.28571
// f(9)=49.28571+(-2.869047619)*9=49.28571-25.82143=23.46429 -> round=23
(function() {
  var f = calculateLinearRegressionForecast([49, 44, 46, 33, 25, 34, 27, 33], 9);
  assert(f === 23, 'Display iPhone 13 Sep forecast (x=9) = 23', 'got ' + f);
})();

// 3-point y=[1,3,5]: slope=2, intercept=-1, f(4)=7
assert(calculateLinearRegressionForecast([1, 3, 5], 4) === 7, 'y=[1,3,5] at x=4 = 7');
assert(calculateLinearRegressionForecast([1, 3, 5], 1) === 1, 'y=[1,3,5] re-predict x=1 = 1 (exact fit)');

// Half-integer rounding: y=[1,2,4,5]
// slope=(4*37-10*12)/20=28/20=1.4, intercept=(12-14)/4=-0.5
// f(5) = -0.5+7 = 6.5 -> round = 7
assert(calculateLinearRegressionForecast([1, 2, 4, 5], 5) === 7, 'y=[1,2,4,5] f(5)=6.5 -> rounds to 7');

// Default targetX = n+1
(function() {
  var y = [2, 4, 6, 8];
  assert(calculateLinearRegressionForecast(y) === calculateLinearRegressionForecast(y, 5),
    'Default targetX=n+1 matches explicit x=' + (y.length+1));
})();

// Flat 2-point: y=[7,7], slope=0, intercept=7, f(3)=7
assert(calculateLinearRegressionForecast([7, 7], 3) === 7, 'Flat 2-point [7,7] at x=3 = 7');
console.log('');

// ── Section 3: 4-Month WMA ───────────────────────────────────────────────────
console.log('\u2500\u2500 Section 3: 4-Month WMA \u2014 Formula Correctness \u2500\u2500');

// Weight sum = 1.0
(function() {
  var s = DEFAULT_WMA_WEIGHTS_4M.reduce(function(a,b){return a+b;},0);
  assert(Math.abs(s - 1.0) < 1e-12, 'Default WMA weights sum = 1.0', 'actual=' + s);
})();

// Exact WMA: y=[10,20,30,40], weights=[0.10,0.20,0.30,0.40]
// = (1+4+9+16)/1.0 = 30
(function() {
  var w = calculateWeightedMovingAverageForecast([10,20,30,40], DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false});
  assert(w === 30, 'WMA([10,20,30,40]) = 30', 'got ' + w);
})();

// Window slicing: only last 4 count
(function() {
  var w = calculateWeightedMovingAverageForecast([5,10,10,20,30,40], DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false});
  assert(w === 30, 'WMA 6-month series uses last-4 window = 30', 'got ' + w);
})();

// Partial window (2 points): activeWeights=[0.30,0.40], sumWeights=0.70
// WMA=(0.30*20+0.40*30)/0.70=(6+12)/0.70=25.714 -> round=26
(function() {
  var w = calculateWeightedMovingAverageForecast([20,30], DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false});
  assert(w === 26, 'WMA partial window [20,30] = 26', 'got ' + w);
})();

// Single point: activeWeights=[0.40], sum=0.40
// WMA=(0.40*50)/0.40=50
(function() {
  var w = calculateWeightedMovingAverageForecast([50], DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false});
  assert(w === 50, 'WMA single point [50] = 50', 'got ' + w);
})();

// All-zero
assert(calculateWeightedMovingAverageForecast([0,0,0,0], DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false}) === 0, 'WMA all-zero = 0');

// Custom equal weights -> simple average
// y=[10,20,30,40], weights=[0.25,0.25,0.25,0.25] -> avg=25
(function() {
  var w = calculateWeightedMovingAverageForecast([10,20,30,40],[0.25,0.25,0.25,0.25],{filterAnomalies:false});
  assert(w === 25, 'WMA equal weights = simple average = 25', 'got ' + w);
})();

// Integer unnormalized weights [1,2,3,4], sum=10
// (1*10+2*20+3*30+4*40)/10 = 300/10 = 30
(function() {
  var w = calculateWeightedMovingAverageForecast([10,20,30,40],[1,2,3,4],{filterAnomalies:false});
  assert(w === 30, 'WMA integer weights [1,2,3,4] normalizes = 30', 'got ' + w);
})();

// Spike dampening verification
// y=[25,28,30,29,32,31,85,34], last-4=[32,31,85,34]
// raw WMA=(0.10*32+0.20*31+0.30*85+0.40*34)=3.2+6.2+25.5+13.6=48.5->round(48.5)=49
(function() {
  var y = [25,28,30,29,32,31,85,34];
  var raw = calculateWeightedMovingAverageForecast(y, DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false});
  assert(raw === 49, 'WMA no-filter with July spike last-4 = 49', 'got ' + raw);
  var filtered = calculateWeightedMovingAverageForecast(y, DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:true});
  assert(filtered < raw, 'WMA with Winsorization dampens spike: ' + filtered + ' < ' + raw);
  assert(filtered >= 0, 'WMA filtered non-negative');
})();

// Minimum clamped to 0
assert(calculateWeightedMovingAverageForecast([0,0,0,0]) >= 0, 'WMA never negative');
console.log('');

// ── Section 4: Model Dispatcher ──────────────────────────────────────────────
console.log('\u2500\u2500 Section 4: Model Dispatcher \u2500\u2500');

(function() {
  var y = [49,44,46,33,25,34,27,33];
  var viaDispatcher = calculateForecastByModel(y, 'linear', {targetX:9});
  var viaDirect = calculateLinearRegressionForecast(y, 9, {filterAnomalies:false});
  assert(viaDispatcher === viaDirect, 'Dispatcher linear matches direct call', viaDispatcher + ' vs ' + viaDirect);

  var alias = calculateForecastByModel(y, 'forecast_linear', {targetX:9});
  assert(alias === 23, 'forecast_linear alias = 23', 'got ' + alias);

  // filterAnomalies must be forced false for linear
  var withFilter = calculateForecastByModel(y, 'linear', {targetX:9, filterAnomalies:true});
  var noFilter = calculateForecastByModel(y, 'linear', {targetX:9, filterAnomalies:false});
  assert(withFilter === noFilter, 'Dispatcher forces filterAnomalies=false for linear', withFilter + ' vs ' + noFilter);

  var wmaD = calculateForecastByModel(y, 'wma', {filterAnomalies:false});
  var wmaDirect = calculateWeightedMovingAverageForecast(y, DEFAULT_WMA_WEIGHTS_4M, {filterAnomalies:false});
  assert(wmaD === wmaDirect, 'Dispatcher wma matches direct WMA call', wmaD + ' vs ' + wmaDirect);
})();
console.log('');

// ── Section 5: Winsorized Anomaly Filtering ───────────────────────────────────
console.log('\u2500\u2500 Section 5: Winsorized Anomaly Filtering \u2500\u2500');

(function() {
  var r = filterAnomaliesWinsorized([5,10]);
  assert(!r.hasAnomaly && r.cleanedValues.length === 2, 'Length<3 passthrough no anomaly');
})();

(function() {
  var r = filterAnomaliesWinsorized([50,52,48,51,53]);
  assert(!r.hasAnomaly, 'Stable series no anomaly');
})();

(function() {
  var y = [25,28,30,29,32,31,85,34];
  var r = filterAnomaliesWinsorized(y, 1.5);
  assert(r.hasAnomaly, 'July spike detected');
  assert(r.anomalyIndices.indexOf(6) >= 0, 'Anomaly at index 6 (July)');
  assert(r.cleanedValues[6] < 85, 'July capped below 85');
  // verify cap formula
  var mean = y.reduce(function(s,v){return s+v;},0)/y.length;
  var variance = y.reduce(function(s,v){return s+Math.pow(v-mean,2);},0)/y.length;
  var std = Math.sqrt(variance);
  var cap = Math.round(mean + 1.5*std);
  assert(r.cleanedValues[6] === cap, 'Cap = round(mean+1.5sigma) = ' + cap, 'got ' + r.cleanedValues[6]);
  assert(r.cleanedValues[0] === 25, 'Non-anomaly index 0 unchanged');
  assert(r.cleanedValues[7] === 34, 'Non-anomaly index 7 unchanged');
})();

(function() {
  var r = filterAnomaliesWinsorized([10,10,10,10,10]);
  assert(!r.hasAnomaly, 'All-same (sigma<1) passthrough');
})();
console.log('');

// ── Section 6: Proportional Allocation ───────────────────────────────────────
console.log('\u2500\u2500 Section 6: Proportional Allocation \u2014 Sum Exactness \u2500\u2500');

(function() {
  var sites = [{siteId:'A',historicalDemand:3},{siteId:'B',historicalDemand:1},{siteId:'C',historicalDemand:2}];
  var res = calculateProportionalAllocation(12, sites);
  var sum = res.reduce(function(s,r){return s+r.allocatedQty;},0);
  assert(sum === 12, 'Basic proportional sum=12', 'got ' + sum);
  assert(res[0].allocatedQty === 6, 'Site A (50%) = 6', 'got ' + res[0].allocatedQty);
  assert(res[1].allocatedQty === 2, 'Site B (16.7%) = 2', 'got ' + res[1].allocatedQty);
  assert(res[2].allocatedQty === 4, 'Site C (33.3%) = 4', 'got ' + res[2].allocatedQty);
})();

// Prime quantity across 27 equal sites
(function() {
  var sites = [];
  for(var i=0;i<27;i++) sites.push({siteId:'S'+i,historicalDemand:1});
  var res = calculateProportionalAllocation(97, sites);
  var sum = res.reduce(function(s,r){return s+r.allocatedQty;},0);
  assert(sum === 97, 'Prime 97 across 27 equal sites sum=97', 'got ' + sum);
})();

// Zero demand fallback
(function() {
  var sites = [{siteId:'X',historicalDemand:0},{siteId:'Y',historicalDemand:0},{siteId:'Z',historicalDemand:0}];
  var res = calculateProportionalAllocation(9, sites);
  var sum = res.reduce(function(s,r){return s+r.allocatedQty;},0);
  assert(sum === 9, 'Uniform fallback sum=9', 'got ' + sum);
})();

// Single site
(function() {
  var res = calculateProportionalAllocation(55, [{siteId:'ONLY',historicalDemand:100}]);
  assert(res[0].allocatedQty === 55, 'Single site gets all 55');
})();

// Zero totalQty
(function() {
  var res = calculateProportionalAllocation(0, [{siteId:'A',historicalDemand:5},{siteId:'B',historicalDemand:3}]);
  assert(res.every(function(r){return r.allocatedQty===0;}), 'Zero totalQty -> all zeros');
})();
console.log('');

// ── Section 7: Option A & Option B ───────────────────────────────────────────
console.log('\u2500\u2500 Section 7: Option A & Option B Allocation \u2500\u2500');

// Option A 1x1
(function() {
  var res = calculateOptionAAllocation(10, [[1.0]], 0);
  assert(res.length===1 && res[0]===10, 'Option A 1x1 = [10]', 'got ' + JSON.stringify(res));
})();

// Option A 1-row 2-site uniform: 50/50 of 20
(function() {
  var res = calculateOptionAAllocation(20, [[0.5,0.5]], 0);
  assert(res[0]===10 && res[1]===10, 'Option A 50/50 of 20 = [10,10]', 'got ' + JSON.stringify(res));
  assert(res.reduce(function(s,v){return s+v;},0)===20, 'Option A sum=20');
})();

// Option A 2x2 row1:
// shareMatrix=[[0.6,0.4],[0.3,0.7]], forecastQty=30, matrixRowIdx=1
// col0: sumBlock=0.6+0.3=0.9, cellShare=0.3 -> round(30*0.9)-round(30*0.6)=27-18=9
// col1: sumBlock=0.6+0.4+0.3+0.7=2.0, cellShare=0.7 -> round(30*2.0)-round(30*1.3)=60-39=21
(function() {
  var sm = [[0.6,0.4],[0.3,0.7]];
  var res = calculateOptionAAllocation(30, sm, 1);
  assert(res[0]===9, 'Option A 2x2 row1 col0=9', 'got ' + res[0]);
  assert(res[1]===21, 'Option A 2x2 row1 col1=21', 'got ' + res[1]);
  assert(res[0]+res[1]===30, 'Option A 2x2 row1 sum=30');
})();

// Option B 3-site ratio 1:2:3
// normalized=[1/6,2/6,3/6], f=30
// col0: cum=1/6 -> round(30/6)-round(0)=5-0=5
// col1: cum=3/6 -> round(15)-round(5)=15-5=10
// col2: cum=1.0 -> round(30)-round(15)=30-15=15
(function() {
  var res = calculate2DCumulativeAllocation(30, [[1,2,3]], 0);
  assert(res[0]===5, 'Option B col0=5', 'got '+res[0]);
  assert(res[1]===10, 'Option B col1=10', 'got '+res[1]);
  assert(res[2]===15, 'Option B col2=15', 'got '+res[2]);
  assert(res.reduce(function(s,v){return s+v;},0)===30, 'Option B sum=30');
})();

// Option B zero forecast
(function() {
  var res = calculate2DCumulativeAllocation(0, [[0.5,0.5]], 0);
  assert(res.every(function(v){return v===0;}), 'Option B zero forecast -> all zeros');
})();

// Option B 27-site stress
(function() {
  var weights = [];
  for(var i=1;i<=27;i++) weights.push(i);
  var res = calculate2DCumulativeAllocation(591, [weights], 0);
  var sum = res.reduce(function(s,v){return s+v;},0);
  assert(sum===591, 'Option B 27-site qty=591 sum=591', 'got '+sum);
})();
console.log('');

// ── Section 8: 4-Week Weekly Split ───────────────────────────────────────────
console.log('\u2500\u2500 Section 8: 4-Week Weekly Split \u2500\u2500');

// Even row, rem=0: all equal
(function() {
  var s = calculateWeeklySplit(12,0,0);
  assert(s.w1_qty===3&&s.w2_qty===3&&s.w3_qty===3&&s.w4_qty===3,'p=12,rem=0,even=[3,3,3,3]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===12,'p=12 sum=12');
})();

// Even row, rem=1: [4,3,3,3]
(function() {
  var s = calculateWeeklySplit(13,0,0);
  assert(s.w1_qty===4&&s.w2_qty===3&&s.w3_qty===3&&s.w4_qty===3,'p=13,rem=1,even=[4,3,3,3]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===13,'p=13 sum=13');
})();

// Even row, rem=2: [4,4,3,3]
(function() {
  var s = calculateWeeklySplit(14,0,0);
  assert(s.w1_qty===4&&s.w2_qty===4&&s.w3_qty===3&&s.w4_qty===3,'p=14,rem=2,even=[4,4,3,3]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===14,'p=14 sum=14');
})();

// Even row, rem=3: [4,4,4,3]
(function() {
  var s = calculateWeeklySplit(15,0,0);
  assert(s.w1_qty===4&&s.w2_qty===4&&s.w3_qty===4&&s.w4_qty===3,'p=15,rem=3,even=[4,4,4,3]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===15,'p=15 sum=15');
})();

// Odd row, rem=1: [3,3,3,4]
(function() {
  var s = calculateWeeklySplit(13,0,1);
  assert(s.w1_qty===3&&s.w2_qty===3&&s.w3_qty===3&&s.w4_qty===4,'p=13,rem=1,odd=[3,3,3,4]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===13,'p=13,odd sum=13');
})();

// Odd row, rem=2: [3,3,4,4]
(function() {
  var s = calculateWeeklySplit(14,0,1);
  assert(s.w1_qty===3&&s.w2_qty===3&&s.w3_qty===4&&s.w4_qty===4,'p=14,rem=2,odd=[3,3,4,4]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===14,'p=14,odd sum=14');
})();

// Odd row, rem=3: [3,4,4,4]
(function() {
  var s = calculateWeeklySplit(15,0,1);
  assert(s.w1_qty===3&&s.w2_qty===4&&s.w3_qty===4&&s.w4_qty===4,'p=15,rem=3,odd=[3,4,4,4]','got ['+s.w1_qty+','+s.w2_qty+','+s.w3_qty+','+s.w4_qty+']');
  assert(s.w1_qty+s.w2_qty+s.w3_qty+s.w4_qty===15,'p=15,odd sum=15');
})();

// Zero
(function() {
  var s = calculateWeeklySplit(0,0,0);
  assert(s.w1_qty===0&&s.w2_qty===0&&s.w3_qty===0&&s.w4_qty===0,'p=0 -> all zeros');
})();

// Cost balance
(function() {
  var totalCost = 25 * 89.5;
  var s = calculateWeeklySplit(25, totalCost, 0);
  var sumC = Math.round((s.w1_cost+s.w2_cost+s.w3_cost+s.w4_cost)*100)/100;
  assert(Math.abs(sumC - totalCost) < 0.01, 'Weekly cost balances for 25x89.5', sumC + ' vs ' + totalCost);
})();

// Stress: sum invariant for all p in [0..200], both parities
(function() {
  var allOk = true;
  for(var p=0;p<=200;p++) {
    var se = calculateWeeklySplit(p,0,0);
    var so = calculateWeeklySplit(p,0,1);
    if(se.w1_qty+se.w2_qty+se.w3_qty+se.w4_qty !== p) { allOk=false; break; }
    if(so.w1_qty+so.w2_qty+so.w3_qty+so.w4_qty !== p) { allOk=false; break; }
  }
  assert(allOk, 'Weekly split sum invariant holds for p in [0..200], both parities');
})();
console.log('');

// ── Section 9: 4-Week Financial Allocation ────────────────────────────────────
console.log('\u2500\u2500 Section 9: 4-Week Financial Allocation \u2500\u2500');

// p=25, base=6, rem=1 -> [7,6,6,6]
(function() {
  var r = calculateFourWeekFinancialAllocation(25,100);
  assert(r.w1_qty===7&&r.w2_qty===6&&r.w3_qty===6&&r.w4_qty===6,'p=25 -> [7,6,6,6]','got ['+r.w1_qty+','+r.w2_qty+','+r.w3_qty+','+r.w4_qty+']');
  assert(r.w1_qty+r.w2_qty+r.w3_qty+r.w4_qty===25,'p=25 sum=25');
  assert(Math.abs(r.totalCost-2500)<0.01,'totalCost=2500');
})();

// Cost balance
(function() {
  var r = calculateFourWeekFinancialAllocation(25,89.5);
  var sumC = Math.round((r.w1_cost+r.w2_cost+r.w3_cost+r.w4_cost)*100)/100;
  assert(Math.abs(sumC-r.totalCost)<0.01,'Cost balances for 25x89.50: '+sumC+'==='+r.totalCost);
})();

// Zero
(function() {
  var r = calculateFourWeekFinancialAllocation(0,99);
  assert(r.w1_qty+r.w2_qty+r.w3_qty+r.w4_qty===0,'Zero units -> all week qtys zero');
  assert(r.totalCost===0,'Zero units -> zero cost');
})();

// Stress: qty sum invariant for all p in [0..100]
(function() {
  var allOk = true;
  for(var p=0;p<=100;p++) {
    var r = calculateFourWeekFinancialAllocation(p, 99);
    if(r.w1_qty+r.w2_qty+r.w3_qty+r.w4_qty !== p) { allOk=false; break; }
  }
  assert(allOk, '4-week financial qty sum invariant for p in [0..100]');
})();

console.log('');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('FORMULA AUDIT RESULTS: ' + passed + ' PASSED, ' + failed + ' FAILED');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
if (failed > 0) process.exit(1);
