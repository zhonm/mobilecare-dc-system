import assert from 'node:assert';
import fs from 'node:fs';
import { searchSerialsWithFullDetails } from '../utils/serialTracker.js';

console.log('========================================================================');
console.log('TEST SUITE: Superadmin Serial Number Location Search & Tracker');
console.log('========================================================================');

// 1. Mock dataset with multi-site branch inventory units
const mockSites = [
  { id: 'site-gl5', code: 'ASP GL5', name: 'MOBILECARE - GLORIETTA 5', region: 'Metro Manila', is_dc: false },
  { id: 'site-sms', code: 'ASP SMS', name: "MOBILECARE - S'MAISON", region: 'Metro Manila', is_dc: false },
  { id: 'site-mrk', code: 'ASP MRK', name: 'MOBILECARE - SM MARIKINA', region: 'Metro Manila', is_dc: false },
  { id: 'site-cdo', code: 'ASP CDO', name: 'MOBILECARE - CAGAYAN DE ORO', region: 'Provincial', is_dc: false },
  { id: 'site-dc', code: 'DC-MDC', name: 'Distribution Center (DC)', region: 'Central DC', is_dc: true }
];

const mockParts = [
  { part_number: '661-21991', description: 'Battery, iPhone 13', iphone_model: 'iPhone 13' },
  { part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', iphone_model: 'iPhone 13 Pro Max' },
  { part_number: 'Z661-35407', description: 'AirPods Pro 2nd gen Right', iphone_model: 'AirPods Pro' }
];

const mockInventoryUnits = [
  {
    id: 'u-1',
    serial_number: 'FG9HTN001JB00006TT',
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    current_site_id: 'site-sms',
    site_code: 'ASP SMS',
    site_name: "MOBILECARE - S'MAISON",
    status: 'in_stock',
    box_number: 3,
    received_at: '2026-10-06T08:00:00Z'
  },
  {
    id: 'u-2',
    serial_number: 'F8Y6272C24J18FKBG',
    part_number: '661-21991',
    description: 'Battery, iPhone 13',
    current_site_id: 'site-mrk',
    site_code: 'ASP MRK',
    site_name: 'MOBILECARE - SM MARIKINA',
    status: 'in_stock',
    box_number: 1,
    received_at: '2026-10-06T10:00:00Z'
  },
  {
    id: 'u-3',
    serial_number: 'USED-SN-998877',
    part_number: '661-22294',
    description: 'Battery, iPhone 13 Pro Max',
    current_site_id: 'site-gl5',
    site_code: 'ASP GL5',
    site_name: 'MOBILECARE - GLORIETTA 5',
    status: 'used',
    work_order_number: 'WO-2026-0044',
    used_at: '2026-10-07T14:30:00Z',
    used_by_name: 'Tech Specialist'
  }
];

// Test 1: Search exact serial from user screenshot
console.log('\n--- Test 1: Exact Serial Number Search (User Screenshot Case) ---');
const res1 = searchSerialsWithFullDetails('FG9HTN001JB00006TT', {
  inventoryUnits: mockInventoryUnits,
  shipments: [],
  repairUsageRecords: [],
  sites: mockSites,
  parts: mockParts
}, 5);

assert.strictEqual(res1.length, 1, 'Must find exactly 1 matching unit');
assert.strictEqual(res1[0].serialNumber, 'FG9HTN001JB00006TT');
assert.strictEqual(res1[0].siteCode, 'ASP SMS', 'Must identify exact location as ASP SMS');
assert.strictEqual(res1[0].siteName, "MOBILECARE - S'MAISON");
assert.strictEqual(res1[0].statusBadgeType, 'site', 'Must show in stock at site');
assert.strictEqual(res1[0].partNumber, '661-21991');
console.log(`  ✓ PASS: Found serial FG9HTN001JB00006TT located at ${res1[0].siteCode} (${res1[0].siteName})`);

// Test 2: Case-insensitive and partial serial search
console.log('\n--- Test 2: Case-Insensitive & Partial Serial Search ---');
const res2 = searchSerialsWithFullDetails('f8y6272c', {
  inventoryUnits: mockInventoryUnits,
  shipments: [],
  repairUsageRecords: [],
  sites: mockSites,
  parts: mockParts
}, 5);

assert.strictEqual(res2.length, 1, 'Must match F8Y6272C24J18FKBG');
assert.strictEqual(res2[0].siteCode, 'ASP MRK', 'Must locate at ASP MRK');
console.log(`  ✓ PASS: Partial lower-case search 'f8y6272c' correctly tracks to ${res2[0].siteCode}`);

// Test 3: Used in Repair Serial Number Tracking
console.log('\n--- Test 3: Used Serial Number Location & Work Order Details ---');
const res3 = searchSerialsWithFullDetails('USED-SN-998877', {
  inventoryUnits: mockInventoryUnits,
  shipments: [],
  repairUsageRecords: [],
  sites: mockSites,
  parts: mockParts
}, 5);

assert.strictEqual(res3.length, 1);
assert.strictEqual(res3[0].isUsed, true);
assert.strictEqual(res3[0].workOrderNumber, 'WO-2026-0044');
assert.strictEqual(res3[0].siteCode, 'ASP GL5');
console.log(`  ✓ PASS: Correctly locates used part at ${res3[0].siteCode} with WO# ${res3[0].workOrderNumber}`);

// Test 4: Verify RequestParts.jsx implementation integrity
console.log('\n--- Test 4: RequestParts.jsx Code Structure Verification ---');
const reqCode = fs.readFileSync('src/components/RequestParts.jsx', 'utf8');
assert.ok(reqCode.includes('allStocksSerialSearchResults'), 'RequestParts.jsx must declare allStocksSerialSearchResults');
assert.ok(reqCode.includes('searchSerialsWithFullDetails'), 'RequestParts.jsx must import and use searchSerialsWithFullDetails');
assert.ok(reqCode.includes('Exact Serial Location Tracker for'), 'RequestParts.jsx must render Exact Serial Location Tracker header');
assert.ok(reqCode.includes('Locate at Branch'), 'RequestParts.jsx must provide Locate at Branch action button');
assert.ok(reqCode.includes('SerialDossierModal'), 'RequestParts.jsx must render SerialDossierModal');
assert.ok(reqCode.includes('Serial Tracking: Full Network') || reqCode.includes('Serial Tracking:'), 'RequestParts.jsx must display Serial Tracking indicator');
console.log('  ✓ PASS: RequestParts.jsx contains all UI and tracking integrations');

console.log('\n========================================================================');
console.log('ALL SUPERADMIN SERIAL LOCATION SEARCH TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================');
