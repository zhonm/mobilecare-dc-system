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
  ShieldCheck
} from 'lucide-react';
import { DC_MONITORING_SLOTS } from '../../utils/dcStockMonitoringEngine';

export default function IngestionCenterPanel({
  datasets = {},
  validationLogs = {},
  onUploadSlotFile,
  onUploadCompleteWorkbook,
  onUploadOrderReport,
  onPullFromAllStocks,
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
  const totalLoadedRows = DC_MONITORING_SLOTS.reduce(
    (sum, s) => sum + (Array.isArray(datasets[s.id]) ? datasets[s.id].length : 0),
    0
  );
  const logList = Object.values(validationLogs || {}).sort(
    (a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')
  );

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
            </div>
            <h3 style={{ color: dragTarget === 'workbook' ? '#0f172a' : '#fff', fontSize: '18px', marginBottom: '6px' }}>
              Drop Daily CSV / XLSX Exports or 1-Click Complete `DC Stock Monitoring.xlsx` Workbook
            </h3>
            <p style={{ fontSize: '13px', color: dragTarget === 'workbook' ? '#334155' : '#cbd5e1', lineHeight: 1.5 }}>
              Upload individual Fixably CSV/XLSX reports into their dedicated slots below, pull cached Fixably files directly from{' '}
              <strong>All Stocks &amp; Inventory</strong>, or drop an entire <code>DC Stock Monitoring.xlsx</code> workbook here to automatically split and validate all 6 source sheets.
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
              title="Pull Site Stock, KGB Used, and Stock Transfer already uploaded in All Stocks & Inventory"
            >
              <RefreshCw size={15} />
              Sync Fixably Slots from All Stocks
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

      {/* 6-Slot Modular Upload Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '14px'
      }}>
        {DC_MONITORING_SLOTS.map((slot) => {
          const rows = datasets[slot.id] || [];
          const log = validationLogs[slot.id];
          const isLoaded = rows.length > 0;
          const isError = log?.status === 'error';
          const isWarn = log?.status === 'warning';
          const isDragging = dragTarget === slot.id;

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
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                      {slot.label}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid var(--border-light)' }}>
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
        })}
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
                  <th style={{ padding: '8px 10px' }}>File / Sheet</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                  <th style={{ padding: '8px 10px' }}>Parsed Rows</th>
                  <th style={{ padding: '8px 10px' }}>Skipped</th>
                  <th style={{ padding: '8px 10px' }}>Diagnostics</th>
                </tr>
              </thead>
              <tbody>
                {logList.map((entry, idx) => (
                  <tr key={`${entry.slot}-${idx}`} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{entry.slot}</td>
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
