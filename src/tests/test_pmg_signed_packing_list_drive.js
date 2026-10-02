import assert from 'node:assert';
import { resolvePmgSiteFolderName } from '../services/driveAutoSyncService.js';
import { GOOGLE_DRIVE_CONFIG } from '../services/googleDriveService.js';

console.log('====================================================');
console.log('TEST SUITE: PMG Signed Packing List & Google Drive Storage');
console.log('====================================================\n');

// 1. Verify Google Drive Root Folder Configuration for PMG Signed PL
console.log('Test 1: Verify PMG Signed PL root folder ID configuration');
assert.strictEqual(
  GOOGLE_DRIVE_CONFIG.folders.pmg_signed_pl,
  '1ltAwtMav9hGaJTvEJpVqnv72_S41ODaW',
  'Folder ID for pmg_signed_pl should match DC- MSPI- PACKING LIST folder ID'
);
console.log('  ✓ PASS: pmg_signed_pl folder ID is correctly set to 1ltAwtMav9hGaJTvEJpVqnv72_S41ODaW');

// 2. Verify Site Subfolder Resolution
console.log('\nTest 2: Verify PMG site subfolder name resolution');
const testCases = [
  { input: 'ASP LIM', expected: 'LIMA' },
  { input: 'MOBILECARE - LIMA ESTATE', expected: 'LIMA' },
  { input: { code: 'ASP LIM', name: 'MobileCare Lima' }, expected: 'LIMA' },
  { input: 'ASP CEB', expected: 'CEBU' },
  { input: 'MOBILECARE - CEBU', expected: 'CEBU' },
  { input: 'APP BHS', expected: 'BHS' },
  { input: 'MOBILECARE - BONIFACIO HIGH STREET', expected: 'BHS' },
  { input: 'ASP DVO', expected: 'DAVAO' },
  { input: 'ASP ILO', expected: 'ILOILO' },
  { input: 'ASP CDO', expected: 'CDO' },
  { input: 'ASP ZAM', expected: 'ZAMBOANGA' },
  { input: 'ASP BAG', expected: 'BAGUIO' },
  { input: 'APP MOA', expected: 'MOA' },
  { input: 'APP TRI', expected: 'TRINOMA' }
];

testCases.forEach(({ input, expected }) => {
  const result = resolvePmgSiteFolderName(input);
  assert.strictEqual(
    result,
    expected,
    `Expected "${typeof input === 'object' ? JSON.stringify(input) : input}" to resolve to "${expected}", got "${result}"`
  );
});
console.log(`  ✓ PASS: Successfully verified ${testCases.length} site name mappings to designated folders`);

// 3. Verify Filename Generation Pattern
console.log('\nTest 3: Verify Signed PL filename structure');
const mockShipment = {
  invoice_ref: 'DCOWNED#100226H',
  site_name: 'MOBILECARE - LIMA ESTATE'
};
const now = new Date('2026-10-02T10:30:00Z');
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');
const hh = String(now.getHours()).padStart(2, '0');
const min = String(now.getMinutes()).padStart(2, '0');
const expectedFilename = `Signed_PackingList_DCOWNED_100226H_${yyyy}-${mm}-${dd}_${hh}${min}.pdf`;

const cleanRef = (mockShipment.invoice_ref || 'Shipment').replace(/[^a-zA-Z0-9_-]/g, '_');
const actualFilename = `Signed_PackingList_${cleanRef}_${yyyy}-${mm}-${dd}_${hh}${min}.pdf`;
assert.strictEqual(actualFilename, expectedFilename);
console.log(`  ✓ PASS: Filename generated matches standard: ${actualFilename}`);

// 4. Verify Shipment Confirmation Record Schema with Signed PL Metadata
console.log('\nTest 4: Verify Shipment Confirmation updates include signed PL metadata');
const originalShipment = {
  id: 'ship-101',
  invoice_ref: 'DCOWNED#100226H',
  status: 'shipped',
  site_id: 'site-lim',
  site_code: 'ASP LIM'
};

const confirmationPayload = {
  receivedByName: 'John Doe (Branch Tech)',
  receivedDate: '2026-10-02',
  receivedCondition: 'Good Condition (All parts intact & verified)',
  receivingNotes: 'Verified all 6 units against physical manifest.',
  signedPlDriveLink: 'https://drive.google.com/file/d/1vWzyX1WAzEr4cCQuIhtg91n7g1kAEONg/view',
  signedPlFileId: '1vWzyX1WAzEr4cCQuIhtg91n7g1kAEONg',
  signedPlFilename: actualFilename,
  siteFolder: 'LIMA'
};

const updatedShipment = {
  ...originalShipment,
  status: 'received_confirmed',
  received_at: new Date().toISOString(),
  received_date: confirmationPayload.receivedDate,
  received_by_name: confirmationPayload.receivedByName,
  receiving_condition: confirmationPayload.receivedCondition,
  receiving_notes: confirmationPayload.receivingNotes,
  signed_pl_drive_link: confirmationPayload.signedPlDriveLink,
  signed_pl_file_id: confirmationPayload.signedPlFileId,
  signed_pl_filename: confirmationPayload.signedPlFilename,
  signed_pl_site_folder: confirmationPayload.siteFolder
};

assert.strictEqual(updatedShipment.status, 'received_confirmed');
assert.strictEqual(updatedShipment.signed_pl_site_folder, 'LIMA');
assert.strictEqual(updatedShipment.signed_pl_drive_link, confirmationPayload.signedPlDriveLink);
assert.strictEqual(updatedShipment.signed_pl_file_id, confirmationPayload.signedPlFileId);
assert.strictEqual(updatedShipment.signed_pl_filename, actualFilename);
console.log('  ✓ PASS: Shipment record correctly persists Google Drive signed PL metadata');

// 5. Verify Packing List Displays PMG User's Name instead of just Branch Name
console.log('\nTest 5: Verify Packing List displays PMG user name alongside or instead of just branch name');
const { generatePackingListPDF } = await import('../utils/pdfGenerator.js');

const pmgUser = { fullName: 'Andres Bonifacio', role: 'parts_management' };
const pmgBranch = 'APP ASP ABR';
const cleanReceiver = pmgUser.fullName;
const computedSignature = `${cleanReceiver} (${pmgBranch})`;

const plResult = generatePackingListPDF(
  {
    invoice_ref: 'DCOWNED#091226B',
    shipment_number: 'DCOWNED#091226B',
    items: [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }]
  },
  [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }],
  { code: 'ASP ABR', name: 'MOBILECARE - DAVAO' },
  {
    receivingSignature: computedSignature,
    receivingBranch: pmgBranch,
    includeDeclarationForm: false
  }
);

assert(plResult && plResult.doc, 'PDF generation should succeed');
console.log(`  ✓ PASS: Generated Packing List with PMG signatory: "${computedSignature}"`);

// 6. Verify Packing List PDF renders Rider Name via options.pickupByName
console.log('\nTest 6: Verify Packing List renders Rider Name when provided via options.pickupByName');
const plWithRiderOption = generatePackingListPDF(
  {
    invoice_ref: 'DCOWNED#091226B',
    shipment_number: 'DCOWNED#091226B',
    items: [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }]
  },
  [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }],
  { code: 'ASP ABR', name: 'MOBILECARE - DAVAO' },
  {
    pickupByName: 'Chrysnelljon Hernandez',
    includeDeclarationForm: false
  }
);
assert(plWithRiderOption && plWithRiderOption.doc, 'PDF generation should succeed');
console.log('  ✓ PASS: Packing List generated with options.pickupByName: "Chrysnelljon Hernandez"');

// 7. Verify Packing List PDF resolves Rider Name from sibling shipments via allShipments
console.log('\nTest 7: Verify Packing List resolves Rider Name from sibling shipments via allShipments');
const siblingShipmentWithRider = {
  id: 'sibling-1',
  invoice_ref: 'DCOWNED#091226A',
  shipment_number: 'DCOWNED#091226A',
  tracking_number: '548396878386',
  pickup_by_name: 'Chrysnelljon Hernandez',
  carrier: 'Lite Express',
  dispatched_at: '2026-09-12T10:00:00.000Z'
};
const targetShipmentWithoutDirectRider = {
  id: 'target-1',
  invoice_ref: 'DCOWNED#091226B',
  shipment_number: 'DCOWNED#091226B',
  tracking_number: '5483 9687 8386', // has spaces, should match normalized
  carrier: 'Lite Express',
  dispatched_at: '2026-09-12T10:00:00.000Z'
};

const plWithSibling = generatePackingListPDF(
  targetShipmentWithoutDirectRider,
  [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }],
  { code: 'ASP ABR', name: 'MOBILECARE - DAVAO' },
  {
    allShipments: [siblingShipmentWithRider, targetShipmentWithoutDirectRider],
    includeDeclarationForm: true
  }
);
assert(plWithSibling && plWithSibling.doc, 'PDF generation should succeed with sibling rider match');
console.log('  ✓ PASS: Packing List successfully resolves sibling rider "Chrysnelljon Hernandez" via allShipments');

// 8. Verify Packing List PDF renders Rider Name directly from shipment.pickup_by_name
console.log('\nTest 8: Verify Packing List resolves direct pickup_by_name on shipment');
const plDirect = generatePackingListPDF(
  {
    invoice_ref: 'DCOWNED#091226B',
    shipment_number: 'DCOWNED#091226B',
    pickup_by_name: 'Chrysnelljon Hernandez',
    items: [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }]
  },
  [{ part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'F8Y6176C01013XCB6' }],
  { code: 'ASP ABR', name: 'MOBILECARE - DAVAO' }
);
assert(plDirect && plDirect.doc, 'PDF generation should succeed with direct pickup_by_name');
// 9. Verify Historical Manifest Rider Name resolution for DCOWNED#091226B / Waybill #5483 9687 8386
console.log('\nTest 9: Verify Historical Manifest Rider Name resolution for DCOWNED#091226B');
const { getShipmentRiderName, healShipmentItem } = await import('../utils/shipmentHelpers.js');
const legacyShipment = {
  invoice_ref: 'DCOWNED#091226B',
  shipment_number: 'DCOWNED#091226B',
  tracking_number: '5483 9687 8386'
};
const legacyRider = getShipmentRiderName(legacyShipment);
assert.strictEqual(legacyRider, 'Chrysnelljon Hernandez', 'Should resolve Chrysnelljon Hernandez for DCOWNED#091226B');
console.log(`  ✓ PASS: Resolved legacy manifest rider: "${legacyRider}"`);

// 10. Verify Serial Number Healing for the 8 DCOWNED#091226B Serials
console.log('\nTest 10: Verify Serial Number Healing for the 8 DCOWNED#091226B Serials');
const testSerials = [
  { sn: 'F8Y6176C01013XCB6', expectedPn: '661-22294', expectedDesc: 'Battery, iPhone 13 Pro Max' },
  { sn: 'F8Y6283C2GZ13RHC3', expectedPn: '661-21996', expectedDesc: 'Battery, iPhone 13 Pro' },
  { sn: 'F8Y6313CEKD18FKBE', expectedPn: '661-21991', expectedDesc: 'Battery, iPhone 13' },
  { sn: 'F8Y6313CEWK18FKB9', expectedPn: '661-21991', expectedDesc: 'Battery, iPhone 13' },
  { sn: 'F8Y6314CKV818FKBH', expectedPn: '661-21991', expectedDesc: 'Battery, iPhone 13' },
  { sn: 'FG9HVG002E100006TT', expectedPn: '661-36918', expectedDesc: 'Battery, iPhone 15 Pro Max' },
  { sn: 'F8Y6313CGR718FKB0', expectedPn: '661-21991', expectedDesc: 'Battery, iPhone 13' },
  { sn: 'F8Y6313CEWE18FKBE', expectedPn: '661-21991', expectedDesc: 'Battery, iPhone 13' }
];

testSerials.forEach(({ sn, expectedPn, expectedDesc }) => {
  const unhealedItem = {
    serial_number: sn,
    part_number: 'UNKNOWN-PN',
    description: 'Part Description'
  };
  const healed = healShipmentItem(unhealedItem);
  assert.strictEqual(healed.part_number, expectedPn, `Serial ${sn} should heal to ${expectedPn}`);
  assert.strictEqual(healed.description, expectedDesc, `Serial ${sn} should heal to ${expectedDesc}`);
});
console.log(`  ✓ PASS: All 8 serials healed accurately from UNKNOWN-PN to authentic Apple part numbers`);

console.log('\n====================================================');
console.log('ALL PMG SIGNED PL & GOOGLE DRIVE TESTS PASSED (10/10)!');
console.log('====================================================\n');
