import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.resolve(__dirname, 'seedData.json');

const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

export const directoryMap = {
  'DC-MDC': {
    name: 'MOBILE CARE SERVICES PHILS. INC. - Distribution Center',
    address: '47 CONNECTICUT STREET NORTHEAST SAN JUAN 46 1503 Philippines',
    full_address: 'Business and Distribution Center, 47 CONNECTICUT STREET NORTHEAST SAN JUAN 46 1503 Philippines',
    contact_person: 'DC Operations',
    contact_phone: '+63 (2) 8721-1234',
    contact_email: 'dc.operations@mobilecareph.com',
    invoice_prefix: 'DCSSR#',
    ship_to: '0001029842',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'APP BHS': {
    name: 'MOBILECARE - APP BONIFACIO HIGH STREET',
    address: 'BONIFACIO HIGH ST.,FORT BONIFACIO TAGUIG CITY 46 1634 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-BHS, BONIFACIO HIGH ST.,FORT BONIFACIO TAGUIG CITY 46 1634 Philippines',
    contact_person: 'Ghibert Justine Flores',
    contact_email: 'ghibertjustine.flores@mobilecareph.com',
    invoice_prefix: 'BHSSSR#',
    ship_to: '0001836095',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'APP GB3': {
    name: 'MOBILECARE - APP GREENBELT 3',
    address: 'GREENBELT 3, AYALA CENTER MAKATI 46 1224 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-GB3, GREENBELT 3, AYALA CENTER MAKATI 46 1224 Philippines',
    contact_person: 'Joshua Malubay',
    contact_email: 'joshua.malubay@mobilecareph.com',
    invoice_prefix: 'GB3SSR#',
    ship_to: '0001645879',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'APP PPM': {
    name: 'MOBILECARE - APP POWER PLANT MALL',
    address: 'ROCKWELL CENTER BRGY. POBLACION MAKATI 46 1210 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-PPM, ROCKWELL CENTER BRGY. POBLACION MAKATI 46 1210 Philippines',
    contact_person: 'Eljon Renz Quarto',
    contact_email: 'eljonrenz.quarto@mobilecareph.com',
    invoice_prefix: 'PPMSSR#',
    ship_to: '0001603617',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'ASP GL5': {
    name: 'MOBILECARE - GLORIETTA 5',
    address: 'AYALA CENTER, MAKATI CITY 46 1221 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., AYALA CENTER, MAKATI CITY 46 1221 Philippines',
    contact_person: 'Danica Ramos',
    contact_email: 'danica.ramos@powermaccenter.com',
    invoice_prefix: 'GL5SSR#',
    ship_to: '0001102537',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'ASP SMS': {
    name: "MOBILECARE - S'MAISON",
    address: 'UNIT NOS.272-274, SECOND FLOOR PASAY 46 1300 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., UNIT NOS.272-274, SECOND FLOOR PASAY 46 1300 Philippines',
    contact_person: 'Jessabel Gregorio',
    contact_email: 'jessabel.gregorio@mobilecareph.com',
    invoice_prefix: 'SMSSSR#',
    ship_to: '0001103790',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'APP MOA': {
    name: 'MOBILECARE - APP MALL OF ASIA',
    address: 'SM MALL OF ASIA BARANGAY 76 PASAY CITY 46 1300 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-MOA, SM MALL OF ASIA BARANGAY 76 PASAY CITY 46 1300 Philippines',
    contact_person: 'Jennelyn Decastro',
    contact_email: 'jennelyn.decastro@mobilecareph.com',
    invoice_prefix: 'MOASSR#',
    ship_to: '0001645876',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'ASP POD': {
    name: 'MOBILECARE - THE PODIUM',
    address: '410, 4L, THE PODIUM, 12 ADB AVENUE MANDALUYONG CITY 46 1550 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., 410, 4L, THE PODIUM, 12 ADB AVENUE MANDALUYONG CITY 46 1550 Philippines',
    contact_person: 'Jasmil Rose Guban',
    contact_email: 'jasmilrose.guban@mobilecareph.com',
    invoice_prefix: 'PODSSR#',
    ship_to: '0001272226',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'APP MEG': {
    name: 'MOBILECARE - APP MEGAMALL',
    address: 'BLDG. B, CYBERZONE, SM MEGAMALL MANDALUYONG 46 1550 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-MEG, BLDG. B, CYBERZONE, SM MEGAMALL MANDALUYONG 46 1550 Philippines',
    contact_person: 'Eugene Deborja',
    contact_email: 'eugene.deborja@mobilecareph.com',
    invoice_prefix: 'MGSSR#',
    ship_to: '0001745440',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'APP ANX': {
    name: 'MOBILECARE - APP THE ANNEX',
    address: 'SMCITY NORTH EDSA, BRGY. STO CRISTO QUEZON CITY 46 1105 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-ANX, SMCITY NORTH EDSA, BRGY. STO CRISTO QUEZON CITY 46 1105 Philippines',
    contact_person: 'Patrick John Rino',
    contact_email: 'patrickjohn.rino@mobilecareph.com',
    invoice_prefix: 'ANSSR#',
    ship_to: '0001764718',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'APP TRI': {
    name: 'MOBILECARE - APP TRINOMA',
    address: 'NORTH AVE., BRGY. BAGONG PAG-ASA, QUEZON CITY 46 1105 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-TRI, NORTH AVE., BRGY. BAGONG PAG-ASA, QUEZON CITY 46 1105 Philippines',
    contact_person: 'Jimboy Tondag',
    contact_email: 'jimboy.tondag@mobilecareph.com',
    invoice_prefix: 'TRSSR#',
    ship_to: '0001764730',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'ASP VN': {
    name: 'MOBILECARE - VERTIS NORTH',
    address: 'VERTIS NORTH BAGONG PAG-ASA QUEZON CITY 46 1105 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., VERTIS NORTH BAGONG PAG-ASA QUEZON CITY 46 1105 Philippines',
    contact_person: 'Cedric Matthew Carreon',
    contact_email: 'cedricmatthew.carreon@mobilecareph.com',
    invoice_prefix: 'VNSSR#',
    ship_to: '0001506282',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'ASP NES': {
    name: 'MOBILECARE - NORTHEAST SQUARE',
    address: '47 CONNECTICUT ST. GREENHILLS SAN JUAN 46 1503 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., 47 CONNECTICUT ST. GREENHILLS SAN JUAN 46 1503 Philippines',
    contact_person: 'Jana Jane Teneza',
    contact_email: 'janajane.teneza@mobilecareph.com',
    invoice_prefix: 'NESSRR#',
    ship_to: '0001102538',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'APP FES': {
    name: 'MOBILECARE - APP FESTIVAL MALL',
    address: 'SPACE NO.UGF-2274.2.1-UGF-2274.2.2, MUNTINLUPA CITY 46 1781 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-FES, SPACE NO.UGF-2274.2.1-UGF-2274.2.2, MUNTINLUPA CITY 46 1781 Philippines',
    contact_person: 'Josef Victor Cruz',
    contact_email: 'josefvictor.cruz@mobilecareph.com',
    invoice_prefix: 'FESSSR#',
    ship_to: '0001815657',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'ASP MRK': {
    name: 'MOBILECARE - SM MARIKINA',
    address: 'SM CITY MARIKINA, MARCOS HIGHWAY MARIKINA 46 1801 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., SM CITY MARIKINA, MARCOS HIGHWAY MARIKINA 46 1801 Philippines',
    contact_person: 'Gian Danzel Samar',
    contact_email: 'giandanzel.samar@mobilecareph.com',
    invoice_prefix: 'MRKSSR#',
    ship_to: '0001240088',
    sold_to: '0001029842',
    region: 'Metro Manila'
  },
  'APP RM': {
    name: 'MOBILECARE - APP MAGNOLIA',
    address: 'DOÑA HEMADY,NEW MANILA, QUEZON CITY 46 1111 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-MAG, DOÑA HEMADY,NEW MANILA, QUEZON CITY 46 1111 Philippines',
    contact_person: 'Jeffrey Ignacio',
    contact_email: 'jeffrey.ignacio@mobilecareph.com',
    invoice_prefix: 'RMSSR#',
    ship_to: '0001764735',
    sold_to: '0001597912',
    region: 'Metro Manila'
  },
  'ASP LIM': {
    name: 'MOBILECARE - LIMA ESTATE',
    address: 'SPECIAL ECONOMIC ZONE LIPA CITY, BATANGAS 4217 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS.INC.-LIMA, SPECIAL ECONOMIC ZONE LIPA CITY, BATANGAS 4217 Philippines',
    contact_person: 'Jhim Adrian Callos',
    contact_email: 'jhimadrian.callos@mobilecareph.com',
    invoice_prefix: 'LMSSR#',
    ship_to: '0001754212',
    sold_to: '0001029842',
    region: 'Batangas'
  },
  'ASP NPM': {
    name: 'MOBILECARE - NEWPOINT MALL',
    address: 'NEPO CENTER, ANGELES CITY, PAMPANGA 59 2009 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., NEPO CENTER, ANGELES CITY, PAMPANGA 59 2009 Philippines',
    contact_person: 'Maurice Mojica',
    contact_email: 'maurice.mojica@mobilecareph.com',
    invoice_prefix: 'NPMSSR#',
    ship_to: '0001196666',
    sold_to: '0001029842',
    region: 'Pampanga'
  },
  'ASP NAG': {
    name: 'MOBILECARE - NAGA',
    address: 'BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS.INC.-NAGA, BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
    contact_person: 'John Lloyd Agapito',
    contact_email: 'johnlloyd.agapito@mobilecareph.com',
    invoice_prefix: 'NGSSR#',
    ship_to: '0001730389',
    sold_to: '0001029842',
    region: 'Camarines Sur'
  },
  'ASP LAU': {
    name: 'MOBILECARE - LA UNION',
    address: 'SPACE NO.: 316, LEVEL 3, DIGIWORLD SAN FERNANDO, LA UNION 38 2500 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-LAU, SPACE NO.: 316, LEVEL 3, DIGIWORLD SAN FERNANDO, LA UNION 38 2500 Philippines',
    contact_person: 'Mheynard Johanne Madarang',
    contact_email: 'mheynardjohanne.madarang@mobilecareph.com',
    invoice_prefix: 'LUSSR#',
    ship_to: '0001815649',
    sold_to: '0001029842',
    region: 'La Union'
  },
  'ASP ILO': {
    name: 'MOBILECARE - FESTIVE WALK ILOILO',
    address: 'FESTIVE WALK MALL ILOILO CITY 35 5000 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., FESTIVE WALK MALL ILOILO CITY 35 5000 Philippines',
    contact_person: 'Ileto Palencia II',
    contact_email: 'ileto.palenciaii@mobilecareph.com',
    invoice_prefix: 'ILOSSR#',
    ship_to: '0001229790',
    sold_to: '0001029842',
    region: 'Iloilo'
  },
  'APP ILO': {
    name: 'MOBILECARE - APP SM ILOILO',
    address: 'EX356-358,3RD LEVEL,CYBERZONE MANDURRIAO SM CITY ILOILO 35 1634 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., EX356-358,3RD LEVEL,CYBERZONE MANDURRIAO SM CITY ILOILO 35 1634 Philippines',
    contact_person: 'Service Manager',
    contact_email: 'app.smiloilo@mobilecareph.com',
    invoice_prefix: 'APILOSSR#',
    ship_to: '0001856196',
    sold_to: '0001597912',
    region: 'Iloilo'
  },
  'ASP CEB': {
    name: 'MOBILECARE - CEBU',
    address: '4033, 4/L ROBINSONS GALLERIA CEBU CEBU CITY 25 6000 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., 4033, 4/L ROBINSONS GALLERIA CEBU CEBU CITY 25 6000 Philippines',
    contact_person: 'Johnaliza Amora',
    contact_email: 'johnaliza.amora@mobilecareph.com',
    invoice_prefix: 'CEBSSR#',
    ship_to: '0001102534',
    sold_to: '0001029842',
    region: 'Cebu'
  },
  'ASP ZAM': {
    name: 'MOBILECARE - ZAMBOANGA',
    address: 'GOV. CAMINS, CAMINO NUEVO, ZAMBOANGA 79 7000 Philippines',
    full_address: 'MOBILECARE SVCS PHILS INC@ZAMBOANGA, GOV. CAMINS, CAMINO NUEVO, ZAMBOANGA 79 7000 Philippines',
    contact_person: 'Ruther Calumpang',
    contact_email: 'ruther.calumpang@mobilecareph.com',
    invoice_prefix: 'ZAMSSR#',
    ship_to: '0001128342',
    sold_to: '0001029842',
    region: 'Zamboanga'
  },
  'ASP ABR': {
    name: 'MOBILECARE - DAVAO',
    address: 'J.P. LAUREL AVE. DAVAO CITY 27 8000 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., J.P. LAUREL AVE. DAVAO CITY 27 8000 Philippines',
    contact_person: 'Jerry Dimakuta',
    contact_email: 'jerry.dimakuta@mobilecareph.com',
    invoice_prefix: 'ABRSSR#',
    ship_to: '0001102535',
    sold_to: '0001029842',
    region: 'Davao'
  },
  'ASP COT': {
    name: 'MOBILECARE SERVICES - COTABATO',
    address: 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave, Rosary Heights 2, Cotabato City 9600 Philippines',
    full_address: 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City 9600 Philippines',
    contact_person: 'Michelle Kaye Vingno',
    contact_email: 'michellekaye.vingno@mobilecareph.com',
    invoice_prefix: 'CBOSSR#',
    ship_to: null,
    sold_to: null,
    region: 'Cotabato'
  },
  'ASP CDO': {
    name: 'MOBILECARE - CAGAYAN DE ORO',
    address: '2/L,EAST CONCOURSE LIMKETKAI MALL CAGAYAN DE ORO CITY 48 9000 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC., 2/L,EAST CONCOURSE LIMKETKAI MALL CAGAYAN DE ORO CITY 48 9000 Philippines',
    contact_person: 'Julia Gamo Inguito',
    contact_email: 'juliagamo.inguito@mobilecareph.com',
    invoice_prefix: 'CDOSRR#',
    ship_to: '0001218985',
    sold_to: '0001029842',
    region: 'Cagayan de Oro'
  },
  'APP LAN': {
    name: 'MOBILECARE - APP SM LANANG',
    address: 'JP LAUREL AVE. DAVAO CITY 8000 Philippines',
    full_address: 'MOBILECARE SERVICES PHILS. INC.-LAN, JP LAUREL AVE. DAVAO CITY 8000 Philippines',
    contact_person: 'Jerry Dimakuta',
    contact_email: 'jerry.dimakuta@mobilecareph.com',
    invoice_prefix: 'LANSSR#',
    ship_to: '0001836101',
    sold_to: '0001597912',
    region: 'Davao'
  }
};

data.sites = data.sites.map(s => {
  // Correct site-20 code to ASP ILO if it was set to APP ILO with Festive Walk name
  if (s.id === 'site-20' || (s.name && s.name.includes('FESTIVE WALK'))) {
    s.code = 'ASP ILO';
  }
  const dir = directoryMap[s.code] || Object.values(directoryMap).find(d => d.name === s.name);
  if (dir) {
    return { ...s, ...dir };
  }
  return s;
});

fs.writeFileSync(seedPath, JSON.stringify(data, null, 2));
console.log('Updated seedData.json with authoritative GSX site addresses and Ship-To numbers!');
