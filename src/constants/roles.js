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
    id: '1b0e9f43-c2d5-4eb4-acef-2ea5d9d21280',
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
    id: 'a703ae69-187d-4711-9f7f-c44da1d0177e',
    email: 'joshua.juvida@mobilecareph.com',
    fullName: 'Joshua Juvida',
    role: 'superadmin',
    rolePosition: 'Inventory Planner',
    siteId: 'site-dc',
    hasSetPassword: false,
    passwordHash: null,
    isActive: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: 'usr-1787831250805',
    email: 'daphneclaire.bascuguin@mobilecareph.com',
    fullName: 'Daphne Bascuguin',
    role: 'superadmin',
    rolePosition: 'Area Manager',
    siteId: 'site-dc',
    hasSetPassword: false,
    passwordHash: null,
    isActive: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: 'usr-1788085932974',
    email: 'andres@mobilecareph.com',
    fullName: 'Andres Bonifacio',
    role: 'parts_management',
    rolePosition: 'Parts Management Analyst',
    siteId: 'site-5',
    hasSetPassword: false,
    passwordHash: null,
    isActive: true,
    permittedPages: ROLE_PRESETS.parts_management
  },
  {
    id: 'usr-1788162524515-g5pbk',
    email: 'joserizal@mobilecareph.com',
    fullName: 'Jose Rizal',
    role: 'parts_management',
    rolePosition: 'Parts Management Specialist',
    siteId: 'site-3',
    hasSetPassword: false,
    passwordHash: null,
    isActive: true,
    permittedPages: ROLE_PRESETS.parts_management
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
