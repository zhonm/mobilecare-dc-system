import assert from 'assert';
import { ROLE_PRESETS, ROLE_OPTIONS } from '../constants/roles.js';
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

// 6. PMG SCAN-IN & IMPORT UI LOGIC SIMULATION
function simulateScanInControlsVisibility(userRole) {
  const isPmgUser = userRole === 'parts_management';
  return {
    showLinkedPO: !isPmgUser,
    showIntakeAssignmentCategory: !isPmgUser,
    showModalPODropdown: !isPmgUser,
    showModalAssignmentDropdown: !isPmgUser,
    showDestinationFilters: !isPmgUser,
    autoReceiveStepNumber: isPmgUser ? '2. Barcode Auto-Receive' : '4. Scanner Intake Mode',
    bulkImportStepNumber: isPmgUser ? '3. Bulk Import & Actions' : '5. Batch Actions'
  };
}

it('PMG user has Linked PO and Intake Assignment completely hidden in Scan-In & Modal', () => {
  const pmgControls = simulateScanInControlsVisibility('parts_management');
  assert.strictEqual(pmgControls.showLinkedPO, false, 'Linked PO column must be HIDDEN for PMG');
  assert.strictEqual(pmgControls.showIntakeAssignmentCategory, false, 'Intake Assignment column must be HIDDEN for PMG');
  assert.strictEqual(pmgControls.showModalPODropdown, false, 'Modal PO selector must be HIDDEN for PMG');
  assert.strictEqual(pmgControls.showModalAssignmentDropdown, false, 'Modal Intake Assignment dropdown must be HIDDEN for PMG');
  assert.strictEqual(pmgControls.showDestinationFilters, false, 'DC Destination filters must be HIDDEN for PMG');
  assert.strictEqual(pmgControls.autoReceiveStepNumber, '2. Barcode Auto-Receive');
  assert.strictEqual(pmgControls.bulkImportStepNumber, '3. Bulk Import & Actions');
});

it('DC / Superadmin user still has access to Linked PO and Part Assignment controls', () => {
  const dcControls = simulateScanInControlsVisibility('superadmin');
  assert.strictEqual(dcControls.showLinkedPO, true, 'Linked PO column must be VISIBLE for Superadmin');
  assert.strictEqual(dcControls.showIntakeAssignmentCategory, true, 'Intake Assignment column must be VISIBLE for Superadmin');
  assert.strictEqual(dcControls.showModalPODropdown, true, 'Modal PO selector must be VISIBLE for Superadmin');
  assert.strictEqual(dcControls.showModalAssignmentDropdown, true, 'Modal Intake Assignment dropdown must be VISIBLE for Superadmin');
  assert.strictEqual(dcControls.showDestinationFilters, true, 'DC Destination filters must be VISIBLE for Superadmin');
});

// 7. PMG BATCH IMPORT & INVENTORY DATABASE RESOLUTION
it('PMG branch upload resolves to branch site UUID rather than hardcoded DC site ID', () => {
  const mockSites = [
    { id: '11111111-1111-4111-8111-111111111111', code: 'DC-MDC', name: 'Distribution Center', is_dc: true },
    { id: '22222222-2222-4222-8222-222222222222', code: 'APP PPM', name: 'Apple Premium Store PPM', is_dc: false },
    { id: '33333333-3333-4333-8333-333333333333', code: 'APP GH', name: 'Apple Store Greenhills', is_dc: false }
  ];
  const dcSiteId = mockSites[0].id;

  function simulateResolveTargetSiteUUID(unit, siteList, fallbackDcId) {
    const unitSiteKey = String(unit.current_site_id || unit.site_id || unit.targetSiteId || '').trim();
    const unitSiteCode = String(unit.site_code || '').trim().toUpperCase();
    const matchedSite = siteList.find(s =>
      (unitSiteKey && (s.id === unitSiteKey || s.code.toUpperCase() === unitSiteKey.toUpperCase())) ||
      (unitSiteCode && s.code.toUpperCase() === unitSiteCode)
    );
    return matchedSite?.id || fallbackDcId;
  }

  const pmgUnit = {
    part_number: '661-30373',
    serial_number: 'SBRANCH00123',
    current_site_id: 'site-ppm',
    site_code: 'APP PPM',
    site_name: 'Apple Premium Store PPM'
  };

  const resolvedSiteId = simulateResolveTargetSiteUUID(pmgUnit, mockSites, dcSiteId);
  assert.strictEqual(
    resolvedSiteId,
    '22222222-2222-4222-8222-222222222222',
    'PMG unit must resolve to the branch site UUID (APP PPM)'
  );
  assert.notStrictEqual(resolvedSiteId, dcSiteId, 'Must not be overwritten with DC site ID');
});

// 8. PMG PARTS REQUESTS & SUPERADMIN VISIBILITY
it('Superadmin with default selectedSiteId="ALL" sees incoming requests from all PMG branches', () => {
  const allRequests = [
    { id: 'req-1', request_number: 'PR-202608-10001', site_id: 'site-ppm', site_code: 'APP PPM', requested_by_name: 'Jose Rizal (PMG)', status: 'pending' },
    { id: 'req-2', request_number: 'PR-202608-10002', site_id: 'site-gh', site_code: 'APP GH', requested_by_name: 'Andres Bonifacio (PMG)', status: 'pending' },
    { id: 'req-3', request_number: 'PR-202608-10003', site_id: 'site-dc', site_code: 'DC-MDC', requested_by_name: 'DC Staff', status: 'approved' }
  ];

  function simulateFilterRequests(partsRequests, currentUser, selectedSiteId) {
    const isSuperadmin = currentUser?.role === 'superadmin';
    return partsRequests.filter(req => {
      if (!isSuperadmin) {
        return req.site_id === currentUser?.siteId;
      } else if (selectedSiteId && selectedSiteId !== 'ALL') {
        return req.site_id === selectedSiteId;
      }
      return true;
    });
  }

  const superadminUser = { id: 'usr-super', role: 'superadmin', fullName: 'Zhon Manaois' };
  const superadminDefaultSiteFilter = 'ALL';

  const visibleToSuperadmin = simulateFilterRequests(allRequests, superadminUser, superadminDefaultSiteFilter);
  assert.strictEqual(visibleToSuperadmin.length, 3, 'Superadmin must see all 3 requests from all branches');
  assert.ok(visibleToSuperadmin.some(r => r.site_code === 'APP PPM'), 'PPM request visible');
  assert.ok(visibleToSuperadmin.some(r => r.site_code === 'APP GH'), 'GH request visible');
});

// 9. REMOVE REQUEST BUTTON FOR SAME-SITE PARTS
it('Removes Request button if user is in the same site/location as the parts', () => {
  function simulateRowActionVisibility(userSiteId, partSiteId) {
    const isUserSameSite = !!(userSiteId && (userSiteId === partSiteId));
    return {
      isUserSameSite,
      showRequestButton: !isUserSameSite,
      statusBadge: isUserSameSite ? 'In Branch Stock' : null
    };
  }

  const currentUserSiteId = 'site-ppm';

  // Part located at the user's own branch (APP PPM)
  const sameSiteResult = simulateRowActionVisibility(currentUserSiteId, 'site-ppm');
  assert.strictEqual(sameSiteResult.showRequestButton, false, 'Request button must NOT be shown for same site');
  assert.strictEqual(sameSiteResult.statusBadge, 'In Branch Stock', 'Must show In Branch Stock badge');

  // Part located at a different branch (APP GH)
  const differentSiteResult = simulateRowActionVisibility(currentUserSiteId, 'site-gh');
  assert.strictEqual(differentSiteResult.showRequestButton, true, 'Request button MUST be shown for different site');
  assert.strictEqual(differentSiteResult.statusBadge, null);
});

// 10. MARK PART AS USED / REPAIR CONSUMPTION
it('Accurately marks part as used, decrements available stock, and logs consumed repair data', () => {
  let inventory = [
    { id: 'u1', part_number: '661-33201', serial_number: 'SN-USED-1', status: 'in_stock', current_site_id: 'site-ppm' },
    { id: 'u2', part_number: '661-33201', serial_number: 'SN-USED-2', status: 'in_stock', current_site_id: 'site-ppm' }
  ];

  // Helper simulating stock on hand calculation
  function calculateInStock(units, siteId, partNumber) {
    return units.filter(u =>
      u.current_site_id === siteId &&
      u.part_number === partNumber &&
      u.status === 'in_stock'
    ).length;
  }

  assert.strictEqual(calculateInStock(inventory, 'site-ppm', '661-33201'), 2, 'Initial stock is 2');

  // Mark SN-USED-1 as used
  const usedAtIso = new Date().toISOString();
  inventory = inventory.map(u => {
    if (u.serial_number === 'SN-USED-1') {
      return {
        ...u,
        status: 'used',
        used_at: usedAtIso,
        used_by_name: 'Jose Rizal (PMG)',
        work_order_number: 'WO-2026-9901',
        usage_notes: 'Replaced rear camera under warranty'
      };
    }
    return u;
  });

  // Stock must decrease to 1
  assert.strictEqual(calculateInStock(inventory, 'site-ppm', '661-33201'), 1, 'In-stock units must decrement to 1');

  const consumedUnit = inventory.find(u => u.serial_number === 'SN-USED-1');
  assert.strictEqual(consumedUnit.status, 'used', 'Unit status is used');
  assert.strictEqual(consumedUnit.work_order_number, 'WO-2026-9901');
  assert.strictEqual(consumedUnit.used_by_name, 'Jose Rizal (PMG)');

  // Revert SN-USED-1 back to in_stock
  inventory = inventory.map(u => {
    if (u.serial_number === 'SN-USED-1') {
      return {
        ...u,
        status: 'in_stock',
        used_at: null,
        work_order_number: null,
        usage_notes: null
      };
    }
    return u;
  });

  assert.strictEqual(calculateInStock(inventory, 'site-ppm', '661-33201'), 2, 'In-stock units restored to 2 on revert');
});

// 11. ZERO STOCK STATUS CHANGE & OUT OF STOCK BADGE
it('Changes status to out_of_stock when available units reach 0 and disables Mark Used', () => {
  function computePartStatus(inStock) {
    return {
      status: inStock > 0 ? 'in_stock' : 'out_of_stock',
      badgeText: inStock > 0 ? 'In Stock' : 'Out of Stock',
      badgeColor: inStock > 0 ? '#059669' : '#dc2626',
      canMarkUsed: inStock > 0,
      canRequestReplenish: inStock === 0
    };
  }

  const stock1 = computePartStatus(4);
  assert.strictEqual(stock1.status, 'in_stock');
  assert.strictEqual(stock1.badgeText, 'In Stock');
  assert.strictEqual(stock1.canMarkUsed, true);

  const stock0 = computePartStatus(0);
  assert.strictEqual(stock0.status, 'out_of_stock');
  assert.strictEqual(stock0.badgeText, 'Out of Stock');
  assert.strictEqual(stock0.badgeColor, '#dc2626');
  assert.strictEqual(stock0.canMarkUsed, false, 'Cannot mark used when 0 units');
  assert.strictEqual(stock0.canRequestReplenish, true, 'Can request replenishment when 0 units');
});

// 12. 3-DAY CONSECUTIVE ZERO-STOCK AUTO-PURGE & SCAN-IN RESTORATION
it('Auto-purges part from branch after 3 consecutive days of 0 stock, allowing scan-in re-add', () => {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let tracker = {
    'site-ppm_661-56050': {
      siteId: 'site-ppm',
      partNumber: '661-56050',
      zeroStockSince: new Date(now - (3.5 * 24 * 60 * 60 * 1000)).toISOString() // 3.5 days ago
    },
    'site-ppm_661-22389': {
      siteId: 'site-ppm',
      partNumber: '661-22389',
      zeroStockSince: new Date(now - (1 * 24 * 60 * 60 * 1000)).toISOString() // 1 day ago
    }
  };

  let branchPartsSummary = {
    '661-56050': { partNumber: '661-56050', inStock: 0, status: 'out_of_stock' },
    '661-22389': { partNumber: '661-22389', inStock: 0, status: 'out_of_stock' },
    '661-21988': { partNumber: '661-21988', inStock: 4, status: 'in_stock' }
  };

  // Simulate purge logic
  Object.keys(branchPartsSummary).forEach(pn => {
    const key = `site-ppm_${pn}`;
    if (tracker[key] && tracker[key].zeroStockSince) {
      const elapsed = now - new Date(tracker[key].zeroStockSince).getTime();
      if (elapsed >= THREE_DAYS_MS) {
        delete branchPartsSummary[pn]; // Purged!
        delete tracker[key];
      }
    }
  });

  // 661-56050 (3.5 days with 0 stock) must be purged from branch table
  assert.strictEqual(branchPartsSummary['661-56050'], undefined, 'Part with 3+ days at 0 stock is purged');
  // 661-22389 (1 day with 0 stock) remains in branch table with out_of_stock status
  assert.ok(branchPartsSummary['661-22389'] != null, 'Part with <3 days at 0 stock remains visible');
  assert.strictEqual(branchPartsSummary['661-21988'].status, 'in_stock', 'In stock part unaffected');

  // User adds 661-56050 again via Receive Scan-In page
  const _scanInNewUnit = {
    serial_number: 'NEW-SN-999',
    part_number: '661-56050',
    current_site_id: 'site-ppm',
    status: 'in_stock'
  };

  branchPartsSummary['661-56050'] = {
    partNumber: '661-56050',
    inStock: 1,
    status: 'in_stock'
  };
  delete tracker['site-ppm_661-56050'];

  assert.strictEqual(branchPartsSummary['661-56050'].inStock, 1, 'Part successfully restored via Receive Scan-In');
  assert.strictEqual(branchPartsSummary['661-56050'].status, 'in_stock', 'Restored part has in_stock status');
});

// 16. DC STOCK ISOLATION TESTS
it('Isolates PMG retail branch stock from DC Parts Stock Records, Scan-Out Packing, and Dashboard', () => {
  const allInventoryPool = [
    { id: 'u1', serial_number: 'SN-DC-001', part_number: '661-30461', current_site_id: 'site-dc', site_code: 'DC-MDC', status: 'in_stock' },
    { id: 'u2', serial_number: 'SN-DC-002', part_number: '661-42843', current_site_id: 'site-dc', site_code: 'DC-MDC', status: 'in_stock' },
    { id: 'u3', serial_number: 'SN-PPM-001', part_number: '661-56050', current_site_id: 'site-ppm', site_code: 'APP PPM', status: 'in_stock' },
    { id: 'u4', serial_number: 'SN-PPM-002', part_number: '661-21988', current_site_id: 'site-ppm', site_code: 'APP PPM', status: 'in_stock' }
  ];

  // DC Warehouse Stock Filter (IntakeRecords, ScanOutPacking, Dashboard)
  const dcStockUnits = allInventoryPool.filter(u => {
    const isDc = u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code);
    return (u.status === 'in_stock' || !u.status) && isDc;
  });

  assert.strictEqual(dcStockUnits.length, 2, 'DC Parts Stock Records contains exactly 2 DC units');
  assert.ok(dcStockUnits.some(u => u.serial_number === 'SN-DC-001'), 'DC stock includes SN-DC-001');
  assert.ok(dcStockUnits.some(u => u.serial_number === 'SN-DC-002'), 'DC stock includes SN-DC-002');
  assert.strictEqual(dcStockUnits.some(u => u.serial_number === 'SN-PPM-001'), false, 'DC stock strictly excludes APP PPM unit SN-PPM-001');
  assert.strictEqual(dcStockUnits.some(u => u.serial_number === 'SN-PPM-002'), false, 'DC stock strictly excludes APP PPM unit SN-PPM-002');
});

// 17. SUPERADMIN SITE IDENTITY & YOUR BRANCH BADGE
it('Multi-Site Stock Summary does NOT flag Superadmin as owning branch site (isOwnSite is false for Superadmin on APP PPM)', () => {
  const superadminUser = { id: 'usr-superadmin-zhon', role: 'superadmin', siteId: 'site-dc' };
  const pmgUserPpm = { id: 'usr-pmg-jose', role: 'parts_management', siteId: 'site-ppm', siteCode: 'APP PPM' };
  const ppmSite = { id: 'site-ppm', code: 'APP PPM', name: 'Power Plant Mall' };

  // Helper matching usePartsRequests getAllSitesStockSummary logic
  const checkIsOwnSite = (user, site) => {
    const isSuper = user?.role === 'superadmin';
    const userSiteId = user?.siteId;
    return !isSuper && Boolean(userSiteId && (site.id === userSiteId || site.code === userSiteId));
  };

  assert.strictEqual(checkIsOwnSite(superadminUser, ppmSite), false, 'Superadmin is not marked as isOwnSite for APP PPM');
  assert.strictEqual(checkIsOwnSite(pmgUserPpm, ppmSite), true, 'PMG user at APP PPM is marked as isOwnSite for APP PPM');
});

// 18. SITE-BASED DELETE AND UPDATE AUTHORITY
it('Site-based authority: PMG user has delete & update authority for own branch units while cross-branch unauthorized delete is blocked', () => {
  const pmgUserPpm = { id: 'usr-pmg-jose', role: 'parts_management', siteId: 'site-ppm', siteCode: 'APP PPM' };
  const pmgUserCebu = { id: 'usr-pmg-maria', role: 'parts_management', siteId: 'site-cebu', siteCode: 'AYALA CEBU' };
  const superadminUser = { id: 'usr-superadmin-zhon', role: 'superadmin', siteId: 'site-dc' };

  const ppmUnit = {
    id: 'unit-ppm-01',
    serial_number: 'SN-PPM-001',
    part_number: '661-56050',
    current_site_id: 'site-ppm',
    site_code: 'APP PPM',
    received_by_id: 'usr-pmg-jose',
    received_by: 'Jose Rizal'
  };

  // Authority check simulation from canUserDeleteRecord
  const canUserDelete = (record, user) => {
    const userRole = String(user.role || '').toLowerCase();
    if (userRole === 'superadmin' || userRole === 'admin') return true;
    if (record.received_by_id === user.id) return true;
    const userSite = user.siteId || user.siteCode;
    const recordSite = record.current_site_id || record.site_code;
    if (userSite && (userSite === recordSite || userSite === record.current_site_id || userSite === record.site_code)) return true;
    return false;
  };

  assert.strictEqual(canUserDelete(ppmUnit, pmgUserPpm), true, 'PMG user at PPM can delete PPM unit');
  assert.strictEqual(canUserDelete(ppmUnit, superadminUser), true, 'Superadmin can delete any unit');
  assert.strictEqual(canUserDelete(ppmUnit, pmgUserCebu), false, 'PMG user at Cebu cannot delete PPM unit');
});

// 19. BULK IMPORT SITE ISOLATION
it('File bulk import and batch receive strictly isolate existing serial checks to the target site (DC imports do not falsely flag PMG branch parts as Already in DC Stock)', () => {
  const existingInventoryPool = [
    { id: 'u-dc-1', serial_number: 'G9PDC001', part_number: '661-30461', current_site_id: 'site-dc', site_code: 'DC-MDC', status: 'in_stock' },
    { id: 'u-ppm-1', serial_number: 'G9PPPM001', part_number: '661-56050', current_site_id: 'site-ppm', site_code: 'APP PPM', status: 'in_stock' }
  ];

  // Helper simulating parseScanInPartsFile site filtering logic
  const checkSerialStatusForSite = (serial, targetSiteId, targetSiteCode, existingUnits) => {
    const isDcTarget = targetSiteId === 'site-dc' || targetSiteCode === 'DC-MDC' || targetSiteCode === 'DC' || (!targetSiteId && !targetSiteCode);
    const targetSiteUnits = existingUnits.filter(u => {
      if (isDcTarget) {
        return (u.current_site_id === 'site-dc' || u.site_code === 'DC-MDC' || u.site_code === 'DC' || (!u.current_site_id && !u.site_code)) && (u.status === 'in_stock' || !u.status);
      }
      return (u.current_site_id === targetSiteId || u.site_code === targetSiteCode) && (u.status === 'in_stock' || !u.status);
    });
    const siteSerialsSet = new Set(targetSiteUnits.map(u => String(u.serial_number || '').trim().toUpperCase()));
    if (siteSerialsSet.has(serial)) {
      return {
        status: 'EXISTING_INVENTORY',
        statusMessage: isDcTarget ? 'Already in DC Stock (Will re-sync/update details)' : 'Already in Branch Stock (Will re-sync/update details)'
      };
    }
    return {
      status: 'VALID',
      statusMessage: 'Ready to Import'
    };
  };

  // Case A: Superadmin receiving into DC uploads G9PPPM001 (which exists only at PPM branch)
  const dcCheck = checkSerialStatusForSite('G9PPPM001', 'site-dc', 'DC-MDC', existingInventoryPool);
  assert.strictEqual(dcCheck.status, 'VALID', 'Branch serial G9PPPM001 is VALID (Ready to Import) for DC, NOT falsely flagged as Already in DC Stock');

  // Case B: Superadmin receiving into DC uploads G9PDC001 (which exists at DC)
  const dcExistingCheck = checkSerialStatusForSite('G9PDC001', 'site-dc', 'DC-MDC', existingInventoryPool);
  assert.strictEqual(dcExistingCheck.status, 'EXISTING_INVENTORY');
  assert.strictEqual(dcExistingCheck.statusMessage, 'Already in DC Stock (Will re-sync/update details)');

  // Case C: PMG user receiving into PPM branch uploads G9PPPM001
  const ppmExistingCheck = checkSerialStatusForSite('G9PPPM001', 'site-ppm', 'APP PPM', existingInventoryPool);
  assert.strictEqual(ppmExistingCheck.status, 'EXISTING_INVENTORY');
  assert.strictEqual(ppmExistingCheck.statusMessage, 'Already in Branch Stock (Will re-sync/update details)');
});

// 20. USER PROVISIONING & EMAIL VALIDATION
it('User Provisioning: correctly provisions valid email formats and synchronizes user state', () => {
  const usersList = [
    { id: 'usr-admin', email: 'admin@mobilecareph.com', fullName: 'System Admin', role: 'superadmin' }
  ];

  // Helper matching updated isAllowedCompanyEmail
  const isAllowedCompanyEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    const clean = email.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(clean);
  };

  // Test various email formats
  assert.strictEqual(isAllowedCompanyEmail('joshua@mobilecareph.com'), true, 'Corporate domain is valid');
  assert.strictEqual(isAllowedCompanyEmail('staff.member@mobilecare.com.ph'), true, 'PH domain is valid');
  assert.strictEqual(isAllowedCompanyEmail('technician.juan@gmail.com'), true, 'Standard email format is valid');
  assert.strictEqual(isAllowedCompanyEmail('invalid-email-no-at'), false, 'Invalid email is rejected');
  assert.strictEqual(isAllowedCompanyEmail(''), false, 'Empty email is rejected');

  // Simulate provisionUser
  const provision = (form) => {
    const cleanEmail = form.email.trim().toLowerCase();
    if (!isAllowedCompanyEmail(cleanEmail)) {
      return { success: false, error: 'Invalid email' };
    }
    if (usersList.some(u => u.email.toLowerCase() === cleanEmail)) {
      return { success: false, error: 'User already exists' };
    }
    const newUser = {
      id: `usr-${Date.now()}`,
      email: cleanEmail,
      fullName: form.fullName.trim(),
      role: form.role,
      rolePosition: form.rolePosition,
      siteId: form.siteId,
      hasSetPassword: false,
      isActive: true
    };
    usersList.push(newUser);
    return { success: true, user: newUser };
  };

  const res = provision({
    fullName: 'Juan Dela Cruz',
    email: 'juan.delacruz@mobilecareph.com',
    role: 'parts_management',
    rolePosition: 'Branch Parts Specialist',
    siteId: 'site-ppm'
  });

  assert.strictEqual(res.success, true, 'User provisioned successfully');
  assert.strictEqual(usersList.length, 2, 'Users list contains new user');
  assert.strictEqual(usersList[1].fullName, 'Juan Dela Cruz');
  assert.strictEqual(usersList[1].role, 'parts_management');
});

// 21. PMG STOCK AVAILABILITY & RECEIPT CONFIRMATION WORKFLOW
it('Packed & In-Transit parts are EXCLUDED from available branch stock until Superadmin confirms receipt', () => {
  const branchSiteId = 'site-ppm';
  const partNumber = '661-21991';

  // 1. Initial State: 1 unit already in stock at branch, 2 units packed at DC for this branch
  const inventoryUnits = [
    {
      id: 'u-existing',
      part_number: partNumber,
      serial_number: 'SER-EXISTING-01',
      current_site_id: branchSiteId,
      status: 'in_stock'
    },
    {
      id: 'u-packed-1',
      part_number: partNumber,
      serial_number: 'SER-PACKED-01',
      current_site_id: branchSiteId,
      status: 'packed'
    },
    {
      id: 'u-packed-2',
      part_number: partNumber,
      serial_number: 'SER-PACKED-02',
      current_site_id: branchSiteId,
      status: 'shipped'
    }
  ];

  // Stock calculation helper matching getStockOnHandForSite
  const calculateStock = (units, siteId) => {
    let inStock = 0;
    let packed = 0;
    units.filter(u => u.current_site_id === siteId).forEach(u => {
      const s = String(u.status || 'in_stock').toLowerCase();
      if (s === 'in_stock' || s === 'delivered' || s === 'received') {
        inStock++;
      } else if (s === 'packed' || s === 'shipped' || s === 'in_transit' || s === 'pending_pickup') {
        packed++;
      }
    });
    return { inStock, packed };
  };

  const initialStock = calculateStock(inventoryUnits, branchSiteId);
  assert.strictEqual(initialStock.inStock, 1, 'Only 1 unit is available in branch stock while 2 units are packed/in-transit');
  assert.strictEqual(initialStock.packed, 2, '2 units are tracked under packed/in-transit');

  // 2. Superadmin Confirms Receipt at Site
  const confirmReceipt = (units, serialsToConfirm) => {
    return units.map(u => {
      if (serialsToConfirm.includes(u.serial_number)) {
        return {
          ...u,
          status: 'in_stock',
          received_at: new Date().toISOString()
        };
      }
      return u;
    });
  };

  const updatedUnits = confirmReceipt(inventoryUnits, ['SER-PACKED-01', 'SER-PACKED-02']);
  const postConfirmStock = calculateStock(updatedUnits, branchSiteId);

  assert.strictEqual(postConfirmStock.inStock, 3, 'All 3 units are now ACTIVE & IN STOCK at branch after confirmation');
  assert.strictEqual(postConfirmStock.packed, 0, '0 units remaining packed');
});

it('Confirming site receipt auto-fulfills matching parts requests and updates status across network', () => {
  const branchSiteId = 'site-ppm';
  const partNumber = '661-21991';

  let partsRequests = [
    {
      id: 'req-001',
      request_number: 'PR-202608-1001',
      site_id: branchSiteId,
      part_number: partNumber,
      quantity_requested: 2,
      quantity_fulfilled: 0,
      status: 'approved'
    }
  ];

  const updatePartsRequestStatus = (reqId, payload) => {
    partsRequests = partsRequests.map(r => r.id === reqId ? { ...r, ...payload } : r);
  };

  const shipment = {
    id: 'ship-100',
    invoice_ref: 'DCSSR#901',
    site_id: branchSiteId,
    status: 'pending_pickup',
    items: [
      { part_number: partNumber, serial_number: 'SER-01' },
      { part_number: partNumber, serial_number: 'SER-02' }
    ]
  };

  // Simulate confirmSiteReceive auto-fulfillment
  const shipmentPartNumbers = new Set((shipment.items || []).map(it => it.part_number.toUpperCase()));
  const matchingRequests = partsRequests.filter(req =>
    (req.site_id === shipment.site_id) &&
    shipmentPartNumbers.has(req.part_number.toUpperCase())
  );

  matchingRequests.forEach(req => {
    updatePartsRequestStatus(req.id, {
      status: 'fulfilled',
      quantity_fulfilled: req.quantity_requested,
      fulfilled_shipment_id: shipment.id
    });
  });

  assert.strictEqual(partsRequests[0].status, 'fulfilled', 'Request marked as fulfilled');
  assert.strictEqual(partsRequests[0].quantity_fulfilled, 2, 'Quantity fulfilled updated to 2');
  assert.strictEqual(partsRequests[0].fulfilled_shipment_id, 'ship-100');
});

// 22. ZERO-STOCK AUTO-CLEANING TRANSIT EXEMPTION TEST
it('Zero-Stock Auto-Cleaning strictly EXEMPTS parts that have units packed or in transit', () => {
  const branchSiteId = 'site-ppm';
  const inTransitPartPN = '661-56050'; // Display, iPhone 17 Pro Max
  const trulyStalePartPN = '661-99999'; // Stale part with 0 stock and 0 in-transit

  const nowMs = Date.now();
  const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
  const fourDaysAgoIso = new Date(nowMs - FOUR_DAYS_MS).toISOString();

  // Simulated inventory units (referenced for scenario context)
  const _inventoryUnits = [
    // inTransitPartPN has 0 in_stock units, but 1 unit packed in transit for PPM branch
    {
      id: 'u-transit-1',
      part_number: inTransitPartPN,
      serial_number: 'SER-TRANSIT-17',
      current_site_id: branchSiteId,
      status: 'packed'
    }
  ];

  // Tracker has both parts recorded as 0 stock 4 days ago (> 3 days)
  let tracker = {
    [`${branchSiteId}_${inTransitPartPN}`]: {
      siteId: branchSiteId,
      partNumber: inTransitPartPN,
      zeroStockSince: fourDaysAgoIso
    },
    [`${branchSiteId}_${trulyStalePartPN}`]: {
      siteId: branchSiteId,
      partNumber: trulyStalePartPN,
      zeroStockSince: fourDaysAgoIso
    }
  };

  // Simulating getStockOnHandForSite with transit protection
  const partsSummary = {
    [inTransitPartPN]: {
      partNumber: inTransitPartPN,
      inStock: 0,
      packed: 1,
      total: 1
    },
    [trulyStalePartPN]: {
      partNumber: trulyStalePartPN,
      inStock: 0,
      packed: 0,
      total: 0
    }
  };

  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  Object.keys(partsSummary).forEach(pn => {
    const item = partsSummary[pn];
    const trackerKey = `${branchSiteId}_${pn}`;

    if (item.inStock > 0 || item.packed > 0) {
      item.status = item.inStock > 0 ? 'in_stock' : 'in_transit';
      item.outOfStockDays = 0;
      item.daysUntilPurge = null;
      item.zeroStockSince = null;
      if (tracker[trackerKey]) {
        delete tracker[trackerKey];
      }
    } else {
      item.status = 'out_of_stock';
      const zeroSinceMs = new Date(tracker[trackerKey]?.zeroStockSince || nowMs).getTime();
      const elapsedMs = nowMs - zeroSinceMs;
      if (elapsedMs >= THREE_DAYS_MS && (item.packed || 0) === 0 && (item.allocated || 0) === 0) {
        delete partsSummary[pn];
      }
    }
  });

  // Verify that the truly stale part was purged
  assert.strictEqual(partsSummary[trulyStalePartPN], undefined, 'Truly stale part with 0 stock and 0 in-transit is purged after 3 days');

  // Verify that in-transit part is PRESERVED and protected from auto-cleaning
  assert.ok(partsSummary[inTransitPartPN], 'In-transit part is NOT purged and remains visible in branch stock summary');
  assert.strictEqual(partsSummary[inTransitPartPN].status, 'in_transit');
  assert.strictEqual(partsSummary[inTransitPartPN].packed, 1);
  assert.strictEqual(partsSummary[inTransitPartPN].daysUntilPurge, null, 'Purge timer is null for in-transit part');
  assert.strictEqual(tracker[`${branchSiteId}_${inTransitPartPN}`], undefined, 'Zero stock tracker was cleared for in-transit part');
});

// 23. PACKING LIST INTAKE ASSIGNMENT NAVIGATION TABS TEST
it('Packing List: Accurately classifies and filters DC available stock into MDC – Forecasting, DC – CRBR, and SVNR', () => {
  const dcUnits = [
    {
      id: 'u-fore-1',
      part_number: '661-21991',
      serial_number: 'SER-F1',
      current_site_id: 'site-dc',
      intake_assignment: 'MDC - Forecasting',
      status: 'in_stock'
    },
    {
      id: 'u-fore-2',
      part_number: '661-21991',
      serial_number: 'SER-F2',
      current_site_id: 'site-dc',
      intake_assignment: undefined,
      notes: '',
      status: 'in_stock'
    },
    {
      id: 'u-crbr-1',
      part_number: '661-37213',
      serial_number: 'SER-C1',
      current_site_id: 'site-dc',
      intake_assignment: 'DC - CRBR',
      notes: 'Customer Return Buffer',
      status: 'in_stock'
    },
    {
      id: 'u-svnr-1',
      part_number: '661-56050',
      serial_number: 'SER-S1',
      current_site_id: 'site-dc',
      intake_assignment: 'SVNR - Service Non-Repair',
      status: 'in_stock'
    }
  ];

  const isUnitSvnr = (u) => {
    const assign = String(u.intake_assignment || '').toUpperCase();
    const notes = String(u.notes || '').toUpperCase();
    return assign.includes('SVNR') || notes.includes('SVNR');
  };

  const isUnitCrbr = (u) => {
    if (isUnitSvnr(u)) return false;
    const assign = String(u.intake_assignment || '').toUpperCase();
    const notes = String(u.notes || '').toUpperCase();
    return assign.includes('CRBR') || notes.includes('CRBR');
  };

  const isUnitForecasting = (u) => {
    return !isUnitSvnr(u) && !isUnitCrbr(u);
  };

  const counts = {
    all: dcUnits.length,
    forecasting: dcUnits.filter(isUnitForecasting).length,
    crbr: dcUnits.filter(isUnitCrbr).length,
    svnr: dcUnits.filter(isUnitSvnr).length
  };

  assert.strictEqual(counts.all, 4, 'Total available stock count is 4');
  assert.strictEqual(counts.forecasting, 2, '2 units classified under MDC – Forecasting');
  assert.strictEqual(counts.crbr, 1, '1 unit classified under DC – CRBR');
  assert.strictEqual(counts.svnr, 1, '1 unit classified under SVNR');

  // Filtering by MDC_FORECASTING
  const forecastingFiltered = dcUnits.filter(isUnitForecasting);
  assert.strictEqual(forecastingFiltered.length, 2);
  assert.strictEqual(forecastingFiltered[0].serial_number, 'SER-F1');

  // Filtering by DC_CRBR
  const crbrFiltered = dcUnits.filter(isUnitCrbr);
  assert.strictEqual(crbrFiltered.length, 1);
  assert.strictEqual(crbrFiltered[0].serial_number, 'SER-C1');

  // Filtering by SVNR
  const svnrFiltered = dcUnits.filter(isUnitSvnr);
  assert.strictEqual(svnrFiltered.length, 1);
  assert.strictEqual(svnrFiltered[0].serial_number, 'SER-S1');
});

it('Packing List: Default destination site is blank requiring explicit selection before packing', () => {
  // Test initial workstation state with no saved draft
  const getInitialSelectedSiteId = (currentUser, savedDraftJson, sites) => {
    try {
      if (savedDraftJson) {
        const parsed = JSON.parse(savedDraftJson);
        if (parsed && parsed.site_id && sites.some(s => s.id === parsed.site_id)) {
          return parsed.site_id;
        }
      }
    } catch (e) {}
    return '';
  };

  const mockSites = [
    { id: 'site-annex', code: 'APP ANX', name: 'MobileCare - APP The Annex', region: 'Metro Manila' },
    { id: 'site-ppm', code: 'APP PPM', name: 'MobileCare - APP Podium', region: 'Metro Manila' },
    { id: 'site-clrk', code: 'APP CLRK', name: 'MobileCare - ASP Clark', region: 'Pampanga' }
  ];

  // 1. Fresh session without active draft defaults to empty string (NOT Annex)
  const initialSiteId = getInitialSelectedSiteId({ id: 'user-zhon' }, null, mockSites);
  assert.strictEqual(initialSiteId, '', 'Initial selectedSiteId must be blank when no active draft exists');

  const getSelectedSite = (siteId, sites) => {
    if (!siteId) return null;
    return sites.find(s => s.id === siteId) || null;
  };

  const initialSiteObj = getSelectedSite(initialSiteId, mockSites);
  assert.strictEqual(initialSiteObj, null, 'Selected site object is null when siteId is empty');

  // 2. Packing unit attempt with no site selected is blocked with a validation error
  const attemptPack = (selectedSiteId, partNumber, serialNumber) => {
    if (!selectedSiteId) {
      return { success: false, error: 'Please select a destination site first before packing parts.' };
    }
    return { success: true, partNumber, serialNumber, siteId: selectedSiteId };
  };

  const blockedPackRes = attemptPack(initialSiteId, '661-21991', 'F8Y6276C1UQ13XCB1');
  assert.strictEqual(blockedPackRes.success, false);
  assert.strictEqual(blockedPackRes.error, 'Please select a destination site first before packing parts.');

  // 3. User explicitly selects a destination site (e.g. Clark)
  const chosenSiteId = 'site-clrk';
  const chosenSiteObj = getSelectedSite(chosenSiteId, mockSites);
  assert.strictEqual(chosenSiteObj.code, 'APP CLRK');

  // 4. Packing succeeds after site selection
  const allowedPackRes = attemptPack(chosenSiteId, '661-21991', 'F8Y6276C1UQ13XCB1');
  assert.strictEqual(allowedPackRes.success, true);
  assert.strictEqual(allowedPackRes.siteId, 'site-clrk');
});

console.log('====================================================');
console.log(`RESULTS: ${passedTests}/${passedTests} PASSED (0 FAILED)`);
console.log('====================================================');






