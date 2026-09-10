import assert from 'assert';
import { formatTo12HourTime, formatTo12HourDateTime } from '../utils/dateUtils.js';
import { generateStyledStockExcel } from '../utils/stockExportUtils.js';

console.log('====================================================');
console.log('TEST SUITE: System-Wide 12-Hour Time Format');
console.log('====================================================');

// 1. 24-Hour String Conversion
console.log('\n--- 1. Testing 24-Hour String Conversions ---');
{
  assert.strictEqual(formatTo12HourTime('14:45:08'), '02:45:08 PM', '14:45:08 should convert to 02:45:08 PM');
  assert.strictEqual(formatTo12HourTime('00:15:30'), '12:15:30 AM', '00:15:30 should convert to 12:15:30 AM');
  assert.strictEqual(formatTo12HourTime('12:00:00'), '12:00:00 PM', '12:00:00 should convert to 12:00:00 PM');
  assert.strictEqual(formatTo12HourTime('09:05:01'), '09:05:01 AM', '09:05:01 should convert to 09:05:01 AM');
  assert.strictEqual(formatTo12HourTime('23:59:59'), '11:59:59 PM', '23:59:59 should convert to 11:59:59 PM');
  assert.strictEqual(formatTo12HourTime('00:00:00'), '12:00:00 AM', '00:00:00 should convert to 12:00:00 AM');
  assert.strictEqual(formatTo12HourTime('16:27:29'), '04:27:29 PM', '16:27:29 should convert to 04:27:29 PM');
  console.log('  ✓ PASS: Standard 24-hour time strings correctly converted to 12-hour format');
}

// 2. Seconds inclusion / exclusion options
console.log('\n--- 2. Testing includeSeconds Options ---');
{
  assert.strictEqual(formatTo12HourTime('14:45:08', false), '02:45 PM', 'includeSeconds=false should drop seconds');
  assert.strictEqual(formatTo12HourTime('09:05:00', false), '09:05 AM', 'includeSeconds=false should drop seconds');
  assert.strictEqual(formatTo12HourTime('14:45', false), '02:45 PM', '14:45 with includeSeconds=false should be 02:45 PM');
  assert.strictEqual(formatTo12HourTime('14:45', true), '02:45:00 PM', '14:45 with includeSeconds=true should append :00');
  console.log('  ✓ PASS: includeSeconds options correctly honored');
}

// 3. Already 12-hour formatted strings (idempotency)
console.log('\n--- 3. Testing 12-Hour Idempotency ---');
{
  assert.strictEqual(formatTo12HourTime('02:45:08 PM'), '02:45:08 PM');
  assert.strictEqual(formatTo12HourTime('2:45:08 pm'), '02:45:08 PM');
  assert.strictEqual(formatTo12HourTime('12:15:30 AM'), '12:15:30 AM');
  assert.strictEqual(formatTo12HourTime('02:45 PM', false), '02:45 PM');
  assert.strictEqual(formatTo12HourTime('02:45 PM', true), '02:45:00 PM');
  console.log('  ✓ PASS: Already formatted 12-hour strings preserved and standardized');
}

// 4. Date objects and timestamps
console.log('\n--- 4. Testing Date Objects and Timestamp Numbers ---');
{
  const testDateMorning = new Date(2026, 8, 10, 8, 30, 45);
  assert.strictEqual(formatTo12HourTime(testDateMorning), '08:30:45 AM');
  assert.strictEqual(formatTo12HourTime(testDateMorning, false), '08:30 AM');

  const testDateAfternoon = new Date(2026, 8, 10, 15, 20, 10);
  assert.strictEqual(formatTo12HourTime(testDateAfternoon), '03:20:10 PM');
  assert.strictEqual(formatTo12HourTime(testDateAfternoon.getTime()), '03:20:10 PM');
  console.log('  ✓ PASS: Date instances and epoch timestamps accurately formatted');
}

// 5. Edge cases: Empty, null, undefined
console.log('\n--- 5. Testing Null/Empty/Invalid Edge Cases ---');
{
  assert.strictEqual(formatTo12HourTime(null), '');
  assert.strictEqual(formatTo12HourTime(undefined), '');
  assert.strictEqual(formatTo12HourTime(''), '');
  assert.strictEqual(formatTo12HourDateTime(null), '');
  assert.strictEqual(formatTo12HourDateTime(undefined), '');
  console.log('  ✓ PASS: Empty and invalid values gracefully handled');
}

// 6. formatTo12HourDateTime
console.log('\n--- 6. Testing formatTo12HourDateTime ---');
{
  const testDate = new Date(2026, 8, 10, 14, 45, 8);
  const formatted = formatTo12HourDateTime(testDate);
  assert.ok(formatted.includes('Sep 10, 2026'), `Should contain Sep 10, 2026, got: ${formatted}`);
  assert.ok(formatted.includes('02:45:08 PM'), `Should contain 02:45:08 PM, got: ${formatted}`);
  console.log(`  ✓ PASS: formatTo12HourDateTime formatted as: "${formatted}"`);
}

// 7. Integration with stockExportUtils Excel generation
console.log('\n--- 7. Testing Integration with Excel Export ---');
async function testExcel() {
  const sampleItems = [
    {
      id: 'unit-test-1',
      dateKey: '2026-09-09',
      timeStr: '14:45:08', // Legacy 24-hr string
      category: 'Display',
      part_number: '661-21988',
      description: 'Display, iPhone 13',
      serial_number: 'GVH5472894CQ9PRSQNJ',
      intake_assignment: 'MDC - Forecasting',
      price: 279
    }
  ];

  const { workbook } = await generateStyledStockExcel({
    items: sampleItems,
    sheetName: 'DC Stock'
  });

  const ws = workbook.getWorksheet('DC Stock');
  const dataRow = ws.getRow(5); // Header is row 4, first data is row 5
  const timeReceivedVal = dataRow.getCell(3).value;

  assert.strictEqual(timeReceivedVal, '02:45:08 PM', `Excel Time Received cell should be formatted to 12-hour: got "${timeReceivedVal}"`);
  console.log(`  ✓ PASS: Excel export automatically converted "14:45:08" to "${timeReceivedVal}"`);
}

testExcel().then(() => {
  console.log('\n====================================================');
  console.log('ALL 12-HOUR TIME FORMAT TESTS PASSED (100%)');
  console.log('====================================================\n');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
