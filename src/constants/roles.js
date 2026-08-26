export const ROLE_PRESETS = {
  superadmin: ['dashboard', 'import', 'forecast', 'records', 'orders', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'forecast-reports', 'audit', 'settings', 'user-access'],
  admin: ['dashboard', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'forecast-reports'],
  user: ['dashboard', 'intake-records', 'shipments', 'reports', 'forecast-reports', 'audit'],
  // Legacy aliases
  warehouse_staff: ['dashboard', 'scan-in', 'intake-records', 'allocation', 'scan-out', 'shipments', 'reports', 'forecast-reports'],
  site_staff: ['dashboard', 'shipments', 'reports', 'forecast-reports'],
  management_viewer: ['dashboard', 'forecast', 'records', 'intake-records', 'allocation', 'shipments', 'reports', 'forecast-reports', 'audit']
};

export const ROLE_OPTIONS = [
  {
    value: 'superadmin',
    label: 'Superadmin',
    description: 'Full access to all system features, configurations, and user permissions.'
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Operational administrator. Page access is assigned by Superadmin. Can edit user role positions.'
  },
  {
    value: 'user',
    label: 'User (View-Only)',
    description: 'Primarily view-only access to operational dashboards, reports, and logs.'
  }
];

export const getDefaultRolePosition = (role) => {
  switch (role) {
    case 'superadmin': return 'Parts Management Specialist';
    case 'admin': return 'Distribution Operations Lead';
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
    hasSetPassword: true,
    passwordHash: 'Password123',
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
    hasSetPassword: true,
    passwordHash: 'Password123',
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
