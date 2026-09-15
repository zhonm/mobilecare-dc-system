// Egress Monitor & Bandwidth Safety Service
// Tracks Supabase PostgREST data usage against free-tier limits (5.0 GB / month)
// and protects against excessive polling / runaway loops.

const STORAGE_KEY = 'mdc_egress_monitor_data';
const FREE_TIER_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5.0 GB

// Seed baseline from Supabase dashboard (3.415 GB recorded on Sep 15, 2026)
const DEFAULT_BASELINE_BYTES = Math.round(3.415 * 1024 * 1024 * 1024);

const getStoredData = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate cycle boundaries (Sep 5 - Oct 5)
      return {
        billingCycleStart: parsed.billingCycleStart || '2026-09-05T00:00:00Z',
        billingCycleEnd: parsed.billingCycleEnd || '2026-10-05T23:59:59Z',
        baselineBytes: typeof parsed.baselineBytes === 'number' ? parsed.baselineBytes : DEFAULT_BASELINE_BYTES,
        sessionBytes: typeof parsed.sessionBytes === 'number' ? parsed.sessionBytes : 0,
        dailyRecords: parsed.dailyRecords || {},
        tableBreakdown: parsed.tableBreakdown || {},
        recentRequests: Array.isArray(parsed.recentRequests) ? parsed.recentRequests : []
      };
    }
  } catch (e) {
    console.warn('[EgressMonitor] Failed to load stored stats:', e);
  }

  return {
    billingCycleStart: '2026-09-05T00:00:00Z',
    billingCycleEnd: '2026-10-05T23:59:59Z',
    baselineBytes: DEFAULT_BASELINE_BYTES,
    sessionBytes: 0,
    dailyRecords: {},
    tableBreakdown: {},
    recentRequests: []
  };
};

let currentData = getStoredData();
const listeners = new Set();
let isAutoRequestContext = false;

const saveStoredData = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentData));
    }
  } catch (e) {
    // ignore storage quota errors
  }
};

const notifyListeners = () => {
  const stats = getEgressStats();
  listeners.forEach(fn => {
    try {
      fn(stats);
    } catch (e) {}
  });
};

// Rolling window for circuit breaker (timestamps of recent auto-syncs)
const recentAutoRequests = [];
let isCircuitBreakerTripped = false;
let circuitBreakerCooldownUntil = 0;

/**
 * Extract table or endpoint name from Supabase URL
 */
export const extractTableFromUrl = (urlStr) => {
  try {
    const url = new URL(urlStr, 'http://localhost');
    const path = url.pathname;
    // RPC: /rest/v1/rpc/<func_name>
    const rpcMatch = path.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    if (rpcMatch && rpcMatch[1]) return `rpc:${rpcMatch[1]}`;
    // PostgREST URLs: /rest/v1/<table_name>
    const restMatch = path.match(/\/rest\/v1\/([^/?]+)/);
    if (restMatch && restMatch[1]) {
      return restMatch[1];
    }
    // Storage: /storage/v1/...
    if (path.includes('/storage/v1/')) return 'storage';
    // Auth: /auth/v1/...
    if (path.includes('/auth/v1/')) return 'auth';
    return 'other';
  } catch (e) {
    return 'unknown';
  }
};

/**
 * Record a network request and its egress/transfer size
 */
export const recordRequest = ({
  method = 'GET',
  url = '',
  status = 200,
  bytes = 0,
  durationMs = 0,
  isAuto = false
}) => {
  const now = Date.now();
  const dateKey = new Date().toISOString().slice(0, 10);
  const table = extractTableFromUrl(url);

  // Update cumulative session bytes
  currentData.sessionBytes = (currentData.sessionBytes || 0) + bytes;

  // Update daily records
  if (!currentData.dailyRecords[dateKey]) {
    currentData.dailyRecords[dateKey] = { bytes: 0, requests: 0 };
  }
  currentData.dailyRecords[dateKey].bytes += bytes;
  currentData.dailyRecords[dateKey].requests += 1;

  // Update table breakdown
  if (!currentData.tableBreakdown[table]) {
    currentData.tableBreakdown[table] = { bytes: 0, requests: 0 };
  }
  currentData.tableBreakdown[table].bytes += bytes;
  currentData.tableBreakdown[table].requests += 1;

  // Update recent requests ring buffer (last 30 requests)
  const entry = {
    id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: now,
    method,
    table,
    bytes,
    status,
    durationMs,
    isAuto
  };
  currentData.recentRequests.unshift(entry);
  if (currentData.recentRequests.length > 30) {
    currentData.recentRequests.pop();
  }

  // Circuit breaker rate evaluation for automatic background requests
  if (isAuto) {
    recentAutoRequests.push({ timestamp: now, bytes });
    // Remove entries older than 2 minutes (120,000 ms)
    while (recentAutoRequests.length > 0 && now - recentAutoRequests[0].timestamp > 120000) {
      recentAutoRequests.shift();
    }
    // Trigger if > 35 auto requests in 2 mins OR > 40 MB in 2 mins
    const recentBytes = recentAutoRequests.reduce((sum, r) => sum + r.bytes, 0);
    if (recentAutoRequests.length > 35 || recentBytes > 40 * 1024 * 1024) {
      isCircuitBreakerTripped = true;
      circuitBreakerCooldownUntil = now + 60000; // 60s cooldown
      console.warn(`[EgressMonitor] Circuit breaker TRIPPED! Rate: ${recentAutoRequests.length} reqs / ${(recentBytes / 1024 / 1024).toFixed(2)} MB in 2 mins. Auto-refresh paused for 60s.`);
    }
  }

  saveStoredData();
  notifyListeners();
};

/**
 * Check if the circuit breaker is currently active
 */
export const isCircuitBreakerActive = () => {
  const now = Date.now();
  if (isCircuitBreakerTripped && now < circuitBreakerCooldownUntil) {
    return true;
  }
  if (isCircuitBreakerTripped && now >= circuitBreakerCooldownUntil) {
    isCircuitBreakerTripped = false;
    recentAutoRequests.length = 0;
  }
  return false;
};

/**
 * Calculate full egress metrics and remaining budgets
 */
export const getEgressStats = () => {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const cycleEnd = new Date(currentData.billingCycleEnd);
  const daysRemaining = Math.max(1, Math.ceil((cycleEnd - now) / (1000 * 60 * 60 * 24)));

  const totalBytesUsed = (currentData.baselineBytes || 0) + (currentData.sessionBytes || 0);
  const remainingBytesInCycle = Math.max(0, FREE_TIER_LIMIT_BYTES - totalBytesUsed);
  const percentUsed = Math.min(100, (totalBytesUsed / FREE_TIER_LIMIT_BYTES) * 100);

  // Safe daily budget: remaining capacity divided by remaining days
  const dailySafeBudgetBytes = Math.round(remainingBytesInCycle / daysRemaining);
  const todayUsage = currentData.dailyRecords[dateKey] || { bytes: 0, requests: 0 };
  const todayPercentOfSafeBudget = dailySafeBudgetBytes > 0 ? (todayUsage.bytes / dailySafeBudgetBytes) * 100 : 100;

  // Status tiers:
  // 'healthy': < 80% total and today's usage <= daily budget
  // 'warning': >= 80% total OR today's usage > 120% daily budget
  // 'critical': >= 92% total OR today's usage > 200% daily budget
  let health = 'healthy';
  if (percentUsed >= 92 || todayPercentOfSafeBudget > 200) {
    health = 'critical';
  } else if (percentUsed >= 80 || todayPercentOfSafeBudget > 100) {
    health = 'warning';
  }

  return {
    totalBytes: totalBytesUsed,
    limitBytes: FREE_TIER_LIMIT_BYTES,
    percentUsed,
    baselineBytes: currentData.baselineBytes,
    sessionBytes: currentData.sessionBytes,
    remainingBytes: remainingBytesInCycle,
    daysRemaining,
    dailySafeBudgetBytes,
    todayBytes: todayUsage.bytes,
    todayRequests: todayUsage.requests,
    todayPercentOfSafeBudget,
    health,
    isCircuitBreakerActive: isCircuitBreakerActive(),
    tableBreakdown: currentData.tableBreakdown,
    dailyRecords: currentData.dailyRecords,
    recentRequests: currentData.recentRequests,
    billingCycle: {
      start: currentData.billingCycleStart,
      end: currentData.billingCycleEnd
    }
  };
};

/**
 * Mark fetches initiated by an automatic refresh while the refresh is running.
 */
export const setEgressRequestContext = (isAuto) => {
  isAutoRequestContext = Boolean(isAuto);
};

/**
 * Reset session counter (e.g. for testing or after manual calibration)
 */
export const resetSessionStats = () => {
  currentData.sessionBytes = 0;
  currentData.recentRequests = [];
  currentData.tableBreakdown = {};
  isCircuitBreakerTripped = false;
  circuitBreakerCooldownUntil = 0;
  recentAutoRequests.length = 0;
  saveStoredData();
  notifyListeners();
};

/**
 * Calibrate baseline from Supabase dashboard if updated
 */
export const updateBaselineBytes = (newBaselineBytes) => {
  if (typeof newBaselineBytes === 'number' && !isNaN(newBaselineBytes)) {
    currentData.baselineBytes = Math.max(0, newBaselineBytes);
    saveStoredData();
    notifyListeners();
  }
};

/**
 * Subscribe to live egress updates
 */
export const subscribeToEgressUpdates = (callback) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};

/**
 * Format bytes into human-readable string (e.g. "3.42 GB", "824 KB")
 */
export const formatBytes = (bytes, decimals = 2) => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * Fetch wrapper that transparently measures PostgREST response sizes
 */
export const createEgressTrackingFetch = (originalFetch = typeof window !== 'undefined' ? window.fetch : null) => {
  const fetchFn = originalFetch || (typeof window !== 'undefined' ? window.fetch.bind(window) : (typeof globalThis !== 'undefined' ? globalThis.fetch : null));
  if (!fetchFn) return null;

  return async function egressTrackingFetch(input, init = {}) {
    const startTime = Date.now();
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = init?.method || (typeof input === 'object' && input?.method) || 'GET';

    try {
      const response = await fetchFn(input, init);
      const durationMs = Date.now() - startTime;

      // Supabase PostgREST responses:
      // Check content-length header first
      let bytes = 0;
      const contentLength = response.headers?.get?.('content-length');
      if (contentLength && !isNaN(parseInt(contentLength, 10))) {
        bytes = parseInt(contentLength, 10);
      } else {
        // If chunked transfer or gzip without content-length header, clone response and measure text size
        try {
          const clone = response.clone();
          const blob = await clone.blob();
          bytes = blob.size;
        } catch (e) {
          bytes = 512; // fallback rough estimate
        }
      }

      // Record to egress monitor
      recordRequest({
        method,
        url,
        status: response.status,
        bytes,
        durationMs,
        isAuto: isAutoRequestContext || Boolean(init?.headers?.['x-mdc-auto-refresh'] || (init?.headers?.get && init.headers.get('x-mdc-auto-refresh')))
      });

      return response;
    } catch (err) {
      recordRequest({
        method,
        url,
        status: 0,
        bytes: 0,
        durationMs: Date.now() - startTime,
        isAuto: isAutoRequestContext || Boolean(init?.headers?.['x-mdc-auto-refresh'] || (init?.headers?.get && init.headers.get('x-mdc-auto-refresh')))
      });
      throw err;
    }
  };
};
