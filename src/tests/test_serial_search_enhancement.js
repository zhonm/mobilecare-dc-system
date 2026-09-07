import assert from 'assert';
import {
  cleanSerialNumberInput,
  resolveSerialFullDetails,
  searchSerialsWithFullDetails
} from '../utils/serialTracker.js';

console.log('====================================================');
console.log('TEST SUITE: Serial Number Search Intelligence & Custody');
console.log('====================================================');

let passedTests = 0;
function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------
// Mock Reference Data
// ----------------------------------------------------
const mockSites = [
  { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center Main Warehouse', is_dc: true },
  { id: 'site-podium', code: 'MC-POD', name: 'Mobile Care The Podium', region: 'Metro Manila', province: false },
  { id: 'site-moa', code: 'MC-MOA', name: 'Mobile Care SM Mall of Asia', region: 'Metro Manila', province: false },
  { id: 'site-cebu', code: 'MC-CEB', name: 'Mobile Care Ayala Center Cebu', region: 'Provincial', province: true }
];

const mockParts = [
  {
    id: 'p-1',
    part_number: '661-30401',
    description: 'Display, iPhone 14 Pro Max',
    iphone_model: 'iPhone 14 Pro Max',
    category_id: 'cat-display',
    stocking_price: 350
  },
  {
    id: 'p-2',
    part_number: '661-42728',
    description: 'Battery, iPhone 16 Pro',
    iphone_model: 'iPhone 16 Pro',
    category_id: 'cat-battery',
    stocking_price: 99
  }
];

// ----------------------------------------------------
// 1. GS1 Barcode Prefix Cleaning & Normalization
// ----------------------------------------------------
console.log('\n--- 1. GS1 Barcode & Prefix Normalization ---');

it('Normalizes plain serial number and uppercase', () => {
  assert.strictEqual(cleanSerialNumberInput('  c39z90aah0d5  '), 'C39Z90AAH0D5');
});

it('Strips GS1 "S" barcode scanner prefix', () => {
  assert.strictEqual(cleanSerialNumberInput('SC39Z90AAH0D5'), 'C39Z90AAH0D5');
  assert.strictEqual(cleanSerialNumberInput('sFG9HTN005WS00006TT'), 'FG9HTN005WS00006TT');
});

it('Strips GS1 "1S" barcode scanner prefix', () => {
  assert.strictEqual(cleanSerialNumberInput('1SC39Z90AAH0D5'), 'C39Z90AAH0D5');
  assert.strictEqual(cleanSerialNumberInput('1s66130401FG9HTN0'), '66130401FG9HTN0');
});

it('Handles empty or invalid input safely', () => {
  assert.strictEqual(cleanSerialNumberInput(''), '');
  assert.strictEqual(cleanSerialNumberInput(null), '');
  assert.strictEqual(cleanSerialNumberInput(undefined), '');
});

// ----------------------------------------------------
// 2. DC Stock Serial Resolution
// ----------------------------------------------------
console.log('\n--- 2. DC Stock Serial Resolution ---');

it('Resolves serial currently in stock at Central DC Warehouse', () => {
  const inventoryUnits = [
    {
      id: 'u-dc-1',
      serial_number: 'DCDC100020003000',
      part_number: '661-30401',
      description: 'Display, iPhone 14 Pro Max',
      status: 'in_stock',
      current_site_id: 'site-dc',
      box_number: 2,
      po_number: 'PO-2026-001',
      received_at: '2026-09-01T08:30:00Z',
      received_by: 'Warehouse Admin'
    }
  ];

  const result = resolveSerialFullDetails('DCDC100020003000', {
    inventoryUnits,
    shipments: [],
    repairUsageRecords: [],
    sites: mockSites,
    parts: mockParts
  });

  assert.ok(result, 'Result should exist');
  assert.strictEqual(result.serial_number, 'DCDC100020003000');
  assert.strictEqual(result.isDcSite, true, 'Should be DC site');
  assert.strictEqual(result.statusKey, 'in_stock_dc');
  assert.strictEqual(result.statusBadgeType, 'dc');
  assert.strictEqual(result.isUsed, false, 'Should NOT be used');
  assert.strictEqual(result.partNumber, '661-30401');
  assert.strictEqual(result.boxNumber, 2);
  assert.ok(result.dcScanInDate, 'Should have DC scan in date');
});

// ----------------------------------------------------
// 3. Site Stock Serial Resolution with Recorded Arrival Date
// ----------------------------------------------------
console.log('\n--- 3. Site Stock & Recorded Arrival Date Resolution ---');

it('Resolves serial received at branch with verified arrival date from confirmed shipment manifest', () => {
  const inventoryUnits = [
    {
      id: 'u-site-1',
      serial_number: 'SITE888999111222',
      part_number: '661-42728',
      status: 'in_stock',
      current_site_id: 'site-podium',
      box_number: 1,
      po_number: 'PO-2026-088'
    }
  ];

  const shipments = [
    {
      id: 'shp-100',
      shipment_number: 'SHP-2026-0099',
      site_id: 'site-podium',
      status: 'received_confirmed',
      shipment_date: '2026-09-02',
      received_date: '2026-09-04',
      received_at: '2026-09-04T14:22:00Z',
      received_by_name: 'Podium Branch Supervisor',
      courier_name: 'LBC Express',
      tracking_number: 'LBC-99882211',
      items: [
        {
          part_number: '661-42728',
          serial_number: 'SITE888999111222',
          box_number: 1
        }
      ]
    }
  ];

  const result = resolveSerialFullDetails('SITE888999111222', {
    inventoryUnits,
    shipments,
    repairUsageRecords: [],
    sites: mockSites,
    parts: mockParts
  });

  assert.ok(result, 'Result should exist');
  assert.strictEqual(result.isDcSite, false, 'Must be branch site');
  assert.strictEqual(result.siteName, 'Mobile Care The Podium');
  assert.strictEqual(result.statusKey, 'in_stock_site');
  assert.strictEqual(result.isUsed, false, 'Must NOT be used');
  // Recorded arrival date at site
  assert.strictEqual(result.siteArrivalFormatted, '2026-09-04', 'Arrival date must be verified from manifest');
  assert.ok(result.siteArrivalStatus.includes('Arrived on 2026-09-04'));
  assert.ok(result.linkedShipment, 'Linked shipment must be resolved');
  assert.strictEqual(result.linkedShipment.trackingNumber, 'LBC-99882211');
});

// ----------------------------------------------------
// 4. Used Serial Resolution & Date Used in System
// ----------------------------------------------------
console.log('\n--- 4. Used Serial Resolution & Date Used ---');

it('Resolves serial consumed in repair with date used, work order # and technician', () => {
  const inventoryUnits = [
    {
      id: 'u-used-1',
      serial_number: 'USED777666555444',
      part_number: '661-30401',
      status: 'used',
      current_site_id: 'site-cebu',
      box_number: 1
    }
  ];

  const repairUsageRecords = [
    {
      id: 'rep-99',
      serial_number: 'USED777666555444',
      part_number: '661-30401',
      site_id: 'site-cebu',
      site_name: 'Mobile Care Ayala Center Cebu',
      used_at: '2026-09-06T10:15:30Z',
      work_order_number: 'WO-CEBU-2026-4401',
      used_by: 'Juan Dela Cruz (ACMT)',
      usage_notes: 'Replaced cracked OLED screen for client warranty claim'
    }
  ];

  const result = resolveSerialFullDetails('USED777666555444', {
    inventoryUnits,
    shipments: [],
    repairUsageRecords,
    sites: mockSites,
    parts: mockParts
  });

  assert.ok(result, 'Result should exist');
  assert.strictEqual(result.isUsed, true, 'isUsed must be true');
  assert.strictEqual(result.statusKey, 'used');
  assert.strictEqual(result.statusBadgeType, 'used');
  assert.strictEqual(result.siteName, 'Mobile Care Ayala Center Cebu');
  // Date when the part was used in the system
  assert.strictEqual(result.dateUsed, '2026-09-06T10:15:30Z');
  assert.ok(result.dateUsedFormatted.includes('2026-09-06'));
  assert.strictEqual(result.workOrderNumber, 'WO-CEBU-2026-4401');
  assert.strictEqual(result.usedByName, 'Juan Dela Cruz (ACMT)');
  assert.strictEqual(result.usageNotes, 'Replaced cracked OLED screen for client warranty claim');
});

// ----------------------------------------------------
// 5. In-Transit Serial Resolution
// ----------------------------------------------------
console.log('\n--- 5. In-Transit Serial Resolution ---');

it('Resolves serial dispatched and in transit to branch', () => {
  const shipments = [
    {
      id: 'shp-555',
      shipment_number: 'SHP-2026-0555',
      site_id: 'site-moa',
      status: 'shipped',
      shipment_date: '2026-09-07',
      courier_name: 'Grab Express',
      tracking_number: 'GRAB-771122',
      items: [
        {
          part_number: '661-42728',
          serial_number: 'TRANSIT111222333',
          box_number: 3
        }
      ]
    }
  ];

  const result = resolveSerialFullDetails('TRANSIT111222333', {
    inventoryUnits: [],
    shipments,
    repairUsageRecords: [],
    sites: mockSites,
    parts: mockParts
  });

  assert.ok(result, 'Result should exist');
  assert.strictEqual(result.statusKey, 'in_transit');
  assert.strictEqual(result.statusBadgeType, 'transit');
  assert.strictEqual(result.siteName, 'Mobile Care SM Mall of Asia');
  assert.strictEqual(result.isUsed, false);
  assert.ok(result.siteArrivalStatus.includes('Pending Site Arrival'));
});

// ----------------------------------------------------
// 6. Multi-Dataset Search & Fuzzy Matching
// ----------------------------------------------------
console.log('\n--- 6. Multi-Dataset Search & Match Ranking ---');

it('Finds serials matching partial query across inventory, shipments, and repairs', () => {
  const inventoryUnits = [
    { id: 'u-1', serial_number: 'AAA111BBB222', part_number: '661-30401', status: 'in_stock', current_site_id: 'site-dc' },
    { id: 'u-2', serial_number: 'AAA111CCC333', part_number: '661-42728', status: 'in_stock', current_site_id: 'site-podium' }
  ];

  const repairUsageRecords = [
    { id: 'u-3', serial_number: 'AAA111DDD444', part_number: '661-30401', site_id: 'site-cebu', used_at: '2026-09-05' }
  ];

  const matches = searchSerialsWithFullDetails('AAA111', {
    inventoryUnits,
    shipments: [],
    repairUsageRecords,
    sites: mockSites,
    parts: mockParts
  }, 10);

  assert.strictEqual(matches.length, 3, 'Should find all 3 matching serials');
  assert.strictEqual(matches[0].serial_number, 'AAA111BBB222');
  assert.strictEqual(matches[1].serial_number, 'AAA111CCC333');
  assert.strictEqual(matches[2].serial_number, 'AAA111DDD444');
});

console.log('\n====================================================');
console.log(`ALL TESTS PASSED! (${passedTests}/${passedTests})`);
console.log('====================================================');
