/**
 * Test Suite: Strict @mobilecareph.com Email Domain Enforcement
 */

import assert from 'assert';
import { isAllowedCompanyEmail, ALLOWED_COMPANY_DOMAINS } from '../utils/userMatcher.js';

console.log('====================================================');
console.log('TEST SUITE: Strict @mobilecareph.com Domain Validation');
console.log('====================================================');

// Test 1: Whitelist contains exclusively mobilecareph.com
console.log('\nTest 1: Verify ALLOWED_COMPANY_DOMAINS contains only mobilecareph.com');
assert.deepStrictEqual(ALLOWED_COMPANY_DOMAINS, ['mobilecareph.com'], 'Only mobilecareph.com must be allowed');
console.log('  ✓ PASS: ALLOWED_COMPANY_DOMAINS strictly equals ["mobilecareph.com"]');

// Test 2: Allowed domain test cases
console.log('\nTest 2: Verify valid @mobilecareph.com addresses are accepted');
const validEmails = [
  'zhon.manaois@mobilecareph.com',
  'joshua.juvida@mobilecareph.com',
  'anjo.alcazar@mobilecareph.com',
  'daphneclaire.bascuguin@mobilecareph.com',
  'andres@mobilecareph.com',
  'ZHON.MANAOIS@MOBILECAREPH.COM',
  'user.test+tag@mobilecareph.com'
];
validEmails.forEach(email => {
  assert.strictEqual(isAllowedCompanyEmail(email), true, `Must accept: ${email}`);
});
console.log(`  ✓ PASS: Accepted all ${validEmails.length} valid @mobilecareph.com variants`);

// Test 3: Unauthorized domains must be strictly rejected
console.log('\nTest 3: Verify non-mobilecareph.com domains are rejected');
const prohibitedEmails = [
  'user@mobilecare.com.ph',
  'user@mobilecare.com',
  'user@mobilecare.ph',
  'user@gmail.com',
  'user@yahoo.com',
  'user@outlook.com',
  'user@company.com',
  'user@notmobilecareph.com',
  'user@mobilecareph.com.evil.com',
  'invalid-email',
  '',
  null,
  undefined
];
prohibitedEmails.forEach(email => {
  assert.strictEqual(isAllowedCompanyEmail(email), false, `Must reject: ${email}`);
});
console.log(`  ✓ PASS: Successfully blocked all ${prohibitedEmails.length} prohibited/external email formats`);

console.log('\n====================================================');
console.log('ALL @mobilecareph.com RESTRICTION TESTS PASSED (100%)');
console.log('====================================================\n');
