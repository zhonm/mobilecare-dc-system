import { useState } from 'react';
import { X, Wrench, Droplet, AlertTriangle, QrCode, History, Save } from 'lucide-react';
import { computeItemStockSummary, normalizePartNumber } from '../utils/consumablesToolsEngine';
import { formatTo12HourTime } from '../utils/dateUtils';

export default function ConsumableToolDetailModal({
  item,
  stockRows = [],
  toolAssets = [],
  movements = [],
  onClose,
  onSaveThresholds,
  onCheckoutTool,
  onCheckinTool,
  onUpdateToolStatus,
  onOpenLabels,
  canEdit = false
}) {
  const [minThreshold, setMinThreshold] = useState(String(item?.min_stock_threshold ?? 2));
  const [reorderQty, setReorderQty] = useState(String(item?.reorder_qty ?? 5));
  const [checkoutAssignee, setCheckoutAssignee] = useState('');

  if (!item) return null;

  const pn = normalizePartNumber(item.part_number);
  const summary = computeItemStockSummary(item, stockRows, toolAssets);

  const itemStockRows = stockRows.filter(
    s => (s.catalog_id && s.catalog_id === item.id) || normalizePartNumber(s.part_number) === pn
  );
  const itemAssets = toolAssets.filter(
    a => (a.catalog_id && a.catalog_id === item.id) || normalizePartNumber(a.part_number) === pn
  );
  const itemMovements = movements.filter(
    m => (m.catalog_id && m.catalog_id === item.id) || normalizePartNumber(m.part_number) === pn
  );

  const handleSaveSettings = (e) => {
    e.preventDefault();
    onSaveThresholds?.({
      ...item,
      min_stock_threshold: Math.max(0, parseInt(minThreshold, 10) || 0),
      reorder_qty: Math.max(1, parseInt(reorderQty, 10) || 1)
    });
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal-content" style={{ maxWidth: '880px', width: '96%' }}>
        <div className="modal-header" style={{ background: '#0f172a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: item.item_kind === 'tool' ? '#0284c7' : '#059669', padding: '8px', borderRadius: '8px', color: '#fff' }}>
              {item.item_kind === 'tool' ? <Wrench size={18} /> : <Droplet size={18} />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 className="font-mono" style={{ color: '#fff', fontSize: '16px', margin: 0 }}>{item.part_number}</h3>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: item.item_kind === 'tool' ? '#e0f2fe' : '#dcfce7', color: item.item_kind === 'tool' ? '#0369a1' : '#166534', textTransform: 'uppercase' }}>
                  {item.item_kind}
                </span>
                {item.is_serialized && (
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: '#fef3c7', color: '#92400e' }}>
                    Serialized
                  </span>
                )}
              </div>
              <p style={{ color: '#cbd5e1', fontSize: '12.5px', margin: '3px 0 0' }}>{item.description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '20px', maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Quick Specs & Alert Thresholds */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Available Stock</div>
              <div className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: summary.isLowStock ? '#dc2626' : '#059669' }}>
                {summary.qtyOnHand} {item.unit_of_measure || 'pcs'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Category</div>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>{item.category}</div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Pack / Unit Cost</div>
              <div className="font-mono" style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
                {item.pack_size || 1}x · ${Number(item.unit_cost || 0).toFixed(2)}
              </div>
            </div>
            <div style={{ background: summary.isLowStock ? '#fef2f2' : '#f0fdf4', border: `1px solid ${summary.isLowStock ? '#fecaca' : '#bbf7d0'}`, borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '11px', color: summary.isLowStock ? '#b91c1c' : '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Reorder Status</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: summary.isLowStock ? '#dc2626' : '#15803d', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                {summary.isLowStock && <AlertTriangle size={14} />}
                <span>{summary.isOutOfStock ? 'Out of Stock' : summary.isLowStock ? `Low (<= ${summary.threshold})` : 'Healthy'}</span>
              </div>
            </div>
          </div>

          {canEdit && (
            <form onSubmit={handleSaveSettings} style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '18px' }}>
              <div>
                <label className="form-label" style={{ fontSize: '11.5px', marginBottom: '4px' }}>Low-Stock Alert Threshold</label>
                <input type="number" min="0" className="form-control font-mono" value={minThreshold} onChange={(e) => setMinThreshold(e.target.value)} style={{ width: '130px', height: '34px' }} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: '11.5px', marginBottom: '4px' }}>Suggested Reorder Qty</label>
                <input type="number" min="1" className="form-control font-mono" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} style={{ width: '130px', height: '34px' }} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" style={{ height: '34px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Save size={14} />
                <span>Update Thresholds</span>
              </button>
            </form>
          )}

          {/* Stock By Site */}
          <h4 style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Site Stock Balances</h4>
          {itemStockRows.length === 0 ? (
            <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '16px' }}>No received stock batches yet across sites.</p>
          ) : (
            <div className="table-container" style={{ marginBottom: '18px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '12.5px' }}>
                <thead>
                  <tr>
                    <th>Site</th>
                    <th style={{ textAlign: 'center' }}>On Hand</th>
                    <th style={{ textAlign: 'center' }}>Consumed</th>
                    <th style={{ textAlign: 'center' }}>Shipped</th>
                    <th>Last Updated By</th>
                  </tr>
                </thead>
                <tbody>
                  {itemStockRows.map(s => (
                    <tr key={s.id || s.site_code}>
                      <td style={{ fontWeight: 700 }}>{s.site_code}</td>
                      <td className="font-mono" style={{ textAlign: 'center', fontWeight: 700 }}>{s.qty_on_hand}</td>
                      <td className="font-mono" style={{ textAlign: 'center' }}>{s.qty_consumed || 0}</td>
                      <td className="font-mono" style={{ textAlign: 'center' }}>{s.qty_shipped || 0}</td>
                      <td>{s.last_updated_by_name || 'System'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Individual Tool Assets (for Tools) */}
          {item.item_kind === 'tool' && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <h4 style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  Individually Tracked Tool Assets ({itemAssets.length})
                </h4>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Assignee / Tech name..."
                    value={checkoutAssignee}
                    onChange={(e) => setCheckoutAssignee(e.target.value)}
                    style={{ height: '30px', fontSize: '12px', width: '170px' }}
                  />
                  {itemAssets.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenLabels?.(itemAssets)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
                    >
                      <QrCode size={13} />
                      <span>Print All Labels</span>
                    </button>
                  )}
                </div>
              </div>
              {itemAssets.length === 0 ? (
                <p style={{ fontSize: '12.5px', color: '#64748b' }}>No individual tool units received yet.</p>
              ) : (
                <div className="table-container" style={{ border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th>Asset Tag</th>
                        <th>Serial Number</th>
                        <th>Site</th>
                        <th>Status</th>
                        <th>Assigned To</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemAssets.map(a => (
                        <tr key={a.id}>
                          <td className="font-mono" style={{ fontWeight: 700 }}>{a.asset_tag}</td>
                          <td className="font-mono">{a.serial_number || '—'}</td>
                          <td>{a.site_code}</td>
                          <td>
                            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: '6px', background: a.status === 'available' ? '#dcfce7' : a.status === 'in_use' ? '#dbeafe' : a.status === 'missing' ? '#fee2e2' : '#f1f5f9', color: a.status === 'available' ? '#166534' : a.status === 'in_use' ? '#1d4ed8' : a.status === 'missing' ? '#b91c1c' : '#475569' }}>
                              {a.status}
                            </span>
                          </td>
                          <td>{a.assigned_to || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                              {a.status === 'available' && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCheckoutTool?.({ assetId: a.id, assignedTo: checkoutAssignee.trim() || 'Branch Tech' })}>
                                  Check Out
                                </button>
                              )}
                              {(a.status === 'in_use' || a.status === 'missing') && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCheckinTool?.({ assetId: a.id })}>
                                  Check In
                                </button>
                              )}
                              {a.status !== 'missing' && a.status !== 'shipped' && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUpdateToolStatus?.({ assetId: a.id, newStatus: 'missing' })}>
                                  Missing
                                </button>
                              )}
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenLabels?.([a])} title="Print QR/Barcode Label">
                                <QrCode size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Item Lifecycle History */}
          <h4 style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <History size={15} />
            <span>Item Movement History ({itemMovements.length})</span>
          </h4>
          {itemMovements.length === 0 ? (
            <p style={{ fontSize: '12.5px', color: '#64748b' }}>No recorded movements for this item yet.</p>
          ) : (
            <div className="table-container" style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th style={{ textAlign: 'center' }}>Qty</th>
                    <th>Route</th>
                    <th>Ref #</th>
                    <th>User</th>
                  </tr>
                </thead>
                <tbody>
                  {itemMovements.slice(0, 40).map(m => (
                    <tr key={m.id}>
                      <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{formatTo12HourTime ? formatTo12HourTime(m.created_at) : m.created_at}</td>
                      <td style={{ fontWeight: 700, textTransform: 'uppercase' }}>{m.action}</td>
                      <td className="font-mono" style={{ textAlign: 'center' }}>{m.quantity}</td>
                      <td>{m.from_site_code || '—'} → {m.to_site_code || '—'}</td>
                      <td className="font-mono">{m.reference_number || '—'}</td>
                      <td>{m.performed_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
