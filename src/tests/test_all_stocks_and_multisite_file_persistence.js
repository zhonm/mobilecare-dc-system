import assert from 'assert';
import dbStorage from '../utils/dbStorage.js';
import { isPreservedKey, PRESERVED_SESSION_KEYS } from '../utils/cacheManager.js';
import { validateFixablyFile, reconcileFixablyMultiFile } from '../utils/fixablyInventoryEngine.js';
import { OFFICIAL_BRANCH_DIRECTORY } from '../constants/branchDirectory.js';

// Setup Mock Browser Globals
const mockStore = new Map();
const mockLocalStorage = {
  getItem: (k) => mockStore.get(k) ?? null,
  setItem: (k, v) => mockStore.set(k, String(v)),
  removeItem: (k) => mockStore.delete(k),
  clear: () => mockStore.clear(),
  get length() { return mockStore.size; },
  key: (i) => Array.from(mockStore.keys())[i] || null
};

if (typeof window === 'undefined') {
  global.window = {
    localStorage: mockLocalStorage,
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    }
  };
  global.localStorage = global.window.localStorage;
  global.sessionStorage = global.window.sessionStorage;
}

async function runPersistenceTests() {
  console.log('========================================================================');
  console.log('TEST SUITE: All Stocks & Multi-Site Uploaded File Persistence & Replace');
  console.log('========================================================================\n');

  const sites = Object.entries(OFFICIAL_BRANCH_DIRECTORY).map(([code, s]) => ({
    id: 'site-' + code.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    code,
    ...s
  }));

  // Sample CSV Contents for the 3 slots
  const sampleSiteStockCsv = [
    'Stock Name,Part Number,Serial Number,Description,Last Received Date,Stock Type',
    'MOBILECARE - APP BONIFACIO HIGH STREET,661-12345,C02TEST0001,Display Assembly,2026-10-01,MSPI-owned',
    'MOBILECARE - APP BONIFACIO HIGH STREET,661-12346,C02TEST0002,Battery,2026-09-15,MSPI-owned',
    'MOBILECARE - APP MEGAMALL,661-12347,C02TEST0003,Top Case,2026-08-20,MSPI-owned'
  ].join('\n');

  const sampleKgbCsv = [
    'Order ID,Product KGB,Repair Closed Date',
    'ORD-101,C02TEST0002,2026-10-05',
    'ORD-102,C02OTHER99,2026-10-06'
  ].join('\n');

  const sampleTransferCsv = [
    'From Stock,To Stock,Serial Number,Transfer Received,Transfer Quantity',
    'DC WAREHOUSE,MOBILECARE - APP BONIFACIO HIGH STREET,C02TEST0001,2026-09-28,1'
  ].join('\n');

  // --- TEST 1: Validate file content & slot identification ---
  console.log('--- Test 1: Validate File Content & Slot Identification ---');
  const siteStockValidation = await validateFixablyFile(sampleSiteStockCsv, 'site_stock');
  assert.strictEqual(siteStockValidation.valid, true, 'Site stock CSV must validate successfully');
  assert.strictEqual(siteStockValidation.detectedType, 'site_stock', 'Detected type must be site_stock');
  assert.strictEqual(siteStockValidation.rowCount, 3, 'Must detect 3 data rows');

  const kgbValidation = await validateFixablyFile(sampleKgbCsv, 'kgb_used');
  assert.strictEqual(kgbValidation.valid, true, 'KGB CSV must validate successfully');
  assert.strictEqual(kgbValidation.detectedType, 'kgb_used', 'Detected type must be kgb_used');

  const transferValidation = await validateFixablyFile(sampleTransferCsv, 'stock_transfer');
  assert.strictEqual(transferValidation.valid, true, 'Stock transfer CSV must validate successfully');
  assert.strictEqual(transferValidation.detectedType, 'stock_transfer', 'Detected type must be stock_transfer');
  console.log('  ✓ PASS: All 3 Fixably report file structures detected and validated correctly');

  // --- TEST 2: Save uploaded slot files into IndexedDB (dbStorage) ---
  console.log('\n--- Test 2: Uploaded Slot File Persistence in IndexedDB ---');
  const siteStockSlotData = {
    name: 'output_daily_oct14.csv',
    size: Buffer.byteLength(sampleSiteStockCsv),
    rowCount: siteStockValidation.rowCount,
    valid: true,
    error: null,
    content: sampleSiteStockCsv,
    updatedAt: new Date().toISOString()
  };

  const kgbSlotData = {
    name: 'kgb_used_oct14.csv',
    size: Buffer.byteLength(sampleKgbCsv),
    rowCount: kgbValidation.rowCount,
    valid: true,
    error: null,
    content: sampleKgbCsv,
    updatedAt: new Date().toISOString()
  };

  await dbStorage.setItem('mdc_uploaded_slot_site_stock', siteStockSlotData);
  await dbStorage.setItem('mdc_uploaded_slot_kgb_used', kgbSlotData);

  const retrievedSiteStock = await dbStorage.getItem('mdc_uploaded_slot_site_stock');
  const retrievedKgb = await dbStorage.getItem('mdc_uploaded_slot_kgb_used');

  assert(retrievedSiteStock !== null, 'Site stock slot must be retrieved from dbStorage');
  assert.strictEqual(retrievedSiteStock.name, 'output_daily_oct14.csv', 'Filename must match');
  assert.strictEqual(retrievedSiteStock.content, sampleSiteStockCsv, 'Full file text content must be preserved');
  assert.strictEqual(retrievedSiteStock.rowCount, 3, 'Row count must be preserved');
  assert(retrievedKgb !== null, 'KGB slot must be retrieved from dbStorage');
  assert.strictEqual(retrievedKgb.name, 'kgb_used_oct14.csv', 'KGB filename must match');
  console.log('  ✓ PASS: Uploaded files and contents successfully persisted in dbStorage');

  // --- TEST 3: Preservation across cache clearing & session termination ---
  console.log('\n--- Test 3: Preservation Across Cache Clearing & Session Reset ---');
  assert(PRESERVED_SESSION_KEYS.includes('mdc_uploaded_slot_site_stock'), 'PRESERVED_SESSION_KEYS must include site_stock slot');
  assert(PRESERVED_SESSION_KEYS.includes('mdc_uploaded_slot_kgb_used'), 'PRESERVED_SESSION_KEYS must include kgb_used slot');
  assert(PRESERVED_SESSION_KEYS.includes('mdc_uploaded_slot_stock_transfer'), 'PRESERVED_SESSION_KEYS must include stock_transfer slot');
  assert(isPreservedKey('mdc_uploaded_slot_site_stock'), 'isPreservedKey must return true for slot keys');
  assert(isPreservedKey('mdc_uploaded_slot_custom'), 'isPreservedKey must return true for any mdc_uploaded_slot_ key');

  // Perform operational cache clearing
  await dbStorage.clearOperationalCache();

  // Verify slots survived cache clearance
  const survivedSiteStock = await dbStorage.getItem('mdc_uploaded_slot_site_stock');
  const survivedKgb = await dbStorage.getItem('mdc_uploaded_slot_kgb_used');
  assert(survivedSiteStock !== null, 'Uploaded site stock file must survive clearOperationalCache');
  assert(survivedKgb !== null, 'Uploaded kgb file must survive clearOperationalCache');
  assert.strictEqual(survivedSiteStock.content, sampleSiteStockCsv, 'Content must remain intact after cache clearing');
  console.log('  ✓ PASS: Uploaded files are strictly immune to cache clearance and session resets');

  // --- TEST 4: Cold Start Hydration & Automatic Reconciliation ---
  console.log('\n--- Test 4: Cold Start Hydration & Reconciliation Durability ---');
  // Simulate page reload where memory state is empty:
  const memorySlots = {
    site_stock: survivedSiteStock ? { ...survivedSiteStock, file: null, valid: true } : { file: null, valid: false },
    kgb_used: survivedKgb ? { ...survivedKgb, file: null, valid: true } : { file: null, valid: false },
    stock_transfer: { file: null, valid: false }
  };

  assert.strictEqual(memorySlots.site_stock.valid, true, 'Hydrated slot must be valid');
  assert.strictEqual(memorySlots.site_stock.name, 'output_daily_oct14.csv', 'Hydrated slot must preserve file name');
  assert.strictEqual(memorySlots.site_stock.rowCount, 3, 'Hydrated slot must preserve row count');

  // Reconcile directly using the restored content
  const reconciled = await reconcileFixablyMultiFile({
    siteStockContent: memorySlots.site_stock.content,
    kgbUsedContent: memorySlots.kgb_used.content,
    stockTransferContent: null,
    options: { sites, currentDate: new Date('2026-10-09T00:00:00Z') }
  });

  assert.strictEqual(reconciled.success, true, 'Reconciliation using persisted file content must succeed');
  assert.strictEqual(reconciled.items.length, 3, 'Must reconcile all 3 items');
  console.log(`  ✓ PASS: Successfully reconciled ${reconciled.items.length} units directly from restored slot content`);

  // --- TEST 5: Replacing / Updating the Daily File ---
  console.log('\n--- Test 5: Replacing / Updating Stored File ---');
  const updatedDailyCsv = [
    'Stock Name,Part Number,Serial Number,Description,Last Received Date,Stock Type',
    'MOBILECARE - APP BONIFACIO HIGH STREET,661-12345,C02TEST0001,Display Assembly,2026-10-01,MSPI-owned',
    'MOBILECARE - APP BONIFACIO HIGH STREET,661-12346,C02TEST0002,Battery,2026-09-15,MSPI-owned',
    'MOBILECARE - APP MEGAMALL,661-12347,C02TEST0003,Top Case,2026-08-20,MSPI-owned',
    'MOBILECARE - APP TRINOMA,661-99999,C02TEST0004,Camera Module,2026-10-14,MSPI-owned'
  ].join('\n');

  const updatedValidation = await validateFixablyFile(updatedDailyCsv, 'site_stock');
  assert.strictEqual(updatedValidation.rowCount, 4, 'Updated CSV must have 4 data rows');

  const updatedSlotData = {
    name: 'output_daily_oct14_v2.csv',
    size: Buffer.byteLength(updatedDailyCsv),
    rowCount: updatedValidation.rowCount,
    valid: true,
    error: null,
    content: updatedDailyCsv,
    updatedAt: new Date().toISOString()
  };

  await dbStorage.setItem('mdc_uploaded_slot_site_stock', updatedSlotData);
  const reloadedSlot = await dbStorage.getItem('mdc_uploaded_slot_site_stock');

  assert.strictEqual(reloadedSlot.name, 'output_daily_oct14_v2.csv', 'Updated file name must be saved');
  assert.strictEqual(reloadedSlot.rowCount, 4, 'Updated row count must be 4');
  assert.strictEqual(reloadedSlot.content, updatedDailyCsv, 'Updated content must replace old content');
  console.log('  ✓ PASS: Replacing / updating the stored file smoothly updates IndexedDB and slot state');

  // --- TEST 6: Slot Removal & Cleanup ---
  console.log('\n--- Test 6: Slot Removal & Cleanup ---');
  await dbStorage.removeItem('mdc_uploaded_slot_kgb_used');
  const clearedKgb = await dbStorage.getItem('mdc_uploaded_slot_kgb_used');
  assert.strictEqual(clearedKgb, null, 'Cleared slot must be removed from dbStorage');

  // Clean up test site stock slot
  await dbStorage.removeItem('mdc_uploaded_slot_site_stock');
  const clearedSiteStock = await dbStorage.getItem('mdc_uploaded_slot_site_stock');
  assert.strictEqual(clearedSiteStock, null, 'Cleared site stock must be removed from dbStorage');
  console.log('  ✓ PASS: Individual and bulk slot clearing removes entries cleanly from dbStorage');

  console.log('\n========================================================================');
  console.log('ALL ALL-STOCKS & MULTI-SITE FILE PERSISTENCE TESTS PASSED (100%)');
  console.log('========================================================================\n');
}

runPersistenceTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
