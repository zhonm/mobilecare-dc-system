import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('====================================================================');
console.log('TEST SUITE: Mobile Screen Device Notice Modal Verification');
console.log('====================================================================');

// Test 1: Verify MobileNoticeModal component exists and has required elements
console.log('\n--- Test 1: Verify MobileNoticeModal Component ---');
const modalPath = path.resolve('src/components/MobileNoticeModal.jsx');
assert(fs.existsSync(modalPath), 'MobileNoticeModal.jsx must exist');
const modalContent = fs.readFileSync(modalPath, 'utf8');

assert(modalContent.includes('Desktop-Optimized System'), 'Must inform about desktop optimization');
assert(modalContent.includes('System Not Optimized for Mobile'), 'Must clearly state system is not optimized for mobile');
assert(modalContent.includes('You Can Still Log In & Access Features') || modalContent.includes('You Can Still Log In'), 'Must reassure users they can still log in');
assert(modalContent.includes('checkIsMobileScreen'), 'Must include mobile screen detection');
assert(modalContent.includes('window.innerWidth <= 768'), 'Must check breakpoint width <= 768px');
console.log('  ✓ PASS: MobileNoticeModal component correctly crafted with all requested messaging');

// Test 2: Verify Login.jsx integrates MobileNoticeModal
console.log('\n--- Test 2: Verify Login.jsx Integration ---');
const loginPath = path.resolve('src/components/Login.jsx');
const loginContent = fs.readFileSync(loginPath, 'utf8');
assert(loginContent.includes('import MobileNoticeModal from \'./MobileNoticeModal\';'), 'Login.jsx must import MobileNoticeModal');
assert(loginContent.includes('<MobileNoticeModal'), 'Login.jsx must render MobileNoticeModal');
assert(loginContent.includes('Device Notice'), 'Login.jsx footer must offer Device Notice re-trigger');
console.log('  ✓ PASS: Login.jsx cleanly integrates MobileNoticeModal with user-triggered option');

// Test 3: Verify App.jsx integrates MobileNoticeModal for authenticated sessions
console.log('\n--- Test 3: Verify App.jsx Integration ---');
const appPath = path.resolve('src/App.jsx');
const appContent = fs.readFileSync(appPath, 'utf8');
assert(appContent.includes('import MobileNoticeModal from \'./components/MobileNoticeModal\';'), 'App.jsx must import MobileNoticeModal');
assert(appContent.includes('<MobileNoticeModal'), 'App.jsx must render MobileNoticeModal');
console.log('  ✓ PASS: App.jsx renders MobileNoticeModal for authenticated users');

console.log('\n====================================================================');
console.log('ALL MOBILE NOTICE MODAL TESTS PASSED (100%)');
console.log('====================================================================');
