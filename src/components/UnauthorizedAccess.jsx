import { useApp } from '../context/AppContext';
import { ALL_PAGES } from '../constants/navigation';
import { ShieldAlert, ArrowLeft, LogOut } from 'lucide-react';

export default function UnauthorizedAccess() {
  const { currentUser, setActiveTab, signOut, canAccess } = useApp();

  const allowedPages = ALL_PAGES.filter(p => canAccess(p.id));
  const hasAllowedPages = allowedPages.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '20px'
      }}
    >
      <div className="card" style={{ maxWidth: '500px', width: '100%', textAlign: 'center', padding: '36px 28px' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'var(--danger-light)',
            color: 'var(--danger)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '16px'
          }}
        >
          <ShieldAlert size={28} />
        </div>

        <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>
          {hasAllowedPages ? 'Access Restricted' : 'Account Under Setup'}
        </h2>

        <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.5 }}>
          {hasAllowedPages
            ? `You do not have permission to view this section under your assigned role (${currentUser?.role?.replace('_', ' ')}). Please contact your administrator if you need access.`
            : `Your account (${currentUser?.email}) has been provisioned, but no page permissions have been assigned to you yet. Please contact your Superadmin.`}
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
          {hasAllowedPages ? (
            <button className="btn btn-primary" onClick={() => setActiveTab(allowedPages[0].id)}>
              <ArrowLeft size={16} />
              <span>Back to {allowedPages[0].label}</span>
            </button>
          ) : null}

          <button className="btn btn-secondary" onClick={signOut}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
