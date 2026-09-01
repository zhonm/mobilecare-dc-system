export const ROLE_PRESETS = {
  superadmin: ['dashboard', 'import', 'forecast', 'records', 'orders', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'forecast-reports', 'audit', 'settings', 'user-access', 'request-parts', 'all-stocks'],
  admin: ['dashboard', 'forecast', 'allocation', 'scan-in', 'intake-records', 'scan-out', 'shipments', 'reports', 'forecast-reports', 'orders', 'records', 'audit', 'request-parts', 'all-stocks'],
  user: ['dashboard', 'forecast', 'allocation', 'forecast-reports', 'reports', 'orders', 'records', 'audit'],
  parts_management: ['request-parts', 'scan-in', 'all-stocks'],
  // Legacy aliases
  warehouse_staff: ['dashboard', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'forecast-reports', 'request-parts', 'all-stocks'],
  site_staff: ['request-parts', 'scan-in', 'all-stocks', 'dashboard', 'forecast', 'allocation', 'shipments', 'reports', 'forecast-reports'],
  management_viewer: ['dashboard', 'forecast', 'records', 'allocation', 'reports', 'forecast-reports', 'audit']
};

export const ROLE_OPTIONS = [
  {
    value: 'superadmin',
    label: 'Superadmin',
    description: 'Full unrestricted governance over all system features, forecasting algorithms, database maintenance, site catalogs, and security permissions.'
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Operational administrator. Manages intake operations, allocations, shipments, and edits staff role positions.'
  },
  {
    value: 'parts_management',
    label: 'Parts Management (PMG)',
    description: 'Site-restricted parts request management, branch scan-in (manual & bulk XLSX/CSV), and multi-site inventory visibility with serial privacy.'
  },
  {
    value: 'user',
    label: 'User (View & Export Only)',
    description: 'View-only access to Demand Forecasting, Allocation Matrix, Reports, Saved Period Records, and POs with full XLSX/PDF export capabilities.'
  }
];

export const getDefaultRolePosition = (role) => {
  switch (role) {
    case 'superadmin': return 'Parts Management Specialist';
    case 'admin': return 'Distribution Operations Lead';
    case 'parts_management': return 'Parts Management Specialist';
    case 'user': return 'Warehouse Operations Specialist';
    default: return 'Parts Management Specialist';
  }
};

export const INITIAL_USERS = [];

export const LEGACY_MOCK_EMAILS = [
  'warehouse@mobilecareph.com',
  'npm.service@mobilecareph.com',
  'newuser@mobilecareph.com'
];

export const LEGACY_MOCK_IDS = [
  'usr-admin',
  'usr-warehouse',
  'usr-sitestaff',
  'usr-firsttime'
];

export function sortUsersDeterministically(users = []) {
  if (!Array.isArray(users)) return [];
  const roleRank = {
    superadmin: 1,
    admin: 2,
    parts_management: 3,
    user: 4
  };
  return [...users].sort((a, b) => {
    // 1. Role hierarchy (Superadmin first, then Admin, PMG, User)
    const rankA = roleRank[a.role] || 99;
    const rankB = roleRank[b.role] || 99;
    if (rankA !== rankB) return rankA - rankB;

    // 2. Active status (Active before Deactivated)
    const activeA = a.isActive !== false ? 1 : 0;
    const activeB = b.isActive !== false ? 1 : 0;
    if (activeA !== activeB) return activeB - activeA;

    // 3. Alphabetical by Full Name
    const nameA = String(a.fullName || a.email || '').trim().toLowerCase();
    const nameB = String(b.fullName || b.email || '').trim().toLowerCase();
    const nameComp = nameA.localeCompare(nameB);
    if (nameComp !== 0) return nameComp;

    // 4. Stable tiebreaker: ID
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}
