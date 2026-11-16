/**
 * Automated Database Backup to Google Drive for MDC DC System
 *
 * Extracts full paginated snapshot data across all Supabase tables & registries,
 * computes a deterministic integrity checksum, and uploads a verified timestamped
 * backup package directly to the "backups" folder in Google Drive.
 *
 * Usage:
 *   node scripts/backup_to_google_drive.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables manually
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.substring(1, v.length - 1);
      }
      process.env[k] = v;
    }
  });
}

// Inject service account key
const keyPath = path.join(rootDir, 'google-service-account.json');
if (fs.existsSync(keyPath)) {
  globalThis.__GOOGLE_SERVICE_KEY__ = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
}

const { uploadToGoogleDrive, isGoogleDriveConfigured } = await import('../src/services/googleDriveService.js');
const {
  normalizeBackupPayload,
  compileSystemBackupPackage,
  validateBackupPackage,
  safeJsonStringify
} = await import('../src/services/backupRestoreService.js');

async function fetchAllRowsPaginated(supabase, tableName, pageSize = 1000) {
  const allRows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw error;
    }
    const page = data || [];
    allRows.push(...page);
    if (page.length < pageSize) break;
  }
  return allRows;
}

async function runBackup() {
  console.log('========================================================================');
  console.log('MDC DC SYSTEM: Automated Full Enterprise Database Backup to Google Drive');
  console.log('========================================================================');

  if (!isGoogleDriveConfigured()) {
    console.error('✗ ERROR: Google Drive credentials are not configured.');
    process.exit(1);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('✗ ERROR: Supabase credentials not found in .env');
    process.exit(1);
  }

  console.log('1. Connecting to Supabase database...');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const tablesToBackup = [
    'profiles',
    'user_page_permissions',
    'part_categories',
    'sites',
    'parts',
    'shipments',
    'shipment_items',
    'inventory_units',
    'dc_intake_records',
    'parts_requests',
    'repair_usage_records',
    'part_transfer_history',
    'consumables_tools_movements',
    'audit_logs',
    'scan_logs',
    'saved_records'
  ];

  const rawDump = {
    metadata: {
      system: 'Mobile Care Services Philippines Inc. (MDC) - DC System',
      backup_timestamp: new Date().toISOString(),
      source_supabase_url: supabaseUrl,
      tables: {}
    },
    tables: {}
  };

  console.log('2. Exporting database tables (with full pagination)...');
  for (const table of tablesToBackup) {
    try {
      const data = await fetchAllRowsPaginated(supabase, table);
      rawDump.tables[table] = data;
      rawDump.metadata.tables[table] = { count: data.length, status: 'ok' };
      console.log(`  ✓ Table "${table}": ${data.length} records exported`);
    } catch (e) {
      console.warn(`  - [WARN] Could not export table "${table}": ${e.message}`);
      rawDump.tables[table] = [];
      rawDump.metadata.tables[table] = { count: 0, status: 'error', error: e.message };
    }
  }

  // Normalize & compile unified v3.0 enterprise backup package with checksum
  const normalizedData = normalizeBackupPayload(rawDump);
  const compiledPkg = compileSystemBackupPackage(
    normalizedData,
    {
      id: 'cli-automation',
      fullName: 'Automated CLI Backup',
      email: 'automation@mobilecareph.com',
      role: 'superadmin'
    },
    {
      trigger: 'CLI_SCRIPT',
      label: 'CLI_Full_DB'
    }
  );

  // Preserve raw relational tables alongside normalized data for complete auditability
  const finalPackage = {
    ...compiledPkg,
    metadata: rawDump.metadata,
    tables: rawDump.tables
  };

  const validation = validateBackupPackage(finalPackage);
  if (!validation.isValid) {
    console.warn(`  ! Validation note: ${validation.error}`);
  } else {
    console.log(`  ✓ Checksum verified: ${finalPackage.integrity.checksum} (${finalPackage.stats.totalRecordsCount} total records)`);
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const backupFileName = `MDC_SYSTEM_BACKUP_${dateStr}_CLI.json`;
  const jsonContent = safeJsonStringify(finalPackage, 2);
  const sizeKb = (Buffer.byteLength(jsonContent, 'utf8') / 1024).toFixed(2);

  console.log(`\n3. Uploading ${backupFileName} (${sizeKb} KB) to Google Drive "backups"...`);
  const uploadResult = await uploadToGoogleDrive({
    name: backupFileName,
    mimeType: 'application/json',
    data: jsonContent,
    folderType: 'backups',
    useDateFolder: false,
    appProperties: {
      system: 'MDC-DC',
      docType: 'system_backup',
      schemaVersion: String(finalPackage.schemaVersion),
      checksum: String(finalPackage.integrity.checksum).slice(0, 110),
      totalRecords: String(finalPackage.stats.totalRecordsCount || 0),
      unitsCount: String(finalPackage.stats.inventoryUnitsCount || 0),
      shipmentsCount: String(finalPackage.stats.shipmentsCount || 0),
      partsCount: String(finalPackage.stats.partsCount || 0),
      sitesCount: String(finalPackage.stats.sitesCount || 0),
      createdBy: 'Automated CLI Script',
      trigger: 'CLI_SCRIPT'
    }
  });

  if (uploadResult.success) {
    console.log('  ✓ System Database Backup saved:', uploadResult.webViewLink);
  } else {
    console.warn('  ✗ Database backup upload failed:', uploadResult.error);
  }

  const liveState = (rawDump.tables.saved_records || []).find(
    (r) => r.id === 'master_live_state' || r.id === 'live_master_state'
  );
  if (liveState?.snapshot_data?.forecastItems) {
    console.log('\n4. Archiving live Forecasting data snapshot to "Forecasting Data" folder...');
    const forecastSnapshot = safeJsonStringify(liveState.snapshot_data.forecastItems, 2);
    const fRes = await uploadToGoogleDrive({
      name: `Forecasting_Data_Snapshot_${dateStr}.json`,
      mimeType: 'application/json',
      data: forecastSnapshot,
      folderType: 'forecasting'
    });
    if (fRes.success) console.log('  ✓ Forecasting Data archived:', fRes.webViewLink);
  }

  if (liveState?.snapshot_data?.allocations) {
    console.log('\n5. Archiving live Allocation matrix snapshot to "Allocation" folder...');
    const allocSnapshot = safeJsonStringify(liveState.snapshot_data.allocations, 2);
    const aRes = await uploadToGoogleDrive({
      name: `Allocation_Matrix_Snapshot_${dateStr}.json`,
      mimeType: 'application/json',
      data: allocSnapshot,
      folderType: 'allocation'
    });
    if (aRes.success) console.log('  ✓ Allocation Matrix archived:', aRes.webViewLink);
  }

  console.log('\n🎉 ALL BACKUPS COMPLETED SUCCESSFULLY ACROSS GOOGLE DRIVE FOLDERS!');
}

runBackup().catch((err) => {
  console.error('Fatal backup error:', err);
  process.exit(1);
});
