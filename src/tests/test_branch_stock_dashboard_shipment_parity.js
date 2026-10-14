import assert from 'assert';
import {
  isShipmentActive,
  filterActiveOutboundShipments,
  calculateActiveQueuePartsCount
} from '../utils/shipmentHelpers.js';
import { resolveSite } from '../utils/appContextHelpers.js';

console.log('========================================================================');
console.log('TEST SUITE: Branch Stock On Hand & Dashboard Active Shipment Parity');
console.log('========================================================================\n');

const mockSites = [
  { id: 'site-dc', code: 'DC-MDC', name: 'MobileCare Central DC', is_dc: true },
  { id: 'site-abr', code: 'ASP ABR', name: 'MobileCare Abreeza Mall' },
  { id: 'site-zam', code: 'ASP ZAM', name: 'MobileCare Zamboanga' },
  { id: 'site-lim', code: 'ASP LIM', name: 'MobileCare Limketkai' },
  { id: 'site-npm', code: 'ASP NPM', name: 'MobileCare Northpoint Mall' },
  { id: 'site-cdo', code: 'ASP CDO', name: 'MobileCare Cagayan De Oro' }
];

// Helper reproducing RequestParts.jsx incomingShipments filter
function getIncomingShipmentsForBranch(shipments, currentUser, sites, selectedSiteId = 'ALL') {
  const isSuperadmin = currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin;
  const userResolved = resolveSite(currentUser?.siteId || currentUser?.site_id || currentUser?.siteCode, sites);
  const targetSiteId = isSuperadmin && selectedSiteId !== 'ALL' ? selectedSiteId : userResolved.id;
  const targetSiteCode = isSuperadmin && selectedSiteId !== 'ALL'
    ? (sites.find(s => s.id === selectedSiteId)?.code || selectedSiteId)
    : userResolved.code;

  return (shipments || []).filter(sh => {
    if (!sh.items || sh.items.length === 0) return false;
    if (!isShipmentActive(sh)) return false;

    // Draft or packing manifests are DC packing lists that have not been dispatched
    const normStatus = String(sh.status || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (normStatus === 'draft' || normStatus === 'packing') return false;

    if (selectedSiteId === 'ALL' && isSuperadmin) return true;

    const shSite = resolveSite(sh.site_id || sh.site_code || sh.siteId || sh.siteCode, sites);
    const matchesSite = (shSite.id && (shSite.id === targetSiteId || shSite.id === targetSiteCode)) ||
                        (shSite.code && targetSiteCode && shSite.code.toUpperCase() === String(targetSiteCode).toUpperCase()) ||
                        (sh.site_id && (sh.site_id === targetSiteId || sh.site_id === targetSiteCode)) ||
                        (sh.site_code && (sh.site_code === targetSiteCode || sh.site_code === targetSiteId));
    return matchesSite;
  });
}

// -----------------------------------------------------------------------------
// Test 1: User's Exact Discrepancy Scenario (5 Historical Received Manifests)
// -----------------------------------------------------------------------------
console.log('--- Test 1: User Scenario - 5 Manifests with Receipt Confirmation ---');

const userReportedManifests = [
  {
    id: 'shp-1',
    invoice_ref: 'DCOWNED#091126J',
    site_id: 'site-abr',
    site_code: 'ASP ABR',
    status: 'shipped',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00Z',
    items: new Array(25).fill({ serial_number: 'SN-J', part_number: '661-13575' })
  },
  {
    id: 'shp-2',
    invoice_ref: 'DCOWNED#091126H',
    site_id: 'site-zam',
    site_code: 'ASP ZAM',
    status: 'shipped',
    received_date: '2026-09-23',
    received_at: '2026-09-23T11:00:00Z',
    items: new Array(20).fill({ serial_number: 'SN-H', part_number: '661-21988' })
  },
  {
    id: 'shp-3',
    invoice_ref: 'DCOWNED#091126L',
    site_id: 'site-lim',
    site_code: 'ASP LIM',
    status: 'received_confirmed',
    received_date: '2026-09-19',
    received_at: '2026-09-19T08:00:00Z',
    items: new Array(30).fill({ serial_number: 'SN-L', part_number: '661-44797' })
  },
  {
    id: 'shp-4',
    invoice_ref: 'DCOWNED#091226A',
    site_id: 'site-npm',
    site_code: 'ASP NPM',
    status: 'shipped',
    received_confirmed_at: '2026-09-19T08:00:00Z',
    items: new Array(23).fill({ serial_number: 'SN-A', part_number: '661-44955' })
  },
  {
    id: 'shp-5',
    invoice_ref: 'DCOWNED#091226C',
    site_id: 'site-cdo',
    site_code: 'ASP CDO',
    status: 'received_confirmed',
    received_date: '2026-09-19',
    items: new Array(17).fill({ serial_number: 'SN-C', part_number: '661-13575' })
  }
];

// Dashboard calculation
const dashboardActive = filterActiveOutboundShipments(userReportedManifests);
const dashboardPartsQueue = calculateActiveQueuePartsCount(null, dashboardActive);

// Branch Stock On Hand calculation (Superadmin view with ALL sites)
const superadminUser = { id: 'usr-admin', role: 'superadmin', fullName: 'Superadmin User' };
const branchStockIncomingSuper = getIncomingShipmentsForBranch(userReportedManifests, superadminUser, mockSites, 'ALL');

// Branch Stock On Hand calculation (Branch Specialist logged in to ASP ABR)
const abrUser = { id: 'usr-abr', role: 'branch_technician', siteId: 'site-abr', fullName: 'Abreeza Tech' };
const branchStockIncomingAbr = getIncomingShipmentsForBranch(userReportedManifests, abrUser, mockSites);

assert.strictEqual(dashboardActive.length, 0, 'Dashboard must report 0 active shipments');
assert.strictEqual(dashboardPartsQueue, 0, 'Dashboard must report 0 parts in queue');
assert.strictEqual(branchStockIncomingSuper.length, 0, 'Branch Stock On Hand (Superadmin ALL) must report 0 incoming shipments');
assert.strictEqual(branchStockIncomingAbr.length, 0, 'Branch Stock On Hand (Branch user) must report 0 incoming shipments');

console.log('  ✓ PASS: Both Dashboard and Branch Stock On Hand report exactly 0 active shipments!');
console.log('  ✓ PASS: Discrepancy eliminated (5 received manifests correctly excluded from both views)');

// -----------------------------------------------------------------------------
// Test 2: Active Dispatch Synchronization (1 Genuine In-Transit Shipment)
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Genuinely Active Dispatched Shipment ---');

const activeDispatchedShipment = {
  id: 'shp-live-1',
  invoice_ref: 'DCOWNED#101426A',
  site_id: 'site-zam',
  site_code: 'ASP ZAM',
  status: 'shipped',
  shipment_date: '2026-10-14',
  carrier: 'Lite Express',
  tracking_number: 'LE-99887766',
  items: [
    { serial_number: 'SN-LIVE-1', part_number: '661-44797' },
    { serial_number: 'SN-LIVE-2', part_number: '661-21988' },
    { serial_number: 'SN-LIVE-3', part_number: '661-44955' }
  ]
};

const mixedDataset = [...userReportedManifests, activeDispatchedShipment];

const dashboardMixed = filterActiveOutboundShipments(mixedDataset);
const branchSuperMixed = getIncomingShipmentsForBranch(mixedDataset, superadminUser, mockSites, 'ALL');
const branchZamMixed = getIncomingShipmentsForBranch(mixedDataset, { id: 'usr-zam', role: 'branch_technician', siteId: 'site-zam' }, mockSites);
const branchAbrMixed = getIncomingShipmentsForBranch(mixedDataset, abrUser, mockSites);

assert.strictEqual(dashboardMixed.length, 1, 'Dashboard must report exactly 1 active shipment');
assert.strictEqual(dashboardMixed[0].invoice_ref, 'DCOWNED#101426A', 'Dashboard active shipment matches manifest');
assert.strictEqual(branchSuperMixed.length, 1, 'Branch Stock On Hand Superadmin must report exactly 1 incoming shipment');
assert.strictEqual(branchSuperMixed[0].invoice_ref, 'DCOWNED#101426A', 'Branch Stock On Hand matches manifest');
assert.strictEqual(branchZamMixed.length, 1, 'Target branch (ASP ZAM) must see the incoming shipment');
assert.strictEqual(branchAbrMixed.length, 0, 'Non-target branch (ASP ABR) must see 0 incoming shipments');

console.log('  ✓ PASS: Active dispatched manifest is visible on Dashboard and Branch Stock On Hand in lockstep');
console.log('  ✓ PASS: Target branch sees 1 package; non-target branch sees 0');

// -----------------------------------------------------------------------------
// Test 3: Dynamic Confirmation Transitions Both to Zero
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Receipt Confirmation Synchronously Drops Both to 0 ---');

const confirmedDataset = mixedDataset.map(s => {
  if (s.id === 'shp-live-1') {
    return {
      ...s,
      status: 'received_confirmed',
      received_at: '2026-10-14T14:30:00Z',
      received_date: '2026-10-14',
      received_by_name: 'Zamboanga Specialist'
    };
  }
  return s;
});

const dashboardAfterConfirm = filterActiveOutboundShipments(confirmedDataset);
const branchAfterConfirm = getIncomingShipmentsForBranch(confirmedDataset, superadminUser, mockSites, 'ALL');

assert.strictEqual(dashboardAfterConfirm.length, 0, 'Dashboard active shipments drops to 0');
assert.strictEqual(branchAfterConfirm.length, 0, 'Branch Stock On Hand incoming shipments drops to 0');

console.log('  ✓ PASS: Confirming package receipt transitions both pages to 0 active shipments simultaneously');

// -----------------------------------------------------------------------------
// Test 4: Draft Shipments in DC Preparation Not Counted as Branch In-Transit
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: DC Draft Manifests Excluded from Branch In-Transit ---');

const draftShipment = {
  id: 'shp-draft-1',
  invoice_ref: 'DCOWNED#101426B',
  site_id: 'site-abr',
  site_code: 'ASP ABR',
  status: 'draft',
  items: [{ serial_number: 'SN-DRAFT-1', part_number: '661-13575' }]
};

const datasetWithDraft = [draftShipment];

// On branch stock on hand, a draft packing list is not en route from DC
const branchIncomingDraft = getIncomingShipmentsForBranch(datasetWithDraft, abrUser, mockSites);
assert.strictEqual(branchIncomingDraft.length, 0, 'Branch incoming shipments must exclude DC draft manifests');

console.log('  ✓ PASS: Draft packing list is excluded from incoming in-transit packages awaiting site confirmation');

console.log('\n========================================================================');
console.log('ALL BRANCH STOCK & DASHBOARD SHIPMENT PARITY TESTS PASSED (100%)');
console.log('========================================================================\n');
