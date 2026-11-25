import assert from 'assert';
import { buildAutoRegisteredParts } from '../utils/partsCatalogAutoRegister.js';
import { parseConsumablesReceivingCsv } from '../utils/consumablesToolsEngine.js';
import { DEFAULT_PART_CATEGORIES } from '../utils/categoryFilter.js';

console.log('========================================================================');
console.log('TEST SUITE: CSV Upload Auto-Registration of Unregistered Part Numbers');
console.log('========================================================================\n');

// --- Test 1: buildAutoRegisteredParts registers unregistered PNs without duplicating existing ones ---
console.log('--- Test 1: buildAutoRegisteredParts adds only unregistered part numbers ---');
const existingCatalog = [
  { id: 'p-1', part_number: '661-21988', description: 'Display, iPhone 13', category_id: 'cat-display', stocking_price: 99 }
];

const csvUploadedItems = [
  { part_number: '661-21988', description: 'Display, iPhone 13', stocking_price: 99 }, // already registered
  { partNumber: '661-99901', description: 'Battery, iPhone 17 Pro', partValue: 115.50 }, // unregistered hardware part
  { part_number: '077-88812', description: 'SVC, IPHONE DUO, FIXTURE KIT', item_kind: 'tool', unit_cost: 420 }, // unregistered tool
  { part_number: '923-77701', description: 'SVC, ADHESIVE STRIPS 30PK', item_kind: 'consumable', unit_cost: 24.5 }, // unregistered consumable
  { part_number: '661-99901', description: 'Battery, iPhone 17 Pro', partValue: 115.50 } // duplicate within same CSV batch
];

const res = buildAutoRegisteredParts(existingCatalog, csvUploadedItems, DEFAULT_PART_CATEGORIES);
assert.strictEqual(res.addedCount, 3, 'Must auto-register exactly 3 unique unregistered part numbers');
assert.strictEqual(res.nextParts.length, 4, 'Catalog must now contain 4 total parts');

const addedBattery = res.addedParts.find(p => p.part_number === '661-99901');
assert(addedBattery, '661-99901 must be added');
assert.strictEqual(addedBattery.category_id, 'cat-battery', 'Battery PN must auto-resolve to cat-battery');
assert.strictEqual(addedBattery.stocking_price, 115.5);

const addedTool = res.addedParts.find(p => p.part_number === '077-88812');
assert(addedTool, '077-88812 must be added');
assert.strictEqual(addedTool.item_kind, 'tool', 'Tool PN must preserve item_kind: tool');
assert.strictEqual(addedTool.category_id, 'cat-other', 'Tool PN must map to cat-other');
assert.strictEqual(addedTool.stocking_price, 420);

const addedConsumable = res.addedParts.find(p => p.part_number === '923-77701');
assert(addedConsumable, '923-77701 must be added');
assert.strictEqual(addedConsumable.item_kind, 'consumable', 'Consumable PN must preserve item_kind: consumable');
assert.strictEqual(addedConsumable.stocking_price, 24.5);
console.log('  ✓ PASS: Unregistered repair parts, tools, and consumables auto-registered cleanly without duplicates');

// --- Test 2: parseConsumablesReceivingCsv accepts unregistered part numbers by default ---
console.log('\n--- Test 2: Consumables/Tools CSV upload accepts unregistered part numbers ---');
const sampleCsv = [
  'Part Number,Description,Type,Unit Cost,Quantity,Site',
  '077-99100,"SVC, NEW TORQUE DRIVER",Tool,85.00,2,DC-MDC',
  '923-99200,"SVC, DISPLAY ADHESIVE KIT",Consumable,19.50,10,ASP BGC'
].join('\n');

const parsed = parseConsumablesReceivingCsv(sampleCsv, []);
assert.strictEqual(parsed.errorRows.length, 0, 'Unregistered part numbers must NOT produce errorRows');
assert.strictEqual(parsed.validRows.length, 2, 'Both CSV rows with unregistered part numbers must be accepted');
assert.strictEqual(parsed.autoRegisteredItems.length, 2, 'Both unregistered part numbers must be returned for catalog registration');
assert.strictEqual(parsed.autoRegisteredItems[0].part_number, '077-99100');
assert.strictEqual(parsed.autoRegisteredItems[0].item_kind, 'tool');
assert.strictEqual(parsed.autoRegisteredItems[0].unit_cost, 85);
assert.strictEqual(parsed.autoRegisteredItems[1].part_number, '923-99200');
assert.strictEqual(parsed.autoRegisteredItems[1].item_kind, 'consumable');
assert.strictEqual(parsed.autoRegisteredItems[1].unit_cost, 19.5);
console.log('  ✓ PASS: CSV upload accepts unregistered part numbers and prepares them for Parts Catalog registration');

console.log('\n========================================================================');
console.log('ALL CSV AUTO-REGISTRATION TESTS PASSED (100%)');
console.log('========================================================================\n');
