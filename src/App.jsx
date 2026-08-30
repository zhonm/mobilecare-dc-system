import { Component } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Login from './components/Login';
import CreatePassword from './components/CreatePassword';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CommandPalette from './components/CommandPalette';
import Dashboard from './components/Dashboard';
import DataImport from './components/DataImport';
import Forecasting from './components/Forecasting';
import SavedRecords from './components/SavedRecords';
import PurchaseOrders from './components/PurchaseOrders';
import ScanInReceiving from './components/ScanInReceiving';
import IntakeRecords from './components/IntakeRecords';
import AllocationMatrix from './components/AllocationMatrix';
import ScanOutPacking from './components/ScanOutPacking';
import Shipments from './components/Shipments';
import StockTransferReports from './components/StockTransferReports';
import ForecastingReports from './components/ForecastingReports';
import AuditTrail from './components/AuditTrail';
import SettingsCatalog from './components/SettingsCatalog';
import UserAccessManagement from './components/UserAccessManagement';
import RequestParts from './components/RequestParts';
import UnauthorizedAccess from './components/UnauthorizedAccess';
import MobileWarning from './components/MobileWarning';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import './App.css';

function MainApp() {
  const {
    currentUser,
    pendingFirstTimeUser,
    activeTab,
    canAccess,
    toast,
    isCommandPaletteOpen,
    setIsCommandPaletteOpen
  } = useApp();

  // 1. Auth Guard: Show CreatePassword or Login if not authenticated
  if (!currentUser) {
    if (pendingFirstTimeUser) {
      return <CreatePassword />;
    }
    return <Login />;
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
      case 'records':
        return <SavedRecords />;
      case 'orders':
        return <PurchaseOrders />;
      case 'scan-in':
        return <ScanInReceiving />;
      case 'intake-records':
        return <IntakeRecords />;
      case 'allocation':
        return <AllocationMatrix />;
      case 'scan-out':
        return <ScanOutPacking />;
      case 'shipments':
        return <Shipments />;
      case 'request-parts':
        return <RequestParts />;
      case 'all-stocks':
        return <RequestParts defaultTab="all_stocks" />;
      case 'reports':
        return <StockTransferReports />;
      case 'forecast-reports':
        return <ForecastingReports />;
      case 'audit':
        return <AuditTrail />;
      case 'settings':
        return <SettingsCatalog />;
      case 'user-access':
        return <UserAccessManagement />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        <Header />
        <main className="page-body">
          {renderActiveTab()}
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
        <MobileWarning />
        <MainApp />
      </AppProvider>
    </ErrorBoundary>
  );
}
