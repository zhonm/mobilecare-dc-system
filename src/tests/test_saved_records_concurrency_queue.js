// ============================================================================
// TEST SUITE: Saved Records Concurrency Queue & Lock Mitigation
// Verifies:
// 1. Debouncing bursts of rapid writes into a single trailing upsert
// 2. Sequential mutex guarantee (no overlapping in-flight calls to the same row)
// 3. Immediate flush functionality (flushSavedRecordsQueue)
// 4. Zero-loss payload retention (latest state is always persisted)
// 5. Error recovery (failed upsert releases the mutex for subsequent calls)
// 6. Polymorphic client support: (client, payload, opts) vs (payload, opts)
// ============================================================================

import assert from 'assert';
import {
  queuedSavedRecordsUpsert,
  flushSavedRecordsQueue,
  getSavedRecordsQueueStatus
} from '../utils/savedRecordsQueue.js';

console.log('====================================================');
console.log('TEST SUITE: Saved Records Concurrency Queue & Mutex');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

async function it(desc, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

function createMockSupabase(delayMs = 10, shouldFail = false) {
  let callCount = 0;
  let inFlightCount = 0;
  let maxConcurrent = 0;
  const recordedPayloads = [];

  const client = {
    from: (_table) => ({
      upsert: async (payload, _options) => {
        callCount++;
        inFlightCount++;
        if (inFlightCount > maxConcurrent) {
          maxConcurrent = inFlightCount;
        }

        recordedPayloads.push(JSON.parse(JSON.stringify(payload)));

        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }

        inFlightCount--;

        if (shouldFail) {
          return { error: { message: 'Simulated Supabase statement timeout 57014' } };
        }
        return { error: null, data: payload };
      }
    }),
    getCallCount: () => callCount,
    getMaxConcurrent: () => maxConcurrent,
    getRecordedPayloads: () => recordedPayloads,
    reset: () => {
      callCount = 0;
      inFlightCount = 0;
      maxConcurrent = 0;
      recordedPayloads.length = 0;
    }
  };

  return client;
}

// Execute test cases
(async () => {
  await it('Debounces rapid burst calls into a single execution with latest payload', async () => {
    const mockClient = createMockSupabase(10);
    const testRowId = 'test_row_debounce_' + Date.now();

    // Fire 25 rapid successive calls (simulating rapid barcode scanning)
    const promises = [];
    for (let i = 1; i <= 25; i++) {
      promises.push(
        queuedSavedRecordsUpsert(mockClient, {
          id: testRowId,
          record_type: 'inventory_master',
          snapshot_data: { scanCount: i, lastUnit: `UNIT-${i}` }
        }, { debounceMs: 150 })
      );
    }

    // Wait for the debounce window to expire and trailing execution to finish
    await new Promise((r) => setTimeout(r, 350));
    await Promise.all(promises);

    // Verify: out of 25 rapid calls, only 1 actual upsert reached the database
    assert.strictEqual(mockClient.getCallCount(), 1, `Expected 1 upsert call, got ${mockClient.getCallCount()}`);

    // Verify: the single execution persisted the LATEST payload (scanCount: 25)
    const payloads = mockClient.getRecordedPayloads();
    assert.strictEqual(payloads[0].snapshot_data.scanCount, 25);
    assert.strictEqual(payloads[0].snapshot_data.lastUnit, 'UNIT-25');
  });

  await it('Enforces strict sequential execution (mutex) with zero overlapping in-flight calls', async () => {
    // 50ms database latency simulation
    const mockClient = createMockSupabase(50);
    const testRowId = 'test_row_mutex_' + Date.now();

    // Call 1: Immediate execution
    const p1 = queuedSavedRecordsUpsert(mockClient, {
      id: testRowId,
      snapshot_data: { batch: 1 }
    }, { immediate: true });

    // Wait 10ms (p1 is now currently in-flight on the network)
    await new Promise((r) => setTimeout(r, 10));

    // Call 2: Immediate execution while p1 is in-flight
    const p2 = queuedSavedRecordsUpsert(mockClient, {
      id: testRowId,
      snapshot_data: { batch: 2 }
    }, { immediate: true });

    await Promise.all([p1, p2]);

    // Maximum concurrent operations for the same ID must NEVER exceed 1
    assert.strictEqual(
      mockClient.getMaxConcurrent(),
      1,
      `Max concurrent writes should be 1 to prevent ShareLock, was ${mockClient.getMaxConcurrent()}`
    );
    assert.strictEqual(mockClient.getCallCount(), 2);
  });

  await it('Immediately flushes queued pending items via flushSavedRecordsQueue()', async () => {
    const mockClient = createMockSupabase(5);
    const testRowId = 'test_row_flush_' + Date.now();

    // Queue with a 5 second debounce (would normally wait 5000ms)
    queuedSavedRecordsUpsert(mockClient, {
      id: testRowId,
      snapshot_data: { status: 'urgent_flush' }
    }, { debounceMs: 5000 });

    const beforeStatus = getSavedRecordsQueueStatus();
    assert(beforeStatus.pendingCount >= 1, 'Queue should hold pending payload');

    // Flush immediately
    const flushResults = await flushSavedRecordsQueue(testRowId);
    assert(flushResults.length >= 1, 'Flush should return execution results');

    assert.strictEqual(mockClient.getCallCount(), 1, 'Flush should have executed immediately');
    const payloads = mockClient.getRecordedPayloads();
    assert.strictEqual(payloads[0].snapshot_data.status, 'urgent_flush');
  });

  await it('Recovers cleanly from simulated database error without deadlocking future calls', async () => {
    const failingClient = createMockSupabase(5, true); // will fail with 57014
    const testRowId = 'test_row_error_' + Date.now();

    // First call fails
    const res1 = await queuedSavedRecordsUpsert(failingClient, {
      id: testRowId,
      snapshot_data: { attempt: 1 }
    }, { immediate: true });

    assert.strictEqual(res1.success, false, 'Expected first call to fail');

    // Second call with working client on the same ID should succeed without getting stuck
    const healthyClient = createMockSupabase(5, false);
    const res2 = await queuedSavedRecordsUpsert(healthyClient, {
      id: testRowId,
      snapshot_data: { attempt: 2 }
    }, { immediate: true });

    assert.strictEqual(res2.success, true, 'Subsequent call must succeed after failure');
    assert.strictEqual(healthyClient.getCallCount(), 1);
  });

  await it('Handles polymorphic call signature gracefully: (client, payload) vs (payload)', async () => {
    const mockClient = createMockSupabase(5);
    const idA = 'test_row_poly_a_' + Date.now();

    // Form 1: (client, payload, options)
    const resA = await queuedSavedRecordsUpsert(mockClient, {
      id: idA,
      snapshot_data: { form: 'with_client' }
    }, { immediate: true });

    assert.strictEqual(resA.success, true);
    assert.strictEqual(mockClient.getCallCount(), 1);

    // Form 2: (payload, options) without client (uses default supabase or mock client fallback)
    const idB = 'test_row_poly_b_' + Date.now();
    const resB = await queuedSavedRecordsUpsert({
      id: idB,
      snapshot_data: { form: 'default_client' }
    }, { immediate: true });

    // Should not throw an exception, returns standard result object
    assert(typeof resB === 'object' && 'success' in resB);
  });

  console.log('----------------------------------------------------');
  console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
  console.log('====================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
