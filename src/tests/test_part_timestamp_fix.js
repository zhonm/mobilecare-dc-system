import assert from 'assert';
import { formatTo12HourTime, formatTo12HourDateTime, formatPartTimestamp, formatPartDate } from '../utils/dateUtils.js';

console.log('====================================================');
console.log('TEST SUITE: Part Timestamp & Date Formatting Parity');
console.log('====================================================');

// 1. Verify Date-Only Strings do NOT return 08:00 AM
console.log('\n--- 1. Testing Date-Only Strings (Eliminating 08:00 AM Bug) ---');
{
  assert.strictEqual(formatTo12HourTime('2026-09-15'), '', 'formatTo12HourTime should return empty for pure date YYYY-MM-DD');
  assert.strictEqual(formatTo12HourTime('2026-09-09'), '', 'formatTo12HourTime should return empty for pure date YYYY-MM-DD');
  assert.strictEqual(formatTo12HourTime('9/15/2026'), '', 'formatTo12HourTime should return empty for pure date M/D/YYYY');
  assert.strictEqual(formatTo12HourTime('2026-08-01T08:00:00Z'), '', 'formatTo12HourTime should return empty for seed artifact T08:00:00Z');
  assert.strictEqual(formatTo12HourTime('2026-08-01T00:00:00.000Z'), '', 'formatTo12HourTime should return empty for UTC midnight');
  assert.strictEqual(formatTo12HourDateTime('2026-09-15'), 'Sep 15, 2026', 'formatTo12HourDateTime should format date-only cleanly without 08:00 AM');
  console.log('  ✓ PASS: False 08:00 AM time generation successfully eliminated for date-only inputs');
}

// 2. Verify Genuine 24-Hour Times and Datetimes Still Format Correctly
console.log('\n--- 2. Testing Genuine Times and Datetimes ---');
{
  assert.strictEqual(formatTo12HourTime('14:45:08'), '02:45:08 PM');
  assert.strictEqual(formatTo12HourTime('14:45:08', false), '02:45 PM');
  assert.strictEqual(formatTo12HourTime('12:21:42 PM'), '12:21:42 PM');
  assert.strictEqual(formatTo12HourTime('12:21:42 PM', false), '12:21 PM');
  console.log('  ✓ PASS: Real times continue to convert accurately to 12-hour format');
}

// 3. Verify formatPartDate and formatPartTimestamp for Clean Date-Only Output
console.log('\n--- 3. Testing formatPartDate (Retaining Only the Date) ---');
{
  // Profile A: Fixably snapshot / CSV date-only import
  const fixablyUnit = {
    part_number: '661-30401',
    serial_number: 'G9P5183N8Q514YDA2',
    received_at: '2026-09-15'
  };
  assert.strictEqual(formatPartDate(fixablyUnit), '2026-09-15', 'Should retain only date YYYY-MM-DD');
  assert.strictEqual(formatPartTimestamp(fixablyUnit), '2026-09-15', 'Timestamp alias should also retain only date');

  // Profile B: Output.csv / ASP ILO unit
  const iloUnit = {
    part_number: '661-21991',
    serial_number: 'F8Y6282C65Y18FKBS',
    received_at: '2026-09-09'
  };
  assert.strictEqual(formatPartDate(iloUnit), '2026-09-09', 'Should retain only date YYYY-MM-DD');

  // Profile C: Seed data unit with T08:00:00Z
  const seedUnit = {
    part_number: '661-21991',
    serial_number: 'DN83341MDKD1MCN3R',
    received_at: '2026-08-01T08:00:00Z'
  };
  assert.strictEqual(formatPartDate(seedUnit), '2026-08-01', 'Should retain only date YYYY-MM-DD');

  // Profile D: Workstation scan today
  const todayNow = new Date();
  const todayYmd = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, '0')}-${String(todayNow.getDate()).padStart(2, '0')}`;
  const todayUnit = {
    part_number: '661-44954',
    serial_number: 'TESTSCAN001',
    received_at: todayNow.toISOString()
  };
  assert.strictEqual(formatPartDate(todayUnit), todayYmd, `Should retain only today's date (${todayYmd})`);

  // Profile E: Historical scan with timeStr or ISO with time
  const historicalUnit = {
    part_number: '661-30401',
    serial_number: 'HIST001',
    received_at: '2026-09-14T04:21:42.859Z',
    timeStr: '12:21:42 PM'
  };
  assert.strictEqual(formatPartDate(historicalUnit), '2026-09-14', 'Should strip time and retain only date');

  // Profile F: Empty / undefined unit
  assert.strictEqual(formatPartDate({}), 'Recent');
  assert.strictEqual(formatPartDate(null), 'Recent');
  assert.strictEqual(formatPartDate(undefined), 'Recent');

  console.log('  ✓ PASS: All unit profiles retain only the date (YYYY-MM-DD) with zero time');
}

console.log('\n====================================================');
console.log('ALL PART TIMESTAMP & DATE TESTS PASSED (100%)');
console.log('====================================================\n');
