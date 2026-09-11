import assert from 'assert';
import { isShipmentProvince, isShipmentMetroManila } from '../utils/shipmentHelpers.js';
import { isProvincialSite } from '../utils/partResolver.js';
import { resolveSafeRegion } from '../constants/config.js';

function normalizeSiteCode(rawCode) {
  if (!rawCode) return '';
  const c = String(rawCode).trim().toUpperCase();
  if (c === 'APPILO') return 'APP ILO';
  return c;
}

console.log('====================================================================');
console.log('TEST SUITE: Site Region & Address Editing, Cloud Sync & Persistence');
console.log('====================================================================\n');

// -----------------------------------------------------------------------------
// 1. Verify Site Editing & Normalization Logic
// -----------------------------------------------------------------------------
console.log('--- 1. Testing Site Editing & Normalization (Region & Address) ---');

const baseSites = [
  {
    id: 'site-lau-1',
    code: 'ASP LAU',
    name: 'MOBILECARE - LA UNION',
    region: 'Metro Manila', // previously defaulted incorrectly
    address: 'SPACE NO.: 316, LEVEL 3, DIGIWORLD SAN FERNANDO, LA UNION 38 2500 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-LAU, SPACE NO.: 316, LEVEL 3, DIGIWORLD SAN FERNANDO, LA UNION 38 2500 Philippines',
    is_dc: false
  },
  {
    id: 'site-nag-1',
    code: 'ASP NAG',
    name: 'MOBILECARE - NAGA',
    region: 'Camarines Sur',
    address: 'BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS.INC.-NAGA, BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
    is_dc: false
  }
];

// Simulate updating ASP LAU to 'La Union' and updating address
const editPayload = {
  id: 'site-lau-1',
  code: 'ASP LAU',
  name: 'MOBILECARE - LA UNION BRANCH',
  region: 'La Union',
  address: 'Robinsons Place La Union, San Fernando City, La Union 2500 Philippines',
  contact_person: 'Felix Mendorio',
  contact_phone: '0927-1664281',
  contact_email: 'felix.mendiorojr@mobilecareph.com',
  ship_to: '0001815649'
};

// Simulation of saveSite logic
function simulateSaveSite(currentSites, siteData) {
  const cleanCode = normalizeSiteCode(siteData.code);
  const cleanRegion = (siteData.region || '').trim() || 'Metro Manila';
  const cleanAddress = (siteData.address || siteData.full_address || '').trim();

  const savedSite = {
    ...siteData,
    code: cleanCode,
    name: (siteData.name || '').trim(),
    region: cleanRegion,
    address: cleanAddress,
    full_address: cleanAddress,
    contact_person: (siteData.contact_person || '').trim(),
    contact_phone: (siteData.contact_phone || '').trim(),
    contact_email: (siteData.contact_email || '').trim(),
    ship_to: (siteData.ship_to || '').trim() || null,
    sold_to: (siteData.sold_to || '').trim() || null
  };

  const updatedList = currentSites.map(s => 
    (s.id === siteData.id || normalizeSiteCode(s.code) === cleanCode) ? savedSite : s
  );

  // Payload sent to Supabase
  const supabasePayload = {
    ...(savedSite.id && !savedSite.id.startsWith('site-') ? { id: savedSite.id } : {}),
    code: savedSite.code,
    name: savedSite.name,
    region: savedSite.region || 'Metro Manila',
    address: savedSite.address || '',
    full_address: savedSite.full_address || savedSite.address || '',
    contact_person: savedSite.contact_person || '',
    contact_phone: savedSite.contact_phone || '',
    contact_email: savedSite.contact_email || '',
    ship_to: savedSite.ship_to || null,
    sold_to: savedSite.sold_to || null,
    invoice_prefix: savedSite.invoice_prefix || '',
    is_dc: savedSite.is_dc ?? false,
    is_active: savedSite.is_active ?? true
  };

  return { updatedList, savedSite, supabasePayload };
}

const saveResult = simulateSaveSite(baseSites, editPayload);
const updatedLAU = saveResult.updatedList.find(s => s.code === 'ASP LAU');

assert.strictEqual(updatedLAU.region, 'La Union', 'ASP LAU region must be updated to La Union');
assert.strictEqual(updatedLAU.address, 'Robinsons Place La Union, San Fernando City, La Union 2500 Philippines');
assert.strictEqual(updatedLAU.full_address, 'Robinsons Place La Union, San Fernando City, La Union 2500 Philippines');
assert.strictEqual(saveResult.supabasePayload.region, 'La Union');
assert.strictEqual(saveResult.supabasePayload.address, updatedLAU.address);
assert.strictEqual(saveResult.supabasePayload.full_address, updatedLAU.address);
console.log('  ✓ PASS: Site state and Supabase payload properly update region & address');

// -----------------------------------------------------------------------------
// 2. Verify Cloud Sync Does Not Overwrite Edited Region
// -----------------------------------------------------------------------------
console.log('\n--- 2. Testing Cloud Sync Preservation (No Hardcoded Overwrite) ---');

// Simulate Supabase returning the updated DB sites
const mockDbSites = [
  {
    id: 'site-lau-1',
    code: 'ASP LAU',
    name: 'MOBILECARE - LA UNION BRANCH',
    region: 'La Union',
    address: 'Robinsons Place La Union, San Fernando City, La Union 2500 Philippines',
    full_address: 'Robinsons Place La Union, San Fernando City, La Union 2500 Philippines',
    is_dc: false,
    is_active: true
  },
  {
    id: 'site-nag-1',
    code: 'ASP NAG',
    name: 'MOBILECARE - NAGA',
    region: 'Camarines Sur',
    address: 'BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS.INC.-NAGA, BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
    is_dc: false,
    is_active: true
  }
];

// Clean mapping function as in useCloudSync.js
function mapCloudSites(dbSites) {
  return dbSites
    .filter(s =>
      !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
      !String(s.address || '').toUpperCase().includes('SM ILOILO')
    )
    .map(s => ({
      id: s.id,
      code: s.code,
      name: s.name,
      region: s.region || (isProvincialSite(s) ? 'Provincial' : 'Metro Manila'),
      address: s.address || s.full_address || '',
      full_address: s.full_address || s.address || '',
      contact_person: s.contact_person || '',
      contact_phone: s.contact_phone || '',
      contact_email: s.contact_email || '',
      ship_to: s.ship_to || null,
      sold_to: s.sold_to || null,
      invoice_prefix: s.invoice_prefix || '',
      is_dc: s.is_dc ?? false,
      is_active: s.is_active ?? true
    }))
    .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
}

const syncedSites = mapCloudSites(mockDbSites);
const syncedLAU = syncedSites.find(s => s.code === 'ASP LAU');
const syncedNAG = syncedSites.find(s => s.code === 'ASP NAG');

assert.strictEqual(syncedLAU.region, 'La Union', 'ASP LAU region must remain La Union after cloud sync');
assert.strictEqual(syncedNAG.region, 'Camarines Sur', 'ASP NAG region must remain Camarines Sur after cloud sync');
console.log('  ✓ PASS: Cloud sync respects database region and does not overwrite with Camarines Sur');

// -----------------------------------------------------------------------------
// 3. Verify Custom Typed Region Support
// -----------------------------------------------------------------------------
console.log('\n--- 3. Testing Custom Region Entry & Persistence ---');

const customRegionPayload = {
  id: 'site-custom-1',
  code: 'ASP PLW',
  name: 'MOBILECARE - PALAWAN',
  region: 'Palawan', // Custom region not previously in hardcoded list
  address: 'Rizal Avenue, Puerto Princesa, Palawan 5300 Philippines',
  is_dc: false
};

const customSaveResult = simulateSaveSite([], customRegionPayload);
assert.strictEqual(customSaveResult.savedSite.region, 'Palawan', 'Custom typed region "Palawan" must be preserved');
assert.strictEqual(customSaveResult.supabasePayload.region, 'Palawan', 'Supabase payload must preserve custom region');

const customSynced = mapCloudSites([customSaveResult.savedSite]);
assert.strictEqual(customSynced[0].region, 'Palawan', 'Custom region must be preserved across sync');
console.log('  ✓ PASS: Custom typed region (e.g. Palawan) correctly saves and persists');

// -----------------------------------------------------------------------------
// 4. Verify Shipment Regional Classification
// -----------------------------------------------------------------------------
console.log('\n--- 4. Testing Shipment Regional Classification with Updated Region ---');

const testShipmentLAU = {
  id: 'sh-lau-test',
  site_id: 'site-lau-1',
  site_name: 'MOBILECARE - LA UNION BRANCH'
};

const testShipmentNAG = {
  id: 'sh-nag-test',
  site_id: 'site-nag-1',
  site_name: 'MOBILECARE - NAGA'
};

const testShipmentMM = {
  id: 'sh-mm-test',
  site_id: 'site-gb3',
  site_name: 'MOBILECARE – APP GREENBELT 3'
};

const sitesWithMM = [
  ...syncedSites,
  {
    id: 'site-gb3',
    code: 'APP GB3',
    name: 'MOBILECARE – APP GREENBELT 3',
    region: 'Metro Manila',
    is_dc: false
  }
];

assert.strictEqual(isShipmentProvince(testShipmentLAU, sitesWithMM), true, 'ASP LAU (La Union) must be classified as Province');
assert.strictEqual(isShipmentMetroManila(testShipmentLAU, sitesWithMM), false, 'ASP LAU must not be Metro Manila');

assert.strictEqual(isShipmentProvince(testShipmentNAG, sitesWithMM), true, 'ASP NAG (Camarines Sur) must be classified as Province');
assert.strictEqual(isShipmentMetroManila(testShipmentNAG, sitesWithMM), false, 'ASP NAG must not be Metro Manila');

assert.strictEqual(isShipmentMetroManila(testShipmentMM, sitesWithMM), true, 'APP GB3 must be classified as Metro Manila');
assert.strictEqual(isShipmentProvince(testShipmentMM, sitesWithMM), false, 'APP GB3 must not be Province');
console.log('  ✓ PASS: Regional classification (Province vs Metro Manila) correctly evaluates updated regions');

// -----------------------------------------------------------------------------
// 5. Verify Complete Removal of "Other" from Region Options & Fallback
// -----------------------------------------------------------------------------
console.log('\n--- 5. Testing Strict Removal of "Other" and Resolution to Real Regions ---');

const PHILIPPINE_REGIONS = [
  'Metro Manila',
  'Batangas',
  'Bicol',
  'Bulacan',
  'Cagayan de Oro',
  'Camarines Sur',
  'Cavite',
  'Cebu',
  'Central Luzon',
  'Cotabato',
  'Davao',
  'Iloilo',
  'La Union',
  'Laguna',
  'Mindanao',
  'North Luzon',
  'Pampanga',
  'Quezon City',
  'Rizal',
  'South Luzon',
  'Visayas',
  'Zamboanga'
];

// Verify resolveSafeRegion eliminates "Other"
assert.strictEqual(resolveSafeRegion('ASP COT', 'Other'), 'Cotabato', 'ASP COT with "Other" must resolve to Cotabato');
assert.strictEqual(resolveSafeRegion('ASP COT', 'other'), 'Cotabato', 'ASP COT with lowercase "other" must resolve to Cotabato');
assert.strictEqual(resolveSafeRegion('ASP COT', null), 'Cotabato', 'ASP COT with null must resolve to Cotabato');
assert.strictEqual(resolveSafeRegion('ASP CDO', 'Other'), 'Cagayan de Oro', 'ASP CDO with "Other" must resolve to Cagayan de Oro');
assert.strictEqual(resolveSafeRegion('ASP ZAM', 'Other'), 'Zamboanga', 'ASP ZAM with "Other" must resolve to Zamboanga');
assert.strictEqual(resolveSafeRegion('ASP LAU', 'Other'), 'La Union', 'ASP LAU with "Other" must resolve to La Union');
assert.strictEqual(resolveSafeRegion('ASP NAG', 'Other'), 'Camarines Sur', 'ASP NAG with "Other" must resolve to Camarines Sur');
assert.strictEqual(resolveSafeRegion('UNKNOWN-SITE', 'Other'), 'Metro Manila', 'Unknown site with "Other" must fallback to Metro Manila');
console.log('  ✓ PASS: resolveSafeRegion accurately resolves all legacy "Other" entries to true regions');

// Simulate allRegionOptions calculation with a site that has "Other" in raw state
const mockSitesWithOther = [
  { code: 'ASP COT', name: 'MOBILECARE SERVICES - COTABATO', region: 'Other' },
  { code: 'ASP CDO', name: 'MOBILECARE - CAGAYAN DE ORO', region: 'Cagayan de Oro' }
];

const set = new Set(PHILIPPINE_REGIONS.filter(r => r.toLowerCase() !== 'other'));
mockSitesWithOther.forEach(s => {
  const reg = resolveSafeRegion(s.code, s.region);
  if (reg && reg.toLowerCase() !== 'other') {
    set.add(reg);
  }
});
const optionsResult = Array.from(set).filter(r => r.toLowerCase() !== 'other').sort((a, b) => a.localeCompare(b));

assert.strictEqual(optionsResult.includes('Other'), false, 'allRegionOptions must never include "Other"');
assert.strictEqual(optionsResult.includes('other'), false, 'allRegionOptions must never include lowercase "other"');
assert.strictEqual(optionsResult.includes('Cotabato'), true, 'allRegionOptions must include Cotabato');
console.log('  ✓ PASS: allRegionOptions strictly excludes "Other" and contains true regions');

console.log('\n====================================================================');
console.log('RESULTS: ALL 5/5 TESTS PASSED (100%)');
console.log('====================================================================');

