import { Component, lazy, Suspense } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Login from './components/Login';
import CreatePassword from './components/CreatePassword';
import FirstLoginLoadingScreen from './components/FirstLoginLoadingScreen';
import Sidebar from './components/Sidebar';
import PmgSidebar from './components/PmgSidebar';
import Header from './components/Header';
import CommandPalette from './components/CommandPalette';
import UnauthorizedAccess from './components/UnauthorizedAccess';
import MobileNoticeModal from './components/MobileNoticeModal';
import { CheckCircle2, AlertCircle, Info, Loader2 } from 'lucide-react';
import './App.css';

// Route-based code splitting: Lazy load heavy modules to optimize initial bundle size & load speed
const Dashboard = lazy(() => import('./components/Dashboard'));
const DataImport = lazy(() => import('./components/DataImport'));
const Forecasting = lazy(() => import('./components/Forecasting'));
const PurchaseOrders = lazy(() => import('./components/PurchaseOrders'));
const ScanInReceiving = lazy(() => import('./components/ScanInReceiving'));
const AllocationMatrix = lazy(() => import('./components/AllocationMatrix'));
const ScanOutPacking = lazy(() => import('./components/ScanOutPacking'));
const Shipments = lazy(() => import('./components/Shipments'));
const SiteTransfersFifoReport = lazy(() => import('./components/SiteTransfersFifoReport'));
const ForecastingReports = lazy(() => import('./components/ForecastingReports'));
const AuditTrail = lazy(() => import('./components/AuditTrail'));
const SettingsCatalog = lazy(() => import('./components/SettingsCatalog'));
const UserAccessManagement = lazy(() => import('./components/UserAccessManagement'));
const RequestParts = lazy(() => import('./components/RequestParts'));
const Feedback = lazy(() => import('./components/Feedback'));
const DriveDocumentHub = lazy(() => import('./components/DriveDocumentHub'));

function ModuleLoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '55vh',
      gap: '14px',
      color: '#64748b'
    }}>
      <Loader2 size={36} className="animate-spin" color="#2563eb" />
      <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.02em' }}>
        Loading module...
      </span>
    </div>
  );
}

function MainApp() {
  const {
    currentUser,
    isInitialSyncing,
    pendingFirstTimeUser,
    activeTab,
    pmgSubTab,
    canAccess,
    toast,
    isCommandPaletteOpen,
    setIsCommandPaletteOpen
  } = useApp();

  // 1. Auth Guard: Show CreatePassword or Login if not authenticated or password not set
  if (!currentUser || currentUser.hasSetPassword === false || !currentUser.hasSetPassword) {
    if (pendingFirstTimeUser || (currentUser && !currentUser.hasSetPassword)) {
      return <CreatePassword />;
    }
    return <Login />;
  }

  // 2. Initial Sync Guard: Block UI until live Supabase data hydration completes
  if (isInitialSyncing) {
    return <FirstLoginLoadingScreen />;
  }

  // 2. Route Guard: Check permission for active tab
  const renderActiveTab = () => {
    if (!canAccess(activeTab)) {
      return <UnauthorizedAccess />;
    }

    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'import':
        return <DataImport />;
      case 'forecast':
        return <Forecasting />;
      case 'orders':
        return <PurchaseOrders />;
      case 'scan-in':
        return (
          <ScanInReceiving
            initialTab={
              currentUser?.role === 'parts_management'
                ? (pmgSubTab === 'station' ? 'station' : (pmgSubTab === 'stock_on_hand' ? 'stock' : null))
                : 'station'
            }
          />
        );
      case 'intake-records':
        return <ScanInReceiving initialTab="records" />;
      case 'allocation':
        return <AllocationMatrix />;
      case 'scan-out':
        return <ScanOutPacking />;
      case 'shipments':
        return <Shipments />;
      case 'request-parts':
        if (currentUser?.role === 'parts_management' && pmgSubTab === 'stock_on_hand') {
          return <ScanInReceiving initialTab="stock" />;
        }
        return <RequestParts defaultTab={pmgSubTab || 'requests_table'} key="request-parts" />;
      case 'all-stocks':
        if (currentUser?.role !== 'superadmin' && !currentUser?.isSuperAdmin) {
          return <RequestParts defaultTab="all_stocks" initialView="multi_site" key="multi-site" />;
        }
        return <RequestParts defaultTab="all_stocks" initialView="all_stocks" key="all-stocks" />;
      case 'multi-site':
        return <RequestParts defaultTab="all_stocks" initialView="multi_site" key="multi-site" />;
      case 'reports':
      case 'site-transfers-fifo':
        return <SiteTransfersFifoReport />;
      case 'forecast-reports':
        return <ForecastingReports />;
      case 'audit':
        return <AuditTrail />;
      case 'settings':
        return <SettingsCatalog />;
      case 'user-access':
        return <UserAccessManagement />;
      case 'feedback':
        return <Feedback />;
      case 'drive-hub':
        return currentUser?.role === 'superadmin' ? <DriveDocumentHub /> : <UnauthorizedAccess />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      <MobileNoticeModal isLoginScreen={false} />
      {currentUser?.role === 'parts_management' ? <PmgSidebar /> : <Sidebar />}
      <div className={`main-content ${currentUser?.role === 'parts_management' ? 'pmg-main-content' : ''}`}>
        <Header />
        <main className="page-body">
          <Suspense fallback={<ModuleLoadingFallback />}>
            {renderActiveTab()}
          </Suspense>
        </main>
      </div>

      {/* Global Command Palette (Cmd+K / Ctrl+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />

      {/* Global Toast Notifications */}
      {toast && (
        <div className={`toast-notification toast-${toast.type}`}>
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} />
          ) : toast.type === 'error' ? (
            <AlertCircle size={18} />
          ) : (
            <Info size={18} />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

// Error Boundary to prevent blank white screens
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[React Error Boundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#f8fafc', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '32px', maxWidth: '520px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <AlertCircle size={24} />
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>Something went wrong</h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', lineHeight: 1.5 }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MainApp />
      </AppProvider>
    </ErrorBoundary>
  );
}
