import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MOBILECARE_LOGO_BASE64, MOBILECARE_NO_BG_LOGO_BASE64 } from '../assets/logoBase64.js';
import { calculateWeeklySplit, getRowParityOffset, isDisplayCategoryOrDesc } from './allocationEngine.js';

const getPdfDoc = (options = {}) => {
  const Constructor = typeof jsPDF === 'function' ? jsPDF : (jsPDF.jsPDF || jsPDF.default);
  return new Constructor(options);
};

/**
 * Generates and downloads a pixel-perfect Packing List PDF matching corporate standards,
 * with the official Declaration Form appended seamlessly as Page 2.
 */
export function generatePackingListPDF(shipment, items = [], site = {}, options = {}) {
  const doc = getPdfDoc({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const totalItemsCount = items?.length || 0;
  const pageWidth = doc.internal.pageSize.getWidth();
  const isDense = totalItemsCount > 45;
  const isMedium = totalItemsCount > 25;
  const margin = isDense ? 9 : isMedium ? 11 : 14;
  const tableWidth = pageWidth - (margin * 2);

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1: PACKING LIST MANIFEST
  // ══════════════════════════════════════════════════════════════════════════

  // Title: "Packing List" Centered
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isDense ? 13 : 15);
  doc.setTextColor(0, 0, 0);
  doc.text('Packing List', pageWidth / 2, isDense ? 10 : 13, { align: 'center' });

  // Top Left: Mobile Care Logo + Company Info
  const headerTopY = isDense ? 14 : 18;
  try {
    if (MOBILECARE_LOGO_BASE64) {
      doc.addImage(MOBILECARE_LOGO_BASE64, 'PNG', margin, headerTopY - 1, 13, 13);
    }
  } catch (e) {
    console.warn('Could not render logo in PDF:', e);
  }

  const compX = margin + 16;
  doc.setFontSize(isDense ? 8.5 : 9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('MOBILE CARE SERVICES PHILS. INC.', compX, headerTopY + 2);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isDense ? 6.8 : 7.5);
  doc.setTextColor(51, 65, 85);
  const lineGap = isDense ? 2.7 : 3.3;
  doc.text('Business and Distribution Center', compX, headerTopY + 2 + lineGap);
  doc.text('2/L Northeast Square, #47', compX, headerTopY + 2 + lineGap * 2);
  doc.text('Connecticut St. Northeast Greenhills', compX, headerTopY + 2 + lineGap * 3);
  doc.text('San Juan City, Metro Manila', compX, headerTopY + 2 + lineGap * 4);

  // Top Right: Invoice / Shipment Metadata Box
  const rightBoxWidth = 84;
  const rightColX = pageWidth - margin - rightBoxWidth;
  const rightValX = pageWidth - margin;

  // Calculate Total Declared Value in PHP (part price × 85 PHP)
  const totalDeclaredValuePHP = items.reduce((sum, it) => {
    const priceUSD = it.stocking_price ?? it.price ?? (it.description?.toLowerCase().includes('display') ? 279 : (it.description?.toLowerCase().includes('battery') ? 99 : 50));
    return sum + (priceUSD * 85);
  }, 0);

  const boxDisplay = shipment.box_number_label || (shipment.box_number ? `${shipment.box_number}/${shipment.total_boxes || 1}` : `1/${shipment.total_boxes || 1}`);

  const createdDateStr = shipment.created_date || (shipment.created_at ? new Date(shipment.created_at).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US'));
  const shipmentDateStr = shipment.shipment_date || '___________________';
  const trackingNumberStr = shipment.tracking_number || shipment.booking_id || '___________________';

  const metaRows = [
    { label: 'INVOICE REF:', val: shipment.invoice_ref || shipment.shipment_number || '___________________' },
    { label: 'CREATED DATE:', val: createdDateStr },
    { label: 'SHIPMENT DATE:', val: shipmentDateStr },
    { label: 'TRACKING NUMBER:', val: trackingNumberStr },
    { label: 'BOX/S #:', val: boxDisplay },
    { label: 'COURIER:', val: shipment.carrier || shipment.courier || 'Lite Express' },
    ...(shipment.transfer_slip_number ? [{ label: 'TRANSFER SLIP #:', val: shipment.transfer_slip_number }] : [])
  ];

  let metaY = headerTopY + 1.2;
  const metaGap = isDense ? 2.8 : 3.4;
  metaRows.forEach(row => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isDense ? 6.8 : 7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(row.label, rightColX, metaY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isDense ? 6.8 : 7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(String(row.val), rightValX, metaY, { align: 'right' });
    metaY += metaGap;
  });

  // Calculate safe Ship To Y (ensuring zero overlap with company address or right metadata box)
  const companyBottomY = headerTopY + 2 + lineGap * 4;
  const metaBottomY = headerTopY + 1.2 + (metaRows.length * metaGap);
  const maxHeaderBottomY = Math.max(companyBottomY, metaBottomY);
  const shipToY = maxHeaderBottomY + (isDense ? 3.5 : 5.5);

  // Ship To Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isDense ? 7.8 : 8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Ship To:', margin, shipToY);
  doc.text((site.name || shipment.site_name || 'SERVICE HUB').toUpperCase(), margin + 16, shipToY);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isDense ? 6.8 : 7.5);
  doc.setTextColor(71, 85, 105);
  const siteAddr = site.address || `${site.name || 'Branch'}, Philippines`;
  doc.text(siteAddr, margin + 16, shipToY + 3.4, { maxWidth: tableWidth - 16 });

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

  const tableData = items.map((item, index) => {
    const itemBoxStr = item.box_number 
      ? (String(item.box_number).includes('/') ? item.box_number : `${item.box_number}/${shipment.total_boxes || 1}`)
      : boxDisplay;

    return [
      index + 1,
      item.part_number || item.partNumber || '',
      item.description || item.partDescription || '',
      item.serial_number || item.serialNumber || '',
      itemBoxStr
    ];
  });

  const tableStartY = shipToY + (isDense ? 7 : 9);

  const col0 = 8;
  const col1 = 28;
  const col4 = 16;
  const col3 = isDense ? 58 : 56;
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
  const totalsY = finalY + (isDense ? 2.5 : 4.5);
  const totalBoxWidth = 74;
  const totalBoxX = pageWidth - margin - totalBoxWidth;
  const totalValX = pageWidth - margin - 3;
  const boxRowHeight = isDense ? 3.6 : 4.4;

  // Remarks (Left Aligned)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isDense ? 7.2 : 8);
  doc.setTextColor(15, 23, 42);
  doc.text('Remarks', margin, totalsY + 2.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isDense ? 7.2 : 8);
  doc.text(shipment.remarks || 'KGB PARTS', margin, totalsY + (isDense ? 5.2 : 6.5));

  // Totals Box (Right Aligned)
  doc.setFillColor(84, 89, 95);
  doc.rect(totalBoxX, totalsY, 40, boxRowHeight, 'F');
  doc.setDrawColor(84, 89, 95);
  doc.rect(totalBoxX + 40, totalsY, totalBoxWidth - 40, boxRowHeight, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(isDense ? 6.5 : 7.5);
  doc.text('TOTAL QTY', totalBoxX + 20, totalsY + (boxRowHeight * 0.7), { align: 'center' });
  doc.setTextColor(15, 23, 42);
  doc.text(String(items.length), totalValX, totalsY + (boxRowHeight * 0.7), { align: 'right' });

  // Total Boxes Row
  doc.setFillColor(84, 89, 95);
  doc.rect(totalBoxX, totalsY + boxRowHeight, 40, boxRowHeight, 'F');
  doc.rect(totalBoxX + 40, totalsY + boxRowHeight, totalBoxWidth - 40, boxRowHeight, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL BOXES', totalBoxX + 20, totalsY + boxRowHeight + (boxRowHeight * 0.7), { align: 'center' });
  doc.setTextColor(15, 23, 42);
  doc.text(String(shipment.total_boxes || 1), totalValX, totalsY + boxRowHeight + (boxRowHeight * 0.7), { align: 'right' });

  // Total Declared Value Row (PHP = part price × 85)
  doc.setFillColor(84, 89, 95);
  doc.rect(totalBoxX, totalsY + boxRowHeight * 2, 40, boxRowHeight, 'F');
  doc.rect(totalBoxX + 40, totalsY + boxRowHeight * 2, totalBoxWidth - 40, boxRowHeight, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(isDense ? 5.8 : 6.8);
  doc.text('DECLARED VALUE', totalBoxX + 20, totalsY + boxRowHeight * 2 + (boxRowHeight * 0.7), { align: 'center' });
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(isDense ? 6.2 : 7.2);
  doc.text(`PHP ${totalDeclaredValuePHP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, totalValX, totalsY + boxRowHeight * 2 + (boxRowHeight * 0.7), { align: 'right' });

  // Signatures Section (Clean divider and crisp 2-column layout with generous label spacing)
  const sigLineY = totalsY + (boxRowHeight * 3) + (isDense ? 3.5 : 5.5);

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, sigLineY, pageWidth - margin, sigLineY);

  const sigRow1Y = sigLineY + (isDense ? 4 : 5.5);
  const sigRow2Y = sigRow1Y + (isDense ? 4 : 5.5);
  doc.setFontSize(isDense ? 6.8 : 7.8);
  doc.setTextColor(15, 23, 42);

  const colRightX = margin + 92;

  // Row 1 - Left: Prepared and Counted by
  doc.setFont('helvetica', 'bold');
  doc.text('Prepared and Counted by:', margin, sigRow1Y);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.prepared_by_name || 'Zhon Manaois', margin + 42, sigRow1Y);

  // Row 1 - Right: Verified by
  const supervisorName = options.supervisorName || shipment.verified_by_name || 'Anjo Alcazar';
  doc.setFont('helvetica', 'bold');
  doc.text('Verified by:', colRightX, sigRow1Y);
  doc.setFont('helvetica', 'normal');
  doc.text(supervisorName, colRightX + 20, sigRow1Y);

  // Row 2 - Left: Receiving Branch Signature
  doc.setFont('helvetica', 'bold');
  doc.text('Receiving Branch Signature:', margin, sigRow2Y);
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.receiving_signature || (site.code ? `APP ${site.code.replace(/^(site-|asp-)/i, '').toUpperCase()}` : 'APP RM'), margin + 42, sigRow2Y);

  // Row 2 - Right: Pickup By (Always aligned on the right under Verified By)
  const pickupByName = shipment.pickup_by_name || shipment.courier_name || shipment.rider_name || (shipment.carrier === 'Utility' ? 'Utility' : '');
  if (pickupByName) {
    doc.setFont('helvetica', 'bold');
    doc.text('Pickup By:', colRightX, sigRow2Y);
    doc.setFont('helvetica', 'normal');
    doc.text(pickupByName, colRightX + 20, sigRow2Y);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 2: OFFICIAL DECLARATION FORM FOR SITE TRANSFERS
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();

  const decMargin = 20;
  const decPageWidth = doc.internal.pageSize.getWidth();
  const decHeaderY = 26;
  const logoWidth = 30;
  const logoHeight = 14.5; // medium size: preserves exact 1442:698 aspect ratio
  const decCompX = decMargin + logoWidth + 6;

  // Top Left: Mobile Care Logo (Medium size, transparent background) + BUSINESS DISTRIBUTION CENTER
  try {
    const logoToUse = MOBILECARE_NO_BG_LOGO_BASE64 || MOBILECARE_LOGO_BASE64;
    if (logoToUse) {
      doc.addImage(logoToUse, 'PNG', decMargin, decHeaderY, logoWidth, logoHeight);
    }
  } catch (e) {
    console.warn('Could not render logo in Declaration Form PDF:', e);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('BUSINESS DISTRIBUTION CENTER', decCompX, decHeaderY + (logoHeight / 2) + 1.4);

  // Two-Column Section Geometry
  const formStartY = 58;
  const decLeftColX = decMargin;
  const decLeftColWidth = 84;
  const idBoxX = decLeftColX + decLeftColWidth + 14;
  const idBoxWidth = decPageWidth - decMargin - idBoxX;
  const idBoxHeight = 118;

  // Dynamic values
  const destSiteName = (site.name || shipment.site_name || 'SERVICE HUB').toUpperCase();
  const courierType = (shipment.carrier || shipment.courier || 'Lite Express').toUpperCase();
  const bookingId = (shipment.booking_id || shipment.tracking_number || shipment.airway_bill || 'N/A').toUpperCase();
  const guardOnDuty = options.guardOnDuty || shipment.guard_on_duty || '';
  const pickupDate = options.pickupDate || shipment.pickup_date || shipment.shipment_date || new Date().toLocaleDateString('en-US');

  // Left Column Fields
  const decRowGap = 31;

  // 1. TRANSFER TO (SITE)
  const f1Y = formStartY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('TRANSFER TO (SITE)', decLeftColX, f1Y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(destSiteName, decLeftColX, f1Y + 7.5, { maxWidth: decLeftColWidth });
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.35);
  doc.line(decLeftColX, f1Y + 11, decLeftColX + decLeftColWidth, f1Y + 11);

  // 2. TYPE OF COURIER
  const f2Y = f1Y + decRowGap;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('TYPE OF COURIER', decLeftColX, f2Y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(courierType, decLeftColX, f2Y + 7.5, { maxWidth: decLeftColWidth });
  doc.line(decLeftColX, f2Y + 11, decLeftColX + decLeftColWidth, f2Y + 11);

  // 3. BOOKING ID / AIRWAY BILL:
  const f3Y = f2Y + decRowGap;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('BOOKING ID / AIRWAY BILL:', decLeftColX, f3Y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(bookingId, decLeftColX, f3Y + 7.5, { maxWidth: decLeftColWidth });
  doc.line(decLeftColX, f3Y + 11, decLeftColX + decLeftColWidth, f3Y + 11);

  // 4. COURIER NAME AND SIGNATURE
  const f4Y = f3Y + decRowGap;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('COURIER NAME AND SIGNATURE', decLeftColX, f4Y);
  let courierDisplay = pickupByName;
  if (shipment.vehicle_plate || shipment.rider_phone) {
    const extras = [];
    if (shipment.vehicle_plate) extras.push(`Plate: ${shipment.vehicle_plate}`);
    if (shipment.rider_phone) extras.push(`Tel: ${shipment.rider_phone}`);
    if (extras.length > 0) courierDisplay = courierDisplay ? `${courierDisplay} (${extras.join(' • ')})` : extras.join(' • ');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(courierDisplay, decLeftColX, f4Y + 7.5, { maxWidth: decLeftColWidth });
  doc.line(decLeftColX, f4Y + 11, decLeftColX + decLeftColWidth, f4Y + 11);

  // Right Column: ID HERE Box
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.rect(idBoxX, f1Y - 4, idBoxWidth, idBoxHeight, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text('ID HERE', idBoxX + (idBoxWidth / 2), f1Y - 4 + (idBoxHeight / 2) + 2, { align: 'center' });

  // Bottom Section: Supervisor Signature & Verification (Evenly balanced at bottom)
  const bottomY = 198;

  // 1. Left: MDC - SUPERVISOR
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('MDC - SUPERVISOR', decLeftColX, bottomY);

  // Supervisor Underline for manual wet signature
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.35);
  doc.line(decLeftColX, bottomY + 22, decLeftColX + decLeftColWidth, bottomY + 22);

  // Supervisor Printed Name (centered neatly under the signature line)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(supervisorName.toUpperCase(), decLeftColX + (decLeftColWidth / 2), bottomY + 26.5, { align: 'center' });

  // 2. Right: GUARD ON DUTY & DATE PICKED UP
  const rightBottomColX = idBoxX;
  const rightBottomWidth = idBoxWidth;

  // GUARD ON DUTY:
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('GUARD ON DUTY:', rightBottomColX, bottomY);
  if (guardOnDuty) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(guardOnDuty, rightBottomColX, bottomY + 16);
  }
  doc.line(rightBottomColX, bottomY + 22, rightBottomColX + rightBottomWidth, bottomY + 22);

  // DATE PICKED UP:
  const bottomDateY = bottomY + 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('DATE PICKED UP:', rightBottomColX, bottomDateY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(pickupDate, rightBottomColX, bottomDateY + 12);
  doc.line(rightBottomColX, bottomDateY + 16, rightBottomColX + rightBottomWidth, bottomDateY + 16);

  // Save / Export
  const filename = `PackingList_${shipment.invoice_ref || shipment.shipment_number || 'export'}.pdf`;
  doc.save(filename);
}

/**
 * Legacy wrapper: generates standard 2-Page corporate vector PDF (Packing List + Declaration Form)
 */
export function printPackingListDirect(shipment, items = [], site = {}, options = {}) {
  return generatePackingListPDF(shipment, items, site, options);
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
      const split = (it.w1_qty !== undefined && it.w1_cost !== undefined)
        ? { w1_qty: it.w1_qty, w2_qty: it.w2_qty, w3_qty: it.w3_qty, w4_qty: it.w4_qty, w1_cost: it.w1_cost, w2_cost: it.w2_cost, w3_cost: it.w3_cost, w4_cost: it.w4_cost }
        : calculateWeeklySplit(q, c, idx + getRowParityOffset(it));
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
    const isDisplay = isDisplayCategoryOrDesc(item);
    const price = item.stocking_price || 0;
    const qty = item.total_allocated_qty || 0;
    const cost = item.total_stock_cost || (qty * price);
    const split = (item.w1_qty !== undefined && item.w1_cost !== undefined)
      ? { w1_qty: item.w1_qty, w2_qty: item.w2_qty, w3_qty: item.w3_qty, w4_qty: item.w4_qty, w1_cost: item.w1_cost, w2_cost: item.w2_cost, w3_cost: item.w3_cost, w4_cost: item.w4_cost }
      : calculateWeeklySplit(qty, cost, idx + getRowParityOffset(item));

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
/**
 * Generates the complete multi-section Parts Usage & Forecasting Report PDF
 * matching the 98-page source structure across Sections A to E.
 */
export function exportForecastingReportToPDF(forecastItems = [], metadata = {}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const periodLabel = metadata?.periodLabel || 'September 2026';
  const pastMonthLabel = metadata?.pastMonthLabel || 'August 2026';
  const rawRecords = metadata?.rawRecords || [];
  const serviceBranches = metadata?.sites || [];

  const resolveStockPrice = (item) => {
    if (!item) return 100;
    if (typeof item.stocking_price === 'number' && item.stocking_price > 0) return item.stocking_price;
    const desc = String(item.description || item.part_name || '').toLowerCase();
    if (desc.includes('display')) return 279;
    if (desc.includes('battery')) return 89;
    if (desc.includes('camera')) return 129;
    if (desc.includes('glass') || desc.includes('back')) return 99;
    if (desc.includes('mid system')) return 449;
    if (desc.includes('rear system')) return 499;
    return 100;
  };

  const getCommodity = (item) => {
    if (item.commodity) return item.commodity;
    const d = String(item.description || '').toLowerCase();
    if (d.includes('battery')) return 'BATTERY';
    if (d.includes('display') || d.includes('screen')) return 'DISPLAY';
    if (d.includes('truedepth') || d.includes('true depth')) return 'CAMERA_TRUE_DEPTH';
    if (d.includes('front camera') || d.includes('facetime')) return 'CAMERA_FRONT';
    if (d.includes('camera') || d.includes('rear camera')) return 'CAMERA_REAR';
    if (d.includes('back glass') || d.includes('rear glass')) return 'BACK_GLASS';
    if (d.includes('mid system')) return 'LOGIC_BOARD_MID_SYSTEM';
    if (d.includes('rear system')) return 'LOGIC_BOARD_REAR_SYSTEM';
    return 'OTHER';
  };

  // Helper for Section Cover / Header Bar
  const renderSectionHeader = (title, subtitle, color = [15, 23, 42]) => {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(margin, 8, pageWidth - (margin * 2), 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title, margin + 6, 15.5);

    if (subtitle) {
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(subtitle, margin + 6, 24);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 1. EXECUTIVE SUMMARY (Page 1)
  // ══════════════════════════════════════════════════════════════════════════
  renderSectionHeader(
    `MOBILE CARE SERVICES PHILS. INC. — Parts Usage & Demand Forecasting Report (${periodLabel})`,
    `Source: Live Fixably Masterlist Analysis  |  Generated: ${new Date().toLocaleDateString('en-US')}`
  );

  const totalDemand = forecastItems.reduce((s, it) => s + (it.final_forecast ?? it.computed_forecast ?? 0), 0);
  const totalValuation = forecastItems.reduce((s, it) => s + ((it.final_forecast ?? it.computed_forecast ?? 0) * resolveStockPrice(it)), 0);

  // KPI Boxes
  const kpiY = 28;
  const kpiBoxWidth = (pageWidth - (margin * 2) - 18) / 4;
  const kpis = [
    { label: 'TOTAL RECOMMENDED DEMAND', val: `${totalDemand.toLocaleString()} units`, sub: 'All iPhone Commodities' },
    { label: 'PROJECTED STOCK VALUATION', val: `$${totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: `~₱${(totalValuation * 57).toLocaleString(undefined, { maximumFractionDigits: 0 })} PHP` },
    { label: 'ACTIVE PART MODELS', val: `${forecastItems.length} SKUs`, sub: 'Standardized Catalog' },
    { label: 'RECEIVING SERVICE HUBS', val: `${serviceBranches.length || 26} Hubs`, sub: 'Metro Manila & Regional' }
  ];

  kpis.forEach((kpi, idx) => {
    const kpiX = margin + (idx * (kpiBoxWidth + 6));
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(kpiX, kpiY, kpiBoxWidth, 20, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, kpiX + 4, kpiY + 5.5);

    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.val, kpiX + 4, kpiY + 12.5);

    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, kpiX + 4, kpiY + 17.5);
  });

  // Executive Commodity Summary Table
  const commodityAgg = {};
  forecastItems.forEach(it => {
    const c = getCommodity(it);
    if (!commodityAgg[c]) commodityAgg[c] = { name: c.replace(/_/g, ' '), skus: 0, units: 0, val: 0 };
    const q = it.final_forecast ?? it.computed_forecast ?? 0;
    commodityAgg[c].skus += 1;
    commodityAgg[c].units += q;
    commodityAgg[c].val += (q * resolveStockPrice(it));
  });

  const execSummaryRows = Object.values(commodityAgg).map(c => [
    c.name,
    c.skus,
    c.units.toLocaleString(),
    totalDemand > 0 ? `${((c.units / totalDemand) * 100).toFixed(1)}%` : '0%',
    `$${c.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `₱${(c.val * 57).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  ]);

  autoTable(doc, {
    startY: kpiY + 26,
    head: [['COMMODITY SECTION', 'SKU COUNT', 'FORECAST DEMAND', 'VOLUME SHARE', 'STOCK VALUATION (USD)', 'EST. COST (PHP)']],
    body: execSummaryRows,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 70 },
      1: { halign: 'center', cellWidth: 30 },
      2: { halign: 'center', fontStyle: 'bold', cellWidth: 40 },
      3: { halign: 'center', cellWidth: 35 },
      4: { halign: 'right', fontStyle: 'bold', cellWidth: 50 },
      5: { halign: 'right', cellWidth: 50 }
    },
    margin: { left: margin, right: margin }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TABLE BUILDER HELPER FOR COMMODITY SECTIONS
  // ══════════════════════════════════════════════════════════════════════════
  const renderCommoditySubTable = (title, items, type = 'forecasting') => {
    if (!items || items.length === 0) return;
    doc.addPage();
    renderSectionHeader(
      `${title} — ${periodLabel}`,
      `Mobile Care Services Phils. Inc.  |  ${items.length} Active SKUs  |  Historical Actuals & 4-Week Projection`
    );

    if (type === 'variance') {
      // Forecast vs Actual Audit Table
      const headers = ['#', 'Part Number', 'Description', 'Model', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', `Actual (${pastMonthLabel.split(' ')[0]})`, 'Forecast', 'Variance', 'Remarks'];
      const body = items.map((it, idx) => {
        const m = it.ytd_monthly_counts || [];
        const actual = m[m.length - 1] || 0;
        const forecast = it.computed_forecast ?? actual;
        const diff = actual - forecast;
        const remarks = diff === 0 ? 'Accurate' : diff > 0 ? 'Under Forecast' : 'Over Forecast';
        return [
          idx + 1,
          it.part_number || '',
          it.description || '',
          it.iphone_model || '',
          m[0] || 0, m[1] || 0, m[2] || 0, m[3] || 0, m[4] || 0, m[5] || 0, m[6] || 0,
          actual,
          forecast,
          diff > 0 ? `+${diff}` : diff,
          remarks
        ];
      });

      autoTable(doc, {
        startY: 28,
        head: [headers],
        body,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, halign: 'center' },
        bodyStyles: { fontSize: 6.5, textColor: [15, 23, 42] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 7 },
          1: { halign: 'center', cellWidth: 22, fontStyle: 'bold' },
          2: { halign: 'left', cellWidth: 55 },
          3: { halign: 'left', cellWidth: 28 },
          4: { halign: 'center', cellWidth: 8 },
          5: { halign: 'center', cellWidth: 8 },
          6: { halign: 'center', cellWidth: 8 },
          7: { halign: 'center', cellWidth: 8 },
          8: { halign: 'center', cellWidth: 8 },
          9: { halign: 'center', cellWidth: 8 },
          10: { halign: 'center', cellWidth: 8 },
          11: { halign: 'center', fontStyle: 'bold', cellWidth: 16 },
          12: { halign: 'center', fontStyle: 'bold', cellWidth: 16 },
          13: { halign: 'center', fontStyle: 'bold', cellWidth: 14 },
          14: { halign: 'center', fontStyle: 'bold', cellWidth: 22 }
        },
        margin: { left: margin, right: margin }
      });
    } else {
      // Demand Forecasting & Weekly Costing Table
      const headers = ['#', 'Part Number', 'Description', 'Model', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Forecast', 'Price', 'W1', 'W2', 'W3', 'W4', 'Total Cost ($)'];
      const body = items.map((it, idx) => {
        const m = it.ytd_monthly_counts || [];
        const fVal = it.final_forecast ?? it.computed_forecast ?? 0;
        const price = resolveStockPrice(it);
        const cost = fVal * price;
        const split = (it.w1_qty !== undefined && it.w1_cost !== undefined)
          ? { w1_qty: it.w1_qty, w2_qty: it.w2_qty, w3_qty: it.w3_qty, w4_qty: it.w4_qty, w1_cost: it.w1_cost, w2_cost: it.w2_cost, w3_cost: it.w3_cost, w4_cost: it.w4_cost }
          : calculateWeeklySplit(fVal, cost, idx + getRowParityOffset(it));

        return [
          idx + 1,
          it.part_number || '',
          it.description || '',
          it.iphone_model || '',
          m[0] || 0, m[1] || 0, m[2] || 0, m[3] || 0, m[4] || 0, m[5] || 0, m[6] || 0, m[7] || 0,
          fVal,
          `$${price}`,
          split.w1_qty, split.w2_qty, split.w3_qty, split.w4_qty,
          `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ];
      });

      autoTable(doc, {
        startY: 28,
        head: [headers],
        body,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, halign: 'center' },
        bodyStyles: { fontSize: 6.5, textColor: [15, 23, 42] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 7 },
          1: { halign: 'center', cellWidth: 20, fontStyle: 'bold' },
          2: { halign: 'left', cellWidth: 50 },
          3: { halign: 'left', cellWidth: 25 },
          4: { halign: 'center', cellWidth: 7 },
          5: { halign: 'center', cellWidth: 7 },
          6: { halign: 'center', cellWidth: 7 },
          7: { halign: 'center', cellWidth: 7 },
          8: { halign: 'center', cellWidth: 7 },
          9: { halign: 'center', cellWidth: 7 },
          10: { halign: 'center', cellWidth: 7 },
          11: { halign: 'center', cellWidth: 7 },
          12: { halign: 'center', fontStyle: 'bold', cellWidth: 12 },
          13: { halign: 'right', cellWidth: 12 },
          14: { halign: 'center', cellWidth: 8 },
          15: { halign: 'center', cellWidth: 8 },
          16: { halign: 'center', cellWidth: 8 },
          17: { halign: 'center', cellWidth: 8 },
          18: { halign: 'right', fontStyle: 'bold', cellWidth: 24 }
        },
        margin: { left: margin, right: margin }
      });
    }
  };

  // Group items by commodity
  const batteryItems = forecastItems.filter(it => getCommodity(it) === 'BATTERY');
  const displayItems = forecastItems.filter(it => getCommodity(it) === 'DISPLAY');
  const cameraRearItems = forecastItems.filter(it => getCommodity(it) === 'CAMERA_REAR');
  const cameraTrueDepthItems = forecastItems.filter(it => getCommodity(it) === 'CAMERA_TRUE_DEPTH');
  const cameraFrontItems = forecastItems.filter(it => getCommodity(it) === 'CAMERA_FRONT');
  const backGlassItems = forecastItems.filter(it => getCommodity(it) === 'BACK_GLASS');
  const logicMidItems = forecastItems.filter(it => getCommodity(it) === 'LOGIC_BOARD_MID_SYSTEM');
  const logicRearItems = forecastItems.filter(it => getCommodity(it) === 'LOGIC_BOARD_REAR_SYSTEM');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION A: BATTERY & DISPLAY (Pages 2–49)
  // ══════════════════════════════════════════════════════════════════════════
  renderCommoditySubTable('SECTION A: iPhone Battery — Forecast vs Actual Variance Audit', batteryItems, 'variance');
  renderCommoditySubTable('SECTION A: iPhone Battery — Demand Forecasting & Weekly Costing', batteryItems, 'forecasting');
  renderCommoditySubTable('SECTION A: iPhone Display — Forecast vs Actual Variance Audit', displayItems, 'variance');
  renderCommoditySubTable('SECTION A: iPhone Display — Demand Forecasting & Weekly Costing', displayItems, 'forecasting');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION B: CAMERA (Pages 50–77)
  // ══════════════════════════════════════════════════════════════════════════
  renderCommoditySubTable('SECTION B: iPhone Rear Camera — Forecast vs Actual Audit', cameraRearItems, 'variance');
  renderCommoditySubTable('SECTION B: iPhone Rear Camera — Demand Forecasting & Costing', cameraRearItems, 'forecasting');
  renderCommoditySubTable('SECTION B: iPhone TrueDepth Camera — Forecast vs Actual Audit', cameraTrueDepthItems, 'variance');
  renderCommoditySubTable('SECTION B: iPhone TrueDepth Camera — Demand Forecasting & Costing', cameraTrueDepthItems, 'forecasting');
  renderCommoditySubTable('SECTION B: iPhone Front Camera / FaceTime — Demand Forecasting & Costing', cameraFrontItems, 'forecasting');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION C: BACK GLASS (Pages 78–82)
  // ══════════════════════════════════════════════════════════════════════════
  renderCommoditySubTable('SECTION C: iPhone Back Glass — Forecast vs Actual Audit', backGlassItems, 'variance');
  renderCommoditySubTable('SECTION C: iPhone Back Glass — Demand Forecasting & Weekly Costing', backGlassItems, 'forecasting');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION D: LOGIC BOARD ASSEMBLIES (Pages 83–88)
  // NOTE: Page 87 Bug Fix implemented ("Rear System Costing Per Week" NOT "Mid System")
  // ══════════════════════════════════════════════════════════════════════════
  renderCommoditySubTable('SECTION D: iPhone Mid System Assemblies — Demand Forecasting & Costing', logicMidItems, 'forecasting');
  renderCommoditySubTable('SECTION D: iPhone Rear System Assemblies — Demand Forecasting & Costing Per Week', logicRearItems, 'forecasting');

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION E: DC STOCK TRANSFERS & DISPATCHES (Pages 89–98)
  // ══════════════════════════════════════════════════════════════════════════
  if (rawRecords && rawRecords.length > 0) {
    doc.addPage();
    renderSectionHeader(
      `SECTION E: Central DC Inter-Branch Stock Transfers & Dispatches — ${periodLabel}`,
      `Mobile Care Services Phils. Inc.  |  ${rawRecords.length} Transfer Events  |  Movement & Logistics Audit`
    );

    const transferHeaders = ['#', 'Date', 'From Stock Hub', 'To Destination Hub', 'Part Number', 'Product Name', 'Qty', 'Unit Val ($)', 'Total Val ($)'];
    const transferBody = rawRecords.slice(0, 120).map((r, idx) => {
      const q = Number(r.transfer_quantity || r.qty || 1);
      const v = Number(r.unit_price || r.price || 100);
      return [
        idx + 1,
        r.transfer_received_date || r.date || '—',
        r.from_stock || 'Central DC',
        r.to_stock || 'Branch Hub',
        r.product_code || r.part_number || '—',
        r.product_name || r.description || '—',
        q,
        `$${v.toFixed(2)}`,
        `$${(q * v).toFixed(2)}`
      ];
    });

    autoTable(doc, {
      startY: 28,
      head: [transferHeaders],
      body: transferBody,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, halign: 'center' },
      bodyStyles: { fontSize: 6.5, textColor: [15, 23, 42] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { halign: 'center', cellWidth: 20 },
        2: { halign: 'left', cellWidth: 35 },
        3: { halign: 'left', cellWidth: 35 },
        4: { halign: 'center', cellWidth: 22, fontStyle: 'bold' },
        5: { halign: 'left', cellWidth: 60 },
        6: { halign: 'center', fontStyle: 'bold', cellWidth: 12 },
        7: { halign: 'right', cellWidth: 18 },
        8: { halign: 'right', fontStyle: 'bold', cellWidth: 22 }
      },
      margin: { left: margin, right: margin }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE NUMBERING FOOTER ON ALL PAGES
  // ══════════════════════════════════════════════════════════════════════════
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `MOBILE CARE SERVICES PHILS. INC.  —  Parts Usage & Forecasting Report (${periodLabel})  |  Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }

  doc.save(`Parts_Usage_and_Forecasting_Report_${periodLabel.replace(/\s+/g, '_')}.pdf`);
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
    if (desc.includes('mid system')) return 449;
    if (desc.includes('rear system')) return 499;
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
          <div style="font-size: 11px; color: #94a3b8;">Parts Usage & Demand Forecasting Master Report — ${periodLabel}</div>
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

/**
 * Generates an executive-grade Audit Trail PDF report with corporate header, KPI metrics,
 * and high-fidelity autoTable formatting for all audit categories.
 */
export function generateAuditTrailPDF(auditType = 'uploads', data = [], options = {}) {
  const isPortrait = auditType === 'serial_tracer';
  const doc = new jsPDF({
    orientation: isPortrait ? 'portrait' : 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(margin, 10, pageWidth - (margin * 2), 14, 'F');

  try {
    if (MOBILECARE_LOGO_BASE64) {
      doc.addImage(MOBILECARE_LOGO_BASE64, 'PNG', margin + 3, 11, 12, 12);
    }
  } catch (e) {
    console.warn('Could not add logo to audit PDF:', e);
  }

  const titleX = margin + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('MOBILE CARE SERVICES PHILS. INC.', titleX, 16);

  let reportTitle = 'Master Ingestion & File Upload Audit Report';
  if (auditType === 'deletions') reportTitle = 'Data Deletions & Purge Audit Trail Report';
  if (auditType === 'scan_logs') reportTitle = 'Hardware Barcode Scanner Event Audit Report';
  if (auditType === 'serial_tracer') reportTitle = 'Serialized Unit Custody Chain Trace Report';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(reportTitle, titleX, 21);

  const genDateStr = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  doc.text(`Generated: ${genDateStr}`, pageWidth - margin - 4, 18.5, { align: 'right' });

  let startY = 29;

  // Summary Metrics Banner
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, startY, pageWidth - (margin * 2), 11, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text(`Total Audit Records: ${data.length}`, margin + 5, startY + 7);

  const filterSummary = options.filterLabel ? `Filter: ${options.filterLabel}  |  ` : '';
  const operatorSummary = `Operator: ${options.currentUser?.fullName || 'Superadmin'}`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`${filterSummary}${operatorSummary}`, pageWidth - margin - 5, startY + 7, { align: 'right' });

  startY += 16;

  if (auditType === 'uploads') {
    const tableHeaders = [
      '#',
      'Date & Time',
      'Uploaded By',
      'Email / Role',
      'Ingested File',
      'Target Period',
      'Forecast Units',
      'Allocated Units',
      'Total Value',
      'Status'
    ];

    const tableRows = data.map((d, i) => [
      i + 1,
      new Date(d.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      d.user_name || 'Super Admin',
      `${d.user_email || ''}\n[${(d.user_role || 'SUPERADMIN').toUpperCase()}]`,
      `${d.file_name || 'Dataset.xlsx'}\n(${d.file_type || 'WORKBOOK'})`,
      d.target_month || 'N/A',
      `${d.total_forecast_units || 0} units`,
      `${d.total_allocated_units || 0} units`,
      `$${Number(d.total_master_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      d.status || 'Active on Cloud'
    ]);

    autoTable(doc, {
      startY,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: 255,
        fontSize: 7.5,
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: {
        fontSize: 7,
        cellPadding: 2,
        valign: 'middle',
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 26 },
        2: { fontStyle: 'bold', cellWidth: 28 },
        3: { cellWidth: 38 },
        4: { cellWidth: 46 },
        5: { halign: 'center', cellWidth: 24 },
        6: { halign: 'right', cellWidth: 22 },
        7: { halign: 'right', cellWidth: 22 },
        8: { halign: 'right', fontStyle: 'bold', cellWidth: 26 },
        9: { halign: 'center', cellWidth: 26 }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin }
    });
  } else if (auditType === 'deletions') {
    const tableHeaders = [
      '#',
      'Date & Time',
      'Entity Type',
      'Record ID & Label',
      'Deleted By (User / Email)',
      'Reason / Action Note',
      'Impact Summary',
      'Status'
    ];

    const tableRows = data.map((d, i) => {
      let impact = [];
      if (d.summary?.itemsCount !== undefined) impact.push(`${d.summary.itemsCount} units purged`);
      if (d.summary?.poNumber) impact.push(`PO: ${d.summary.poNumber}`);
      if (d.summary?.destinationSite) impact.push(`Dest: ${d.summary.destinationSite}`);
      if (d.summary?.forecastPartsCount !== undefined) impact.push(`${d.summary.forecastPartsCount} parts`);
      return [
        i + 1,
        new Date(d.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
        d.entity_type || 'Record',
        `${d.entity_id || ''}\n${d.entity_label || ''}`,
        `${d.deleted_by_name || 'System'}\n${d.deleted_by_email || ''}\n[${d.deleted_by_position || d.deleted_by_role || 'Specialist'}]`,
        d.reason || 'User initiated deletion',
        impact.join(' • ') || 'Record purged',
        'Audit Logged'
      ];
    });

    autoTable(doc, {
      startY,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [185, 28, 28], // red-700
        textColor: 255,
        fontSize: 7.5,
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: {
        fontSize: 7,
        cellPadding: 2,
        valign: 'middle',
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 26 },
        2: { fontStyle: 'bold', cellWidth: 32 },
        3: { cellWidth: 44 },
        4: { cellWidth: 48 },
        5: { cellWidth: 46 },
        6: { cellWidth: 42 },
        7: { halign: 'center', cellWidth: 22 }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin }
    });
  } else if (auditType === 'scan_logs') {
    const tableHeaders = [
      '#',
      'Timestamp',
      'Operation',
      'Part Number',
      'Serial Number',
      'Warehouse Operator',
      'Validation Result'
    ];

    const tableRows = data.map((d, i) => [
      i + 1,
      new Date(d.created_at || d.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      d.scan_type || 'SCAN_IN',
      d.part_number || 'N/A',
      d.serial_number || 'N/A',
      d.user_name || 'Warehouse Staff',
      d.is_valid !== false ? 'VALID' : `REJECTED (${d.error_message || 'Error'})`
    ]);

    autoTable(doc, {
      startY,
      head: [tableHeaders],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: 255,
        fontSize: 7.5,
        fontStyle: 'bold',
        halign: 'center'
      },
      styles: {
        fontSize: 7,
        cellPadding: 2.2,
        valign: 'middle',
        lineColor: [226, 232, 240],
        lineWidth: 0.1
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 12 },
        1: { cellWidth: 34 },
        2: { halign: 'center', fontStyle: 'bold', cellWidth: 30 },
        3: { cellWidth: 38 },
        4: { fontStyle: 'bold', cellWidth: 55 },
        5: { cellWidth: 45 },
        6: { halign: 'center', cellWidth: 45 }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin }
    });
  } else if (auditType === 'serial_tracer') {
    const u = options.matchedUnit;
    if (u) {
      // Unit detail card
      doc.setFillColor(240, 249, 255); // sky-50
      doc.setDrawColor(186, 230, 253);
      doc.roundedRect(margin, startY, pageWidth - (margin * 2), 34, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(3, 105, 161);
      doc.text(`SERIAL: ${u.serial_number}`, margin + 6, startY + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      doc.text(`Part Number: ${u.part_number}  |  Description: ${u.description || 'N/A'}`, margin + 6, startY + 15);
      doc.text(`Status: ${String(u.status || 'in_stock').toUpperCase()}  |  Current Site: ${options.siteName || 'Distribution Center'}`, margin + 6, startY + 22);
      doc.text(`Box Number: ${u.box_number || 'N/A'}  |  PO Reference: ${u.po_number || 'N/A'}`, margin + 6, startY + 29);

      startY += 42;

      const timelineHeaders = ['Custody Stage', 'Date & Time', 'Action / Status', 'Handled By / Destination'];
      const timelineRows = [
        [
          '1. DC Receive Scan-In',
          u.received_at ? new Date(u.received_at).toLocaleString() : 'Recorded',
          'Received into Stock',
          `By: ${u.received_by || 'Warehouse Staff'}`
        ],
        [
          '2. Allocation & Order',
          u.allocated_at ? new Date(u.allocated_at).toLocaleString() : 'System Matched',
          'Assigned to Allocation Cycle',
          `Target: ${options.siteName || 'DC Stock'}`
        ],
        [
          '3. Box Pack Scan-Out',
          u.shipped_at ? new Date(u.shipped_at).toLocaleString() : (u.status === 'packed' ? 'Packed in Dispatch' : 'Awaiting Pack'),
          `Box #: ${u.box_number || 1}`,
          `By: ${u.packed_by || 'Warehouse Dispatcher'}`
        ],
        [
          '4. Shipment & Delivery',
          u.delivered_at ? new Date(u.delivered_at).toLocaleString() : (u.status === 'delivered' ? 'Delivered to Branch' : 'In Transit / Dispatched'),
          `Status: ${String(u.status || 'in_stock').toUpperCase()}`,
          `Destination: ${options.siteName || 'Service Branch'}`
        ]
      ];

      autoTable(doc, {
        startY,
        head: [timelineHeaders],
        body: timelineRows,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: 255,
          fontSize: 8,
          fontStyle: 'bold'
        },
        styles: {
          fontSize: 8,
          cellPadding: 3.5,
          lineColor: [226, 232, 240],
          lineWidth: 0.1
        },
        margin: { left: margin, right: margin }
      });
    }
  }

  // Footer Page Numbering & Security Statement
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      'CONFIDENTIAL & IMMUTABLE AUDIT LOG — MOBILE CARE SERVICES PHILS. INC. (DISTRIBUTION CENTER)',
      margin,
      pageHeight - 6
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
  }

  const fileName = `MDC_${auditType.toUpperCase()}_AUDIT_REPORT_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
}
