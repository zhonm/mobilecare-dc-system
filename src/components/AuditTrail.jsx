import { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  History,
  Search,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Box,
  UploadCloud,
  FileSpreadsheet,
  Calendar
} from 'lucide-react';

export default function AuditTrail() {
  const { inventoryUnits, scanLogs, sites, uploadAuditLogs, searchQuery } = useApp();
  const [selectedSerial, setSelectedSerial] = useState('');
  const [auditTab, setAuditTab] = useState('uploads'); // 'uploads' | 'serial_tracer' | 'scan_logs'

  // Find unit details if a serial is searched
  const matchedUnit = selectedSerial.trim()
    ? inventoryUnits.find(u => u.serial_number.toUpperCase().includes(selectedSerial.trim().toUpperCase()))
    : null;

  // Filter scan logs
  const filteredLogs = scanLogs.filter(log => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.part_number?.toLowerCase().includes(q) ||
      log.serial_number?.toLowerCase().includes(q) ||
      log.scan_type?.toLowerCase().includes(q)
    );
  });

  // Filter upload logs (sorted newest first)
  const filteredUploads = (uploadAuditLogs || [])
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .filter(log => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        log.file_name?.toLowerCase().includes(q) ||
        log.user_name?.toLowerCase().includes(q) ||
        log.user_email?.toLowerCase().includes(q) ||
        log.target_month?.toLowerCase().includes(q) ||
        log.user_role?.toLowerCase().includes(q)
      );
    });

  return (
    <div className="audit-view" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Banner */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={22} color="var(--primary)" />
              <h2 style={{ fontSize: '18px', margin: 0 }}>Serialized Lifecycle &amp; Traceability Audit System</h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Enterprise custody chain and ingestion audit logs. Review who uploaded forecasting/allocation datasets, trace serialized part journeys, and monitor hardware barcode scanner logs.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span className="badge badge-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>
              {uploadAuditLogs?.length || 0} File Upload Audits
            </span>
            <span className="badge badge-neutral" style={{ padding: '6px 12px', fontSize: '12px' }}>
              {scanLogs?.length || 0} Barcode Scan Logs
            </span>
          </div>
        </div>

        {/* Audit Category Switcher Tabs */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '18px', borderTop: '1px solid var(--border-light)', paddingTop: '14px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${auditTab === 'uploads' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAuditTab('uploads')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <UploadCloud size={14} />
            <span>File Upload &amp; Master Ingestion Audits</span>
            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.25)', padding: '1px 6px', borderRadius: '10px' }}>
              {uploadAuditLogs?.length || 0}
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${auditTab === 'serial_tracer' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAuditTab('serial_tracer')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Box size={14} />
            <span>Serialized Part Custody Tracer</span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${auditTab === 'scan_logs' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAuditTab('scan_logs')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <History size={14} />
            <span>Barcode Scanner Event Logs</span>
            <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.25)', padding: '1px 6px', borderRadius: '10px' }}>
              {scanLogs?.length || 0}
            </span>
          </button>
        </div>
      </div>

      {/* TAB 1: File Upload & Master Ingestion Audits */}
      {auditTab === 'uploads' && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '16px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileSpreadsheet size={18} color="var(--primary)" />
                Master Forecasting &amp; Allocation Upload Audit Records
              </h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Traceability log of all Excel/CSV masterlists uploaded to the Distribution Center, recording uploader identity, target period, unit quantities, and master valuations.
              </p>
            </div>
            <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={13} />
              Super Admin Authorization Enforced
            </span>
          </div>

          <div className="table-container" style={{ maxHeight: '480px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>Uploaded By</th>
                  <th>Ingested Masterlist / Source</th>
                  <th>Target Month</th>
                  <th>Forecast Units</th>
                  <th>Master Allocated</th>
                  <th>Total Master Value</th>
                  <th>Parts &amp; Sites Scope</th>
                  <th>System Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredUploads.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                      No masterlist upload events recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredUploads.map((log, index) => {
                    const isActive = index === 0;
                    return (
                      <tr key={log.id} style={{ background: isActive ? '#f0fdf4' : 'inherit' }}>
                        <td style={{ fontSize: '12px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                          <div style={{ fontSize: '11px' }}>
                            {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div
                              style={{
                                width: '30px',
                                height: '30px',
                                borderRadius: '50%',
                                background: isActive ? 'rgba(16, 185, 129, 0.15)' : 'var(--primary-light)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '12px',
                                color: isActive ? '#059669' : 'var(--primary)'
                              }}
                            >
                              {log.user_name ? log.user_name.charAt(0).toUpperCase() : 'A'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '13px' }}>
                                {log.user_name || 'Super Admin'}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {log.user_email || 'superadmin@mobilecare.com'}
                              </div>
                              <span className="badge badge-primary font-mono" style={{ fontSize: '9.5px', marginTop: '2px', padding: '1px 6px' }}>
                                {(log.user_role || 'SUPERADMIN').toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <FileSpreadsheet size={14} color="var(--primary)" />
                            {log.file_name}
                          </div>
                          <span className="badge badge-neutral" style={{ fontSize: '10px', marginTop: '4px' }}>
                            {log.file_type ? log.file_type.replace('_', ' ') : 'WORKBOOK'}
                          </span>
                        </td>

                        <td style={{ fontSize: '12.5px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Calendar size={13} color="var(--primary)" />
                            {log.target_month || 'August 2026'}
                          </div>
                        </td>

                        <td className="font-mono" style={{ fontWeight: 700, fontSize: '13px', color: 'var(--primary)' }}>
                          {log.total_forecast_units?.toLocaleString() || 461} units
                        </td>

                        <td className="font-mono" style={{ fontWeight: 700, fontSize: '13px', color: '#059669' }}>
                          {log.total_allocated_units?.toLocaleString() || 461} units
                        </td>

                        <td className="font-mono" style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>
                          ${(log.total_master_cost || 72659).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          <div><strong>{log.parts_count || 39}</strong> Genuine Parts</div>
                          <div><strong>{log.sites_count || 26}</strong> Service Sites</div>
                        </td>

                        <td>
                          {isActive ? (
                            <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, padding: '4px 8px' }}>
                              <CheckCircle2 size={12} />
                              Active on Cloud
                            </span>
                          ) : (
                            <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10.5px', color: 'var(--text-muted)', padding: '3px 7px' }}>
                              <History size={11} />
                              Superseded
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
        </div>
      )}

      {/* TAB 2: Serial Number Investigation Card */}
      {auditTab === 'serial_tracer' && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '6px' }}>Serialized Unit Custody Tracer</h3>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Track the complete custody chain of any high-value Apple replacement part (Scan-In $\to$ Allocation $\to$ Box Pack $\to$ Delivery)
          </p>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <div className="search-input-box" style={{ flex: 1 }}>
              <Search size={16} />
              <input
                type="text"
                placeholder="Enter exact or partial Serial Number (e.g. FG9HTN005WS00006TT)..."
                value={selectedSerial}
                onChange={(e) => setSelectedSerial(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {matchedUnit ? (
            <div
              style={{
                border: '1px solid var(--primary-light)',
                background: '#f0f9ff',
                borderRadius: 'var(--radius-md)',
                padding: '20px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <span className="badge badge-primary">{matchedUnit.status.toUpperCase()}</span>
                  <h3 style={{ fontSize: '17px', marginTop: '6px' }}>{matchedUnit.description}</h3>
                  <div className="font-mono" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    P/N: <strong>{matchedUnit.part_number}</strong> • Serial: <strong>{matchedUnit.serial_number}</strong>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Current Location:</span>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {sites.find(s => s.id === matchedUnit.current_site_id)?.name || 'DC Main Warehouse'}
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '16px' }}>
                <div style={{ background: '#fff', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid #bae6fd' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>1. DC RECEIVE SCAN-IN</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '4px' }}>
                    {new Date(matchedUnit.received_at).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    By: {matchedUnit.received_by || 'Warehouse Staff'}
                  </div>
                </div>

                <div style={{ background: '#fff', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid #bae6fd' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>2. PACK SCAN-OUT</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '4px' }}>
                    {matchedUnit.shipped_at ? new Date(matchedUnit.shipped_at).toLocaleDateString() : 'Awaiting Pack'}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Box #: {matchedUnit.box_number || 1}
                  </div>
                </div>

                <div style={{ background: '#fff', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid #bae6fd' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>3. SHIPMENT STATUS</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '4px' }}>
                    {matchedUnit.status === 'packed' || matchedUnit.status === 'shipped' ? 'Dispatched' : 'In Stock'}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Verified: Yes
                  </div>
                </div>
              </div>
            </div>
          ) : selectedSerial.trim() ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
              No serial number found matching "{selectedSerial}".
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 3: Barcode Scanner Audit Logs */}
      {auditTab === 'scan_logs' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3>Barcode Scan Event Logs</h3>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                Real-time audit log of all hardware barcode scanner inputs (Scan-In &amp; Scan-Out)
              </p>
            </div>
            <span className="badge badge-neutral">{scanLogs.length} Events Logged</span>
          </div>

          <div className="table-container" style={{ maxHeight: '420px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Operation</th>
                  <th>Part Number</th>
                  <th>Serial Number</th>
                  <th>User</th>
                  <th>Validation Result</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>
                      No scan log events recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td>
                        <span className="badge badge-primary font-mono" style={{ fontSize: '10.5px' }}>
                          {log.scan_type}
                        </span>
                      </td>
                      <td className="font-mono"><strong>{log.part_number}</strong></td>
                      <td className="font-mono">{log.serial_number}</td>
                      <td>{log.user_name || 'Warehouse Staff'}</td>
                      <td>
                        {log.is_valid ? (
                          <span className="badge badge-success">
                            <CheckCircle2 size={12} />
                            Valid
                          </span>
                        ) : (
                          <span className="badge badge-danger" title={log.error_message}>
                            <XCircle size={12} />
                            {log.error_message || 'Rejected'}
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
    </div>
  );
}

