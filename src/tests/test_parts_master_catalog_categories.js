/**
 * Test Suite: Parts Master Catalog Category Classification & Normalization
 *
 * Verifies that:
 * 1. Parts are correctly categorized into Battery, Display, Camera, Back Glass, Mid/Rear System, and Other Components.
 * 2. Parts from the user's screenshots (Display, Logic Boards, Cameras, Back Glass) are NOT miscategorized as Battery.
 * 3. resolvePartCategoryId maps parts to their accurate category IDs (both UUID-based and slug-based).
 * 4. getCategoryForPart auto-corrects parts previously misassigned to Battery.
 * 5. Default catalog categories are canonical and consistent.
 */

import assert from 'assert';
import fs from 'fs';
import {
  HARDWARE_CATEGORIES,
  DEFAULT_PART_CATEGORIES,
  getPartCategory,
  getCategoryForPart,
  resolvePartCategoryId
} from '../utils/categoryFilter.js';
import { defaultPartsCatalog } from '../data/defaultCatalog.js';

const seedData = JSON.parse(fs.readFileSync(new URL('../data/seedData.json', import.meta.url), 'utf8'));

console.log('\n====================================================');
console.log('TEST SUITE: Parts Master Catalog Category Correction');
console.log('====================================================\n');

// ----------------------------------------------------
// 1. Categories Definition Integrity
// ----------------------------------------------------
console.log('--- 1. Category Definitions Integrity ---');
assert.strictEqual(HARDWARE_CATEGORIES.length, 6, 'HARDWARE_CATEGORIES must contain 6 categories');
assert.strictEqual(DEFAULT_PART_CATEGORIES.length, 6, 'DEFAULT_PART_CATEGORIES must contain 6 categories');

const expectedCodes = ['BATTERY', 'DISPLAY', 'CAMERA', 'BACK_GLASS', 'MID_REAR', 'OTHER'];
expectedCodes.forEach(code => {
  const found = DEFAULT_PART_CATEGORIES.find(c => c.code === code);
  assert.ok(found, `Category code ${code} must exist in DEFAULT_PART_CATEGORIES`);
});
console.log('  ✓ PASS: All 6 standard categories defined including OTHER (Other Components)');

// ----------------------------------------------------
// 2. User Screenshot Parts Categorization
// ----------------------------------------------------
console.log('\n--- 2. Specific User Screenshot Parts Verification ---');

const screenshotParts = [
  { pn: '661-22374', desc: 'Battery, iPhone 13 mini', expected: 'BATTERY' },
  { pn: '66B-30373', desc: 'Replacement Part (66B-30373)', expected: 'OTHER' },
  { pn: '661-21988', desc: 'Display, iPhone 13', expected: 'DISPLAY' },
  { pn: '661-30397', desc: 'SVC,IPHONE 14 PRO MAX, BATTERY', expected: 'BATTERY' },
  { pn: '661-22309', desc: 'Display, iPhone 13 Pro Max', expected: 'DISPLAY' },
  { pn: '661-37207', desc: 'Battery, iPhone 15 Plus', expected: 'BATTERY' },
  { pn: 'TA661-42898', desc: '128GB, White Titanium, ROW, iPhone 16 Pro, CI/AR', expected: 'MID_REAR' },
  { pn: 'TA661-45239', desc: '256GB, Ultramarine, ROW, iPhone 16 Plus, Logic Board Assy Mid System', expected: 'MID_REAR' },
  { pn: 'PP661-23455', desc: 'iPhone 13, Starlight, 128GB, Logic Board Assy Rear System, ROW', expected: 'MID_REAR' },
  { pn: 'PP661-23454', desc: 'iPhone 13, Midnight, 128GB, Logic Board Assy Rear System, ROW', expected: 'MID_REAR' },
  { pn: '661-30416', desc: 'Blue, Back Glass, iPhone 14', expected: 'BACK_GLASS' },
  { pn: 'PP661-23468', desc: 'iPhone 13, Blue, 512GB, Logic Board Assy Rear System, ROW', expected: 'MID_REAR' },
  { pn: 'Z661-56016', desc: 'Logic Board, 512GB, iPhone 17, ROW', expected: 'MID_REAR' },
  { pn: '661-42845', desc: 'Camera, iPhone 16 Plus', expected: 'CAMERA' },
  { pn: '661-32232', desc: 'Rear Camera, iPhone 13/mini, MICN', expected: 'CAMERA' },
  { pn: '923-02609', desc: 'Speaker, iPhone XR', expected: 'OTHER' }
];

screenshotParts.forEach(item => {
  const detected = getPartCategory({ part_number: item.pn, description: item.desc });
  assert.strictEqual(detected, item.expected, `Part ${item.pn} (${item.desc}) should be ${item.expected}, got ${detected}`);
});
console.log(`  ✓ PASS: All ${screenshotParts.length} screenshot parts correctly classified`);

// ----------------------------------------------------
// 3. Auto-Healing of Misassigned Battery Category
// ----------------------------------------------------
console.log('\n--- 3. Auto-Healing Misassigned Battery Category ---');

const testCategories = [
  { id: 'uuid-batt', code: 'BATTERY', name: 'Battery' },
  { id: 'uuid-disp', code: 'DISPLAY', name: 'Display' },
  { id: 'uuid-cam', code: 'CAMERA', name: 'Camera' },
  { id: 'uuid-glass', code: 'BACK_GLASS', name: 'Back Glass' },
  { id: 'uuid-mid', code: 'MID_REAR', name: 'Mid/Rear System' },
  { id: 'uuid-other', code: 'OTHER', name: 'Other Components' }
];

// Display part mistakenly tagged with Battery UUID
const misassignedDisplay = {
  part_number: '661-21988',
  description: 'Display, iPhone 13',
  category_id: 'uuid-batt'
};

const resolvedCat = getCategoryForPart(misassignedDisplay, testCategories);
assert.strictEqual(resolvedCat.code, 'DISPLAY', 'Should resolve to DISPLAY even when category_id was Battery');
assert.strictEqual(resolvedCat.id, 'uuid-disp', 'Should return Display category UUID');

const resolvedId = resolvePartCategoryId(misassignedDisplay, testCategories);
assert.strictEqual(resolvedId, 'uuid-disp', 'resolvePartCategoryId should return Display UUID');
console.log('  ✓ PASS: Auto-healing overrides stale Battery category_id and returns correct Display category');

// Mid/Rear Logic Board part mistakenly tagged with Battery
const misassignedLogicBoard = {
  part_number: 'PP661-23455',
  description: 'iPhone 13, Starlight, 128GB, Logic Board Assy Rear System, ROW',
  category_id: 'uuid-batt'
};

const resolvedMidCat = getCategoryForPart(misassignedLogicBoard, testCategories);
assert.strictEqual(resolvedMidCat.code, 'MID_REAR', 'Should resolve to MID_REAR');
assert.strictEqual(resolvedMidCat.id, 'uuid-mid', 'Should return Mid/Rear UUID');
console.log('  ✓ PASS: Auto-healing correctly identifies Logic Board / Mid/Rear systems');

// ----------------------------------------------------
// 4. Default Catalog Normalization
// ----------------------------------------------------
console.log('\n--- 4. defaultPartsCatalog Consistency ---');
assert.ok(defaultPartsCatalog.length > 200, 'defaultPartsCatalog must have parts');

const allowedCatIds = ['cat-battery', 'cat-display', 'cat-camera', 'cat-backglass', 'cat-midrear', 'cat-other'];
defaultPartsCatalog.forEach(p => {
  assert.ok(allowedCatIds.includes(p.category_id), `Part ${p.part_number} has invalid category_id: ${p.category_id}`);
});
console.log(`  ✓ PASS: All ${defaultPartsCatalog.length} parts in defaultPartsCatalog use normalized canonical category IDs`);

// ----------------------------------------------------
// 5. SeedData Categories & Parts
// ----------------------------------------------------
console.log('\n--- 5. SeedData Categories & Parts Integrity ---');
assert.ok(seedData.categories.some(c => c.code === 'OTHER'), 'seedData.categories must include OTHER');

seedData.parts.forEach(p => {
  const genuineCode = getPartCategory(p);
  const expectedId = 'cat-' + genuineCode.toLowerCase().replace('_', '');
  assert.strictEqual(p.category_id, expectedId, `seedData part ${p.part_number} category_id mismatch`);
});
console.log(`  ✓ PASS: All ${seedData.parts.length} seedData parts accurately categorized`);

console.log('\n====================================================');
console.log('ALL PARTS MASTER CATALOG CATEGORY TESTS PASSED (100%)');
console.log('====================================================\n');
