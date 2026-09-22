import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Saved Period Records Removal & Pre-Deletion XLSX Export');
console.log('========================================================================');

let passedTests = 0;
async function it(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ----------------------------------------------------
// 1. Physical Component and Constants Removal
// ----------------------------------------------------
console.log('\n--- 1. Removed File Verification ---');

await it('SavedRecords.jsx has been deleted', () => {
  const file = path.join(projectRoot, 'src/components/SavedRecords.jsx');
  assert.strictEqual(fs.existsSync(file), false, 'SavedRecords.jsx must not exist');
});

await it('SaveRecordModal.jsx has been deleted', () => {
  const file = path.join(projectRoot, 'src/components/SaveRecordModal.jsx');
  assert.strictEqual(fs.existsSync(file), false, 'SaveRecordModal.jsx must not exist');
});

await it('initialSavedRecords.js has been deleted', () => {
  const file = path.join(projectRoot, 'src/constants/initialSavedRecords.js');
  assert.strictEqual(fs.existsSync(file), false, 'initialSavedRecords.js must not exist');
});

// ----------------------------------------------------
// 2. Navigation and Role Configuration Cleanliness
// ----------------------------------------------------
console.log('\n--- 2. Navigation and Roles Cleanliness ---');

await it('navigation.js has no "records" route or page', async () => {
  const navModule = await import('../constants/navigation.js');
  assert.strictEqual(navModule.ALL_PAGES.includes('records'), false, 'ALL_PAGES must not contain "records"');
  assert.strictEqual('records' in navModule.PAGE_TITLES, false, 'PAGE_TITLES must not contain "records"');
});

await it('roles.js has no "records" permission in any role', async () => {
  const rolesModule = await import('../constants/roles.js');
  const presets = rolesModule.ROLE_PRESETS;
  for (const [roleName, pages] of Object.entries(presets)) {
    assert.strictEqual(
      pages.includes('records'),
      false,
      `Role ${roleName} must not contain "records" permission`
    );
  }
});

await it('Sidebar.jsx and Header.jsx do not render "records" navigation', () => {
  const sidebarContent = fs.readFileSync(path.join(projectRoot, 'src/components/Sidebar.jsx'), 'utf-8');
  assert.strictEqual(sidebarContent.includes("id: 'records'"), false, 'Sidebar must not contain "records" item');

  const headerContent = fs.readFileSync(path.join(projectRoot, 'src/components/Header.jsx'), 'utf-8');
  assert.strictEqual(headerContent.includes("tabConfig['records']"), false, 'Header must not contain "records" tabConfig');
});

await it('App.jsx does not import SavedRecords or route to "records"', () => {
  const appContent = fs.readFileSync(path.join(projectRoot, 'src/App.jsx'), 'utf-8');
  assert.strictEqual(appContent.includes('SavedRecords'), false, 'App.jsx must not import or render SavedRecords');
  assert.strictEqual(appContent.includes("case 'records':"), false, 'App.jsx must not have case "records"');
});

// ----------------------------------------------------
// 3. Operational Pages (Forecasting & Allocation) Cleanliness
// ----------------------------------------------------
console.log('\n--- 3. Operational Pages Cleanliness ---');

await it('Forecasting.jsx has no Save Record modal or trigger', () => {
  const forecastingContent = fs.readFileSync(path.join(projectRoot, 'src/components/Forecasting.jsx'), 'utf-8');
  assert.strictEqual(forecastingContent.includes('SaveRecordModal'), false, 'Forecasting.jsx must not import SaveRecordModal');
  assert.strictEqual(forecastingContent.includes('Save Period Record'), false, 'Forecasting.jsx must not have "Save Period Record" button');
  assert.strictEqual(forecastingContent.includes('showSaveModal'), false, 'Forecasting.jsx must not retain showSaveModal state');
});

await it('AllocationMatrix.jsx has no Save Record modal or trigger', () => {
  const allocContent = fs.readFileSync(path.join(projectRoot, 'src/components/AllocationMatrix.jsx'), 'utf-8');
  assert.strictEqual(allocContent.includes('SaveRecordModal'), false, 'AllocationMatrix.jsx must not import SaveRecordModal');
  assert.strictEqual(allocContent.includes('Save as Record'), false, 'AllocationMatrix.jsx must not have "Save as Record" button');
  assert.strictEqual(allocContent.includes('showSaveModal'), false, 'AllocationMatrix.jsx must not retain showSaveModal state');
});

// ----------------------------------------------------
// 4. Cloud Sync and AppContext Pruning
// ----------------------------------------------------
console.log('\n--- 4. Cloud Sync & AppContext Pruning ---');

await it('useCloudSync.js does not fetch or manage period records registries', () => {
  const syncContent = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf-8');
  assert.strictEqual(syncContent.includes('master_period_records_registry'), false, 'useCloudSync must not query master_period_records_registry');
  assert.strictEqual(syncContent.includes('deleted_period_record_ids_registry'), false, 'useCloudSync must not query deleted_period_record_ids_registry');
  assert.strictEqual(syncContent.includes('setSavedRecords'), false, 'useCloudSync must not reference setSavedRecords');
});

await it('usePeriodRecordsAndReports.js and AppContext.jsx do not export period record actions', () => {
  const reportsContent = fs.readFileSync(path.join(projectRoot, 'src/context/usePeriodRecordsAndReports.js'), 'utf-8');
  assert.strictEqual(reportsContent.includes('savePeriodRecord'), false, 'usePeriodRecordsAndReports must not export savePeriodRecord');
  assert.strictEqual(reportsContent.includes('restorePeriodRecord'), false, 'usePeriodRecordsAndReports must not export restorePeriodRecord');
  assert.strictEqual(reportsContent.includes('deletePeriodRecord'), false, 'usePeriodRecordsAndReports must not export deletePeriodRecord');
  assert.strictEqual(reportsContent.includes('clearAllPeriodRecords'), false, 'usePeriodRecordsAndReports must not export clearAllPeriodRecords');

  const contextContent = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf-8');
  assert.strictEqual(contextContent.includes('savedRecords,'), false, 'AppContext must not export savedRecords');
  assert.strictEqual(contextContent.includes('savePeriodRecord,'), false, 'AppContext must not export savePeriodRecord');
});

// ----------------------------------------------------
// 5. Masterlist Pre-Deletion XLSX Export Feature
// ----------------------------------------------------
console.log('\n--- 5. Pre-Deletion Optional XLSX Export in ClearDataConfirmationModal ---');

await it('ClearDataConfirmationModal.jsx implements optional XLSX export before deletion', () => {
  const modalContent = fs.readFileSync(path.join(projectRoot, 'src/components/ClearDataConfirmationModal.jsx'), 'utf-8');
  
  // Verify imports
  assert.ok(modalContent.includes('exportForecastToExcel'), 'Must import exportForecastToExcel');
  assert.ok(modalContent.includes('exportAllocationToExcel'), 'Must import exportAllocationToExcel');
  assert.ok(modalContent.includes('FileSpreadsheet'), 'Must import FileSpreadsheet icon');
  assert.ok(modalContent.includes('Download'), 'Must import Download icon');

  // Verify handlers
  assert.ok(modalContent.includes('handleExportForecast'), 'Must define handleExportForecast');
  assert.ok(modalContent.includes('handleExportAllocation'), 'Must define handleExportAllocation');

  // Verify advisory notice and buttons in UI
  assert.ok(modalContent.includes('Optional Backup: Export Current Data (XLSX)'), 'Must contain backup advisory title');
  assert.ok(modalContent.includes('Before clearing the masterlist, you may optionally download a backup spreadsheet'), 'Must describe optional backup');
  assert.ok(modalContent.includes('Export Forecasting (.xlsx)'), 'Must have Export Forecasting button');
  assert.ok(modalContent.includes('Export Allocation (.xlsx)'), 'Must have Export Allocation button');
});

console.log(`\n========================================================================`);
console.log(`ALL ${passedTests} VERIFICATION TESTS PASSED SUCCESSFULLY!`);
console.log(`========================================================================`);
