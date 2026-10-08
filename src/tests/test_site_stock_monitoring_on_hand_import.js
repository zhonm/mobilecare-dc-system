import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { parseSiteStockMonitoringWorkbook } from '../utils/excelParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workbookPath = path.resolve(__dirname, '../../Site Stock Monitoring (On Hand).xlsx');

console.log('====================================================');
console.log('TEST SUITE: Site Stock Monitoring On-Hand Import Integrity');
console.log('====================================================');

if (!fs.existsSync(workbookPath)) {
  console.log('  Note: Site Stock Monitoring (On Hand).xlsx not found; skipping fixture test.');
  process.exit(0);
}

const workbook = XLSX.read(fs.readFileSync(workbookPath), { type: 'buffer' });
const result = parseSiteStockMonitoringWorkbook(workbook, { parseAllSheets: true });

assert.strictEqual(result.success, true, 'On-hand workbook parsing must succeed');
assert.strictEqual(result.summary.inStock, 3446, 'All 3,446 on-hand rows must survive parsing');
assert.strictEqual(result.summary.inStock + result.summary.used + result.summary.outtake + result.summary.transferred, 5109);

console.log(`  PASS: Preserved ${result.summary.inStock} on-hand records across all branch sheets.`);
