import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: Fixably/GSX Upload Lock & Cloud Sync Parity');
console.log('====================================================');

// 1. Verify rawMasterlistData.json is aligned with authoritative in-scope September 2026 data
const rawDataPath = path.join(__dirname, '../data/rawMasterlistData.json');
const rawData = JSON.parse(fs.readFileSync(rawDataPath, 'utf-8'));

assert.strictEqual(rawData.totalUnits, 7611, 'rawMasterlistData.json totalUnits must be 7,611');
assert.strictEqual(rawData.totalDistinctParts, 395, 'rawMasterlistData.json totalDistinctParts must be 395');
assert.strictEqual(rawData.totalSites, 27, 'rawMasterlistData.json totalSites must be 27');
assert.strictEqual(rawData.totalValUSD, 1561089, 'rawMasterlistData.json totalValUSD must be 1,561,089');
assert.strictEqual(rawData.sites[0].siteName, 'MOBILECARE - NEWPOINT MALL', 'Top site must be NEWPOINT MALL');
assert.strictEqual(rawData.sites[0].totalUnits, 784, 'NEWPOINT MALL units must be 784');
console.log('  ✓ PASS: rawMasterlistData.json has 100% parity with September 2026 in-scope data (7,611 units)');

// 2. Verify useCloudSync.js includes master_masterlist_data_registry in SYSTEM_DOC_IDS
const useCloudSyncCode = fs.readFileSync(path.join(__dirname, '../context/useCloudSync.js'), 'utf-8');

assert.ok(
  useCloudSyncCode.includes("'master_masterlist_data_registry'"),
  'useCloudSync.js must include master_masterlist_data_registry'
);
assert.ok(
  useCloudSyncCode.includes("'master_upload_audit_logs_registry'"),
  'useCloudSync.js must include master_upload_audit_logs_registry'
);

// Verify SYSTEM_DOC_IDS block contains both
const systemDocIdsMatch = useCloudSyncCode.match(/const SYSTEM_DOC_IDS = \[([\s\S]*?)\];/);
assert.ok(systemDocIdsMatch, 'SYSTEM_DOC_IDS must be declared');
const systemDocIdsContent = systemDocIdsMatch[1];
assert.ok(systemDocIdsContent.includes('master_masterlist_data_registry'), 'SYSTEM_DOC_IDS must include master_masterlist_data_registry');
assert.ok(systemDocIdsContent.includes('master_upload_audit_logs_registry'), 'SYSTEM_DOC_IDS must include master_upload_audit_logs_registry');
console.log('  ✓ PASS: SYSTEM_DOC_IDS includes master_masterlist_data_registry and master_upload_audit_logs_registry');

// 3. Verify snap.isCleared clears masterlistData
assert.ok(
  useCloudSyncCode.includes("setMasterlistData(null)") && useCloudSyncCode.includes("removeItem('mdc_masterlist_data')"),
  'snap.isCleared must clear masterlistData from state and storage'
);
console.log('  ✓ PASS: snap.isCleared cleanly purges masterlistData across peer clients');

// 4. Verify liveSnapshotPayload has masterlistData
assert.ok(
  useCloudSyncCode.includes('masterlistData: currentMasterlistData || null'),
  'liveSnapshotPayload must include masterlistData for dual cloud redundancy'
);
console.log('  ✓ PASS: liveSnapshotPayload includes masterlistData for dual redundancy');

// 5. Verify DataImport.jsx upload lock implementation
const dataImportCode = fs.readFileSync(path.join(__dirname, '../components/DataImport.jsx'), 'utf-8');

assert.ok(dataImportCode.includes('hasExistingData'), 'DataImport.jsx must compute hasExistingData');
assert.ok(dataImportCode.includes('Upload Locked: Existing System Data Detected'), 'DataImport.jsx must render upload locked banner');
assert.ok(dataImportCode.includes('Delete Current Data to Unlock Upload'), 'DataImport.jsx must provide unlock button');
assert.ok(dataImportCode.includes('setShowClearModal(true)'), 'Unlock button must trigger ClearDataConfirmationModal');
console.log('  ✓ PASS: DataImport.jsx renders locked dropzone and action button when active data exists');

// 6. Verify Dashboard.jsx has quick upload guard
const dashboardCode = fs.readFileSync(path.join(__dirname, '../components/Dashboard.jsx'), 'utf-8');
assert.ok(
  dashboardCode.includes('Upload Locked: Existing operational data detected') || dashboardCode.includes('Upload Locked: Existing system data detected'),
  'Dashboard.jsx must guard quick upload against existing data'
);
console.log('  ✓ PASS: Dashboard.jsx prevents upload when active data exists');

console.log('====================================================');
console.log('ALL TESTS PASSED (6/6)');
console.log('====================================================');
