import assert from 'assert';
import {
  generateNextInvoiceRef,
  indexToSequenceLetters,
  sequenceLettersToIndex,
  extractSeqLettersFromRef
} from '../utils/appContextHelpers.js';

console.log('====================================================');
console.log('TEST SUITE: Packing List (PL) Invoice Reference Sequencing');
console.log('====================================================');

async function runTests() {
  const testDate = new Date(2026, 8, 3); // September 3, 2026 (Month is 0-indexed: 8 = Sept)
  const expectedDateCode = '090326';

  // ── Test 1: Bijective Base-26 Conversion Accuracy ─────────────────────────
  console.log('\nTest 1: Bijective Base-26 Letter Sequence Conversion');
  {
    const mapping = [
      [1, 'A'],
      [2, 'B'],
      [25, 'Y'],
      [26, 'Z'],
      [27, 'AA'],
      [28, 'AB'],
      [29, 'AC'],
      [52, 'AZ'],
      [53, 'BA'],
      [54, 'BB'],
      [701, 'ZY'],
      [702, 'ZZ'],
      [703, 'AAA'],
      [704, 'AAB']
    ];

    mapping.forEach(([num, str]) => {
      const generatedStr = indexToSequenceLetters(num);
      assert.strictEqual(generatedStr, str, `Number ${num} should convert to "${str}", got "${generatedStr}"`);
      const parsedNum = sequenceLettersToIndex(str);
      assert.strictEqual(parsedNum, num, `String "${str}" should convert back to ${num}, got ${parsedNum}`);
    });
    console.log('  ✓ PASS: Bijective base-26 converts between integer and letter sequence flawlessly (1 -> A ... 26 -> Z ... 27 -> AA ... 702 -> ZZ ... 703 -> AAA)');
  }

  // ── Test 2: Sequence Extraction from Reference Tokens ─────────────────────
  console.log('\nTest 2: Sequence Letter Extraction from Reference Tokens');
  {
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#090326A', expectedDateCode), 'A');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#090326Z', expectedDateCode), 'Z');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#090326AA', expectedDateCode), 'AA');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#090326AB', expectedDateCode), 'AB');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#090326AZ', expectedDateCode), 'AZ');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#090326ZZ', expectedDateCode), 'ZZ');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED090326B', expectedDateCode), 'B');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED-090326C', expectedDateCode), 'C');
    assert.strictEqual(extractSeqLettersFromRef('DCOWNED#083126Z', expectedDateCode), null, 'Different date code must not match');
    assert.strictEqual(extractSeqLettersFromRef('SHIP-202608-001', expectedDateCode), null, 'Non-matching format must return null');
    console.log('  ✓ PASS: Extraction reliably parses trailing letters for the target date');
  }

  // ── Test 3: Standard Sequential Generation (A -> B -> C) ──────────────────
  console.log('\nTest 3: Initial and Standard Sequences');
  {
    const emptyRef = generateNextInvoiceRef([], testDate);
    assert.strictEqual(emptyRef, `DCOWNED#${expectedDateCode}A`, 'First PL of the day must be A');

    const singleShipment = [{ invoice_ref: `DCOWNED#${expectedDateCode}A` }];
    const nextRef = generateNextInvoiceRef(singleShipment, testDate);
    assert.strictEqual(nextRef, `DCOWNED#${expectedDateCode}B`, 'Next PL after A must be B');

    const twoShipments = [
      { invoice_ref: `DCOWNED#${expectedDateCode}A` },
      { invoice_ref: `DCOWNED#${expectedDateCode}B` }
    ];
    const thirdRef = generateNextInvoiceRef(twoShipments, testDate);
    assert.strictEqual(thirdRef, `DCOWNED#${expectedDateCode}C`, 'Next PL after B must be C');
    console.log('  ✓ PASS: Generates A for empty day, and increments sequentially (A -> B -> C)');
  }

  // ── Test 4: Transition from Z to AA ───────────────────────────────────────
  console.log('\nTest 4: Crucial Transition from Z to AA');
  {
    const reachedZShipments = [
      { invoice_ref: `DCOWNED#${expectedDateCode}Z` }
    ];
    const afterZRef = generateNextInvoiceRef(reachedZShipments, testDate);
    assert.strictEqual(afterZRef, `DCOWNED#${expectedDateCode}AA`, 'Next reference after Z must be AA');
    console.log('  ✓ PASS: When system reaches Z, it automatically continues with AA (DCOWNED#090326AA)');
  }

  // ── Test 5: Continuing through Double-Letter Sequences (AA -> AB -> AC) ───
  console.log('\nTest 5: Progression through AA, AB, AC, ... AZ, BA');
  {
    const afterAAShipments = [
      { invoice_ref: `DCOWNED#${expectedDateCode}Z` },
      { invoice_ref: `DCOWNED#${expectedDateCode}AA` }
    ];
    const afterAARef = generateNextInvoiceRef(afterAAShipments, testDate);
    assert.strictEqual(afterAARef, `DCOWNED#${expectedDateCode}AB`, 'Next reference after AA must be AB');

    const afterABShipments = [
      ...afterAAShipments,
      { invoice_ref: `DCOWNED#${expectedDateCode}AB` }
    ];
    const afterABRef = generateNextInvoiceRef(afterABShipments, testDate);
    assert.strictEqual(afterABRef, `DCOWNED#${expectedDateCode}AC`, 'Next reference after AB must be AC');

    const reachedAZShipments = [
      { invoice_ref: `DCOWNED#${expectedDateCode}AZ` }
    ];
    const afterAZRef = generateNextInvoiceRef(reachedAZShipments, testDate);
    assert.strictEqual(afterAZRef, `DCOWNED#${expectedDateCode}BA`, 'Next reference after AZ must be BA');

    const reachedZZShipments = [
      { invoice_ref: `DCOWNED#${expectedDateCode}ZZ` }
    ];
    const afterZZRef = generateNextInvoiceRef(reachedZZShipments, testDate);
    assert.strictEqual(afterZZRef, `DCOWNED#${expectedDateCode}AAA`, 'Next reference after ZZ must be AAA');

    console.log('  ✓ PASS: Multi-letter sequences seamlessly advance: AA -> AB -> AC ... AZ -> BA ... ZZ -> AAA');
  }

  // ── Test 6: Date Isolation (Different Days Don\'t Interfere) ───────────────
  console.log('\nTest 6: Date Isolation');
  {
    const yesterdayShipments = [
      { invoice_ref: 'DCOWNED#090226Z' },
      { invoice_ref: 'DCOWNED#090226AA' }
    ];
    const todayRef = generateNextInvoiceRef(yesterdayShipments, testDate);
    assert.strictEqual(todayRef, `DCOWNED#${expectedDateCode}A`, 'Previous day shipments must not increment today\'s sequence');
    console.log('  ✓ PASS: Sequence is strictly isolated per day in MMDDYY format');
  }

  console.log('\n====================================================');
  console.log('ALL INVOICE REF SEQUENCING TESTS PASSED (100%)');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Invoice ref test failed:', err);
  process.exit(1);
});
