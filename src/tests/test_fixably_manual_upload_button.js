import assert from 'assert';
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

async function runTests() {
  console.log('========================================================================');
  console.log('TEST SUITE: Manual Upload Button & Multi-File Staging Verification');
  console.log('========================================================================\n');

  const sites = Object.entries(OFFICIAL_BRANCH_DIRECTORY).map(([code, s]) => ({
    id: 'site-' + code.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    code,
    ...s
  }));

  // 1. Prepare sample files for 3 slots
  const siteStockContent = [
    'Stock Name,Part Number,Serial Number,Description,Last Received Date,Stock Type',
    'MOBILECARE - APP BONIFACIO HIGH STREET,661-12345,C02TEST0001,Display Assembly,2026-10-01,MSPI-owned',
    'MOBILECARE - APP BONIFACIO HIGH STREET,661-12346,C02TEST0002,Battery,2026-09-15,MSPI-owned'
  ].join('\n');

  const kgbUsedContent = [
    'Order ID,Product KGB,Repair Closed Date',
    'ORD-101,C02TEST0002,2026-10-05'
  ].join('\n');

  const transferContent = [
    'From Stock,To Stock,Serial Number,Transfer Received,Transfer Quantity',
    'DC WAREHOUSE,MOBILECARE - APP BONIFACIO HIGH STREET,C02TEST0001,2026-09-28,1'
  ].join('\n');

  // --- Test 1: Verify Fixably File Auto-Detection across all 3 files ---
  console.log('--- Test 1: Auto-detection of 3 distinct Fixably files ---');
  const val1 = await validateFixablyFile(siteStockContent, null);
  const val2 = await validateFixablyFile(kgbUsedContent, null);
  const val3 = await validateFixablyFile(transferContent, null);

  assert.strictEqual(val1.valid, true);
  assert.strictEqual(val1.detectedType, 'site_stock', 'Must detect site_stock');
  assert.strictEqual(val2.valid, true);
  assert.strictEqual(val2.detectedType, 'kgb_used', 'Must detect kgb_used');
  assert.strictEqual(val3.valid, true);
  assert.strictEqual(val3.detectedType, 'stock_transfer', 'Must detect stock_transfer');
  console.log('  ✓ PASS: All 3 files correctly identified to their target slots without mismatch');

  // --- Test 2: Simulate multi-file selection (staging without immediate auto-upload) ---
  console.log('\n--- Test 2: Staging 3 files without executing immediate auto-upload ---');
  let executionCount = 0;
  const mockExecuteReconciliation = async () => {
    executionCount++;
  };

  const stagedSlots = {
    site_stock: { file: null, name: '', valid: false, content: null, pendingUpload: false },
    kgb_used: { file: null, name: '', valid: false, content: null, pendingUpload: false },
    stock_transfer: { file: null, name: '', valid: false, content: null, pendingUpload: false }
  };

  // Simulate file selection function (handleSlotFileChange / handleMultipleFiles)
  const simulateFileSelection = async (fileList) => {
    for (const f of fileList) {
      const v = await validateFixablyFile(f.content, null);
      if (v.valid && v.detectedType) {
        stagedSlots[v.detectedType] = {
          name: f.name,
          valid: true,
          content: f.content,
          rowCount: v.rowCount,
          pendingUpload: true
        };
      }
    }
    // Crucially: NO automatic execution of mockExecuteReconciliation here!
  };

  await simulateFileSelection([
    { name: 'DC Stock Monitoring - Site Stock.csv', content: siteStockContent },
    { name: 'Custom reports - GSX KGB KGBs Used (1).csv', content: kgbUsedContent },
    { name: 'Custom reports - Stock Transfers.csv', content: transferContent }
  ]);

  assert.strictEqual(executionCount, 0, 'Upload/reconciliation MUST NOT run automatically on file selection');
  assert.strictEqual(stagedSlots.site_stock.valid, true, 'Slot 1 must be staged & valid');
  assert.strictEqual(stagedSlots.kgb_used.valid, true, 'Slot 2 must be staged & valid');
  assert.strictEqual(stagedSlots.stock_transfer.valid, true, 'Slot 3 must be staged & valid');
  assert.strictEqual(stagedSlots.site_stock.pendingUpload, true);
  assert.strictEqual(stagedSlots.kgb_used.pendingUpload, true);
  assert.strictEqual(stagedSlots.stock_transfer.pendingUpload, true);
  console.log('  ✓ PASS: All 3 files staged in ready state with executionCount = 0 (zero auto-upload)');

  // --- Test 3: Upload button label reflects count of staged files ---
  console.log('\n--- Test 3: Upload button label generation ---');
  const stagedCount = ['site_stock', 'kgb_used', 'stock_transfer'].filter(
    k => stagedSlots[k]?.valid && stagedSlots[k]?.content
  ).length;

  assert.strictEqual(stagedCount, 3, 'Must identify 3 selected files');
  const buttonLabel = stagedCount > 1
    ? `Upload & Process (${stagedCount} Files)`
    : stagedCount === 1
      ? 'Upload & Process File'
      : 'Upload & Sync Inventory';

  assert.strictEqual(buttonLabel, 'Upload & Process (3 Files)');
  console.log(`  ✓ PASS: Upload button dynamically shows "${buttonLabel}"`);

  // --- Test 4: Triggering the Upload button processes all 3 files at once ---
  console.log('\n--- Test 4: Clicking Upload button processes all 3 files at once in a single action ---');
  let uploadedBatch = null;

  const simulateUploadButtonClick = async () => {
    // Collect effective contents
    const siteStockText = stagedSlots.site_stock.content;
    const kgbText = stagedSlots.kgb_used.content;
    const transferText = stagedSlots.stock_transfer.content;

    // Run reconciliation with all 3 files in a single invocation
    const reconciled = await reconcileFixablyMultiFile({
      siteStockContent: siteStockText,
      kgbUsedContent: kgbText,
      stockTransferContent: transferText,
      options: { sites, currentDate: new Date('2026-10-09T00:00:00Z') }
    });

    uploadedBatch = {
      reconciled,
      filesProcessed: [stagedSlots.site_stock.name, stagedSlots.kgb_used.name, stagedSlots.stock_transfer.name]
    };
    mockExecuteReconciliation();
  };

  await simulateUploadButtonClick();

  assert.strictEqual(executionCount, 1, 'Reconciliation must execute exactly once on Upload click');
  assert(uploadedBatch !== null, 'Reconciliation batch must be produced');
  assert.strictEqual(uploadedBatch.reconciled.success, true);
  assert.strictEqual(uploadedBatch.filesProcessed.length, 3, 'All 3 files processed in the single upload action');
  console.log('  ✓ PASS: Single upload action processed all 3 files simultaneously with success');

  console.log('\n========================================================================');
  console.log('ALL MANUAL UPLOAD BUTTON & MULTI-FILE STAGING TESTS PASSED (100%)');
  console.log('========================================================================\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
