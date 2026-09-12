import assert from 'assert';
import * as jspdfModule from 'jspdf';
import { exportPackingListXLSX, parseScanOutPartsFile } from '../utils/excelParser.js';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Packing List XLSX Backup & PDF Enhancements');
console.log('====================================================');

// Mock data generator
function createMockItems(count) {
  const items = [];
  for (let i = 1; i <= count; i++) {
    const pad = String(i).padStart(3, '0');
    items.push({
      part_number: i % 2 === 0 ? '661-21991' : '661-30401',
      description: i % 2 === 0 ? 'Battery, iPhone 13' : 'Display, iPhone 14 Pro Max',
      serial_number: `F8Y${pad}SERIAL${pad}XYZ`,
      box_number: i <= 50 ? 1 : 2,
      price: i % 2 === 0 ? 99 : 329
    });
  }
  return items;
}

const mockShipment = {
  id: 'ship-test-001',
  invoice_ref: 'D091026E',
  shipment_number: 'D091026E',
  site_name: 'MOBILECARE - VERTIS NORTH',
  carrier: 'LALAMOVE',
  booking_id: '20227469',
  prepared_by_name: 'Zhon Manaois',
  verified_by_name: 'Anjo Alcazar',
  total_boxes: 2,
  remarks: 'KGB PARTS'
};

const mockSite = {
  id: 'site-vn',
  name: 'MOBILECARE - VERTIS NORTH',
  code: 'ASP VN',
  address: 'Level 4, Vertis North Mall, Quezon City'
};

async function runTests() {
  // ── TEST 1: XLSX Export Generation ──────────────────────────────────────
  console.log('\n--- 1. Testing exportPackingListXLSX ---');
  const items61 = createMockItems(61);
  const { workbook, buffer } = await exportPackingListXLSX(mockShipment, items61, mockSite, {
    supervisorName: 'Anjo Alcazar',
    userName: 'Zhon Manaois'
  });

  assert(workbook, 'Workbook instance must be returned');
  assert(buffer && buffer.byteLength > 0, 'Buffer must have content');

  const ws = workbook.getWorksheet('Packing List');
  assert(ws, 'Worksheet "Packing List" must exist');

  // Verify Header & Metadata
  assert.strictEqual(ws.getCell('A1').value, 'MOBILE CARE SERVICES PHILS. INC.');
  assert.strictEqual(ws.getCell('B5').value, 'D091026E');
  assert.strictEqual(ws.getCell('B6').value, 'MOBILECARE - VERTIS NORTH');
  assert.strictEqual(ws.getCell('H5').value, '61 units');
  assert.strictEqual(ws.getCell('H6').value, 2); // 2 boxes

  // Verify Row 9 Table Headers (compatible with parseScanOutPartsFile)
  const headerRowVals = ws.getRow(9).values;
  assert(headerRowVals.includes('Part Number'), 'Must contain "Part Number"');
  assert(headerRowVals.includes('Serial Number'), 'Must contain "Serial Number"');
  assert(headerRowVals.includes('Box Number'), 'Must contain "Box Number"');
  assert(headerRowVals.includes('Destination Site'), 'Must contain "Destination Site"');
  assert(headerRowVals.includes('Description'), 'Must contain "Description"');

  // Verify Data Rows (Row 10 is item 1, Row 70 is item 61)
  const firstItemRow = ws.getRow(10);
  assert.strictEqual(firstItemRow.getCell(1).value, 1);
  assert.strictEqual(firstItemRow.getCell(2).value, items61[0].part_number);
  assert.strictEqual(firstItemRow.getCell(4).value, items61[0].serial_number);
  assert.strictEqual(firstItemRow.getCell(5).value, 1);

  const lastItemRow = ws.getRow(70);
  assert.strictEqual(lastItemRow.getCell(1).value, 61);
  assert.strictEqual(lastItemRow.getCell(2).value, items61[60].part_number);
  assert.strictEqual(lastItemRow.getCell(4).value, items61[60].serial_number);
  assert.strictEqual(lastItemRow.getCell(5).value, 2);

  console.log('  ✓ PASS: exportPackingListXLSX creates complete, formatted workbook with all 61 items');

  // ── TEST 2: Re-Upload Parsing of the Exported XLSX ───────────────────────
  console.log('\n--- 2. Testing Re-Upload Parsing with parseScanOutPartsFile ---');
  const mockFile = {
    name: 'PackingList_D091026E.xlsx',
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };

  // Mock inventory with these serials
  const inventoryUnits = items61.map(it => ({
    part_number: it.part_number,
    description: it.description,
    serial_number: it.serial_number,
    status: 'in_stock'
  }));

  const parseResult = await parseScanOutPartsFile(mockFile, inventoryUnits, [mockSite], mockSite.id, {
    activeDraftItems: items61,
    currentShipmentId: mockShipment.id
  });

  assert(parseResult.success, `Parse should succeed: ${parseResult.error}`);
  assert.strictEqual(parseResult.items.length, 61, 'Must parse exactly 61 items from Excel');
  assert.strictEqual(parseResult.summary.valid, 61, 'All 61 items must be VALID for packing');
  assert.strictEqual(parseResult.items[0].serialNumber, items61[0].serial_number);
  assert.strictEqual(parseResult.items[60].serialNumber, items61[60].serial_number);
  assert.strictEqual(parseResult.items[60].boxNumber, 2);
  console.log('  ✓ PASS: Re-uploading the exported Excel file parses seamlessly (61/61 valid items recognized)');

  // ── TEST 3: PDF Logo, 50-Parts Limit, Continuation & Pagination ────────
  console.log('\n--- 3. Testing PDF Generator (Logo, 50-Limit, Continuation & Pagination) ---');

  let interceptedPages = 0;
  let addedImages = [];
  let renderedTexts = [];

  const origJSPDF = jspdfModule.default.jsPDF;
  class MockJSPDF extends origJSPDF {
    constructor(...args) {
      super(...args);
      const origAddImage = this.addImage;
      const origText = this.text;

      this.addImage = (...imgArgs) => {
        addedImages.push({
          src: typeof imgArgs[0] === 'string' ? imgArgs[0].slice(0, 30) : 'obj',
          x: imgArgs[2],
          y: imgArgs[3],
          w: imgArgs[4],
          h: imgArgs[5],
          page: this.internal.getCurrentPageInfo().pageNumber
        });
        return origAddImage.apply(this, imgArgs);
      };

      this.text = (text, ...rest) => {
        renderedTexts.push({
          text: String(text),
          page: this.internal.getCurrentPageInfo().pageNumber,
          x: rest[0],
          y: rest[1]
        });
        return origText.call(this, text, ...rest);
      };

      this.save = (_filename) => {
        interceptedPages = this.internal.pages.length - 1;
      };
    }
  }

  jspdfModule.default.jsPDF = MockJSPDF;

  try {
    // Subtest 3A: <= 50 parts (e.g. 15 parts) -> Exactly 2 Pages (Manifest Page 1 of 1, Declaration Form has NO page number)
    renderedTexts = [];
    addedImages = [];
    const items15 = createMockItems(15);
    generatePackingListPDF(mockShipment, items15, mockSite);

    assert.strictEqual(interceptedPages, 2, 'PL with 15 parts must produce exactly 2 pages (Manifest + Declaration Form)');
    
    // Check pagination footers
    const p1Footer = renderedTexts.find(t => t.text === 'Page 1 of 1' && t.page === 1);
    assert(p1Footer, 'Page 1 must render "Page 1 of 1"');
    const decPageNumber = renderedTexts.find(t => t.page === 2 && /Page \d+ of \d+/.test(t.text));
    assert.strictEqual(decPageNumber, undefined, 'Declaration Form (Page 2) must NOT have page numbering');

    // Check Page 1 logo is mobilecareNoBGLogo with 22x10.65 dimensions (slightly smaller for balance)
    const p1Logo = addedImages.find(img => img.page === 1);
    assert(p1Logo, 'Page 1 must have a logo');
    assert.strictEqual(p1Logo.w, 22, 'Page 1 logo width must be 22mm (balanced size)');
    assert.strictEqual(p1Logo.h, 10.65, 'Page 1 logo height must be 10.65mm');

    // Check space below "Packing List" title on Page 1 (generous breathing room)
    const p1Title = renderedTexts.find(t => t.page === 1 && t.text === 'Packing List');
    assert(p1Title, 'Page 1 must render "Packing List" title');
    const p1CompName = renderedTexts.find(t => t.page === 1 && t.text === 'MOBILE CARE SERVICES PHILS. INC.');
    assert(p1CompName, 'Page 1 must render company name');
    assert(p1CompName.y >= 23, `Space below title must be generous (p1CompName.y=${p1CompName.y} >= 23)`);

    // Check Verified By and Pickup By alignment with table Totals Box (X = 124)
    const verifiedByText = renderedTexts.find(t => t.page === 1 && t.text === 'Verified by:');
    assert(verifiedByText, 'Page 1 must render "Verified by:"');
    assert.strictEqual(verifiedByText.x, 124, 'Verified by: must align with table Totals Box at X=124');

    const pickupByText = renderedTexts.find(t => t.page === 1 && t.text === 'Pickup By:');
    assert(pickupByText, 'Page 1 must render "Pickup By:"');
    assert.strictEqual(pickupByText.x, 124, 'Pickup By: must align with table Totals Box at X=124');

    console.log('  ✓ PASS: Small PL (<=50 parts) generates 2 pages with 22x10.65mm logo, "Page 1 of 1", generous title spacing, and aligned signatures (X=124)');

    // Subtest 3B: 61 parts -> Exactly 3 Pages (Manifest Page 1 of 2, Page 2 of 2, and Declaration Form with NO page number)
    renderedTexts = [];
    addedImages = [];
    generatePackingListPDF(mockShipment, items61, mockSite);

    assert.strictEqual(interceptedPages, 3, 'PL with 61 parts must produce exactly 3 pages (2 Manifest + 1 Declaration Form)');
    
    const p1of2 = renderedTexts.find(t => t.page === 1 && t.text === 'Page 1 of 2');
    const p2of2 = renderedTexts.find(t => t.page === 2 && t.text === 'Page 2 of 2');
    const decPage3Number = renderedTexts.find(t => t.page === 3 && /Page \d+ of \d+/.test(t.text));
    assert(p1of2, 'Page 1 must render "Page 1 of 2"');
    assert(p2of2, 'Page 2 must render "Page 2 of 2"');
    assert.strictEqual(decPage3Number, undefined, 'Declaration Form (Page 3) must NOT have page numbering');

    // Check Page 2 has continuation header and no vertical collision
    const contHeader = renderedTexts.find(t => t.page === 2 && t.text === 'Packing List (Continuation)');
    assert(contHeader, 'Page 2 must have "Packing List (Continuation)" header');
    assert.strictEqual(contHeader.y, 12, 'Continuation title must be at Y=12');

    const contCompName = renderedTexts.find(t => t.page === 2 && t.text === 'MOBILE CARE SERVICES PHILS. INC.');
    assert(contCompName, 'Continuation page must have company name');
    assert(contCompName.y > 16, 'Company name on continuation page must be below title (Y > 16) to avoid overlap');

    console.log('  ✓ PASS: Large PL (61 parts) splits across 3 pages with clean continuation header, "Page 1 of 2", "Page 2 of 2", and blank Declaration pagination');

    // Subtest 3C: 105 parts -> Exactly 4 Pages (3 Manifest pages + 1 Declaration Form)
    renderedTexts = [];
    addedImages = [];
    const items105 = createMockItems(105);
    generatePackingListPDF(mockShipment, items105, mockSite);
    assert.strictEqual(interceptedPages, 4, 'PL with 105 parts must produce exactly 4 pages (3 Manifest + 1 Declaration Form)');
    
    const p1of3 = renderedTexts.find(t => t.page === 1 && t.text === 'Page 1 of 3');
    const p2of3 = renderedTexts.find(t => t.page === 2 && t.text === 'Page 2 of 3');
    const p3of3 = renderedTexts.find(t => t.page === 3 && t.text === 'Page 3 of 3');
    const decPage4Number = renderedTexts.find(t => t.page === 4 && /Page \d+ of \d+/.test(t.text));
    assert(p1of3, 'Page 1 must render "Page 1 of 3"');
    assert(p2of3, 'Page 2 must render "Page 2 of 3"');
    assert(p3of3, 'Page 3 must render "Page 3 of 3"');
    assert.strictEqual(decPage4Number, undefined, 'Declaration Form (Page 4) must NOT have page numbering');
    console.log('  ✓ PASS: Extra-large PL (105 parts) splits across 4 pages with "Page 1 of 3", "Page 2 of 3", "Page 3 of 3", and blank Declaration pagination');

  } finally {
    jspdfModule.default.jsPDF = origJSPDF;
  }

  console.log('\n====================================================');
  console.log('RESULTS: ALL XLSX & PDF ENHANCEMENT TESTS PASSED (100%)');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
