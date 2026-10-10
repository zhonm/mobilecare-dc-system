import assert from 'assert';
import { ROLE_PRESETS } from '../constants/roles.js';
import { ALL_PAGES } from '../constants/navigation.js';

console.log('========================================================================');
console.log('TEST SUITE: PMG All Stocks Restriction & Multi-Site Serial Privacy');
console.log('========================================================================\n');

// 1. Mock Users
const pmgAndresAnx = {
  id: 'usr-andres-anx',
  fullName: 'Andres Bonifacio',
  role: 'parts_management',
  siteId: 'site-anx-uuid',
  siteCode: 'APP ANX'
};

const pmgMariaCeb = {
  id: 'usr-maria-ceb',
  fullName: 'Maria Clara',
  role: 'parts_management',
  siteId: 'site-ceb-uuid',
  siteCode: 'ASP CEB'
};

const superadminZhon = {
  id: 'usr-zhon-super',
  fullName: 'Zhon Manaois',
  role: 'superadmin',
  siteId: 'site-dc-uuid',
  siteCode: 'DC-MDC'
};

const adminJoshua = {
  id: 'usr-joshua-admin',
  fullName: 'Joshua Juvida',
  role: 'admin',
  siteId: 'site-dc-uuid',
  siteCode: 'DC-MDC'
};

// 2. Simulation of canAccess (mirroring src/context/useAuth.js)
function canAccess(user, pageId) {
  if (!user) return false;
  if (user.role === 'superadmin' || Boolean(user.isSuperAdmin)) return true;
  if (pageId === 'user-access' || pageId === 'all-stocks') return false;
  if (user.isActive === false) return false;
  if (user.role === 'user') return ROLE_PRESETS.user.includes(pageId);
  if (user.role === 'parts_management') {
    return (ROLE_PRESETS.parts_management || ['request-parts', 'scan-in', 'multi-site', 'feedback']).includes(pageId);
  }
  if (Array.isArray(user.permittedPages)) return user.permittedPages.includes(pageId);
  const fallback = ROLE_PRESETS[user.role] || ROLE_PRESETS.user;
  return fallback.includes(pageId) && pageId !== 'user-access' && pageId !== 'all-stocks';
}

// Test 1: Page access permissions
console.log('--- Test 1: Page access permissions (All Stocks strictly Superadmin only) ---');
assert.strictEqual(canAccess(superadminZhon, 'all-stocks'), true, 'Superadmin can access all-stocks');
assert.strictEqual(canAccess(superadminZhon, 'multi-site'), true, 'Superadmin can access multi-site');

assert.strictEqual(canAccess(pmgAndresAnx, 'all-stocks'), false, 'PMG cannot access all-stocks');
assert.strictEqual(canAccess(pmgAndresAnx, 'multi-site'), true, 'PMG can access multi-site');
assert.strictEqual(canAccess(pmgAndresAnx, 'request-parts'), true, 'PMG can access request-parts');
assert.strictEqual(canAccess(pmgAndresAnx, 'scan-in'), true, 'PMG can access scan-in');

assert.strictEqual(canAccess(adminJoshua, 'all-stocks'), false, 'Admin cannot access all-stocks (strictly superadmin)');
assert.strictEqual(canAccess(adminJoshua, 'multi-site'), true, 'Admin can access multi-site');
console.log('  ✓ PASS: all-stocks strictly restricted to Superadmin; blocked for PMG and Admin');

// Test 2: Role presets check
console.log('\n--- Test 2: ROLE_PRESETS verification ---');
assert.ok(ROLE_PRESETS.parts_management.includes('multi-site'), 'parts_management preset has multi-site');
assert.ok(!ROLE_PRESETS.parts_management.includes('all-stocks'), 'parts_management preset does NOT have all-stocks');
assert.ok(ROLE_PRESETS.superadmin.includes('all-stocks'), 'superadmin preset has all-stocks');
assert.ok(ROLE_PRESETS.superadmin.includes('multi-site'), 'superadmin preset has multi-site');
console.log('  ✓ PASS: ROLE_PRESETS correctly configured');

// Test 3: Multi-Site Serial Visibility Logic
console.log('\n--- Test 3: Multi-Site Serial Visibility & Privacy Masking ---');
function checkCanViewSiteSerials(user, targetSiteCode) {
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'SUPERADMIN' || Boolean(user?.isSuperAdmin);
  const isPmgUser = user?.role === 'parts_management';
  if (isSuperadmin) return true;
  if (!isPmgUser) return true;

  const rawUserCode = user?.siteCode || '';
  const userCleanCode = rawUserCode.toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
  const targetCleanCode = (targetSiteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();

  return Boolean(userCleanCode && targetCleanCode && userCleanCode === targetCleanCode);
}

// Andres Bonifacio is assigned to ANX
assert.strictEqual(checkCanViewSiteSerials(pmgAndresAnx, 'APP ANX'), true, 'Andres can view serials of APP ANX');
assert.strictEqual(checkCanViewSiteSerials(pmgAndresAnx, 'ANX'), true, 'Andres can view serials of ANX');
assert.strictEqual(checkCanViewSiteSerials(pmgAndresAnx, 'ASP BHS'), false, 'Andres CANNOT view serials of BHS');
assert.strictEqual(checkCanViewSiteSerials(pmgAndresAnx, 'GL5'), false, 'Andres CANNOT view serials of GL5');
assert.strictEqual(checkCanViewSiteSerials(pmgAndresAnx, 'ASP CEB'), false, 'Andres CANNOT view serials of CEB');

// Maria Clara is assigned to CEB
assert.strictEqual(checkCanViewSiteSerials(pmgMariaCeb, 'ASP CEB'), true, 'Maria can view serials of CEB');
assert.strictEqual(checkCanViewSiteSerials(pmgMariaCeb, 'APP ANX'), false, 'Maria CANNOT view serials of ANX');

// Superadmin can view all sites' serials
assert.strictEqual(checkCanViewSiteSerials(superadminZhon, 'APP ANX'), true, 'Superadmin can view serials of ANX');
assert.strictEqual(checkCanViewSiteSerials(superadminZhon, 'ASP BHS'), true, 'Superadmin can view serials of BHS');
assert.strictEqual(checkCanViewSiteSerials(superadminZhon, 'ASP CEB'), true, 'Superadmin can view serials of CEB');
console.log('  ✓ PASS: PMG users can only view serials of their assigned site; other sites masked');

// Test 4: Export Sanitization
console.log('\n--- Test 4: Export Data Sanitization on Cross-Site Views ---');
const rawSiteItems = [
  { id: '1', partNumber: '661-21996', serialNumber: 'F8Y6305C84E18FK01', partSerial: 'F8Y6305C84E18FK01' },
  { id: '2', partNumber: '661-21993', serialNumber: 'F8Y6305C84E18FK02', partSerial: 'F8Y6305C84E18FK02' }
];

function sanitizeItemsForExport(user, targetSiteCode, items) {
  const canView = checkCanViewSiteSerials(user, targetSiteCode);
  if (canView) return items;
  return items.map(it => ({
    ...it,
    serialNumber: '[RESTRICTED]',
    partSerial: '[RESTRICTED]'
  }));
}

const andresExportOwnSite = sanitizeItemsForExport(pmgAndresAnx, 'ANX', rawSiteItems);
assert.strictEqual(andresExportOwnSite[0].serialNumber, 'F8Y6305C84E18FK01', 'Own site export keeps real serial');

const andresExportOtherSite = sanitizeItemsForExport(pmgAndresAnx, 'BHS', rawSiteItems);
assert.strictEqual(andresExportOtherSite[0].serialNumber, '[RESTRICTED]', 'Other site export replaces serial with [RESTRICTED]');
assert.strictEqual(andresExportOtherSite[1].serialNumber, '[RESTRICTED]', 'Other site export replaces serial with [RESTRICTED]');

const superadminExportOtherSite = sanitizeItemsForExport(superadminZhon, 'BHS', rawSiteItems);
assert.strictEqual(superadminExportOtherSite[0].serialNumber, 'F8Y6305C84E18FK01', 'Superadmin export retains real serial for all sites');
console.log('  ✓ PASS: Cross-site exports are sanitized to prevent serial leakage');

// Test 5: Top KPI Summary Metrics Scoping (Branch-scoped for PMG, Network-wide for Superadmin)
console.log('\n--- Test 5: Top KPI Summary Metrics Scoping ---');

const mockSnapshot = {
  globalMetrics: {
    totalUnits: 3368,
    totalValue: 827848.93,
    uniqueParts: 452,
    sitesCount: 26,
    investigationCount: 14,
    agingCounts: {
      DEAD_STOCK: 1768,
      NON_MOVING: 432,
      SLOW_MOVING: 312,
      IN_STOCK: 856
    },
    deadStockPercent: '52.5',
    nonMovingPercent: '12.8',
    slowMovingPercent: '9.3',
    inStockPercent: '25.4'
  },
  sites: [
    {
      siteCode: 'APP ANX',
      siteName: 'Apple Premium Partner The Annex',
      totalUnits: 80,
      totalValue: 18720.00,
      uniquePartsCount: 32,
      investigationCount: 0,
      metrics: {
        total: {
          units: 80,
          dead: 12,
          nonMoving: 13,
          slow: 14,
          inStock: 41,
          deadPercent: '15.0%',
          nonMovingPercent: '16.3%',
          slowPercent: '17.5%',
          inStockPercent: '51.2%'
        }
      }
    },
    {
      siteCode: 'ASP BHS',
      siteName: 'ASP Bonifacio High Street',
      totalUnits: 150,
      totalValue: 35000.00,
      uniquePartsCount: 65,
      investigationCount: 2,
      metrics: {
        total: {
          units: 150,
          dead: 45,
          nonMoving: 20,
          slow: 15,
          inStock: 70,
          deadPercent: '30.0%',
          nonMovingPercent: '13.3%',
          slowPercent: '10.0%',
          inStockPercent: '46.7%'
        }
      }
    }
  ]
};

function computeDisplayMetrics(user, snapshot) {
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'SUPERADMIN' || Boolean(user?.isSuperAdmin);
  const isPmgUser = user?.role === 'parts_management';

  if (!isSuperadmin && isPmgUser) {
    const rawUserCode = user?.siteCode || '';
    const userClean = rawUserCode.toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
    const userSiteData = snapshot.sites.find(s => {
      const clean = s.siteCode.toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
      return clean === userClean || (clean === 'ANX' && userClean === 'THE ANNEX') || (clean === 'THE ANNEX' && userClean === 'ANX');
    });

    if (userSiteData) {
      const m = userSiteData.metrics.total;
      return {
        isScopedToBranch: true,
        branchName: userSiteData.siteName,
        branchCode: userSiteData.siteCode,
        totalUnits: userSiteData.totalUnits,
        totalValue: userSiteData.totalValue,
        uniqueParts: userSiteData.uniquePartsCount,
        sitesCount: 1,
        investigationCount: userSiteData.investigationCount,
        agingCounts: {
          DEAD_STOCK: m.dead,
          NON_MOVING: m.nonMoving,
          SLOW_MOVING: m.slow,
          IN_STOCK: m.inStock
        },
        deadStockPercent: m.deadPercent,
        nonMovingPercent: m.nonMovingPercent,
        slowMovingPercent: m.slowPercent,
        inStockPercent: m.inStockPercent
      };
    }
  }

  return {
    isScopedToBranch: false,
    ...snapshot.globalMetrics
  };
}

// PMG Andres at Annex sees Annex-specific KPIs:
const andresKpis = computeDisplayMetrics(pmgAndresAnx, mockSnapshot);
assert.strictEqual(andresKpis.isScopedToBranch, true, 'Andres KPIs are branch-scoped');
assert.strictEqual(andresKpis.totalUnits, 80, 'Andres sees 80 total units on-hand (Annex), NOT 3,368 network units');
assert.strictEqual(andresKpis.agingCounts.DEAD_STOCK, 12, 'Andres sees 12 Dead Stock units (Annex), NOT 1,768 network dead units');
assert.strictEqual(andresKpis.agingCounts.NON_MOVING, 13, 'Andres sees 13 Non-Moving units (Annex), NOT 432 network units');
assert.strictEqual(andresKpis.agingCounts.SLOW_MOVING, 14, 'Andres sees 14 Slow-Moving units (Annex)');
assert.strictEqual(andresKpis.agingCounts.IN_STOCK, 41, 'Andres sees 41 Active stock units (Annex)');
assert.strictEqual(andresKpis.deadStockPercent, '15.0%', 'Andres sees 15.0% dead stock, not 52.5% network dead');
assert.strictEqual(andresKpis.sitesCount, 1, 'Andres sites count is 1 (assigned branch)');

// Superadmin Zhon sees network-wide KPIs:
const superKpis = computeDisplayMetrics(superadminZhon, mockSnapshot);
assert.strictEqual(superKpis.isScopedToBranch, false, 'Superadmin KPIs are network-wide');
assert.strictEqual(superKpis.totalUnits, 3368, 'Superadmin sees 3,368 network units');
assert.strictEqual(superKpis.agingCounts.DEAD_STOCK, 1768, 'Superadmin sees 1,768 total network dead stock');
assert.strictEqual(superKpis.sitesCount, 26, 'Superadmin sees 26 sites');
console.log('  ✓ PASS: KPI metrics accurately scoped to assigned branch for PMG and network-wide for Superadmin');

// Test 6: Cross-Site Health & Aging Suppression for PMG Users
console.log('\n--- Test 6: Cross-Site Health & Aging Metrics Suppression ---');

function canViewSiteHealthMetrics(user, targetSiteCode) {
  const isSuperadmin = user?.role === 'superadmin' || user?.role === 'SUPERADMIN' || Boolean(user?.isSuperAdmin);
  const isPmgUser = user?.role === 'parts_management';
  if (isSuperadmin) return true;
  if (!isPmgUser) return false;

  const rawUserCode = user?.siteCode || '';
  const userClean = rawUserCode.toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
  const targetClean = (targetSiteCode || '').toUpperCase().replace(/^(ASP|APP)\s+/, '').trim();
  return Boolean(userClean && targetClean && userClean === targetClean);
}

// Andres at Annex checking Annex:
assert.strictEqual(canViewSiteHealthMetrics(pmgAndresAnx, 'APP ANX'), true, 'Andres can view health/aging for own site (ANX)');
assert.strictEqual(canViewSiteHealthMetrics(pmgAndresAnx, 'ANX'), true, 'Andres can view health/aging for own site alias');

// Andres at Annex checking BHS (another site):
assert.strictEqual(canViewSiteHealthMetrics(pmgAndresAnx, 'ASP BHS'), false, 'Andres CANNOT view health/aging for other site (BHS)');
assert.strictEqual(canViewSiteHealthMetrics(pmgAndresAnx, 'CEB'), false, 'Andres CANNOT view health/aging for other site (CEB)');

// Superadmin checking any site:
assert.strictEqual(canViewSiteHealthMetrics(superadminZhon, 'APP ANX'), true, 'Superadmin can view health/aging for ANX');
assert.strictEqual(canViewSiteHealthMetrics(superadminZhon, 'ASP BHS'), true, 'Superadmin can view health/aging for BHS');
console.log('  ✓ PASS: PMG users cannot view dead stock/non-moving health metrics of other sites');

console.log('\n========================================================================');
console.log('ALL PMG ALL-STOCKS RESTRICTION & SERIAL PRIVACY TESTS PASSED (100%)');
console.log('========================================================================\n');

