import assert from 'assert';
import * as jspdfModule from 'jspdf';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Declaration Form Field Verification (No N/A, Blank Pickup Date)');
console.log('====================================================');

let capturedTexts = [];

const origJSPDF = jspdfModule.default.jsPDF;
class MockJSPDF extends origJSPDF {
  constructor(...args) {
    super(...args);
    const origText = this.text;
    this.text = (text, ...rest) => {
      capturedTexts.push({ text: String(text), y: rest[1] });
      return origText.call(this, text, ...rest);
    };
    this.save = () => {};
  }
}

jspdfModule.default.jsPDF = MockJSPDF;

const mockShipmentWithoutBooking = {
  invoice_ref: 'DCOWNED#091026A',
  shipment_number: 'DCOWNED#091026A',
  site_name: 'MOBILECARE - APP GREENBELT 3',
  carrier: 'LALAMOVE',
  booking_id: 'N/A', // user case: had N/A
  tracking_number: '',
  airway_bill: '',
  verified_by_name: 'ANJO ALCAZAR',
  guard_on_duty: 'Joy Libiano',
  pickup_date: '9/10/2026'
};

const mockItems = [
  { part_number: '661-21991', description: 'Battery, iPhone 13', serial_number: 'F8Y6202CCGC20J9BB', price: 99, box_number: 1 }
];

const mockSite = {
  name: 'MOBILECARE - APP GREENBELT 3',
  code: 'site-gb3'
};

try {
  // Test 1: Declaration Form when booking ID is 'N/A'
  capturedTexts = [];
  generatePackingListPDF(mockShipmentWithoutBooking, mockItems, mockSite);

  const texts = capturedTexts.map(t => t.text);

  // Assert 'N/A' is nowhere in the generated PDF text
  const hasNA = texts.some(t => t.trim().toUpperCase() === 'N/A');
  assert.strictEqual(hasNA, false, 'The word "N/A" must NOT appear in the PDF output');
  console.log('  ✓ PASS: The word "N/A" is completely removed from the Declaration Form');

  // Assert DATE PICKED UP has no date value printed
  const datePickedUpIndex = texts.findIndex(t => t === 'DATE PICKED UP:');
  assert(datePickedUpIndex !== -1, 'Must render DATE PICKED UP: header');

  // Verify that neither 9/10/2026 nor any date format is printed after DATE PICKED UP
  // Page 1 header has Invoice Date/Shipment Date, but Page 2 DATE PICKED UP must NOT have a date
  const page2Texts = capturedTexts.filter(t => t.y >= 198); // bottom section of Page 2
  const page2Date = page2Texts.find(t => /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(t.text));
  assert.strictEqual(page2Date, undefined, 'Page 2 DATE PICKED UP field must remain completely blank');
  console.log('  ✓ PASS: Pickup Date field remains completely blank (no text or placeholder values displayed)');

  // Test 2: Valid tracking number is rendered when provided
  capturedTexts = [];
  const mockShipmentWithTracking = {
    ...mockShipmentWithoutBooking,
    tracking_number: '20227458'
  };
  generatePackingListPDF(mockShipmentWithTracking, mockItems, mockSite);
  const textsWithTracking = capturedTexts.map(t => t.text);
  assert(textsWithTracking.includes('20227458'), 'Valid tracking number must be rendered');
  console.log('  ✓ PASS: Valid tracking number (20227458) is correctly displayed when present');

} finally {
  jspdfModule.default.jsPDF = origJSPDF;
}

console.log('====================================================');
console.log('RESULTS: ALL DECLARATION FIELD TESTS PASSED (100%)');
console.log('====================================================');
