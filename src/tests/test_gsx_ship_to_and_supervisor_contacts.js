import assert from 'assert';
import { OFFICIAL_BRANCH_DIRECTORY, enrichSiteWithDirectory, normalizeSiteCode } from '../constants/branchDirectory.js';

console.log('====================================================================');
console.log('TEST SUITE: GSX Ship-To Location Numbers & Supervisor Directory Sync');
console.log('====================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Verify Directory Completeness
// -----------------------------------------------------------------------------
console.log('--- Test 1: Verify Completeness of Official Branch Directory ---');

const expectedBranchCodes = [
  'DC-MDC', 'APP BHS', 'APP GB3', 'APP PPM', 'ASP GL5', 'ASP SMS', 'APP MOA', 'ASP POD',
  'APP MEG', 'APP ANX', 'APP TRI', 'ASP VN', 'ASP NES', 'APP FES', 'ASP MRK',
  'APP RM', 'ASP LIM', 'ASP NPM', 'ASP NAG', 'ASP LAU', 'ASP ILO', 'ASP CEB',
  'ASP ZAM', 'ASP ABR', 'ASP COT', 'ASP CDO', 'APP LAN'
];

let totalDirectorySites = Object.keys(OFFICIAL_BRANCH_DIRECTORY).length;
console.log(`Verified ${totalDirectorySites} official service sites registered in directory.`);
assert.strictEqual(totalDirectorySites >= 26, true, 'At least 26 official sites must exist in directory');

expectedBranchCodes.forEach(code => {
  const entry = OFFICIAL_BRANCH_DIRECTORY[code];
  assert.ok(entry, `Branch directory must contain entry for ${code}`);
  assert.ok(entry.name, `Branch ${code} must have a name`);
  assert.ok(entry.address, `Branch ${code} must have an address`);
  assert.ok(entry.contact_person, `Branch ${code} must have a contact person`);
  assert.ok(entry.contact_phone, `Branch ${code} must have a contact phone`);
  assert.ok(entry.contact_email, `Branch ${code} must have a contact email`);

  if (code !== 'ASP COT') {
    assert.ok(entry.ship_to, `Branch ${code} must have a GSX Ship-To number`);
    assert.strictEqual(entry.ship_to.length, 10, `GSX Ship-To for ${code} must be a 10-digit Apple identifier`);
  }
});
console.log('  ✓ PASS: All official branches have complete supervisor identity and contact credentials\n');

// -----------------------------------------------------------------------------
// Test 2: Verify Specific Screenshot Branches
// -----------------------------------------------------------------------------
console.log('--- Test 2: Verifying Specific Screenshot Branches (APP BHS, APP FES, APP GB3, APP RM, APP MOA, APP MEG) ---');

const screenshotScenario = [
  { code: 'APP BHS', expectedShipTo: '0001836095', expectedSupervisor: 'MA. PARTRICIA BAGARES' },
  { code: 'APP FES', expectedShipTo: '0001815657', expectedSupervisor: 'FRANCHESCA MACALINAO' },
  { code: 'APP GB3', expectedShipTo: '0001645879', expectedSupervisor: 'AILA CASSANDRA DE GALA' },
  { code: 'APP RM',  expectedShipTo: '0001764735', expectedSupervisor: 'EDWARD RUSSEL VISTAN' },
  { code: 'APP MOA', expectedShipTo: '0001645876', expectedSupervisor: 'JAY IAN DULAY' },
  { code: 'APP MEG', expectedShipTo: '0001745440', expectedSupervisor: 'LEANDRO LEE' }
];

screenshotScenario.forEach(({ code, expectedShipTo, expectedSupervisor }) => {
  // Simulate bare Supabase row where ship_to and contact are null
  const bareRowFromDb = {
    id: `db-${code.toLowerCase().replace(/\s+/g, '-')}`,
    code,
    name: OFFICIAL_BRANCH_DIRECTORY[code].name,
    region: 'Metro Manila',
    address: OFFICIAL_BRANCH_DIRECTORY[code].address,
    ship_to: null,
    contact_person: '',
    contact_phone: '',
    contact_email: ''
  };

  const enriched = enrichSiteWithDirectory(bareRowFromDb);

  assert.strictEqual(enriched.ship_to, expectedShipTo, `Enriched ship_to for ${code} must match ${expectedShipTo}`);
  assert.strictEqual(enriched.contact_person, expectedSupervisor, `Enriched contact_person for ${code} must match ${expectedSupervisor}`);
  assert.ok(enriched.contact_phone.length > 0, `Enriched contact_phone for ${code} must not be empty`);
  assert.ok(enriched.contact_email.includes('@mobilecareph.com'), `Enriched contact_email for ${code} must be mobilecareph domain`);

  console.log(`  ✓ ${code.padEnd(8)}: Ship-To = ${enriched.ship_to} | Supervisor = ${enriched.contact_person} | Phone = ${enriched.contact_phone}`);
});
console.log('  ✓ PASS: All screenshot scenario branches successfully restored\n');

// -----------------------------------------------------------------------------
// Test 3: Normalization & Custom Overrides
// -----------------------------------------------------------------------------
console.log('--- Test 3: Normalization and User Custom Overrides ---');

// APPILO normalization
assert.strictEqual(normalizeSiteCode('APPILO'), 'APP ILO');
assert.strictEqual(normalizeSiteCode('DC'), 'DC-MDC');

// Ensure user custom edits are preserved if already specified
const customEditedSite = {
  code: 'APP BHS',
  name: 'MOBILECARE - APP BONIFACIO HIGH STREET',
  ship_to: '0001999999', // custom override
  contact_person: 'New Custom Manager',
  contact_phone: '0999-9999999',
  contact_email: 'custom@test.com'
};

const enrichedCustom = enrichSiteWithDirectory(customEditedSite);
assert.strictEqual(enrichedCustom.ship_to, '0001999999', 'Custom ship_to must be preserved');
assert.strictEqual(enrichedCustom.contact_person, 'New Custom Manager', 'Custom contact_person must be preserved');
assert.strictEqual(enrichedCustom.contact_phone, '0999-9999999', 'Custom contact_phone must be preserved');
console.log('  ✓ PASS: User customizations take precedence over default directory\n');

console.log('====================================================================');
console.log('ALL GSX SHIP-TO & SUPERVISOR DIRECTORY TESTS PASSED (100%)');
console.log('====================================================================');
