import assert from 'node:assert';
import { resolveMergedActiveServiceSites, CANONICAL_SITE_LIST } from '../utils/excelParser.js';
import {
  generateAllocationsFromForecasts,
  calculateWeeklySiteAllocations,
  resolvePartSiteDemands,
  validateSiteSharesConsistency
} from '../utils/allocationEngine.js';
import { resolvePmgSiteFolderName } from '../services/driveAutoSyncService.js';
import { resolveSiteBranchCode } from '../utils/shipmentHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Dynamic Site Addition & Non-Static Expansion');
console.log('====================================================\n');

// Mock a live list of sites that includes a new site added by Superadmin in the future
const customNewSite1 = {
  id: 'site-tar',
  code: 'ASP TAR',
  name: 'MOBILECARE - TARLAC',
  region: 'Central Luzon',
  address: 'SM City Tarlac, MacArthur Highway, Tarlac City',
  is_dc: false,
  is_active: true
};

const customNewSite2 = {
  id: 'site-sub',
  code: 'APP SUB',
  name: 'MOBILECARE - SUBIC',
  region: 'Zambales',
  address: 'Harbor Point Subic, Olongapo City',
  is_dc: false,
  is_active: true
};

const liveSitesWithNewBranches = [
  ...CANONICAL_SITE_LIST.map((s, idx) => ({ ...s, id: `site-${idx + 1}`, is_dc: false })),
  customNewSite1,
  customNewSite2
];

// 1. Verify resolveMergedActiveServiceSites dynamically includes new sites
console.log('Test 1: Verify resolveMergedActiveServiceSites dynamically merges canonical + new sites');
const mergedSites = resolveMergedActiveServiceSites(liveSitesWithNewBranches);
assert.strictEqual(mergedSites.length, 28, 'Merged sites should have 26 canonical + 2 new sites = 28');
assert(mergedSites.some(s => s.code === 'ASP TAR'), 'New site ASP TAR must be present in merged sites');
assert(mergedSites.some(s => s.code === 'APP SUB'), 'New site APP SUB must be present in merged sites');
console.log(`  ✓ PASS: Merged active service sites count is ${mergedSites.length} (includes ASP TAR and APP SUB)`);

// 2. Verify validateSiteSharesConsistency accepts dynamic sites
console.log('\nTest 2: Verify validateSiteSharesConsistency does not fail on added branches');
const validation = validateSiteSharesConsistency(mergedSites);
assert.strictEqual(validation.isValid, true, 'Consistency check must pass when activeCount >= expectedCount');
assert.strictEqual(validation.activeCount, 28, 'Active count should reflect 28 sites');
console.log('  ✓ PASS: validateSiteSharesConsistency accepts 28 active sites seamlessly');

// 3. Verify resolvePartSiteDemands allocates demand to new sites
console.log('\nTest 3: Verify resolvePartSiteDemands handles custom new sites');
const testForecastItem = {
  part_id: 'part-display-13',
  part_number: '661-21988',
  description: 'Display, iPhone 13',
  site_quantities: {
    'ASP TAR': 5,
    'APP SUB': 3
  }
};
const demands = resolvePartSiteDemands(testForecastItem, mergedSites);
assert.strictEqual(demands.length, 28, 'Demands array should cover all 28 sites');
const tarDemand = demands.find(d => d.siteId === 'site-tar');
assert(tarDemand, 'ASP TAR must have a demand entry');
console.log('  ✓ PASS: Demands array successfully resolves for all 28 sites including new branches');

// 4. Verify generateAllocationsFromForecasts dynamically includes new sites
console.log('\nTest 4: Verify generateAllocationsFromForecasts generates allocations for new sites');
const sampleForecasts = [
  {
    part_id: 'part-display-13',
    part_number: '661-21988',
    description: 'Display, iPhone 13',
    final_forecast: 140,
    site_counts: {
      'MOBILECARE - TARLAC': 10,
      'MOBILECARE - SUBIC': 6
    }
  }
];
const generatedAllocs = generateAllocationsFromForecasts(sampleForecasts, mergedSites, 'linear');
assert.strictEqual(generatedAllocs.length, 1);
const allocRow = generatedAllocs[0];
assert(allocRow.site_quantities['ASP TAR'] !== undefined, 'site_quantities must have an entry for ASP TAR');
assert(allocRow.site_quantities['APP SUB'] !== undefined, 'site_quantities must have an entry for APP SUB');
console.log(`  ✓ PASS: Allocations successfully computed for ASP TAR (${allocRow.site_quantities['ASP TAR']}) and APP SUB (${allocRow.site_quantities['APP SUB']})`);

// 5. Verify calculateWeeklySiteAllocations dynamically splits for all sites
console.log('\nTest 5: Verify calculateWeeklySiteAllocations handles 28 sites in alternating weekly split');
const weeklyResult = calculateWeeklySiteAllocations(allocRow, mergedSites, 0);
assert(weeklyResult.week1['site-tar'] !== undefined, 'Week 1 split must include site-tar');
assert(weeklyResult.week2['site-sub'] !== undefined, 'Week 2 split must include site-sub');
console.log('  ✓ PASS: 4-week alternating parity split smoothly incorporates new sites');

// 6. Verify Google Drive Folder Resolution for new sites
console.log('\nTest 6: Verify resolvePmgSiteFolderName dynamically resolves folders for new sites');
const folderTar = resolvePmgSiteFolderName(customNewSite1);
assert.strictEqual(folderTar, 'TARLAC', `Expected TARLAC, got ${folderTar}`);

const folderSub = resolvePmgSiteFolderName(customNewSite2);
assert.strictEqual(folderSub, 'SUBIC', `Expected SUBIC, got ${folderSub}`);

const folderBareString = resolvePmgSiteFolderName('ASP BATANGAS CITY');
assert.strictEqual(folderBareString, 'BATANGAS CITY', `Expected BATANGAS CITY, got ${folderBareString}`);
console.log(`  ✓ PASS: Drive folder names resolved: "${folderTar}", "${folderSub}", "${folderBareString}"`);

// 7. Verify resolveSiteBranchCode resolves branch codes for new sites
console.log('\nTest 7: Verify resolveSiteBranchCode dynamically resolves codes for new sites');
const codeTar = resolveSiteBranchCode(customNewSite1);
assert.strictEqual(codeTar, 'ASP TAR', `Expected ASP TAR, got ${codeTar}`);

const codeSub = resolveSiteBranchCode(customNewSite2);
assert.strictEqual(codeSub, 'APP SUB', `Expected APP SUB, got ${codeSub}`);

const codeByNameOnly = resolveSiteBranchCode({ name: 'MOBILECARE - LUCENA' });
assert.strictEqual(codeByNameOnly, 'ASP LUCENA', `Expected ASP LUCENA, got ${codeByNameOnly}`);
console.log(`  ✓ PASS: Branch codes resolved: "${codeTar}", "${codeSub}", "${codeByNameOnly}"`);

console.log('\n====================================================');
console.log('ALL DYNAMIC SITE EXPANSION TESTS PASSED (7/7)!');
console.log('====================================================\n');
