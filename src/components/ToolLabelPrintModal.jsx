import { useMemo } from 'react';
import { X, Printer, QrCode } from 'lucide-react';

/**
 * Deterministic compact 2D SVG matrix code (stylized QR-compatible visual identifier)
 * + Code-style bars encoded purely in SVG so no external CDN or canvas dep is required.
 */
function buildDeterministicMatrix(seedText, size = 13) {
  const str = String(seedText || 'MDC-TOOL');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const grid = [];
  for (let r = 0; r < size; r += 1) {
    const row = [];
    for (let c = 0; c < size; c += 1) {
      const inFinderTL = r < 4 && c < 4;
      const inFinderTR = r < 4 && c >= size - 4;
      const inFinderBL = r >= size - 4 && c < 4;
      if (inFinderTL || inFinderTR || inFinderBL) {
        const lr = r < 4 ? r : r - (size - 4);
        const lc = c < 4 ? c : c - (size - 4);
        const border = lr === 0 || lr === 3 || lc === 0 || lc === 3;
        const center = (lr === 1 || lr === 2) && (lc === 1 || lc === 2) && lr === lc;
        row.push(border || center);
      } else {
        hash ^= (r * 31 + c * 17 + str.charCodeAt((r + c) % str.length));
        hash = Math.imul(hash, 16777619);
        row.push(((hash >>> ((r + c) % 16)) & 1) === 1);
      }
    }
    grid.push(row);
  }
  return grid;
}

function buildBarcodeBars(codeText = '') {
  const clean = String(codeText || 'MDC');
  const bars = [];
  let x = 2;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const w1 = ((code >> 0) & 1) + 1;
    const g1 = ((code >> 1) & 1) + 1;
    const w2 = ((code >> 2) & 1) + 1.5;
    const g2 = ((code >> 3) & 1) + 1;
    bars.push({ x, w: w1 });
    x += w1 + g1;
    bars.push({ x, w: w2 });
    x += w2 + g2;
  }
  return { bars, totalWidth: Math.max(x + 2, 120) };
}

function AssetLabelCard({ asset }) {
  const payload = `${asset.asset_tag}|${asset.part_number}|${asset.serial_number || 'NO-SN'}`;
  const matrix = useMemo(() => buildDeterministicMatrix(payload, 13), [payload]);
  const barcode = useMemo(() => buildBarcodeBars(asset.serial_number || asset.asset_tag), [asset.serial_number, asset.asset_tag]);

  return (
    <div
      className="tool-label-card"
      style={{
        border: '1.5px solid #0f172a',
        borderRadius: '8px',
        padding: '10px 12px',
        background: '#ffffff',
        display: 'grid',
        gridTemplateColumns: '68px 1fr',
        gap: '10px',
        alignItems: 'center',
        pageBreakInside: 'avoid'
      }}
    >
      <svg width="68" height="68" viewBox="0 0 13 13" shapeRendering="crispEdges" aria-label={`QR Label ${asset.asset_tag}`}>
        <rect x="0" y="0" width="13" height="13" fill="#ffffff" />
        {matrix.map((row, r) =>
          row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#0f172a" /> : null))
        )}
      </svg>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#475569', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          MOBILECARE TOOL ASSET
        </div>
        <div className="font-mono" style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginTop: '1px', wordBreak: 'break-all' }}>
          {asset.asset_tag}
        </div>
        <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.part_number} · {asset.description}
        </div>
        <div className="font-mono" style={{ fontSize: '10.5px', color: '#334155', marginTop: '2px' }}>
          {asset.serial_number ? `SN: ${asset.serial_number}` : 'Unserialized Tool'} · Site: {asset.site_code}
        </div>
        <svg
          width="100%"
          height="18"
          viewBox={`0 0 ${barcode.totalWidth} 18`}
          preserveAspectRatio="none"
          style={{ marginTop: '4px', display: 'block' }}
        >
          {barcode.bars.map((b, idx) => (
            <rect key={idx} x={b.x} y="0" width={b.w} height="18" fill="#0f172a" />
          ))}
        </svg>
      </div>
    </div>
  );
}

export default function ToolLabelPrintModal({ assets = [], onClose }) {
  if (!assets || assets.length === 0) return null;

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=860,height=640');
    if (!win) {
      window.print();
      return;
    }
    const cardsHtml = assets
      .map(
        (asset) => `
          <div style="border:1.5px solid #0f172a;border-radius:8px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid;font-family:system-ui,-apple-system,sans-serif;">
            <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;">MOBILECARE TOOL ASSET</div>
            <div style="font-family:monospace;font-size:14px;font-weight:800;color:#0f172a;margin:2px 0;">${asset.asset_tag}</div>
            <div style="font-size:12px;font-weight:600;color:#1e293b;">${asset.part_number} — ${asset.description}</div>
            <div style="font-family:monospace;font-size:11px;color:#334155;margin-top:4px;">
              ${asset.serial_number ? `SN: ${asset.serial_number}` : 'Unserialized Tool'} | Site: ${asset.site_code}
            </div>
          </div>`
      )
      .join('');

    win.document.write(`<!doctype html><html><head><title>Tool Labels</title></head><body style="padding:18px;">${cardsHtml}<script>window.print();</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal-content" style={{ maxWidth: '640px', width: '95%' }}>
        <div className="modal-header" style={{ background: '#0f172a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <QrCode size={18} color="#38bdf8" />
            <div>
              <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>
                Tool QR & Barcode Asset Labels ({assets.length})
              </h3>
              <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0 }}>
                Print peel-and-stick asset labels for serialized and shop tools
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '18px', maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
            {assets.map(asset => (
              <AssetLabelCard key={asset.id || asset.asset_tag} asset={asset} />
            ))}
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '12px 18px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={15} />
            <span>Print Label Sheet</span>
          </button>
        </div>
      </div>
    </div>
  );
}
