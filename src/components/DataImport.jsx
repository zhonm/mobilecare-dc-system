import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { parseUniversalExcel, downloadSampleGsxFixablyCsv } from '../utils/excelParser';
import ClearDataConfirmationModal from './ClearDataConfirmationModal';
import {
  UploadCloud,
  TrendingUp,
  Split,
  Boxes,
  FileText,
  Download,
  RotateCcw,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Smartphone,
  Calendar,
  ShieldAlert,
  Lock
} from 'lucide-react';

export default function DataImport() {
  const { applyParsedDataset, resetToDefaultData, clearAllData, sites, parts, currentUser, showToast, activePeriod, setActivePeriod, setActiveTab } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [lastFileObj, setLastFileObj] = useState(null);
  const [filterScope, setFilterScope] = useState(() => {
    try {
      return localStorage.getItem('mdc_filter_scope') || 'IPHONE_13_PLUS_BATTERY_DISPLAY';
    } catch {
      return 'IPHONE_13_PLUS_BATTERY_DISPLAY';
    }
  });

  const [allocationMode, setAllocationMode] = useState(() => {
    try {
      return localStorage.getItem('mdc_allocation_mode') || 'OPTION_A';
    } catch {
      return 'OPTION_A';
    }
  });

  const MONTH_FULL_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const [selectedMonth, setSelectedMonth] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_selected_ingestion_month');
      if (saved !== null && saved !== undefined && saved !== '') return saved;
      if (activePeriod?.month) return String(activePeriod.month - 1);
    } catch (e) {}
    return '8'; // Default to September
  });

  const [previewTab, setPreviewTab] = useState('forecast'); // 'forecast' | 'allocation' | 'raw'

  const isSuperAdmin = currentUser?.role === 'superadmin';

  // Sync selectedMonth when activePeriod changes from loading records or dataset
  useEffect(() => {
    if (activePeriod?.month) {
      const targetIdx = String(activePeriod.month - 1);
      setSelectedMonth(targetIdx);
      try {
        localStorage.setItem('mdc_selected_ingestion_month', targetIdx);
      } catch (e) {}
    }
  }, [activePeriod?.month]);

  const handleFileUpload = async (e) => {
    if (!isSuperAdmin) {
      showToast('Access restricted: Only Superadmin can upload forecasting and allocation data.', 'error');
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    setLastFileObj(file);
    setFileName(file.name);
    await processFile(file, filterScope, selectedMonth, allocationMode);
  };

  const processFile = async (file, scope, month, mode = allocationMode) => {
    setIsProcessing(true);
    try {
      const result = await parseUniversalExcel(file, sites, parts, {
        filterScope: scope,
        selectedMonth: month,
        allocationMode: mode
      });
      if (result.success) {
        setParsedData(result);
        if (result.type === 'RAW_USAGE_PIPELINE') {
          setPreviewTab('forecast');
          showToast(`Filtered to ${result.summary.partsCount} iPhone parts (${result.summary.recordsCount} repairs matched)!`, 'success');
        } else {
          showToast(`Successfully analyzed "${file.name}" as ${result.type.replace('_', ' ')}!`, 'success');
        }
      } else {
        showToast(result.error || 'Failed to parse file', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScopeChange = async (newScope) => {
    setFilterScope(newScope);
    try {
      localStorage.setItem('mdc_filter_scope', newScope);
    } catch (e) {}
    if (lastFileObj) {
      await processFile(lastFileObj, newScope, selectedMonth, allocationMode);
    }
  };

  const handleAllocationModeChange = async (newMode) => {
    setAllocationMode(newMode);
    try {
      localStorage.setItem('mdc_allocation_mode', newMode);
    } catch (e) {}
    if (lastFileObj) {
      await processFile(lastFileObj, filterScope, selectedMonth, newMode);
    }
  };

  const handleMonthChange = async (newMonth) => {
    setSelectedMonth(newMonth);
    try {
      localStorage.setItem('mdc_selected_ingestion_month', newMonth);
    } catch (e) {}

    // If user explicitly chooses a specific month, also update global activePeriod so Header and other views immediately match
    if (newMonth !== 'auto') {
      const mIdx = parseInt(newMonth, 10);
      if (!isNaN(mIdx) && mIdx >= 0 && mIdx <= 11) {
        const newPeriod = {
          month: mIdx + 1,
          year: 2026,
          label: `${MONTH_FULL_NAMES[mIdx]} 2026`
        };
        setActivePeriod(newPeriod);
        try {
          localStorage.setItem('mdc_active_period', JSON.stringify(newPeriod));
        } catch (e) {}
      }
    }

    if (lastFileObj) {
      await processFile(lastFileObj, filterScope, newMonth);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedData) return;
    if (!isSuperAdmin) {
      showToast('Action restricted: Only Superadmin is authorized to apply datasets.', 'error');
      return;
    }

    const totalAllocUnits = parsedData.payload?.allocations?.reduce((s, a) => s + (a.total_allocated_qty || 0), 0) || parsedData.summary?.totalForecastedUnits || 0;
    const totalCost = parsedData.payload?.allocations?.reduce((s, a) => s + (a.total_stock_cost || 0), 0) || 0;
    const partsCount = parsedData.payload?.allocations?.length || parsedData.summary?.partsCount || 0;
    const sitesCount = parsedData.payload?.sites?.length || parsedData.summary?.sitesCount || 26;

    let targetMonthName = 'September 2026';
    let periodMonth = 9;
    let periodYear = 2026;

    if (selectedMonth !== 'auto') {
      const idx = parseInt(selectedMonth, 10);
      targetMonthName = `${MONTH_FULL_NAMES[idx]} 2026`;
      periodMonth = idx + 1;
    } else if (parsedData.detectedPeriod) {
      targetMonthName = parsedData.detectedPeriod.label;
      periodMonth = parsedData.detectedPeriod.month;
      periodYear = parsedData.detectedPeriod.year;
    }

    const auditMeta = {
      id: `log-import-${Date.now()}`,
      timestamp: new Date().toISOString(),
      action_type: 'FILE_IMPORT_APPLIED',
      file_name: fileName || lastFileObj?.name || 'Uploaded Dataset.xlsx',
      file_type: parsedData.type,
      target_month: targetMonthName,
      period_month: periodMonth,
      period_year: periodYear,
      filter_scope: filterScope,
      total_forecast_units: parsedData.summary?.totalForecastedUnits || totalAllocUnits,
      total_allocated_units: totalAllocUnits,
      total_master_cost: totalCost,
      parts_count: partsCount,
      sites_count: sitesCount,
      user_id: currentUser?.id || 'usr-superadmin',
      user_name: currentUser?.fullName || 'Superadmin User',
      user_email: currentUser?.email || 'superadmin@mobilecare.com',
      user_role: currentUser?.role || 'superadmin',
      status: 'ACTIVE_ON_CLOUD'
    };

    await applyParsedDataset(parsedData, auditMeta);
    setParsedData(null);
    setFileName('');
    setLastFileObj(null);
    setActiveTab('allocation');
    showToast('Dataset imported and allocation matrix updated successfully!', 'success');
  };

  const handleDownloadTemplate = () => {
    downloadSampleGsxFixablyCsv(sites, parts);
    showToast('Downloaded Fixably_GSX_Raw_Usage_Template.csv', 'info');
  };

  return (
    <div className="data-import-view" style={{ maxWidth: '1150px', margin: '0 auto' }}>
      {/* Header & Reset Tool */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UploadCloud size={20} color="var(--primary)" />
              <h2 style={{ fontSize: '18px', margin: 0 }}>Fixably / GSX Raw Usage & Dynamic Data Importer</h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Upload raw repair exports (.csv, .xlsx) from Fixably / GSX. The engine automatically filters for <strong>iPhone 13 and newer (Battery & Display)</strong> and computes forecasts and allocations.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDownloadTemplate}
              title="Download a formatted sample Fixably / GSX CSV file"
            >
              <Download size={14} />
              <span>Download Sample Fixably/GSX CSV</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowClearModal(true)}
              title="Reset to fresh empty state with zero forecasts or allocations"
            >
              <RotateCcw size={14} />
              <span>Clear to Empty State</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={resetToDefaultData}
              title="Load sample August 2026 dataset for demonstration"
            >
              <Sparkles size={14} color="var(--primary)" />
              <span>Load Demo Data</span>
            </button>
          </div>
        </div>

        {/* Superadmin Upload Permission Notice */}
        {!isSuperAdmin && (
          <div
            style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 18px',
              marginTop: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <ShieldAlert size={22} color="#d97706" style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ color: '#92400e', fontSize: '13.5px' }}>
                Upload Restricted: Super Admin Only
              </strong>
              <p style={{ color: '#b45309', fontSize: '12px', margin: '2px 0 0' }}>
                Only users with the <strong>Superadmin</strong> role are authorized to ingest and apply Forecasting and Master Allocation datasets to the Distribution Center.
              </p>
            </div>
          </div>
        )}

        {/* Configuration Bar: Target Month & Part Scope */}
        <div
          style={{
            marginTop: '16px',
            padding: '14px 18px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-light)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '16px',
            alignItems: 'center'
          }}
        >
          {/* Target Month Selector */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Calendar size={15} color="var(--primary)" />
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                Target Ingestion Month:
              </strong>
            </div>
            <select
              className="form-select"
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              disabled={!isSuperAdmin}
              style={{ width: '100%', fontSize: '13px', padding: '7px 10px', background: '#fff' }}
            >
              <option value="auto">Auto-Detect from Dates in File</option>
              <option value="0">January (Jan)</option>
              <option value="1">February (Feb)</option>
              <option value="2">March (Mar)</option>
              <option value="3">April (Apr)</option>
              <option value="4">May (May)</option>
              <option value="5">June (Jun)</option>
              <option value="6">July (Jul)</option>
              <option value="7">August (Aug)</option>
              <option value="8">September (Sep)</option>
              <option value="9">October (Oct)</option>
              <option value="10">November (Nov)</option>
              <option value="11">December (Dec)</option>
            </select>
          </div>

          {/* Part Filter Scope Selector */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Smartphone size={15} color="var(--primary)" />
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                Hardware Filter Scope:
              </strong>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`btn btn-sm ${filterScope === 'IPHONE_13_PLUS_BATTERY_DISPLAY' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleScopeChange('IPHONE_13_PLUS_BATTERY_DISPLAY')}
                disabled={!isSuperAdmin}
                style={{ fontSize: '12px', flex: 1, padding: '7px 10px', whiteSpace: 'nowrap' }}
              >
                iPhone (Battery & Display)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${filterScope === 'ALL_PARTS' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleScopeChange('ALL_PARTS')}
                disabled={!isSuperAdmin}
                style={{ fontSize: '12px', flex: 1, padding: '7px 10px', whiteSpace: 'nowrap' }}
              >
                All Parts
              </button>
            </div>
          </div>

          {/* Allocation Engine Mode Selector */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Split size={15} color="var(--primary)" />
              <strong style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                Allocation Mode:
              </strong>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`btn btn-sm ${allocationMode === 'OPTION_A' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleAllocationModeChange('OPTION_A')}
                disabled={!isSuperAdmin}
                style={{ fontSize: '12px', flex: 1, padding: '7px 10px', whiteSpace: 'nowrap' }}
                title="Option A: Bit-for-bit Excel workbook formula parity"
              >
                Option A (Excel Parity)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${allocationMode === 'OPTION_B' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleAllocationModeChange('OPTION_B')}
                disabled={!isSuperAdmin}
                style={{ fontSize: '12px', flex: 1, padding: '7px 10px', whiteSpace: 'nowrap' }}
                title="Option B: Corrected self-consistent 2D quota allocation"
              >
                Option B (Corrected)
              </button>
            </div>
          </div>
        </div>

        {/* Universal Dropzone */}
        <div
          style={{
            border: isSuperAdmin ? '2px dashed var(--primary)' : '2px dashed #cbd5e1',
            borderRadius: 'var(--radius-md)',
            padding: '40px 20px',
            textAlign: 'center',
            background: isSuperAdmin ? 'var(--bg-primary)' : '#f8fafc',
            cursor: isSuperAdmin ? 'pointer' : 'not-allowed',
            position: 'relative',
            marginTop: '16px',
            transition: 'all 0.2s ease',
            opacity: isSuperAdmin ? 1 : 0.75
          }}
        >
          {isSuperAdmin && (
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileUpload}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer'
              }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: isSuperAdmin ? 'var(--primary-light)' : '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isSuperAdmin ? 'var(--primary)' : '#94a3b8',
                boxShadow: isSuperAdmin ? '0 4px 12px rgba(2, 132, 199, 0.2)' : 'none'
              }}
            >
              {!isSuperAdmin ? <Lock size={24} /> : isProcessing ? <RefreshCw className="animate-spin" size={26} /> : <UploadCloud size={26} />}
            </div>
            <div>
              <strong style={{ fontSize: '16px', color: isSuperAdmin ? 'var(--text-main)' : 'var(--text-muted)' }}>
                {!isSuperAdmin
                  ? 'Upload Disabled — Super Admin Permission Required'
                  : fileName ? fileName : 'Drag and drop your Fixably/GSX CSV or Excel file here or click to browse'}
              </strong>
              <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {!isSuperAdmin
                  ? 'Please log in with a Superadmin account to upload new forecast and allocation masterlists.'
                  : <>Accepts <strong>.CSV</strong> and <strong>.XLSX</strong> • Target: <strong>iPhone 13, 14, 15, 16, 17 Battery & Display</strong></>}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-Detection & Calculation Preview Card */}
      {parsedData && (
        <div className="card" style={{ border: '2px solid var(--primary)', background: '#f0f9ff', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '14px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="badge badge-primary" style={{ fontSize: '12px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {parsedData.type === 'RAW_USAGE_PIPELINE' && <Sparkles size={13} />}
                  {parsedData.type === 'FORECAST' && <TrendingUp size={13} />}
                  {parsedData.type === 'ALLOCATION' && <Split size={13} />}
                  {parsedData.type === 'INVENTORY_STOCK' && <Boxes size={13} />}
                  {parsedData.type === 'RAW_USAGE_PIPELINE' ? 'Raw Fixably / GSX Engine Processed' : `Detected: ${parsedData.type.replace('_', ' ')}`}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Source: <strong>{fileName}</strong> ({parsedData.sheetName})
                </span>
              </div>

              <h3 style={{ fontSize: '18px', marginTop: '8px', color: 'var(--text-main)' }}>
                {parsedData.type === 'RAW_USAGE_PIPELINE'
                  ? 'Forecasting & Multi-Site Allocations Ready to Apply'
                  : `Ready to Apply "${fileName}" to Live System`}
              </h3>

              <p style={{ fontSize: '13px', color: '#0369a1', marginTop: '2px' }}>
                {parsedData.summary.description}
              </p>
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleConfirmImport}
              disabled={!isSuperAdmin}
              style={{ boxShadow: 'var(--shadow-md)', minWidth: '220px', cursor: isSuperAdmin ? 'pointer' : 'not-allowed' }}
            >
              <span>Apply & Update Live System</span>
              <ArrowRight size={18} />
            </button>
          </div>

          {/* Quick Metrics KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            {parsedData.summary.recordsCount !== undefined && (
              <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                <div style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600, textTransform: 'uppercase' }}>In-Scope Repairs Matched</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7' }}>{parsedData.summary.recordsCount}</div>
              </div>
            )}
            <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600, textTransform: 'uppercase' }}>Target iPhone Parts</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7' }}>
                {parsedData.payload?.forecastItems?.length || parsedData.payload?.allocations?.length || parsedData.summary.partsCount || 0}
              </div>
            </div>
            {parsedData.payload?.sites?.length > 0 && (
              <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                <div style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600, textTransform: 'uppercase' }}>Service Sites Matched</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7' }}>{parsedData.payload.sites.length}</div>
              </div>
            )}
            <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: '11px', color: '#0369a1', fontWeight: 600, textTransform: 'uppercase' }}>Total Demand Forecast</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7' }}>
                {parsedData.summary.totalForecastedUnits || (parsedData.payload?.forecastItems || []).reduce((acc, f) => acc + (f.final_forecast || f.computed_forecast || 0), 0)} units
              </div>
            </div>
          </div>

          {/* Sub Navigation Tabs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {parsedData.payload?.forecastItems?.length > 0 && (
              <button
                className={`btn btn-sm ${previewTab === 'forecast' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPreviewTab('forecast')}
              >
                <TrendingUp size={14} />
                <span>Demand Forecasts ({parsedData.payload.forecastItems.length})</span>
              </button>
            )}
            {parsedData.payload?.allocations?.length > 0 && (
              <button
                className={`btn btn-sm ${previewTab === 'allocation' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPreviewTab('allocation')}
              >
                <Split size={14} />
                <span>Master Allocations ({parsedData.payload.allocations.length})</span>
              </button>
            )}
            {parsedData.payload?.records?.length > 0 && (
              <button
                className={`btn btn-sm ${previewTab === 'raw' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPreviewTab('raw')}
              >
                <FileText size={14} />
                <span>In-Scope Repair Records ({parsedData.payload.records.length})</span>
              </button>
            )}
          </div>

          {/* Preview Tab 1: Forecasts */}
          {previewTab === 'forecast' && parsedData.payload?.forecastItems?.length > 0 && (
            <div className="table-container" style={{ maxHeight: '360px', overflowY: 'auto', background: '#fff', borderRadius: '8px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'center' }}>Monthly Trend</th>
                    <th style={{ textAlign: 'center' }}>{parsedData.detectedPeriod?.label ? `${parsedData.detectedPeriod.label.split(' ')[0]} Forecast` : (selectedMonth !== 'auto' ? `${MONTH_FULL_NAMES[parseInt(selectedMonth)]} Forecast` : 'Forecast Demand')}</th>
                    <th style={{ textAlign: 'center' }}>Safety Stock (5%)</th>
                    <th style={{ textAlign: 'center', background: '#ecfdf5', color: '#065f46' }}>Recommended Order</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.payload.forecastItems.map(item => (
                    <tr key={item.part_id}>
                      <td className="font-mono"><strong>{item.part_number}</strong></td>
                      <td>{item.description}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                        {item.ytd_monthly_counts.join(', ')}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {item.final_forecast || item.computed_forecast}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {item.safety_stock_units}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#15803d' }}>
                        {item.recommended_order}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Preview Tab 2: Allocations */}
          {previewTab === 'allocation' && parsedData.payload?.allocations?.length > 0 && (
            <div className="table-container" style={{ maxHeight: '360px', overflowY: 'auto', background: '#fff', borderRadius: '8px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Stock Price</th>
                    <th style={{ textAlign: 'center', background: '#e0f2fe' }}>Total Parts</th>
                    <th style={{ textAlign: 'right', background: '#e0f2fe' }}>Total Cost</th>
                    <th style={{ textAlign: 'center' }}>W1 Qty</th>
                    <th style={{ textAlign: 'right' }}>W1 Total</th>
                    <th style={{ textAlign: 'center' }}>W2 Qty</th>
                    <th style={{ textAlign: 'right' }}>W2 Total</th>
                    <th style={{ textAlign: 'center' }}>W3 Qty</th>
                    <th style={{ textAlign: 'right' }}>W3 Total</th>
                    <th style={{ textAlign: 'center' }}>W4 Qty</th>
                    <th style={{ textAlign: 'right' }}>W4 Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.payload.allocations.map(item => {
                    const price = item.stocking_price || 0;
                    const totalQty = item.total_allocated_qty || 0;
                    const totalCost = item.total_stock_cost || (totalQty * price);
                    return (
                      <tr key={item.part_id}>
                        <td className="font-mono"><strong>{item.part_number}</strong></td>
                        <td>{item.description}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${price.toFixed(2)}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                          {totalQty}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                          ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w1_qty ?? 0}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${((item.w1_cost ?? (item.w1_qty * price)) || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w2_qty ?? 0}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${((item.w2_cost ?? (item.w2_qty * price)) || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w3_qty ?? 0}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${((item.w3_cost ?? (item.w3_qty * price)) || 0).toFixed(2)}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{item.w4_qty ?? 0}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${((item.w4_cost ?? (item.w4_qty * price)) || 0).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Preview Tab 3: Raw Repair Records */}
          {parsedData.type === 'RAW_USAGE_PIPELINE' && previewTab === 'raw' && (
            <div className="table-container" style={{ maxHeight: '360px', overflowY: 'auto', background: '#fff', borderRadius: '8px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Repair #</th>
                    <th>Date / Month</th>
                    <th>Branch / Site</th>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'center' }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.payload.records.slice(0, 100).map((rec, idx) => (
                    <tr key={idx}>
                      <td className="font-mono">{rec.repairNumber}</td>
                      <td>{rec.closedDate}</td>
                      <td>{rec.rawSiteName || rec.siteId}</td>
                      <td className="font-mono"><strong>{rec.partNumber}</strong></td>
                      <td>{rec.description}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{rec.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedData.payload.records.length > 100 && (
                <div style={{ textAlign: 'center', padding: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Showing first 100 of {parsedData.payload.records.length} records. All records will be saved.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* High-Security Clear Data Confirmation Modal */}
      {showClearModal && (
        <ClearDataConfirmationModal
          isOpen={showClearModal}
          onClose={() => setShowClearModal(false)}
          title="Reset System to Fresh Empty State"
        />
      )}
    </div>
  );
}
