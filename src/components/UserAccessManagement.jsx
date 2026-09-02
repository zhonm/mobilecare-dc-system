import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ALL_PAGES } from '../constants/navigation';
import { ROLE_OPTIONS, ROLE_PRESETS, getDefaultRolePosition, sortUsersDeterministically } from '../constants/roles';
import { resolveSite } from '../utils/appContextHelpers';
import {
  ShieldCheck,
  UserPlus,
  CheckCircle2,
  XCircle,
  UserX,
  UserCheck,
  Pencil,
  Trash2,
  X,
  Mail,
  User,
  MapPin,
  Shield,
  Briefcase,
  Sliders,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  Search,
  Package
} from 'lucide-react';

const SUGGESTED_POSITIONS = [
  'Parts Management Specialist',
  'DC Operations Lead',
  'Warehouse Specialist',
  'Inventory Controller',
  'Logistics Coordinator',
  'Service Center Technician',
  'Branch Coordinator',
  'Area Manager',
  'Management Auditor'
];

const emptyForm = {
  fullName: '',
  email: '',
  role: 'parts_management',
  rolePosition: '',
  siteId: 'site-dc',
  permittedPages: [...ROLE_PRESETS.parts_management]
};

export default function UserAccessManagement() {
  const {
    usersList,
    sites,
    provisionUser,
    updateUser,
    updateUserRolePosition,
    resetUserPassword,
    deleteUser,
    toggleUserPagePermission,
    applyRolePresetToUser,
    toggleUserActiveStatus,
    currentUser,
    showToast,
    isAutoRefreshing,
    autoRefreshData
  } = useApp();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState('role_hierarchy');

  // Modals State
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [positionEditUser, setPositionEditUser] = useState(null);
  const [newPositionText, setNewPositionText] = useState('');
  
  // Password Reset Modal State
  const [passwordResetUser, setPasswordResetUser] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [requireNextLogin, setRequireNextLogin] = useState(false);
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [isResettingSubmitting, setIsResettingSubmitting] = useState(false);
  const [isDeletingSubmitting, setIsDeletingSubmitting] = useState(false);
  const [isProvisionSubmitting, setIsProvisionSubmitting] = useState(false);

  const [form, setForm] = useState(emptyForm);

  const isSuperadmin = currentUser?.role === 'superadmin';
  const isAdmin = currentUser?.role === 'admin';

  const matrixPages = ALL_PAGES.filter(p => p.id !== 'user-access');
  const adminUsers = useMemo(() => (usersList || []).filter(u => u.role === 'admin'), [usersList]);

  // Dynamic statistics calculations
  const stats = useMemo(() => {
    const total = (usersList || []).length;
    const superadmins = (usersList || []).filter(u => u.role === 'superadmin').length;
    const admins = (usersList || []).filter(u => u.role === 'admin').length;
    const pmgSpecialists = (usersList || []).filter(u => u.role === 'parts_management').length;
    const standardUsers = (usersList || []).filter(u => u.role === 'user').length;
    const activeAccounts = (usersList || []).filter(u => u.isActive !== false).length;
    return { total, superadmins, admins, pmgSpecialists, standardUsers, activeAccounts };
  }, [usersList]);

  // Deterministic filtered and sorted user list
  const filteredUsers = useMemo(() => {
    let list = [...(usersList || [])];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(u => {
        const nameMatch = (u.fullName || '').toLowerCase().includes(q);
        const emailMatch = (u.email || '').toLowerCase().includes(q);
        const posMatch = (u.rolePosition || '').toLowerCase().includes(q);
        const site = resolveSite(u.siteId || u.site_id || u.siteCode, sites);
        const siteMatch = (site.name || '').toLowerCase().includes(q) || (site.code || '').toLowerCase().includes(q);
        return nameMatch || emailMatch || posMatch || siteMatch;
      });
    }

    // Role filter
    if (roleFilter !== 'ALL') {
      list = list.filter(u => u.role === roleFilter);
    }

    // Site filter
    if (siteFilter !== 'ALL') {
      list = list.filter(u => {
        const s = resolveSite(u.siteId || u.site_id || u.siteCode, sites);
        return s.id === siteFilter || s.code === siteFilter;
      });
    }

    // Deterministic Sorting
    if (sortKey === 'role_hierarchy') {
      return sortUsersDeterministically(list);
    }

    if (sortKey === 'name_asc') {
      return list.sort((a, b) => (a.fullName || a.email || '').localeCompare(b.fullName || b.email || ''));
    }

    if (sortKey === 'name_desc') {
      return list.sort((a, b) => (b.fullName || b.email || '').localeCompare(a.fullName || a.email || ''));
    }

    if (sortKey === 'site') {
      return list.sort((a, b) => {
        const siteA = resolveSite(a.siteId || a.site_id || a.siteCode, sites).code || '';
        const siteB = resolveSite(b.siteId || b.site_id || b.siteCode, sites).code || '';
        return siteA.localeCompare(siteB);
      });
    }

    if (sortKey === 'status') {
      return list.sort((a, b) => (b.isActive !== false ? 1 : 0) - (a.isActive !== false ? 1 : 0));
    }

    return sortUsersDeterministically(list);
  }, [usersList, searchQuery, roleFilter, siteFilter, sortKey, sites]);

  const openAddModal = () => {
    const defaultSiteId = (sites || []).find(s => s.is_dc || s.code === 'DC' || s.code === 'DC-MDC')?.id || sites?.[0]?.id || 'site-dc';
    setForm({
      ...emptyForm,
      role: 'parts_management',
      rolePosition: getDefaultRolePosition('parts_management'),
      siteId: defaultSiteId,
      permittedPages: [...ROLE_PRESETS.parts_management]
    });
    setShowAddModal(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName,
      email: user.email,
      role: user.role || 'user',
      rolePosition: user.rolePosition || getDefaultRolePosition(user.role || 'user'),
      siteId: user.siteId || user.site_id || 'site-dc',
      permittedPages: Array.isArray(user.permittedPages) ? [...user.permittedPages] : [...(ROLE_PRESETS[user.role] || ROLE_PRESETS.user)]
    });
  };

  const openPositionModal = (user) => {
    setPositionEditUser(user);
    setNewPositionText(user.rolePosition || getDefaultRolePosition(user.role || 'user'));
  };

  const openPasswordResetModal = (user) => {
    setPasswordResetUser(user);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let res = '';
    for (let i = 0; i < 10; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPasswordInput(res);
    setRequireNextLogin(false);
    setShowPasswordText(true);
    setCopiedNotice(false);
  };

  const closeModals = () => {
    setShowAddModal(false);
    setEditingUser(null);
    setDeletingUser(null);
    setPositionEditUser(null);
    setPasswordResetUser(null);
    setForm(emptyForm);
    setIsResettingSubmitting(false);
    setIsProvisionSubmitting(false);
  };

  const handleCopyPassword = () => {
    navigator.clipboard?.writeText(newPasswordInput);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  const handleGenerateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let res = '';
    for (let i = 0; i < 10; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPasswordInput(res);
    setShowPasswordText(true);
  };

  const handleExecutePasswordReset = async (e) => {
    e.preventDefault();
    if (!passwordResetUser) return;
    if (!requireNextLogin && (!newPasswordInput || newPasswordInput.length < 4)) {
      showToast('Password must be at least 4 characters long', 'error');
      return;
    }

    setIsResettingSubmitting(true);
    try {
      if (resetUserPassword) {
        const res = await resetUserPassword(passwordResetUser.id, {
          newPassword: newPasswordInput,
          requireNextLoginReset: requireNextLogin
        });
        if (res && res.success !== false) {
          closeModals();
        }
      }
    } finally {
      setIsResettingSubmitting(false);
    }
  };

  const handleRoleChangeInForm = (newRole) => {
    const defaultPages = ROLE_PRESETS[newRole] || ROLE_PRESETS.user;
    setForm(prev => ({
      ...prev,
      role: newRole,
      rolePosition: prev.rolePosition && prev.rolePosition !== getDefaultRolePosition(prev.role)
        ? prev.rolePosition
        : getDefaultRolePosition(newRole),
      permittedPages: [...defaultPages]
    }));
  };

  const handleToggleModalPage = (pageId) => {
    setForm(prev => {
      const has = prev.permittedPages.includes(pageId);
      return {
        ...prev,
        permittedPages: has
          ? prev.permittedPages.filter(p => p !== pageId)
          : [...prev.permittedPages, pageId]
      };
    });
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim()) {
      showToast('Please provide full name and company email', 'error');
      return;
    }

    setIsProvisionSubmitting(true);
    try {
      const res = await provisionUser({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        role: form.role,
        rolePosition: form.rolePosition.trim() || getDefaultRolePosition(form.role),
        siteId: form.siteId,
        customPermissions: form.role === 'admin' ? form.permittedPages : undefined
      });

      if (res && res.success !== false) {
        closeModals();
      }
    } finally {
      setIsProvisionSubmitting(false);
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim()) {
      showToast('Please provide full name and company email', 'error');
      return;
    }

    setIsProvisionSubmitting(true);
    try {
      if (updateUser) {
        const res = await updateUser(editingUser.id, {
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          role: form.role,
          rolePosition: form.rolePosition.trim() || getDefaultRolePosition(form.role),
          siteId: form.siteId,
          permittedPages: form.role === 'admin' ? form.permittedPages : (ROLE_PRESETS[form.role] || ROLE_PRESETS.user)
        });
        if (res && res.success !== false) {
          closeModals();
        }
      } else {
        closeModals();
      }
    } finally {
      setIsProvisionSubmitting(false);
    }
  };

  const handleSavePositionOnly = async (e) => {
    e.preventDefault();
    if (!positionEditUser) return;
    const res = await updateUserRolePosition(positionEditUser.id, newPositionText);
    if (res && res.success !== false) {
      closeModals();
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser || isDeletingSubmitting) return;
    setIsDeletingSubmitting(true);
    try {
      if (deleteUser) {
        const res = await deleteUser(deletingUser.id);
        if (res && res.success !== false) {
          closeModals();
        }
      } else {
        closeModals();
      }
    } finally {
      setIsDeletingSubmitting(false);
    }
  };

  const getRoleBadgeStyle = (role) => {
    switch (role) {
      case 'superadmin':
        return { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', avatarBg: '#0284c7', label: 'SUPERADMIN' };
      case 'admin':
        return { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe', avatarBg: '#7c3aed', label: 'ADMIN' };
      case 'parts_management':
        return { bg: '#fef3c7', text: '#b45309', border: '#fde68a', avatarBg: '#d97706', label: 'PMG SPECIALIST' };
      case 'user':
      default:
        return { bg: '#dcfce7', text: '#047857', border: '#bbf7d0', avatarBg: '#059669', label: 'VIEW & EXPORT' };
    }
  };

  return (
    <div className="user-access-view" style={{ maxWidth: '100%', margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      
      {/* Top Hero Banner */}
      <div
        className="card"
        style={{
          marginBottom: '20px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
          color: '#ffffff',
          padding: '22px 26px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid #334155',
          boxShadow: '0 8px 20px -4px rgba(15, 23, 42, 0.35)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <div style={{ padding: '7px', background: 'rgba(2, 132, 199, 0.2)', borderRadius: '8px', color: '#38bdf8' }}>
                <ShieldCheck size={22} />
              </div>
              <div>
                <h2 style={{ color: '#fff', fontSize: '19px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                  User Access &amp; Role Management
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                  <span
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em'
                    }}
                  >
                    Superadmin Full Governance
                  </span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>•</span>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {stats.activeAccounts} of {stats.total} accounts active across {sites.length} facilities
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'manual_db_sync' })}
              disabled={isAutoRefreshing}
              style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#fff', borderColor: 'rgba(255, 255, 255, 0.2)', padding: '7px 12px', fontSize: '12.5px' }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin-anim' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Sync DB'}</span>
            </button>

            {currentUser && (
              <button
                className="btn btn-secondary"
                onClick={() => openPasswordResetModal(currentUser)}
                style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#fff', borderColor: 'rgba(255, 255, 255, 0.2)', padding: '7px 12px', fontSize: '12.5px' }}
              >
                <KeyRound size={13} />
                <span>Reset My Password</span>
              </button>
            )}

            {isSuperadmin && (
              <button
                className="btn btn-primary"
                onClick={openAddModal}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  border: 'none',
                  boxShadow: '0 4px 12px rgba(2, 132, 199, 0.35)',
                  fontWeight: 700,
                  padding: '7px 14px',
                  fontSize: '12.5px'
                }}
              >
                <UserPlus size={15} />
                <span>Add New User</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4 Interactive Role Overview & Filter Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
          marginBottom: '18px'
        }}
      >
        <div
          onClick={() => setRoleFilter(prev => prev === 'superadmin' ? 'ALL' : 'superadmin')}
          className="card"
          style={{
            cursor: 'pointer',
            borderLeft: '4px solid #0284c7',
            background: roleFilter === 'superadmin' ? '#f0f9ff' : '#ffffff',
            borderColor: roleFilter === 'superadmin' ? '#0284c7' : 'var(--border-light)',
            padding: '14px 16px',
            transition: 'all 0.15s ease',
            boxShadow: roleFilter === 'superadmin' ? '0 0 0 2px rgba(2, 132, 199, 0.2)' : 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ padding: '5px', background: '#e0f2fe', borderRadius: '6px', color: '#0284c7' }}>
                <ShieldCheck size={16} />
              </div>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>1. Superadmin</strong>
            </div>
            <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 800, fontSize: '11px' }}>
              {stats.superadmins}
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: '#64748b', margin: 0, lineHeight: 1.35 }}>
            Master governance across models, physical inventory, logs, and security.
          </p>
        </div>

        <div
          onClick={() => setRoleFilter(prev => prev === 'admin' ? 'ALL' : 'admin')}
          className="card"
          style={{
            cursor: 'pointer',
            borderLeft: '4px solid #8b5cf6',
            background: roleFilter === 'admin' ? '#faf5ff' : '#ffffff',
            borderColor: roleFilter === 'admin' ? '#8b5cf6' : 'var(--border-light)',
            padding: '14px 16px',
            transition: 'all 0.15s ease',
            boxShadow: roleFilter === 'admin' ? '0 0 0 2px rgba(139, 92, 246, 0.2)' : 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ padding: '5px', background: '#ede9fe', borderRadius: '6px', color: '#8b5cf6' }}>
                <Sliders size={16} />
              </div>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>2. Admin</strong>
            </div>
            <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9', fontWeight: 800, fontSize: '11px' }}>
              {stats.admins}
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: '#64748b', margin: 0, lineHeight: 1.35 }}>
            Operations planning lead with customizable module permissions.
          </p>
        </div>

        <div
          onClick={() => setRoleFilter(prev => prev === 'parts_management' ? 'ALL' : 'parts_management')}
          className="card"
          style={{
            cursor: 'pointer',
            borderLeft: '4px solid #d97706',
            background: roleFilter === 'parts_management' ? '#fffbeb' : '#ffffff',
            borderColor: roleFilter === 'parts_management' ? '#d97706' : 'var(--border-light)',
            padding: '14px 16px',
            transition: 'all 0.15s ease',
            boxShadow: roleFilter === 'parts_management' ? '0 0 0 2px rgba(217, 119, 6, 0.2)' : 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ padding: '5px', background: '#fef3c7', borderRadius: '6px', color: '#d97706' }}>
                <Package size={16} />
              </div>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>3. PMG Specialist</strong>
            </div>
            <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontWeight: 800, fontSize: '11px' }}>
              {stats.pmgSpecialists}
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: '#64748b', margin: 0, lineHeight: 1.35 }}>
            Retail branch portal for replenishment requests, scan-in, and local stock.
          </p>
        </div>

        <div
          onClick={() => setRoleFilter(prev => prev === 'user' ? 'ALL' : 'user')}
          className="card"
          style={{
            cursor: 'pointer',
            borderLeft: '4px solid #10b981',
            background: roleFilter === 'user' ? '#f0fdf4' : '#ffffff',
            borderColor: roleFilter === 'user' ? '#10b981' : 'var(--border-light)',
            padding: '14px 16px',
            transition: 'all 0.15s ease',
            boxShadow: roleFilter === 'user' ? '0 0 0 2px rgba(16, 185, 129, 0.2)' : 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ padding: '5px', background: '#dcfce7', borderRadius: '6px', color: '#10b981' }}>
                <Eye size={16} />
              </div>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>4. View &amp; Export</strong>
            </div>
            <span className="badge" style={{ background: '#dcfce7', color: '#047857', fontWeight: 800, fontSize: '11px' }}>
              {stats.standardUsers}
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: '#64748b', margin: 0, lineHeight: 1.35 }}>
            Read-only analytics and corporate XLSX export for Forecasting and Reports.
          </p>
        </div>
      </div>

      {/* Main Staff Accounts Card with Unified Horizontal Filter Bar */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px', boxShadow: 'var(--shadow-sm)' }}>
        
        {/* Horizontal Filter Bar */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border-light)',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          {/* Search Box */}
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: '200px', maxWidth: '380px' }}>
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search by name, email, role, or branch..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                paddingLeft: '32px',
                paddingRight: searchQuery ? '28px' : '10px',
                height: '36px',
                fontSize: '12.5px',
                margin: 0,
                width: '100%',
                display: 'block'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  padding: '2px'
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Inline Filter Selects in one horizontal row */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="form-select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{ height: '36px', fontSize: '12px', padding: '0 24px 0 10px', width: 'auto', minWidth: '120px', margin: 0, display: 'inline-block' }}
            >
              <option value="ALL">All Roles</option>
              <option value="superadmin">Superadmin</option>
              <option value="admin">Admin</option>
              <option value="parts_management">PMG Specialist</option>
              <option value="user">User (View Only)</option>
            </select>

            <select
              className="form-select"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              style={{ height: '36px', fontSize: '12px', padding: '0 24px 0 10px', width: 'auto', minWidth: '135px', margin: 0, display: 'inline-block' }}
            >
              <option value="ALL">All Locations</option>
              {sites.map(s => (
                <option key={s.id || s.code} value={s.id}>
                  {s.code} ({s.name})
                </option>
              ))}
            </select>

            <select
              className="form-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              style={{ height: '36px', fontSize: '12px', padding: '0 24px 0 10px', width: 'auto', minWidth: '145px', margin: 0, display: 'inline-block' }}
            >
              <option value="role_hierarchy">Sort: Role Hierarchy</option>
              <option value="name_asc">Sort: Name (A to Z)</option>
              <option value="name_desc">Sort: Name (Z to A)</option>
              <option value="site">Sort: Location</option>
              <option value="status">Sort: Status</option>
            </select>

            {(roleFilter !== 'ALL' || siteFilter !== 'ALL' || searchQuery) && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setRoleFilter('ALL');
                  setSiteFilter('ALL');
                  setSearchQuery('');
                  setSortKey('role_hierarchy');
                }}
                style={{ height: '36px', fontSize: '11.5px', padding: '0 10px' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results Header Status */}
        <div
          style={{
            padding: '8px 18px',
            background: '#f8fafc',
            borderBottom: '1px solid var(--border-light)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11.5px',
            color: '#64748b'
          }}
        >
          <div>
            Showing <strong>{filteredUsers.length}</strong> of <strong>{usersList.length}</strong> registered staff accounts
            {roleFilter !== 'ALL' && <span style={{ marginLeft: '4px', fontWeight: 600, color: '#0284c7' }}>({roleFilter.toUpperCase()})</span>}
          </div>
        </div>

        {/* Accounts Table */}
        <div className="table-container" style={{ border: 'none', borderRadius: 0, overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', minWidth: '940px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: '25%', minWidth: '220px', padding: '10px 16px', textAlign: 'left' }}>Staff Identity &amp; Email</th>
                <th style={{ width: '19%', minWidth: '170px', padding: '10px 12px', textAlign: 'left' }}>Designated Role Position</th>
                <th style={{ width: '13%', minWidth: '120px', textAlign: 'center', padding: '10px 10px' }}>Security Role</th>
                <th style={{ width: '17%', minWidth: '160px', textAlign: 'left', padding: '10px 12px' }}>Assigned Location</th>
                <th style={{ width: '8%', minWidth: '80px', textAlign: 'center', padding: '10px 8px' }}>Status</th>
                <th style={{ width: '8%', minWidth: '90px', textAlign: 'center', padding: '10px 8px' }}>Scope</th>
                <th style={{ width: '10%', minWidth: '100px', textAlign: 'center', padding: '10px 10px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '44px 16px' }}>
                    <div style={{ maxWidth: '320px', margin: '0 auto', color: '#94a3b8' }}>
                      <UserX size={34} style={{ marginBottom: '8px', strokeWidth: 1.5 }} />
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#475569' }}>No Matching Accounts Found</div>
                      <p style={{ fontSize: '11.5px', marginTop: '4px', lineHeight: 1.4 }}>
                        Try adjusting your search criteria or resetting filters.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map(user => {
                  const isSuper = user.role === 'superadmin';
                  const isSelf = user.id === currentUser?.id || user.email?.toLowerCase() === currentUser?.email?.toLowerCase();
                  const siteObj = resolveSite(user.siteId || user.site_id || user.siteCode, sites);
                  const canEditFull = isSuperadmin;
                  const canEditPosition = isSuperadmin || (isAdmin && user.role === 'user');
                  const roleStyle = getRoleBadgeStyle(user.role);

                  return (
                    <tr
                      key={user.id}
                      style={{
                        opacity: user.isActive !== false ? 1 : 0.6,
                        background: isSelf ? '#f0f9ff44' : 'transparent',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      {/* Identity & Email */}
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              background: roleStyle.avatarBg,
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 800,
                              fontSize: '13px',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
                              flexShrink: 0
                            }}
                          >
                            {user.fullName ? user.fullName.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <strong style={{ fontSize: '13px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {user.fullName}
                              </strong>
                              {isSelf && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    color: '#0284c7',
                                    background: '#e0f2fe',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    fontWeight: 700
                                  }}
                                >
                                  You
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'var(--font-mono)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {user.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role Position */}
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Briefcase size={12} color="#64748b" style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {user.rolePosition || getDefaultRolePosition(user.role || 'user')}
                          </span>
                          {canEditPosition && (
                            <button
                              onClick={() => openPositionModal(user)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#0284c7',
                                cursor: 'pointer',
                                padding: '2px',
                                borderRadius: '3px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                flexShrink: 0
                              }}
                              title="Quick Edit Role Position"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Security Role Badge */}
                      <td style={{ textAlign: 'center', padding: '10px 10px' }}>
                        <span
                          className="badge"
                          style={{
                            background: roleStyle.bg,
                            color: roleStyle.text,
                            border: `1px solid ${roleStyle.border}`,
                            fontWeight: 800,
                            fontSize: '10.5px',
                            padding: '2px 7px',
                            letterSpacing: '0.02em',
                            display: 'inline-block'
                          }}
                        >
                          {roleStyle.label}
                        </span>
                      </td>

                      {/* Assigned Location */}
                      <td style={{ textAlign: 'left', padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                          <MapPin size={12} color="#0284c7" style={{ flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                              {siteObj.code || 'DC-MDC'}
                            </div>
                            <div style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '170px' }}>
                              {siteObj.name || 'MobileCare Central DC'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                        <span
                          className="badge"
                          style={{
                            background: user.isActive !== false ? '#dcfce7' : '#fee2e2',
                            color: user.isActive !== false ? '#15803d' : '#b91c1c',
                            border: `1px solid ${user.isActive !== false ? '#bbf7d0' : '#fecaca'}`,
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 6px'
                          }}
                        >
                          {user.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Permitted Pages */}
                      <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                        {isSuper ? (
                          <span className="badge badge-primary" style={{ fontSize: '10.5px', padding: '2px 6px' }}>
                            All 17
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', fontSize: '10.5px', padding: '2px 6px' }}
                          >
                            {user.permittedPages?.length || 0} Modules
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'center', padding: '10px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', flexWrap: 'nowrap' }}>
                          {canEditFull ? (
                            <>
                              <button
                                className="btn btn-sm btn-secondary"
                                style={{ fontSize: '11px', padding: '3px 7px', borderRadius: '5px' }}
                                onClick={() => openEditModal(user)}
                                title="Edit profile"
                              >
                                <Pencil size={11} />
                              </button>

                              <button
                                className="btn btn-sm btn-secondary"
                                style={{
                                  fontSize: '11px',
                                  padding: '3px 7px',
                                  borderRadius: '5px',
                                  color: '#0369a1',
                                  background: '#f0f9ff',
                                  borderColor: '#bae6fd'
                                }}
                                onClick={() => openPasswordResetModal(user)}
                                title="Password credentials"
                              >
                                <KeyRound size={11} />
                              </button>
                            </>
                          ) : canEditPosition ? (
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ fontSize: '11px', padding: '3px 7px', borderRadius: '5px' }}
                              onClick={() => openPositionModal(user)}
                              title="Edit position"
                            >
                              <Briefcase size={11} />
                            </button>
                          ) : null}

                          {isSuperadmin && !isSelf && (
                            <>
                              <button
                                className={`btn btn-sm ${user.isActive !== false ? 'btn-secondary' : 'btn-primary'}`}
                                style={{ fontSize: '11px', padding: '3px 6px', borderRadius: '5px' }}
                                onClick={() => toggleUserActiveStatus(user.id)}
                                title={user.isActive !== false ? 'Deactivate user' : 'Reactivate user'}
                              >
                                {user.isActive !== false ? <UserX size={11} /> : <UserCheck size={11} />}
                              </button>

                              <button
                                className="btn btn-sm btn-danger"
                                style={{ fontSize: '11px', padding: '3px 6px', borderRadius: '5px' }}
                                onClick={() => setDeletingUser(user)}
                                title="Delete user account"
                              >
                                <Trash2 size={11} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Admin Page Permissions Matrix (Superadmin Exclusive) */}
      {isSuperadmin && adminUsers.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-light)', background: '#ffffff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ padding: '5px', background: '#ede9fe', borderRadius: '6px', color: '#7c3aed' }}>
                <Sliders size={16} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                  Admin Module Permissions Matrix
                </h3>
                <p style={{ margin: '1px 0 0', fontSize: '11.5px', color: '#64748b' }}>
                  Granular control over operational module access for designated Administrator accounts.
                </p>
              </div>
            </div>
          </div>

          <div className="table-container" style={{ overflowX: 'auto', border: 'none', borderRadius: 0 }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 10, minWidth: '200px', padding: '10px 14px' }}>
                    Administrator Account
                  </th>
                  {matrixPages.map(page => (
                    <th key={page.id} style={{ textAlign: 'center', fontSize: '11px', whiteSpace: 'nowrap', padding: '8px 6px' }}>
                      {page.label}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', minWidth: '110px', padding: '8px 10px' }}>Preset</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map(admin => (
                  <tr key={admin.id}>
                    <td style={{ position: 'sticky', left: 0, background: '#ffffff', zIndex: 5, padding: '10px 14px', borderRight: '1px solid var(--border-light)' }}>
                      <div>
                        <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{admin.fullName}</strong>
                        <div style={{ fontSize: '10.5px', color: '#7c3aed', fontWeight: 600 }}>
                          {admin.rolePosition || 'DC Operations Lead'}
                        </div>
                      </div>
                    </td>

                    {matrixPages.map(page => {
                      const isGranted = admin.permittedPages?.includes(page.id) ?? false;
                      return (
                        <td key={page.id} style={{ textAlign: 'center', padding: '5px 4px' }}>
                          <button
                            type="button"
                            onClick={() => toggleUserPagePermission(admin.id, page.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '3px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px'
                            }}
                            title={`${isGranted ? 'Revoke' : 'Grant'} access to ${page.label}`}
                          >
                            {isGranted ? (
                              <CheckCircle2 size={16} color="#0284c7" />
                            ) : (
                              <XCircle size={16} color="#cbd5e1" />
                            )}
                          </button>
                        </td>
                      );
                    })}

                    <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}
                        onClick={() => applyRolePresetToUser(admin.id, 'admin')}
                        title="Reset to standard admin permissions"
                      >
                        Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add User Creation / Edit Profile Modal */}
      {(showAddModal || editingUser) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModals();
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '580px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '16px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              border: '1px solid var(--border-light)',
              padding: '22px 24px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {editingUser ? <Pencil size={18} /> : <UserPlus size={18} />}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                    {editingUser ? 'Edit User Profile & Access' : 'Create New Staff Account'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                    {editingUser ? 'Update credentials, site assignment, and role permissions.' : 'Provision identity, security role, and branch location in PostgreSQL.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModals}
                style={{
                  border: 'none',
                  background: '#f1f5f9',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b'
                }}
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser}>
              
              {/* Row 1: Full Name & Company Email */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700 }}>
                    <User size={12} color="#0284c7" />
                    <span>Full Name</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Maria Santos"
                    value={form.fullName}
                    onChange={(e) => setForm(prev => ({ ...prev, fullName: e.target.value }))}
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700 }}>
                    <Mail size={12} color="#0284c7" />
                    <span>Company Email</span>
                  </label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="e.g. maria.santos@mobilecareph.com"
                    value={form.email}
                    onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </div>
              </div>

              {/* Row 2: Security Role Selection */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700 }}>
                  <Shield size={12} color="#0284c7" />
                  <span>Security Role</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {ROLE_OPTIONS.map(opt => {
                    const isSelected = form.role === opt.value;
                    return (
                      <div
                        key={opt.value}
                        onClick={() => handleRoleChangeInForm(opt.value)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid #0284c7' : '1px solid #e2e8f0',
                          background: isSelected ? '#f0f9ff' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 700, fontSize: '12px', color: isSelected ? '#0284c7' : '#0f172a' }}>
                            {opt.label}
                          </span>
                          {isSelected && <CheckCircle2 size={13} color="#0284c7" />}
                        </div>
                        <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px', lineHeight: 1.25 }}>
                          {opt.value === 'superadmin' && 'Full governance access'}
                          {opt.value === 'admin' && 'Operational lead controls'}
                          {opt.value === 'parts_management' && 'Site parts requests & stock'}
                          {opt.value === 'user' && 'View-only demand & export'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Row 3: Role Position */}
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700 }}>
                  <Briefcase size={12} color="#0284c7" />
                  <span>Role Position / Job Title</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Parts Management Specialist..."
                  value={form.rolePosition}
                  onChange={(e) => setForm(prev => ({ ...prev, rolePosition: e.target.value }))}
                  required
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                  {SUGGESTED_POSITIONS.map(pos => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, rolePosition: pos }))}
                      style={{
                        background: form.rolePosition === pos ? '#e0f2fe' : '#f1f5f9',
                        color: form.rolePosition === pos ? '#0369a1' : '#475569',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        padding: '2px 7px',
                        fontSize: '10.5px',
                        fontWeight: form.rolePosition === pos ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 4: Assigned Facility Location */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700 }}>
                  <MapPin size={12} color="#0284c7" />
                  <span>Assigned Location / Service Branch</span>
                </label>
                <select
                  className="form-select"
                  value={form.siteId}
                  onChange={(e) => setForm(prev => ({ ...prev, siteId: e.target.value }))}
                >
                  {sites.map(s => (
                    <option key={s.id || s.code} value={s.id}>
                      {s.code} - {s.name} {s.is_dc ? '(Central DC)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Admin Permissions Checklist (Conditional) */}
              {form.role === 'admin' && (
                <div style={{ marginBottom: '14px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Sliders size={13} color="#7c3aed" />
                    <span>Permitted Modules for this Admin</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {matrixPages.map(page => {
                      const isChecked = form.permittedPages.includes(page.id);
                      return (
                        <label
                          key={page.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '11.5px',
                            color: isChecked ? '#0f172a' : '#64748b',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleModalPage(page.id)}
                            style={{ accentColor: '#0284c7' }}
                          />
                          <span>{page.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModals} disabled={isProvisionSubmitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    border: 'none',
                    fontWeight: 700,
                    minWidth: '120px'
                  }}
                  disabled={isProvisionSubmitting}
                >
                  {isProvisionSubmitting ? 'Saving...' : (editingUser ? 'Save Changes' : 'Provision User')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Edit Position Modal */}
      {positionEditUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModals();
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '460px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '14px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '20px 22px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Briefcase size={16} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Edit Role Position</h3>
              </div>
              <button type="button" onClick={closeModals} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSavePositionOnly}>
              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Role Position / Job Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={newPositionText}
                  onChange={(e) => setNewPositionText(e.target.value)}
                  placeholder="e.g. Warehouse Specialist..."
                  required
                  autoFocus
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }}>
                  {SUGGESTED_POSITIONS.map(pos => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setNewPositionText(pos)}
                      style={{
                        background: newPositionText === pos ? '#e0f2fe' : '#f1f5f9',
                        color: newPositionText === pos ? '#0369a1' : '#475569',
                        border: '1px solid #e2e8f0',
                        borderRadius: '4px',
                        padding: '2px 7px',
                        fontSize: '10.5px',
                        cursor: 'pointer'
                      }}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModals}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ background: '#0284c7' }}>
                  Update Position
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {passwordResetUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModals();
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '500px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '14px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '22px 24px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <KeyRound size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                    Reset Account Password
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#64748b' }}>
                    Centralized Superadmin Security Governance
                  </p>
                </div>
              </div>
              <button type="button" onClick={closeModals} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: getRoleBadgeStyle(passwordResetUser.role).avatarBg,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '12.5px'
                  }}
                >
                  {passwordResetUser.fullName ? passwordResetUser.fullName.charAt(0).toUpperCase() : 'U'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>{passwordResetUser.fullName}</strong>
                    {passwordResetUser.id === currentUser?.id && (
                      <span style={{ fontSize: '10px', color: '#0284c7', fontWeight: 700 }}>(Your Account)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{passwordResetUser.email}</div>
                </div>
              </div>
              <span
                className="badge"
                style={{
                  ...getRoleBadgeStyle(passwordResetUser.role),
                  fontSize: '10.5px',
                  fontWeight: 700
                }}
              >
                {getRoleBadgeStyle(passwordResetUser.role).label}
              </span>
            </div>

            <form onSubmit={handleExecutePasswordReset}>
              <div style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Lock size={12} />
                    <span>New Password</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleGenerateRandomPassword}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#0284c7',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                  >
                    <RefreshCw size={10} /> Generate New
                  </button>
                </label>

                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    className="form-input"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    disabled={requireNextLogin}
                    placeholder="Enter new secure password..."
                    style={{
                      paddingRight: '70px',
                      fontFamily: showPasswordText ? 'var(--font-mono)' : 'inherit',
                      background: requireNextLogin ? '#f1f5f9' : '#ffffff'
                    }}
                    required={!requireNextLogin}
                  />
                  <div style={{ position: 'absolute', right: '5px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <button
                      type="button"
                      onClick={handleCopyPassword}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        color: copiedNotice ? '#10b981' : '#64748b',
                        borderRadius: '3px'
                      }}
                      title="Copy to clipboard"
                    >
                      {copiedNotice ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPasswordText(!showPasswordText)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        color: '#64748b',
                        borderRadius: '3px'
                      }}
                      title={showPasswordText ? 'Hide password' : 'Show password'}
                    >
                      {showPasswordText ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                {copiedNotice && (
                  <div style={{ fontSize: '10.5px', color: '#10b981', marginTop: '3px', fontWeight: 600 }}>
                    ✓ Copied new password to clipboard!
                  </div>
                )}
              </div>

              {passwordResetUser.id !== currentUser?.id && (
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '10px 12px',
                    background: requireNextLogin ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${requireNextLogin ? '#bbf7d0' : '#e2e8f0'}`,
                    borderRadius: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={requireNextLogin}
                      onChange={(e) => setRequireNextLogin(e.target.checked)}
                      style={{ marginTop: '2px', accentColor: '#0284c7', width: '15px', height: '15px' }}
                    />
                    <div>
                      <strong style={{ fontSize: '12px', color: requireNextLogin ? '#166534' : '#0f172a' }}>
                        Force User to Set New Password on Next Login
                      </strong>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b', lineHeight: 1.35 }}>
                        Sets account status to <code>has_set_password = false</code>.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '7px',
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  padding: '9px 11px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '11px',
                  color: '#0369a1',
                  lineHeight: 1.35
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>
                  {passwordResetUser.id === currentUser?.id
                    ? 'You are updating your own password. Changes will take effect immediately.'
                    : `This will immediately update access credentials for ${passwordResetUser.fullName}.`}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModals} disabled={isResettingSubmitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: '#0284c7', display: 'flex', alignItems: 'center', gap: '5px' }}
                  disabled={isResettingSubmitting}
                >
                  <KeyRound size={13} />
                  <span>{isResettingSubmitting ? 'Updating...' : 'Confirm Password Reset'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModals();
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '14px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '20px 22px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={17} />
              </div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Delete User Account</h3>
            </div>
            <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '16px', lineHeight: 1.4 }}>
              Are you sure you want to permanently delete <strong>{deletingUser.fullName}</strong> ({deletingUser.email}) from PostgreSQL?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={closeModals} disabled={isDeletingSubmitting}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDeleteUser} disabled={isDeletingSubmitting}>
                <span>{isDeletingSubmitting ? 'Deleting...' : 'Delete User'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
