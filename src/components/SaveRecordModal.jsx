import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  BookmarkPlus,
  Calendar,
  Layers,
  FileText,
  X,
  AlertCircle,
  TrendingUp,
  Split
} from 'lucide-react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function SaveRecordModal({
  isOpen,
  onClose,
  defaultType = 'both' // 'both' | 'forecast' | 'allocation'
}) {
  const {
    forecastItems,
    allocations,
    sites,
    savePeriodRecord,
    activePeriod
  } = useApp();

  const [recordType, setRecordType] = useState(defaultType);
  const [periodYear, setPeriodYear] = useState(activePeriod?.year || 2026);
  const [periodMonth, setPeriodMonth] = useState(activePeriod?.month || 9);
  const [periodWeek, setPeriodWeek] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [isLabelCustomized, setIsLabelCustomized] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-generate suggested period label when Year/Month/Week/Type changes if not manually typed
  useEffect(() => {
    if (!isOpen) return;

    if (!isLabelCustomized) {
      const monthName = MONTH_NAMES[periodMonth - 1] || 'September';
      let suggested = `${monthName} ${periodYear}`;
      
      if (periodWeek) {
        suggested += ` – Week ${periodWeek}`;
      } else {
        suggested += ` – Master`;
      }

      if (recordType === 'forecast') {
        suggested += ` (Forecast)`;
      } else if (recordType === 'allocation') {
        suggested += ` (Allocation)`;
      }

      setPeriodLabel(suggested);
    }
  }, [isOpen, periodYear, periodMonth, periodWeek, recordType, isLabelCustomized]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setRecordType(defaultType);
      setPeriodYear(activePeriod?.year || 2026);
      setPeriodMonth(activePeriod?.month || 9);
      setPeriodWeek('');
      setIsLabelCustomized(false);
      setNotes('');
      setErrorMsg('');
      setIsSubmitting(false);
    }
  }, [isOpen, defaultType, activePeriod]);

  if (!isOpen) return null;

  const totalForecastUnits = (forecastItems || []).reduce((sum, it) => sum + (it.final_forecast || it.computed_forecast || 0), 0);
  const totalAllocatedUnits = (allocations || []).reduce((sum, it) => sum + (it.total_allocated_qty || 0), 0);
  const activeSitesCount = (sites || []).filter(s => !s.is_dc).length;

  const isForecastEmpty = !forecastItems || forecastItems.length === 0;
  const isAllocationEmpty = !allocations || allocations.length === 0;

  let hasDataForSelectedType = true;
  if (recordType === 'forecast' && isForecastEmpty) hasDataForSelectedType = false;
  if (recordType === 'allocation' && isAllocationEmpty) hasDataForSelectedType = false;
  if (recordType === 'both' && isForecastEmpty && isAllocationEmpty) hasDataForSelectedType = false;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!periodLabel.trim()) {
      setErrorMsg('Please specify a period label / record name.');
      return;
    }

    if (!hasDataForSelectedType) {
      setErrorMsg('Cannot save: The selected data matrix currently has no items.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await savePeriodRecord({
        recordType,
        periodLabel: periodLabel.trim(),
        periodYear: parseInt(periodYear) || 2026,
        periodMonth: parseInt(periodMonth) || 8,
        periodWeek: periodWeek ? parseInt(periodWeek) : null,
        notes: notes.trim()
      });

      if (res && res.success) {
        onClose();
      } else {
        setErrorMsg(res?.error || 'Failed to save record.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="modal-content" style={{ maxWidth: '620px' }}>
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <BookmarkPlus size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#ffffff', fontWeight: 600 }}>
                Save as Period Record
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                Capture an immutable snapshot of current forecasting & allocation tables.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '6px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {errorMsg && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: '#fee2e2',
                  border: '1px solid #f87171',
                  color: '#991b1b',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12.5px',
                  marginBottom: '16px'
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Scope / Record Type Selector */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Layers size={13} />
                <span>Record Scope / Type</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setRecordType('both')}
                  className={`btn btn-sm ${recordType === 'both' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px' }}
                >
                  Both (Full Bundle)
                </button>
                <button
                  type="button"
                  onClick={() => setRecordType('forecast')}
                  className={`btn btn-sm ${recordType === 'forecast' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px' }}
                >
                  Forecasting Only
                </button>
                <button
                  type="button"
                  onClick={() => setRecordType('allocation')}
                  className={`btn btn-sm ${recordType === 'allocation' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ justifyContent: 'center', fontSize: '12px', padding: '8px 6px' }}
                >
                  Allocation Only
                </button>
              </div>
            </div>

            {/* Period Year, Month & Optional Week */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.3fr 1fr',
                gap: '12px',
                marginBottom: '16px'
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Year</label>
                <select
                  className="form-select"
                  value={periodYear}
                  onChange={(e) => setPeriodYear(parseInt(e.target.value))}
                >
                  <option value={2025}>2025</option>
                  <option value={2026}>2026</option>
                  <option value={2027}>2027</option>
                  <option value={2028}>2028</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Month</label>
                <select
                  className="form-select"
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(parseInt(e.target.value))}
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={idx + 1} value={idx + 1}>
                      {name} ({idx + 1})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Week (Optional)</label>
                <select
                  className="form-select"
                  value={periodWeek}
                  onChange={(e) => setPeriodWeek(e.target.value)}
                >
                  <option value="">Full Month</option>
                  <option value="1">Week 1</option>
                  <option value="2">Week 2</option>
                  <option value="3">Week 3</option>
                  <option value="4">Week 4</option>
                </select>
              </div>
            </div>

            {/* Period Label (Editable) */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calendar size={13} />
                  <span>Period Record Name / Label</span>
                </label>
                {isLabelCustomized && (
                  <button
                    type="button"
                    onClick={() => setIsLabelCustomized(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--primary)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    Reset to auto-name
                  </button>
                )}
              </div>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. August 2026 – Week 1"
                value={periodLabel}
                onChange={(e) => {
                  setPeriodLabel(e.target.value);
                  setIsLabelCustomized(true);
                }}
                required
              />
            </div>

            {/* Optional Notes */}
            <div className="form-group" style={{ marginBottom: '18px' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileText size={13} />
                <span>Notes & Remarks (Optional)</span>
              </label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="e.g. Approved monthly replenishment for 26 ASP branches; battery safety buffer set to 5%."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ resize: 'vertical', minHeight: '54px' }}
              />
            </div>

            {/* Live Data Snapshot Preview Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px'
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em', marginBottom: '8px' }}>
                Data To Be Saved in Snapshot:
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {/* Forecast Stats */}
                {(recordType === 'both' || recordType === 'forecast') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TrendingUp size={15} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11.5px', color: '#64748b' }}>Forecast Matrix</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                        {forecastItems?.length || 0} parts <span style={{ fontWeight: 500, fontSize: '11px', color: '#64748b' }}>({totalForecastUnits.toLocaleString()} units)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Allocation Stats */}
                {(recordType === 'both' || recordType === 'allocation') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#dcfce7', color: '#15803d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Split size={15} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11.5px', color: '#64748b' }}>Master Allocation</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                        {allocations?.length || 0} parts <span style={{ fontWeight: 500, fontSize: '11px', color: '#64748b' }}>({totalAllocatedUnits.toLocaleString()} units across {activeSitesCount} sites)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !hasDataForSelectedType}
            >
              <BookmarkPlus size={15} />
              <span>{isSubmitting ? 'Saving Snapshot...' : 'Save Period Record'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
