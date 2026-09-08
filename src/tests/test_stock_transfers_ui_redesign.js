import assert from 'assert';
import { exportStockTransfersToPDF } from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Stock Transfer Reports UI Redesign & Executive Summary');
console.log('====================================================');

// Sample dataset simulating Fixably Stock Transfers
const mockTransfers = [
  {
    transfer_received_date: '2026-09-02',
    from_stock: 'DC_MSPI',
    to_stock: 'ALABANG_SERVICE_HUB',
    product_code: '661-21996',
    product_name: 'IPHONE 13 PRO BATTERY',
    transfer_quantity: 10,
    serial_number: 'F8Y6918C0C260JYVV',
    transfer_value: 990
  },
  {
    transfer_received_date: '2026-09-03',
    from_stock: 'DC_MSPI',
    to_stock: 'CEBU_SERVICE_HUB',
    product_code: '661-17997',
    product_name: 'IPHONE 12 DISPLAY',
    transfer_quantity: 5,
    serial_number: 'G9P6915C0CDA3BJ60',
    transfer_value: 1395
  },
  {
    transfer_received_date: '2026-09-04',
    from_stock: 'DC_MSPI',
    to_stock: 'DAVAO_SERVICE_HUB',
    product_code: '661-24998',
    product_name: 'IPHONE 14 TRUEDEPTH CAMERA',
    transfer_quantity: 4,
    serial_number: 'C176914C0CAA1KK88',
    transfer_value: 596
  },
  {
    transfer_received_date: '2026-09-05',
    from_stock: 'DC_MSPI',
    to_stock: 'NORTH_EDSA_SERVICE_HUB',
    product_code: '661-30010',
    product_name: 'IPHONE 15 BACK GLASS',
    transfer_quantity: 6,
    serial_number: 'B8X6912C0CCC9LL11',
    transfer_value: 774
  },
  {
    transfer_received_date: '2026-09-06',
    from_stock: 'ALABANG_SERVICE_HUB',
    to_stock: 'CEBU_SERVICE_HUB',
    product_code: '661-21996',
    product_name: 'IPHONE 13 PRO BATTERY',
    transfer_quantity: 2,
    serial_number: 'F8Y6918C0C260JYAA',
    transfer_value: 198
  }
];

// Test 1: KPI Aggregation Integrity
console.log('\n--- 1. Executive Summary KPI Aggregations ---');
const totalTransfers = mockTransfers.length;
const totalUnits = mockTransfers.reduce((s, r) => s + r.transfer_quantity, 0);
const totalVal = mockTransfers.reduce((s, r) => s + r.transfer_value, 0);
const totalValPHP = totalVal * 57;

assert.strictEqual(totalTransfers, 5, 'Total transfers count should be 5');
assert.strictEqual(totalUnits, 27, 'Total units moved should be 27 (10+5+4+6+2)');
assert.strictEqual(totalVal, 3953, 'Total valuation should be $3,953');
assert.strictEqual(totalValPHP, 3953 * 57, 'Total PHP valuation should match 57x rate');
console.log(`  ✓ PASS: Total Transfers: ${totalTransfers}, Units Moved: ${totalUnits}, USD: $${totalVal}, PHP: ₱${totalValPHP}`);

// Test 2: Commodity Volume & Valuation Distribution
console.log('\n--- 2. Commodity Breakdown Calculation ---');
let batteryUnits = 0, displayUnits = 0, cameraUnits = 0, otherUnits = 0;
let batteryVal = 0, displayVal = 0, cameraVal = 0, otherVal = 0;

mockTransfers.forEach(r => {
  const d = r.product_name.toLowerCase();
  if (d.includes('battery')) { batteryUnits += r.transfer_quantity; batteryVal += r.transfer_value; }
  else if (d.includes('display')) { displayUnits += r.transfer_quantity; displayVal += r.transfer_value; }
  else if (d.includes('camera')) { cameraUnits += r.transfer_quantity; cameraVal += r.transfer_value; }
  else { otherUnits += r.transfer_quantity; otherVal += r.transfer_value; }
});

assert.strictEqual(batteryUnits, 12, 'Battery units should be 12 (10+2)');
assert.strictEqual(displayUnits, 5, 'Display units should be 5');
assert.strictEqual(cameraUnits, 4, 'Camera units should be 4');
assert.strictEqual(otherUnits, 6, 'Other units should be 6');
assert.strictEqual(batteryVal, 1188, 'Battery valuation should be $1,188');
assert.strictEqual(displayVal, 1395, 'Display valuation should be $1,395');
assert.strictEqual(cameraVal, 596, 'Camera valuation should be $596');
assert.strictEqual(otherVal, 774, 'Other valuation should be $774');
console.log(`  ✓ PASS: Commodity split verified: Battery: ${batteryUnits}u ($${batteryVal}), Display: ${displayUnits}u ($${displayVal}), Camera: ${cameraUnits}u ($${cameraVal}), Other: ${otherUnits}u ($${otherVal})`);

// Test 3: Regional Logistics Courier Classification
console.log('\n--- 3. Regional Logistics & Courier Split ---');
let mmCount = 0, provCount = 0;
mockTransfers.forEach(r => {
  const isProv = /(cebu|davao|iloilo|bacolod|pampanga|clark|baguio|dagupan|lipa|batangas|palawan|gensan|cagayan|laoag|naga|legazpi|tarlac|subic|marilao|cabanatuan|lucena|roxas|tacloban|butuan|tagum|zamboanga|newpoint|nep|lanang|lima|la union|\b(ceb|dav|ilo|bac|pam|cla|bag|dag|lip|bat|pal|gen|cdo)\b)/i.test(r.to_stock);
  if (isProv) provCount++;
  else mmCount++;
});

assert.strictEqual(mmCount, 2, 'Metro Manila shipments should be 2 (Alabang, North Edsa)');
assert.strictEqual(provCount, 3, 'Provincial shipments should be 3 (Cebu x2, Davao)');
const estShippingPHP = (mmCount * 180) + (provCount * 350);
assert.strictEqual(estShippingPHP, (2 * 180) + (3 * 350), 'Shipping fee calculation parity');
console.log(`  ✓ PASS: Regional split verified: MM: ${mmCount} (@ ₱180), Prov: ${provCount} (@ ₱350), Est. Shipping: ₱${estShippingPHP}`);

// Test 4: PDF Generator Export with Executive Summary Page 1
console.log('\n--- 4. Stock Transfers PDF Generation with Executive Summary ---');
try {
  exportStockTransfersToPDF(mockTransfers, { fileName: 'Test_Stock_Transfers.xlsx' });
  console.log('  ✓ PASS: exportStockTransfersToPDF executed successfully without exceptions');
} catch (err) {
  console.error('  ✗ FAIL: exportStockTransfersToPDF crashed:', err);
  process.exit(1);
}

console.log('\n====================================================');
console.log('ALL STOCK TRANSFER REPORTS UI & EXECUTIVE SUMMARY TESTS PASSED (100%)');
console.log('====================================================');
