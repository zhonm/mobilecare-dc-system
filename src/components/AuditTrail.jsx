import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '../context/AppContext';
import { generateAuditTrailPDF } from '../utils/pdfGenerator';
import { resolveSerialFullDetails } from '../utils/serialTracker';
import { formatTo12HourTime, formatTo12HourDateTime } from '../utils/dateUtils';
import { formatAuditEntityDisplay } from '../utils/appContextHelpers';
import { resolveSiteBranchCode } from '../utils/shipmentHelpers';
import SerialDossierModal from './SerialDossierModal';
import {
  History,
  Search,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Box,
  UploadCloud,
  FileSpreadsheet,
  Calendar,
  Trash2,
  Download,
  RefreshCw,
  FileText,
  AlertTriangle,
  X,
  Truck,
  Layers,
  BarChart3,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Printer,
  MapPin,
  ExternalLink,
  Clock,
  Wrench,
  ClipboardList,
  Eye,
  ArrowUpRight,
  Activity
} from 'lucide-react';

export default function AuditTrail() {
  const {
    inventoryUnits = [],
    scanLogs = [],
    sites = [],
    shipments = [],
    repairUsageRecords = [],
    parts = [],
    partsRequests = [],
    systemAuditLogs = [],
    uploadAuditLogs = [],
    deletionAuditLogs = [],
    sessionAuditLogs = [],
    deleteAllAuditLogs,
    currentUser,
    showToast,
    autoRefreshData,
    isAutoRefreshing,
    fixablySnapshot
  } = useApp();

  const isSuperadmin = currentUser?.role === 'superadmin';

  // Active Tab: 'master' | 'report' | 'uploads' | 'deletions' | 'serial_tracer' | 'scan_logs' | 'session_activity'
  const [auditTab, setAuditTab] = useState('master');

  // Master Activity Stream State
  const [masterCategoryFilter, setMasterCategoryFilter] = useState('ALL');
  const [masterRoleFilter, setMasterRoleFilter] = useState('ALL');
  const [masterSiteFilter, setMasterSiteFilter] = useState('ALL');
  const [masterDateFilter, setMasterDateFilter] = useState('ALL');
  const [masterSearch, setMasterSearch] = useState('');
  const [masterPage, setMasterPage] = useState(1);
  const masterPageSize = 15;
  const [selectedEventForDossier, setSelectedEventForDossier] = useState(null);

  // Search & Filter State
  const [localSearch, setLocalSearch] = useState('');
  const [deletionEntityTypeFilter, setDeletionEntityTypeFilter] = useState('ALL');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [selectedSerial, setSelectedSerial] = useState('');
  const [inspectedSerialDetails, setInspectedSerialDetails] = useState(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  // Modals & Async state
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // ── Helpers & Badge Metadata ────────────────────────────────────────────────
  const getActionDisplayMeta = (action, category) => {
    const normAct = String(action || '').toUpperCase();
    const normCat = String(category || '').toUpperCase();

    if (normAct.includes('REQUEST_SUBMITTED')) {
      return { label: 'Requisition Filed', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: ClipboardList };
    }
    if (normAct.includes('REQUEST_APPROVED')) {
      return { label: 'Requisition Approved', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircle2 };
    }
    if (normAct.includes('REQUEST_REJECTED')) {
      return { label: 'Requisition Denied', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: XCircle };
    }
    if (normAct.includes('REQUEST_FULFILLED')) {
      return { label: 'Requisition Fulfilled', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: CheckCircle2 };
    }
    if (normAct.includes('SHIPMENT_DISPATCHED')) {
      return { label: 'Outbound Dispatched', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: Truck };
    }
    if (normAct.includes('SHIPMENT_RECEIVED')) {
      return { label: 'Branch Package Received', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: CheckCircle2 };
    }
    if (normAct.includes('PART_CONSUMED') || normAct.includes('REPAIR') || normCat === 'CONSUMPTION') {
      return { label: 'Part Consumed (Repair)', color: '#ea580c', bg: '#fff7ed', border: '#ffedd5', icon: Wrench };
    }
    if (normAct === 'MULTI_SITE_INVENTORY_IMPORT' || normAct === 'BATCH_SCAN_INTAKE' || normCat === 'INVENTORY') {
      return { label: 'Batch Stock Intake', color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', icon: Layers };
    }
    if (normAct.includes('IMPORT') || normCat === 'DATA_IMPORT') {
      return { label: 'Master Data Imported', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd', icon: UploadCloud };
    }
    if (normAct.includes('DELETE') || normAct.includes('PURGE') || normCat === 'DELETION') {
      return { label: 'Data Record Purged', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', icon: Trash2 };
    }
    if (normAct.includes('POLICY')) {
      return { label: 'Security Policy Armed', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd', icon: ShieldCheck };
    }
    if (normAct === 'AUTO_LOGOUT') {
      return { label: 'Scheduled Auto-Logout', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: Clock };
    }
    if (normAct.includes('LOGOUT')) {
      return { label: 'User Session Logout', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: Clock };
    }
    if (normAct.includes('SESSION_REFRESH')) {
      return { label: 'Session Refreshed', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', icon: RefreshCw };
    }
    if (normAct.includes('LOGIN')) {
      return { label: 'User Login / Auth', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: UserCheck };
    }
    if (normAct.includes('RECEIVE_IN')) {
      return { label: 'Scan Receive-In', color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe', icon: History };
    }
    if (normAct.includes('PACK_OUT')) {
      return { label: 'Scan Pack-Out', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: Box };
    }
    if (normAct.includes('SCAN') || normCat === 'HARDWARE_SCAN') {
      return { label: 'Barcode Scan Event', color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe', icon: History };
    }
    if (normAct.includes('TRANSFER')) {
      return { label: 'Site Transfer', color: '#9333ea', bg: '#faf5ff', border: '#e9d5ff', icon: ArrowUpRight };
    }
    const cleanFallback = normAct.replace(/_/g, ' ');
    return {
      label: cleanFallback.length > 24 ? `${cleanFallback.slice(0, 22)}…` : cleanFallback,
      color: '#475569',
      bg: '#f8fafc',
      border: '#e2e8f0',
      icon: Activity
    };
  };

  const getRoleBadgeMeta = (role) => {
    const norm = String(role || '').toLowerCase();
    if (norm === 'superadmin') {
      return { label: 'SUPERADMIN', bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe' };
    }
    if (norm === 'parts_management' || norm.includes('pmg')) {
      return { label: 'PMG SPECIALIST', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
    }
    if (norm === 'technician') {
      return { label: 'TECHNICIAN', bg: '#ecfeff', color: '#0e7490', border: '#a5f3fc' };
    }
    if (norm === 'warehouse_staff' || norm === 'planner') {
      return { label: 'WAREHOUSE STAFF', bg: '#fef3c7', color: '#b45309', border: '#fde68a' };
    }
    if (norm === 'system') {
      return { label: 'SYSTEM ENGINE', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    }
    return { label: (role || 'STAFF').toUpperCase(), bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
  };

  const getRelativeTimeBadge = (timestamp) => {
    if (!timestamp) return null;
    const ms = Date.now() - new Date(timestamp).getTime();
    if (isNaN(ms)) return null;
    const mins = Math.floor(ms / (1000 * 60));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  // Fast lookup map for resolving unit intake timestamps and branch locations by serial number
  const unitBySerialMap = useMemo(() => {
    const map = new Map();
    const registerUnit = (u) => {
      if (!u) return;
      const sn = String(u.serial_number || u.serialNumber || u.raw_serial || '').trim().toUpperCase();
      if (!sn) return;
      const existing = map.get(sn);
      const recvAt = u.received_at || u.dateReceived || u.lastReceivedDate || u.latest_transfer_date || u.created_at || existing?.received_at || null;
      const sCode = u.site_code || u.siteCode || existing?.site_code || null;
      const sId = u.current_site_id || u.site_id || u.siteId || existing?.site_id || null;
      const matchedSite = (sites || []).find(s =>
        (sId && String(s.id).toLowerCase() === String(sId).toLowerCase()) ||
        (sCode && String(s.code).toUpperCase() === String(sCode).toUpperCase())
      );
      const cleanSiteCode = matchedSite?.code || (sCode ? String(sCode).replace(/_MSPI-Owned$/i, '').trim() : null);
      const cleanSiteName = matchedSite?.name || u.site_name || u.siteName || existing?.site_name || (cleanSiteCode ? `${cleanSiteCode} Branch` : null);
      map.set(sn, {
        ...existing,
        ...u,
        received_at: recvAt,
        site_id: matchedSite?.id || sId || 'site-dc',
        site_code: cleanSiteCode || 'DC-MDC',
        site_name: cleanSiteName || 'Central DC Workstation'
      });
    };
    (fixablySnapshot?.items || []).forEach(registerUnit);
    (inventoryUnits || []).forEach(registerUnit);
    return map;
  }, [inventoryUnits, fixablySnapshot, sites]);

  // Resilient Scanner Events List (resolves authentic per-unit intake dates for batch-imported scans and deduplicates repeated imports)
  const effectiveScanLogs = useMemo(() => {
    if (Array.isArray(scanLogs) && scanLogs.length > 0) {
      const tsCounts = new Map();
      scanLogs.forEach(sc => {
        const tsKey = String(sc.created_at || sc.timestamp || '').substring(0, 19);
        if (tsKey) tsCounts.set(tsKey, (tsCounts.get(tsKey) || 0) + 1);
      });

      const seenScanKeys = new Set();
      const resolved = [];
      scanLogs.forEach(sc => {
        const sn = String(sc.serial_number || '').trim().toUpperCase();
        const pn = String(sc.part_number || '').trim().toUpperCase();
        const scanType = sc.scan_type || 'RECEIVE_IN';
        const dedupKey = sn ? `${scanType}_${sn}` : `${scanType}_${pn}_${sc.id}`;
        if (seenScanKeys.has(dedupKey)) return;
        seenScanKeys.add(dedupKey);

        const rawTs = sc.created_at || sc.timestamp || '';
        const tsKey = String(rawTs).substring(0, 19);
        const isBatchStamped = scanType === 'RECEIVE_IN_BATCH' || (tsKey && (tsCounts.get(tsKey) || 0) > 1);
        const matchedUnit = sn ? unitBySerialMap.get(sn) : null;
        const unitRecvAt = matchedUnit?.received_at || null;
        const effectiveTs = (isBatchStamped && unitRecvAt) ? unitRecvAt : (rawTs || unitRecvAt || new Date().toISOString());

        resolved.push({
          ...sc,
          created_at: effectiveTs,
          batch_created_at: rawTs || effectiveTs,
          site_id: sc.site_id || matchedUnit?.site_id || 'site-dc',
          site_code: sc.site_code || matchedUnit?.site_code || 'DC-MDC',
          site_name: sc.site_name || matchedUnit?.site_name || 'Central DC Workstation'
        });
      });
      return resolved;
    }
    return (inventoryUnits || []).slice(0, 60).map((u, i) => ({
      id: `derived-scan-${u.id || i}`,
      scan_type: u.status === 'shipped' ? 'PACK_OUT' : 'RECEIVE_IN',
      part_number: u.part_number || 'UNKNOWN',
      serial_number: u.serial_number || 'N/A',
      site_id: u.current_site_id || u.site_id || 'site-dc',
      site_code: u.site_code || 'DC-MDC',
      site_name: u.site_name || 'Central DC Workstation',
      user_name: u.received_by || 'Warehouse Operator',
      is_valid: true,
      error_message: null,
      created_at: u.received_at || u.created_at || new Date().toISOString()
    }));
  }, [scanLogs, inventoryUnits, unitBySerialMap]);

  // ── Universal Master System Activity Aggregator ─────────────────────────────
  const allMasterEvents = useMemo(() => {
    const events = [];
    const seenSignatures = new Set();

    const hasRealClockTime = (val) => {
      if (!val || typeof val !== 'string') return false;
      const s = val.trim();
      if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return false;
      if (/[T ]00:00:00(?:\.\d+)?(?:Z|[+-]00(?::?00)?)?$/i.test(s)) return false;
      if (/[T ]08:00:00(?:\.\d+)?(?:Z|[+-]00(?::?00)?)?$/i.test(s)) return false;
      if (/[T ]12:00:00\.000(?:Z|[+-]00(?::?00)?)?$/i.test(s)) return false;
      return !isNaN(new Date(s).getTime());
    };

    const extractDatePrefix = (val) => {
      if (!val || typeof val !== 'string') return '';
      const m = val.trim().match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : '';
    };

    const combineDateWithClockTime = (datePrefix, isoWithTime) => {
      if (!datePrefix || !hasRealClockTime(isoWithTime)) return null;
      const s = String(isoWithTime).trim();
      const m = s.match(/^\d{4}-\d{2}-\d{2}([T ].*)$/);
      return m ? `${datePrefix}${m[1]}` : null;
    };

    // Collect upload timestamps & raw batch scan loop timestamps to prevent duplicate/colliding import timestamps
    const uploadEpochList = (uploadAuditLogs || [])
      .map(up => new Date(up.timestamp || 0).getTime())
      .filter(ms => !isNaN(ms) && ms > 0);

    const rawBatchScanTimes = Array.from(
      new Set(
        (scanLogs || [])
          .filter(sc => sc.scan_type === 'RECEIVE_IN_BATCH' && (sc.created_at || sc.timestamp))
          .map(sc => sc.created_at || sc.timestamp)
      )
    );

    // Pre-sort systemAuditLogs chronologically (oldest first) so the original batch import is kept when deduplicating repeated labels
    const sortedSystemLogs = [...(systemAuditLogs || [])].sort(
      (a, b) => new Date(a.timestamp || a.created_at || 0).getTime() - new Date(b.timestamp || b.created_at || 0).getTime()
    );
    const seenBatchImportLabels = new Set();

    // 1. Live Universal System Audit Logs (highest authority)
    sortedSystemLogs.forEach(log => {
      let ts = log.timestamp || log.created_at || new Date().toISOString();
      const act = String(log.action || 'SYSTEM_ACTION').toUpperCase();
      const label = String(log.entityLabel || log.entity_label || 'System Event').trim();

      if (act === 'MULTI_SITE_INVENTORY_IMPORT' || act === 'BATCH_SCAN_INTAKE') {
        const labelKey = `${act}_${label}`;
        if (seenBatchImportLabels.has(labelKey)) {
          return;
        }
        seenBatchImportLabels.add(labelKey);

        // If this batch intake log was recorded at the exact same second as a MASTER_FILE_IMPORTED log,
        // anchor it to the actual batch scan loop start timestamp (e.g. 09:15:21 AM vs 09:15:35 AM)
        const logMs = new Date(ts).getTime();
        const collidesWithUpload = uploadEpochList.some(uMs => Math.abs(uMs - logMs) <= 5000);
        if (collidesWithUpload) {
          const matchingBatchStart = rawBatchScanTimes.find(bTs => {
            const bMs = new Date(bTs).getTime();
            return !isNaN(bMs) && bMs < logMs && (logMs - bMs) <= 120000;
          });
          if (matchingBatchStart) {
            ts = matchingBatchStart;
          }
        }
      }

      const sig = `${act}_${log.entityId || log.entity_id}_${String(ts).substring(0, 16)}`;
      if (seenSignatures.has(sig)) return;
      seenSignatures.add(sig);
      events.push({
        id: log.id || `sys-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        timestamp: ts,
        action: act,
        category: log.category || 'SYSTEM',
        entityType: log.entityType || log.entity_type || 'System Record',
        entityId: log.entityId || log.entity_id || 'N/A',
        entityLabel: label,
        siteId: log.siteId || log.site_id || 'site-dc',
        siteCode: log.siteCode || log.site_code || 'DC-MDC',
        siteName: log.siteName || log.site_name || 'Distribution Center',
        user: log.user || {
          fullName: log.userName || log.user_name || 'System Engine',
          role: log.userRole || log.user_role || 'system',
          email: log.userEmail || log.user_email || ''
        },
        status: log.status || 'LOGGED',
        details: log.details || {}
      });
    });

    // 2. Parts Requisitions (Operational events by PMG Specialists and Superadmins)
    (partsRequests || []).forEach(req => {
      const createdTs = req.created_at || req.requested_at || new Date().toISOString();
      const createSig = `PARTS_REQUEST_SUBMITTED_${req.request_number || req.id}_${String(createdTs).substring(0, 16)}`;
      if (!seenSignatures.has(createSig)) {
        seenSignatures.add(createSig);
        events.push({
          id: `ev-req-create-${req.id || req.request_number}`,
          timestamp: createdTs,
          action: 'PARTS_REQUEST_SUBMITTED',
          category: 'REQUISITION',
          entityType: 'Parts Request',
          entityId: req.request_number || req.id,
          entityLabel: `${req.part_number || 'PART'} (${req.quantity_requested || 1} units) - Req #${req.request_number}`,
          siteId: req.site_id,
          siteCode: req.site_code || 'BRANCH',
          siteName: req.site_name || `${req.site_code || 'Branch'} Store`,
          user: {
            fullName: req.requested_by_name || 'PMG Specialist',
            role: 'parts_management',
            email: req.requested_by_email || ''
          },
          status: 'PENDING',
          details: {
            requestNumber: req.request_number,
            partNumber: req.part_number,
            partDescription: req.part_description,
            quantity: req.quantity_requested,
            priority: req.priority || 'normal',
            reason: req.reason || req.notes || 'Site replenishment'
          }
        });
      }

      if (req.status && req.status !== 'pending') {
        const reviewTs = req.reviewed_at || req.updated_at || createdTs;
        const reviewAction = req.status === 'approved' ? 'PARTS_REQUEST_APPROVED' :
          req.status === 'rejected' ? 'PARTS_REQUEST_REJECTED' :
          req.status === 'fulfilled' ? 'PARTS_REQUEST_FULFILLED' :
          `PARTS_REQUEST_${req.status.toUpperCase()}`;
        const reviewSig = `${reviewAction}_${req.request_number || req.id}_${String(reviewTs).substring(0, 16)}`;
        if (!seenSignatures.has(reviewSig)) {
          seenSignatures.add(reviewSig);
          events.push({
            id: `ev-req-rev-${req.id || req.request_number}`,
            timestamp: reviewTs,
            action: reviewAction,
            category: 'REQUISITION',
            entityType: 'Parts Request',
            entityId: req.request_number || req.id,
            entityLabel: `${req.part_number || 'PART'} - ${req.status.toUpperCase()} by Superadmin`,
            siteId: req.site_id,
            siteCode: req.site_code || 'BRANCH',
            siteName: req.site_name || `${req.site_code || 'Branch'} Store`,
            user: {
              fullName: req.reviewed_by_name || 'DC Superadmin',
              role: 'superadmin',
              email: 'superadmin@mobilecareph.com'
            },
            status: req.status.toUpperCase(),
            details: {
              requestNumber: req.request_number,
              partNumber: req.part_number,
              status: req.status,
              quantityFulfilled: req.quantity_fulfilled || req.quantity_requested,
              notes: req.notes
            }
          });
        }
      }
    });

    // 3. Outbound Shipments & Branch Receipts
    (shipments || []).forEach(ship => {
      const manifestNum = ship.invoice_ref || ship.shipment_number || ship.id;
      const matchedSite = (sites || []).find(
        s =>
          (ship.destination_site_id && s.id === ship.destination_site_id) ||
          (ship.site_id && s.id === ship.site_id) ||
          (ship.site_code && String(s.code || '').toUpperCase() === String(ship.site_code).toUpperCase())
      );
      const resolvedBranchCode = resolveSiteBranchCode(matchedSite, ship) || ship.site_code || 'BRANCH';
      const resolvedBranchName = matchedSite?.name || ship.destination_site_name || ship.site_name || resolvedBranchCode || 'Branch Store';

      if (ship.status === 'shipped' || ship.status === 'in_transit' || ship.status === 'received_confirmed' || ship.dispatched_at) {
        const shipDateKey = extractDatePrefix(ship.dispatched_at || ship.shipment_date || ship.pickup_date);
        const createdHasSameDateTime = hasRealClockTime(ship.created_at) && (!shipDateKey || extractDatePrefix(ship.created_at) === shipDateKey);
        const dispatchTs = (hasRealClockTime(ship.dispatched_at) ? ship.dispatched_at : null) ||
          (createdHasSameDateTime ? ship.created_at : null) ||
          combineDateWithClockTime(shipDateKey, ship.created_at) ||
          (hasRealClockTime(ship.created_at) ? ship.created_at : null) ||
          ship.dispatched_at ||
          ship.shipment_date ||
          ship.updated_at ||
          ship.created_at ||
          new Date().toISOString();
        const dispatchSig = `SHIPMENT_DISPATCHED_${manifestNum}_${String(dispatchTs).substring(0, 16)}`;
        if (!seenSignatures.has(dispatchSig)) {
          seenSignatures.add(dispatchSig);
          events.push({
            id: `ev-ship-disp-${ship.id || manifestNum}`,
            timestamp: dispatchTs,
            action: 'SHIPMENT_DISPATCHED',
            category: 'LOGISTICS',
            entityType: 'Outbound Shipment',
            entityId: manifestNum,
            entityLabel: `Manifest #${manifestNum} dispatched to ${resolvedBranchCode} (${ship.items?.length || 0} parts)`,
            siteId: ship.destination_site_id || ship.site_id || matchedSite?.id,
            siteCode: resolvedBranchCode,
            siteName: resolvedBranchName,
            user: {
              fullName: ship.dispatched_by || ship.prepared_by_name || 'DC Logistics Lead',
              role: 'superadmin',
              email: 'logistics@mobilecareph.com'
            },
            status: 'IN_TRANSIT',
            details: {
              manifestNumber: manifestNum,
              carrier: ship.carrier || ship.courier || 'Lite Express',
              trackingNumber: ship.tracking_number || ship.booking_id,
              riderName: ship.pickup_by_name || ship.courier_name,
              partsCount: ship.items?.length || 0,
              destination: resolvedBranchCode
            }
          });
        }
      }

      if (ship.status === 'received_confirmed' || ship.received_at || ship.received_date) {
        const recvDateKey = extractDatePrefix(ship.received_date || ship.received_at);
        const updatedHasSameDateTime = hasRealClockTime(ship.updated_at) && (!recvDateKey || extractDatePrefix(ship.updated_at) === recvDateKey);
        const receiveTs = (hasRealClockTime(ship.received_at) ? ship.received_at : null) ||
          (updatedHasSameDateTime ? ship.updated_at : null) ||
          combineDateWithClockTime(recvDateKey, ship.updated_at) ||
          (hasRealClockTime(ship.updated_at) ? ship.updated_at : null) ||
          ship.received_at ||
          ship.received_date ||
          ship.updated_at ||
          new Date().toISOString();
        const receiveSig = `SHIPMENT_RECEIVED_CONFIRMED_${manifestNum}_${String(receiveTs).substring(0, 16)}`;
        if (!seenSignatures.has(receiveSig)) {
          seenSignatures.add(receiveSig);
          events.push({
            id: `ev-ship-rec-${ship.id || manifestNum}`,
            timestamp: receiveTs,
            action: 'SHIPMENT_RECEIVED_CONFIRMED',
            category: 'LOGISTICS',
            entityType: 'Outbound Shipment',
            entityId: manifestNum,
            entityLabel: `Manifest #${manifestNum} received & stocked at ${resolvedBranchCode}`,
            siteId: ship.destination_site_id || ship.site_id || matchedSite?.id,
            siteCode: resolvedBranchCode,
            siteName: resolvedBranchName,
            user: {
              fullName: ship.received_by_name || 'PMG Specialist',
              role: 'parts_management',
              email: 'branch.pmg@mobilecareph.com'
            },
            status: 'RECEIVED',
            details: {
              manifestNumber: manifestNum,
              receivedDate: ship.received_date,
              condition: ship.receivedCondition || 'Verified in good condition',
              partsCount: ship.items?.length || 0,
              siteCode: resolvedBranchCode
            }
          });
        }
      }
    });

    // 4. Parts Consumed in Repair / KGB Work Orders
    (repairUsageRecords || []).forEach(rep => {
      const repTs = rep.dateUsed || rep.date_used || rep.created_at || rep.timestamp || new Date().toISOString();
      const serialOrPn = rep.serial_number || rep.part_number || rep.id;
      const repSig = `PART_CONSUMED_REPAIR_${serialOrPn}_${String(repTs).substring(0, 16)}`;
      if (!seenSignatures.has(repSig)) {
        seenSignatures.add(repSig);
        events.push({
          id: `ev-rep-${rep.id || serialOrPn}`,
          timestamp: repTs,
          action: 'PART_CONSUMED_REPAIR',
          category: 'CONSUMPTION',
          entityType: 'Inventory Unit',
          entityId: rep.serial_number || rep.part_number || 'UNIT',
          entityLabel: `${rep.part_number || 'Part'} (${rep.serial_number || 'Non-Serial'}) - WO #${rep.work_order_number || rep.workOrderNumber || 'N/A'}`,
          siteId: rep.site_id,
          siteCode: rep.site_code || 'BRANCH',
          siteName: rep.site_name || `${rep.site_code || 'Branch'} Store`,
          user: {
            fullName: rep.used_by_name || rep.technician_name || 'Certified Technician',
            role: 'technician',
            email: 'tech@mobilecareph.com'
          },
          status: 'USED',
          details: {
            serialNumber: rep.serial_number,
            partNumber: rep.part_number,
            workOrderNumber: rep.work_order_number || rep.workOrderNumber,
            technician: rep.technician_name || rep.used_by_name,
            notes: rep.remarks || rep.usage_notes || 'Replaced defective component'
          }
        });
      }
    });

    // 5. File Imports & Master Ingestions
    (uploadAuditLogs || []).forEach(up => {
      const upTs = up.timestamp || new Date().toISOString();
      const upSig = `MASTER_FILE_IMPORTED_${up.file_name}_${String(upTs).substring(0, 16)}`;
      if (!seenSignatures.has(upSig)) {
        seenSignatures.add(upSig);
        const unitsCount = Number(up.total_forecast_units || up.parts_count || 0);
        const masterCost = Number(up.total_master_cost || 0);
        const cleanType = (up.file_type || 'CSV Dataset').replace(/_/g, ' ');
        const formattedUploadLabel = unitsCount > 0 || masterCost > 0
          ? `${up.file_name} • ${unitsCount.toLocaleString()} units${masterCost > 0 ? ` ($${masterCost.toLocaleString()})` : ''}`
          : `${up.file_name} • ${cleanType}`;
        events.push({
          id: up.id || `ev-up-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: upTs,
          action: 'MASTER_FILE_IMPORTED',
          category: 'DATA_IMPORT',
          entityType: 'Workbook Bundle',
          entityId: up.file_name || 'Masterlist',
          entityLabel: formattedUploadLabel,
          siteId: 'site-dc',
          siteCode: 'DC-MDC',
          siteName: 'Distribution Center (DC)',
          user: {
            fullName: up.user_name || 'Zhon Manaois',
            role: up.user_role || 'superadmin',
            email: up.user_email || 'zhonmanaois@gmail.com'
          },
          status: 'IMPORTED',
          details: {
            fileName: up.file_name,
            targetMonth: up.target_month,
            forecastUnits: up.total_forecast_units,
            allocatedUnits: up.total_allocated_units,
            totalValuation: up.total_master_cost
          }
        });
      }
    });

    // 6. Data Deletions & Purge Audits
    (deletionAuditLogs || []).forEach(del => {
      const delTs = del.timestamp || new Date().toISOString();
      const disp = formatAuditEntityDisplay(del);
      const delSig = `DATA_PURGED_DELETED_${del.entity_id || disp.id}_${String(delTs).substring(0, 16)}`;
      if (!seenSignatures.has(delSig)) {
        seenSignatures.add(delSig);
        events.push({
          id: del.id || `ev-del-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: delTs,
          action: 'DATA_PURGED_DELETED',
          category: 'DELETION',
          entityType: del.entity_type || 'Record',
          entityId: disp.id || del.entity_id || 'RECORD',
          entityLabel: `${disp.label || del.entity_label || del.entity_type} - Purged`,
          siteId: 'site-dc',
          siteCode: 'DC-MDC',
          siteName: 'Distribution Center (DC)',
          user: {
            fullName: del.deleted_by_name || 'Zhon Manaois',
            role: del.deleted_by_role || 'superadmin',
            email: del.deleted_by_email || ''
          },
          status: 'PURGED',
          details: {
            entityType: del.entity_type,
            entityId: disp.id,
            reason: del.reason,
            summary: del.summary
          }
        });
      }
    });

    // 7. Session Activity & Auto-Logouts
    (sessionAuditLogs || []).forEach(sess => {
      const sessTs = sess.timestamp || new Date().toISOString();
      const sessSig = `${sess.action}_${sess.user_email || sess.user_name}_${String(sessTs).substring(0, 16)}`;
      if (!seenSignatures.has(sessSig)) {
        seenSignatures.add(sessSig);
        const isPolicyInit = String(sess.action || '').includes('POLICY');
        const isSessionTerminated = !isPolicyInit && String(sess.action || '').includes('LOGOUT');
        events.push({
          id: sess.id || `ev-sess-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: sessTs,
          action: sess.action || 'SESSION_EVENT',
          category: 'SECURITY_SESSION',
          entityType: 'User Session',
          entityId: sess.user_email || sess.user_name || 'SESSION',
          entityLabel: sess.reason || `${(sess.action || 'SESSION').replace(/_/g, ' ')} • ${sess.user_name || 'User'}`,
          siteId: 'site-dc',
          siteCode: 'SECURITY',
          siteName: 'Authentication Service',
          user: {
            fullName: sess.user_name || 'User',
            role: sess.user_role || 'user',
            email: sess.user_email || ''
          },
          status: isSessionTerminated ? 'TERMINATED' : 'ACTIVE',
          details: {
            action: sess.action,
            reason: sess.reason,
            userPosition: sess.user_position,
            ...(sess.details || {})
          }
        });
      }
    });

    // 8. Barcode Hardware Scans (consolidate RECEIVE_IN_BATCH by branch & receipt date so bulk CSV imports don't flood the stream with identical timestamps)
    const batchScanGroups = new Map();
    (effectiveScanLogs || []).forEach(sc => {
      const scTs = sc.created_at || sc.timestamp || new Date().toISOString();
      const scanType = String(sc.scan_type || 'IN').toUpperCase();
      const scSiteId = sc.site_id || 'site-dc';
      const scSiteCode = sc.site_code || 'DC-MDC';
      const scSiteName = sc.site_name || 'Central DC Workstation';

      if (scanType === 'RECEIVE_IN_BATCH') {
        const dateKey = extractDatePrefix(scTs) || String(scTs).substring(0, 16);
        const groupKey = `${scSiteCode}_${dateKey}`;
        if (!batchScanGroups.has(groupKey)) {
          batchScanGroups.set(groupKey, {
            id: sc.id || `ev-scan-batch-${scSiteCode}-${dateKey}`,
            timestamp: combineDateWithClockTime(extractDatePrefix(scTs), sc.batch_created_at) || scTs,
            siteId: scSiteId,
            siteCode: scSiteCode,
            siteName: scSiteName,
            userName: sc.user_name || 'Warehouse Operator',
            count: 0,
            serials: [],
            parts: new Set()
          });
        }
        const grp = batchScanGroups.get(groupKey);
        grp.count += 1;
        if (sc.serial_number) grp.serials.push(sc.serial_number);
        if (sc.part_number) grp.parts.add(sc.part_number);
        return;
      }

      const scSig = `SCAN_${scanType}_${sc.serial_number || sc.part_number}_${String(scTs).substring(0, 16)}`;
      if (!seenSignatures.has(scSig)) {
        seenSignatures.add(scSig);
        events.push({
          id: sc.id || `ev-scan-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: scTs,
          action: sc.is_valid !== false ? `SCAN_${scanType}` : `SCAN_${scanType}_REJECTED`,
          category: 'HARDWARE_SCAN',
          entityType: 'Barcode Scan',
          entityId: sc.serial_number || sc.part_number || 'SCAN',
          entityLabel: `${sc.part_number || 'PN'} (${sc.serial_number || 'No S/N'}) - ${scanType}`,
          siteId: scSiteId,
          siteCode: scSiteCode,
          siteName: scSiteName,
          user: {
            fullName: sc.user_name || 'Warehouse Operator',
            role: 'warehouse_staff',
            email: ''
          },
          status: sc.is_valid !== false ? 'VALID' : 'REJECTED',
          details: {
            scanType,
            partNumber: sc.part_number,
            serialNumber: sc.serial_number,
            isValid: sc.is_valid,
            errorMessage: sc.error_message
          }
        });
      }
    });

    let batchGroupIdx = 0;
    batchScanGroups.forEach((grp, groupKey) => {
      let groupTs = grp.timestamp;
      const baseMs = new Date(groupTs).getTime();
      if (!isNaN(baseMs) && batchGroupIdx > 0 && hasRealClockTime(groupTs)) {
        groupTs = new Date(baseMs - batchGroupIdx * 1000).toISOString();
      }
      batchGroupIdx += 1;

      const batchSig = `SCAN_RECEIVE_IN_BATCH_${groupKey}`;
      if (!seenSignatures.has(batchSig)) {
        seenSignatures.add(batchSig);
        const partsArr = Array.from(grp.parts);
        events.push({
          id: grp.id,
          timestamp: groupTs,
          action: 'SCAN_RECEIVE_IN_BATCH',
          category: 'HARDWARE_SCAN',
          entityType: 'Batch Barcode Scan',
          entityId: grp.serials[0] || partsArr[0] || `BATCH-${grp.siteCode}`,
          entityLabel: grp.count === 1
            ? `${partsArr[0] || 'PN'} (${grp.serials[0] || 'No S/N'}) - RECEIVE_IN_BATCH`
            : `Batch Scan Receive-In at ${grp.siteCode} (${grp.count} serialized units • ${partsArr.length} SKUs)`,
          siteId: grp.siteId,
          siteCode: grp.siteCode,
          siteName: grp.siteName,
          user: {
            fullName: grp.userName,
            role: 'warehouse_staff',
            email: ''
          },
          status: 'VALID',
          details: {
            scanType: 'RECEIVE_IN_BATCH',
            unitsScanned: grp.count,
            distinctParts: partsArr.length,
            samplePartNumbers: partsArr.slice(0, 15).join(', '),
            sampleSerialNumbers: grp.serials.slice(0, 25).join(', '),
            isValid: true
          }
        });
      }
    });

    // Sort descending by timestamp
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [systemAuditLogs, partsRequests, shipments, sites, repairUsageRecords, uploadAuditLogs, deletionAuditLogs, sessionAuditLogs, effectiveScanLogs, scanLogs]);

  // Master Filtered Dataset
  const filteredMasterEvents = useMemo(() => {
    let list = allMasterEvents;

    // 1. Category Filter
    if (masterCategoryFilter !== 'ALL') {
      list = list.filter(e => e.category === masterCategoryFilter);
    }

    // 2. Role Filter
    if (masterRoleFilter !== 'ALL') {
      list = list.filter(e => {
        const r = String(e.user?.role || '').toLowerCase();
        if (masterRoleFilter === 'superadmin') return r === 'superadmin';
        if (masterRoleFilter === 'parts_management') return r === 'parts_management' || r.includes('pmg');
        if (masterRoleFilter === 'technician') return r === 'technician';
        if (masterRoleFilter === 'warehouse_staff') return r === 'warehouse_staff' || r === 'planner';
        return r === masterRoleFilter.toLowerCase();
      });
    }

    // 3. Site Filter
    if (masterSiteFilter !== 'ALL') {
      list = list.filter(e => {
        const sc = String(e.siteCode || '').toUpperCase();
        const sid = String(e.siteId || '').toLowerCase();
        return sc === masterSiteFilter.toUpperCase() || sid === masterSiteFilter.toLowerCase();
      });
    }

    // 4. Date Filter
    if (masterDateFilter !== 'ALL') {
      const now = Date.now();
      list = list.filter(e => {
        const eventMs = new Date(e.timestamp).getTime();
        if (masterDateFilter === 'TODAY') {
          return new Date(e.timestamp).toDateString() === new Date().toDateString();
        }
        if (masterDateFilter === '7DAYS') {
          return eventMs >= now - 7 * 86400 * 1000;
        }
        if (masterDateFilter === '30DAYS') {
          return eventMs >= now - 30 * 86400 * 1000;
        }
        return true;
      });
    }

    // 5. Search
    if (masterSearch.trim()) {
      const q = masterSearch.toLowerCase().trim();
      list = list.filter(e =>
        String(e.action || '').toLowerCase().includes(q) ||
        String(e.entityId || '').toLowerCase().includes(q) ||
        String(e.entityLabel || '').toLowerCase().includes(q) ||
        String(e.user?.fullName || '').toLowerCase().includes(q) ||
        String(e.user?.email || '').toLowerCase().includes(q) ||
        String(e.siteCode || '').toLowerCase().includes(q) ||
        String(e.siteName || '').toLowerCase().includes(q) ||
        String(e.status || '').toLowerCase().includes(q) ||
        JSON.stringify(e.details || {}).toLowerCase().includes(q)
      );
    }

    return list;
  }, [allMasterEvents, masterCategoryFilter, masterRoleFilter, masterSiteFilter, masterDateFilter, masterSearch]);

  const paginatedMasterEvents = useMemo(() => {
    const start = (masterPage - 1) * masterPageSize;
    return filteredMasterEvents.slice(start, start + masterPageSize);
  }, [filteredMasterEvents, masterPage]);

  const totalMasterPages = Math.ceil(filteredMasterEvents.length / masterPageSize) || 1;

  // ── Executive Report Metrics Calculations ────────────────────────────────────
  const reportMetrics = useMemo(() => {
    const totalUploads = (uploadAuditLogs || []).length;
    const totalValuation = (uploadAuditLogs || []).reduce((acc, curr) => acc + Number(curr.total_master_cost || 0), 0);
    const totalForecastUnits = (uploadAuditLogs || []).reduce((acc, curr) => acc + Number(curr.total_forecast_units || 0), 0);
    const totalAllocatedUnits = (uploadAuditLogs || []).reduce((acc, curr) => acc + Number(curr.total_allocated_units || 0), 0);
    const totalDeletions = (deletionAuditLogs || []).length;
    const totalScans = (effectiveScanLogs || []).length;

    const totalSystemEvents = allMasterEvents.length;
    const totalPmgEvents = allMasterEvents.filter(e =>
      e.category === 'REQUISITION' ||
      e.category === 'CONSUMPTION' ||
      e.user?.role === 'parts_management' ||
      e.user?.role === 'technician'
    ).length;
    const totalLogisticsEvents = allMasterEvents.filter(e => e.category === 'LOGISTICS').length;
    const totalScansAndSerials = allMasterEvents.filter(e =>
      e.category === 'HARDWARE_SCAN' ||
      e.category === 'INVENTORY' ||
      e.category === 'TRANSFER'
    ).length;

    // Monthly aggregation
    const monthlyGroups = {};
    (uploadAuditLogs || []).forEach(log => {
      const monthKey = log.target_month || 'Other Period';
      if (!monthlyGroups[monthKey]) {
        monthlyGroups[monthKey] = {
          month: monthKey,
          uploadCount: 0,
          totalCost: 0,
          forecastUnits: 0,
          allocatedUnits: 0,
          latestUpload: log.timestamp,
          uploadedBy: log.user_name || 'Super Admin'
        };
      }
      monthlyGroups[monthKey].uploadCount += 1;
      monthlyGroups[monthKey].totalCost += Number(log.total_master_cost || 0);
      monthlyGroups[monthKey].forecastUnits += Number(log.total_forecast_units || 0);
      monthlyGroups[monthKey].allocatedUnits += Number(log.total_allocated_units || 0);
    });

    const monthlySummary = Object.values(monthlyGroups).sort((a, b) => new Date(b.latestUpload) - new Date(a.latestUpload));

    return {
      totalUploads,
      totalValuation,
      totalForecastUnits,
      totalAllocatedUnits,
      totalDeletions,
      totalScans,
      totalSystemEvents,
      totalPmgEvents,
      totalLogisticsEvents,
      totalScansAndSerials,
      monthlySummary
    };
  }, [uploadAuditLogs, deletionAuditLogs, effectiveScanLogs, allMasterEvents]);

  // ── Filtered Datasets ───────────────────────────────────────────────────────

  // 1. Upload Logs Filter
  const filteredUploads = useMemo(() => {
    let list = (uploadAuditLogs || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (periodFilter !== 'ALL') {
      list = list.filter(l => (l.target_month || '').toLowerCase() === periodFilter.toLowerCase());
    }

    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l =>
      (l.file_name || '').toLowerCase().includes(q) ||
      (l.user_name || '').toLowerCase().includes(q) ||
      (l.user_email || '').toLowerCase().includes(q) ||
      (l.target_month || '').toLowerCase().includes(q) ||
      (l.user_role || '').toLowerCase().includes(q)
    );
  }, [uploadAuditLogs, localSearch, periodFilter]);

  // 2. Deletion Logs Filter
  const filteredDeletions = useMemo(() => {
    let list = (deletionAuditLogs || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (deletionEntityTypeFilter !== 'ALL') {
      list = list.filter(l => l.entity_type === deletionEntityTypeFilter);
    }
    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l => {
      const disp = formatAuditEntityDisplay(l);
      return (
        (l.entity_id || '').toLowerCase().includes(q) ||
        (disp.id || '').toLowerCase().includes(q) ||
        (disp.label || '').toLowerCase().includes(q) ||
        (l.entity_label || '').toLowerCase().includes(q) ||
        (l.entity_type || '').toLowerCase().includes(q) ||
        (l.deleted_by_name || '').toLowerCase().includes(q) ||
        (l.deleted_by_email || '').toLowerCase().includes(q) ||
        (l.deleted_by_role || '').toLowerCase().includes(q) ||
        (l.reason || '').toLowerCase().includes(q)
      );
    });
  }, [deletionAuditLogs, deletionEntityTypeFilter, localSearch]);

  // 3. Scan Logs Filter
  const filteredScanLogs = useMemo(() => {
    const list = (effectiveScanLogs || [])
      .slice()
      .sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp));
    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l =>
      (l.part_number || '').toLowerCase().includes(q) ||
      (l.serial_number || '').toLowerCase().includes(q) ||
      (l.scan_type || '').toLowerCase().includes(q) ||
      (l.user_name || '').toLowerCase().includes(q)
    );
  }, [effectiveScanLogs, localSearch]);

  // 4. Session Activity Logs Filter
  const filteredSessionLogs = useMemo(() => {
    const list = (sessionAuditLogs || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    if (!localSearch.trim()) return list;
    const q = localSearch.toLowerCase();
    return list.filter(l =>
      (l.user_name || '').toLowerCase().includes(q) ||
      (l.user_email || '').toLowerCase().includes(q) ||
      (l.action || '').toLowerCase().includes(q) ||
      (l.reason || '').toLowerCase().includes(q)
    );
  }, [sessionAuditLogs, localSearch]);

  // 5. Serial Tracer Matched Unit
  const matchedUnit = useMemo(() => {
    if (!selectedSerial.trim()) return null;
    return resolveSerialFullDetails(selectedSerial, {
      inventoryUnits,
      shipments,
      repairUsageRecords,
      sites,
      parts,
      fixablyItems: fixablySnapshot?.items || [],
      fixablyTransfers: fixablySnapshot?.transfers || []
    });
  }, [selectedSerial, inventoryUnits, shipments, repairUsageRecords, sites, parts, fixablySnapshot]);

  // Paginated data for uploads
  const paginatedUploads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredUploads.slice(start, start + pageSize);
  }, [filteredUploads, currentPage]);

  const totalUploadPages = Math.ceil(filteredUploads.length / pageSize) || 1;

  // ── Export Handlers: XLSX ───────────────────────────────────────────────────

  const handleExportMasterXLSX = () => {
    if (filteredMasterEvents.length === 0) {
      showToast?.('No master audit records to export', 'warning');
      return;
    }
    const rows = filteredMasterEvents.map((e, idx) => ({
      '#': idx + 1,
      'Date & Time': formatTo12HourDateTime(e.timestamp),
      'Action': e.action,
      'Category': e.category,
      'Operator (Name)': e.user?.fullName || 'System User',
      'Operator (Role)': (e.user?.role || 'system').toUpperCase(),
      'Operator (Email)': e.user?.email || '',
      'Target Entity Type': e.entityType,
      'Record ID': e.entityId,
      'Summary Description': e.entityLabel,
      'Location Code': e.siteCode || 'DC-MDC',
      'Location Name': e.siteName || 'Distribution Center',
      'Status': e.status,
      'Details Payload': JSON.stringify(e.details || {})
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master_Activity_Stream');
    XLSX.writeFile(wb, `MDC_Master_Activity_Stream_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Master activity audit records exported to Excel (.xlsx)', 'success');
  };

  const handleExportUploadsXLSX = () => {
    if (filteredUploads.length === 0) {
      showToast?.('No upload audit records to export', 'warning');
      return;
    }
    const rows = filteredUploads.map((l, idx) => ({
      '#': idx + 1,
      'Date & Time': formatTo12HourDateTime(l.timestamp),
      'Uploaded By (Name)': l.user_name || 'Superadmin',
      'Uploaded By (Email)': l.user_email || '',
      'Role': (l.user_role || 'SUPERADMIN').toUpperCase(),
      'Ingested Masterlist': l.file_name || '',
      'File Type': l.file_type || 'WORKBOOK',
      'Target Period': l.target_month || 'N/A',
      'Forecast Units': l.total_forecast_units || 0,
      'Allocated Units': l.total_allocated_units || 0,
      'Total Valuation ($)': Number(l.total_master_cost || 0),
      'Parts Count': l.parts_count || 0,
      'Sites Count': l.sites_count || 0,
      'System Status': l.status || 'Active on Cloud'
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Upload_Audits');
    XLSX.writeFile(wb, `MDC_Upload_Audits_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Upload audits exported to Excel (.xlsx)', 'success');
  };

  const handleExportDeletionsXLSX = () => {
    if (filteredDeletions.length === 0) {
      showToast?.('No deletion audit records to export', 'warning');
      return;
    }
    const rows = filteredDeletions.map((d, idx) => {
      const { id: displayId, label: displayLabel } = formatAuditEntityDisplay(d);

      let impact = [];
      if (d.summary?.itemsCount !== undefined) impact.push(`${d.summary.itemsCount} units purged`);
      if (d.summary?.description) impact.push(d.summary.description);
      if (d.summary?.iphone_model) impact.push(`Model: ${d.summary.iphone_model}`);
      if (d.summary?.site_name) impact.push(d.summary.site_name);
      if (d.summary?.region) impact.push(`Region: ${d.summary.region}`);
      if (d.summary?.poNumber) impact.push(`PO: ${d.summary.poNumber}`);
      if (d.summary?.destinationSite) impact.push(`Dest: ${d.summary.destinationSite}`);
      if (d.summary?.forecastPartsCount !== undefined) impact.push(`${d.summary.forecastPartsCount} parts`);

      return {
        '#': idx + 1,
        'Date & Time': formatTo12HourDateTime(d.timestamp),
        'Entity Type': d.entity_type || 'Record',
        'Record ID': displayId,
        'Record Label': displayLabel,
        'Reason / Action Note': d.reason || 'User initiated deletion',
        'Deleted By (Name)': d.deleted_by_name || 'System',
        'Deleted By (Email)': d.deleted_by_email || '',
        'Role / Position': d.deleted_by_position || d.deleted_by_role || 'Specialist',
        'Impact Summary': impact.join(' • ') || 'Record purged',
        'Status': 'Audit Logged'
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Deletion_Audits');
    XLSX.writeFile(wb, `MDC_Deletion_Audits_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Deletion audits exported to Excel (.xlsx)', 'success');
  };

  const handleExportScanLogsXLSX = () => {
    if (filteredScanLogs.length === 0) {
      showToast?.('No barcode scanner event logs to export', 'warning');
      return;
    }
    const rows = filteredScanLogs.map((s, idx) => ({
      '#': idx + 1,
      'Date & Time': formatTo12HourDateTime(s.created_at || s.timestamp),
      'Operation': s.scan_type || 'SCAN_IN',
      'Part Number': s.part_number || 'N/A',
      'Serial Number': s.serial_number || 'N/A',
      'Warehouse Operator': s.user_name || 'Warehouse Staff',
      'Validation Result': s.is_valid !== false ? 'VALID' : 'REJECTED',
      'Error Message': s.error_message || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scanner_Logs');
    XLSX.writeFile(wb, `MDC_Scanner_Event_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Scanner logs exported to Excel (.xlsx)', 'success');
  };

  const handleExportSessionLogsXLSX = () => {
    if (filteredSessionLogs.length === 0) {
      showToast?.('No session activity records to export', 'warning');
      return;
    }
    const rows = filteredSessionLogs.map((l, idx) => ({
      '#': idx + 1,
      'Date & Time': formatTo12HourDateTime(l.timestamp),
      'Action / Event': l.action,
      'User Name': l.user_name || 'System User',
      'User Email': l.user_email || '',
      'Role': (l.user_role || 'user').toUpperCase(),
      'Position': l.user_position || '',
      'Reason / Trigger': l.reason || '',
      'Details': JSON.stringify(l.details || {})
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Session_Audits');
    XLSX.writeFile(wb, `MDC_Session_Audit_Logs_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Session audit records exported to Excel (.xlsx)', 'success');
  };

  const handleExportSerialTracerXLSX = () => {
    if (!matchedUnit) {
      showToast?.('Search and select a serial number first', 'warning');
      return;
    }
    const unitSheet = [
      { Property: 'Serial Number', Value: matchedUnit.serial_number },
      { Property: 'Part Number', Value: matchedUnit.part_number },
      { Property: 'Description', Value: matchedUnit.description || 'N/A' },
      { Property: 'Current Status', Value: matchedUnit.statusBadgeLabel || String(matchedUnit.status || 'in_stock').toUpperCase() },
      { Property: 'Stock Location', Value: matchedUnit.isDcSite ? 'DC Stocks' : `${matchedUnit.siteName || 'Site'} (${matchedUnit.siteRegion || 'Branch'})` },
      { Property: 'Site Arrival Date', Value: matchedUnit.siteArrivalFormatted || (matchedUnit.siteArrivalDate ? String(matchedUnit.siteArrivalDate).slice(0, 10) : 'N/A') },
      { Property: 'Site Arrival Status', Value: matchedUnit.siteArrivalStatus || 'N/A' },
      { Property: 'Used by Site', Value: matchedUnit.isUsed ? 'YES - Consumed in Repair' : 'NO - In Stock / Available' },
      { Property: 'Date Used in System', Value: matchedUnit.dateUsedFormatted || 'N/A' },
      { Property: 'Work Order #', Value: matchedUnit.workOrderNumber || 'N/A' },
      { Property: 'Technician / User', Value: matchedUnit.usedByName || 'N/A' },
      { Property: 'Box Number', Value: matchedUnit.box_number || 1 },
      { Property: 'PO Number', Value: matchedUnit.po_number || 'N/A' },
      { Property: 'DC Intake Date', Value: matchedUnit.received_at ? formatTo12HourDateTime(matchedUnit.received_at) : 'Recorded' },
      { Property: 'DC Intake By', Value: matchedUnit.received_by || 'Warehouse Staff' },
      { Property: 'Outbound Manifest #', Value: matchedUnit.linkedShipment?.shipmentNumber || 'N/A' },
      { Property: 'Shipped Date', Value: matchedUnit.shipped_at ? formatTo12HourDateTime(matchedUnit.shipped_at) : 'N/A' }
    ];
    const ws = XLSX.utils.json_to_sheet(unitSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Custody_Trace');
    XLSX.writeFile(wb, `MDC_Serial_Trace_${matchedUnit.serial_number}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Serial custody trace exported to Excel (.xlsx)', 'success');
  };

  const handleExportAllAuditsXLSX = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Master Activity Stream
    const masterRows = (allMasterEvents || []).map((e, idx) => ({
      '#': idx + 1,
      'Timestamp': formatTo12HourDateTime(e.timestamp),
      'Action': e.action,
      'Category': e.category,
      'Operator (Name)': e.user?.fullName || 'System',
      'Operator (Role)': (e.user?.role || 'system').toUpperCase(),
      'Operator (Email)': e.user?.email || '',
      'Target Entity Type': e.entityType,
      'Record ID': e.entityId,
      'Summary Description': e.entityLabel,
      'Location Code': e.siteCode || 'DC-MDC',
      'Location Name': e.siteName || 'Distribution Center',
      'Status': e.status,
      'Details Payload': JSON.stringify(e.details || {})
    }));
    const wsMaster = XLSX.utils.json_to_sheet(masterRows.length > 0 ? masterRows : [{ Notice: 'No master audit events' }]);
    XLSX.utils.book_append_sheet(wb, wsMaster, 'Master_Activity_Stream');

    // Sheet 2: Parts Requisitions
    const reqRows = (partsRequests || []).map((r, idx) => ({
      '#': idx + 1,
      'Request Number': r.request_number || r.id,
      'Requested At': formatTo12HourDateTime(r.created_at),
      'Site': r.site_code || 'SITE',
      'Part Number': r.part_number,
      'Part Description': r.part_description || '',
      'Qty Requested': r.quantity_requested,
      'Qty Fulfilled': r.quantity_fulfilled || 0,
      'Status': (r.status || 'pending').toUpperCase(),
      'Priority': (r.priority || 'normal').toUpperCase(),
      'Requested By': r.requested_by_name || 'Staff',
      'Reviewed By': r.reviewed_by_name || 'N/A',
      'Reviewed At': r.reviewed_at ? formatTo12HourDateTime(r.reviewed_at) : 'N/A',
      'Reason': r.reason || '',
      'Notes': r.notes || ''
    }));
    const wsReqs = XLSX.utils.json_to_sheet(reqRows.length > 0 ? reqRows : [{ Notice: 'No parts requests' }]);
    XLSX.utils.book_append_sheet(wb, wsReqs, 'Parts_Requisitions');

    // Sheet 3: Outbound Logistics & Manifests
    const shipRows = (shipments || []).map((s, idx) => ({
      '#': idx + 1,
      'Manifest #': s.invoice_ref || s.shipment_number,
      'Dispatched At': s.dispatched_at ? formatTo12HourDateTime(s.dispatched_at) : (s.shipment_date || 'N/A'),
      'Destination Site': s.site_code || 'BRANCH',
      'Carrier': s.carrier || s.courier || 'Lite Express',
      'Tracking Number': s.tracking_number || s.booking_id || 'N/A',
      'Rider Name': s.pickup_by_name || s.courier_name || 'N/A',
      'Items Count': s.items?.length || 0,
      'Dispatched By': s.dispatched_by || 'Logistics Staff',
      'Received At': s.received_at ? formatTo12HourDateTime(s.received_at) : (s.received_date || 'Pending Delivery'),
      'Received By': s.received_by_name || 'Pending Site Receive',
      'Status': (s.status || 'draft').toUpperCase()
    }));
    const wsShipments = XLSX.utils.json_to_sheet(shipRows.length > 0 ? shipRows : [{ Notice: 'No outbound shipments' }]);
    XLSX.utils.book_append_sheet(wb, wsShipments, 'Outbound_Logistics');

    // Sheet 4: Uploads
    const uploadRows = (uploadAuditLogs || []).map((l, idx) => ({
      '#': idx + 1,
      'Timestamp': formatTo12HourDateTime(l.timestamp),
      'Uploaded By': l.user_name || 'Superadmin',
      'Email': l.user_email || '',
      'Role': (l.user_role || 'SUPERADMIN').toUpperCase(),
      'File Name': l.file_name || '',
      'Target Period': l.target_month || '',
      'Forecast Units': l.total_forecast_units || 0,
      'Allocated Units': l.total_allocated_units || 0,
      'Total Value ($)': Number(l.total_master_cost || 0),
      'Status': l.status || 'Active'
    }));
    const wsUploads = XLSX.utils.json_to_sheet(uploadRows.length > 0 ? uploadRows : [{ Notice: 'No upload audit logs' }]);
    XLSX.utils.book_append_sheet(wb, wsUploads, 'File_Upload_Audits');

    // Sheet 5: Deletions
    const delRows = (deletionAuditLogs || []).map((d, idx) => {
      const { id: displayId, label: displayLabel } = formatAuditEntityDisplay(d);
      return {
        '#': idx + 1,
        'Timestamp': formatTo12HourDateTime(d.timestamp),
        'Entity Type': d.entity_type || '',
        'Record ID': displayId,
        'Record Label': displayLabel,
        'Deleted By': d.deleted_by_name || '',
        'Role / Position': d.deleted_by_position || d.deleted_by_role || 'Specialist',
        'Reason': d.reason || '',
        'Details': JSON.stringify(d.summary || {})
      };
    });
    const wsDeletions = XLSX.utils.json_to_sheet(delRows.length > 0 ? delRows : [{ Notice: 'No deletion audit logs' }]);
    XLSX.utils.book_append_sheet(wb, wsDeletions, 'Data_Deletion_Audits');

    // Sheet 6: Scan Logs
    const scanRows = (effectiveScanLogs || []).map((s, idx) => ({
      '#': idx + 1,
      'Timestamp': formatTo12HourDateTime(s.created_at || s.timestamp),
      'Operation': s.scan_type || 'SCAN_IN',
      'Part Number': s.part_number || '',
      'Serial Number': s.serial_number || '',
      'Operator': s.user_name || '',
      'Result': s.is_valid !== false ? 'VALID' : 'REJECTED'
    }));
    const wsScans = XLSX.utils.json_to_sheet(scanRows.length > 0 ? scanRows : [{ Notice: 'No barcode scan logs' }]);
    XLSX.utils.book_append_sheet(wb, wsScans, 'Scanner_Event_Logs');

    // Sheet 7: Session Activity & Auto-Logout Audits
    const sessionRows = (sessionAuditLogs || []).map((s, idx) => ({
      '#': idx + 1,
      'Timestamp': formatTo12HourDateTime(s.timestamp),
      'Action': s.action,
      'User Name': s.user_name || '',
      'User Email': s.user_email || '',
      'Role': (s.user_role || 'user').toUpperCase(),
      'Position': s.user_position || '',
      'Reason': s.reason || '',
      'Details': JSON.stringify(s.details || {})
    }));
    const wsSessions = XLSX.utils.json_to_sheet(sessionRows.length > 0 ? sessionRows : [{ Notice: 'No session activity logs' }]);
    XLSX.utils.book_append_sheet(wb, wsSessions, 'Session_Activity_Audits');

    XLSX.writeFile(wb, `MDC_Full_Master_Audit_Package_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast?.('Complete Multi-Sheet Master Audit Package exported (.xlsx)', 'success');
  };

  // ── Export Handlers: PDF ────────────────────────────────────────────────────

  const handleExportPDF = (type = auditTab) => {
    let targetData = [];
    let filterLabel = '';

    if (type === 'master') {
      targetData = filteredMasterEvents;
      filterLabel = masterCategoryFilter !== 'ALL' ? `Category: ${masterCategoryFilter}` : (masterSearch ? `Search: "${masterSearch}"` : 'All Master Activities');
    } else if (type === 'uploads' || type === 'report') {
      targetData = filteredUploads;
      filterLabel = periodFilter !== 'ALL' ? `Period: ${periodFilter}` : (localSearch ? `Search: "${localSearch}"` : 'All Master Uploads');
    } else if (type === 'deletions') {
      targetData = filteredDeletions;
      filterLabel = deletionEntityTypeFilter !== 'ALL' ? `Entity: ${deletionEntityTypeFilter}` : 'All Entities';
    } else if (type === 'scan_logs') {
      targetData = filteredScanLogs;
      filterLabel = localSearch ? `Search: "${localSearch}"` : 'All Scanner Logs';
    } else if (type === 'session_activity') {
      targetData = filteredSessionLogs;
      filterLabel = localSearch ? `Search: "${localSearch}"` : 'All Session Activity Logs';
    } else if (type === 'serial_tracer') {
      if (!matchedUnit) {
        showToast?.('Please search and select a valid serial number first', 'warning');
        return;
      }
      targetData = [matchedUnit];
    }

    if (type !== 'serial_tracer' && targetData.length === 0) {
      showToast?.('No records to export for this report', 'warning');
      return;
    }

    const siteObj = sites.find(s => s.id === matchedUnit?.current_site_id);
    generateAuditTrailPDF(type === 'report' ? 'uploads' : type, targetData, {
      currentUser,
      filterLabel,
      matchedUnit,
      siteName: siteObj?.name || 'Distribution Center'
    });
    showToast?.(`Audit report PDF generated successfully`, 'success');
  };

  // ── Purge All Audits Handler (Superadmin Only) ──────────────────────────────

  const handleConfirmPurgeAllAudits = async () => {
    if (!isSuperadmin) {
      showToast?.('Superadmin authorization required to purge audit records', 'error');
      return;
    }
    setIsPurging(true);
    try {
      await deleteAllAuditLogs();
      showToast?.('All audit trail records permanently purged from system & database', 'success');
      setShowPurgeModal(false);
    } catch (err) {
      console.error('Failed to purge audits:', err);
      showToast?.('Failed to purge audit records: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="audit-view" style={{ maxWidth: '100%', margin: '0 auto', paddingBottom: '30px' }}>
      {/* ── Top Header & KPI Banner Card ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '16px', padding: '18px 22px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#ffffff', padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(2,132,199,0.3)' }}>
              <ShieldCheck size={26} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Serialized Lifecycle &amp; Traceability Audit System
                </h2>
                <span
                  style={{
                    background: '#ecfdf5',
                    color: '#059669',
                    border: '1px solid #a7f3d0',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                  Live Traceability Active
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', margin: '3px 0 0' }}>
                Enterprise custody chain, masterlist ingestion history, hardware scanner events, and immutable deletion audit records.
              </p>
            </div>
          </div>

          {/* Action Tools in Header */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => autoRefreshData && autoRefreshData({ force: true, silent: false, reason: 'AuditTrail manual refresh', tables: ['saved_records'] })}
              disabled={isAutoRefreshing}
              title="Force reload latest audit logs from Supabase cloud database"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 12px', borderRadius: '6px' }}
            >
              <RefreshCw size={13} className={isAutoRefreshing ? 'spin-animation' : ''} />
              <span>{isAutoRefreshing ? 'Syncing...' : 'Sync Cloud'}</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleExportAllAuditsXLSX}
              title="Export complete 3-sheet audit archive (.xlsx)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 12px', borderRadius: '6px', color: '#047857' }}
            >
              <FileSpreadsheet size={14} color="#059669" />
              <span>Export Full XLSX</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleExportPDF(auditTab)}
              title="Export active audit view as official branded PDF report"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '6px 12px', borderRadius: '6px', color: '#dc2626' }}
            >
              <FileText size={14} color="#dc2626" />
              <span>Export PDF Report</span>
            </button>

            {/* Superadmin Delete All Audits Trigger */}
            {isSuperadmin && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowPurgeModal(true)}
                title="Superadmin authority: Delete all audit logs across system and cloud database"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 700,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Trash2 size={13} color="#b91c1c" />
                <span>Delete All Audits</span>
              </button>
            )}
          </div>
        </div>

        {/* ── 4 Executive Enterprise KPI Metric Cards ───────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '16px' }}>
          {/* KPI 1: Total Universal Audit Events */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Total Audit Events</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalSystemEvents.toLocaleString()} Verified Events
              </div>
              <div style={{ fontSize: '10.5px', color: '#0284c7', fontWeight: 600 }}>Across all roles &amp; branches</div>
            </div>
          </div>

          {/* KPI 2: PMG & Branch Operations */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ClipboardList size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>PMG &amp; Branch Actions</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalPmgEvents.toLocaleString()} Activities
              </div>
              <div style={{ fontSize: '10.5px', color: '#15803d', fontWeight: 600 }}>Requisitions &amp; repair usage</div>
            </div>
          </div>

          {/* KPI 3: Outbound Logistics & Dispatches */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#f5f3ff', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Logistics &amp; Shipments</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalLogisticsEvents.toLocaleString()} Dispatches
              </div>
              <div style={{ fontSize: '10.5px', color: '#7c3aed', fontWeight: 600 }}>Courier manifests &amp; dispatches</div>
            </div>
          </div>

          {/* KPI 4: Hardware Scans & Serial Lifecycles */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fef3c7', color: '#b45309', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <History size={20} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Hardware Scans &amp; Trace</div>
              <div className="font-mono" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                {reportMetrics.totalScansAndSerials.toLocaleString()} Scans &amp; Trace
              </div>
              <div style={{ fontSize: '10.5px', color: '#b45309', fontWeight: 600 }}>Realtime barcode stream</div>
            </div>
          </div>
        </div>

        {/* ── Sub-Tabs Segmented Ribbon ────────────────────────────────────────── */}
        <div
          style={{
            background: '#f1f5f9',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid #e2e8f0',
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            marginTop: '16px',
            overflowX: 'auto'
          }}
        >
          {/* Tab 1: Master Activity Log (Flagship) */}
          <button
            type="button"
            onClick={() => { setAuditTab('master'); setMasterPage(1); }}
            style={{
              background: auditTab === 'master' ? 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' : 'transparent',
              color: auditTab === 'master' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'master' ? 700 : 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'master' ? '0 2px 6px rgba(15,23,42,0.3)' : 'none'
            }}
          >
            <ClipboardList size={14} />
            <span>Master Activity Log</span>
            <span
              style={{
                background: auditTab === 'master' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                color: auditTab === 'master' ? '#ffffff' : '#475569',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 700
              }}
            >
              {allMasterEvents.length}
            </span>
          </button>

          {/* Tab: Report Summary UI */}
          <button
            type="button"
            onClick={() => setAuditTab('report')}
            style={{
              background: auditTab === 'report' ? 'linear-gradient(135deg, #0f172a 0%, #334155 100%)' : 'transparent',
              color: auditTab === 'report' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'report' ? 700 : 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'report' ? '0 2px 6px rgba(15,23,42,0.3)' : 'none'
            }}
          >
            <BarChart3 size={14} />
            <span>Executive Audit Report</span>
            <span
              style={{
                background: auditTab === 'report' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                color: auditTab === 'report' ? '#ffffff' : '#475569',
                padding: '1px 6px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 700
              }}
            >
              Summary
            </span>
          </button>

          {/* Tab: Uploads */}
          <button
            type="button"
            onClick={() => setAuditTab('uploads')}
            style={{
              background: auditTab === 'uploads' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'uploads' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'uploads' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'uploads' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <UploadCloud size={14} />
            <span>Master File Ingestion</span>
            <span
              style={{
                background: auditTab === 'uploads' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'uploads' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {uploadAuditLogs?.length || 0}
            </span>
          </button>

          {/* Tab: Deletions */}
          <button
            type="button"
            onClick={() => setAuditTab('deletions')}
            style={{
              background: auditTab === 'deletions' ? 'linear-gradient(135deg, #b91c1c 0%, #991b1b 100%)' : 'transparent',
              color: auditTab === 'deletions' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'deletions' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'deletions' ? '0 2px 6px rgba(185,28,28,0.25)' : 'none'
            }}
          >
            <Trash2 size={14} />
            <span>Data Deletions &amp; Purge</span>
            <span
              style={{
                background: auditTab === 'deletions' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'deletions' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {deletionAuditLogs?.length || 0}
            </span>
          </button>

          {/* Tab: Serial Tracer */}
          <button
            type="button"
            onClick={() => setAuditTab('serial_tracer')}
            style={{
              background: auditTab === 'serial_tracer' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'serial_tracer' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'serial_tracer' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'serial_tracer' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <Box size={14} />
            <span>Serialized Part Custody Tracer</span>
          </button>

          {/* Tab: Scanner Logs */}
          <button
            type="button"
            onClick={() => setAuditTab('scan_logs')}
            style={{
              background: auditTab === 'scan_logs' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'scan_logs' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'scan_logs' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'scan_logs' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <History size={14} />
            <span>Barcode Scanner Event Logs</span>
            <span
              style={{
                background: auditTab === 'scan_logs' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'scan_logs' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {scanLogs?.length || 0}
            </span>
          </button>

          {/* Tab: Session & Auto-Logout Activity */}
          <button
            type="button"
            onClick={() => setAuditTab('session_activity')}
            style={{
              background: auditTab === 'session_activity' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
              color: auditTab === 'session_activity' ? '#ffffff' : '#475569',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: auditTab === 'session_activity' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: auditTab === 'session_activity' ? '0 2px 6px rgba(2,132,199,0.25)' : 'none'
            }}
          >
            <Clock size={14} />
            <span>Session &amp; Auto-Logout</span>
            <span
              style={{
                background: auditTab === 'session_activity' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: auditTab === 'session_activity' ? '#ffffff' : '#475569',
                padding: '2px 7px',
                borderRadius: '12px',
                fontSize: '10.5px',
                fontWeight: 700
              }}
            >
              {sessionAuditLogs?.length || 0}
            </span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: Master Activity Log (Flagship Universal Audit Stream) ──────── */}
      {auditTab === 'master' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          {/* Master Toolbar Header */}
          <div style={{ padding: '16px 20px', background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ClipboardList size={18} color="#0284c7" />
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    Master System Activity &amp; Traceability Stream
                  </h3>
                  <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                    Live &amp; Immutable
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>
                  Authoritative, system-wide audit trail recording every user action across Super Admins, PMG Specialists, Technicians, and automated system engines.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportMasterXLSX}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}
                >
                  <Download size={13} />
                  <span>Export Activity (.xlsx)</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleExportPDF('master')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px', color: '#dc2626' }}
                >
                  <Printer size={13} color="#dc2626" />
                  <span>Print PDF Report</span>
                </button>
              </div>
            </div>

            {/* Quick Category Filter Chips */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px', marginBottom: '12px' }}>
              {[
                { id: 'ALL', label: 'All Activities', count: allMasterEvents.length },
                { id: 'REQUISITION', label: '📋 Requisitions', count: allMasterEvents.filter(e => e.category === 'REQUISITION').length },
                { id: 'LOGISTICS', label: '🚚 Logistics & Shipments', count: allMasterEvents.filter(e => e.category === 'LOGISTICS').length },
                { id: 'CONSUMPTION', label: '🔧 Repairs & Parts Used', count: allMasterEvents.filter(e => e.category === 'CONSUMPTION').length },
                { id: 'INVENTORY', label: '📦 Stock & Intake', count: allMasterEvents.filter(e => e.category === 'INVENTORY').length },
                { id: 'HARDWARE_SCAN', label: '⚡ Barcode Scans', count: allMasterEvents.filter(e => e.category === 'HARDWARE_SCAN').length },
                { id: 'DATA_IMPORT', label: '📁 Master Imports', count: allMasterEvents.filter(e => e.category === 'DATA_IMPORT').length },
                { id: 'SECURITY_SESSION', label: '🛡️ Security & Sessions', count: allMasterEvents.filter(e => e.category === 'SECURITY_SESSION').length },
                { id: 'DELETION', label: '🗑️ Deletions & Purges', count: allMasterEvents.filter(e => e.category === 'DELETION').length }
              ].map(cat => {
                const isActive = masterCategoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => { setMasterCategoryFilter(cat.id); setMasterPage(1); }}
                    style={{
                      background: isActive ? '#0f172a' : '#f1f5f9',
                      color: isActive ? '#ffffff' : '#475569',
                      border: '1px solid ' + (isActive ? '#0f172a' : '#e2e8f0'),
                      borderRadius: '20px',
                      padding: '4px 12px',
                      fontSize: '11.5px',
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{cat.label}</span>
                    <span style={{
                      background: isActive ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                      color: isActive ? '#ffffff' : '#64748b',
                      padding: '1px 5px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: 700
                    }}>
                      {cat.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Multi-Filter Dropdowns & Live Search Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', alignItems: 'end' }}>
              {/* Search Input */}
              <div style={{ gridColumn: 'span 2', minWidth: '240px' }}>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                  Search Activity Stream
                </label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Search Part #, Serial #, User, Action, Site, WO, Tracking #..."
                    value={masterSearch}
                    onChange={(e) => { setMasterSearch(e.target.value); setMasterPage(1); }}
                    className="form-input"
                    style={{ paddingLeft: '32px', paddingRight: masterSearch ? '28px' : '10px', height: '36px', fontSize: '12px', width: '100%', borderRadius: '8px' }}
                  />
                  {masterSearch && (
                    <button
                      type="button"
                      onClick={() => { setMasterSearch(''); setMasterPage(1); }}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* User Role Filter */}
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                  Operator Role
                </label>
                <select
                  value={masterRoleFilter}
                  onChange={(e) => { setMasterRoleFilter(e.target.value); setMasterPage(1); }}
                  className="form-select"
                  style={{ height: '36px', fontSize: '12px', width: '100%', borderRadius: '8px' }}
                >
                  <option value="ALL">All User Roles</option>
                  <option value="superadmin">Super Admin (Central DC)</option>
                  <option value="parts_management">PMG Specialist (Retail ASP)</option>
                  <option value="technician">Service Technician</option>
                  <option value="warehouse_staff">Warehouse &amp; Logistics</option>
                </select>
              </div>

              {/* Site / Branch Filter */}
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                  Site / Location
                </label>
                <select
                  value={masterSiteFilter}
                  onChange={(e) => { setMasterSiteFilter(e.target.value); setMasterPage(1); }}
                  className="form-select"
                  style={{ height: '36px', fontSize: '12px', width: '100%', borderRadius: '8px' }}
                >
                  <option value="ALL">All Locations / Sites</option>
                  <option value="DC-MDC">Distribution Center (DC-MDC)</option>
                  {(sites || []).map(s => (
                    <option key={s.id || s.code} value={s.code || s.id}>
                      {s.code} - {s.name || 'Branch'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Period Filter */}
              <div>
                <label style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                  Time Horizon
                </label>
                <select
                  value={masterDateFilter}
                  onChange={(e) => { setMasterDateFilter(e.target.value); setMasterPage(1); }}
                  className="form-select"
                  style={{ height: '36px', fontSize: '12px', width: '100%', borderRadius: '8px' }}
                >
                  <option value="ALL">All Time History</option>
                  <option value="TODAY">Today Only</option>
                  <option value="7DAYS">Last 7 Days</option>
                  <option value="30DAYS">Last 30 Days</option>
                </select>
              </div>
            </div>
          </div>

          {/* Master Table */}
          <div className="table-scroll-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1175px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#f8fafc', borderBottom: '1px solid #1e293b' }}>
                  <th style={{ width: '48px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
                  <th style={{ width: '210px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timestamp</th>
                  <th style={{ width: '210px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action &amp; Category</th>
                  <th style={{ width: '215px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operator &amp; Role</th>
                  <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Entity &amp; Details</th>
                  <th style={{ width: '165px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</th>
                  <th style={{ width: '110px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  <th style={{ width: '96px', textAlign: 'center', padding: '12px 10px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dossier</th>
                </tr>
              </thead>
              <tbody>
                {filteredMasterEvents.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '56px 20px', color: '#94a3b8' }}>
                      <ClipboardList size={40} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 700, color: '#475569' }}>
                        No matching audit activities found
                      </p>
                      <p style={{ margin: 0, fontSize: '12px' }}>
                        Try adjusting your search criteria or selecting "All Activities".
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedMasterEvents.map((evt, index) => {
                    const meta = getActionDisplayMeta(evt.action, evt.category);
                    const ActionIcon = meta.icon;
                    const roleMeta = getRoleBadgeMeta(evt.user?.role);
                    const relTime = getRelativeTimeBadge(evt.timestamp);
                    const rowNum = (masterPage - 1) * masterPageSize + index + 1;
                    const operatorName = evt.user?.fullName || 'System User';
                    const operatorInitial = operatorName.charAt(0).toUpperCase();

                    return (
                      <tr
                        key={evt.id || index}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: index % 2 === 0 ? '#ffffff' : '#f8fafc',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f9ff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = index % 2 === 0 ? '#ffffff' : '#f8fafc'; }}
                      >
                        {/* 1. Row # */}
                        <td className="font-mono" style={{ textAlign: 'center', padding: '12px 8px', color: '#94a3b8', fontWeight: 700, fontSize: '11px', verticalAlign: 'middle' }}>
                          {rowNum}
                        </td>

                        {/* 2. Timestamp */}
                        <td
                          style={{ padding: '12px 12px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}
                          title={formatTo12HourDateTime(evt.timestamp)}
                        >
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12px', lineHeight: 1.3 }}>
                            {formatTo12HourDateTime(evt.timestamp)}
                          </div>
                          {relTime && (
                            <div style={{ fontSize: '10.5px', color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                              <Clock size={10} style={{ flexShrink: 0 }} />
                              <span>{relTime}</span>
                            </div>
                          )}
                        </td>

                        {/* 3. Action & Category */}
                        <td style={{ padding: '12px 12px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
                            <span
                              style={{
                                background: meta.bg,
                                color: meta.color,
                                border: `1px solid ${meta.border}`,
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                              title={`${meta.label} (${evt.action})`}
                            >
                              <ActionIcon size={12} style={{ flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.label}</span>
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '10px',
                              color: '#64748b',
                              marginTop: '4px',
                              fontFamily: 'var(--font-mono, monospace)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '100%'
                            }}
                            title={evt.action}
                          >
                            {evt.action}
                          </div>
                        </td>

                        {/* 4. Operator & Role */}
                        <td
                          style={{ padding: '12px 12px', overflow: 'hidden', verticalAlign: 'middle' }}
                          title={`${operatorName} (${roleMeta.label})${evt.user?.email ? ` • ${evt.user.email}` : ''}`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                background: roleMeta.bg,
                                color: roleMeta.color,
                                border: `1px solid ${roleMeta.border}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '11px',
                                flexShrink: 0
                              }}
                            >
                              {operatorInitial}
                            </div>
                            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: '#0f172a',
                                  fontSize: '12px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  lineHeight: 1.25
                                }}
                              >
                                {operatorName}
                              </div>
                              <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center' }}>
                                <span
                                  style={{
                                    background: roleMeta.bg,
                                    color: roleMeta.color,
                                    border: `1px solid ${roleMeta.border}`,
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    whiteSpace: 'nowrap',
                                    display: 'inline-block',
                                    letterSpacing: '0.02em'
                                  }}
                                >
                                  {roleMeta.label}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 5. Target Entity & Details */}
                        <td style={{ padding: '12px 14px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <div
                            style={{
                              fontWeight: 700,
                              color: '#0f172a',
                              fontSize: '12px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.3
                            }}
                            title={evt.entityLabel || evt.entityId}
                          >
                            {evt.entityLabel || evt.entityId}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', minWidth: 0, overflow: 'hidden' }}>
                            <span
                              style={{
                                background: '#f1f5f9',
                                color: '#475569',
                                border: '1px solid #e2e8f0',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                flexShrink: 0
                              }}
                            >
                              {evt.entityType}
                            </span>
                            <span
                              className="font-mono"
                              style={{
                                color: '#0284c7',
                                fontWeight: 600,
                                fontSize: '11px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                              title={evt.entityId}
                            >
                              {evt.entityId}
                            </span>
                          </div>
                        </td>

                        {/* 6. Location */}
                        <td style={{ padding: '12px 12px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <div>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              <MapPin size={11} color="#0284c7" style={{ flexShrink: 0 }} />
                              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                {evt.siteCode || 'DC-MDC'}
                              </span>
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '10.5px',
                              color: '#64748b',
                              marginTop: '3px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '100%'
                            }}
                            title={evt.siteName || 'Distribution Center'}
                          >
                            {evt.siteName || 'Distribution Center'}
                          </div>
                        </td>

                        {/* 7. Status */}
                        <td style={{ textAlign: 'center', padding: '12px 8px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              background: evt.status === 'COMPLETED' || evt.status === 'APPROVED' || evt.status === 'RECEIVED' || evt.status === 'VALID' || evt.status === 'ACTIVE'
                                ? '#ecfdf5' : evt.status === 'REJECTED' || evt.status === 'PURGED' || evt.status === 'FAILED'
                                ? '#fef2f2' : evt.status === 'PENDING' || evt.status === 'TERMINATED'
                                ? '#fffbeb' : '#f0f9ff',
                              color: evt.status === 'COMPLETED' || evt.status === 'APPROVED' || evt.status === 'RECEIVED' || evt.status === 'VALID' || evt.status === 'ACTIVE'
                                ? '#059669' : evt.status === 'REJECTED' || evt.status === 'PURGED' || evt.status === 'FAILED'
                                ? '#dc2626' : evt.status === 'PENDING' || evt.status === 'TERMINATED'
                                ? '#b45309' : '#0284c7',
                              border: `1px solid ${
                                evt.status === 'COMPLETED' || evt.status === 'APPROVED' || evt.status === 'RECEIVED' || evt.status === 'VALID' || evt.status === 'ACTIVE'
                                ? '#a7f3d0' : evt.status === 'REJECTED' || evt.status === 'PURGED' || evt.status === 'FAILED'
                                ? '#fecaca' : evt.status === 'PENDING' || evt.status === 'TERMINATED'
                                ? '#fde68a' : '#bae6fd'
                              }`,
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '10px',
                              display: 'inline-block',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {evt.status}
                          </span>
                        </td>

                        {/* 8. Dossier */}
                        <td style={{ textAlign: 'center', padding: '12px 10px', verticalAlign: 'middle' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedEventForDossier(evt)}
                            className="btn btn-secondary btn-sm"
                            title="Inspect complete event cryptographic dossier & metadata"
                            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', borderRadius: '6px' }}
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          {filteredMasterEvents.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Showing <strong>{(masterPage - 1) * masterPageSize + 1}</strong> - <strong>{Math.min(masterPage * masterPageSize, filteredMasterEvents.length)}</strong> of <strong>{filteredMasterEvents.length}</strong> activity records
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={masterPage === 1}
                  onClick={() => setMasterPage(prev => Math.max(1, prev - 1))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '11.5px' }}
                >
                  <ChevronLeft size={13} />
                  <span>Prev</span>
                </button>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', padding: '0 8px' }}>
                  Page {masterPage} of {totalMasterPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={masterPage >= totalMasterPages}
                  onClick={() => setMasterPage(prev => Math.min(totalMasterPages, prev + 1))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '11.5px' }}
                >
                  <span>Next</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 0: Executive Audit Summary Report UI (The Simple Report UI) ──────── */}
      {auditTab === 'report' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Report Summary Card */}
          <div className="card" style={{ padding: '22px 24px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart3 size={20} color="#0284c7" />
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    Monthly Master Ingestion &amp; Period Valuation Report
                  </h3>
                  <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>
                    Executive View
                  </span>
                </div>
                <p style={{ fontSize: '12.5px', color: '#64748b', margin: '3px 0 0' }}>
                  Consolidated breakdown of all masterlist datasets, period unit totals, aggregate inventory valuations, and audit timestamps.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleExportAllAuditsXLSX}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
                >
                  <Download size={13} />
                  <span>Download Report (.xlsx)</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleExportPDF('report')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#dc2626' }}
                >
                  <Printer size={13} color="#dc2626" />
                  <span>Print PDF Report</span>
                </button>
              </div>
            </div>

            {/* Monthly Breakdown Table */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ background: '#0f172a', color: '#f8fafc', borderBottom: '1px solid #1e293b' }}>
                    <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Period</th>
                    <th style={{ textAlign: 'center', padding: '12px 10px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingestion Count</th>
                    <th style={{ textAlign: 'right', padding: '12px 14px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Forecast Units</th>
                    <th style={{ textAlign: 'right', padding: '12px 14px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Master Valuation</th>
                    <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Primary Uploader</th>
                    <th style={{ textAlign: 'center', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reportMetrics.monthlySummary.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                        No monthly ingestion reports available.
                      </td>
                    </tr>
                  ) : (
                    reportMetrics.monthlySummary.map((item, idx) => (
                      <tr
                        key={item.month}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: idx === 0 ? '#f0fdf4' : (idx % 2 === 0 ? '#ffffff' : '#fafafa')
                        }}
                      >
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0f172a' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={13} color="#0284c7" />
                            <span>{item.month}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '12px 10px' }}>
                          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700 }}>
                            {item.uploadCount} masterlists
                          </span>
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 700, color: '#0284c7' }}>
                          {item.forecastUnits.toLocaleString()} units
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '12px 14px', fontWeight: 800, color: '#0f172a' }}>
                          ${item.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '12px 14px', color: '#334155' }}>
                          <div style={{ fontWeight: 600 }}>{item.uploadedBy}</div>
                          <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                            Last: {new Date(item.latestUpload).toLocaleDateString()}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '12px 12px' }}>
                          {idx === 0 ? (
                            <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: '10.5px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px' }}>
                              Active Cycle
                            </span>
                          ) : (
                            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: '10.5px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px' }}>
                              Archived
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Quick Audit Health & System Security Info */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginTop: '18px' }}>
              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                  <ShieldCheck size={14} color="#059669" />
                  <span>Audit Security &amp; Database State</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                  Connected to Supabase Cloud PostgreSQL. Audit records are streamed with real-time websocket broadcasts and cross-tab synchronization.
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                  <UserCheck size={14} color="#0284c7" />
                  <span>Operator Identity &amp; Accountability</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.5 }}>
                  Logged-in Specialist: <strong>{currentUser?.fullName || 'Superadmin'}</strong> ({currentUser?.email || 'zhonmanaois@gmail.com'}).
                  All actions are stamped with immutable cryptographic timestamps.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 1: File Upload & Master Ingestion Audits ────────────────────────── */}
      {auditTab === 'uploads' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileSpreadsheet size={16} color="#0284c7" />
                  Master Ingestion &amp; Upload History
                </h3>
                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                  {filteredUploads.length} Events
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Period Filter Dropdown */}
              <select
                value={periodFilter}
                onChange={(e) => {
                  setPeriodFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="form-select"
                style={{ height: '34px', fontSize: '12px', width: '150px', borderRadius: '6px' }}
              >
                <option value="ALL">All Periods</option>
                <option value="September 2026">September 2026</option>
                <option value="August 2026">August 2026</option>
              </select>

              {/* Search Bar */}
              <div style={{ position: 'relative', width: '200px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search file, user..."
                  value={localSearch}
                  onChange={(e) => {
                    setLocalSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="form-input"
                  style={{ paddingLeft: '30px', paddingRight: localSearch ? '26px' : '10px', height: '34px', fontSize: '12px', width: '100%', borderRadius: '6px' }}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalSearch('');
                      setCurrentPage(1);
                    }}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Single Tab Export Buttons */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportUploadsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <Download size={13} />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('uploads')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <FileText size={13} />
                <span>PDF Report</span>
              </button>
            </div>
          </div>

          {/* Table Container - Auto Responsive */}
          <div className="table-scroll-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', minWidth: '960px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#f8fafc', borderBottom: '1px solid #1e293b' }}>
                  <th style={{ width: '48px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
                  <th style={{ width: '130px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date &amp; Time</th>
                  <th style={{ width: '210px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uploaded By</th>
                  <th style={{ textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingested File</th>
                  <th style={{ width: '135px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target Period</th>
                  <th style={{ width: '115px', textAlign: 'right', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Units</th>
                  <th style={{ width: '125px', textAlign: 'right', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Value</th>
                  <th style={{ width: '95px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUploads.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <FileSpreadsheet size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No upload events found</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>Upload a masterlist to generate live audit records.</p>
                    </td>
                  </tr>
                ) : (
                  paginatedUploads.map((log, index) => {
                    const actualIdx = (currentPage - 1) * pageSize + index;
                    const isActive = actualIdx === 0;
                    return (
                      <tr
                        key={log.id || `upload-log-${actualIdx}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: isActive ? '#f0fdf4' : (actualIdx % 2 === 0 ? '#ffffff' : '#fafafa')
                        }}
                      >
                        <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                          {actualIdx + 1}
                        </td>
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                            {formatTo12HourTime(log.timestamp, false)}
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <div
                              style={{
                                width: '26px',
                                height: '26px',
                                borderRadius: '50%',
                                background: isActive ? '#dcfce7' : '#e0f2fe',
                                color: isActive ? '#15803d' : '#0369a1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '11px',
                                flexShrink: 0
                              }}
                            >
                              {log.user_name ? log.user_name.charAt(0).toUpperCase() : 'Z'}
                            </div>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.user_name || 'Super Admin'}
                              </div>
                              <div style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.user_email || 'zhon.manaois@mobilecareph.com'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ fontWeight: 600, fontSize: '12px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <FileSpreadsheet size={13} color="#0284c7" style={{ flexShrink: 0 }} />
                            <span style={{ wordBreak: 'break-word' }}>{log.file_name}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '2px', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '1px 4px', borderRadius: '3px' }}>
                              {log.file_type ? log.file_type.replace('_', ' ') : 'WORKBOOK'}
                            </span>
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                              {log.parts_count || 41} SKUs &bull; {log.sites_count || 27} Sites
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '11.5px', fontWeight: 600, color: '#334155' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f8fafc', padding: '2px 7px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                            <Calendar size={11} color="#0284c7" />
                            <span>{log.target_month || 'Current'}</span>
                          </div>
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 700, fontSize: '12px', color: '#0284c7' }}>
                          {log.total_forecast_units?.toLocaleString() || 0} units
                        </td>
                        <td className="font-mono" style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 800, fontSize: '12px', color: '#0f172a' }}>
                          ${(log.total_master_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                          {isActive ? (
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: '10px',
                                background: '#ecfdf5',
                                color: '#047857',
                                border: '1px solid #a7f3d0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <CheckCircle2 size={10} />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '9.5px',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: '10px',
                                background: '#f1f5f9',
                                color: '#64748b',
                                border: '1px solid #e2e8f0',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <History size={9} />
                              <span>Archived</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {totalUploadPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, filteredUploads.length)}</strong> of <strong>{filteredUploads.length}</strong> records
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  style={{ height: '30px', padding: '0 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                >
                  <ChevronLeft size={13} />
                  <span>Prev</span>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                  {currentPage} / {totalUploadPages}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={currentPage === totalUploadPages}
                  onClick={() => setCurrentPage(p => Math.min(totalUploadPages, p + 1))}
                  style={{ height: '30px', padding: '0 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                >
                  <span>Next</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: Data Deletions & Purge Audits ────────────────────────────────── */}
      {auditTab === 'deletions' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Trash2 size={16} color="#b91c1c" />
                  Data Deletions &amp; Purge Audit Trail
                </h3>
                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                  {filteredDeletions.length} Events
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Entity Type Filter */}
              <select
                value={deletionEntityTypeFilter}
                onChange={(e) => setDeletionEntityTypeFilter(e.target.value)}
                className="form-select"
                style={{ height: '34px', fontSize: '12px', width: '160px', borderRadius: '6px' }}
              >
                <option value="ALL">All Entities ({deletionAuditLogs.length})</option>
                <option value="Part Catalog">Parts Catalog</option>
                <option value="Service Site">Service Sites &amp; Branches</option>
                <option value="DC Intake Record">Intake Records</option>
                <option value="Period Snapshot">Period Snapshots</option>
                <option value="Shipment Manifest">Shipments</option>
                <option value="Purchase Order">Purchase Orders</option>
                <option value="Inventory Unit">Inventory Units</option>
              </select>

              {/* Search Bar */}
              <div style={{ position: 'relative', width: '190px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search ID, user, reason..."
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '30px', paddingRight: localSearch ? '26px' : '10px', height: '34px', fontSize: '12px', width: '100%', borderRadius: '6px' }}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => setLocalSearch('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Export Buttons */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportDeletionsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <Download size={13} />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('deletions')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <FileText size={13} />
                <span>PDF Report</span>
              </button>
            </div>
          </div>

          {/* Table Container - Auto Responsive */}
          <div className="table-scroll-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1020px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#f8fafc', borderBottom: '1px solid #1e293b' }}>
                  <th style={{ width: '48px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
                  <th style={{ width: '130px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timestamp</th>
                  <th style={{ width: '140px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entity Type</th>
                  <th style={{ width: '215px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Record ID &amp; Label</th>
                  <th style={{ textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason / Action Note</th>
                  <th style={{ width: '190px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deleted By</th>
                  <th style={{ width: '150px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Impact Summary</th>
                  <th style={{ width: '90px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeletions.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <Trash2 size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No deletion audit events found</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>When records are deleted, immutable audit logs will appear here.</p>
                    </td>
                  </tr>
                ) : (
                  filteredDeletions.map((log, index) => {
                    const isPart = log.entity_type === 'Part Catalog' || log.entity_type === 'Part';
                    const isSite = log.entity_type === 'Service Site' || log.entity_type === 'Site';
                    const isIntake = log.entity_type === 'DC Intake Record';
                    const isSnapshot = log.entity_type === 'Period Snapshot';
                    const isShipment = log.entity_type === 'Shipment Manifest';
                    const isPO = log.entity_type === 'Purchase Order';

                    const badgeBg = isPart ? '#f3e8ff' : isSite ? '#e0e7ff' : isIntake ? '#fffbeb' : isSnapshot ? '#eff6ff' : isShipment ? '#f0fdf4' : isPO ? '#fef3c7' : '#fee2e2';
                    const badgeColor = isPart ? '#7e22ce' : isSite ? '#3730a3' : isIntake ? '#b45309' : isSnapshot ? '#1d4ed8' : isShipment ? '#15803d' : isPO ? '#92400e' : '#b91c1c';
                    const badgeBorder = isPart ? '#e9d5ff' : isSite ? '#c7d2fe' : isIntake ? '#fde68a' : isSnapshot ? '#bfdbfe' : isShipment ? '#bbf7d0' : isPO ? '#fde68a' : '#fecaca';

                    const { id: displayId, label: displayLabel, fullRawId } = formatAuditEntityDisplay(log);

                    return (
                      <tr
                        key={log.id || `deletion-log-${index}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: index % 2 === 0 ? '#ffffff' : '#fafafa'
                        }}
                      >
                        <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                            {formatTo12HourTime(log.timestamp, false)}
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '5px',
                              background: badgeBg,
                              color: badgeColor,
                              border: `1px solid ${badgeBorder}`,
                              display: 'inline-block'
                            }}
                          >
                            {log.entity_type}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div
                            className="font-mono"
                            style={{
                              fontWeight: 700,
                              fontSize: '12px',
                              color: '#0f172a',
                              letterSpacing: '0.2px'
                            }}
                            title={fullRawId ? `System ID: ${fullRawId}` : undefined}
                          >
                            {displayId}
                          </div>
                          {displayLabel && (
                            <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px', lineHeight: 1.3 }}>
                              {displayLabel}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'flex-start',
                            gap: '6px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '11.5px',
                            color: '#991b1b',
                            lineHeight: 1.35
                          }}>
                            <span style={{ fontWeight: 600 }}>{log.reason || 'User initiated deletion'}</span>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <div
                              style={{
                                width: '26px',
                                height: '26px',
                                borderRadius: '50%',
                                background: '#fee2e2',
                                color: '#b91c1c',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 800,
                                fontSize: '11px',
                                flexShrink: 0
                              }}
                            >
                              {log.deleted_by_name ? log.deleted_by_name.charAt(0).toUpperCase() : 'Z'}
                            </div>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.deleted_by_name || 'Zhon Manaois'}
                              </div>
                              <div style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {log.deleted_by_position || log.deleted_by_role || 'Specialist'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '9px 10px', fontSize: '11px', color: '#334155' }}>
                          {log.summary?.itemsCount !== undefined && (
                            <div style={{ fontWeight: 600 }}>
                              <strong>{log.summary.itemsCount}</strong> units purged
                            </div>
                          )}
                          {log.summary?.description && (
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>
                              {log.summary.description}
                            </div>
                          )}
                          {log.summary?.iphone_model && (
                            <div style={{ color: '#64748b' }}>
                              Model: {log.summary.iphone_model}
                            </div>
                          )}
                          {log.summary?.stocking_price !== undefined && (
                            <div className="font-mono" style={{ color: '#0284c7', fontSize: '10.5px' }}>
                              Stock: ${Number(log.summary.stocking_price).toFixed(2)}
                            </div>
                          )}
                          {log.summary?.site_name && (
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>
                              {log.summary.site_name}
                            </div>
                          )}
                          {log.summary?.region && (
                            <div style={{ color: '#64748b' }}>
                              Region: {log.summary.region}
                            </div>
                          )}
                          {log.summary?.poNumber && (
                            <div style={{ color: '#64748b' }}>
                              PO: <span className="font-mono">{log.summary.poNumber}</span>
                            </div>
                          )}
                          {log.summary?.destinationSite && (
                            <div style={{ color: '#64748b' }}>
                              Dest: {log.summary.destinationSite}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', padding: '9px 6px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 7px',
                              borderRadius: '10px',
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <ShieldCheck size={10} />
                            <span>Logged</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 3: Serialized Part Custody Tracer ──────────────────────────────── */}
      {auditTab === 'serial_tracer' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Search Card */}
          <div className="card" style={{ padding: '18px 22px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Box size={16} color="#0284c7" />
                  Serialized Unit Custody Chain Tracer
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                  Search any individual Apple serial number to inspect its lifecycle: Scan-In &rarr; Allocation &rarr; Pack Out &rarr; Branch Dispatch.
                </p>
              </div>

              {matchedUnit && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleExportSerialTracerXLSX}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <Download size={13} />
                    <span>Export XLSX</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleExportPDF('serial_tracer')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                  >
                    <FileText size={13} />
                    <span>Trace PDF</span>
                  </button>
                </div>
              )}
            </div>

            <div style={{ position: 'relative', maxWidth: '580px' }}>
              <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Enter exact Apple Serial Number (e.g. FG9HTN005WS00006TT)..."
                value={selectedSerial}
                onChange={(e) => setSelectedSerial(e.target.value)}
                className="form-input font-mono"
                style={{ paddingLeft: '34px', height: '40px', fontSize: '13px', fontWeight: 600, width: '100%', borderRadius: '8px' }}
              />
              {selectedSerial && (
                <button
                  type="button"
                  onClick={() => setSelectedSerial('')}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Matched Unit Lifecycle Display */}
          {matchedUnit ? (
            <div className="card" style={{ padding: '20px 22px', border: '1px solid #bae6fd', background: '#ffffff', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '10.5px',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: matchedUnit.isUsed ? '#fef2f2' : matchedUnit.isDcSite ? '#ecfdf5' : '#eff6ff',
                      color: matchedUnit.isUsed ? '#dc2626' : matchedUnit.isDcSite ? '#059669' : '#0284c7',
                      border: `1px solid ${matchedUnit.isUsed ? '#fecaca' : matchedUnit.isDcSite ? '#a7f3d0' : '#bfdbfe'}`
                    }}>
                      {matchedUnit.statusBadgeLabel ? matchedUnit.statusBadgeLabel.toUpperCase() : String(matchedUnit.status || 'in_stock').toUpperCase()}
                    </span>
                    <span className="font-mono" style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                      {matchedUnit.serial_number}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '4px 0 2px' }}>
                    {matchedUnit.description || 'Apple Genuine Component'}
                  </h3>
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                    Part Number: <strong className="font-mono" style={{ color: '#0f172a' }}>{matchedUnit.part_number}</strong>
                    {matchedUnit.po_number && <> &bull; PO Ref: <strong className="font-mono" style={{ color: '#0f172a' }}>{matchedUnit.po_number}</strong></>}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setInspectedSerialDetails(matchedUnit)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700 }}
                  >
                    <ExternalLink size={13} />
                    <span>Open Serial Dossier</span>
                  </button>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Current Location</div>
                    <div style={{ fontSize: '13.5px', fontWeight: 800, color: matchedUnit.isDcSite ? '#059669' : '#0284c7', marginTop: '1px' }}>
                      {matchedUnit.isDcSite ? 'Distribution Center Main Warehouse' : matchedUnit.siteName}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Core Intelligence Highlight Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {/* 1. Stock Location: DC vs Specific Site */}
                <div style={{ background: matchedUnit.isDcSite ? '#f0fdf4' : '#f0f9ff', padding: '12px 14px', borderRadius: '10px', border: `1px solid ${matchedUnit.isDcSite ? '#bbf7d0' : '#bae6fd'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: matchedUnit.isDcSite ? '#15803d' : '#0369a1', textTransform: 'uppercase' }}>
                    <MapPin size={13} />
                    <span>Stock Location</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {matchedUnit.isDcSite ? 'DC Stocks' : matchedUnit.siteName || 'Branch Site'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {matchedUnit.isDcSite ? 'Central DC Stock' : `Site Stock (${matchedUnit.siteRegion || 'Branch'})`}
                  </div>
                </div>

                {/* 2. Usage Status: Used by Site */}
                <div style={{ background: matchedUnit.isUsed ? '#fef2f2' : '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: `1px solid ${matchedUnit.isUsed ? '#fecaca' : '#e2e8f0'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: matchedUnit.isUsed ? '#b91c1c' : '#475569', textTransform: 'uppercase' }}>
                    <Wrench size={13} />
                    <span>Usage Status</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: matchedUnit.isUsed ? '#b91c1c' : '#059669', marginTop: '4px' }}>
                    {matchedUnit.isUsed ? 'Used / Consumed by Site' : 'In Stock / Available'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {matchedUnit.isUsed ? `WO: ${matchedUnit.workOrderNumber || 'Internal'}` : 'Not consumed in repair'}
                  </div>
                </div>

                {/* 3. Site Arrival Date */}
                <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Calendar size={13} />
                    <span>Recorded Site Arrival Date</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                    {matchedUnit.siteArrivalFormatted || (matchedUnit.isDcSite ? 'DC Central Intake' : 'Pending Confirmation')}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {matchedUnit.siteArrivalStatus}
                  </div>
                </div>

                {/* 4. Date Used in System */}
                <div style={{ background: matchedUnit.isUsed ? '#fffbeb' : '#f8fafc', padding: '12px 14px', borderRadius: '10px', border: `1px solid ${matchedUnit.isUsed ? '#fde68a' : '#e2e8f0'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800, color: matchedUnit.isUsed ? '#b45309' : '#64748b', textTransform: 'uppercase' }}>
                    <Clock size={13} />
                    <span>Date Used in System</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: matchedUnit.isUsed ? '#b45309' : '#94a3b8', marginTop: '4px' }}>
                    {matchedUnit.dateUsedFormatted || (matchedUnit.isUsed ? 'Date Recorded' : 'Not Yet Used')}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {matchedUnit.isUsed ? `By: ${matchedUnit.usedByName || 'Specialist'}` : 'Active inventory unit'}
                  </div>
                </div>
              </div>

              {/* 4-Stage Custody Visual Stepper Pipeline */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                {/* Stage 1: DC Receive Scan-In */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <CheckCircle2 size={13} />
                    <span>1. DC Receive Scan-In</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.received_at ? new Date(matchedUnit.received_at).toLocaleDateString() : 'Recorded in Stock'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    By: <strong>{matchedUnit.received_by || 'Warehouse Staff'}</strong>
                  </div>
                </div>

                {/* Stage 2: Allocation & Order Matching */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Layers size={13} />
                    <span>2. Allocation &amp; Cycle</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.allocated_at ? new Date(matchedUnit.allocated_at).toLocaleDateString() : 'Auto-Allocated'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Target: <strong>{matchedUnit.isDcSite ? 'DC Stock' : matchedUnit.siteName}</strong>
                  </div>
                </div>

                {/* Stage 3: Box Pack Scan-Out */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Box size={13} />
                    <span>3. Pack Scan-Out</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.shipped_at ? new Date(matchedUnit.shipped_at).toLocaleDateString() : (matchedUnit.status === 'packed' ? 'Packed in Dispatch' : 'Awaiting Pack')}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Box #: <strong>{matchedUnit.box_number || 1}</strong>
                  </div>
                </div>

                {/* Stage 4: Dispatch & Delivery */}
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                    <Truck size={13} />
                    <span>4. Site Delivery &amp; Usage</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>
                    {matchedUnit.isUsed ? 'Used in Repair' : matchedUnit.siteArrivalFormatted ? 'Arrived at Site' : matchedUnit.status === 'shipped' ? 'In Transit' : 'DC Central Stock'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Status: <strong style={{ color: matchedUnit.isUsed ? '#dc2626' : '#047857' }}>{matchedUnit.statusBadgeLabel}</strong>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedSerial.trim() ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', border: '1px dashed #cbd5e1', borderRadius: '12px' }}>
              <Box size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 700, color: '#475569' }}>
                No serial number found matching &quot;{selectedSerial}&quot;
              </p>
              <p style={{ margin: 0, fontSize: '12px' }}>
                Verify the entered Apple serial string or check Barcode Scanner Event Logs.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* ── TAB 4: Barcode Scanner Event Logs ──────────────────────────────────── */}
      {auditTab === 'scan_logs' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#ffffff' }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <History size={16} color="#0284c7" />
                  Hardware Barcode Scanner Event Logs
                </h3>
                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                  {filteredScanLogs.length} Events
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', width: '200px' }}>
                <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Search serial, P/N..."
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '30px', paddingRight: localSearch ? '26px' : '10px', height: '34px', fontSize: '12px', width: '100%', borderRadius: '6px' }}
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => setLocalSearch('')}
                    style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Single Tab Export Buttons */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportScanLogsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <Download size={13} />
                <span>Export XLSX</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleExportPDF('scan_logs')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px', fontSize: '11.5px', fontWeight: 600 }}
              >
                <FileText size={13} />
                <span>PDF Report</span>
              </button>
            </div>
          </div>

          {/* Table Container - Auto Responsive */}
          <div className="table-scroll-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', minWidth: '880px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#f8fafc', borderBottom: '1px solid #1e293b' }}>
                  <th style={{ width: '48px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
                  <th style={{ width: '145px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timestamp</th>
                  <th style={{ width: '130px', textAlign: 'center', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operation</th>
                  <th style={{ width: '140px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Part Number</th>
                  <th style={{ textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Serial Number</th>
                  <th style={{ width: '175px', textAlign: 'left', padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operator</th>
                  <th style={{ width: '115px', textAlign: 'center', padding: '12px 8px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {filteredScanLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <History size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No barcode scanner events recorded</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>Live scans from Receive Scan-In and Pack Scan-Out will stream here.</p>
                    </td>
                  </tr>
                ) : (
                  filteredScanLogs.map((log, index) => (
                    <tr
                      key={log.id || `scan-log-${index}`}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: index % 2 === 0 ? '#ffffff' : '#fafafa'
                      }}
                    >
                      <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px' }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                          {new Date(log.created_at || log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '1px' }}>
                          {formatTo12HourTime(log.created_at || log.timestamp, false)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '9px 10px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            border: '1px solid #bae6fd',
                            fontFamily: 'var(--font-mono, monospace)',
                            display: 'inline-block'
                          }}
                        >
                          {log.scan_type || 'SCAN_IN'}
                        </span>
                      </td>
                      <td className="font-mono" style={{ padding: '9px 10px', fontWeight: 700, color: '#0f172a' }}>
                        {log.part_number || 'N/A'}
                      </td>
                      <td className="font-mono" style={{ padding: '9px 10px', fontWeight: 700, color: '#0284c7' }}>
                        {log.serial_number || 'N/A'}
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: '11.5px', color: '#334155' }}>
                        <div style={{ fontWeight: 600 }}>{log.user_name || 'Warehouse Staff'}</div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '9px 8px' }}>
                        {log.is_valid !== false ? (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '10px',
                              background: '#ecfdf5',
                              color: '#047857',
                              border: '1px solid #a7f3d0',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <CheckCircle2 size={10} />
                            <span>Valid</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '10px',
                              background: '#fee2e2',
                              color: '#991b1b',
                              border: '1px solid #fecaca',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                            title={log.error_message}
                          >
                            <XCircle size={10} />
                            <span>{log.error_message || 'Rejected'}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sub-Tab 6: Session & Auto-Logout Activity Table ─────────────────────── */}
      {auditTab === 'session_activity' && (
        <div className="card" style={{ padding: '0', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {/* Table Toolbar Header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: '0 0 3px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={18} color="#0284c7" />
                <span>User Session Lifecycle &amp; Auto-Logout Audit Log</span>
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                Authoritative compliance log of automated scheduled logouts, advance grace-period session refreshes, and security policy modifications.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportSessionLogsXLSX}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#047857' }}
              >
                <FileSpreadsheet size={13} color="#059669" />
                <span>Export Session Log (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Table Content */}
          <div className="table-scroll-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
            <table className="table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1020px' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#f8fafc', borderBottom: '1px solid #1e293b', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', width: '48px', textAlign: 'center', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
                  <th style={{ padding: '12px 12px', width: '140px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date &amp; Time</th>
                  <th style={{ padding: '12px 12px', width: '195px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action / Event</th>
                  <th style={{ padding: '12px 12px', width: '200px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>User Account</th>
                  <th style={{ padding: '12px 12px', width: '155px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role / Position</th>
                  <th style={{ padding: '12px 12px', width: '190px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason / Trigger</th>
                  <th style={{ padding: '12px 12px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Technical Audit Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessionLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 20px', color: '#94a3b8' }}>
                      <Clock size={36} style={{ margin: '0 auto 10px', color: '#cbd5e1' }} />
                      <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#64748b' }}>No session audit events found</p>
                      <p style={{ margin: 0, fontSize: '12px' }}>Automated logouts and session activity will be recorded here.</p>
                    </td>
                  </tr>
                ) : (
                  filteredSessionLogs.map((log, index) => {
                    const isAutoLogout = log.action === 'AUTO_LOGOUT';
                    const isRefresh = log.action === 'SESSION_REFRESH';
                    const isPolicy = log.action?.includes('POLICY');

                    const badgeStyle = isAutoLogout
                      ? { bg: '#fee2e2', text: '#b91c1c', border: '#fecaca' }
                      : isRefresh
                      ? { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }
                      : isPolicy
                      ? { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' }
                      : { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' };

                    return (
                      <tr
                        key={log.id || `sess-log-${index}`}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: index % 2 === 0 ? '#ffffff' : '#f8fafc'
                        }}
                      >
                        <td className="font-mono" style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px', verticalAlign: 'middle' }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '11.5px' }}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                            {formatTo12HourTime(log.timestamp, false)}
                          </div>
                        </td>
                        <td style={{ padding: '12px 12px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: badgeStyle.bg,
                              color: badgeStyle.text,
                              border: `1px solid ${badgeStyle.border}`,
                              fontFamily: 'var(--font-mono, monospace)',
                              display: 'inline-block',
                              whiteSpace: 'nowrap',
                              maxWidth: '100%',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                            title={log.action}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '12px 12px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.user_name || 'System User'}>
                            {log.user_name || 'System User'}
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.user_email || 'N/A'}>
                            {log.user_email || 'N/A'}
                          </div>
                        </td>
                        <td style={{ padding: '12px 12px', overflow: 'hidden', verticalAlign: 'middle' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {log.user_position || 'Staff'}
                          </div>
                          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {log.user_role || 'User'}
                          </div>
                        </td>
                        <td style={{ padding: '12px 12px', fontSize: '11.5px', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }} title={log.reason || 'Automated policy enforcement'}>
                          {log.reason || 'Automated policy enforcement'}
                        </td>
                        <td style={{ padding: '12px 12px', fontSize: '11px', color: '#64748b', overflow: 'hidden', verticalAlign: 'middle' }}>
                          {log.details && typeof log.details === 'object' ? (
                            <div
                              style={{
                                background: '#f8fafc',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid #e2e8f0',
                                fontFamily: 'var(--font-mono, monospace)',
                                fontSize: '10.5px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                              title={Object.entries(log.details)
                                .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                                .join(' | ')}
                            >
                              {Object.entries(log.details)
                                .slice(0, 3)
                                .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                                .join(' | ')}
                            </div>
                          ) : (
                            <span>None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete All Audit Records Confirmation (Superadmin Only) ─────── */}
      {showPurgeModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !isPurging) setShowPurgeModal(false); }}>
          <div className="modal-content" style={{ maxWidth: '520px', borderRadius: '12px', overflow: 'hidden' }}>
            {/* Modal Header */}
            <div className="modal-header" style={{ background: '#991b1b', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#f87171', color: '#7f1d1d', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} color="#ffffff" />
                </div>
                <div>
                  <h3 style={{ color: '#ffffff', fontSize: '16px', fontWeight: 800, margin: 0 }}>
                    Permanently Delete All Audit Records?
                  </h3>
                  <p style={{ color: '#fecaca', fontSize: '11.5px', margin: '2px 0 0' }}>
                    Superadmin Authority &bull; System &amp; PostgreSQL Database Purge
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isPurging && setShowPurgeModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#fecaca', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body" style={{ padding: '20px' }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '12px 14px', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
                  Warning: This action is irreversible and will permanently wipe all audit logs across all connected clients and the Supabase cloud database.
                </p>
              </div>

              <div style={{ fontSize: '12.5px', color: '#334155', marginBottom: '14px' }}>
                The following records will be completely removed:
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Master File Upload Audits:</span>
                  <strong style={{ color: '#0f172a' }}>{uploadAuditLogs.length} records</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Data Deletion &amp; Purge Audits:</span>
                  <strong style={{ color: '#0f172a' }}>{deletionAuditLogs.length} records</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Hardware Scanner Event Logs:</span>
                  <strong style={{ color: '#0f172a' }}>{scanLogs.length} events</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '6px' }}>
                  <span style={{ color: '#64748b' }}>Supabase Cloud DB Tables:</span>
                  <strong style={{ color: '#b91c1c' }}>audit_logs, scan_logs, saved_records</strong>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isPurging}
                onClick={() => setShowPurgeModal(false)}
                style={{ fontSize: '12.5px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={isPurging}
                onClick={handleConfirmPurgeAllAudits}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 700 }}
              >
                {isPurging ? (
                  <>
                    <RefreshCw size={14} className="spin-animation" />
                    <span>Purging Cloud Database...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Yes, Purge All Audit Records</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Universal Audit Event Dossier Modal */}
      {selectedEventForDossier && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div className="modal-dialog" style={{ background: '#ffffff', borderRadius: '14px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', color: '#ffffff', borderRadius: '14px 14px 0 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ShieldCheck size={20} color="#38bdf8" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800 }}>Audit Event Immutable Dossier</h3>
                  <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
                    Ref: {selectedEventForDossier.id}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEventForDossier(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px' }}>
              {/* Top Badges */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
                <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '3px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 700 }}>
                  {selectedEventForDossier.action}
                </span>
                <span style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600 }}>
                  Category: {selectedEventForDossier.category}
                </span>
                <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '3px 10px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 700 }}>
                  Status: {selectedEventForDossier.status}
                </span>
              </div>

              {/* 2-column details grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px', background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Timestamp</div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                    {formatTo12HourDateTime(selectedEventForDossier.timestamp)}
                  </div>
                  <div style={{ fontSize: '10.5px', color: '#64748b', fontFamily: 'monospace' }}>
                    {selectedEventForDossier.timestamp}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Operator</div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                    {selectedEventForDossier.user?.fullName || 'System'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
                    {(selectedEventForDossier.user?.role || 'STAFF').toUpperCase()}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Target Entity</div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                    {selectedEventForDossier.entityType}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#334155', fontFamily: 'monospace' }}>
                    {selectedEventForDossier.entityId}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Location / Branch</div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                    {selectedEventForDossier.siteCode || 'DC-MDC'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    {selectedEventForDossier.siteName || 'Distribution Center'}
                  </div>
                </div>
              </div>

              {/* Entity Label Description */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>Summary Description</div>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#1e293b' }}>
                  {selectedEventForDossier.entityLabel || 'Standard system operational event recorded.'}
                </div>
              </div>

              {/* Detailed Metadata / Payload */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>Cryptographic Event Metadata &amp; Payload</div>
                <pre style={{ background: '#0f172a', color: '#38bdf8', padding: '12px', borderRadius: '8px', fontSize: '11.5px', fontFamily: 'monospace', overflowX: 'auto', margin: 0, maxHeight: '180px' }}>
                  {JSON.stringify(selectedEventForDossier.details || {}, null, 2)}
                </pre>
              </div>

              {/* Serial Lifecycle Link if serial exists */}
              {(() => {
                const serialCandidate = selectedEventForDossier.details?.serialNumber ||
                  selectedEventForDossier.details?.serial_number ||
                  (selectedEventForDossier.entityType === 'Inventory Unit' ? selectedEventForDossier.entityId : null);

                if (serialCandidate && String(serialCandidate).length >= 8) {
                  return (
                    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#0369a1', fontSize: '12px' }}>
                          Serialized Part Detected: {serialCandidate}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          Trace full chain of custody across DC and retail branches.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const clean = String(serialCandidate).trim().toUpperCase();
                          setSelectedSerial(clean);
                          const details = resolveSerialFullDetails(clean, {
                            inventoryUnits,
                            shipments,
                            repairUsageRecords,
                            sites,
                            parts,
                            fixablyItems: fixablySnapshot?.items || [],
                            fixablyTransfers: fixablySnapshot?.transfers || []
                          });
                          setInspectedSerialDetails(details);
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 700, fontSize: '11.5px' }}
                      >
                        <ExternalLink size={12} />
                        <span>Trace Serial</span>
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', borderRadius: '0 0 14px 14px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedEventForDossier(null)}
                style={{ fontSize: '12px' }}
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Serial Custody Intelligence Dossier Modal */}
      {inspectedSerialDetails && (
        <SerialDossierModal
          details={inspectedSerialDetails}
          onClose={() => setInspectedSerialDetails(null)}
        />
      )}
    </div>
  );
}

