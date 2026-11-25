import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const lsStore = new Map();
globalThis.window = {
  __MDC_SYSTEM_RESTORE_IN_PROGRESS: false,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  console: globalThis.console,
  localStorage: {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => lsStore.set(k, String(v)),
    removeItem: (k) => lsStore.delete(k),
    clear: () => lsStore.clear(),
    get length() {
      return lsStore.size;
    },
    key: (i) => Array.from(lsStore.keys())[i] ?? null
  }
};
globalThis.localStorage = globalThis.window.localStorage;

const {
  generateXlsxBackupWorkbook,
  generateCsvBackupContent,
  parseAndValidateBackupFile
} = await import('../services/spreadsheetBackupService.js');

const { executeSystemStateRestore } = await import('../services/backupRestoreService.js');

console.log('=== XLSX / CSV Backup & Restore Full Round-Trip Test ===');

// Build a rich dataset with 1,250 parts (>1,000 PostgREST cap), DC Stock, Branch Stock, Tools, Consumables, Users, Sites
const parts = Array.from({ length: 1250 }, (_, i) => ({
  id: `part-${i + 1}`,
  part_number: `661-${String(10000 + i)}`,
  description: `Apple Service Part #${i + 1}`,
  iphone_model: 'iPhone 15 Pro',
  category_code: i % 2 === 0 ? 'DISPLAY' : 'BATTERY',
  stocking_price: 99 + (i % 50),
  safety_stock_pct: 0.05,
  is_active: true
}));

const dcUnits = [
  { id: 'dc-1', part_number: '661-10000', description: 'Display 1', serial_number: 'DC-SN-0001', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC', intake_assignment: 'MDC - Forecasting' },
  { id: 'dc-2', part_number: '661-10001', description: 'Battery 1', serial_number: 'DC-SN-0002', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC', intake_assignment: 'MDC - Forecasting' },
  { id: 'dc-3', part_number: '661-10002', description: 'Display 2', serial_number: 'DC-SN-0003', status: 'in_stock', current_site_id: 'site-dc', site_code: 'DC-MDC', intake_assignment: 'DC - CRBR' }
];

const branchUnits = [
  { id: 'br-1', part_number: '661-10000', description: 'Display 1', serial_number: 'BR-SN-0001', status: 'in_stock', current_site_id: 'site-nes', site_code: 'ASP NES', site_name: 'Northeast Square' }
];

const fullState = {
  parts,
  sites: [
    { id: 'site-dc', code: 'DC-MDC', name: 'Central DC', region: 'NCR', is_dc: true, is_active: true },
    { id: 'site-nes', code: 'ASP NES', name: 'Northeast Square', region: 'NCR', is_dc: false, is_active: true }
  ],
  categories: [
    { id: 'cat-disp', code: 'DISPLAY', name: 'Display Module', has_imei: false, is_serialized: true, sort_order: 1 },
    { id: 'cat-bat', code: 'BATTERY', name: 'Battery', has_imei: false, is_serialized: true, sort_order: 2 }
  ],
  inventoryUnits: [...dcUnits, ...branchUnits],
  shipments: [
    { id: 'ship-1', shipment_number: 'SH-001', invoice_ref: 'INV-001', destination_site_code: 'ASP NES', status: 'shipped', items: [{ serial_number: 'BR-SN-0001', part_number: '661-10000' }] }
  ],
  purchaseOrders: [
    { id: 'po-1', po_number: 'PO-2026-01', status: 'submitted', items: [{ part_number: '661-10000', quantity_ordered: 10 }] }
  ],
  dcIntakeRecords: [
    {
      id: 'intake-1',
      record_name: 'DC Batch 1 (Large >32k payload test)',
      site_code: 'DC-MDC',
      items: Array.from({ length: 450 }, (_, idx) => ({
        serial_number: `BIG-BATCH-SN-${String(idx + 1).padStart(5, '0')}`,
        part_number: '661-10000',
        description: 'Display, iPhone 15 Pro Max — Large Batch Cell Chunking Verification',
        status: 'in_stock'
      }))
    }
  ],
  partsRequests: [
    { id: 'req-1', request_number: 'REQ-001', site_code: 'ASP NES', status: 'pending', items: [{ part_number: '661-10000', qty: 2 }] }
  ],
  forecastItems: [{ part_number: '661-10000', forecast_qty: 25 }],
  allocations: [{ part_number: '661-10000', site_code: 'ASP NES', allocated_qty: 5 }],
  ctCatalog: [{ id: 'ctc-1', part_number: '923-15261', description: 'Adhesive 10PK', item_type: 'consumable', pack_size: 10 }],
  ctStock: [{ id: 'cts-1', part_number: '923-15261', description: 'Adhesive 10PK', site_code: 'ASP NES', qty_on_hand: 20, pack_size: 10, min_threshold: 2 }],
  ctToolAssets: [{ id: 'tool-1', asset_tag: 'MDC-TL-07701158-0001', ownership_tag: 'APPLE-07701158-01-AAAA', part_number: '077-01158', site_code: 'ASP NES', status: 'available' }],
  ctMovements: [{ id: 'ctm-1', movement_type: 'deduct', part_number: '923-15261', site_code: 'ASP NES', qty_delta: -2 }],
  ctOrders: [],
  ctShipments: [],
  partTransferHistory: [{ serial_number: 'BR-SN-0001', part_number: '661-10000', from_site_code: 'DC-MDC', to_site_code: 'ASP NES' }],
  usersList: [{ id: 'usr-1', email: 'admin@mobilecareph.com', fullName: 'Superadmin', role: 'superadmin', isActive: true }],
  activePeriod: { month: 12, year: 2026, label: 'December 2026' },
  forecastingModel: 'wma'
};

// 1. Test XLSX Export + Parse Round-Trip
const xlsxArtifact = generateXlsxBackupWorkbook(fullState, fullState.usersList[0], { label: 'UnitTest' });
assert.equal(xlsxArtifact.format, 'XLSX');
assert.ok(xlsxArtifact.filename.endsWith('.xlsx'));
assert.ok(xlsxArtifact.bytes instanceof Uint8Array && xlsxArtifact.bytes.byteLength > 1000);
console.log(`XLSX generated: ${xlsxArtifact.filename} (${(xlsxArtifact.sizeBytes / 1024).toFixed(1)} KB)`);

const parsedXlsx = await parseAndValidateBackupFile(xlsxArtifact.bytes, xlsxArtifact.filename);
assert.equal(parsedXlsx.isValid, true, `XLSX should validate: ${parsedXlsx.error || ''}`);
assert.equal(parsedXlsx.package.data.parts.length, 1250, 'XLSX must preserve all 1,250 parts');
assert.equal(parsedXlsx.package.data.inventoryUnits.length, 4, 'XLSX must preserve all 4 inventory units (3 DC + 1 Branch)');
assert.equal(parsedXlsx.package.data.ctToolAssets.length, 1, 'XLSX must preserve Tools');
assert.equal(parsedXlsx.package.data.ctStock.length, 1, 'XLSX must preserve Consumables');
assert.equal(parsedXlsx.package.data.ctStock[0].qty_on_hand, 20, 'Consumable quantity must match');
assert.equal(parsedXlsx.package.data.usersList.length, 1, 'XLSX must preserve Users');
assert.equal(parsedXlsx.package.data.sites.length, 2, 'XLSX must preserve Sites');
assert.equal(parsedXlsx.package.data.shipments.length, 1, 'XLSX must preserve Shipments');
assert.equal(parsedXlsx.package.data.purchaseOrders.length, 1, 'XLSX must preserve Purchase Orders');
assert.equal(parsedXlsx.package.data.dcIntakeRecords.length, 1, 'XLSX must preserve DC Intake Batches');
assert.equal(parsedXlsx.package.data.dcIntakeRecords[0].items.length, 450, 'XLSX must losslessly reassemble >32,767-char chunked cells');

// 2. Test CSV Export + Parse Round-Trip
const csvArtifact = generateCsvBackupContent(fullState, fullState.usersList[0], { label: 'UnitTest' });
assert.equal(csvArtifact.format, 'CSV');
assert.ok(csvArtifact.filename.endsWith('.csv'));
console.log(`CSV generated: ${csvArtifact.filename} (${(csvArtifact.sizeBytes / 1024).toFixed(1)} KB)`);

const parsedCsv = await parseAndValidateBackupFile(csvArtifact.bytes, csvArtifact.filename);
assert.equal(parsedCsv.isValid, true, `CSV should validate: ${parsedCsv.error || ''}`);
assert.equal(parsedCsv.package.data.parts.length, 1250, 'CSV must preserve all 1,250 parts');
assert.equal(parsedCsv.package.data.inventoryUnits.length, 4, 'CSV must preserve all 4 inventory units');
assert.equal(parsedCsv.package.data.ctToolAssets.length, 1, 'CSV must preserve Tools');
assert.equal(parsedCsv.package.data.ctStock.length, 1, 'CSV must preserve Consumables');

// 3. Simulate deleting 2 DC Stock units & truncating parts to 1,000, then restore from XLSX
globalThis.localStorage.setItem('mdc_deleted_unit_serials', JSON.stringify(['DC-SN-0001', 'DC-SN-0002']));
const liveAfterDamage = {
  ...fullState,
  parts: parts.slice(0, 1000),
  inventoryUnits: [dcUnits[2], branchUnits[0]]
};

let restoredParts = [];
let restoredUnits = [];
let restoredCt = null;

const restoreResult = await executeSystemStateRestore(
  parsedXlsx.package,
  {
    currentUser: fullState.usersList[0],
    currentAppState: liveAfterDamage,
    setParts: (p) => { restoredParts = p; },
    setSites: () => {},
    setCategories: () => {},
    setInventoryUnits: (u) => { restoredUnits = u; },
    setShipments: () => {},
    setPurchaseOrders: () => {},
    setDcIntakeRecords: () => {},
    setPartsRequests: () => {},
    setForecastItems: () => {},
    setAllocations: () => {},
    restoreCtState: (ct) => { restoredCt = ct; },
    setUsersList: () => {},
    forceGlobalCloudSyncAndPurge: async (payload) => ({
      success: true,
      deletedRegistriesFlushed: true,
      inventoryUnitsSynced: payload.inventoryUnits.length,
      inventoryUnitsFailed: 0,
      registriesSynced: 6,
      warnings: [],
      durationMs: 10
    })
  },
  null,
  { sourceType: 'LOCAL_FILE', sourceFilename: xlsxArtifact.filename, createPreRestoreSnapshot: false }
);

assert.equal(restoreResult.success, true);
assert.equal(restoredParts.length, 1250, 'All 1,250 parts must be restored');
assert.equal(restoredUnits.length, 4, 'All 4 inventory units (including 2 deleted DC units) must be restored');
assert.equal(restoreResult.recoveredDeletedUnits, 2, 'Should report 2 deleted DC Stock units recovered');
assert.equal(restoreResult.verificationReport.verified, true, 'Post-restore verification must pass');
assert.equal(restoreResult.verificationReport.tombstoneConflicts, 0, 'Zero tombstone conflicts');
assert.equal(restoredCt?.toolAssets?.length, 1, 'Tools must be restored via restoreCtState');
assert.equal(restoredCt?.stock?.length, 1, 'Consumables must be restored via restoreCtState');

// 3b. Verify restoring an XLSX with 0 shipments NEVER wipes existing live Outbound Shipments
const emptyShipState = { ...fullState, shipments: [] };
const emptyShipXlsx = generateXlsxBackupWorkbook(emptyShipState, fullState.usersList[0], { label: 'NoShipments' });
const parsedEmptyShip = await parseAndValidateBackupFile(emptyShipXlsx.bytes, emptyShipXlsx.filename);
let shipmentsSetterCalledWithEmpty = false;
let cloudShipmentsCount = 0;

await executeSystemStateRestore(
  parsedEmptyShip.package,
  {
    currentUser: fullState.usersList[0],
    currentAppState: fullState, // Live has 1 shipment
    setParts: () => {},
    setSites: () => {},
    setCategories: () => {},
    setInventoryUnits: () => {},
    setShipments: (s) => {
      if (Array.isArray(s) && s.length === 0) shipmentsSetterCalledWithEmpty = true;
    },
    setPurchaseOrders: () => {},
    setDcIntakeRecords: () => {},
    setPartsRequests: () => {},
    setForecastItems: () => {},
    setAllocations: () => {},
    setUsersList: () => {},
    forceGlobalCloudSyncAndPurge: async (payload) => {
      cloudShipmentsCount = (payload.shipments || []).length;
      return { success: true, deletedRegistriesFlushed: true, inventoryUnitsSynced: 4, inventoryUnitsFailed: 0, registriesSynced: 6, warnings: [], durationMs: 5 };
    }
  },
  null,
  { sourceType: 'LOCAL_FILE', sourceFilename: emptyShipXlsx.filename, createPreRestoreSnapshot: false }
);
assert.equal(shipmentsSetterCalledWithEmpty, false, 'Restoring a backup with 0 shipments must NOT wipe live Outbound Shipments');
assert.equal(cloudShipmentsCount, 1, 'Cloud sync payload must preserve live Outbound Shipments when backup Shipments sheet is empty');

// 4. Static verification of useCloudSync.js paginated parts fetch & Drive XLSX/CSV support
const cloudSyncCode = fs.readFileSync(path.resolve('src/context/useCloudSync.js'), 'utf8');
assert.ok(cloudSyncCode.includes("from('parts')") && cloudSyncCode.includes('.range(offset, offset + pageSize - 1)'), 'useCloudSync.js must paginate parts beyond 1,000 rows');

const backupSvcCode = fs.readFileSync(path.resolve('src/services/backupRestoreService.js'), 'utf8');
assert.ok(backupSvcCode.includes('export async function uploadSpreadsheetBackupToDrive'), 'backupRestoreService must export uploadSpreadsheetBackupToDrive');
assert.ok(backupSvcCode.includes("f.name?.endsWith('.xlsx')") && backupSvcCode.includes("f.name?.endsWith('.csv')"), 'listGoogleDriveBackups must include .xlsx and .csv backups');

console.log('ALL XLSX / CSV BACKUP & RESTORE TESTS PASSED!');
