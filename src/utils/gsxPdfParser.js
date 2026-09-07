/**
 * GSX PDF & Purchase Order Parser
 * Zero-dependency client-side & Node compatible parser for Apple GSX / SAP Tax Invoices.
 * 
 * Supports:
 * - Direct stream token decoding (hex <...> Tj and standard (...) Tj)
 * - Positional y/x sorting for exact line reconstruction
 * - Structured table cell extraction for multi-column headers and values
 * - Line item extraction: Apple Part Number (661-xxxxx), Description, Quantity Ordered, Quantity Shipped, Unit Price, Extended Price
 */

/**
 * Extracts raw visual lines from PDF binary content.
 * Compatible with modern browsers (ArrayBuffer / Uint8Array / String) and Node.js.
 */
export async function extractPdfVisualLines(pdfInput) {
  let rawStr = '';

  if (typeof pdfInput === 'string') {
    rawStr = pdfInput;
  } else if (pdfInput instanceof ArrayBuffer) {
    const bytes = new Uint8Array(pdfInput);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    rawStr = binary;
  } else if (pdfInput && typeof pdfInput.length === 'number') {
    // Uint8Array or Buffer
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < pdfInput.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, pdfInput.subarray ? pdfInput.subarray(i, i + chunkSize) : pdfInput.slice(i, i + chunkSize));
    }
    rawStr = binary;
  }

  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match;
  const allLines = [];

  while ((match = streamRegex.exec(rawStr)) !== null) {
    const streamData = match[1];
    let decoded = '';

    // Check if stream is zlib compressed (starts with 0x78 0x9c or similar)
    const isZlib = streamData.length > 2 && streamData.charCodeAt(0) === 0x78;

    if (isZlib) {
      try {
        if (typeof window === 'undefined') {
          // Node.js environment
          const zlib = await import('zlib');
          const buf = Buffer.from(streamData, 'latin1');
          decoded = zlib.inflateSync(buf).toString('latin1');
        } else if (typeof DecompressionStream !== 'undefined') {
          // Browser environment with DecompressionStream
          const bytes = new Uint8Array(streamData.length);
          for (let i = 0; i < streamData.length; i++) {
            bytes[i] = streamData.charCodeAt(i);
          }
          const ds = new DecompressionStream('deflate');
          const writer = ds.writable.getWriter();
          writer.write(bytes);
          writer.close();
          const response = new Response(ds.readable);
          const decompressedBuf = await response.arrayBuffer();
          const dBytes = new Uint8Array(decompressedBuf);
          let dStr = '';
          for (let i = 0; i < dBytes.length; i += 8192) {
            dStr += String.fromCharCode.apply(null, dBytes.subarray(i, i + 8192));
          }
          decoded = dStr;
        } else {
          decoded = streamData;
        }
      } catch {
        decoded = streamData;
      }
    } else {
      decoded = streamData;
    }

    // Extract positioned text tokens: handles <hex> Tj and (ascii) Tj with preceding Td
    const opRegex = /([0-9.-]+)\s+([0-9.-]+)\s+Td[\s\S]*?(?:<([0-9A-Fa-f\s]+)>|\(([\s\S]*?)\))\s*Tj/g;
    let opMatch;
    const positionedTokens = [];

    while ((opMatch = opRegex.exec(decoded)) !== null) {
      const x = parseFloat(opMatch[1]);
      const y = parseFloat(opMatch[2]);
      let txt = '';

      if (opMatch[3] !== undefined) {
        // Hex encoded string
        const hexClean = opMatch[3].replace(/\s+/g, '');
        let decodedAscii = '';
        for (let i = 0; i < hexClean.length; i += 2) {
          decodedAscii += String.fromCharCode(parseInt(hexClean.substr(i, 2), 16));
        }
        txt = decodedAscii;
      } else if (opMatch[4] !== undefined) {
        // Plain text string in parentheses
        txt = opMatch[4];
      }

      const clean = txt.trim();
      if (clean) {
        positionedTokens.push({ x, y, text: clean });
      }
    }

    // Sort by y descending (top of page first, within 3pt threshold), then x ascending (left to right)
    positionedTokens.sort((a, b) => {
      if (Math.abs(b.y - a.y) > 3) {
        return b.y - a.y;
      }
      return a.x - b.x;
    });

    // Group into visual lines
    let currentY = null;
    let currentLine = [];
    for (const token of positionedTokens) {
      if (currentY === null || Math.abs(currentY - token.y) > 3) {
        if (currentLine.length > 0) {
          allLines.push(currentLine);
        }
        currentY = token.y;
        currentLine = [token];
      } else {
        currentLine.push(token);
      }
    }
    if (currentLine.length > 0) {
      allLines.push(currentLine);
    }
  }

  return allLines;
}

/**
 * Finds the token in candidateTokens whose x position is closest to targetX.
 */
function findClosestTokenByX(targetX, candidateTokens) {
  if (!candidateTokens || candidateTokens.length === 0) return null;
  let best = candidateTokens[0];
  let minDiff = Math.abs(candidateTokens[0].x - targetX);
  for (let i = 1; i < candidateTokens.length; i++) {
    const diff = Math.abs(candidateTokens[i].x - targetX);
    if (diff < minDiff) {
      minDiff = diff;
      best = candidateTokens[i];
    }
  }
  return best;
}

/**
 * Parses Apple GSX Tax Invoice / PO PDF into structured Purchase Order data.
 * @param {ArrayBuffer|Uint8Array|string} pdfInput 
 * @param {string} filename 
 * @returns {Promise<Object>}
 */
export async function parseGsxInvoicePdf(pdfInput, filename = 'GSX_Invoice.pdf') {
  const visualLines = await extractPdfVisualLines(pdfInput);

  if (!visualLines || visualLines.length === 0) {
    throw new Error('Unable to extract text from PDF. The document may be empty or encrypted.');
  }

  // 1. Extract Header Information
  let poNumber = '';
  let invoiceRef = '';
  let salesOrderNo = '';
  let customerNo = '';
  let documentDate = '';
  let shipDate = '';
  let webOrderNo = '';
  let totalAmount = 0;
  let currency = 'USD';
  let supplier = 'Apple South Asia Pte Ltd';

  // Check visual line rows for supplier
  for (const line of visualLines) {
    const texts = line.map(t => t.text);
    const supp = texts.find(t => /Apple\s+South\s+Asia/i.test(t));
    if (supp) {
      supplier = 'Apple South Asia Pte Ltd';
      break;
    }
  }

  // Table header matching across rows
  for (let i = 0; i < visualLines.length; i++) {
    const line = visualLines[i];
    const nextLine = i + 1 < visualLines.length ? visualLines[i + 1] : null;

    // Check for Reference No, Document Date, Page No
    const refIdx = line.findIndex(t => /REFERENCE\s*NO/i.test(t.text));
    if (refIdx !== -1 && nextLine) {
      const refToken = line[refIdx];
      const matchToken = findClosestTokenByX(refToken.x, nextLine);
      if (matchToken && !invoiceRef) {
        invoiceRef = matchToken.text;
      }
    }

    const docDateIdx = line.findIndex(t => /DOCUMENT\s*DATE/i.test(t.text));
    if (docDateIdx !== -1 && nextLine) {
      const dateToken = line[docDateIdx];
      const matchToken = findClosestTokenByX(dateToken.x, nextLine);
      if (matchToken && !documentDate) {
        documentDate = matchToken.text;
      }
    }

    // Check for Customer No, Sales Order No, Customer P.O. No, Terms
    const poIdx = line.findIndex(t => /CUSTOMER\s*P\.?O\.?\s*NO/i.test(t.text) || /P\.?O\.?\s*NO/i.test(t.text));
    if (poIdx !== -1 && nextLine) {
      const poToken = line[poIdx];
      const matchToken = findClosestTokenByX(poToken.x, nextLine);
      if (matchToken && !poNumber) {
        poNumber = matchToken.text;
      }
    }

    const soIdx = line.findIndex(t => /SALES\s*ORDER\s*NO/i.test(t.text));
    if (soIdx !== -1 && nextLine) {
      const soToken = line[soIdx];
      const matchToken = findClosestTokenByX(soToken.x, nextLine);
      if (matchToken && !salesOrderNo) {
        salesOrderNo = matchToken.text;
      }
    }

    const custIdx = line.findIndex(t => /CUSTOMER\s*NO/i.test(t.text));
    if (custIdx !== -1 && nextLine) {
      const custToken = line[custIdx];
      const matchToken = findClosestTokenByX(custToken.x, nextLine);
      if (matchToken && !customerNo) {
        customerNo = matchToken.text;
      }
    }

    // Check for Ship Date
    const shipDateIdx = line.findIndex(t => /SHIP\s*DATE/i.test(t.text));
    if (shipDateIdx !== -1 && nextLine) {
      const shipToken = line[shipDateIdx];
      const matchToken = findClosestTokenByX(shipToken.x, nextLine);
      if (matchToken && !shipDate) {
        shipDate = matchToken.text;
      }
    }

    // Check for Web Order Number
    const webOrderToken = line.find(t => /Web\s*Order\s*Number\s*:\s*([A-Z0-9]+)/i.test(t.text));
    if (webOrderToken) {
      const match = webOrderToken.text.match(/Web\s*Order\s*Number\s*:\s*([A-Z0-9]+)/i);
      if (match) webOrderNo = match[1];
    }

    // Check for Total and Currency
    const totalIdx = line.findIndex(t => t.text.trim().toUpperCase() === 'TOTAL');
    if (totalIdx !== -1) {
      for (let k = totalIdx + 1; k < line.length; k++) {
        const txt = line[k].text.trim();
        if (/^[A-Z]{3}$/.test(txt)) {
          currency = txt;
        } else if (/^[0-9,.]+$/.test(txt)) {
          totalAmount = parseFloat(txt.replace(/,/g, '')) || totalAmount;
        }
      }
    }
  }

  // 2. Extract Line Items (Apple Genuine Parts: 661-xxxxx)
  const items = [];
  const partNumberRegex = /^(661-\d{5})$/i;

  for (const lineTokens of visualLines) {
    const texts = lineTokens.map(t => t.text);
    const pnIndex = texts.findIndex(t => partNumberRegex.test(t));

    if (pnIndex !== -1) {
      const partNumber = texts[pnIndex].toUpperCase();
      let description = '';
      let qtyOrdered = 0;
      let qtyShipped = 0;
      let unitPrice = 0;
      let extendedPrice = 0;

      // Description is located right after part number (e.g. SVC,BATTERY,...)
      if (pnIndex + 1 < texts.length && isNaN(parseFloat(texts[pnIndex + 1]))) {
        description = texts[pnIndex + 1];
      }

      // Collect numeric tokens after part number
      const numericTokens = [];
      for (let j = pnIndex + 1; j < texts.length; j++) {
        const val = texts[j].replace(/,/g, '');
        if (!isNaN(parseFloat(val)) && /^-?\d+(\.\d+)?$/.test(val)) {
          numericTokens.push(parseFloat(val));
        }
      }

      if (numericTokens.length >= 4) {
        // [qtyOrdered, qtyShipped, unitPrice, extendedPrice]
        qtyOrdered = Math.round(numericTokens[0]);
        qtyShipped = Math.round(numericTokens[1]);
        unitPrice = numericTokens[2];
        extendedPrice = numericTokens[3];
      } else if (numericTokens.length === 3) {
        // [qtyOrdered, unitPrice, extendedPrice]
        qtyOrdered = Math.round(numericTokens[0]);
        qtyShipped = qtyOrdered;
        unitPrice = numericTokens[1];
        extendedPrice = numericTokens[2];
      } else if (numericTokens.length === 2) {
        // [qty, unitPrice]
        qtyOrdered = Math.round(numericTokens[0]);
        qtyShipped = qtyOrdered;
        unitPrice = numericTokens[1];
        extendedPrice = qtyOrdered * unitPrice;
      } else if (numericTokens.length === 1) {
        qtyOrdered = Math.round(numericTokens[0]);
        qtyShipped = qtyOrdered;
      }

      items.push({
        id: `po-item-${partNumber}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        part_number: partNumber,
        description: description || `Apple Genuine Part ${partNumber}`,
        quantity_ordered: qtyOrdered || 1,
        quantity_shipped: qtyShipped || qtyOrdered || 1,
        quantity_received: 0,
        unit_price: unitPrice || 0,
        extended_price: extendedPrice || (qtyOrdered * (unitPrice || 0))
      });
    }
  }

  // Fallback defaults if fields not detected
  if (!poNumber) {
    poNumber = invoiceRef ? `PO-${invoiceRef}` : `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  }
  if (!documentDate) {
    documentDate = new Date().toISOString().split('T')[0];
  }

  const calculatedTotal = items.reduce((sum, it) => sum + (it.quantity_ordered * (it.unit_price || 0)), 0);

  return {
    po_number: poNumber,
    invoice_ref: invoiceRef,
    sales_order_no: salesOrderNo,
    customer_no: customerNo,
    supplier: supplier,
    order_date: documentDate,
    expected_date: shipDate || documentDate,
    currency: currency,
    total_amount: totalAmount > 0 ? totalAmount : calculatedTotal,
    remarks: webOrderNo ? `GSX Invoice ${invoiceRef || ''} / Web Order ${webOrderNo}` : `GSX Invoice ${invoiceRef || ''}`,
    status: 'pending', // 'pending' | 'partially_received' | 'received'
    source_filename: filename,
    items: items
  };
}

/**
 * Fallback parser for Purchase Orders uploaded as Excel (.xlsx/.xls) or CSV.
 * @param {ArrayBuffer|Uint8Array} fileData 
 * @param {string} filename 
 * @returns {Promise<Object>}
 */
export async function parseGsxExcelOrCsv(fileData, filename = 'Purchase_Order.xlsx') {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(fileData, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rows || rows.length === 0) {
    throw new Error('The uploaded spreadsheet is empty.');
  }

  let poNumber = '';
  let invoiceRef = '';
  let salesOrderNo = '';
  let supplier = 'Apple South Asia Pte Ltd';
  let orderDate = new Date().toISOString().split('T')[0];
  let expectedDate = orderDate;
  let currency = 'USD';
  const items = [];

  // Look for header metadata
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r].map(c => String(c).trim());
    const rowStr = row.join(' ');

    const poMatch = rowStr.match(/(?:P\.?O\.?\s*(?:NO|NUMBER)|PURCHASE\s*ORDER)[\s:]*([A-Z0-9_-]+)/i);
    if (poMatch && !poNumber) poNumber = poMatch[1];

    const refMatch = rowStr.match(/(?:REFERENCE|INVOICE)[\s:]*([A-Z0-9_-]+)/i);
    if (refMatch && !invoiceRef) invoiceRef = refMatch[1];

    const soMatch = rowStr.match(/SALES\s*ORDER[\s:]*([A-Z0-9_-]+)/i);
    if (soMatch && !salesOrderNo) salesOrderNo = soMatch[1];
  }

  // Find line items header row
  let headerRowIdx = -1;
  let pnCol = -1;
  let descCol = -1;
  let qtyCol = -1;
  let priceCol = -1;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r].map(c => String(c).trim().toUpperCase());
    const pIdx = row.findIndex(c => c.includes('PART') || c.includes('ITEM NO') || c.includes('SKU'));
    const qIdx = row.findIndex(c => c.includes('QTY') || c.includes('QUANTITY') || c.includes('ORDERED'));
    if (pIdx !== -1 && qIdx !== -1) {
      headerRowIdx = r;
      pnCol = pIdx;
      qtyCol = qIdx;
      descCol = row.findIndex(c => c.includes('DESC') || c.includes('NAME') || c.includes('PRODUCT'));
      priceCol = row.findIndex(c => c.includes('PRICE') || c.includes('COST') || c.includes('UNIT'));
      break;
    }
  }

  const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    let partNumber = pnCol !== -1 ? String(row[pnCol] || '').trim().toUpperCase() : '';
    let description = descCol !== -1 ? String(row[descCol] || '').trim() : '';
    let qty = qtyCol !== -1 ? parseInt(String(row[qtyCol] || '0').replace(/,/g, ''), 10) : 0;
    let price = priceCol !== -1 ? parseFloat(String(row[priceCol] || '0').replace(/,/g, '')) : 0;

    // If no designated columns, scan cells for Apple part number (661-xxxxx)
    if (!partNumber) {
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toUpperCase();
        if (/^661-\d{5}$/i.test(val)) {
          partNumber = val;
          if (c + 1 < row.length && isNaN(parseFloat(row[c + 1]))) {
            description = String(row[c + 1]).trim();
          }
          break;
        }
      }
    }

    if (partNumber && /^661-\d{5}$/i.test(partNumber)) {
      if (!qty || isNaN(qty) || qty <= 0) qty = 1;
      items.push({
        id: `po-item-${partNumber}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        part_number: partNumber,
        description: description || `Apple Genuine Part ${partNumber}`,
        quantity_ordered: qty,
        quantity_shipped: qty,
        quantity_received: 0,
        unit_price: price || 0,
        extended_price: qty * (price || 0)
      });
    }
  }

  if (!poNumber) {
    poNumber = invoiceRef ? `PO-${invoiceRef}` : `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  }

  const calculatedTotal = items.reduce((sum, it) => sum + (it.quantity_ordered * (it.unit_price || 0)), 0);

  return {
    po_number: poNumber,
    invoice_ref: invoiceRef,
    sales_order_no: salesOrderNo,
    supplier: supplier,
    order_date: orderDate,
    expected_date: expectedDate,
    currency: currency,
    total_amount: calculatedTotal,
    remarks: `Imported from ${filename}`,
    status: 'pending',
    source_filename: filename,
    items: items
  };
}

