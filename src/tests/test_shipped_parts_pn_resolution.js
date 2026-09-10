import assert from 'assert';
import {
  buildSerialDictionary,
  healShipmentItem,
  formatSerialsForExport,
  isUnknownPn,
  isUnknownDesc
} from '../utils/shipmentHelpers.js';

console.log('\n====================================================');
console.log('TEST SUITE: Shipped Parts Part Number & Description Resolution');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

// Mock parts catalog
const mockParts = [
  { id: 'p-21988', part_number: '661-21988', description: 'Display, iPhone 13', stocking_price: 279 },
  { id: 'p-22294', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', stocking_price: 69 },
  { id: 'p-21991', part_number: '661-21991', description: 'Battery, iPhone 13', stocking_price: 69 },
  { id: 'p-56050', part_number: '661-56050', description: 'Display, iPhone 17 Pro Max', stocking_price: 379 },
  { id: 'p-56065', part_number: '661-56065', description: 'Display, iPhone 17', stocking_price: 329 },
  { id: 'p-42726', part_number: '661-42726', description: 'Display, iPhone 16 Pro', stocking_price: 329 }
];

// Mock historical intake records from MDC202600016 AND DC2026082526
const mockDcIntakeRecords = [
  {
    id: 'MDC202600016 AND DC2026082526',
    record_name: 'MDC202600016 and DC2026082526',
    items: [
      { serial_number: 'GVH54810YM8PR5PAD', part_number: '661-21988', description: 'Display, iPhone 13', stocking_price: 279 },
      { serial_number: 'GVH54811CT7PR5PAD', part_number: '661-21988', description: 'Display, iPhone 13', stocking_price: 279 },
      { serial_number: 'G9P5524C0FWPR5QA4', part_number: '661-21988', description: 'Display, iPhone 13', stocking_price: 279 },
      { serial_number: 'GVCHU7014TG0000U6M', part_number: '661-56065', description: 'Display, iPhone 17', stocking_price: 329 },
      { serial_number: 'G9PHVHE6F2G0000MUY', part_number: '661-56050', description: 'Display, iPhone 17 Pro Max', stocking_price: 379 },
      { serial_number: 'G9PHRWT116R00005DP', part_number: '661-42726', description: 'Display, iPhone 16 Pro', stocking_price: 329 }
    ]
  }
];

// Mock inventory units (e.g. battery units)
const mockInventoryUnits = [
  { serial_number: 'F8Y6285C30S13XCBB', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', stocking_price: 69, status: 'in_stock' },
  { serial_number: 'F8Y6304C9QV18FKBQ', part_number: '661-21991', description: 'Battery, iPhone 13', stocking_price: 69, status: 'in_stock' }
];

// 1. Test buildSerialDictionary creation
test('buildSerialDictionary correctly indexes all serials from intake and inventory', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    dcIntakeRecords: mockDcIntakeRecords,
    inventoryUnits: mockInventoryUnits,
    parts: mockParts
  });

  assert.ok(serialDict.has('GVH54810YM8PR5PAD'), 'Must index GVH54810YM8PR5PAD');
  const d1 = serialDict.get('GVH54810YM8PR5PAD');
  assert.strictEqual(d1.part_number, '661-21988');
  assert.strictEqual(d1.description, 'Display, iPhone 13');

  assert.ok(serialDict.has('G9PHVHE6F2G0000MUY'), 'Must index G9PHVHE6F2G0000MUY');
  const d2 = serialDict.get('G9PHVHE6F2G0000MUY');
  assert.strictEqual(d2.part_number, '661-56050');
  assert.strictEqual(d2.description, 'Display, iPhone 17 Pro Max');

  assert.ok(serialDict.has('F8Y6285C30S13XCBB'), 'Must index F8Y6285C30S13XCBB');
  const d3 = serialDict.get('F8Y6285C30S13XCBB');
  assert.strictEqual(d3.part_number, '661-22294');
  assert.strictEqual(d3.description, 'Battery, iPhone 13 Pro Max');
});

// 2. Test healShipmentItem with UNKNOWN-PN
test('healShipmentItem heals corrupted UNKNOWN-PN items from dictionary', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    dcIntakeRecords: mockDcIntakeRecords,
    inventoryUnits: mockInventoryUnits,
    parts: mockParts
  });

  const corruptedItem = {
    id: 'shp-it-1',
    serial_number: 'GVH54810YM8PR5PAD',
    part_number: 'UNKNOWN-PN',
    description: 'Part Description',
    box_number: 1,
    cost: 0
  };

  const healed = healShipmentItem(corruptedItem, serialDict, partsMapByPn);
  assert.strictEqual(healed.part_number, '661-21988', 'Should heal part_number to 661-21988');
  assert.strictEqual(healed.description, 'Display, iPhone 13', 'Should heal description to Display, iPhone 13');
  assert.strictEqual(healed.cost, 279, 'Should heal cost to 279');
});

// 3. Test healShipmentItem with all 6 items from manifest DCOWNED#083126H (User Screenshot)
test('healShipmentItem heals all 6 items from manifest DCOWNED#083126H', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    dcIntakeRecords: mockDcIntakeRecords,
    inventoryUnits: mockInventoryUnits,
    parts: mockParts
  });

  const corruptedItems = [
    { serial_number: 'GVH54810YM8PR5PAD', part_number: 'UNKNOWN-PN', description: 'Part Description' },
    { serial_number: 'F8Y6285C30S13XCBB', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max' },
    { serial_number: 'F8Y6304C9QV18FKBQ', part_number: '661-21991', description: 'Battery, iPhone 13' },
    { serial_number: 'G9PHVHE6F2G0000MUY', part_number: 'UNKNOWN-PN', description: 'Part Description' },
    { serial_number: 'GVCHU7014TG0000U6M', part_number: 'UNKNOWN-PN', description: 'Part Description' },
    { serial_number: 'G9PHRWT116R00005DP', part_number: 'UNKNOWN-PN', description: 'Part Description' }
  ];

  const healed = corruptedItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));

  assert.strictEqual(healed[0].part_number, '661-21988');
  assert.strictEqual(healed[0].description, 'Display, iPhone 13');

  assert.strictEqual(healed[1].part_number, '661-22294');
  assert.strictEqual(healed[1].description, 'Battery, iPhone 13 Pro Max');

  assert.strictEqual(healed[2].part_number, '661-21991');
  assert.strictEqual(healed[2].description, 'Battery, iPhone 13');

  assert.strictEqual(healed[3].part_number, '661-56050');
  assert.strictEqual(healed[3].description, 'Display, iPhone 17 Pro Max');

  assert.strictEqual(healed[4].part_number, '661-56065');
  assert.strictEqual(healed[4].description, 'Display, iPhone 17');

  assert.strictEqual(healed[5].part_number, '661-42726');
  assert.strictEqual(healed[5].description, 'Display, iPhone 16 Pro');

  // Ensure zero UNKNOWN-PN remain
  const remainingUnknown = healed.filter(it => isUnknownPn(it.part_number) || isUnknownDesc(it.description));
  assert.strictEqual(remainingUnknown.length, 0, 'Zero items should remain UNKNOWN-PN');
});

// 4. Test manifest DCOWNED#083126G items (User Screenshot 1 & 2)
test('healShipmentItem heals items from manifest DCOWNED#083126G', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    dcIntakeRecords: mockDcIntakeRecords,
    inventoryUnits: mockInventoryUnits,
    parts: mockParts
  });

  const corruptedItems = [
    { serial_number: 'G9P5524C0FWPR5QA4', part_number: 'UNKNOWN-PN', description: 'Part Description' },
    { serial_number: 'GVH54811CT7PR5PAD', part_number: 'UNKNOWN-PN', description: 'Part Description' }
  ];

  const healed = corruptedItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));

  assert.strictEqual(healed[0].part_number, '661-21988');
  assert.strictEqual(healed[0].description, 'Display, iPhone 13');

  assert.strictEqual(healed[1].part_number, '661-21988');
  assert.strictEqual(healed[1].description, 'Display, iPhone 13');
});

// 5. Test description enrichment from part number
test('healShipmentItem enriches missing description when part number is known', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    parts: mockParts
  });

  const item = {
    serial_number: 'SN-TEST-12345',
    part_number: '661-56050',
    description: 'Part Description'
  };

  const healed = healShipmentItem(item, serialDict, partsMapByPn);
  assert.strictEqual(healed.part_number, '661-56050');
  assert.strictEqual(healed.description, 'Display, iPhone 17 Pro Max', 'Should resolve description from part catalog');
});

// 6. Test preservation of valid item details
test('healShipmentItem preserves already valid part number and description without tampering', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    parts: mockParts
  });

  const validItem = {
    serial_number: 'CUSTOM-SN-999',
    part_number: '661-CUSTOM',
    description: 'Custom Authentic Part',
    cost: 150
  };

  const result = healShipmentItem(validItem, serialDict, partsMapByPn);
  assert.strictEqual(result.part_number, '661-CUSTOM');
  assert.strictEqual(result.description, 'Custom Authentic Part');
  assert.strictEqual(result.cost, 150);
});

// 7. Test formatSerialsForExport TSV output
test('formatSerialsForExport exports healed part details in TSV format', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    dcIntakeRecords: mockDcIntakeRecords,
    inventoryUnits: mockInventoryUnits,
    parts: mockParts
  });

  const mockShipment = {
    total_boxes: 1,
    items: [
      { serial_number: 'GVH54810YM8PR5PAD', part_number: 'UNKNOWN-PN', description: 'Part Description', box_number: 1 }
    ]
  };

  const tsv = formatSerialsForExport(mockShipment, 'tsv', serialDict, partsMapByPn);
  assert.ok(tsv.includes('661-21988'), 'TSV must contain healed part number 661-21988');
  assert.ok(tsv.includes('Display, iPhone 13'), 'TSV must contain healed description Display, iPhone 13');
  assert.ok(!tsv.includes('UNKNOWN-PN'), 'TSV must not contain UNKNOWN-PN');
});

// 8. In-stock isolation verification
test('In-stock inventory units are untouched by shipment healing operations', () => {
  const unitsBefore = JSON.stringify(mockInventoryUnits);

  const { serialDict, partsMapByPn } = buildSerialDictionary({
    dcIntakeRecords: mockDcIntakeRecords,
    inventoryUnits: mockInventoryUnits,
    parts: mockParts
  });

  const corruptedItem = { serial_number: 'GVH54810YM8PR5PAD', part_number: 'UNKNOWN-PN', description: 'Part Description' };
  healShipmentItem(corruptedItem, serialDict, partsMapByPn);

  const unitsAfter = JSON.stringify(mockInventoryUnits);
  assert.strictEqual(unitsBefore, unitsAfter, 'Inventory units must remain completely unchanged');
});

// 9. iPhone 13 mini DC Exclusion & Normalization (Manifest DCOWNED#083126E)
test('healShipmentItem normalizes iPhone 13 mini to iPhone 13 (661-21991) per DC policy', () => {
  const { serialDict, partsMapByPn } = buildSerialDictionary({
    parts: mockParts
  });

  const miniItems = [
    { serial_number: 'F8Y6301C06C14LNC1', part_number: '661-22374', description: 'Battery, iPhone 13 mini' },
    { serial_number: 'F8Y6301C20014LNCX', part_number: '661-22374', description: 'Battery, iPhone 13 mini' }
  ];

  const healed = miniItems.map(it => healShipmentItem(it, serialDict, partsMapByPn));

  assert.strictEqual(healed[0].part_number, '661-21991', 'Part number must be 661-21991');
  assert.strictEqual(healed[0].description, 'Battery, iPhone 13', 'Description must be Battery, iPhone 13 (not mini)');

  assert.strictEqual(healed[1].part_number, '661-21991', 'Part number must be 661-21991');
  assert.strictEqual(healed[1].description, 'Battery, iPhone 13', 'Description must be Battery, iPhone 13 (not mini)');
});

console.log('\n----------------------------------------------------');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
