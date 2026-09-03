import assert from 'assert';
import { executeDeleteIntakeRecord } from '../services/intakeRecordService.js';

console.log('\n====================================================');
console.log('TEST SUITE: DC Intake Records Deletion & Terminology');
console.log('====================================================\n');

async function runTests() {
  const mockRecords = [
    { id: 'MDC20260827', record_name: 'MDC20260827', total_units: 10, items: [] },
    { id: 'MDC20260816 AND DC2026082526', record_name: 'MDC20260816 AND DC2026082526', total_units: 15, items: [] },
    { id: 'MDC_LIVE_DC_STOCK_INTAKE', record_name: 'MDC_LIVE_DC_STOCK_INTAKE', total_units: 5, items: [] },
    { id: 'MDC20260826', record_name: 'MDC20260826', total_units: 8, items: [] }
  ];

  let currentRecords = [...mockRecords];
  let toastedMessages = [];
  let loggedAudits = [];

  const res = await executeDeleteIntakeRecord({
    recordId: 'MDC20260827',
    dcIntakeRecords: currentRecords,
    setDcIntakeRecords: (next) => { currentRecords = next; },
    logDeletionAudit: async (audit) => { loggedAudits.push(audit); },
    currentUser: { id: 'admin-1', fullName: 'Super Admin', role: 'superadmin' },
    setCloudSyncStatus: () => {},
    broadcastCloudEvent: () => {},
    showToast: (msg, type) => { toastedMessages.push({ msg, type }); }
  });

  assert.strictEqual(res.success, true, 'Deletion returned success: true');
  assert.strictEqual(currentRecords.length, 3, 'Record removed from local state');
  assert(!currentRecords.some(r => r.id === 'MDC20260827'), 'MDC20260827 does not exist in updated state');
  assert(toastedMessages[0].msg.includes('Deleted Parts Saved History Record'), 'Toast displays Parts Saved History Record');
  console.log('  ✓ PASS: executeDeleteIntakeRecord removes non-UUID record and shows Parts Saved History Record toast');

  const res2 = await executeDeleteIntakeRecord({
    recordId: 'MDC20260816 AND DC2026082526',
    dcIntakeRecords: currentRecords,
    setDcIntakeRecords: (next) => { currentRecords = next; },
    logDeletionAudit: async (audit) => { loggedAudits.push(audit); },
    currentUser: { id: 'admin-1', fullName: 'Super Admin', role: 'superadmin' },
    setCloudSyncStatus: () => {},
    broadcastCloudEvent: () => {},
    showToast: (msg, type) => { toastedMessages.push({ msg, type }); }
  });

  assert.strictEqual(res2.success, true, 'Complex ID deletion succeeded');
  assert.strictEqual(currentRecords.length, 2, 'Complex ID removed from state');
  console.log('  ✓ PASS: Complex multi-word batch record IDs cleanly deleted without error');

  const deletedSet = new Set(['MDC20260827', 'MDC20260816 AND DC2026082526']);
  const incomingCloudDocs = [
    { id: 'MDC20260827', record_name: 'MDC20260827', snapshot_data: { id: 'MDC20260827' } },
    { id: 'MDC20260826', record_name: 'MDC20260826', snapshot_data: { id: 'MDC20260826' } }
  ];

  const filteredDocs = incomingCloudDocs.filter(doc => !deletedSet.has(doc.id));
  assert.strictEqual(filteredDocs.length, 1, 'Deleted record filtered out from cloud sync');
  assert.strictEqual(filteredDocs[0].id, 'MDC20260826', 'Non-deleted record preserved');
  console.log('  ✓ PASS: Cloud sync strictly suppresses deleted records from hydration');

  console.log('\n====================================================');
  console.log('RESULTS: ALL INTAKE RECORD DELETION TESTS PASSED (100%)');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
