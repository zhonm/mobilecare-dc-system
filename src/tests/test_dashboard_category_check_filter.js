import assert from 'assert';
import {
  getMasterlistParts,
  getMasterlistPartsForSite,
  getMasterlistSites,
  scanMasterlistData
} from '../utils/rawMasterlistScanner.js';
import { isPartMatchingCategoryFilter, DEFAULT_SELECTED_CATEGORIES, HARDWARE_CATEGORIES } from '../utils/categoryFilter.js';

console.log('====================================================');
console.log('TEST SUITE: Dashboard Report Category Check Filter');
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
// 1. Default Selected Categories: Battery & Display
// ----------------------------------------------------
console.log('\n--- 1. Default Check Filter (Battery & Display) ---');

it('Default selected categories is [BATTERY, DISPLAY]', () => {
  assert.deepStrictEqual(DEFAULT_SELECTED_CATEGORIES, ['BATTERY', 'DISPLAY']);
});

it('Filters masterlist parts to strictly Battery and Display by default', () => {
  const defaultReport = getMasterlistParts({
    category: 'ALL',
    categories: ['BATTERY', 'DISPLAY'],
    limit: 'ALL'
  });

  assert.ok(defaultReport.totalCount > 0, 'Must return parts');
  assert.strictEqual(defaultReport.totalFilteredUnits, 4660, 'September 2026 Battery (2,718) + Display (1,942) = 4,660 units');

  // Verify all parts in display list are either Battery or Display
  defaultReport.all.forEach(p => {
    assert.ok(
      p.category === 'Battery' || p.category === 'Display',
      `Expected Battery or Display, got ${p.category} (${p.description})`
    );
  });
});

// ----------------------------------------------------
// 2. Adjusting Check Filter: Adding Cameras
// ----------------------------------------------------
console.log('\n--- 2. Dynamic Adjustment: Adding Cameras ---');

it('Adjusts parts list when user checks Camera in addition to Battery & Display', () => {
  const withCameraReport = getMasterlistParts({
    category: 'ALL',
    categories: ['BATTERY', 'DISPLAY', 'CAMERA'],
    limit: 'ALL'
  });

  // Battery (2,718) + Display (1,942) + Camera (885) = 5,545 units
  assert.strictEqual(withCameraReport.totalFilteredUnits, 5545, 'Battery + Display + Camera = 5,545 units');

  const hasCamera = withCameraReport.all.some(p => p.category === 'Camera');
  const hasDisplay = withCameraReport.all.some(p => p.category === 'Display');
  const hasBattery = withCameraReport.all.some(p => p.category === 'Battery');
  const hasBackGlass = withCameraReport.all.some(p => p.category === 'Back Glass');

  assert.strictEqual(hasCamera, true, 'Must include cameras');
  assert.strictEqual(hasDisplay, true, 'Must include displays');
  assert.strictEqual(hasBattery, true, 'Must include batteries');
  assert.strictEqual(hasBackGlass, false, 'Must NOT include back glass when unchecked');
});

// ----------------------------------------------------
// 3. Selecting All Categories (All 5 Categories)
// ----------------------------------------------------
console.log('\n--- 3. Select All Categories ---');

it('Displays all 395 parts and 7,611 units when all 5 categories are selected', () => {
  const allCategories = HARDWARE_CATEGORIES.map(c => c.code);
  const allReport = getMasterlistParts({
    category: 'ALL',
    categories: allCategories,
    limit: 'ALL'
  });

  assert.strictEqual(allReport.totalCount, 395, 'Must contain all 395 SKUs');
  assert.strictEqual(allReport.totalFilteredUnits, 7611, 'Must contain authoritative 7,611 units');
});

// ----------------------------------------------------
// 4. Single Category Check (Only Battery)
// ----------------------------------------------------
console.log('\n--- 4. Single Category Selection ---');

it('Displays only Battery parts when only Battery is checked', () => {
  const batteryOnly = getMasterlistParts({
    category: 'ALL',
    categories: ['BATTERY'],
    limit: 'ALL'
  });

  assert.strictEqual(batteryOnly.totalFilteredUnits, 2718, 'Must equal total batteries (2,718 units)');
  batteryOnly.all.forEach(p => {
    assert.strictEqual(p.category, 'Battery');
  });
});

// ----------------------------------------------------
// 5. Per-Site Parts Filtering (All Parts Per Site)
// ----------------------------------------------------
console.log('\n--- 5. All Parts Per Site Category Filtering ---');

it('Filters branch parts for specific site based on user category check filter', () => {
  const branchDefault = getMasterlistPartsForSite('MOBILECARE - NEWPOINT MALL', {
    category: 'ALL',
    categories: ['BATTERY', 'DISPLAY'],
    limit: 'ALL'
  });

  assert.ok(branchDefault.totalPartsCount > 0);
  branchDefault.all.forEach(p => {
    assert.ok(
      p.category === 'Battery' || p.category === 'Display',
      `Branch part must be Battery or Display, got ${p.category}`
    );
  });

  // When all categories are active
  const branchAll = getMasterlistPartsForSite('MOBILECARE - NEWPOINT MALL', {
    category: 'ALL',
    categories: ['BATTERY', 'DISPLAY', 'CAMERA', 'BACK_GLASS', 'MID_REAR'],
    limit: 'ALL'
  });

  assert.ok(branchAll.totalPartsCount > branchDefault.totalPartsCount, 'All categories must have more parts than default');
  assert.strictEqual(branchAll.siteTotalUnits, 784, 'Newpoint total units is 784');
});

// ----------------------------------------------------
// 6. Service Hubs Network Filter
// ----------------------------------------------------
console.log('\n--- 6. Service Hubs Network Filter ---');

it('Filters Service Hubs demand when categories are selected', () => {
  const hubsDefault = getMasterlistSites({
    categories: ['BATTERY', 'DISPLAY'],
    limit: 'ALL'
  });

  assert.strictEqual(hubsDefault.totalSitesCount, 27);
  assert.ok(hubsDefault.all[0].totalUnits > 0);

  hubsDefault.all.forEach(s => {
    s.allParts.forEach(p => {
      assert.ok(p.category === 'Battery' || p.category === 'Display');
    });
  });
});

console.log('\n====================================================');
console.log(`ALL TESTS PASSED! (${passedTests}/${passedTests})`);
console.log('====================================================');
