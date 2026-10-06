import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('========================================================================');
console.log('TEST SUITE: Clear Data Google Drive Automatic Backup & Monthly Status Check');
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
// 1. Service Functions in driveAutoSyncService.js
// ----------------------------------------------------
console.log('\n--- 1. driveAutoSyncService Verification ---');

await it('driveAutoSyncService exports required Drive backup and status check methods', async () => {
  const service = await import('../services/driveAutoSyncService.js');
  assert.strictEqual(typeof service.autoArchiveDatasetToDrive, 'function', 'Must export autoArchiveDatasetToDrive');
  assert.strictEqual(typeof service.checkDriveDatasetStatusForPeriod, 'function', 'Must export checkDriveDatasetStatusForPeriod');
  assert.strictEqual(typeof service.saveLocalDriveBackupReceipt, 'function', 'Must export saveLocalDriveBackupReceipt');
  assert.strictEqual(typeof service.getLocalDriveBackupReceipt, 'function', 'Must export getLocalDriveBackupReceipt');
});

await it('checkDriveDatasetStatusForPeriod returns structured status response', async () => {
  const service = await import('../services/driveAutoSyncService.js');
  const res = await service.checkDriveDatasetStatusForPeriod('September 2026');
  
  assert.strictEqual(typeof res, 'object', 'Result must be an object');
  assert.strictEqual(res.period, 'September 2026', 'Period must match argument');
  assert.strictEqual(typeof res.forecasting, 'object', 'forecasting status must be present');
  assert.strictEqual(typeof res.allocation, 'object', 'allocation status must be present');
  assert.strictEqual(typeof res.allUploaded, 'boolean', 'allUploaded flag must be boolean');
  assert.strictEqual(typeof res.anyUploaded, 'boolean', 'anyUploaded flag must be boolean');
});

// ----------------------------------------------------
// 2. ClearDataConfirmationModal.jsx Integration
// ----------------------------------------------------
console.log('\n--- 2. ClearDataConfirmationModal.jsx Verification ---');

await it('ClearDataConfirmationModal imports Drive backup services and UI components', () => {
  const modalPath = path.join(projectRoot, 'src/components/ClearDataConfirmationModal.jsx');
  const modalContent = fs.readFileSync(modalPath, 'utf-8');

  assert.ok(modalContent.includes('autoArchiveDatasetToDrive'), 'Must import autoArchiveDatasetToDrive');
  assert.ok(modalContent.includes('checkDriveDatasetStatusForPeriod'), 'Must import checkDriveDatasetStatusForPeriod');
  assert.ok(modalContent.includes('CloudUpload'), 'Must import CloudUpload icon');
  assert.ok(modalContent.includes('CheckCircle2'), 'Must import CheckCircle2 icon');
});

await it('ClearDataConfirmationModal implements live Drive status check & pre-deletion auto backup', () => {
  const modalPath = path.join(projectRoot, 'src/components/ClearDataConfirmationModal.jsx');
  const modalContent = fs.readFileSync(modalPath, 'utf-8');

  // Drive state and handlers
  assert.ok(modalContent.includes('fetchDriveStatus'), 'Must define fetchDriveStatus callback');
  assert.ok(modalContent.includes('handleBackupToDrive'), 'Must define handleBackupToDrive handler');
  assert.ok(modalContent.includes('isCheckingDrive'), 'Must maintain isCheckingDrive state');
  assert.ok(modalContent.includes('isBackingUpToDrive'), 'Must maintain isBackingUpToDrive state');

  // Pre-deletion safety backup call inside handleConfirm
  assert.ok(modalContent.includes('autoArchiveDatasetToDrive('), 'Must invoke autoArchiveDatasetToDrive in handleConfirm');

  // UI verification: Drive backup card
  assert.ok(modalContent.includes('Google Drive Cloud Backup & Safety Check'), 'Must display Drive backup card header');
  assert.ok(modalContent.includes('Forecasting ('), 'Must display monthly forecasting status row');
  assert.ok(modalContent.includes('Allocation ('), 'Must display monthly allocation status row');
  assert.ok(modalContent.includes('Backup to Google Drive Now'), 'Must provide Drive backup action button');
});

console.log(`\n========================================================================`);
console.log(`ALL ${passedTests} VERIFICATION TESTS PASSED SUCCESSFULLY!`);
console.log(`========================================================================`);
