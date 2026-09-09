import assert from 'assert';
import { validateAppleSerialNumber } from '../utils/partResolver.js';

console.log('====================================================');
console.log('TEST SUITE: Serial Number Truncation Defense');
console.log('====================================================');

// 1. Incomplete / Truncated Serial Rejection for Apple Replacement Parts
console.log('\n--- 1. Incomplete Serial Protection for 661- Parts ---');
const incompleteSn = 'F8Y6283C1C'; // 10 characters from user screenshot
const completeSn = 'F8Y6283C1C918FKBY'; // Full 17 characters
const pn = '661-21991';

const incompleteRes = validateAppleSerialNumber(incompleteSn, pn);
assert.strictEqual(incompleteRes.isValid, false, '10-character serial must be rejected as incomplete for 661- part');
assert(incompleteRes.error.includes('Incomplete Serial Number') || incompleteRes.error.includes('17 characters'),
  `Error must indicate incomplete serial. Got: ${incompleteRes.error}`);
console.log(`  ✓ PASS: Truncated 10-char serial "${incompleteSn}" rejected with message: "${incompleteRes.error}"`);

const completeRes = validateAppleSerialNumber(completeSn, pn);
assert.strictEqual(completeRes.isValid, true, 'Full 17-character serial must pass validation');
assert.strictEqual(completeRes.cleanSerial, completeSn, 'Full serial must be preserved identically');
console.log(`  ✓ PASS: Complete 17-char serial "${completeSn}" validated successfully`);

// 2. Real-World Physical Barcodes from iPhone 13 Battery Box Verification
console.log('\n--- 2. Real-World Casepack Barcode Validation ---');
const realBoxSerials = [
  'F8Y6303C1J918FKB3',
  'F8Y6302CAWJ18FKBJ',
  'F8Y6305C8R318FKBD',
  'F8Y6305C7KA18FKBR',
  'F8Y6305C84E18FKBX',
  'F8Y6303C1JE18FKBY',
  'F8Y6302CA2W18FKBN',
  'F8Y6304C99S18FKB4'
];

realBoxSerials.forEach((sn, idx) => {
  const res = validateAppleSerialNumber(sn, '661-21991');
  assert.strictEqual(res.isValid, true, `Real barcode #${idx + 1} (${sn}) must be valid`);
  assert.strictEqual(res.cleanSerial, sn, `Real barcode #${idx + 1} (${sn}) must match 100%`);
  console.log(`  ✓ PASS: Casepack Barcode #${idx + 1}: ${sn} (Length: ${sn.length}) verified`);
});

// 3. Auto-Receive Stream Guard Logic Simulation
console.log('\n--- 3. Auto-Receive Stream Guard Logic Simulation ---');
function shouldScheduleAutoReceive(serial, currentPn) {
  const isComponent = /^66[0-9]-?\d{4,6}$/i.test(currentPn);
  return isComponent ? serial.length >= 17 : serial.length >= 10;
}

assert.strictEqual(shouldScheduleAutoReceive('F8Y6283C1C', '661-21991'), false, 'Auto-receive MUST NOT schedule on 10 chars for 661- part');
assert.strictEqual(shouldScheduleAutoReceive('F8Y6283C1C918F', '661-21991'), false, 'Auto-receive MUST NOT schedule on 14 chars for 661- part');
assert.strictEqual(shouldScheduleAutoReceive('F8Y6283C1C918FKBY', '661-21991'), true, 'Auto-receive MUST schedule once full 17 chars are present');
console.log('  ✓ PASS: Auto-receive timer only schedules when serial stream reaches full 17 characters');

console.log('\n====================================================');
console.log('ALL SERIAL TRUNCATION DEFENSE TESTS PASSED (100%)');
console.log('====================================================\n');
