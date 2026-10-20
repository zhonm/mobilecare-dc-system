import assert from 'assert';
import {
  CANONICAL_SITE_LIST,
  getCanonicalSiteSortIndex,
  resolveSafeRegion
} from '../constants/config.js';
import { resolveMergedActiveServiceSites } from '../utils/excelParser.js';
import { resolveSiteBranchCode } from '../utils/shipmentHelpers.js';
import { resolvePmgSiteFolderName } from '../services/driveAutoSyncService.js';

console.log('====================================================');
console.log('TEST SUITE: APP-AUR Positioning Beside BHS and GB3');
console.log('====================================================\n');

// 1. Check getCanonicalSiteSortIndex values
const bhsIndex = getCanonicalSiteSortIndex('APP BHS');
const aurDashIndex = getCanonicalSiteSortIndex('APP-AUR');
const aurSpaceIndex = getCanonicalSiteSortIndex('APP AUR');
const gb3Index = getCanonicalSiteSortIndex('APP GB3');

assert.strictEqual(bhsIndex, 0, 'APP BHS index is 0');
assert.strictEqual(aurDashIndex, 0.5, 'APP-AUR index is 0.5');
assert.strictEqual(aurSpaceIndex, 0.5, 'APP AUR index is 0.5');
assert.strictEqual(gb3Index, 1, 'APP GB3 index is 1');

assert(bhsIndex < aurDashIndex && aurDashIndex < gb3Index, 'APP-AUR must sit strictly between APP BHS and APP GB3');
console.log('  ✓ PASS: getCanonicalSiteSortIndex places APP-AUR (0.5) strictly between APP BHS (0) and APP GB3 (1)');

// 2. Test sorting in resolveMergedActiveServiceSites
const mockSitesWithAur = [
  ...CANONICAL_SITE_LIST.map((s, idx) => ({ ...s, id: `site-${idx + 1}`, region: resolveSafeRegion(s.code, ''), is_dc: false, is_active: true })),
  { id: 'site-aur', code: 'APP-AUR', name: 'MOBILECARE - APP SM AURA', region: 'Metro Manila', is_dc: false, is_active: true }
];

const merged = resolveMergedActiveServiceSites(mockSitesWithAur);
const codes = merged.map(s => s.code);

const idxBhs = codes.indexOf('APP BHS');
const idxAur = codes.indexOf('APP-AUR');
const idxGb3 = codes.indexOf('APP GB3');

assert(idxBhs !== -1, 'APP BHS must be present');
assert(idxAur !== -1, 'APP-AUR must be present');
assert(idxGb3 !== -1, 'APP GB3 must be present');

assert.strictEqual(idxAur, idxBhs + 1, 'APP-AUR must be immediately next to APP BHS');
assert.strictEqual(idxGb3, idxAur + 1, 'APP GB3 must be immediately next to APP-AUR');

console.log(`  ✓ PASS: Column order verified: [${codes.slice(0, 5).join(', ')}]`);
console.log(`    Position 0: ${codes[0]} (APP BHS)`);
console.log(`    Position 1: ${codes[1]} (APP-AUR) <-- Directly beside BHS and GB3!`);
console.log(`    Position 2: ${codes[2]} (APP GB3)`);

// 3. Test resolveSiteBranchCode
assert.strictEqual(resolveSiteBranchCode({ code: 'APP-AUR', name: 'MOBILECARE - APP SM AURA' }), 'APP AUR');
console.log('  ✓ PASS: resolveSiteBranchCode returns APP AUR');

// 4. Test resolvePmgSiteFolderName
assert.strictEqual(resolvePmgSiteFolderName({ code: 'APP-AUR', name: 'MOBILECARE - APP SM AURA' }), 'AURA');
console.log('  ✓ PASS: resolvePmgSiteFolderName returns AURA');

console.log('\n====================================================');
console.log('ALL APP-AUR POSITIONING TESTS PASSED (100%)!');
console.log('====================================================\n');
