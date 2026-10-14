import assert from 'node:assert';

console.log('========================================================================');
console.log('TEST SUITE: Part Number Search & Cross-Site Stock Availability');
console.log('========================================================================\n');

// Mock snapshot items representing serialized inventory across 26 service sites
const mockSnapshotItems = [
  // 661-30401 (Display, iPhone 14 Pro Max)
  { partNumber: '661-30401', description: 'Display, iPhone 14 Pro Max', siteCode: 'ASP ILO', siteName: 'MobileCare - Festive Walk Iloilo', stockType: 'DC_STOCK', agingBracket: 'IN_STOCK' },
  { partNumber: '661-30401', description: 'Display, iPhone 14 Pro Max', siteCode: 'ASP ILO', siteName: 'MobileCare - Festive Walk Iloilo', stockType: 'DC_STOCK', agingBracket: 'IN_STOCK' },
  { partNumber: '661-30401', description: 'Display, iPhone 14 Pro Max', siteCode: 'APP BHS', siteName: 'MobileCare - Bonifacio High Street', stockType: 'DC_STOCK', agingBracket: 'IN_STOCK' },
  { partNumber: '661-30401', description: 'Display, iPhone 14 Pro Max', siteCode: 'DC', siteName: 'MobileCare DC Warehouse', stockType: 'DC_STOCK', agingBracket: 'SLOW_MOVING' },
  { partNumber: '661-30401', description: 'Display, iPhone 14 Pro Max', siteCode: 'DC', siteName: 'MobileCare DC Warehouse', stockType: 'MSPI_OWNED', agingBracket: 'IN_STOCK' },

  // 661-24546 (MLB, MacBook Pro 14")
  { partNumber: '661-24546', description: 'MLB, MacBook Pro 14", Apple M2 Pro, 16GB, 512GB', siteCode: 'APP MOA', siteName: 'MobileCare - Mall of Asia', stockType: 'DC_STOCK', agingBracket: 'IN_STOCK' },
  { partNumber: '661-24546', description: 'MLB, MacBook Pro 14", Apple M2 Pro, 16GB, 512GB', siteCode: 'APP MOA', siteName: 'MobileCare - Mall of Asia', stockType: 'DC_STOCK', agingBracket: 'DEAD_STOCK' },

  // 661-17989 (Battery, iPhone 13)
  { partNumber: '661-17989', description: 'Battery, iPhone 13', siteCode: 'ASP CEB', siteName: 'MobileCare - Cebu', stockType: 'DC_STOCK', agingBracket: 'IN_STOCK' },
];

// Helper mimicking activePartCatalog in FixablyInventoryDashboard.jsx
function buildActivePartCatalog(items = []) {
  const map = new Map();
  items.forEach(it => {
    const pn = String(it.partNumber || '').trim();
    if (!pn) return;
    const cleanPn = pn.toUpperCase();
    if (!map.has(cleanPn)) {
      map.set(cleanPn, {
        partNumber: it.partNumber || cleanPn,
        description: it.description || '',
        totalUnits: 0,
        sitesSet: new Set()
      });
    }
    const entry = map.get(cleanPn);
    entry.totalUnits += 1;
    const site = it.siteCode || it.siteName || '';
    if (site) entry.sitesSet.add(site);
  });

  return Array.from(map.values())
    .map(e => ({ ...e, siteCount: e.sitesSet.size }))
    .sort((a, b) => b.totalUnits - a.totalUnits);
}

// Helper mimicking filteredPartCatalog autocomplete in FixablyInventoryDashboard.jsx
function filterPartCatalog(catalog, input) {
  const raw = String(input || '').trim();
  if (!raw) return catalog.slice(0, 40);
  const q = raw.toUpperCase();
  const qClean = q.replace(/[^A-Z0-9]/g, '');

  return catalog.filter(p => {
    const pn = p.partNumber.toUpperCase();
    const pnClean = pn.replace(/[^A-Z0-9]/g, '');
    const desc = (p.description || '').toUpperCase();
    return pn.includes(q) || (qClean && pnClean.includes(qClean)) || desc.includes(q);
  }).slice(0, 40);
}

// Helper mimicking partStockBySite calculation in FixablyInventoryDashboard.jsx
function computePartStockBySite(items, query) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return null;
  const queryClean = q.replace(/[^A-Z0-9]/g, '');

  const provCodes = new Set(['ABR', 'CDO', 'CEB', 'COT', 'CBO', 'ILO', 'LAN', 'LAU', 'LIM', 'NAG', 'ZAM']);

  const matchingItems = items.filter(it => {
    const itPn = String(it.partNumber || '').trim().toUpperCase();
    const itPnClean = itPn.replace(/[^A-Z0-9]/g, '');
    return itPn === q || (queryClean && itPnClean === queryClean);
  });

  const siteStockMap = new Map();

  matchingItems.forEach(it => {
    const rawSiteCode = String(it.siteCode || '').trim();
    const cleanSiteCode = rawSiteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '');

    if (!siteStockMap.has(cleanSiteCode)) {
      const isProv = provCodes.has(cleanSiteCode);
      siteStockMap.set(cleanSiteCode, {
        siteCode: it.siteCode,
        cleanCode: cleanSiteCode,
        siteName: it.siteName,
        region: isProv ? 'provincial' : 'metro_manila',
        totalUnits: 0,
        dcStockUnits: 0,
        mspiOwnedUnits: 0,
        agingBrackets: { inStock: 0, slow: 0, nonMoving: 0, dead: 0 }
      });
    }

    const sEntry = siteStockMap.get(cleanSiteCode);
    sEntry.totalUnits += 1;
    if (it.stockType === 'DC_STOCK') sEntry.dcStockUnits += 1;
    else sEntry.mspiOwnedUnits += 1;

    if (it.agingBracket === 'IN_STOCK') sEntry.agingBrackets.inStock += 1;
    else if (it.agingBracket === 'SLOW_MOVING') sEntry.agingBrackets.slow += 1;
    else if (it.agingBracket === 'DEAD_STOCK') sEntry.agingBrackets.dead += 1;
  });

  const sitesWithStock = Array.from(siteStockMap.values()).sort((a, b) => b.totalUnits - a.totalUnits);

  return {
    searchedPartNumber: q,
    partDescription: matchingItems[0]?.description || '',
    totalNetworkUnits: matchingItems.length,
    sitesCount: sitesWithStock.length,
    sitesWithStock
  };
}

// 1. Verify Active Part Catalog Compilation
console.log('--- Test 1: Active Part Catalog Aggregation ---');
const catalog = buildActivePartCatalog(mockSnapshotItems);
assert.strictEqual(catalog.length, 3, 'Should aggregate exactly 3 unique part numbers');
assert.strictEqual(catalog[0].partNumber, '661-30401', 'Most stocked part (5 units) should be ranked first');
assert.strictEqual(catalog[0].totalUnits, 5, '661-30401 should have 5 total on-hand units');
assert.strictEqual(catalog[0].siteCount, 3, '661-30401 should be stocked across 3 sites (ILO, BHS, DC)');
console.log('  ✓ PASS: Catalog compiles active part numbers with accurate network on-hand counts');

// 2. Verify Autocomplete Search Filtering
console.log('\n--- Test 2: Autocomplete Dropdown Search Filtering ---');
const matchExact = filterPartCatalog(catalog, '661-30401');
assert.strictEqual(matchExact.length, 1, 'Exact part search should match 1 part');
assert.strictEqual(matchExact[0].partNumber, '661-30401');

const matchDashless = filterPartCatalog(catalog, '66130401');
assert.strictEqual(matchDashless.length, 1, 'Dashless search (66130401) should match 661-30401');

const matchDescription = filterPartCatalog(catalog, 'MacBook');
assert.strictEqual(matchDescription.length, 1, 'Description search "MacBook" should match MLB 661-24546');
assert.strictEqual(matchDescription[0].partNumber, '661-24546');
console.log('  ✓ PASS: Autocomplete matches by part number, dashless format, and description');

// 3. Verify Cross-Site Stock Calculation
console.log('\n--- Test 3: Cross-Site Stock Availability Calculation ---');
const stockResult = computePartStockBySite(mockSnapshotItems, '661-30401');
assert.strictEqual(stockResult.totalNetworkUnits, 5, 'Network units must equal 5');
assert.strictEqual(stockResult.sitesCount, 3, 'Sites count must equal 3');

// Check site breakdowns
const iloSite = stockResult.sitesWithStock.find(s => s.cleanCode === 'ILO');
assert.ok(iloSite, 'ILO must be in sites with stock');
assert.strictEqual(iloSite.totalUnits, 2, 'ILO has 2 units');
assert.strictEqual(iloSite.region, 'provincial', 'ILO is a Provincial site');

const bhsSite = stockResult.sitesWithStock.find(s => s.cleanCode === 'BHS');
assert.ok(bhsSite, 'BHS must be in sites with stock');
assert.strictEqual(bhsSite.totalUnits, 1, 'BHS has 1 unit');
assert.strictEqual(bhsSite.region, 'metro_manila', 'BHS is a Metro Manila site');

const dcSite = stockResult.sitesWithStock.find(s => s.cleanCode === 'DC');
assert.ok(dcSite, 'DC must be in sites with stock');
assert.strictEqual(dcSite.totalUnits, 2, 'DC has 2 units');
assert.strictEqual(dcSite.dcStockUnits, 1, 'DC has 1 DC_STOCK unit');
assert.strictEqual(dcSite.mspiOwnedUnits, 1, 'DC has 1 MSPI_OWNED unit');
console.log('  ✓ PASS: Accurately calculates stocking sites, quantities, regions, and stock types');

// 4. Verify 0-stock Search State
console.log('\n--- Test 4: Zero Stock Part Number Query ---');
const zeroStock = computePartStockBySite(mockSnapshotItems, '661-99999');
assert.strictEqual(zeroStock.totalNetworkUnits, 0, 'Non-existent part should report 0 total units');
assert.strictEqual(zeroStock.sitesCount, 0, 'Non-existent part should report 0 stocking sites');
assert.strictEqual(zeroStock.sitesWithStock.length, 0, 'Sites array must be empty');
console.log('  ✓ PASS: Correctly handles parts with zero availability across all sites');

console.log('\n========================================================================');
console.log('ALL PART NUMBER CROSS-SITE SEARCH TESTS PASSED (100%)');
console.log('========================================================================\n');
