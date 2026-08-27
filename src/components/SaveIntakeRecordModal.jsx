import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  BookmarkPlus,
  Package,
  Calendar,
  User,
  CheckCircle2,
  X,
  Tag
} from 'lucide-react';

export default function SaveIntakeRecordModal({
  isOpen,
  onClose,
  initialUnits = [],
  defaultPoId = '',
  onSaved = () => {}
}) {
  const {
    currentUser,
    purchaseOrders,
    parts,
    generateNextIntakeRecordId,
    saveIntakeRecord,
    showToast
  } = useApp();

  const [intakeDate, setIntakeDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [customRecordId, setCustomRecordId] = useState('');
  const [customRecordName, setCustomRecordName] = useState('');
  const [selectedPoId, setSelectedPoId] = useState(defaultPoId || '');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Auto-calculated default ID
  const autoId = useMemo(() => {
    const targetDate = intakeDate ? new Date(intakeDate) : new Date();
    return generateNextIntakeRecordId(targetDate);
  }, [intakeDate, generateNextIntakeRecordId]);

  const activeRecordId = customRecordId !== '' ? customRecordId : autoId;
  const activeRecordName = customRecordName !== '' ? customRecordName : activeRecordId;

  // Derive PO details
  const selectedPo = useMemo(() => {
    return purchaseOrders.find(p => p.id === selectedPoId) || null;
  }, [purchaseOrders, selectedPoId]);

  // Breakdown of units by category/part
  const summaryBreakdown = useMemo(() => {
    const counts = {};
    initialUnits.forEach(u => {
      const partObj = parts.find(p => p.part_number === u.part_number);
      const desc = u.description || partObj?.description || u.part_number;
      counts[desc] = (counts[desc] || 0) + 1;
    });
    return counts;
  }, [initialUnits, parts]);

  if (!isOpen) return null;

  const handleDateChange = (newDate) => {
    setIntakeDate(newDate);
    setCustomRecordId('');
    setCustomRecordName('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!activeRecordId.trim()) {
      showToast('Please provide a record name / ID', 'error');
      return;
    }
    if (!initialUnits || initialUnits.length === 0) {
      showToast('No scanned units to save in this dispatched record', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const res = await saveIntakeRecord({
        id: activeRecordId.trim().toUpperCase(),
        recordId: activeRecordId.trim().toUpperCase(),
        record_name: (activeRecordName || activeRecordId).trim(),
        recordName: (activeRecordName || activeRecordId).trim(),
        intake_date: intakeDate,
        intakeDate: intakeDate,
        po_id: selectedPoId || null,
        poId: selectedPoId || null,
        po_number: selectedPo?.po_number || null,
        poNumber: selectedPo?.po_number || null,
        supplier_name: selectedPo?.supplier || 'Direct Dispatch',
        supplier: selectedPo?.supplier || 'Direct Dispatch',
        notes: notes.trim(),
        items: initialUnits
      });

      if (res.success) {
        onSaved(res.record);
        onClose();
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving dispatched record: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '680px' }}>
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '8px', borderRadius: '8px' }}>
              <BookmarkPlus size={22} color="#38bdf8" />
            </div>
            <div>
              <h3 style={{ color: '#fff', fontSize: '18px', margin: 0 }}>Save Dispatched Batch Record (All Sites)</h3>
              <p style={{ color: '#94a3b8', fontSize: '12px', margin: '2px 0 0 0' }}>
                Create a permanent, multi-user accessible dispatched parts record based on purchase orders
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSave}>
          <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            {/* Record Name / ID Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', marginBottom: '16px' }}>
              <div>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Tag size={13} color="var(--primary)" />
                  <span>Standard Record ID / Batch #</span>
                </label>
                <input
                  type="text"
                  className="form-input font-mono"
                  style={{ fontWeight: 700, fontSize: '15px', color: 'var(--primary)' }}
                  value={activeRecordId}
                  onChange={(e) => {
                    setCustomRecordId(e.target.value);
                    setCustomRecordName(e.target.value);
                  }}
                  placeholder="e.g. MDC202600015"
                  required
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                  Standard structure: <code>MDC[YYYY][00000]</code> (auto-sequenced)
                </span>
              </div>

              <div>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calendar size={13} color="var(--primary)" />
                  <span>Date</span>
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={intakeDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* PO & Operator Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', marginBottom: '16px' }}>
              <div>
                <label className="form-label">Linked Purchase Order (Optional)</label>
                <select
                  className="form-select"
                  value={selectedPoId}
                  onChange={(e) => setSelectedPoId(e.target.value)}
                >
                  <option value="">-- Direct Dispatch (No PO) --</option>
                  {purchaseOrders.map(po => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} ({po.status}) - {po.supplier || 'Apple Direct'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <User size={13} color="var(--primary)" />
                  <span>Saved By / Operator</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={currentUser?.fullName || 'Warehouse Operations'}
                  disabled
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                />
              </div>
            </div>

            {/* Notes / Remarks */}
            <div style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ margin: 0 }}>Dispatched Notes / Batch Remarks</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setNotes(prev => prev ? `${prev} | MDC - Forecasting` : 'MDC - Forecasting')}
                    className="badge"
                    style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', cursor: 'pointer', padding: '2px 8px' }}
                  >
                    + Tag "MDC - Forecasting"
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotes(prev => prev ? `${prev} | DC - CRBR` : 'DC - CRBR')}
                    className="badge"
                    style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', cursor: 'pointer', padding: '2px 8px' }}
                  >
                    + Tag "DC - CRBR"
                  </button>
                </div>
              </div>
              <textarea
                className="form-input"
                rows={2}
                placeholder="e.g. MDC - Forecasting | Received via Lite Express KGB air freight. Verified complete with barcode scan."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ resize: 'vertical', minHeight: '56px', fontSize: '13px' }}
              />
            </div>

            {/* Scanned Batch Metric Card */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Package size={17} color="var(--primary)" />
                  <strong style={{ fontSize: '13.5px' }}>Scanned Units in Batch</strong>
                </div>
                <span className="badge badge-success" style={{ fontSize: '12px', padding: '4px 10px' }}>
                  {initialUnits.length} Total Units
                </span>
              </div>

              {/* Part Breakdown List */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {Object.entries(summaryBreakdown).map(([desc, count]) => (
                  <span
                    key={desc}
                    style={{
                      background: '#fff',
                      border: '1px solid #cbd5e1',
                      borderRadius: 'var(--radius-full)',
                      padding: '3px 10px',
                      fontSize: '11.5px',
                      color: 'var(--text-main)'
                    }}
                  >
                    <strong>{count}x</strong> {desc}
                  </span>
                ))}
              </div>

              {/* Serial numbers preview table */}
              <div className="table-container" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                <table className="data-table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 10px' }}>#</th>
                      <th style={{ padding: '6px 10px' }}>Part Number</th>
                      <th style={{ padding: '6px 10px' }}>Serial Number</th>
                      <th style={{ padding: '6px 10px' }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initialUnits.map((u, idx) => (
                      <tr key={u.id || `${u.serial_number}-${idx}`}>
                        <td className="font-mono" style={{ padding: '6px 10px' }}>{idx + 1}</td>
                        <td className="font-mono" style={{ padding: '6px 10px', fontWeight: 600 }}>{u.part_number}</td>
                        <td className="font-mono" style={{ padding: '6px 10px' }}>{u.serial_number}</td>
                        <td style={{ padding: '6px 10px' }}>{u.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving || initialUnits.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <CheckCircle2 size={16} />
              <span>{isSaving ? 'Saving Record...' : `Save Record (${activeRecordId})`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
