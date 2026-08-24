import { useState } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { hashPassword } from '../utils/security';
import { isAllowedCompanyEmail } from '../utils/userMatcher';
import {
  INITIAL_USERS,
  ROLE_PRESETS,
  getDefaultRolePosition,
  LEGACY_MOCK_EMAILS,
  LEGACY_MOCK_IDS
} from '../constants/roles';

export function useUserManagement({
  currentUser,
  setCurrentUser,
  showToast,
  broadcastCloudEvent,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [usersList, setUsersList] = useState(() => {
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const saved = localStorage.getItem('mdc_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.filter(u =>
          !deletedIds.includes(u.id) &&
          !deletedIds.includes(u.email?.toLowerCase()) &&
          !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
          !LEGACY_MOCK_IDS.includes(u.id)
        );
      }
      return INITIAL_USERS.filter(u =>
        !deletedIds.includes(u.id) &&
        !deletedIds.includes(u.email?.toLowerCase()) &&
        !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
        !LEGACY_MOCK_IDS.includes(u.id)
      );
    } catch (e) {
      console.warn('Error loading mdc_users:', e);
    }
    return INITIAL_USERS;
  });

  // 1. Create / Provision New User
  const provisionUser = async ({ fullName, email, role, rolePosition, siteId, customPermissions }) => {
    const cleanEmail = email.trim().toLowerCase();

    if (!isAllowedCompanyEmail(cleanEmail)) {
      showToast('User email must belong to an official Mobile Care company domain (@mobilecareph.com, @mobilecare.com.ph).', 'error');
      return { success: false, error: 'External email domains are prohibited for internal security.' };
    }

    if (usersList.some(u => u.email.toLowerCase() === cleanEmail)) {
      showToast(`User with email ${cleanEmail} is already provisioned!`, 'error');
      return { success: false, error: 'User already exists' };
    }

    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const filteredDeleted = deletedIds.filter(id => id !== cleanEmail);
      localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(filteredDeleted));
    } catch (e) {}

    const defaultPages = customPermissions || ROLE_PRESETS[role] || ROLE_PRESETS.user;
    const finalRolePosition = String(rolePosition || '').trim() || getDefaultRolePosition(role);

    const newUser = {
      id: `usr-${Date.now()}`,
      email: cleanEmail,
      fullName: fullName.trim(),
      role,
      rolePosition: finalRolePosition,
      siteId: siteId || 'site-dc',
      hasSetPassword: false,
      passwordHash: null,
      isActive: true,
      permittedPages: role === 'superadmin' ? ROLE_PRESETS.superadmin : defaultPages
    };

    const nextList = [...usersList.filter(u => u.email.toLowerCase() !== cleanEmail), newUser];
    setUsersList(nextList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: inserted, error: profErr } = await supabase
          .from('profiles')
          .upsert({
            email: cleanEmail,
            full_name: fullName.trim(),
            role: role,
            role_position: finalRolePosition,
            has_set_password: false,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'email' })
          .select();

        if (profErr) throw profErr;

        const effectiveUserId = inserted?.[0]?.id || newUser.id;
        if (defaultPages && defaultPages.length > 0 && effectiveUserId) {
          const permRows = defaultPages.map(pageId => ({
            user_id: effectiveUserId,
            page_id: pageId
          }));
          const { error: permErr } = await supabase.from('user_page_permissions').upsert(permRows, { onConflict: 'user_id,page_id' });
          if (permErr) console.warn('Permission sync warning:', permErr.message);
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_PROVISIONED', { email: cleanEmail, userId: effectiveUserId });
      } catch (dbErr) {
        console.error('Could not sync provisioned user to Supabase:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PROFILE_UPSERT', {
            email: cleanEmail,
            full_name: fullName.trim(),
            role,
            role_position: finalRolePosition,
            has_set_password: false,
            is_active: true,
            updated_at: new Date().toISOString()
          });
        }
        showToast(`Warning: Cloud sync error (${dbErr.message}). Provisioned locally.`, 'warning');
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_PROVISIONED', { email: cleanEmail, userId: newUser.id });
    }

    showToast(`Provisioned user ${fullName} (${cleanEmail}) as ${finalRolePosition}.`, 'success');
    return { success: true, user: newUser };
  };

  // 2. Update User Page Permission
  const toggleUserPagePermission = async (userId, pageId) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (!targetUser) return;

    if (targetUser.role === 'superadmin' && pageId === 'user-access') {
      showToast('Superadmin cannot revoke access to User Access Management', 'warning');
      return;
    }

    const hasPage = targetUser.permittedPages?.includes(pageId);
    const newPerms = hasPage
      ? targetUser.permittedPages.filter(p => p !== pageId)
      : [...(targetUser.permittedPages || []), pageId];

    setUsersList(prev => prev.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          permittedPages: newPerms
        };
      }
      return user;
    }));

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: prof, error: findErr } = await supabase
          .from('profiles')
          .select('id')
          .or(`id.eq.${userId},email.ilike.${targetUser.email}`)
          .maybeSingle();

        if (findErr) throw findErr;

        if (prof?.id) {
          if (hasPage) {
            const { error: delErr } = await supabase
              .from('user_page_permissions')
              .delete()
              .eq('user_id', prof.id)
              .eq('page_id', pageId);
            if (delErr) throw delErr;
          } else {
            const { error: upErr } = await supabase
              .from('user_page_permissions')
              .upsert({ user_id: prof.id, page_id: pageId }, { onConflict: 'user_id,page_id' });
            if (upErr) throw upErr;
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_PERMISSIONS_UPDATED', { userId: prof?.id || userId, pageId, hasPage: !hasPage });
      } catch (e) {
        console.error('Supabase permission sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_PERMISSIONS_UPDATED', { userId, pageId, hasPage: !hasPage });
    }
  };

  // 3. Apply Role Preset to User
  const applyRolePresetToUser = async (userId, presetRole) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (!targetUser) return;

    const pages = ROLE_PRESETS[presetRole] || [];
    setUsersList(prev => prev.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          role: presetRole,
          permittedPages: pages
        };
      }
      return user;
    }));

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: prof, error: profFindErr } = await supabase
          .from('profiles')
          .select('id')
          .or(`id.eq.${userId},email.ilike.${targetUser.email}`)
          .maybeSingle();

        if (profFindErr) throw profFindErr;

        if (prof?.id) {
          const { error: upProfErr } = await supabase
            .from('profiles')
            .update({ role: presetRole, updated_at: new Date().toISOString() })
            .eq('id', prof.id);
          if (upProfErr) throw upProfErr;

          await supabase
            .from('user_page_permissions')
            .delete()
            .eq('user_id', prof.id);

          const rows = pages.map(pg => ({ user_id: prof.id, page_id: pg }));
          if (rows.length > 0) {
            const { error: permErr } = await supabase.from('user_page_permissions').upsert(rows, { onConflict: 'user_id,page_id' });
            if (permErr) throw permErr;
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_ROLE_UPDATED', { userId: prof?.id || userId, role: presetRole });
      } catch (e) {
        console.error('Supabase role preset sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_ROLE_UPDATED', { userId, role: presetRole });
    }

    showToast(`Applied ${presetRole} default permissions`, 'success');
  };

  // 4. Toggle User Active Status
  const toggleUserActiveStatus = async (userId) => {
    const target = usersList.find(u => u.id === userId);
    if (target?.id === currentUser?.id) {
      showToast('You cannot deactivate your own logged-in account', 'warning');
      return;
    }

    const nextState = !target.isActive;
    setUsersList(prev => prev.map(user => {
      if (user.id === userId) {
        return { ...user, isActive: nextState };
      }
      return user;
    }));

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ is_active: nextState, updated_at: new Date().toISOString() })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_STATUS_UPDATED', { userId, isActive: nextState });
      } catch (e) {
        console.error('Supabase status sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_STATUS_UPDATED', { userId, isActive: nextState });
    }

    showToast(`Account for ${target.fullName} is now ${nextState ? 'Active' : 'Deactivated'}`, 'info');
  };

  // 5. Update User Profile
  const updateUser = async (userId, { fullName, email, role, rolePosition, siteId, permittedPages: customPages }) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) {
      return { success: false, error: 'User not found' };
    }

    const cleanEmail = email.trim().toLowerCase();
    if (usersList.some(u => u.id !== userId && u.email.toLowerCase() === cleanEmail)) {
      showToast(`User with email ${cleanEmail} already exists!`, 'error');
      return { success: false, error: 'Email already in use' };
    }

    const previousEmail = target.email;
    const roleChanged = role !== target.role;
    const resolvedRole = role || target.role;
    const resolvedPosition = String(rolePosition || '').trim() || target.rolePosition || getDefaultRolePosition(resolvedRole);

    let finalPermittedPages = customPages;
    if (!finalPermittedPages) {
      finalPermittedPages = roleChanged
        ? (ROLE_PRESETS[resolvedRole] || target.permittedPages)
        : target.permittedPages;
    }

    const updatedUser = {
      ...target,
      fullName: fullName.trim(),
      email: cleanEmail,
      role: resolvedRole,
      rolePosition: resolvedPosition,
      siteId: siteId || target.siteId,
      permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : finalPermittedPages
    };

    setUsersList(prev => prev.map(u => (u.id === userId ? updatedUser : u)));
    try {
      const nextList = usersList.map(u => u.id === userId ? updatedUser : u);
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (currentUser?.id === userId || currentUser?.email?.toLowerCase() === previousEmail.toLowerCase()) {
      if (setCurrentUser) setCurrentUser(updatedUser);
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        let updatedInDb = false;

        const updatePayload = {
          email: cleanEmail,
          full_name: fullName.trim(),
          role: resolvedRole,
          role_position: resolvedPosition,
          updated_at: new Date().toISOString()
        };

        if (siteId && !siteId.startsWith('site-')) {
          updatePayload.site_id = siteId;
        }

        const { data: byIdData, error: byIdErr } = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', userId)
          .select();

        if (!byIdErr && byIdData && byIdData.length > 0) {
          updatedInDb = true;
        } else {
          const { data: byEmailData, error: byEmailErr } = await supabase
            .from('profiles')
            .update(updatePayload)
            .ilike('email', previousEmail)
            .select();

          if (!byEmailErr && byEmailData && byEmailData.length > 0) {
            updatedInDb = true;
          }
        }

        if (!updatedInDb) {
          const { error: upsertErr } = await supabase
            .from('profiles')
            .upsert({
              email: cleanEmail,
              full_name: fullName.trim(),
              role: resolvedRole,
              role_position: resolvedPosition,
              has_set_password: target.hasSetPassword ?? true,
              is_active: target.isActive ?? true,
              updated_at: new Date().toISOString()
            }, { onConflict: 'email' });
          if (upsertErr) throw upsertErr;
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_UPDATED', { userId, email: cleanEmail });
      } catch (dbErr) {
        console.error('Supabase profile update error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PROFILE_UPSERT', {
            email: cleanEmail,
            full_name: fullName.trim(),
            role: resolvedRole,
            role_position: resolvedPosition,
            updated_at: new Date().toISOString()
          });
        }
        showToast(`Warning: Cloud sync failed (${dbErr.message}). Profile updated locally.`, 'warning');
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_UPDATED', { userId, email: cleanEmail });
    }

    showToast(`Updated profile for ${fullName} (${resolvedPosition})`, 'success');
    return { success: true, user: updatedUser };
  };

  // 6. Update Role Position
  const updateUserRolePosition = async (userId, newRolePosition) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) return { success: false, error: 'User not found' };

    const pos = String(newRolePosition || '').trim() || getDefaultRolePosition(target.role);
    const updatedUser = { ...target, rolePosition: pos };

    setUsersList(prev => prev.map(u => (u.id === userId ? updatedUser : u)));
    if (currentUser?.id === userId && setCurrentUser) {
      setCurrentUser(updatedUser);
    }

    try {
      const nextList = usersList.map(u => u.id === userId ? updatedUser : u);
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ role_position: pos, updated_at: new Date().toISOString() })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_UPDATED', { userId, rolePosition: pos });
      } catch (e) {
        console.error('Supabase role position sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_UPDATED', { userId, rolePosition: pos });
    }

    showToast(`Updated role position for ${target.fullName} to "${pos}"`, 'success');
    return { success: true, user: updatedUser };
  };

  // 7. Reset User Password
  const resetUserPassword = async (userId, { newPassword, requireNextLoginReset = false }) => {
    if (currentUser && currentUser.role !== 'superadmin' && currentUser.id !== userId) {
      showToast('Unauthorized: Only Superadmins can reset passwords for other users.', 'error');
      return { success: false, error: 'Unauthorized' };
    }

    const target = usersList.find(u => u.id === userId);
    if (!target) return { success: false, error: 'User not found' };

    const finalPassword = String(newPassword || '').trim() || 'Password123';
    const hasSet = !requireNextLoginReset;
    const secureHash = await hashPassword(finalPassword);

    const updatedUser = {
      ...target,
      passwordHash: secureHash,
      hasSetPassword: hasSet
    };

    setUsersList(prev => prev.map(u => (u.id === userId ? updatedUser : u)));

    if (currentUser?.id === userId || currentUser?.email?.toLowerCase() === target.email?.toLowerCase()) {
      if (setCurrentUser) setCurrentUser(updatedUser);
    }

    try {
      const nextList = usersList.map(u => (u.id === userId ? updatedUser : u));
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        if (currentUser?.id === userId) {
          try { await supabase.auth.updateUser({ password: finalPassword }); } catch (authErr) {}
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            has_set_password: hasSet,
            password_hash: secureHash,
            updated_at: new Date().toISOString()
          })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_PASSWORD_RESET', { userId });
      } catch (dbErr) {
        console.error('Supabase password reset sync error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_PASSWORD_RESET', { userId });
    }

    if (requireNextLoginReset) {
      showToast(`Password reset for ${target.fullName}. User will configure a new password on their next login.`, 'info');
    } else {
      showToast(`Password successfully updated for ${target.fullName}!`, 'success');
    }

    return { success: true, user: updatedUser };
  };

  // 8. Delete User
  const deleteUser = async (userId) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) {
      return { success: false, error: 'User not found' };
    }

    if (target.id === currentUser?.id) {
      showToast('You cannot delete your own account while logged in', 'warning');
      return { success: false, error: 'Cannot delete self' };
    }

    if (target.role === 'superadmin') {
      const superadminCount = usersList.filter(u => u.role === 'superadmin').length;
      if (superadminCount <= 1) {
        showToast('Cannot delete the last superadmin account', 'error');
        return { success: false, error: 'Last superadmin' };
      }
    }

    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      if (!deletedIds.includes(userId)) deletedIds.push(userId);
      if (target.email && !deletedIds.includes(target.email.toLowerCase())) {
        deletedIds.push(target.email.toLowerCase());
      }
      localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));
    } catch (e) {
      console.warn('Error saving deleted user id:', e);
    }

    const nextList = usersList.filter(u => u.id !== userId && u.email?.toLowerCase() !== target.email?.toLowerCase());
    setUsersList(nextList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        await supabase.from('user_page_permissions').delete().eq('user_id', userId);
        const { error: delProfErr } = await supabase.from('profiles').delete().eq('id', userId);
        if (delProfErr) {
          const { error: delEmailErr } = await supabase.from('profiles').delete().ilike('email', target.email);
          if (delEmailErr) {
            await supabase.from('profiles').update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() }).or(`id.eq.${userId},email.ilike.${target.email}`);
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_DELETED', { userId, email: target.email });
      } catch (e) {
        console.error('Supabase delete user error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) enqueueOfflineAction('PROFILE_DELETE', { id: userId, email: target.email });
        showToast(`Warning: Cloud sync error (${e.message}). User removed locally.`, 'warning');
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_DELETED', { userId, email: target.email });
    }

    showToast(`Deleted user ${target.fullName}`, 'success');
    return { success: true };
  };

  return {
    usersList,
    setUsersList,
    provisionUser,
    updateUser,
    updateUserRolePosition,
    resetUserPassword,
    deleteUser,
    toggleUserPagePermission,
    applyRolePresetToUser,
    toggleUserActiveStatus
  };
}
