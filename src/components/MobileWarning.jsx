import { useState, useEffect } from 'react';
import { Laptop, Smartphone, AlertTriangle, X, Check, Copy, ArrowRight } from 'lucide-react';
import mobileCareLogo from '../assets/mobilecare_logo.png';
import './MobileWarning.css';

const STORAGE_KEY = 'mdc_mobile_warning_dismissed';

export default function MobileWarning() {
  const [isMobile, setIsMobile] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Check initial screen width
    const checkViewport = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
    };

    checkViewport();

    // Check if dismissed in this session
    const dismissed = sessionStorage.getItem(STORAGE_KEY) === 'true';
    setIsDismissed(dismissed);
    if (dismissed) {
      setShowBanner(true);
    }

    window.addEventListener('resize', checkViewport);
    window.addEventListener('orientationchange', checkViewport);

    return () => {
      window.removeEventListener('resize', checkViewport);
      window.removeEventListener('orientationchange', checkViewport);
    };
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, 'true');
    setIsDismissed(true);
    setShowBanner(true);
  };

  const handleReopen = () => {
    setIsDismissed(false);
  };

  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (!isMobile) {
    return null;
  }

  return (
    <>
      {/* Full Screen Warning Modal on Phone Screens */}
      {!isDismissed && (
        <div className="mobile-warning-overlay" role="dialog" aria-modal="true">
          <div className="mobile-warning-card">
            {/* Close / Dismiss button */}
            <button
              type="button"
              className="mobile-warning-close"
              onClick={handleDismiss}
              aria-label="Dismiss warning"
            >
              <X size={18} />
            </button>

            {/* Header Badge */}
            <div className="mobile-warning-header">
              <div className="mobile-warning-logo-wrap">
                <img
                  src={mobileCareLogo}
                  alt="Mobile Care Services"
                  className="mobile-warning-logo"
                />
              </div>
              <div className="mobile-warning-tag">
                <AlertTriangle size={13} className="text-amber-400" />
                <span>DISPLAY ADVISORY</span>
              </div>
            </div>

            {/* Visual Device Icon */}
            <div className="mobile-warning-visual">
              <div className="device-icon-box desktop-icon">
                <Laptop size={32} />
                <span className="device-label optimal">Recommended</span>
              </div>
              <div className="device-arrow">
                <ArrowRight size={16} />
              </div>
              <div className="device-icon-box phone-icon">
                <Smartphone size={32} />
                <span className="device-label limited">Limited</span>
              </div>
            </div>

            {/* Body Content */}
            <div className="mobile-warning-body">
              <h2 className="mobile-warning-title">Desktop Screen Required</h2>
              <p className="mobile-warning-text">
                The <strong>Mobile Care DC System</strong> is an enterprise platform designed and optimized for <strong>desktop & laptop workstations</strong>.
              </p>

              <div className="mobile-warning-reasons">
                <div className="reason-item">
                  <div className="reason-bullet" />
                  <span>Allocation matrices and forecasting grids require widescreen view</span>
                </div>
                <div className="reason-item">
                  <div className="reason-bullet" />
                  <span>High-speed barcode scanner feeds are tailored for computer terminals</span>
                </div>
                <div className="reason-item">
                  <div className="reason-bullet" />
                  <span>Data tables and export functions may be clipped on phone displays</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mobile-warning-actions">
              <button
                type="button"
                className="mobile-btn-copy"
                onClick={handleCopyLink}
              >
                {copied ? (
                  <>
                    <Check size={16} color="#10b981" />
                    <span>Link Copied! Open on PC</span>
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    <span>Copy Link for PC / Laptop</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="mobile-btn-proceed"
                onClick={handleDismiss}
              >
                <span>Proceed Anyway (Limited Mobile View)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Persistent Top Banner when dismissed on phone */}
      {isDismissed && showBanner && (
        <div className="mobile-persistent-banner">
          <div className="mobile-banner-content">
            <AlertTriangle size={14} color="#f59e0b" style={{ flexShrink: 0 }} />
            <span>Mobile screen detected. Desktop recommended.</span>
          </div>
          <div className="mobile-banner-actions">
            <button
              type="button"
              className="mobile-banner-link"
              onClick={handleReopen}
            >
              Details
            </button>
            <button
              type="button"
              className="mobile-banner-close"
              onClick={() => setShowBanner(false)}
              aria-label="Close banner"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
