import { useState, useEffect } from 'react';
import {
  Activity,
  ShieldCheck,
  RefreshCw,
  X,
  Zap,
  Info,
  Layers,
  ArrowDownCircle,
  Calendar,
  CheckCircle2
} from 'lucide-react';
import {
  getEgressStats,
  formatBytes,
  subscribeToEgressUpdates,
  updateBaselineBytes
} from '../services/egressMonitorService';

export default function EgressUsageModal({ isOpen, onClose, onForceSync }) {
  const [stats, setStats] = useState(getEgressStats());
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [calibrateInput, setCalibrateInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStats(getEgressStats());
    const unsubscribe = subscribeToEgressUpdates((newStats) => {
      setStats(newStats);
    });
    return () => unsubscribe();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualSync = async () => {
    if (typeof onForceSync === 'function') {
      setIsSyncing(true);
      try {
        await onForceSync();
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleApplyCalibration = () => {
    const gbVal = parseFloat(calibrateInput);
    if (!isNaN(gbVal) && gbVal >= 0) {
      updateBaselineBytes(Math.round(gbVal * 1024 * 1024 * 1024));
      setShowCalibrate(false);
      setCalibrateInput('');
    }
  };

  const getStatusBadge = () => {
    if (stats.health === 'critical') {
      return {
        bg: '#fef2f2',
        color: '#dc2626',
        border: '1px solid #fecaca',
        label: 'Critical High'
      };
    }
    if (stats.health === 'warning') {
      return {
        bg: '#fffbeb',
        color: '#d97706',
        border: '1px solid #fde68a',
        label: 'Warning'
      };
    }
    return {
      bg: '#ecfdf5',
      color: '#059669',
      border: '1px solid #a7f3d0',
      label: 'Budget Safe'
    };
  };

  const getProgressBarColor = () => {
    if (stats.percentUsed >= 90) return '#ef4444';
    if (stats.percentUsed >= 75) return '#f59e0b';
    return '#10b981';
  };

  const badgeStyle = getStatusBadge();

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          animation: 'fadeIn 0.2s ease-out'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f8fafc'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#e0e7ff',
                color: '#4338ca',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Activity size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                  Supabase Egress & Quota Monitor
                </h3>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: badgeStyle.bg,
                    color: badgeStyle.color,
                    border: badgeStyle.border
                  }}
                >
                  {badgeStyle.label}
                </span>
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                Free Tier: <strong>5.00 GB / month</strong> • Billing Cycle: 05 Sep – 05 Oct 2026
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
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#e2e8f0';
              e.currentTarget.style.color = '#334155';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#94a3b8';
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Quota Progress Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                Total Monthly Egress Used
              </span>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                {formatBytes(stats.totalBytes)}{' '}
                <span style={{ fontSize: '12px', fontWeight: 400, color: '#64748b' }}>
                  / 5.00 GB ({stats.percentUsed.toFixed(1)}%)
                </span>
              </span>
            </div>

            {/* Gauge Track */}
            <div
              style={{
                width: '100%',
                height: '10px',
                background: '#e2e8f0',
                borderRadius: '9999px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: '9999px',
                  background: getProgressBarColor(),
                  width: `${Math.min(100, stats.percentUsed)}%`,
                  transition: 'width 0.4s ease'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
              <span>
                Remaining Quota: <strong style={{ color: '#0f172a' }}>{formatBytes(stats.remainingBytes)}</strong>
              </span>
              <span>
                Cycle Days Remaining: <strong style={{ color: '#0f172a' }}>{stats.daysRemaining} days</strong>
              </span>
            </div>
          </div>

          {/* 3 Metric Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px'
            }}
          >
            {/* Safe Daily Budget */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                <Calendar size={15} color="#6366f1" />
                Safe Daily Budget
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                {formatBytes(stats.dailySafeBudgetBytes)}
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}> / day</span>
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Target to stay under 5 GB</div>
            </div>

            {/* Today's Usage */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                <ArrowDownCircle size={15} color="#10b981" />
                Today's Session Usage
              </div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                {formatBytes(stats.todayBytes)}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>{stats.todayRequests} network queries</div>
            </div>

            {/* Circuit Breaker Status */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                <Zap size={15} color="#f59e0b" />
                Circuit Breaker
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', height: '27px' }}>
                {stats.isCircuitBreakerActive ? (
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' }}>
                    Tripped (Cooling 60s)
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>
                    Active & Guarding
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Halts runaway query loops</div>
            </div>
          </div>

          {/* Active Bandwidth Defenses */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
              <ShieldCheck size={16} color="#10b981" />
              Active Egress Reduction Defenses
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px', display: 'flex', gap: '8px' }}>
                <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>Conditional ETag / Timestamp Hydration</div>
                  <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4, marginTop: '2px' }}>
                    Heavy documents (masterlist, live state) check headers and skip downloading unchanged multi-MB payloads.
                  </div>
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px', display: 'flex', gap: '8px' }}>
                <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>Selective Table Realtime Routing</div>
                  <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4, marginTop: '2px' }}>
                    Broadcast events reload only the affected table rather than executing blanket 10-table full queries.
                  </div>
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px', display: 'flex', gap: '8px' }}>
                <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>Redundant Polling Suppression</div>
                  <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4, marginTop: '2px' }}>
                    Tab switching & window refocus skip background queries while WebSocket Realtime is connected.
                  </div>
                </div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px', display: 'flex', gap: '8px' }}>
                <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>Runaway Circuit Breaker</div>
                  <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4, marginTop: '2px' }}>
                    Automatically suppresses rapid automated query bursts (&gt;35 req/2 min) to protect remaining quota.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Table Breakdown */}
          {Object.keys(stats.tableBreakdown).length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <Layers size={16} color="#64748b" />
                Session PostgREST Egress by Table
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '8px 12px', fontWeight: 600 }}>Table / Endpoint</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Queries</th>
                      <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Data Transferred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats.tableBreakdown)
                      .sort((a, b) => b[1].bytes - a[1].bytes)
                      .map(([table, data], idx) => (
                        <tr
                          key={table}
                          style={{
                            borderBottom: idx === Object.keys(stats.tableBreakdown).length - 1 ? 'none' : '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafafa'
                          }}
                        >
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#334155' }}>
                            {table}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>
                            {data.requests}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                            {formatBytes(data.bytes)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Calibrate Baseline Accordion */}
          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
            {!showCalibrate ? (
              <button
                type="button"
                onClick={() => setShowCalibrate(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#4f46e5',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: 0
                }}
              >
                <Info size={14} />
                Calibrate baseline from Supabase Usage Dashboard
              </button>
            ) : (
              <div
                style={{
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#4338ca' }}>
                  Set Baseline Egress from Supabase Dashboard (in GB):
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="e.g. 3.415"
                    value={calibrateInput}
                    onChange={(e) => setCalibrateInput(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      border: '1px solid #c7d2fe',
                      fontSize: '12px',
                      width: '130px',
                      outline: 'none',
                      background: '#ffffff'
                    }}
                  />
                  <span style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>GB</span>
                  <button
                    type="button"
                    onClick={handleApplyCalibration}
                    style={{
                      background: '#4f46e5',
                      color: '#ffffff',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCalibrate(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px'
          }}
        >
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#334155',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              opacity: isSyncing ? 0.6 : 1
            }}
          >
            <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
            {isSyncing ? 'Syncing Cloud...' : 'Force Cloud Sync'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '7px 18px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
