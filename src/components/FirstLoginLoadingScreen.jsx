import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Cloud,
  Database,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  Sparkles,
  Layers,
  Boxes
} from 'lucide-react';
import mobileCareLogo from '../assets/mobilecare_logo.png';

const SYNC_STEPS = [
  { id: 'auth', label: 'Authenticating cloud session & role permissions', icon: ShieldCheck },
  { id: 'catalog', label: 'Hydrating parts catalog, sites & master settings', icon: Layers },
  { id: 'inventory', label: 'Syncing live inventory units & intake batches', icon: Boxes },
  { id: 'forecasts', label: 'Restoring live demand forecasts & branch allocations', icon: Database },
  { id: 'finalize', label: 'Finalizing workspace environment', icon: Sparkles }
];

export default function FirstLoginLoadingScreen() {
  const {
    currentUser,
    hydrateFromSupabase,
    setIsInitialSyncing,
    showToast
  } = useApp();

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [progressPct, setProgressPct] = useState(15);
  const [syncStatus, setSyncStatus] = useState('syncing'); // 'syncing' | 'completed' | 'error'
  const [errorMessage, setErrorMessage] = useState('');

  const syncInitiatedRef = useRef(false);

  const performInitialHydration = async () => {
    setSyncStatus('syncing');
    setErrorMessage('');
    setActiveStepIndex(0);
    setProgressPct(15);

    const stepTimers = [];

    // Progressive step animations for responsive, transparent user feedback
    stepTimers.push(setTimeout(() => {
      setActiveStepIndex(1);
      setProgressPct(35);
    }, 400));

    stepTimers.push(setTimeout(() => {
      setActiveStepIndex(2);
      setProgressPct(60);
    }, 900));

    stepTimers.push(setTimeout(() => {
      setActiveStepIndex(3);
      setProgressPct(80);
    }, 1400));

    try {
      // Safety timeout: If Supabase connection takes > 12s, fallback gracefully
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), 12000)
      );

      const syncPromise = (async () => {
        if (typeof hydrateFromSupabase === 'function') {
          const success = await hydrateFromSupabase();
          return { success };
        }
        return { success: true };
      })();

      const result = await Promise.race([syncPromise, timeoutPromise]);

      stepTimers.forEach(t => clearTimeout(t));

      if (result?.timedOut) {
        setSyncStatus('error');
        setErrorMessage('Cloud database sync timed out. You can retry or proceed with local offline fallback.');
        return;
      }

      setActiveStepIndex(4);
      setProgressPct(100);
      setSyncStatus('completed');

      // Stamp data ownership & first login completion markers
      if (currentUser?.id) {
        try {
          localStorage.setItem(`mdc_first_login_done_${currentUser.id}`, 'true');
          localStorage.setItem('mdc_local_data_owner', currentUser.id);
        } catch (e) {
          console.warn('Marker write error:', e);
        }
      }

      // Brief pause at 100% to let user see successful completion
      setTimeout(() => {
        setIsInitialSyncing(false);
        if (showToast) {
          showToast(`Live workspace ready for ${currentUser?.fullName || currentUser?.email || 'User'}!`, 'success');
        }
      }, 500);
    } catch (err) {
      stepTimers.forEach(t => clearTimeout(t));
      console.error('First login initial sync error:', err);
      setSyncStatus('error');
      setErrorMessage(err.message || 'An unexpected error occurred while hydrating live operational data.');
    }
  };

  useEffect(() => {
    if (!syncInitiatedRef.current) {
      syncInitiatedRef.current = true;
      performInitialHydration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProceedAnyway = () => {
    if (currentUser?.id) {
      try {
        localStorage.setItem(`mdc_first_login_done_${currentUser.id}`, 'true');
        localStorage.setItem('mdc_local_data_owner', currentUser.id);
      } catch (e) {}
    }
    setIsInitialSyncing(false);
    if (showToast) {
      showToast('Proceeding with local/cached workspace.', 'info');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-ambient-glow" />

      <div
        className="auth-card"
        style={{
          maxWidth: '540px',
          width: '100%',
          padding: '36px 32px'
        }}
      >
        {/* Header Branding */}
        <div className="auth-header" style={{ marginBottom: '24px' }}>
          <div className="auth-logo-badge">
            <img
              src={mobileCareLogo}
              alt="Mobile Care Services"
              className="auth-logo-img"
            />
          </div>

          <div
            className="auth-badge"
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              borderColor: 'rgba(56, 189, 248, 0.28)',
              color: '#38bdf8'
            }}
          >
            <div className="pulse-dot" style={{ background: '#38bdf8' }} />
            <span>Live Supabase Cloud Hydration</span>
          </div>

          <h1 className="auth-title" style={{ fontSize: '20px', marginTop: '12px' }}>
            Preparing Your Live Workspace
          </h1>
          <p className="auth-subtitle" style={{ fontSize: '13px', marginTop: '4px' }}>
            Setting up operational data for{' '}
            <strong style={{ color: '#f1f5f9' }}>
              {currentUser?.fullName || currentUser?.email || 'Authorized User'}
            </strong>
          </p>
        </div>

        {/* Progress Bar Container */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>
              {syncStatus === 'completed'
                ? 'Hydration Complete'
                : syncStatus === 'error'
                ? 'Hydration Interrupted'
                : 'Downloading latest live database state...'}
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>
              {progressPct}%
            </span>
          </div>

          <div
            style={{
              width: '100%',
              height: '8px',
              background: 'rgba(51, 65, 85, 0.5)',
              borderRadius: '999px',
              overflow: 'hidden',
              border: '1px solid #334155'
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                background:
                  syncStatus === 'error'
                    ? '#ef4444'
                    : syncStatus === 'completed'
                    ? '#10b981'
                    : 'linear-gradient(90deg, #0284c7, #38bdf8)',
                transition: 'width 0.4s ease-out',
                borderRadius: '999px'
              }}
            />
          </div>
        </div>

        {/* Steps List */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid #334155',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {SYNC_STEPS.map((step, idx) => {
            const isDone = activeStepIndex > idx || syncStatus === 'completed';
            const isCurrent = activeStepIndex === idx && syncStatus === 'syncing';
            const StepIcon = step.icon;

            return (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  opacity: isDone || isCurrent ? 1 : 0.4,
                  transition: 'opacity 0.3s ease'
                }}
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isDone
                      ? 'rgba(16, 185, 129, 0.15)'
                      : isCurrent
                      ? 'rgba(56, 189, 248, 0.15)'
                      : 'rgba(51, 65, 85, 0.3)',
                    color: isDone ? '#10b981' : isCurrent ? '#38bdf8' : '#64748b',
                    flexShrink: 0
                  }}
                >
                  {isDone ? (
                    <CheckCircle2 size={15} />
                  ) : isCurrent ? (
                    <RefreshCw size={13} className="spin" />
                  ) : (
                    <StepIcon size={13} />
                  )}
                </div>
                <span
                  style={{
                    fontSize: '12.5px',
                    color: isDone ? '#e2e8f0' : isCurrent ? '#f8fafc' : '#94a3b8',
                    fontWeight: isCurrent ? 600 : 400
                  }}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error State Controls */}
        {syncStatus === 'error' && (
          <div style={{ marginBottom: '20px' }}>
            <div
              className="scanner-feedback-box scanner-feedback-error"
              style={{ padding: '12px 14px', marginBottom: '16px' }}
            >
              <AlertCircle size={17} color="#ef4444" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '13px' }}>{errorMessage}</span>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={performInitialHydration}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <RefreshCw size={15} />
                <span>Retry Database Sync</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleProceedAnyway}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <span>Proceed to Workspace</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Syncing Indicator Notice */}
        {syncStatus === 'syncing' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: '#94a3b8',
              fontSize: '12px'
            }}
          >
            <Cloud size={14} color="#38bdf8" />
            <span>Fetching live database state from Supabase Cloud...</span>
          </div>
        )}
      </div>
    </div>
  );
}
