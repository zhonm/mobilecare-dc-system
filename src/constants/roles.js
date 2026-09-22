export const ROLE_PRESETS = {
  superadmin: ['dashboard', 'import', 'forecast', 'orders', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'site-transfers-fifo', 'forecast-reports', 'audit', 'settings', 'user-access', 'request-parts', 'all-stocks', 'feedback'],
  admin: ['dashboard', 'forecast', 'allocation', 'scan-in', 'intake-records', 'scan-out', 'shipments', 'reports', 'site-transfers-fifo', 'forecast-reports', 'orders', 'audit', 'request-parts', 'all-stocks', 'feedback'],
  user: ['dashboard', 'forecast', 'allocation', 'forecast-reports', 'reports', 'site-transfers-fifo', 'orders', 'audit', 'feedback'],
  parts_management: ['request-parts', 'scan-in', 'all-stocks', 'feedback'],
  // Legacy aliases
  warehouse_staff: ['dashboard', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'site-transfers-fifo', 'forecast-reports', 'request-parts', 'all-stocks', 'feedback'],
  site_staff: ['request-parts', 'scan-in', 'all-stocks', 'dashboard', 'forecast', 'allocation', 'shipments', 'reports', 'site-transfers-fifo', 'forecast-reports', 'feedback'],
  management_viewer: ['dashboard', 'forecast', 'allocation', 'reports', 'site-transfers-fifo', 'forecast-reports', 'audit', 'feedback']
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
    description: 'View-only access to Demand Forecasting, Allocation Matrix, Reports, and POs with full XLSX/PDF export capabilities.'
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
    siteId: '2cf62bf6-14cf-4d31-838e-9bff43fb9018',
    isActive: true,
    hasSetPassword: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: '2541421a-3383-407a-a6c2-1264198940b6',
    email: 'joshua.juvida@mobilecareph.com',
    fullName: 'Joshua Juvida',
    role: 'superadmin',
    rolePosition: 'Inventory Planner',
    siteId: '2cf62bf6-14cf-4d31-838e-9bff43fb9018',
    isActive: true,
    hasSetPassword: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: '076a8481-2014-4aa1-a77e-5e221b40fea7',
    email: 'anjo.alcazar@mobilecareph.com',
    fullName: 'Anjo Alcazar',
    role: 'superadmin',
    rolePosition: 'Assistant Manager',
    siteId: '2cf62bf6-14cf-4d31-838e-9bff43fb9018',
    isActive: true,
    hasSetPassword: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: '7db37a36-73cd-4d0a-ae7e-c73c61a9935a',
    email: 'daphneclaire.bascuguin@mobilecareph.com',
    fullName: 'Daphne Bascuguin',
    role: 'superadmin',
    rolePosition: 'Area Manager',
    siteId: '2cf62bf6-14cf-4d31-838e-9bff43fb9018',
    isActive: true,
    hasSetPassword: true,
    permittedPages: ROLE_PRESETS.superadmin
  },
  {
    id: '181ce98c-0cd9-476c-a4c5-2ee833c174f4',
    email: 'andres@mobilecareph.com',
    fullName: 'Andres Bonifacio',
    role: 'parts_management',
    rolePosition: 'Parts Management Analyst',
    siteId: '1cebf73f-f511-47a5-a767-002709a42fab',
    isActive: true,
    hasSetPassword: true,
    permittedPages: ROLE_PRESETS.parts_management
  },
  {
    id: '3fa435cd-24bc-46ed-ab18-23222662477b',
    email: 'joserizal@mobilecareph.com',
    fullName: 'Jose Rizal',
    role: 'parts_management',
    rolePosition: 'Parts Management Specialist',
    siteId: '61419aaa-da16-4075-9f40-a113be2620f9',
    isActive: true,
    hasSetPassword: true,
    permittedPages: ROLE_PRESETS.parts_management
  }
];

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
