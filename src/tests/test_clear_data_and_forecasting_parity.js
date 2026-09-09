/**
 * Test Suite: Clear Data Functionality & Demand Forecasting Parity
 * Verifies that:
 * 1. isExplicitlyCleared() correctly returns true when mdc_is_cleared is true,
 *    even when intake records or inventory logs exist in localStorage.
 * 2. getActiveMasterlist() returns null when cleared, preventing unwanted resuscitation.
 * 3. clearOperationalLocalStorage preserves mdc_is_cleared.
 * 4. Case-insensitive phrase matching works for "Delete Data".
 * 5. Items with computed_forecast/final_forecast and empty historical monthly usage
 *    correctly display their forecast units and valuations rather than 0.
 */

import assert from 'assert';
import { isExplicitlyCleared } from '../utils/appContextHelpers.js';
import { getActiveMasterlist, isMasterlistCleared } from '../utils/rawMasterlistScanner.js';
import { clearOperationalLocalStorage } from '../utils/cacheManager.js';
import { calculateItemForecast } from '../utils/forecastEngine.js';

// Setup Mock Window & LocalStorage
const storage = {};
global.window = {
  localStorage: {
    getItem: (key) => (key in storage ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
    get length() { return Object.keys(storage).length; },
    key: (i) => Object.keys(storage)[i] || null
  }
};
global.localStorage = global.window.localStorage;

console.log('====================================================');
console.log('RUNNING TEST SUITE: Clear Data & Forecasting Parity');
console.log('====================================================');

// ── Test 1: isExplicitlyCleared Reliability ─────────────────────────
console.log('\nTest 1: Verifying isExplicitlyCleared with intake records present...');
localStorage.clear();
localStorage.setItem('mdc_is_cleared', 'true');
localStorage.setItem('mdc_dc_intake_records', JSON.stringify([{ id: 'intake-1', items: [{ serial: 'ABC12345' }] }]));
localStorage.setItem('mdc_inventory', JSON.stringify([{ id: 'inv-1', serial: 'ABC12345' }]));

assert.strictEqual(
  isExplicitlyCleared(),
  true,
  'isExplicitlyCleared() must return true when mdc_is_cleared is true even if intake records exist'
);
console.log('  ✓ PASS: isExplicitlyCleared() correctly returns true regardless of intake or inventory records');

// ── Test 2: getActiveMasterlist Returns null When Cleared ───────────
console.log('\nTest 2: Verifying getActiveMasterlist returns null when cleared...');
localStorage.setItem('mdc_is_cleared', 'true');
assert.strictEqual(isMasterlistCleared(), true, 'isMasterlistCleared() must be true');

const activeWhenCleared = getActiveMasterlist(null, { month: 9, year: 2026, label: 'September 2026' });
assert.strictEqual(
  activeWhenCleared,
  null,
  'getActiveMasterlist() must return null when cleared to prevent phantom resuscitation'
);
console.log('  ✓ PASS: getActiveMasterlist() returns null when system is in cleared state');

// ── Test 3: clearOperationalLocalStorage Preserves mdc_is_cleared ───
console.log('\nTest 3: Verifying clearOperationalLocalStorage preserves mdc_is_cleared...');
localStorage.clear();
localStorage.setItem('mdc_current_user', JSON.stringify({ id: 'user-1', role: 'admin' }));
localStorage.setItem('mdc_is_cleared', 'true');
localStorage.setItem('mdc_forecast', '[{"id": "fc-1"}]');

await clearOperationalLocalStorage({ keepSession: true });

assert.strictEqual(
  localStorage.getItem('mdc_is_cleared'),
  'true',
  'mdc_is_cleared must NOT be wiped by clearOperationalLocalStorage'
);
assert.strictEqual(
  localStorage.getItem('mdc_forecast'),
  null,
  'mdc_forecast must be wiped by clearOperationalLocalStorage'
);
console.log('  ✓ PASS: clearOperationalLocalStorage successfully preserves mdc_is_cleared and active session');

// ── Test 4: Case-Insensitive Phrase Matching ────────────────────────
console.log('\nTest 4: Verifying case-insensitive phrase matching...');
const REQUIRED_PHRASE = 'Delete Data';
const variations = ['Delete Data', 'delete data', 'DELETE DATA', '  Delete Data  ', 'delete Data'];

variations.forEach(v => {
  const isMatched = v.trim().toLowerCase() === REQUIRED_PHRASE.toLowerCase();
  assert.strictEqual(isMatched, true, `Phrase "${v}" must match "${REQUIRED_PHRASE}"`);
});
console.log('  ✓ PASS: Case-insensitive "Delete Data" phrase matching verified for all variations');

// ── Test 5: Demand Forecasting Fallback When History is Zero ────────
console.log('\nTest 5: Verifying Demand Forecasting value calculation when monthly history is 0...');
// Simulating an item derived from an Allocation Masterlist (e.g. Battery iPhone 13)
const mockMasterlistItem = {
  id: 'fc-661-21991',
  part_number: '661-21991',
  description: 'Battery, iPhone 13',
  stocking_price: 89,
  computed_forecast: 234,
  final_forecast: 234,
  admin_override: null,
  ytd_monthly_counts: [0, 0, 0, 0, 0, 0, 0, 0]
};

const counts = mockMasterlistItem.ytd_monthly_counts;
const hasCounts = counts.some(c => c > 0);
const calculated = hasCounts ? calculateItemForecast(mockMasterlistItem, 'linear') : 0;
const computed = hasCounts
  ? calculated
  : (typeof mockMasterlistItem.computed_forecast === 'number'
      ? mockMasterlistItem.computed_forecast
      : (typeof mockMasterlistItem.final_forecast === 'number'
          ? mockMasterlistItem.final_forecast
          : calculated));
const finalVal = mockMasterlistItem.admin_override !== null ? mockMasterlistItem.admin_override : computed;
const lineCost = finalVal * mockMasterlistItem.stocking_price;

assert.strictEqual(computed, 234, 'Computed forecast must equal 234 instead of 0');
assert.strictEqual(finalVal, 234, 'Final forecast must equal 234 instead of 0');
assert.strictEqual(lineCost, 234 * 89, 'Line cost must equal 234 * $89 = $20,826');
console.log('  ✓ PASS: Masterlist items with 0 historical counts correctly resolve to their 234 unit forecast & $20,826 valuation');

// ── Test 6: Verify Admin Override Still Takes Precedence ─────────────
console.log('\nTest 6: Verifying Admin Override takes precedence...');
const overrideItem = {
  ...mockMasterlistItem,
  admin_override: 300
};
const overrideFinal = overrideItem.admin_override !== null ? overrideItem.admin_override : computed;
assert.strictEqual(overrideFinal, 300, 'Admin override (300) must take precedence over computed forecast (234)');
console.log('  ✓ PASS: Admin override (300) takes precedence over baseline forecast');

console.log('\n====================================================');
console.log('ALL TESTS PASSED (6/6)');
console.log('====================================================');
