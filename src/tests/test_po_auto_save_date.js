import assert from 'assert';
import {
  normalizeDateToIso,
  consolidateDcIntakeRecordsList,
  formatDcIntakeRecordForDb,
  parseDcIntakeRecordFromDb
} from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: PO Auto-Save Date Normalization & Integrity');
console.log('====================================================\n');

// 1. Universal Date Normalizer Unit Tests
console.log('--- 1. normalizeDateToIso Unit Tests ---');
assert.strictEqual(normalizeDateToIso('02-Sep-2026'), '2026-09-02', 'DD-MMM-YYYY should format to YYYY-MM-DD');
assert.strictEqual(normalizeDateToIso('02-SEP-2026'), '2026-09-02', 'Uppercase DD-MMM-YYYY should format to YYYY-MM-DD');
assert.strictEqual(normalizeDateToIso('2-Sep-2026'), '2026-09-02', 'Single digit day 2-Sep-2026 should format to 2026-09-02');
assert.strictEqual(normalizeDateToIso('02-Sep-26'), '2026-09-02', '2-digit year 02-Sep-26 should format to 2026-09-02');
assert.strictEqual(normalizeDateToIso('2026-09-08'), '2026-09-08', 'ISO YYYY-MM-DD should remain unchanged');
assert.strictEqual(normalizeDateToIso('2026-09-08T15:30:00.000Z'), '2026-09-08', 'ISO datetime string should extract YYYY-MM-DD');
assert.strictEqual(normalizeDateToIso(''), new Date().toISOString().split('T')[0], 'Empty string should default to today');
assert.strictEqual(normalizeDateToIso(null), new Date().toISOString().split('T')[0], 'Null should default to today');
assert.strictEqual(normalizeDateToIso(undefined), new Date().toISOString().split('T')[0], 'Undefined should default to today');
console.log('  ✓ PASS: All date formats accurately normalized to ISO YYYY-MM-DD');

// 2. Auto-Save via PO with DC Intake Date
console.log('\n--- 2. PO Auto-Save Date Consolidation ---');
const todayIso = new Date().toISOString().split('T')[0];
const rawPoWithGsxDate = {
  id: 'po-mdc202600018',
  po_number: 'MDC202600018',
  order_date: '02-Sep-2026', // Raw GSX order date from Apple invoice PDF
  expected_date: '02-Sep-2026',
  created_at: `${todayIso}T08:00:00.000Z`, // Created today at DC warehouse
  supplier: 'Apple South Asia Pte Ltd',
  items: [
    { part_number: '661-21996', quantity_ordered: 54, unit_price: 99, description: 'SVC,BATTERY' }
  ]
};

const { consolidatedRecords } = consolidateDcIntakeRecordsList([], [rawPoWithGsxDate], { fullName: 'Zhon Manaois' }, []);

assert.strictEqual(consolidatedRecords.length, 1, 'Should create 1 consolidated history record for PO');
const autoSavedRec = consolidatedRecords[0];
assert.strictEqual(autoSavedRec.intake_date, todayIso, `Auto-saved PO intake_date at DC must reflect DC intake/creation date (${todayIso}), not Apple invoice order date (2026-09-02)`);
assert.ok(autoSavedRec.items.length > 0, 'Should have generated items with serial traceability');
assert.strictEqual(autoSavedRec.items[0].received_at, `${todayIso}T12:00:00.000Z`, 'Item received_at must be valid ISO timestamp based on intake date');
console.log(`  ✓ PASS: Auto-saved PO record intake_date reflects DC intake date: ${autoSavedRec.intake_date}`);
console.log(`  ✓ PASS: Generated items have valid ISO timestamp: ${autoSavedRec.items[0].received_at}`);

// 3. Existing Intake Date Preservation (Today's date not overwritten by PO order date)
console.log('\n--- 3. Preserving Existing Intake Date on Receiving ---');
const existingRecordWithTodayDate = {
  id: 'MDC202600020',
  record_name: 'MDC202600020 (Apple GSX PO)',
  intake_date: '2026-09-08', // Intaken today at DC warehouse
  po_number: 'MDC202600020',
  po_id: 'po-mdc202600020',
  items: []
};

const matchingPoFromLastWeek = {
  id: 'po-mdc202600020',
  po_number: 'MDC202600020',
  order_date: '02-Sep-2026', // Order placed 6 days ago
  supplier: 'Apple South Asia Pte Ltd',
  items: [
    { part_number: '661-21995', quantity_ordered: 51, unit_price: 329, description: 'SVC,DISPLAY' }
  ]
};

const result2 = consolidateDcIntakeRecordsList([existingRecordWithTodayDate], [matchingPoFromLastWeek], { fullName: 'Zhon Manaois' }, []);
const reconciledRec = result2.consolidatedRecords.find(r => r.id === 'MDC202600020');
assert.strictEqual(reconciledRec.intake_date, '2026-09-08', 'Existing intake date (2026-09-08) must be preserved and not overwritten by PO order date');
console.log(`  ✓ PASS: Existing DC intake date preserved correctly: ${reconciledRec.intake_date}`);

// 4. Database Schema Serialization Integrity
console.log('\n--- 4. Database Schema Serialization Integrity ---');
const dbRow = formatDcIntakeRecordForDb(autoSavedRec, { fullName: 'Zhon Manaois' });
assert.strictEqual(dbRow.intake_date, todayIso, `Database intake_date must be clean YYYY-MM-DD (${todayIso}) for PostgreSQL DATE column`);
const parsedFromDb = parseDcIntakeRecordFromDb(dbRow);
assert.strictEqual(parsedFromDb.intake_date, todayIso, `Parsed record must retain normalized YYYY-MM-DD (${todayIso})`);
console.log(`  ✓ PASS: Database row formatted and parsed cleanly for Supabase: ${dbRow.intake_date}`);

// 5. Newly Created Batches Sort Order (Newest at Top)
console.log('\n--- 5. Newly Created Batches Sort Order ---');
import { sortBatchesNewestFirst, extractMaxIdNumber } from '../utils/appContextHelpers.js';

assert.strictEqual(extractMaxIdNumber('MDC202600022 AND MDC202600024'), 202600024);
assert.strictEqual(extractMaxIdNumber('MDC202600021'), 202600021);
assert.strictEqual(extractMaxIdNumber('MDC202600018'), 202600018);
console.log('  ✓ PASS: extractMaxIdNumber parses sequential numbers accurately');

const testBatches = [
  { id: 'MDC202600018', record_name: 'MDC202600018', created_at: '2026-09-08T07:45:00.000Z', intake_date: '2026-09-08' },
  { id: 'MDC202600020', record_name: 'MDC202600020', created_at: '2026-09-08T07:50:00.000Z', intake_date: '2026-09-08' },
  { id: 'MDC202600022 AND MDC202600024', record_name: 'MDC202600022 and MDC202600024', created_at: '2026-09-08T08:20:00.000Z', intake_date: '2026-09-08' },
  { id: 'MDC202600021', record_name: 'MDC202600021', created_at: '2026-09-08T08:15:00.000Z', intake_date: '2026-09-08' }
];

const sorted = [...testBatches].sort(sortBatchesNewestFirst);
assert.strictEqual(sorted[0].id, 'MDC202600022 AND MDC202600024', 'Newly created batch MDC202600024 must be at the TOP');
assert.strictEqual(sorted[1].id, 'MDC202600021', 'MDC202600021 must be second');
assert.strictEqual(sorted[2].id, 'MDC202600020', 'MDC202600020 must be third');
assert.strictEqual(sorted[3].id, 'MDC202600018', 'Oldest batch MDC202600018 must be at the bottom');
console.log('  ✓ PASS: Batches properly sorted with newly created records at the top');

console.log('\n====================================================');
console.log('ALL PO AUTO-SAVE DATE & SORTING TESTS PASSED (100%)');
console.log('====================================================\n');
