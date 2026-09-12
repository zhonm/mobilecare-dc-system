/**
 * MDC SYSTEM 2: Automated Scheduled Logout & Session Refresh Policy Manager
 *
 * Enforces automatic user logout at scheduled daily times (defaults to 12:00 AM local device time).
 * Clears operational cached data to prevent stale states, displays advance grace period warnings,
 * allows active users to refresh session/data, and logs audit events.
 */

export const DEFAULT_AUTO_LOGOUT_CONFIG = {
  enabled: true,
  logout_time: '00:00', // 12:00 AM Midnight (Device Local Time)
  warning_lead_minutes: 5, // 5 minutes advance warning
  allow_session_refresh: true, // Allow active users to refresh data & extend session
  clear_cache_on_logout: true, // Purge operational caches upon auto-logout
  enforce_office_hours: false,
  updated_at: null,
  updated_by: 'System Default'
};

export const AUTO_LOGOUT_PRESET_TIMES = [
  { label: '12:00 AM (Midnight - Default)', value: '00:00' },
  { label: '11:00 PM (Night End)', value: '23:00' },
  { label: '01:00 AM (Late Night)', value: '01:00' },
  { label: '06:00 PM (End of Shift)', value: '18:00' },
  { label: '08:00 PM (Evening Close)', value: '20:00' }
];

export const AUTO_LOGOUT_STORAGE_KEY = 'mdc_auto_logout_settings';
export const SESSION_AUTH_TIMESTAMP_KEY = 'mdc_session_auth_timestamp';
export const LOGOUT_NOTICE_KEY = 'mdc_logout_notice';
export const AUTO_LOGOUT_REGISTRY_DOC_ID = 'master_auto_logout_settings_registry';
export const SESSION_AUDIT_REGISTRY_DOC_ID = 'master_session_audit_logs_registry';

/**
 * Parses a "HH:MM" 24-hour time string into hours and minutes.
 */
export function parseTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return { hours: 0, minutes: 0 };
  const parts = timeStr.trim().split(':');
  const hours = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
  const minutes = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));
  return { hours, minutes };
}

/**
 * Calculates the next upcoming scheduled logout Date object based on device local time.
 */
export function getNextScheduledLogout(logoutTime = '00:00', fromDate = new Date()) {
  const { hours, minutes } = parseTime(logoutTime);
  const target = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
    hours,
    minutes,
    0,
    0
  );

  // If target time today has already passed, advance to tomorrow
  if (fromDate.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target;
}

/**
 * Calculates the most recent scheduled reset boundary Date object based on device local time.
 */
export function getMostRecentScheduledBoundary(logoutTime = '00:00', fromDate = new Date()) {
  const { hours, minutes } = parseTime(logoutTime);
  const targetToday = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
    hours,
    minutes,
    0,
    0
  );

  if (fromDate.getTime() >= targetToday.getTime()) {
    return targetToday;
  }

  // If currently before target today, the most recent boundary was yesterday's target
  const targetYesterday = new Date(targetToday);
  targetYesterday.setDate(targetYesterday.getDate() - 1);
  return targetYesterday;
}

/**
 * Determines whether an active session is expired based on whether it was authenticated
 * before the most recent scheduled auto-logout boundary.
 *
 * Example:
 * If user logged in at 10:00 PM yesterday, and it is now 8:00 AM today (after 12:00 AM reset),
 * the session crossed the 12:00 AM boundary and is expired.
 */
export function isSessionExpiredBySchedule(sessionAuthTime, logoutTime = '00:00', fromDate = new Date()) {
  if (!sessionAuthTime) return false;

  const authTimeMs = typeof sessionAuthTime === 'number'
    ? sessionAuthTime
    : new Date(sessionAuthTime).getTime();

  if (isNaN(authTimeMs) || authTimeMs <= 0) return false;

  const mostRecentBoundary = getMostRecentScheduledBoundary(logoutTime, fromDate);
  return authTimeMs < mostRecentBoundary.getTime();
}

/**
 * Formats a millisecond duration into a clean countdown string (e.g. "04:59" or "00:32").
 */
export function formatRemainingTime(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats a Date into standard 12-hour device local time (e.g., "12:00 AM", "11:45 PM").
 */
export function formatLocalTime(date = new Date()) {
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch {
    return date.toLocaleTimeString();
  }
}

/**
 * Formats a 24-hour "HH:MM" string to standard 12-hour display (e.g., "00:00" -> "12:00 AM").
 */
export function formatConfigTimeTo12Hour(timeStr = '00:00') {
  const { hours, minutes } = parseTime(timeStr);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinutes = String(minutes).padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${period}`;
}

/**
 * Storage Helpers
 */
export function getStoredAutoLogoutConfig() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_AUTO_LOGOUT_CONFIG };
    const raw = window.localStorage.getItem(AUTO_LOGOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTO_LOGOUT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_AUTO_LOGOUT_CONFIG,
      ...parsed
    };
  } catch (e) {
    return { ...DEFAULT_AUTO_LOGOUT_CONFIG };
  }
}

export function saveStoredAutoLogoutConfig(config) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AUTO_LOGOUT_STORAGE_KEY, JSON.stringify(config));
    }
  } catch (e) {
    console.warn('Could not save auto-logout config locally:', e);
  }
}

export function getSessionAuthTimestamp() {
  try {
    if (typeof window === 'undefined') return null;
    const val = window.localStorage?.getItem(SESSION_AUTH_TIMESTAMP_KEY) ||
      window.sessionStorage?.getItem(SESSION_AUTH_TIMESTAMP_KEY);
    if (!val) return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

export function setSessionAuthTimestamp(ts = Date.now()) {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(SESSION_AUTH_TIMESTAMP_KEY, String(ts));
      window.sessionStorage?.setItem(SESSION_AUTH_TIMESTAMP_KEY, String(ts));
    }
  } catch (e) {
    console.warn('Could not set session auth timestamp:', e);
  }
}

export function clearSessionAuthTimestamp() {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.removeItem(SESSION_AUTH_TIMESTAMP_KEY);
      window.sessionStorage?.removeItem(SESSION_AUTH_TIMESTAMP_KEY);
    }
  } catch (e) {}
}

export function getStoredLogoutNotice() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(LOGOUT_NOTICE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredLogoutNotice(notice) {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(LOGOUT_NOTICE_KEY, JSON.stringify(notice));
    }
  } catch (e) {}
}

export function clearStoredLogoutNotice() {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(LOGOUT_NOTICE_KEY);
    }
  } catch (e) {}
}
