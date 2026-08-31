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

export const INITIAL_USERS = [
  {
    id: 'usr-superadmin-zhon',
    email: 'zhon.manaois@mobilecareph.com',
    fullName: 'Zhon Manaois',
    role: 'superadmin',
    rolePosition: 'Parts Management Specialist',
    siteId: 'site-dc',
    hasSetPassword: false,
    passwordHash: null,
    isActive: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: 'usr-superadmin-joshua',
    email: 'joshua.juvida@mobilecareph.com',
    fullName: 'Joshua Juvida',
    role: 'superadmin',
    rolePosition: 'DC Operations Lead & Superadmin',
    siteId: 'site-dc',
    hasSetPassword: false,
    passwordHash: null,
    isActive: true,
    permittedPages: ROLE_PRESETS.superadmin
  }
];

export const LEGACY_MOCK_EMAILS = [
  'anjo.alcazar@mobilecareph.com',
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
