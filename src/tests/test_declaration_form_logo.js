import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { MOBILECARE_NO_BG_LOGO_BASE64, MOBILECARE_LOGO_BASE64 } from '../assets/logoBase64.js';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';
import * as jspdfModule from 'jspdf';

console.log('====================================================');
console.log('TEST SUITE: Declaration Form PDF & mobilecareNoBGLogo');
console.log('====================================================');

// 1. Verify mobilecareNoBGLogo.png file exists and is valid
const pngPath = path.resolve('src/assets/mobilecareNoBGLogo.png');
assert(fs.existsSync(pngPath), 'mobilecareNoBGLogo.png must exist in src/assets');
const pngBuf = fs.readFileSync(pngPath);
assert(pngBuf.length > 0, 'mobilecareNoBGLogo.png must not be empty');
assert(pngBuf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'Must have valid PNG header');
console.log('  ✓ PASS: mobilecareNoBGLogo.png asset exists with valid PNG signature');

// 2. Verify MOBILECARE_NO_BG_LOGO_BASE64 and MOBILECARE_LOGO_BASE64 export
assert(typeof MOBILECARE_NO_BG_LOGO_BASE64 === 'string', 'MOBILECARE_NO_BG_LOGO_BASE64 must be a string');
assert(MOBILECARE_NO_BG_LOGO_BASE64.startsWith('data:image/png;base64,'), 'Must start with data:image/png;base64,');
assert(MOBILECARE_NO_BG_LOGO_BASE64.length > 1000, 'Base64 string must contain full image payload');
assert(typeof MOBILECARE_LOGO_BASE64 === 'string' && MOBILECARE_LOGO_BASE64.length > 1000, 'MOBILECARE_LOGO_BASE64 must be valid');
console.log('  ✓ PASS: MOBILECARE_NO_BG_LOGO_BASE64 correctly exported from logoBase64.js');

// 3. Test generatePackingListPDF execution and Page 2 Declaration form rendering
let savedFilename = null;
let savedPagesCount = 0;
const jsPDFClass = jspdfModule.jsPDF || jspdfModule.default;
const origSave = jsPDFClass.API.save;

jsPDFClass.API.save = function (name) {
  savedFilename = name;
  savedPagesCount = this.internal.pages.length - 1;
};

const mockShipment = {
  invoice_ref: 'DCOWNED#090226B',
  shipment_number: 'DCOWNED#090226B',
  site_name: 'MOBILECARE - APP FESTIVAL MALL',
  carrier: 'LALAMOVE',
  booking_id: 'N/A',
  courier_name: 'John Doe',
  vehicle_plate: 'ABC-1234',
  rider_phone: '09171234567',
  verified_by_name: 'ANJO ALCAZAR',
  guard_on_duty: 'Sgt. Dela Cruz',
  pickup_date: '9/2/2026'
};

const mockItems = [
  { part_number: '661-21991', description: 'Display Module Silver', serial_number: 'G9PQHU084CQ9D088S5L4B', price: 279, box_number: 1 },
  { part_number: '661-22002', description: 'Battery Module 60Wh', serial_number: 'D088S5L4BG9PQHU084CQ9', price: 99, box_number: 1 }
];

const mockSite = {
  name: 'MOBILECARE - APP FESTIVAL MALL',
  code: 'site-festival',
  address: 'Festival Mall, Alabang, Muntinlupa City'
};

try {
  generatePackingListPDF(mockShipment, mockItems, mockSite);
  assert.strictEqual(savedPagesCount, 2, 'Packing List PDF must contain exactly 2 pages (Page 1 Manifest + Page 2 Declaration Form)');
  assert.strictEqual(savedFilename, 'PackingList_DCOWNED#090226B.pdf', 'Saved filename must match invoice ref pattern');
  console.log('  ✓ PASS: generatePackingListPDF seamlessly builds 2-Page corporate PDF with updated Declaration Form');
} finally {
  jsPDFClass.API.save = origSave;
}

console.log('====================================================');
console.log('RESULTS: ALL DECLARATION FORM LOGO TESTS PASSED (100%)');
console.log('====================================================');
