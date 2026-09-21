import { useState, useEffect } from 'react';
import { Smartphone, Monitor, AlertTriangle, CheckCircle2, ArrowRight, X } from 'lucide-react';

// Comprehensive check for mobile screens and mobile devices
function checkIsMobileScreen() {
  if (typeof window === 'undefined') return false;
  const hasNarrowWidth = typeof window.innerWidth === 'number' && window.innerWidth > 0 && window.innerWidth <= 768;
  const matchesMediaQuery = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  );
  return Boolean(hasNarrowWidth || matchesMediaQuery || isMobileUserAgent);
}

export default function MobileNoticeModal({
  forceOpen = false,
  onClose = null,
  isLoginScreen = true
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // If forced open via button
    if (forceOpen) {
      setIsOpen(true);
      return;
    }

    if (isDismissed) return;

    // Check immediately on mount whether this is a mobile screen
    const evaluate = () => {
      if (isDismissed) return;
      if (checkIsMobileScreen()) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    };

    evaluate();

    window.addEventListener('resize', evaluate);
    window.addEventListener('orientationchange', evaluate);
    return () => {
      window.removeEventListener('resize', evaluate);
      window.removeEventListener('orientationchange', evaluate);
    };
  }, [forceOpen, isDismissed]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setIsOpen(false);
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-notice-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '430px',
          width: '100%',
          background: '#0f172a',
          color: '#f8fafc',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.08)',
          position: 'relative'
        }}
      >
        {/* Header Section */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.18)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Smartphone size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.4)'
                  }}
                >
                  System Notice
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Mobile Access</span>
              </div>
              <h2
                id="mobile-notice-title"
                style={{
                  margin: '4px 0 0 0',
                  fontSize: '17px',
                  fontWeight: 800,
                  color: '#ffffff',
                  letterSpacing: '-0.01em'
                }}
              >
                Desktop-Optimized System
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close notice"
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
              transition: 'background 0.2s ease, color 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#94a3b8';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Notice Box: System is not optimized for mobile */}
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '12px',
            padding: '12px 14px',
            marginBottom: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
            <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#fbbf24' }}>
              System Not Optimized for Mobile Devices
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#e2e8f0', lineHeight: 1.5 }}>
            The Distribution Center (DC) System is engineered primarily for desktop and laptop workstations (warehouse barcode scanning, high-density inventory matrices, and label printing).
          </p>
        </div>

        {/* Reassurance Box: User can still log in and access */}
        <div
          style={{
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.28)',
            borderRadius: '12px',
            padding: '12px 14px',
            marginBottom: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
            <CheckCircle2 size={16} color="#38bdf8" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8' }}>
              You Can Still Log In &amp; Access Features
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '12.5px', color: '#e2e8f0', lineHeight: 1.5 }}>
            You are welcome to log in and use the system from this mobile device if you choose to proceed. All core actions remain accessible.
          </p>
        </div>

        {/* Primary Action Button */}
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            width: '100%',
            padding: '12px 18px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '14px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
            transition: 'transform 0.15s ease, filter 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'brightness(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'none';
          }}
        >
          <span>{isLoginScreen ? 'I Choose to Proceed to Login' : 'I Choose to Proceed'}</span>
          <ArrowRight size={16} />
        </button>

        {/* Desktop Recommendation Footnote */}
        <div style={{ marginTop: '12px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <Monitor size={12} color="#64748b" />
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            For warehouse inventory, a desktop display is recommended.
          </span>
        </div>
      </div>
    </div>
  );
}
