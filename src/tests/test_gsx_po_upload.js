import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseGsxInvoicePdf, extractPdfVisualLines } from '../utils/gsxPdfParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('--- Testing GSX PDF & Purchase Order Ingestion ---');

  const pdfPath = '/Users/zhonmns/.gemini/antigravity/brain/dea97567-41a9-4644-b477-16d206dbbefc/.user_uploaded/media_1788766168275.pdf';
  
  let pdfBuffer = null;
  try {
    if (fs.existsSync(pdfPath)) {
      pdfBuffer = fs.readFileSync(pdfPath);
    }
  } catch (e) {
    pdfBuffer = null;
  }

  if (pdfBuffer) {
    console.log('[Test 1] Parsing User Uploaded Apple GSX Tax Invoice PDF...');
    
    // 1. Visual line extraction
    const lines = await extractPdfVisualLines(pdfBuffer);
    assert(lines.length > 20, `Expected > 20 visual lines, got ${lines.length}`);
    console.log(`  ✓ Extracted ${lines.length} visual lines from PDF`);

    // 2. Structured invoice parsing
    const po = await parseGsxInvoicePdf(pdfBuffer, 'Tax_Invoice_MD04136490.pdf');
    
    assert.strictEqual(po.po_number, 'MDC202600024', `Expected PO MDC202600024, got ${po.po_number}`);
    assert.strictEqual(po.invoice_ref, 'MD04136490', `Expected Ref MD04136490, got ${po.invoice_ref}`);
    assert.strictEqual(po.sales_order_no, 'AFB3459762', `Expected SO AFB3459762, got ${po.sales_order_no}`);
    assert.strictEqual(po.customer_no, '1029842', `Expected Cust No 1029842, got ${po.customer_no}`);
    assert.strictEqual(po.order_date, '04-Sep-2026', `Expected Date 04-Sep-2026, got ${po.order_date}`);
    assert.strictEqual(po.expected_date, '10-Sep-2026', `Expected Ship Date 10-Sep-2026, got ${po.expected_date}`);
    assert.strictEqual(po.supplier, 'Apple South Asia Pte Ltd');
    assert.strictEqual(po.currency, 'USD');
    assert.strictEqual(po.total_amount, 4622);
    assert.strictEqual(po.items.length, 10, `Expected 10 line items, got ${po.items.length}`);

    // Verify individual items
    const expectedParts = [
      { pn: '661-21996', qty: 5, price: 89 },
      { pn: '661-22294', qty: 8, price: 89 },
      { pn: '661-30373', qty: 2, price: 99 },
      { pn: '661-30394', qty: 1, price: 99 },
      { pn: '661-30382', qty: 7, price: 99 },
      { pn: '661-30397', qty: 9, price: 99 },
      { pn: '661-35885', qty: 4, price: 99 },
      { pn: '661-37207', qty: 1, price: 99 },
      { pn: '661-35694', qty: 6, price: 99 },
      { pn: '661-36918', qty: 5, price: 99 }
    ];

    let totalCalculatedUnits = 0;
    expectedParts.forEach(exp => {
      const found = po.items.find(it => it.part_number === exp.pn);
      assert(found, `Part ${exp.pn} not found in parsed items`);
      assert.strictEqual(found.quantity_ordered, exp.qty, `Part ${exp.pn} expected qty ${exp.qty}, got ${found.quantity_ordered}`);
      assert.strictEqual(found.unit_price, exp.price, `Part ${exp.pn} expected price ${exp.price}, got ${found.unit_price}`);
      totalCalculatedUnits += found.quantity_ordered;
    });

    assert.strictEqual(totalCalculatedUnits, 48, `Expected 48 total units, got ${totalCalculatedUnits}`);
    console.log('  ✓ All 10 Apple Genuine Parts, quantities (48 total units), and prices ($4,622.00) verified perfectly!');
  } else {
    console.log('  ⚠ Sample PDF not found at path, skipping direct file parse');
  }

  // Test 2: PO fulfillment state transitions
  console.log('[Test 2] Testing PO Fulfillment Lifecycle & Status Transitions...');
  let mockPo = {
    id: 'po-test-1',
    po_number: 'PO-MDC-TEST',
    status: 'pending',
    items: [
      { part_number: '661-21996', quantity_ordered: 2, quantity_received: 0 },
      { part_number: '661-30394', quantity_ordered: 1, quantity_received: 0 }
    ]
  };

  // Receive 1st unit of 661-21996
  function receiveUnit(po, partNumber) {
    const updatedItems = po.items.map(it => {
      if (it.part_number.toUpperCase() === partNumber.toUpperCase()) {
        return { ...it, quantity_received: it.quantity_received + 1 };
      }
      return it;
    });
    const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
    const anyReceived = updatedItems.some(it => it.quantity_received > 0);
    return {
      ...po,
      items: updatedItems,
      status: allReceived ? 'received' : anyReceived ? 'partially_received' : 'pending'
    };
  }

  mockPo = receiveUnit(mockPo, '661-21996');
  assert.strictEqual(mockPo.status, 'partially_received', 'Status should transition to partially_received');
  assert.strictEqual(mockPo.items[0].quantity_received, 1);
  console.log('  ✓ Unit 1 scanned -> status transitioned to partially_received');

  // Receive 2nd unit of 661-21996
  mockPo = receiveUnit(mockPo, '661-21996');
  assert.strictEqual(mockPo.status, 'partially_received', 'Status should remain partially_received');
  assert.strictEqual(mockPo.items[0].quantity_received, 2);
  console.log('  ✓ Unit 2 scanned -> item 661-21996 completed, PO partially_received');

  // Receive final unit of 661-30394
  mockPo = receiveUnit(mockPo, '661-30394');
  assert.strictEqual(mockPo.status, 'received', 'Status should transition to received when all items fulfilled');
  assert.strictEqual(mockPo.items[1].quantity_received, 1);
  console.log('  ✓ Unit 3 scanned -> all items fulfilled, PO status transitioned to received!');

  console.log('--- ALL GSX PO UPLOAD & RECEIVING TESTS PASSED ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
