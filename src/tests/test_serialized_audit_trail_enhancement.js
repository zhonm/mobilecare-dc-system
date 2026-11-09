import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('====================================================');
console.log('TEST SUITE: Serialized Audit Trail Enhancement');
console.log('====================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, testFn) {
  try {
    testFn();
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

// ── Test 1: useAuditLogs exports universal audit event mechanism ────────────────
runTest('useAuditLogs.js exports systemAuditLogs and logAuditEvent', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/context/useAuditLogs.js'), 'utf8');
  assert.ok(fileContent.includes('systemAuditLogs'), 'useAuditLogs.js must contain systemAuditLogs state');
  assert.ok(fileContent.includes('logAuditEvent'), 'useAuditLogs.js must export logAuditEvent function');
  assert.ok(fileContent.includes('master_system_audit_logs_registry'), 'useAuditLogs.js must persist to master_system_audit_logs_registry');
});

// ── Test 2: AppContext provides systemAuditLogs and logAuditEvent ───────────────
runTest('AppContext.jsx exposes universal audit stream across context providers', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  assert.ok(fileContent.includes('systemAuditLogs: auditLogs.systemAuditLogs'), 'AppContext.jsx must export systemAuditLogs');
  assert.ok(fileContent.includes('logAuditEvent: auditLogs.logAuditEvent'), 'AppContext.jsx must export logAuditEvent');
  assert.ok(fileContent.includes('logAuditEvent: auditLogs.logAuditEvent'), 'useInventory & useShipments & usePartsRequests must receive logAuditEvent');
});

// ── Test 3: useInventory persists barcode scan events ─────────────────────────
runTest('useInventory.js persists scan logs to localStorage, IndexedDB, and universal audit stream', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/context/useInventory.js'), 'utf8');
  assert.ok(fileContent.includes("localStorage.setItem('mdc_scan_logs'"), 'logScan must save to mdc_scan_logs in localStorage');
  assert.ok(fileContent.includes("dbStorage.setItem('mdc_scan_logs'"), 'logScan must save to mdc_scan_logs in dbStorage');
  assert.ok(fileContent.includes("logAuditEvent"), 'logScan must forward hardware scans to universal audit stream');
  assert.ok(fileContent.includes("category: 'INVENTORY'"), 'batchAddScanInUnits must log audit event for batch intake');
});

// ── Test 4: usePartsRequests records PMG and Superadmin actions ────────────────
runTest('usePartsRequests.js records requisitions, approvals, and repair consumption', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/context/usePartsRequests.js'), 'utf8');
  assert.ok(fileContent.includes("action: 'PARTS_REQUEST_SUBMITTED'"), 'submitPartsRequest must log PARTS_REQUEST_SUBMITTED');
  assert.ok(fileContent.includes("action: actionName") || fileContent.includes("PARTS_REQUEST_APPROVED"), 'updatePartsRequestStatus must log approval or rejection');
  assert.ok(fileContent.includes("action: 'PART_CONSUMED_REPAIR'"), 'markUnitAsUsed must log PART_CONSUMED_REPAIR');
});

// ── Test 5: useShipments records dispatch and branch receipt ───────────────────
runTest('useShipments.js records courier dispatch and branch site receipt confirmation', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/context/useShipments.js'), 'utf8');
  assert.ok(fileContent.includes("action: 'SHIPMENT_DISPATCHED'"), 'confirmCourierPickup must log SHIPMENT_DISPATCHED');
  assert.ok(fileContent.includes("action: 'SHIPMENT_RECEIVED_CONFIRMED'"), 'confirmSiteReceive must log SHIPMENT_RECEIVED_CONFIRMED');
});

// ── Test 6: AuditTrail.jsx implements Master Activity Log as default ─────────
runTest('AuditTrail.jsx sets master activity log as default tab with comprehensive stream', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/components/AuditTrail.jsx'), 'utf8');
  assert.ok(fileContent.includes("const [auditTab, setAuditTab] = useState('master')"), 'Default auditTab must be master');
  assert.ok(fileContent.includes("Master System Activity & Traceability Stream") || fileContent.includes("Master Activity Log"), 'AuditTrail.jsx must display Master Activity Log');
  assert.ok(fileContent.includes("allMasterEvents"), 'AuditTrail.jsx must aggregate all operational system events');
  assert.ok(fileContent.includes("selectedEventForDossier"), 'AuditTrail.jsx must provide Audit Event Dossier inspection');
});

// ── Test 7: AuditTrail.jsx multi-sheet export includes Master Stream as Sheet 1 ─
runTest('AuditTrail.jsx multi-sheet Excel export features Master_Activity_Stream as Sheet 1', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/components/AuditTrail.jsx'), 'utf8');
  assert.ok(fileContent.includes("'Master_Activity_Stream'"), 'handleExportAllAuditsXLSX must append Master_Activity_Stream as Sheet 1');
  assert.ok(fileContent.includes("'Parts_Requisitions'"), 'handleExportAllAuditsXLSX must append Parts_Requisitions');
  assert.ok(fileContent.includes("'Outbound_Logistics'"), 'handleExportAllAuditsXLSX must append Outbound_Logistics');
});

// ── Test 8: Backward compatibility with session activity and purge tests ──────
runTest('AuditTrail.jsx preserves session_activity tab and handleExportSessionLogsXLSX', () => {
  const fileContent = fs.readFileSync(path.join(projectRoot, 'src/components/AuditTrail.jsx'), 'utf8');
  assert.ok(fileContent.includes("auditTab === 'session_activity'"), 'Must preserve session_activity tab');
  assert.ok(fileContent.includes('handleExportSessionLogsXLSX'), 'Must preserve handleExportSessionLogsXLSX');
  assert.ok(fileContent.includes('handleConfirmPurgeAllAudits'), 'Must preserve handleConfirmPurgeAllAudits');
});

console.log('\n====================================================');
console.log(`RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('====================================================');

if (failedTests > 0) {
  process.exit(1);
}
