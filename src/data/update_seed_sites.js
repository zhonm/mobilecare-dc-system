import fs from 'fs';

const seedPath = '/Users/zhonmns/Documents/mobilecare-dc-system/src/data/seedData.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const directoryMap = {
  'DC-MDC': {
    address: '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila',
    full_address: 'Business and Distribution Center, 2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila',
    contact_person: 'DC Operations',
    contact_phone: '+63 (2) 8721-1234',
    contact_email: 'dc.operations@mobilecareph.com',
    invoice_prefix: 'DCSSR#',
    ship_to: '1029842',
    sold_to: '1029842'
  },
  'APP BHS': {
    name: 'MOBILECARE - APP BONIFACIO HIGH STREET',
    address: '1/F Wumaco Building, 7th Ave cor Lane P, Bonifacio High Street, BGC, Taguig City 1635',
    full_address: '1F, Wumaco Building, 7th Ave cor. Lane P, High Street, Taguig, 1635',
    contact_person: 'Ghibert Justine Flores',
    contact_email: 'ghibertjustine.flores@mobilecareph.com',
    invoice_prefix: 'BHSSSR#',
    ship_to: '1836095',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'APP GB3': {
    name: 'MOBILECARE - APP GREENBELT 3',
    address: 'Space Nos. 214-215, 2/F, Greenbelt 3, Greenbelt Complex, Ayala Center, Brgy. San Lorenzo, Makati City 1228',
    full_address: 'Space Nos. 214-215, 2/F, Greenbelt 3, Greenbelt Complex, Ayala Center Brgy. Lorenzo, Makati City 1228',
    contact_person: 'Joshua Malubay',
    contact_email: 'joshua.malubay@mobilecareph.com',
    invoice_prefix: 'GB3SSR#',
    ship_to: '1645879',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'APP PPM': {
    name: 'MOBILECARE - APP POWER PLANT MALL',
    address: 'Power Mac Center R2 Level, Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila',
    full_address: 'Power Mac Center R2 Level Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila',
    contact_person: 'Eljon Renz Quarto',
    contact_email: 'eljonrenz.quarto@mobilecareph.com',
    invoice_prefix: 'PPMSSR#',
    ship_to: '1603617',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'ASP GL5': {
    name: 'MOBILECARE - GLORIETTA 5',
    address: 'Unit 329 3/F Glorietta 5, Ayala Center, Brgy. San Lorenzo, Makati City, Metro Manila',
    full_address: 'Unit 329 3/F Glorietta St., 5 Ayala Center, Brgy. San Lorenzo Makati City, Metro Manila',
    contact_person: 'Danica Ramos',
    contact_email: 'danica.ramos@powermaccenter.com',
    invoice_prefix: 'GL5SSR#',
    ship_to: '1102537',
    sold_to: '1029842',
    region: 'Metro Manila'
  },
  'ASP SMS': {
    name: "MOBILECARE - S'MAISON",
    address: '2/L, S Maison at Conrad Manila, Seaside Blvd., Coral Way, MOA Complex, Brgy. 76, Pasay City, 1300',
    full_address: '2/L, Smaison At Conrad Manila, Seaside Blvd., Coral Way, Moa Complex, Brgy. 76 Pasay City, 1300',
    contact_person: 'Jessabel Gregorio',
    contact_email: 'jessabel.gregorio@mobilecareph.com',
    invoice_prefix: 'SMSSSR#',
    ship_to: '1103790',
    sold_to: '1029842',
    region: 'Metro Manila'
  },
  'APP MOA': {
    name: 'MOBILECARE - APP MALL OF ASIA',
    address: '2/L North Parking Building, Cyberzone, SM Mall of Asia, Barangay 76, Pasay City',
    full_address: '2/L North Parking Building Cyberzone Power Mac Center SM Mall Of Asia Barangay 76 Pasay City',
    contact_person: 'Jennelyn Decastro',
    contact_email: 'jennelyn.decastro@mobilecareph.com',
    invoice_prefix: 'MOASSR#',
    ship_to: '1597912',
    sold_to: '1645876',
    region: 'Metro Manila'
  },
  'ASP POD': {
    name: 'MOBILECARE - THE PODIUM',
    address: '4/F, The Podium, 12 ADB Ave, Ortigas Center, Mandaluyong City, 1550 Metro Manila',
    full_address: '4/F, The Podium, 12 ADB Ave, Ortigas Center, Mandaluyong City, 1550 Metro Manila',
    contact_person: 'Jasmil Rose Guban',
    contact_email: 'jasmilrose.guban@mobilecareph.com',
    invoice_prefix: 'PODSSR#',
    ship_to: '1272226',
    sold_to: '1029842',
    region: 'Metro Manila'
  },
  'APP MEG': {
    name: 'MOBILECARE - APP MEGAMALL',
    address: 'Bldg. B, 4/F Cyberzone, SM Megamall, EDSA cor Doña Julia Vargas Ave, Mandaluyong City 1550',
    full_address: 'Bldg. B, Cyberzone, SM Megamall, Mandaluyong City 1550 Philippines',
    contact_person: 'Eugene Deborja',
    contact_email: 'eugene.deborja@mobilecareph.com',
    invoice_prefix: 'MGSSR#',
    ship_to: '1745440',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'APP ANX': {
    name: 'MOBILECARE - APP THE ANNEX',
    address: '4/F Cyberzone, SM City North EDSA The Annex, Brgy. Sto. Cristo, Quezon City 1105',
    full_address: 'SMCITY NORTH EDSA, BRGY. STO CRISTO, QUEZON CITY 1105 PH',
    contact_person: 'Patrick John Rino',
    contact_email: 'patrickjohn.rino@mobilecareph.com',
    invoice_prefix: 'ANSSR#',
    ship_to: '1764718',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'APP TRI': {
    name: 'MOBILECARE - APP TRINOMA',
    address: '3rd Level, Mindanao Ave. wing, TriNoma Mall, EDSA cor North Ave, Quezon City, Metro Manila',
    full_address: '3rd Level, Mindanao Ave., TriNoma Mall, EDSA, cor North Ave, Quezon City, Metro Manila',
    contact_person: 'Jimboy Tondag',
    contact_email: 'jimboy.tondag@mobilecareph.com',
    invoice_prefix: 'TRSSR#',
    ship_to: '1764730',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'ASP VN': {
    name: 'MOBILECARE - VERTIS NORTH',
    address: '3/F Unit R1-L3-006 Ayala Malls Vertis North, Bagong Pag-Asa, Quezon City, 1100',
    full_address: 'Mobile Care Services Philippines, Inc. By Power Mac Center Vertis North, Apple Authorized Service Provider 3/F Unit R1-L3-006 Ayala Malls Vertis North, Bagong Pag-Asa Quezon City, Philippines 1100',
    contact_person: 'Cedric Matthew Carreon',
    contact_email: 'cedricmatthew.carreon@mobilecareph.com',
    invoice_prefix: 'VNSSR#',
    ship_to: '1506282',
    sold_to: '1029842',
    region: 'Metro Manila'
  },
  'ASP NES': {
    name: 'MOBILECARE - NORTHEAST SQUARE',
    address: '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila',
    full_address: '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills San Juan City, Metro Manila',
    contact_person: 'Jana Jane Teneza',
    contact_email: 'janajane.teneza@mobilecareph.com',
    invoice_prefix: 'NESSRR#',
    ship_to: '1102538',
    sold_to: '1029842',
    region: 'Metro Manila'
  },
  'APP FES': {
    name: 'MOBILECARE - APP FESTIVAL MALL',
    address: 'Space No. UGF-2274.2.1-UGF-2274.2.2, Festival Mall Alabang, Filinvest City, Muntinlupa City 1781',
    full_address: 'Space No. UGF-2274.2.1-UGF-2274.2.2, Festival Mall Alabang, Muntinlupa City 1781 PH',
    contact_person: 'Josef Victor Cruz',
    contact_email: 'josefvictor.cruz@mobilecareph.com',
    invoice_prefix: 'FESSSR#',
    ship_to: '1815657',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'ASP MRK': {
    name: 'MOBILECARE - SM MARIKINA',
    address: 'Marcos Highway, Barangay Calumpang, Marikina City, Metro Manila, Philippines',
    full_address: 'Marcos Highway, Barangay Calumpang, Marikina City, Metro Manila, Philippines',
    contact_person: 'Gian Danzel Samar',
    contact_email: 'giandanzel.samar@mobilecareph.com',
    invoice_prefix: 'MRKSSR#',
    ship_to: '1240088',
    sold_to: '1029842',
    region: 'Metro Manila'
  },
  'APP RM': {
    name: 'MOBILECARE - APP MAGNOLIA',
    address: 'Unit 211, Level 2, Robinsons Magnolia (Expansion Bldg), Aurora Blvd cor Doña Hemady St, Quezon City 1111',
    full_address: 'Unit 211, Level 2, Robinsons Magnolia (Expansion Bldg), Aurora Blvd. Doña Hemady, Kaunlaran, Quezon City, Metro Manila, 1111',
    contact_person: 'Jeffrey Ignacio',
    contact_email: 'jeffrey.ignacio@mobilecareph.com',
    invoice_prefix: 'RMSSR#',
    ship_to: '1764735',
    sold_to: '1597912',
    region: 'Metro Manila'
  },
  'ASP LIM': {
    name: 'MOBILECARE - LIMA ESTATE',
    address: 'Blk A Unit R07-08, The Outlets at Lipa, LIMA Estate, Lipa City, Batangas',
    full_address: 'Blk A Unit R07-08, The Outlets at Lima Estates, Lipa City, Batangas',
    contact_person: 'Jhim Adrian Callos',
    contact_email: 'jhimadrian.callos@mobilecareph.com',
    invoice_prefix: 'LMSSR#',
    ship_to: '1754212',
    sold_to: '1029842',
    region: 'Batangas'
  },
  'ASP NPM': {
    name: 'MOBILECARE - NEWPOINT MALL',
    address: 'Unit 1, 2F, Newpoint Mall, Doña Teresa Ave., Nepo Center, Angeles City, Pampanga 2009',
    full_address: 'Unit 1, 2F, Newpoint Mall, Doña Teresa Ave., Nepo Center, Angeles City Pampanga, Philippines, 2009',
    contact_person: 'Maurice Mojica',
    contact_email: 'maurice.mojica@mobilecareph.com',
    invoice_prefix: 'NPMSSR#',
    ship_to: '1196666',
    sold_to: '1029842',
    region: 'Pampanga'
  },
  'ASP NAG': {
    name: 'MOBILECARE - NAGA',
    address: 'Unit 101-101a, Level 1, Robinsons Naga, Roxas Ave cor Almeda Hwy, Naga City, Camarines Sur',
    full_address: 'Unit 101-101a, Level 1 Robinsons Naga, Brgy. Roxas Avenue, Cor Almeda Hwy, Naga City, Camarines Sur',
    contact_person: 'John Lloyd Agapito',
    contact_email: 'johnlloyd.agapito@mobilecareph.com',
    invoice_prefix: 'NGSSR#',
    ship_to: '1730389',
    sold_to: '1029842',
    region: 'Camarines Sur'
  },
  'ASP LAU': {
    name: 'MOBILECARE - LA UNION',
    address: 'Space 316, Level 3 Digiworld, Robinsons Place La Union, National Highway, Brgy. Sevilla, San Fernando City, La Union',
    full_address: 'Space 316, Level 3, Digiworld, Robinsons Place La Union, National Highway, Sevilla, San Fernando, La Union',
    contact_person: 'Mheynard Johanne Madarang',
    contact_email: 'mheynardjohanne.madarang@mobilecareph.com',
    invoice_prefix: 'LUSSR#',
    ship_to: '1815649',
    sold_to: '1029842',
    region: 'La Union'
  },
  'ASP ILO': {
    name: 'MOBILECARE - FESTIVE WALK ILOILO',
    address: 'G/F Festive Walk Mall, Iloilo Business Park, Airport Road, Mandurriao, Iloilo City',
    full_address: 'G/F Festive Walk Mall, Iloilo Business Park, Airport Road, Mandurriao Iloilo City',
    contact_person: 'Ileto Palencia II',
    contact_email: 'ileto.palenciaii@mobilecareph.com',
    invoice_prefix: 'ILOSSR#',
    ship_to: '1029842',
    sold_to: '1229790',
    region: 'Iloilo'
  },
  'APP ILO': {
    name: 'MOBILECARE - APP SM ILOILO',
    address: 'Cyberzone, 3/F SM City Iloilo, Senator Benigno Aquino Jr. Ave, Mandurriao, Iloilo City',
    full_address: 'Space 322-323, 3/F Cyberzone, SM City Iloilo, Mandurriao, Iloilo City 5000',
    contact_person: 'Service Manager',
    contact_email: 'app.smiloilo@mobilecareph.com',
    invoice_prefix: 'APILOSSR#',
    ship_to: '1029842',
    sold_to: '1597912',
    region: 'Iloilo'
  },
  'ASP CEB': {
    name: 'MOBILECARE - CEBU',
    address: 'Unit 4033, 4/L Robinsons Galleria Cebu, General Maxilom Ave, Cebu City 6000',
    full_address: 'MOBILECARE SERVICES PHILS. INC., 4033, 4/L ROBINSONS GALLERIA CEBU, CEBU CITY 6000 PH',
    contact_person: 'Johnaliza Amora',
    contact_email: 'johnaliza.amora@mobilecareph.com',
    invoice_prefix: 'CEBSSR#',
    ship_to: '1102534',
    sold_to: '1029842',
    region: 'Cebu'
  },
  'ASP ZAM': {
    name: 'MOBILECARE - ZAMBOANGA',
    address: '2/F East Wing, KCC Mall de Zamboanga, Gov. Camins Ave., Camino Nuevo, Zamboanga City 7000',
    full_address: 'Mobilecare Services Inc. 2/F East Wing, KCC Mall de Zamboanga, Governor Camins Avenue, Camino Nuevo, 7000',
    contact_person: 'Ruther Calumpang',
    contact_email: 'ruther.calumpang@mobilecareph.com',
    invoice_prefix: 'ZAMSSR#',
    ship_to: '1128342',
    sold_to: '1029842',
    region: 'Zamboanga'
  },
  'ASP ABR': {
    name: 'MOBILECARE - DAVAO',
    address: '2nd Floor, Abreeza Mall, JP Laurel Avenue, Bajada, Davao City, Davao del Sur 8000',
    full_address: '2nd Floor, Abreeza Mall JP Laurel Avenue, Bajada Davao City, Davao del Sur 8000',
    contact_person: 'Jerry Dimakuta',
    contact_email: 'jerry.dimakuta@mobilecareph.com',
    invoice_prefix: 'ABRSSR#',
    ship_to: '1102535',
    sold_to: '1029842',
    region: 'Davao'
  },
  'ASP COT': {
    name: 'MOBILECARE SERVICES - COTABATO',
    address: 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave, Rosary Heights 2, Cotabato City',
    full_address: 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City',
    contact_person: 'Michelle Kaye Vingno',
    contact_email: 'michellekaye.vingno@mobilecareph.com',
    invoice_prefix: 'CBOSSR#',
    region: 'Cotabato'
  },
  'ASP CDO': {
    name: 'MOBILECARE - CAGAYAN DE ORO',
    address: '2/L, East Concourse, Limketkai Mall, Limketkai Center, Cagayan De Oro City 9000',
    full_address: '2/L, East Concourse Limketkai Mall, Cagayan De Oro City 9000 PH',
    contact_person: 'Julia Gamo Inguito',
    contact_email: 'juliagamo.inguito@mobilecareph.com',
    invoice_prefix: 'CDOSRR#',
    ship_to: '1218985',
    sold_to: '1029842',
    region: 'Cagayan de Oro'
  },
  'APP LAN': {
    name: 'MOBILECARE - APP SM LANANG',
    address: '3/F Cyberzone, SM Lanang Premier, JP Laurel Ave, Lanang, Davao City, 8000',
    full_address: '3/F Cyberzone, SM Lanang Premier, JP Laurel Ave, Lanang, Davao City, 8000',
    contact_person: 'Jerry Dimakuta',
    contact_email: 'jerry.dimakuta@mobilecareph.com',
    invoice_prefix: 'LANSSR#',
    ship_to: '1102535',
    sold_to: '1029842',
    region: 'Davao'
  }
};

data.sites = data.sites.map(s => {
  const dir = directoryMap[s.code] || Object.values(directoryMap).find(d => d.name === s.name);
  if (dir) {
    return { ...s, ...dir };
  }
  return s;
});

fs.writeFileSync(seedPath, JSON.stringify(data, null, 2));
console.log('Updated seedData.json with all PMG Directory site details!');
