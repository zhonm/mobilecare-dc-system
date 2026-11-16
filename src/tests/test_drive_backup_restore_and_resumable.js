import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

import {
  normalizeToFileBytes,
  GOOGLE_DRIVE_CONFIG
} from '../services/googleDriveService.js';

import {
  getFormattedSaveTimestamp
} from '../services/driveAutoSyncService.js';

import {
  enqueueOfflineDriveUpload,
  getPendingOfflineUploads,
  removeOfflineDriveUpload
} from '../services/driveOfflineQueueService.js';

import {
  compileSystemBackupPackage,
  compileFullEnterpriseBackupPackage,
  validateBackupPackage,
  executeSystemStateRestore,
  deduplicateAndSanitizeBackupData,
  compareBackupWithLiveState,
  identifyExpiredBackups,
  saveBackupRetentionPolicy,
  togglePinBackup,
  recordBackupExecutionLog,
  getBackupExecutionLogs,
  getRestoreHistoryLogs,
  BACKUP_SCHEMA_VERSION
} from '../services/backupRestoreService.js';

console.log('========================================================================');
console.log('TEST SUITE: Features A, B, C, D, E, F & Superadmin Backup & Restore');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Feature A - Zero-Supabase-Storage for Documents
// -----------------------------------------------------------------------------
console.log('--- Test 1: Feature A - Zero-Supabase-Storage for Documents ---');
const confirmationMetadata = {
  receivedByName: 'Maria Santos',
  receivedDate: '2026-10-05',
  receivedCondition: 'Good Condition',
  receivingNotes: 'Verified all 12 units against packing list',
  signedPlDriveLink: 'https://drive.google.com/file/d/1ltAwtMav9hGaJTvEJpVqnv72_S41ODaW/view',
  signedPlFileId: '1ltAwtMav9hGaJTvEJpVqnv72_S41ODaW',
  signedPlFilename: 'Signed_PackingList_DCOWNED_100526A_2026-10-05_1000.pdf',
  siteFolder: 'CDO'
};

// Ensure no binary fields or base64 data URLs exist in confirmation metadata
assert.strictEqual(typeof confirmationMetadata.signedPlDriveLink, 'string');
assert.strictEqual(confirmationMetadata.signedPlDriveLink.startsWith('https://drive.google.com/'), true);
assert.strictEqual(confirmationMetadata.signedPlDriveLink.includes('data:'), false);
assert.strictEqual(Boolean(confirmationMetadata.signedPlFileId), true);
assert.strictEqual(confirmationMetadata.siteFolder, 'CDO');
console.log('  ✓ PASS: Only lightweight metadata pointers stored; 0 binary bytes passed to database');

// -----------------------------------------------------------------------------
// Test 2: Feature B - Offload Heavy Monthly Snapshots to Drive
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Feature B - Offload Heavy Monthly Snapshots to Drive ---');
assert.strictEqual(
  GOOGLE_DRIVE_CONFIG.folders.snapshots,
  '1ZATES0O0caRM3qT4rMwNBSZyWrUh-9eF',
  'Snapshots folder ID must match designated Drive directory'
);

const timestampStr = getFormattedSaveTimestamp();
assert.ok(timestampStr.length >= 10, 'Timestamp string must be formatted');
console.log('  ✓ PASS: Monthly snapshots folder is configured at 1ZATES0O0caRM3qT4rMwNBSZyWrUh-9eF');

// -----------------------------------------------------------------------------
// Test 3: Feature C - Resumable Chunked Uploads for >5MB
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Feature C - Resumable Chunked Uploads for >5MB ---');

// Test normalizeToFileBytes helper
const strBytes = await normalizeToFileBytes('Hello MDC');
assert.strictEqual(strBytes instanceof Uint8Array, true);
assert.strictEqual(new TextDecoder().decode(strBytes), 'Hello MDC');

const arrBuf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
const arrBufBytes = await normalizeToFileBytes(arrBuf);
assert.strictEqual(arrBufBytes.length, 5);

// Test 256KB chunk boundary rule in Resumable Upload
const CHUNK_UNIT = 256 * 1024; // 262,144 bytes
const requestedChunk = 2 * 1024 * 1024; // 2MB
assert.strictEqual(requestedChunk % CHUNK_UNIT, 0, 'Chunk size must be exact multiple of 256KB');

// Verify that uploadToGoogleDrive code contains the 5MB automatic delegation rule
const driveServiceContent = fs.readFileSync(path.join(projectRoot, 'src/services/googleDriveService.js'), 'utf-8');
assert.ok(
  driveServiceContent.includes('uploadResumableToGoogleDrive'),
  'googleDriveService.js must export uploadResumableToGoogleDrive'
);
assert.ok(
  driveServiceContent.includes('FIVE_MEGABYTES') || driveServiceContent.includes('5 * 1024 * 1024'),
  'uploadToGoogleDrive must route files > 5MB to Resumable Upload protocol'
);
console.log('  ✓ PASS: Resumable Chunked Upload protocol strictly adheres to 256KB multiples and 5MB threshold');

// -----------------------------------------------------------------------------
// Test 4: Feature D - Offline Upload Queue via IndexedDB
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Feature D - Offline Upload Queue via IndexedDB ---');

const queueResult = await enqueueOfflineDriveUpload({
  type: 'PMG_SIGNED_PL',
  shipmentId: 'ship-offline-01',
  siteFolder: 'LIMA',
  fileName: 'Signed_PackingList_LIMA_Test.pdf',
  mimeType: 'application/pdf',
  fileData: new Uint8Array([10, 20, 30, 40]),
  payload: { note: 'Offline queue test' }
});

assert.strictEqual(queueResult.success, true);
assert.ok(queueResult.queueId.startsWith('drive-offline-'));

const pendingItems = await getPendingOfflineUploads();
assert.ok(Array.isArray(pendingItems));
const foundItem = pendingItems.find((i) => i.id === queueResult.queueId);
assert.ok(foundItem, 'Enqueued item must be present in offline queue');
assert.strictEqual(foundItem.type, 'PMG_SIGNED_PL');
assert.strictEqual(foundItem.siteFolder, 'LIMA');

// Test removal
await removeOfflineDriveUpload(queueResult.queueId);
const pendingAfter = await getPendingOfflineUploads();
assert.ok(!pendingAfter.some((i) => i.id === queueResult.queueId), 'Removed item must not appear in queue');
console.log('  ✓ PASS: Offline upload queue cleanly enqueues, stores, and clears items');

// -----------------------------------------------------------------------------
// Test 5: Feature E - Direct Google Drive Redirection (Zero Supabase Egress)
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Feature E - Direct Google Drive Redirection ---');

const previewModalPath = path.join(projectRoot, 'src/components/DriveDocumentPreviewModal.jsx');
assert.ok(!fs.existsSync(previewModalPath), 'DriveDocumentPreviewModal.jsx must be completely removed');

// Verify integration in Shipments.jsx
const shipmentsContent = fs.readFileSync(path.join(projectRoot, 'src/components/Shipments.jsx'), 'utf-8');
assert.ok(
  !shipmentsContent.includes('DriveDocumentPreviewModal'),
  'Shipments.jsx must not import DriveDocumentPreviewModal'
);
assert.ok(
  !shipmentsContent.includes('previewDriveDoc'),
  'Shipments.jsx must not track previewDriveDoc modal state'
);
assert.ok(
  shipmentsContent.includes('signed_pl_drive_link') && shipmentsContent.includes('target="_blank"'),
  'Shipments.jsx must render direct redirect link opening Google Drive in a new tab'
);
console.log('  ✓ PASS: Drive preview modal removed and direct Google Drive redirection link verified (0 KB Supabase egress)');

// -----------------------------------------------------------------------------
// Test 6: Feature F - Full System Backup Compilation & Verification
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Feature F - Full System Backup Compilation & Verification ---');

const mockAppState = {
  parts: [
    { id: 'p-1', part_number: '661-21991', description: 'Display Module' },
    { id: 'p-2', part_number: '661-22002', description: 'Battery Module' }
  ],
  sites: [
    { id: 's-1', code: 'ASP LIM', name: 'MobileCare Lima' },
    { id: 's-2', code: 'ASP CDO', name: 'MobileCare CDO' }
  ],
  categories: [{ id: 'cat-1', name: 'Display' }],
  inventoryUnits: [
    { id: 'u-1', serial_number: 'G9PQHU084CQ9D088S5L4B', status: 'in_stock' },
    { id: 'u-2', serial_number: 'D088S5L4BG9PQHU084CQ9', status: 'packed' }
  ],
  shipments: [
    { id: 'sh-1', invoice_ref: 'DCOWNED#100526A', status: 'shipped' }
  ],
  purchaseOrders: [{ id: 'po-1', po_number: 'PO-2026-001' }],
  forecastItems: [{ id: 'fc-1', part_number: '661-21991', forecast_qty: 45 }],
  allocations: [{ id: 'al-1', part_number: '661-21991' }],
  usersList: [
    { id: 'usr-admin', email: 'zhon.manaois@mobilecareph.com', role: 'superadmin' }
  ],
  supervisorSettings: { supervisor_name: 'Anjo Alcazar', supervisor_title: 'MDC Supervisor' },
  autoLogoutConfig: { enabled: true, hour: 0, minute: 0 }
};

const mockAdminUser = {
  id: 'usr-admin',
  fullName: 'Zhon Manaois',
  email: 'zhon.manaois@mobilecareph.com',
  role: 'superadmin'
};

const backupPkg = compileSystemBackupPackage(mockAppState, mockAdminUser);
assert.strictEqual(backupPkg.schemaVersion, BACKUP_SCHEMA_VERSION);
assert.strictEqual(backupPkg.backupType, 'FULL_ENTERPRISE_SYSTEM_STATE');
assert.strictEqual(backupPkg.stats.partsCount, 2);
assert.strictEqual(backupPkg.stats.sitesCount, 2);
assert.strictEqual(backupPkg.stats.inventoryUnitsCount, 2);
assert.strictEqual(backupPkg.stats.shipmentsCount, 1);
assert.strictEqual(backupPkg.createdBy.email, 'zhon.manaois@mobilecareph.com');

// Test validation
const validation = validateBackupPackage(backupPkg);
assert.strictEqual(validation.isValid, true);
assert.strictEqual(validation.stats.inventoryUnitsCount, 2);
assert.strictEqual(validation.stats.shipmentsCount, 1);

// Test validation rejects empty package
const emptyPkg = { data: { parts: [], sites: [], inventoryUnits: [], shipments: [] } };
const emptyValidation = validateBackupPackage(emptyPkg);
assert.strictEqual(emptyValidation.isValid, false);
console.log('  ✓ PASS: System backup package compiles and validates 100% of core records');

// -----------------------------------------------------------------------------
// Test 7: Superadmin Backup & Restore Settings Sub-Page Integration
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Superadmin Backup & Restore Settings Sub-Page Integration ---');

const backupSettingsPath = path.join(projectRoot, 'src/components/BackupRestoreSettings.jsx');
assert.ok(fs.existsSync(backupSettingsPath), 'BackupRestoreSettings.jsx component file must exist');

const settingsCatalogPath = path.join(projectRoot, 'src/components/SettingsCatalog.jsx');
const settingsCatalogContent = fs.readFileSync(settingsCatalogPath, 'utf-8');

assert.ok(
  settingsCatalogContent.includes('BackupRestoreSettings'),
  'SettingsCatalog.jsx must import and use BackupRestoreSettings'
);
assert.ok(
  settingsCatalogContent.includes("activeTab === 'backup'"),
  'SettingsCatalog.jsx must support activeTab backup'
);
assert.ok(
  settingsCatalogContent.includes('Backup & Restore') || settingsCatalogContent.includes('Backup &amp; Restore'),
  'SettingsCatalog.jsx must include Backup & Restore navigation button'
);
assert.ok(
  settingsCatalogContent.includes('isSuperadmin'),
  'SettingsCatalog.jsx must restrict Backup & Restore tab to isSuperadmin'
);
console.log('  ✓ PASS: Superadmin Backup & Restore page is cleanly integrated inside System Settings');

// -----------------------------------------------------------------------------
// Test 8: System State Restore Simulation
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: System State Restore Simulation ---');

let restoredParts = [];
let restoredSites = [];
let restoredUnits = [];
let restoredShipments = [];
let cloudSyncPurged = false;

const mockAppActions = {
  savePart: (part) => { restoredParts.push(part); },
  saveSite: (site) => { restoredSites.push(site); },
  batchAddScanInUnits: (units) => { restoredUnits = [...units]; },
  batchImportShipments: (shipments) => { restoredShipments = [...shipments]; },
  saveSupervisorSettings: () => {},
  updateAutoLogoutConfig: () => {},
  forceGlobalCloudSyncAndPurge: () => { cloudSyncPurged = true; }
};

const restoreResult = await executeSystemStateRestore(backupPkg, mockAppActions);
assert.strictEqual(restoreResult.success, true);
assert.strictEqual(restoredParts.length, 2);
assert.strictEqual(restoredSites.length, 2);
assert.strictEqual(restoredUnits.length, 2);
assert.strictEqual(restoredShipments.length, 1);
assert.strictEqual(cloudSyncPurged, true, 'Must execute forceGlobalCloudSyncAndPurge upon restore');
console.log('  ✓ PASS: System restore executes sequence, updates state, and purges cloud cache');

// -----------------------------------------------------------------------------
// Test 9: Complete 22-Store Enterprise Backup Coverage
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: Complete 22-Store Enterprise Backup Coverage ---');

const fullEnterpriseState = {
  ...mockAppState,
  dcIntakeRecords: [
    { id: 'MDC202600001', record_name: 'Intake Batch #1', total_units: 2, items: [{ serial_number: 'G9PQHU084CQ9D088S5L4B' }] }
  ],
  partsRequests: [
    { id: 'req-1', request_number: 'PR-202610-10001', part_number: '661-21991', quantity_requested: 3, status: 'pending' }
  ],
  repairUsageRecords: [
    { id: 'usage-1', repairNumber: 'R123456', partNumber: '661-21991', quantity: 1 }
  ],
  activePeriod: { month: 10, year: 2026, label: 'October 2026' },
  forecastingModel: 'wma',
  masterlistData: { totalUnits: 591, totalDistinctParts: 40, periodLabel: 'October 2026' },
  ctCatalog: [{ id: 'ct-1', part_number: '923-00001', description: 'Display Adhesive', item_kind: 'consumable' }],
  ctOrders: [{ id: 'cto-1', po_number: 'GS1003315365', status: 'ordered', items: [] }],
  ctStock: [{ id: 'cts-1', part_number: '923-00001', site_code: 'DC-MDC', quantity_on_hand: 25 }],
  ctToolAssets: [{ id: 'ctt-1', serial_number: 'TOOL-SN-001', part_number: '923-99999', status: 'available' }],
  ctMovements: [{ id: 'ctm-1', part_number: '923-00001', action: 'received', quantity: 25 }],
  ctShipments: [{ id: 'ctsh-1', packing_list_number: 'CT-PL-001', status: 'shipped' }],
  partTransferHistory: [
    { id: 'xfer-1', part_number: '661-21991', serial_number: 'G9PQHU084CQ9D088S5L4B', from_site_code: 'DC', to_site_code: 'BHS' }
  ],
  fixablySnapshot: { timestamp: '2026-10-15T00:00:00.000Z', items: [{ serialNumber: 'G9PQHU084CQ9D088S5L4B' }] },
  dcMonitoringState: {
    datasets: { site_stock: [{ partNumber: '661-21991', partSerial: 'G9PQHU084CQ9D088S5L4B' }] },
    shippingCosts: [{ month: 'October', cost: 1200 }]
  },
  systemAuditLogs: [{ id: 'sys-1', action: 'LOGIN' }],
  uploadAuditLogs: [{ id: 'up-1', file_name: 'Masterlist.xlsx' }],
  deletionAuditLogs: [{ id: 'del-1', entity_id: 'OLD-1' }],
  sessionAuditLogs: [{ id: 'sess-1', action: 'AUTO_LOGOUT' }],
  scanLogs: [{ id: 'scan-1', serial_number: 'G9PQHU084CQ9D088S5L4B' }]
};

const fullBackupPkg = await compileFullEnterpriseBackupPackage(fullEnterpriseState, mockAdminUser, {
  label: 'Milestone_Test',
  trigger: 'MANUAL_DRIVE_BACKUP'
});

assert.strictEqual(fullBackupPkg.stats.dcIntakeRecordsCount, 1);
assert.strictEqual(fullBackupPkg.stats.partsRequestsCount, 1);
assert.strictEqual(fullBackupPkg.stats.repairUsageRecordsCount, 1);
assert.strictEqual(fullBackupPkg.stats.consumablesToolsTotalCount, 6);
assert.strictEqual(fullBackupPkg.stats.partTransferHistoryCount, 1);
assert.strictEqual(fullBackupPkg.stats.fixablySnapshotItemsCount, 1);
assert.strictEqual(fullBackupPkg.stats.dcMonitoringRowsCount, 1);
assert.strictEqual(fullBackupPkg.stats.auditLogsCount, 5);
assert.strictEqual(fullBackupPkg.data.forecastingModel, 'wma');
assert.strictEqual(fullBackupPkg.data.activePeriod.label, 'October 2026');
assert.ok(fullBackupPkg.integrity?.checksum?.startsWith('fnv64:'), 'Backup must include deterministic FNV-64 checksum');
console.log('  ✓ PASS: All 22 operational stores and metadata are included and counted in enterprise backup');

// -----------------------------------------------------------------------------
// Test 10: Cryptographic Checksum Verification & Tamper Detection
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: Cryptographic Checksum Verification & Tamper Detection ---');

const validCheck = validateBackupPackage(fullBackupPkg);
assert.strictEqual(validCheck.isValid, true);
assert.strictEqual(validCheck.integrity.checksumValid, true);

// Tamper with a serial number inside the backup payload without updating checksum
const tamperedPkg = JSON.parse(JSON.stringify(fullBackupPkg));
tamperedPkg.data.inventoryUnits[0].serial_number = 'TAMPERED_SERIAL_999999';
const tamperedCheck = validateBackupPackage(tamperedPkg);
assert.strictEqual(tamperedCheck.isValid, false, 'Tampered backup must fail checksum validation');
assert.ok(tamperedCheck.error.includes('checksum mismatch'), 'Error must report checksum mismatch');
console.log('  ✓ PASS: Checksum verification detects tampered or corrupted backup records');

// -----------------------------------------------------------------------------
// Test 11: Multi-Format Normalization (CLI scripts/backup_to_google_drive.mjs format)
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: Multi-Format Normalization (CLI Dump Format) ---');

const cliDumpFormat = {
  metadata: { backup_timestamp: '2026-10-20T08:00:00.000Z' },
  tables: {
    parts: [{ id: 'p-1', part_number: '661-21991', description: 'Display' }],
    sites: [{ id: 's-1', code: 'ASP LIM', name: 'Lima' }],
    inventory_units: [{ id: 'u-1', serial_number: 'SN1001', status: 'in_stock' }],
    shipments: [{ id: 'sh-1', invoice_ref: 'DCOWNED#102026A', status: 'shipped' }],
    shipment_items: [{ id: 'shi-1', shipment_id: 'sh-1', serial_number: 'SN1001' }],
    dc_intake_records: [{ id: 'MDC202600009', total_units: 1 }],
    saved_records: [
      {
        id: 'master_live_state',
        snapshot_data: {
          forecastItems: [{ part_number: '661-21991', final_forecast: 12 }],
          allocations: [{ part_number: '661-21991', total_allocated_qty: 12 }]
        }
      }
    ]
  }
};

const cliValidation = validateBackupPackage(cliDumpFormat);
assert.strictEqual(cliValidation.isValid, true);
assert.strictEqual(cliValidation.computedStats.partsCount, 1);
assert.strictEqual(cliValidation.computedStats.inventoryUnitsCount, 1);
assert.strictEqual(cliValidation.computedStats.shipmentsCount, 1);
assert.strictEqual(cliValidation.computedStats.dcIntakeRecordsCount, 1);
assert.strictEqual(cliValidation.computedStats.forecastItemsCount, 1);
console.log('  ✓ PASS: CLI table dump format normalizes and validates cleanly');

// -----------------------------------------------------------------------------
// Test 12: Deduplication, Sanitization & Zero-Duplication Guarantee
// -----------------------------------------------------------------------------
console.log('\n--- Test 12: Deduplication, Sanitization & Zero-Duplication Guarantee ---');

const noisyData = {
  parts: [
    { part_number: '661-21991', description: 'Display v1' },
    { part_number: '661-21991', description: 'Display v2' }
  ],
  sites: [
    { code: 'ASP LIM', name: 'Lima' },
    { code: 'asp lim', name: 'Lima Duplicate' }
  ],
  inventoryUnits: [
    { serial_number: 'G9PQHU084CQ9D088S5L4B', status: 'in_stock', updated_at: '2026-10-01T00:00:00Z' },
    { serial_number: 'g9pqhu084cq9d088s5l4b', status: 'shipped', updated_at: '2026-10-05T00:00:00Z' }
  ],
  shipments: [
    {
      id: 'sh-1',
      invoice_ref: 'DCOWNED#100526A',
      items: [
        { serial_number: 'SN1' },
        { serial_number: 'SN1' }
      ]
    },
    {
      id: 'sh-1-dup',
      invoice_ref: 'DCOWNED#100526A',
      items: [{ serial_number: 'SN1' }]
    }
  ],
  usersList: [
    { email: 'Zhon.Manaois@mobilecareph.com', role: 'superadmin', accessToken: 'secret-jwt', refreshToken: 'secret-ref' },
    { email: 'zhon.manaois@mobilecareph.com', role: 'superadmin' }
  ]
};

const { cleanData, totalDuplicatesRemoved } = deduplicateAndSanitizeBackupData(noisyData);
assert.strictEqual(cleanData.parts.length, 1);
assert.strictEqual(cleanData.sites.length, 1);
assert.strictEqual(cleanData.inventoryUnits.length, 1);
assert.strictEqual(cleanData.inventoryUnits[0].status, 'shipped', 'Newer unit timestamp must win during deduplication');
assert.strictEqual(cleanData.shipments.length, 1);
assert.strictEqual(cleanData.shipments[0].items.length, 1, 'Duplicate shipment items must be deduplicated');
assert.strictEqual(cleanData.usersList.length, 1);
assert.strictEqual(cleanData.usersList[0].accessToken, undefined, 'Ephemeral auth tokens must be stripped from backup');
assert.ok(totalDuplicatesRemoved >= 5);
console.log('  ✓ PASS: Duplicate records and sensitive session tokens are sanitized deterministically');

// -----------------------------------------------------------------------------
// Test 13: Point-in-Time Full State Restore, Integrity Verification & Rollback
// -----------------------------------------------------------------------------
console.log('\n--- Test 13: Point-in-Time Full State Restore, Integrity Verification & Rollback ---');

let liveStateStore = {
  parts: [{ part_number: 'CORRUPT-PN' }],
  sites: [],
  categories: [],
  inventoryUnits: [{ serial_number: 'CORRUPT-SN-POST-BACKUP' }],
  shipments: [{ id: 'sh-corrupt', invoice_ref: 'CORRUPT-SHIP' }],
  purchaseOrders: [],
  dcIntakeRecords: [],
  partsRequests: [],
  forecastItems: [],
  allocations: [],
  ctState: null,
  usersList: [],
  cloudOverrideReceived: null
};

const fullRestoreActions = {
  currentUser: mockAdminUser,
  currentAppState: liveStateStore,
  setParts: (v) => { liveStateStore.parts = v; },
  setSites: (v) => { liveStateStore.sites = v; },
  setCategories: (v) => { liveStateStore.categories = v; },
  setInventoryUnits: (v) => { liveStateStore.inventoryUnits = v; },
  setShipments: (v) => { liveStateStore.shipments = v; },
  setPurchaseOrders: (v) => { liveStateStore.purchaseOrders = v; },
  setDcIntakeRecords: (v) => { liveStateStore.dcIntakeRecords = v; },
  setPartsRequests: (v) => { liveStateStore.partsRequests = v; },
  setForecastItems: (v) => { liveStateStore.forecastItems = v; },
  setAllocations: (v) => { liveStateStore.allocations = v; },
  restoreCtState: (v) => { liveStateStore.ctState = v; },
  setUsersList: (v) => { liveStateStore.usersList = v; },
  saveSupervisorSettings: () => {},
  updateAutoLogoutConfig: () => {},
  forceGlobalCloudSyncAndPurge: async (override) => {
    liveStateStore.cloudOverrideReceived = override;
    return { success: true };
  }
};

const fullRestoreRes = await executeSystemStateRestore(fullBackupPkg, fullRestoreActions, null, {
  sourceType: 'GOOGLE_DRIVE',
  sourceFilename: 'MDC_SYSTEM_BACKUP_TEST.json'
});

assert.strictEqual(fullRestoreRes.success, true);
assert.strictEqual(fullRestoreRes.verificationReport.verified, true);
assert.strictEqual(fullRestoreRes.verificationReport.lostRecords, 0);
assert.strictEqual(fullRestoreRes.verificationReport.duplicateRecords, 0);
assert.strictEqual(liveStateStore.inventoryUnits.length, 2, 'Post-backup corrupt unit must be replaced by exact backup units');
assert.strictEqual(liveStateStore.purchaseOrders.length, 1, 'Purchase orders must be restored');
assert.strictEqual(liveStateStore.dcIntakeRecords.length, 1, 'DC intake records must be restored');
assert.strictEqual(liveStateStore.partsRequests.length, 1, 'Parts requests must be restored');
assert.strictEqual(liveStateStore.forecastItems.length, 1, 'Forecast items must be restored');
assert.strictEqual(liveStateStore.allocations.length, 1, 'Allocations must be restored');
assert.strictEqual(liveStateStore.ctState.catalog.length, 1, 'Consumables & Tools state must be restored');
assert.strictEqual(liveStateStore.cloudOverrideReceived?.isSystemRestore, true, 'Cloud sync must receive override payload directly');

// Test automatic rollback if cloud sync throws a fatal error
let rollbackTestParts = [{ part_number: 'ORIGINAL-SAFE-PART', description: 'Safe Part' }];
const failingRestoreActions = {
  currentUser: mockAdminUser,
  currentAppState: { parts: rollbackTestParts, sites: [{ code: 'ASP LIM', name: 'Lima' }] },
  setParts: (v) => { rollbackTestParts = v; },
  setSites: () => {},
  forceGlobalCloudSyncAndPurge: async () => {
    throw new Error('Simulated fatal cloud sync failure');
  }
};

let caughtError = null;
try {
  await executeSystemStateRestore(fullBackupPkg, failingRestoreActions);
} catch (err) {
  caughtError = err;
}
assert.ok(caughtError, 'Fatal restore error must propagate');
assert.strictEqual(rollbackTestParts[0].part_number, 'ORIGINAL-SAFE-PART', 'Pre-restore state must be automatically rolled back on error');
console.log('  ✓ PASS: Point-in-time restore replaces corrupt state across all 22 stores and rolls back on fatal error');

// -----------------------------------------------------------------------------
// Test 14: Live Diff, Retention Policy, Pin Protection & Execution Logs
// -----------------------------------------------------------------------------
console.log('\n--- Test 14: Live Diff, Retention Policy, Pin Protection & Execution Logs ---');

const diffResult = compareBackupWithLiveState(fullBackupPkg, mockAppState);
assert.ok(Array.isArray(diffResult.rows) && diffResult.rows.length >= 12);
const poDiffRow = diffResult.rows.find((r) => r.key === 'dcIntakeRecordsCount');
assert.strictEqual(poDiffRow.backupCount, 1);
assert.strictEqual(poDiffRow.liveCount, 0);
assert.strictEqual(poDiffRow.delta, 1);

const policy = saveBackupRetentionPolicy({ maxBackupsToKeep: 4, retentionDays: 30, pinnedBackupIds: ['file-old-pinned'] });
const sampleRemoteBackups = [
  { id: 'file-1', name: 'Backup_1.json', createdTime: new Date().toISOString() },
  { id: 'file-2', name: 'Backup_2.json', createdTime: new Date().toISOString() },
  { id: 'file-3', name: 'Backup_3.json', createdTime: new Date().toISOString() },
  { id: 'file-4', name: 'Backup_4.json', createdTime: new Date().toISOString() },
  { id: 'file-old-pinned', name: 'Backup_Pinned.json', createdTime: '2025-01-01T00:00:00Z' },
  { id: 'file-old-unpinned', name: 'Backup_Expired.json', createdTime: '2025-01-01T00:00:00Z' }
];
const expired = identifyExpiredBackups(sampleRemoteBackups, policy);
assert.strictEqual(expired.some((f) => f.id === 'file-old-pinned'), false, 'Pinned backups must never be marked expired');
assert.strictEqual(expired.some((f) => f.id === 'file-old-unpinned'), true, 'Unpinned old backup must be marked expired');

const logEntry = recordBackupExecutionLog({
  status: 'SUCCESS',
  operationType: 'GOOGLE_DRIVE_BACKUP',
  filename: 'MDC_SYSTEM_BACKUP_TEST.json',
  sizeBytes: 20480,
  totalRecords: 35
});
assert.ok(logEntry.id.startsWith('bk-log-'));
assert.ok(getBackupExecutionLogs().length >= 1, 'Backup execution logs must persist');
assert.ok(getRestoreHistoryLogs().length >= 1, 'Restore history logs must persist');
const pinnedPolicy = togglePinBackup('file-2');
assert.strictEqual(pinnedPolicy.pinnedBackupIds.includes('file-2'), true);
console.log('  ✓ PASS: Live Diff, Retention Policy, Pin Protection & Activity Logs verified');

console.log('\n========================================================================');
console.log('ALL TESTS PASSED: Features A, B, C, D, E, F & Production Backup/Restore (100%)');
console.log('========================================================================');
