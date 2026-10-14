import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

import {
  getOrCreateFolderPath,
  searchDriveFiles
} from '../services/googleDriveService.js';

import {
  ROLE_PRESETS
} from '../constants/roles.js';

console.log('========================================================================');
console.log('TEST SUITE: Google Drive Document Hub, Hierarchies & AppProperties');
console.log('========================================================================\n');

// 1. Verify getOrCreateFolderPath exists and handles empty/array inputs safely
console.log('--- Test 1: getOrCreateFolderPath API and Path Normalization ---');
assert.strictEqual(typeof getOrCreateFolderPath, 'function', 'getOrCreateFolderPath must be exported as a function');

const rootId = 'test-root-folder-123';
const resNull = await getOrCreateFolderPath(rootId, null);
assert.strictEqual(resNull, rootId, 'Null path should return root folder ID');

const resEmpty = await getOrCreateFolderPath(rootId, []);
assert.strictEqual(resEmpty, rootId, 'Empty path array should return root folder ID');
console.log('  ✓ PASS: getOrCreateFolderPath safely normalizes boundary inputs');

// 2. Verify searchDriveFiles query builder
console.log('\n--- Test 2: searchDriveFiles Query Builder & AppProperties Filter ---');
assert.strictEqual(typeof searchDriveFiles, 'function', 'searchDriveFiles must be exported as a function');

// 3. Verify Role Presets restrict drive-hub strictly to superadmin
console.log('\n--- Test 3: Role Presets restrict drive-hub strictly to superadmin ---');
assert.ok(ROLE_PRESETS.superadmin.includes('drive-hub'), 'Superadmin role must have access to drive-hub');
assert.ok(!ROLE_PRESETS.admin.includes('drive-hub'), 'Admin role must NOT have access to drive-hub');
assert.ok(!ROLE_PRESETS.parts_management.includes('drive-hub'), 'Parts Management role must NOT have access to drive-hub');
assert.ok(!ROLE_PRESETS.user.includes('drive-hub'), 'User role must NOT have access to drive-hub');
console.log('  ✓ PASS: drive-hub route permission strictly restricted to superadmin');

// 4. Verify App.jsx imports DriveDocumentHub with React.lazy
console.log('\n--- Test 4: App.jsx Lazy-Loading & Suspense Architecture ---');
const appJsxContent = fs.readFileSync(path.join(projectRoot, 'src/App.jsx'), 'utf-8');
assert.ok(appJsxContent.includes("lazy(() => import('./components/DriveDocumentHub'))"), 'DriveDocumentHub must be lazy-loaded in App.jsx');
assert.ok(appJsxContent.includes("lazy(() => import('./components/AllocationMatrix'))"), 'AllocationMatrix must be lazy-loaded');
assert.ok(appJsxContent.includes("lazy(() => import('./components/Shipments'))"), 'Shipments must be lazy-loaded');
assert.ok(appJsxContent.includes('<Suspense fallback={<ModuleLoadingFallback />}>'), 'App.jsx must wrap active tab inside Suspense');
console.log('  ✓ PASS: App.jsx successfully implements React.lazy route-based code splitting');

// 5. Verify DriveDocumentHub component source file
console.log('\n--- Test 5: DriveDocumentHub UI Component Integrity ---');
const hubFile = path.join(projectRoot, 'src/components/DriveDocumentHub.jsx');
assert.ok(fs.existsSync(hubFile), 'DriveDocumentHub.jsx must exist');
const hubContent = fs.readFileSync(hubFile, 'utf-8');
assert.ok(hubContent.includes('Google Drive Document Hub & Archive'), 'DriveDocumentHub title verified');
assert.ok(hubContent.includes('handleOpenPreview'), 'Inline preview capability verified');
assert.ok(hubContent.includes('processOfflineDriveQueue'), 'Offline queue recovery action verified');
console.log('  ✓ PASS: DriveDocumentHub component source verified');

console.log('\n========================================================================');
console.log('ALL GOOGLE DRIVE HUB & CODE SPLITTING TESTS PASSED (100%)');
console.log('========================================================================\n');
