/**
 * MDC System 2 - Storage & Cache Clearance and Hard Refresh Manager
 * Ensures that operational caches (forecasts, allocations, overrides, period states)
 * are systematically cleared on data upload or manual hard sync, while preserving
 * active user authentication credentials and session tokens.
 */

import { dbStorage } from './dbStorage.js';

/**
 * List of keys that must NEVER be deleted during operational cache wipes
 * to ensure the user stays securely logged in.
 */
const PRESERVED_SESSION_KEYS = [
  'mdc_current_user',
  'mdc_session_sig',
  'mdc_users',
  'mdc_deleted_user_ids',
  'mdc_sec_rate_limit',
  'mdc_forecasting_model',
  'mdc_default_forecasting_model',
  'mdc_allocation_mode',
  'mdc_filter_scope'
];

/**
 * Checks whether a key is an auth/session key that must be kept.
 */
function isPreservedKey(key) {
  if (!key) return false;
  if (PRESERVED_SESSION_KEYS.includes(key)) return true;
  if (key.startsWith('sb-') || key.includes('supabase.auth') || key.includes('turnstile')) {
    return true;
  }
  return false;
}

/**
 * Systematically clears all operational localStorage and sessionStorage caches,
 * resets IndexedDB operational app state, and configures target period/tab.
 *
 * @param {Object} options
 * @param {boolean} [options.keepSession=true] - Whether to preserve user login session
 * @param {Object} [options.preservePeriod=null] - New active period to persist after cache wipe
 * @param {string} [options.targetTab=null] - Target navigation tab (e.g. 'forecast' or 'allocation')
 */
export async function clearOperationalLocalStorage({
  keepSession = true,
  preservePeriod = null,
  targetTab = null
} = {}) {
  try {
    // 1. Snapshot preserved session keys from localStorage
    const preservedLocal = new Map();
    if (typeof window !== 'undefined' && window.localStorage && keepSession) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && isPreservedKey(key)) {
          preservedLocal.set(key, window.localStorage.getItem(key));
        }
      }
    }

    // 2. Clear operational keys from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (keepSession && isPreservedKey(key)) continue;
        // Operational caches and flags to wipe
        if (
          key.startsWith('mdc_') ||
          key.startsWith('excel_') ||
          key.startsWith('cache_') ||
          key.startsWith('parsed_') ||
          key.startsWith('report_')
        ) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(k => {
        try {
          window.localStorage.removeItem(k);
        } catch (e) {}
      });

      // Restore preserved session credentials
      preservedLocal.forEach((val, k) => {
        try {
          window.localStorage.setItem(k, val);
        } catch (e) {}
      });

      // Persist active period if provided
      if (preservePeriod && typeof preservePeriod === 'object') {
        try {
          window.localStorage.setItem('mdc_active_period', JSON.stringify(preservePeriod));
          if (preservePeriod.month) {
            window.localStorage.setItem('mdc_selected_ingestion_month', String(preservePeriod.month - 1));
          }
        } catch (e) {}
      }

      // Persist target tab if provided
      if (targetTab) {
        try {
          window.localStorage.setItem('mdc_active_tab', targetTab);
        } catch (e) {}
      }
    }

    // 3. Clear operational sessionStorage (preserving user session)
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const preservedSession = new Map();
      if (keepSession) {
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key && isPreservedKey(key)) {
            preservedSession.set(key, window.sessionStorage.getItem(key));
          }
        }
      }

      window.sessionStorage.clear();

      preservedSession.forEach((val, k) => {
        try {
          window.sessionStorage.setItem(k, val);
        } catch (e) {}
      });
    }

    // 4. Clear IndexedDB operational state
    try {
      if (dbStorage && typeof dbStorage.clearOperationalCache === 'function') {
        await dbStorage.clearOperationalCache(keepSession ? PRESERVED_SESSION_KEYS : []);
      }
    } catch (dbErr) {
      console.debug('IndexedDB operational cache clearance note:', dbErr);
    }
  } catch (err) {
    console.warn('Error during clearOperationalLocalStorage:', err);
  }
}

/**
 * Performs a hard refresh of the application, busting browser caching with a timestamp
 * and navigating to the specified tab.
 *
 * @param {string} [targetTab='forecast'] - The target tab to navigate to (e.g. 'forecast')
 * @param {number} [delayMs=400] - Delay in milliseconds before executing the reload
 */
export function performHardRefresh(targetTab = 'forecast', delayMs = 400) {
  if (typeof window === 'undefined') return;

  setTimeout(() => {
    try {
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('_sync', String(Date.now()));
      if (targetTab) {
        currentUrl.hash = `#${targetTab}`;
      }
      // Use replace to ensure the hard reload is immediate and cleanly updates history
      window.location.replace(currentUrl.toString());
    } catch (e) {
      // Fallback reload
      if (targetTab) {
        window.location.hash = `#${targetTab}`;
      }
      window.location.reload();
    }
  }, delayMs);
}
