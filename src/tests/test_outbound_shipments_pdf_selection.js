import assert from 'assert';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Outbound Shipments PDF Selection & Superadmin Exclusivity');
console.log('====================================================\n');

// Mock data
const mockShipment = {
  id: 'sh-test-01',
  invoice_ref: 'DCOWNED#TEST01',
  site_name: 'ASP ZAM - MOBILECARE - ZAMBOANGA',
  destination_site_name: 'ASP ZAM',
  carrier: 'Lite Express',
  tracking_number: '548396878387',
  created_at: '2026-09-14T08:00:00Z',
  total_boxes: 1,
  verified_by_name: 'Anjo Alcazar'
};

const mockItems = [
  { part_number: '661-21988', description: 'iPhone 13 Display', quantity: 2, stocking_price: 279 },
  { part_number: '661-21990', description: 'iPhone 13 Battery', quantity: 1, stocking_price: 99 }
];

const mockSite = {
  id: 'site-zam',
  name: 'MOBILECARE - ZAMBOANGA',
  code: 'ASP ZAM'
};

// --- Test 1: generatePackingListPDF with includeDeclarationForm: false (PL Only) ---
console.log('--- Test 1: generatePackingListPDF with includeDeclarationForm: false ---');
const plOnlyResult = generatePackingListPDF(mockShipment, mockItems, mockSite, {
  includeDeclarationForm: false
});

const plOnlyPages = plOnlyResult.doc.internal.getNumberOfPages();
assert.strictEqual(plOnlyPages, 1, `Packing List Only must contain exactly 1 page (got ${plOnlyPages})`);
console.log('  ✓ PASS: generatePackingListPDF with includeDeclarationForm: false generates exactly 1 page (Manifest only)');

// --- Test 2: generatePackingListPDF with includeDeclarationForm: true (Both) ---
console.log('\n--- Test 2: generatePackingListPDF with includeDeclarationForm: true (Both) ---');
const bothResult = generatePackingListPDF(mockShipment, mockItems, mockSite, {
  includeDeclarationForm: true
});

const bothPages = bothResult.doc.internal.getNumberOfPages();
assert.strictEqual(bothPages, 2, `Both PL & Declaration must contain exactly 2 pages (got ${bothPages})`);
console.log('  ✓ PASS: generatePackingListPDF with includeDeclarationForm: true generates 2 pages (Manifest + Declaration Form)');

// --- Test 3: Default backward-compatibility (includeDeclarationForm omitted) ---
console.log('\n--- Test 3: Default backward-compatibility when includeDeclarationForm is omitted ---');
const defaultResult = generatePackingListPDF(mockShipment, mockItems, mockSite);
const defaultPages = defaultResult.doc.internal.getNumberOfPages();
assert.strictEqual(defaultPages, 2, `Default invocation must retain backward-compatible 2-page behavior (got ${defaultPages})`);
console.log('  ✓ PASS: Omitted options default to 2 pages without regression');

// --- Test 4: Simulation of Superadmin vs PMG Role Guards on Shipments Page ---
console.log('\n--- Test 4: Superadmin vs PMG Role Authorization Guard Logic ---');

const simulateHandleRequestPrintOrPDF = (currentUser, customOptions = {}) => {
  const isSuperadmin = Boolean(currentUser?.role === 'superadmin' || currentUser?.isSuperAdmin);
  const includeDeclaration = isSuperadmin
    ? (customOptions?.includeDeclarationForm !== undefined ? customOptions.includeDeclarationForm : true)
    : false;

  const pdfOptions = {
    ...customOptions,
    includeDeclarationForm: includeDeclaration
  };

  const res = generatePackingListPDF(mockShipment, mockItems, mockSite, pdfOptions);
  return {
    isSuperadmin,
    includeDeclaration,
    pageCount: res.doc.internal.getNumberOfPages()
  };
};

// 4A: Superadmin selecting PL Only
const superadminPlOnly = simulateHandleRequestPrintOrPDF(
  { role: 'superadmin', fullName: 'Zhon Manaois' },
  { includeDeclarationForm: false }
);
assert.strictEqual(superadminPlOnly.includeDeclaration, false);
assert.strictEqual(superadminPlOnly.pageCount, 1);
console.log('  ✓ PASS: Superadmin can choose PL Only -> 1 page generated');

// 4B: Superadmin selecting Both (PL + Declaration)
const superadminBoth = simulateHandleRequestPrintOrPDF(
  { role: 'superadmin', fullName: 'Zhon Manaois' },
  { includeDeclarationForm: true }
);
assert.strictEqual(superadminBoth.includeDeclaration, true);
assert.strictEqual(superadminBoth.pageCount, 2);
console.log('  ✓ PASS: Superadmin can choose Both -> 2 pages generated');

// 4C: PMG User attempting to download (even if spoofing includeDeclarationForm: true)
const pmgUser = simulateHandleRequestPrintOrPDF(
  { role: 'parts_management', fullName: 'Jose Branch Staff', siteId: 'site-zam' },
  { includeDeclarationForm: true } // Attempting to request Declaration Form
);
assert.strictEqual(pmgUser.isSuperadmin, false);
assert.strictEqual(pmgUser.includeDeclaration, false, 'PMG user must NOT be permitted to include Declaration Form');
assert.strictEqual(pmgUser.pageCount, 1, 'PMG user must only ever receive 1-page PL manifest');
console.log('  ✓ PASS: PMG user is strictly restricted to PL Only (Declaration Form blocked even if requested)');

console.log('\n====================================================');
console.log('RESULTS: ALL OUTBOUND SHIPMENTS PDF SELECTION TESTS PASSED (100%)');
console.log('====================================================\n');
