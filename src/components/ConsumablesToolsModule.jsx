import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Wrench,
  PackageCheck,
  Truck,
  Download,
  Printer,
  FileText,
  AlertTriangle,
  CheckCircle2,
  QrCode,
  ScanLine,
  ArrowRightLeft,
  Pencil,
  Trash2,
  Search,
  Plus,
  X,
  FileSpreadsheet,
  Check,
  Building2,
  MapPin
} from 'lucide-react';
import { getSiteColorTheme } from '../utils/ctSpreadsheetImporter';
import { useApp } from '../context/AppContext';
import {
  getSitePackingCandidates,
  normalizePartNumber,
  parseSerialTokens,
  validateAndScanPackItem,
  isValidGsPoNumber,
  generateNextGsPoNumber
} from '../utils/consumablesToolsEngine';
import {
  exportCtCenterToExcel,
  exportCtMovementsToExcel
} from '../utils/ctExcelExporter';
import { barcodeAudio } from '../utils/barcodeAudio';
import {
  generateConsumablesToolsPackingListPDF,
  generateConsumablesToolsPackingListPdfBytes,
  printConsumablesToolsPackingListDirect
} from '../utils/pdfGenerator';
import { uploadCtPackingListToDrive } from '../services/driveAutoSyncService';
import { formatTo12HourTime } from '../utils/dateUtils';
import ToolLabelPrintModal from './ToolLabelPrintModal';
import CtSpreadsheetImportModal from './CtSpreadsheetImportModal';

export default function ConsumablesToolsModule({ initialSection = 'assets' }) {
  const {
    ctCatalog = [],
    rawCtCatalog = [],
    ctOrders = [],
    ctStock = [],
    ctToolAssets = [],
    ctMovements = [],
    ctShipments = [],
    ctPdfImports = [],
    sites = [],
    currentUser,
    canEdit,
    showToast,
    saveCtCatalogItem,
    deleteCtCatalogItem,
    clearCtCatalog,
    updateCtStockRecord,
    addCtOrder,
    updateCtOrder,
    deleteCtOrder,
    receiveCtOrderLine,
    commitCtPdfImport,
    openCtSourcePdf,
    checkoutTool,
    checkinTool,
    updateToolStatus,
    updateToolMetadata,
    consumeCtStock,
    createCtShipment,
    confirmCtDelivery,
    attachCtShipmentDocument,
    importPriorityCsvText
  } = useApp();

  const normalizeSection = (sec) => (sec === 'catalog' ? 'assets' : sec || 'assets');
  const [section, setSection] = useState(() => normalizeSection(initialSection));
  const [pdfImportModalOpen, setPdfImportModalOpen] = useState(false);

  // Sub-tabs inside main Consumables & Tools page (Combined Multi-Site, Tool Assets, Consumables Stock, Complete Catalog)
  const [assetsSubTab, setAssetsSubTab] = useState('combined'); // 'combined' | 'assets' | 'consumables' | 'catalog'
  const [centerRegionFilter, setCenterRegionFilter] = useState('ALL'); // 'ALL' | 'Metro Manila' | 'Province'
  const [catalogKindFilter, setCatalogKindFilter] = useState('all'); // 'all' | 'tool' | 'consumable'
  const [catalogSearch, setCatalogSearch] = useState('');
  const [editingCatalogId, setEditingCatalogId] = useState(null);
  const [editCatForm, setEditCatForm] = useState({ part_number: '', description: '', item_kind: 'tool', unit_cost: 0 });
  const [addingCatalogItem, setAddingCatalogItem] = useState(false);
  const [newCatForm, setNewCatForm] = useState({ part_number: '', description: '', item_kind: 'tool', unit_cost: 0 });

  // Consumables stock inline editing
  const [consumableSearch, setConsumableSearch] = useState('');
  const [editingStockId, setEditingStockId] = useState(null);
  const [editStockForm, setEditStockForm] = useState({ description: '', qty_on_hand: 0, min_stock_threshold: 2 });
  useEffect(() => {
    if (initialSection) setSection(normalizeSection(initialSection));
  }, [initialSection]);

  const userCanEdit = typeof canEdit === 'function' ? canEdit() : true;

  // Check if Scan-In routed a consumable/tool PN here via localStorage handoff
  useEffect(() => {
    try {
      const pendingPn = localStorage.getItem('mdc_ct_pending_receive_pn');
      if (pendingPn) {
        localStorage.removeItem('mdc_ct_pending_receive_pn');
        setSection('orders_receiving');
        setRecvPn(pendingPn);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  // --- Shared Filters & Modals ---
  const [siteFilter, setSiteFilter] = useState('ALL');
  const [labelAssetsModal, setLabelAssetsModal] = useState([]);

  // --- Quick Consume Form ---
  const [consumeModalOpen, setConsumeModalOpen] = useState(false);
  const [consumePn, setConsumePn] = useState('');
  const [consumeSiteCode, setConsumeSiteCode] = useState('DC-MDC');
  const [consumeQty, setConsumeQty] = useState('1');
  const [consumeNotes, setConsumeNotes] = useState('');

  // --- Orders & Receiving State ---
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [poDropdownQuery, setPoDropdownQuery] = useState('');
  const [poDropdownOpen, setPoDropdownOpen] = useState(false);
  const poDropdownRef = useRef(null);
  const [recvPn, setRecvPn] = useState('');
  const [recvQty, setRecvQty] = useState('1');
  const [recvSerials, setRecvSerials] = useState('');
  const [recvSiteCode, setRecvSiteCode] = useState('DC-MDC');
  const [recvNotes, setRecvNotes] = useState('');
  const [recvFeedback, setRecvFeedback] = useState(null);
  const [showCreatePoModal, setShowCreatePoModal] = useState(false);
  const [editingPoId, setEditingPoId] = useState(null);
  const [poPartSearch, setPoPartSearch] = useState('');
  const [poPartFilter, setPoPartFilter] = useState('ALL'); // ALL | consumable | tool
  const [deleteConfirmPo, setDeleteConfirmPo] = useState(null);
  const [newPoForm, setNewPoForm] = useState({
    po_number: '',
    site_code: 'DC-MDC',
    supplier: 'Apple South Asia Pte Ltd',
    remarks: '',
    items: []
  });

  // --- Tool Assets Filter, Inline Edit & Checkout State ---
  const [assetStatusFilter, setAssetStatusFilter] = useState('ALL');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetAssigneeInput, setAssetAssigneeInput] = useState('');
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [editAdminTag, setEditAdminTag] = useState('');
  const [editAssignedTo, setEditAssignedTo] = useState('');
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // --- Shipping & Packing List State ---
  const [shipFromSite, setShipFromSite] = useState('DC-MDC');
  const [shipToSite, setShipToSite] = useState('');
  const [shipCarrier, setShipCarrier] = useState('Lalamove');
  const [shipFreightMode, setShipFreightMode] = useState('Air');
  const [shipTracking, setShipTracking] = useState('');
  const [shipTsNumber, setShipTsNumber] = useState('');
  const [shipNotes, setShipNotes] = useState('');
  const [shipSignature, setShipSignature] = useState('');
  const [shipLines, setShipLines] = useState([]);
  const [addLinePn, setAddLinePn] = useState('');
  const [addLineQty, setAddLineQty] = useState('1');
  const [addLineSourceSite, setAddLineSourceSite] = useState('');
  const [addLineAssetIds, setAddLineAssetIds] = useState([]);
  const [candidateSourceTab, setCandidateSourceTab] = useState('site'); // 'site' | 'from'
  const [manualPnMode, setManualPnMode] = useState(false);
  const [packScanInput, setPackScanInput] = useState('');
  const [packSerialInput, setPackSerialInput] = useState('');
  const [pendingScanPn, setPendingScanPn] = useState('');
  const [packScanFeedback, setPackScanFeedback] = useState(null);
  const [packAutoAdd, setPackAutoAdd] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_ct_pack_auto_add');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [requireScanVerification, setRequireScanVerification] = useState(true);
  const packScanRef = useRef(null);
  const packSerialRef = useRef(null);
  const autoPackTimerRef = useRef(null);
  const [deliveryModalShipment, setDeliveryModalShipment] = useState(null);
  const [deliveryReceiverName, setDeliveryReceiverName] = useState('');
  const [deliveryPlFile, setDeliveryPlFile] = useState(null);
  const [isUploadingDeliveryPl, setIsUploadingDeliveryPl] = useState(false);
  const [downloadChoiceShipment, setDownloadChoiceShipment] = useState(null);
  const [detailsShipment, setDetailsShipment] = useState(null);

  // --- History Filter State ---
  const [historyActionFilter, setHistoryActionFilter] = useState('ALL');
  const [historyRegionFilter, setHistoryRegionFilter] = useState('ALL');
  const [historySiteFilter, setHistorySiteFilter] = useState('ALL');
  const [historyViewMode, setHistoryViewMode] = useState('combined'); // 'combined' | 'shipments' | 'movements'
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historyDisplayLimit, setHistoryDisplayLimit] = useState(50);

  // --- Center Table Pagination (Hard limit: max 50 records per page to prevent endless scrolling) ---
  const MAX_RECORDS_PER_PAGE = 50;
  const centerFilterKey = `${assetsSubTab}|${siteFilter}|${centerRegionFilter}|${assetStatusFilter}|${assetSearch}|${consumableSearch}|${catalogSearch}|${catalogKindFilter}`;
  const [centerPagination, setCenterPagination] = useState({ key: '', page: 1 });
  const activeCenterPage = centerPagination.key === centerFilterKey ? centerPagination.page : 1;
  const setCenterPage = (nextPage) => setCenterPagination({ key: centerFilterKey, page: Math.max(1, nextPage) });

  const paginateCenterRows = (rows) => {
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / MAX_RECORDS_PER_PAGE));
    const safePage = Math.min(activeCenterPage, totalPages);
    const startIdx = (safePage - 1) * MAX_RECORDS_PER_PAGE;
    const endIdx = Math.min(startIdx + MAX_RECORDS_PER_PAGE, total);
    return {
      pageRows: rows.slice(startIdx, endIdx),
      total,
      totalPages,
      safePage,
      startIdx,
      endIdx
    };
  };

  const renderCenterPaginationBar = ({ total, totalPages, safePage, startIdx, endIdx }) => {
    if (total === 0) return null;
    return (
      <div
        style={{
          padding: '12px 18px',
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          fontSize: '12px',
          color: '#475569'
        }}
      >
        <div>
          Showing <strong>{startIdx + 1}–{endIdx}</strong> of <strong>{total}</strong> records{' '}
          <span style={{ color: '#64748b' }}>(max {MAX_RECORDS_PER_PAGE} per page)</span>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 1}
              onClick={() => setCenterPage(1)}
              style={{ padding: '4px 9px', fontSize: '11.5px' }}
            >
              First
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 1}
              onClick={() => setCenterPage(safePage - 1)}
              style={{ padding: '4px 10px', fontSize: '11.5px' }}
            >
              Prev
            </button>
            <span style={{ padding: '0 8px', fontWeight: 700, color: '#0f172a' }}>
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setCenterPage(safePage + 1)}
              style={{ padding: '4px 10px', fontSize: '11.5px' }}
            >
              Next
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= totalPages}
              onClick={() => setCenterPage(totalPages)}
              style={{ padding: '4px 9px', fontSize: '11.5px' }}
            >
              Last
            </button>
          </div>
        )}
      </div>
    );
  };

  // --- Derived Metrics ---
  const kpis = useMemo(() => {
    const openOrdersCount = ctOrders.filter(o => o.status !== 'received' && o.status !== 'closed').length;
    const totalAssets = ctToolAssets.length;
    const availableAssets = ctToolAssets.filter(a => a.status === 'available').length;
    const inUseAssets = ctToolAssets.filter(a => a.status === 'in_use').length;
    const consumablesOnHand = (ctStock || [])
      .filter(r => r.item_kind !== 'tool')
      .reduce((sum, r) => sum + (Number(r.qty_on_hand) || 0), 0);
    return {
      openOrdersCount,
      totalAssets,
      availableAssets,
      inUseAssets,
      consumablesOnHand,
      shipmentsCount: ctShipments.length
    };
  }, [ctOrders, ctToolAssets, ctStock, ctShipments]);

  const inStockConsumables = useMemo(
    () => (ctStock || []).filter(r => (Number(r.qty_on_hand) || 0) > 0),
    [ctStock]
  );

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return (ctOrders || []).filter(o => {
      if (!q) return true;
      const itemsText = (o.items || []).map(it => `${it.part_number} ${it.description}`).join(' ');
      return `${o.po_number} ${o.order_number || ''} ${o.site_code || ''} ${itemsText}`.toLowerCase().includes(q);
    });
  }, [ctOrders, orderSearch]);

  const activeReceivingOrder = useMemo(
    () => ctOrders.find(o => o.id === selectedOrderId) || null,
    [ctOrders, selectedOrderId]
  );

  useEffect(() => {
    if (!poDropdownOpen) return undefined;
    const handleOutsideClick = (e) => {
      if (poDropdownRef.current && !poDropdownRef.current.contains(e.target)) {
        setPoDropdownOpen(false);
        setPoDropdownQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [poDropdownOpen]);

  const linkedOrderMatches = useMemo(() => {
    const q = poDropdownQuery.trim().toLowerCase();
    return (ctOrders || []).filter(o => {
      if (!q) return true;
      return `${o.po_number || ''} ${o.order_number || ''} ${o.site_code || ''} ${o.status || ''}`.toLowerCase().includes(q);
    });
  }, [ctOrders, poDropdownQuery]);

  const handleSelectLinkedOrder = (orderId) => {
    const ord = ctOrders.find(o => o.id === orderId);
    setSelectedOrderId(orderId);
    setPoDropdownOpen(false);
    setPoDropdownQuery('');
    if (ord?.site_code) setRecvSiteCode(ord.site_code);
    if (ord?.items?.length === 1) {
      setRecvPn(ord.items[0].part_number);
      const openQty = Math.max(1, (ord.items[0].quantity_ordered || 1) - (ord.items[0].quantity_received || 0));
      setRecvQty(String(openQty));
    }
  };

  const catalogByPnMap = useMemo(() => {
    const map = new Map();
    (ctCatalog || []).forEach(c => {
      if (c?.part_number) {
        map.set(normalizePartNumber(c.part_number), c);
      }
    });
    return map;
  }, [ctCatalog]);

  const matchedCatalogForReceive = useMemo(() => {
    const clean = normalizePartNumber(recvPn);
    return catalogByPnMap.get(clean) || null;
  }, [catalogByPnMap, recvPn]);

  const parsedRecvSerialPreview = useMemo(() => parseSerialTokens(recvSerials), [recvSerials]);

  const siteRegionMap = useMemo(() => {
    const map = new Map();
    (sites || []).forEach(s => {
      const code = s.site_code || s.code;
      if (code) map.set(String(code).toUpperCase(), s.region || 'Province');
    });
    map.set('DC-MDC', 'Metro Manila');
    return map;
  }, [sites]);

  const filteredAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    return (ctToolAssets || [])
      .filter(a => {
        if (assetStatusFilter !== 'ALL' && a.status !== assetStatusFilter) return false;
        const code = String(a.site_code || 'UNASSIGNED').trim().toUpperCase();
        const reg = siteRegionMap.get(code) === 'Metro Manila' ? 'Metro Manila' : 'Province';
        if (centerRegionFilter !== 'ALL' && reg !== centerRegionFilter) return false;
        if (siteFilter !== 'ALL' && code !== siteFilter.toUpperCase()) return false;
        if (q) {
          const ownership = a.ownership_tag || 'Apple-Owned';
          const hay = `${a.asset_tag} ${ownership} ${a.serial_number || ''} ${a.part_number} ${a.description} ${a.assigned_to || ''} ${code}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const siteCmp = String(a.site_code || '').localeCompare(String(b.site_code || ''));
        if (siteCmp !== 0) return siteCmp;
        const pnCmp = String(a.part_number || '').localeCompare(String(b.part_number || ''));
        if (pnCmp !== 0) return pnCmp;
        return String(a.asset_tag || '').localeCompare(String(b.asset_tag || ''));
      });
  }, [ctToolAssets, assetStatusFilter, centerRegionFilter, siteFilter, assetSearch, siteRegionMap]);

  // Multi-Site Dashboard Rollup (sorted A -> Z by Site Code, split by Metro Manila vs Provincial)
  const multiSiteOverview = useMemo(() => {
    const map = new Map();
    const ensure = (rawCode) => {
      const code = String(rawCode || 'UNASSIGNED').trim().toUpperCase();
      if (!map.has(code)) {
        const reg = siteRegionMap.get(code) || 'Province';
        map.set(code, {
          code,
          region: reg === 'Metro Manila' ? 'Metro Manila' : 'Province',
          toolsCount: 0,
          consumablesQty: 0,
          totalUnits: 0
        });
      }
      return map.get(code);
    };

    (ctToolAssets || []).forEach(a => {
      const b = ensure(a.site_code);
      b.toolsCount += 1;
      b.totalUnits += 1;
    });
    (ctStock || []).forEach(s => {
      if (s.item_kind === 'tool') return;
      const qty = Number(s.qty_on_hand) || 0;
      if (qty <= 0) return;
      const b = ensure(s.site_code);
      b.consumablesQty += qty;
      b.totalUnits += qty;
    });

    const allSorted = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
    const metroManila = allSorted.filter(s => s.region === 'Metro Manila');
    const provincial = allSorted.filter(s => s.region !== 'Metro Manila');
    return {
      allSorted,
      metroManila,
      provincial,
      metroUnits: metroManila.reduce((sum, s) => sum + s.totalUnits, 0),
      provincialUnits: provincial.reduce((sum, s) => sum + s.totalUnits, 0),
      totalUnits: allSorted.reduce((sum, s) => sum + s.totalUnits, 0)
    };
  }, [ctToolAssets, ctStock, siteRegionMap]);

  // Unified Combined Single-View rows (Tools + Consumables sorted by Site A->Z, Tools first, then Part #)
  const combinedInventoryRows = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    const rows = [];

    (ctToolAssets || []).forEach(a => {
      const code = String(a.site_code || 'UNASSIGNED').trim().toUpperCase();
      const reg = siteRegionMap.get(code) === 'Metro Manila' ? 'Metro Manila' : 'Province';
      if (centerRegionFilter !== 'ALL' && reg !== centerRegionFilter) return;
      if (siteFilter !== 'ALL' && code !== siteFilter.toUpperCase()) return;
      const ownership = a.ownership_tag || 'Apple-Owned';
      if (q) {
        const hay = `${code} ${a.part_number || ''} ${a.description || ''} ${a.asset_tag || ''} ${a.serial_number || ''} ${ownership} ${a.source_pdf_ref || ''}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      rows.push({
        id: `tool-${a.id}`,
        site_code: code,
        item_kind: 'tool',
        part_number: a.part_number,
        description: a.description,
        asset_tag: a.asset_tag,
        ownership_tag: ownership,
        serial_number: a.serial_number || '—',
        qty: 1,
        status: a.status || 'available',
        source_ref: a.source_pdf_ref || null,
        source_import_id: a.source_pdf_import_id || null
      });
    });

    (ctStock || []).forEach(s => {
      if (s.item_kind === 'tool') return;
      const qty = Number(s.qty_on_hand) || 0;
      if (qty <= 0) return;
      const code = String(s.site_code || 'UNASSIGNED').trim().toUpperCase();
      const reg = siteRegionMap.get(code) === 'Metro Manila' ? 'Metro Manila' : 'Province';
      if (centerRegionFilter !== 'ALL' && reg !== centerRegionFilter) return;
      if (siteFilter !== 'ALL' && code !== siteFilter.toUpperCase()) return;
      const ownership = s.ownership_tag || 'Apple-Owned';
      if (q) {
        const hay = `${code} ${s.part_number || ''} ${s.description || ''} consumable ${ownership} ${s.last_source_pdf_ref || ''}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      rows.push({
        id: `cons-${s.id}`,
        site_code: code,
        item_kind: 'consumable',
        part_number: s.part_number,
        description: s.description,
        asset_tag: null,
        ownership_tag: ownership,
        serial_number: '—',
        qty,
        status: 'in_stock',
        source_ref: s.last_source_pdf_ref || null,
        source_import_id: s.last_source_pdf_import_id || null
      });
    });

    return rows.sort((a, b) => {
      const siteCmp = a.site_code.localeCompare(b.site_code);
      if (siteCmp !== 0) return siteCmp;
      if (a.item_kind !== b.item_kind) return a.item_kind === 'tool' ? -1 : 1;
      return String(a.part_number || '').localeCompare(String(b.part_number || ''));
    });
  }, [ctToolAssets, ctStock, siteRegionMap, centerRegionFilter, siteFilter, assetSearch]);

  const formatMovementDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  const filteredHistoryShipments = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return (ctShipments || []).filter(shp => {
      const toCode = String(shp.to_site_code || '').toUpperCase();
      const fromCode = String(shp.from_site_code || '').toUpperCase();
      if (historySiteFilter !== 'ALL' && toCode !== historySiteFilter.toUpperCase() && fromCode !== historySiteFilter.toUpperCase()) {
        return false;
      }
      if (historyRegionFilter !== 'ALL') {
        const reg = siteRegionMap.get(toCode) || 'Province';
        if (reg !== historyRegionFilter) return false;
      }
      const shpDate = String(shp.shipment_date || shp.created_at || '').slice(0, 10);
      if (historyDateFrom && shpDate && shpDate < historyDateFrom) return false;
      if (historyDateTo && shpDate && shpDate > historyDateTo) return false;
      if (q) {
        const itemsText = (shp.items || []).map(it => `${it.part_number} ${it.description || ''} ${(it.serial_numbers || []).join(' ')}`).join(' ');
        const hay = `${shp.packing_list_number || ''} ${shp.shipment_number || ''} ${shp.ts_number || ''} ${shp.to_site_code || ''} ${shp.to_site_name || ''} ${shp.carrier || ''} ${shp.tracking_number || ''} ${shp.prepared_by_name || ''} ${shp.received_by_name || ''} ${itemsText}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ctShipments, historySearch, historySiteFilter, historyRegionFilter, historyDateFrom, historyDateTo, siteRegionMap]);

  const baseFilteredMovements = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return (ctMovements || []).filter(m => {
      const toCode = String(m.to_site_code || '').toUpperCase();
      const fromCode = String(m.from_site_code || '').toUpperCase();
      if (historySiteFilter !== 'ALL' && toCode !== historySiteFilter.toUpperCase() && fromCode !== historySiteFilter.toUpperCase()) {
        return false;
      }
      if (historyRegionFilter !== 'ALL') {
        const toReg = siteRegionMap.get(toCode);
        const fromReg = siteRegionMap.get(fromCode);
        if (toReg !== historyRegionFilter && fromReg !== historyRegionFilter) return false;
      }
      const movDate = String(m.created_at || '').slice(0, 10);
      if (historyDateFrom && movDate && movDate < historyDateFrom) return false;
      if (historyDateTo && movDate && movDate > historyDateTo) return false;
      if (q) {
        const hay = `${m.part_number} ${m.description || ''} ${m.reference_number || ''} ${m.from_site_code || ''} ${m.to_site_code || ''} ${m.performed_by_name || ''} ${m.notes || ''} ${(m.serial_numbers || []).join(' ')} ${(m.asset_tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ctMovements, historySiteFilter, historyRegionFilter, historyDateFrom, historyDateTo, historySearch, siteRegionMap]);

  const movementActionCounts = useMemo(() => {
    const counts = { ALL: baseFilteredMovements.length };
    baseFilteredMovements.forEach(m => {
      const k = String(m.action || 'other').toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }, [baseFilteredMovements]);

  const filteredMovements = useMemo(() => {
    if (historyActionFilter === 'ALL') return baseFilteredMovements;
    return baseFilteredMovements.filter(m => m.action === historyActionFilter);
  }, [baseFilteredMovements, historyActionFilter]);

  const historyStats = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const shippedInTransit = filteredHistoryShipments.filter(s => s.status !== 'delivered');
    const deliveredConfirmed = filteredHistoryShipments.filter(s => s.status === 'delivered');
    const todayMovements = filteredMovements.filter(m => String(m.created_at || '').slice(0, 10) === todayIso);
    return {
      totalMovements: filteredMovements.length,
      shippedCount: shippedInTransit.length,
      shippedUnits: shippedInTransit.reduce((sum, s) => sum + (s.items || []).reduce((a, b) => a + (Number(b.quantity) || 0), 0), 0),
      deliveredCount: deliveredConfirmed.length,
      deliveredUnits: deliveredConfirmed.reduce((sum, s) => sum + (s.items || []).reduce((a, b) => a + (Number(b.quantity) || 0), 0), 0),
      todayCount: todayMovements.length
    };
  }, [filteredHistoryShipments, filteredMovements]);

  const siteChoices = useMemo(() => {
    const map = new Map();
    (sites || []).forEach(s => {
      if (s.code) map.set(s.code, s);
    });
    if (!map.has('DC-MDC')) {
      map.set('DC-MDC', {
        code: 'DC-MDC',
        name: 'Distribution Center (DC-MDC)',
        address: '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila'
      });
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [sites]);

  // --- Handlers ---
  const handleConfirmConsume = (e) => {
    e.preventDefault();
    const targetPn = normalizePartNumber(consumePn);
    if (!targetPn) return;
    const res = consumeCtStock({
      partNumber: targetPn,
      siteCode: consumeSiteCode,
      quantity: parseInt(consumeQty, 10) || 1,
      notes: consumeNotes
    });
    if (res.ok) {
      setConsumeModalOpen(false);
      setConsumePn('');
      setConsumeQty('1');
      setConsumeNotes('');
    }
  };

  const handleExecuteReceive = (e) => {
    e.preventDefault();
    setRecvFeedback(null);
    const serialsList = parseSerialTokens(recvSerials).serials;
    const res = receiveCtOrderLine({
      orderId: activeReceivingOrder?.id || null,
      partNumber: recvPn,
      deliveredQty: parseInt(recvQty, 10),
      scannedSerials: serialsList,
      siteCode: recvSiteCode || activeReceivingOrder?.site_code || 'DC-MDC',
      allowOverDelivery: true,
      allowAdHoc: !activeReceivingOrder,
      notes: recvNotes
    });
    setRecvFeedback(res);
    if (res.ok) {
      setRecvSerials('');
      setRecvNotes('');
    }
  };

  const handlePriorityReimport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      importPriorityCsvText(text);
    } catch (err) {
      showToast?.(`Failed to import Priority CSV: ${err.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  };

  const poCatalogMatches = useMemo(() => {
    const q = poPartSearch.trim().toLowerCase();
    const filtered = (ctCatalog || []).filter(item => {
      if (poPartFilter !== 'ALL' && item.item_kind !== poPartFilter) return false;
      if (!q) return true;
      return `${item.part_number} ${item.description || ''} ${item.category || ''}`.toLowerCase().includes(q);
    });
    return {
      total: filtered.length,
      items: filtered.slice(0, 250)
    };
  }, [ctCatalog, poPartSearch, poPartFilter]);

  const openNewPoModal = () => {
    setEditingPoId(null);
    setPoPartSearch('');
    setPoPartFilter('ALL');
    setNewPoForm({
      po_number: generateNextGsPoNumber(ctOrders),
      site_code: 'DC-MDC',
      supplier: 'Apple South Asia Pte Ltd',
      remarks: '',
      items: []
    });
    setShowCreatePoModal(true);
  };

  const openEditPoModal = (ord) => {
    setEditingPoId(ord.id);
    setPoPartSearch('');
    setPoPartFilter('ALL');
    setNewPoForm({
      po_number: ord.po_number || '',
      site_code: ord.site_code || 'DC-MDC',
      supplier: ord.supplier || 'Apple South Asia Pte Ltd',
      remarks: ord.remarks || '',
      items: (ord.items || []).map(it => ({
        id: it.id,
        part_number: it.part_number,
        description: it.description,
        item_kind: it.item_kind || 'consumable',
        quantity_ordered: Number(it.quantity_ordered) || 1,
        quantity_received: Number(it.quantity_received) || 0,
        unit_cost: Number(it.unit_cost) || 0
      }))
    });
    setShowCreatePoModal(true);
  };

  const handleAddPartToPoForm = (part) => {
    const cleanPn = normalizePartNumber(part.part_number);
    setNewPoForm(f => {
      const idx = f.items.findIndex(it => normalizePartNumber(it.part_number) === cleanPn);
      if (idx >= 0) {
        const nextItems = [...f.items];
        nextItems[idx] = {
          ...nextItems[idx],
          quantity_ordered: (Number(nextItems[idx].quantity_ordered) || 1) + 1
        };
        return { ...f, items: nextItems };
      }
      return {
        ...f,
        items: [
          ...f.items,
          {
            part_number: cleanPn,
            description: part.description || cleanPn,
            item_kind: part.item_kind || 'consumable',
            quantity_ordered: 1,
            quantity_received: 0,
            unit_cost: Number(part.unit_cost) || 0
          }
        ]
      };
    });
  };

  const handleCreatePo = (e) => {
    e.preventDefault();
    const cleanPo = String(newPoForm.po_number || '').trim().toUpperCase();
    if (!isValidGsPoNumber(cleanPo)) {
      showToast?.('Invalid PO Number format. Must start with GS followed by 10 digits (e.g. GS1003315365).', 'error');
      return;
    }
    if (!newPoForm.items || newPoForm.items.length === 0) {
      showToast?.('Select at least one part to include in the Purchase Order.', 'error');
      return;
    }
    const payload = {
      po_number: newPoForm.po_number,
      site_code: newPoForm.site_code,
      supplier: newPoForm.supplier,
      remarks: newPoForm.remarks,
      items: newPoForm.items
    };
    const res = editingPoId ? updateCtOrder(editingPoId, payload) : addCtOrder(payload);
    if (res.ok) {
      setShowCreatePoModal(false);
      setEditingPoId(null);
      if (res.order?.id) setSelectedOrderId(res.order.id);
      setNewPoForm({
        po_number: '',
        site_code: 'DC-MDC',
        supplier: 'Apple South Asia Pte Ltd',
        remarks: '',
        items: []
      });
    }
  };

  const handleExportMovementsCsv = () => {
    const header = ['Date', 'Time', 'Action', 'Part Number', 'Description', 'Kind', 'Qty', 'From', 'To', 'Serials', 'Asset Tags', 'Reference', 'User', 'Notes'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      header.map(escape).join(','),
      ...filteredMovements.map(m =>
        [
          formatMovementDate(m.created_at),
          formatTo12HourTime ? formatTo12HourTime(m.created_at) : m.created_at,
          m.action,
          m.part_number,
          m.description || '',
          m.item_kind,
          m.quantity,
          m.from_site_code || '',
          m.to_site_code || '',
          (m.serial_numbers || []).join(' '),
          (m.asset_tags || []).join(' '),
          m.reference_number || '',
          m.performed_by_name || '',
          m.notes || ''
        ]
          .map(escape)
          .join(',')
      )
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MDC_Consumables_Tools_History_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMovementsExcel = async () => {
    setIsExportingExcel(true);
    try {
      const fileName = await exportCtMovementsToExcel({
        movements: filteredMovements,
        shipments: filteredHistoryShipments,
        siteRegionMap,
        regionFilter: historyRegionFilter,
        siteFilter: historySiteFilter,
        actionFilter: historyActionFilter,
        dateFrom: historyDateFrom,
        dateTo: historyDateTo,
        searchQuery: historySearch,
        generatedBy: currentUser?.fullName || currentUser?.email || 'Admin'
      });
      showToast?.(`Exported ${fileName}`, 'success');
    } catch (err) {
      showToast?.(`Excel export failed: ${err?.message || err}`, 'error');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportCenterExcel = async () => {
    setIsExportingExcel(true);
    try {
      const fileName = await exportCtCenterToExcel({
        toolAssets: ctToolAssets,
        consumablesStock: ctStock,
        catalog: ctCatalog,
        siteFilter,
        statusFilter: assetStatusFilter,
        searchQuery: assetSearch,
        generatedBy: currentUser?.fullName || currentUser?.email || 'Admin'
      });
      showToast?.(`Exported ${fileName}`, 'success');
    } catch (err) {
      showToast?.(`Excel export failed: ${err?.message || err}`, 'error');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const startEditAsset = (asset) => {
    if (!userCanEdit) return;
    setEditingAssetId(asset.id);
    // Admin Asset Tag reserved for future Cables category; Tools default to Apple-Owned Ownership Tag
    setEditAdminTag(asset.ownership_tag || 'Apple-Owned');
    setEditAssignedTo(asset.assigned_to || '');
  };

  const cancelEditAsset = () => {
    setEditingAssetId(null);
    setEditAdminTag('');
    setEditAssignedTo('');
  };

  const saveEditAsset = (asset) => {
    if (!updateToolMetadata) return;
    const res = updateToolMetadata({
      assetId: asset.id,
      ownershipTag: editAdminTag || 'Apple-Owned',
      assignedTo: editAssignedTo
    });
    if (res?.ok) {
      cancelEditAsset();
    }
  };

  // --- Shipping Builder Helpers (Site-Filtered Packing Candidates) ---
  const sitePackingCandidates = useMemo(() => {
    return getSitePackingCandidates({
      targetSiteCode: shipToSite,
      fromSiteCode: shipFromSite,
      catalogItems: ctCatalog,
      stockRows: ctStock,
      toolAssets: ctToolAssets,
      orders: ctOrders,
      existingShipments: ctShipments
    });
  }, [shipToSite, shipFromSite, ctCatalog, ctStock, ctToolAssets, ctOrders, ctShipments]);

  const siteReadyCounts = useMemo(() => {
    const counts = new Map();
    (ctStock || []).forEach(r => {
      if ((Number(r.qty_on_hand) || 0) <= 0 || !r.site_code) return;
      const code = String(r.site_code).toUpperCase();
      if (!counts.has(code)) counts.set(code, new Set());
      counts.get(code).add(normalizePartNumber(r.part_number));
    });
    (ctToolAssets || []).forEach(a => {
      if (a.status !== 'available' || !a.site_code) return;
      const code = String(a.site_code).toUpperCase();
      if (!counts.has(code)) counts.set(code, new Set());
      counts.get(code).add(normalizePartNumber(a.part_number));
    });
    const out = {};
    counts.forEach((set, code) => { out[code] = set.size; });
    return out;
  }, [ctStock, ctToolAssets]);

  const effectiveCandidateTab =
    candidateSourceTab === 'from' && sitePackingCandidates.fromCandidates.length > 0
      ? 'from'
      : sitePackingCandidates.siteCandidates.length > 0
        ? 'site'
        : sitePackingCandidates.fromCandidates.length > 0
          ? 'from'
          : 'site';

  const activeCandidatePool = useMemo(() => {
    const rawList =
      effectiveCandidateTab === 'from'
        ? sitePackingCandidates.fromCandidates
        : sitePackingCandidates.siteCandidates;

    // Subtract quantities already staged in shipLines
    const stagedQtyByKey = new Map();
    const stagedAssetIds = new Set();
    (shipLines || []).forEach(ln => {
      const key = `${normalizePartNumber(ln.part_number)}::${String(ln.sourceSiteCode || shipFromSite).toUpperCase()}`;
      stagedQtyByKey.set(key, (stagedQtyByKey.get(key) || 0) + (Number(ln.quantity) || 0));
      (ln.assetIds || []).forEach(id => stagedAssetIds.add(id));
    });

    return rawList.map(cand => {
      const key = `${normalizePartNumber(cand.part_number)}::${String(cand.sourceSiteCode || shipFromSite).toUpperCase()}`;
      const stagedQty = stagedQtyByKey.get(key) || 0;
      const remainingQty = Math.max(0, (Number(cand.availableQty) || 0) - stagedQty);
      const remainingAssets = (cand.availableAssets || []).filter(a => !stagedAssetIds.has(a.id));
      return {
        ...cand,
        remainingQty,
        remainingAssets
      };
    });
  }, [effectiveCandidateTab, sitePackingCandidates, shipLines, shipFromSite]);

  const selectedCandidate = useMemo(
    () => activeCandidatePool.find(c => normalizePartNumber(c.part_number) === normalizePartNumber(addLinePn)) || null,
    [activeCandidatePool, addLinePn]
  );

  const addLineCatalogMatch = useMemo(
    () => ctCatalog.find(c => normalizePartNumber(c.part_number) === normalizePartNumber(addLinePn)) || null,
    [ctCatalog, addLinePn]
  );

  const availableAssetsForAddLine = useMemo(() => {
    if (selectedCandidate?.remainingAssets?.length > 0) return selectedCandidate.remainingAssets;
    if (!addLineCatalogMatch || addLineCatalogMatch.item_kind !== 'tool') return [];
    const stagedIds = new Set(shipLines.flatMap(ln => ln.assetIds || []));
    const matchSite = String(addLineSourceSite || shipFromSite).toUpperCase();
    return ctToolAssets.filter(
      a =>
        !stagedIds.has(a.id) &&
        normalizePartNumber(a.part_number) === normalizePartNumber(addLineCatalogMatch.part_number) &&
        a.status === 'available' &&
        String(a.site_code || '').toUpperCase() === matchSite
    );
  }, [selectedCandidate, addLineCatalogMatch, ctToolAssets, addLineSourceSite, shipFromSite, shipLines]);

  const resolveLineSerials = (itemKind, qty, chosenAssets = [], candidate = null) => {
    if (itemKind === 'tool') {
      return chosenAssets.map(a => a.serial_number || a.asset_tag).filter(Boolean);
    }
    return (candidate?.serial_numbers || []).filter(Boolean).slice(0, qty);
  };

  const addCandidateToPackingList = (cand, requestedQty = null, chosenAssetIds = []) => {
    const qty = parseInt(requestedQty ?? cand.remainingQty, 10) || 0;
    if (qty <= 0) return;
    if (qty > cand.remainingQty) {
      showToast?.(`Only ${cand.remainingQty} remaining for ${cand.part_number}.`, 'error');
      return;
    }
    const chosenAssets = cand.item_kind === 'tool'
      ? (chosenAssetIds.length > 0
        ? (cand.remainingAssets || []).filter(a => chosenAssetIds.includes(a.id))
        : (cand.remainingAssets || []).slice(0, qty))
      : [];
    const assetIds = chosenAssets.map(a => a.id);
    const serialNumbers = resolveLineSerials(cand.item_kind, qty, chosenAssets, cand);
    setShipLines(prev => [
      ...prev,
      {
        part_number: cand.part_number,
        description: cand.description,
        item_kind: cand.item_kind,
        quantity: qty,
        sourceSiteCode: cand.sourceSiteCode || shipFromSite,
        assetIds,
        serial_numbers: serialNumbers
      }
    ]);
  };

  const handleAddAllSiteCandidates = () => {
    const addable = activeCandidatePool.filter(c => c.remainingQty > 0);
    if (addable.length === 0) return;
    setShipLines(prev => [
      ...prev,
      ...addable.map(c => {
        const chosenAssets = c.item_kind === 'tool' ? (c.remainingAssets || []).slice(0, c.remainingQty) : [];
        return {
          part_number: c.part_number,
          description: c.description,
          item_kind: c.item_kind,
          quantity: c.remainingQty,
          sourceSiteCode: c.sourceSiteCode || shipFromSite,
          assetIds: chosenAssets.map(a => a.id),
          serial_numbers: resolveLineSerials(c.item_kind, c.remainingQty, chosenAssets, c)
        };
      })
    ]);
    setAddLinePn('');
    setAddLineQty('1');
    setAddLineAssetIds([]);
  };

  const handleAddShipmentLine = () => {
    if (!addLineCatalogMatch && !selectedCandidate) {
      showToast?.('Select a valid Consumable or Tool part number.', 'error');
      return;
    }
    const targetItem = selectedCandidate || addLineCatalogMatch;
    const qty = parseInt(addLineQty, 10) || 1;
    if (selectedCandidate && qty > selectedCandidate.remainingQty) {
      showToast?.(`Only ${selectedCandidate.remainingQty} remaining for ${targetItem.part_number}.`, 'error');
      return;
    }
    if (targetItem.item_kind === 'tool' && addLineAssetIds.length > 0 && addLineAssetIds.length !== qty) {
      showToast?.(`Selected ${addLineAssetIds.length} tool asset(s) does not match Qty ${qty}.`, 'error');
      return;
    }
    const chosenAssets = targetItem.item_kind === 'tool'
      ? (addLineAssetIds.length > 0
        ? availableAssetsForAddLine.filter(a => addLineAssetIds.includes(a.id))
        : (selectedCandidate?.remainingAssets || []).slice(0, qty))
      : [];
    const serialNumbers = resolveLineSerials(targetItem.item_kind, qty, chosenAssets, selectedCandidate);
    setShipLines(prev => [
      ...prev,
      {
        part_number: targetItem.part_number,
        description: targetItem.description,
        item_kind: targetItem.item_kind,
        quantity: qty,
        sourceSiteCode: selectedCandidate?.sourceSiteCode || addLineSourceSite || shipFromSite,
        assetIds: chosenAssets.map(a => a.id),
        serial_numbers: serialNumbers
      }
    ]);
    setAddLinePn('');
    setAddLineQty('1');
    setAddLineSourceSite('');
    setAddLineAssetIds([]);
  };

  useEffect(() => {
    try {
      localStorage.setItem('mdc_ct_pack_auto_add', String(packAutoAdd));
    } catch {
      // Ignore storage errors
    }
  }, [packAutoAdd]);

  useEffect(() => {
    return () => {
      if (autoPackTimerRef.current) clearTimeout(autoPackTimerRef.current);
    };
  }, []);

  const executePackScan = (overrideScan = null, overrideSerial = null) => {
    if (autoPackTimerRef.current) {
      clearTimeout(autoPackTimerRef.current);
      autoPackTimerRef.current = null;
    }
    const scanVal = overrideScan !== null ? overrideScan : packScanInput;
    const serialVal = overrideSerial !== null ? overrideSerial : packSerialInput;

    const res = validateAndScanPackItem({
      scanToken: scanVal,
      serialToken: serialVal,
      pendingPartNumber: pendingScanPn,
      targetSiteCode: shipToSite,
      fromSiteCode: shipFromSite,
      catalogItems: ctCatalog,
      stockRows: ctStock,
      toolAssets: ctToolAssets,
      orders: ctOrders,
      existingShipments: ctShipments,
      currentBoxLines: shipLines,
      scanQty: 1
    });

    if (!res.ok) {
      barcodeAudio.playError();
      setPackScanFeedback({ ok: false, message: res.message });
      setTimeout(() => {
        if (pendingScanPn && packSerialRef.current) {
          packSerialRef.current.focus();
          packSerialRef.current.select();
        } else if (packScanRef.current) {
          packScanRef.current.focus();
          packScanRef.current.select();
        }
      }, 20);
      return res;
    }

    if (res.status === 'NEEDS_SERIAL') {
      setPendingScanPn(res.pendingPartNumber);
      setPackScanFeedback({ ok: true, pending: true, message: res.message });
      setTimeout(() => {
        packSerialRef.current?.focus();
      }, 20);
      return res;
    }

    barcodeAudio.playSuccess();
    setShipLines(res.nextBoxLines);
    setPendingScanPn('');
    setPackScanInput('');
    setPackSerialInput('');
    setPackScanFeedback({ ok: true, pending: false, message: res.message });
    setTimeout(() => {
      packScanRef.current?.focus();
    }, 20);
    return res;
  };

  const handlePackScanChange = (rawVal) => {
    const val = rawVal.toUpperCase();
    setPackScanInput(val);
    if (autoPackTimerRef.current) clearTimeout(autoPackTimerRef.current);
    const clean = normalizePartNumber(val);
    if (!packAutoAdd || !clean || pendingScanPn) return;

    const pool = [...sitePackingCandidates.siteCandidates, ...sitePackingCandidates.fromCandidates];
    const matchesCandidatePn = pool.some(c => c.part_number === clean);
    const matchesAsset = (ctToolAssets || []).some(
      a =>
        a.status === 'available' &&
        (normalizePartNumber(a.serial_number) === clean || normalizePartNumber(a.asset_tag) === clean)
    );
    if (matchesCandidatePn || matchesAsset) {
      autoPackTimerRef.current = setTimeout(() => {
        executePackScan(val, packSerialInput);
      }, 180);
    }
  };

  const handlePackSerialChange = (rawVal) => {
    const val = rawVal.toUpperCase();
    setPackSerialInput(val);
    if (autoPackTimerRef.current) clearTimeout(autoPackTimerRef.current);
    const clean = normalizePartNumber(val);
    if (!packAutoAdd || !clean) return;

    const matchesAsset = (ctToolAssets || []).some(
      a =>
        a.status === 'available' &&
        (!pendingScanPn || normalizePartNumber(a.part_number) === pendingScanPn) &&
        (normalizePartNumber(a.serial_number) === clean || normalizePartNumber(a.asset_tag) === clean)
    );
    if (matchesAsset) {
      autoPackTimerRef.current = setTimeout(() => {
        executePackScan(pendingScanPn || packScanInput, val);
      }, 180);
    }
  };

  const handleCreateShipmentSubmit = (e) => {
    e.preventDefault();
    if (requireScanVerification) {
      const unverified = shipLines.filter(ln => !ln.box_verified);
      if (unverified.length > 0) {
        barcodeAudio.playError();
        const msg = `Security verification required: scan all ${unverified.length} unverified item(s) into the box before generating the packing list (or uncheck Require Scan-to-Box).`;
        setPackScanFeedback({ ok: false, message: msg });
        showToast?.(msg, 'error');
        return;
      }
    }
    const toSiteObj = siteChoices.find(s => s.code === shipToSite);
    const fromSiteObj = siteChoices.find(s => s.code === shipFromSite);
    const res = createCtShipment({
      fromSiteCode: shipFromSite,
      fromSiteName: fromSiteObj?.name || 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center',
      toSiteCode: shipToSite,
      toSiteName: toSiteObj?.name || shipToSite,
      carrier: shipCarrier,
      trackingNumber: shipTracking,
      tsNumber: shipTsNumber,
      notes: shipNotes,
      signatureName: shipSignature,
      lineRequests: shipLines,
      status: 'shipped'
    });
    if (res.ok) {
      setShipLines([]);
      setShipTracking('');
      setShipTsNumber('');
      setShipNotes('');
      setShipSignature('');
      setPendingScanPn('');
      setPackScanInput('');
      setPackSerialInput('');
      setPackScanFeedback(null);

      // Auto-archive generated CT Packing List PDF to Google Drive ("Consumables & Tools Receiving Packing Lists")
      if (res.shipment) {
        (async () => {
          try {
            const pdfBytes = await generateConsumablesToolsPackingListPdfBytes(res.shipment, {
              toAddress: getSiteAddressForPdf(res.shipment.to_site_code)
            });
            if (pdfBytes) {
              const driveRes = await uploadCtPackingListToDrive({
                file: pdfBytes,
                shipment: res.shipment,
                docKind: 'ct_packing_list'
              });
              if (driveRes.success && driveRes.fileId) {
                attachCtShipmentDocument?.(res.shipment.id, {
                  drive_pl_file_id: driveRes.fileId,
                  drive_pl_web_view_link: driveRes.webViewLink || null,
                  drive_pl_filename: driveRes.filename || null,
                  drive_pl_site_folder: driveRes.siteFolder || null
                });
              }
            }
          } catch {
            // Non-blocking Google Drive auto-archive
          }
        })();
      }
    }
  };

  const getSiteAddressForPdf = (siteCode) => {
    const found = siteChoices.find(s => String(s.code).toUpperCase() === String(siteCode).toUpperCase());
    return found?.full_address || found?.address || '';
  };

  return (
    <div className="consumables-tools-module" style={{ maxWidth: '1320px', margin: '0 auto', paddingBottom: '44px' }}>
      {/* Header Banner */}
      <div className="card" style={{ marginBottom: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#ffffff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#0f172a', color: '#38bdf8', padding: '10px', borderRadius: '10px', display: 'flex' }}>
              <Wrench size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                Consumables & Service Tools Center
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                Dedicated tracking for consumables (qty-based) and service tools (individual/serialized assets) — completely separate from Repair Parts.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {userCanEdit && inStockConsumables.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const first = inStockConsumables[0];
                  setConsumePn(first?.part_number || '');
                  setConsumeSiteCode(first?.site_code || 'DC-MDC');
                  setConsumeModalOpen(true);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <ArrowRightLeft size={14} />
                <span>Log Consumable Usage</span>
              </button>
            )}
          </div>
        </div>

        {/* Shared Parts Master + Priority Autocomplete Datalist */}
        <datalist id="ct-catalog-datalist">
          {ctCatalog.map(c => (
            <option key={c.id || c.part_number} value={c.part_number}>
              [{(c.item_kind || 'consumable').toUpperCase()}] {c.description}
            </option>
          ))}
        </datalist>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', marginTop: '16px' }}>
          <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: '10px', padding: '10px 12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#854d0e', textTransform: 'uppercase' }}>Open Orders</div>
            <div className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#a16207' }}>{kpis.openOrdersCount}</div>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Consumables On Hand</div>
            <div className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{kpis.consumablesOnHand}</div>
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>Tracked Tool Units</div>
            <div className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#1d4ed8' }}>
              {kpis.totalAssets} <span style={{ fontSize: '11.5px', color: '#3b82f6', fontWeight: 500 }}>({kpis.availableAssets} avail)</span>
            </div>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px 12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Dedicated Shipments</div>
            <div className="font-mono" style={{ fontSize: '20px', fontWeight: 800, color: '#15803d' }}>{kpis.shipmentsCount}</div>
          </div>
        </div>
      </div>

      {/* SECTION 1: CONSUMABLES & TOOLS MULTI-SITE DASHBOARD (ALL SITES COMBINED · TOOLS · CONSUMABLES · CATALOG) */}
      {section === 'assets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Multi-Site Dashboard Region & Sorted Site Selector (matches Multi-Site Inventory Dashboard UX) */}
          <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Cross-Site Instant Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Search size={15} color="#0284c7" />
                  <span>Search Tools &amp; Consumables Across All Sites</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                  Filter by Part Number, Description, Asset Tag, Serial #, Ownership Tag (Apple-Owned), or Site
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setPdfImportModalOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '34px' }}
                >
                  <FileSpreadsheet size={14} />
                  <span>Import CSV / Excel</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isExportingExcel}
                  onClick={handleExportCenterExcel}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '34px' }}
                >
                  <FileSpreadsheet size={14} color="#059669" />
                  <span>{isExportingExcel ? 'Exporting...' : `Export Excel (${siteFilter === 'ALL' ? 'All Sites' : siteFilter})`}</span>
                </button>
              </div>
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '12px', pointerEvents: 'none' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Type or scan Part # (e.g. 077-01158), Description, Asset Tag, or Site..."
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                style={{ width: '100%', height: '38px', paddingLeft: '36px', fontSize: '13px', borderRadius: '9px' }}
              />
              {assetSearch && (
                <button
                  type="button"
                  onClick={() => setAssetSearch('')}
                  style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Region Selector Cards (Metro Manila vs Provincial) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  setCenterRegionFilter('ALL');
                  setSiteFilter('ALL');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: centerRegionFilter === 'ALL' && siteFilter === 'ALL' ? '2px solid #0f172a' : '1px solid #e2e8f0',
                  background: centerRegionFilter === 'ALL' && siteFilter === 'ALL' ? '#0f172a' : '#f8fafc',
                  color: centerRegionFilter === 'ALL' && siteFilter === 'ALL' ? '#ffffff' : '#0f172a'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={16} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800 }}>All Combined Sites</div>
                    <div style={{ fontSize: '11px', opacity: 0.8 }}>{multiSiteOverview.allSorted.length} Active Service Points</div>
                  </div>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800, background: centerRegionFilter === 'ALL' && siteFilter === 'ALL' ? 'rgba(255,255,255,0.2)' : '#e2e8f0' }}>
                  {multiSiteOverview.totalUnits} units
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCenterRegionFilter('Metro Manila');
                  setSiteFilter('ALL');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: centerRegionFilter === 'Metro Manila' ? '2px solid #0284c7' : '1px solid #e2e8f0',
                  background: centerRegionFilter === 'Metro Manila' ? '#0284c7' : '#f8fafc',
                  color: centerRegionFilter === 'Metro Manila' ? '#ffffff' : '#0f172a'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={16} color={centerRegionFilter === 'Metro Manila' ? '#fff' : '#0284c7'} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800 }}>Metro Manila Sites</div>
                    <div style={{ fontSize: '11px', opacity: 0.8 }}>{multiSiteOverview.metroManila.length} Authorized Service Points</div>
                  </div>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800, background: centerRegionFilter === 'Metro Manila' ? 'rgba(255,255,255,0.2)' : '#e0f2fe', color: centerRegionFilter === 'Metro Manila' ? '#fff' : '#0369a1' }}>
                  {multiSiteOverview.metroUnits} units
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCenterRegionFilter('Province');
                  setSiteFilter('ALL');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: centerRegionFilter === 'Province' ? '2px solid #d97706' : '1px solid #e2e8f0',
                  background: centerRegionFilter === 'Province' ? '#d97706' : '#f8fafc',
                  color: centerRegionFilter === 'Province' ? '#ffffff' : '#0f172a'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={16} color={centerRegionFilter === 'Province' ? '#fff' : '#d97706'} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800 }}>Provincial Sites</div>
                    <div style={{ fontSize: '11px', opacity: 0.8 }}>{multiSiteOverview.provincial.length} Regional Service Points</div>
                  </div>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 800, background: centerRegionFilter === 'Province' ? 'rgba(255,255,255,0.2)' : '#fef3c7', color: centerRegionFilter === 'Province' ? '#fff' : '#92400e' }}>
                  {multiSiteOverview.provincialUnits} units
                </span>
              </button>
            </div>

            {/* Alphabetically Sorted Site Chips (A -> Z) */}
            {(() => {
              const visibleSites =
                centerRegionFilter === 'Metro Manila'
                  ? multiSiteOverview.metroManila
                  : centerRegionFilter === 'Province'
                    ? multiSiteOverview.provincial
                    : multiSiteOverview.allSorted;
              if (visibleSites.length === 0) return null;
              return (
                <div>
                  <div style={{ fontSize: '10.5px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '7px' }}>
                    Select Site to Filter (Sorted A–Z):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                    {visibleSites.map(s => {
                      const active = siteFilter.toUpperCase() === s.code;
                      const theme = getSiteColorTheme(s.code);
                      return (
                        <button
                          key={s.code}
                          type="button"
                          onClick={() => setSiteFilter(active ? 'ALL' : s.code)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '5px 10px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            background: active ? theme.text : theme.bg,
                            color: active ? '#ffffff' : theme.text,
                            border: active ? `2px solid ${theme.text}` : `1px solid ${theme.border}`,
                            fontSize: '12px',
                            fontWeight: 800
                          }}
                        >
                          <span>{s.code}</span>
                          <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '10.5px', background: active ? 'rgba(255,255,255,0.22)' : '#dbeafe', color: active ? '#fff' : '#1e40af' }}>
                            {s.toolsCount}T
                          </span>
                          <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '10.5px', background: active ? 'rgba(255,255,255,0.22)' : '#d1fae5', color: active ? '#fff' : '#065f46' }}>
                            {s.consumablesQty}C
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Sub-Tab Switcher */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'inline-flex', gap: '6px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', border: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
              {[
                { key: 'combined', label: `All Sites Combined (${combinedInventoryRows.length})` },
                { key: 'assets', label: `Tracked Tool Units (${ctToolAssets.length})` },
                { key: 'consumables', label: `Consumables Stock (${ctStock.filter(s => s.item_kind !== 'tool' && (Number(s.qty_on_hand) || 0) > 0).length})` },
                { key: 'catalog', label: `Complete Catalog (${rawCtCatalog.length})` }
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setAssetsSubTab(tab.key)}
                  style={{
                    border: 'none',
                    borderRadius: '8px',
                    padding: '7px 14px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: assetsSubTab === tab.key ? '#0f172a' : 'transparent',
                    color: assetsSubTab === tab.key ? '#ffffff' : '#475569'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* SUB-TAB 0: ALL SITES COMBINED SINGLE VIEW (SORTED A->Z BY SITE) */}
          {assetsSubTab === 'combined' && (
            <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800 }}>
                    Combined Multi-Site Tools &amp; Consumables ({combinedInventoryRows.length} rows)
                  </h3>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Sorted A–Z by Site · All Service Tools &amp; Consumables tagged <strong>Apple-Owned</strong>
                  </div>
                </div>
                {siteFilter !== 'ALL' && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSiteFilter('ALL')}>
                    Show All Sites
                  </button>
                )}
              </div>

              {combinedInventoryRows.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
                  No tools or consumables match the current site/search filter.
                </div>
              ) : (
                <>
                <div className="table-container" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '12.5px', minWidth: '880px' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '115px' }}>Site</th>
                        <th style={{ width: '115px' }}>Type</th>
                        <th style={{ width: '155px' }}>Ownership / Tag</th>
                        <th style={{ width: '125px' }}>Part Number</th>
                        <th>Description</th>
                        <th style={{ width: '75px', textAlign: 'center' }}>Qty</th>
                        <th style={{ width: '130px' }}>Serial / Asset</th>
                        <th style={{ width: '140px' }}>Source Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginateCenterRows(combinedInventoryRows).pageRows.map(row => {
                        const siteTheme = getSiteColorTheme(row.site_code);
                        const isTool = row.item_kind === 'tool';
                        return (
                          <tr key={row.id}>
                            <td>
                              <span
                                className="font-mono"
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  background: siteTheme.bg,
                                  color: siteTheme.text,
                                  border: `1px solid ${siteTheme.border}`
                                }}
                              >
                                {row.site_code}
                              </span>
                            </td>
                            <td>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  background: isTool ? '#eff6ff' : '#ecfdf5',
                                  color: isTool ? '#1d4ed8' : '#047857'
                                }}
                              >
                                {isTool ? 'Tool' : 'Consumable'}
                              </span>
                            </td>
                            <td>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  background: (row.ownership_tag || 'Apple-Owned') === 'Apple-Owned' ? '#0f172a' : '#f0f9ff',
                                  color: (row.ownership_tag || 'Apple-Owned') === 'Apple-Owned' ? '#ffffff' : '#0369a1',
                                  border: (row.ownership_tag || 'Apple-Owned') === 'Apple-Owned' ? '1px solid #0f172a' : '1px solid #bae6fd',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {row.ownership_tag || 'Apple-Owned'}
                              </span>
                            </td>
                            <td className="font-mono" style={{ fontWeight: 700 }}>{row.part_number}</td>
                            <td>{row.description}</td>
                            <td className="font-mono" style={{ textAlign: 'center', fontWeight: 800 }}>{row.qty}</td>
                            <td className="font-mono" style={{ fontSize: '11.5px', color: '#475569' }}>
                              {isTool ? (row.serial_number !== '—' ? row.serial_number : row.asset_tag) : '—'}
                            </td>
                            <td>
                              {row.source_ref ? (
                                <button
                                  type="button"
                                  onClick={() => openCtSourcePdf?.(row.source_import_id || row.source_ref)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '2px 7px',
                                    borderRadius: '999px',
                                    background: '#eff6ff',
                                    border: '1px solid #bfdbfe',
                                    color: '#1d4ed8',
                                    fontSize: '10.5px',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <FileText size={10} />
                                  <span>{row.source_ref}</span>
                                </button>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {renderCenterPaginationBar(paginateCenterRows(combinedInventoryRows))}
                </>
              )}
            </div>
          )}

          {/* SUB-TAB A: TRACKED TOOL ASSETS */}
          {assetsSubTab === 'assets' && (
        <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['ALL', 'available', 'in_use', 'shipped', 'missing', 'retired'].map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setAssetStatusFilter(st)}
                  style={{
                    padding: '6px 11px',
                    borderRadius: '7px',
                    border: assetStatusFilter === st ? '1px solid #0284c7' : '1px solid #cbd5e1',
                    background: assetStatusFilter === st ? '#e0f2fe' : '#ffffff',
                    color: assetStatusFilter === st ? '#0369a1' : '#475569',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'capitalize',
                    cursor: 'pointer'
                  }}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="form-select"
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                title="Filter table and Excel export by site (or All Sites)"
                style={{ height: '36px', fontSize: '12.5px', minWidth: '175px' }}
              >
                <option value="ALL">All Sites ({siteChoices.length})</option>
                {siteChoices.map(s => (
                  <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                ))}
              </select>
              <input
                type="text"
                className="form-input"
                placeholder="Checkout tech/assignee..."
                value={assetAssigneeInput}
                onChange={(e) => setAssetAssigneeInput(e.target.value)}
                style={{ height: '36px', fontSize: '12.5px', width: '165px' }}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Search asset tag, ownership, serial, PN, assignee..."
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                style={{ height: '36px', fontSize: '12.5px', width: '230px' }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={isExportingExcel}
                onClick={handleExportCenterExcel}
                title={siteFilter === 'ALL' ? 'Export Consumables & Tools Excel report for All Sites' : `Export Consumables & Tools Excel report for ${siteFilter} only`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '36px' }}
              >
                <FileSpreadsheet size={14} />
                <span>{isExportingExcel ? 'Exporting...' : `Export Excel (${siteFilter === 'ALL' ? 'All Sites' : siteFilter})`}</span>
              </button>
              {filteredAssets.length > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLabelAssetsModal(filteredAssets.slice(0, 24))} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', height: '36px' }}>
                  <QrCode size={14} />
                  <span>Print Filtered Labels</span>
                </button>
              )}
            </div>
          </div>

          {filteredAssets.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
              No individual tool assets match the current filter. Receive tool units under <strong>Orders & Receiving</strong> to mint tracked asset tags and serials.
            </div>
          ) : (
            <>
            <div className="table-container" style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: '12.5px', minWidth: '940px' }}>
                <thead>
                  <tr>
                    <th>System Asset Tag</th>
                    <th>Ownership Tag</th>
                    <th>Serial Number</th>
                    <th>Part Number</th>
                    <th>Description</th>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Assigned To</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginateCenterRows(filteredAssets).pageRows.map(asset => {
                    const isEditingRow = editingAssetId === asset.id;
                    const ownershipLabel = asset.ownership_tag || 'Apple-Owned';
                    const isAppleOwned = ownershipLabel === 'Apple-Owned';
                    const siteTheme = getSiteColorTheme(asset.site_code);
                    return (
                    <tr key={asset.id}>
                      <td className="font-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <div>{asset.asset_tag}</div>
                        {asset.source_pdf_ref && (
                          <button
                            type="button"
                            onClick={() => openCtSourcePdf?.(asset.source_pdf_import_id || asset.source_pdf_ref)}
                            title={`Imported from ${asset.source_pdf_filename || asset.source_pdf_ref}`}
                            style={{
                              marginTop: '3px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              padding: '1px 6px',
                              borderRadius: '999px',
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              color: '#1d4ed8',
                              fontSize: '10px',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            <FileText size={10} />
                            <span>Ref: {asset.source_pdf_ref}</span>
                          </button>
                        )}
                      </td>
                      <td style={{ minWidth: '145px' }}>
                        {isEditingRow ? (
                          <select
                            className="form-select"
                            value={editAdminTag || 'Apple-Owned'}
                            onChange={(e) => setEditAdminTag(e.target.value)}
                            autoFocus
                            style={{ height: '28px', fontSize: '12px', padding: '2px 7px', width: '150px' }}
                          >
                            <option value="Apple-Owned">Apple-Owned</option>
                            <option value="MobileCare-Owned">MobileCare-Owned</option>
                            <option value="Cable / Admin-Tagged">Cable / Admin-Tagged</option>
                          </select>
                        ) : (
                          <span
                            onClick={() => userCanEdit && startEditAsset(asset)}
                            title={userCanEdit ? 'Click to update Ownership Tag or Assigned Person' : ownershipLabel}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 9px',
                              borderRadius: '999px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: isAppleOwned ? '#0f172a' : '#f0f9ff',
                              color: isAppleOwned ? '#ffffff' : '#0369a1',
                              border: isAppleOwned ? '1px solid #0f172a' : '1px solid #bae6fd',
                              cursor: userCanEdit ? 'pointer' : 'default',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <span>{ownershipLabel}</span>
                            {userCanEdit && <Pencil size={10} style={{ opacity: 0.7 }} />}
                          </span>
                        )}
                      </td>
                      <td className="font-mono">{asset.serial_number || '—'}</td>
                      <td className="font-mono">{asset.part_number}</td>
                      <td>{asset.description}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: siteTheme.bg,
                            color: siteTheme.text,
                            border: `1px solid ${siteTheme.border}`,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {asset.site_code}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: '6px', background: asset.status === 'available' ? '#dcfce7' : asset.status === 'in_use' ? '#dbeafe' : asset.status === 'missing' ? '#fee2e2' : '#f1f5f9', color: asset.status === 'available' ? '#166534' : asset.status === 'in_use' ? '#1d4ed8' : asset.status === 'missing' ? '#b91c1c' : '#475569' }}>
                          {asset.status}
                        </span>
                      </td>
                      <td style={{ minWidth: '155px' }}>
                        {isEditingRow ? (
                          <input
                            type="text"
                            className="form-input"
                            value={editAssignedTo}
                            onChange={(e) => setEditAssignedTo(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveEditAsset(asset); }
                              if (e.key === 'Escape') { e.preventDefault(); cancelEditAsset(); }
                            }}
                            placeholder="Assigned person..."
                            style={{ height: '28px', fontSize: '12px', padding: '2px 7px', width: '150px' }}
                          />
                        ) : userCanEdit ? (
                          <button
                            type="button"
                            onClick={() => startEditAsset(asset)}
                            title="Click to assign or update person"
                            style={{
                              background: asset.assigned_to ? '#f8fafc' : 'transparent',
                              border: asset.assigned_to ? '1px solid #e2e8f0' : '1px dashed #cbd5e1',
                              borderRadius: '6px',
                              padding: '3px 8px',
                              fontSize: '12px',
                              fontWeight: asset.assigned_to ? 600 : 500,
                              color: asset.assigned_to ? '#0f172a' : '#94a3b8',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <span>{asset.assigned_to || '+ Assign'}</span>
                            <Pencil size={11} style={{ opacity: 0.7 }} />
                          </button>
                        ) : (
                          <span>{asset.assigned_to || '—'}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '5px' }}>
                          {isEditingRow ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => saveEditAsset(asset)}
                                title="Save Admin Tag & Assignee"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              >
                                <Check size={13} />
                                <span>Save</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={cancelEditAsset}
                                title="Cancel"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              {userCanEdit && (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => startEditAsset(asset)}
                                  title="Edit Admin Asset Tag & Assigned Person"
                                >
                                  <Pencil size={12} />
                                </button>
                              )}
                              {asset.status === 'available' && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => checkoutTool({ assetId: asset.id, assignedTo: assetAssigneeInput.trim() || asset.assigned_to || currentUser?.fullName || 'Shop Technician' })}>
                                  Check Out
                                </button>
                              )}
                              {(asset.status === 'in_use' || asset.status === 'missing') && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => checkinTool({ assetId: asset.id })}>
                                  Check In
                                </button>
                              )}
                              {asset.status === 'available' && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateToolStatus({ assetId: asset.id, newStatus: 'missing' })}>
                                  Missing
                                </button>
                              )}
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLabelAssetsModal([asset])} title="QR/Barcode Label">
                                <QrCode size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            {renderCenterPaginationBar(paginateCenterRows(filteredAssets))}
            </>
          )}
        </div>
          )}

          {/* SUB-TAB B: CONSUMABLES STOCK (EDITABLE) */}
          {assetsSubTab === 'consumables' && (() => {
            const q = consumableSearch.trim().toLowerCase();
            const consumableRows = (ctStock || []).filter(s => {
              if (s.item_kind === 'tool') return false;
              if (siteFilter !== 'ALL' && String(s.site_code || '').toUpperCase() !== siteFilter.toUpperCase()) return false;
              if (q) {
                const hay = `${s.part_number || ''} ${s.description || ''} ${s.site_code || ''} ${s.last_source_pdf_ref || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

            return (
              <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800 }}>Consumables Stock ({consumableRows.length})</h3>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Quantity-tracked consumables by site — click Edit to correct description, stock qty, or threshold</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      className="form-select"
                      value={siteFilter}
                      onChange={(e) => setSiteFilter(e.target.value)}
                      style={{ height: '36px', fontSize: '12.5px', minWidth: '175px' }}
                    >
                      <option value="ALL">All Sites ({siteChoices.length})</option>
                      {siteChoices.map(s => (
                        <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Search PN, description, site, PDF ref..."
                      value={consumableSearch}
                      onChange={(e) => setConsumableSearch(e.target.value)}
                      style={{ height: '36px', fontSize: '12.5px', width: '230px' }}
                    />
                  </div>
                </div>

                {consumableRows.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
                    No consumable stock records found. Import a scanned Apple PDF or receive consumables under <strong>CT Receiving &amp; Scan-In</strong>.
                  </div>
                ) : (
                  <>
                  <div className="table-container" style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', fontSize: '12.5px' }}>
                      <thead>
                        <tr>
                          <th>Part Number</th>
                          <th>Ownership Tag</th>
                          <th>Description</th>
                          <th>Site</th>
                          <th style={{ textAlign: 'center' }}>On Hand</th>
                          <th style={{ textAlign: 'center' }}>Min Threshold</th>
                          <th>Source Ref</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginateCenterRows(consumableRows).pageRows.map(row => {
                          const isEditing = editingStockId === row.id;
                          const ownershipLabel = row.ownership_tag || 'Apple-Owned';
                          const isAppleOwned = ownershipLabel === 'Apple-Owned';
                          return (
                            <tr key={row.id}>
                              <td className="font-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{row.part_number}</td>
                              <td>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    fontSize: '11px',
                                    fontWeight: 800,
                                    background: isAppleOwned ? '#0f172a' : '#f0f9ff',
                                    color: isAppleOwned ? '#ffffff' : '#0369a1',
                                    border: isAppleOwned ? '1px solid #0f172a' : '1px solid #bae6fd',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {ownershipLabel}
                                </span>
                              </td>
                              <td>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={editStockForm.description}
                                    onChange={(e) => setEditStockForm(f => ({ ...f, description: e.target.value }))}
                                    style={{ height: '30px', fontSize: '12.5px', width: '100%', minWidth: '220px' }}
                                  />
                                ) : (
                                  row.description || '—'
                                )}
                              </td>
                              <td style={{ fontWeight: 700 }}>{row.site_code}</td>
                              <td className="font-mono" style={{ textAlign: 'center', fontWeight: 800 }}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min={0}
                                    className="form-input"
                                    value={editStockForm.qty_on_hand}
                                    onChange={(e) => setEditStockForm(f => ({ ...f, qty_on_hand: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                    style={{ height: '30px', fontSize: '12.5px', width: '72px', textAlign: 'center' }}
                                  />
                                ) : (
                                  row.qty_on_hand
                                )}
                              </td>
                              <td className="font-mono" style={{ textAlign: 'center' }}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min={0}
                                    className="form-input"
                                    value={editStockForm.min_stock_threshold}
                                    onChange={(e) => setEditStockForm(f => ({ ...f, min_stock_threshold: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                    style={{ height: '30px', fontSize: '12.5px', width: '72px', textAlign: 'center' }}
                                  />
                                ) : (
                                  row.min_stock_threshold ?? 2
                                )}
                              </td>
                              <td>
                                {row.last_source_pdf_ref ? (
                                  <button
                                    type="button"
                                    onClick={() => openCtSourcePdf?.(row.last_source_pdf_import_id || row.last_source_pdf_ref)}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '2px 7px',
                                      borderRadius: '999px',
                                      background: '#eff6ff',
                                      border: '1px solid #bfdbfe',
                                      color: '#1d4ed8',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <FileText size={11} />
                                    <span>PDF: {row.last_source_pdf_ref}</span>
                                  </button>
                                ) : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '6px' }}>
                                  {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => {
                                          updateCtStockRecord?.(row.id, editStockForm);
                                          setEditingStockId(null);
                                        }}
                                      >
                                        <Check size={13} /> Save
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setEditingStockId(null)}
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : userCanEdit ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => {
                                        setEditingStockId(row.id);
                                        setEditStockForm({
                                          description: row.description || '',
                                          qty_on_hand: Number(row.qty_on_hand) || 0,
                                          min_stock_threshold: Number(row.min_stock_threshold ?? 2)
                                        });
                                      }}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <Pencil size={12} /> Edit
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {renderCenterPaginationBar(paginateCenterRows(consumableRows))}
                  </>
                )}
              </div>
            );
          })()}

          {/* SUB-TAB C: COMPLETE TOOLS & CONSUMABLES CATALOG (EDITABLE, PDF-SOURCED) */}
          {assetsSubTab === 'catalog' && (() => {
            const q = catalogSearch.trim().toLowerCase();
            const filteredCatalog = (rawCtCatalog || []).filter(item => {
              if (catalogKindFilter !== 'all' && item.item_kind !== catalogKindFilter) return false;
              if (q) {
                const hay = `${item.part_number || ''} ${item.description || ''} ${item.category || ''} ${item.source_pdf_ref || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });
            const toolsCount = (rawCtCatalog || []).filter(i => i.item_kind === 'tool').length;
            const consCount = (rawCtCatalog || []).filter(i => i.item_kind !== 'tool').length;

            return (
              <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800 }}>
                      Complete Tools &amp; Consumables Catalog ({rawCtCatalog.length})
                    </h3>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      Sourced directly from scanned Apple PDFs · Fully editable so you can update or correct any record
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'inline-flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
                      {[
                        { key: 'all', label: `All (${rawCtCatalog.length})` },
                        { key: 'tool', label: `Tools (${toolsCount})` },
                        { key: 'consumable', label: `Consumables (${consCount})` }
                      ].map(f => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setCatalogKindFilter(f.key)}
                          style={{
                            border: 'none',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            background: catalogKindFilter === f.key ? '#0f172a' : 'transparent',
                            color: catalogKindFilter === f.key ? '#fff' : '#475569'
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Search catalog PN or description..."
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      style={{ height: '34px', fontSize: '12.5px', width: '215px' }}
                    />
                    {userCanEdit && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setAddingCatalogItem(v => !v)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', height: '34px' }}
                        >
                          <Plus size={14} /> Add Item
                        </button>
                        {rawCtCatalog.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              if (window.confirm(`Clear all ${rawCtCatalog.length} items from the Tools & Consumables Catalog so you can rebuild cleanly from scanned Apple PDFs?`)) {
                                clearCtCatalog?.();
                              }
                            }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', height: '34px', color: '#dc2626', borderColor: '#fecaca' }}
                          >
                            <Trash2 size={13} /> Clear Catalog
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {addingCatalogItem && (
                  <div style={{ padding: '12px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '150px 1fr 140px 110px auto', gap: '8px', alignItems: 'end' }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '11px', marginBottom: '3px' }}>Part Number *</label>
                      <input
                        type="text"
                        className="form-input font-mono"
                        placeholder="e.g. 077-01158"
                        value={newCatForm.part_number}
                        onChange={(e) => setNewCatForm(f => ({ ...f, part_number: e.target.value }))}
                        style={{ height: '34px', width: '100%' }}
                      />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '11px', marginBottom: '3px' }}>Description *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Exact Apple description..."
                        value={newCatForm.description}
                        onChange={(e) => setNewCatForm(f => ({ ...f, description: e.target.value }))}
                        style={{ height: '34px', width: '100%' }}
                      />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '11px', marginBottom: '3px' }}>Type</label>
                      <select
                        className="form-select"
                        value={newCatForm.item_kind}
                        onChange={(e) => setNewCatForm(f => ({ ...f, item_kind: e.target.value }))}
                        style={{ height: '34px', width: '100%' }}
                      >
                        <option value="tool">Tool</option>
                        <option value="consumable">Consumable</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '11px', marginBottom: '3px' }}>USD Price</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="form-input font-mono"
                        value={newCatForm.unit_cost}
                        onChange={(e) => setNewCatForm(f => ({ ...f, unit_cost: Math.max(0, parseFloat(e.target.value) || 0) }))}
                        style={{ height: '34px', width: '100%', textAlign: 'right' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ height: '34px' }}
                        onClick={() => {
                          const res = saveCtCatalogItem?.(newCatForm);
                          if (res?.ok) {
                            setNewCatForm({ part_number: '', description: '', item_kind: 'tool', unit_cost: 0 });
                            setAddingCatalogItem(false);
                          }
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ height: '34px' }}
                        onClick={() => setAddingCatalogItem(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {filteredCatalog.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
                    No catalog items yet. Click <strong>Import CSV / Excel</strong> to populate the catalog directly from your Gemini-extracted CSV/XLSX files, or click <strong>+ Add Item</strong>.
                  </div>
                ) : (
                  <>
                  <div className="table-container" style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', fontSize: '12.5px' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '140px' }}>Part Number</th>
                          <th>Description</th>
                          <th style={{ width: '125px' }}>Type</th>
                          <th style={{ width: '110px', textAlign: 'right' }}>USD Price</th>
                          <th style={{ width: '150px' }}>Source Ref</th>
                          <th style={{ width: '130px', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginateCenterRows(filteredCatalog).pageRows.map(item => {
                          const isEditing = editingCatalogId === item.id;
                          return (
                            <tr key={item.id}>
                              <td className="font-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    className="form-input font-mono"
                                    value={editCatForm.part_number}
                                    onChange={(e) => setEditCatForm(f => ({ ...f, part_number: e.target.value }))}
                                    style={{ height: '30px', width: '125px', fontSize: '12px' }}
                                  />
                                ) : (
                                  item.part_number
                                )}
                              </td>
                              <td>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={editCatForm.description}
                                    onChange={(e) => setEditCatForm(f => ({ ...f, description: e.target.value }))}
                                    style={{ height: '30px', width: '100%', minWidth: '220px', fontSize: '12px' }}
                                  />
                                ) : (
                                  item.description
                                )}
                              </td>
                              <td>
                                {isEditing ? (
                                  <select
                                    className="form-select"
                                    value={editCatForm.item_kind}
                                    onChange={(e) => setEditCatForm(f => ({ ...f, item_kind: e.target.value }))}
                                    style={{ height: '30px', width: '115px', fontSize: '12px' }}
                                  >
                                    <option value="tool">Tool</option>
                                    <option value="consumable">Consumable</option>
                                  </select>
                                ) : (
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      padding: '2px 8px',
                                      borderRadius: '999px',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      background: item.item_kind === 'tool' ? '#eff6ff' : '#ecfdf5',
                                      color: item.item_kind === 'tool' ? '#1d4ed8' : '#047857'
                                    }}
                                  >
                                    {item.item_kind === 'tool' ? 'Tool' : 'Consumable'}
                                  </span>
                                )}
                              </td>
                              <td className="font-mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className="form-input font-mono"
                                    value={editCatForm.unit_cost}
                                    onChange={(e) => setEditCatForm(f => ({ ...f, unit_cost: Math.max(0, parseFloat(e.target.value) || 0) }))}
                                    style={{ height: '30px', width: '90px', textAlign: 'right', fontSize: '12px' }}
                                  />
                                ) : (
                                  `$${(Number(item.unit_cost) || 0).toFixed(2)}`
                                )}
                              </td>
                              <td>
                                {item.source_pdf_ref ? (
                                  <button
                                    type="button"
                                    onClick={() => openCtSourcePdf?.(item.source_pdf_import_id || item.source_pdf_ref)}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '2px 7px',
                                      borderRadius: '999px',
                                      background: '#eff6ff',
                                      border: '1px solid #bfdbfe',
                                      color: '#1d4ed8',
                                      fontSize: '11px',
                                      fontWeight: 700,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <FileText size={11} />
                                    <span>{item.source_pdf_ref}</span>
                                  </button>
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Manual / Legacy</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '5px' }}>
                                  {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => {
                                          const res = saveCtCatalogItem?.({ id: item.id, ...editCatForm });
                                          if (res?.ok) setEditingCatalogId(null);
                                        }}
                                      >
                                        <Check size={12} /> Save
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setEditingCatalogId(null)}
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : userCanEdit ? (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => {
                                          setEditingCatalogId(item.id);
                                          setEditCatForm({
                                            part_number: item.part_number,
                                            description: item.description,
                                            item_kind: item.item_kind === 'tool' ? 'tool' : 'consumable',
                                            unit_cost: Number(item.unit_cost) || 0
                                          });
                                        }}
                                        title="Edit catalog item"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => deleteCtCatalogItem?.(item.id)}
                                        style={{ color: '#dc2626' }}
                                        title="Remove from catalog"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {renderCenterPaginationBar(paginateCenterRows(filteredCatalog))}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* SECTION 3: ORDERS & RECEIVING */}
      {section === 'orders_receiving' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', alignItems: 'start' }}>
          {/* Receiving Scanner & Validation Form */}
          <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ScanLine size={18} color="#0284c7" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Receive Consumables & Tools</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setPdfImportModalOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileSpreadsheet size={14} />
                  <span>Import CSV / Excel (XLSX)</span>
                </button>
              </div>
            </div>

            {recvFeedback && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  fontSize: '12.5px',
                  background: !recvFeedback.ok ? '#fef2f2' : recvFeedback.isOverDelivery ? '#fffbeb' : recvFeedback.isPartialDelivery ? '#eff6ff' : '#ecfdf5',
                  border: `1px solid ${!recvFeedback.ok ? '#fecaca' : recvFeedback.isOverDelivery ? '#fde68a' : recvFeedback.isPartialDelivery ? '#bfdbfe' : '#a7f3d0'}`,
                  color: !recvFeedback.ok ? '#991b1b' : recvFeedback.isOverDelivery ? '#92400e' : recvFeedback.isPartialDelivery ? '#1e40af' : '#065f46'
                }}
              >
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {!recvFeedback.ok ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                  <span>
                    {!recvFeedback.ok
                      ? `Blocked (${recvFeedback.errorCode})`
                      : recvFeedback.deliveryStatus === 'over_delivery'
                        ? `Over-Delivery Logged (+${recvFeedback.varianceQty} above PO)`
                        : recvFeedback.deliveryStatus === 'partial'
                          ? `Partial Delivery Recorded (${recvFeedback.remainingAfter} remaining)`
                          : 'Full Delivery Received Into Stock'}
                  </span>
                </div>
                {!recvFeedback.ok && <div style={{ marginTop: '4px' }}>{recvFeedback.message}</div>}
              </div>
            )}

            <form onSubmit={handleExecuteReceive} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div ref={poDropdownRef} style={{ position: 'relative' }}>
                <label className="form-label">Linked Purchase Order (Optional for Direct Scan)</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search
                    size={14}
                    color="#64748b"
                    style={{ position: 'absolute', left: '10px', pointerEvents: 'none' }}
                  />
                  <input
                    type="text"
                    className="form-control"
                    style={{ paddingLeft: '32px', paddingRight: (selectedOrderId || poDropdownQuery) ? '32px' : '10px' }}
                    value={
                      poDropdownOpen
                        ? poDropdownQuery
                        : activeReceivingOrder
                          ? `${activeReceivingOrder.po_number} · ${activeReceivingOrder.site_code} (${activeReceivingOrder.status})`
                          : ''
                    }
                    placeholder="Search PO Number (or leave blank for Direct / Ad-Hoc Receipt)..."
                    onFocus={() => {
                      setPoDropdownOpen(true);
                      setPoDropdownQuery('');
                    }}
                    onChange={(e) => {
                      setPoDropdownOpen(true);
                      setPoDropdownQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setPoDropdownOpen(false);
                        setPoDropdownQuery('');
                        e.currentTarget.blur();
                      } else if (e.key === 'Enter' && poDropdownOpen) {
                        e.preventDefault();
                        if (linkedOrderMatches.length > 0) {
                          handleSelectLinkedOrder(linkedOrderMatches[0].id);
                        }
                      }
                    }}
                  />
                  {(selectedOrderId || poDropdownQuery) && (
                    <button
                      type="button"
                      title="Clear linked PO (Direct / Ad-Hoc Receipt)"
                      onClick={() => {
                        setSelectedOrderId('');
                        setPoDropdownQuery('');
                        setPoDropdownOpen(false);
                      }}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        background: 'transparent',
                        border: 'none',
                        padding: '2px',
                        cursor: 'pointer',
                        color: '#64748b',
                        display: 'inline-flex',
                        alignItems: 'center'
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {poDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      zIndex: 30,
                      maxHeight: '240px',
                      overflowY: 'auto',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 10px 25px rgba(15, 23, 42, 0.12)',
                      padding: '4px'
                    }}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectLinkedOrder('');
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        border: 'none',
                        background: !selectedOrderId ? '#eff6ff' : 'transparent',
                        color: !selectedOrderId ? '#1d4ed8' : '#475569',
                        fontSize: '12.5px',
                        fontWeight: !selectedOrderId ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      -- Direct / Ad-Hoc Receipt (No PO) --
                    </button>

                    {linkedOrderMatches.length === 0 ? (
                      <div style={{ padding: '10px', fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
                        No purchase orders matching &ldquo;{poDropdownQuery}&rdquo;
                      </div>
                    ) : (
                      linkedOrderMatches.map(o => {
                        const isSelected = selectedOrderId === o.id;
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectLinkedOrder(o.id);
                            }}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '7px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              background: isSelected ? '#eff6ff' : 'transparent',
                              color: '#0f172a',
                              fontSize: '12.5px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '8px',
                              cursor: 'pointer'
                            }}
                          >
                            <span>
                              <span className="font-mono" style={{ fontWeight: 700 }}>{o.po_number}</span>
                              <span style={{ color: '#64748b' }}> · {o.site_code}</span>
                            </span>
                            <span style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', fontWeight: 600 }}>
                              {String(o.status || '').replace('_', ' ')}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {activeReceivingOrder && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                  <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                    PO Line Items (Click to autofill):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '165px', overflowY: 'auto' }}>
                    {(activeReceivingOrder.items || []).map(it => {
                      const rem = Math.max(0, (it.quantity_ordered || 0) - (it.quantity_received || 0));
                      const catEntry = catalogByPnMap.get(normalizePartNumber(it.part_number));
                      const itemDesc = it.description || catEntry?.description || '';
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => {
                            setRecvPn(it.part_number);
                            setRecvQty(String(Math.max(1, rem)));
                          }}
                          title={itemDesc ? `${it.part_number} — ${itemDesc}` : it.part_number}
                          style={{
                            textAlign: 'left',
                            padding: '6px 8px',
                            borderRadius: '6px',
                            border: normalizePartNumber(recvPn) === normalizePartNumber(it.part_number) ? '1px solid #0284c7' : '1px solid #e2e8f0',
                            background: normalizePartNumber(recvPn) === normalizePartNumber(it.part_number) ? '#f0f9ff' : '#ffffff',
                            fontSize: '12px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                            <span className="font-mono" style={{ fontWeight: 700, flexShrink: 0, color: '#0f172a' }}>{it.part_number}</span>
                            {itemDesc && (
                              <span style={{ color: '#475569', fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                — {itemDesc}
                              </span>
                            )}
                          </span>
                          <span style={{
                            flexShrink: 0,
                            fontSize: '11px',
                            fontWeight: 700,
                            color: rem === 0 ? '#15803d' : '#0369a1'
                          }}>
                            Rec: {it.quantity_received}/{it.quantity_ordered}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Item / Part Number *</label>
                  <input
                    type="text"
                    list="ct-catalog-datalist"
                    className="form-control font-mono"
                    value={recvPn}
                    onChange={(e) => setRecvPn(e.target.value.toUpperCase())}
                    placeholder="Scan barcode or enter PN..."
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Delivered Qty *</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control font-mono"
                    value={recvQty}
                    onChange={(e) => setRecvQty(e.target.value)}
                    required
                  />
                </div>
              </div>

              {matchedCatalogForReceive ? (
                <div style={{ fontSize: '12px', padding: '7px 10px', borderRadius: '6px', background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0c4a6e' }}>
                  <strong>{matchedCatalogForReceive.item_kind.toUpperCase()}</strong>: {matchedCatalogForReceive.description}
                  {matchedCatalogForReceive.is_serialized && ' (Requires matching serial number per unit)'}
                </div>
              ) : recvPn.trim() ? (
                <div style={{ fontSize: '12px', padding: '7px 10px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                  Part number not found in Parts Master Catalog or Priority Orders (will be blocked cleanly on submit).
                </div>
              ) : null}

              <div>
                <label className="form-label">Receiving Site *</label>
                <select className="form-select" value={recvSiteCode} onChange={(e) => setRecvSiteCode(e.target.value)}>
                  {siteChoices.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                </select>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" style={{ marginBottom: '4px' }}>
                    Serial Number(s) (if applicable — one per line / comma-separated)
                  </label>
                  <span className="font-mono" style={{ fontSize: '11px', color: '#475569' }}>
                    {parsedRecvSerialPreview.serials.length} scanned
                  </span>
                </div>
                <textarea
                  rows={3}
                  className="form-control font-mono"
                  value={recvSerials}
                  onChange={(e) => setRecvSerials(e.target.value)}
                  placeholder="Scan or enter serial number(s) whenever the part has one (leave blank for non-serialized items)..."
                  style={{ fontSize: '12px' }}
                />
              </div>

              <div>
                <label className="form-label">Receiving Remarks</label>
                <input type="text" className="form-control" value={recvNotes} onChange={(e) => setRecvNotes(e.target.value)} placeholder="Delivery receipt / waybill note..." />
              </div>

              <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <PackageCheck size={16} />
                <span>Validate & Receive Into Stock</span>
              </button>
            </form>
          </div>

          {/* Orders List (40 Priority Orders + Custom POs) */}
          <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Purchase Orders ({filteredOrders.length})</h3>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {userCanEdit && (
                  <>
                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                      <span>Import Priority CSV</span>
                      <input type="file" accept=".csv" onChange={handlePriorityReimport} style={{ display: 'none' }} />
                    </label>
                    <button type="button" className="btn btn-primary btn-sm" onClick={openNewPoModal}>
                      + New PO
                    </button>
                  </>
                )}
              </div>
            </div>

            <input
              type="text"
              className="form-input"
              placeholder="Filter PO#, site, part number..."
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              style={{ marginBottom: '10px', height: '36px', fontSize: '12.5px' }}
            />

            <div style={{ maxHeight: '520px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredOrders.map(ord => {
                const orderedSum = (ord.items || []).reduce((s, it) => s + (it.quantity_ordered || 0), 0);
                const receivedSum = (ord.items || []).reduce((s, it) => s + (it.quantity_received || 0), 0);
                const isSelected = selectedOrderId === ord.id;
                return (
                  <div
                    key={ord.id}
                    onClick={() => {
                      setSelectedOrderId(ord.id);
                      if (ord.site_code) setRecvSiteCode(ord.site_code);
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: isSelected ? '1.5px solid #0284c7' : '1px solid #e2e8f0',
                      background: isSelected ? '#f0f9ff' : '#ffffff',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span className="font-mono" style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>{ord.po_number}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 7px', borderRadius: '10px', background: ord.status === 'received' ? '#dcfce7' : ord.status === 'partially_received' ? '#dbeafe' : '#fef9c3', color: ord.status === 'received' ? '#166534' : ord.status === 'partially_received' ? '#1d4ed8' : '#854d0e' }}>
                          {ord.status.replace('_', ' ')}
                        </span>
                        {userCanEdit && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              title="Edit Purchase Order"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditPoModal(ord);
                              }}
                              style={{ padding: '3px 7px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                            >
                              <Pencil size={11} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              title="Delete Purchase Order"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmPo(ord);
                              }}
                              style={{ padding: '3px 7px', fontSize: '11px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                            >
                              <Trash2 size={11} />
                              <span>Delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Site: <strong>{ord.site_code}</strong> · {ord.items?.length || 0} line(s)</span>
                      <span className="font-mono">Qty {receivedSum}/{orderedSum}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CSV / Excel Import History Log */}
          <div className="card" style={{ gridColumn: '1 / -1', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileSpreadsheet size={18} color="#059669" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800 }}>
                    CSV / Excel Import History Log ({ctPdfImports.length})
                  </h3>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    Audit trail of all structured CSV &amp; Excel (XLSX) reports imported into Consumables &amp; Tools
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setPdfImportModalOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
              >
                <FileSpreadsheet size={14} />
                <span>Import CSV / Excel</span>
              </button>
            </div>

            {ctPdfImports.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                No CSV or Excel reports imported yet. Click <strong>Import CSV / Excel (XLSX)</strong> to upload structured reports generated by Gemini.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', fontSize: '12.5px' }}>
                  <thead>
                    <tr>
                      <th>Imported At</th>
                      <th>Report Ref / File</th>
                      <th>Site</th>
                      <th>Format</th>
                      <th>Items Added</th>
                      <th>Status</th>
                      <th>Imported By</th>
                      <th style={{ textAlign: 'right' }}>Source File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ctPdfImports.map(imp => {
                      const statusColors =
                        imp.status === 'completed'
                          ? { bg: '#dcfce7', fg: '#166534', label: 'COMPLETED' }
                          : imp.status === 'partial'
                            ? { bg: '#fef3c7', fg: '#92400e', label: 'PARTIAL' }
                            : imp.status === 'duplicate_blocked'
                              ? { bg: '#fee2e2', fg: '#991b1b', label: 'DUPLICATE BLOCKED' }
                              : { bg: '#fee2e2', fg: '#991b1b', label: 'FAILED' };
                      return (
                        <tr key={imp.id}>
                          <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                            <div>{imp.imported_at ? new Date(imp.imported_at).toLocaleDateString() : '—'}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {imp.imported_at ? formatTo12HourTime(imp.imported_at) : ''}
                            </div>
                          </td>
                          <td>
                            <div className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                              {imp.report_ref || '—'}
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#64748b' }}>{imp.filename}</div>
                          </td>
                          <td style={{ fontWeight: 700 }}>{imp.site_code || '—'}</td>
                          <td style={{ fontSize: '11.5px', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>
                            {imp.extraction_method || 'XLSX'}
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              {imp.tools_created_count || 0} tool(s) · {imp.consumables_qty_added || 0} consumable(s)
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {imp.items_imported_count || 0} line(s)
                              {imp.drive_file_id ? ' · Drive Archived' : ''}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '10.5px',
                                fontWeight: 800,
                                background: statusColors.bg,
                                color: statusColors.fg
                              }}
                            >
                              {statusColors.label}
                            </span>
                          </td>
                          <td>{imp.imported_by_name || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {imp.status !== 'duplicate_blocked' && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openCtSourcePdf?.(imp)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <Download size={13} />
                                <span>File</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 4: DEDICATED SHIPPING & PACKING LIST */}
      {section === 'shipping' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', alignItems: 'start' }}>
          <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Truck size={18} color="#0284c7" />
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Create Consumables & Tools Shipment</h3>
                <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>Generates a dedicated CT Packing List separate from Repair Parts shipments.</p>
              </div>
            </div>

            <form onSubmit={handleCreateShipmentSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Ship From *</label>
                  <select
                    className="form-select"
                    value={shipFromSite}
                    onChange={(e) => {
                      setShipFromSite(e.target.value);
                      setAddLinePn('');
                      setAddLineSourceSite('');
                      setAddLineAssetIds([]);
                    }}
                  >
                    {siteChoices.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Ship To *</label>
                  <select
                    className="form-select"
                    value={shipToSite}
                    onChange={(e) => {
                      const nextCode = e.target.value;
                      setShipToSite(nextCode);
                      const targetSiteObj = siteChoices.find(s => s.code === nextCode);
                      if (targetSiteObj?.region) {
                        const isMM = targetSiteObj.region === 'Metro Manila';
                        setShipCarrier(isMM ? 'Lalamove' : `Lite Express (${shipFreightMode})`);
                      }
                      setCandidateSourceTab('site');
                      setAddLinePn('');
                      setAddLineQty('1');
                      setAddLineSourceSite('');
                      setAddLineAssetIds([]);
                    }}
                    required
                  >
                    <option value="">Select destination...</option>
                    {siteChoices.filter(s => s.code !== shipFromSite).map(s => {
                      const readyCount = siteReadyCounts[String(s.code).toUpperCase()] || 0;
                      return (
                        <option key={s.code} value={s.code}>
                          {s.code} — {s.name}{readyCount > 0 ? ` (${readyCount} SKU${readyCount === 1 ? '' : 's'} ready)` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', alignItems: 'start' }}>
                <div>
                  <label className="form-label">Carrier / Courier</label>
                  <select
                    className="form-select"
                    value={
                      String(shipCarrier || '').toLowerCase().includes('lite express')
                        ? 'Lite Express'
                        : (String(shipCarrier || '').toLowerCase().includes('utility') ? 'Utility' : 'Lalamove')
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      setShipCarrier(val === 'Lite Express' ? `Lite Express (${shipFreightMode})` : val);
                    }}
                  >
                    <option value="Lalamove">Lalamove (MM)</option>
                    <option value="Lite Express">Lite Express (Prov)</option>
                    <option value="Utility">Utility Pickup</option>
                  </select>
                  {String(shipCarrier || '').toLowerCase().includes('lite express') && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginTop: '5px', background: '#f8fafc', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#475569' }}>FREIGHT:</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {['Air', 'Land'].map(mode => {
                          const active = shipFreightMode === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setShipFreightMode(mode);
                                setShipCarrier(`Lite Express (${mode})`);
                              }}
                              style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '10.5px',
                                fontWeight: 700,
                                border: active ? '1px solid #0284c7' : '1px solid #cbd5e1',
                                background: active ? '#0284c7' : '#ffffff',
                                color: active ? '#ffffff' : '#475569',
                                cursor: 'pointer'
                              }}
                            >
                              {mode}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="form-label">Waybill / Tracking #</label>
                  <input type="text" className="form-control font-mono" value={shipTracking} onChange={(e) => setShipTracking(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">TS Number</label>
                  <input type="text" className="form-control font-mono" placeholder="e.g. TS-2026-0001" value={shipTsNumber} onChange={(e) => setShipTsNumber(e.target.value)} />
                </div>
              </div>

              {/* Security Scan-to-Box & Auto-Entry Station (matches Pack Scan-Out for Displays/Batteries) */}
              <div style={{ background: '#0f172a', color: '#f8fafc', borderRadius: '8px', padding: '11px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ScanLine size={15} color="#38bdf8" />
                    <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.02em' }}>
                      Security Scan-to-Box (Part # &amp; Serial #)
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#cbd5e1', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={packAutoAdd}
                        onChange={(e) => setPackAutoAdd(e.target.checked)}
                      />
                      <span>Auto-Add on Scan</span>
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#bae6fd', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={requireScanVerification}
                        onChange={(e) => setRequireScanVerification(e.target.checked)}
                      />
                      <span>Require Scan-to-Box</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: pendingScanPn ? '1fr 1fr auto' : '1.4fr 1fr auto', gap: '6px', alignItems: 'center' }}>
                  <input
                    ref={packScanRef}
                    type="text"
                    className="form-control font-mono"
                    placeholder={pendingScanPn ? `Locked: ${pendingScanPn}` : 'Scan Part # or Serial / Asset Tag...'}
                    value={packScanInput}
                    onChange={(e) => handlePackScanChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        executePackScan();
                      }
                    }}
                    disabled={Boolean(pendingScanPn)}
                    style={{ height: '34px', fontSize: '12px', background: pendingScanPn ? '#1e293b' : '#ffffff', color: pendingScanPn ? '#94a3b8' : '#0f172a' }}
                  />
                  <input
                    ref={packSerialRef}
                    type="text"
                    className="form-control font-mono"
                    placeholder={pendingScanPn ? `Scan Serial for ${pendingScanPn}...` : 'Serial # (if tool has S/N)...'}
                    value={packSerialInput}
                    onChange={(e) => handlePackSerialChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        executePackScan();
                      }
                    }}
                    style={{
                      height: '34px',
                      fontSize: '12px',
                      background: '#ffffff',
                      color: '#0f172a',
                      border: pendingScanPn ? '2px solid #38bdf8' : undefined
                    }}
                  />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => executePackScan()}
                      style={{ height: '34px', whiteSpace: 'nowrap' }}
                    >
                      Place in Box
                    </button>
                    {pendingScanPn && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setPendingScanPn('');
                          setPackScanInput('');
                          setPackSerialInput('');
                          setPackScanFeedback(null);
                        }}
                        title="Cancel pending serial scan"
                        style={{ height: '34px', padding: '0 8px' }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {packScanFeedback && (
                  <div
                    style={{
                      marginTop: '7px',
                      padding: '6px 9px',
                      borderRadius: '6px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: !packScanFeedback.ok ? '#7f1d1d' : packScanFeedback.pending ? '#1e3a8a' : '#064e3b',
                      color: '#ffffff'
                    }}
                  >
                    {!packScanFeedback.ok ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                    <span>{packScanFeedback.message}</span>
                  </div>
                )}
              </div>

              {/* Line Builder: Auto-Loaded Site Part Numbers */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                    {shipToSite
                      ? `Available Items for ${shipToSite} (${activeCandidatePool.filter(c => c.remainingQty > 0).length})`
                      : 'Add Items to Packing List'}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {shipToSite && sitePackingCandidates.fromCandidates.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setCandidateSourceTab('site'); setAddLinePn(''); }}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            border: effectiveCandidateTab === 'site' ? '1px solid #0284c7' : '1px solid #cbd5e1',
                            background: effectiveCandidateTab === 'site' ? '#e0f2fe' : '#ffffff',
                            color: effectiveCandidateTab === 'site' ? '#0369a1' : '#475569',
                            cursor: 'pointer'
                          }}
                        >
                          {shipToSite} ({sitePackingCandidates.siteCandidates.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCandidateSourceTab('from'); setAddLinePn(''); }}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            border: effectiveCandidateTab === 'from' ? '1px solid #0284c7' : '1px solid #cbd5e1',
                            background: effectiveCandidateTab === 'from' ? '#e0f2fe' : '#ffffff',
                            color: effectiveCandidateTab === 'from' ? '#0369a1' : '#475569',
                            cursor: 'pointer'
                          }}
                        >
                          {shipFromSite} Pool ({sitePackingCandidates.fromCandidates.length})
                        </button>
                      </>
                    )}
                    {activeCandidatePool.some(c => c.remainingQty > 0) && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleAddAllSiteCandidates}
                        style={{ padding: '4px 9px', fontSize: '11px' }}
                      >
                        Add All Available ({activeCandidatePool.filter(c => c.remainingQty > 0).length})
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Site-Filtered Selector (Select without typing) */}
                {activeCandidatePool.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px', maxHeight: '190px', overflowY: 'auto', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px' }}>
                    {activeCandidatePool.map(cand => (
                      <div
                        key={`${cand.part_number}-${cand.sourceSiteCode}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          background: normalizePartNumber(addLinePn) === normalizePartNumber(cand.part_number) ? '#f0f9ff' : '#f8fafc',
                          border: normalizePartNumber(addLinePn) === normalizePartNumber(cand.part_number) ? '1px solid #38bdf8' : '1px solid #e2e8f0',
                          opacity: cand.remainingQty <= 0 ? 0.55 : 1
                        }}
                      >
                        <div
                          onClick={() => {
                            if (cand.remainingQty <= 0) return;
                            setAddLinePn(cand.part_number);
                            setAddLineQty(String(cand.remainingQty));
                            setAddLineSourceSite(cand.sourceSiteCode || shipFromSite);
                            setAddLineAssetIds([]);
                          }}
                          style={{ flex: 1, minWidth: 0, cursor: cand.remainingQty > 0 ? 'pointer' : 'default' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span className="font-mono" style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a' }}>{cand.part_number}</span>
                            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: '4px', background: cand.item_kind === 'tool' ? '#e0f2fe' : '#dcfce7', color: cand.item_kind === 'tool' ? '#0369a1' : '#166534' }}>
                              {cand.item_kind}
                            </span>
                            <span className="font-mono" style={{ fontSize: '11px', fontWeight: 700, color: cand.remainingQty > 0 ? '#0369a1' : '#94a3b8' }}>
                              Avail: {cand.remainingQty}
                            </span>
                            {cand.poNumbers?.length > 0 && (
                              <span style={{ fontSize: '10.5px', color: '#64748b' }}>({cand.poNumbers.join(', ')})</span>
                            )}
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cand.description}
                          </div>
                          {cand.serial_numbers?.length > 0 && (
                            <div className="font-mono" style={{ fontSize: '10.5px', color: '#0369a1', marginTop: '2px' }}>
                              S/N: {cand.serial_numbers.join(', ')}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={cand.remainingQty <= 0}
                          onClick={() => addCandidateToPackingList(cand, cand.remainingQty)}
                          style={{ padding: '4px 9px', fontSize: '11px', whiteSpace: 'nowrap' }}
                        >
                          {cand.remainingQty > 0 ? `+ Add (${cand.remainingQty})` : 'Added'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {shipToSite && activeCandidatePool.length === 0 && (
                  <div style={{ padding: '8px 10px', marginBottom: '8px', borderRadius: '6px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '11.5px', color: '#92400e' }}>
                    No received or assigned Consumables/Tools currently in stock for <strong>{shipToSite}</strong>. Receive items under <strong>Orders & Receiving</strong> or use manual PN entry below.
                  </div>
                )}

                {/* Dropdown selector (custom qty) + optional manual PN fallback */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.7fr auto', gap: '6px', alignItems: 'center' }}>
                  {manualPnMode ? (
                    <input
                      type="text"
                      list="ct-catalog-datalist"
                      className="form-control font-mono"
                      placeholder="Enter Part Number..."
                      value={addLinePn}
                      onChange={(e) => {
                        setAddLinePn(e.target.value.toUpperCase());
                        setAddLineAssetIds([]);
                      }}
                      style={{ height: '34px', fontSize: '12px' }}
                    />
                  ) : (
                    <select
                      className="form-select font-mono"
                      value={addLinePn}
                      onChange={(e) => {
                        const pn = e.target.value;
                        setAddLinePn(pn);
                        const match = activeCandidatePool.find(c => normalizePartNumber(c.part_number) === normalizePartNumber(pn));
                        setAddLineQty(match ? String(Math.max(1, match.remainingQty)) : '1');
                        setAddLineSourceSite(match?.sourceSiteCode || shipFromSite);
                        setAddLineAssetIds([]);
                      }}
                      style={{ height: '34px', fontSize: '12px' }}
                    >
                      <option value="">
                        {activeCandidatePool.length > 0
                          ? `Select part number (${activeCandidatePool.filter(c => c.remainingQty > 0).length} available)...`
                          : 'Select Ship To site first...'}
                      </option>
                      {activeCandidatePool.filter(c => c.remainingQty > 0).map(c => (
                        <option key={`${c.part_number}-${c.sourceSiteCode}`} value={c.part_number}>
                          {c.part_number} — {c.description} (Avail: {c.remainingQty})
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    min="1"
                    max={selectedCandidate ? Math.max(1, selectedCandidate.remainingQty) : undefined}
                    className="form-control font-mono"
                    value={addLineQty}
                    onChange={(e) => setAddLineQty(e.target.value)}
                    style={{ height: '34px', fontSize: '12px' }}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddShipmentLine} style={{ height: '34px' }}>
                    Add
                  </button>
                </div>

                <div style={{ marginTop: '5px', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setManualPnMode(v => !v);
                      setAddLinePn('');
                      setAddLineAssetIds([]);
                    }}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', color: '#0284c7', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {manualPnMode ? 'Use site part dropdown' : 'Enter part number manually instead'}
                  </button>
                </div>

                {(selectedCandidate?.item_kind === 'tool' || addLineCatalogMatch?.item_kind === 'tool') && availableAssetsForAddLine.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                      Pick Specific Tool Serial / Asset Tags (optional, {availableAssetsForAddLine.length} available at {selectedCandidate?.sourceSiteCode || addLineSourceSite || shipFromSite}):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '95px', overflowY: 'auto' }}>
                      {availableAssetsForAddLine.map(a => {
                        const checked = addLineAssetIds.includes(a.id);
                        return (
                          <label key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '3px 7px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setAddLineAssetIds(prev => (checked ? prev.filter(id => id !== a.id) : [...prev, a.id]))
                              }
                            />
                            <span className="font-mono">{a.serial_number || a.asset_tag}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {shipLines.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#334155', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Box Contents / Manifest ({shipLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)} units)</span>
                      <span style={{ color: shipLines.every(l => l.box_verified) ? '#15803d' : '#b45309' }}>
                        {shipLines.filter(l => l.box_verified).length}/{shipLines.length} Scanned in Box
                      </span>
                    </div>
                    {shipLines.map((ln, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', background: ln.box_verified ? '#f0fdf4' : '#ffffff', padding: '6px 8px', borderRadius: '6px', border: ln.box_verified ? '1px solid #86efac' : '1px solid #cbd5e1', fontSize: '12px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div>
                            <strong className="font-mono">{ln.part_number}</strong> · {ln.description} (x{ln.quantity})
                            {ln.sourceSiteCode && ln.sourceSiteCode !== shipFromSite && (
                              <span style={{ marginLeft: '6px', fontSize: '10.5px', color: '#64748b' }}>[{ln.sourceSiteCode}]</span>
                            )}
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: ln.box_verified ? '#dcfce7' : '#fef3c7',
                                color: ln.box_verified ? '#166534' : '#92400e'
                              }}
                            >
                              {ln.box_verified ? 'IN BOX · SCANNED' : 'UNVERIFIED'}
                            </span>
                          </div>
                          {ln.serial_numbers?.length > 0 && (
                            <div className="font-mono" style={{ fontSize: '10.5px', color: '#475569', marginTop: '2px' }}>
                              S/N: {ln.serial_numbers.join(', ')}
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={() => setShipLines(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="form-label">Notes / Instructions</label>
                  <input type="text" className="form-control" value={shipNotes} onChange={(e) => setShipNotes(e.target.value)} placeholder="Handling / signature note..." />
                </div>
                <div>
                  <label className="form-label">Authorized Signatory Name</label>
                  <input type="text" className="form-control" value={shipSignature} onChange={(e) => setShipSignature(e.target.value)} placeholder="Receiver / Guard on duty..." />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={shipLines.length === 0 || !shipToSite} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <FileText size={16} />
                <span>Dispatch & Generate CT Packing List</span>
              </button>
            </form>
          </div>

          {/* Dedicated Consumables & Tools Shipments List */}
          <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 800 }}>
              Consumables & Tools Shipments ({ctShipments.length})
            </h3>
            {ctShipments.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#64748b' }}>
                No consumables/tools shipments dispatched yet. Use the form on the left to build one and download its dedicated PDF packing list.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '580px', overflowY: 'auto' }}>
                {ctShipments.map(shp => (
                  <div key={shp.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#ffffff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <div>
                        <span className="font-mono" style={{ fontWeight: 800, color: '#0f172a', fontSize: '13.5px' }}>{shp.packing_list_number}</span>
                        {shp.ts_number && (
                          <span className="font-mono" style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '6px' }}>
                            TS: {shp.ts_number}
                          </span>
                        )}
                        <span style={{ marginLeft: '8px', fontSize: '11px', color: '#64748b' }}>{shp.shipment_date}</span>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: '10px', background: shp.status === 'delivered' ? '#dcfce7' : '#e0f2fe', color: shp.status === 'delivered' ? '#166534' : '#0369a1' }}>
                        {shp.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#334155', marginTop: '5px' }}>
                      <strong>{shp.from_site_code}</strong> → <strong>{shp.to_site_code}</strong> ({shp.to_site_name}) · {shp.items?.length || 0} line(s)
                    </div>
                    {shp.received_by_name && (
                      <div style={{ fontSize: '11.5px', color: '#15803d', marginTop: '3px' }}>
                        Signed & received by {shp.received_by_name}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDetailsShipment(shp)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <FileText size={13} />
                        <span>Details</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setDownloadChoiceShipment(shp)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <Download size={13} />
                        <span>Download PDF</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => printConsumablesToolsPackingListDirect(shp, { toAddress: getSiteAddressForPdf(shp.to_site_code) })}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <Printer size={13} />
                        <span>Print</span>
                      </button>
                      {shp.status !== 'delivered' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setDeliveryModalShipment(shp);
                            setDeliveryReceiverName(currentUser?.fullName || '');
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        >
                          <ArrowRightLeft size={13} />
                          <span>Confirm Delivery</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 5: CONSOLIDATED MOVEMENT HISTORY & SHIPMENT ARCHIVE */}
      {section === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Archive Header & Filters */}
          <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                  Consumables &amp; Tools Movement &amp; Shipment Archive
                </h2>
                <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  Consolidated all-sites movement history, packing list dispatches, and delivery confirmations ({ctShipments.length} shipments · {ctMovements.length} movements)
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search PL #, TS #, PO #, PN, serial, site..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  style={{ height: '34px', fontSize: '12.5px', width: '250px' }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={isExportingExcel}
                  onClick={handleExportMovementsExcel}
                  title="Download formatted Excel (.xlsx) report of filtered movements & shipments"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <FileSpreadsheet size={13} />
                  <span>{isExportingExcel ? 'Exporting...' : 'Export Excel (.xlsx)'}</span>
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportMovementsCsv} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <Download size={13} />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Region, Site & Date Range Filter Row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Region:</span>
                {['ALL', 'Metro Manila', 'Province'].map(reg => (
                  <button
                    key={reg}
                    type="button"
                    onClick={() => setHistoryRegionFilter(reg)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      border: historyRegionFilter === reg ? '1px solid #0f172a' : '1px solid #cbd5e1',
                      background: historyRegionFilter === reg ? '#0f172a' : '#ffffff',
                      color: historyRegionFilter === reg ? '#ffffff' : '#475569',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {reg === 'ALL' ? 'All Sites' : reg}
                  </button>
                ))}
                <select
                  className="form-select"
                  value={historySiteFilter}
                  onChange={(e) => setHistorySiteFilter(e.target.value)}
                  style={{ height: '30px', fontSize: '12px', width: '195px', padding: '2px 8px' }}
                >
                  <option value="ALL">All Locations ({siteChoices.length})</option>
                  {siteChoices.map(s => (
                    <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                  ))}
                </select>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Date:</span>
                  <input
                    type="date"
                    value={historyDateFrom}
                    onChange={(e) => setHistoryDateFrom(e.target.value)}
                    title="Filter from date"
                    style={{ height: '30px', fontSize: '11.5px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>→</span>
                  <input
                    type="date"
                    value={historyDateTo}
                    onChange={(e) => setHistoryDateTo(e.target.value)}
                    title="Filter to date"
                    style={{ height: '30px', fontSize: '11.5px', padding: '2px 6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>
                {(historyRegionFilter !== 'ALL' || historySiteFilter !== 'ALL' || historyActionFilter !== 'ALL' || historyDateFrom || historyDateTo || historySearch) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setHistoryRegionFilter('ALL');
                      setHistorySiteFilter('ALL');
                      setHistoryActionFilter('ALL');
                      setHistoryDateFrom('');
                      setHistoryDateTo('');
                      setHistorySearch('');
                      setHistoryDisplayLimit(200);
                    }}
                    style={{ height: '28px', padding: '0 8px', fontSize: '11px' }}
                  >
                    Reset Filters
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  { id: 'combined', label: 'Combined View' },
                  { id: 'shipments', label: `Shipments Archive (${filteredHistoryShipments.length})` },
                  { id: 'movements', label: `All Item Movements (${filteredMovements.length})` }
                ].map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setHistoryViewMode(v.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '7px',
                      border: historyViewMode === v.id ? '1px solid #0284c7' : '1px solid #cbd5e1',
                      background: historyViewMode === v.id ? '#e0f2fe' : '#ffffff',
                      color: historyViewMode === v.id ? '#0369a1' : '#475569',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4 KPI Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '10px', marginTop: '12px' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Total Movements</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>{historyStats.totalMovements}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Across all filtered sites</div>
              </div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>Shipped / In Transit</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#92400e', marginTop: '2px' }}>{historyStats.shippedCount}</div>
                <div style={{ fontSize: '11px', color: '#b45309' }}>{historyStats.shippedUnits} units in transit</div>
              </div>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>Delivered Confirmed</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#166534', marginTop: '2px' }}>{historyStats.deliveredCount}</div>
                <div style={{ fontSize: '11px', color: '#15803d' }}>{historyStats.deliveredUnits} units branch verified</div>
              </div>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 14px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase' }}>Today&apos;s Activity</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#1e40af', marginTop: '2px' }}>{historyStats.todayCount}</div>
                <div style={{ fontSize: '11px', color: '#1d4ed8' }}>Movements logged today</div>
              </div>
            </div>
          </div>

          {/* Consolidated Shipments & Packing Lists Table (All Sites) */}
          {(historyViewMode === 'combined' || historyViewMode === 'shipments') && (
            <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#0f172a' }}>
                  Consolidated Shipments &amp; Packing Lists ({filteredHistoryShipments.length})
                </span>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>All sites combined · Click PDF for PL Only or PL + Declaration Form</span>
              </div>
              <div className="table-container" style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                <table className="data-table" style={{ width: '100%', fontSize: '12px', minWidth: '880px' }}>
                  <thead>
                    <tr>
                      <th>Packing List / TS #</th>
                      <th>Destination Site</th>
                      <th>Ship &amp; Receive Dates</th>
                      <th>Courier &amp; Tracking</th>
                      <th style={{ textAlign: 'center' }}>Total Qty</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryShipments.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '22px', color: '#64748b' }}>
                          No Consumables &amp; Tools shipments match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredHistoryShipments.map(shp => {
                        const reg = siteRegionMap.get(String(shp.to_site_code || '').toUpperCase()) || 'Province';
                        const totalUnits = (shp.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
                        return (
                          <tr
                            key={shp.id}
                            onClick={() => setDetailsShipment(shp)}
                            style={{ cursor: 'pointer' }}
                            title="Click to view all Consumables & Tools in this shipment"
                          >
                            <td>
                              <div className="font-mono" style={{ fontWeight: 800, color: '#0369a1', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{shp.packing_list_number}</div>
                              {shp.ts_number && (
                                <div className="font-mono" style={{ fontSize: '11px', color: '#0f172a', fontWeight: 700 }}>TS: {shp.ts_number}</div>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <strong>{shp.to_site_code}</strong>
                                <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: reg === 'Metro Manila' ? '#dbeafe' : '#f3e8ff', color: reg === 'Metro Manila' ? '#1d4ed8' : '#7e22ce', textTransform: 'uppercase' }}>
                                  {reg}
                                </span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{shp.to_site_name || shp.to_site_code}</div>
                            </td>
                            <td className="font-mono" style={{ fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                              <div>SHIP: {shp.shipment_date || formatMovementDate(shp.created_at)}</div>
                              {shp.received_at && (
                                <div style={{ color: '#15803d', fontWeight: 700 }}>RECV: {String(shp.received_at).slice(0, 10)}</div>
                              )}
                            </td>
                            <td style={{ fontSize: '11.5px' }}>
                              <div style={{ fontWeight: 700 }}>{shp.carrier || 'Lalamove'}</div>
                              {shp.tracking_number && <div className="font-mono" style={{ color: '#475569' }}>WAYBILL #{shp.tracking_number}</div>}
                              <div style={{ color: '#64748b' }}>Prep: {shp.prepared_by_name || 'DC Staff'}</div>
                              {shp.received_by_name && <div style={{ color: '#15803d' }}>Recv by: {shp.received_by_name}</div>}
                            </td>
                            <td className="font-mono" style={{ textAlign: 'center', fontWeight: 800 }}>
                              {totalUnits} <span style={{ fontWeight: 400, color: '#64748b', fontSize: '11px' }}>({shp.items?.length || 0} lines)</span>
                            </td>
                            <td>
                              <span style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: '999px', background: shp.status === 'delivered' ? '#dcfce7' : '#e0f2fe', color: shp.status === 'delivered' ? '#166534' : '#0369a1' }}>
                                {shp.status === 'delivered' ? 'Delivered Confirmed' : shp.status}
                              </span>
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setDetailsShipment(shp)}
                                  style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                >
                                  <FileText size={12} />
                                  <span>Details</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setDownloadChoiceShipment(shp)}
                                  style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                >
                                  <Download size={12} />
                                  <span>PDF</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => printConsumablesToolsPackingListDirect(shp, { toAddress: getSiteAddressForPdf(shp.to_site_code) })}
                                  style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                >
                                  <Printer size={12} />
                                  <span>Print</span>
                                </button>
                                {(shp.signed_pl_web_view_link || shp.drive_pl_web_view_link) && (
                                  <a
                                    href={shp.signed_pl_web_view_link || shp.drive_pl_web_view_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '3px 8px', fontSize: '11px', textDecoration: 'none' }}
                                    title={shp.signed_pl_filename || shp.drive_pl_filename || 'Open stored Packing List in Google Drive'}
                                  >
                                    Drive PL
                                  </a>
                                )}
                                {shp.status !== 'delivered' && (
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => {
                                      setDeliveryModalShipment(shp);
                                      setDeliveryReceiverName(currentUser?.fullName || '');
                                    }}
                                    style={{ padding: '3px 8px', fontSize: '11px' }}
                                  >
                                    Confirm
                                  </button>
                                )}
                              </div>
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

          {/* All-Sites Movement Ledger */}
          {(historyViewMode === 'combined' || historyViewMode === 'movements') && (
            <div className="card" style={{ borderRadius: '12px', border: '1px solid #e2e8f0', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {['ALL', 'ordered', 'received', 'in_stock', 'consumed', 'checked_out', 'checked_in', 'shipped', 'delivered', 'status_change', 'updated'].map(act => {
                    const count = movementActionCounts[act] || 0;
                    if (act !== 'ALL' && count === 0 && historyActionFilter !== act) return null;
                    return (
                    <button
                      key={act}
                      type="button"
                      onClick={() => {
                        setHistoryActionFilter(act);
                        setHistoryDisplayLimit(200);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '7px',
                        border: historyActionFilter === act ? '1px solid #0284c7' : '1px solid #cbd5e1',
                        background: historyActionFilter === act ? '#e0f2fe' : '#ffffff',
                        color: historyActionFilter === act ? '#0369a1' : '#475569',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>{act.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: '10.5px', opacity: 0.75 }}>({count})</span>
                    </button>
                  );})}
                </div>
              </div>

              <div className="table-container" style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                <table className="data-table" style={{ width: '100%', fontSize: '12px', minWidth: '820px' }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Part Number</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'center' }}>Qty</th>
                      <th>From → To</th>
                      <th>Serials / Tags</th>
                      <th>Ref #</th>
                      <th>User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovements.slice(0, historyDisplayLimit).map(m => (
                      <tr key={m.id}>
                        <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>{formatMovementDate(m.created_at)}</div>
                          <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                            {formatTo12HourTime ? formatTo12HourTime(m.created_at) : ''}
                          </div>
                        </td>
                        <td style={{ fontWeight: 700, textTransform: 'uppercase' }}>{String(m.action || '').replace(/_/g, ' ')}</td>
                        <td className="font-mono" style={{ fontWeight: 700 }}>{m.part_number}</td>
                        <td>
                          <div>{m.description || '—'}</div>
                          {m.notes && m.action === 'updated' && (
                            <div style={{ fontSize: '11px', color: '#0369a1', marginTop: '2px' }}>{m.notes}</div>
                          )}
                        </td>
                        <td className="font-mono" style={{ textAlign: 'center', fontWeight: 700 }}>{m.quantity}</td>
                        <td>{m.from_site_code || '—'} → {m.to_site_code || '—'}</td>
                        <td className="font-mono">{[...(m.serial_numbers || []), ...(m.asset_tags || [])].join(', ') || '—'}</td>
                        <td className="font-mono">
                          {m.source_pdf_import_id || m.source_pdf_ref ? (
                            <button
                              type="button"
                              onClick={() => openCtSourcePdf?.(m.source_pdf_import_id || m.source_pdf_ref)}
                              title={`Open source PDF: ${m.source_pdf_filename || m.source_pdf_ref || m.reference_number}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 7px',
                                borderRadius: '999px',
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                color: '#1d4ed8',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              <FileText size={11} />
                              <span>{m.reference_number || m.source_pdf_ref}</span>
                            </button>
                          ) : (
                            m.reference_number || '—'
                          )}
                        </td>
                        <td>{m.performed_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredMovements.length > 0 && (
                <div style={{ padding: '10px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b', background: '#f8fafc' }}>
                  <span>
                    Showing <strong>{Math.min(historyDisplayLimit, filteredMovements.length)}</strong> of <strong>{filteredMovements.length}</strong> movement(s)
                  </span>
                  {filteredMovements.length > historyDisplayLimit && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setHistoryDisplayLimit(prev => prev + 200)}
                    >
                      Show More (+200)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* QR / Barcode Labels Modal */}
      {labelAssetsModal.length > 0 && (
        <ToolLabelPrintModal assets={labelAssetsModal} onClose={() => setLabelAssetsModal([])} />
      )}

      {/* Quick Consume Modal */}
      {consumeModalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setConsumeModalOpen(false); }}>
          <div className="modal-content" style={{ maxWidth: '430px', width: '94%' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>Log Consumable Usage</h3>
              <button type="button" onClick={() => setConsumeModalOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleConfirmConsume}>
              <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label className="form-label">In-Stock Consumable *</label>
                  <select
                    className="form-select font-mono"
                    value={consumePn}
                    onChange={(e) => setConsumePn(e.target.value)}
                    required
                  >
                    {inStockConsumables.map(row => {
                      const desc = row.description || catalogByPnMap.get(normalizePartNumber(row.part_number))?.description || '';
                      return (
                        <option key={`${row.part_number}-${row.site_code}`} value={row.part_number}>
                          {row.part_number}{desc ? ` — ${desc}` : ''} ({row.site_code}: {row.qty_on_hand} avail)
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="form-label">Site</label>
                  <select className="form-select" value={consumeSiteCode} onChange={(e) => setConsumeSiteCode(e.target.value)}>
                    {siteChoices.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Quantity Consumed</label>
                  <input type="number" min="1" className="form-control font-mono" value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} required />
                </div>
                <div>
                  <label className="form-label">Notes / Repair Ticket</label>
                  <input type="text" className="form-control" value={consumeNotes} onChange={(e) => setConsumeNotes(e.target.value)} placeholder="e.g. Bench usage / GSX repair #" />
                </div>
              </div>
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setConsumeModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Record Consumption</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Confirmation Modal */}
      {deliveryModalShipment && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDeliveryModalShipment(null); }}>
          <div className="modal-content" style={{ maxWidth: '430px', width: '94%' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>Confirm Receipt: {deliveryModalShipment.packing_list_number}</h3>
              <button type="button" onClick={() => setDeliveryModalShipment(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                let driveDocMeta = null;
                if (deliveryPlFile) {
                  setIsUploadingDeliveryPl(true);
                  const driveRes = await uploadCtPackingListToDrive({
                    file: deliveryPlFile,
                    shipment: deliveryModalShipment,
                    docKind: 'ct_receiving_packing_list'
                  });
                  setIsUploadingDeliveryPl(false);
                  if (driveRes.success && driveRes.fileId) {
                    driveDocMeta = {
                      signed_pl_file_id: driveRes.fileId,
                      signed_pl_web_view_link: driveRes.webViewLink || null,
                      signed_pl_filename: driveRes.filename || null,
                      signed_pl_site_folder: driveRes.siteFolder || null
                    };
                    showToast?.(
                      `Stored receiving PL in Google Drive (${driveRes.folderName} / ${driveRes.siteFolder})`,
                      'success'
                    );
                  } else if (driveRes.error && driveRes.error !== 'Google Drive not configured') {
                    showToast?.(`Drive upload note: ${driveRes.error}`, 'warning');
                  }
                }
                confirmCtDelivery({
                  shipmentId: deliveryModalShipment.id,
                  receivedByName: deliveryReceiverName.trim() || currentUser?.fullName || 'Branch Staff',
                  signatureName: deliveryReceiverName.trim(),
                  driveDocMeta
                });
                setDeliveryPlFile(null);
                setDeliveryModalShipment(null);
              }}
            >
              <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  Destination: <strong>{deliveryModalShipment.to_site_code}</strong> ({deliveryModalShipment.items?.length || 0} item lines)
                </div>
                <div>
                  <label className="form-label">Received By (Name / Signature) *</label>
                  <input type="text" className="form-control" value={deliveryReceiverName} onChange={(e) => setDeliveryReceiverName(e.target.value)} required />
                </div>
                <div>
                  <label className="form-label">Receiving / Signed Packing List File (Optional)</label>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="form-control"
                    onChange={(e) => setDeliveryPlFile(e.target.files?.[0] || null)}
                  />
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    Stored automatically in Google Drive: <strong>Consumables &amp; Tools Receiving Packing Lists / {deliveryModalShipment.to_site_code}</strong>
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setDeliveryPlFile(null); setDeliveryModalShipment(null); }} disabled={isUploadingDeliveryPl}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isUploadingDeliveryPl}>
                  {isUploadingDeliveryPl ? 'Uploading PL...' : 'Confirm Delivery'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit PO Modal (Full Scrollable Catalog Picker + Multi-Line) */}
      {showCreatePoModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowCreatePoModal(false); }}>
          <div className="modal-content" style={{ maxWidth: '760px', width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>
                {editingPoId ? `Edit Purchase Order: ${newPoForm.po_number}` : 'New Consumables / Tools Purchase Order'}
              </h3>
              <button type="button" onClick={() => setShowCreatePoModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreatePo} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
              <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label className="form-label">PO Number *</label>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="form-control font-mono"
                        value={newPoForm.po_number}
                        onChange={(e) => setNewPoForm(f => ({ ...f, po_number: e.target.value.toUpperCase().replace(/\s+/g, '') }))}
                        placeholder="e.g. GS1003315365"
                        style={{
                          borderColor: newPoForm.po_number && !isValidGsPoNumber(newPoForm.po_number) ? '#dc2626' : undefined
                        }}
                        required
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => setNewPoForm(f => ({ ...f, po_number: generateNextGsPoNumber(ctOrders) }))}
                        title="Auto-generate next GS PO Number"
                      >
                        Auto
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        marginTop: '4px',
                        color: newPoForm.po_number && !isValidGsPoNumber(newPoForm.po_number) ? '#dc2626' : '#64748b',
                        fontWeight: newPoForm.po_number && !isValidGsPoNumber(newPoForm.po_number) ? 600 : 400
                      }}
                    >
                      {newPoForm.po_number && !isValidGsPoNumber(newPoForm.po_number)
                        ? 'Invalid format: must be GS + 10 digits (e.g. GS1003315365)'
                        : 'Format: GS + 10 digits (e.g. GS1003315365)'}
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Destination Site *</label>
                    <select className="form-select" value={newPoForm.site_code} onChange={(e) => setNewPoForm(f => ({ ...f, site_code: e.target.value }))}>
                      {siteChoices.map(s => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label className="form-label">Supplier</label>
                    <input type="text" className="form-control" value={newPoForm.supplier} onChange={(e) => setNewPoForm(f => ({ ...f, supplier: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Remarks</label>
                    <input type="text" className="form-control" value={newPoForm.remarks} onChange={(e) => setNewPoForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional PO notes..." />
                  </div>
                </div>

                {/* Full Scrollable Parts Picker */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                      Select Parts from Catalog ({poCatalogMatches.total} matching)
                    </span>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {[
                        { id: 'ALL', label: 'All Parts' },
                        { id: 'consumable', label: 'Consumables' },
                        { id: 'tool', label: 'Tools' }
                      ].map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setPoPartFilter(f.id)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            border: poPartFilter === f.id ? '1px solid #0284c7' : '1px solid #cbd5e1',
                            background: poPartFilter === f.id ? '#e0f2fe' : '#ffffff',
                            color: poPartFilter === f.id ? '#0369a1' : '#475569',
                            cursor: 'pointer'
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Search any part number, description, or category..."
                      value={poPartSearch}
                      onChange={(e) => setPoPartSearch(e.target.value)}
                      style={{ paddingLeft: '32px', height: '34px', fontSize: '12.5px' }}
                    />
                  </div>

                  <div style={{ maxHeight: '210px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#ffffff' }}>
                    {poCatalogMatches.items.length === 0 ? (
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                        No parts match "{poPartSearch}".
                      </div>
                    ) : (
                      poCatalogMatches.items.map(part => {
                        const inOrder = newPoForm.items.find(it => normalizePartNumber(it.part_number) === normalizePartNumber(part.part_number));
                        return (
                          <div
                            key={part.id || part.part_number}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '7px 10px',
                              borderBottom: '1px solid #f1f5f9',
                              background: inOrder ? '#f0f9ff' : '#ffffff'
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span className="font-mono" style={{ fontWeight: 700, fontSize: '12px', color: '#0f172a' }}>{part.part_number}</span>
                                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: '4px', background: part.item_kind === 'tool' ? '#e0f2fe' : '#dcfce7', color: part.item_kind === 'tool' ? '#0369a1' : '#166534' }}>
                                  {part.item_kind || 'consumable'}
                                </span>
                                {part.category && (
                                  <span style={{ fontSize: '10.5px', color: '#64748b' }}>{part.category}</span>
                                )}
                              </div>
                              <div style={{ fontSize: '11.5px', color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {part.description}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleAddPartToPoForm(part)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 9px', fontSize: '11px', whiteSpace: 'nowrap' }}
                            >
                              <Plus size={12} />
                              <span>{inOrder ? `Added (${inOrder.quantity_ordered})` : 'Add'}</span>
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {poCatalogMatches.total > poCatalogMatches.items.length && (
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                      Showing first {poCatalogMatches.items.length} of {poCatalogMatches.total} parts — type in search to narrow down.
                    </div>
                  )}
                </div>

                {/* Selected PO Line Items */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
                    PO Line Items ({newPoForm.items.length})
                  </div>
                  {newPoForm.items.length === 0 ? (
                    <div style={{ padding: '12px', borderRadius: '6px', border: '1px dashed #cbd5e1', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                      Click <strong>+ Add</strong> on any part above to add it to this Purchase Order.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '165px', overflowY: 'auto' }}>
                      {newPoForm.items.map((it, idx) => (
                        <div key={`${it.part_number}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '12px' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <strong className="font-mono">{it.part_number}</strong> · {it.description}
                            {it.quantity_received > 0 && (
                              <span style={{ marginLeft: '6px', fontSize: '10.5px', color: '#0369a1' }}>(Rec: {it.quantity_received})</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <label style={{ fontSize: '11px', color: '#64748b' }}>Qty:</label>
                            <input
                              type="number"
                              min="1"
                              className="form-control font-mono"
                              value={it.quantity_ordered}
                              onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setNewPoForm(f => ({
                                  ...f,
                                  items: f.items.map((row, i) => (i === idx ? { ...row, quantity_ordered: val } : row))
                                }));
                              }}
                              style={{ width: '70px', height: '30px', fontSize: '12px' }}
                            />
                            <button
                              type="button"
                              onClick={() => setNewPoForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '2px' }}
                              title="Remove line"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreatePoModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={newPoForm.items.length === 0}>
                  {editingPoId ? 'Save PO Changes' : `Create Order (${newPoForm.items.length})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shipment Details Modal (View All Included Consumables & Tools) */}
      {detailsShipment && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDetailsShipment(null); }}>
          <div className="modal-content" style={{ maxWidth: '820px', width: '95%' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div>
                <h3 style={{ color: '#fff', fontSize: '15.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span>Shipment Manifest Details</span>
                  <span className="font-mono" style={{ fontSize: '12.5px', background: '#1e293b', color: '#38bdf8', padding: '2px 8px', borderRadius: '6px' }}>
                    {detailsShipment.packing_list_number}
                  </span>
                  {detailsShipment.ts_number && (
                    <span className="font-mono" style={{ fontSize: '12px', background: '#0369a1', color: '#fff', padding: '2px 8px', borderRadius: '6px' }}>
                      TS: {detailsShipment.ts_number}
                    </span>
                  )}
                </h3>
                <div style={{ color: '#94a3b8', fontSize: '11.5px', marginTop: '3px' }}>
                  {detailsShipment.shipment_number} · {detailsShipment.from_site_code} → {detailsShipment.to_site_code} ({detailsShipment.to_site_name || detailsShipment.to_site_code})
                </div>
              </div>
              <button type="button" onClick={() => setDetailsShipment(null)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Dispatch Summary Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', fontSize: '12px' }}>
                <div>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Courier &amp; Tracking</div>
                  <div style={{ fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>{detailsShipment.carrier || 'Lalamove'}</div>
                  {detailsShipment.tracking_number && (
                    <div className="font-mono" style={{ fontSize: '11px', color: '#475569' }}>#{detailsShipment.tracking_number}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Dispatch &amp; Receipt</div>
                  <div className="font-mono" style={{ color: '#0f172a', marginTop: '2px' }}>Ship: {detailsShipment.shipment_date || '—'}</div>
                  {detailsShipment.received_at && (
                    <div className="font-mono" style={{ color: '#15803d', fontWeight: 700, fontSize: '11px' }}>
                      Recv: {String(detailsShipment.received_at).slice(0, 10)} ({detailsShipment.received_by_name || 'Confirmed'})
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Prepared By</div>
                  <div style={{ fontWeight: 600, color: '#0f172a', marginTop: '2px' }}>{detailsShipment.prepared_by_name || 'DC Staff'}</div>
                  {detailsShipment.notes && (
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{detailsShipment.notes}</div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Status</div>
                  <div style={{ marginTop: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: '999px', background: detailsShipment.status === 'delivered' ? '#dcfce7' : '#e0f2fe', color: detailsShipment.status === 'delivered' ? '#166534' : '#0369a1' }}>
                      {detailsShipment.status === 'delivered' ? 'Delivered Confirmed' : detailsShipment.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Included Consumables & Tools Items Table */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>
                  <span>Included Consumables &amp; Tools ({detailsShipment.items?.length || 0} line items)</span>
                  <span className="font-mono" style={{ color: '#0369a1' }}>
                    Total Qty: {(detailsShipment.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)} units
                  </span>
                </div>
                <div className="table-container" style={{ maxHeight: '360px', overflowY: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                        <th>Part Number</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'center' }}>Qty</th>
                        <th>Serial Numbers / Asset Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailsShipment.items || []).length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '16px', color: '#64748b' }}>
                            No items recorded on this shipment.
                          </td>
                        </tr>
                      ) : (
                        (detailsShipment.items || []).map((it, idx) => {
                          const serials = Array.isArray(it.serial_numbers) ? it.serial_numbers.filter(Boolean) : [];
                          const tags = Array.isArray(it.asset_tags) ? it.asset_tags.filter(Boolean) : [];
                          return (
                            <tr key={it.id || `${it.part_number}-${idx}`}>
                              <td style={{ textAlign: 'center', color: '#64748b' }}>{idx + 1}</td>
                              <td className="font-mono" style={{ fontWeight: 700, color: '#0f172a' }}>{it.part_number}</td>
                              <td>
                                <span style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', padding: '2px 6px', borderRadius: '4px', background: it.item_kind === 'tool' ? '#e0f2fe' : '#dcfce7', color: it.item_kind === 'tool' ? '#0369a1' : '#166534' }}>
                                  {it.item_kind === 'tool' ? 'Tool' : 'Consumable'}
                                </span>
                              </td>
                              <td>{it.description || '—'}</td>
                              <td className="font-mono" style={{ textAlign: 'center', fontWeight: 800 }}>{it.quantity || 1}</td>
                              <td className="font-mono" style={{ fontSize: '11.5px', color: '#334155' }}>
                                {serials.length > 0 && <div>SN: {serials.join(', ')}</div>}
                                {tags.length > 0 && <div style={{ color: '#0369a1' }}>Tag: {tags.join(', ')}</div>}
                                {serials.length === 0 && tags.length === 0 && (
                                  <span style={{ color: '#94a3b8' }}>
                                    {it.item_kind === 'tool' ? 'Unserialized Tool' : 'Bulk Quantity'}
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
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const target = detailsShipment;
                    setDetailsShipment(null);
                    setDownloadChoiceShipment(target);
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <Download size={13} />
                  <span>Download PDF</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => printConsumablesToolsPackingListDirect(detailsShipment, { toAddress: getSiteAddressForPdf(detailsShipment.to_site_code) })}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <Printer size={13} />
                  <span>Print</span>
                </button>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setDetailsShipment(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Select Document Download Modal (PL Only vs PL + Declaration Form) */}
      {downloadChoiceShipment && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDownloadChoiceShipment(null); }}>
          <div className="modal-content" style={{ maxWidth: '480px', width: '94%' }}>
            <div className="modal-header" style={{ background: '#0f172a' }}>
              <div>
                <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>Select Document Download</h3>
                <div style={{ color: '#94a3b8', fontSize: '11.5px', marginTop: '2px' }}>
                  {downloadChoiceShipment.packing_list_number} · Destination: {downloadChoiceShipment.to_site_name || downloadChoiceShipment.to_site_code}
                </div>
              </div>
              <button type="button" onClick={() => setDownloadChoiceShipment(null)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12.5px', color: '#475569' }}>
                Choose which document format you would like to download for this shipment:
              </div>
              <button
                type="button"
                onClick={() => {
                  generateConsumablesToolsPackingListPDF(downloadChoiceShipment, {
                    toAddress: getSiteAddressForPdf(downloadChoiceShipment.to_site_code),
                    includeDeclarationForm: false
                  });
                  setDownloadChoiceShipment(null);
                }}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Packing List (PL Only)</strong>
                  <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: '#e0f2fe', color: '#0369a1' }}>Manifest Only</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
                  Standard warehouse dispatch manifest containing item numbers, descriptions, serial numbers, and quantities.
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb', marginTop: '6px' }}>Download PL Only →</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  generateConsumablesToolsPackingListPDF(downloadChoiceShipment, {
                    toAddress: getSiteAddressForPdf(downloadChoiceShipment.to_site_code),
                    includeDeclarationForm: true
                  });
                  setDownloadChoiceShipment(null);
                }}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #86efac',
                  background: '#f0fdf4',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Both (PL &amp; Declaration Form)</strong>
                  <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: '#dcfce7', color: '#166534' }}>Official Package</span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '4px' }}>
                  Complete corporate shipment package containing both the Packing List manifest and the official MDC Site Transfer Declaration Form.
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#15803d', marginTop: '6px' }}>Download Both (PL + Declaration) →</div>
              </button>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDownloadChoiceShipment(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete PO Confirmation Modal */}
      {deleteConfirmPo && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirmPo(null); }}>
          <div className="modal-content" style={{ maxWidth: '420px', width: '94%' }}>
            <div className="modal-header" style={{ background: '#7f1d1d' }}>
              <h3 style={{ color: '#fff', fontSize: '15px', margin: 0 }}>Delete Purchase Order</h3>
              <button type="button" onClick={() => setDeleteConfirmPo(null)} style={{ background: 'none', border: 'none', color: '#fecaca', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ padding: '16px', fontSize: '13px', color: '#334155' }}>
              Are you sure you want to delete Purchase Order <strong className="font-mono">{deleteConfirmPo.po_number}</strong> for <strong>{deleteConfirmPo.site_code}</strong> ({deleteConfirmPo.items?.length || 0} line(s))? This action cannot be undone.
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirmPo(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => {
                  const res = deleteCtOrder(deleteConfirmPo.id);
                  if (res?.ok && selectedOrderId === deleteConfirmPo.id) {
                    setSelectedOrderId('');
                  }
                  setDeleteConfirmPo(null);
                }}
              >
                Delete PO
              </button>
            </div>
          </div>
        </div>
      )}
      {/* CSV / Excel (XLSX) Tools & Consumables Import Modal */}
      <CtSpreadsheetImportModal
        isOpen={pdfImportModalOpen}
        onClose={() => setPdfImportModalOpen(false)}
        ctCatalog={ctCatalog}
        ctToolAssets={ctToolAssets}
        ctPdfImports={ctPdfImports}
        sites={sites}
        onCommitImport={commitCtPdfImport}
        onOpenSourceFile={openCtSourcePdf}
      />
    </div>
  );
}
