import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_AUTO_LOGOUT_CONFIG,
  AUTO_LOGOUT_REGISTRY_DOC_ID,
  SESSION_AUDIT_REGISTRY_DOC_ID,
  parseTime,
  getNextScheduledLogout,
  getMostRecentScheduledBoundary,
  isSessionExpiredBySchedule,
  formatRemainingTime,
  formatConfigTimeTo12Hour
} from '../utils/autoLogoutManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

console.log('====================================================');
console.log('TEST SUITE: 12:00 AM Daily Auto-Logout & Session Policy');
console.log('====================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failedTests++;
  }
}

// ── Test 1: Configuration Defaults & Time Parsing ────────────────────────────
runTest('Default configuration defines 12:00 AM (00:00) with 5m warning and cache purge', () => {
  assert.strictEqual(DEFAULT_AUTO_LOGOUT_CONFIG.enabled, true);
  assert.strictEqual(DEFAULT_AUTO_LOGOUT_CONFIG.logout_time, '00:00');
  assert.strictEqual(DEFAULT_AUTO_LOGOUT_CONFIG.warning_lead_minutes, 5);
  assert.strictEqual(DEFAULT_AUTO_LOGOUT_CONFIG.allow_session_refresh, true);
  assert.strictEqual(DEFAULT_AUTO_LOGOUT_CONFIG.clear_cache_on_logout, true);
});

runTest('parseTime correctly extracts hours and minutes', () => {
  assert.deepStrictEqual(parseTime('00:00'), { hours: 0, minutes: 0 });
  assert.deepStrictEqual(parseTime('12:00'), { hours: 12, minutes: 0 });
  assert.deepStrictEqual(parseTime('23:45'), { hours: 23, minutes: 45 });
  assert.deepStrictEqual(parseTime('08:30'), { hours: 8, minutes: 30 });
});

runTest('formatConfigTimeTo12Hour formats 24h times to 12h AM/PM representation', () => {
  assert.strictEqual(formatConfigTimeTo12Hour('00:00'), '12:00 AM');
  assert.strictEqual(formatConfigTimeTo12Hour('00:30'), '12:30 AM');
  assert.strictEqual(formatConfigTimeTo12Hour('12:00'), '12:00 PM');
  assert.strictEqual(formatConfigTimeTo12Hour('18:00'), '6:00 PM');
  assert.strictEqual(formatConfigTimeTo12Hour('23:00'), '11:00 PM');
});

runTest('formatRemainingTime formats milliseconds to MM:SS countdown', () => {
  assert.strictEqual(formatRemainingTime(300000), '05:00');
  assert.strictEqual(formatRemainingTime(299000), '04:59');
  assert.strictEqual(formatRemainingTime(60000), '01:00');
  assert.strictEqual(formatRemainingTime(35000), '00:35');
  assert.strictEqual(formatRemainingTime(0), '00:00');
  assert.strictEqual(formatRemainingTime(-1000), '00:00');
});

// ── Test 2: Next Scheduled Logout Calculation ────────────────────────────────
runTest('getNextScheduledLogout advances to tomorrow when target time has passed today', () => {
  // Current time: Sept 12, 2026 10:00 AM
  const fromDate = new Date(2026, 8, 12, 10, 0, 0); // Month is 0-indexed (8 = Sept)
  // Target: 00:00 (12:00 AM)
  const nextTarget = getNextScheduledLogout('00:00', fromDate);

  // Next target must be Sept 13, 2026 00:00:00
  assert.strictEqual(nextTarget.getFullYear(), 2026);
  assert.strictEqual(nextTarget.getMonth(), 8);
  assert.strictEqual(nextTarget.getDate(), 13);
  assert.strictEqual(nextTarget.getHours(), 0);
  assert.strictEqual(nextTarget.getMinutes(), 0);
});

runTest('getNextScheduledLogout targets later today when target time is upcoming', () => {
  // Current time: Sept 12, 2026 10:00 AM
  const fromDate = new Date(2026, 8, 12, 10, 0, 0);
  // Target: 18:00 (6:00 PM)
  const nextTarget = getNextScheduledLogout('18:00', fromDate);

  // Next target must be Sept 12, 2026 18:00:00
  assert.strictEqual(nextTarget.getFullYear(), 2026);
  assert.strictEqual(nextTarget.getMonth(), 8);
  assert.strictEqual(nextTarget.getDate(), 12);
  assert.strictEqual(nextTarget.getHours(), 18);
  assert.strictEqual(nextTarget.getMinutes(), 0);
});

// ── Test 3: Most Recent Reset Boundary Calculation ───────────────────────────
runTest('getMostRecentScheduledBoundary returns today target when current time is past it', () => {
  // Current time: Sept 12, 2026 10:00 AM
  const fromDate = new Date(2026, 8, 12, 10, 0, 0);
  // Target: 00:00
  const mostRecent = getMostRecentScheduledBoundary('00:00', fromDate);

  assert.strictEqual(mostRecent.getFullYear(), 2026);
  assert.strictEqual(mostRecent.getMonth(), 8);
  assert.strictEqual(mostRecent.getDate(), 12);
  assert.strictEqual(mostRecent.getHours(), 0);
});

runTest('getMostRecentScheduledBoundary returns yesterday target when before today target', () => {
  // Current time: Sept 12, 2026 10:00 AM
  const fromDate = new Date(2026, 8, 12, 10, 0, 0);
  // Target: 18:00 (6:00 PM)
  const mostRecent = getMostRecentScheduledBoundary('18:00', fromDate);

  // At 10:00 AM, today 18:00 has not arrived yet. Most recent was yesterday Sept 11, 18:00
  assert.strictEqual(mostRecent.getFullYear(), 2026);
  assert.strictEqual(mostRecent.getMonth(), 8);
  assert.strictEqual(mostRecent.getDate(), 11);
  assert.strictEqual(mostRecent.getHours(), 18);
});

// ── Test 4: Overnight Sleep/Wake Expiry Detection ────────────────────────────
runTest('isSessionExpiredBySchedule flags sessions crossing 12:00 AM boundary (sleep/wake)', () => {
  // User authenticated yesterday at 10:30 PM (Sept 11, 2026 22:30)
  const authTime = new Date(2026, 8, 11, 22, 30, 0).getTime();
  // Device wakes up today at 8:00 AM (Sept 12, 2026 08:00)
  const wakeTime = new Date(2026, 8, 12, 8, 0, 0);

  const isExpired = isSessionExpiredBySchedule(authTime, '00:00', wakeTime);
  assert.strictEqual(isExpired, true, 'Session from yesterday must expire at 12:00 AM reset boundary');
});

runTest('isSessionExpiredBySchedule keeps active sessions valid before upcoming boundary', () => {
  // User authenticated today at 9:00 AM (Sept 12, 2026 09:00)
  const authTime = new Date(2026, 8, 12, 9, 0, 0).getTime();
  // Current time: today at 11:30 AM (Sept 12, 2026 11:30)
  const currentTime = new Date(2026, 8, 12, 11, 30, 0);

  const isExpired = isSessionExpiredBySchedule(authTime, '00:00', currentTime);
  assert.strictEqual(isExpired, false, 'Session authenticated after most recent 12:00 AM reset is valid');
});

// ── Test 5: Storage Helpers and Mock Environment ─────────────────────────────
runTest('LocalStorage and SessionStorage keys are declared consistently', () => {
  assert.strictEqual(AUTO_LOGOUT_REGISTRY_DOC_ID, 'master_auto_logout_settings_registry');
  assert.strictEqual(SESSION_AUDIT_REGISTRY_DOC_ID, 'master_session_audit_logs_registry');
});

// ── Test 6: Codebase Integration Validation ──────────────────────────────────
runTest('useCloudSync.js declares master_auto_logout_settings_registry in SYSTEM_DOC_IDS', () => {
  const syncFile = fs.readFileSync(path.join(projectRoot, 'src/context/useCloudSync.js'), 'utf8');
  assert.ok(
    syncFile.includes('master_auto_logout_settings_registry'),
    'useCloudSync.js must include master_auto_logout_settings_registry'
  );
  assert.ok(
    syncFile.includes('master_session_audit_logs_registry'),
    'useCloudSync.js must include master_session_audit_logs_registry'
  );
});

runTest('useAuth.js integrates session auth timestamp tracking and cleanup', () => {
  const authFile = fs.readFileSync(path.join(projectRoot, 'src/context/useAuth.js'), 'utf8');
  assert.ok(
    authFile.includes('setSessionAuthTimestamp'),
    'useAuth.js must call setSessionAuthTimestamp on login'
  );
  assert.ok(
    authFile.includes('clearSessionAuthTimestamp'),
    'useAuth.js must call clearSessionAuthTimestamp on signOut'
  );
});

runTest('useAuditLogs.js includes sessionAuditLogs and logSessionAudit', () => {
  const auditFile = fs.readFileSync(path.join(projectRoot, 'src/context/useAuditLogs.js'), 'utf8');
  assert.ok(
    auditFile.includes('sessionAuditLogs'),
    'useAuditLogs.js must declare sessionAuditLogs state'
  );
  assert.ok(
    auditFile.includes('logSessionAudit'),
    'useAuditLogs.js must provide logSessionAudit function'
  );
});

runTest('AppContext.jsx provides useAutoLogout engine and AutoLogoutWarningModal', () => {
  const contextFile = fs.readFileSync(path.join(projectRoot, 'src/context/AppContext.jsx'), 'utf8');
  assert.ok(
    contextFile.includes('useAutoLogout'),
    'AppContext.jsx must invoke useAutoLogout'
  );
  assert.ok(
    contextFile.includes('AutoLogoutWarningModal'),
    'AppContext.jsx must render AutoLogoutWarningModal'
  );
  assert.ok(
    contextFile.includes('autoLogoutConfig:'),
    'AppContext.jsx must expose autoLogoutConfig'
  );
});

runTest('SettingsCatalog.jsx includes Session & Auto-Logout tab and AutoLogoutSettings component', () => {
  const settingsFile = fs.readFileSync(path.join(projectRoot, 'src/components/SettingsCatalog.jsx'), 'utf8');
  assert.ok(
    settingsFile.includes("activeTab === 'security'"),
    'SettingsCatalog.jsx must include security tab condition'
  );
  assert.ok(
    settingsFile.includes('AutoLogoutSettings'),
    'SettingsCatalog.jsx must render AutoLogoutSettings'
  );
});

runTest('Login.jsx includes logout notice display banner', () => {
  const loginFile = fs.readFileSync(path.join(projectRoot, 'src/components/Login.jsx'), 'utf8');
  assert.ok(
    loginFile.includes('getStoredLogoutNotice'),
    'Login.jsx must check getStoredLogoutNotice'
  );
  assert.ok(
    loginFile.includes('Daily Session Reset'),
    'Login.jsx must render Daily Session Reset notice banner'
  );
});

runTest('AuditTrail.jsx includes Session & Auto-Logout activity tab and Excel export', () => {
  const auditTrailFile = fs.readFileSync(path.join(projectRoot, 'src/components/AuditTrail.jsx'), 'utf8');
  assert.ok(
    auditTrailFile.includes("auditTab === 'session_activity'"),
    'AuditTrail.jsx must handle session_activity tab'
  );
  assert.ok(
    auditTrailFile.includes('handleExportSessionLogsXLSX'),
    'AuditTrail.jsx must provide handleExportSessionLogsXLSX'
  );
});

console.log('====================================================');
console.log(`RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('====================================================');

if (failedTests > 0) {
  process.exit(1);
}
