import { useState, useEffect } from 'react';
import { egressMonitor } from '../utils/egressMonitor';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Zap,
  X,
  Sliders
} from 'lucide-react';

export default function EgressUsageModal({ isOpen, onClose, onNavigateToSettings }) {
  const [stats, setStats] = useState(() => egressMonitor.getStats());
  const [isEditingBaseline, setIsEditingBaseline] = useState(false);
  const [customGb, setCustomGb] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStats(egressMonitor.getStats());
    const unsub = egressMonitor.subscribe(newStats => {
      setStats(newStats);
    });
    return unsub;
  }, [isOpen]);

  if (!isOpen) return null;

  const {
    totalEgressBytes,
    limitBytes,
    remainingBytes,
    usagePercent,
    daysRemaining,
    recentBurnRateBytes,
    safeDailyBudgetBytes,
    projectedTotalBytes,
    alertLevel,
    egressSaverMode
  } = stats;

  const handleSaveBaseline = (e) => {
    e.preventDefault();
    const val = parseFloat(customGb);
    if (!isNaN(val) && val >= 0 && val <= 50) {
      egressMonitor.setBaselineUsage(val);
      setIsEditingBaseline(false);
      setCustomGb('');
    }
  };

  const alertColors = {
    ok: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0', icon: CheckCircle2, label: 'Optimal Budget' },
    warning: { bg: '#fffbeb', text: '#d97706', border: '#fde68a', icon: AlertTriangle, label: 'Elevated Burn Rate' },
    critical: { bg: '#fff1f2', text: '#e11d48', border: '#fecdd3', icon: ShieldAlert, label: 'Approaching 5GB Limit' },
    emergency: { bg: '#450a0a', text: '#f87171', border: '#ef4444', icon: ShieldAlert, label: 'Emergency Quota Depletion' }
  };

  const currentAlert = alertColors[alertLevel] || alertColors.ok;
  const AlertIcon = currentAlert.icon;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-container"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '620px',
          width: '94%',
          background: 'var(--bg-card)',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          border: '1px solid var(--border-color)'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#fff',
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #334155'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                background: usagePercent >= 80 ? '#ef4444' : usagePercent >= 60 ? '#f59e0b' : '#0284c7',
                padding: '8px',
                borderRadius: '8px',
                display: 'flex'
              }}
            >
              <Activity size={20} color="#fff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#fff' }}>
                Supabase Egress Quota Monitor
              </h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                Free Plan Cap: 5.00 GB · Billing Cycle Reset: Oct 06
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px'
            }}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Alert Status Banner */}
          <div
            style={{
              background: currentAlert.bg,
              border: `1px solid ${currentAlert.border}`,
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertIcon size={20} color={currentAlert.text} />
              <div>
                <strong style={{ fontSize: '13px', color: currentAlert.text }}>
                  {currentAlert.label}
                </strong>
                <p style={{ margin: 0, fontSize: '12px', color: currentAlert.text, opacity: 0.9 }}>
                  {alertLevel === 'emergency' || alertLevel === 'critical'
                    ? 'At current burn rate, free-tier egress will be depleted before billing reset.'
                    : alertLevel === 'warning'
                    ? 'Recent daily bandwidth is higher than sustainable monthly pace.'
                    : 'Network traffic is currently within safe limits.'}
                </p>
              </div>
            </div>

            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: '4px',
                background: currentAlert.text,
                color: '#fff',
                whiteSpace: 'nowrap'
              }}
            >
              {usagePercent.toFixed(1)}% Used
            </span>
          </div>

          {/* Progress Bar & Quota Gauge */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                Monthly Egress Consumption
              </span>
              <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-main)' }}>
                {egressMonitor.constructor.formatBytes(totalEgressBytes)} / {egressMonitor.constructor.formatBytes(limitBytes)}
              </span>
            </div>

            <div
              style={{
                height: '14px',
                background: '#e2e8f0',
                borderRadius: '7px',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, usagePercent)}%`,
                  height: '100%',
                  background: usagePercent >= 80 ? '#ef4444' : usagePercent >= 60 ? '#f59e0b' : '#10b981',
                  borderRadius: '7px',
                  transition: 'width 0.4s ease'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
              <span>0 GB</span>
              <span>3.0 GB (60% Warning)</span>
              <span>4.0 GB (80% Critical)</span>
              <span>5.0 GB Limit</span>
            </div>
          </div>

          {/* 4 Key Metrics Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg-card-alt, #f8fafc)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Remaining Quota
              </div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-main)', marginTop: '4px' }}>
                {egressMonitor.constructor.formatBytes(remainingBytes)}
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                {daysRemaining} day(s) until Oct 06 reset
              </div>
            </div>

            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg-card-alt, #f8fafc)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Safe Daily Budget
              </div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>
                {egressMonitor.constructor.formatBytes(safeDailyBudgetBytes)}/day
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                Target pace to finish within free tier
              </div>
            </div>

            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg-card-alt, #f8fafc)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Recent Burn Rate
              </div>
              <div
                style={{
                  fontSize: '17px',
                  fontWeight: 800,
                  color: recentBurnRateBytes > safeDailyBudgetBytes ? '#ef4444' : '#10b981',
                  marginTop: '4px'
                }}
              >
                {egressMonitor.constructor.formatBytes(recentBurnRateBytes)}/day
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                {recentBurnRateBytes > safeDailyBudgetBytes ? 'Over daily budget' : 'Under daily budget'}
              </div>
            </div>

            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg-card-alt, #f8fafc)',
                borderRadius: '10px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Projected Total
              </div>
              <div
                style={{
                  fontSize: '17px',
                  fontWeight: 800,
                  color: projectedTotalBytes > limitBytes ? '#ef4444' : '#10b981',
                  marginTop: '4px'
                }}
              >
                {egressMonitor.constructor.formatBytes(projectedTotalBytes)}
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px' }}>
                {projectedTotalBytes > limitBytes
                  ? `Exceeds 5.0 GB limit`
                  : 'Stays within Free Tier'}
              </div>
            </div>
          </div>

          {/* Egress Saver Mode Banner / Control */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: egressSaverMode ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-card-alt, #f8fafc)',
              borderRadius: '10px',
              border: `1px solid ${egressSaverMode ? '#a7f3d0' : 'var(--border-color)'}`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Zap size={20} color={egressSaverMode ? '#10b981' : '#64748b'} />
              <div>
                <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                  Egress Saver Mode: {egressSaverMode ? 'ACTIVE' : 'STANDBY'}
                </strong>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                  {egressSaverMode
                    ? 'Metadata-first delta syncing active. Background re-fetches throttled.'
                    : 'Auto-engages if usage exceeds 80% to protect against quota exhaustion.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              className={`btn btn-sm ${egressSaverMode ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => egressMonitor.setEgressSaverMode(!egressSaverMode, true)}
              style={{ fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {egressSaverMode ? 'Disable Saver' : 'Enable Saver'}
            </button>
          </div>

          {/* Quick Baseline Calibration Section */}
          {isEditingBaseline ? (
            <form onSubmit={handleSaveBaseline} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="50"
                placeholder="e.g. 2.83"
                value={customGb}
                onChange={e => setCustomGb(e.target.value)}
                className="form-control"
                style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
                autoFocus
              />
              <button type="submit" className="btn btn-primary btn-sm" style={{ fontWeight: 700 }}>
                Set Baseline (GB)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsEditingBaseline(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Calibrated from Supabase Dashboard
              </span>
              <button
                type="button"
                onClick={() => setIsEditingBaseline(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0284c7',
                  cursor: 'pointer',
                  fontWeight: 600,
                  padding: 0,
                  textDecoration: 'underline'
                }}
              >
                Calibrate Current Total (GB)
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '16px 24px',
            background: 'var(--bg-card-alt, #f8fafc)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              onClose();
              if (onNavigateToSettings) onNavigateToSettings();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
          >
            <Sliders size={14} />
            <span>Full Database Telemetry</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onClose}
            style={{ fontWeight: 700, padding: '7px 18px' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
