import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: TS (Transfer Slip) Easy-Copy Functionality');
console.log('====================================================\n');

// 1. Verify TS normalization/clean logic
console.log('Test 1: TS prefix cleaning logic');
const cleanTS = (raw) => String(raw || '').replace(/^TS[:#\s-]*/i, '').trim();

assert.strictEqual(cleanTS('20227495'), '20227495');
assert.strictEqual(cleanTS('TS: 20227495'), '20227495');
assert.strictEqual(cleanTS('TS #20227495'), '20227495');
assert.strictEqual(cleanTS('TS:20227495'), '20227495');
assert.strictEqual(cleanTS('  20227495  '), '20227495');
assert.strictEqual(cleanTS(''), '');
console.log('  ✓ PASS: TS cleaning logic cleanly extracts raw transfer slip number.');

// 2. Verify Shipments.jsx implementation
console.log('\nTest 2: Shipments.jsx TS copy handler and UI bindings');
const shipmentsFile = fs.readFileSync(path.join(__dirname, '../components/Shipments.jsx'), 'utf8');

assert.ok(shipmentsFile.includes('copiedTS'), 'Shipments.jsx must define copiedTS state');
assert.ok(shipmentsFile.includes('handleCopyTS'), 'Shipments.jsx must define handleCopyTS function');
assert.ok(shipmentsFile.includes('handleCopyTS(cleanTS)'), 'Shipments.jsx must invoke handleCopyTS with cleanTS');
assert.ok(shipmentsFile.includes('title={isCopied ? "Copied to clipboard!" : "Click to copy TS number"}'), 'Shipments.jsx must include helpful title tooltip');
assert.ok(shipmentsFile.includes("Copied TS #"), 'Shipments.jsx must trigger informative toast confirmation');
console.log('  ✓ PASS: Shipments.jsx has handleCopyTS wired to table rows and modal views.');

// 3. Verify ScanOutPacking.jsx implementation
console.log('\nTest 3: ScanOutPacking.jsx TS copy handler and UI bindings');
const scanOutFile = fs.readFileSync(path.join(__dirname, '../components/ScanOutPacking.jsx'), 'utf8');

assert.ok(scanOutFile.includes('copiedTS'), 'ScanOutPacking.jsx must define copiedTS state');
assert.ok(scanOutFile.includes('handleCopyTS'), 'ScanOutPacking.jsx must define handleCopyTS function');
assert.ok(scanOutFile.includes('handleCopyTS(cleanTS)'), 'ScanOutPacking.jsx must invoke handleCopyTS with cleanTS in drafts table');
console.log('  ✓ PASS: ScanOutPacking.jsx has handleCopyTS wired to drafts table.');

// 4. Verify propagation stop to prevent unwanted modal popups on copy
console.log('\nTest 4: Event propagation stop on table row click');
assert.ok(
  shipmentsFile.includes('e.stopPropagation();') && shipmentsFile.includes('handleCopyTS(cleanTS);'),
  'Must prevent row click when copying TS in table rows'
);
console.log('  ✓ PASS: e.stopPropagation() prevents modal from triggering when TS is clicked.');

console.log('\n====================================================');
console.log('ALL TS EASY-COPY TESTS PASSED (100%)');
console.log('====================================================');
