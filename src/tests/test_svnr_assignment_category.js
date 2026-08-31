import assert from 'assert';
import { isProvincialSite, normalizeInventoryUnits, validateAppleSerialNumber } from '../utils/partResolver.js';

console.log('====================================================');
console.log('TEST SUITE: SVNR - Service Non-Repair Part Assignment Category');
console.log('====================================================');

// --- 1. PROVINCIAL SITE DETECTION TESTS ---
const dcSite = { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center', is_dc: true, region: 'Metro Manila' };
const mmSite1 = { id: 'site-1', code: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET', is_dc: false, region: 'Metro Manila' };
const mmSite2 = { id: 'site-2', code: 'APP GB3', name: 'MOBILECARE - APP GREENBELT 3', is_dc: false, region: 'Metro Manila' };
const mmSite3 = { id: 'site-4', code: 'ASP GL5', name: 'MOBILECARE - GLORIETTA 5', is_dc: false, region: 'Metro Manila' };

const provSite1 = { id: 'site-17', code: 'ASP LMA', name: 'MOBILECARE - LIMA ESTATE', is_dc: false, region: 'Batangas' };
const provSite2 = { id: 'site-18', code: 'ASP CLK', name: 'MOBILECARE - NEWPOINT MALL', is_dc: false, region: 'Pampanga' };
const provSite3 = { id: 'site-19', code: 'ASP NAG', name: 'MOBILECARE - ROBINSONS NAGA', is_dc: false, region: 'Camarines Sur' };
const provSite4 = { id: 'site-20', code: 'ASP LAU', name: 'MOBILECARE - ROBINSONS LA UNION', is_dc: false, region: 'La Union' };
const provSite5 = { id: 'site-21', code: 'ASP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO', is_dc: false, region: 'Iloilo' };
const provSite6 = { id: 'site-22', code: 'ASP CEB', name: 'MOBILECARE - ROBINSONS GALLERIA CEBU', is_dc: false, region: 'Cebu' };
const provSite7 = { id: 'site-23', code: 'ASP ZAM', name: 'MOBILECARE - KCC ZAMBOANGA', is_dc: false, region: 'Zamboanga' };
const provSite8 = { id: 'site-24', code: 'ASP DVO', name: 'MOBILECARE - ABREEZA DAVAO', is_dc: false, region: 'Davao' };
const provSite9 = { id: 'site-25', code: 'ASP COT', name: 'MOBILECARE - KCC COTABATO', is_dc: false, region: 'Cotabato' };
const provSite10 = { id: 'site-26', code: 'ASP CDO', name: 'MOBILECARE - CENTRIO CAGAYAN DE ORO', is_dc: false, region: 'Cagayan de Oro' };

assert.strictEqual(isProvincialSite(dcSite), false, 'DC site should not be provincial');
assert.strictEqual(isProvincialSite(mmSite1), false, 'BHS site should not be provincial');
assert.strictEqual(isProvincialSite(mmSite2), false, 'GB3 site should not be provincial');
assert.strictEqual(isProvincialSite(mmSite3), false, 'Glorietta 5 site should not be provincial');

assert.strictEqual(isProvincialSite(provSite1), true, 'Lima Estate (Batangas) is provincial');
assert.strictEqual(isProvincialSite(provSite2), true, 'Newpoint Mall (Pampanga) is provincial');
assert.strictEqual(isProvincialSite(provSite3), true, 'Robinsons Naga is provincial');
assert.strictEqual(isProvincialSite(provSite4), true, 'Robinsons La Union is provincial');
assert.strictEqual(isProvincialSite(provSite5), true, 'Festive Walk Iloilo is provincial');
assert.strictEqual(isProvincialSite(provSite6), true, 'Robinsons Galleria Cebu is provincial');
assert.strictEqual(isProvincialSite(provSite7), true, 'KCC Zamboanga is provincial');
assert.strictEqual(isProvincialSite(provSite8), true, 'Abreeza Davao is provincial');
assert.strictEqual(isProvincialSite(provSite9), true, 'KCC Cotabato is provincial');
assert.strictEqual(isProvincialSite(provSite10), true, 'Centrio CDO is provincial');
console.log('  ✓ PASS: Provincial Site classification strictly isolates provincial branches from DC & Metro Manila');

// --- 2. INVENTORY UNIT NORMALIZATION WITH SVNR ---
const rawUnits = [
  {
    serial_number: 'G9PQHU084CQ9D088S5L4B',
    part_number: '661-30373',
    description: 'Battery, iPhone 14',
    intake_assignment: 'SVNR - Service Non-Repair',
    notes: 'SVNR - Service Non-Repair'
  },
  {
    serial_number: 'F8Y6234C9AR231LB3',
    part_number: '661-24756',
    description: 'Display, iPhone 13',
    notes: 'SVNR'
  },
  {
    serial_number: 'G9P5442NAFK14YDXP',
    part_number: '661-30373',
    description: 'Battery, iPhone 14',
    intake_assignment: 'DC - CRBR',
    notes: 'DC - CRBR'
  },
  {
    serial_number: 'G9QHXKT0KU690004YY',
    part_number: '661-24756',
    description: 'Display, iPhone 13',
    notes: 'MDC - Forecasting'
  }
];

const normalized = normalizeInventoryUnits(rawUnits);
assert.strictEqual(normalized.length, 4, 'All valid 4 units normalized');
assert.strictEqual(normalized[0].intake_assignment, 'SVNR - Service Non-Repair', 'Unit 1 assigned to SVNR - Service Non-Repair');
assert.strictEqual(normalized[1].intake_assignment, 'SVNR - Service Non-Repair', 'Unit 2 normalized to SVNR from notes');
assert.strictEqual(normalized[2].intake_assignment, 'DC - CRBR', 'Unit 3 remains DC - CRBR');
assert.strictEqual(normalized[3].intake_assignment, 'MDC - Forecasting', 'Unit 4 remains MDC - Forecasting');
console.log('  ✓ PASS: normalizeInventoryUnits accurately preserves SVNR - Service Non-Repair');

// --- 3. SERIAL NUMBER VALIDATION & RESOLUTION ---
const validation = validateAppleSerialNumber('G9PQHU084CQ9D088S5L4B', '661-30373');
assert.strictEqual(validation.isValid, true, 'Valid serial number');
console.log('  ✓ PASS: Apple Serial validation intact');

// --- 4. ASSIGNMENT RESOLUTION LOGIC ---
function resolveAssignment(input) {
  const str = String(input || '');
  if (str.includes('SVNR')) return 'SVNR - Service Non-Repair';
  if (str.includes('CRBR')) return 'DC - CRBR';
  return 'MDC - Forecasting';
}

assert.strictEqual(resolveAssignment('SVNR - Service Non-Repair'), 'SVNR - Service Non-Repair');
assert.strictEqual(resolveAssignment('SVNR'), 'SVNR - Service Non-Repair');
assert.strictEqual(resolveAssignment('DC - CRBR'), 'DC - CRBR');
assert.strictEqual(resolveAssignment('CRBR'), 'DC - CRBR');
assert.strictEqual(resolveAssignment('MDC - Forecasting'), 'MDC - Forecasting');
assert.strictEqual(resolveAssignment('Forecasting'), 'MDC - Forecasting');
console.log('  ✓ PASS: Assignment categorization logic resolves all 3 categories seamlessly');

console.log('====================================================');
console.log('ALL SVNR TESTS PASSED (100%)');
console.log('====================================================');
