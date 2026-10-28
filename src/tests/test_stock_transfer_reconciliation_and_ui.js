import fs from 'fs';
import path from 'path';
import assert from 'assert';
import {
  validateFixablyFile,
  parseStockTransferCsv,
  reconcileFixablyMultiFile,
  compactFixablySnapshot,
  hydrateFixablySnapshot
} from '../utils/fixablyInventoryEngine.js';
import {
  syncFixablyTransfersToHistory,
  loadLocalTransferHistory
} from '../services/transferHistoryService.js';
import { resolveSerialFullDetails, searchSerialsWithFullDetails } from '../utils/serialTracker.js';

// Mock localStorage for Node environment
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

function resolveCsvPath(name) {
  const rootPath = path.resolve(process.cwd(), name);
  if (fs.existsSync(rootPath)) return rootPath;
  return path.resolve(process.cwd(), 'xlsx files', name);
}

async function runTests() {
  console.log('=== Running Stock Transfer & Inventory Reconciliation Verification Suite ===\n');

  const transferCsvText = fs.readFileSync(
    resolveCsvPath('_2026 Site Stocks (Fixably) - Stock Transfer.csv'),
    'utf-8'
  );
  const siteStock1Text = fs.readFileSync(
    resolveCsvPath('_2026 Site Stocks (Fixably) - Site Stock.csv'),
    'utf-8'
  );
  // Simulate _2026 Site Stocks (Fixably) - Site Stock (2).csv where F8Y6233C5Y6237KBC was removed from origin BHS
  const siteStock2Text = siteStock1Text
    .split(/\r?\n/)
    .filter(line => !line.includes('F8Y6233C5Y6237KBC'))
    .join('\n');
  const kgbUsedText = fs.readFileSync(
    resolveCsvPath('SIte Stocks (Fixably) - KGB Used.csv'),
    'utf-8'
  );

  // 1. Validate & Parse _2026 Site Stocks (Fixably) - Stock Transfer.csv
  console.log('Test 1: Validating & parsing _2026 Site Stocks (Fixably) - Stock Transfer.csv...');
  const validation = await validateFixablyFile(transferCsvText, 'stock_transfer');
  assert.strictEqual(validation.valid, true, 'Stock transfer file must pass validation');
  assert.strictEqual(validation.rowCount, 3409, 'Must identify 3,409 total data rows');
  assert.strictEqual(validation.validationDetails.validRows, 3404, 'Must identify 3,404 valid serialized transfer records');
  assert.strictEqual(validation.validationDetails.siteToSiteCount, 178, 'Must identify 178 site-to-site transfers');
  assert.strictEqual(validation.validationDetails.missingFieldsCount, 4, 'Must identify 4 rows with missing serials');
  assert.strictEqual(validation.validationDetails.duplicateCount, 1, 'Must identify 1 duplicate row');

  const parsedTr = await parseStockTransferCsv(transferCsvText);
  assert.strictEqual(parsedTr.success, true);
  const targetChain = parsedTr.serialTransferMap.get('F8Y6233C5Y6237KBC');
  assert.ok(targetChain, 'F8Y6233C5Y6237KBC must exist in serialTransferMap');
  assert.deepStrictEqual(targetChain.movementHistory, ['DC', 'BHS', 'POD']);
  assert.strictEqual(targetChain.movementTrail, 'DC → BHS → POD');
  assert.strictEqual(targetChain.currentOwner, 'POD_MSPI-OWNED');
  assert.strictEqual(targetChain.transferCount, 2);
  assert.strictEqual(targetChain.siteToSiteCount, 1);
  assert.strictEqual(targetChain.latestTransfer.fromStock, 'BHS_MSPI-Owned');
  assert.strictEqual(targetChain.latestTransfer.toStock, 'POD_MSPI-Owned');
  assert.strictEqual(targetChain.latestTransfer.fromSiteCode, 'BHS');
  assert.strictEqual(targetChain.latestTransfer.toSiteCode, 'POD');
  assert.strictEqual(targetChain.latestTransfer.receivedDate, '2026-10-27');
  console.log('  ✓ Passed Test 1: BHS -> POD transfer parsed with distinct From/To columns and full chain DC → BHS → POD');

  // 2. Duplicate & Missing Field Validation Check
  console.log('Test 2: Testing duplicate and missing field detection on Stock Transfer CSV...');
  const duplicateSample = [
    'Received Date,From Stock,To Stock,Product Code,Product Name,Quantity,Serial Number,IMEI,Transfer Value',
    '10/27/26,BHS_MSPI-Owned,POD_MSPI-Owned,661-30394,"Battery, iPhone 14 Plus",1,F8Y6233C5Y6237KBC,,99',
    '10/27/26,BHS_MSPI-Owned,POD_MSPI-Owned,661-30394,"Battery, iPhone 14 Plus",1,F8Y6233C5Y6237KBC,,99',
    '10/27/26,BHS_MSPI-Owned,POD_MSPI-Owned,661-30394,"Battery, iPhone 14 Plus",1,,,99'
  ].join('\n');
  const dupRes = await parseStockTransferCsv(duplicateSample);
  assert.strictEqual(dupRes.success, true);
  assert.strictEqual(dupRes.validRows, 1, 'Duplicate row and missing-serial row must be filtered out');
  assert.strictEqual(dupRes.validation.duplicateCount, 1, 'Must flag 1 duplicate transfer');
  assert.strictEqual(dupRes.validation.missingFieldsCount, 1, 'Must flag 1 missing field row');
  console.log('  ✓ Passed Test 2: Duplicate and missing-field rows detected and deduplicated');

  // 3. Reconcile Case A: Site Stock.csv + Stock Transfer.csv (Relocation from BHS to POD)
  console.log('Test 3: Reconciling Site Stock.csv + Stock Transfer.csv (Case A: Relocation)...');
  const recA = await reconcileFixablyMultiFile({
    siteStockContent: siteStock1Text,
    kgbUsedContent: kgbUsedText,
    stockTransferContent: transferCsvText,
    options: { currentDate: new Date('2026-10-28T00:00:00Z'), expandQuantity: true }
  });
  assert.strictEqual(recA.success, true);
  const unitA = recA.items.find(i => i.serialNumber === 'F8Y6233C5Y6237KBC');
  assert.ok(unitA, 'F8Y6233C5Y6237KBC must be present in reconciled inventory (Case A)');
  assert.strictEqual(unitA.cleanSiteCode, 'POD', 'Unit must be relocated to POD');
  assert.strictEqual(unitA.previousSiteCode, 'BHS', 'Unit must track previousSiteCode BHS');
  assert.strictEqual(unitA.lastReceivedDate, '2026-10-27', 'Unit lastReceivedDate must update to 2026-10-27');
  assert.strictEqual(unitA.currentOwner, 'POD_MSPI-OWNED');
  assert.strictEqual(unitA.movementTrail, 'DC → BHS → POD');
  assert.strictEqual(unitA.relocatedByTransfer, true);
  console.log('  ✓ Passed Test 3: F8Y6233C5Y6237KBC automatically relocated from BHS (2026-07-04) to POD (2026-10-27)');

  // 4. Reconcile Case B: Site Stock (2).csv + Stock Transfer.csv (Synthesis when removed from origin branch)
  console.log('Test 4: Reconciling Site Stock (2).csv + Stock Transfer.csv (Case B: Post-cutoff transfer synthesis)...');
  const recB = await reconcileFixablyMultiFile({
    siteStockContent: siteStock2Text,
    kgbUsedContent: kgbUsedText,
    stockTransferContent: transferCsvText,
    options: { currentDate: new Date('2026-10-28T00:00:00Z'), expandQuantity: true }
  });
  assert.strictEqual(recB.success, true);
  const unitB = recB.items.find(i => i.serialNumber === 'F8Y6233C5Y6237KBC');
  assert.ok(unitB, 'F8Y6233C5Y6237KBC must be synthesized at POD when missing from Site Stock (2).csv');
  assert.strictEqual(unitB.cleanSiteCode, 'POD');
  assert.strictEqual(unitB.lastReceivedDate, '2026-10-27');
  assert.strictEqual(unitB.currentOwner, 'POD_MSPI-OWNED');
  assert.strictEqual(unitB.movementTrail, 'DC → BHS → POD');
  assert.strictEqual(unitB.synthesizedFromTransfer, true);
  console.log('  ✓ Passed Test 4: F8Y6233C5Y6237KBC synthesized at POD (2026-10-27) when Site Stock (2).csv is used');

  // 5. Compact & Hydrate Snapshot Preservation
  console.log('Test 5: Verifying compactFixablySnapshot & hydrateFixablySnapshot preserve transfer records...');
  const compacted = compactFixablySnapshot(recA);
  const hydrated = hydrateFixablySnapshot(compacted, []);
  assert.strictEqual(hydrated.siteToSiteTransfers.length, 178, 'Hydrated snapshot must preserve 178 siteToSiteTransfers');
  const hydratedUnit = hydrated.items.find(i => i.serialNumber === 'F8Y6233C5Y6237KBC');
  assert.ok(hydratedUnit);
  assert.strictEqual(hydratedUnit.cleanSiteCode, 'POD');
  assert.strictEqual(hydratedUnit.movementTrail, 'DC → BHS → POD');
  assert.strictEqual(hydratedUnit.currentOwner, 'POD_MSPI-OWNED');
  console.log('  ✓ Passed Test 5: Compact & Hydrate preserve all transfer records and item movement metadata');

  // 6. Transfer History Sync & Serial Tracker Resolution (CommandPalette & SerialDossierModal)
  console.log('Test 6: Verifying syncFixablyTransfersToHistory & resolveSerialFullDetails override stale BHS unit...');
  await syncFixablyTransfersToHistory(recA.transfers, 'test@mobilecare.ph');
  const storedHistory = loadLocalTransferHistory();
  assert.ok(storedHistory.length > 0, 'Transfer history must be populated');

  const staleInventoryUnits = [
    {
      id: 'stale-bhs-unit',
      serial_number: 'F8Y6233C5Y6237KBC',
      part_number: '661-30394',
      description: 'Battery, iPhone 14 Plus',
      site_code: 'APP BHS',
      status: 'VALID',
      lifecycle_status: 'in_stock',
      scan_timestamp: '2026-07-04T00:00:00.000Z'
    }
  ];

  const resolved = resolveSerialFullDetails('F8Y6233C5Y6237KBC', {
    inventoryUnits: staleInventoryUnits,
    fixablyItems: recA.items,
    sites: [
      { id: 1, code: 'APP BHS', name: 'BONIFACIO HIGH STREET' },
      { id: 2, code: 'ASP POD', name: 'MOBILECARE - THE PODIUM' }
    ],
    parts: []
  });

  assert.ok(resolved, 'resolveSerialFullDetails must return details for F8Y6233C5Y6237KBC');
  assert.strictEqual(resolved.siteCode, 'ASP POD', 'Must resolve to destination branch ASP POD');
  assert.strictEqual(resolved.siteName, 'MOBILECARE - THE PODIUM', 'Must resolve to MOBILECARE - THE PODIUM');
  assert.strictEqual(resolved.siteArrivalFormatted, '2026-10-27', 'Must show arrival date 2026-10-27');
  assert.strictEqual(resolved.currentOwner, 'POD_MSPI-OWNED', 'Must show currentOwner POD_MSPI-OWNED');
  assert.strictEqual(resolved.movementTrail, 'DC → BHS → POD', 'Must show movementTrail DC → BHS → POD');
  assert.strictEqual(resolved.transferCount, 2, 'Must show 2 transfers');
  assert.strictEqual(resolved.statusBadgeLabel, 'In Stock at MOBILECARE - THE PODIUM');
  console.log('  ✓ Passed Test 6: resolveSerialFullDetails resolves F8Y6233C5Y6237KBC to POD (2026-10-27, 2 transfers)');

  // 7. Test 7: Main Search Bar (searchSerialsWithFullDetails) & resolveSerialFullDetails for historical transfer serial F8Y6272C2QP18FKBK
  console.log('Test 7: Main Search Bar consistency for transfer-ledger serial F8Y6272C2QP18FKBK (VER -> MAG)...');
  const searchResults = searchSerialsWithFullDetails('F8Y6272C2QP18FKBK', {
    inventoryUnits: [],
    shipments: [],
    repairUsageRecords: [],
    sites: [
      { id: 10, code: 'ASP VER', name: 'MOBILECARE - VERTIS NORTH' },
      { id: 11, code: 'APP MAG', name: 'MOBILECARE - APP MAGNOLIA' }
    ],
    parts: [],
    fixablyItems: recA.items,
    fixablyTransfers: recA.transfers
  }, 8);

  assert.strictEqual(searchResults.length, 1, 'searchSerialsWithFullDetails must find F8Y6272C2QP18FKBK');
  const f8yDetails = searchResults[0];
  assert.strictEqual(f8yDetails.serialNumber, 'F8Y6272C2QP18FKBK');
  assert.strictEqual(f8yDetails.partNumber, '661-21991', 'Must resolve partNumber 661-21991');
  assert.ok(f8yDetails.description.includes('Battery, iPhone 13'), 'Must resolve description Battery, iPhone 13');
  assert.strictEqual(f8yDetails.movementTrail, 'VER → MAG', 'Must resolve movementTrail VER → MAG');
  assert.strictEqual(f8yDetails.currentOwner, 'MAG_MSPI-OWNED', 'Must resolve currentOwner MAG_MSPI-OWNED');
  assert.strictEqual(f8yDetails.siteArrivalFormatted, '2026-09-30', 'Must resolve transfer received date 2026-09-30');
  assert.strictEqual(f8yDetails.siteName, 'MOBILECARE - APP MAGNOLIA', 'Must resolve destination site MOBILECARE - APP MAGNOLIA');
  assert.strictEqual(f8yDetails.isHistoricalTransfer, true, 'Must mark as historical/consumed transfer');

  // Also verify fallback resolution when caller omits fixablyTransfers (relies on synced transfer history)
  const fallbackSearch = searchSerialsWithFullDetails('F8Y6272C2QP18FKBK', {
    inventoryUnits: [],
    shipments: [],
    repairUsageRecords: [],
    sites: [
      { id: 10, code: 'ASP VER', name: 'MOBILECARE - VERTIS NORTH' },
      { id: 11, code: 'APP MAG', name: 'MOBILECARE - APP MAGNOLIA' }
    ],
    parts: [],
    fixablyItems: recA.items
  }, 8);
  assert.strictEqual(fallbackSearch.length, 1, 'Fallback search via localTransferHistory must also find F8Y6272C2QP18FKBK');
  assert.strictEqual(fallbackSearch[0].movementTrail, 'VER → MAG');
  console.log('  ✓ Passed Test 7: searchSerialsWithFullDetails & resolveSerialFullDetails consistently return F8Y6272C2QP18FKBK (VER → MAG, 661-21991)');

  console.log('\n=== ALL 7 STOCK TRANSFER & INVENTORY VERIFICATION TESTS PASSED 100%! ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
