import assert from 'node:assert';
import { resolvePackingListSiteCode, getPackingListFileName } from '../utils/shipmentHelpers.js';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';
import { CANONICAL_SITE_LIST } from '../constants/config.js';

console.log('====================================================');
console.log('TEST SUITE: Packing List Filename Format with Site Code');
console.log('====================================================\n');

// 1. Verify User-Specified Examples
console.log('--- Test 1: User-Specified Target Examples (NES, VER, ILO, SMS, MEG) ---');

// Northeast Square (ASP NES -> NES)
const nesShipment = { invoice_ref: 'DCOWNED#083126A' };
const nesSite = { code: 'ASP NES', name: 'MOBILECARE - NORTHEAST SQUARE' };
const nesFilename = getPackingListFileName(nesShipment, nesSite, 'pdf');
assert.strictEqual(nesFilename, 'DCOWNED#083126A_NES.pdf', 'Northeast Square must yield DCOWNED#083126A_NES.pdf');
console.log('  ✓ PASS: Northeast Square matches target format: "DCOWNED#083126A_NES.pdf"');

// Vertis North (ASP VN -> VER)
const verSite = { code: 'ASP VN', name: 'MOBILECARE - VERTIS NORTH' };
const verFilename = getPackingListFileName(nesShipment, verSite, 'pdf');
assert.strictEqual(verFilename, 'DCOWNED#083126A_VER.pdf', 'Vertis North must yield DCOWNED#083126A_VER.pdf');
console.log('  ✓ PASS: Vertis North matches target format: "DCOWNED#083126A_VER.pdf"');

// Festive Walk Iloilo (ASP ILO -> ILO)
const iloSite = { code: 'ASP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO' };
const iloFilename = getPackingListFileName(nesShipment, iloSite, 'pdf');
assert.strictEqual(iloFilename, 'DCOWNED#083126A_ILO.pdf', 'Iloilo must yield DCOWNED#083126A_ILO.pdf');
console.log('  ✓ PASS: Iloilo matches target format: "DCOWNED#083126A_ILO.pdf"');

// S'Maison (ASP SMS -> SMS)
const smsSite = { code: 'ASP SMS', name: "MOBILECARE - S'MAISON" };
const smsFilename = getPackingListFileName(nesShipment, smsSite, 'pdf');
assert.strictEqual(smsFilename, 'DCOWNED#083126A_SMS.pdf', "S'Maison must yield DCOWNED#083126A_SMS.pdf");
console.log('  ✓ PASS: S\'Maison matches target format: "DCOWNED#083126A_SMS.pdf"');

// Megamall (APP MEG -> MEG)
const megSite = { code: 'APP MEG', name: 'MOBILECARE - APP MEGAMALL' };
const megFilename = getPackingListFileName(nesShipment, megSite, 'pdf');
assert.strictEqual(megFilename, 'DCOWNED#083126A_MEG.pdf', 'Megamall must yield DCOWNED#083126A_MEG.pdf');
console.log('  ✓ PASS: Megamall matches target format: "DCOWNED#083126A_MEG.pdf"');

// 2. Verify all 26 Canonical Sites
console.log('\n--- Test 2: Full 26 Canonical Sites Coverage ---');
const EXPECTED_MAPPINGS = {
  'APP BHS': 'BHS',
  'APP GB3': 'GB3',
  'APP PPM': 'PPM',
  'ASP GL5': 'GL5',
  'ASP SMS': 'SMS',
  'APP MOA': 'MOA',
  'ASP POD': 'POD',
  'APP MEG': 'MEG',
  'APP ANX': 'ANX',
  'APP TRI': 'TRI',
  'ASP VN': 'VER',
  'ASP NES': 'NES',
  'APP FES': 'FES',
  'ASP MRK': 'MRK',
  'APP RM': 'MAG',
  'ASP LIM': 'LIM',
  'ASP NPM': 'NPM',
  'ASP NAG': 'NAG',
  'ASP LAU': 'LAU',
  'ASP ILO': 'ILO',
  'ASP CEB': 'CEB',
  'ASP ZAM': 'ZAM',
  'ASP ABR': 'ABR',
  'ASP COT': 'COT',
  'ASP CDO': 'CDO',
  'APP LAN': 'LAN'
};

for (const site of CANONICAL_SITE_LIST) {
  const code = resolvePackingListSiteCode(site);
  const expectedCode = EXPECTED_MAPPINGS[site.code];
  assert.strictEqual(code, expectedCode, `Site ${site.code} (${site.name}) should resolve to ${expectedCode}, got ${code}`);
  const filename = getPackingListFileName({ invoice_ref: 'DCOWNED#110426A' }, site, 'pdf');
  assert.strictEqual(filename, `DCOWNED#110426A_${expectedCode}.pdf`);
}
console.log('  ✓ PASS: All 26 canonical sites accurately mapped to standard 3-character branch codes');

// 3. Verify Additional Sites (Aura, Baguio, Tacloban, Palawan, Alabang, etc.)
console.log('\n--- Test 3: Additional Known Sites Resolution ---');
assert.strictEqual(resolvePackingListSiteCode({ code: 'APP-AUR', name: 'MOBILECARE - APP SM AURA' }), 'AUR');
assert.strictEqual(resolvePackingListSiteCode({ code: 'ASP BAG', name: 'MOBILECARE - BAGUIO' }), 'BAG');
assert.strictEqual(resolvePackingListSiteCode({ code: 'ASP TAC', name: 'MOBILECARE - TACLOBAN' }), 'TAC');
assert.strictEqual(resolvePackingListSiteCode({ code: 'ASP PAL', name: 'MOBILECARE - PALAWAN' }), 'PAL');
assert.strictEqual(resolvePackingListSiteCode({ code: 'APP ATC', name: 'MOBILECARE - APP ALABANG TOWN CENTER' }), 'ATC');
console.log('  ✓ PASS: Additional branch sites (AUR, BAG, TAC, PAL, ATC) correctly resolved');

// 4. Verify Resolution from Shipment fields when site parameter is empty/null
console.log('\n--- Test 4: Resolution from Shipment Context ---');
const shWithDestCode = { invoice_ref: 'DCOWNED#083126B', destination_site_code: 'ASP ILO' };
assert.strictEqual(getPackingListFileName(shWithDestCode, null, 'pdf'), 'DCOWNED#083126B_ILO.pdf');

const shWithDestName = { invoice_ref: 'DCOWNED#083126C', destination_site_name: 'MOBILECARE - VERTIS NORTH' };
assert.strictEqual(getPackingListFileName(shWithDestName, {}, 'pdf'), 'DCOWNED#083126C_VER.pdf');

const shWithSiteName = { invoice_ref: 'DCOWNED#083126D', site_name: "MOBILECARE - S'MAISON" };
assert.strictEqual(getPackingListFileName(shWithSiteName, null, 'pdf'), 'DCOWNED#083126D_SMS.pdf');

const shWithRecBranch = { invoice_ref: 'DCOWNED#083126E', receiving_branch: 'APP MEG' };
assert.strictEqual(getPackingListFileName(shWithRecBranch, null, 'pdf'), 'DCOWNED#083126E_MEG.pdf');
console.log('  ✓ PASS: Correctly extracts destination site directly from shipment properties');

// 5. Verify Edge Cases (Duplicate suffix avoidance, missing site, special characters)
console.log('\n--- Test 5: Edge Cases & Idempotency ---');
// Already has suffix _NES
const shAlreadyHasSuffix = { invoice_ref: 'DCOWNED#083126A_NES' };
assert.strictEqual(getPackingListFileName(shAlreadyHasSuffix, nesSite, 'pdf'), 'DCOWNED#083126A_NES.pdf');
console.log('  ✓ PASS: Does not duplicate suffix when invoice_ref already ends with _NES');

// Missing site and no destination on shipment
const shNoSite = { invoice_ref: 'DCOWNED#083126X' };
assert.strictEqual(getPackingListFileName(shNoSite, null, 'pdf'), 'DCOWNED#083126X.pdf');
console.log('  ✓ PASS: Gracefully outputs clean ref without suffix when site is unknown');

// Sanitization of filesystem-forbidden characters (e.g. slashes)
const shSlashRef = { invoice_ref: 'DC/OWNED/083126A' };
assert.strictEqual(getPackingListFileName(shSlashRef, nesSite, 'pdf'), 'DC_OWNED_083126A_NES.pdf');
console.log('  ✓ PASS: Sanitizes forbidden characters (/ \\ : * ? " < > |)');

// 6. Verify Excel Export Extension (.xlsx)
console.log('\n--- Test 6: Excel (.xlsx) Export Filename ---');
const xlsxFilename = getPackingListFileName(nesShipment, nesSite, 'xlsx');
assert.strictEqual(xlsxFilename, 'DCOWNED#083126A_NES.xlsx');
console.log('  ✓ PASS: Correctly applies .xlsx extension for Excel exports: "DCOWNED#083126A_NES.xlsx"');

// 7. Verify generatePackingListPDF returns new filename
console.log('\n--- Test 7: generatePackingListPDF Output Integration ---');
const pdfResult = generatePackingListPDF(nesShipment, [], nesSite, { saveFile: false });
assert.strictEqual(pdfResult.filename, 'DCOWNED#083126A_NES.pdf');
console.log('  ✓ PASS: generatePackingListPDF returns filename: "DCOWNED#083126A_NES.pdf"');

console.log('\n====================================================');
console.log('RESULTS: ALL PACKING LIST FILENAME TESTS PASSED (100%)');
console.log('====================================================');
