import { useState, useRef } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Trash2,
  Sparkles,
  FileCheck2,
  Database,
  ShieldCheck,
  Link2,
  ArrowUpRight
} from 'lucide-react';
import { DC_MONITORING_SLOTS } from '../../utils/dcStockMonitoringEngine';
import { ALL_STOCKS_LINKED_SLOT_IDS, ALL_STOCKS_SLOT_MAPPINGS } from '../../services/dcMonitoringStorageService';

const LINKED_SLOT_SET = new Set(ALL_STOCKS_LINKED_SLOT_IDS);
const LINKED_SLOT_META_BY_ID = Object.fromEntries(
  ALL_STOCKS_SLOT_MAPPINGS.map(m => [m.slotId, m])
);

export default function IngestionCenterPanel({
  datasets = {},
  validationLogs = {},
  allStocksStatuses = {},
  onUploadSlotFile,
  onUploadCompleteWorkbook,
  onUploadOrderReport,
  onPullFromAllStocks,
  onOpenAllStocks,
  onClearAll,
  isProcessing = false
}) {
  const [dragTarget, setDragTarget] = useState(null);
  const workbookInputRef = useRef(null);
  const orderReportInputRef = useRef(null);
  const slotInputRefs = useRef({});

  const handleDrop = (e, slotId = 'workbook') => {
    e.preventDefault();
    setDragTarget(null);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.name && /order[-_]report/i.test(file.name) && onUploadOrderReport) {
      onUploadOrderReport(file);
    } else if (slotId === 'workbook') {
      onUploadCompleteWorkbook(file);
    } else {
      onUploadSlotFile(slotId, file);
    }
  };

  const loadedSlotCount = DC_MONITORING_SLOTS.filter(s => Array.isArray(datasets[s.id]) && datasets[s.id].length > 0).length;
  const linkedLoadedCount = DC_MONITORING_SLOTS.filter(
    s => LINKED_SLOT_SET.has(s.id) && Array.isArray(datasets[s.id]) && datasets[s.id].length > 0
  ).length;
  const dcManualSlots = DC_MONITORING_SLOTS.filter(s => !LINKED_SLOT_SET.has(s.id));
  const linkedAllStocksSlots = DC_MONITORING_SLOTS.filter(s => LINKED_SLOT_SET.has(s.id));
  const totalLoadedRows = DC_MONITORING_SLOTS.reduce(
    (sum, s) => sum + (Array.isArray(datasets[s.id]) ? datasets[s.id].length : 0),
    0
  );
  const logList = Object.values(validationLogs || {}).sort(
    (a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')
  );

  const renderManualSlotCard = (slot) => {
    const rows = datasets[slot.id] || [];
    const log = validationLogs[slot.id];
    const isLoaded = rows.length > 0;
    const isError = log?.status === 'error';
    const isWarn = log?.status === 'warning';
    const isDragging = dragTarget === slot.id;
    const isBaselineOptional = slot.id === 'sdr_baseline';

    return (
      <div
        key={slot.id}
        className="card"
        onDragOver={(e) => { e.preventDefault(); setDragTarget(slot.id); }}
        onDragLeave={() => setDragTarget(null)}
        onDrop={(e) => handleDrop(e, slot.id)}
        style={{
          padding: '16px',
          border: isDragging
            ? '2px dashed #2563eb'
            : isError
              ? '1px solid #fca5a5'
              : isLoaded
                ? '1px solid #86efac'
                : '1px solid var(--border-light)',
          background: isDragging ? '#eff6ff' : 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '12px'
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                  {slot.label}
                </span>
                <span
                  className="badge"
                  style={{
                    background: isBaselineOptional ? '#f8fafc' : '#eff6ff',
                    color: isBaselineOptional ? '#64748b' : '#1d4ed8',
                    borderColor: isBaselineOptional ? '#e2e8f0' : '#bfdbfe',
                    fontSize: '10.5px',
                    padding: '2px 6px'
                  }}
                >
                  {isBaselineOptional ? 'Optional / As Needed' : 'Daily Upload'}
                </span>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Expected: {slot.sampleTitle}
              </div>
            </div>
            {isError ? (
              <span className="badge badge-danger"><XCircle size={12} /> Error</span>
            ) : isWarn ? (
              <span className="badge badge-warning"><AlertTriangle size={12} /> Warning</span>
            ) : isLoaded ? (
              <span className="badge badge-success"><CheckCircle2 size={12} /> {rows.length.toLocaleString()} rows</span>
            ) : (
              <span className="badge badge-neutral">Empty</span>
            )}
          </div>

          {log && (
            <div style={{
              fontSize: '11.5px',
              background: isError ? '#fef2f2' : '#f8fafc',
              borderRadius: '6px',
              padding: '8px 10px',
              marginTop: '8px',
              border: '1px solid var(--border-light)',
              color: isError ? '#991b1b' : '#475569'
            }}>
              <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                {log.fileName}
              </div>
              {log.errors?.length > 0 && (
                <div style={{ color: '#dc2626', marginTop: '4px' }}>{log.errors.join(' ')}</div>
              )}
              {log.warnings?.length > 0 && (
                <div style={{ color: '#b45309', marginTop: '4px' }}>{log.warnings.join(' ')}</div>
              )}
              {log.timestamp && (
                <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '4px' }}>
                  Updated {new Date(log.timestamp).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border-light)' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            <Database size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            {slot.acceptedFormats}
          </span>
          <input
            ref={(el) => { slotInputRefs.current[slot.id] = el; }}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadSlotFile(slot.id, f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className={isLoaded ? 'btn btn-secondary' : 'btn btn-primary'}
            disabled={isProcessing}
            style={{ padding: '6px 12px', fontSize: '12px' }}
            onClick={() => slotInputRefs.current[slot.id]?.click()}
          >
            <UploadCloud size={14} />
            {isLoaded ? 'Replace File' : 'Upload File'}
          </button>
        </div>
      </div>
    );
  };

  const renderCompactLinkedItem = (slot) => {
    const rows = datasets[slot.id] || [];
    const log = validationLogs[slot.id];
    const isLoaded = rows.length > 0;
    const isError = log?.status === 'error';
    const isDragging = dragTarget === slot.id;
    const linkedMeta = LINKED_SLOT_META_BY_ID[slot.id];
    const allStocksStatus = allStocksStatuses[slot.id];

    return (
      <div
        key={slot.id}
        onDragOver={(e) => { e.preventDefault(); setDragTarget(slot.id); }}
        onDragLeave={() => setDragTarget(null)}
        onDrop={(e) => handleDrop(e, slot.id)}
        style={{
          padding: '8px 10px',
          borderRadius: '8px',
          border: isDragging
            ? '1.5px dashed #2563eb'
            : isError
              ? '1px solid #fca5a5'
              : isLoaded
                ? '1px solid #ccfbf1'
                : '1px dashed var(--border-light)',
          background: isDragging ? '#eff6ff' : isLoaded ? '#f8fafc' : '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          minWidth: 0
        }}
      >
        <input
          ref={(el) => { slotInputRefs.current[slot.id] = el; }}
          type="file"
          accept=".csv,.xlsx,.xls,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadSlotFile(slot.id, f);
            e.target.value = '';
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            {isError ? (
              <XCircle size={13} color="#dc2626" style={{ flexShrink: 0 }} />
            ) : isLoaded ? (
              <CheckCircle2 size={13} color="#0d9488" style={{ flexShrink: 0 }} />
            ) : (
              <Link2 size={13} color="#94a3b8" style={{ flexShrink: 0 }} />
            )}
            <span style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {slot.shortLabel}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: isLoaded ? '#0f766e' : '#94a3b8' }}>
              {isLoaded ? `${rows.length.toLocaleString()} rows` : 'Empty'}
            </span>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => slotInputRefs.current[slot.id]?.click()}
              title={`Manual override for ${slot.shortLabel} (${linkedMeta?.allStocksLabel || 'All Stocks'})`}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-light)',
                borderRadius: '5px',
                padding: '2px 5px',
                cursor: 'pointer',
                color: '#64748b',
                display: 'inline-flex',
                alignItems: 'center'
              }}
            >
              <UploadCloud size={11} />
            </button>
          </div>
        </div>

        <div
          style={{
            fontSize: '11px',
            color: allStocksStatus?.pendingUpload ? '#b45309' : '#64748b',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
          title={
            allStocksStatus?.pendingUpload
              ? `Staged in All Stocks (${allStocksStatus.fileName}) — click Upload & Process in All Stocks`
              : log?.fileName
                ? `${log.fileName}${log.timestamp ? ` • Updated ${new Date(log.timestamp).toLocaleString()}` : ''}`
                : 'Waiting for upload in All Stocks & Inventory'
          }
        >
          {allStocksStatus?.pendingUpload
            ? `Staged in All Stocks: ${allStocksStatus.fileName}`
            : log?.fileName
              ? `${log.fileName}${log.timestamp ? ` • ${new Date(log.timestamp).toLocaleDateString()}` : ''}`
              : 'Waiting for All Stocks upload'}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Action & Quick Import Workbook Banner */}
      <div
        className="card"
        onDragOver={(e) => { e.preventDefault(); setDragTarget('workbook'); }}
        onDragLeave={() => setDragTarget(null)}
        onDrop={(e) => handleDrop(e, 'workbook')}
        style={{
          background: dragTarget === 'workbook'
            ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)'
            : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: dragTarget === 'workbook' ? '#0f172a' : '#fff',
          border: dragTarget === 'workbook' ? '2px dashed #2563eb' : '1px solid #334155',
          padding: '22px 24px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ maxWidth: '680px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span className="badge" style={{ background: 'rgba(56, 189, 248, 0.18)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.35)' }}>
                <Sparkles size={12} /> Unified Multi-File Ingestion Center
              </span>
              <span className="badge" style={{ background: 'rgba(34, 197, 94, 0.18)', color: '#4ade80', borderColor: 'rgba(34, 197, 94, 0.35)' }}>
                {loadedSlotCount}/{DC_MONITORING_SLOTS.length} Datasets Active • {totalLoadedRows.toLocaleString()} Rows
              </span>
              <span className="badge" style={{ background: 'rgba(20, 184, 166, 0.18)', color: '#5eead4', borderColor: 'rgba(20, 184, 166, 0.35)' }}>
                <Link2 size={12} /> {linkedLoadedCount}/3 Connected to All Stocks
              </span>
            </div>
            <h3 style={{ color: dragTarget === 'workbook' ? '#0f172a' : '#fff', fontSize: '18px', marginBottom: '6px' }}>
              Daily DC Reports + Auto-Connected Fixably Datasets
            </h3>
            <p style={{ fontSize: '13px', color: dragTarget === 'workbook' ? '#334155' : '#cbd5e1', lineHeight: 1.5 }}>
              <strong>Site Stock</strong>, <strong>KGB Used</strong>, and <strong>Stock Transfer</strong> sync automatically from the Unified Fixably Multi-File Ingestion Center in{' '}
              <strong>All Stocks &amp; Inventory</strong>. Daily updates here only require uploading <strong>DC Masterlists</strong> and <strong>SDR Report</strong> (plus <strong>SDR Baseline</strong> if needed), or dropping a complete <code>DC Stock Monitoring.xlsx</code> workbook.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              ref={workbookInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadCompleteWorkbook(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={isProcessing}
              onClick={() => workbookInputRef.current?.click()}
            >
              <FileSpreadsheet size={16} />
              {isProcessing ? 'Processing...' : 'Import Complete Workbook (.xlsx)'}
            </button>

            <input
              ref={orderReportInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && onUploadOrderReport) onUploadOrderReport(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isProcessing}
              onClick={() => orderReportInputRef.current?.click()}
              title="Upload Lalamove Order Report (August to October) to update DC delivery shipment costs"
            >
              <ShieldCheck size={15} />
              Ingest Order Report (.xlsx)
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={isProcessing}
              onClick={onPullFromAllStocks}
              title="Force re-sync Site Stock, KGB Used, and Stock Transfer from All Stocks & Inventory"
            >
              <RefreshCw size={15} />
              Re-sync from All Stocks
            </button>

            {loadedSlotCount > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isProcessing}
                onClick={onClearAll}
                style={{ color: '#dc2626', borderColor: '#fecaca' }}
              >
                <Trash2 size={15} /> Clear Workspace
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section 1: DC-Specific Reports (Manual Daily Upload) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h4 style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-main)' }}>
              DC-Specific Reports (Upload Here)
            </h4>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Update DC Masterlists and SDR Report daily; update SDR Baseline (2025) only when needed.
            </div>
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '14px'
        }}>
          {dcManualSlots.map(renderManualSlotCard)}
        </div>
      </div>

      {/* Section 2: Compact Auto-Connected Fixably Strip */}
      <div
        className="card"
        style={{
          padding: '12px 14px',
          border: '1px solid #ccfbf1',
          background: 'linear-gradient(180deg, #f0fdfa 0%, #ffffff 38%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Link2 size={14} color="#0f766e" />
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
              Connected Fixably Datasets
            </span>
            <span className="badge" style={{ background: '#f0fdfa', color: '#0f766e', borderColor: '#99f6e4', fontSize: '10.5px', padding: '2px 7px' }}>
              {linkedLoadedCount}/3 Auto-Synced from All Stocks
            </span>
          </div>
          {onOpenAllStocks && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '11.5px' }}
              onClick={onOpenAllStocks}
            >
              Update in All Stocks
              <ArrowUpRight size={13} />
            </button>
          )}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '8px'
        }}>
          {linkedAllStocksSlots.map(renderCompactLinkedItem)}
        </div>
      </div>

      {/* Validation & Schema Verification Audit Log */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} color="#2563eb" />
            <h4 style={{ fontSize: '15px' }}>Ingestion Validation &amp; Schema Diagnostic Log</h4>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {logList.length} logged event(s)
          </span>
        </div>

        {logList.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            <FileCheck2 size={28} style={{ opacity: 0.45, marginBottom: '8px' }} />
            <div>No ingestion runs recorded yet. Upload any Fixably CSV/XLSX report or complete workbook above.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-light)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Dataset Slot</th>
                  <th style={{ padding: '8px 10px' }}>Source</th>
                  <th style={{ padding: '8px 10px' }}>File / Sheet</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                  <th style={{ padding: '8px 10px' }}>Parsed Rows</th>
                  <th style={{ padding: '8px 10px' }}>Skipped</th>
                  <th style={{ padding: '8px 10px' }}>Diagnostics</th>
                </tr>
              </thead>
              <tbody>
                {logList.map((entry, idx) => (
                  <tr key={`${entry.slot || entry.slotId}-${idx}`} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{entry.slot || entry.slotId}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {entry.source === 'All Stocks & Inventory' ? (
                        <span className="badge" style={{ background: '#f0fdfa', color: '#0f766e', borderColor: '#99f6e4' }}>
                          <Link2 size={10} /> All Stocks
                        </span>
                      ) : (
                        <span className="badge badge-neutral">{entry.source || 'Direct Upload'}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{entry.fileName}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span className={`badge badge-${entry.status === 'error' ? 'danger' : entry.status === 'warning' ? 'warning' : 'success'}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>{(entry.parsedCount || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>{(entry.skippedCount || 0).toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>
                      {entry.errors?.length ? entry.errors.join('; ') : entry.warnings?.length ? entry.warnings.join('; ') : 'All required headers & rows verified'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
