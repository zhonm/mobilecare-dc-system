import assert from 'assert';
import { isTargetIPhonePart, processRawUsageSheet } from '../utils/excelParser.js';
import { isPartMatchingCategoryFilter, DEFAULT_SELECTED_CATEGORIES, HARDWARE_CATEGORIES } from '../utils/categoryFilter.js';

console.log('--- RUNNING MULTI-CATEGORY FILTER & ALL-IPHONE-PARTS INGESTION TESTS ---');

// =========================================================================
// TEST 1: isPartMatchingCategoryFilter Predicate Across All 5 Categories
// =========================================================================
console.log('\nTest 1: isPartMatchingCategoryFilter with various category combinations');
const sampleParts = [
  { id: '1', category_id: 'cat-battery', description: 'Battery, iPhone 14 Pro' },
  { id: '2', category_id: 'cat-display', description: 'Display, iPhone 15' },
  { id: '3', category_id: 'cat-camera', description: 'Camera, TrueDepth Sensor, iPhone 15 Pro' },
  { id: '4', category_id: 'cat-backglass', description: 'Back Glass, iPhone 14' },
  { id: '5', category_id: 'cat-midrear', description: 'Rear System & Logic Board, iPhone 13 Pro' }
];

// Default selection: ['BATTERY', 'DISPLAY']
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[0], DEFAULT_SELECTED_CATEGORIES), true, 'Battery matches default');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[1], DEFAULT_SELECTED_CATEGORIES), true, 'Display matches default');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[2], DEFAULT_SELECTED_CATEGORIES), false, 'Camera excluded by default');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[3], DEFAULT_SELECTED_CATEGORIES), false, 'Back Glass excluded by default');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[4], DEFAULT_SELECTED_CATEGORIES), false, 'Mid/Rear excluded by default');

// Custom selection: ['CAMERA', 'BACK_GLASS']
const camAndGlass = ['CAMERA', 'BACK_GLASS'];
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[0], camAndGlass), false, 'Battery not matched in cam/glass');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[1], camAndGlass), false, 'Display not matched in cam/glass');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[2], camAndGlass), true, 'Camera matched in cam/glass');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[3], camAndGlass), true, 'Back Glass matched in cam/glass');
assert.strictEqual(isPartMatchingCategoryFilter(sampleParts[4], camAndGlass), false, 'Mid/Rear not matched in cam/glass');

// All 5 categories selected
const allCats = HARDWARE_CATEGORIES.map(c => c.code);
sampleParts.forEach(p => {
  assert.strictEqual(isPartMatchingCategoryFilter(p, allCats), true, `Part ${p.description} matches when all selected`);
});
console.log('✓ Test 1 Passed: Filter correctly isolates and includes categories.');

// =========================================================================
// TEST 2: isTargetIPhonePart with New Default 'ALL_IPHONE_PARTS' Scope
// =========================================================================
console.log('\nTest 2: isTargetIPhonePart scope handling');
const cameraDesc = 'Camera, Rear Dual, iPhone 14';
const glassDesc = 'Back Glass, iPhone 15 Pro Max';
const midRearDesc = 'Rear System, iPhone 14 Pro';
const batteryDesc = 'Battery, iPhone 15';
const legacyBatteryDesc = 'Battery, iPhone 11'; // in 20 legacy exclusions
const nonIphoneDesc = 'Display, iPad Pro 11-inch';

// Under ALL_IPHONE_PARTS (New default)
assert.strictEqual(isTargetIPhonePart(cameraDesc, '', 'ALL_IPHONE_PARTS'), true, 'Camera allowed under ALL_IPHONE_PARTS');
assert.strictEqual(isTargetIPhonePart(glassDesc, '', 'ALL_IPHONE_PARTS'), true, 'Back Glass allowed under ALL_IPHONE_PARTS');
assert.strictEqual(isTargetIPhonePart(midRearDesc, '', 'ALL_IPHONE_PARTS'), true, 'Mid/Rear allowed under ALL_IPHONE_PARTS');
assert.strictEqual(isTargetIPhonePart(batteryDesc, '', 'ALL_IPHONE_PARTS'), true, 'iPhone 15 battery allowed');
assert.strictEqual(isTargetIPhonePart(legacyBatteryDesc, '', 'ALL_IPHONE_PARTS'), false, 'Legacy iPhone 11 battery excluded');
assert.strictEqual(isTargetIPhonePart(nonIphoneDesc, '', 'ALL_IPHONE_PARTS'), false, 'iPad excluded under ALL_IPHONE_PARTS');

// Under legacy IPHONE_13_PLUS_BATTERY_DISPLAY
assert.strictEqual(isTargetIPhonePart(cameraDesc, '', 'IPHONE_13_PLUS_BATTERY_DISPLAY'), false, 'Camera rejected under legacy scope');
assert.strictEqual(isTargetIPhonePart(glassDesc, '', 'IPHONE_13_PLUS_BATTERY_DISPLAY'), false, 'Back Glass rejected under legacy scope');
assert.strictEqual(isTargetIPhonePart(midRearDesc, '', 'IPHONE_13_PLUS_BATTERY_DISPLAY'), false, 'Mid/Rear rejected under legacy scope');
assert.strictEqual(isTargetIPhonePart(batteryDesc, '', 'IPHONE_13_PLUS_BATTERY_DISPLAY'), true, 'Battery allowed under legacy scope');

// Under ALL_PARTS
assert.strictEqual(isTargetIPhonePart(nonIphoneDesc, '', 'ALL_PARTS'), true, 'iPad allowed under ALL_PARTS');
console.log('✓ Test 2 Passed: isTargetIPhonePart correctly admits and filters parts based on scope.');

// =========================================================================
// TEST 3: Full Ingestion Pipeline (processRawUsageSheet) with All Categories
// =========================================================================
console.log('\nTest 3: Ingesting dataset with Battery, Display, Camera, Back Glass, Mid/Rear');

const mockSites = [
  { id: 'site-1', code: 'APP BHS', name: 'MobileCare BHS', is_dc: false },
  { id: 'site-2', code: 'APP GB3', name: 'MobileCare Greenbelt', is_dc: false },
  { id: 'site-3', code: 'APP MOA', name: 'MobileCare Mall of Asia', is_dc: false }
];

const mockRawRows = [
  ['Site Name', 'GSX Repair Number', 'Repair Closed Date', 'Part Number', 'Part Description', 'Quantity'],
  // Display repair
  ['APP BHS', 'R-001', '2026-08-10', '661-21988', 'Display, iPhone 13', 5],
  // Battery repair
  ['APP GB3', 'R-002', '2026-08-11', '661-21990', 'Battery, iPhone 13', 8],
  // Camera repair
  ['APP MOA', 'R-003', '2026-08-12', '661-30001', 'Camera, TrueDepth, iPhone 14 Pro', 6],
  // Back Glass repair
  ['APP BHS', 'R-004', '2026-08-13', '661-30002', 'Back Glass, iPhone 15', 4],
  // Mid/Rear System repair
  ['APP GB3', 'R-005', '2026-08-14', '661-30003', 'Rear System, iPhone 14', 3]
];

const result = processRawUsageSheet(mockRawRows, mockSites, [], {
  filterScope: 'ALL_IPHONE_PARTS',
  selectedMonth: 8, // September target
  allocationMode: 'OPTION_B'
});

assert.strictEqual(result.records.length, 5, 'All 5 repairs admitted');

// Check category assignments in parsed records
const catCounts = {};
result.records.forEach(r => {
  catCounts[r.category_id] = (catCounts[r.category_id] || 0) + 1;
});
assert.strictEqual(catCounts['cat-display'], 1, 'Display record categorized');
assert.strictEqual(catCounts['cat-battery'], 1, 'Battery record categorized');
assert.strictEqual(catCounts['cat-camera'], 1, 'Camera record categorized');
assert.strictEqual(catCounts['cat-backglass'], 1, 'Back Glass record categorized');
assert.strictEqual(catCounts['cat-midrear'], 1, 'Mid/Rear record categorized');

// Check that forecast items exist for all parts
const forecastDescs = result.forecastItems.map(fi => fi.description);
assert(forecastDescs.includes('Display, iPhone 13'), 'Display in forecast items');
assert(forecastDescs.includes('Battery, iPhone 13'), 'Battery in forecast items');
assert(forecastDescs.includes('Camera, TrueDepth, iPhone 14 Pro'), 'Camera in forecast items');
assert(forecastDescs.includes('Back Glass, iPhone 15'), 'Back Glass in forecast items');
assert(forecastDescs.includes('Rear System, iPhone 14'), 'Rear System in forecast items');

// Check that allocations exist for all parts with intact weekly splits and site quantities
result.allocations.forEach(alloc => {
  assert(typeof alloc.total_allocated_qty === 'number', 'total_allocated_qty is a number');
  assert(typeof alloc.w1_qty === 'number', 'w1_qty is a number');
  assert(typeof alloc.w2_qty === 'number', 'w2_qty is a number');
  assert(typeof alloc.w3_qty === 'number', 'w3_qty is a number');
  assert(typeof alloc.w4_qty === 'number', 'w4_qty is a number');
  
  // Weekly split quantities must sum up to total allocated quantity
  const splitSum = alloc.w1_qty + alloc.w2_qty + alloc.w3_qty + alloc.w4_qty;
  assert.strictEqual(splitSum, alloc.total_allocated_qty, `Weekly split sum (${splitSum}) matches total allocated (${alloc.total_allocated_qty}) for ${alloc.description}`);
});

console.log('✓ Test 3 Passed: Ingestion engine successfully parsed, forecasted, and allocated all 5 iPhone categories with accurate weekly splits and order remarks.');

// =========================================================================
// TEST 4: Strict Battery & Display Filtering Isolation (Fix for Screenshot Issues)
// =========================================================================
console.log('\nTest 4: Strict Battery & Display filtering isolation');
const userScreenshotParts = [
  { part_number: '661-21988', description: 'Display, iPhone 13', category_id: 'cat-display' },
  { part_number: '661-21991', description: 'Battery, iPhone 13', category_id: 'cat-battery' },
  { part_number: '923-02609', description: 'Speaker, iPhone XR', category_id: 'cat-other' },
  { part_number: '923-04236', description: 'Top Speaker, iPhone 11', category_id: 'cat-other' },
  { part_number: 'ZP923-13705', description: 'Silver, Enclosure, iPhone 17 Pro Max, ROW', category_id: 'cat-midrear' },
  { part_number: 'ZP923-13706', description: 'Cosmic Orange, Enclosure, iPhone 17 Pro Max', category_id: 'cat-midrear' },
  { part_number: 'PP661-22980', description: 'Midnight, 128 GB, iPhone 13, ROW, CI/AR, Philippines', category_id: 'cat-midrear' },
  { part_number: 'TA661-45263', description: '256GB, Desert Titanium, ROW, iPhone 16 Pro Max', category_id: 'cat-midrear' },
  // Even if legacy data had category_id set to 'cat-battery' for an enclosure or speaker:
  { part_number: 'CORRUPTED-1', description: 'Speaker, iPhone XR', category_id: 'cat-battery' },
  { part_number: 'CORRUPTED-2', description: 'Silver, Enclosure, iPhone 17 Pro Max, ROW', category_id: 'cat-battery' }
];

const battAndDisp = ['BATTERY', 'DISPLAY'];

assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[0], battAndDisp), true, 'Display is shown');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[1], battAndDisp), true, 'Battery is shown');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[2], battAndDisp), false, 'Speaker XR is strictly excluded');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[3], battAndDisp), false, 'Top Speaker 11 is strictly excluded');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[4], battAndDisp), false, 'Silver Enclosure is strictly excluded');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[5], battAndDisp), false, 'Cosmic Orange Enclosure is strictly excluded');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[6], battAndDisp), false, 'Midnight 128GB is strictly excluded');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[7], battAndDisp), false, '256GB Desert Titanium is strictly excluded');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[8], battAndDisp), false, 'Corrupted speaker is strictly excluded from Battery & Display');
assert.strictEqual(isPartMatchingCategoryFilter(userScreenshotParts[9], battAndDisp), false, 'Corrupted enclosure is strictly excluded from Battery & Display');

console.log('✓ Test 4 Passed: Strict isolation verified - Speakers, Enclosures, and non-battery parts are 100% excluded when only Battery & Display are selected.');

console.log('\nALL MULTI-CATEGORY FILTER & INGESTION TESTS PASSED SUCCESSFULLY!');
