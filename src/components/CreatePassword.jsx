import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, CheckCircle2, Circle, Eye, EyeOff, ArrowRight, ArrowLeft, RefreshCw, ArrowUp, ShieldCheck, UserCheck, AlertCircle } from 'lucide-react';
import mobileCareLogo from '../assets/mobilecare_logo.png';

export default function CreatePassword() {
  const { pendingFirstTimeUser, setPendingFirstTimeUser, createFirstTimePassword } = useApp();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!pendingFirstTimeUser) {
    return null;
  }

  const handleCapsLockCheck = (e) => {
    if (e?.getModifierState) {
      setIsCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  // Helper to extract user initials for avatar
  const getUserInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Password Policy Rules (Enforcing strong case-sensitive passwords)
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasUpperLower = hasUpper && hasLower;
  const hasNumber = /[0-9]/.test(password);
  const isMatch = password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const isFormValid = hasMinLength && hasUpperLower && hasNumber && isMatch;

  const requirements = [
    { id: 'length', label: '8+ characters', met: hasMinLength },
    { id: 'case', label: 'Upper & lowercase', met: hasUpperLower },
    { id: 'number', label: 'At least 1 number', met: hasNumber },
    { id: 'match', label: 'Passwords match', met: isMatch }
  ];

  const metCount = requirements.filter(r => r.met).length;

  const getStrengthStatus = () => {
    if (metCount === 0) return { label: '4 required', color: '#64748b' };
    if (metCount === 1) return { label: 'Weak (1/4)', color: '#f87171' };
    if (metCount === 2) return { label: 'Fair (2/4)', color: '#fbbf24' };
    if (metCount === 3) return { label: 'Good (3/4)', color: '#38bdf8' };
    return { label: 'Strong & Ready (4/4)', color: '#34d399' };
  };

  const strength = getStrengthStatus();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid) {
      setErrorMessage('Please fulfill all security requirements before proceeding.');
      return;
    }

    setErrorMessage('');
    setIsLoading(true);

    try {
      const res = await createFirstTimePassword(pendingFirstTimeUser.email, password);
      if (!res.success) {
        setErrorMessage(res.error || 'Failed to initialize password');
      }
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred setting password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-ambient-glow" />

      <div className="auth-card" style={{ maxWidth: '490px' }}>
        {/* Header */}
        <div className="auth-header">
          <div className="auth-logo-badge">
            <img
              src={mobileCareLogo}
              alt="Mobile Care Logo"
              className="auth-logo-img"
            />
          </div>

          <div className="auth-badge" style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.28)', color: '#34d399' }}>
            <div className="pulse-dot" style={{ background: '#34d399' }} />
            <span>Account Activation • DC System</span>
          </div>

          <h1 className="auth-title">
            Create Your Password
          </h1>
          <p className="auth-subtitle">
            Set up your credentials to activate and secure your account.
          </p>
        </div>

        {/* User Identity Chip */}
        <div className="auth-user-chip" style={{ marginBottom: '22px' }}>
          <div className="auth-user-info">
            <div className="auth-user-avatar">
              {getUserInitials(pendingFirstTimeUser?.fullName)}
            </div>
            <div style={{ textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px', lineHeight: 1.2 }}>
                {pendingFirstTimeUser?.fullName || 'Authorized Staff'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '11.5px', lineHeight: 1.2, marginTop: '2px' }}>
                {pendingFirstTimeUser?.email}
              </div>
            </div>
          </div>
          <div className="auth-user-chip-badge">
            <UserCheck size={12} />
            <span>First Setup</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* New Password */}
          <div className="auth-form-group">
            <label className="auth-label">New Password</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                style={{ paddingRight: '48px' }}
                placeholder="Create a secure password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  handleCapsLockCheck(e);
                }}
                onKeyDown={handleCapsLockCheck}
                onKeyUp={handleCapsLockCheck}
                onFocus={handleCapsLockCheck}
                onBlur={() => setIsCapsLockOn(false)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="auth-eye-btn"
                style={{
                  color: showPassword ? '#38bdf8' : '#94a3b8'
                }}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {isCapsLockOn && (
              <div className="auth-capslock-warning">
                <ArrowUp size={13} />
                <span>Caps Lock is ON — password is case sensitive</span>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="auth-form-group">
            <label className="auth-label">Confirm Password</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className="auth-input"
                style={{
                  paddingRight: '48px',
                  borderColor: isMatch ? '#10b981' : undefined
                }}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  handleCapsLockCheck(e);
                }}
                onKeyDown={handleCapsLockCheck}
                onKeyUp={handleCapsLockCheck}
                onFocus={handleCapsLockCheck}
                onBlur={() => setIsCapsLockOn(false)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                title={showConfirmPassword ? 'Hide password' : 'Show password'}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                className="auth-eye-btn"
                style={{
                  color: showConfirmPassword ? '#38bdf8' : '#94a3b8'
                }}
              >
                {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Security Checklist Box */}
          <div className="auth-req-box">
            <div className="auth-req-header">
              <div className="auth-req-title">
                <ShieldCheck size={14} color="#38bdf8" />
                <span>Security Requirements</span>
              </div>
              <span className="auth-req-status" style={{ color: strength.color }}>
                {strength.label}
              </span>
            </div>

            {/* 4-Segment Strength Progress Meter */}
            <div className="auth-req-meter">
              {[1, 2, 3, 4].map((step) => {
                const isActive = metCount >= step;
                let barColor = 'rgba(51, 65, 85, 0.45)';
                if (isActive) {
                  if (metCount === 1) barColor = '#f87171';
                  else if (metCount === 2) barColor = '#fbbf24';
                  else if (metCount === 3) barColor = '#38bdf8';
                  else barColor = '#34d399';
                }
                return (
                  <div
                    key={step}
                    className="auth-req-meter-bar"
                    style={{
                      background: barColor,
                      boxShadow: isActive ? `0 0 8px ${barColor}40` : 'none'
                    }}
                  />
                );
              })}
            </div>

            {/* Symmetrical 2x2 Requirement Cards */}
            <div className="auth-req-grid">
              {requirements.map((req) => (
                <div
                  key={req.id}
                  className={`auth-req-item ${req.met ? 'is-met' : 'is-unmet'}`}
                >
                  <div className="auth-req-item-icon">
                    {req.met ? (
                      <CheckCircle2 size={14} color="#34d399" />
                    ) : (
                      <Circle size={13} color="#64748b" />
                    )}
                  </div>
                  <span className="auth-req-item-text">{req.label}</span>
                </div>
              ))}
            </div>
          </div>

          {errorMessage && (
            <div className="scanner-feedback-box scanner-feedback-error" style={{ marginBottom: '20px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className="auth-btn-primary"
            disabled={!isFormValid || isLoading}
            style={{
              boxShadow: isFormValid ? '0 4px 20px rgba(16, 185, 129, 0.4)' : undefined,
              background: isFormValid ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : undefined
            }}
          >
            {isLoading ? (
              <>
                <RefreshCw className="spin" size={17} />
                <span>Activating Account...</span>
              </>
            ) : (
              <>
                <span>Save Password & Access DC System</span>
                <ArrowRight size={17} />
              </>
            )}
          </button>

          <div style={{ textAlign: 'center', marginTop: '18px' }}>
            <button
              type="button"
              onClick={() => setPendingFirstTimeUser(null)}
              className="auth-back-link"
            >
              <ArrowLeft size={14} />
              <span>Back to Login</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

