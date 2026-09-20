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
  const [isDataSyncPaused, setIsDataSyncPaused] = useState(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      const storedPaused = localStorage.getItem(INACTIVITY_PAUSED_STORAGE_KEY);
      if (storedPaused === 'true') {
        const lastAct = parseInt(localStorage.getItem(INACTIVITY_STORAGE_KEY) || '0', 10);
        if (lastAct > 0 && Date.now() - lastAct >= timeoutMs) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  });

  const [inactiveDurationMs, setInactiveDurationMs] = useState(0);
  const lastActivityTimeRef = useRef(Date.now());
  const lastEventThrottleTimeRef = useRef(0);
  const checkIntervalRef = useRef(null);

  // Synchronize initial last activity timestamp from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(INACTIVITY_STORAGE_KEY);
      const parsed = stored ? parseInt(stored, 10) : 0;
      if (parsed > 0 && parsed <= Date.now()) {
        lastActivityTimeRef.current = parsed;
      } else {
        const now = Date.now();
        lastActivityTimeRef.current = now;
        localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
      }
    } catch {
      lastActivityTimeRef.current = Date.now();
    }
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
  const pauseDataSync = useCallback(() => {
    setIsDataSyncPaused(true);
    try {
      localStorage.setItem(INACTIVITY_PAUSED_STORAGE_KEY, 'true');
    } catch {}

    if (typeof onInactivityPause === 'function') {
      try {
        onInactivityPause();
      } catch (err) {
        console.warn('[InactivityGuard] onInactivityPause note:', err);
      }
    }
  }, [onInactivityPause]);

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

    if (typeof onResumeSync === 'function') {
      try {
        await onResumeSync();
      } catch (err) {
        console.warn('[InactivityGuard] onResumeSync note:', err);
      }
    }
  }, [onResumeSync]);

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
    pauseDataSync();
  }, [timeoutMs, pauseDataSync]);

  // DOM Event Listeners for User Activity
  useEffect(() => {
    if (!currentUser) return;

    // Listen only when not already paused
    const handleActivity = () => {
      if (!isDataSyncPaused) {
        recordUserActivity();
      }
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    events.forEach(ev => window.addEventListener(ev, handleActivity, { passive: true }));

    return () => {
      events.forEach(ev => window.removeEventListener(ev, handleActivity));
    };
  }, [currentUser, isDataSyncPaused, recordUserActivity]);

  // Periodic Inactivity Checker (evaluates every 10 seconds)
  useEffect(() => {
    if (!currentUser) {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      return;
    }

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
      setInactiveDurationMs(elapsed);

      if (elapsed >= timeoutMs && !isDataSyncPaused) {
        console.info(`[InactivityGuard] User inactive for ${Math.round(elapsed / 60000)} minutes (>= 60 mins). Pausing cloud auto-loading.`);
        pauseDataSync();
      }
    };

    // Check immediately on mount/focus
    checkInactivity();

    checkIntervalRef.current = setInterval(checkInactivity, 10000);

    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
    };
  }, [currentUser, isDataSyncPaused, timeoutMs, pauseDataSync]);

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
