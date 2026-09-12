import { useState, useEffect } from 'react';
import {
  Clock,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Save,
  RotateCcw,
  Play,
  CheckCircle2,
  Zap
} from 'lucide-react';
import {
  AUTO_LOGOUT_PRESET_TIMES,
  DEFAULT_AUTO_LOGOUT_CONFIG,
  formatConfigTimeTo12Hour,
  formatLocalTime
} from '../utils/autoLogoutManager';

export default function AutoLogoutSettings({
  autoLogoutConfig,
  updateAutoLogoutConfig,
  timeRemainingMs,
  triggerTestWarning,
  triggerTestAutoLogout,
  showToast,
  currentUser: _currentUser
}) {
  // Local form state
  const [form, setForm] = useState(() => ({
    enabled: autoLogoutConfig?.enabled ?? true,
    logout_time: autoLogoutConfig?.logout_time || '00:00',
    warning_lead_minutes: autoLogoutConfig?.warning_lead_minutes ?? 5,
    allow_session_refresh: autoLogoutConfig?.allow_session_refresh ?? true,
    clear_cache_on_logout: autoLogoutConfig?.clear_cache_on_logout ?? true,
    enforce_office_hours: autoLogoutConfig?.enforce_office_hours ?? false
  }));

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deviceLocalTime, setDeviceLocalTime] = useState(() => formatLocalTime(new Date()));

  // Keep live local clock ticking every second
  useEffect(() => {
    const interval = setInterval(() => {
      setDeviceLocalTime(formatLocalTime(new Date()));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync form whenever external autoLogoutConfig updates
  useEffect(() => {
    if (autoLogoutConfig) {
      setForm({
        enabled: autoLogoutConfig.enabled ?? true,
        logout_time: autoLogoutConfig.logout_time || '00:00',
        warning_lead_minutes: autoLogoutConfig.warning_lead_minutes ?? 5,
        allow_session_refresh: autoLogoutConfig.allow_session_refresh ?? true,
        clear_cache_on_logout: autoLogoutConfig.clear_cache_on_logout ?? true,
        enforce_office_hours: autoLogoutConfig.enforce_office_hours ?? false
      });
    }
  }, [autoLogoutConfig]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      if (typeof updateAutoLogoutConfig === 'function') {
        await updateAutoLogoutConfig(form);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (typeof showToast === 'function') {
        showToast('Auto-logout session policy saved successfully.', 'success');
      }
    } catch (err) {
      console.error('Failed to save auto-logout settings:', err);
      if (typeof showToast === 'function') {
        showToast('Failed to save settings: ' + (err.message || 'Unknown error'), 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setForm({
      enabled: DEFAULT_AUTO_LOGOUT_CONFIG.enabled,
      logout_time: DEFAULT_AUTO_LOGOUT_CONFIG.logout_time,
      warning_lead_minutes: DEFAULT_AUTO_LOGOUT_CONFIG.warning_lead_minutes,
      allow_session_refresh: DEFAULT_AUTO_LOGOUT_CONFIG.allow_session_refresh,
      clear_cache_on_logout: DEFAULT_AUTO_LOGOUT_CONFIG.clear_cache_on_logout,
      enforce_office_hours: DEFAULT_AUTO_LOGOUT_CONFIG.enforce_office_hours
    });
    if (typeof showToast === 'function') {
      showToast('Form reset to system recommendations (12:00 AM Midnight). Click Save to apply.', 'info');
    }
  };

  // Time calculations
  const remainingHours = typeof timeRemainingMs === 'number' && timeRemainingMs > 0
    ? Math.floor(timeRemainingMs / (1000 * 60 * 60))
    : 0;
  const remainingMins = typeof timeRemainingMs === 'number' && timeRemainingMs > 0
    ? Math.floor((timeRemainingMs % (1000 * 60 * 60)) / (1000 * 60))
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Status KPI Cards ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        {/* Card 1: Policy State */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: form.enabled ? '#ecfdf5' : '#fee2e2', color: form.enabled ? '#059669' : '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Policy Status</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: form.enabled ? '#059669' : '#dc2626' }}>
              {form.enabled ? 'Active & Enforcing' : 'Policy Suspended'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {form.enabled ? 'All user accounts' : 'Manual logout only'}
            </div>
          </div>
        </div>

        {/* Card 2: Scheduled Time */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scheduled Logout</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
              {formatConfigTimeTo12Hour(form.logout_time)}
            </div>
            <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
              Device Local Time
            </div>
          </div>
        </div>

        {/* Card 3: Countdown to Reset */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#fef3c7', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next Reset In</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono, monospace)' }}>
              {form.enabled && timeRemainingMs
                ? `${remainingHours}h ${remainingMins}m`
                : 'Disabled'}
            </div>
            <div style={{ fontSize: '11px', color: '#d97706', fontWeight: 600 }}>
              {form.warning_lead_minutes}m advance warning
            </div>
          </div>
        </div>

        {/* Card 4: Device Local Time Clock */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#f3e8ff', color: '#7e22ce', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RotateCcw size={22} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Device Local Time</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', fontFamily: 'var(--font-mono, monospace)' }}>
              {deviceLocalTime}
            </div>
            <div style={{ fontSize: '11px', color: '#7e22ce', fontWeight: 600 }}>
              Live Client Reference
            </div>
          </div>
        </div>
      </div>

      {/* ── Configuration Form Card ────────────────────────────────────────── */}
      <div className="card" style={{ padding: '24px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '16px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px 0' }}>
            Automated Daily Session Expiration &amp; Cache Purge Configuration
          </h3>
          <p style={{ fontSize: '12.5px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
            Enforce automatic sign-out at a designated daily hour (defaulting to 12:00 AM local device time) to flush stale operational data,
            protect system integrity during non-office hours, and maintain strict data accuracy across all users.
          </p>
        </div>

        <form onSubmit={handleSave}>
          {/* Section 1: Toggle */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                Enable Automatic Daily Logout
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                When enabled, all connected staff and admin accounts will be automatically logged out at the scheduled time.
              </div>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '26px', flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: form.enabled ? '#0284c7' : '#cbd5e1',
                  transition: '0.2s',
                  borderRadius: '26px'
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: '20px',
                    width: '20px',
                    left: form.enabled ? '24px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '0.2s',
                    borderRadius: '50%',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                  }}
                />
              </span>
            </label>
          </div>

          {/* Section 2: Scheduled Time Selection */}
          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
              Daily Scheduled Logout Time (Device Local Time)
            </label>

            {/* Quick Presets */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {AUTO_LOGOUT_PRESET_TIMES.map(preset => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, logout_time: preset.value }))}
                  style={{
                    padding: '7px 12px',
                    fontSize: '12px',
                    fontWeight: form.logout_time === preset.value ? 700 : 500,
                    borderRadius: '8px',
                    border: form.logout_time === preset.value ? '2px solid #0284c7' : '1px solid #cbd5e1',
                    background: form.logout_time === preset.value ? '#eff6ff' : '#ffffff',
                    color: form.logout_time === preset.value ? '#0284c7' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Direct Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="time"
                value={form.logout_time}
                onChange={(e) => setForm(prev => ({ ...prev, logout_time: e.target.value }))}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono, monospace)',
                  background: '#ffffff',
                  color: '#0f172a',
                  width: '160px'
                }}
              />
              <span style={{ fontSize: '12.5px', color: '#64748b' }}>
                Converts to: <strong style={{ color: '#0f172a' }}>{formatConfigTimeTo12Hour(form.logout_time)}</strong>
              </span>
            </div>
          </div>

          {/* Section 3: Grace Period / Advance Warning */}
          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
              Grace Period &amp; Advance Warning Window
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { label: '1 Minute Before', val: 1 },
                { label: '2 Minutes Before', val: 2 },
                { label: '5 Minutes Before (Default)', val: 5 },
                { label: '10 Minutes Before', val: 10 },
                { label: '15 Minutes Before', val: 15 }
              ].map(opt => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, warning_lead_minutes: opt.val }))}
                  style={{
                    padding: '7px 12px',
                    fontSize: '12px',
                    fontWeight: form.warning_lead_minutes === opt.val ? 700 : 500,
                    borderRadius: '8px',
                    border: form.warning_lead_minutes === opt.val ? '2px solid #0284c7' : '1px solid #cbd5e1',
                    background: form.warning_lead_minutes === opt.val ? '#eff6ff' : '#ffffff',
                    color: form.warning_lead_minutes === opt.val ? '#0284c7' : '#475569',
                    cursor: 'pointer'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px', margin: '6px 0 0 0' }}>
              Displays an interactive on-screen countdown prompt to active users before logout triggers so they are not caught off guard.
            </p>
          </div>

          {/* Section 4: Operational Policy Checkboxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px', background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            {/* Policy Checkbox 1: Session Refresh */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.allow_session_refresh}
                onChange={(e) => setForm(prev => ({ ...prev, allow_session_refresh: e.target.checked }))}
                style={{ marginTop: '3px' }}
              />
              <div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                  Allow Active Session Refresh During Grace Period
                </span>
                <span style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  Enables a &quot;Refresh Data &amp; Stay Logged In&quot; button in the warning modal. Active warehouse staff can synchronize live data without losing unsubmitted scan drafts.
                </span>
              </div>
            </label>

            {/* Policy Checkbox 2: Purge Cache */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.clear_cache_on_logout}
                onChange={(e) => setForm(prev => ({ ...prev, clear_cache_on_logout: e.target.checked }))}
                style={{ marginTop: '3px' }}
              />
              <div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                  Purge Operational Cache &amp; Local Storage On Logout (Recommended)
                </span>
                <span style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  Completely flushes operational caches from localStorage and IndexedDB upon automatic logout to ensure no stale data persists on the device.
                </span>
              </div>
            </label>

            {/* Policy Checkbox 3: Non-Office Hours Restriction */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.enforce_office_hours}
                onChange={(e) => setForm(prev => ({ ...prev, enforce_office_hours: e.target.checked }))}
                style={{ marginTop: '3px' }}
              />
              <div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', display: 'block' }}>
                  Enforce Non-Office Hours Re-Authentication Policy
                </span>
                <span style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                  Requires full multi-factor re-login after 12:00 AM, restricting persistent off-shift background sessions.
                </span>
              </div>
            </label>
          </div>

          {/* Form Submit & Reset Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={isSaving}
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                fontWeight: 700,
                fontSize: '13px'
              }}
            >
              {isSaving ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
              <span>{isSaving ? 'Saving Changes...' : 'Save Policy Settings'}</span>
            </button>

            <button
              type="button"
              onClick={handleResetDefaults}
              className="btn btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 600
              }}
            >
              <RotateCcw size={14} />
              <span>Reset to Defaults</span>
            </button>

            {saveSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', fontSize: '13px', fontWeight: 600 }}>
                <CheckCircle2 size={16} />
                <span>Settings saved to cloud and active on all devices.</span>
              </div>
            )}
          </div>
        </form>
      </div>

      {/* ── Administrative Testing Panel ────────────────────────────────────────── */}
      <div className="card" style={{ padding: '20px 24px', border: '1px solid #cbd5e1', borderRadius: '12px', background: '#f8fafc' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{ background: '#fef3c7', color: '#d97706', padding: '6px', borderRadius: '6px' }}>
            <Play size={16} />
          </div>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            Administrative UX Simulation &amp; Testing Tools
          </h4>
        </div>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px 0', lineHeight: 1.45 }}>
          Test the user experience without needing to wait until midnight. These actions simulate the advance grace period warning or execute an immediate auto-logout.
        </p>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (typeof triggerTestWarning === 'function') {
                triggerTestWarning();
                if (typeof showToast === 'function') {
                  showToast('Simulating advance grace period warning modal (60s countdown).', 'info');
                }
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              background: '#ffffff'
            }}
          >
            <Clock size={14} color="#d97706" />
            <span>Test Warning Modal (60s Countdown)</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (window.confirm('Are you sure you want to test immediate auto-logout? Your active session will be terminated and operational storage will be purged.')) {
                if (typeof triggerTestAutoLogout === 'function') {
                  triggerTestAutoLogout();
                }
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#b91c1c',
              borderColor: '#fca5a5',
              background: '#ffffff'
            }}
          >
            <AlertTriangle size={14} color="#b91c1c" />
            <span>Test Immediate Auto-Logout Flow</span>
          </button>
        </div>
      </div>
    </div>
  );
}
