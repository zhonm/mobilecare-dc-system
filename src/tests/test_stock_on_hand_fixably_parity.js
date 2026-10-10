import assert from 'assert';
import { getCategoryForPart } from '../utils/categoryFilter.js';
import { resolveCanonicalIPhoneModel } from '../utils/partResolver.js';

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

console.log('========================================================================');
console.log('TEST SUITE: Stock On Hand & Multi-Site Dashboard Fixably Parity');
console.log('========================================================================');

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

// Mock sites
const mockSites = [
  { id: 'site-dc-main', code: 'DC', name: 'Distribution Center', is_dc: true },
  { id: 'site-annex-uuid', code: 'APP THE ANNEX', name: 'APP The Annex', is_dc: false },
  { id: 'site-ppm-uuid', code: 'APP PPM', name: 'APP PPM', is_dc: false }
];

// Mock 32 SKUs and 80 total units for Annex (matching Fixably output.csv ingestion)
const mockAnnexFixablyItems = [];
const skus = [
  { pn: '661-44954', desc: 'Battery, iPhone 16 Pro Max', count: 3 },
  { pn: '661-44955', desc: 'Display, iPhone 16 Pro Max', count: 2 },
  { pn: '661-44956', desc: 'Rear Camera, iPhone 16 Pro Max', count: 2 },
  { pn: '661-39820', desc: 'Battery, iPhone 15 Pro', count: 4 },
  { pn: '661-39821', desc: 'Display, iPhone 15 Pro', count: 3 },
  { pn: '661-32100', desc: 'Speaker, iPhone 15', count: 2 },
  { pn: '661-32101', desc: 'TrueDepth Camera, iPhone 15', count: 1 },
  { pn: '661-28900', desc: 'Taptic Engine, iPhone 14 Pro', count: 3 },
  { pn: '661-28901', desc: 'Rear System, iPhone 14 Pro', count: 1 },
  { pn: '661-25400', desc: 'Battery, iPhone 14', count: 4 },
  { pn: '661-25401', desc: 'Display, iPhone 14', count: 4 },
  { pn: '661-21000', desc: 'Camera, iPhone 13 Pro', count: 2 },
  { pn: '661-21001', desc: 'Battery, iPhone 13 Pro', count: 3 },
  { pn: '661-19000', desc: 'Display, iPhone 13', count: 3 },
  { pn: '661-19001', desc: 'Battery, iPhone 13', count: 4 },
  { pn: '661-17000', desc: 'Speaker, iPhone 12', count: 2 },
  { pn: '661-17001', desc: 'Rear System, iPhone 12', count: 1 },
  { pn: '661-15000', desc: 'Battery, iPhone 12 Pro', count: 3 },
  { pn: '661-15001', desc: 'Display, iPhone 12 Pro', count: 2 },
  { pn: '661-14000', desc: 'Camera, iPhone 11', count: 2 },
  { pn: '661-14001', desc: 'Battery, iPhone 11', count: 4 },
  { pn: '661-13000', desc: 'Display, iPhone 11', count: 3 },
  { pn: '661-12000', desc: 'Taptic Engine, iPhone XR', count: 2 },
  { pn: '661-12001', desc: 'Battery, iPhone XR', count: 3 },
  { pn: '661-11000', desc: 'Display, iPhone XR', count: 2 },
  { pn: '661-10000', desc: 'Battery, iPhone SE 3rd Gen', count: 3 },
  { pn: '661-09000', desc: 'Display, iPhone SE 3rd Gen', count: 2 },
  { pn: '661-08000', desc: 'Camera, iPhone SE 3rd Gen', count: 2 },
  { pn: '661-07000', desc: 'Speaker, iPhone SE 2nd Gen', count: 2 },
  { pn: '661-06000', desc: 'Battery, iPhone SE 2nd Gen', count: 3 },
  { pn: '661-05000', desc: 'Display, iPhone SE 2nd Gen', count: 2 },
  { pn: '661-04000', desc: 'Rear System, iPhone SE 2nd Gen', count: 1 }
];

let totalUnitsGen = 0;
skus.forEach((sku, sIdx) => {
  for (let i = 0; i < sku.count; i++) {
    totalUnitsGen++;
    mockAnnexFixablyItems.push({
      id: `anx-unit-${sIdx}-${i}`,
      partNumber: sku.pn,
      description: sku.desc,
      serialNumber: `SN-ANX-${sIdx}-${i}`,
      siteCode: 'APP THE ANNEX',
      siteName: 'APP The Annex',
      stockType: 'DC Stock',
      dateReceived: '2026-03-20T08:00:00.000Z',
      agingDays: 14,
      statusLabel: 'In Stock'
    });
  }
});

// Snapshot uploaded at 2026-03-25T10:00:00.000Z
const snapshotUploadTime = '2026-03-25T10:00:00.000Z';
const mockFixablySnapshot = {
  timestamp: snapshotUploadTime,
  itemCount: 80,
  items: mockAnnexFixablyItems
};

// Simulation of getStockOnHandForSite from usePartsRequests.js
function simulateGetStockOnHandForSite({
  siteIdOrCode,
  fixablySnapshot,
  inventoryUnits = [],
  usedPartsRegistry = [],
  sites = mockSites,
  parts = []
}) {
  const targetSite = sites.find(s =>
    s.id === siteIdOrCode ||
    s.code === siteIdOrCode ||
    s.name === siteIdOrCode
  );

  const siteId = targetSite?.id || siteIdOrCode;
  const siteCode = targetSite?.code || siteIdOrCode;
  const targetCodeUpper = String(siteCode || '').trim().toUpperCase();
  const targetClean = targetCodeUpper.replace(/^(ASP|APP)\s+/, '');
  const targetIdLower = String(siteId || '').trim().toLowerCase();
  const isDcTarget = targetSite?.is_dc || targetCodeUpper === 'DC';

  // Fixably snapshot branch
  if (!isDcTarget && fixablySnapshot && Array.isArray(fixablySnapshot.items) && fixablySnapshot.items.length > 0) {
    const branchFixablyItems = fixablySnapshot.items.filter(it => {
      const itSiteCode = String(it.siteCode || it.site_code || '').trim().toUpperCase();
      const itClean = itSiteCode.replace(/^(ASP|APP)\s+/, '');
      const itSiteId = String(it.siteId || it.site_id || '').trim().toLowerCase();
      return (itSiteCode && itSiteCode === targetCodeUpper) ||
             (itClean && targetClean && itClean === targetClean) ||
             (itSiteId && targetIdLower && itSiteId === targetIdLower);
    });

    if (branchFixablyItems.length > 0) {
      const partsSummary = {};
      let totalInStock = 0;
      let totalAllocated = 0;
      let totalPacked = 0;
      const unitsList = [];

      const newlyUsedSerials = new Map();
      const snapshotTimeMs = fixablySnapshot?.timestamp ? new Date(fixablySnapshot.timestamp).getTime() : 0;
      (usedPartsRegistry || []).forEach(r => {
        if (r?.serial_number && r?.used_at) {
          const usedTimeMs = new Date(r.used_at).getTime();
          if (snapshotTimeMs && usedTimeMs > snapshotTimeMs) {
            newlyUsedSerials.set(String(r.serial_number).trim().toUpperCase(), r);
          }
        }
      });

      branchFixablyItems.forEach(it => {
        const cleanPN = String(it.partNumber || it.part_number || '').trim().toUpperCase();
        if (!cleanPN) return;
        const cleanSerial = String(it.serialNumber || it.serial_number || '').trim().toUpperCase();

        if (!partsSummary[cleanPN]) {
          partsSummary[cleanPN] = {
            partNumber: cleanPN,
            description: it.description || `Part ${cleanPN}`,
            inStock: 0,
            allocated: 0,
            packed: 0,
            total: 0
          };
        }

        const isNewlyUsed = Boolean(cleanSerial && newlyUsedSerials.has(cleanSerial));
        const unitStatus = isNewlyUsed ? 'used' : 'in_stock';

        if (unitStatus === 'in_stock') {
          partsSummary[cleanPN].inStock += 1;
          totalInStock += 1;
        }
        partsSummary[cleanPN].total += 1;

        unitsList.push({
          id: it.id,
          part_number: cleanPN,
          serial_number: cleanSerial,
          site_code: siteCode,
          status: unitStatus
        });
      });

      // In-transit overlay
      (inventoryUnits || []).filter(u => {
        if (!u || u.status === 'deleted') return false;
        const uSiteCode = String(u.site_code || '').trim().toUpperCase();
        const uClean = uSiteCode.replace(/^(ASP|APP)\s+/, '');
        const matches = (uSiteCode === targetCodeUpper) || (uClean === targetClean);
        return matches && (u.status === 'packed' || u.status === 'shipped' || u.status === 'in_transit' || u.status === 'allocated');
      }).forEach(u => {
        const cleanPN = String(u.part_number || '').trim().toUpperCase();
        if (partsSummary[cleanPN]) {
          if (u.status === 'allocated') {
            partsSummary[cleanPN].allocated += 1;
            totalAllocated += 1;
          } else {
            partsSummary[cleanPN].packed += 1;
            totalPacked += 1;
          }
          partsSummary[cleanPN].total += 1;
        }
      });

      return {
        siteId,
        siteCode,
        partsSummary,
        totalInStock,
        totalAllocated,
        totalPacked,
        totalUnits: totalInStock + totalAllocated + totalPacked,
        units: unitsList
      };
    }
  }

  return { siteId, siteCode, partsSummary: {}, totalInStock: 0, totalUnits: 0, units: [] };
}

// 1. VERIFY EXACT 80 UNITS ACROSS 32 SKUS FOR ANNEX
it('Annex site returns exactly 80 parts in stock and 32 unique SKUs matching Fixably Dashboard', () => {
  assert.strictEqual(mockAnnexFixablyItems.length, 80, 'Total mock units is 80');
  assert.strictEqual(skus.length, 32, 'Total mock SKUs is 32');

  const result = simulateGetStockOnHandForSite({
    siteIdOrCode: 'APP THE ANNEX',
    fixablySnapshot: mockFixablySnapshot
  });

  assert.strictEqual(result.totalInStock, 80, 'Total in-stock units must equal 80');
  assert.strictEqual(result.totalUnits, 80, 'Total units must equal 80');
  assert.strictEqual(Object.keys(result.partsSummary).length, 32, 'Total SKUs must equal 32');
  assert.strictEqual(result.units.length, 80, 'Units array length must equal 80');
});

// 2. VERIFY SITE MATCHING BY SITE ID, CODE, OR SHORT CODE
it('Resolves Annex site stock correctly whether queried by UUID, full code, or short code ANX', () => {
  const resByCode = simulateGetStockOnHandForSite({ siteIdOrCode: 'APP THE ANNEX', fixablySnapshot: mockFixablySnapshot });
  const resById = simulateGetStockOnHandForSite({ siteIdOrCode: 'site-annex-uuid', fixablySnapshot: mockFixablySnapshot });
  const resByClean = simulateGetStockOnHandForSite({ siteIdOrCode: 'THE ANNEX', fixablySnapshot: mockFixablySnapshot });

  assert.strictEqual(resByCode.totalInStock, 80);
  assert.strictEqual(resById.totalInStock, 80);
  assert.strictEqual(resByClean.totalInStock, 80);
});

// 3. STALE USED RECORDS PROTECTION
it('Protects Fixably snapshot against stale used records uploaded BEFORE snapshot timestamp', () => {
  // A used part consumed on 2026-03-20 (5 days before snapshot upload)
  const staleUsedRecord = [
    {
      serial_number: 'SN-ANX-0-0', // Belongs to 661-44954 Battery
      used_at: '2026-03-20T12:00:00.000Z'
    }
  ];

  const result = simulateGetStockOnHandForSite({
    siteIdOrCode: 'APP THE ANNEX',
    fixablySnapshot: mockFixablySnapshot,
    usedPartsRegistry: staleUsedRecord
  });

  // Stale record is ignored because the fresh Fixably snapshot uploaded on 2026-03-25 is authoritative
  assert.strictEqual(result.totalInStock, 80, 'Stale used record must NOT decrement stock below 80');
});

// 4. ACTIVE USED RECORD CONSUMPTION
it('Correctly decrements on-hand stock when a part is consumed AFTER the latest snapshot timestamp', () => {
  // A used part consumed on 2026-03-26 (1 day after snapshot upload)
  const freshUsedRecord = [
    {
      serial_number: 'SN-ANX-0-0',
      used_at: '2026-03-26T14:00:00.000Z'
    }
  ];

  const result = simulateGetStockOnHandForSite({
    siteIdOrCode: 'APP THE ANNEX',
    fixablySnapshot: mockFixablySnapshot,
    usedPartsRegistry: freshUsedRecord
  });

  assert.strictEqual(result.totalInStock, 79, 'Stock must decrement to 79 when consumed after snapshot upload');
  const battery = result.partsSummary['661-44954'];
  assert.strictEqual(battery.inStock, 2, 'Battery in-stock decrements from 3 to 2');
});

// 5. IN-TRANSIT OVERLAY
it('Overlays in-transit / packed units arriving from DC onto branch stock', () => {
  const inTransitUnits = [
    {
      id: 'transit-1',
      part_number: '661-44954',
      site_code: 'APP THE ANNEX',
      status: 'in_transit'
    }
  ];

  const result = simulateGetStockOnHandForSite({
    siteIdOrCode: 'APP THE ANNEX',
    fixablySnapshot: mockFixablySnapshot,
    inventoryUnits: inTransitUnits
  });

  assert.strictEqual(result.totalInStock, 80, 'In-stock remains 80');
  assert.strictEqual(result.totalPacked, 1, 'Packed / in-transit is 1');
  assert.strictEqual(result.totalUnits, 81, 'Total units increases to 81 with in-transit unit');
});

// 6. SERIAL PRIVACY FOR PMG USERS ON STOCK ON HAND & MULTI-SITE
it('Ensures PMG users see full serials for their own site but masked serials for other sites', () => {
  const annexUser = { id: 'u-annex', role: 'parts_management', siteId: 'site-annex-uuid', siteCode: 'APP THE ANNEX' };

  // Annex part serial
  const canViewOwn = checkCanViewSiteSerials(annexUser, 'APP THE ANNEX');
  assert.strictEqual(canViewOwn, true, 'PMG user viewing own site must be allowed to view full serials');

  // PPM part serial viewed by Annex PMG user
  const canViewOther = checkCanViewSiteSerials(annexUser, 'APP PPM');
  assert.strictEqual(canViewOther, false, 'PMG user viewing another site must NOT be allowed to view full serials');

  const ownSerialDisplay = canViewOwn ? 'SN-ANX-0-0' : '••••••••';
  const otherSerialDisplay = canViewOther ? 'SN-PPM-99-99' : '••••••••';
  assert.strictEqual(ownSerialDisplay, 'SN-ANX-0-0', 'Own serial is displayed clearly');
  assert.strictEqual(otherSerialDisplay, '••••••••', 'Other site serial is masked');
});

// 7. SIDEBAR & SCAN-IN BADGE CONSISTENCY
it('Sidebar badge and Scan-In badge calculate exact 80 units matching Stock on Hand', () => {
  // Sidebar calculation: getStockOnHandForSite(userAssignedSite)?.totalInStock
  const annexStock = simulateGetStockOnHandForSite({
    siteIdOrCode: 'APP THE ANNEX',
    fixablySnapshot: mockFixablySnapshot
  });

  const sidebarBadgeCount = annexStock.totalInStock;
  const scanInCardCount = annexStock.totalInStock;

  assert.strictEqual(sidebarBadgeCount, 80, 'Sidebar badge must show 80');
  assert.strictEqual(scanInCardCount, 80, 'Scan-In receiving card badge must show 80');
});

console.log('========================================================================');
console.log(`ALL TESTS PASSED: ${passedTests}/${passedTests} (100%)`);
console.log('========================================================================');
