import { useMemo } from 'react';
import { X, Printer, QrCode } from 'lucide-react';
import {
  encodeCode128B,
  encodeQrCode,
  buildCode128SvgString,
  buildQrSvgString
} from '../utils/barcodeGenerator';

function escapeHtml(val = '') {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getToolScanValues(asset) {
  const assetTag = String(asset.asset_tag || '').trim() || 'MDC-TOOL';
  const barcodeValue = String(asset.serial_number || assetTag).trim();
  // QR encodes the primary system asset tag (matches Search & Scan-Out directly)
  const qrValue = assetTag;
  return { qrValue, barcodeValue };
}

function AssetLabelCard({ asset }) {
  const { qrValue, barcodeValue } = getToolScanValues(asset);
  const qr = useMemo(() => encodeQrCode(qrValue), [qrValue]);
  const barcode = useMemo(() => encodeCode128B(barcodeValue), [barcodeValue]);
  const qrViewSize = qr.size + qr.quietZone * 2;

  return (
    <div
      className="tool-label-card"
      style={{
        border: '1.5px solid #0f172a',
        borderRadius: '8px',
        padding: '10px 12px',
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        pageBreakInside: 'avoid'
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '10px', alignItems: 'center' }}>
        <svg
          width="84"
          height="84"
          viewBox={`0 0 ${qrViewSize} ${qrViewSize}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`QR Code ${qrValue}`}
          style={{ display: 'block', background: '#ffffff' }}
        >
          <rect x="0" y="0" width={qrViewSize} height={qrViewSize} fill="#ffffff" />
          {qr.matrix.map((row, r) =>
            row.map((on, c) =>
              on ? (
                <rect
                  key={`${r}-${c}`}
                  x={c + qr.quietZone}
                  y={r + qr.quietZone}
                  width="1"
                  height="1"
                  fill="#000000"
                />
              ) : null
            )
          )}
        </svg>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#475569', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            MOBILECARE TOOL ASSET
          </div>
          <div className="font-mono" style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', marginTop: '1px', wordBreak: 'break-all' }}>
            {asset.asset_tag}
          </div>
          {asset.ownership_tag_id && (
            <div className="font-mono" style={{ fontSize: '10px', fontWeight: 700, color: '#0369a1', marginTop: '1px', wordBreak: 'break-all' }}>
              {asset.ownership_tag || 'Apple-Owned'} · {asset.ownership_tag_id}
            </div>
          )}
          {asset.admin_asset_tag && (
            <div className="font-mono" style={{ fontSize: '10.5px', fontWeight: 700, color: '#0369a1', marginTop: '1px', wordBreak: 'break-all' }}>
              Admin Tag: {asset.admin_asset_tag}
            </div>
          )}
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
            {asset.part_number} · {asset.description}
          </div>
          <div className="font-mono" style={{ fontSize: '10px', color: '#334155', marginTop: '2px' }}>
            {asset.serial_number ? `SN: ${asset.serial_number}` : 'Unserialized Tool'} · Site: {asset.site_code}
            {asset.assigned_to ? ` · Assigned: ${asset.assigned_to}` : ''}
          </div>
        </div>
      </div>

      {/* Full-width ISO/IEC 15417 Code 128B 1D Barcode */}
      <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: '6px' }}>
        <svg
          width="100%"
          height="32"
          viewBox={`0 0 ${barcode.totalWidth} 32`}
          preserveAspectRatio="xMidYMid meet"
          shapeRendering="crispEdges"
          role="img"
          aria-label={`Code 128 Barcode ${barcode.text}`}
          style={{ display: 'block', background: '#ffffff' }}
        >
          <rect x="0" y="0" width={barcode.totalWidth} height="32" fill="#ffffff" />
          {barcode.bars.map((b, idx) => (
            <rect key={idx} x={b.x} y="0" width={b.w} height="32" fill="#000000" />
          ))}
        </svg>
        <div
          className="font-mono"
          style={{
            fontSize: '9.5px',
            fontWeight: 700,
            color: '#0f172a',
            textAlign: 'center',
            letterSpacing: '0.08em',
            marginTop: '2px'
          }}
        >
          {barcode.text}
        </div>
      </div>
    </div>
  );
}

export default function ToolLabelPrintModal({ assets = [], onClose }) {
  if (!assets || assets.length === 0) return null;

  const handlePrint = () => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      window.print();
      return;
    }

    const cardsHtml = assets
      .map((asset) => {
        const { qrValue, barcodeValue } = getToolScanValues(asset);
        const qrSvg = buildQrSvgString(qrValue, { size: 84, ariaLabel: `QR Code ${qrValue}` });
        const barcodeSvg = buildCode128SvgString(barcodeValue, { height: 36 });

        return `
          <div class="label-card">
            <div class="label-top">
              ${qrSvg}
              <div style="min-width:0;">
                <div style="font-size:9.5px;font-weight:700;color:#475569;letter-spacing:0.05em;text-transform:uppercase;">MOBILECARE TOOL ASSET</div>
                <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums;font-size:13px;font-weight:800;color:#0f172a;margin-top:1px;word-break:break-all;">${escapeHtml(asset.asset_tag)}</div>
                ${asset.ownership_tag_id ? `<div style="font-size:10px;font-weight:700;color:#0369a1;margin-top:1px;word-break:break-all;">${escapeHtml(asset.ownership_tag || 'Apple-Owned')} · ${escapeHtml(asset.ownership_tag_id)}</div>` : ''}
                ${asset.admin_asset_tag ? `<div style="font-size:10.5px;font-weight:700;color:#0369a1;margin-top:1px;word-break:break-all;">Admin Tag: ${escapeHtml(asset.admin_asset_tag)}</div>` : ''}
                <div style="font-size:11px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">${escapeHtml(asset.part_number)} · ${escapeHtml(asset.description)}</div>
                <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums;font-size:10px;color:#334155;margin-top:2px;">
                  ${asset.serial_number ? `SN: ${escapeHtml(asset.serial_number)}` : 'Unserialized Tool'} · Site: ${escapeHtml(asset.site_code)}${asset.assigned_to ? ` · Assigned: ${escapeHtml(asset.assigned_to)}` : ''}
                </div>
              </div>
            </div>
            <div class="label-barcode">
              ${barcodeSvg}
              <div class="barcode-caption">${escapeHtml(barcodeValue)}</div>
            </div>
          </div>`;
      })
      .join('');

    win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Tool QR &amp; Barcode Asset Labels (${assets.length})</title>
    <style>
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        margin: 0;
        padding: 18px;
        background: #ffffff;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .labels-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .label-card {
        border: 1.5px solid #0f172a;
        border-radius: 8px;
        padding: 10px 12px;
        background: #ffffff;
        display: flex;
        flex-direction: column;
        gap: 6px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .label-top {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 10px;
        align-items: center;
      }
      .label-barcode {
        border-top: 1px dashed #e2e8f0;
        padding-top: 6px;
      }
      .barcode-caption {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 9.5px;
        font-weight: 700;
        color: #0f172a;
        text-align: center;
        letter-spacing: 0.08em;
        margin-top: 2px;
      }
      @media print {
        body { padding: 8px; }
      }
    </style>
  </head>
  <body>
    <div class="labels-grid">${cardsHtml}</div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () { window.print(); }, 150);
      });
    </script>
  </body>
</html>`);
    win.document.close();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal-content" style={{ maxWidth: '720px', width: '95%' }}>
        <div className="modal-header" style={{ background: '#0f172a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <QrCode size={18} color="#38bdf8" />
            <div>
              <h3 style={{ color: '#fff', fontSize: '16px', margin: 0 }}>
                Tool QR &amp; Barcode Asset Labels ({assets.length})
              </h3>
              <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0 }}>
                Scannable ISO Code 128 barcodes &amp; QR codes for peel-and-stick tool tracking
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '18px', maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
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
