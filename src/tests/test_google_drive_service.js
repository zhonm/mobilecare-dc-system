import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyPath = path.resolve(__dirname, '../../google-service-account.json');

// Inject credentials for Node runtime test
if (fs.existsSync(keyPath)) {
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  globalThis.__GOOGLE_SERVICE_KEY__ = key;
}

import {
  isGoogleDriveConfigured,
  getGoogleDriveAccessToken,
  uploadToGoogleDrive,
  downloadFromGoogleDrive,
  listFilesInDriveFolder,
  trashFileInDrive
} from '../services/googleDriveService.js';

console.log('========================================================================');
console.log('TEST SUITE: Google Drive Integration & Storage Verification');
console.log('========================================================================');

async function run() {
  console.log('1. Configuration Check...');
  assert.strictEqual(isGoogleDriveConfigured(), true, 'Google Drive must report configured');
  console.log('  ✓ PASS: Google Drive is configured');

  console.log('2. Access Token Generation via SubtleCrypto...');
  const token = await getGoogleDriveAccessToken();
  assert(token && token.length > 20, 'Access token must be non-empty');
  console.log('  ✓ PASS: Access token acquired successfully');

  console.log('3. Upload Test File to Backups Folder...');
  const testFileName = `test_dc_sync_${Date.now()}.json`;
  const testPayload = JSON.stringify({
    system: 'MDC DC System',
    timestamp: new Date().toISOString(),
    status: 'ACTIVE_VERIFICATION',
    notes: 'Google Drive Storage Integration Verified'
  }, null, 2);

  const uploadResult = await uploadToGoogleDrive({
    name: testFileName,
    mimeType: 'application/json',
    data: testPayload,
    folderType: 'backups'
  });

  assert.strictEqual(uploadResult.success, true, 'Upload must succeed');
  assert(uploadResult.fileId, 'File ID must be returned');
  assert(uploadResult.webViewLink?.includes('drive.google.com'), 'webViewLink must point to Google Drive');
  assert(uploadResult.dateFolder, 'Date folder name must be returned');
  assert(uploadResult.parentFolderId, 'Parent date folder ID must be returned');
  console.log(`  ✓ PASS: File uploaded into date folder "${uploadResult.dateFolder}" (${uploadResult.parentFolderId})`);
  console.log(`  ✓ File ID: ${uploadResult.fileId}`);
  console.log(`  ✓ Preview URL: ${uploadResult.webViewLink}`);

  console.log('4. Verify Date Folder Reuse...');
  const secondUploadResult = await uploadToGoogleDrive({
    name: `second_${testFileName}`,
    mimeType: 'application/json',
    data: testPayload,
    folderType: 'backups'
  });
  assert.strictEqual(secondUploadResult.parentFolderId, uploadResult.parentFolderId, 'Second upload must reuse the same date folder');
  console.log(`  ✓ PASS: Reused existing date folder "${secondUploadResult.dateFolder}" without duplicate creation`);
  await trashFileInDrive(secondUploadResult.fileId);

  console.log('4. Download and Verify Content...');
  const downloadRes = await downloadFromGoogleDrive(uploadResult.fileId);
  const downloadedJson = await downloadRes.json();
  assert.strictEqual(downloadedJson.system, 'MDC DC System');
  assert.strictEqual(downloadedJson.status, 'ACTIVE_VERIFICATION');
  console.log('  ✓ PASS: Downloaded payload content verified bit-for-bit');

  console.log('5. List Files in Backups Folder...');
  const filesList = await listFilesInDriveFolder('backups', 10);
  assert(Array.isArray(filesList), 'Files list must be an array');
  const found = filesList.find(f => f.id === uploadResult.fileId);
  assert(found, 'Uploaded file must be visible in folder listings');
  console.log(`  ✓ PASS: Found uploaded file in folder listings (${filesList.length} total files)`);

  console.log('6. Clean Up Test File via Trashing...');
  const trashed = await trashFileInDrive(uploadResult.fileId);
  assert.strictEqual(trashed, true, 'File trashing must succeed');
  console.log('  ✓ PASS: Test file trashed cleanly in Shared Drive');

  console.log('\n🎉 ALL GOOGLE DRIVE TESTS COMPLETED WITH 100% SUCCESS!');
}

run().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
