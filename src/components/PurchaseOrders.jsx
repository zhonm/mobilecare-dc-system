import { useState, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShoppingCart,
  Barcode,
  UploadCloud,
  FileText,
  Trash2,
  Plus,
  Search,
  X,
  CheckCircle,
  Files
} from 'lucide-react';
import { parseGsxInvoicePdf, parseGsxExcelOrCsv } from '../utils/gsxPdfParser';
import { getBasePoNumber, normalizeDateToIso } from '../utils/appContextHelpers';

export default function PurchaseOrders() {
  const {
    purchaseOrders = [],
    addPurchaseOrder,
    deletePurchaseOrder,
    clearCompletedPurchaseOrders,
    receivePo,
    currentUser,
    setActiveTab,
    showToast
  } = useApp();

  const isSuperAdmin = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';

  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'pending' | 'partially_received' | 'received'

  // Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Form State inside Modal
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [salesOrderNo, setSalesOrderNo] = useState('');
  const [supplier, setSupplier] = useState('Apple South Asia Pte Ltd');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [expectedDate, setExpectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState('USD');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState([]);

  // Filtered PO list
  const filteredPOs = useMemo(() => {
    return purchaseOrders.filter(po => {
      // Status Filter
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'pending' && po.status !== 'pending' && po.status !== 'ordered') return false;
        if (statusFilter === 'partially_received' && po.status !== 'partially_received') return false;
        if (statusFilter === 'received' && po.status !== 'received' && po.status !== 'closed') return false;
      }

      // Search Query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const matchPo = (po.po_number || '').toLowerCase().includes(q);
      const matchRef = (po.invoice_ref || '').toLowerCase().includes(q);
      const matchSales = (po.sales_order_no || '').toLowerCase().includes(q);
      const matchSupplier = (po.supplier || '').toLowerCase().includes(q);
      const matchItems = (po.items || []).some(
        it => (it.part_number || '').toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q)
      );

      return matchPo || matchRef || matchSales || matchSupplier || matchItems;
    });
  }, [purchaseOrders, statusFilter, searchQuery]);

  // Overall Statistics
  const stats = useMemo(() => {
    const totalPOs = purchaseOrders.length;
    const pendingPOs = purchaseOrders.filter(p => p.status === 'pending' || p.status === 'ordered').length;
    const partialPOs = purchaseOrders.filter(p => p.status === 'partially_received').length;
    const receivedPOs = purchaseOrders.filter(p => p.status === 'received' || p.status === 'closed').length;

    let totalOrderedUnits = 0;
    let totalReceivedUnits = 0;
    let totalValue = 0;

    purchaseOrders.forEach(p => {
      (p.items || []).forEach(it => {
        totalOrderedUnits += it.quantity_ordered || 0;
        totalReceivedUnits += it.quantity_received || 0;
        totalValue += (it.quantity_ordered || 0) * (it.unit_price || 0);
      });
    });

    return {
      totalPOs,
      pendingPOs,
      partialPOs,
      receivedPOs,
      totalOrderedUnits,
      totalReceivedUnits,
      totalValue
    };
  }, [purchaseOrders]);

  // Multi-PO Staging State
  const [stagedPOs, setStagedPOs] = useState([]);
  const [isBatchImporting, setIsBatchImporting] = useState(false);

  // Reset Modal Form
  const resetUploadForm = () => {
    setUploadedFileName('');
    setPoNumber('');
    setInvoiceRef('');
    setSalesOrderNo('');
    setSupplier('Apple South Asia Pte Ltd');
    setOrderDate(new Date().toISOString().split('T')[0]);
    setExpectedDate(new Date().toISOString().split('T')[0]);
    setCurrency('USD');
    setRemarks('');
    setItems([]);
    setStagedPOs([]);
    setParseError('');
    setIsParsing(false);
    setIsBatchImporting(false);
  };

  const handleOpenUpload = () => {
    resetUploadForm();
    setIsUploadModalOpen(true);
  };

  // Process File(s) Upload
  const handleFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setIsParsing(true);
    setParseError('');

    if (files.length === 1) {
      const file = files[0];
      setUploadedFileName(file.name);
      try {
        const buffer = await file.arrayBuffer();
        const ext = file.name.split('.').pop().toLowerCase();

        let parsedData = null;
        if (ext === 'pdf') {
          parsedData = await parseGsxInvoicePdf(buffer, file.name);
        } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
          parsedData = await parseGsxExcelOrCsv(buffer, file.name);
        } else {
          throw new Error('Unsupported file format. Please upload a PDF (.pdf), Excel (.xlsx/.xls), or CSV file.');
        }

        if (!parsedData || !parsedData.items || parsedData.items.length === 0) {
          throw new Error('Could not detect valid Apple line items (661-xxxxx) in the uploaded document.');
        }

        setPoNumber(parsedData.po_number || '');
        setInvoiceRef(parsedData.invoice_ref || '');
        setSalesOrderNo(parsedData.sales_order_no || '');
        setSupplier(parsedData.supplier || 'Apple South Asia Pte Ltd');
        setOrderDate(normalizeDateToIso(parsedData.order_date));
        setExpectedDate(normalizeDateToIso(parsedData.expected_date || parsedData.order_date));
        setCurrency(parsedData.currency || 'USD');
        setRemarks(parsedData.remarks || '');
        setItems(parsedData.items || []);
        setStagedPOs([]);

        showToast(`Parsed ${parsedData.items.length} parts from ${file.name}`, 'success');
      } catch (err) {
        console.error('PO parse error:', err);
        setParseError(err.message || 'Failed to parse purchase order file.');
        showToast('Error parsing PO: ' + err.message, 'error');
      } finally {
        setIsParsing(false);
      }
    } else {
      // Multiple files uploaded
      setUploadedFileName(`${files.length} Files Selected`);
      const parsedList = [];
      const errorList = [];

      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();
          const ext = file.name.split('.').pop().toLowerCase();
          let parsed = null;
          if (ext === 'pdf') {
            parsed = await parseGsxInvoicePdf(buffer, file.name);
          } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
            parsed = await parseGsxExcelOrCsv(buffer, file.name);
          } else {
            errorList.push(`${file.name}: Unsupported format`);
            continue;
          }

          if (parsed && parsed.items && parsed.items.length > 0) {
            const calculatedTotal = parsed.items.reduce((sum, it) => sum + (Number(it.quantity_ordered || 0) * Number(it.unit_price || 0)), 0);
            parsedList.push({
              ...parsed,
              fileName: file.name,
              calculatedTotal,
              totalUnits: parsed.items.reduce((s, it) => s + (Number(it.quantity_ordered) || 1), 0)
            });
          } else {
            errorList.push(`${file.name}: No Apple parts detected`);
          }
        } catch (err) {
          errorList.push(`${file.name}: ${err.message}`);
        }
      }

      setIsParsing(false);
      if (parsedList.length > 0) {
        setStagedPOs(parsedList);
        showToast(`Parsed ${parsedList.length} of ${files.length} Purchase Order files! Review and click Import All.`, 'success');
        if (errorList.length > 0) {
          setParseError(`Warnings: ${errorList.join(', ')}`);
        }
      } else {
        setParseError(`Failed to parse files: ${errorList.join(' | ')}`);
        showToast('Failed to parse uploaded files', 'error');
      }
    }
  };

  const handleBatchImportAll = async () => {
    if (stagedPOs.length === 0) return;
    setIsBatchImporting(true);

    // Consolidate staged POs by base PO number so multiple invoices for the same PO are imported into one
    const poMap = new Map();
    stagedPOs.forEach(staged => {
      const rawPoNum = (staged.po_number || `PO-${Date.now()}`).trim();
      const basePoNum = getBasePoNumber(rawPoNum);

      if (!poMap.has(basePoNum)) {
        poMap.set(basePoNum, {
          ...staged,
          po_number: basePoNum,
          items: [...staged.items],
          invoice_refs: staged.invoice_ref ? [String(staged.invoice_ref).trim()] : [],
          sales_order_nos: staged.sales_order_no ? [String(staged.sales_order_no).trim()] : [],
          fileNames: staged.fileName ? [staged.fileName] : []
        });
      } else {
        const existing = poMap.get(basePoNum);
        existing.items.push(...staged.items);
        if (staged.invoice_ref && !existing.invoice_refs.includes(String(staged.invoice_ref).trim())) {
          existing.invoice_refs.push(String(staged.invoice_ref).trim());
        }
        if (staged.sales_order_no && !existing.sales_order_nos.includes(String(staged.sales_order_no).trim())) {
          existing.sales_order_nos.push(String(staged.sales_order_no).trim());
        }
        if (staged.fileName && !existing.fileNames.includes(staged.fileName)) {
          existing.fileNames.push(staged.fileName);
        }
      }
    });

    let count = 0;
    for (const [basePoNum, consolidatedStaged] of poMap.entries()) {
      const calculatedTotal = consolidatedStaged.items.reduce((sum, it) => sum + (Number(it.quantity_ordered || 0) * Number(it.unit_price || 0)), 0);
      const combinedInvoiceRef = consolidatedStaged.invoice_refs.join(', ') || null;
      const combinedSalesOrderNo = consolidatedStaged.sales_order_nos.join(', ') || null;
      const combinedFileNames = consolidatedStaged.fileNames.join(', ') || 'Batch_Import';

      const poPayload = {
        po_number: basePoNum,
        invoice_ref: combinedInvoiceRef,
        sales_order_no: combinedSalesOrderNo,
        supplier: consolidatedStaged.supplier || 'Apple South Asia Pte Ltd',
        order_date: normalizeDateToIso(consolidatedStaged.order_date),
        expected_date: normalizeDateToIso(consolidatedStaged.expected_date || consolidatedStaged.order_date),
        status: 'pending',
        currency: consolidatedStaged.currency || 'USD',
        total_amount: calculatedTotal,
        remarks: consolidatedStaged.remarks || '',
        source_filename: combinedFileNames,
        items: consolidatedStaged.items.map((it, idx) => ({
          id: it.id || `po-item-${idx}-${Date.now()}`,
          part_number: String(it.part_number || '').trim().toUpperCase(),
          description: it.description || `Apple Genuine Part ${it.part_number}`,
          quantity_ordered: parseInt(it.quantity_ordered, 10) || 1,
          quantity_shipped: parseInt(it.quantity_shipped || it.quantity_ordered, 10) || 1,
          quantity_received: 0,
          unit_price: parseFloat(it.unit_price) || 0,
          extended_price: (parseInt(it.quantity_ordered, 10) || 1) * (parseFloat(it.unit_price) || 0)
        }))
      };

      if (addPurchaseOrder) {
        await addPurchaseOrder(poPayload);
        count++;
      }
    }

    setIsBatchImporting(false);
    setIsUploadModalOpen(false);
    resetUploadForm();
    showToast(`Successfully imported ${count} Purchase Order${count > 1 ? 's' : ''}! All parts consolidated into single POs.`, 'success');
  };

  const handleRemoveStagedPO = (index) => {
    setStagedPOs(prev => prev.filter((_, idx) => idx !== index));
  };

  // Drag and Drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Line item manipulation inside modal
  const handleItemChange = (index, field, value) => {
    setItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      if (field === 'quantity_ordered' || field === 'unit_price') {
        const qty = field === 'quantity_ordered' ? Number(value) : Number(copy[index].quantity_ordered);
        const price = field === 'unit_price' ? Number(value) : Number(copy[index].unit_price);
        copy[index].extended_price = qty * price;
      }
      return copy;
    });
  };

  const handleDeleteItem = (index) => {
    setItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleAddManualItem = () => {
    setItems(prev => [
      ...prev,
      {
        id: `po-item-${Date.now()}`,
        part_number: '661-',
        description: 'Apple Genuine Part',
        quantity_ordered: 1,
        quantity_shipped: 1,
        quantity_received: 0,
        unit_price: 99,
        extended_price: 99
      }
    ]);
  };

  // Commit and Save PO
  const handleSavePurchaseOrder = async (e) => {
    e.preventDefault();

    if (!poNumber.trim()) {
      showToast('Purchase Order Number is required', 'error');
      return;
    }

    if (items.length === 0) {
      showToast('At least one part number is required to create a Purchase Order', 'error');
      return;
    }

    const calculatedTotal = items.reduce((sum, it) => sum + (Number(it.quantity_ordered || 0) * Number(it.unit_price || 0)), 0);
    const basePoNum = getBasePoNumber(poNumber);

    const poPayload = {
      po_number: basePoNum,
      invoice_ref: invoiceRef.trim() || null,
      sales_order_no: salesOrderNo.trim() || null,
      supplier: supplier.trim() || 'Apple South Asia Pte Ltd',
      order_date: orderDate,
      expected_date: expectedDate || orderDate,
      status: 'pending',
      currency: currency || 'USD',
      total_amount: calculatedTotal,
      remarks: remarks.trim(),
      source_filename: uploadedFileName || 'Manual_Entry',
      items: items.map(it => ({
        part_number: String(it.part_number || '').trim().toUpperCase(),
        description: it.description || `Apple Genuine Part ${it.part_number}`,
        quantity_ordered: parseInt(it.quantity_ordered, 10) || 1,
        quantity_shipped: parseInt(it.quantity_shipped || it.quantity_ordered, 10) || 1,
        quantity_received: parseInt(it.quantity_received, 10) || 0,
        unit_price: parseFloat(it.unit_price) || 0,
        extended_price: (parseInt(it.quantity_ordered, 10) || 1) * (parseFloat(it.unit_price) || 0)
      }))
    };

    if (addPurchaseOrder) {
      await addPurchaseOrder(poPayload);
    }

    setIsUploadModalOpen(false);
    resetUploadForm();
  };

  return (
    <div className="purchase-orders-view" style={{ maxWidth: '1240px', margin: '0 auto', paddingBottom: '40px' }}>
      {/* Top Header Banner */}
      <div className="card" style={{ marginBottom: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '9px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShoppingCart size={22} color="#2563eb" />
              </div>
              <div>
                <h3 style={{ fontSize: '18px', margin: 0, fontWeight: 700, color: '#0f172a' }}>
                  Purchase Orders (DC Replenishment)
                </h3>
                <p style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px', marginBottom: 0 }}>
                  Upload Apple GSX Tax Invoices & track incoming vendor shipments. Scanned parts at DC link directly to each PO.
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {isSuperAdmin && purchaseOrders.some(p => p.status === 'received') && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  if (window.confirm(`Clear all completed Purchase Orders from active tracking? All scanned serials remain permanently preserved in Parts Saved History Records.`)) {
                    clearCompletedPurchaseOrders();
                  }
                }}
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px' }}
                title="Delete all 100% completed POs from active replenishment list"
              >
                <Trash2 size={14} />
                <span>Clear Completed POs ({purchaseOrders.filter(p => p.status === 'received').length})</span>
              </button>
            )}

            {isSuperAdmin && (
              <button className="btn btn-primary" onClick={handleOpenUpload} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UploadCloud size={16} />
                <span>Upload GSX Purchase Order</span>
              </button>
            )}

            <button
              className="btn btn-secondary"
              onClick={() => {
                setActiveTab('scan-in');
                showToast('Switched to Scan-In Receiving Station', 'info');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Barcode size={16} />
              <span>Go to Scan-In Receiving</span>
            </button>
          </div>
        </div>

        {/* Quick KPI Overview - Soft, Anti-Glare Ergonomic Tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginTop: '18px' }}>
          {/* Total POs */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total POs</span>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0f172a', marginTop: '4px' }}>
              {stats.totalPOs}
            </div>
          </div>

          {/* Pending / In Transit */}
          <div style={{ background: '#fefce8', padding: '14px 16px', borderRadius: '10px', border: '1px solid #fef08a' }}>
            <span style={{ fontSize: '11px', color: '#854d0e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Pending / In Transit</span>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#a16207', marginTop: '4px' }}>
              {stats.pendingPOs}
            </div>
          </div>

          {/* Partially Received */}
          <div style={{ background: '#eff6ff', padding: '14px 16px', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
            <span style={{ fontSize: '11px', color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Partially Received</span>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#2563eb', marginTop: '4px' }}>
              {stats.partialPOs}
            </div>
          </div>

          {/* Fully Received */}
          <div style={{ background: '#f0fdf4', padding: '14px 16px', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
            <span style={{ fontSize: '11px', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Fully Received</span>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#16a34a', marginTop: '4px' }}>
              {stats.receivedPOs}
            </div>
          </div>

          {/* Received Units */}
          <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Received Units</span>
            <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0f172a', marginTop: '4px' }}>
              {stats.totalReceivedUnits} <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 500 }}>/ {stats.totalOrderedUnits}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ marginBottom: '16px', padding: '12px 16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Status Pills */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { label: 'All POs', value: 'ALL' },
              { label: 'Pending Arrival', value: 'pending' },
              { label: 'Partially Received', value: 'partially_received' },
              { label: 'Fully Received', value: 'received' }
            ].map(tab => {
              const isActive = statusFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: isActive ? '1px solid #2563eb' : '1px solid #e2e8f0',
                    background: isActive ? '#2563eb' : '#ffffff',
                    color: isActive ? '#ffffff' : '#64748b',
                    boxShadow: isActive ? '0 1px 3px rgba(37, 99, 235, 0.25)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '11px', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search PO, Invoice, Part No..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{
                paddingLeft: '32px',
                height: '36px',
                fontSize: '13px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                color: '#0f172a'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: '8px', top: '8px', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Purchase Orders List */}
      {filteredPOs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px', border: '2px dashed #cbd5e1', background: '#ffffff', borderRadius: '12px' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: '#eff6ff',
              color: '#2563eb',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <ShoppingCart size={28} />
          </div>
          <h3 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '6px', color: '#0f172a' }}>
            {purchaseOrders.length === 0 ? 'No Active Purchase Orders' : 'No Matching Purchase Orders Found'}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '500px', margin: '0 auto 22px', lineHeight: 1.5 }}>
            {purchaseOrders.length === 0
              ? 'Upload your Apple GSX Tax Invoice PDF or spreadsheet to track incoming shipments for the DC. Once units arrive, scan them directly against the PO.'
              : 'Try clearing your search filters to view existing replenishment orders.'}
          </p>

          {isSuperAdmin && purchaseOrders.length === 0 && (
            <button className="btn btn-primary" onClick={handleOpenUpload} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <UploadCloud size={16} />
              <span>Upload GSX Purchase Order</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredPOs.map(po => {
            const totalOrdered = po.items?.reduce((s, it) => s + (it.quantity_ordered || 0), 0) || 0;
            const totalReceived = po.items?.reduce((s, it) => s + (it.quantity_received || 0), 0) || 0;
            const totalValue = po.items?.reduce((s, it) => s + ((it.quantity_ordered || 0) * (it.unit_price || 0)), 0) || 0;
            const pct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
            const isCompleted = po.status === 'received' || totalReceived >= totalOrdered;

            return (
              <div
                key={po.id}
                className="card"
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                  padding: '20px'
                }}
              >
                {/* PO Card Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0f172a' }}>
                        {po.po_number}
                      </span>
                      <span className={`badge ${isCompleted ? 'badge-success' : totalReceived > 0 ? 'badge-primary' : 'badge-warning'}`}>
                        {isCompleted ? 'Fully Received' : totalReceived > 0 ? 'Partially Received' : 'Pending Arrival'}
                      </span>
                      {po.invoice_ref && (
                        <span style={{ fontSize: '11px', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '4px', color: '#475569' }}>
                          Ref: <strong>{po.invoice_ref}</strong>
                        </span>
                      )}
                      {po.sales_order_no && (
                        <span style={{ fontSize: '11px', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 8px', borderRadius: '4px', color: '#475569' }}>
                          SO: <strong>{po.sales_order_no}</strong>
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '12.5px', color: '#64748b', marginTop: '5px', marginBottom: 0 }}>
                      Supplier: <strong style={{ color: '#334155' }}>{po.supplier || 'Apple South Asia Pte Ltd'}</strong> • Order Date: {po.order_date} • Expected Arrival: {po.expected_date} {po.remarks ? `• ${po.remarks}` : ''}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ textAlign: 'right', marginRight: '8px' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: isCompleted ? '#16a34a' : '#2563eb' }}>
                        {totalReceived} / {totalOrdered} Units ({pct}%)
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '1px' }}>
                        Total Value: ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {po.currency || 'USD'}
                      </div>
                    </div>

                    {!isCompleted && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          receivePo(po.id);
                          showToast(`Linked ${po.po_number} to Scan-In Station`, 'info');
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <Barcode size={14} />
                        <span>Receive In Station</span>
                      </button>
                    )}

                    {isSuperAdmin && po.status === 'received' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete completed PO ${po.po_number}? All scanned serials and intake records remain safely preserved in Parts Saved History Records.`)) {
                            deletePurchaseOrder(po.id);
                          }
                        }}
                        className="btn btn-sm"
                        style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px' }}
                        title="Delete Completed Purchase Order (History preserved in Parts Saved History Records)"
                      >
                        <CheckCircle size={14} />
                        <span>Completed — Delete PO</span>
                      </button>
                    )}

                    {isSuperAdmin && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to remove purchase order ${po.po_number}?`)) {
                            deletePurchaseOrder(po.id);
                          }
                        }}
                        className="btn btn-secondary btn-sm"
                        style={{ color: '#dc2626', borderColor: '#fca5a5', padding: '6px 8px' }}
                        title="Delete Purchase Order"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Fulfillment Progress Bar */}
                <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px', border: '1px solid #e2e8f0' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: pct === 100 ? '#16a34a' : '#2563eb',
                      transition: 'width 0.4s ease'
                    }}
                  />
                </div>

                {/* Line Items Table */}
                <div className="table-container" style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table className="data-table" style={{ fontSize: '12.5px', width: '100%' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ width: '140px', color: '#475569', fontWeight: 600 }}>Part Number</th>
                        <th style={{ color: '#475569', fontWeight: 600 }}>Description</th>
                        <th style={{ textAlign: 'center', width: '90px', color: '#475569', fontWeight: 600 }}>Ordered</th>
                        <th style={{ textAlign: 'center', width: '90px', color: '#475569', fontWeight: 600 }}>Received</th>
                        <th style={{ textAlign: 'center', width: '90px', color: '#475569', fontWeight: 600 }}>Remaining</th>
                        <th style={{ textAlign: 'right', width: '110px', color: '#475569', fontWeight: 600 }}>Unit Price</th>
                        <th style={{ textAlign: 'center', width: '110px', color: '#475569', fontWeight: 600 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items?.map((item, idx) => {
                        const remaining = Math.max(0, (item.quantity_ordered || 0) - (item.quantity_received || 0));
                        const itemPct = item.quantity_ordered > 0 ? Math.round((item.quantity_received / item.quantity_ordered) * 100) : 0;
                        const isItemDone = itemPct >= 100;

                        return (
                          <tr key={item.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td className="font-mono" style={{ fontWeight: 700, color: '#1e40af' }}>
                              {item.part_number}
                            </td>
                            <td style={{ color: '#334155' }}>{item.description}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#0f172a' }}>{item.quantity_ordered}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, color: item.quantity_received > 0 ? '#16a34a' : '#64748b' }}>
                              {item.quantity_received}
                            </td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', color: remaining > 0 ? '#b45309' : '#64748b' }}>
                              {remaining}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#334155' }}>
                              ${Number(item.unit_price || 0).toFixed(2)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`badge ${isItemDone ? 'badge-success' : item.quantity_received > 0 ? 'badge-primary' : 'badge-neutral'}`}>
                                {isItemDone ? 'Complete' : `${itemPct}%`}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Purchase Order Modal */}
      {isUploadModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIsUploadModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: '820px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            {/* Modal Header */}
            <div className="modal-header" style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '8px', borderRadius: '8px' }}>
                  <UploadCloud size={20} color="#2563eb" />
                </div>
                <div>
                  <h3 style={{ color: '#0f172a', fontSize: '17px', margin: 0, fontWeight: 700 }}>
                    Upload GSX Purchase Order
                  </h3>
                  <p style={{ color: '#64748b', fontSize: '12px', margin: '2px 0 0 0' }}>
                    Upload an Apple GSX Tax Invoice PDF or Excel file to register incoming DC parts
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSavePurchaseOrder} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="modal-body" style={{ overflowY: 'auto', padding: '20px', flex: 1, background: '#ffffff' }}>
                {/* Drag and Drop Zone */}
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: dragActive ? '2px dashed #2563eb' : '2px dashed #cbd5e1',
                    background: dragActive ? '#eff6ff' : '#f8fafc',
                    padding: '28px 20px',
                    borderRadius: '10px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    marginBottom: '18px'
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFiles(e.target.files);
                      }
                    }}
                  />
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', marginBottom: '10px' }}>
                    {stagedPOs.length > 0 ? <Files size={24} /> : <FileText size={24} />}
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                    {uploadedFileName ? `Selected: ${uploadedFileName}` : 'Click to Browse or Drag & Drop Multiple Files Here'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Supports single or multiple Apple GSX Tax Invoice PDFs (e.g. MD04136487.pdf, MD04136490.pdf) or Excel / CSV
                  </div>

                  {isParsing && (
                    <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#2563eb', fontSize: '12.5px' }}>
                      <span className="spinner-border spinner-border-sm" />
                      <span>Parsing Apple GSX purchase order invoices and extracting parts tables...</span>
                    </div>
                  )}

                  {parseError && (
                    <div style={{ marginTop: '12px', color: '#dc2626', fontSize: '12px', fontWeight: 500 }}>
                      ⚠️ {parseError}
                    </div>
                  )}
                </div>

                {stagedPOs.length > 0 ? (
                  <div>
                    {/* Multi-PO Staging Batch Summary */}
                    <div style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '10px',
                      padding: '14px 18px',
                      marginBottom: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div>
                        <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Files size={17} />
                          <span>{stagedPOs.length} Purchase Orders Ready to Import</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#15803d', marginTop: '2px' }}>
                          Each PO will be registered in the system with expected parts and automatically saved in <strong>Parts Saved History Records</strong>.
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Expected Units</span>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                            {stagedPOs.reduce((s, p) => s + (p.totalUnits || 0), 0)} units
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Value</span>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a', fontFamily: 'var(--font-mono)' }}>
                            ${stagedPOs.reduce((s, p) => s + (p.calculatedTotal || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Staged PO Cards */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
                      {stagedPOs.map((staged, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#0f172a' }}>
                                  {staged.po_number || `PO #${idx + 1}`}
                                </span>
                                {staged.invoice_ref && (
                                  <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                                    Ref: {staged.invoice_ref}
                                  </span>
                                )}
                                <span className="badge badge-warning" style={{ fontSize: '11px' }}>
                                  Pending Arrival (0% received)
                                </span>
                                <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                                  • {staged.fileName}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                {staged.supplier || 'Apple South Asia Pte Ltd'} • {staged.items?.length || 0} part numbers • {staged.totalUnits || 0} units
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                                ${(staged.calculatedTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {staged.currency || 'USD'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveStagedPO(idx)}
                                style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px' }}
                                title="Remove PO from batch"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>

                          {/* Expected Part Chips */}
                          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                            {staged.items?.map((it, pIdx) => (
                              <div
                                key={pIdx}
                                style={{
                                  background: '#f8fafc',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '6px',
                                  padding: '3px 8px',
                                  fontSize: '11.5px',
                                  whiteSpace: 'nowrap',
                                  display: 'flex',
                                  gap: '6px',
                                  alignItems: 'center'
                                }}
                                title={it.description}
                              >
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#2563eb' }}>
                                  {it.part_number}
                                </span>
                                <span style={{ color: '#64748b' }}>
                                  ({it.quantity_ordered}x)
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Metadata Fields Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '18px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Customer P.O. Number *
                        </label>
                        <input
                          type="text"
                          className="form-control font-mono"
                          value={poNumber}
                          onChange={(e) => setPoNumber(e.target.value)}
                          placeholder="e.g. MDC202600024"
                          required
                          style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Tax Invoice / Reference No
                        </label>
                        <input
                          type="text"
                          className="form-control font-mono"
                          value={invoiceRef}
                          onChange={(e) => setInvoiceRef(e.target.value)}
                          placeholder="e.g. MD04136490"
                          style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Sales Order No
                        </label>
                        <input
                          type="text"
                          className="form-control font-mono"
                          value={salesOrderNo}
                          onChange={(e) => setSalesOrderNo(e.target.value)}
                          placeholder="e.g. AFB3459762"
                          style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Supplier
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={supplier}
                          onChange={(e) => setSupplier(e.target.value)}
                          placeholder="Apple South Asia Pte Ltd"
                          style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Document Date
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={orderDate}
                          onChange={(e) => setOrderDate(e.target.value)}
                          placeholder="YYYY-MM-DD or DD-MMM-YYYY"
                          style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                          Expected Arrival / Ship Date
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          value={expectedDate}
                          onChange={(e) => setExpectedDate(e.target.value)}
                          placeholder="YYYY-MM-DD or DD-MMM-YYYY"
                          style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: '18px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                        Remarks / GSX Web Order Details
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder="e.g. Web Order GS1006546576"
                        style={{ fontSize: '13px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                      />
                    </div>

                    {/* Line Items Table */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <label style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                          PO Line Items ({items.length} parts)
                        </label>
                        <button
                          type="button"
                          onClick={handleAddManualItem}
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px' }}
                        >
                          <Plus size={13} />
                          <span>Add Part</span>
                        </button>
                      </div>

                      {items.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '13px' }}>
                          No parts added yet. Upload a GSX invoice or click "Add Part" to add items.
                        </div>
                      ) : (
                        <div className="table-container" style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                          <table className="data-table" style={{ fontSize: '12px', width: '100%' }}>
                            <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                              <tr>
                                <th style={{ width: '130px', color: '#475569' }}>Part Number</th>
                                <th style={{ color: '#475569' }}>Description</th>
                                <th style={{ width: '80px', textAlign: 'center', color: '#475569' }}>Qty</th>
                                <th style={{ width: '90px', textAlign: 'right', color: '#475569' }}>Unit Price</th>
                                <th style={{ width: '90px', textAlign: 'right', color: '#475569' }}>Ext. Total</th>
                                <th style={{ width: '40px', textAlign: 'center' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((it, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td>
                                    <input
                                      type="text"
                                      className="form-control font-mono"
                                      value={it.part_number}
                                      onChange={(e) => handleItemChange(idx, 'part_number', e.target.value.toUpperCase())}
                                      style={{ height: '30px', fontSize: '12px', padding: '2px 8px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      className="form-control"
                                      value={it.description}
                                      onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                                      style={{ height: '30px', fontSize: '12px', padding: '2px 8px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      min="1"
                                      className="form-control font-mono"
                                      value={it.quantity_ordered}
                                      onChange={(e) => handleItemChange(idx, 'quantity_ordered', e.target.value)}
                                      style={{ height: '30px', fontSize: '12px', textAlign: 'center', padding: '2px 6px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="form-control font-mono"
                                      value={it.unit_price}
                                      onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
                                      style={{ height: '30px', fontSize: '12px', textAlign: 'right', padding: '2px 6px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a' }}
                                    />
                                  </td>
                                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#0f172a', fontWeight: 600 }}>
                                    ${(Number(it.quantity_ordered || 0) * Number(it.unit_price || 0)).toFixed(2)}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteItem(idx)}
                                      style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px' }}
                                      title="Delete Item"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Modal Footer */}
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                {stagedPOs.length > 0 ? (
                  <>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      Ready to import <strong style={{ color: '#0f172a' }}>{stagedPOs.length} Purchase Orders</strong> ({stagedPOs.reduce((s, p) => s + (p.totalUnits || 0), 0)} total units)
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setIsUploadModalOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleBatchImportAll}
                        disabled={isBatchImporting || stagedPOs.length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        {isBatchImporting ? <span className="spinner-border spinner-border-sm" /> : <UploadCloud size={16} />}
                        <span>Import All {stagedPOs.length} Purchase Orders</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                      Total Parts: <strong style={{ color: '#0f172a' }}>{items.length}</strong> | Total Units: <strong style={{ color: '#0f172a' }}>{items.reduce((s, it) => s + (Number(it.quantity_ordered) || 0), 0)}</strong> | Value: <strong style={{ color: '#0f172a' }}>${items.reduce((s, it) => s + ((Number(it.quantity_ordered) || 0) * (Number(it.unit_price) || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</strong>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setIsUploadModalOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={items.length === 0 || !poNumber.trim() || isParsing}
                      >
                        Confirm & Save Purchase Order
                      </button>
                    </div>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
