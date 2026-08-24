import { useApp } from '../context/AppContext';
import mobileCareLogo from '../assets/mobilecare_logo.png';
import {
  LayoutDashboard,
  UploadCloud,
  TrendingUp,
  BookmarkCheck,
  BookmarkPlus,
  ShoppingCart,
  Barcode,
  Split,
  PackageCheck,
  Truck,
  FileSpreadsheet,
  BarChart3,
  History,
  Settings,
  ShieldCheck,
  Users,
  LogOut
} from 'lucide-react';

export default function Sidebar() {
  const {
    activeTab,
    setActiveTab,
    currentUser,
    canAccess,
    signOut,
    purchaseOrders,
    shipments,
    sites
  } = useApp();

  const openPOsCount = purchaseOrders.filter(p => p.status !== 'closed' && p.status !== 'received').length;
  const pendingShipmentsCount = shipments.filter(s => s.status === 'draft' || s.status === 'packing').length;

  const userSite = sites.find(s => s.id === currentUser?.siteId);

  const navItems = [
    { id: 'dashboard', label: 'DC Overview', icon: LayoutDashboard, section: 'Core' },
    { id: 'import', label: 'Fixably / GSX Data Import', icon: UploadCloud, section: 'Planning' },
    { id: 'forecast', label: 'Demand Forecasting', icon: TrendingUp, section: 'Planning' },
    { id: 'records', label: 'Saved Period Records', icon: BookmarkCheck, section: 'Planning' },
    { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart, badge: openPOsCount, section: 'Planning' },
    { id: 'scan-in', label: 'Receive Scan-In', icon: Barcode, hotkey: 'F1', section: 'Warehouse Operations' },
    { id: 'intake-records', label: 'DC Intake Records', icon: BookmarkPlus, section: 'Warehouse Operations' },
    { id: 'allocation', label: 'Allocation Matrix', icon: Split, section: 'Warehouse Operations' },
    { id: 'scan-out', label: 'Pack Scan-Out', icon: PackageCheck, hotkey: 'F2', badge: pendingShipmentsCount, section: 'Warehouse Operations' },
    { id: 'shipments', label: 'Shipments & Packing Lists', icon: Truck, section: 'Distribution' },
    { id: 'reports', label: 'Stock Transfer Reports', icon: FileSpreadsheet, section: 'Reports & Analytics' },
    { id: 'forecast-reports', label: 'Forecasting Reports', icon: BarChart3, section: 'Reports & Analytics' },
    { id: 'audit', label: 'Serialized Audit Log', icon: History, section: 'Traceability' },
    { id: 'settings', label: 'Parts & Site Catalog', icon: Settings, section: 'Admin' },
    { id: 'user-access', label: 'User Access Management', icon: Users, section: 'Admin' }
  ];

  // Filter items by permitted access
  const visibleItems = navItems.filter(item => canAccess(item.id));
  const sections = ['Core', 'Planning', 'Warehouse Operations', 'Distribution', 'Reports & Analytics', 'Traceability', 'Admin'];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo-img-wrapper">
          <img
            src={mobileCareLogo}
            alt="Mobile Care"
            className="sidebar-logo-img"
          />
        </div>
        <div className="sidebar-brand">
          <h2>DC System</h2>
          <p>Mobile Care Services Phils.</p>
        </div>
      </div>

      <div className="sidebar-nav">
        {sections.map(secName => {
          const items = visibleItems.filter(item => item.section === secName);
          if (items.length === 0) return null;

          return (
            <div key={secName}>
              <div className="nav-section-title">{secName}</div>
              {items.map(item => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <div
                    key={item.id}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveTab(item.id)}
                  >
                    <div className="nav-item-left">
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {item.hotkey && <span className="nav-hotkey">{item.hotkey}</span>}
                      {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <div className="user-profile-badge" style={{ marginBottom: '10px' }}>
          <div className="user-avatar">
            <ShieldCheck size={16} />
          </div>
          <div className="user-info-text" style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentUser?.fullName || 'User'}
            </h4>
            <div style={{ fontSize: '11px', color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }} title={currentUser?.rolePosition || 'DC Operations'}>
              {currentUser?.rolePosition || (currentUser?.role === 'superadmin' ? 'Superadmin' : currentUser?.role === 'admin' ? 'Operations Lead' : 'DC Specialist')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
              <span className="badge badge-primary" style={{ fontSize: '9.5px', padding: '1px 5px', textTransform: 'uppercase' }}>
                {currentUser?.role?.replace('_', ' ')}
              </span>
              {userSite && (
                <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                  {userSite.code}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={signOut}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            background: '#1e293b',
            border: '1px solid #334155',
            color: '#cbd5e1',
            padding: '7px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'all 0.15s ease'
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = '#334155'; e.currentTarget.style.color = '#fff'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.color = '#cbd5e1'; }}
        >
          <LogOut size={13} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
