import { useState, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  X,
  RefreshCw,
  ShieldAlert,
  Wrench,
  Package,
  Loader2,
  Search,
  Files,
  Download,
  ChevronDown,
  ChevronRight,
  Layers,
  List,
  DollarSign,
  MapPin,
  FileCheck2,
  Info
} from 'lucide-react';
import {
  parseSpreadsheetFile,
  detectBatchDuplicateSpreadsheetImports,
  validateSpreadsheetImportDraft,
  inferCtItemKind,
  parseReportRefList,
  downloadCtImportTemplateXlsx,
  getSiteColorTheme
} from '../utils/ctSpreadsheetImporter.js';
import { exportCtConsolidatedAuditToExcel } from '../utils/ctExcelExporter.js';
import { normalizePartNumber, generateCtId } from '../utils/consumablesToolsEngine.js';

const ACCEPTED_EXT_REGEX = /\.(?:csv|xlsx|xls)$/i;

export default function CtSpreadsheetImportModal({
  isOpen,
  onClose,
  ctCatalog = [],
  ctToolAssets = [],
  ctPdfImports = [],
  sites = [],
  onCommitImport,
  onOpenSourceFile
}) {
  const fileInputRef = useRef(null);
  const addMoreInputRef = useRef(null);

  const [step, setStep] = useState('upload'); // 'upload' | 'parsing' | 'preview'
  const [dragOver, setDragOver] = useState(false);
  const [extractNotice, setExtractNotice] = useState(null);

  // Multi-file batch drafts
  const [drafts, setDrafts] = useState([]);
  const [activeDraftId, setActiveDraftId] = useState(null);

  // Preview filters, site chips, view mode, and bulk HAWB edit
  const [itemKindFilter, setItemKindFilter] = useState('all'); // 'all' | 'tool' | 'consumable' | 'review'
  const [siteChipFilter, setSiteChipFilter] = useState('ALL');
  const [itemSearch, setItemSearch] = useState('');
  const [viewMode, setViewMode] = useState('flat'); // 'flat' | 'grouped'
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [dismissedDupBanner, setDismissedDupBanner] = useState({});

  // Bulk assign Report Ref by HAWB #
  const [bulkHawbTarget, setBulkHawbTarget] = useState('');
  const [bulkHawbRefValue, setBulkHawbRefValue] = useState('');

  const [isCommitting, setIsCommitting] = useState(false);
  const [isExportingAudit, setIsExportingAudit] = useState(false);
  const [commitProgressText, setCommitProgressText] = useState('');

  const catalogByPn = useMemo(() => {
    const map = new Map();
    (ctCatalog || []).forEach(c => {
      const pn = normalizePartNumber(c.part_number);
      if (pn) map.set(pn, c);
    });
    return map;
  }, [ctCatalog]);

  const batchDuplicateMap = useMemo(() => {
    return detectBatchDuplicateSpreadsheetImports(drafts, ctPdfImports);
  }, [drafts, ctPdfImports]);

  const batchValidationMap = useMemo(() => {
    const map = {};
    for (const d of drafts) {
      if (d.extractError) {
        map[d.id] = {
          valid: false,
          documentErrors: [d.extractError],
          rowErrors: {},
          selectedCount: 0,
          toolCount: 0,
          consumableQty: 0
        };
        continue;
      }
      map[d.id] = validateSpreadsheetImportDraft({
        reportRef: d.reportRef,
        siteCode: d.siteCode,
        documentDate: d.documentDate,
        items: d.items,
        duplicateCheck: batchDuplicateMap[d.id],
        existingToolAssets: ctToolAssets,
        allowDuplicateOverride: false
      });
    }
    return map;
  }, [drafts, batchDuplicateMap, ctToolAssets]);

  const activeDraft = useMemo(() => {
    if (!drafts.length) return null;
    return drafts.find(d => d.id === activeDraftId) || drafts[0];
  }, [drafts, activeDraftId]);

  const activeDuplicateCheck = activeDraft
    ? batchDuplicateMap[activeDraft.id] || { isDuplicate: false }
    : { isDuplicate: false };

  const activeValidation = activeDraft
    ? batchValidationMap[activeDraft.id] || {
        valid: false,
        documentErrors: [],
        rowErrors: {},
        selectedCount: 0,
        toolCount: 0,
        consumableQty: 0
      }
    : { valid: false, documentErrors: [], rowErrors: {}, selectedCount: 0, toolCount: 0, consumableQty: 0 };

  const batchSummary = useMemo(() => {
    const readyDrafts = [];
    let duplicateCount = 0;
    let errorCount = 0;
    let totalTools = 0;
    let totalConsumables = 0;

    for (const d of drafts) {
      const dup = batchDuplicateMap[d.id];
      const val = batchValidationMap[d.id];
      if (dup?.isDuplicate) {
        duplicateCount += 1;
      } else if (val?.valid) {
        readyDrafts.push(d);
        totalTools += val.toolCount || 0;
        totalConsumables += val.consumableQty || 0;
      } else {
        errorCount += 1;
      }
    }

    return {
      readyDrafts,
      duplicateCount,
      errorCount,
      totalTools,
      totalConsumables
    };
  }, [drafts, batchDuplicateMap, batchValidationMap]);

  // Per-site summary chips for the active draft
  const activeSiteChips = useMemo(() => {
    if (!activeDraft?.items) return [];
    const map = new Map();
    for (const row of activeDraft.items) {
      const code = String(row.site_code || activeDraft.siteCode || 'UNMAPPED').trim() || 'UNMAPPED';
      if (!map.has(code)) {
        map.set(code, { code, count: 0, subtotal: 0, missingRefs: 0 });
      }
      const b = map.get(code);
      b.count += 1;
      b.subtotal += (Number(row.quantity) || 1) * (Number(row.unit_cost) || 0);
      if (row.missing_invoice_ref) b.missingRefs += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [activeDraft]);

  // Unique HAWBs available for Bulk Assign Report Ref
  const activeHawbOptions = useMemo(() => {
    if (!activeDraft?.items) return [];
    const map = new Map();
    for (const row of activeDraft.items) {
      const h = String(row.hawb_number || '').trim();
      if (!h) continue;
      if (!map.has(h)) {
        map.set(h, { hawb: h, site: row.site_code || 'UNMAPPED', count: 0, missingRefCount: 0 });
      }
      const b = map.get(h);
      b.count += 1;
      if (row.missing_invoice_ref) b.missingRefCount += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.missingRefCount - a.missingRefCount || a.hawb.localeCompare(b.hawb));
  }, [activeDraft]);

  // Filtered rows for active draft
  const filteredActiveItems = useMemo(() => {
    if (!activeDraft?.items) return [];
    const q = itemSearch.trim().toLowerCase();
    return activeDraft.items.filter(row => {
      const effSite = String(row.site_code || activeDraft.siteCode || 'UNMAPPED').trim() || 'UNMAPPED';
      if (siteChipFilter !== 'ALL' && effSite !== siteChipFilter) return false;
      if (itemKindFilter === 'tool' && row.item_kind !== 'tool') return false;
      if (itemKindFilter === 'consumable' && row.item_kind !== 'consumable') return false;
      if (
        itemKindFilter === 'review' &&
        !row.needs_review &&
        !row.missing_invoice_ref &&
        !row.price_mismatch &&
        !(activeValidation.rowErrors[row.id]?.length > 0)
      ) {
        return false;
      }
      if (q) {
        const hay = `${row.part_number || ''} ${row.description || ''} ${row.site_code || ''} ${row.hawb_number || ''} ${row.report_ref || ''} ${(row.serial_numbers || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeDraft, siteChipFilter, itemKindFilter, itemSearch, activeValidation.rowErrors]);

  // Live 4 KPI cards computed from currently visible selected rows
  const liveKpis = useMemo(() => {
    const selected = filteredActiveItems.filter(r => r.selected !== false);
    const sitesSet = new Set();
    const docsSet = new Set();
    let toolsQty = 0;
    let consQty = 0;
    let totalUsd = 0;

    for (const r of selected) {
      const sc = String(r.site_code || activeDraft?.siteCode || '').trim();
      if (sc) sitesSet.add(sc);
      if (r.report_ref) docsSet.add(r.report_ref);
      else if (r.hawb_number) docsSet.add(`HAWB-${r.hawb_number}`);
      const q = Number(r.quantity) || 1;
      const p = Number(r.unit_cost) || 0;
      if (r.item_kind === 'tool') toolsQty += q;
      else consQty += q;
      totalUsd += q * p;
    }

    return {
      sitesCount: sitesSet.size,
      toolsQty,
      consQty,
      totalUnits: toolsQty + consQty,
      uniqueDocsCount: docsSet.size,
      totalUsd: Math.round(totalUsd * 100) / 100
    };
  }, [filteredActiveItems, activeDraft?.siteCode]);

  // Grouped by Site & HAWB for Accordion View
  const groupedBySiteAndHawb = useMemo(() => {
    const map = new Map();
    for (const row of filteredActiveItems) {
      const sc = String(row.site_code || activeDraft?.siteCode || 'UNMAPPED').trim() || 'UNMAPPED';
      const hawb = row.hawb_number || row.report_ref || 'Direct / No HAWB';
      const key = `${sc}::${hawb}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          siteCode: sc,
          hawb,
          reportRef: row.report_ref || '',
          rows: [],
          toolsQty: 0,
          consQty: 0,
          subtotalUsd: 0,
          missingInvoiceRef: false
        });
      }
      const g = map.get(key);
      g.rows.push(row);
      const q = Number(row.quantity) || 1;
      const p = Number(row.unit_cost) || 0;
      if (row.item_kind === 'tool') g.toolsQty += q;
      else g.consQty += q;
      g.subtotalUsd += q * p;
      if (row.missing_invoice_ref) g.missingInvoiceRef = true;
      if (!g.reportRef && row.report_ref) g.reportRef = row.report_ref;
    }
    return Array.from(map.values()).sort((a, b) => a.siteCode.localeCompare(b.siteCode) || a.hawb.localeCompare(b.hawb));
  }, [filteredActiveItems, activeDraft?.siteCode]);

  const resetModal = () => {
    setStep('upload');
    setExtractNotice(null);
    setDrafts([]);
    setActiveDraftId(null);
    setItemKindFilter('all');
    setSiteChipFilter('ALL');
    setItemSearch('');
    setViewMode('flat');
    setCollapsedGroups({});
    setDismissedDupBanner({});
    setBulkHawbTarget('');
    setBulkHawbRefValue('');
    setIsCommitting(false);
    setCommitProgressText('');
  };

  const handleClose = () => {
    if (isCommitting) return;
    resetModal();
    onClose?.();
  };

  const processSpreadsheetFiles = async (fileList, { append = false } = {}) => {
    const rawFiles = Array.from(fileList || []);
    if (rawFiles.length === 0) return;

    const validFiles = rawFiles.filter(f => ACCEPTED_EXT_REGEX.test(f.name || ''));
    const skippedCount = rawFiles.length - validFiles.length;

    if (validFiles.length === 0) {
      setExtractNotice({
        type: 'error',
        message: 'Only CSV and Excel (.xlsx / .xls) files are accepted. Please extract PDF reports with Gemini into CSV or XLSX first.'
      });
      return;
    }

    setExtractNotice(
      skippedCount > 0
        ? {
            type: 'warning',
            message: `Skipped ${skippedCount} unsupported file(s). Only CSV / Excel (.xlsx, .xls) files are imported.`
          }
        : null
    );

    setStep('parsing');
    const newlyParsed = [];

    for (const file of validFiles) {
      try {
        const result = await parseSpreadsheetFile(file, {
          catalogItems: ctCatalog,
          sites
        });

        newlyParsed.push({
          id: generateCtId('ct-xls-draft'),
          file,
          fileHash: result.fileHash,
          filename: result.filename,
          fileSize: result.fileSize,
          pageCount: result.sheetCount,
          extractionMethod: result.extractionMethod,
          ocrConfidence: 100,
          pdfBytes: result.fileBytes,
          reportRef: result.parsed.reportRef || '',
          poNumber: result.parsed.poNumber || '',
          siteCode: result.parsed.detectedSiteCode || '',
          documentDate: result.parsed.documentDate || new Date().toISOString().slice(0, 10),
          supplier: result.parsed.supplier || 'Apple South Asia Pte Ltd',
          notes: '',
          duplicateRowsSkipped: result.parsed.duplicateRowsSkipped || 0,
          partialScanAlerts: result.parsed.partialScanAlerts || [],
          extractError: null,
          items:
            result.parsed.items.length > 0
              ? result.parsed.items
              : [
                  {
                    id: generateCtId('ct-xls-row'),
                    selected: true,
                    part_number: '',
                    description: '',
                    item_kind: 'tool',
                    quantity: 1,
                    unit_cost: 0,
                    site_code: '',
                    serial_numbers: [],
                    catalog_matched: false,
                    needs_review: true,
                    review_note: 'No rows detected in spreadsheet — add items manually below'
                  }
                ]
        });
      } catch (err) {
        console.error('[CT CSV/XLSX Import] Parse failed for', file.name, err);
        newlyParsed.push({
          id: generateCtId('ct-xls-draft'),
          file,
          fileHash: '',
          filename: file.name,
          fileSize: file.size || 0,
          pageCount: 0,
          extractionMethod: 'failed',
          ocrConfidence: 0,
          pdfBytes: null,
          reportRef: '',
          poNumber: '',
          siteCode: '',
          documentDate: new Date().toISOString().slice(0, 10),
          supplier: 'Apple South Asia Pte Ltd',
          notes: '',
          duplicateRowsSkipped: 0,
          partialScanAlerts: [],
          extractError: err?.message || 'Failed to read CSV/Excel file.',
          items: []
        });
      }
    }

    setDrafts(prev => {
      const merged = append ? [...prev, ...newlyParsed] : newlyParsed;
      if (merged.length > 0) {
        setActiveDraftId(append && activeDraftId ? activeDraftId : merged[0].id);
      }
      return merged;
    });
    setItemKindFilter('all');
    setSiteChipFilter('ALL');
    setItemSearch('');
    setStep('preview');
  };

  const updateActiveDraft = (updater) => {
    if (!activeDraft) return;
    const id = activeDraft.id;
    setDrafts(prev =>
      prev.map(d => (d.id === id ? (typeof updater === 'function' ? updater(d) : { ...d, ...updater }) : d))
    );
  };

  const handleRemoveDraft = (draftId) => {
    setDrafts(prev => {
      const next = prev.filter(d => d.id !== draftId);
      if (next.length === 0) {
        setStep('upload');
        setActiveDraftId(null);
      } else if (activeDraftId === draftId) {
        setActiveDraftId(next[0].id);
      }
      return next;
    });
  };

  const handleUpdateRow = (rowId, field, value) => {
    updateActiveDraft(draft => ({
      ...draft,
      items: (draft.items || []).map(row => {
        if (row.id !== rowId) return row;
        const updated = { ...row, [field]: value };
        if (field === 'quantity' || field === 'unit_cost') {
          const q = Number(updated.quantity) || 1;
          const p = Number(updated.unit_cost) || 0;
          updated.line_total_usd = Math.round(q * p * 100) / 100;
          updated.price_mismatch = false;
        }
        if (field === 'report_ref') {
          updated.missing_invoice_ref = !String(value || '').trim();
        }
        if (field === 'part_number') {
          const clean = normalizePartNumber(value);
          const match = catalogByPn.get(clean);
          if (match) {
            if (!updated.description) updated.description = match.description || '';
            if (!Number(updated.unit_cost)) {
              updated.unit_cost = Number(match.stocking_price ?? match.unit_cost ?? 0) || 0;
            }
            updated.catalog_matched = true;
            updated.review_note = updated.missing_invoice_ref ? 'Missing Invoice Ref (Packing List Only)' : null;
          } else {
            updated.catalog_matched = false;
            updated.review_note = 'New SKU — will be added to Parts Catalog on save';
            if (clean && updated.description && !updated.item_kind) {
              updated.item_kind = inferCtItemKind(clean, updated.description, '');
            }
          }
        }
        return updated;
      })
    }));
  };

  const handleBulkApplyRefToHawb = () => {
    const targetHawb = bulkHawbTarget.trim();
    const newRef = bulkHawbRefValue.trim().toUpperCase();
    if (!targetHawb || !newRef) return;
    updateActiveDraft(draft => {
      const nextItems = (draft.items || []).map(row => {
        if (String(row.hawb_number || '').trim() !== targetHawb) return row;
        return {
          ...row,
          report_ref: newRef,
          effective_ref: newRef,
          missing_invoice_ref: false,
          needs_review: !row.part_number || !row.description || !row.site_code || row.price_mismatch,
          review_note: !row.catalog_matched ? 'New SKU — will be added to Parts Catalog on save' : null
        };
      });
      const mergedRefs = parseReportRefList([draft.reportRef, newRef]).join(', ');
      return { ...draft, reportRef: mergedRefs, items: nextItems };
    });
    setBulkHawbRefValue('');
  };

  const handleAddRow = () => {
    updateActiveDraft(draft => ({
      ...draft,
      items: [
        ...(draft.items || []),
        {
          id: generateCtId('ct-xls-row'),
          selected: true,
          part_number: '',
          description: '',
          item_kind: 'tool',
          quantity: 1,
          unit_cost: 0,
          line_total_usd: 0,
          site_code: siteChipFilter !== 'ALL' ? siteChipFilter : (draft.siteCode || ''),
          serial_numbers: [],
          catalog_matched: false,
          needs_review: false,
          review_note: 'Manually added'
        }
      ]
    }));
  };

  const handleRemoveRow = (rowId) => {
    updateActiveDraft(draft => ({
      ...draft,
      items: (draft.items || []).filter(r => r.id !== rowId)
    }));
  };

  const handleExportAuditExcel = async () => {
    if (!activeDraft || isExportingAudit) return;
    setIsExportingAudit(true);
    try {
      await exportCtConsolidatedAuditToExcel({
        items: activeDraft.items || [],
        sites,
        generatedBy: 'DC Specialist'
      });
    } finally {
      setIsExportingAudit(false);
    }
  };

  const handleCommitBatch = async () => {
    const readyList = batchSummary.readyDrafts;
    if (readyList.length === 0 || isCommitting) return;
    setIsCommitting(true);

    let successCount = 0;
    const remainingDrafts = [];

    try {
      for (let i = 0; i < readyList.length; i++) {
        const d = readyList[i];
        setCommitProgressText(
          `Importing ${i + 1} of ${readyList.length}: ${d.reportRef || d.filename}...`
        );
        const res = await onCommitImport?.({
          file: d.file,
          pdfBytes: d.pdfBytes,
          fileHash: d.fileHash,
          filename: d.filename,
          fileSize: d.fileSize,
          pageCount: d.pageCount,
          extractionMethod: d.extractionMethod,
          ocrConfidence: 100,
          reportRef: d.reportRef.trim(),
          poNumber: d.poNumber.trim(),
          siteCode: d.siteCode,
          documentDate: d.documentDate,
          supplier: d.supplier.trim() || 'Apple South Asia Pte Ltd',
          notes: d.notes.trim(),
          items: d.items
        });
        if (res?.ok) {
          successCount += 1;
        } else {
          remainingDrafts.push(d);
        }
      }

      if (successCount === readyList.length && remainingDrafts.length === 0) {
        resetModal();
        onClose?.();
      } else {
        setDrafts(remainingDrafts);
        setActiveDraftId(remainingDrafts[0]?.id || null);
      }
    } finally {
      setIsCommitting(false);
      setCommitProgressText('');
    }
  };

  if (!isOpen) return null;

  const activeToolItemCount = (activeDraft?.items || []).filter(r => r.item_kind === 'tool').length;
  const activeConsumableItemCount = (activeDraft?.items || []).filter(r => r.item_kind === 'consumable').length;
  const activeReviewItemCount = (activeDraft?.items || []).filter(
    r => r.needs_review || r.missing_invoice_ref || r.price_mismatch || (activeValidation.rowErrors[r.id]?.length > 0)
  ).length;

  const renderItemRow = (row) => {
    const rowErrs = activeValidation.rowErrors[row.id] || [];
    const hasHardError = rowErrs.length > 0 || row.price_mismatch || !(row.site_code || activeDraft.siteCode);
    const hasAmberWarning = !hasHardError && row.missing_invoice_ref;
    const isToolRow = row.item_kind === 'tool' || /^077-/.test(String(row.part_number || '').toUpperCase());
    const serialStr = Array.isArray(row.serial_numbers)
      ? row.serial_numbers.join(', ')
      : String(row.serial_numbers || '');
    const effSite = row.site_code || activeDraft.siteCode || '';
    const siteTheme = getSiteColorTheme(effSite);

    return (
      <tr
        key={row.id}
        style={{
          borderBottom: '1px solid #e2e8f0',
          borderLeft: hasHardError
            ? '4px solid #dc2626'
            : hasAmberWarning
              ? '4px solid #f59e0b'
              : `4px solid ${siteTheme.border}`,
          background:
            row.selected === false
              ? '#f8fafc'
              : hasHardError
                ? '#fef2f2'
                : hasAmberWarning
                  ? '#fffbeb'
                  : '#ffffff',
          opacity: row.selected === false ? 0.55 : 1
        }}
      >
        <td style={{ padding: '7px 6px', verticalAlign: 'top', textAlign: 'center' }}>
          <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="checkbox"
              checked={row.selected !== false}
              onChange={(e) => handleUpdateRow(row.id, 'selected', e.target.checked)}
              style={{ width: '15px', height: '15px', cursor: 'pointer', margin: 0 }}
            />
          </div>
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <input
            type="text"
            list="ct-catalog-datalist"
            className="form-control"
            style={{ width: '100%', height: '32px', boxSizing: 'border-box', fontSize: '12px', padding: '0 7px', fontFamily: 'monospace', fontWeight: 700, margin: 0 }}
            value={row.part_number}
            onChange={(e) => handleUpdateRow(row.id, 'part_number', e.target.value)}
            placeholder="077-01158"
          />
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <input
            type="text"
            className="form-control"
            style={{ width: '100%', height: '32px', boxSizing: 'border-box', fontSize: '12px', padding: '0 7px', margin: 0 }}
            value={row.description}
            onChange={(e) => handleUpdateRow(row.id, 'description', e.target.value)}
            placeholder="Item description..."
          />
          {hasAmberWarning && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '3px', padding: '1px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontSize: '10px', fontWeight: 700 }}>
              <AlertTriangle size={10} /> Missing Invoice Ref (Packing List Only){row.hawb_number ? ` · HAWB ${row.hawb_number}` : ''}
            </div>
          )}
          {!hasAmberWarning && row.review_note && rowErrs.length === 0 && (
            <div style={{ fontSize: '10.5px', color: '#b45309', marginTop: '3px', lineHeight: 1.25 }}>
              {row.review_note}
            </div>
          )}
          {rowErrs.length > 0 && (
            <div style={{ fontSize: '10.5px', color: '#dc2626', marginTop: '3px', fontWeight: 700, lineHeight: 1.25 }}>
              {rowErrs.join(' · ')}
            </div>
          )}
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <select
            className="form-control"
            style={{
              width: '100%',
              height: '32px',
              boxSizing: 'border-box',
              fontSize: '11.5px',
              padding: '0 6px',
              fontWeight: 700,
              margin: 0,
              background: effSite ? siteTheme.bg : '#fef2f2',
              color: effSite ? siteTheme.text : '#991b1b',
              borderColor: effSite ? siteTheme.border : '#f87171'
            }}
            value={effSite}
            onChange={(e) => handleUpdateRow(row.id, 'site_code', e.target.value)}
            title={row.raw_site_label ? `From file: ${row.raw_site_label}` : 'Receiving site'}
          >
            <option value="">Site...</option>
            <option value="DC-MDC">DC-MDC</option>
            {(sites || [])
              .filter(s => String(s.site_code || s.code || '').toUpperCase() !== 'DC-MDC')
              .map(s => {
                const code = s.site_code || s.code;
                return (
                  <option key={code} value={code}>
                    {code}
                  </option>
                );
              })}
          </select>
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <select
            className="form-control"
            style={{ width: '100%', height: '32px', boxSizing: 'border-box', fontSize: '11.5px', padding: '0 6px', margin: 0 }}
            value={row.item_kind}
            onChange={(e) => handleUpdateRow(row.id, 'item_kind', e.target.value)}
          >
            <option value="tool">Tool (Asset)</option>
            <option value="consumable">Consumable</option>
          </select>
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <input
            type="number"
            min={1}
            className="form-control"
            style={{ width: '100%', height: '32px', boxSizing: 'border-box', fontSize: '12px', padding: '0 4px', textAlign: 'center', margin: 0 }}
            value={row.quantity}
            onChange={(e) => handleUpdateRow(row.id, 'quantity', Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <input
            type="number"
            min={0}
            step="0.01"
            className="form-control"
            style={{ width: '100%', height: '32px', boxSizing: 'border-box', fontSize: '12px', padding: '0 6px', textAlign: 'right', fontFamily: 'monospace', margin: 0 }}
            value={row.unit_cost ?? 0}
            onChange={(e) => handleUpdateRow(row.id, 'unit_cost', Math.max(0, parseFloat(e.target.value) || 0))}
            placeholder="0.00"
          />
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top' }}>
          <input
            type="text"
            className="form-control"
            style={{
              width: '100%',
              height: '32px',
              boxSizing: 'border-box',
              fontSize: '11.5px',
              padding: '0 7px',
              fontFamily: 'monospace',
              margin: 0,
              background: isToolRow && !serialStr ? '#eff6ff' : '#ffffff',
              borderColor: isToolRow && !serialStr ? '#60a5fa' : '#cbd5e1'
            }}
            value={serialStr}
            onChange={(e) =>
              handleUpdateRow(
                row.id,
                'serial_numbers',
                e.target.value
                  .split(/[,;\n]+/)
                  .map(s => s.trim().toUpperCase())
                  .filter(Boolean)
              )
            }
            placeholder={isToolRow ? 'Tool S/N (scan-in)' : 'Optional S/N'}
            title={isToolRow ? 'Tool asset — scan or enter serial number for asset tagging' : 'Optional serial number'}
          />
        </td>
        <td style={{ padding: '7px 5px', verticalAlign: 'top', textAlign: 'center' }}>
          <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {hasHardError ? (
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#dc2626' }}>Fix Error</span>
            ) : row.catalog_matched ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  background: '#dcfce7',
                  color: '#166534',
                  fontSize: '10px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}
              >
                <CheckCircle2 size={10} /> In Catalog
              </span>
            ) : (
              <span
                title="Will be automatically added to Parts Catalog with this USD price on confirm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  background: '#e0f2fe',
                  color: '#0369a1',
                  fontSize: '10px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap'
                }}
              >
                + Parts Catalog
              </span>
            )}
          </div>
        </td>
        <td style={{ padding: '7px 4px', verticalAlign: 'top', textAlign: 'center' }}>
          <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => handleRemoveRow(row.id)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', display: 'inline-flex', alignItems: 'center' }}
              title="Remove row"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '14px'
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '1320px',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          borderRadius: '14px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)'
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#0f172a',
            color: '#fff',
            padding: '13px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: 'rgba(16, 185, 129, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <FileSpreadsheet size={18} color="#34d399" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#fff' }}>
                Import Tools &amp; Consumables (CSV / Excel XLSX)
              </h3>
              <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                Structured CSV/XLSX source of truth · Auto-detects sites via Ship-To ID · Duplicate &amp; pricing guard · Review before saving
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isCommitting}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1 }}>
          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {extractNotice && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: extractNotice.type === 'error' ? '#fef2f2' : '#fffbeb',
                    border: `1px solid ${extractNotice.type === 'error' ? '#fecaca' : '#fde68a'}`,
                    color: extractNotice.type === 'error' ? '#991b1b' : '#92400e',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <AlertTriangle size={16} />
                  <span>{extractNotice.message}</span>
                </div>
              )}

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer?.files?.length) {
                    processSpreadsheetFiles(e.dataTransfer.files, { append: false });
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? '#059669' : '#cbd5e1'}`,
                  background: dragOver ? '#ecfdf5' : '#f8fafc',
                  borderRadius: '12px',
                  padding: '44px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <UploadCloud size={42} color="#059669" style={{ marginBottom: '10px' }} />
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                  Drop one or multiple CSV / Excel (.xlsx, .xls) files here, or click to browse
                </div>
                <div style={{ fontSize: '12.5px', color: '#64748b', maxWidth: '600px', margin: '0 auto' }}>
                  Upload structured <strong>CSV</strong> or <strong>Excel (XLSX)</strong> reports (e.g.{' '}
                  <code>MOBILECARE_CONSOLIDATED_IPHONE_DUO_IMPORT-v2.csv</code>). Automatically maps sites by Apple GSX Ship-To ID, filters duplicate deliveries, flags missing Invoice Refs, and lets you review every line before importing.
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      processSpreadsheetFiles(e.target.files, { append: false });
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0'
                }}
              >
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  <strong>18-Column MobileCare Format:</strong>{' '}
                  <code>Receiving Site</code>, <code>Site Code</code>, <code>Ship-To ID</code>,{' '}
                  <code>Report Ref / Doc #</code>, <code>HAWB #</code>, <code>Delivery #</code>,{' '}
                  <code>Part Number</code>, <code>Description</code>, <code>Type</code>, <code>Qty</code>,{' '}
                  <code>USD Price</code>, <code>Line Total USD</code>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={downloadCtImportTemplateXlsx}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}
                >
                  <Download size={14} />
                  <span>Download Template (.xlsx)</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PARSING */}
          {step === 'parsing' && (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <Loader2 size={38} color="#059669" style={{ animation: 'spin 1s linear infinite', marginBottom: '12px' }} />
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                Parsing CSV / Excel spreadsheet(s) &amp; mapping sites...
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW, AUDIT, FILTER & EDIT */}
          {step === 'preview' && activeDraft && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Multi-File Batch Queue Strip */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 800, color: '#334155' }}>
                    <Files size={14} color="#059669" />
                    Files ({drafts.length}):
                  </span>
                  {drafts.map(d => {
                    const isActive = d.id === activeDraft.id;
                    const dup = batchDuplicateMap[d.id];
                    const val = batchValidationMap[d.id];
                    const badge = dup?.isDuplicate
                      ? { bg: '#fee2e2', fg: '#991b1b', label: 'Duplicate' }
                      : d.extractError
                        ? { bg: '#fee2e2', fg: '#991b1b', label: 'Error' }
                        : val?.valid
                          ? { bg: '#dcfce7', fg: '#166534', label: `${val.selectedCount} rows` }
                          : { bg: '#fef3c7', fg: '#92400e', label: 'Needs Fix' };

                    return (
                      <div
                        key={d.id}
                        onClick={() => {
                          setActiveDraftId(d.id);
                          setItemKindFilter('all');
                          setSiteChipFilter('ALL');
                          setItemSearch('');
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '4px 8px 4px 10px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          background: isActive ? '#0f172a' : '#ffffff',
                          color: isActive ? '#ffffff' : '#0f172a',
                          border: isActive ? '1px solid #0f172a' : '1px solid #cbd5e1',
                          fontSize: '12px',
                          fontWeight: 700,
                          maxWidth: '300px'
                        }}
                      >
                        <FileSpreadsheet size={13} color={isActive ? '#34d399' : '#059669'} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.filename}
                        </span>
                        <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 800, background: badge.bg, color: badge.fg, whiteSpace: 'nowrap' }}>
                          {badge.label}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveDraft(d.id);
                          }}
                          style={{ background: 'none', border: 'none', color: isActive ? '#94a3b8' : '#64748b', cursor: 'pointer', padding: '0 2px', display: 'inline-flex' }}
                          title="Remove file"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => addMoreInputRef.current?.click()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Plus size={13} /> Add Files
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => resetModal()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <RefreshCw size={13} /> Clear
                  </button>
                  <input
                    ref={addMoreInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        processSpreadsheetFiles(e.target.files, { append: true });
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {/* 4 Live Summary KPI Header Cards */}
              {!activeDraft.extractError && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
                  <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MapPin size={12} color="#0284c7" /> Total Sites Detected
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                      {liveKpis.sitesCount}
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', marginLeft: '6px' }}>
                        {siteChipFilter === 'ALL' ? 'branch(es)' : `filtered: ${siteChipFilter}`}
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Package size={12} color="#1d4ed8" /> Total Units (Split)
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#1e3a8a', marginTop: '2px' }}>
                      {liveKpis.totalUnits}
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#2563eb', marginLeft: '8px' }}>
                        {liveKpis.toolsQty} Tools · {liveKpis.consQty} Cons.
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#f5f3ff', border: '1px solid #ddd6fe' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#5b21b6', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <FileCheck2 size={12} color="#7c3aed" /> Unique Doc Refs / HAWBs
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#4c1d95', marginTop: '2px' }}>
                      {liveKpis.uniqueDocsCount}
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#6d28d9', marginLeft: '6px' }}>
                        shipment(s)
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: '10px 14px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#065f46', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <DollarSign size={12} color="#059669" /> Total Customs Value (USD)
                    </div>
                    <div className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#064e3b', marginTop: '2px' }}>
                      ${liveKpis.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              )}

              {/* Dismissible Duplicate Shipment Skipped Banner */}
              {activeDraft.duplicateRowsSkipped > 0 && !dismissedDupBanner[activeDraft.id] && (
                <div
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    background: '#eff6ff',
                    border: '1px solid #93c5fd',
                    color: '#1e40af',
                    fontSize: '12.5px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                    <Info size={16} />
                    <span>
                      {activeDraft.duplicateRowsSkipped} duplicate shipment row(s) auto-skipped (matching HAWB/Ref + Delivery # + Part #) to prevent double-counting.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDismissedDupBanner(prev => ({ ...prev, [activeDraft.id]: true }))}
                    style={{ background: 'none', border: 'none', color: '#1e40af', cursor: 'pointer', padding: '2px' }}
                    title="Dismiss"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              {/* Missing Page Detector Banner (Partial Multi-Page Scans like Iloilo) */}
              {activeDraft.partialScanAlerts?.length > 0 && (
                <div
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    background: '#fffbeb',
                    border: '1px solid #fcd34d',
                    color: '#92400e',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={14} />
                    <span>Partial Scan Notice (Non-Blocking):</span>
                  </div>
                  <ul style={{ margin: '3px 0 0 18px', padding: 0 }}>
                    {activeDraft.partialScanAlerts.map((a, idx) => (
                      <li key={idx}>{a.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* File-Level Duplicate Alert */}
              {activeDuplicateCheck.isDuplicate && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    color: '#991b1b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
                    <ShieldAlert size={18} color="#dc2626" />
                    <span><strong>Duplicate File Blocked:</strong> {activeDuplicateCheck.message}</span>
                  </div>
                  {activeDuplicateCheck.existingImport && onOpenSourceFile && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenSourceFile(activeDuplicateCheck.existingImport)}
                    >
                      View Previous File
                    </button>
                  )}
                </div>
              )}

              {/* Horizontal Color-Coded Site Filter Bar */}
              {!activeDraft.extractError && activeSiteChips.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    overflowX: 'auto',
                    padding: '6px 2px'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSiteChipFilter('ALL')}
                    style={{
                      padding: '5px 11px',
                      borderRadius: '999px',
                      fontSize: '11.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      border: siteChipFilter === 'ALL' ? '2px solid #0f172a' : '1px solid #cbd5e1',
                      background: siteChipFilter === 'ALL' ? '#0f172a' : '#f8fafc',
                      color: siteChipFilter === 'ALL' ? '#ffffff' : '#334155'
                    }}
                  >
                    All Sites ({activeDraft.items.length})
                  </button>
                  {activeSiteChips.map(chip => {
                    const theme = getSiteColorTheme(chip.code);
                    const isSelected = siteChipFilter === chip.code;
                    return (
                      <button
                        key={chip.code}
                        type="button"
                        onClick={() => setSiteChipFilter(isSelected ? 'ALL' : chip.code)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: '999px',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          background: theme.bg,
                          color: theme.text,
                          border: isSelected ? `2px solid ${theme.text}` : `1px solid ${theme.border}`,
                          boxShadow: isSelected ? '0 0 0 2px rgba(15,23,42,0.12)' : 'none'
                        }}
                      >
                        <strong>{chip.code}</strong> · {chip.count} · ${chip.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {chip.missingRefs > 0 && (
                          <span style={{ marginLeft: '5px', padding: '0 4px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontSize: '10px' }}>
                            !Ref
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Bulk Assign Report Ref by HAWB # Toolbar */}
              {!activeDraft.extractError && activeHawbOptions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px'
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                    Bulk Assign Invoice Ref by HAWB #:
                  </span>
                  <select
                    className="form-control"
                    style={{ height: '30px', fontSize: '12px', width: '240px', margin: 0, padding: '0 8px' }}
                    value={bulkHawbTarget}
                    onChange={(e) => setBulkHawbTarget(e.target.value)}
                  >
                    <option value="">Select HAWB #...</option>
                    {activeHawbOptions.map(opt => (
                      <option key={opt.hawb} value={opt.hawb}>
                        {opt.hawb} — {opt.site} ({opt.count} rows{opt.missingRefCount > 0 ? ', Missing Ref' : ''})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="form-control font-mono"
                    style={{ height: '30px', fontSize: '12px', width: '165px', margin: 0, padding: '0 8px' }}
                    value={bulkHawbRefValue}
                    onChange={(e) => setBulkHawbRefValue(e.target.value)}
                    placeholder="e.g. SG02860999"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!bulkHawbTarget || !bulkHawbRefValue.trim()}
                    onClick={handleBulkApplyRefToHawb}
                    style={{ height: '30px' }}
                  >
                    Apply to HAWB
                  </button>
                </div>
              )}

              {/* Validation Errors Banner */}
              {!activeDraft.extractError && !activeValidation.valid && !activeDuplicateCheck.isDuplicate && (
                <div
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontSize: '12px'
                  }}
                >
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={14} />
                    <span>Please fix required fields before importing:</span>
                  </div>
                  <ul style={{ margin: '3px 0 0 18px', padding: 0 }}>
                    {activeValidation.documentErrors.map((err, i) => (
                      <li key={`doc-${i}`}>{err}</li>
                    ))}
                    {Object.entries(activeValidation.rowErrors).slice(0, 6).map(([rid, errs]) => {
                      const idx = activeDraft.items.findIndex(it => it.id === rid);
                      return (
                        <li key={rid}>
                          Row {idx + 1}: {errs.join(' ')}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Filter Bar + View Toggle (Flat vs Grouped by Site & HAWB) */}
              {!activeDraft.extractError && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px',
                      flexWrap: 'wrap',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'inline-flex', gap: '3px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
                        {[
                          { key: 'all', label: `All (${activeDraft.items.length})` },
                          { key: 'tool', label: `Tools (${activeToolItemCount})` },
                          { key: 'consumable', label: `Consumables (${activeConsumableItemCount})` },
                          { key: 'review', label: `Warnings / Review (${activeReviewItemCount})` }
                        ].map(tab => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setItemKindFilter(tab.key)}
                            style={{
                              border: 'none',
                              borderRadius: '6px',
                              padding: '4px 9px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: itemKindFilter === tab.key ? '#0f172a' : 'transparent',
                              color: itemKindFilter === tab.key ? '#ffffff' : '#475569'
                            }}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div style={{ display: 'inline-flex', gap: '3px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setViewMode('flat')}
                          style={{
                            border: 'none',
                            borderRadius: '6px',
                            padding: '4px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: viewMode === 'flat' ? '#0284c7' : 'transparent',
                            color: viewMode === 'flat' ? '#ffffff' : '#475569'
                          }}
                        >
                          <List size={12} /> Flat Table
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('grouped')}
                          style={{
                            border: 'none',
                            borderRadius: '6px',
                            padding: '4px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: viewMode === 'grouped' ? '#0284c7' : 'transparent',
                            color: viewMode === 'grouped' ? '#ffffff' : '#475569'
                          }}
                        >
                          <Layers size={12} /> Grouped by Site &amp; HAWB
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Search size={13} color="#64748b" style={{ position: 'absolute', left: '8px', pointerEvents: 'none' }} />
                        <input
                          type="text"
                          className="form-control"
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          placeholder="Search PN, desc, HAWB..."
                          style={{ height: '30px', fontSize: '12px', paddingLeft: '26px', width: '185px', margin: 0 }}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleAddRow}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', height: '30px' }}
                      >
                        <Plus size={13} /> Add Row
                      </button>
                    </div>
                  </div>

                  {/* FLAT TABLE VIEW */}
                  {viewMode === 'flat' && (
                    <div style={{ overflowX: 'auto', maxHeight: '360px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '10px', background: '#fff' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left', color: '#334155', position: 'sticky', top: 0, zIndex: 2 }}>
                            <th style={{ padding: '9px 6px', width: '36px', textAlign: 'center', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Use</th>
                            <th style={{ padding: '9px 5px', width: '112px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Part # *</th>
                            <th style={{ padding: '9px 5px', width: 'auto', minWidth: '200px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Description *</th>
                            <th style={{ padding: '9px 5px', width: '114px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Site *</th>
                            <th style={{ padding: '9px 5px', width: '118px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Type *</th>
                            <th style={{ padding: '9px 5px', width: '58px', textAlign: 'center', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Qty *</th>
                            <th style={{ padding: '9px 5px', width: '84px', textAlign: 'right', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>USD</th>
                            <th style={{ padding: '9px 5px', width: '128px', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Serial #(s)</th>
                            <th style={{ padding: '9px 5px', width: '98px', textAlign: 'center', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>Catalog</th>
                            <th style={{ padding: '9px 4px', width: '32px' }}></th>
                          </tr>
                        </thead>
                        <tbody>{filteredActiveItems.map(renderItemRow)}</tbody>
                      </table>
                    </div>
                  )}

                  {/* GROUPED BY SITE & HAWB ACCORDION VIEW */}
                  {viewMode === 'grouped' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto', paddingRight: '2px' }}>
                      {groupedBySiteAndHawb.map(group => {
                        const isCollapsed = Boolean(collapsedGroups[group.key]);
                        const theme = getSiteColorTheme(group.siteCode);
                        return (
                          <div
                            key={group.key}
                            style={{
                              border: `1px solid ${theme.border}`,
                              borderRadius: '10px',
                              overflow: 'hidden',
                              background: '#fff'
                            }}
                          >
                            <div
                              onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                              style={{
                                background: theme.bg,
                                color: theme.text,
                                padding: '9px 14px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                cursor: 'pointer',
                                flexWrap: 'wrap',
                                gap: '8px'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, fontSize: '12.5px' }}>
                                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                                <span>{group.siteCode}</span>
                                <span className="font-mono" style={{ fontWeight: 700, opacity: 0.85 }}>
                                  · HAWB: {group.hawb}
                                </span>
                                {group.reportRef ? (
                                  <span className="font-mono" style={{ padding: '1px 7px', borderRadius: '999px', background: '#ffffff', fontSize: '10.5px', border: `1px solid ${theme.border}` }}>
                                    Ref: {group.reportRef}
                                  </span>
                                ) : (
                                  <span style={{ padding: '1px 7px', borderRadius: '999px', background: '#fef3c7', color: '#92400e', fontSize: '10.5px', fontWeight: 700 }}>
                                    Missing Invoice Ref
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', fontWeight: 700 }}>
                                <span>{group.rows.length} line(s) ({group.toolsQty} Tools · {group.consQty} Cons.)</span>
                                <span className="font-mono">
                                  ${group.subtotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                            {!isCollapsed && (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12px' }}>
                                  <tbody>{group.rows.map(renderItemRow)}</tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {step === 'preview' && (
              <>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  Ready: {batchSummary.readyDrafts.length}/{drafts.length} File(s)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Wrench size={13} color="#1d4ed8" /> {batchSummary.totalTools} Tool(s)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Package size={13} color="#047857" /> {batchSummary.totalConsumables} Consumable(s)
                </span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {step === 'preview' && activeDraft && !activeDraft.extractError && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isExportingAudit || isCommitting}
                onClick={handleExportAuditExcel}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <FileSpreadsheet size={15} color="#059669" />
                <span>{isExportingAudit ? 'Exporting...' : 'Export Audit Excel (.xlsx)'}</span>
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={isCommitting}>
              Cancel
            </button>
            {step === 'preview' && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={batchSummary.readyDrafts.length === 0 || isCommitting}
                onClick={handleCommitBatch}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {isCommitting ? (
                  <>
                    <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>{commitProgressText || 'Importing...'}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} />
                    <span>
                      {batchSummary.readyDrafts.length > 1
                        ? `Confirm & Import ${batchSummary.readyDrafts.length} Ready Files`
                        : `Confirm & Import (${batchSummary.totalTools + batchSummary.totalConsumables} Units)`}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
