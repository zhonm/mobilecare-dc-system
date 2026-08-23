import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Lock, ArrowRight, Eye, EyeOff, AlertCircle, RefreshCw, Mail, ShieldCheck } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import mobileCareLogo from '../assets/mobilecare_logo.png';
import { loginRateLimiter } from '../utils/security';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '';

export default function Login() {
  const { verifyLoginEmail, signInWithPassword, setPendingFirstTimeUser, showToast } = useApp();
  
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState('email'); // 'email' | 'password'
  const [verifiedUser, setVerifiedUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');

  // Handle Email Verification Step
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      setErrorMessage('Please enter your company email address');
      return;
    }

    // Check brute-force lockout status
    const rateCheck = loginRateLimiter.checkLimit(emailInput.trim().toLowerCase());
    if (!rateCheck.allowed) {
      setErrorMessage(rateCheck.message);
      return;
    }

    setErrorMessage('');
    setIsLoading(true);

    try {
      const check = await verifyLoginEmail(emailInput);
      if (!check.success) {
        setErrorMessage(check.error);
        setIsLoading(false);
        return;
      }

      if (!check.hasSetPassword) {
        // First-time login! Route to CreatePassword screen
        setPendingFirstTimeUser(check.user);
      } else {
        // Returning user: reveal password step
        setVerifiedUser(check.user);
        setStep('password');
      }
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred during verification');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Password Submit Step
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!passwordInput) {
      setErrorMessage('Please enter your password');
      return;
    }

    // Check brute-force lockout status
    const rateCheck = loginRateLimiter.checkLimit(emailInput.trim().toLowerCase());
    if (!rateCheck.allowed) {
      setErrorMessage(rateCheck.message);
      return;
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setErrorMessage('Please verify that you are not a robot.');
      return;
    }

    setErrorMessage('');
    setIsLoading(true);

    try {
      const res = await signInWithPassword(emailInput, passwordInput, turnstileToken);
      if (!res.success) {
        const failState = loginRateLimiter.recordFailure(emailInput.trim().toLowerCase());
        if (failState.locked) {
          setErrorMessage(`Too many failed attempts. Security lockout active for 60 seconds.`);
        } else {
          setErrorMessage(`${res.error} (${failState.remainingAttempts} attempts remaining)`);
        }
      } else {
        loginRateLimiter.recordSuccess(emailInput.trim().toLowerCase());
      }
    } catch (err) {
      setErrorMessage(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Background ambient lighting */}
      <div className="auth-ambient-glow" />

      <div className="auth-card">
        {/* Header Branding */}
        <div className="auth-header">
          <div className="auth-logo-badge">
            <img
              src={mobileCareLogo}
              alt="Mobile Care Services"
              className="auth-logo-img"
            />
          </div>

          <div className="auth-badge">
            <div className="pulse-dot" style={{ background: '#38bdf8' }} />
            <span>DC System • Secure Access</span>
          </div>

          <h1 className="auth-title">
            MOBILE CARE SERVICES PHILS. INC.
          </h1>
          <p className="auth-subtitle">
            Distribution Center Logistics & Allocation Platform
          </p>
        </div>

        {/* Form Section */}
        {step === 'email' ? (
          <form onSubmit={handleEmailSubmit}>
            <div className="auth-form-group">
              <label className="auth-label">Company Email</label>
              <div className="auth-input-wrapper">
                <Mail size={18} className="auth-input-icon" />
                <input
                  type="email"
                  className="auth-input"
                  placeholder="e.g. name@mobilecare.com.ph"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    if (errorMessage) setErrorMessage('');
                  }}
                  autoFocus
                  required
                />
              </div>
            </div>

            {errorMessage && (
              <div
                className="scanner-feedback-box scanner-feedback-error"
                style={{ marginBottom: '20px', padding: '10px 14px' }}
              >
                <AlertCircle size={17} color="#ef4444" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '13px' }}>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="auth-btn-primary"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="spin" size={17} />
                  <span>Checking Provisioning...</span>
                </>
              ) : (
                <>
                  <span>Continue with Email</span>
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePasswordSubmit}>
            {/* User identification chip */}
            <div className="auth-user-chip">
              <div className="auth-user-info">
                <div className="auth-user-avatar">
                  {verifiedUser?.fullName ? verifiedUser.fullName.charAt(0).toUpperCase() : 'U'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '13px', lineHeight: 1.2 }}>
                    {verifiedUser?.fullName || 'Authorized Staff'}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.2 }}>
                    {verifiedUser?.email}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setPasswordInput('');
                  setErrorMessage('');
                  setTurnstileToken('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  padding: '4px 8px'
                }}
              >
                Switch
              </button>
            </div>

            <div className="auth-form-group">
              <div className="auth-label">
                <span>Password</span>
                <button
                  type="button"
                  onClick={() => setShowForgotModal(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#38bdf8',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textTransform: 'none',
                    fontWeight: 500,
                    letterSpacing: 'normal'
                  }}
                >
                  Forgot Password?
                </button>
              </div>
              <div className="auth-input-wrapper">
                <Lock size={18} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input"
                  style={{ paddingRight: '48px' }}
                  placeholder="Enter your password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    if (errorMessage) setErrorMessage('');
                  }}
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

            {/* Cloudflare Turnstile Verification Widget */}
            {TURNSTILE_SITE_KEY ? (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
                <Turnstile
                  siteKey={TURNSTILE_SITE_KEY}
                  options={{
                    theme: 'dark',
                    size: 'normal'
                  }}
                  onSuccess={(token) => {
                    setTurnstileToken(token);
                    if (errorMessage) setErrorMessage('');
                  }}
                  onExpire={() => setTurnstileToken('')}
                  onError={() => {
                    setErrorMessage('Verification check failed. Please refresh or retry.');
                  }}
                />
              </div>
            ) : null}

            {errorMessage && (
              <div
                className="scanner-feedback-box scanner-feedback-error"
                style={{ marginBottom: '20px', padding: '10px 14px' }}
              >
                <AlertCircle size={17} color="#ef4444" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '13px' }}>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="auth-btn-primary"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="spin" size={17} />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <Lock size={16} />
                  <span>Sign In to DC System</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Security Footer Notice */}
        <div className="auth-footer-notice">
          <ShieldCheck size={14} color="#64748b" />
          <span>Authorized DC Employees Only • Encrypted Session</span>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
        >
          <div className="card" style={{ maxWidth: '420px', width: '100%', background: '#0f172a', color: '#fff', borderColor: '#334155', borderRadius: '16px' }}>
            <h3 style={{ color: '#fff', marginBottom: '8px' }}>Reset Password</h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', lineHeight: 1.5 }}>
              For security, password resets for authorized service staff are administered by your IT Superadmin.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setShowForgotModal(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  showToast('Password reset assistance notification logged for Superadmin.', 'info');
                  setShowForgotModal(false);
                }}
              >
                Request IT Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
