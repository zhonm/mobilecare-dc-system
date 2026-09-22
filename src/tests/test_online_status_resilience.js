import assert from 'assert';

/**
 * Test resilient online status calculation logic matching Header.jsx and useCloudSync.js
 */
function computeIsOnline({ realtimeConnected, cloudSyncStatus, probeOnline, networkOnline }) {
  return Boolean(
    realtimeConnected ||
    cloudSyncStatus?.isOnline === true ||
    probeOnline === true ||
    (networkOnline && cloudSyncStatus?.isOnline !== false)
  );
}

function shouldBlockOfflineSyncQueue({ supabase, navigatorOnLine, realtimeConnected, cloudSyncStatus }) {
  if (!supabase) return true;
  if (typeof navigatorOnLine !== 'undefined' && !navigatorOnLine && !realtimeConnected && cloudSyncStatus?.isOnline === false) {
    return true;
  }
  return false;
}

console.log('--- Running Online Status Resilience Tests ---');

// Test 1: Chrome false negative: navigator.onLine is false, but realtime WebSocket is connected
{
  const status = computeIsOnline({
    realtimeConnected: true,
    cloudSyncStatus: { isOnline: false },
    probeOnline: false,
    networkOnline: false
  });
  assert.strictEqual(status, true, 'Should be ONLINE if realtimeConnected is true, even if navigator.onLine is false');
  console.log('✓ Test 1 Passed: Chrome false negative with connected Realtime WebSocket is recognized as ONLINE.');
}

// Test 2: Chrome false negative: navigator.onLine is false, realtime reconnecting, but REST DB query succeeded
{
  const status = computeIsOnline({
    realtimeConnected: false,
    cloudSyncStatus: { isOnline: true },
    probeOnline: null,
    networkOnline: false
  });
  assert.strictEqual(status, true, 'Should be ONLINE if cloudSyncStatus.isOnline is true');
  console.log('✓ Test 2 Passed: Successful cloud REST query overrides false navigator.onLine.');
}

// Test 3: Active probe succeeds when browser reports false offline
{
  const status = computeIsOnline({
    realtimeConnected: false,
    cloudSyncStatus: { isOnline: null },
    probeOnline: true,
    networkOnline: false
  });
  assert.strictEqual(status, true, 'Should be ONLINE if active HTTP probe succeeds');
  console.log('✓ Test 3 Passed: Active HTTP probe overrides browser false negative.');
}

// Test 4: True offline state (all connections lost)
{
  const status = computeIsOnline({
    realtimeConnected: false,
    cloudSyncStatus: { isOnline: false },
    probeOnline: false,
    networkOnline: false
  });
  assert.strictEqual(status, false, 'Should be OFFLINE when all tiers fail');
  console.log('✓ Test 4 Passed: True offline state properly detects OFFLINE.');
}

// Test 5: Normal online state
{
  const status = computeIsOnline({
    realtimeConnected: true,
    cloudSyncStatus: { isOnline: true },
    probeOnline: null,
    networkOnline: true
  });
  assert.strictEqual(status, true, 'Should be ONLINE under normal conditions');
  console.log('✓ Test 5 Passed: Normal online state is ONLINE.');
}

// Test 6: Offline sync queue processing guard
{
  // When navigator.onLine is false, but user is connected via realtime
  const blocked1 = shouldBlockOfflineSyncQueue({
    supabase: {},
    navigatorOnLine: false,
    realtimeConnected: true,
    cloudSyncStatus: { isOnline: true }
  });
  assert.strictEqual(blocked1, false, 'Queue should NOT be blocked when realtime is connected');

  // When navigator.onLine is false and actually disconnected
  const blocked2 = shouldBlockOfflineSyncQueue({
    supabase: {},
    navigatorOnLine: false,
    realtimeConnected: false,
    cloudSyncStatus: { isOnline: false }
  });
  assert.strictEqual(blocked2, true, 'Queue SHOULD be blocked when truly offline');

  console.log('✓ Test 6 Passed: Offline sync queue guard does not choke on false navigator.onLine.');
}

console.log('\nAll 6 online resilience tests passed successfully!');
