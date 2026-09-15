import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  getPartCategory,
  isPartMatchingCategoryFilter,
  getCategoryBadgeStyle,
  DEFAULT_SELECTED_CATEGORIES
} from '../utils/categoryFilter.js';

console.log('====================================================');
console.log('TEST SUITE: Stock Transfer Reports Category Filter');
console.log('====================================================');

let passedTests = 0;
function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------
// 1. Header TabConfig Verification
// ----------------------------------------------------
console.log('\n--- 1. Header tabConfig Configuration ---');

it('Header.jsx reports tabConfig enables showCategories', () => {
  const headerPath = path.resolve('src/components/Header.jsx');
  const headerContent = fs.readFileSync(headerPath, 'utf8');
  assert.ok(
    headerContent.includes("reports: { title: 'Stock Transfer Reports', section: 'Reports & Analytics', showCategories: true }"),
    'Header tabConfig.reports must have showCategories: true'
  );
});

// ----------------------------------------------------
// 2. getPartCategory on Stock Transfer Record Objects
// ----------------------------------------------------
console.log('\n--- 2. Record Classification via product_name ---');

const sampleTransfers = [
  { product_code: '661-21991', product_name: 'Battery, iPhone 13', transfer_quantity: 496, from_stock: 'DC', to_stock: 'VBR' },
  { product_code: '661-20397', product_name: 'Battery, iPhone 14 Pro Max', transfer_quantity: 159, from_stock: 'DC', to_stock: 'GLS' },
  { product_code: '661-17935', product_name: 'Display, iPhone 12 Pro Max', transfer_quantity: 120, from_stock: 'DC', to_stock: 'SMS' },
  { product_code: '661-24011', product_name: 'Camera, Wide Angle, iPhone 14', transfer_quantity: 18, from_stock: 'DC', to_stock: 'POD' },
  { product_code: '661-31422', product_name: 'Back Glass, Natural Titanium, iPhone 15 Pro', transfer_quantity: 12, from_stock: 'DC', to_stock: 'FES' },
  { product_code: '661-28501', product_name: 'Rear System, iPhone 15', transfer_quantity: 15, from_stock: 'DC', to_stock: 'VBR' },
  { product_code: '923-03859', product_name: 'Battery Adhesive Tape, iPhone 13', transfer_quantity: 50, from_stock: 'DC', to_stock: 'VBR' },
  { product_code: '923-06781', product_name: 'SIM Tray, Midnight, iPhone 14', transfer_quantity: 5, from_stock: 'DC', to_stock: 'GLS' },
  { product_code: '923-13582', product_name: 'Main Microphone, iPhone 16', transfer_quantity: 10, from_stock: 'DC', to_stock: 'SMS' }
];

it('Correctly classifies sample stock transfer records into appropriate categories', () => {
  assert.strictEqual(getPartCategory(sampleTransfers[0]), 'BATTERY', 'Battery iPhone 13');
  assert.strictEqual(getPartCategory(sampleTransfers[1]), 'BATTERY', 'Battery iPhone 14 Pro Max');
  assert.strictEqual(getPartCategory(sampleTransfers[2]), 'DISPLAY', 'Display iPhone 12 Pro Max');
  assert.strictEqual(getPartCategory(sampleTransfers[3]), 'CAMERA', 'Camera iPhone 14');
  assert.strictEqual(getPartCategory(sampleTransfers[4]), 'BACK_GLASS', 'Back Glass iPhone 15 Pro');
  assert.strictEqual(getPartCategory(sampleTransfers[5]), 'MID_REAR', 'Rear System iPhone 15');
  assert.strictEqual(getPartCategory(sampleTransfers[6]), 'OTHER', 'Battery Adhesive is disqualified to OTHER');
  assert.strictEqual(getPartCategory(sampleTransfers[7]), 'OTHER', 'SIM Tray is disqualified to OTHER');
  assert.strictEqual(getPartCategory(sampleTransfers[8]), 'OTHER', 'Main Microphone is disqualified to OTHER');
});

// ----------------------------------------------------
// 3. Multi-Category Filtering Logic
// ----------------------------------------------------
console.log('\n--- 3. Multi-Category Filtering Logic ---');

it('Filters by default categories (Battery & Display)', () => {
  const filtered = sampleTransfers.filter(r => isPartMatchingCategoryFilter(r, DEFAULT_SELECTED_CATEGORIES));
  assert.strictEqual(filtered.length, 3);
  assert.ok(filtered.every(r => ['BATTERY', 'DISPLAY'].includes(getPartCategory(r))));
  const totalUnits = filtered.reduce((acc, r) => acc + r.transfer_quantity, 0);
  assert.strictEqual(totalUnits, 496 + 159 + 120);
});

it('Filters by the 5 Header Hardware Categories (Select All preset in HeaderCategoryFilter)', () => {
  const headerCats = ['BATTERY', 'DISPLAY', 'CAMERA', 'BACK_GLASS', 'MID_REAR'];
  const filtered = sampleTransfers.filter(r => isPartMatchingCategoryFilter(r, headerCats));
  assert.strictEqual(filtered.length, 6);
  assert.ok(!filtered.some(r => r.product_name.includes('Adhesive') || r.product_name.includes('SIM Tray')));
  const totalUnits = filtered.reduce((acc, r) => acc + r.transfer_quantity, 0);
  assert.strictEqual(totalUnits, 496 + 159 + 120 + 18 + 12 + 15); // 820 units
});

it('Includes other items when OTHER category is explicitly included', () => {
  const allCatsWithOther = ['BATTERY', 'DISPLAY', 'CAMERA', 'BACK_GLASS', 'MID_REAR', 'OTHER'];
  const filtered = sampleTransfers.filter(r => isPartMatchingCategoryFilter(r, allCatsWithOther));
  assert.strictEqual(filtered.length, 9);
});

it('Filters by single category Camera only', () => {
  const filtered = sampleTransfers.filter(r => isPartMatchingCategoryFilter(r, ['CAMERA']));
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].product_code, '661-24011');
  assert.strictEqual(filtered[0].transfer_quantity, 18);
});

it('Filters by custom combination: Camera and Back Glass', () => {
  const filtered = sampleTransfers.filter(r => isPartMatchingCategoryFilter(r, ['CAMERA', 'BACK_GLASS']));
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered.reduce((acc, r) => acc + r.transfer_quantity, 0), 30);
});

// ----------------------------------------------------
// 4. Badge Styling Verification
// ----------------------------------------------------
console.log('\n--- 4. Category Badge Styling ---');

it('Provides distinct and valid styles for all categories', () => {
  ['BATTERY', 'DISPLAY', 'CAMERA', 'BACK_GLASS', 'MID_REAR', 'OTHER'].forEach(code => {
    const style = getCategoryBadgeStyle(code);
    assert.ok(style.color, `Must have color for ${code}`);
    assert.ok(style.bg, `Must have bg for ${code}`);
    assert.ok(style.label, `Must have label for ${code}`);
  });
});

console.log('\n====================================================');
console.log(`ALL ${passedTests} STOCK TRANSFER CATEGORY TESTS PASSED (100%)`);
console.log('====================================================\n');
