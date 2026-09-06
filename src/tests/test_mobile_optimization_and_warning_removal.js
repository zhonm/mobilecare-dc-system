import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('====================================================');
console.log('TEST SUITE: Mobile Layout Optimization & Warning Removal');
console.log('====================================================\n');

const repoRoot = process.cwd();

// Test 1: Verify MobileWarning component and CSS are completely removed
console.log('Test 1: Decommissioning of MobileWarning advisory');
const warningJsxPath = path.join(repoRoot, 'src', 'components', 'MobileWarning.jsx');
const warningCssPath = path.join(repoRoot, 'src', 'components', 'MobileWarning.css');
assert.strictEqual(fs.existsSync(warningJsxPath), false, 'MobileWarning.jsx must be deleted');
assert.strictEqual(fs.existsSync(warningCssPath), false, 'MobileWarning.css must be deleted');

const appJsxContent = fs.readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
assert.strictEqual(appJsxContent.includes('MobileWarning'), false, 'App.jsx must not import or render MobileWarning');
console.log('  ✓ PASS: MobileWarning files deleted and removed from App.jsx');

// Test 2: Verify isMobileNavOpen state in AppContext
console.log('\nTest 2: AppContext mobile navigation drawer state');
const appContextContent = fs.readFileSync(path.join(repoRoot, 'src', 'context', 'AppContext.jsx'), 'utf8');
assert.ok(appContextContent.includes('isMobileNavOpen'), 'AppContext must define isMobileNavOpen state');
assert.ok(appContextContent.includes('setIsMobileNavOpen'), 'AppContext must expose setIsMobileNavOpen');
console.log('  ✓ PASS: AppContext manages and exposes mobile navigation drawer state');

// Test 3: Verify Header mobile hamburger toggle and search buttons
console.log('\nTest 3: Header mobile hamburger toggle button');
const headerContent = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'Header.jsx'), 'utf8');
assert.ok(headerContent.includes('header-mobile-toggle-btn'), 'Header must contain header-mobile-toggle-btn');
assert.ok(headerContent.includes('header-mobile-search-btn'), 'Header must contain header-mobile-search-btn');
console.log('  ✓ PASS: Header contains mobile toggle and search triggers');

// Test 4: Verify Sidebar and PmgSidebar mobile drawer support
console.log('\nTest 4: Sidebar & PmgSidebar mobile drawer & close button');
const sidebarContent = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'Sidebar.jsx'), 'utf8');
const pmgSidebarContent = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'PmgSidebar.jsx'), 'utf8');
assert.ok(sidebarContent.includes('mobile-nav-backdrop'), 'Sidebar must render mobile-nav-backdrop');
assert.ok(sidebarContent.includes('sidebar-mobile-close'), 'Sidebar must have sidebar-mobile-close button');
assert.ok(pmgSidebarContent.includes('mobile-nav-backdrop'), 'PmgSidebar must render mobile-nav-backdrop');
assert.ok(pmgSidebarContent.includes('sidebar-mobile-close'), 'PmgSidebar must have sidebar-mobile-close button');
console.log('  ✓ PASS: Both standard and PMG sidebars support mobile off-canvas drawer and backdrop');

// Test 5: Verify CSS Media Queries for <= 768px in App.css and index.css
console.log('\nTest 5: Responsive media queries in App.css and index.css');
const appCssContent = fs.readFileSync(path.join(repoRoot, 'src', 'App.css'), 'utf8');
const indexCssContent = fs.readFileSync(path.join(repoRoot, 'src', 'index.css'), 'utf8');
assert.ok(appCssContent.includes('@media (max-width: 768px)'), 'App.css must have @media (max-width: 768px)');
assert.ok(appCssContent.includes('.sidebar.mobile-open'), 'App.css must style .sidebar.mobile-open');
assert.ok(appCssContent.includes('.header-mobile-toggle-btn'), 'App.css must style .header-mobile-toggle-btn');
assert.ok(appCssContent.includes('.matrix-col-sticky-1'), 'App.css must unfreeze matrix columns for mobile touch scrolling');
assert.ok(indexCssContent.includes('@media (max-width: 768px)'), 'index.css must have @media (max-width: 768px)');
assert.ok(indexCssContent.includes('.mobile-nav-backdrop'), 'index.css must define .mobile-nav-backdrop');
console.log('  ✓ PASS: Responsive styling and media query rules verified');

console.log('\n====================================================');
console.log('ALL MOBILE OPTIMIZATION & WARNING REMOVAL TESTS PASSED (100%)');
console.log('====================================================\n');
