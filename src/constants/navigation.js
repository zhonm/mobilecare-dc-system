export const ALL_PAGES = [
  { id: 'dashboard', label: 'DC Overview', section: 'Core' },
  { id: 'import', label: 'Fixably / GSX Data Import', section: 'Planning' },
  { id: 'forecast', label: 'Demand Forecasting', section: 'Planning' },
  { id: 'records', label: 'Saved Period Records', section: 'Planning' },
  { id: 'orders', label: 'Purchase Orders', section: 'Planning' },
  { id: 'scan-in', label: 'Receive Scan-In', section: 'Warehouse Operations' },
  { id: 'intake-records', label: 'DC Intake Records', section: 'Warehouse Operations' },
  { id: 'allocation', label: 'Allocation Matrix', section: 'Warehouse Operations' },
  { id: 'scan-out', label: 'Pack Scan-Out', section: 'Warehouse Operations' },
  { id: 'shipments', label: 'Shipments & Packing Lists', section: 'Distribution' },
  { id: 'reports', label: 'Stock Transfer Reports', section: 'Reports & Analytics' },
  { id: 'forecast-reports', label: 'Forecasting Reports', section: 'Reports & Analytics' },
  { id: 'audit', label: 'Serialized Audit Log', section: 'Traceability' },
  { id: 'settings', label: 'Parts & Site Catalog', section: 'Admin' },
  { id: 'user-access', label: 'User Access Management', section: 'Admin' }
];

export const PAGE_TITLES = {
  dashboard: 'Distribution Center Overview',
  import: 'GSX & Fixably Data Import (ETL)',
  forecast: 'Demand Forecasting & PO Recommendations',
  records: 'Saved Period Records & Historical Archives',
  orders: 'Purchase Order Tracking',
  'scan-in': 'Receive Scan-In (Physical Barcode Scanner)',
  'intake-records': 'DC Intake Records & Verification',
  allocation: 'Master Allocation Matrix & Weekly Batches',
  'scan-out': 'Pack Scan-Out & Packing List Generator',
  shipments: 'Shipment Manifests & Proof of Delivery',
  reports: 'Fixably Stock Transfer Reports & Analytics',
  'forecast-reports': 'Fixably Forecasting Reports & Analytics',
  audit: 'Serialized Lifecycle & Traceability Audit',
  settings: 'Parts Catalog & Site Configuration',
  'user-access': 'User Access & Permissions Management'
};
