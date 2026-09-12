import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { clearOperationalLocalStorage } from '../utils/cacheManager';
import {
  AUTO_LOGOUT_REGISTRY_DOC_ID,
  getStoredAutoLogoutConfig,
  saveStoredAutoLogoutConfig,
  getSessionAuthTimestamp,
  setSessionAuthTimestamp,
  clearSessionAuthTimestamp,
  setStoredLogoutNotice,
  getNextScheduledLogout,
  isSessionExpiredBySchedule,
  formatConfigTimeTo12Hour,
  formatLocalTime
} from '../utils/autoLogoutManager';

export function useAutoLogout({
  currentUser,
  signOut,
  autoRefreshData,
  broadcastCloudEvent,
  logSessionAudit,
  showToast
}) {
  const [autoLogoutConfig, setAutoLogoutConfig] = useState(() => getStoredAutoLogoutConfig());
  const [timeRemainingMs, setTimeRemainingMs] = useState(null);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);

  // Store mutable external references to keep callbacks stable
  const currentUserRef = useRef(currentUser);
  const signOutRef = useRef(signOut);
  const autoRefreshDataRef = useRef(autoRefreshData);
  const broadcastCloudEventRef = useRef(broadcastCloudEvent);
  const logSessionAuditRef = useRef(logSessionAudit);
  const showToastRef = useRef(showToast);
  const autoLogoutConfigRef = useRef(autoLogoutConfig);

  useEffect(() => {
    currentUserRef.current = currentUser;
    signOutRef.current = signOut;
    autoRefreshDataRef.current = autoRefreshData;
    broadcastCloudEventRef.current = broadcastCloudEvent;
    logSessionAuditRef.current = logSessionAudit;
    showToastRef.current = showToast;
    autoLogoutConfigRef.current = autoLogoutConfig;
  });

  // Ref to track user dismissal of the warning prompt during the current cycle
  const hasUserDismissedThisCycleRef = useRef(false);
  const lastTargetTimestampRef = useRef(null);
  const lastReportedMinuteRef = useRef(null);
  const isLoggingOutRef = useRef(false);

  // 1. Synchronize config with IndexedDB on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const idbConfig = await dbStorage.getItem('mdc_auto_logout_settings');
        if (isMounted && idbConfig && typeof idbConfig === 'object') {
          setAutoLogoutConfig(prev => {
            if (prev && JSON.stringify(prev) === JSON.stringify({ ...prev, ...idbConfig })) {
              return prev;
            }
            return {
              ...prev,
              ...idbConfig
            };
          });
        }
      } catch (e) {}
    })();
    return () => { isMounted = false; };
  }, []);

  // 2. Core Session Expiration & Auto-Logout Execution
  const executeAutoLogout = useCallback(async (reason = 'SCHEDULED_DAILY_RESET') => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    const currentConfig = autoLogoutConfigRef.current;
    const user = currentUserRef.current;
    const localTimeStr = formatLocalTime(new Date());
    const scheduledTimeStr = formatConfigTimeTo12Hour(currentConfig.logout_time);

    // Save notice for the Login screen banner
    setStoredLogoutNotice({
      reason,
      scheduledTime: scheduledTimeStr,
      deviceLocalTime: localTimeStr,
      timestamp: new Date().toISOString(),
      message: `Your session ended at ${localTimeStr} pursuant to the daily ${scheduledTimeStr} session refresh policy. Re-authenticate to access updated system records.`
    });

    // Write audit log entry before clearing credentials
    if (typeof logSessionAuditRef.current === 'function' && user) {
      try {
        await logSessionAuditRef.current({
          action: 'AUTO_LOGOUT',
          reason: reason === 'SCHEDULED_DAILY_RESET_ON_WAKE'
            ? 'Scheduled Daily Reset (Device Wake from Inactivity/Sleep)'
            : 'Scheduled Daily Reset (12:00 AM Local Device Policy)',
          details: {
            scheduledTime: scheduledTimeStr,
            deviceLocalTime: localTimeStr,
            policyLogoutTime: currentConfig.logout_time,
            clearedCache: currentConfig.clear_cache_on_logout
          }
        });
      } catch (err) {
        console.warn('Could not log auto-logout audit:', err);
      }
    }

    // Clean up session auth tracking
    clearSessionAuthTimestamp();
    setIsWarningOpen(false);

    // Clear operational storage to prevent stale cached data on device
    if (currentConfig.clear_cache_on_logout) {
      try {
        await clearOperationalLocalStorage({ keepSession: false });
      } catch (err) {
        console.warn('Operational storage purge error on auto-logout:', err);
      }
    }

    // Invoke sign out
    try {
      if (typeof signOutRef.current === 'function') {
        await signOutRef.current();
      }
    } catch (e) {
      console.warn('Error during auto-logout signOut:', e);
    } finally {
      isLoggingOutRef.current = false;
    }
  }, []);

  // 3. Active Session Refresh Handler (Grace Period User Action)
  const refreshSession = useCallback(async () => {
    setIsRefreshingSession(true);
    try {
      // 1. Refresh live data from Supabase Cloud to ensure 100% freshness
      if (typeof autoRefreshDataRef.current === 'function') {
        await autoRefreshDataRef.current();
      }

      // 2. Extend current session authentication timestamp to current time
      const now = Date.now();
      setSessionAuthTimestamp(now);

      // 3. Reset warning modal and cycle state
      setIsWarningOpen(false);
      setIsTestMode(false);
      hasUserDismissedThisCycleRef.current = false;

      // 4. Audit Log
      const user = currentUserRef.current;
      if (typeof logSessionAuditRef.current === 'function' && user) {
        await logSessionAuditRef.current({
          action: 'SESSION_REFRESH',
          reason: 'User refreshed session during advance grace period',
          details: {
            refreshedAt: new Date().toISOString(),
            deviceLocalTime: formatLocalTime(new Date()),
            extendedUntilNextScheduledBoundary: true
          }
        });
      }

      if (typeof showToastRef.current === 'function') {
        showToastRef.current('Session refreshed! System records updated to latest cloud state.', 'success');
      }
    } catch (err) {
      console.error('Session refresh failed:', err);
      if (typeof showToastRef.current === 'function') {
        showToastRef.current('Session refresh encountered a sync notice, but session was extended.', 'info');
      }
    } finally {
      setIsRefreshingSession(false);
    }
  }, []);

  // 4. Manual / Administrative Configuration Update
  const updateAutoLogoutConfig = useCallback(async (newSettings) => {
    const user = currentUserRef.current;
    const currentConfig = autoLogoutConfigRef.current;
    const updated = {
      ...currentConfig,
      ...newSettings,
      updated_at: new Date().toISOString(),
      updated_by: user?.fullName || user?.email || 'Admin'
    };

    setAutoLogoutConfig(updated);
    saveStoredAutoLogoutConfig(updated);

    try {
      await dbStorage.setItem('mdc_auto_logout_settings', updated);
    } catch (e) {}

    // Cloud Persistence to Supabase saved_records registry
    if (supabase) {
      try {
        await supabase.from('saved_records').upsert({
          id: AUTO_LOGOUT_REGISTRY_DOC_ID,
          record_type: 'auto_logout_settings',
          period_label: 'Master Auto-Logout & Session Policy Directive',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master Automated Scheduled Logout & Session Expiration Directive',
          snapshot_data: updated,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('Sync master_auto_logout_settings_registry note:', err);
      }
    }

    // Broadcast across realtime channels so all user tabs update their timer
    if (typeof broadcastCloudEventRef.current === 'function') {
      broadcastCloudEventRef.current('AUTO_LOGOUT_SETTINGS_UPDATED', updated);
    }

    // Audit policy modification
    if (typeof logSessionAuditRef.current === 'function' && user) {
      try {
        await logSessionAuditRef.current({
          action: 'AUTO_LOGOUT_POLICY_UPDATED',
          reason: 'Administrator updated automated session expiration policy',
          details: updated
        });
      } catch (e) {}
    }

    if (typeof showToastRef.current === 'function') {
      showToastRef.current('Session policy settings saved successfully.', 'success');
    }
  }, []);

  const currentUserId = currentUser?.id || null;
  const isUserLoggedIn = Boolean(currentUser);
  const isEnabled = autoLogoutConfig.enabled;
  const logoutTime = autoLogoutConfig.logout_time;
  const warningLeadMinutes = autoLogoutConfig.warning_lead_minutes || 5;

  // 5. Reactive Timer & Wake/Sleep Monitor
  useEffect(() => {
    if (!isUserLoggedIn || !isEnabled) {
      setTimeRemainingMs(prev => prev === null ? prev : null);
      setIsWarningOpen(prev => prev === false ? prev : false);
      return;
    }

    // Ensure session auth timestamp exists
    let currentAuthTs = getSessionAuthTimestamp();
    if (!currentAuthTs) {
      currentAuthTs = Date.now();
      setSessionAuthTimestamp(currentAuthTs);
    }

    // Core check function
    const evaluateSessionSchedule = () => {
      if (isLoggingOutRef.current) return;

      const now = new Date();
      const authTs = getSessionAuthTimestamp();

      // Check for overnight sleep / wake boundary crossing
      if (authTs && isSessionExpiredBySchedule(authTs, logoutTime, now)) {
        executeAutoLogout('SCHEDULED_DAILY_RESET_ON_WAKE');
        return;
      }

      // Calculate upcoming target
      const nextTarget = getNextScheduledLogout(logoutTime, now);
      const remainingMs = Math.max(0, nextTarget.getTime() - now.getTime());

      // Reset cycle dismissal flag if target time has shifted
      if (lastTargetTimestampRef.current !== nextTarget.getTime()) {
        lastTargetTimestampRef.current = nextTarget.getTime();
        hasUserDismissedThisCycleRef.current = false;
      }

      const warningLeadMs = warningLeadMinutes * 60 * 1000;

      // Check if target is reached or passed
      if (remainingMs <= 0) {
        executeAutoLogout('SCHEDULED_DAILY_RESET');
        return;
      }

      // Check if within advance grace period warning window
      const inWarningWindow = remainingMs <= warningLeadMs;
      if (inWarningWindow) {
        if (!hasUserDismissedThisCycleRef.current && !isTestMode) {
          setIsWarningOpen(true);
        }
      } else {
        if (!isTestMode) {
          setIsWarningOpen(false);
        }
      }

      // Smooth countdown when modal is open or in test mode; throttled by minute otherwise
      const currentMinute = Math.floor(remainingMs / 60000);
      if (isWarningOpen || isTestMode) {
        setTimeRemainingMs(remainingMs);
      } else if (lastReportedMinuteRef.current !== currentMinute) {
        lastReportedMinuteRef.current = currentMinute;
        setTimeRemainingMs(remainingMs);
      }
    };

    // Immediate check on effect run
    evaluateSessionSchedule();

    // Use 1-second interval when modal is open or in test mode; 10 seconds in background
    const intervalMs = (isWarningOpen || isTestMode) ? 1000 : 10000;
    const intervalId = setInterval(evaluateSessionSchedule, intervalMs);

    // Event listeners to instantly check when device wakes from sleep or tab regains focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        evaluateSessionSchedule();
      }
    };
    const handleFocus = () => {
      evaluateSessionSchedule();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [
    isUserLoggedIn,
    currentUserId,
    isEnabled,
    logoutTime,
    warningLeadMinutes,
    isWarningOpen,
    isTestMode,
    executeAutoLogout
  ]);

  // 6. User Warning Interaction Helpers
  const dismissWarning = useCallback(() => {
    hasUserDismissedThisCycleRef.current = true;
    setIsWarningOpen(false);
    setIsTestMode(false);
  }, []);

  // 7. Administrative Test Utilities
  const triggerTestWarning = useCallback(() => {
    setIsTestMode(true);
    setTimeRemainingMs(60 * 1000); // 60 seconds test countdown
    setIsWarningOpen(true);
    hasUserDismissedThisCycleRef.current = false;
  }, []);

  const triggerTestAutoLogout = useCallback(() => {
    executeAutoLogout('ADMINISTRATIVE_TEST_AUTO_LOGOUT');
  }, [executeAutoLogout]);

  return {
    autoLogoutConfig,
    setAutoLogoutConfig,
    updateAutoLogoutConfig,
    timeRemainingMs,
    isWarningOpen,
    isRefreshingSession,
    refreshSession,
    dismissWarning,
    executeAutoLogout,
    triggerTestWarning,
    triggerTestAutoLogout
  };
}
