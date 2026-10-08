import assert from 'node:assert';
import fs from 'node:fs';
import { parseFixablyInventoryValueCsv, isFixablyInventoryValueContent } from '../utils/excelParser.js';

console.log('========================================================================');
console.log('TEST SUITE: Fixably / GSX Inventory Value CSV Parser');
console.log('========================================================================');

const csvPath = 'Custom reports - Inventory Value.csv';
assert.ok(fs.existsSync(csvPath), 'Custom reports - Inventory Value.csv must exist');

const content = fs.readFileSync(csvPath, 'utf8');

// Test 1: Content detection
assert.strictEqual(isFixablyInventoryValueContent(content), true, 'Must detect as Fixably Inventory Value CSV');
console.log('  ✓ PASS: Content detection identifies Fixably / GSX CSV correctly');

// Test 2: Parsing execution
const parseResult = await parseFixablyInventoryValueCsv(content, [], []);
assert.strictEqual(parseResult.success, true, 'Parsing must succeed');
assert.strictEqual(parseResult.items.length, 3416, `Must parse exactly 3,416 items matching the 3,416 CSV rows (got ${parseResult.items.length})`);
assert.strictEqual(parseResult.summary.uniqueParts, 141, 'Must extract exactly 141 unique parts');
assert.strictEqual(parseResult.summary.sitesCount, 25, 'Must cover 25 branch sites');

console.log(`  ✓ PASS: Parsed ${parseResult.items.length} units across ${parseResult.summary.sitesCount} sites`);
console.log(`  ✓ PASS: Extracted ${parseResult.summary.uniqueParts} parts for catalog`);
console.log(`  ✓ PASS: Total inventory value calculated: $${parseResult.summary.totalValue.toFixed(2)}`);

// Test 3: Verify site codes
const siteCodes = Object.keys(parseResult.summary.siteBreakdown);
assert.ok(siteCodes.includes('ASP GL5'), 'Must contain ASP GL5');
assert.ok(siteCodes.includes('ASP VN'), 'Must contain ASP VN (mapped from VER)');
assert.ok(siteCodes.includes('APP RM'), 'Must contain APP RM (mapped from MAG)');
assert.ok(siteCodes.includes('ASP ILO'), 'Must contain ASP ILO');
assert.ok(siteCodes.includes('APP LAN'), 'Must contain APP LAN');
assert.ok(siteCodes.includes('APP BHS'), 'Must contain APP BHS');
console.log('  ✓ PASS: All branch site codes correctly normalized');

// Test 4: Verify part models and categories
const displayPart = parseResult.extractedParts.find(p => p.part_number === '661-11232');
assert.ok(displayPart, 'Must find 661-11232');
assert.strictEqual(displayPart.category_id, 'cat-display', '661-11232 must be cat-display');

const batteryPart = parseResult.extractedParts.find(p => p.part_number === '661-13574');
assert.ok(batteryPart, 'Must find 661-13574');
assert.strictEqual(batteryPart.category_id, 'cat-battery', '661-13574 must be cat-battery');
console.log('  ✓ PASS: Categories assigned accurately to parts catalog');

console.log('========================================================================');
console.log('ALL FIXABLY CSV PARSER TESTS PASSED!');
console.log('========================================================================');
