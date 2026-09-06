import assert from 'assert';
import {
  getActiveMasterlist,
  getMasterlistSummary,
  getMasterlistSites,
  isPeriodMatching,
  isPeriodMonth
} from '../utils/rawMasterlistScanner.js';

console.log('====================================================');
console.log('TEST SUITE: Cross-Browser Period & Masterlist Parity');
console.log('====================================================');

async function runTests() {
  // ── TEST 1: Period matching helpers ──
  assert.strictEqual(isPeriodMonth('August 2026', 8, 'aug'), true, 'August 2026 matches month 8');
  assert.strictEqual(isPeriodMonth({ month: 8, year: 2026, label: 'August 2026' }, 8, 'aug'), true, 'August obj matches month 8');
  assert.strictEqual(isPeriodMonth('September 2026', 9, 'sep'), true, 'September 2026 matches month 9');
  assert.strictEqual(isPeriodMonth({ month: 9, year: 2026, label: 'September 2026' }, 9, 'sep'), true, 'September obj matches month 9');

  assert.strictEqual(isPeriodMatching('August 2026', 'August 2026'), true, 'August matches August');
  assert.strictEqual(isPeriodMatching('September 2026', 'August 2026'), false, 'September does NOT match August');
  assert.strictEqual(isPeriodMatching('August 2026', { month: 8, year: 2026, label: 'August 2026' }), true, 'August matches August obj');
  assert.strictEqual(isPeriodMatching('September 2026', { month: 8, year: 2026, label: 'August 2026' }), false, 'September does NOT match August obj');
  console.log('  ✓ PASS: Period matching and month detection functions work correctly');

  // ── TEST 2: August 2026 Period Resolution (Matching Safari screenshot) ──
  const augSummary = getMasterlistSummary(null, 'August 2026');
  const augSites = getMasterlistSites({ limit: 'ALL' }, null, 'August 2026');

  assert.strictEqual(augSummary.totalUnits, 6383, `August total units must be 6,383 (got ${augSummary.totalUnits})`);
  assert.strictEqual(augSummary.totalDistinctParts, 375, `August SKUs must be 375 (got ${augSummary.totalDistinctParts})`);
  assert.strictEqual(augSummary.totalSites, 26, `August hubs must be 26 (got ${augSummary.totalSites})`);
  assert.strictEqual(augSites.topSite.shortName, 'NEWPOINT MALL', 'August top site must be NEWPOINT MALL');
  assert.strictEqual(augSites.topSite.totalUnits, 673, `August NEWPOINT MALL units must be 673 (got ${augSites.topSite.totalUnits})`);
  console.log('  ✓ PASS: August 2026 period returns authoritative 6,383 units, 375 SKUs, 26 hubs, NEWPOINT MALL (673 units)');

  // ── TEST 3: September 2026 Period Resolution (Matching Edge September screenshot) ──
  const sepData = getActiveMasterlist(null, 'September 2026');
  const sepSummary = getMasterlistSummary(null, 'September 2026');
  const sepSites = getMasterlistSites({ limit: 'ALL' }, null, 'September 2026');

  assert.strictEqual(sepSummary.totalUnits, 7611, `September total units must be 7,611 (got ${sepSummary.totalUnits})`);
  assert.strictEqual(sepSummary.totalDistinctParts, 395, `September SKUs must be 395 (got ${sepSummary.totalDistinctParts})`);
  assert.strictEqual(sepSummary.totalSites, 27, `September hubs must be 27 (got ${sepSummary.totalSites})`);
  assert.strictEqual(sepSites.topSite.shortName, 'NEWPOINT MALL', 'September top site must be NEWPOINT MALL');
  assert.strictEqual(sepSites.topSite.totalUnits, 784, `September NEWPOINT MALL units must be 784 (got ${sepSites.topSite.totalUnits})`);
  console.log('  ✓ PASS: September 2026 period returns authoritative 7,611 units, 395 SKUs, 27 hubs, NEWPOINT MALL (784 units)');

  // ── TEST 4: Cross-Browser Parity (Edge with stale September cache viewing August) ──
  // Edge had September dataset loaded in cache or memory, but the activePeriod is August 2026:
  const mockStaleEdgeMasterlist = {
    periodLabel: 'September 2026',
    totalUnits: 7611,
    totalDistinctParts: 395,
    totalSites: 27,
    partsSummary: sepData.partsSummary,
    sites: sepData.sites
  };

  // When activePeriod is August 2026, getActiveMasterlist MUST ignore the stale September masterlist and return August
  const resolvedForEdge = getActiveMasterlist(mockStaleEdgeMasterlist, { month: 8, year: 2026, label: 'August 2026' });
  assert.strictEqual(resolvedForEdge.totalUnits, 6383, `Edge viewing August MUST resolve to 6,383 units, not 7,611 (got ${resolvedForEdge.totalUnits})`);
  assert.strictEqual(resolvedForEdge.totalDistinctParts, 375, 'SKUs must be 375');
  assert.strictEqual(resolvedForEdge.sites.length, 26, 'Hubs must be 26');
  console.log('  ✓ PASS: Stale cross-period cache ignored; Edge viewing August displays 6,383 units identically to Safari');

  // ── TEST 5: Custom uploaded masterlist for another month (e.g., October 2026) ──
  const customOctMasterlist = {
    periodLabel: 'October 2026',
    totalUnits: 8120,
    totalDistinctParts: 410,
    totalSites: 28,
    partsSummary: [{ part_number: '661-21991', totalUnits: 1400, totalValUSD: 140000, siteDistribution: {} }],
    sites: [{ siteName: 'MOBILECARE - NEWPOINT MALL', shortName: 'NEWPOINT MALL', totalUnits: 850, totalValUSD: 85000, allParts: [] }]
  };

  const resolvedOct = getActiveMasterlist(customOctMasterlist, { month: 10, year: 2026, label: 'October 2026' });
  assert.strictEqual(resolvedOct.totalUnits, 8120, 'Matching October custom masterlist is preserved for October period');
  console.log('  ✓ PASS: Custom uploaded masterlists correctly match their respective active period');

  console.log('====================================================');
  console.log('ALL CROSS-BROWSER PERIOD PARITY TESTS PASSED (100%)');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
