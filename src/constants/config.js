export const LIVE_MASTER_RECORD_ID = '00000000-0000-0000-0000-000000000001';

export const CANONICAL_SITE_CODES = [
  'APP BHS', 'APP GB3', 'APP PPM', 'ASP GL5', 'ASP SMS', 'APP MOA', 'ASP POD',
  'APP MEG', 'APP ANX', 'APP TRI', 'ASP VN', 'ASP NES', 'APP FES', 'ASP MRK',
  'APP RM', 'ASP LIM', 'ASP NPM', 'ASP NAG', 'ASP LAU', 'ASP ILO', 'APP ILO', 'ASP CEB',
  'ASP ZAM', 'ASP ABR', 'ASP COT', 'ASP CDO', 'APP LAN'
];

export const CANONICAL_SITE_LIST = [
  { code: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET' },
  { code: 'APP GB3', name: 'MOBILECARE - APP GREENBELT 3' },
  { code: 'APP PPM', name: 'MOBILECARE - APP POWER PLANT MALL' },
  { code: 'ASP GL5', name: 'MOBILECARE - GLORIETTA 5' },
  { code: 'ASP SMS', name: "MOBILECARE - S'MAISON" },
  { code: 'APP MOA', name: 'MOBILECARE - APP MALL OF ASIA' },
  { code: 'ASP POD', name: 'MOBILECARE - THE PODIUM' },
  { code: 'APP MEG', name: 'MOBILECARE - APP MEGAMALL' },
  { code: 'APP ANX', name: 'MOBILECARE - APP THE ANNEX' },
  { code: 'APP TRI', name: 'MOBILECARE - APP TRINOMA' },
  { code: 'ASP VN', name: 'MOBILECARE - VERTIS NORTH' },
  { code: 'ASP NES', name: 'MOBILECARE - NORTHEAST SQUARE' },
  { code: 'APP FES', name: 'MOBILECARE - APP FESTIVAL MALL' },
  { code: 'ASP MRK', name: 'MOBILECARE - SM MARIKINA' },
  { code: 'APP RM', name: 'MOBILECARE - APP MAGNOLIA' },
  { code: 'ASP LIM', name: 'MOBILECARE - LIMA ESTATE' },
  { code: 'ASP NPM', name: 'MOBILECARE - NEWPOINT MALL' },
  { code: 'ASP NAG', name: 'MOBILECARE - NAGA' },
  { code: 'ASP LAU', name: 'MOBILECARE - LA UNION' },
  { code: 'ASP ILO', name: 'MOBILECARE - FESTIVE WALK ILOILO' },
  { code: 'APP ILO', name: 'MOBILECARE - APP SM ILOILO' },
  { code: 'ASP CEB', name: 'MOBILECARE - CEBU' },
  { code: 'ASP ZAM', name: 'MOBILECARE - ZAMBOANGA' },
  { code: 'ASP ABR', name: 'MOBILECARE - DAVAO' },
  { code: 'ASP COT', name: 'MOBILECARE SERVICES' },
  { code: 'ASP CDO', name: 'MOBILECARE - CAGAYAN DE ORO' },
  { code: 'APP LAN', name: 'MOBILECARE - APP SM LANANG' }
];

export const CANONICAL_DISPLAY_DESCS = [
  'Display, iPhone 13',
  'Display, iPhone 13 Pro',
  'Display, iPhone 13 Pro Max',
  'Display, iPhone 14',
  'Display, iPhone 14 Plus',
  'Display, iPhone 14 Pro',
  'Display, iPhone 14 Pro Max',
  'Display, iPhone 15',
  'Display, iPhone 15 Plus',
  'Display, iPhone 15 Pro',
  'Display, iPhone 15 Pro Max',
  'Display, iPhone 16',
  'Display, iPhone 16 Plus',
  'Display, iPhone 16 Pro',
  'Display, iPhone 16 Pro Max',
  'Display, iPhone 16e',
  'Display, iPhone 17',
  'Display, iPhone 17 Pro',
  'Display, iPhone 17 Pro Max',
  'Display, iPhone 17e',
  'Display, iPhone Air'
];

export const CANONICAL_BATTERY_DESCS = [
  'Battery, iPhone 13',
  'Battery, iPhone 13 Pro',
  'Battery, iPhone 13 Pro Max',
  'Battery, iPhone 14',
  'Battery, iPhone 14 Plus',
  'Battery, iPhone 14 Pro',
  'Battery, iPhone 14 Pro Max',
  'Battery, iPhone 15',
  'Battery, iPhone 15 Plus',
  'Battery, iPhone 15 Pro',
  'Battery, iPhone 15 Pro Max',
  'Battery, iPhone 16',
  'Battery, iPhone 16 Plus',
  'Battery, iPhone 16 Pro',
  'Battery, iPhone 16 Pro Max',
  'Battery, iPhone 17',
  'Battery, iPhone Air',
  'Battery, pSIM, iPhone 17 Pro',
  'Battery, pSIM, iPhone 17 Pro Max',
  'SVC,IPHONE 14 PRO MAX, BATTERY'
];

export const CANONICAL_BATTERY_SHARE_DESCS = [
  'Battery, iPhone 13',
  'Battery, iPhone 13 Pro',
  'Battery, iPhone 13 Pro Max',
  'Battery, iPhone 14',
  'Battery, iPhone 14 Plus',
  'Battery, iPhone 14 Pro',
  'Battery, iPhone 14 Pro Max',
  'Battery, iPhone 15',
  'Battery, iPhone 15 Plus',
  'Battery, iPhone 15 Pro',
  'Battery, iPhone 15 Pro Max',
  'Battery, iPhone 16',
  'Battery, iPhone 16 Pro',
  'Battery, iPhone 16 Pro Max',
  'Battery, iPhone 17',
  'Battery, iPhone Air',
  'Battery, pSIM, iPhone 17 Pro',
  'Battery, pSIM, iPhone 17 Pro Max'
];

export const CANONICAL_SITE_WEIGHTS = {
  'VN': 0.175, 'FESTIVAL': 0.112, 'FES': 0.112, 'PODIUM': 0.098, 'POD': 0.098,
  'GL5': 0.094, 'GLS': 0.094, 'SMS': 0.086, 'MOA': 0.071, 'BHS': 0.062,
  'NEWPOINT': 0.048, 'NPM': 0.048, 'NES': 0.048, 'GB3': 0.042, 'CEBU': 0.038,
  'CEB': 0.038, 'DAVAO': 0.032, 'DVO': 0.032, 'MEG': 0.030, 'TRI': 0.028,
  'PPM': 0.025, 'ANX': 0.022, 'MRK': 0.020, 'RM': 0.019, 'BACOLOD': 0.018,
  'CDO': 0.016, 'GENSAN': 0.012, 'ILOILO': 0.010, 'ILO': 0.010, 'APP ILO': 0.010, 'LIMA': 0.008,
  'LIM': 0.008, 'ZAM': 0.007, 'ABR': 0.006, 'NAGA': 0.006, 'NAG': 0.006,
  'COT': 0.005, 'LAN': 0.005, 'LAUNION': 0.005, 'LAU': 0.005, 'TUGUE': 0.004
};

export const CATEGORY_COLORS = {
  DISPLAY: '#0284c7',      // Sky Blue
  BATTERY: '#10b981',      // Emerald Green
  CAMERA: '#8b5cf6',       // Purple
  BACK_GLASS: '#f59e0b',   // Amber
  MID_REAR: '#64748b',     // Slate
  OTHER: '#94a3b8'         // Gray
};

export const COMMODITY_COLORS = {
  BATTERY: '#15803d',
  DISPLAY: '#0284c7',
  CAMERA: '#7c3aed',
  OTHER: '#64748b'
};
