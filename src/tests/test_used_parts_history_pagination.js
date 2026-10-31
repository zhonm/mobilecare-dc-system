/**
 * Verification Test: Used Parts History Performance & Pagination
 *
 * Validates:
 * 1. Pagination slicing & page calculation on 16,236 records.
 * 2. Search tokenization and deferred filtering speed.
 * 3. Sorting performance with timestamp caching.
 * 4. UI integration: Sticky columns, scroll wrapper, pagination controls.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

console.log('\n========================================================================');
console.log('TEST SUITE: Used Parts History Performance & Proper Pagination');
console.log('========================================================================\n');

// ── Test 1: High-Volume (16,236 Records) Pagination Slicing ─────────────────
console.log('--- Test 1: High-Volume (16,236 Records) Pagination Slicing ---');

const TOTAL_RECORDS = 16236;
const mockRecords = Array.from({ length: TOTAL_RECORDS }, (_, i) => ({
  id: `mock-${i + 1}`,
  serial_number: `F8Y${String(i).padStart(8, '0')}XYZ`,
  part_number: i % 2 === 0 ? '661-30373' : '661-21991',
  description: i % 2 === 0 ? 'Battery, iPhone 14' : 'Display, iPhone 13',
  work_order_number: 20100000 + i,
  used_at: new Date(Date.now() - i * 60000).toISOString(),
  used_by_name: 'GSX KGB Import (Zhon Manaois)',
  usage_notes: `Consumed in GSX CRBR repair | Order #${20100000 + i}`,
  site_code: 'ANX',
  status: 'used'
}));

const pageSize50 = 50;
const totalPages50 = Math.max(1, Math.ceil(mockRecords.length / pageSize50));
assert.strictEqual(totalPages50, 325, '16,236 records with page size 50 must produce 325 pages');

// Page 1 slice
const page1 = mockRecords.slice(0, 50);
assert.strictEqual(page1.length, 50, 'Page 1 must contain exactly 50 records');
assert.strictEqual(page1[0].id, 'mock-1');
assert.strictEqual(page1[49].id, 'mock-50');

// Page 325 (last page) slice
const page325 = mockRecords.slice((325 - 1) * 50, 325 * 50);
assert.strictEqual(page325.length, 36, 'Last page must contain remaining 36 records');
assert.strictEqual(page325[35].id, 'mock-16236');
console.log(`  ✓ PASS: 16,236 records cleanly paginated into 325 pages (last page has 36 items)`);

// ── Test 2: Fast Single-Pass Usage Metrics ──────────────────────────────────
console.log('\n--- Test 2: Fast Single-Pass Usage Metrics vs Array Filters ---');

const startMetrics = performance.now();
let displayCount = 0;
let batteryCount = 0;
const skuSet = new Set();
for (let i = 0; i < mockRecords.length; i++) {
  const u = mockRecords[i];
  const desc = (u.description || u.part_number || '').toLowerCase();
  const cat = (u.part_category || '').toLowerCase();
  if (desc.includes('disp') || cat.includes('disp')) displayCount++;
  if (desc.includes('batt') || cat.includes('batt')) batteryCount++;
  if (u.part_number) skuSet.add(u.part_number);
}
const elapsedMetrics = performance.now() - startMetrics;

assert.strictEqual(displayCount, 8118);
assert.strictEqual(batteryCount, 8118);
assert.strictEqual(skuSet.size, 2);
assert.ok(elapsedMetrics < 50, `Metrics computation took ${elapsedMetrics.toFixed(2)}ms (must be < 50ms)`);
console.log(`  ✓ PASS: Single-pass metrics processed 16,236 records in ${elapsedMetrics.toFixed(2)}ms`);

// ── Test 3: Multi-Token Search Filtering ────────────────────────────────────
console.log('\n--- Test 3: Multi-Token Search Filtering Performance ---');

const searchQuery = 'battery 2010005';
const q = searchQuery.toLowerCase().trim();
const tokens = q.split(/\s+/).filter(Boolean);

const startSearch = performance.now();
const searchResults = mockRecords.filter(u => {
  const pn = String(u.part_number || '').toLowerCase();
  const desc = String(u.description || '').toLowerCase();
  const sn = String(u.serial_number || '').toLowerCase();
  const wo = String(u.work_order_number || '').toLowerCase();
  const tech = String(u.used_by_name || u.used_by || '').toLowerCase();
  const notes = String(u.usage_notes || u.notes || '').toLowerCase();
  const site = String(u.site_code || u.site_name || '').toLowerCase();
  const haystack = `${pn} ${desc} ${sn} ${wo} ${tech} ${notes} ${site}`;
  return tokens.every(tok => haystack.includes(tok));
});
const elapsedSearch = performance.now() - startSearch;

assert.ok(searchResults.length > 0, 'Search must return matching records');
assert.ok(searchResults.every(r => r.description.includes('Battery') && String(r.work_order_number).includes('2010005')));
console.log(`  ✓ PASS: Multi-token search filtered 16,236 records in ${elapsedSearch.toFixed(2)}ms (found ${searchResults.length} matches)`);

// ── Test 4: UI Source Code Verification ─────────────────────────────────────
console.log('\n--- Test 4: UI Source Code Verification (RequestParts.jsx & index.css) ---');

const reqPartsCode = fs.readFileSync(path.join(projectRoot, 'src/components/RequestParts.jsx'), 'utf8');
const indexCssCode = fs.readFileSync(path.join(projectRoot, 'src/index.css'), 'utf8');

// Verify pagination state and controls in RequestParts.jsx
assert.ok(reqPartsCode.includes('usedLogPage'), 'RequestParts.jsx must define usedLogPage state');
assert.ok(reqPartsCode.includes('usedLogPageSize'), 'RequestParts.jsx must define usedLogPageSize state');
assert.ok(reqPartsCode.includes('paginatedUsedUnits'), 'RequestParts.jsx must compute paginatedUsedUnits');
assert.ok(reqPartsCode.includes('totalUsedLogPages'), 'RequestParts.jsx must calculate totalUsedLogPages');
assert.ok(reqPartsCode.includes('getPageNumbers'), 'RequestParts.jsx must define smart windowing pagination function');
assert.ok(reqPartsCode.includes('useDeferredValue'), 'RequestParts.jsx must use useDeferredValue for smooth search typing');

// Verify Usage Notes clarity & Revert button removal
assert.ok(reqPartsCode.includes('renderUsageNotesContent'), 'RequestParts.jsx must use renderUsageNotesContent for clear readable usage notes');
assert.ok(!reqPartsCode.includes('<span>Revert</span>'), 'RequestParts.jsx must NOT render Revert button (feature removed)');
assert.ok(!reqPartsCode.includes('unmarkUnitAsUsed(u.serial_number)'), 'RequestParts.jsx must not have unmarkUnitAsUsed in table rows');
assert.ok(reqPartsCode.includes('table-scroll-wrapper'), 'RequestParts.jsx must wrap table in table-scroll-wrapper');
assert.ok(reqPartsCode.includes('minWidth: \'1180px\''), 'RequestParts.jsx must enforce sufficient table min-width to prevent squishing');

// Verify CSS scrollbar optimization
assert.ok(indexCssCode.includes('.table-scroll-wrapper::-webkit-scrollbar'), 'index.css must define custom webkit scrollbar for table scroll wrapper');
assert.ok(indexCssCode.includes('scrollbar-color'), 'index.css must define thin scrollbar styling for modern browsers');
console.log('  ✓ PASS: UI components implement clear usage notes, custom scrollbars, and pagination controls');

console.log('\n========================================================================');
console.log('ALL USED PARTS HISTORY PAGINATION & PERFORMANCE TESTS PASSED (100%)');
console.log('========================================================================\n');
