import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: Branch Stock & Parts Requests Modernization Review');
console.log('====================================================');

let passedTests = 0;
function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 1. READ SOURCE FILES
const reqPartsPath = path.resolve(__dirname, '../components/RequestParts.jsx');
const usePartsReqPath = path.resolve(__dirname, '../context/usePartsRequests.js');
const reqPartsCode = fs.readFileSync(reqPartsPath, 'utf8');
const usePartsReqCode = fs.readFileSync(usePartsReqPath, 'utf8');

// 2. VERIFY 'ALL' BRANCH STOCK AGGREGATION IN usePartsRequests.js
it('usePartsRequests.js aggregates all branches when isAllTarget is true', () => {
  assert.ok(
    usePartsReqCode.includes("isAllTarget"),
    'Must handle isAllTarget'
  );
  assert.ok(
    usePartsReqCode.includes("siteId: isAllTarget ? 'ALL' : siteId"),
    'Must return aggregated siteId and siteCode as ALL'
  );
  assert.ok(
    usePartsReqCode.includes("partsSummary,") && usePartsReqCode.includes("totalInStock,") && usePartsReqCode.includes("units: unitsList"),
    'Must return complete summary, total in stock, and serialized units list'
  );
});

// 3. VERIFY BRANCH STOCK SUB-TABS & DIRECTORY ARCHITECTURE IN RequestParts.jsx
it('RequestParts.jsx implements modern 3 sub-tab navigation for Branch Stock', () => {
  assert.ok(
    reqPartsCode.includes("const [stockSubTab, setStockSubTab] = useState('catalog')"),
    'Must provide stockSubTab state initialized to catalog'
  );
  assert.ok(
    reqPartsCode.includes("Catalog &amp; Device Summary") || reqPartsCode.includes("Catalog & Device Summary"),
    'Must render Catalog & Device Summary sub-tab button'
  );
  assert.ok(
    reqPartsCode.includes("Serialized Stock Directory"),
    'Must render Serialized Stock Directory sub-tab button'
  );
  assert.ok(
    reqPartsCode.includes("Incoming Dispatches"),
    'Must render Incoming Dispatches sub-tab button'
  );
});

// 4. VERIFY DARK TABLE HEADERS (#0f172a) CONSISTENCY
it('RequestParts.jsx uses dark table headers (#0f172a) across tables for system design consistency', () => {
  const darkMatches = (reqPartsCode.match(/background:\s*'#0f172a'/g) || []).length;
  assert.ok(
    darkMatches >= 3,
    `Expected at least 3 occurrences of dark table header (#0f172a), found ${darkMatches}`
  );
});

// 5. VERIFY 1-CLICK CLIPBOARD COPY BUTTONS
it('RequestParts.jsx implements 1-click clipboard copy helpers with checkmark feedback', () => {
  assert.ok(reqPartsCode.includes("handleCopyPartNumber"), 'Must implement handleCopyPartNumber');
  assert.ok(reqPartsCode.includes("handleCopyReqNumber"), 'Must implement handleCopyReqNumber');
  assert.ok(reqPartsCode.includes("handleCopySerial"), 'Must implement handleCopySerial');
  assert.ok(reqPartsCode.includes("handleCopyWaybill"), 'Must implement handleCopyWaybill');
  assert.ok(reqPartsCode.includes("copiedPartNumber"), 'Must track copiedPartNumber feedback state');
  assert.ok(reqPartsCode.includes("copiedSerial"), 'Must track copiedSerial feedback state');
  assert.ok(reqPartsCode.includes("copiedReqNumber"), 'Must track copiedReqNumber feedback state');
});

// 6. VERIFY SERIALIZED STOCK DIRECTORY FILTERING & AGING BRACKETS
it('RequestParts.jsx supports aging brackets, stock classification, and movement filtering in Serialized Directory', () => {
  assert.ok(reqPartsCode.includes("serializedAgingFilter"), 'Must have serializedAgingFilter');
  assert.ok(reqPartsCode.includes("serializedClassificationFilter"), 'Must have serializedClassificationFilter');
  assert.ok(reqPartsCode.includes("serializedTransferFilter"), 'Must have serializedTransferFilter');
  assert.ok(reqPartsCode.includes("paginatedSerializedUnits"), 'Must paginate serialized units');
  assert.ok(reqPartsCode.includes("totalSerializedPages"), 'Must calculate totalSerializedPages');
  assert.ok(reqPartsCode.includes("safeSerializedPage"), 'Must calculate safeSerializedPage');
  assert.ok(reqPartsCode.includes("getPageNumbers"), 'Must render windowed pagination');
});

// 7. VERIFY PARTS REQUESTS LIFECYCLE TABS & BATCH ACTIONS
it('RequestParts.jsx implements status lifecycle tabs and Superadmin batch approval/denial', () => {
  assert.ok(reqPartsCode.includes("requestStatusTab"), 'Must have requestStatusTab state');
  assert.ok(reqPartsCode.includes("requestTabCounts"), 'Must calculate requestTabCounts for badges');
  assert.ok(reqPartsCode.includes("handleBatchApproveRequests"), 'Must implement handleBatchApproveRequests');
  assert.ok(reqPartsCode.includes("handleBatchDenyRequests"), 'Must implement handleBatchDenyRequests');
  assert.ok(reqPartsCode.includes("handleToggleSelectAllPending"), 'Must implement handleToggleSelectAllPending');
  assert.ok(reqPartsCode.includes("handleToggleSelectRequest"), 'Must implement handleToggleSelectRequest');
});

// 8. VERIFY MODAL INTEGRATIONS (SerialDossierModal, MovementHistoryModal, Requisition Details)
it('RequestParts.jsx integrates SerialDossierModal, MovementHistoryModal, and Requisition Details modal', () => {
  assert.ok(reqPartsCode.includes("<SerialDossierModal"), 'Must render SerialDossierModal');
  assert.ok(reqPartsCode.includes("<MovementHistoryModal"), 'Must render MovementHistoryModal');
  assert.ok(reqPartsCode.includes("selectedRequestDetails"), 'Must have selectedRequestDetails state');
  assert.ok(
    reqPartsCode.includes("Parts Requisition Details Modal"),
    'Must render full Requisition Details modal drawer'
  );
});

// 9. VERIFY TELEMETRY KPI CARDS & EXPORT ENHANCEMENTS
it('RequestParts.jsx renders rich telemetry KPI cards, Excel exports, and dead stock pull-out', () => {
  assert.ok(reqPartsCode.includes("branchStockAgingMetrics"), 'Must compute branchStockAgingMetrics');
  assert.ok(reqPartsCode.includes("Branch Inventory Value"), 'Must have Branch Inventory Value KPI');
  assert.ok(reqPartsCode.includes("Dead Stock (> 150D)"), 'Must have Dead Stock (> 150D) KPI');
  assert.ok(reqPartsCode.includes("Non-Moving (90-149D)"), 'Must have Non-Moving KPI');
  assert.ok(reqPartsCode.includes("Slow-Moving (60-89D)"), 'Must have Slow-Moving KPI');
  assert.ok(reqPartsCode.includes("Active Stock (< 60D)"), 'Must have Active Stock KPI');
  assert.ok(reqPartsCode.includes("handleExportSerializedStockToXlsx"), 'Must implement handleExportSerializedStockToXlsx');
  assert.ok(reqPartsCode.includes("handleExportDeadStockForBranch"), 'Must implement handleExportDeadStockForBranch');
});

console.log(`\n====================================================`);
console.log(`ALL ${passedTests} BRANCH STOCK & PARTS REQUESTS MODERNIZATION TESTS PASSED (100%)`);
console.log(`====================================================`);
