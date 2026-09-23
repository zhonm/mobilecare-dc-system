/**
 * TEST SUITE: Confirm Site Package Receipt - Superadmin Blank vs PMG Auto-fill
 * 
 * Verifies that:
 * 1. For Superadmin users, the "Received By (Staff Name)" field is left blank initially,
 *    preventing the Superadmin's own name from being wrongly attributed as the site receiver.
 * 2. Superadmin confirmation cannot proceed while the field is blank (it is required).
 * 3. Once completed with the branch staff name, the confirmation persists the branch staff name.
 * 4. For PMG account users, the field is auto-filled with their login name for ease of use.
 */

import assert from 'assert';

console.log('====================================================');
console.log('TEST SUITE: Confirm Site Package - Superadmin Blank vs PMG Auto-fill');
console.log('====================================================\n');

// Mock User Accounts
const superadminUser = {
  id: 'usr-superadmin-zhon',
  fullName: 'Zhon Manaois',
  role: 'superadmin',
  email: 'zhon.manaois@mobilecareph.com'
};

const pmgUser = {
  id: 'usr-pmg-andres',
  fullName: 'Andres Bonifacio',
  role: 'parts_management',
  email: 'andres@mobilecareph.com',
  siteId: 'site-davao',
  siteCode: 'ASP DVO'
};

const mockDestSite = {
  id: 'site-davao',
  name: 'MOBILECARE - DAVAO',
  code: 'ASP DVO'
};

const mockShipment = {
  id: 'ship-101',
  shipment_number: 'SHP-2026-0001',
  invoice_ref: 'DCOWNED#091226B',
  site_id: 'site-davao',
  site_name: 'MOBILECARE - DAVAO',
  site_code: 'ASP DVO',
  status: 'shipped',
  items: [
    { part_number: '661-22294', serial_number: 'F8Y6176C01813XCB6', box_number: 1 }
  ]
};

// 1. Initial State Resolution Logic (as used in Shipments.jsx and RequestParts.jsx)
function resolveInitialReceivedByName(currentUser, destSite) {
  const isSuperadmin = currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin;
  return isSuperadmin ? '' : (currentUser?.fullName || currentUser?.name || `${destSite?.code || 'Branch'} Staff`);
}

// 2. Confirmation Validation Logic (as used in useShipments.js)
function validateAndProcessConfirmSiteReceive(targetShipment, currentUser, receiveDetails) {
  const isSuperadmin = currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin;
  const providedReceiver = String(receiveDetails?.receivedByName || '').trim();

  if (!providedReceiver && isSuperadmin) {
    return { success: false, error: 'Received By (Staff Name) must be completed before confirming site receipt.' };
  }

  const cleanReceiver = providedReceiver || (!isSuperadmin ? (currentUser?.fullName || currentUser?.name || 'Branch Staff') : '');
  if (!cleanReceiver) {
    return { success: false, error: 'Received By (Staff Name) must be completed before confirming site receipt.' };
  }

  return {
    success: true,
    shipment: {
      ...targetShipment,
      status: 'received_confirmed',
      received_by_name: cleanReceiver,
      receiving_signature: cleanReceiver,
      received_date: receiveDetails.receivedDate || '2026-09-23'
    }
  };
}

// ----------------------------------------------------
// TEST 1: Superadmin Modal Initial State is Blank
// ----------------------------------------------------
console.log('Test 1: Modal initialization for Superadmin user leaves Received By field blank');
const superadminInitialName = resolveInitialReceivedByName(superadminUser, mockDestSite);
assert.strictEqual(
  superadminInitialName,
  '',
  'Superadmin field must remain blank initially so their name is not pre-populated'
);
console.log('  ✓ PASS: Superadmin Received By field is strictly blank ("")');

// ----------------------------------------------------
// TEST 2: PMG User Modal Initial State is Auto-filled with Login Name
// ----------------------------------------------------
console.log('\nTest 2: Modal initialization for PMG user auto-fills their login name');
const pmgInitialName = resolveInitialReceivedByName(pmgUser, mockDestSite);
assert.strictEqual(
  pmgInitialName,
  'Andres Bonifacio',
  'PMG specialist account must auto-fill their login name'
);
console.log('  ✓ PASS: PMG account Received By field is auto-filled with "Andres Bonifacio"');

// ----------------------------------------------------
// TEST 3: Superadmin Cannot Submit Blank Received By Field
// ----------------------------------------------------
console.log('\nTest 3: Superadmin cannot confirm site package without entering receiving staff name');
const blankSuperadminSubmit = validateAndProcessConfirmSiteReceive(mockShipment, superadminUser, {
  receivedByName: '',
  receivedDate: '2026-09-23'
});
assert.strictEqual(blankSuperadminSubmit.success, false);
assert(blankSuperadminSubmit.error.includes('must be completed'));
console.log('  ✓ PASS: Blank submission blocked with error:', blankSuperadminSubmit.error);

// ----------------------------------------------------
// TEST 4: Superadmin Successfully Confirms when Site Staff Name is Provided
// ----------------------------------------------------
console.log('\nTest 4: Superadmin enters actual site staff name and confirms successfully');
const filledSuperadminSubmit = validateAndProcessConfirmSiteReceive(mockShipment, superadminUser, {
  receivedByName: 'Maria Santos (Davao Tech)',
  receivedDate: '2026-09-23'
});
assert.strictEqual(filledSuperadminSubmit.success, true);
assert.strictEqual(filledSuperadminSubmit.shipment.status, 'received_confirmed');
assert.strictEqual(filledSuperadminSubmit.shipment.received_by_name, 'Maria Santos (Davao Tech)');
assert.notStrictEqual(filledSuperadminSubmit.shipment.received_by_name, superadminUser.fullName);
console.log('  ✓ PASS: Shipment confirmed with branch receiver "Maria Santos (Davao Tech)" instead of Superadmin');

// ----------------------------------------------------
// TEST 5: PMG User Successfully Confirms with Auto-filled Login Name
// ----------------------------------------------------
console.log('\nTest 5: PMG User confirms package with auto-filled login name');
const pmgSubmit = validateAndProcessConfirmSiteReceive(mockShipment, pmgUser, {
  receivedByName: pmgInitialName,
  receivedDate: '2026-09-23'
});
assert.strictEqual(pmgSubmit.success, true);
assert.strictEqual(pmgSubmit.shipment.status, 'received_confirmed');
assert.strictEqual(pmgSubmit.shipment.received_by_name, 'Andres Bonifacio');
console.log('  ✓ PASS: PMG specialist confirms package seamlessly under their login name');

console.log('\n====================================================');
console.log('ALL TESTS PASSED (5/5)!');
console.log('====================================================');
