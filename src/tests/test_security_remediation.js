import {
  verifyPassword,
  hashPassword,
  generateSessionSignature,
  verifySessionIntegrity
} from '../utils/security.js';
import { INITIAL_USERS } from '../constants/roles.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('====================================================');
console.log('TEST SUITE: Security Remediation & Exploit Prevention (A1-A5)');
console.log('====================================================');

async function runSecurityTests() {
  // 1. Password Verification & Backdoor Removal
  const nullHashResult = await verifyPassword('Password123', null);
  assert(nullHashResult === false, 'verifyPassword rejects Password123 against null hash');

  const undefinedHashResult = await verifyPassword('Password123', undefined);
  assert(undefinedHashResult === false, 'verifyPassword rejects Password123 against undefined hash');

  const emptyHashResult = await verifyPassword('Password123', '');
  assert(emptyHashResult === false, 'verifyPassword rejects Password123 against empty string hash');

  const plainComparisonResult = await verifyPassword('SecretPass123', 'SecretPass123');
  assert(plainComparisonResult === false, 'verifyPassword rejects plaintext stored hashes (requires sha256: prefix)');

  // 2. Cryptographic Salted SHA-256 Verification & Strict Single Password
  const legitimatePassword = 'ValidSecurePassword!2026';
  const legitimateHash = await hashPassword(legitimatePassword);
  assert(legitimateHash.startsWith('sha256:'), 'hashPassword produces salted sha256: prefix hash');

  const legitVerification = await verifyPassword(legitimatePassword, legitimateHash);
  assert(legitVerification === true, 'verifyPassword correctly verifies matching salted password');

  const wrongPasswordVerification = await verifyPassword('WrongPassword', legitimateHash);
  assert(wrongPasswordVerification === false, 'verifyPassword rejects incorrect password against valid hash');

  // Critical: Enforce strict case-sensitivity (no multiple passwords via lower/upper mutations)
  const lowerCaseMismatch = await verifyPassword(legitimatePassword.toLowerCase(), legitimateHash);
  assert(lowerCaseMismatch === false, 'verifyPassword strictly rejects lowercase password variation');

  const upperCaseMismatch = await verifyPassword(legitimatePassword.toUpperCase(), legitimateHash);
  assert(upperCaseMismatch === false, 'verifyPassword strictly rejects uppercase password variation');

  const joseTestPassword = 'MySecretPassword123';
  const joseTestHash = await hashPassword(joseTestPassword);
  const joseLowerAttempt = await verifyPassword('mysecretpassword123', joseTestHash);
  assert(joseLowerAttempt === false, 'verifyPassword strictly rejects lowercase variant on Jose account');
  const joseExactAttempt = await verifyPassword('MySecretPassword123', joseTestHash);
  assert(joseExactAttempt === true, 'verifyPassword accepts only exact case password');

  // 3. Session Integrity & [object Promise] Bypass Removal
  const user = {
    id: 'user-uuid-1234',
    email: 'admin@mobilecareph.com',
    role: 'superadmin'
  };

  const validSig = generateSessionSignature(user);
  assert(validSig.startsWith('sig_'), 'generateSessionSignature generates synchronous sig_ token');

  const validIntegrity = verifySessionIntegrity(user, validSig);
  assert(validIntegrity === true, 'verifySessionIntegrity validates authentic user signature');

  const promiseBypassIntegrity = verifySessionIntegrity(user, '[object Promise]');
  assert(promiseBypassIntegrity === false, 'verifySessionIntegrity strictly rejects [object Promise] bypass signature');

  const nonStringIntegrity = verifySessionIntegrity(user, { malicious: true });
  assert(nonStringIntegrity === false, 'verifySessionIntegrity rejects non-string signatures');

  const tamperedUser = {
    ...user,
    role: 'superadmin'
  };
  const regularUser = {
    id: 'user-uuid-9999',
    email: 'user@mobilecareph.com',
    role: 'user'
  };
  const forgedSig = generateSessionSignature(regularUser);
  const privilegeEscalation = verifySessionIntegrity(tamperedUser, forgedSig);
  assert(privilegeEscalation === false, 'verifySessionIntegrity blocks signature forgery / privilege escalation');

  // 4. Initial Users Configuration Security
  INITIAL_USERS.forEach(u => {
    assert(u.passwordHash === null, `Initial user ${u.email} does not have hardcoded password hash`);
    assert(u.hasSetPassword === false, `Initial user ${u.email} has hasSetPassword: false`);
  });

  console.log('====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests();
