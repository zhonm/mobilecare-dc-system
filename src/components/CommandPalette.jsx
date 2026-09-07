import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { ALL_PAGES } from '../constants/navigation';
import { searchSerialsWithFullDetails } from '../utils/serialTracker';
import SerialDossierModal from './SerialDossierModal';
import {
  Search,
  ArrowRight,
  Barcode,
  PackageCheck,
  TrendingUp,
  Split,
  Truck,
  FileSpreadsheet,
  History,
  Settings,
  Users,
  Database,
  BookmarkPlus,
  Sparkles,
  Command,
  X,
  Package,
  Layers,
  Building2,
  Calendar,
  Wrench,
  ShieldCheck
} from 'lucide-react';

const PAGE_ICONS = {
  dashboard: Layers,
  import: FileSpreadsheet,
  forecast: TrendingUp,
  records: BookmarkPlus,
  orders: Package,
  'scan-in': Barcode,
  'intake-records': BookmarkPlus,
  allocation: Split,
  'scan-out': PackageCheck,
  shipments: Truck,
  reports: FileSpreadsheet,
  audit: History,
  settings: Settings,
  'user-access': Users
};

export default function CommandPalette({ isOpen, onClose }) {
  const {
    currentUser,
    setActiveTab,
    canAccess,
    inventoryUnits = [],
    parts = [],
    shipments = [],
    repairUsageRecords = [],
    setSelectedCategory,
    autoRefreshData,
    showToast,
    setPmgSubTab,
    sites = []
  } = useApp();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inspectedSerialDetails, setInspectedSerialDetails] = useState(null);
  const inputRef = useRef(null);

  const userSiteObj = useMemo(() => {
    return sites.find(s => s.id === currentUser?.siteId || s.code === currentUser?.siteId) || {};
  }, [sites, currentUser?.siteId]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keyboard shortcut listener to close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filtered Navigation items
  const accessiblePages = useMemo(() => {
    return ALL_PAGES.filter(p => canAccess(p.id));
  }, [canAccess]);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  // Search Results
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [];

    // 1. Navigation Pages (Strictly filtered by canAccess)
    accessiblePages.forEach(p => {
      if (!q || p.label.toLowerCase().includes(q) || p.section.toLowerCase().includes(q) || p.id.includes(q)) {
        list.push({
          type: 'navigation',
          id: `nav-${p.id}`,
          title: p.label,
          subtitle: `${p.section} Section`,
          icon: PAGE_ICONS[p.id] || Layers,
          action: () => {
            setActiveTab(p.id);
            handleClose();
          }
        });
      }
    });

    // 2. Quick Actions (Strictly filtered by user permission)
    const quickActions = [];

    if (canAccess('scan-in')) {
      quickActions.push({
        id: 'action-scan-in',
        title: 'Receive Scan-In Terminal',
        subtitle: 'Quick switch to inbound barcode receiving',
        icon: Barcode,
        keywords: 'receive scan barcode inbound intake',
        action: () => {
          setActiveTab('scan-in');
          handleClose();
        }
      });
    }

    if (canAccess('scan-out')) {
      quickActions.push({
        id: 'action-scan-out',
        title: 'Pack Scan-Out Terminal',
        subtitle: 'Quick switch to outbound branch packing list generator',
        icon: PackageCheck,
        keywords: 'pack scan out packing box shipment manifest',
        action: () => {
          setActiveTab('scan-out');
          handleClose();
        }
      });
    }

    if (canAccess('request-parts')) {
      quickActions.push({
        id: 'action-request-new',
        title: 'Submit New Part Request',
        subtitle: 'Create a parts replenishment request for DC Superadmin',
        icon: Package,
        keywords: 'request part new replenishment order demand',
        action: () => {
          setActiveTab('request-parts');
          if (setPmgSubTab) setPmgSubTab('requests_table');
          setTimeout(() => window.dispatchEvent(new CustomEvent('mdc:open-request-form')), 50);
          handleClose();
        }
      });

      quickActions.push({
        id: 'action-mark-used',
        title: 'Mark Part as Used / Consumed',
        subtitle: 'Record consumed repair part for work order',
        icon: Barcode,
        keywords: 'mark used consume repair work order parts consumption',
        action: () => {
          setActiveTab('request-parts');
          if (setPmgSubTab) setPmgSubTab('usage_history');
          setTimeout(() => window.dispatchEvent(new CustomEvent('mdc:open-mark-used')), 50);
          handleClose();
        }
      });
    }

    quickActions.push({
      id: 'action-sync',
      title: 'Synchronize Cloud Database',
      subtitle: 'Force verify and refresh all operational tables from Supabase',
      icon: Database,
      keywords: 'sync refresh database reload cloud',
      action: () => {
        if (autoRefreshData) {
          autoRefreshData({ force: true, silent: false, reason: 'Command palette sync' });
        }
        handleClose();
      }
    });

    if (canAccess('forecast') || canAccess('allocation') || canAccess('dashboard')) {
      quickActions.push(
        {
          id: 'action-cat-all',
          title: 'Filter: All Categories',
          subtitle: 'Show all parts (Batteries, Displays, Cameras, Back Glass)',
          icon: Sparkles,
          keywords: 'filter category all reset',
          action: () => {
            setSelectedCategory('ALL');
            showToast('Category filter set to All', 'info');
            handleClose();
          }
        },
        {
          id: 'action-cat-disp',
          title: 'Filter: Displays Only',
          subtitle: 'Filter workspace to iPhone Screen / Display assemblies',
          icon: Sparkles,
          keywords: 'filter category display screen',
          action: () => {
            setSelectedCategory('DISPLAY');
            showToast('Category filter set to Displays', 'info');
            handleClose();
          }
        },
        {
          id: 'action-cat-batt',
          title: 'Filter: Batteries Only',
          subtitle: 'Filter workspace to iPhone Battery modules',
          icon: Sparkles,
          keywords: 'filter category battery',
          action: () => {
            setSelectedCategory('BATTERY');
            showToast('Category filter set to Batteries', 'info');
            handleClose();
          }
        }
      );
    }

    quickActions.forEach(act => {
      if (!q || act.title.toLowerCase().includes(q) || act.keywords.includes(q)) {
        list.push({
          type: 'action',
          id: act.id,
          title: act.title,
          subtitle: act.subtitle,
          icon: act.icon,
          action: act.action
        });
      }
    });

    // 3. Parts Catalog Lookup
    if (q) {
      const matchedParts = (parts || []).filter(p =>
        p.part_number?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.iphone_model?.toLowerCase().includes(q)
      ).slice(0, 4);

      matchedParts.forEach(p => {
        const hasFinancialAccess = canAccess('settings') || canAccess('forecast') || canAccess('orders');
        list.push({
          type: 'part',
          id: `part-${p.id}`,
          title: `${p.part_number} — ${p.description}`,
          subtitle: hasFinancialAccess
            ? `Stocking: $${parseFloat(p.stocking_price || 0).toFixed(2)}`
            : `Apple Replacement Part • ${p.iphone_model || 'Hardware Module'}`,
          icon: Package,
          action: () => {
            if (canAccess('settings')) {
              setActiveTab('settings');
            } else if (canAccess('forecast')) {
              setActiveTab('forecast');
            } else if (canAccess('request-parts')) {
              setActiveTab('request-parts');
              if (setPmgSubTab) setPmgSubTab('stock_on_hand');
            } else if (canAccess('all-stocks')) {
              setActiveTab('all-stocks');
            }
            handleClose();
          }
        });
      });

      // 4. Enhanced Serial Number Search (Complete Information: DC vs Site stock, Usage, Arrival Date, Used Date)
      if (canAccess('audit') || canAccess('scan-in') || canAccess('all-stocks') || canAccess('intake-records') || canAccess('request-parts') || canAccess('shipments')) {
        const isSuper = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
        const userSiteId = currentUser?.siteId;

        const resolvedSerials = searchSerialsWithFullDetails(q, {
          inventoryUnits,
          shipments,
          repairUsageRecords,
          sites,
          parts
        }, 5);

        // Site-restricted staff only search units belonging to or shipped to their branch
        const permittedSerials = resolvedSerials.filter(sd => {
          if (isSuper) return true;
          return (
            sd.siteId === userSiteId ||
            sd.siteCode === userSiteObj?.code ||
            sd.linkedShipment?.site_id === userSiteId ||
            sd.linkedShipment?.site_code === userSiteObj?.code
          );
        });

        permittedSerials.forEach(sd => {
          list.push({
            type: 'serial',
            id: `serial-${sd.serialNumber}`,
            serialDetails: sd,
            title: `Serial: ${sd.serialNumber}`,
            subtitle: `${sd.partNumber} • ${sd.description} (${sd.iphoneModel})`,
            icon: Barcode,
            action: () => {
              setInspectedSerialDetails(sd);
            }
          });
        });
      }
    }

    return list;
  }, [query, accessiblePages, parts, inventoryUnits, shipments, repairUsageRecords, sites, canAccess, setActiveTab, setSelectedCategory, autoRefreshData, showToast, handleClose, currentUser, userSiteObj, setPmgSubTab]);

  const handleInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[selectedIndex];
      if (item && item.action) {
        item.action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop cmd-palette-backdrop"
      style={{
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="cmd-palette-card"
        style={{
          background: '#0f172a',
          color: '#f8fafc',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '580px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px #334155',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out'
        }}
      >
        {/* Search Input Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid #1e293b'
          }}
        >
          <Search size={20} color="#38bdf8" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command, page name, part #, or serial..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '15px',
              outline: 'none',
              fontFamily: 'inherit'
            }}
          />
          <span
            style={{
              background: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #334155',
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600
            }}
          >
            ESC to close
          </span>
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              padding: '2px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Results List */}
        <div
          style={{
            maxHeight: '380px',
            overflowY: 'auto',
            padding: '8px'
          }}
        >
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 20px', color: '#64748b' }}>
              <Command size={28} style={{ opacity: 0.4, marginBottom: '8px' }} />
              <p style={{ margin: 0, fontSize: '13px' }}>No commands or items matching "{query}"</p>
            </div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;

              // Rich Serial Intelligence Card (Requested: DC vs Site stock, used status, site arrival date, usage date)
              if (item.type === 'serial' && item.serialDetails) {
                const sd = item.serialDetails;
                const statusBg =
                  sd.statusBadgeType === 'dc' ? '#0369a1' :
                  sd.statusBadgeType === 'site' ? '#15803d' :
                  sd.statusBadgeType === 'transit' ? '#b45309' : '#6d28d9';

                return (
                  <div
                    key={item.id}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(56, 189, 248, 0.16)' : 'rgba(30, 41, 59, 0.55)',
                      border: `1.5px solid ${isSelected ? '#38bdf8' : '#334155'}`,
                      transition: 'all 0.12s ease',
                      marginBottom: '8px',
                      boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.2)' : 'none'
                    }}
                  >
                    {/* Top row: Barcode, Serial, Status Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '6px',
                          background: isSelected ? '#0284c7' : '#1e293b',
                          color: '#38bdf8',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Barcode size={15} />
                        </div>
                        <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#f8fafc', fontFamily: 'var(--font-mono)' }}>
                          {sd.serialNumber}
                        </span>
                      </div>

                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: statusBg,
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {sd.statusBadgeLabel}
                      </span>
                    </div>

                    {/* Part Description and Model */}
                    <div style={{ fontSize: '12.5px', color: '#cbd5e1', fontWeight: 600, marginBottom: '8px' }}>
                      {sd.partNumber} &bull; {sd.description} ({sd.iphoneModel})
                    </div>

                    {/* Complete 3-Way Information Grid Requested by User */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '6px',
                        background: 'rgba(15, 23, 42, 0.7)',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #1e293b'
                      }}
                    >
                      {/* 1. DC vs Site In-Stock */}
                      <div>
                        <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
                          Stock Location:
                        </span>
                        <strong style={{ color: '#f1f5f9', fontSize: '11.5px' }}>
                          {sd.isDcSite ? 'Central DC Warehouse' : sd.siteName}
                        </strong>
                      </div>

                      {/* 2. Recorded Arrival Date at Site */}
                      <div>
                        <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
                          Site Arrival Date:
                        </span>
                        <strong style={{ color: sd.siteArrivalFormatted ? '#38bdf8' : '#94a3b8', fontSize: '11.5px' }}>
                          {sd.siteArrivalFormatted || (sd.statusBadgeType === 'transit' ? 'Pending Site Arrival' : (sd.dcScanInFormatted ? `DC: ${sd.dcScanInFormatted}` : 'In DC Stock'))}
                        </strong>
                      </div>

                      {/* 3. Used by Site & Date Used */}
                      <div>
                        <span style={{ color: '#64748b', fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>
                          Usage / Repair Date:
                        </span>
                        {sd.isUsed ? (
                          <strong style={{ color: '#c084fc', fontSize: '11.5px' }}>
                            Used: {sd.dateUsedFormatted ? sd.dateUsedFormatted.slice(0, 10) : 'Recorded'} {sd.workOrderNumber ? `(${sd.workOrderNumber})` : ''}
                          </strong>
                        ) : (
                          <strong style={{ color: '#4ade80', fontSize: '11.5px' }}>
                            Available &amp; Unused
                          </strong>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '6px' }}>
                      <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Inspect Complete Dossier <ArrowRight size={12} />
                      </span>
                    </div>
                  </div>
                );
              }

              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                    border: `1px solid ${isSelected ? 'rgba(56, 189, 248, 0.3)' : 'transparent'}`,
                    transition: 'all 0.1s ease',
                    marginBottom: '2px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        background: isSelected ? '#0284c7' : '#1e293b',
                        color: isSelected ? '#fff' : '#38bdf8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <Icon size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '13.5px',
                          fontWeight: 600,
                          color: isSelected ? '#38bdf8' : '#f1f5f9',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: '#94a3b8',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: '1px'
                        }}
                      >
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isSelected && (
                      <span style={{ fontSize: '11.5px', color: '#38bdf8', fontWeight: 600 }}>
                        Jump <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div
          style={{
            padding: '10px 16px',
            background: '#0a0f1d',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11.5px',
            color: '#64748b'
          }}
        >
          <div style={{ display: 'flex', gap: '14px' }}>
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>DC System 2.0 Command Center</span>
        </div>
      </div>

      {/* Serial Number Intelligence Dossier Modal */}
      {inspectedSerialDetails && (
        <SerialDossierModal
          serialDetails={inspectedSerialDetails}
          onClose={() => setInspectedSerialDetails(null)}
          onNavigateTab={(tab) => {
            setActiveTab(tab);
            handleClose();
          }}
        />
      )}
    </div>
  );
}
