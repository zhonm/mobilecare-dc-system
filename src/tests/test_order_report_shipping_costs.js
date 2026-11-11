import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  parseOrderReportFile,
  alignShippingCostsWithOrderReports,
  DEFAULT_DC_SHIPPING_COSTS,
  computeDcStockMonitoringAnalytics,
  ORDER_REPORT_BASELINE
} from '../utils/dcStockMonitoringEngine.js';

async function runTestSuite() {
  console.log('====================================================');
  console.log('TEST SUITE: Order Report (August to October) Source of Truth');
  console.log('====================================================\n');

  // ── 1. Order-Report_August.xlsx Parsing & Parity ─────────────────────────
  const augPath = path.resolve('Order-Report_August.xlsx');
  assert.ok(fs.existsSync(augPath), 'Order-Report_August.xlsx must exist');
  const augBuf = new Uint8Array(fs.readFileSync(augPath));
  const augResult = await parseOrderReportFile(augBuf);

  assert.strictEqual(augResult.success, true, 'August Order Report parsing must succeed');
  assert.strictEqual(augResult.completedCount, 74, 'August completed deliveries must be 74');
  assert.strictEqual(augResult.totalAmount, 24295.00, 'August total amount must be ₱24,295.00');
  assert.strictEqual(augResult.monthlyTotals.length, 1, 'August monthly totals count must be 1');
  assert.strictEqual(augResult.monthlyTotals[0].month, 'August');
  assert.strictEqual(augResult.monthlyTotals[0].amount, 24295.00);
  console.log('  ✓ PASS: August Order Report verified (74 orders, ₱24,295.00)');

  // ── 2. Order-Report_September.xlsx Parsing & Parity ──────────────────────
  const sepPath = path.resolve('Order-Report_September.xlsx');
  assert.ok(fs.existsSync(sepPath), 'Order-Report_September.xlsx must exist');
  const sepBuf = new Uint8Array(fs.readFileSync(sepPath));
  const sepResult = await parseOrderReportFile(sepBuf);

  assert.strictEqual(sepResult.success, true, 'September Order Report parsing must succeed');
  assert.strictEqual(sepResult.completedCount, 41, 'September completed deliveries must be 41');
  assert.strictEqual(sepResult.totalAmount, 11835.00, 'September total amount must be ₱11,835.00');
  assert.strictEqual(sepResult.monthlyTotals.length, 1, 'September monthly totals count must be 1');
  assert.strictEqual(sepResult.monthlyTotals[0].month, 'September');
  assert.strictEqual(sepResult.monthlyTotals[0].amount, 11835.00);
  console.log('  ✓ PASS: September Order Report verified (41 orders, ₱11,835.00)');

  // ── 3. Order-Report_October.xlsx Parsing & Parity ────────────────────────
  const octPath = path.resolve('Order-Report_October.xlsx');
  assert.ok(fs.existsSync(octPath), 'Order-Report_October.xlsx must exist');
  const octBuf = new Uint8Array(fs.readFileSync(octPath));
  const octResult = await parseOrderReportFile(octBuf);

  assert.strictEqual(octResult.success, true, 'October Order Report parsing must succeed');
  assert.strictEqual(octResult.completedCount, 37, 'October completed deliveries must be 37');
  assert.strictEqual(octResult.totalAmount, 9830.00, 'October total amount must be ₱9,830.00');
  assert.strictEqual(octResult.monthlyTotals.length, 1, 'October monthly totals count must be 1');
  assert.strictEqual(octResult.monthlyTotals[0].month, 'October');
  assert.strictEqual(octResult.monthlyTotals[0].amount, 9830.00);
  console.log('  ✓ PASS: October Order Report verified (37 orders, ₱9,830.00)');

  // ── 4. Combined Aug–Oct Baseline Parity ─────────────────────────────────
  const combinedTotal = augResult.totalAmount + sepResult.totalAmount + octResult.totalAmount;
  const combinedCount = augResult.completedCount + sepResult.completedCount + octResult.completedCount;
  assert.strictEqual(combinedTotal, 45960.00, 'Combined Aug-Oct spend must be ₱45,960.00');
  assert.strictEqual(combinedCount, 152, 'Combined Aug-Oct delivery count must be 152');

  assert.strictEqual(ORDER_REPORT_BASELINE.totalOrders, 152, 'Baseline total orders must be 152');
  assert.strictEqual(ORDER_REPORT_BASELINE.totalAmount, 45960.00, 'Baseline total amount must be ₱45,960.00');
  console.log('  ✓ PASS: Combined Order Report baseline verified (152 deliveries, ₱45,960.00)');

  // ── 5. DEFAULT_DC_SHIPPING_COSTS Alignment ──────────────────────────────
  const defaultTotal = DEFAULT_DC_SHIPPING_COSTS.reduce((s, c) => s + c.amount, 0);
  assert.strictEqual(Number(defaultTotal.toFixed(2)), 45960.00, 'Default total shipping cost must be ₱45,960.00 (Order Report Source of Truth)');
  assert.strictEqual(DEFAULT_DC_SHIPPING_COSTS.length, 3, 'Default shipping cost entries must be 3 (August, September, October)');

  const augDefault = DEFAULT_DC_SHIPPING_COSTS.find(c => c.month === 'August')?.amount;
  const sepDefault = DEFAULT_DC_SHIPPING_COSTS.find(c => c.month === 'September')?.amount;
  const octDefault = DEFAULT_DC_SHIPPING_COSTS.find(c => c.month === 'October')?.amount;

  assert.strictEqual(augDefault, 24295.00, 'August default must match Order Report');
  assert.strictEqual(sepDefault, 11835.00, 'September default must match Order Report');
  assert.strictEqual(octDefault, 9830.00, 'October default must match Order Report');
  console.log('  ✓ PASS: DEFAULT_DC_SHIPPING_COSTS exact parity with Order Report source of truth (₱45,960.00)');

  // ── 6. Source of Truth Enforcement via alignShippingCostsWithOrderReports ─
  const divergentCosts = [
    { id: '1', month: 'August', amount: 24205.00, courier: 'Lalamove' }, // typo from earlier manual entry
    { id: '2', month: 'September', amount: 11825.00, courier: 'Lalamove' },
    { id: '3', month: 'October', amount: 9000.00, courier: 'Lalamove' }
  ];
  const aligned = alignShippingCostsWithOrderReports(divergentCosts);
  const alignedAug = aligned.find(c => c.month === 'August');
  const alignedSep = aligned.find(c => c.month === 'September');
  const alignedOct = aligned.find(c => c.month === 'October');

  assert.strictEqual(alignedAug.amount, 24295.00, 'August must be corrected to 24,295.00');
  assert.strictEqual(alignedAug.isOrderReportVerified, true);
  assert.strictEqual(alignedSep.amount, 11835.00, 'September must be corrected to 11,835.00');
  assert.strictEqual(alignedSep.isOrderReportVerified, true);
  assert.strictEqual(alignedOct.amount, 9830.00, 'October must be corrected to 9,830.00');
  assert.strictEqual(alignedOct.isOrderReportVerified, true);
  console.log('  ✓ PASS: alignShippingCostsWithOrderReports enforces authoritative Order Report pricing');

  // ── 7. Analytics Calculation & KPI Parity ─────────────────────────────────
  const mockDatasets = {
    stock_transfer: [
      { fromStock: 'DC_MSPI-Owned', toStock: 'GL5_MSPI-Owned', serialNumber: 'SN001', transferQuantity: 1, month: 'August' },
      { fromStock: 'DC_MSPI-Owned', toStock: 'VER_MSPI-Owned', serialNumber: 'SN002', transferQuantity: 1, month: 'August' }
    ]
  };
  const analytics = computeDcStockMonitoringAnalytics(mockDatasets, {
    shippingCosts: DEFAULT_DC_SHIPPING_COSTS
  });

  assert.strictEqual(Number(analytics.kpis.totalShippingCostPhp.toFixed(2)), 45960.00);
  assert.strictEqual(Number(analytics.kpis.costPerDcTransferPhp.toFixed(2)), 22980.00); // 45960 / 2 mock transfers
  assert.strictEqual(analytics.kpis.orderReportTotalAmountPhp, 45960.00);
  assert.strictEqual(analytics.kpis.orderReportDeliveriesCount, 152);
  assert.strictEqual(Number(analytics.kpis.avgCostPerOrderDeliveryPhp.toFixed(2)), 302.37);
  assert.strictEqual(analytics.transferAnalytics.orderReportDetails.totalDeliveries, 152);
  console.log('  ✓ PASS: computeDcStockMonitoringAnalytics surfaces Order Report metrics accurately\n');

  console.log('====================================================');
  console.log('ALL ORDER REPORT SOURCE OF TRUTH TESTS PASSED (100%)');
  console.log('====================================================');
}

runTestSuite().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
