import assert from 'assert';
import {
  OWNERSHIP_TAG_CATEGORIES,
  getOwnershipTagCategoryMeta,
  ensureOwnershipTagIds,
  validateAndReceiveOrderLine,
  updateToolAssetMetadata
} from '../utils/consumablesToolsEngine.js';

console.log('========================================================================');
console.log('TEST SUITE: System-Generated Ownership Tags & Per-Site Sequencing');
console.log('========================================================================\n');

// --- Test 1: Ownership category prefix resolution ---
console.log('--- Test 1: Ownership category prefixes ---');
assert.strictEqual(getOwnershipTagCategoryMeta('Apple-Owned').prefix, 'APPLE');
assert.strictEqual(getOwnershipTagCategoryMeta('MobileCare-Owned').prefix, 'MCARE');
assert.strictEqual(getOwnershipTagCategoryMeta('Mobicare-Owned').prefix, 'MCARE');
assert.strictEqual(getOwnershipTagCategoryMeta('Cable / Admin-Tagged').prefix, 'ADMIN');
assert.strictEqual(getOwnershipTagCategoryMeta('Vendor-Loaned').prefix, 'VENDR');
assert.strictEqual(getOwnershipTagCategoryMeta('DC-Shared').prefix, 'DCSHR');
assert(OWNERSHIP_TAG_CATEGORIES.length >= 5, 'Must define at least 5 ownership categories');
console.log('  ✓ PASS: All ownership categories map to clean, consistent prefixes');

// --- Test 2: Multi-unit receiving of same part number at same site gets 01, 02, 03 ---
console.log('\n--- Test 2: Multiple units of same part number at one site get 01, 02, 03 sequence ---');
const catalogItems = [
  {
    id: 'cat-duo',
    part_number: '077-01158',
    description: 'SVC, IPHONE DUO, KIT, CVLO FIXTURE',
    item_kind: 'tool',
    ownership_tag: 'Apple-Owned',
    is_serialized: false
  }
];

const recvRes = validateAndReceiveOrderLine({
  order: null,
  partNumber: '077-01158',
  deliveredQty: 3,
  scannedSerials: [],
  siteCode: 'APP RM',
  catalogItems,
  stockRows: [],
  toolAssets: [],
  actorName: 'Test Admin',
  allowAdHoc: true
});

assert.strictEqual(recvRes.ok, true, 'Receiving 3 tool units must succeed');
assert.strictEqual(recvRes.newToolAssets.length, 3, 'Must create 3 tool assets');

const tagIds = recvRes.newToolAssets.map(a => a.ownership_tag_id);
console.log('  Generated tags at APP RM:', tagIds.join(', '));
assert(/^APPLE-07701158-01-[23456789A-HJ-NP-Z]{4}$/.test(tagIds[0]), `Tag 1 format mismatch: ${tagIds[0]}`);
assert(/^APPLE-07701158-02-[23456789A-HJ-NP-Z]{4}$/.test(tagIds[1]), `Tag 2 format mismatch: ${tagIds[1]}`);
assert(/^APPLE-07701158-03-[23456789A-HJ-NP-Z]{4}$/.test(tagIds[2]), `Tag 3 format mismatch: ${tagIds[2]}`);
assert.strictEqual(new Set(tagIds).size, 3, 'All 3 generated ownership tag IDs must be globally unique');
console.log('  ✓ PASS: Same part number at same site received unique tags with 01, 02, 03 sequencing');

// --- Test 3: Same part number at a different site starts fresh per-site sequence 01 with unique UID ---
console.log('\n--- Test 3: Same part number at another site gets its own 01 sequence and unique UID ---');
const recvSite2 = validateAndReceiveOrderLine({
  order: null,
  partNumber: '077-01158',
  deliveredQty: 2,
  scannedSerials: [],
  siteCode: 'ASP ABR',
  catalogItems,
  stockRows: recvRes.nextStockRows,
  toolAssets: recvRes.nextToolAssets,
  actorName: 'Test Admin',
  allowAdHoc: true
});
const site2Tags = recvSite2.newToolAssets.map(a => a.ownership_tag_id);
console.log('  Generated tags at ASP ABR:', site2Tags.join(', '));
assert(/^APPLE-07701158-01-[23456789A-HJ-NP-Z]{4}$/.test(site2Tags[0]), `Site 2 Tag 1 mismatch: ${site2Tags[0]}`);
assert(/^APPLE-07701158-02-[23456789A-HJ-NP-Z]{4}$/.test(site2Tags[1]), `Site 2 Tag 2 mismatch: ${site2Tags[1]}`);
assert.strictEqual(new Set([...tagIds, ...site2Tags]).size, 5, 'All 5 tags across both sites must be globally unique');
console.log('  ✓ PASS: Per-site sequencing and global uniqueness verified across multiple sites');

// --- Test 4: Changing ownership category updates tag prefix while preserving sequence ---
console.log('\n--- Test 4: Updating ownership category regenerates tag with new prefix ---');
const targetAsset = recvRes.newToolAssets[1]; // seq 02
const editRes = updateToolAssetMetadata({
  toolAssets: recvRes.nextToolAssets,
  assetId: targetAsset.id,
  ownershipTag: 'MobileCare-Owned',
  actorName: 'Test Admin'
});
assert.strictEqual(editRes.ok, true);
assert.strictEqual(editRes.updatedAsset.ownership_tag, 'MobileCare-Owned');
assert(
  /^MCARE-07701158-02-[23456789A-HJ-NP-Z]{4}$/.test(editRes.updatedAsset.ownership_tag_id),
  `Expected MCARE prefix with seq 02, got: ${editRes.updatedAsset.ownership_tag_id}`
);
console.log(`  Updated tag: ${targetAsset.ownership_tag_id} -> ${editRes.updatedAsset.ownership_tag_id}`);
console.log('  ✓ PASS: Ownership category update cleanly regenerates tag ID with MCARE prefix');

// --- Test 5: Backfilling legacy records without ownership_tag_id ---
console.log('\n--- Test 5: Backfill legacy records without ownership_tag_id ---');
const legacyRecords = [
  { id: 'leg-1', part_number: '077-01158', site_code: 'APP MEG', ownership_tag: 'Apple-Owned' },
  { id: 'leg-2', part_number: '077-01158', site_code: 'APP MEG', ownership_tag: 'Apple-Owned' },
  { id: 'leg-3', part_number: '077-01158', site_code: 'APP MEG', ownership_tag: 'Vendor-Loaned' }
];
const backfilled = ensureOwnershipTagIds(legacyRecords);
assert(/^APPLE-07701158-01-[23456789A-HJ-NP-Z]{4}$/.test(backfilled[0].ownership_tag_id));
assert(/^APPLE-07701158-02-[23456789A-HJ-NP-Z]{4}$/.test(backfilled[1].ownership_tag_id));
assert(/^VENDR-07701158-03-[23456789A-HJ-NP-Z]{4}$/.test(backfilled[2].ownership_tag_id));
assert.strictEqual(new Set(backfilled.map(r => r.ownership_tag_id)).size, 3);
console.log('  ✓ PASS: Legacy records backfilled with sequential unique ownership tag IDs');

console.log('\n========================================================================');
console.log('ALL OWNERSHIP TAG GENERATION TESTS PASSED (100%)');
console.log('========================================================================\n');
