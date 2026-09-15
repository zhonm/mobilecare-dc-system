/**
 * Egress Telemetry & Bandwidth Quota Monitor for Supabase Free Tier
 *
 * Tracks network egress against the 5.0 GB / month free-tier limit.
 * Provides real-time bandwidth accounting, burn-rate projections,
 * safe daily budget calculations, and automated Egress Saver mode.
 */

export const FREE_TIER_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5.0 GB = 5,368,709,120 bytes
export const STORAGE_KEY = 'mdc_egress_monitor_v1';

// Historical daily data calibrated directly from the user's Supabase dashboard (06 Sep - 15 Sep 2026)
export const DEFAULT_CYCLE_BASELINE = {
  cycleStart: '2026-09-06T00:00:00.000Z',
  cycleEnd: '2026-10-06T23:59:59.999Z',
  // Historical recorded daily bytes
  dailyHistory: {
    '2026-09-06': 12.5 * 1024 * 1024,
    '2026-09-07': 98.2 * 1024 * 1024,
    '2026-09-08': 104.7 * 1024 * 1024,
    '2026-09-09': 108.1 * 1024 * 1024,
    '2026-09-10': 105.4 * 1024 * 1024,
    '2026-09-11': 152.8 * 1024 * 1024,
    '2026-09-12': 1220.0 * 1024 * 1024, // Spike: 1.2 GB
    '2026-09-13': 285.3 * 1024 * 1024,
    '2026-09-14': 312.0 * 1024 * 1024,
    '2026-09-15': 490.0 * 1024 * 1024
  },
  // Table breakdown baseline (derived from data volume)
  tableBreakdown: {
    saved_records: 1850 * 1024 * 1024,
    repair_usage_records: 620 * 1024 * 1024,
    inventory_units: 240 * 1024 * 1024,
    shipments: 85 * 1024 * 1024,
    dc_intake_records: 52 * 1024 * 1024,
    parts: 24 * 1024 * 1024,
    profiles: 12 * 1024 * 1024,
    auth: 5 * 1024 * 1024
  },
  manualBaselineAdjustmentBytes: 0,
  egressSaverMode: false,
  isManualSaverOverride: false
};

class EgressMonitor {
  constructor() {
    this.subscribers = new Set();
    this.state = this.loadState();
    this.recentRequests = [];
  }

  loadState() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          // Check if stored cycle is still current
          const now = new Date();
          const cycleEnd = new Date(parsed.cycleEnd || DEFAULT_CYCLE_BASELINE.cycleEnd);
          if (now <= cycleEnd) {
            return {
              ...DEFAULT_CYCLE_BASELINE,
              ...parsed,
              dailyHistory: {
                ...DEFAULT_CYCLE_BASELINE.dailyHistory,
                ...(parsed.dailyHistory || {})
              },
              tableBreakdown: {
                ...DEFAULT_CYCLE_BASELINE.tableBreakdown,
                ...(parsed.tableBreakdown || {})
              }
            };
          }
        }
      }
    } catch (e) {
      console.warn('[EgressMonitor] Could not read stored state:', e);
    }
    return { ...DEFAULT_CYCLE_BASELINE };
  }

  saveState() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      }
    } catch (e) {
      console.warn('[EgressMonitor] Could not persist state:', e);
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    const currentState = this.getStats();
    this.subscribers.forEach(cb => {
      try {
        cb(currentState);
      } catch (e) {
        console.warn('[EgressMonitor] Subscriber error:', e);
      }
    });
  }

  /**
   * Determine target table or service name from URL
   */
  parseEndpoint(url) {
    try {
      const parsedUrl = new URL(url, 'https://dummy.co');
      const pathname = parsedUrl.pathname;

      if (pathname.includes('/rest/v1/')) {
        const parts = pathname.split('/rest/v1/')[1].split('?')[0].split('/');
        return parts[0] || 'rest_api';
      }
      if (pathname.includes('/auth/v1/')) {
        return 'auth';
      }
      if (pathname.includes('/storage/v1/')) {
        return 'storage';
      }
      if (pathname.includes('/realtime/v1/')) {
        return 'realtime';
      }
      return 'other';
    } catch (e) {
      return 'other';
    }
  }

  /**
   * Record a network call's bandwidth usage
   */
  recordEgress({ url, method = 'GET', requestBytes = 0, responseBytes = 0, status = 200 }) {
    const today = new Date().toISOString().slice(0, 10);
    // In Supabase egress billing, outgoing server responses are the primary egress billed.
    // Client-side downloads = Supabase egress bandwidth.
    const totalEgress = responseBytes + (method !== 'GET' ? requestBytes : 0);
    if (totalEgress <= 0) return;

    // 1. Update daily history
    const currentDaily = this.state.dailyHistory[today] || 0;
    this.state.dailyHistory[today] = currentDaily + totalEgress;

    // 2. Update table breakdown
    const table = this.parseEndpoint(url);
    const currentTableBytes = this.state.tableBreakdown[table] || 0;
    this.state.tableBreakdown[table] = currentTableBytes + totalEgress;

    // 3. Keep a circular log of recent 50 requests
    this.recentRequests.unshift({
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      url: typeof url === 'string' ? url.split('?')[0] : 'supabase_request',
      table,
      method,
      requestBytes,
      responseBytes,
      totalBytes: totalEgress,
      status
    });
    if (this.recentRequests.length > 50) {
      this.recentRequests.pop();
    }

    // 4. Auto-evaluate Egress Saver mode
    this._checkAutoSaverMode();

    this.saveState();
    this.notify();
  }

  _checkAutoSaverMode() {
    if (!this.state.isManualSaverOverride) {
      const stats = this.getStats();
      if (stats.usagePercent >= 80 && !this.state.egressSaverMode) {
        this.state.egressSaverMode = true;
      } else if (stats.usagePercent < 75 && this.state.egressSaverMode) {
        this.state.egressSaverMode = false;
      }
    }
  }

  /**
   * Compute comprehensive metrics & projections
   */
  getStats() {
    const now = new Date();
    const cycleStart = new Date(this.state.cycleStart);
    const cycleEnd = new Date(this.state.cycleEnd);

    // Sum daily history
    let totalTrackedBytes = 0;
    Object.values(this.state.dailyHistory).forEach(bytes => {
      totalTrackedBytes += bytes;
    });

    const totalEgressBytes = totalTrackedBytes + (this.state.manualBaselineAdjustmentBytes || 0);
    const limitBytes = FREE_TIER_LIMIT_BYTES;
    const remainingBytes = Math.max(0, limitBytes - totalEgressBytes);
    const usagePercent = Math.min(100, (totalEgressBytes / limitBytes) * 100);

    // Calculate days
    const totalCycleDays = Math.max(1, Math.ceil((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24)));
    const daysElapsed = Math.max(1, Math.ceil((now - cycleStart) / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(1, Math.ceil((cycleEnd - now) / (1000 * 60 * 60 * 24)));

    // Burn rates
    const avgDailyBurnRateBytes = totalEgressBytes / daysElapsed;
    
    // Recent 3-day burn rate (more responsive)
    const recentDays = Object.entries(this.state.dailyHistory)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 3);
    const recent3DayTotal = recentDays.reduce((sum, [, b]) => sum + b, 0);
    const recentBurnRateBytes = recentDays.length > 0 ? recent3DayTotal / recentDays.length : avgDailyBurnRateBytes;

    // Projected total by cycle end
    const projectedTotalBytes = totalEgressBytes + (recentBurnRateBytes * daysRemaining);
    const projectedUsagePercent = (projectedTotalBytes / limitBytes) * 100;

    // Safe daily budget to stay below 5.0 GB limit
    const safeDailyBudgetBytes = remainingBytes / daysRemaining;

    // Days until limit exhausted at current burn rate
    const daysUntilLimit = recentBurnRateBytes > 0
      ? remainingBytes / recentBurnRateBytes
      : 999;

    // Determine alert status
    let alertLevel = 'ok'; // 'ok' | 'warning' | 'critical' | 'emergency'
    if (usagePercent >= 95 || remainingBytes <= 250 * 1024 * 1024) {
      alertLevel = 'emergency';
    } else if (usagePercent >= 80 || daysUntilLimit <= 3) {
      alertLevel = 'critical';
    } else if (usagePercent >= 60 || daysUntilLimit < daysRemaining) {
      alertLevel = 'warning';
    }

    return {
      totalEgressBytes,
      limitBytes,
      remainingBytes,
      usagePercent,
      cycleStart: this.state.cycleStart,
      cycleEnd: this.state.cycleEnd,
      daysElapsed,
      daysRemaining,
      totalCycleDays,
      avgDailyBurnRateBytes,
      recentBurnRateBytes,
      projectedTotalBytes,
      projectedUsagePercent,
      safeDailyBudgetBytes,
      daysUntilLimit: Math.max(0, daysUntilLimit),
      alertLevel,
      egressSaverMode: this.state.egressSaverMode,
      dailyHistory: this.state.dailyHistory,
      tableBreakdown: this.state.tableBreakdown,
      recentRequests: this.recentRequests
    };
  }

  /**
   * Set or adjust baseline manually (e.g. if user verifies Supabase dashboard number)
   */
  setBaselineUsage(totalGbUsed) {
    if (typeof totalGbUsed !== 'number' || totalGbUsed < 0) return;
    const targetBytes = totalGbUsed * 1024 * 1024 * 1024;
    
    // Sum current tracked history
    let currentHistorySum = 0;
    Object.values(this.state.dailyHistory).forEach(bytes => {
      currentHistorySum += bytes;
    });

    this.state.manualBaselineAdjustmentBytes = targetBytes - currentHistorySum;
    this._checkAutoSaverMode();
    this.saveState();
    this.notify();
  }

  /**
   * Toggle Egress Saver Mode
   */
  setEgressSaverMode(active, isManual = true) {
    this.state.egressSaverMode = Boolean(active);
    this.state.isManualSaverOverride = Boolean(isManual);
    this.saveState();
    this.notify();
  }

  /**
   * Format byte sizes into human readable strings
   */
  static formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

export const egressMonitor = new EgressMonitor();
export default egressMonitor;
