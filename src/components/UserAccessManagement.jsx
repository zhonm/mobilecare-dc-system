import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ALL_PAGES } from '../constants/navigation';
import { ROLE_OPTIONS, ROLE_PRESETS, getDefaultRolePosition } from '../constants/roles';
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
  AlertCircle
} from 'lucide-react';

const SUGGESTED_POSITIONS = [
  'DC Operations Lead',
  'Warehouse Specialist',
  'Inventory Controller',
  'Logistics Coordinator',
  'Service Center Technician',
  'Branch Coordinator',
  'Management Auditor'
];

const emptyForm = {
  fullName: '',
  email: '',
  role: 'user',
  rolePosition: '',
  siteId: 'site-dc',
  permittedPages: [...ROLE_PRESETS.user]
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

  const [form, setForm] = useState(emptyForm);

  const isSuperadmin = currentUser?.role === 'superadmin';
  const isAdmin = currentUser?.role === 'admin';

  const matrixPages = ALL_PAGES.filter(p => p.id !== 'user-access');
  const adminUsers = usersList.filter(u => u.role === 'admin');

  const openAddModal = () => {
    setForm({
      ...emptyForm,
      role: 'user',
      rolePosition: getDefaultRolePosition('user'),
      permittedPages: [...ROLE_PRESETS.user]
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
      siteId: user.siteId || 'site-dc',
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
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim()) {
      showToast('Please provide full name and company email', 'error');
      return;
    }

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
    if (!deletingUser) return;
    if (deleteUser) {
      const res = await deleteUser(deletingUser.id);
      if (res && res.success !== false) {
        closeModals();
      }
    } else {
      closeModals();
    }
  };

  return (
    <div className="user-access-view" style={{ maxWidth: '1240px', margin: '0 auto', animation: 'fadeIn 0.2s ease-out' }}>
      <div
        className="card"
        style={{
          marginBottom: '20px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid #334155'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 800, margin: 0 }}>
                User Access & Role Management
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <ShieldCheck size={13} />
                {currentUser?.role?.toUpperCase() || 'SUPERADMIN'}
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
              Superadmin full system governance • Admin custom permissions • User view-only operations
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {autoRefreshData && (
              <button
                className="btn btn-secondary"
                style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.2)' }}
                onClick={() => autoRefreshData({ force: true, silent: false, reason: 'User Access manual sync' })}
                disabled={isAutoRefreshing}
                title="Sync users and permissions from cloud database"
              >
                <RefreshCw size={14} className={isAutoRefreshing ? 'spin' : ''} />
                <span>{isAutoRefreshing ? 'Syncing…' : 'Sync DB'}</span>
              </button>
            )}

            {isSuperadmin && (
              <>
                <button
                  className="btn btn-secondary"
                  style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.2)' }}
                  onClick={() => openPasswordResetModal(currentUser)}
                >
                  <KeyRound size={15} />
                  <span>Reset My Password</span>
                </button>

                <button className="btn btn-primary" onClick={openAddModal} style={{ background: '#0284c7' }}>
                  <UserPlus size={16} />
                  <span>Add New User</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '16px',
          marginBottom: '22px'
        }}
      >
        <div className="card" style={{ borderLeft: '4px solid #0284c7', background: '#f8fafc', padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{ padding: '6px', background: '#e0f2fe', borderRadius: '6px', color: '#0284c7' }}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>1. Superadmin</strong>
              <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 700 }}>Full Unrestricted Access</div>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
            Unrestricted access to all operations, demand models, database tools, site catalogs, and security permissions.
          </p>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #8b5cf6', background: '#f8fafc', padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{ padding: '6px', background: '#ede9fe', borderRadius: '6px', color: '#8b5cf6' }}>
              <Sliders size={18} />
            </div>
            <div>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>2. Admin</strong>
              <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 700 }}>Custom Superadmin Assigned</div>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
            Page permissions are granted by Superadmin. Admins can manage operations and edit user Role Positions.
          </p>
        </div>

        <div className="card" style={{ borderLeft: '4px solid #10b981', background: '#f8fafc', padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <div style={{ padding: '6px', background: '#dcfce7', borderRadius: '6px', color: '#10b981' }}>
              <Eye size={18} />
            </div>
            <div>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>3. User (View &amp; Export Only)</strong>
              <div style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>Read-Only &amp; XLSX Export</div>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', margin: 0, lineHeight: 1.4 }}>
            Unrestricted view and styled XLSX export access to Demand Forecasting, Allocation Matrix, Reports, Saved Period Records, and POs. Operations and physical logistics are restricted.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px' }}>Provisioned Staff Accounts</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              All registered users with their assigned security role, role position, and permitted modules.
            </p>
          </div>
          <span className="badge badge-primary">{usersList.length} Accounts</span>
        </div>

        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ minWidth: '220px' }}>User & Email</th>
                <th style={{ minWidth: '180px' }}>Role Position</th>
                <th style={{ textAlign: 'center', width: '130px' }}>Security Role</th>
                <th style={{ textAlign: 'center', width: '140px' }}>Assigned Site</th>
                <th style={{ textAlign: 'center', width: '110px' }}>Account Status</th>
                <th style={{ textAlign: 'center', width: '110px' }}>Permitted Pages</th>
                <th style={{ textAlign: 'center', minWidth: '150px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersList.map(user => {
                const isSuper = user.role === 'superadmin';
                const isSelf = user.id === currentUser?.id || user.email?.toLowerCase() === currentUser?.email?.toLowerCase();
                const siteObj = sites.find(s => s.id === user.siteId || s.code === user.siteId || s.id === user.site_id || s.code === user.siteCode) || {};
                const canEditFull = isSuperadmin;
                const canEditPosition = isSuperadmin || (isAdmin && user.role === 'user');

                const getRoleColor = (role) => {
                  if (role === 'superadmin') return { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', avatarBg: '#0284c7' };
                  if (role === 'admin') return { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe', avatarBg: '#7c3aed' };
                  if (role === 'parts_management') return { bg: '#fef3c7', text: '#b45309', border: '#fde68a', avatarBg: '#d97706' };
                  return { bg: '#dcfce7', text: '#047857', border: '#bbf7d0', avatarBg: '#059669' };
                };
                const roleColors = getRoleColor(user.role);

                return (
                  <tr key={user.id} style={{ opacity: user.isActive ? 1 : 0.6 }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '34px',
                            height: '34px',
                            borderRadius: '50%',
                            background: roleColors.avatarBg,
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '13px'
                          }}
                        >
                          {user.fullName ? user.fullName.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <strong style={{ fontSize: '13px', color: '#0f172a' }}>{user.fullName}</strong>
                            {isSelf && <span style={{ fontSize: '10.5px', color: '#0284c7', fontWeight: 700 }}>(You)</span>}
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#64748b', fontFamily: 'var(--font-mono)' }}>{user.email}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Briefcase size={13} color="#64748b" />
                        <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1e293b' }}>
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
                              padding: '2px 4px',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center'
                            }}
                            title="Quick Edit Role Position"
                          >
                            <Pencil size={11} />
                          </button>
                        )}
                      </div>
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <span
                        className="badge"
                        style={{
                          background: roleColors.bg,
                          color: roleColors.text,
                          border: `1px solid ${roleColors.border}`,
                          fontWeight: 700,
                          fontSize: '11px',
                          textTransform: 'uppercase'
                        }}
                      >
                        {user.role === 'parts_management' ? 'PMG' : (user.role || 'USER').toUpperCase()}
                      </span>
                    </td>

                    <td style={{ textAlign: 'center', fontSize: '12px', color: '#475569' }}>
                      {siteObj.name || siteObj.code || 'DC Central'}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${user.isActive ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '11px' }}>
                        {user.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      {isSuper ? (
                        <span className="badge badge-primary" style={{ fontSize: '11px' }}>All {ROLE_PRESETS.superadmin?.length || 17} Pages</span>
                      ) : (
                        <span className="badge" style={{ background: '#f1f5f9', color: '#334155', fontSize: '11px' }}>
                          {user.permittedPages?.length || 0} Pages
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {canEditFull ? (
                          <>
                            <button
                              className="btn btn-sm btn-secondary"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => openEditModal(user)}
                              title="Edit full profile and permissions"
                            >
                              <Pencil size={12} />
                              <span>Edit</span>
                            </button>

                            <button
                              className="btn btn-sm btn-secondary"
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                color: '#0369a1',
                                background: '#f0f9ff',
                                borderColor: '#bae6fd'
                              }}
                              onClick={() => openPasswordResetModal(user)}
                              title={`Reset password for ${user.fullName}${isSelf ? ' (Your account)' : ''}`}
                            >
                              <KeyRound size={12} />
                              <span>Password</span>
                            </button>
                          </>
                        ) : canEditPosition ? (
                          <button
                            className="btn btn-sm btn-secondary"
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                            onClick={() => openPositionModal(user)}
                            title="Edit role position"
                          >
                            <Briefcase size={12} />
                            <span>Position</span>
                          </button>
                        ) : null}

                        {isSuperadmin && !isSelf && (
                          <>
                            <button
                              className={`btn btn-sm ${user.isActive ? 'btn-secondary' : 'btn-primary'}`}
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => toggleUserActiveStatus(user.id)}
                              title={user.isActive ? 'Deactivate user' : 'Reactivate user'}
                            >
                              {user.isActive ? <UserX size={12} /> : <UserCheck size={12} />}
                            </button>

                            <button
                              className="btn btn-sm btn-danger"
                              style={{ fontSize: '11px', padding: '3px 8px' }}
                              onClick={() => setDeletingUser(user)}
                              title="Delete user account"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isSuperadmin && adminUsers.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sliders size={18} color="#7c3aed" />
              <h3 style={{ margin: 0, fontSize: '16px' }}>Admin Page Permissions Matrix</h3>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              As Superadmin, you control precisely which operational pages each Admin account is allowed to access.
            </p>
          </div>

          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 10, minWidth: '200px' }}>
                    Admin Account
                  </th>
                  {matrixPages.map(page => (
                    <th key={page.id} style={{ textAlign: 'center', fontSize: '11px', whiteSpace: 'nowrap', padding: '8px 6px' }}>
                      {page.label}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', minWidth: '120px' }}>Quick Presets</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map(admin => (
                  <tr key={admin.id}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg-surface)', zIndex: 5 }}>
                      <div>
                        <strong style={{ fontSize: '13px', color: '#0f172a' }}>{admin.fullName}</strong>
                        <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600 }}>
                          {admin.rolePosition || 'DC Operations Lead'}
                        </div>
                      </div>
                    </td>

                    {matrixPages.map(page => {
                      const isGranted = admin.permittedPages?.includes(page.id) ?? false;
                      return (
                        <td key={page.id} style={{ textAlign: 'center', padding: '6px 4px' }}>
                          <button
                            type="button"
                            onClick={() => toggleUserPagePermission(admin.id, page.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                              transition: 'transform 0.1s ease'
                            }}
                            title={`${isGranted ? 'Revoke' : 'Grant'} access to ${page.label}`}
                          >
                            {isGranted ? (
                              <CheckCircle2 size={18} color="#0284c7" />
                            ) : (
                              <XCircle size={18} color="#cbd5e1" />
                            )}
                          </button>
                        </td>
                      );
                    })}

                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '10.5px', padding: '2px 6px' }}
                        onClick={() => applyRolePresetToUser(admin.id, 'admin')}
                        title="Reset to default admin template"
                      >
                        Reset Defaults
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
              maxWidth: '600px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '24px 28px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {editingUser ? <Pencil size={18} /> : <UserPlus size={18} />}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                    {editingUser ? 'Edit User Account' : 'Add New User'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                    Configure user identity, system role, and job position.
                  </p>
                </div>
              </div>
              <button type="button" onClick={closeModals} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <User size={13} />
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

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Mail size={13} />
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

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Shield size={13} />
                  <span>Security Role</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {ROLE_OPTIONS.map(opt => (
                    <div
                      key={opt.value}
                      onClick={() => handleRoleChangeInForm(opt.value)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: form.role === opt.value ? '2px solid #0284c7' : '1px solid #cbd5e1',
                        background: form.role === opt.value ? '#f0f9ff' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '12.5px', color: form.role === opt.value ? '#0284c7' : '#0f172a' }}>
                        {opt.label}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', lineHeight: 1.3 }}>
                        {opt.value === 'superadmin' ? 'Full access' : opt.value === 'admin' ? 'Assigned access' : opt.value === 'parts_management' ? 'Site Parts Requests Only' : 'View only'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Briefcase size={13} />
                  <span>Role Position / Job Title</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Warehouse Specialist, Logistics Coordinator..."
                  value={form.rolePosition}
                  onChange={(e) => setForm(prev => ({ ...prev, rolePosition: e.target.value }))}
                  required
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
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
                        padding: '2px 8px',
                        fontSize: '11px',
                        cursor: 'pointer'
                      }}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MapPin size={13} />
                  <span>Assigned Location</span>
                </label>
                <select
                  className="form-select"
                  value={form.siteId}
                  onChange={(e) => setForm(prev => ({ ...prev, siteId: e.target.value }))}
                >
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {form.role === 'admin' && (
                <div style={{ marginBottom: '16px', padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700, fontSize: '12.5px', color: '#0f172a', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sliders size={14} color="#7c3aed" />
                    <span>Permitted Pages for this Admin</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {matrixPages.map(page => {
                      const isChecked = form.permittedPages.includes(page.id);
                      return (
                        <label
                          key={page.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '12px',
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModals}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ background: '#0284c7' }}>
                  {editingUser ? 'Save Changes' : 'Provision User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              maxWidth: '480px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '22px 24px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Briefcase size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Edit Role Position</h3>
              </div>
              <button type="button" onClick={closeModals} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '14px' }}>
              Modify the designated role position for <strong>{positionEditUser.fullName}</strong>.
            </p>

            <form onSubmit={handleSavePositionOnly}>
              <div className="form-group" style={{ marginBottom: '14px' }}>
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
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
                        padding: '2px 8px',
                        fontSize: '11px',
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

      {/* Password Reset Modal (Superadmin Control) */}
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
              maxWidth: '520px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '24px 28px'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <KeyRound size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                    Reset Account Password
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                    Centralized Superadmin Security Control
                  </p>
                </div>
              </div>
              <button type="button" onClick={closeModals} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}>
                <X size={18} />
              </button>
            </div>

            {/* Target Account Summary Banner */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    background: passwordResetUser.role === 'superadmin' ? '#0284c7' : passwordResetUser.role === 'admin' ? '#7c3aed' : '#059669',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '13px'
                  }}
                >
                  {passwordResetUser.fullName ? passwordResetUser.fullName.charAt(0).toUpperCase() : 'U'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{passwordResetUser.fullName}</strong>
                    {passwordResetUser.id === currentUser?.id && (
                      <span style={{ fontSize: '10.5px', color: '#0284c7', fontWeight: 700 }}>(Your Account)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>{passwordResetUser.email}</div>
                </div>
              </div>
              <span
                className="badge"
                style={{
                  background: passwordResetUser.role === 'superadmin' ? '#e0f2fe' : passwordResetUser.role === 'admin' ? '#ede9fe' : '#dcfce7',
                  color: passwordResetUser.role === 'superadmin' ? '#0369a1' : passwordResetUser.role === 'admin' ? '#6d28d9' : '#047857',
                  fontSize: '11px',
                  fontWeight: 700
                }}
              >
                {passwordResetUser.role?.toUpperCase()}
              </span>
            </div>

            <form onSubmit={handleExecutePasswordReset}>
              {/* Option 1: Direct Password Assignment */}
              <div style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Lock size={13} />
                    <span>New Password</span>
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={handleGenerateRandomPassword}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#0284c7',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}
                    >
                      <RefreshCw size={11} /> Generate New
                    </button>
                  </div>
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
                      paddingRight: '76px',
                      fontFamily: showPasswordText ? 'var(--font-mono)' : 'inherit',
                      background: requireNextLogin ? '#f1f5f9' : '#ffffff'
                    }}
                    required={!requireNextLogin}
                  />
                  <div style={{ position: 'absolute', right: '6px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <button
                      type="button"
                      onClick={handleCopyPassword}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '5px',
                        cursor: 'pointer',
                        color: copiedNotice ? '#10b981' : '#64748b',
                        borderRadius: '4px'
                      }}
                      title="Copy to clipboard"
                    >
                      {copiedNotice ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPasswordText(!showPasswordText)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '5px',
                        cursor: 'pointer',
                        color: '#64748b',
                        borderRadius: '4px'
                      }}
                      title={showPasswordText ? 'Hide password' : 'Show password'}
                    >
                      {showPasswordText ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                {copiedNotice && (
                  <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px', fontWeight: 600 }}>
                    ✓ Copied new password to clipboard!
                  </div>
                )}
              </div>

              {/* Option 2: Require Reset on Next Login Checkbox */}
              {passwordResetUser.id !== currentUser?.id && (
                <div
                  style={{
                    marginBottom: '18px',
                    padding: '12px 14px',
                    background: requireNextLogin ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${requireNextLogin ? '#bbf7d0' : '#e2e8f0'}`,
                    borderRadius: '8px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={requireNextLogin}
                      onChange={(e) => setRequireNextLogin(e.target.checked)}
                      style={{ marginTop: '2px', accentColor: '#0284c7', width: '16px', height: '16px' }}
                    />
                    <div>
                      <strong style={{ fontSize: '12.5px', color: requireNextLogin ? '#166534' : '#0f172a' }}>
                        Force User to Set New Password on Next Login
                      </strong>
                      <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                        Sets account status to <code>has_set_password = false</code>. The user will be required to create their own new password upon logging in.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Security Advisory / Notice */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  background: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  marginBottom: '18px',
                  fontSize: '11.5px',
                  color: '#0369a1',
                  lineHeight: 1.4
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>
                  {passwordResetUser.id === currentUser?.id
                    ? 'You are updating your own password. The changes will take effect immediately for your account across all devices.'
                    : `This will immediately update access credentials for ${passwordResetUser.fullName}. Please provide them with the new password.`}
                </span>
              </div>

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModals} disabled={isResettingSubmitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px' }}
                  disabled={isResettingSubmitting}
                >
                  <KeyRound size={14} />
                  <span>{isResettingSubmitting ? 'Updating...' : 'Confirm Password Reset'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              maxWidth: '440px',
              width: '100%',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border-light)',
              padding: '22px 24px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Delete User Account</h3>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '18px', lineHeight: 1.4 }}>
              Are you sure you want to delete <strong>{deletingUser.fullName}</strong> ({deletingUser.email})? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={closeModals}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDeleteUser}>
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
