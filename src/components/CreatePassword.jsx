import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, CheckCircle2, XCircle, Eye, EyeOff, ArrowRight, RefreshCw } from 'lucide-react';
import mobileCareLogo from '../assets/mobilecare_logo.png';

export default function CreatePassword() {
  const { pendingFirstTimeUser, setPendingFirstTimeUser, createFirstTimePassword } = useApp();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!pendingFirstTimeUser) {
    return null;
  }

  // Password Policy Rules (Enforcing strong case-sensitive passwords)
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const isMatch = password.length > 0 && password === confirmPassword;
  const isFormValid = hasMinLength && hasUpper && hasLower && hasNumber && isMatch;

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

      <div className="auth-card" style={{ maxWidth: '480px' }}>
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
            Welcome, <strong style={{ color: '#f1f5f9' }}>{pendingFirstTimeUser.fullName}</strong> ({pendingFirstTimeUser.email})
          </p>
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
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
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
          </div>

          {/* Confirm Password */}
          <div className="auth-form-group">
            <label className="auth-label">Confirm Password</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Security Checklist */}
          <div style={{ background: 'rgba(30, 41, 59, 0.5)', borderRadius: '12px', padding: '14px 16px', marginBottom: '22px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Security Requirements
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: hasMinLength ? '#34d399' : '#94a3b8' }}>
                {hasMinLength ? <CheckCircle2 size={14} color="#34d399" /> : <XCircle size={14} color="#64748b" />}
                <span>8+ characters</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: (hasUpper && hasLower) ? '#34d399' : '#94a3b8' }}>
                {(hasUpper && hasLower) ? <CheckCircle2 size={14} color="#34d399" /> : <XCircle size={14} color="#64748b" />}
                <span>Upper & lowercase letters (case-sensitive)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: hasNumber ? '#34d399' : '#94a3b8' }}>
                {hasNumber ? <CheckCircle2 size={14} color="#34d399" /> : <XCircle size={14} color="#64748b" />}
                <span>At least 1 number</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: isMatch ? '#34d399' : '#94a3b8' }}>
                {isMatch ? <CheckCircle2 size={14} color="#34d399" /> : <XCircle size={14} color="#64748b" />}
                <span>Passwords match</span>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="scanner-feedback-box scanner-feedback-error" style={{ marginBottom: '20px', padding: '10px 14px' }}>
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className="auth-btn-primary"
            disabled={!isFormValid || isLoading}
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
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '12.5px', cursor: 'pointer' }}
            >
              ← Back to Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
