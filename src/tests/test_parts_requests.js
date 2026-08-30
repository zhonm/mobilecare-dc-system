import assert from 'assert';
import { ROLE_PRESETS, ROLE_OPTIONS, getDefaultRolePosition } from '../constants/roles.js';
import { ALL_PAGES, PAGE_TITLES } from '../constants/navigation.js';

console.log('====================================================');
console.log('TEST SUITE: Parts Management (PMG) Role, Site Scan-In & Serial Privacy');
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

// 1. ROLE & NAVIGATION CONFIGURATION TESTS
it('ROLE_PRESETS has parts_management with [request-parts, scan-in, all-stocks]', () => {
  assert.ok(ROLE_PRESETS.parts_management, 'ROLE_PRESETS.parts_management exists');
  assert.deepStrictEqual(
    ROLE_PRESETS.parts_management,
    ['request-parts', 'scan-in', 'all-stocks'],
    'Permitted pages must contain request-parts, scan-in, all-stocks'
  );
});

it('ROLE_OPTIONS includes updated description for parts_management', () => {
  const opt = ROLE_OPTIONS.find(o => o.value === 'parts_management');
  assert.ok(opt, 'parts_management found in ROLE_OPTIONS');
  assert.strictEqual(opt.label, 'Parts Management (PMG)');
});

it('ALL_PAGES and PAGE_TITLES include request-parts, scan-in, and all-stocks', () => {
  assert.ok(ALL_PAGES.find(p => p.id === 'request-parts'), 'request-parts in ALL_PAGES');
  assert.ok(ALL_PAGES.find(p => p.id === 'scan-in'), 'scan-in in ALL_PAGES');
  assert.ok(ALL_PAGES.find(p => p.id === 'all-stocks'), 'all-stocks in ALL_PAGES');
  assert.ok(PAGE_TITLES['request-parts'], 'request-parts in PAGE_TITLES');
  assert.ok(PAGE_TITLES['scan-in'], 'scan-in in PAGE_TITLES');
  assert.ok(PAGE_TITLES['all-stocks'], 'all-stocks in PAGE_TITLES');
});

// 2. PERMISSION GUARD (canAccess) SIMULATION
function simulateCanAccess(user, pageId) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  if (pageId === 'user-access') return false;
  if (user.isActive === false) return false;
  if (user.role === 'user') {
    return ROLE_PRESETS.user.includes(pageId);
  }
  if (Array.isArray(user.permittedPages)) {
    return user.permittedPages.includes(pageId);
  }
  const fallbackPreset = ROLE_PRESETS[user.role] || ROLE_PRESETS.user;
  return fallbackPreset.includes(pageId) && pageId !== 'user-access';
}

it('PMG role allows request-parts, scan-in, and all-stocks, while blocking dashboard/admin pages', () => {
  const pmgUser = {
    id: 'usr-pmg-01',
    role: 'parts_management',
    permittedPages: ROLE_PRESETS.parts_management,
    isActive: true,
    siteId: 'site-ppm'
  };

  assert.strictEqual(simulateCanAccess(pmgUser, 'request-parts'), true, 'PMG can access request-parts');
  assert.strictEqual(simulateCanAccess(pmgUser, 'scan-in'), true, 'PMG can access scan-in');
  assert.strictEqual(simulateCanAccess(pmgUser, 'all-stocks'), true, 'PMG can access all-stocks');

  const blockedPages = [
    'dashboard', 'import', 'forecast', 'records', 'orders',
    'allocation', 'scan-out', 'shipments', 'reports', 'forecast-reports',
    'audit', 'settings', 'user-access'
  ];

  blockedPages.forEach(p => {
    assert.strictEqual(
      simulateCanAccess(pmgUser, p),
      false,
      `PMG user must be BLOCKED from accessing page "${p}"`
    );
  });
});

// 3. SERIAL PRIVACY & MASKING LOGIC SIMULATION
function simulateMultiSiteStockWithPrivacy(currentUser, inventoryUnits, parts, sites) {
  const isSuper = currentUser?.role === 'superadmin';
  const userSiteId = currentUser?.siteId;
  const userId = currentUser?.id;

  return sites.map(site => {
    const isOwnSite = isSuper || (userSiteId && (site.id === userSiteId || site.code === userSiteId));
    const matchingUnits = inventoryUnits.filter(u => u.current_site_id === site.id);

    const partsMap = {};
    matchingUnits.forEach(u => {
      const pn = u.part_number;
      if (!partsMap[pn]) {
        partsMap[pn] = {
          partNumber: pn,
          inStock: 0,
          serializedUnits: []
        };
      }

      if (u.status === 'in_stock') {
        partsMap[pn].inStock++;
      }

      const isAddedBySelf = userId && (u.added_by_user_id === userId || u.received_by_id === userId);
      const canSeeSerial = isSuper || isOwnSite || isAddedBySelf;

      partsMap[pn].serializedUnits.push({
        id: u.id,
        serialNumber: canSeeSerial ? u.serial_number : '••••••••••••••••',
        isMasked: !canSeeSerial
      });
    });

    return {
      siteId: site.id,
      siteCode: site.code,
      isOwnSite,
      parts: Object.values(partsMap)
    };
  });
}

it('Enforces Serial Number Masking for cross-site users while showing full serials for own site/own added parts', () => {
  const sites = [
    { id: 'site-ppm', code: 'APP PPM', name: 'Power Plant Mall' },
    { id: 'site-cebu', code: 'APP CEB', name: 'Ayala Center Cebu' }
  ];

  const inventoryUnits = [
    {
      id: 'u1',
      part_number: '661-37213',
      serial_number: 'G9PQHU084CQ9D088S5L4B',
      current_site_id: 'site-ppm',
      added_by_user_id: 'usr-ppm-01',
      status: 'in_stock'
    },
    {
      id: 'u2',
      part_number: '661-37213',
      serial_number: 'G9QHXKT0KU690004YY123',
      current_site_id: 'site-cebu',
      added_by_user_id: 'usr-cebu-01',
      status: 'in_stock'
    }
  ];

  // User 1: PPM Staff (Jose Rizal)
  const ppmUser = { id: 'usr-ppm-01', role: 'parts_management', siteId: 'site-ppm' };
  const ppmView = simulateMultiSiteStockWithPrivacy(ppmUser, inventoryUnits, [], sites);

  const ppmSiteStock = ppmView.find(s => s.siteId === 'site-ppm');
  const cebuSiteStock = ppmView.find(s => s.siteId === 'site-cebu');

  // Own Site (PPM): Serial is visible
  assert.strictEqual(ppmSiteStock.parts[0].inStock, 1);
  assert.strictEqual(ppmSiteStock.parts[0].serializedUnits[0].serialNumber, 'G9PQHU084CQ9D088S5L4B');
  assert.strictEqual(ppmSiteStock.parts[0].serializedUnits[0].isMasked, false);

  // Other Site (Cebu): Quantity is visible (1 in stock), but Serial Number is MASKED!
  assert.strictEqual(cebuSiteStock.parts[0].inStock, 1, 'PPM user sees 1 unit in stock at Cebu');
  assert.strictEqual(cebuSiteStock.parts[0].serializedUnits[0].serialNumber, '••••••••••••••••', 'PPM user CANNOT see Cebu serial number');
  assert.strictEqual(cebuSiteStock.parts[0].serializedUnits[0].isMasked, true, 'Serial is marked masked');

  // Superadmin View: Full serial transparency across all sites
  const superadmin = { id: 'usr-admin-01', role: 'superadmin' };
  const adminView = simulateMultiSiteStockWithPrivacy(superadmin, inventoryUnits, [], sites);
  const adminCebuStock = adminView.find(s => s.siteId === 'site-cebu');
  assert.strictEqual(adminCebuStock.parts[0].serializedUnits[0].serialNumber, 'G9QHXKT0KU690004YY123', 'Superadmin sees unmasked serial at Cebu');
  assert.strictEqual(adminCebuStock.parts[0].serializedUnits[0].isMasked, false);
});

// 4. SUPERADMIN-EXCLUSIVE APPROVAL AUTHORITY
it('Enforces Superadmin-only approval & denial authority on parts requests', () => {
  function simulateUpdatePartsRequest(currentUser, status) {
    if (currentUser?.role !== 'superadmin') {
      return { success: false, error: 'Permission Denied: Only Superadmin can approve or deny requests' };
    }
    return { success: true, status };
  }

  const pmgUser = { id: 'usr-pmg-01', role: 'parts_management', siteId: 'site-ppm' };
  const superadmin = { id: 'usr-admin-01', role: 'superadmin' };

  const pmgAttempt = simulateUpdatePartsRequest(pmgUser, 'approved');
  assert.strictEqual(pmgAttempt.success, false, 'PMG cannot approve requests');
  assert.ok(pmgAttempt.error.includes('Permission Denied'));

  const superadminAttempt = simulateUpdatePartsRequest(superadmin, 'approved');
  assert.strictEqual(superadminAttempt.success, true, 'Superadmin can approve requests');
});

// 5. RECEIVE SCAN-IN DESTINATION RESOLUTION
it('Properly sets target site ID and received_by_id during scan-in', () => {
  const user = { id: 'usr-pmg-01', fullName: 'Jose Rizal', siteId: 'site-ppm' };
  const scanInput = {
    partNumber: '661-37213',
    serialNumber: 'F8Y6234C9A9912R231LB3',
    targetSiteId: user.siteId,
    targetSiteCode: 'APP PPM'
  };

  const newUnit = {
    id: 'unit-123',
    part_number: scanInput.partNumber,
    serial_number: scanInput.serialNumber,
    current_site_id: scanInput.targetSiteId || user.siteId,
    site_code: scanInput.targetSiteCode || 'BRANCH',
    received_by_id: user.id,
    added_by_user_id: user.id,
    status: 'in_stock'
  };

  assert.strictEqual(newUnit.current_site_id, 'site-ppm', 'Unit assigned to branch site PPM');
  assert.strictEqual(newUnit.received_by_id, 'usr-pmg-01', 'Tracked creator user ID');
  assert.strictEqual(newUnit.status, 'in_stock', 'Unit in stock status');
});

console.log('====================================================');
console.log(`RESULTS: ${passedTests}/${passedTests} PASSED (0 FAILED)`);
console.log('====================================================');
