import assert from 'assert';
import * as jspdfModule from 'jspdf';
import {
  hasBatteryItem,
  detectRecommendedShippingMode,
  formatCourierWithMode,
  getShipmentCourierDisplay
} from '../utils/shipmentHelpers.js';
import { generatePackingListPDF } from '../utils/pdfGenerator.js';

console.log('====================================================');
console.log('TEST SUITE: Lite Express Air vs. Land Selection & PDF Display');
console.log('====================================================');

// --- 1. Battery Detection Tests ---
const batteryItem = { part_number: '661-21991', description: 'Battery, iPhone 13 Pro', serial_number: 'BATT12345678' };
const displayItem = { part_number: '661-18034', description: 'Display Assembly, iPhone 13', serial_number: 'DISP12345678' };
const cameraItem = { part_number: '661-09823', description: 'Rear Camera, iPhone 12', serial_number: 'CAM12345678' };

assert.strictEqual(hasBatteryItem([batteryItem]), true, 'Battery item should be detected as battery');
assert.strictEqual(hasBatteryItem([displayItem]), false, 'Display item should not be detected as battery');
assert.strictEqual(hasBatteryItem([displayItem, cameraItem]), false, 'Display and camera should not be detected as battery');
assert.strictEqual(hasBatteryItem([displayItem, batteryItem]), true, 'Display and battery combined must detect battery');
console.log('  ✓ PASS: hasBatteryItem detection works accurately');

// --- 2. Recommended Mode Auto-Detection Tests ---
assert.strictEqual(detectRecommendedShippingMode([displayItem]), 'Air', 'Display-only parts should recommend Air');
assert.strictEqual(detectRecommendedShippingMode([batteryItem]), 'Land', 'Battery parts must recommend Land');
assert.strictEqual(detectRecommendedShippingMode([batteryItem, displayItem]), 'Land', 'Battery + Display parts must recommend Land');
console.log('  ✓ PASS: detectRecommendedShippingMode accurately flags Land for batteries, Air for non-batteries');

// --- 3. Format Courier With Mode Tests ---
assert.strictEqual(formatCourierWithMode('Lite Express', 'Air'), 'Lite Express (Air)');
assert.strictEqual(formatCourierWithMode('Lite Express', 'Land'), 'Lite Express (Land)');
assert.strictEqual(formatCourierWithMode('Lite Express (Land)', 'Air'), 'Lite Express (Air)');
assert.strictEqual(formatCourierWithMode('Lite Express (Air)', 'Land'), 'Lite Express (Land)');
assert.strictEqual(formatCourierWithMode('Lalamove', 'Air'), 'Lalamove');
assert.strictEqual(formatCourierWithMode('Utility', 'Land'), 'Utility');
console.log('  ✓ PASS: formatCourierWithMode handles Lite Express variants and preserves other couriers');

// --- 4. Shipment Courier Display Tests ---
const airShipment = {
  carrier: 'Lite Express',
  shipping_mode: 'Air',
  items: [displayItem]
};
assert.strictEqual(getShipmentCourierDisplay(airShipment), 'Lite Express (Air)');

const landShipment = {
  carrier: 'Lite Express',
  shipping_mode: 'Land',
  items: [batteryItem, displayItem]
};
assert.strictEqual(getShipmentCourierDisplay(landShipment), 'Lite Express (Land)');

const autoDetectedBatteryShipment = {
  carrier: 'Lite Express',
  items: [batteryItem, displayItem]
};
assert.strictEqual(getShipmentCourierDisplay(autoDetectedBatteryShipment), 'Lite Express (Land)');

const autoDetectedDisplayShipment = {
  carrier: 'Lite Express',
  items: [displayItem]
};
assert.strictEqual(getShipmentCourierDisplay(autoDetectedDisplayShipment), 'Lite Express (Air)');
console.log('  ✓ PASS: getShipmentCourierDisplay resolves correctly for explicit and auto-detected modes');

// --- 5. PDF Generation Verification (Packing List & Declaration Form) ---
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

const mockSite = {
  name: 'MOBILECARE - SM CEBU',
  code: 'site-cebu',
  address: 'SM City Cebu, North Reclamation Area, Cebu City'
};

try {
  // Test 5A: Air Express PDF
  capturedTexts = [];
  const testAirShipment = {
    invoice_ref: 'MC-2026-AIR-01',
    shipment_number: 'MC-2026-AIR-01',
    carrier: 'Lite Express',
    shipping_mode: 'Air',
    tracking_number: 'AIR-998877',
    site_name: 'MOBILECARE - SM CEBU',
    items: [displayItem]
  };

  generatePackingListPDF(testAirShipment, [displayItem], mockSite);
  const airTexts = capturedTexts.map(t => t.text);

  assert(airTexts.includes('Lite Express (Air)'), 'Packing List Page 1 must display "Lite Express (Air)"');
  assert(airTexts.includes('LITE EXPRESS (AIR)'), 'Declaration Form Page 2 must display "LITE EXPRESS (AIR)"');
  console.log('  ✓ PASS: PDF correctly renders "Lite Express (Air)" on PL and "LITE EXPRESS (AIR)" on Declaration Form');

  // Test 5B: Land Cargo PDF
  capturedTexts = [];
  const testLandShipment = {
    invoice_ref: 'MC-2026-LAND-02',
    shipment_number: 'MC-2026-LAND-02',
    carrier: 'Lite Express',
    shipping_mode: 'Land',
    tracking_number: 'LAND-445566',
    site_name: 'MOBILECARE - SM CEBU',
    items: [batteryItem, displayItem]
  };

  generatePackingListPDF(testLandShipment, [batteryItem, displayItem], mockSite);
  const landTexts = capturedTexts.map(t => t.text);

  assert(landTexts.includes('Lite Express (Land)'), 'Packing List Page 1 must display "Lite Express (Land)"');
  assert(landTexts.includes('LITE EXPRESS (LAND)'), 'Declaration Form Page 2 must display "LITE EXPRESS (LAND)"');
  console.log('  ✓ PASS: PDF correctly renders "Lite Express (Land)" on PL and "LITE EXPRESS (LAND)" on Declaration Form');

} finally {
  jspdfModule.default.jsPDF = origJSPDF;
}

console.log('====================================================');
console.log('RESULTS: ALL LITE EXPRESS AIR & LAND TESTS PASSED (100%)');
console.log('====================================================');
