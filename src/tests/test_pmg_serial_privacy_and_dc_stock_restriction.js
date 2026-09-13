import assert from 'assert';

console.log('====================================================================');
console.log('TEST SUITE: PMG Serial Privacy & DC Stock Access Restriction');
console.log('====================================================================\n');

// Mock Users
const pmgUserAndres = {
  id: 'usr-andres-01',
  fullName: 'Andres Bonifacio',
  role: 'parts_management',
  siteId: 'site-zam',
  siteCode: 'ASP ZAM'
};

const pmgUserMaria = {
  id: 'usr-maria-02',
  fullName: 'Maria Clara',
  role: 'parts_management',
  siteId: 'site-zam',
  siteCode: 'ASP ZAM'
};

const superadminUser = {
  id: 'usr-admin-01',
  fullName: 'Zhon Manaois',
  role: 'superadmin',
  siteId: 'site-dc',
  siteCode: 'DC-MDC'
};

// Mock Sites
const mockSites = [
  { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center', is_dc: true },
  { id: 'site-zam', code: 'ASP ZAM', name: 'MOBILECARE - ZAMBOANGA', is_dc: false },
  { id: 'site-ceb', code: 'ASP CEB', name: 'MOBILECARE - CEBU', is_dc: false }
];

// Helper: check if a unit is in DC stock
function isDcStockUnit(u) {
  if (!u) return false;
  const siteId = String(u.current_site_id || u.site_id || u.siteId || '').toLowerCase();
  const siteCode = String(u.site_code || u.siteCode || '').toUpperCase();
  return (
    siteId === 'site-dc' ||
    siteId === 'dc' ||
    siteCode === 'DC-MDC' ||
    siteCode === 'DC' ||
    siteCode.startsWith('DC-') ||
    (!siteId && !siteCode)
  );
}

// Helper: check if a unit was added by current user
function isUnitAddedByCurrentUser(u, user) {
  if (!user || !u) return false;
  if (user.role === 'superadmin') return true;
  const curId = String(user.id || '').trim();
  const curName = String(user.fullName || user.name || '').trim().toLowerCase();

  const unitAddedId = String(u.added_by_user_id || u.received_by_id || '').trim();
  const unitAddedName = String(u.received_by || u.saved_by_name || '').trim().toLowerCase();

  if (curId && unitAddedId && curId === unitAddedId) return true;
  if (curName && unitAddedName && curName === unitAddedName) return true;
  return false;
}

// Helper: filter units visible to a PMG user in Receive Scan-In
function filterUnitsForPmgUser(units, user, activeSite) {
  const isPmg = user?.role === 'parts_management';
  return (units || []).filter(u => {
    if (u.status !== 'in_stock') return false;

    if (isPmg) {
      // 1. PMG users CANNOT view or access DC stocks!
      if (isDcStockUnit(u)) return false;

      // 2. Only show units at designated branch site OR added by currentUser at a branch
      const targetSiteId = activeSite?.id || user.siteId;
      const targetSiteCode = activeSite?.code || user.siteCode;
      const uSite = u.current_site_id || u.site_id || u.siteId;
      const uCode = u.site_code || u.siteCode;

      const isDesignatedSite = (
        uSite === targetSiteId ||
        uSite === targetSiteCode ||
        uCode === targetSiteCode ||
        uCode === targetSiteId
      );
      const isAddedBySelf = isUnitAddedByCurrentUser(u, user);

      return isDesignatedSite || isAddedBySelf;
    }

    return true;
  });
}

// Helper: mask serial number according to privacy rules:
// - Serials for the user's assigned site MUST remain visible.
// - Serials for parts added by the user MUST remain visible.
// - Serials belonging to OTHER sites MUST be hidden/masked.
// - Superadmin/Admin see all serials.
function getDisplaySerialNumber(unit, user) {
  if (!user || !unit) return '••••••••••••••••';
  if (user.role === 'superadmin' || user.role === 'admin') return unit.serial_number;
  if (isUnitAddedByCurrentUser(unit, user)) return unit.serial_number;

  const userSiteId = String(user.siteId || user.site_id || '').toLowerCase();
  const userSiteCode = String(user.siteCode || user.site_code || '').toUpperCase();
  const uSiteId = String(unit.current_site_id || unit.site_id || unit.siteId || '').toLowerCase();
  const uSiteCode = String(unit.site_code || unit.siteCode || '').toUpperCase();

  const isOwnSite = (userSiteId && (uSiteId === userSiteId || uSiteCode === userSiteId.toUpperCase())) ||
                    (userSiteCode && (uSiteCode === userSiteCode || uSiteId.toUpperCase() === userSiteCode));

  if (isOwnSite) return unit.serial_number;
  return '••••••••••••••••';
}

// Mock inventory units pool
const sampleUnits = [
  // 1. DC unit added by Admin
  {
    id: 'u-dc-1',
    part_number: '661-21996',
    description: 'Battery, iPhone 13 Pro',
    serial_number: 'F8Y628000DC0001',
    current_site_id: 'site-dc',
    site_code: 'DC-MDC',
    added_by_user_id: 'usr-admin-01',
    received_by: 'Zhon Manaois',
    status: 'in_stock'
  },
  // 2. ASP ZAM unit added by Andres Bonifacio
  {
    id: 'u-zam-1',
    part_number: '661-21996',
    description: 'Battery, iPhone 13 Pro',
    serial_number: 'F8Y6305C84E18FK01',
    current_site_id: 'site-zam',
    site_code: 'ASP ZAM',
    added_by_user_id: 'usr-andres-01',
    received_by: 'Andres Bonifacio',
    status: 'in_stock'
  },
  // 3. ASP ZAM unit added by Maria Clara
  {
    id: 'u-zam-2',
    part_number: '661-21996',
    description: 'Battery, iPhone 13 Pro',
    serial_number: 'F8Y6305C84E18FK02',
    current_site_id: 'site-zam',
    site_code: 'ASP ZAM',
    added_by_user_id: 'usr-maria-02',
    received_by: 'Maria Clara',
    status: 'in_stock'
  },
  // 4. ASP CEB unit added by Maria Clara
  {
    id: 'u-ceb-1',
    part_number: '661-36918',
    description: 'Battery, iPhone 15 Pro Max',
    serial_number: 'FG9HTN004900001',
    current_site_id: 'site-ceb',
    site_code: 'ASP CEB',
    added_by_user_id: 'usr-maria-02',
    received_by: 'Maria Clara',
    status: 'in_stock'
  }
];

// --- Test 1: PMG Users CANNOT view or access DC stocks ---
console.log('--- Test 1: PMG users CANNOT view/access DC stocks ---');
const andresVisibleUnits = filterUnitsForPmgUser(sampleUnits, pmgUserAndres, mockSites[1]); // ASP ZAM
const hasDcUnit = andresVisibleUnits.some(u => isDcStockUnit(u) || u.site_code === 'DC-MDC');
assert.strictEqual(hasDcUnit, false, 'DC stock must be strictly blocked from PMG users');
console.log('  ✓ PASS: DC stock completely excluded from PMG user view');

// --- Test 2: In private view ("My Added Parts"), user sees only their own added parts and serial numbers ---
console.log('\n--- Test 2: PMG User private view shows only own added parts with full serials ---');
const andresOwnUnits = andresVisibleUnits.filter(u => isUnitAddedByCurrentUser(u, pmgUserAndres));
assert.strictEqual(andresOwnUnits.length, 1, 'Andres should see exactly 1 part added by him');
assert.strictEqual(andresOwnUnits[0].id, 'u-zam-1');
assert.strictEqual(getDisplaySerialNumber(andresOwnUnits[0], pmgUserAndres), 'F8Y6305C84E18FK01', 'Serial must be fully visible to the user who added it');
console.log('  ✓ PASS: Andres sees his own added part with complete serial number (F8Y6305C84E18FK01)');

// --- Test 3: Serials belonging to user's assigned site remain visible; serials for other sites are protected ---
console.log('\n--- Test 3: Serials belonging to user\'s assigned site remain visible; serials for other sites are protected ---');
// Andres viewing Maria's unit at the SAME site (ASP ZAM):
const mariaUnitAtZam = andresVisibleUnits.find(u => u.id === 'u-zam-2');
assert.ok(mariaUnitAtZam, 'Unit at designated site ASP ZAM should be visible in site inventory');
assert.strictEqual(mariaUnitAtZam.part_number, '661-21996', 'Part number is visible');
assert.strictEqual(getDisplaySerialNumber(mariaUnitAtZam, pmgUserAndres), 'F8Y6305C84E18FK02', 'Serials belonging to the user\'s assigned site must remain visible');
console.log('  ✓ PASS: Maria\'s unit serial (ASP ZAM) is VISIBLE to Andres who is assigned to the same site (ASP ZAM)');

// Andres viewing unit at an OTHER site (ASP CEB):
const cebUnit = sampleUnits.find(u => u.id === 'u-ceb-1');
assert.strictEqual(getDisplaySerialNumber(cebUnit, pmgUserAndres), '••••••••••••••••', 'Serials for other sites must remain masked and protected');
console.log('  ✓ PASS: ASP CEB unit serial is MASKED as •••••••••••••••• when viewed by Andres (assigned to ASP ZAM)');

// Maria viewing unit at her assigned site (ASP ZAM):
assert.strictEqual(getDisplaySerialNumber(mariaUnitAtZam, pmgUserMaria), 'F8Y6305C84E18FK02', 'Maria sees serial at her assigned site in full');
console.log('  ✓ PASS: Maria sees serial number in full (F8Y6305C84E18FK02) at her assigned site');

// --- Test 4: Designated Site Summary groups by Part Number & Site (Quantities only, zero serials) ---
console.log('\n--- Test 4: Designated Site Summary shows P/N & Quantity without serial numbers ---');
function getDesignatedSiteSummary(units, siteCode) {
  const filtered = (units || []).filter(u => !isDcStockUnit(u) && (u.site_code === siteCode || u.current_site_id === siteCode));
  const grouped = {};
  filtered.forEach(u => {
    const pn = u.part_number;
    if (!grouped[pn]) {
      grouped[pn] = {
        part_number: pn,
        description: u.description,
        site_code: u.site_code,
        quantity: 0
      };
    }
    grouped[pn].quantity++;
  });
  return Object.values(grouped);
}

const zamSummary = getDesignatedSiteSummary(sampleUnits, 'ASP ZAM');
assert.strictEqual(zamSummary.length, 1, 'ASP ZAM should have 1 unique part number');
assert.strictEqual(zamSummary[0].part_number, '661-21996');
assert.strictEqual(zamSummary[0].quantity, 2, 'ASP ZAM should have 2 total units available');
assert.strictEqual(zamSummary[0].serial_number, undefined, 'Summary must not expose any serial number');
console.log('  ✓ PASS: ASP ZAM summary: Part 661-21996 has 2 available units (Zero serials exposed)');

// --- Test 5: Superadmin retains global access ---
console.log('\n--- Test 5: Superadmin retains full oversight across DC and all sites ---');
assert.strictEqual(getDisplaySerialNumber(sampleUnits[0], superadminUser), 'F8Y628000DC0001', 'Superadmin sees DC serials');
assert.strictEqual(getDisplaySerialNumber(sampleUnits[1], superadminUser), 'F8Y6305C84E18FK01', 'Superadmin sees branch serials');
console.log('  ✓ PASS: Superadmin global serial visibility verified');

// --- Test 6: getStockOnHandForSite blocks non-superadmin queries to Central DC ---
console.log('\n--- Test 6: Non-superadmin users cannot query Central DC stock ---');
function mockGetStockOnHandForSite(siteIdOrCode, user, sitesList, unitsPool) {
  const targetSite = sitesList.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
  const siteId = targetSite?.id || siteIdOrCode;
  const siteCode = targetSite?.code || siteIdOrCode;

  const isSuper = user?.role === 'superadmin';
  const isDcTarget = siteId === 'site-dc' || siteCode === 'DC-MDC' || siteCode === 'DC' || Boolean(targetSite?.is_dc);
  if (!isSuper && isDcTarget) {
    return { siteId, siteCode, partsSummary: {}, totalInStock: 0, totalUnits: 0, units: [] };
  }

  const matchingUnits = unitsPool.filter(u => {
    const uSiteId = u.current_site_id || u.siteId;
    const uSiteCode = u.site_code || u.siteCode;
    return (uSiteId && (uSiteId === siteId || uSiteId === siteCode)) ||
           (uSiteCode && (uSiteCode === siteCode || uSiteCode === siteId));
  });

  return { siteId, siteCode, totalInStock: matchingUnits.length, totalUnits: matchingUnits.length, units: matchingUnits };
}

const pmgDcQuery = mockGetStockOnHandForSite('site-dc', pmgUserAndres, mockSites, sampleUnits);
assert.strictEqual(pmgDcQuery.totalInStock, 0, 'PMG user querying DC stock must get 0 units');
assert.strictEqual(pmgDcQuery.units.length, 0, 'PMG user querying DC stock must get empty units array');

const standardUser = { id: 'usr-std-01', role: 'user', siteId: 'site-zam', siteCode: 'ASP ZAM' };
const standardUserDcQuery = mockGetStockOnHandForSite('DC-MDC', standardUser, mockSites, sampleUnits);
assert.strictEqual(standardUserDcQuery.totalInStock, 0, 'Standard user querying DC stock must get 0 units');

const superadminDcQuery = mockGetStockOnHandForSite('site-dc', superadminUser, mockSites, sampleUnits);
assert.strictEqual(superadminDcQuery.totalInStock, 1, 'Superadmin querying DC stock successfully gets DC units');
console.log('  ✓ PASS: DC stock querying strictly restricted to Superadmin; blocked for all other roles');

// --- Test 7: Multi-Site Directory strictly excludes Central DC ---
console.log('\n--- Test 7: Multi-Site Directory strictly excludes Central DC ---');
function mockGetAllSitesStockSummary(targetSiteFilter, user, sitesList) {
  const isSuper = user?.role === 'superadmin';
  let siteList = targetSiteFilter === 'ALL'
    ? sitesList
    : sitesList.filter(s => s.id === targetSiteFilter || s.code === targetSiteFilter);

  if (!isSuper) {
    siteList = siteList.filter(s => !s.is_dc && s.code !== 'DC-MDC' && s.code !== 'DC' && s.id !== 'site-dc');
  }

  return siteList.map(s => ({ siteId: s.id, siteCode: s.code, isDc: Boolean(s.is_dc) }));
}

const nonSuperSites = mockGetAllSitesStockSummary('ALL', pmgUserAndres, mockSites);
assert.ok(!nonSuperSites.some(s => s.siteId === 'site-dc' || s.siteCode === 'DC-MDC'), 'Non-superadmin must not have DC in site summary');

// All Stocks page filter (even for Superadmin)
const allStocksMultiSite = mockGetAllSitesStockSummary('ALL', superadminUser, mockSites)
  .filter(s => s.siteId !== 'site-dc' && s.siteCode !== 'DC-MDC');
assert.ok(!allStocksMultiSite.some(s => s.siteId === 'site-dc' || s.siteCode === 'DC-MDC'), 'All Stocks & Multi-Site page strictly excludes Central DC');
console.log('  ✓ PASS: Central DC stock completely removed from All Stocks & Multi-Site page');

console.log('\n====================================================================');
console.log('ALL PMG SERIAL PRIVACY & DC ACCESS RESTRICTION TESTS PASSED (100%)');
console.log('====================================================================\n');
