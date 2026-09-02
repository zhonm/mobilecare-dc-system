import { useState } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { getDefaultRolePosition } from '../constants/roles';

export function useAuditLogs({
  currentUser,
  broadcastCloudEvent,
  setScanLogs
}) {
  const [uploadAuditLogs, setUploadAuditLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_upload_audit_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return [
        {
          id: 'log-september-2026-masterlist',
          timestamp: new Date().toISOString(),
          action_type: 'FILE_IMPORT_APPLIED',
          file_name: 'Battery & Display (Allocation) - September 2026.xlsx',
          file_type: 'WORKBOOK_BUNDLE',
          target_month: 'September 2026',
          total_forecast_units: 591,
          total_allocated_units: 591,
          total_master_cost: 91199,
          parts_count: 40,
          sites_count: 26,
          user_id: 'usr-superadmin-01',
          user_name: 'Zhon Manaois',
          user_email: 'zhonmanaois@gmail.com',
          user_role: 'superadmin',
          status: 'ACTIVE_ON_CLOUD'
        }
      ];
    } catch {
      return [];
    }
  });

  const [deletionAuditLogs, setDeletionAuditLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_deletion_audit_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return [
        {
          id: 'del-audit-init-01',
          timestamp: new Date().toISOString(),
          action: 'DELETE',
          entity_type: 'DC Intake Record',
          entity_id: 'MDC202600001',
          entity_label: 'Intake Batch #MDC202600001',
          deleted_by_id: 'usr-superadmin-zhon',
          deleted_by_name: 'Zhon Manaois',
          deleted_by_email: 'zhon.manaois@mobilecareph.com',
          deleted_by_role: 'superadmin',
          deleted_by_position: 'Parts Management Specialist',
          reason: 'Initial intake test record purged from staging',
          summary: {
            itemsCount: 15,
            intakeDate: '2026-08-20',
            notes: 'Test intake batch'
          }
        }
      ];
    } catch {
      return [];
    }
  });

  const logDeletionAudit = async ({
    entityType,
    entityId,
    entityLabel,
    summary = {},
    reason = 'User initiated deletion'
  }) => {
    const newLog = {
      id: `del-audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      action: 'DELETE',
      entity_type: entityType,
      entity_id: entityId,
      entity_label: entityLabel || entityId,
      deleted_by_id: currentUser?.id || 'usr-system',
      deleted_by_name: currentUser?.fullName || 'System User',
      deleted_by_email: currentUser?.email || '',
      deleted_by_role: currentUser?.role || 'admin',
      deleted_by_position: currentUser?.rolePosition || getDefaultRolePosition(currentUser?.role) || 'Parts Management Specialist',
      reason,
      summary
    };

    setDeletionAuditLogs(prev => {
      const updated = [newLog, ...(prev || [])];
      try {
        localStorage.setItem('mdc_deletion_audit_logs', JSON.stringify(updated.slice(0, 250)));
      } catch (e) {}
      return updated;
    });

    try {
      await dbStorage.setItem('mdc_deletion_audit_logs', [newLog, ...(deletionAuditLogs || [])]);
    } catch (e) {}

    if (supabase) {
      try {
        await supabase.from('audit_logs').insert([{
          action: 'DELETE',
          entity_type: entityType,
          entity_id: entityId,
          user_id: currentUser?.id || 'usr-system',
          user_name: currentUser?.fullName || 'System User',
          user_email: currentUser?.email || '',
          metadata: newLog,
          created_at: newLog.timestamp
        }]);

        // Also persist to guaranteed saved_records deletion registry
        try {
          const { data: regDoc } = await supabase.from('saved_records').select('snapshot_data').eq('id', 'master_deletion_audit_logs_registry').maybeSingle();
          const existingCloudLogs = Array.isArray(regDoc?.snapshot_data?.logs) ? regDoc.snapshot_data.logs : [];
          const mergedLogs = [newLog, ...existingCloudLogs.filter(l => l.id !== newLog.id)].slice(0, 300);

          await supabase.from('saved_records').upsert({
            id: 'master_deletion_audit_logs_registry',
            record_type: 'deletion_audit_registry',
            period_label: 'Master Deletion Audit Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: `Master deletion audit records (${mergedLogs.length} entries)`,
            saved_by_name: currentUser?.fullName || 'Parts Management Specialist',
            snapshot_data: {
              logs: mergedLogs,
              lastUpdated: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        } catch (regErr) {
          console.warn('Could not upsert master_deletion_audit_logs_registry:', regErr);
        }
      } catch (err) {}
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('AUDIT_DELETION_LOGGED', { log: newLog });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records' });
    }
    return newLog;
  };

  /**
   * Superadmin Authority: Permanently delete all audit trail records
   * across local storage, IndexedDB, and Supabase cloud tables (audit_logs, scan_logs, saved_records registries).
   */
  const deleteAllAuditLogs = async () => {
    // 1. Clear Local State
    setUploadAuditLogs([]);
    setDeletionAuditLogs([]);
    if (typeof setScanLogs === 'function') {
      setScanLogs([]);
    }

    // 2. Clear Local Storage
    try {
      localStorage.setItem('mdc_upload_audit_logs', '[]');
      localStorage.setItem('mdc_deletion_audit_logs', '[]');
      localStorage.setItem('mdc_scan_logs', '[]');
    } catch (e) {
      console.warn('Could not clear local storage audit logs:', e);
    }

    // 3. Clear IndexedDB
    try {
      await dbStorage.setItem('mdc_upload_audit_logs', []);
      await dbStorage.setItem('mdc_deletion_audit_logs', []);
      await dbStorage.setItem('mdc_scan_logs', []);
    } catch (e) {
      console.warn('Could not clear dbStorage audit logs:', e);
    }

    // 4. Delete Records from Supabase Database
    if (supabase) {
      try {
        // Delete all rows from public.audit_logs
        await supabase.from('audit_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      } catch (err) {
        console.warn('Could not purge supabase audit_logs:', err);
      }

      try {
        // Delete all rows from public.scan_logs
        await supabase.from('scan_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      } catch (err) {
        console.warn('Could not purge supabase scan_logs:', err);
      }

      try {
        // Reset audit registries in saved_records with empty array snapshot
        await supabase.from('saved_records').upsert([
          {
            id: 'master_upload_audit_logs_registry',
            record_type: 'upload_audit_registry',
            period_label: 'Master Upload Audit Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master upload audit records (0 entries)',
            saved_by_name: currentUser?.fullName || 'Superadmin',
            snapshot_data: { logs: [], lastUpdated: new Date().toISOString() },
            updated_at: new Date().toISOString()
          },
          {
            id: 'master_deletion_audit_logs_registry',
            record_type: 'deletion_audit_registry',
            period_label: 'Master Deletion Audit Registry',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            notes: 'Master deletion audit records (0 entries)',
            saved_by_name: currentUser?.fullName || 'Superadmin',
            snapshot_data: { logs: [], lastUpdated: new Date().toISOString() },
            updated_at: new Date().toISOString()
          }
        ], { onConflict: 'id' });
      } catch (err) {
        console.warn('Could not reset saved_records audit registries:', err);
      }
    }

    // 5. Broadcast Realtime Synchronization Events
    if (broadcastCloudEvent) {
      broadcastCloudEvent('AUDIT_LOGS_PURGED', {
        purged_by_id: currentUser?.id || 'usr-superadmin',
        purged_by_name: currentUser?.fullName || 'Superadmin',
        timestamp: new Date().toISOString()
      });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'saved_records' });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'audit_logs' });
      broadcastCloudEvent('MASTER_DATA_UPDATED', { table: 'scan_logs' });
    }

    return true;
  };

  return {
    uploadAuditLogs,
    setUploadAuditLogs,
    deletionAuditLogs,
    setDeletionAuditLogs,
    logDeletionAudit,
    deleteAllAuditLogs
  };
}
