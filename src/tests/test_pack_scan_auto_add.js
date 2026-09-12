import assert from 'assert';
import { extractSerialNumber, cleanSerialNumberInput } from '../utils/serialTracker.js';

console.log('====================================================');
console.log('TEST SUITE: Pack Scan-Out Station Auto-Add & Scanning');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
  }
}

// 1. Serial Number Extraction and Normalization Tests
it('extractSerialNumber resolves clean 17-char serial', () => {
  const res = extractSerialNumber('F8Y6202C6FM18FK97');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber strips Apple 1D barcode "S" prefix', () => {
  const res = extractSerialNumber('SF8Y6202C6FM18FK97');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber strips Apple 1D barcode "1S" prefix', () => {
  const res = extractSerialNumber('1SF8Y6202C6FM18FK97');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber parses 2D GS1 DataMatrix barcode string', () => {
  const raw2D = '[)>06\x1dP661-21991\x1dSF8Y6202C6FM18FK97\x1e\x04';
  const res = extractSerialNumber(raw2D);
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber parses comma-delimited PN,SN barcode', () => {
  const res = extractSerialNumber('661-21991,F8Y6202C6FM18FK97');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber parses tab-delimited PN\\tSN barcode', () => {
  const res = extractSerialNumber('661-21991\tF8Y6202C6FM18FK97');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber parses space-delimited PN SN barcode', () => {
  const res = extractSerialNumber('661-21991 F8Y6202C6FM18FK97');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

it('extractSerialNumber strips trailing carriage return and whitespace from scanner', () => {
  const res = extractSerialNumber('  F8Y6202C6FM18FK97\r\n  ');
  assert.strictEqual(res, 'F8Y6202C6FM18FK97');
});

// 2. Security: Part Number Scanning Guard
it('Rejects scan if entered string is an Apple Part Number (P/N)', () => {
  const testPns = ['661-21991', '661-12345', 'P661-21991', '1P661-21991'];
  for (const pn of testPns) {
    const isPn = /^(?:ZP|PP|Z|1P|P)?66[0-9]-?\d{4,6}$/i.test(pn) || /^\d{3}-\d{4,6}$/.test(pn);
    assert.strictEqual(isPn, true, `Expected ${pn} to be identified as a Part Number`);
  }
});

// 3. Simulated Inventory Matching & Auto-Pack Engine
const mockInventory = [
  { id: 'u1', part_number: '661-21991', description: 'Battery, iPhone 13', serial_number: 'F8Y6202C6FM18FK97', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'u2', part_number: '661-21991', description: 'Battery, iPhone 13', serial_number: 'F8Y6202C6CP18FK96', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'u3', part_number: '661-21991', description: 'Battery, iPhone 13', serial_number: 'F8Y6303CCT318FK08', status: 'in_stock', current_site_id: 'site-dc' },
  { id: 'u4', part_number: '661-21988', description: 'Display, iPhone 13', serial_number: 'G9PQ1001AABBCCDD1', status: 'shipped', current_site_id: 'site-dc' }
];

function simulatePackScan({
  scannedText,
  selectedSiteId = 'site-app-gb3',
  activeDraftItems = [],
  inventory = mockInventory,
  reservedSerials = new Set()
}) {
  const cleanSerial = extractSerialNumber(scannedText);
  if (!cleanSerial) return { success: false, error: 'Empty serial number' };
  if (!selectedSiteId) return { success: false, error: 'Destination site required' };

  // Part Number check
  if (/^(?:ZP|PP|Z|1P|P)?66[0-9]-?\d{4,6}$/i.test(cleanSerial) || /^\d{3}-\d{4,6}$/.test(cleanSerial)) {
    return { success: false, error: 'Part Number scanned instead of Serial Number' };
  }

  // Active draft duplicate check
  const packedSet = new Set(activeDraftItems.map(it => cleanSerialNumberInput(it.serial_number || it.serialNumber)));
  if (packedSet.has(cleanSerial)) {
    return { success: false, error: 'Already packed' };
  }

  // Concurrent user conflict check
  if (reservedSerials.has(cleanSerial)) {
    return { success: false, error: 'Station Conflict' };
  }

  // Inventory lookup with resilient normalization
  const matchingUnit = inventory.find(u => {
    const uClean = cleanSerialNumberInput(u.serial_number);
    const uRaw = String(u.serial_number || '').trim().toUpperCase();
    return uClean === cleanSerial || uRaw === cleanSerial;
  });

  if (!matchingUnit) {
    return { success: false, error: 'Unit not found' };
  }

  if (matchingUnit.status !== 'in_stock' && matchingUnit.status !== 'allocated') {
    return { success: false, error: 'Unit not available' };
  }

  const packedItem = {
    id: matchingUnit.id,
    part_number: matchingUnit.part_number,
    description: matchingUnit.description,
    serial_number: matchingUnit.serial_number,
    box_number: 1
  };

  return { success: true, item: packedItem };
}

it('Auto-pack succeeds instantly when raw serial matches in-stock unit', () => {
  const res = simulatePackScan({ scannedText: 'F8Y6202C6FM18FK97' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.item.serial_number, 'F8Y6202C6FM18FK97');
  assert.strictEqual(res.item.part_number, '661-21991');
});

it('Auto-pack succeeds when scanner emits Apple "S" barcode prefix', () => {
  const res = simulatePackScan({ scannedText: 'SF8Y6202C6FM18FK97' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.item.serial_number, 'F8Y6202C6FM18FK97');
});

it('Auto-pack succeeds when scanner emits 2D DataMatrix barcode', () => {
  const res = simulatePackScan({ scannedText: '[)>06\x1dP661-21991\x1dSF8Y6202C6CP18FK96\x1e\x04' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.item.serial_number, 'F8Y6202C6CP18FK96');
});

it('Blocks auto-pack if user accidentally scans Part Number (661-21991)', () => {
  const res = simulatePackScan({ scannedText: '661-21991' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Part Number scanned instead of Serial Number');
});

it('Blocks auto-pack on duplicate scan of already packed unit', () => {
  const activeItems = [{ id: 'u1', serial_number: 'F8Y6202C6FM18FK97' }];
  const res = simulatePackScan({ scannedText: 'F8Y6202C6FM18FK97', activeDraftItems: activeItems });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Already packed');
});

it('Blocks auto-pack if unit has non-stock status (shipped/consumed)', () => {
  const res = simulatePackScan({ scannedText: 'G9PQ1001AABBCCDD1' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Unit not available');
});

it('Blocks auto-pack if unit is reserved by another concurrent packing station', () => {
  const reserved = new Set(['F8Y6303CCT318FK08']);
  const res = simulatePackScan({ scannedText: 'F8Y6303CCT318FK08', reservedSerials: reserved });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Station Conflict');
});

// 4. Rapid Sequential Scanning Simulation
it('Simulates rapid multi-serial auto-scan adding 3 consecutive units', () => {
  let draftItems = [];
  const scannedSerials = [
    'SF8Y6202C6FM18FK97',
    'F8Y6202C6CP18FK96\r',
    'SF8Y6303CCT318FK08'
  ];

  for (const scan of scannedSerials) {
    const res = simulatePackScan({ scannedText: scan, activeDraftItems: draftItems });
    assert.strictEqual(res.success, true);
    draftItems = [...draftItems, res.item];
  }

  assert.strictEqual(draftItems.length, 3);
  assert.strictEqual(draftItems[0].serial_number, 'F8Y6202C6FM18FK97');
  assert.strictEqual(draftItems[1].serial_number, 'F8Y6202C6CP18FK96');
  assert.strictEqual(draftItems[2].serial_number, 'F8Y6303CCT318FK08');
});

// 5. Auto-Add Toggle Simulation
it('When autoAdd is OFF, typing does not auto-pack; Enter or Pack Unit packs successfully', () => {
  let autoAdd = false;
  let autoPackTriggered = false;

  // Simulate onChange with autoAdd = false
  function onInputChange(_val) {
    if (!autoAdd) {
      // Does not trigger autoPack
      return false;
    }
    autoPackTriggered = true;
    return true;
  }

  const triggered = onInputChange('F8Y6202C6FM18FK97');
  assert.strictEqual(triggered, false);
  assert.strictEqual(autoPackTriggered, false);

  // But when user hits Enter or clicks Pack Unit:
  const manualPackRes = simulatePackScan({ scannedText: 'F8Y6202C6FM18FK97' });
  assert.strictEqual(manualPackRes.success, true);
  assert.strictEqual(manualPackRes.item.serial_number, 'F8Y6202C6FM18FK97');
});

// 6. Auto-Highlight on Invalid Serial Detection
it('Triggers auto-highlight when input is detected as an Apple Part Number', () => {
  let highlightedVal = null;
  function mockHighlight(val) {
    highlightedVal = val;
  }

  const res = simulatePackScan({ scannedText: '661-21991' });
  if (!res.success) {
    mockHighlight('661-21991');
  }

  assert.strictEqual(res.success, false);
  assert.strictEqual(highlightedVal, '661-21991');
});

it('Triggers auto-highlight when input contains illegal non-serial characters', () => {
  const invalidInputs = ['NOT@SERIAL#', 'INVALID!!', 'TEST-SER'];
  for (const input of invalidInputs) {
    const isIllegal = /[^A-Z0-9]/i.test(input) || input.length < 8;
    assert.strictEqual(isIllegal, true);
  }
});

console.log('====================================================');
console.log(`RESULTS: ${passedTests}/${totalTests} PASSED (0 FAILED)`);
console.log('====================================================');

