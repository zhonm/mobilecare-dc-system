import { useState } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { getDefaultRolePosition } from '../constants/roles';

export function useAuditLogs({
  currentUser,
  broadcastCloudEvent
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
        }]).catch(() => {});
      } catch (err) {}
    }

    if (broadcastCloudEvent) broadcastCloudEvent('AUDIT_DELETION_LOGGED', { log: newLog });
    return newLog;
  };

  return {
    uploadAuditLogs,
    setUploadAuditLogs,
    deletionAuditLogs,
    setDeletionAuditLogs,
    logDeletionAudit
  };
}
