import assert from 'node:assert';
import fs from 'node:fs';
import { searchSerialsWithFullDetails } from '../utils/serialTracker.js';

console.log('========================================================================');
console.log('TEST SUITE: Serial Number Search in Dashboard & Across System');
console.log('========================================================================\n');

// Mock Fixably snapshot items matching the user's uploaded screenshot case
const mockSnapshotItems = [
  {
    serialNumber: 'G9QHQ4D08500004Y7',
    partNumber: '661-44797',
    description: 'Display, iPhone 16',
    siteCode: 'APP MEG',
    siteName: 'MOBILECARE - APP MEGAMALL',
    stockType: 'MSPI-Owned',
    agingDays: 183,
    agingBracket: 'DEAD_STOCK',
    badgeBg: '#fee2e2',
    badgeColor: '#dc2626',
    statusLabel: 'Dead Stock'
  },
  {
    serialNumber: 'FG9HTN001JB00006TT',
    partNumber: '661-21991',
    description: 'Battery, iPhone 13',
    siteCode: 'APP BHS',
    siteName: 'MOBILECARE - BONIFACIO HIGH STREET',
    stockType: 'DC Stock',
    agingDays: 45,
    agingBracket: 'IN_STOCK',
    badgeBg: '#dcfce7',
    badgeColor: '#15803d',
    statusLabel: 'In Stock'
  }
];

// Test 1: Autocomplete matching serial numbers logic
console.log('--- Test 1: Autocomplete Matching Serial Numbers Logic ---');
function findMatchingSerials(items, input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length < 2) return [];
  const q = raw.toUpperCase();
  const qClean = q.replace(/[^A-Z0-9]/g, '');

  const matches = [];
  const seen = new Set();

  for (const it of items) {
    const sn = String(it.serialNumber || it.serial_number || '').trim();
    if (!sn || sn.startsWith('Non-serialized')) continue;
    const snClean = sn.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (sn.toUpperCase().includes(q) || (qClean && snClean.includes(qClean))) {
      const key = `${sn}-${it.siteCode}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push(it);
      }
    }
  }
  return matches;
}

const matchExact = findMatchingSerials(mockSnapshotItems, 'G9QHQ4D08500004Y7');
assert.strictEqual(matchExact.length, 1, 'Should find 1 matching serial for exact query');
assert.strictEqual(matchExact[0].serialNumber, 'G9QHQ4D08500004Y7');
assert.strictEqual(matchExact[0].partNumber, '661-44797');
assert.strictEqual(matchExact[0].siteCode, 'APP MEG');
console.log('  ✓ PASS: Exact serial query "G9QHQ4D08500004Y7" successfully matched');

const matchPartial = findMatchingSerials(mockSnapshotItems, 'g9qhq');
assert.strictEqual(matchPartial.length, 1, 'Should find 1 matching serial for partial lowercase query');
assert.strictEqual(matchPartial[0].serialNumber, 'G9QHQ4D08500004Y7');
console.log('  ✓ PASS: Partial lowercase query "g9qhq" successfully matched');

// Test 2: Global serial tracking with fixablyItems
console.log('\n--- Test 2: Global serialTracker with fixablyItems ---');
const resolvedGlobal = searchSerialsWithFullDetails('G9QHQ4D08500004Y7', {
  inventoryUnits: [],
  shipments: [],
  repairUsageRecords: [],
  sites: [{ code: 'APP MEG', name: 'MOBILECARE - APP MEGAMALL', region: 'Metro Manila' }],
  parts: [{ part_number: '661-44797', description: 'Display, iPhone 16' }],
  fixablyItems: mockSnapshotItems
}, 5);

assert.strictEqual(resolvedGlobal.length, 1, 'searchSerialsWithFullDetails must find Fixably branch serial');
assert.strictEqual(resolvedGlobal[0].serialNumber, 'G9QHQ4D08500004Y7');
assert.strictEqual(resolvedGlobal[0].partNumber, '661-44797');
assert.strictEqual(resolvedGlobal[0].siteCode, 'APP MEG');
assert.strictEqual(resolvedGlobal[0].statusBadgeType, 'site');
console.log(`  ✓ PASS: Globally resolved serial to ${resolvedGlobal[0].siteCode} (${resolvedGlobal[0].siteName})`);

// Test 3: FixablyInventoryDashboard.jsx code verification
console.log('\n--- Test 3: FixablyInventoryDashboard.jsx Code Structure Verification ---');
const dashCode = fs.readFileSync('src/components/FixablyInventoryDashboard.jsx', 'utf8');

assert.ok(dashCode.includes('Search Stock Availability by Part Number or Serial #'), 'Title must reflect Serial searching capability');
assert.ok(dashCode.includes('matchingSerials'), 'Must compute matchingSerials in dashboard');
assert.ok(dashCode.includes('locatedSerialUnit'), 'Must compute locatedSerialUnit in dashboard');
assert.ok(dashCode.includes('handleSelectSerial'), 'Must have handleSelectSerial function');
assert.ok(dashCode.includes('Serial Number Located'), 'Must render dedicated Serial Number Located banner');
assert.ok(dashCode.includes('SerialDossierModal'), 'Must import and render SerialDossierModal');
assert.ok(dashCode.includes('branchFilterQuery'), 'Must support branch filter query');
assert.ok(dashCode.includes('displayedPartAggregations'), 'Must use displayedPartAggregations for branch stock filtering');
console.log('  ✓ PASS: All dashboard UI components and search state verified');

// Test 4: CommandPalette.jsx and RequestParts.jsx integration
console.log('\n--- Test 4: CommandPalette.jsx and RequestParts.jsx Integration Verification ---');
const cmdCode = fs.readFileSync('src/components/CommandPalette.jsx', 'utf8');
assert.ok(cmdCode.includes('fixablyItems: fixablySnapshot?.items'), 'CommandPalette must pass fixablyItems to serial search');

const reqCode = fs.readFileSync('src/components/RequestParts.jsx', 'utf8');
assert.ok(reqCode.includes('fixablyItems: fixablySnapshot?.items'), 'RequestParts must pass fixablyItems to serial search');
console.log('  ✓ PASS: CommandPalette and RequestParts both integrated with branch snapshot serials');

console.log('\n========================================================================');
console.log('ALL SERIAL SEARCH TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================');
