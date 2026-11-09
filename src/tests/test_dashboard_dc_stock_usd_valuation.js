import assert from 'assert';
import { resolveItemStockingPrice } from '../utils/shipmentHelpers.js';
import { exportDcInventoryToExcel, exportDcInventoryToPDF } from '../utils/dashboardReportExporter.js';

console.log('====================================================');
console.log('TEST SUITE: DC Stock USD Valuation & Dashboard Parity');
console.log('====================================================\n');

// 1. Test Price Resolution on In-Stock DC Units
console.log('--- 1. Testing DC Unit Stocking Price Resolution in USD ---');
const sampleDcUnits = [
  {
    id: 'dc-unit-1',
    serial_number: 'G9PHVAJ6SUF0000PUY',
    part_number: '661-30401',
    description: 'Display, iPhone 16 Pro Max',
    status: 'in_stock',
    received_at: '2026-09-01T08:00:00Z'
  },
  {
    id: 'dc-unit-2',
    serial_number: 'G9PHVAJ6SUF0000PUZ',
    part_number: '661-30401',
    description: 'Display, iPhone 16 Pro Max',
    status: 'in_stock',
    received_at: '2026-09-01T08:00:00Z'
  },
  {
    id: 'dc-unit-3',
    serial_number: 'F8Y6175C3DA19X08K',
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    status: 'in_stock',
    received_at: '2026-09-08T08:00:00Z'
  }
];

const price1 = resolveItemStockingPrice(sampleDcUnits[0]);
const price2 = resolveItemStockingPrice(sampleDcUnits[1]);
const price3 = resolveItemStockingPrice(sampleDcUnits[2]);

assert.strictEqual(price1, 379, 'Display 661-30401 should resolve to $379 USD');
assert.strictEqual(price2, 379, 'Display 661-30401 should resolve to $379 USD');
assert.strictEqual(price3, 89, 'Battery 661-21991 should resolve to $89 USD');

const totalValuationUSD = sampleDcUnits.reduce((sum, u) => sum + resolveItemStockingPrice(u), 0);
assert.strictEqual(totalValuationUSD, 379 + 379 + 89, 'Total valuation should be $847 USD');
console.log(`  ✓ PASS: Resolved individual USD prices ($379, $379, $89) and total valuation: $${totalValuationUSD.toFixed(2)} USD`);

// 2. Test Grouped Inventory Valuation Mapping
console.log('\n--- 2. Testing Grouped DC Inventory SKU Valuation ---');
const groupedMap = new Map();
sampleDcUnits.forEach(u => {
  const pn = u.part_number;
  if (!groupedMap.has(pn)) {
    const price = resolveItemStockingPrice(u);
    groupedMap.set(pn, {
      part_number: pn,
      description: u.description,
      category: pn.startsWith('661-30') ? 'Display' : 'Battery',
      stockPriceUSD: price,
      units: [],
      maxDaysInDc: 4,
      latest_serial: u.serial_number
    });
  }
  groupedMap.get(pn).units.push(u);
});

const groupedList = Array.from(groupedMap.values()).map(entry => {
  const itemTotalVal = entry.stockPriceUSD * entry.units.length;
  return {
    ...entry,
    totalValUSD: itemTotalVal,
    totalValPHP: itemTotalVal * 57
  };
});

assert.strictEqual(groupedList.length, 2, 'Should have 2 distinct SKUs');
const displayEntry = groupedList.find(e => e.part_number === '661-30401');
const batteryEntry = groupedList.find(e => e.part_number === '661-21991');

assert.strictEqual(displayEntry.stockPriceUSD, 379);
assert.strictEqual(displayEntry.totalValUSD, 758);
assert.strictEqual(batteryEntry.stockPriceUSD, 89);
assert.strictEqual(batteryEntry.totalValUSD, 89);
console.log('  ✓ PASS: Grouped list accurately maps stockPriceUSD and totalValUSD per SKU');

// 3. Test Export with USD Stocking Price and Total Value Columns
console.log('\n--- 3. Testing Excel & PDF Export with USD Stocking Prices ---');
async function testExports() {
  const excelRes = await exportDcInventoryToExcel(groupedList, { filter: 'ALL', search: '' });
  assert.ok(excelRes.workbook, 'Workbook created');
  const ws = excelRes.workbook.worksheets[0];
  
  // Verify Category column is at Cell 4 for compatibility
  assert.strictEqual(ws.getRow(4).getCell(4).value, 'Display', 'Row 4 cell 4 must be Display');
  // Verify Stock Price (USD) is at Cell 6
  assert.strictEqual(ws.getRow(4).getCell(6).value, '$379.00', 'Row 4 cell 6 must be $379.00');
  // Verify Total Value (USD) is at Cell 7
  assert.strictEqual(ws.getRow(4).getCell(7).value, '$758.00', 'Row 4 cell 7 must be $758.00');
  
  const pdfRes = exportDcInventoryToPDF(groupedList, { filter: 'ALL', search: '' });
  assert.ok(pdfRes.doc, 'PDF generation successful');
  console.log('  ✓ PASS: Excel export includes Unit Stock Price ($379.00) and Total Valuation ($758.00)');
  console.log('  ✓ PASS: PDF export generated successfully with USD valuation columns');
}

await testExports();

// 4. Test Dynamic Real-Time Valuation Reactivity
console.log('\n--- 4. Testing Dynamic Real-Time Valuation Reactivity (Scan-In, Packing, Catalog) ---');
import { filterAvailableDcInStockUnits } from '../utils/appContextHelpers.js';

// Initial state: 7 Display units ($379 each)
let currentInventory = Array.from({ length: 7 }, (_, i) => ({
  id: `dc-init-disp-${i + 1}`,
  serial_number: `SEP_DISP_INIT_${i + 1}`,
  part_number: '661-30401',
  description: 'Display, iPhone 16 Pro Max',
  status: 'in_stock',
  current_site_id: 'site-dc',
  site_code: 'DC-MDC',
  received_at: '2026-09-01T08:00:00Z'
}));

let currentDraft = null;
let currentShipments = [];
let currentParts = [
  { part_number: '661-30401', description: 'Display, iPhone 16 Pro Max', stocking_price: 379 },
  { part_number: '661-21991', description: 'Battery, iPhone 13', stocking_price: 89 }
];

// Calculate dynamic valuation function mirroring Dashboard.jsx useMemo
function computeValuation(inv, draft, sh, catalog) {
  const available = filterAvailableDcInStockUnits({
    inventoryUnits: inv,
    activePackDraft: draft,
    shipments: sh
  });
  const totalValUSD = available.reduce((sum, u) => sum + resolveItemStockingPrice(u, catalog), 0);
  return { available, totalValUSD };
}

// Step 1: Initial 7 units @ $379 = $2,653.00
let state = computeValuation(currentInventory, currentDraft, currentShipments, currentParts);
assert.strictEqual(state.available.length, 7);
assert.strictEqual(state.totalValUSD, 2653, 'Initial valuation should be exactly $2,653.00 USD');
console.log(`  ✓ Dynamic Step 1 (Initial): 7 displays = $${state.totalValUSD.toFixed(2)} USD`);

// Step 2: Receive Scan-In of 3 Batteries ($89 each = +$267)
const newBatteries = Array.from({ length: 3 }, (_, i) => ({
  id: `dc-new-batt-${i + 1}`,
  serial_number: `SEP_BATT_NEW_${i + 1}`,
  part_number: '661-21991',
  description: 'Battery, iPhone 13',
  status: 'in_stock',
  current_site_id: 'site-dc',
  site_code: 'DC-MDC',
  received_at: new Date().toISOString()
}));
currentInventory = [...currentInventory, ...newBatteries];
state = computeValuation(currentInventory, currentDraft, currentShipments, currentParts);
assert.strictEqual(state.available.length, 10);
assert.strictEqual(state.totalValUSD, 2653 + (3 * 89), 'Valuation should dynamically increase to $2,920.00 USD');
console.log(`  ✓ Dynamic Step 2 (Scan-In +3 Batteries): 10 units = $${state.totalValUSD.toFixed(2)} USD`);

// Step 3: Packing 2 Displays into an Outbound Pack Draft (-2 * $379 = -$758)
currentDraft = {
  id: 'draft-101',
  site_id: 'site-ver',
  items: [
    { serial_number: 'SEP_DISP_INIT_1', part_number: '661-30401' },
    { serial_number: 'SEP_DISP_INIT_2', part_number: '661-30401' }
  ]
};
state = computeValuation(currentInventory, currentDraft, currentShipments, currentParts);
assert.strictEqual(state.available.length, 8);
assert.strictEqual(state.totalValUSD, 2920 - 758, 'Valuation should dynamically drop to $2,162.00 USD');
console.log(`  ✓ Dynamic Step 3 (Draft Pack -2 Displays): 8 available units = $${state.totalValUSD.toFixed(2)} USD`);

// Step 4: Finalizing & Dispatching Shipment (persists deduction)
currentShipments = [
  {
    id: 'sh-101',
    status: 'shipped',
    site_id: 'site-ver',
    items: currentDraft.items
  }
];
currentDraft = null; // draft cleared upon dispatch
state = computeValuation(currentInventory, currentDraft, currentShipments, currentParts);
assert.strictEqual(state.available.length, 8);
assert.strictEqual(state.totalValUSD, 2162, 'Valuation remains dynamically updated after shipment dispatch');
console.log(`  ✓ Dynamic Step 4 (Shipment Dispatched): 8 units = $${state.totalValUSD.toFixed(2)} USD`);

// Step 5: Parts Catalog Price Update (Admin updates Battery price to $95)
currentParts = [
  { part_number: '661-30401', description: 'Display, iPhone 16 Pro Max', stocking_price: 379 },
  { part_number: '661-21991', description: 'Battery, iPhone 13', stocking_price: 95 } // Updated from 89 to 95
];
state = computeValuation(currentInventory, currentDraft, currentShipments, currentParts);
// 5 displays @ 379 ($1,895) + 3 batteries @ 95 ($285) = $2,180
assert.strictEqual(state.totalValUSD, (5 * 379) + (3 * 95), 'Valuation dynamically reflects catalog price updates');
console.log(`  ✓ Dynamic Step 5 (Catalog Price Update): Total dynamically recalculates to $${state.totalValUSD.toFixed(2)} USD`);

console.log('\n====================================================');
console.log('ALL DC STOCK USD VALUATION TESTS PASSED (100%)');
console.log('====================================================');
