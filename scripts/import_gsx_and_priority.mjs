/**
 * Repeatable (Idempotent) Import Runner for GSX all Parts.csv & Priority parts.csv
 *
 * Usage:
 *   node scripts/import_gsx_and_priority.mjs
 *
 * Outputs:
 *   - src/data/gsxPartsCatalog.json
 *   - src/data/consumablesToolsSeed.json
 *   - reports/gsx_excluded_devices_report.{json,md}
 *   - reports/priority_needs_review_report.{json,md}
 *   - reports/priority_description_conflicts_report.{json,md}
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { importGsxCatalogFromCsv, OBSOLETE_DEVICE_EXCLUSION_RULES } from '../src/utils/gsxCatalogImporter.js';
import { importPriorityPartsFromCsv } from '../src/utils/priorityPartsImporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const gsxCsvPath = path.join(ROOT, 'GSX all Parts.csv');
const priorityCsvPath = path.join(ROOT, 'Priority parts.csv');
const reportsDir = path.join(ROOT, 'reports');
const dataDir = path.join(ROOT, 'src', 'data');

fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

console.log('Reading GSX all Parts.csv...');
const gsxCsvText = fs.readFileSync(gsxCsvPath, 'utf8');
const gsxResult = importGsxCatalogFromCsv(gsxCsvText);

console.log('Reading Priority parts.csv...');
const priorityCsvText = fs.readFileSync(priorityCsvPath, 'utf8');
const priorityResult = importPriorityPartsFromCsv(priorityCsvText, {
  gsxDescriptionsByPn: gsxResult.allDescriptionsByPn,
  gsxParts: gsxResult.parts
});

// 1. Write compact GSX catalog JSON
const gsxCatalogOut = path.join(dataDir, 'gsxPartsCatalog.json');
fs.writeFileSync(gsxCatalogOut, JSON.stringify({
  generatedAt: new Date().toISOString(),
  stats: gsxResult.stats,
  keptDevices: gsxResult.keptDevices,
  parts: gsxResult.parts
}, null, 2));

// 2. Write Consumables & Tools seed JSON
const ctSeedOut = path.join(dataDir, 'consumablesToolsSeed.json');
fs.writeFileSync(ctSeedOut, JSON.stringify({
  generatedAt: new Date().toISOString(),
  stats: priorityResult.stats,
  catalogItems: priorityResult.catalogItems,
  orders: priorityResult.orders,
  movements: priorityResult.movements
}, null, 2));

// 3. Write Excluded Devices Report
const excludedJsonPath = path.join(reportsDir, 'gsx_excluded_devices_report.json');
fs.writeFileSync(excludedJsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  rule: OBSOLETE_DEVICE_EXCLUSION_RULES,
  stats: gsxResult.stats,
  keptDevices: gsxResult.keptDevices,
  excludedDevices: gsxResult.excludedDevices
}, null, 2));

const excludedMd = [
  '# GSX Excluded Devices Report',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Exclusion Definition ("Obsolete")',
  OBSOLETE_DEVICE_EXCLUSION_RULES.cutoffNote,
  '',
  '## Import Summary',
  `- Total CSV rows scanned: **${gsxResult.stats.totalCsvRows}**`,
  `- Current devices kept: **${gsxResult.stats.keptDevicesCount}**`,
  `- Excluded device entries: **${gsxResult.stats.excludedObsoleteDeviceCount}** (${gsxResult.stats.excludedObsoleteRows} rows)`,
  `- Excluded \`Service Intangible\` rows (current devices): **${gsxResult.stats.excludedServiceIntangibleRows}** (${gsxResult.stats.excludedServiceIntangibleUniquePns} unique PNs)`,
  `- Current orderable unique GSX parts imported: **${gsxResult.stats.importedUniquePartsCount}**`,
  '',
  '## Excluded Devices (for Review)',
  '',
  '| Product Name | Exclusion Reason | CSV Rows | Unique Part Numbers |',
  '|---|---|---:|---:|',
  ...gsxResult.excludedDevices.map((d) => `| ${d.product_name} | ${d.reason} | ${d.row_count} | ${d.unique_part_numbers} |`),
  '',
  '## Kept Current Devices',
  ...gsxResult.keptDevices.map((m) => `- ${m}`)
].join('\n');
fs.writeFileSync(path.join(reportsDir, 'gsx_excluded_devices_report.md'), excludedMd);

// 4. Write Priority Needs-Review Report
fs.writeFileSync(path.join(reportsDir, 'priority_needs_review_report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  stats: priorityResult.stats,
  needsReview: priorityResult.needsReview
}, null, 2));

const needsReviewMd = [
  '# Priority Parts — Needs Review Report',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Total rows flagged for review: **${priorityResult.needsReview.length}**`,
  '',
  '| CSV Line | PO# | Site | Raw PN | Assigned SKU | Description | Raw QTY | Reason(s) |',
  '|---:|---|---|---|---|---|---:|---|',
  ...priorityResult.needsReview.map((r) =>
    `| ${r.csv_line} | ${r.po_number} | ${r.raw_site} -> ${r.resolved_site_code} | ${r.raw_part_number} | \`${r.assigned_part_number}\` | ${r.raw_description} | ${r.raw_qty} | ${r.reasons.join('; ')} |`
  )
].join('\n');
fs.writeFileSync(path.join(reportsDir, 'priority_needs_review_report.md'), needsReviewMd);

// 5. Write Priority Description Conflicts Report
fs.writeFileSync(path.join(reportsDir, 'priority_description_conflicts_report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: priorityResult.descriptionConflicts.length,
  descriptionConflicts: priorityResult.descriptionConflicts
}, null, 2));

const conflictsMd = [
  '# Priority Parts — Description Conflicts Report',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Part numbers with multiple or non-GSX descriptions: **${priorityResult.descriptionConflicts.length}**`,
  '',
  '| Part Number | Resolved Canonical Description | GSX Description | Priority CSV Variants | Occurrences | Sample PO#s |',
  '|---|---|---|---|---:|---|',
  ...priorityResult.descriptionConflicts.map((c) =>
    `| \`${c.part_number}\` | ${c.resolved_description} | ${c.gsx_canonical_description || '_(not in GSX CSV)_'} | ${c.priority_csv_descriptions.join(' • ')} | ${c.occurrences} | ${c.sample_po_numbers.join(', ')} |`
  )
].join('\n');
fs.writeFileSync(path.join(reportsDir, 'priority_description_conflicts_report.md'), conflictsMd);

console.log('GSX Import Stats:', gsxResult.stats);
console.log('Priority Import Stats:', priorityResult.stats);
console.log('Generated seed files and reports successfully.');
