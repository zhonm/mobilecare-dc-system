import { useState, useEffect } from 'react';
import {
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  ZapOff,
  Database
} from 'lucide-react';

export default function InactivityRefreshModal({
  isOpen,
  onResumeSync,
  inactiveDurationMs = 3600000
}) {
  const [isResuming, setIsResuming] = useState(false);

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRefreshPage = () => {
    // Clear the paused flag in localStorage so it re-mounts clean
    try {
      localStorage.removeItem('mdc_is_sync_paused_inactivity');
      localStorage.setItem('mdc_last_user_activity_time', String(Date.now()));
    } catch {}
    window.location.reload();
  };

  const handleResumeLiveSync = async () => {
    if (typeof onResumeSync === 'function') {
      setIsResuming(true);
      try {
        await onResumeSync();
      } finally {
        setIsResuming(false);
      }
    } else {
      handleRefreshPage();
    }
  };

  const inactiveMinutes = Math.max(60, Math.round((inactiveDurationMs || 3600000) / 60000));

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.25s ease-out'
      }}
    >
      <div
        style={{
          background: '#1e293b',
          border: '2px solid #38bdf8',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(14, 165, 233, 0.35), 0 0 0 1px rgba(56, 189, 248, 0.2)',
          maxWidth: '520px',
          width: '100%',
          padding: '28px',
          color: '#f8fafc',
          position: 'relative',
          fontFamily: 'inherit'
        }}
      >
        {/* Header with Icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 4px 12px rgba(2, 132, 199, 0.4)'
            }}
          >
            <PauseCircle size={30} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ fontSize: '19px', fontWeight: 800, margin: 0, color: '#f8fafc', letterSpacing: '-0.01em' }}>
                Data Sync Paused
              </h3>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)'
                }}
              >
                Inactivity Defense
              </span>
            </div>
            <span style={{ fontSize: '13px', color: '#94a3b8', display: 'block', marginTop: '2px' }}>
              Inactive for {inactiveMinutes >= 60 ? `${Math.floor(inactiveMinutes / 60)} hour${Math.floor(inactiveMinutes / 60) > 1 ? 's' : ''}` : `${inactiveMinutes} minutes`}
            </span>
          </div>
        </div>

        {/* Informative Explanation */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '14px',
            padding: '16px',
            marginBottom: '20px',
            fontSize: '13px',
            color: '#cbd5e1',
            lineHeight: 1.55
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
            <ZapOff size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ color: '#f8fafc' }}>Automatic background queries are halted.</strong>
              <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '2px' }}>
                Because you have been inactive for over 1 hour, the system stopped auto-loading data from Supabase to conserve cloud bandwidth and stay within the free-tier limit.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', paddingTop: '10px', borderTop: '1px solid #1e293b' }}>
            <Database size={18} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              Please refresh to re-establish live cloud synchronization and retrieve the latest inventory, shipments, and parts allocations.
            </div>
          </div>
        </div>

        {/* Protection Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#6ee7b7',
            marginBottom: '22px'
          }}
        >
          <ShieldCheck size={16} color="#10b981" />
          <span>Bandwidth Guard: 0 bytes consumed while inactive.</span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Primary Button: Refresh Page */}
          <button
            type="button"
            onClick={handleRefreshPage}
            style={{
              width: '100%',
              padding: '12px 18px',
              fontSize: '14px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
              transition: 'transform 0.1s, opacity 0.1s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.95'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            <RefreshCw size={17} />
            <span>Refresh Page &amp; Retrieve Data</span>
          </button>

          {/* Secondary Button: Resume Live Sync without full reload */}
          <button
            type="button"
            onClick={handleResumeLiveSync}
            disabled={isResuming}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: '#334155',
              color: '#f8fafc',
              border: '1px solid #475569',
              borderRadius: '10px',
              cursor: isResuming ? 'not-allowed' : 'pointer',
              opacity: isResuming ? 0.6 : 1,
              transition: 'background 0.15s'
            }}
            onMouseEnter={(e) => { if (!isResuming) e.currentTarget.style.background = '#3f516d'; }}
            onMouseLeave={(e) => { if (!isResuming) e.currentTarget.style.background = '#334155'; }}
          >
            <RefreshCw size={15} className={isResuming ? 'spin' : ''} />
            <span>{isResuming ? 'Syncing Cloud Data...' : 'Resume Live Sync in Current View'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
