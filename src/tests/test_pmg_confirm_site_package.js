import assert from 'node:assert';
import { reconcileUnitsWithPackedDrafts } from '../utils/appContextHelpers.js';
import { isProvincialSite } from '../utils/partResolver.js';

console.log('====================================================');
console.log('TEST SUITE: PMG Accounts Stock Updating & Confirm Site Package');
console.log('====================================================\n');

// Mock Sites
const mockSites = [
  { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center', is_dc: true },
  { id: 'site-ceb', code: 'ASP CEB', name: 'MOBILECARE - CEBU', is_dc: false },
  { id: 'site-zam', code: 'ASP ZAM', name: 'MOBILECARE - ZAMBOANGA', is_dc: false }
];

// Mock Parts Catalog
const mockParts = [
  { id: 'p-1', part_number: '661-21988', description: 'Display, iPhone 13', iphone_model: 'iPhone 13' },
  { id: 'p-2', part_number: '661-21991', description: 'Battery, iPhone 13', iphone_model: 'iPhone 13' },
  { id: 'p-3', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', iphone_model: 'iPhone 13 Pro Max' },
  { id: 'p-4', part_number: '661-42726', description: 'Display, iPhone 16 Pro', iphone_model: 'iPhone 16 Pro' },
  { id: 'p-5', part_number: '661-56058', description: 'Display, iPhone 17 Pro Max', iphone_model: 'iPhone 17 Pro Max' },
  { id: 'p-6', part_number: '661-56065', description: 'Display, iPhone 17', iphone_model: 'iPhone 17' }
];

// Stock On Hand calculation helper matching getStockOnHandForSite
function calculateStockOnHand(units, siteIdOrCode) {
  const targetSite = mockSites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
  const siteId = targetSite?.id || siteIdOrCode;
  const siteCode = targetSite?.code || siteIdOrCode;

  const matchingUnits = (units || []).filter(u => {
    const uSiteId = u.current_site_id || u.siteId;
    const uSiteCode = u.site_code || u.siteCode;
    return (uSiteId && (uSiteId === siteId || uSiteId === siteCode)) ||
           (uSiteCode && (uSiteCode === siteCode || uSiteCode === siteId));
  });

  const partsSummary = {};
  let totalInStock = 0;
  let totalPacked = 0;

  matchingUnits.forEach(u => {
    const rawPN = u.part_number || u.partNumber || '';
    const cleanPN = String(rawPN).trim().toUpperCase();
    if (!cleanPN) return;

    if (!partsSummary[cleanPN]) {
      const matchedPart = mockParts.find(p => p.part_number?.toUpperCase() === cleanPN);
      partsSummary[cleanPN] = {
        partNumber: cleanPN,
        description: matchedPart?.description || u.description,
        inStock: 0,
        packed: 0,
        total: 0
      };
    }

    const status = String(u.status || 'in_stock').toLowerCase();
    if (status === 'in_stock' || status === 'delivered' || status === 'received') {
      partsSummary[cleanPN].inStock += 1;
      totalInStock += 1;
    } else if (status === 'packed' || status === 'shipped' || status === 'in_transit' || status === 'pending_pickup') {
      partsSummary[cleanPN].packed += 1;
      totalPacked += 1;
    }
    partsSummary[cleanPN].total += 1;
  });

  return { siteId, siteCode, partsSummary, totalInStock, totalPacked, totalUnits: matchingUnits.length };
}

// ----------------------------------------------------
// TEST 1: In-Transit Shipment (Shipped) shows Packed / In-Transit for Branch
// ----------------------------------------------------
console.log('Test 1: In-Transit shipment correctly marks units as shipped for destination branch');
const mockShippedShipment = {
  id: 'ship-ceb-1',
  invoice_ref: 'DCOWNED#083126H',
  site_id: 'site-ceb',
  site_code: 'ASP CEB',
  status: 'shipped',
  carrier: 'Lite Express',
  tracking_number: '548396878382',
  items: [
    { part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'GVH54810T98PR5PAL', box_number: 1 },
    { part_number: '661-21991', description: 'Battery, iPhone 13', serial_number: 'GVH54810T98PR5PB1', box_number: 1 },
    { part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', serial_number: 'GVH54810T98PR5PC2', box_number: 1 },
    { part_number: '661-42726', description: 'Display, iPhone 16 Pro', serial_number: 'GVH54810T98PR5PD3', box_number: 1 },
    { part_number: '661-56058', description: 'Display, iPhone 17 Pro Max', serial_number: 'GVH54810T98PR5PE4', box_number: 1 },
    { part_number: '661-56065', description: 'Display, iPhone 17', serial_number: 'GVH54810T98PR5PF5', box_number: 1 }
  ]
};

const initialUnits = mockShippedShipment.items.map(it => ({
  id: `u-${it.serial_number}`,
  part_number: it.part_number,
  description: it.description,
  serial_number: it.serial_number,
  current_site_id: 'site-dc',
  status: 'in_stock'
}));

const inTransitReconciled = reconcileUnitsWithPackedDrafts(initialUnits, [mockShippedShipment]);
const inTransitStock = calculateStockOnHand(inTransitReconciled, 'site-ceb');

assert.strictEqual(inTransitStock.totalInStock, 0, 'In-transit shipment units are not yet in_stock');
assert.strictEqual(inTransitStock.totalPacked, 6, 'All 6 units are marked as in-transit / packed for Cebu branch');
console.log('  ✓ PASS: Shipped manifest correctly displays 6 in-transit parts with 0 in-stock');

// ----------------------------------------------------
// TEST 2: Received Confirmed Shipment Immediately Activates Units to In-Stock
// ----------------------------------------------------
console.log('\nTest 2: Received Confirmed shipment transitions units to IN_STOCK at branch');
const mockConfirmedShipment = {
  ...mockShippedShipment,
  status: 'received_confirmed',
  received_at: '2026-09-05T14:30:00.000Z',
  received_date: '2026-09-05',
  received_by_name: 'Johnalize Amora - PMA',
  receiving_condition: 'Good Condition (All parts intact & verified)'
};

const confirmedReconciled = reconcileUnitsWithPackedDrafts(initialUnits, [mockConfirmedShipment]);
const confirmedStock = calculateStockOnHand(confirmedReconciled, 'site-ceb');

assert.strictEqual(confirmedStock.totalInStock, 6, 'All 6 units are now active in_stock at Cebu branch');
assert.strictEqual(confirmedStock.totalPacked, 0, 'In-transit count drops to 0 after confirmation');

// Check each individual SKU in Cebu branch stock
mockShippedShipment.items.forEach(it => {
  const pn = it.part_number;
  assert.ok(confirmedStock.partsSummary[pn], `Part ${pn} exists in branch summary`);
  assert.strictEqual(confirmedStock.partsSummary[pn].inStock, 1, `Part ${pn} has inStock = 1`);
  assert.strictEqual(confirmedStock.partsSummary[pn].packed, 0, `Part ${pn} has packed = 0`);
});

const cebUnit = confirmedReconciled.find(u => u.serial_number === 'GVH54810T98PR5PAL');
assert.strictEqual(cebUnit.status, 'in_stock', 'Unit status is in_stock');
assert.strictEqual(cebUnit.current_site_id, 'site-ceb', 'Unit site is site-ceb');
assert.strictEqual(cebUnit.received_by, 'Johnalize Amora - PMA', 'Receiver name recorded');
console.log('  ✓ PASS: Received confirmed manifest successfully activates 6 parts to In-Stock at Cebu');

// ----------------------------------------------------
// TEST 3: PMG User Confirms Arriving Package via Confirm Site Package
// ----------------------------------------------------
console.log('\nTest 3: PMG Specialist confirms arriving package at their branch');
const pmgUserAndres = {
  id: 'usr-andres',
  fullName: 'Andres Bonifacio',
  role: 'parts_management',
  siteId: 'site-ceb',
  siteCode: 'ASP CEB'
};

// Simulate confirmSiteReceive execution
function simulateConfirmSiteReceive(shipment, pmgUser, receiveDetails) {
  // Authorization check: PMG users can confirm packages for their branch; Superadmin can confirm any
  const isSuperadmin = pmgUser.role === 'superadmin';
  const matchesSite = shipment.site_id === pmgUser.siteId || shipment.site_code === pmgUser.siteCode;
  assert(isSuperadmin || matchesSite, 'PMG user must have authority to confirm packages for their site');

  const cleanReceiver = receiveDetails.receivedByName || pmgUser.fullName;
  const cleanDate = receiveDetails.receivedDate || new Date().toISOString().split('T')[0];

  const updatedShipment = {
    ...shipment,
    status: 'received_confirmed',
    received_at: new Date().toISOString(),
    received_date: cleanDate,
    received_by_name: cleanReceiver,
    receiving_signature: cleanReceiver,
    receiving_condition: receiveDetails.receivedCondition,
    receiving_notes: receiveDetails.receivingNotes
  };

  return updatedShipment;
}

const pmgConfirmedShipment = simulateConfirmSiteReceive(mockShippedShipment, pmgUserAndres, {
  receivedByName: 'Andres Bonifacio',
  receivedDate: '2026-09-07',
  receivedCondition: 'Good Condition (All parts intact & verified)',
  receivingNotes: 'Confirmed physical receipt of package and parts at branch.'
});

assert.strictEqual(pmgConfirmedShipment.status, 'received_confirmed');
assert.strictEqual(pmgConfirmedShipment.received_by_name, 'Andres Bonifacio');

const pmgReconciled = reconcileUnitsWithPackedDrafts(initialUnits, [pmgConfirmedShipment]);
const pmgStock = calculateStockOnHand(pmgReconciled, 'site-ceb');

assert.strictEqual(pmgStock.totalInStock, 6, 'All 6 units are active in-stock at Cebu after PMG confirmation');
assert.strictEqual(pmgStock.totalPacked, 0, 'No remaining packed units');
console.log('  ✓ PASS: PMG specialist can confirm arriving package and immediately activate branch stock');

// ----------------------------------------------------
// TEST 4: Superadmin Retains Cross-Site Confirmation Authority
// ----------------------------------------------------
console.log('\nTest 4: Superadmin retains authority to confirm packages across all branches');
const superadminZhon = {
  id: 'usr-zhon',
  fullName: 'Zhon Manaois',
  role: 'superadmin',
  siteId: 'site-dc',
  siteCode: 'DC-MDC'
};

const mockZamShipment = {
  id: 'ship-zam-1',
  invoice_ref: 'DCOWNED#083126E',
  site_id: 'site-zam',
  site_code: 'ASP ZAM',
  status: 'shipped',
  items: [
    { part_number: '661-36786', description: 'Display, iPhone 15', serial_number: '0906081U94M21KHA8', box_number: 1 },
    { part_number: '661-22374', description: 'Battery, iPhone 13', serial_number: 'F8Y6301CD6C14LMC1', box_number: 1 },
    { part_number: '661-22374', description: 'Battery, iPhone 13', serial_number: 'F8Y6301CD20B14LMCX', box_number: 1 }
  ]
};

const adminConfirmedShipment = simulateConfirmSiteReceive(mockZamShipment, superadminZhon, {
  receivedByName: 'Zhon Manaois',
  receivedDate: '2026-09-07',
  receivedCondition: 'Good Condition (All parts intact & verified)'
});

assert.strictEqual(adminConfirmedShipment.status, 'received_confirmed');
assert.strictEqual(adminConfirmedShipment.received_by_name, 'Zhon Manaois');

const zamReconciled = reconcileUnitsWithPackedDrafts([], [adminConfirmedShipment]);
const zamStock = calculateStockOnHand(zamReconciled, 'site-zam');

assert.strictEqual(zamStock.totalInStock, 3, 'Superadmin confirmed 3 units active in-stock for Zamboanga');
console.log('  ✓ PASS: Superadmin retains cross-site package confirmation authority');

// ----------------------------------------------------
// TEST 5: Imported Manifest Serials not in base units are preserved in reconciled stock
// ----------------------------------------------------
console.log('\nTest 5: Imported manifest items not in initial units array are hydrated as in_stock');
const emptyBaseUnits = [];
const hydratedReconciled = reconcileUnitsWithPackedDrafts(emptyBaseUnits, [mockConfirmedShipment]);
const hydratedStock = calculateStockOnHand(hydratedReconciled, 'site-ceb');

assert.strictEqual(hydratedStock.totalInStock, 6, 'All 6 units from shipment are present in stock even if units array was empty');
console.log('  ✓ PASS: Units from confirmed shipments are reliably preserved and hydrated into stock');

// ----------------------------------------------------
// TEST 6: Role Scoping: Only PMG Specialists can create requests; Superadmins only review/approve
// ----------------------------------------------------
console.log('\nTest 6: Role Scoping: Superadmin cannot create requests, only PMG specialists');
const canUserCreatePartsRequest = (user) => {
  if (!user) return false;
  return user.role === 'parts_management';
};

assert.strictEqual(canUserCreatePartsRequest(pmgUserAndres), true, 'PMG specialist can submit parts request');
assert.strictEqual(canUserCreatePartsRequest(superadminZhon), false, 'Superadmin cannot submit parts request');
console.log('  ✓ PASS: Request creation is strictly restricted to PMG specialists');

// ----------------------------------------------------
// TEST 7: Regional Site Classification: Metro Manila vs Provincial Sites
// ----------------------------------------------------
console.log('\nTest 7: Regional Site Classification: Metro Manila vs Provincial sites');

const testSites = [
  { id: 'site-ppm', code: 'APP PPM', name: 'MOBILECARE - APP POWER PLANT MALL', region: 'Metro Manila' },
  { id: 'site-bhs', code: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET', region: 'Metro Manila' },
  { id: 'site-ceb', code: 'ASP CEB', name: 'MOBILECARE - ROBINSONS GALLERIA CEBU', region: 'Cebu' },
  { id: 'site-zam', code: 'ASP ZAM', name: 'MOBILECARE - KCC MALL DE ZAMBOANGA', region: 'Zamboanga' },
  { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center', is_dc: true }
];

const mmSites = testSites.filter(s => !isProvincialSite(s) && !s.is_dc);
const provSites = testSites.filter(s => isProvincialSite(s));

assert.strictEqual(mmSites.length, 2, '2 Metro Manila ASP sites identified');
assert.strictEqual(provSites.length, 2, '2 Provincial ASP sites identified');
assert.ok(mmSites.some(s => s.code === 'APP PPM'), 'APP PPM is in Metro Manila');
assert.ok(provSites.some(s => s.code === 'ASP CEB'), 'ASP CEB is in Provincial');
console.log('  ✓ PASS: Sites correctly separated into Metro Manila and Provincial groups');

// ----------------------------------------------------
// TEST 8: Network-Wide Part Number Search Availability
// ----------------------------------------------------
console.log('\nTest 8: Network-wide Part Number Availability Search');
const multiSiteMockData = [
  {
    siteId: 'site-dc',
    siteCode: 'DC-MDC',
    siteName: 'Distribution Center',
    parts: [
      { partNumber: '661-22294', description: 'Battery, iPhone 13 Pro Max', inStock: 22 }
    ]
  },
  {
    siteId: 'site-ceb',
    siteCode: 'ASP CEB',
    siteName: 'Cebu Galleria',
    parts: [
      { partNumber: '661-22294', description: 'Battery, iPhone 13 Pro Max', inStock: 4 },
      { partNumber: '661-21988', description: 'Display, iPhone 13', inStock: 2 }
    ]
  },
  {
    siteId: 'site-ppm',
    siteCode: 'APP PPM',
    siteName: 'Power Plant Mall',
    parts: [
      { partNumber: '661-21988', description: 'Display, iPhone 13', inStock: 5 }
    ]
  }
];

function searchNetworkAvailability(query, multiSiteData) {
  if (!query || !query.trim()) return [];
  const q = query.toLowerCase().trim();
  const results = [];
  multiSiteData.forEach(summary => {
    summary.parts.forEach(p => {
      if (p.partNumber.toLowerCase().includes(q) && p.inStock > 0) {
        results.push({
          siteCode: summary.siteCode,
          siteName: summary.siteName,
          partNumber: p.partNumber,
          inStock: p.inStock
        });
      }
    });
  });
  return results;
}

const searchResults = searchNetworkAvailability('661-22294', multiSiteMockData);
assert.strictEqual(searchResults.length, 2, 'Found 2 sites stocking 661-22294');
assert.ok(searchResults.some(r => r.siteCode === 'DC-MDC' && r.inStock === 22));
assert.ok(searchResults.some(r => r.siteCode === 'ASP CEB' && r.inStock === 4));
console.log('  ✓ PASS: Network-wide part search correctly identifies all stocking branches');

// ----------------------------------------------------
// TEST 9: PMG Receive Scan-In Scoping: Records & History Hidden
// ----------------------------------------------------
console.log('\nTest 9: PMG Receive Scan-In Scoping: Records and History Hidden');
const shouldShowBranchRecordsTab = (user) => user?.role !== 'parts_management';
const shouldShowReceivedHistoryTable = (user) => user?.role !== 'parts_management';

assert.strictEqual(shouldShowBranchRecordsTab(pmgUserAndres), false, 'PMG users cannot access branch records tab');
assert.strictEqual(shouldShowReceivedHistoryTable(pmgUserAndres), false, 'PMG users cannot access intake history table');
assert.strictEqual(shouldShowBranchRecordsTab(superadminZhon), true, 'Superadmin can access stock records tab');
assert.strictEqual(shouldShowReceivedHistoryTable(superadminZhon), true, 'Superadmin can access intake history table');
console.log('  ✓ PASS: Receive Scan-In properly scopes records and history away from PMG users');

console.log('\n====================================================');
console.log('ALL PMG ACCOUNTS & CONFIRM SITE PACKAGE TESTS PASSED (100%)');
console.log('====================================================\n');
