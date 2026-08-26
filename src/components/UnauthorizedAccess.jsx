import { useApp } from '../context/AppContext';
import { ALL_PAGES, PAGE_TITLES } from '../constants/navigation';
import {
  ShieldAlert,
  ArrowLeft,
  LogOut,
  Lock,
  CheckCircle2
} from 'lucide-react';

export default function UnauthorizedAccess() {
  const { currentUser, activeTab, setActiveTab, signOut, canAccess } = useApp();

  const currentModule = ALL_PAGES.find(p => p.id === activeTab);
  const moduleTitle = PAGE_TITLES[activeTab] || currentModule?.label || activeTab;
  const allowedPages = ALL_PAGES.filter(p => canAccess(p.id));
  const hasAllowedPages = allowedPages.length > 0;
  const primaryAllowedPage = allowedPages[0];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '75vh',
        padding: '24px 16px',
        animation: 'fadeIn 0.2s ease-out'
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '580px',
          width: '100%',
          padding: '36px 32px',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid #fee2e2',
          background: '#ffffff',
          textAlign: 'center'
        }}
      >
        {/* Security Shield Icon Header */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#fef2f2',
            border: '2px solid #fecaca',
            color: '#dc2626',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '18px',
            boxShadow: '0 0 0 6px rgba(239, 68, 68, 0.08)'
          }}
        >
          <Lock size={30} />
        </div>

        {/* Status Badge */}
        <div style={{ marginBottom: '12px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 12px',
              borderRadius: '999px',
              background: '#fee2e2',
              color: '#b91c1c',
              fontSize: '11.5px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}
          >
            <ShieldAlert size={13} />
            Direct Link Restricted
          </span>
        </div>

        <h2 style={{ fontSize: '21px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
          Access to This Module Is Restricted
        </h2>

        <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.55, marginBottom: '20px' }}>
          You do not have permission to open or view{' '}
          <strong style={{ color: '#0f172a', fontWeight: 700 }}>
            &ldquo;{moduleTitle}&rdquo;
          </strong>
          . Even if a direct URL link was shared with you, access remains locked until explicitly granted by the Super Admin.
        </p>

        {/* Security Details Card */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '16px 18px',
            textAlign: 'left',
            marginBottom: '24px'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Target Module:</span>
            <span style={{ color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <code>#{activeTab}</code>
              <span style={{ color: '#94a3b8', fontSize: '12px' }}>({currentModule?.section || 'System'})</span>
            </span>

            <span style={{ color: '#64748b', fontWeight: 600 }}>Your Account:</span>
            <span style={{ color: '#0f172a' }}>
              {currentUser?.fullName || 'User'}{' '}
              <span style={{ color: '#64748b', fontSize: '12px' }}>({currentUser?.email})</span>
            </span>

            <span style={{ color: '#64748b', fontWeight: 600 }}>Assigned Role:</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>
              <span
                style={{
                  background: '#e0f2fe',
                  color: '#0284c7',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  marginRight: '6px'
                }}
              >
                {currentUser?.role || 'USER'}
              </span>
              <span style={{ color: '#64748b', fontSize: '12.5px' }}>
                {currentUser?.rolePosition || 'Staff'}
              </span>
            </span>

            <span style={{ color: '#64748b', fontWeight: 600 }}>Governance:</span>
            <span style={{ color: '#475569', fontSize: '12.5px' }}>
              Permissions are configured in the <strong>Admin Page Permissions Matrix</strong> by Superadmin.
            </span>
          </div>
        </div>

        {/* Permitted Modules Fast Switcher */}
        {hasAllowedPages && (
          <div style={{ marginBottom: '24px', textAlign: 'left' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Your Authorized Modules ({allowedPages.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {allowedPages.map(page => (
                <button
                  key={page.id}
                  onClick={() => setActiveTab(page.id)}
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    color: '#1e293b',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#e2e8f0';
                    e.currentTarget.style.borderColor = '#94a3b8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }}
                >
                  <CheckCircle2 size={12} color="#16a34a" />
                  <span>{page.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {primaryAllowedPage && (
            <button
              className="btn btn-primary"
              onClick={() => setActiveTab(primaryAllowedPage.id)}
              style={{ background: '#0284c7', borderColor: '#0284c7' }}
            >
              <ArrowLeft size={16} />
              <span>Go to {primaryAllowedPage.label}</span>
            </button>
          )}

          <button className="btn btn-secondary" onClick={signOut}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
