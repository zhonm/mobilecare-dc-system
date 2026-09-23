import { useState, useEffect, useCallback, useRef } from 'react';

// Default 1 hour inactivity threshold (60 minutes = 3,600,000 ms)
export const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
export const INACTIVITY_STORAGE_KEY = 'mdc_last_user_activity_time';
export const INACTIVITY_PAUSED_STORAGE_KEY = 'mdc_is_sync_paused_inactivity';

/**
 * MDC SYSTEM: 1-Hour User Inactivity Watchdog for Cloud Data Sync
 *
 * Detects prolonged user inactivity (1 hour without mouse, keyboard, touch, or scroll interaction).
 * When inactive, halts all automatic background data fetches, heartbeats, and WebSocket listeners
 * to protect the Supabase free-tier egress limit (5 GB/month).
 */
export function useInactivitySyncGuard({
  currentUser = null,
  timeoutMs = INACTIVITY_TIMEOUT_MS,
  onInactivityPause = null,
  onResumeSync = null
} = {}) {
  // Manual page refresh or initial page load counts as active user engagement retrieving latest data.
  // The paused state should never persist across fresh page mounts/refreshes.
  const [isDataSyncPaused, setIsDataSyncPaused] = useState(false);

  const [inactiveDurationMs, setInactiveDurationMs] = useState(0);
  const lastActivityTimeRef = useRef(Date.now());
  const lastEventThrottleTimeRef = useRef(0);
  const isDataSyncPausedRef = useRef(isDataSyncPaused);
  useEffect(() => {
    isDataSyncPausedRef.current = isDataSyncPaused;
  }, [isDataSyncPaused]);

  const onInactivityPauseRef = useRef(onInactivityPause);
  const onResumeSyncRef = useRef(onResumeSync);
  useEffect(() => {
    onInactivityPauseRef.current = onInactivityPause;
    onResumeSyncRef.current = onResumeSync;
  });

  // On page mount / refresh: clear any residual paused flag and reset activity timer
  useEffect(() => {
    const now = Date.now();
    lastActivityTimeRef.current = now;
    lastEventThrottleTimeRef.current = now;
    try {
      localStorage.removeItem(INACTIVITY_PAUSED_STORAGE_KEY);
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
    } catch {}
  }, []);

  // Record user interaction (throttled to at most once every 5 seconds to reduce CPU/Storage overhead)
  const recordUserActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastEventThrottleTimeRef.current < 5000) {
      return;
    }
    lastEventThrottleTimeRef.current = now;
    lastActivityTimeRef.current = now;

    try {
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
    } catch {}
  }, []);

  // Pause data sync
  const pauseDataSync = useCallback((duration = 0) => {
    if (isDataSyncPausedRef.current) return;
    setIsDataSyncPaused(true);
    if (duration > 0) {
      setInactiveDurationMs(duration);
    }
    try {
      localStorage.setItem(INACTIVITY_PAUSED_STORAGE_KEY, 'true');
    } catch {}

    if (typeof onInactivityPauseRef.current === 'function') {
      try {
        onInactivityPauseRef.current();
      } catch (err) {
        console.warn('[InactivityGuard] onInactivityPause note:', err);
      }
    }
  }, []);

  // Resume data sync & reset timer
  const resumeDataSync = useCallback(async () => {
    const now = Date.now();
    lastActivityTimeRef.current = now;
    lastEventThrottleTimeRef.current = now;
    setIsDataSyncPaused(false);
    setInactiveDurationMs(0);

    try {
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
      localStorage.removeItem(INACTIVITY_PAUSED_STORAGE_KEY);
    } catch {}

    if (typeof onResumeSyncRef.current === 'function') {
      try {
        await onResumeSyncRef.current();
      } catch (err) {
        console.warn('[InactivityGuard] onResumeSync note:', err);
      }
    }
  }, []);

  // Reset timer without necessarily triggering onResumeSync
  const resetInactivityTimer = useCallback(() => {
    const now = Date.now();
    lastActivityTimeRef.current = now;
    lastEventThrottleTimeRef.current = now;
    setIsDataSyncPaused(false);
    setInactiveDurationMs(0);

    try {
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
      localStorage.removeItem(INACTIVITY_PAUSED_STORAGE_KEY);
    } catch {}
  }, []);

  // Administrative / Testing trigger to simulate 1-hour inactivity immediately
  const triggerSimulatedInactivity = useCallback(() => {
    const simulatedPastTime = Date.now() - timeoutMs - 5000;
    lastActivityTimeRef.current = simulatedPastTime;
    try {
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(simulatedPastTime));
    } catch {}
    pauseDataSync(timeoutMs + 5000);
  }, [timeoutMs, pauseDataSync]);

  const currentUserId = currentUser?.id || null;

  // DOM Event Listeners for User Activity
  useEffect(() => {
    if (!currentUserId) return;

    const handleActivity = () => {
      if (!isDataSyncPausedRef.current) {
        recordUserActivity();
      }
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    events.forEach(ev => window.addEventListener(ev, handleActivity, { passive: true }));

    return () => {
      events.forEach(ev => window.removeEventListener(ev, handleActivity));
    };
  }, [currentUserId, recordUserActivity]);

  // Periodic Inactivity Checker (evaluates every 10 seconds)
  useEffect(() => {
    if (!currentUserId) return;

    const checkInactivity = () => {
      const now = Date.now();
      let lastAct = lastActivityTimeRef.current;

      try {
        const stored = localStorage.getItem(INACTIVITY_STORAGE_KEY);
        const parsed = stored ? parseInt(stored, 10) : 0;
        if (parsed > lastAct) {
          lastAct = parsed;
          lastActivityTimeRef.current = parsed;
        }
      } catch {}

      const elapsed = Math.max(0, now - lastAct);

      if (elapsed >= timeoutMs && !isDataSyncPausedRef.current) {
        console.info(`[InactivityGuard] User inactive for ${Math.round(elapsed / 60000)} minutes (>= 60 mins). Pausing cloud auto-loading.`);
        pauseDataSync(elapsed);
      }
    };

    // Check on mount/setup
    checkInactivity();

    const intervalId = setInterval(checkInactivity, 10000);

    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
    };
  }, [currentUserId, timeoutMs, pauseDataSync]);

  return {
    isDataSyncPaused,
    inactiveDurationMs,
    timeoutMs,
    recordUserActivity,
    resumeDataSync,
    resetInactivityTimer,
    triggerSimulatedInactivity
  };
}
