import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Part Number Search without Auto Site Selection');
console.log('========================================================================\n');

const code = fs.readFileSync(path.join(projectRoot, 'src/components/FixablyInventoryDashboard.jsx'), 'utf8');

// Test 1: selectedSiteCode initial state does not hardcode 'BHS'
console.log('--- Test 1: Initial selectedSiteCode state ---');
assert.ok(!code.includes("return 'BHS';"), "selectedSiteCode must not return hardcoded 'BHS'");
assert.ok(code.includes("return '';"), "selectedSiteCode should default to empty string when not assigned or provided");
console.log('  ✓ PASS: selectedSiteCode does not default to BHS');

// Test 2: currentSiteData returns null if no site is selected
console.log('\n--- Test 2: currentSiteData memoization ---');
assert.ok(!code.includes("|| snapshot.sites[0] || null;"), "currentSiteData must not fall back to snapshot.sites[0]");
assert.ok(code.includes("if (!snapshot?.sites || !selectedSiteCode) return null;"), "currentSiteData must return null when selectedSiteCode is falsy");
console.log('  ✓ PASS: currentSiteData is null when no site has been selected');

// Test 3: isCurrentSelected requires selectedSiteCode to be truthy
console.log('\n--- Test 3: isCurrentSelected in search availability cards ---');
assert.ok(
  code.includes("const isCurrentSelected = Boolean(selectedSiteCode && selectedSiteCode.toUpperCase() === site.cleanCode.toUpperCase());"),
  "isCurrentSelected must guard against empty selectedSiteCode"
);
console.log('  ✓ PASS: isCurrentSelected requires explicit selectedSiteCode');

// Test 4: Enter key on part search prioritizes part number catalog over matching serials
console.log('\n--- Test 4: Keyboard navigation in part search bar ---');
assert.ok(code.includes("const isPartNumberFormat = /^[0-9]{3}-/i.test(rawQuery)"), "Must recognize part number format like 661-");
assert.ok(code.includes("if (matchingSerials.length > 0 && !isPartNumberFormat)"), "Must not auto-select serial when searching a part number format");
console.log('  ✓ PASS: Enter key prioritizes part number search without auto-selecting serial or site');

// Test 5: Region tab switching does not force-select a site
console.log('\n--- Test 5: Region tab switching ---');
assert.ok(!code.includes("setSelectedSiteCode(metroManilaSitesList[0]"), "Switching to Metro Manila must not force select first site");
assert.ok(!code.includes("setSelectedSiteCode(provincialSitesList[0]"), "Switching to Provincial must not force select first site");
console.log('  ✓ PASS: Switching regions does not force-select any site');

// Test 6: Clear view / placeholder exists
console.log('\n--- Test 6: Unselected site placeholder & close view button ---');
assert.ok(code.includes("No Branch Site Selected"), "Must render placeholder when no branch is selected");
assert.ok(code.includes("Deselect site and return to all-sites view"), "Must provide Close View button when viewing a branch");
console.log('  ✓ PASS: Clean unselected state and Close View button verified');

console.log('\n========================================================================');
console.log('ALL PART SEARCH NO-AUTO-SELECTION TESTS PASSED (100%)');
console.log('========================================================================\n');
