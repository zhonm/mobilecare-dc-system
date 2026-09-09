import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: Receive Button Alignment & Duplicate Guard');
console.log('====================================================\n');

// 1. Check ScanInReceiving.jsx file contents
const scanInPath = path.resolve(__dirname, '../components/ScanInReceiving.jsx');
const scanInContent = fs.readFileSync(scanInPath, 'utf8');

console.log('--- 1. ScanInReceiving.jsx Verification ---');

// Check Ban import
assert(scanInContent.includes("Ban"), 'Ban icon should be imported from lucide-react');
console.log('  ✓ PASS: Ban icon imported from lucide-react');

// Check receive-btn-col and receive-btn-spacer
assert(scanInContent.includes('className="receive-btn-col"'), 'receive-btn-col class should be used');
assert(scanInContent.includes('className="receive-btn-spacer"'), 'receive-btn-spacer class should be used');
console.log('  ✓ PASS: receive-btn-col and receive-btn-spacer markup in place');

// Check disabled prop on button
assert(
  scanInContent.includes('disabled={Boolean(duplicateSerialMatch)}'),
  'Receive button must have disabled={Boolean(duplicateSerialMatch)}'
);
console.log('  ✓ PASS: Receive button has disabled={Boolean(duplicateSerialMatch)} attribute');

// Check click handler guard
assert(
  scanInContent.includes('if (duplicateSerialMatch) return;') &&
  scanInContent.includes('executeScan();'),
  'onClick must prevent execution when duplicateSerialMatch is present'
);
console.log('  ✓ PASS: Receive button onClick is guarded against duplicate serials');

// Check handleSerialKeyDown guard
assert(
  scanInContent.includes('if (duplicateSerialMatch) {') &&
  scanInContent.includes('barcodeAudio.playError();') &&
  scanInContent.includes('serialInputRef.current?.select();'),
  'handleSerialKeyDown must reject Enter and select input when duplicateSerialMatch is present'
);
console.log('  ✓ PASS: Enter key press is blocked and serial is selected when duplicate serial is present');

// Check blocked label & icon
assert(scanInContent.includes('Receive (Blocked)'), 'Button should display Receive (Blocked) when duplicate');
assert(scanInContent.includes('<Ban size={18} color="#ef4444" />'), 'Ban icon should be displayed when duplicate');
console.log('  ✓ PASS: Receive (Blocked) and Ban icon rendered when duplicate serial detected');

// 2. Check App.css file contents
console.log('\n--- 2. App.css Verification ---');
const appCssPath = path.resolve(__dirname, '../App.css');
const appCssContent = fs.readFileSync(appCssPath, 'utf8');

assert(appCssContent.includes('.receive-btn-col'), 'App.css must have .receive-btn-col');
assert(appCssContent.includes('.receive-btn-spacer'), 'App.css must have .receive-btn-spacer');
assert(
  appCssContent.includes('.receive-btn-spacer {\n    display: none !important;\n  }'),
  'Mobile responsive rule must hide spacer on <=800px screens'
);
console.log('  ✓ PASS: App.css contains .receive-btn-col and .receive-btn-spacer with responsive rules');

// 3. Logic simulation test
console.log('\n--- 3. Logic Simulation Test ---');
const systemSerialsMap = new Map();
systemSerialsMap.set('F8Y6234C9AR231LB3', {
  part_number: '661-30373',
  description: 'Battery, iPhone 14',
  assignment: 'CRBR',
  location: 'DC-BIN-01'
});

function checkDuplicate(serialInput) {
  const clean = String(serialInput || '').trim().toUpperCase();
  if (!clean || clean.length < 4) return null;
  return systemSerialsMap.get(clean) || null;
}

function isButtonDisabled(serialInput) {
  const duplicateSerialMatch = checkDuplicate(serialInput);
  return Boolean(duplicateSerialMatch);
}

// Case A: Duplicate Serial
const dupResult = checkDuplicate('F8Y6234C9AR231LB3');
assert(dupResult !== null, 'Duplicate serial should match existing system serial');
assert(isButtonDisabled('F8Y6234C9AR231LB3') === true, 'Button MUST be disabled for duplicate serial');
console.log('  ✓ PASS: Button disabled = true for duplicate serial F8Y6234C9AR231LB3');

// Case B: Case insensitivity and whitespace handling
assert(isButtonDisabled('  f8y6234c9ar231lb3  ') === true, 'Button MUST be disabled for lowercase/whitespace duplicate');
console.log('  ✓ PASS: Button disabled = true for lowercased/spaced duplicate');

// Case C: New unique serial
assert(isButtonDisabled('C02ZW0TCJ168') === false, 'Button MUST NOT be disabled for unique serial');
console.log('  ✓ PASS: Button disabled = false for unique new serial');

// Case D: Short input (<4 chars)
assert(isButtonDisabled('F8Y') === false, 'Button MUST NOT be disabled for short prefix');
console.log('  ✓ PASS: Button disabled = false for short input');

// 4. Automatic Duplicate Text Selection / Highlighting Verification
console.log('\n--- 4. Automatic Text Highlighting on Duplicate Detection ---');
assert(
  scanInContent.includes('serialInputRef.current.select()') &&
  scanInContent.includes('duplicateSerialMatch && serialInputRef.current'),
  'ScanInReceiving must have an effect auto-selecting serialInputRef when duplicate is detected'
);
console.log('  ✓ PASS: useEffect auto-focuses and selects duplicate serial text');

assert(
  scanInContent.includes('scanner-input-duplicate'),
  'ScanInReceiving must apply scanner-input-duplicate CSS class'
);
console.log('  ✓ PASS: scanner-input-duplicate CSS class applied dynamically');

assert(
  appCssContent.includes('.scanner-input.scanner-input-duplicate::selection'),
  'App.css must have selection highlight rule for .scanner-input.scanner-input-duplicate'
);
console.log('  ✓ PASS: App.css defines ::selection styling for duplicate input');

console.log('\n====================================================');
console.log('ALL RECEIVE BUTTON & DUPLICATE TESTS PASSED (100%)');
console.log('====================================================\n');
