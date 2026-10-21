import assert from 'assert';
import { calculateDeclaredValuePHP, resolveItemStockingPrice, healShipmentItem } from '../utils/shipmentHelpers.js';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';
import { exportPackingListXLSX } from '../utils/excelParser.js';

console.log('====================================================');
console.log('TEST SUITE: Packing List Declared Value Accuracy & Parity');
console.log('====================================================\n');

// 1. User reported items (Invoice Ref DCOWNED#101926A)
const testItems = [
  {
    part_number: '661-30397',
    description: 'Battery, iPhone 14 Pro Max',
    serial_number: 'F8Y6277C73P20J9BA',
    box_number: 1
  },
  {
    part_number: '661-30401',
    description: 'Display, iPhone 14 Pro Max',
    serial_number: 'G9P5183NC1914YDAV',
    box_number: 1
  },
  {
    part_number: '661-30401',
    description: 'Display, iPhone 14 Pro Max',
    serial_number: 'G9P5434NN0M14YDAM',
    box_number: 1
  },
  {
    part_number: '661-30397',
    description: 'SVC,IPHONE 14 PRO MAX, BATTERY',
    serial_number: 'F8Y6233C1QP20J9B3',
    box_number: 1
  }
];

const mockShipment = {
  id: 'ship-101926A',
  invoice_ref: 'DCOWNED#101926A',
  carrier: 'Lite Express',
  shipping_mode: 'Land',
  site_name: 'MOBILECARE - FESTIVAL MALL',
  site_code: 'FESTIVAL',
  total_boxes: 1,
  box_number: 1,
  remarks: 'KGB PARTS',
  created_at: new Date().toISOString()
};

const mockSite = {
  id: 'site-festival',
  code: 'FESTIVAL',
  name: 'MobileCare - Festival Mall',
  region: 'Metro Manila'
};

// --- Test 1: Unit Stocking Price Resolution ---
console.log('--- Test 1: Unit Stocking Price Resolution ---');
const priceBattery = resolveItemStockingPrice(testItems[0]);
const priceDisplay = resolveItemStockingPrice(testItems[1]);
assert.strictEqual(priceBattery, 99, '661-30397 (Battery) must resolve to $99 USD from Apple catalog');
assert.strictEqual(priceDisplay, 379, '661-30401 (Display) must resolve to $379 USD from Apple catalog');
console.log(`  ✓ PASS: 661-30397 = $${priceBattery} USD, 661-30401 = $${priceDisplay} USD`);

// --- Test 2: Prefix 'ZM' and whitespace handling ---
console.log('\n--- Test 2: ZM Prefix Handling ---');
const priceZmDisplay = resolveItemStockingPrice({ part_number: 'ZM661-30401', description: 'Display' });
assert.strictEqual(priceZmDisplay, 379, 'ZM661-30401 must resolve to $379 USD');
console.log('  ✓ PASS: ZM661-30401 resolves to $379 USD');

// --- Test 3: Total Declared Value Calculation ---
console.log('\n--- Test 3: Total Declared Value Calculation ---');
const totalPHP = calculateDeclaredValuePHP(testItems);
// Expected: (99 + 379 + 379 + 99) * 85 = 956 * 85 = 81,260 PHP
assert.strictEqual(totalPHP, 81260, 'Total Declared Value for DCOWNED#101926A must be exactly PHP 81,260.00');
console.log(`  ✓ PASS: calculateDeclaredValuePHP returned PHP ${totalPHP.toLocaleString('en-US', { minimumFractionDigits: 2 })} (matches UI preview!)`);

// --- Test 4: PDF Generator Parity ---
console.log('\n--- Test 4: PDF Generator Parity ---');
const { doc } = generatePackingListPDF(mockShipment, testItems, mockSite, { saveFile: false });
assert.ok(doc, 'PDF doc must be generated successfully');

// Inspect text rendered in the PDF
let renderedPdfText = '';
const totalPages = doc.internal.getNumberOfPages();
for (let p = 1; p <= totalPages; p++) {
  doc.setPage(p);
  const textArray = doc.internal.pages[p] || [];
  // jsPDF internal page stream contains instructions
  renderedPdfText += JSON.stringify(textArray);
}

// In jsPDF, text strings are embedded into the page stream
const hasDeclaredValueHeader = renderedPdfText.includes('DECLARED VALUE');
const hasCorrectValue = renderedPdfText.includes('81,260.00');
const hasIncorrectValue = renderedPdfText.includes('64,260.00');

assert.ok(hasDeclaredValueHeader, 'PDF must contain "DECLARED VALUE" block');
assert.ok(hasCorrectValue, 'PDF must contain the correct declared value "81,260.00"');
assert.strictEqual(hasIncorrectValue, false, 'PDF must NOT contain the incorrect value "64,260.00"');
console.log('  ✓ PASS: Generated PDF contains "PHP 81,260.00" and does NOT contain "64,260.00"');

// --- Test 5: Excel (.xlsx) Export Parity ---
console.log('\n--- Test 5: Excel (.xlsx) Export Parity ---');
const { workbook } = await exportPackingListXLSX(mockShipment, testItems, mockSite);
const ws = workbook.getWorksheet('Packing List');
assert.ok(ws, 'Worksheet "Packing List" must exist');

const cellH7 = ws.getCell('H7').value;
assert.strictEqual(cellH7, 81260, 'Excel cell H7 (DECLARED VALUE) must be exactly 81,260');
console.log('  ✓ PASS: Excel cell H7 contains 81,260');

// --- Test 6: Item healing attaches stocking_price ---
console.log('\n--- Test 6: Item healing attaches stocking_price ---');
const healedItem = healShipmentItem(testItems[1]);
assert.strictEqual(healedItem.stocking_price, 379, 'healShipmentItem must attach stocking_price 379 to 661-30401');
console.log('  ✓ PASS: healShipmentItem attached stocking_price: 379');

// --- Test 7: 3-Item vs 4-Item Declared Value Parity (Image 2 Troubleshooting) ---
console.log('\n--- Test 7: 3-Item vs 4-Item Declared Value Parity ---');
const items3 = testItems.slice(0, 3);
const declaredVal3 = calculateDeclaredValuePHP(items3);
assert.strictEqual(declaredVal3, 72845, '3 items must equal PHP 72,845.00 exactly');
const declaredVal4 = calculateDeclaredValuePHP(testItems);
assert.strictEqual(declaredVal4, 81260, '4 items must equal PHP 81,260.00 exactly');
console.log(`  ✓ PASS: 3 items (without 2nd battery) = PHP ${declaredVal3.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log(`  ✓ PASS: 4 items (with 2nd battery) = PHP ${declaredVal4.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
console.log('  ✓ PASS: Confirms PHP 72,845.00 occurred when 4th item was unsynced; synchronizing 4 items restores PHP 81,260.00');

console.log('\n====================================================');
console.log('RESULTS: ALL DECLARED VALUE TESTS PASSED (100%)');
console.log('====================================================');
