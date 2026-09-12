import { useState, useEffect } from 'react';
import {
  Clock,
  RefreshCw,
  LogOut,
  X,
  ShieldAlert
} from 'lucide-react';
import {
  formatRemainingTime,
  formatLocalTime,
  formatConfigTimeTo12Hour
} from '../utils/autoLogoutManager';

export default function AutoLogoutWarningModal({
  isOpen,
  timeRemainingMs,
  autoLogoutConfig,
  isRefreshingSession,
  onRefreshSession,
  onLogoutNow,
  onDismiss
}) {
  const [currentDeviceTime, setCurrentDeviceTime] = useState(() => formatLocalTime(new Date()));

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setCurrentDeviceTime(formatLocalTime(new Date()));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const remainingFormatted = formatRemainingTime(timeRemainingMs);
  const scheduledTime12Hour = formatConfigTimeTo12Hour(autoLogoutConfig?.logout_time || '00:00');
  const isUrgent = typeof timeRemainingMs === 'number' && timeRemainingMs <= 60000; // Less than 1 minute

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(5px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      <div
        style={{
          background: '#1e293b',
          border: isUrgent ? '2px solid #ef4444' : '2px solid #f59e0b',
          borderRadius: '16px',
          boxShadow: isUrgent
            ? '0 25px 50px -12px rgba(239, 68, 68, 0.35)'
            : '0 25px 50px -12px rgba(245, 158, 11, 0.25)',
          maxWidth: '480px',
          width: '100%',
          padding: '24px',
          color: '#f8fafc',
          position: 'relative'
        }}
      >
        {/* Dismiss 'X' Button */}
        <button
          type="button"
          onClick={onDismiss}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Dismiss warning modal (auto-logout still triggers at 00:00)"
        >
          <X size={18} />
        </button>

        {/* Header with Icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: isUrgent ? '#fee2e2' : '#fef3c7',
              color: isUrgent ? '#dc2626' : '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {isUrgent ? <ShieldAlert size={26} /> : <Clock size={26} />}
          </div>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Scheduled Session Reset Approaching
            </h3>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              Daily Policy: Automatic Logout at {scheduledTime12Hour} (Local Time)
            </span>
          </div>
        </div>

        {/* Countdown Box */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '12px',
            padding: '16px',
            textAlign: 'center',
            marginBottom: '16px'
          }}
        >
          <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
            Auto-Logout Countdown
          </div>
          <div
            style={{
              fontSize: '42px',
              fontWeight: 900,
              fontFamily: 'var(--font-mono, monospace)',
              color: isUrgent ? '#f87171' : '#fbbf24',
              margin: '4px 0',
              textShadow: isUrgent ? '0 0 20px rgba(239, 68, 68, 0.4)' : 'none'
            }}
          >
            {remainingFormatted}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#64748b' }}>
            <span>Device Local Time:</span>
            <strong style={{ color: '#cbd5e1' }}>{currentDeviceTime}</strong>
          </div>
        </div>

        {/* Explanatory Policy Notice */}
        <div
          style={{
            background: 'rgba(2, 132, 199, 0.1)',
            border: '1px solid rgba(2, 132, 199, 0.25)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '20px',
            fontSize: '12.5px',
            color: '#93c5fd',
            lineHeight: 1.5
          }}
        >
          To maintain data accuracy, purge outdated device caches, and enforce non-office hours security,
          your active session will end. Any uncommitted draft scans or records should be finalized now.
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {autoLogoutConfig?.allow_session_refresh && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRefreshSession}
              disabled={isRefreshingSession}
              style={{
                width: '100%',
                padding: '11px 16px',
                fontSize: '13.5px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                cursor: isRefreshingSession ? 'not-allowed' : 'pointer'
              }}
            >
              {isRefreshingSession ? (
                <>
                  <RefreshCw size={16} className="spin" />
                  <span>Syncing Fresh Data &amp; Refreshing Session...</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  <span>Refresh Data &amp; Stay Logged In</span>
                </>
              )}
            </button>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onLogoutNow}
              style={{
                flex: 1,
                padding: '9px 14px',
                fontSize: '12.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: '#334155',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              <LogOut size={14} />
              <span>Log Out &amp; Clear Cache Now</span>
            </button>

            <button
              type="button"
              onClick={onDismiss}
              style={{
                padding: '9px 14px',
                fontSize: '12.5px',
                fontWeight: 600,
                background: 'transparent',
                color: '#94a3b8',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
