import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MOBILECARE_LOGO_BASE64 } from '../assets/logoBase64.js';
import { calculateWeeklySplit } from './allocationEngine.js';

/**
 * Generates and downloads a pixel-perfect Packing List PDF matching corporate standards
 */
export function generatePackingListPDF(shipment, items = [], site = {}) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const totalItemsCount = items.length;
  const margin = totalItemsCount > 45 ? 8 : totalItemsCount > 25 ? 10 : 12;
  const tableWidth = pageWidth - (margin * 2);

  // Title: "Packing List" Centered (Font Size 14)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('Packing List', pageWidth / 2, totalItemsCount > 45 ? 9 : 11, { align: 'center' });

  // Top Left: Mobile Care Logo + Company Info
  const headerTopY = totalItemsCount > 45 ? 13 : 16;
  try {
    if (MOBILECARE_LOGO_BASE64) {
      doc.addImage(MOBILECARE_LOGO_BASE64, 'PNG', margin, headerTopY - 1, 13, 13);
    }
  } catch (e) {
    console.warn('Could not render logo in PDF:', e);
  }

  const compX = margin + 15;
  doc.setFontSize(totalItemsCount > 45 ? 8.5 : 9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('MOBILE CARE SERVICES PHILS. INC.', compX, headerTopY + 2);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(totalItemsCount > 45 ? 6.8 : 7.5);
  doc.setTextColor(51, 65, 85);
  const lineGap = totalItemsCount > 45 ? 2.8 : 3.4;
  doc.text('Business and Distribution Center', compX, headerTopY + 2 + lineGap);
  doc.text('2/L Northeast Square, #47', compX, headerTopY + 2 + lineGap * 2);
  doc.text('Connecticut St. Northeast Greenhills', compX, headerTopY + 2 + lineGap * 3);
  doc.text('San Juan City, Metro Manila', compX, headerTopY + 2 + lineGap * 4);

  // Top Right: Invoice / Shipment Metadata Box
  const rightBoxWidth = 82;
  const rightColX = pageWidth - margin - rightBoxWidth;
  const rightValX = pageWidth - margin;

  const metaRows = [
    { label: 'INVOICE REF:', val: shipment.invoice_ref || `DCMSPIOWNED#20260818N` },
    { label: 'SHIPMENT DATE:', val: shipment.shipment_date || new Date().toLocaleDateString('en-US') },
    { label: 'BOX/S #:', val: String(shipment.total_boxes || 1) },
    { label: 'CARRIER:', val: shipment.carrier || 'Lite Express' },
    { label: 'TRACKING NUMBER:', val: shipment.tracking_number || '' }
  ];

  let metaY = headerTopY + 1.5;
  const metaGap = totalItemsCount > 45 ? 2.8 : 3.3;
  metaRows.forEach(row => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(totalItemsCount > 45 ? 6.8 : 7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(row.label, rightColX, metaY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(totalItemsCount > 45 ? 6.8 : 7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(String(row.val), rightValX, metaY, { align: 'right' });
    metaY += metaGap;
  });

  // Ship To Section
  const shipToY = headerTopY + (totalItemsCount > 45 ? 15.5 : 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(totalItemsCount > 45 ? 7.8 : 8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Ship To', margin, shipToY);
  doc.text((site.name || shipment.site_name || 'SERVICE HUB').toUpperCase(), margin + 14, shipToY);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(totalItemsCount > 45 ? 6.8 : 7.5);
  doc.setTextColor(71, 85, 105);
  const siteAddr = site.address || `${site.name || 'Branch'}, Philippines`;
  doc.text(siteAddr, margin + 14, shipToY + 3.2, { maxWidth: pageWidth - margin - 20 });

  // Items Table Sizing (Adaptive to fit 1 to 75 parts on exactly 1 single page)
  let tableFontSize = 8.2;
  let cellPaddingY = 1.4;
  if (totalItemsCount > 55) {
    tableFontSize = 5.8;
    cellPaddingY = 0.25;
  } else if (totalItemsCount > 40) {
    tableFontSize = 6.4;
    cellPaddingY = 0.45;
  } else if (totalItemsCount > 25) {
    tableFontSize = 7.2;
    cellPaddingY = 0.75;
  }

  const tableData = items.map((item, index) => [
    index + 1,
    item.part_number || item.partNumber || '',
    item.description || item.partDescription || '',
    item.serial_number || item.serialNumber || '',
    item.box_number || item.boxNumber || 1
  ]);

  const tableStartY = shipToY + (totalItemsCount > 45 ? 6.5 : 8);

  const col0 = 7;
  const col1 = 26;
  const col4 = 14;
  const col3 = totalItemsCount > 45 ? 58 : 56;
  const col2 = tableWidth - col0 - col1 - col3 - col4;

  autoTable(doc, {
    startY: tableStartY,
    head: [['#', 'PART NUMBER', 'DESCRIPTION', 'SERIAL NUMBER', 'BOX #']],
    body: tableData,
    theme: 'grid',
    showHead: 'firstPage',
    headStyles: {
      fillColor: [84, 89, 95], // Charcoal #54595F matching MSPI DC Packing List
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: tableFontSize + 0.2,
      halign: 'center',
      valign: 'middle',
      cellPadding: cellPaddingY + 0.2
    },
    bodyStyles: {
      fontSize: tableFontSize,
      textColor: [15, 23, 42],
      cellPadding: cellPaddingY
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: col0 },
      1: { halign: 'center', cellWidth: col1, fontStyle: 'bold' },
      2: { halign: 'left', cellWidth: col2 },
      3: { halign: 'center', cellWidth: col3, font: 'helvetica', fontStyle: 'normal' },
      4: { halign: 'center', cellWidth: col4 }
    },
    margin: { left: margin, right: margin }
  });

  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : (tableStartY + 30);

  // Remarks & Totals Block
  const totalsY = finalY + (totalItemsCount > 45 ? 2.5 : 4.5);
  const totalBoxWidth = 64;
  const totalBoxX = pageWidth - margin - totalBoxWidth;
  const totalValX = pageWidth - margin - 3;
  const boxRowHeight = totalItemsCount > 45 ? 3.6 : 4.4;

  // Remarks (Left Aligned)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(totalItemsCount > 45 ? 7.2 : 8);
  doc.setTextColor(15, 23, 42);
  doc.text('Remarks', margin, totalsY + 2.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(totalItemsCount > 45 ? 7.2 : 8);
  doc.text(shipment.remarks || 'KGB PARTS', margin, totalsY + (totalItemsCount > 45 ? 5.2 : 6.5));

  // Totals Box (Right Aligned)
  doc.setFillColor(84, 89, 95);
  doc.rect(totalBoxX, totalsY, 36, boxRowHeight, 'F');
  doc.setDrawColor(84, 89, 95);
  doc.rect(totalBoxX + 36, totalsY, totalBoxWidth - 36, boxRowHeight, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(totalItemsCount > 45 ? 6.5 : 7.5);
  doc.text('TOTAL QTY', totalBoxX + 18, totalsY + (boxRowHeight * 0.7), { align: 'center' });
  doc.setTextColor(15, 23, 42);
  doc.text(String(items.length), totalValX, totalsY + (boxRowHeight * 0.7), { align: 'right' });

  // Total Boxes Row
  doc.setFillColor(84, 89, 95);
  doc.rect(totalBoxX, totalsY + boxRowHeight, 36, boxRowHeight, 'F');
  doc.rect(totalBoxX + 36, totalsY + boxRowHeight, totalBoxWidth - 36, boxRowHeight, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL BOXES', totalBoxX + 18, totalsY + boxRowHeight + (boxRowHeight * 0.7), { align: 'center' });
  doc.setTextColor(15, 23, 42);
  doc.text(String(shipment.total_boxes || 1), totalValX, totalsY + boxRowHeight + (boxRowHeight * 0.7), { align: 'right' });

  // Signatures Section (Clean divider and crisp inline layout)
  const sigLineY = totalsY + (boxRowHeight * 2) + (totalItemsCount > 45 ? 3 : 5);

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, sigLineY, pageWidth - margin, sigLineY);

  const sigRow1Y = sigLineY + (totalItemsCount > 45 ? 3.5 : 4.5);
  doc.setFontSize(totalItemsCount > 45 ? 6.5 : 7.5);
  doc.setTextColor(15, 23, 42);

  // Prepared by
  doc.setFont('helvetica', 'bold');
  doc.text('Prepared and Counted by:', margin, sigRow1Y);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.prepared_by_name || 'Joshua Juvida', margin + 35, sigRow1Y);

  // Verified by
  doc.setFont('helvetica', 'bold');
  doc.text('Verified by:', margin + 85, sigRow1Y);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.verified_by_name || 'Anjo Alcazar', margin + 102, sigRow1Y);

  // Receiving Branch Signature
  const sigRow2Y = sigRow1Y + (totalItemsCount > 45 ? 3.5 : 4.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Receiving Branch Signature:', margin, sigRow2Y);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.receiving_signature || (site.code ? `APP ${site.code.replace(/^(site-|asp-)/i, '').toUpperCase()}` : 'APP RM'), margin + 35, sigRow2Y);

  // Save / Export
  const filename = `PackingList_${shipment.invoice_ref || shipment.shipment_number || 'export'}.pdf`;
  doc.save(filename);
}

/**
 * Triggers native browser print preview for immediate packing list manifest printing
 */
export function printPackingListDirect(shipment, items = [], site = {}) {
  const printWindow = window.open('', '_blank', 'width=900,height=800');
  if (!printWindow) {
    window.print();
    return;
  }

  const count = items.length;
  let bodyFontSize = '11px';
  let tablePadding = '3px 5px';
  let tableFontSize = '10.5px';
  let headerPadding = '4.5px 5px';
  let headerFontSize = '10px';
  let topGridMargin = '10px';
  let metaFontSize = '10.5px';
  let logoSize = '48px';

  if (count > 50) {
    bodyFontSize = '8px';
    tablePadding = '1px 3px';
    tableFontSize = '7.5px';
    headerPadding = '2px 3px';
    headerFontSize = '7.5px';
    topGridMargin = '4px';
    metaFontSize = '8.5px';
    logoSize = '40px';
  } else if (count > 35) {
    bodyFontSize = '9px';
    tablePadding = '1.8px 4px';
    tableFontSize = '8.5px';
    headerPadding = '2.5px 4px';
    headerFontSize = '8px';
    topGridMargin = '6px';
    metaFontSize = '9px';
    logoSize = '42px';
  } else if (count > 25) {
    bodyFontSize = '9.5px';
    tablePadding = '2.2px 4.5px';
    tableFontSize = '9px';
    headerPadding = '3px 4.5px';
    headerFontSize = '8.5px';
    topGridMargin = '7px';
    metaFontSize = '9.5px';
    logoSize = '44px';
  }

  const tableRowsHtml = items.map((it, idx) => `
    <tr style="${idx % 2 === 1 ? 'background-color: #fbfcfd;' : ''}">
      <td style="text-align: center; color: #64748b; padding: ${tablePadding}; border: 1px solid #cbd5e1; font-size: ${tableFontSize}; line-height: 1.15;">${idx + 1}</td>
      <td style="text-align: center; font-weight: 700; padding: ${tablePadding}; border: 1px solid #cbd5e1; font-size: ${tableFontSize}; line-height: 1.15;">${it.part_number || it.partNumber || ''}</td>
      <td style="text-align: left; padding: ${tablePadding}; border: 1px solid #cbd5e1; font-size: ${tableFontSize}; line-height: 1.15;">${it.description || it.partDescription || ''}</td>
      <td style="text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 400; padding: ${tablePadding}; border: 1px solid #cbd5e1; font-size: ${tableFontSize}; line-height: 1.15;">${it.serial_number || it.serialNumber || ''}</td>
      <td style="text-align: center; padding: ${tablePadding}; border: 1px solid #cbd5e1; font-size: ${tableFontSize}; line-height: 1.15;">${it.box_number || it.boxNumber || 1}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Packing List - ${shipment.invoice_ref || 'Manifest'}</title>
      <style>
        @page { size: portrait; margin: 5mm 8mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; }
        body { padding: 4px 6px; font-size: ${bodyFontSize}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .header-title { text-align: center; font-size: 14pt; font-weight: 800; margin: 0 0 5px 0; letter-spacing: -0.01em; color: #000000; }
        .top-grid { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${topGridMargin}; gap: 12px; }
        .company-title { font-size: 11.5px; font-weight: 800; color: #0f172a; }
        .meta-table { border-collapse: collapse; font-size: ${metaFontSize}; }
        .meta-table td { padding: 1px 3px; }
        .meta-label { font-weight: 700; color: #0f172a; }
        .meta-val { font-weight: 700; text-align: right; color: #0f172a; padding-left: 12px; }
        .shipto-box { margin-bottom: 5px; font-size: ${metaFontSize}; }
        .data-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; border: 1px solid #334155; }
        .data-table th { background-color: #54595F !important; color: #ffffff !important; padding: ${headerPadding}; font-size: ${headerFontSize}; text-align: center; border: 1px solid #cbd5e1; font-weight: 700; }
        .data-table td { border: 1px solid #cbd5e1; padding: ${tablePadding}; font-size: ${tableFontSize}; }
        .data-table tr { page-break-inside: avoid; }
        .totals-wrap { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 3px; margin-bottom: 5px; page-break-inside: avoid; }
        .totals-table { width: 210px; border-collapse: collapse; border: 1px solid #54595F; }
        .totals-table td { padding: 2px 6px; font-size: ${metaFontSize}; }
        .totals-table .label-cell { background-color: #54595F !important; color: #ffffff !important; font-weight: 700; font-size: ${metaFontSize}; width: 55%; text-align: center; }
        .totals-table .val-cell { text-align: right; font-weight: 800; font-size: ${metaFontSize}; background: #ffffff; border: 1px solid #54595F; }
        .signatures-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 5px; border-top: 1px solid #cbd5e1; padding-top: 4px; font-size: ${metaFontSize}; page-break-inside: avoid; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="header-title">Packing List</div>
      <div class="top-grid">
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <img src="${MOBILECARE_LOGO_BASE64}" alt="Mobile Care Logo" style="width: ${logoSize}; height: ${logoSize}; object-fit: contain; flex-shrink: 0;" />
          <div>
            <div class="company-title">MOBILE CARE SERVICES PHILS. INC.</div>
            <div style="color: #334155; font-size: 9px; margin-top: 1px;">Business and Distribution Center</div>
            <div style="color: #475569; font-size: 8.5px;">2/L Northeast Square, #47</div>
            <div style="color: #475569; font-size: 8.5px;">Connecticut St. Northeast Greenhills</div>
            <div style="color: #475569; font-size: 8.5px;">San Juan City, Metro Manila</div>
          </div>
        </div>
        <div>
          <table class="meta-table">
            <tr><td class="meta-label">INVOICE REF:</td><td class="meta-val">${shipment.invoice_ref || 'DCMSPIOWNED#20260818N'}</td></tr>
            <tr><td class="meta-label">SHIPMENT DATE:</td><td class="meta-val">${shipment.shipment_date || new Date().toLocaleDateString('en-US')}</td></tr>
            <tr><td class="meta-label">BOX/S #:</td><td class="meta-val">${shipment.total_boxes || 1}</td></tr>
            <tr><td class="meta-label">CARRIER:</td><td class="meta-val">${shipment.carrier || 'Lite Express'}</td></tr>
            <tr><td class="meta-label">TRACKING NUMBER:</td><td class="meta-val">${shipment.tracking_number || ''}</td></tr>
          </table>
        </div>
      </div>

      <div class="shipto-box">
        <div style="display: flex; gap: 10px;">
          <strong style="min-width: 45px;">Ship To</strong>
          <div>
            <strong style="text-transform: uppercase;">${site.name || shipment.site_name || 'SERVICE HUB'}</strong><br/>
            <span style="color: #334155; font-size: 8.5px;">${site.address || `${site.name || 'Branch'}, Philippines`}</span>
          </div>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 32px;">#</th>
            <th style="width: 105px;">PART NUMBER</th>
            <th>DESCRIPTION</th>
            <th style="width: 165px;">SERIAL NUMBER</th>
            <th style="width: 45px;">BOX #</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>

      <div class="totals-wrap">
        <div>
          <strong style="font-size: ${metaFontSize};">Remarks</strong><br/>
          <span style="font-size: ${metaFontSize}; color: #0f172a;">${shipment.remarks || 'KGB PARTS'}</span>
        </div>
        <table class="totals-table">
          <tr>
            <td class="label-cell">TOTAL QTY</td>
            <td class="val-cell">${items.length}</td>
          </tr>
          <tr>
            <td class="label-cell">TOTAL BOXES</td>
            <td class="val-cell">${shipment.total_boxes || 1}</td>
          </tr>
        </table>
      </div>

      <div class="signatures-grid">
        <div>
          <strong>Prepared and Counted by:</strong> <span>${shipment.prepared_by_name || 'Joshua Juvida'}</span>
        </div>
        <div>
          <strong>Verified by:</strong> <span>${shipment.verified_by_name || 'Anjo Alcazar'}</span>
        </div>
        <div style="grid-column: 1 / -1; margin-top: 2px;">
          <strong>Receiving Branch Signature:</strong> <span>${shipment.receiving_signature || (site.code ? `APP ${site.code.replace(/^(site-|asp-)/i, '').toUpperCase()}` : 'APP RM')}</span>
        </div>
      </div>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Triggers a beautifully styled, landscape Master Allocation Matrix print document
 */
export function printAllocationMatrixDirect(allocations = [], sites = [], period = 'August 2026') {
  const printWindow = window.open('', '_blank', 'width=1200,height=900');
  if (!printWindow) {
    window.print();
    return;
  }

  const totalUnits = allocations.reduce((sum, it) => sum + (it.total_allocated_qty || 0), 0);
  let totalCost = 0;
  allocations.forEach(it => {
    const p = it.stocking_price || (it.description?.toLowerCase().includes('display') ? 279 : 99);
    totalCost += (it.total_allocated_qty || 0) * p;
  });

  const displayItems = allocations.filter(it => it.category_id === 'cat-display' || it.description?.toLowerCase().includes('display'));
  const batteryItems = allocations.filter(it => it.category_id === 'cat-battery' || it.description?.toLowerCase().includes('battery') || !displayItems.includes(it));

  const renderSectionRows = (items, catLabel) => {
    return items.map((it, idx) => {
      const price = it.stocking_price || 0;
      const q = it.total_allocated_qty || 0;
      const c = it.total_stock_cost || (q * price);
      const split = calculateWeeklySplit(q, c, idx + 3);
      const isDisplay = catLabel === 'DISPLAY';

      const siteCells = sites.map(s => {
        const sq = it.site_quantities?.[s.id] ?? it.site_quantities?.[s.code] ?? 0;
        return `<td style="text-align: center; ${sq > 0 ? 'background: #dcfce7; color: #15803d; font-weight: 700;' : 'color: #94a3b8;'}">${sq}</td>`;
      }).join('');

      return `
        <tr>
          <td style="text-align: center;"><span style="background: ${isDisplay ? '#e0f2fe' : '#dcfce7'}; color: ${isDisplay ? '#0369a1' : '#15803d'}; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 9.5px;">${catLabel}</span></td>
          <td style="font-weight: 700; font-family: monospace; font-size: 10.5px;">${it.part_number}</td>
          <td style="text-align: left; font-size: 10.5px;">${it.description}</td>
          <td style="text-align: right; font-size: 10px;">$${price.toFixed(2)}</td>
          ${siteCells}
          <td style="text-align: center; background: #e0f2fe; color: #0369a1; font-weight: 800; font-size: 11px;">${q}</td>
          <td style="text-align: right; font-weight: 700; font-size: 10.5px;">$${c.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align: center; font-size: 10px;">${split.w1_qty}</td>
          <td style="text-align: right; font-size: 10px;">$${split.w1_cost.toFixed(2)}</td>
          <td style="text-align: center; font-size: 10px;">${split.w2_qty}</td>
          <td style="text-align: right; font-size: 10px;">$${split.w2_cost.toFixed(2)}</td>
          <td style="text-align: center; font-size: 10px;">${split.w3_qty}</td>
          <td style="text-align: right; font-size: 10px;">$${split.w3_cost.toFixed(2)}</td>
          <td style="text-align: center; font-size: 10px;">${split.w4_qty}</td>
          <td style="text-align: right; font-size: 10px;">$${split.w4_cost.toFixed(2)}</td>
          <td style="text-align: center; font-size: 9px;"><span style="background: ${q > 0 ? '#dcfce7' : '#f1f5f9'}; color: ${q > 0 ? '#15803d' : '#64748b'}; padding: 2px 6px; border-radius: 4px; font-weight: 700;">${q > 0 ? 'ORDER REQUIRED' : 'NO NEED TO ORDER'}</span></td>
        </tr>
      `;
    }).join('');
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Master Allocation Matrix - ${period}</title>
      <style>
        @page { size: landscape; margin: 6mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 0; padding: 6px; font-size: 10px; }
        .matrix-title-bar { background: #0f172a; color: #ffffff; padding: 10px 16px; border-radius: 6px 6px 0 0; display: flex; justify-content: space-between; align-items: center; }
        .matrix-kpi-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0; }
        .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 4px; }
        .kpi-label { font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; }
        .kpi-val { font-size: 14px; font-weight: 800; color: #0f172a; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #0f172a; color: #ffffff; padding: 4px 3px; font-size: 9px; border: 1px solid #334155; text-align: center; }
        td { border: 1px solid #cbd5e1; padding: 3px 4px; font-size: 9.5px; }
        .footer-row-1 { background: #0f172a; color: #ffffff; font-weight: 800; }
        .footer-row-2 { background: #1e293b; color: #38bdf8; font-weight: 800; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="matrix-title-bar">
        <div>
          <strong style="font-size: 13px;">MOBILE CARE SERVICES PHILS. INC. — Master Allocation Matrix</strong>
          <div style="font-size: 10px; color: #94a3b8;">${period} • 26 Branch Distribution & 4-Week Batch Valuation</div>
        </div>
        <div style="font-size: 11px; font-weight: 700; color: #38bdf8;">100% Zero-Error Matched</div>
      </div>

      <div class="matrix-kpi-bar">
        <div class="kpi-card"><div class="kpi-label">Total Allocated</div><div class="kpi-val" style="color: #0284c7;">${totalUnits.toLocaleString()} units</div></div>
        <div class="kpi-card"><div class="kpi-label">Active Branches</div><div class="kpi-val">${sites.length} sites</div></div>
        <div class="kpi-card"><div class="kpi-label">Grand Total Stock Value</div><div class="kpi-val" style="color: #15803d;">$${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 60px;">Commodity</th>
            <th style="width: 75px;">Part #</th>
            <th>Description</th>
            <th style="width: 55px;">Stock Price</th>
            ${sites.map(s => `<th style="color: #38bdf8; font-size: 8.5px;">${s.code}</th>`).join('')}
            <th style="background: #0284c7; width: 60px;">Total Parts</th>
            <th style="background: #0369a1; width: 75px;">Total Value</th>
            <th style="background: #334155;">W1 Qty</th>
            <th style="background: #1e293b; color: #38bdf8;">W1 Cost</th>
            <th style="background: #334155;">W2 Qty</th>
            <th style="background: #1e293b; color: #38bdf8;">W2 Cost</th>
            <th style="background: #334155;">W3 Qty</th>
            <th style="background: #1e293b; color: #38bdf8;">W3 Cost</th>
            <th style="background: #334155;">W4 Qty</th>
            <th style="background: #1e293b; color: #38bdf8;">W4 Cost</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: #f0f9ff; font-weight: 800; color: #0369a1;"><td colspan="${sites.length + 14}">DISPLAY COMMODITY (${displayItems.length} Parts)</td></tr>
          ${renderSectionRows(displayItems, 'DISPLAY')}
          <tr style="background: #f0fdf4; font-weight: 800; color: #15803d;"><td colspan="${sites.length + 14}">BATTERY COMMODITY (${batteryItems.length} Parts)</td></tr>
          ${renderSectionRows(batteryItems, 'BATTERY')}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Downloads a high-resolution, landscape Master Allocation Matrix PDF
 */
export function exportAllocationToPDF(allocations = [], sites = [], period = 'August 2026') {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a3' // A3 landscape provides optimal resolution for 35+ columns
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 8;

  // Title Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, 8, pageWidth - (margin * 2), 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(`MOBILE CARE SERVICES PHILS. INC. — Master Allocation Matrix (${period})`, margin + 6, 16);

  const headers = [
    'Commodity',
    'Part #',
    'Description',
    'Price',
    ...sites.map(s => s.code),
    'Total Qty',
    'Total Cost',
    'W1 Qty',
    'W1 Total',
    'W2 Qty',
    'W2 Total',
    'W3 Qty',
    'W3 Total',
    'W4 Qty',
    'W4 Total',
    'Remarks'
  ];

  const tableData = allocations.map((item, idx) => {
    const isDisplay = item.category_id === 'cat-display' || item.description?.toLowerCase().includes('display');
    const price = item.stocking_price || 0;
    const qty = item.total_allocated_qty || 0;
    const cost = item.total_stock_cost || (qty * price);
    const split = calculateWeeklySplit(qty, cost, idx + 3);

    const row = [
      isDisplay ? 'DISPLAY' : 'BATTERY',
      item.part_number,
      item.description,
      `$${price.toFixed(0)}`
    ];

    sites.forEach(s => {
      row.push(item.site_quantities?.[s.id] ?? item.site_quantities?.[s.code] ?? 0);
    });

    row.push(
      qty,
      `$${cost.toFixed(0)}`,
      split.w1_qty,
      `$${split.w1_cost.toFixed(0)}`,
      split.w2_qty,
      `$${split.w2_cost.toFixed(0)}`,
      split.w3_qty,
      `$${split.w3_cost.toFixed(0)}`,
      split.w4_qty,
      `$${split.w4_cost.toFixed(0)}`,
      qty > 0 ? 'ORDER' : 'NO NEED'
    );

    return row;
  });

  autoTable(doc, {
    startY: 24,
    head: [headers],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
      valign: 'middle'
    },
    bodyStyles: {
      fontSize: 6.5,
      textColor: [15, 23, 42]
    },
    margin: { left: margin, right: margin }
  });

  doc.save(`Master_Allocation_${period.replace(/\s+/g, '_')}.pdf`);
}

/**
 * Direct print preview for Fixably Stock Transfers Report
 */
export function printStockTransfersDirect(records = [], metadata = {}) {
  const printWindow = window.open('', '_blank', 'width=1100,height=850');
  if (!printWindow) {
    window.print();
    return;
  }

  const totalQty = records.reduce((sum, r) => sum + (r.transfer_quantity || 0), 0);
  const totalVal = records.reduce((sum, r) => sum + (r.transfer_value || 0), 0);

  const rowsHtml = records.slice(0, 500).map((r, idx) => `
    <tr>
      <td style="text-align: center; color: #64748b;">${idx + 1}</td>
      <td style="text-align: center;">${r.transfer_received_date || '—'}</td>
      <td style="text-align: center; font-weight: 700; color: #92400e; background: #fef3c7; border-radius: 4px;">${r.from_stock || '—'}</td>
      <td style="text-align: center; font-weight: 700; color: #15803d; background: #dcfce7; border-radius: 4px;">${r.to_stock || '—'}</td>
      <td style="text-align: center; font-family: monospace; font-weight: 700;">${r.product_code || '—'}</td>
      <td style="text-align: left;">${r.product_name || '—'}</td>
      <td style="text-align: center; font-weight: 800; color: #0369a1; background: #e0f2fe;">${r.transfer_quantity || 1}</td>
      <td style="text-align: center; font-family: monospace; font-size: 10px;">${r.serial_number || '—'}</td>
      <td style="text-align: right; font-weight: 700;">$${(r.transfer_value || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Fixably Stock Transfers Report</title>
      <style>
        @page { size: landscape; margin: 8mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 0; padding: 8px; font-size: 11px; }
        .report-header { background: #0f172a; color: #ffffff; padding: 12px 18px; border-radius: 6px 6px 0 0; display: flex; justify-content: space-between; align-items: center; }
        .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 10px 0; }
        .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; }
        .kpi-title { font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase; }
        .kpi-number { font-size: 16px; font-weight: 800; color: #0f172a; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #0f172a; color: #ffffff; padding: 6px 4px; font-size: 9.5px; border: 1px solid #334155; text-align: center; }
        td { border: 1px solid #cbd5e1; padding: 4px 6px; font-size: 10px; }
        .footer-row { background: #0f172a; color: #ffffff; font-weight: 800; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="report-header">
        <div>
          <div style="font-size: 14px; font-weight: 800;">MOBILE CARE SERVICES PHILS. INC.</div>
          <div style="font-size: 11px; color: #94a3b8;">Fixably Stock Transfers Comprehensive Movement Report</div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #38bdf8; font-weight: 700;">
          Source: ${metadata.fileName || 'Reports – Stock Transfers.xlsx'}
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-box"><div class="kpi-title">Total Transfers</div><div class="kpi-number" style="color: #0284c7;">${records.length.toLocaleString()} transfers</div></div>
        <div class="kpi-box"><div class="kpi-title">Total Quantity Moved</div><div class="kpi-number">${totalQty.toLocaleString()} units</div></div>
        <div class="kpi-box"><div class="kpi-title">Total Valuation</div><div class="kpi-number" style="color: #15803d;">$${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 30px;">#</th>
            <th style="width: 80px;">Received Date</th>
            <th style="width: 120px;">From Stock (Origin)</th>
            <th style="width: 120px;">To Stock (Destination)</th>
            <th style="width: 90px;">Part Code</th>
            <th>Product Name</th>
            <th style="width: 45px;">Qty</th>
            <th style="width: 150px;">Serial Number</th>
            <th style="width: 80px;">Transfer Value</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr class="footer-row">
            <td colspan="5" style="text-align: center;">TOTAL SUMMARY</td>
            <td>${records.length} Total Records (${records.length > 500 ? 'Showing first 500' : 'Complete'})</td>
            <td style="text-align: center;">${totalQty}</td>
            <td></td>
            <td style="text-align: right;">$${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        </tbody>
      </table>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Downloads landscape PDF for Fixably Stock Transfers Report
 */
export function exportStockTransfersToPDF(records = [], metadata = {}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 8;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, 8, pageWidth - (margin * 2), 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  const titleText = metadata?.fileName
    ? `MOBILE CARE SERVICES PHILS. INC. — Fixably Stock Transfers (${metadata.fileName})`
    : 'MOBILE CARE SERVICES PHILS. INC. — Fixably Stock Transfers Report';
  doc.text(titleText, margin + 6, 15.5);

  const headers = [
    '#',
    'Received Date',
    'From Stock',
    'To Stock',
    'Part Code',
    'Product Name',
    'Qty',
    'Serial Number',
    'Value ($)'
  ];

  const tableData = records.slice(0, 400).map((r, idx) => [
    idx + 1,
    r.transfer_received_date || '',
    r.from_stock || '',
    r.to_stock || '',
    r.product_code || '',
    r.product_name || '',
    r.transfer_quantity || 1,
    r.serial_number || '',
    `$${(r.transfer_value || 0).toFixed(2)}`
  ]);

  autoTable(doc, {
    startY: 23,
    head: [headers],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 6.8,
      textColor: [15, 23, 42]
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { halign: 'center', cellWidth: 22 },
      2: { halign: 'center', cellWidth: 30 },
      3: { halign: 'center', cellWidth: 30 },
      4: { halign: 'center', cellWidth: 22 },
      5: { halign: 'left', cellWidth: 65 },
      6: { halign: 'center', cellWidth: 12 },
      7: { halign: 'center', cellWidth: 42 },
      8: { halign: 'right', cellWidth: 20 }
    },
    margin: { left: margin, right: margin }
  });

  doc.save(`Stock_Transfers_Report_${new Date().toISOString().split('T')[0]}.pdf`);
}

/**
 * Downloads landscape PDF for Fixably Forecasting Report
 */
export function exportForecastingReportToPDF(forecastItems = [], metadata = {}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 8;
  const periodLabel = metadata?.periodLabel || 'September 2026';

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, 8, pageWidth - (margin * 2), 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  const titleText = `MOBILE CARE SERVICES PHILS. INC. — Fixably Demand Forecasting Report (${periodLabel})`;
  doc.text(titleText, margin + 6, 15.5);

  const resolveStockPrice = (item) => {
    if (!item) return 100;
    if (typeof item.stocking_price === 'number' && item.stocking_price > 0) return item.stocking_price;
    const desc = String(item.description || item.part_name || '').toLowerCase();
    if (desc.includes('display')) return 279;
    if (desc.includes('battery')) return 89;
    if (desc.includes('camera')) return 129;
    if (desc.includes('glass') || desc.includes('back')) return 99;
    if (desc.includes('rear') || desc.includes('mid')) return 119;
    return 100;
  };

  const totalForecastUnits = forecastItems.reduce((s, it) => s + (it.final_forecast ?? it.computed_forecast ?? 0), 0);
  const totalValuation = forecastItems.reduce((s, it) => {
    const qty = it.final_forecast ?? it.computed_forecast ?? 0;
    const price = resolveStockPrice(it);
    return s + (qty * price);
  }, 0);

  // Sub-header Summary
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Total Parts: ${forecastItems.length} SKUs  |  Recommended Demand: ${totalForecastUnits.toLocaleString()} units  |  Projected Stock Cost: $${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}  |  Generated: ${new Date().toLocaleString()}`,
    margin + 6,
    24
  );

  const headers = [
    '#',
    'Part Number',
    'Description',
    'iPhone Model',
    'Commodity',
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
    'Base',
    'Final',
    'Price ($)',
    'Total Cost ($)'
  ];

  const tableData = forecastItems.map((it, idx) => {
    const m = it.ytd_monthly_counts || [];
    const base = it.computed_forecast ?? 0;
    const finalVal = it.final_forecast ?? base;
    const price = resolveStockPrice(it);
    const cost = finalVal * price;

    return [
      idx + 1,
      it.part_number || '',
      it.description || '',
      it.iphone_model || '',
      it.category_name || (it.part_number?.startsWith('661-') ? 'Apple Part' : 'General'),
      m[0] || 0,
      m[1] || 0,
      m[2] || 0,
      m[3] || 0,
      m[4] || 0,
      m[5] || 0,
      m[6] || 0,
      m[7] || 0,
      base,
      finalVal,
      `$${price.toFixed(2)}`,
      `$${cost.toFixed(2)}`
    ];
  });

  autoTable(doc, {
    startY: 28,
    head: [headers],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 6.8,
      textColor: [15, 23, 42]
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 7 },
      1: { halign: 'center', cellWidth: 20 },
      2: { halign: 'left', cellWidth: 46 },
      3: { halign: 'left', cellWidth: 28 },
      4: { halign: 'center', cellWidth: 16 },
      5: { halign: 'center', cellWidth: 8 },
      6: { halign: 'center', cellWidth: 8 },
      7: { halign: 'center', cellWidth: 8 },
      8: { halign: 'center', cellWidth: 8 },
      9: { halign: 'center', cellWidth: 8 },
      10: { halign: 'center', cellWidth: 8 },
      11: { halign: 'center', cellWidth: 8 },
      12: { halign: 'center', cellWidth: 8 },
      13: { halign: 'center', cellWidth: 12 },
      14: { halign: 'center', cellWidth: 12 },
      15: { halign: 'right', cellWidth: 18 },
      16: { halign: 'right', cellWidth: 22 }
    },
    margin: { left: margin, right: margin }
  });

  doc.save(`Forecasting_Report_${periodLabel.replace(/\s+/g, '_')}.pdf`);
}

/**
 * Direct print preview for Fixably Forecasting Report
 */
export function printForecastingReportDirect(forecastItems = [], metadata = {}) {
  const periodLabel = metadata?.periodLabel || 'September 2026';
  const resolveStockPrice = (item) => {
    if (!item) return 100;
    if (typeof item.stocking_price === 'number' && item.stocking_price > 0) return item.stocking_price;
    const desc = String(item.description || item.part_name || '').toLowerCase();
    if (desc.includes('display')) return 279;
    if (desc.includes('battery')) return 89;
    if (desc.includes('camera')) return 129;
    if (desc.includes('glass') || desc.includes('back')) return 99;
    if (desc.includes('rear') || desc.includes('mid')) return 119;
    return 100;
  };

  const totalForecastUnits = forecastItems.reduce((s, it) => s + (it.final_forecast ?? it.computed_forecast ?? 0), 0);
  const totalValuation = forecastItems.reduce((s, it) => {
    const qty = it.final_forecast ?? it.computed_forecast ?? 0;
    const price = resolveStockPrice(it);
    return s + (qty * price);
  }, 0);

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Pop-up blocked. Please allow pop-ups for direct printing.');
    return;
  }

  const rowsHtml = forecastItems.map((it, idx) => {
    const m = it.ytd_monthly_counts || [];
    const base = it.computed_forecast ?? 0;
    const finalVal = it.final_forecast ?? base;
    const price = resolveStockPrice(it);
    const cost = finalVal * price;

    return `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td style="font-family:monospace;font-weight:bold;color:#0284c7">${it.part_number}</td>
        <td>${it.description || ''}</td>
        <td>${it.iphone_model || ''}</td>
        <td style="text-align:center">${it.category_name || (it.part_number?.startsWith('661-') ? 'Apple Part' : 'General')}</td>
        <td style="text-align:center">${m[0] || 0}</td>
        <td style="text-align:center">${m[1] || 0}</td>
        <td style="text-align:center">${m[2] || 0}</td>
        <td style="text-align:center">${m[3] || 0}</td>
        <td style="text-align:center">${m[4] || 0}</td>
        <td style="text-align:center">${m[5] || 0}</td>
        <td style="text-align:center">${m[6] || 0}</td>
        <td style="text-align:center">${m[7] || 0}</td>
        <td style="text-align:center;font-weight:600">${base}</td>
        <td style="text-align:center;font-weight:bold;color:#0f172a;background:#f8fafc">${finalVal}</td>
        <td style="text-align:right">$${price.toFixed(2)}</td>
        <td style="text-align:right;font-weight:bold">$${cost.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Fixably Demand Forecasting Report - ${periodLabel}</title>
      <style>
        @page { size: landscape; margin: 8mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; font-size: 11px; }
        .header-bar { background: #0f172a; color: #fff; padding: 12px 16px; border-radius: 6px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
        .kpi-bar { display: flex; gap: 12px; margin-bottom: 14px; }
        .kpi-card { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0; background: #f8fafc; }
        .kpi-card strong { display: block; font-size: 14px; color: #0f172a; }
        .kpi-card span { font-size: 10px; color: #64748b; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th { background: #0f172a; color: #fff; font-weight: 700; padding: 6px 4px; text-align: center; border: 1px solid #334155; }
        td { padding: 5px 4px; border: 1px solid #e2e8f0; }
        tr:nth-child(even) { background: #f8fafc; }
      </style>
    </head>
    <body>
      <div class="header-bar">
        <div>
          <div style="font-size: 14px; font-weight: bold;">MOBILE CARE SERVICES PHILS. INC.</div>
          <div style="font-size: 11px; color: #94a3b8;">Fixably Demand Forecasting Master Report — ${periodLabel}</div>
        </div>
        <div style="font-size: 10px; text-align: right; color: #94a3b8;">
          Printed: ${new Date().toLocaleString()}
        </div>
      </div>

      <div class="kpi-bar">
        <div class="kpi-card"><span>Total SKUs</span><strong>${forecastItems.length} Part Models</strong></div>
        <div class="kpi-card"><span>Total Demand</span><strong>${totalForecastUnits.toLocaleString()} units</strong></div>
        <div class="kpi-card"><span>Projected Stock Valuation</span><strong>$${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Part Number</th>
            <th>Description</th>
            <th>iPhone Model</th>
            <th>Commodity</th>
            <th>Jan</th><th>Feb</th><th>Mar</th><th>Apr</th><th>May</th><th>Jun</th><th>Jul</th><th>Aug</th>
            <th>Base</th>
            <th>Final</th>
            <th>Price</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `);

  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 400);
}

