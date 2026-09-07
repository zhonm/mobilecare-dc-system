-- MDC SYSTEM 2: Authoritative Site Addresses, GSX Ship-To Location Numbers & Supervisor Details Update
-- Generated from Official GSX Directory and Supervisor Registry

ALTER TABLE sites ADD COLUMN IF NOT EXISTS ship_to TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS sold_to TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS invoice_prefix TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS full_address TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS city TEXT;

-- Distribution Center (DC-MDC)
UPDATE sites SET
  ship_to = '0001029842',
  sold_to = '0001029842',
  invoice_prefix = 'DCSSR#',
  contact_person = 'DC Operations',
  contact_phone = '+63 (2) 8721-1234',
  contact_email = 'dc.operations@mobilecareph.com',
  address = '47 CONNECTICUT STREET NORTHEAST SAN JUAN 46 1503 Philippines',
  full_address = 'Business and Distribution Center, 47 CONNECTICUT STREET NORTHEAST SAN JUAN 46 1503 Philippines'
WHERE code IN ('DC', 'DC-MDC') OR is_dc = true;

-- ASP NES (Northeast Square)
UPDATE sites SET
  ship_to = '0001102538',
  sold_to = '0001029842',
  invoice_prefix = 'NESSRR#',
  contact_person = 'JOHN JAMES SEGOVIA',
  contact_phone = '0999-6684460',
  contact_email = 'johnjames.segovia@mobilecareph.com',
  address = '47 CONNECTICUT ST. GREENHILLS SAN JUAN 46 1503 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., 47 CONNECTICUT ST. GREENHILLS SAN JUAN 46 1503 Philippines'
WHERE (code IN ('NES', 'ASP NES', 'ASP_NES') OR name ILIKE '%NORTH EAST SQUARE%' OR name ILIKE '%NORTHEAST%') AND is_dc = false AND code NOT LIKE 'APP%';

-- ASP NPM (Newpoint Mall)
UPDATE sites SET
  ship_to = '0001196666',
  sold_to = '0001029842',
  invoice_prefix = 'NPMSSR#',
  contact_person = 'ALLELLEY SUBA',
  contact_phone = '0976-0409935',
  contact_email = 'allelley.suba@mobilecareph.com',
  address = 'NEPO CENTER, ANGELES CITY, PAMPANGA 59 2009 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., NEPO CENTER, ANGELES CITY, PAMPANGA 59 2009 Philippines'
WHERE code IN ('NPM', 'ASP NPM', 'ASP_NPM') OR name ILIKE '%NEW POINT%' OR name ILIKE '%NEWPOINT%';

-- ASP LIM (Lima Estate)
UPDATE sites SET
  ship_to = '0001754212',
  sold_to = '0001029842',
  invoice_prefix = 'LMSSR#',
  contact_person = 'SHARMAINE ESPEJO',
  contact_phone = '0917-1075392',
  contact_email = 'sharmaine.espejo@mobilecareph.com',
  address = 'SPECIAL ECONOMIC ZONE LIPA CITY, BATANGAS 4217 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS.INC.-LIMA, SPECIAL ECONOMIC ZONE LIPA CITY, BATANGAS 4217 Philippines'
WHERE code IN ('TOL', 'LIM', 'ASP LIM', 'ASP_LIM', 'ASP TOL') OR name ILIKE '%LIMA%' OR name ILIKE '%OUTLETS%';

-- ASP POD (The Podium)
UPDATE sites SET
  ship_to = '0001272226',
  sold_to = '0001029842',
  invoice_prefix = 'PODSSR#',
  contact_person = 'JOHN PAUL REVILLA',
  contact_phone = '0969-0120395',
  contact_email = 'paulangelo.revilla@mobilecareph.com',
  address = '410, 4L, THE PODIUM, 12 ADB AVENUE MANDALUYONG CITY 46 1550 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., 410, 4L, THE PODIUM, 12 ADB AVENUE MANDALUYONG CITY 46 1550 Philippines'
WHERE code IN ('POD', 'ASP POD', 'ASP_POD') OR name ILIKE '%PODIUM%';

-- ASP ABR (Abreeza Davao)
UPDATE sites SET
  ship_to = '0001102535',
  sold_to = '0001029842',
  invoice_prefix = 'ABRSSR#',
  contact_person = 'ROSHELL VANZUELA',
  contact_phone = '0955-6020351',
  contact_email = 'roshell.saballa@mobilecareph.com',
  address = 'J.P. LAUREL AVE. DAVAO CITY 27 8000 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., J.P. LAUREL AVE. DAVAO CITY 27 8000 Philippines'
WHERE code IN ('ABR', 'ABZ', 'ASP ABR', 'ASP_ABR', 'ASP ABZ') OR (name ILIKE '%ABREEZA%' OR (name ILIKE '%DAVAO%' AND name NOT ILIKE '%LANANG%' AND code NOT LIKE 'APP%'));

-- ASP CEB (Robinsons Galleria Cebu)
UPDATE sites SET
  ship_to = '0001102534',
  sold_to = '0001029842',
  invoice_prefix = 'CEBSSR#',
  contact_person = 'GLADYS SICAT (AM)',
  contact_phone = '0997-4851174',
  contact_email = 'gladys.sicat@mobilecareph.com',
  address = '4033, 4/L ROBINSONS GALLERIA CEBU CEBU CITY 25 6000 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., 4033, 4/L ROBINSONS GALLERIA CEBU CEBU CITY 25 6000 Philippines'
WHERE code IN ('CEB', 'ASP CEB', 'ASP_CEB') OR name ILIKE '%ROBINSONS GALLERIA%CEBU%' OR name ILIKE '%CEBU%';

-- ASP ZAM (Zamboanga)
UPDATE sites SET
  ship_to = '0001128342',
  sold_to = '0001029842',
  invoice_prefix = 'ZAMSSR#',
  contact_person = 'RONALD DIAZ',
  contact_phone = '0908-8959684',
  contact_email = 'ronald.diaz@mobilecareph.com',
  address = 'GOV. CAMINS, CAMINO NUEVO, ZAMBOANGA 79 7000 Philippines',
  full_address = 'MOBILECARE SVCS PHILS INC@ZAMBOANGA, GOV. CAMINS, CAMINO NUEVO, ZAMBOANGA 79 7000 Philippines'
WHERE code IN ('ZAM', 'ZMB', 'ASP ZAM', 'ASP_ZAM') OR name ILIKE '%ZAMBOANGA%';

-- ASP NAG (Robinsons Naga)
UPDATE sites SET
  ship_to = '0001730389',
  sold_to = '0001029842',
  invoice_prefix = 'NGSSR#',
  contact_person = 'CAROLINE DACER',
  contact_phone = '0947-8716519',
  contact_email = 'caroline.dacer@mobilecareph.com',
  address = 'BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS.INC.-NAGA, BRGY ROXAS AVENUE, COR ALMEDA HWY NAGA, CAMARINES SUR 4400 Philippines'
WHERE code IN ('RNG', 'NAG', 'ASP NAG', 'ASP_NAG', 'ASP RNG') OR name ILIKE '%NAGA%' OR name ILIKE '%ROBINSONS NAGA%';

-- ASP SMS (S'Maison Conrad Manila)
UPDATE sites SET
  ship_to = '0001103790',
  sold_to = '0001029842',
  invoice_prefix = 'SMSSSR#',
  contact_person = 'KEIRONE MCILVAINE BAUTISTA',
  contact_phone = '0919-8281889',
  contact_email = 'keironemcilvaine.bautista@mobilecareph.com',
  address = 'UNIT NOS.272-274, SECOND FLOOR PASAY 46 1300 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., UNIT NOS.272-274, SECOND FLOOR PASAY 46 1300 Philippines'
WHERE code IN ('SMN', 'SMS', 'ASP SMS', 'ASP_SMS', 'ASP SMN') OR name ILIKE '%S MAISON%' OR name ILIKE '%SMAISON%';

-- ASP ILO (Festive Walk Iloilo)
UPDATE sites SET
  code = 'ASP ILO',
  ship_to = '0001229790',
  sold_to = '0001029842',
  invoice_prefix = 'ILOSSR#',
  contact_person = 'CHARM PRINCESS ABILA',
  contact_phone = '0962-1734658',
  contact_email = 'princesscharm.abila@mobilecareph.com',
  address = 'FESTIVE WALK MALL ILOILO CITY 35 5000 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., FESTIVE WALK MALL ILOILO CITY 35 5000 Philippines'
WHERE code IN ('ILO', 'ASP ILO', 'ASP_ILO') OR name ILIKE '%FESTIVE WALK%';

-- ASP GL5 (Glorietta 5)
UPDATE sites SET
  ship_to = '0001102537',
  sold_to = '0001029842',
  invoice_prefix = 'GL5SSR#',
  contact_person = 'RAUL THOMAS CLOMA',
  contact_phone = '0939-3365339',
  contact_email = 'raulthomas.cloma@mobilecareph.com',
  address = 'AYALA CENTER, MAKATI CITY 46 1221 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., AYALA CENTER, MAKATI CITY 46 1221 Philippines'
WHERE code IN ('GL5', 'ASP GL5', 'ASP_GL5') OR name ILIKE '%GLORIETTA 5%' OR name ILIKE '%GLORIETTA5%';

-- ASP CDO (Limketkai Mall CDO)
UPDATE sites SET
  ship_to = '0001218985',
  sold_to = '0001029842',
  invoice_prefix = 'CDOSRR#',
  contact_person = 'INAH CONTA',
  contact_phone = '0936-4578411',
  contact_email = 'inahmarie.conta@mobilecareph.com',
  address = '2/L,EAST CONCOURSE LIMKETKAI MALL CAGAYAN DE ORO CITY 48 9000 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., 2/L,EAST CONCOURSE LIMKETKAI MALL CAGAYAN DE ORO CITY 48 9000 Philippines'
WHERE code IN ('CDO', 'ASP CDO', 'ASP_CDO') OR name ILIKE '%LIMKETKAI%' OR name ILIKE '%CAGAYAN%';

-- ASP LAU (Robinsons Place La Union)
UPDATE sites SET
  ship_to = '0001815649',
  sold_to = '0001029842',
  invoice_prefix = 'LUSSR#',
  contact_person = 'FELIX MENDORIO',
  contact_phone = '0927-1664281',
  contact_email = 'felix.mendiorojr@mobilecareph.com',
  address = 'SPACE NO.: 316, LEVEL 3, DIGIWORLD SAN FERNANDO, LA UNION 38 2500 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-LAU, SPACE NO.: 316, LEVEL 3, DIGIWORLD SAN FERNANDO, LA UNION 38 2500 Philippines'
WHERE code IN ('LAU', 'ASP LAU', 'ASP_LAU') OR name ILIKE '%LA UNION%' OR name ILIKE '%ROBINSONS LA UNION%';

-- ASP VN (Vertis North)
UPDATE sites SET
  ship_to = '0001506282',
  sold_to = '0001029842',
  invoice_prefix = 'VNSSR#',
  contact_person = 'MARC AARON LITAO',
  contact_phone = '0961-2379121',
  contact_email = 'marcaaron.litao@mobilecareph.com',
  address = 'VERTIS NORTH BAGONG PAG-ASA QUEZON CITY 46 1105 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., VERTIS NORTH BAGONG PAG-ASA QUEZON CITY 46 1105 Philippines'
WHERE code IN ('VTN', 'ASP VN', 'ASP_VN', 'VN') OR name ILIKE '%VERTIS NORTH%';

-- ASP MRK (SM Marikina)
UPDATE sites SET
  ship_to = '0001240088',
  sold_to = '0001029842',
  invoice_prefix = 'MRKSSR#',
  contact_person = 'JOHN FRANCIS MADRONIO',
  contact_phone = '0927-6554756',
  contact_email = 'john.madronio@mobilecareph.com',
  address = 'SM CITY MARIKINA, MARCOS HIGHWAY MARIKINA 46 1801 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., SM CITY MARIKINA, MARCOS HIGHWAY MARIKINA 46 1801 Philippines'
WHERE code IN ('SMM', 'ASP MRK', 'MRK', 'ASP_MRK') OR name ILIKE '%SM MARIKINA%' OR name ILIKE '%MARIKINA%';

-- ASP COT (KCC Mall Cotabato)
UPDATE sites SET
  ship_to = NULL,
  sold_to = NULL,
  invoice_prefix = 'CBOSSR#',
  contact_person = 'ALLEN JOYCE AGUIT',
  contact_phone = '0955-0271729',
  contact_email = 'allynjoyce.aguit@mobilecareph.com',
  address = 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave, Rosary Heights 2, Cotabato City 9600 Philippines',
  full_address = 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City 9600 Philippines'
WHERE code IN ('COT', 'ASP COT', 'ASP_COT') OR name ILIKE '%COTABATO%';

-- APP LAN (SM Lanang Premier Davao)
UPDATE sites SET
  ship_to = '0001836101',
  sold_to = '0001597912',
  invoice_prefix = 'LANSSR#',
  contact_person = 'ROSHELL VANZUELA',
  contact_phone = '0955-6020351',
  contact_email = 'roshell.saballa@mobilecareph.com',
  address = 'JP LAUREL AVE. DAVAO CITY 8000 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-LAN, JP LAUREL AVE. DAVAO CITY 8000 Philippines'
WHERE code IN ('LAN', 'APP LAN', 'APP_LAN') OR name ILIKE '%SM LANANG%' OR name ILIKE '%LANANG%';

-- APP ILO (SM City Iloilo)
UPDATE sites SET
  ship_to = '0001856196',
  sold_to = '0001597912',
  invoice_prefix = 'APILOSSR#',
  contact_person = 'CHARM PRINCESS ABILA',
  contact_phone = '0962-1734658',
  contact_email = 'princesscharm.abila@mobilecareph.com',
  address = 'EX356-358,3RD LEVEL,CYBERZONE MANDURRIAO SM CITY ILOILO 35 1634 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC., EX356-358,3RD LEVEL,CYBERZONE MANDURRIAO SM CITY ILOILO 35 1634 Philippines'
WHERE code IN ('APP ILO', 'APP_ILO', 'APPILO') AND name ILIKE '%SM ILOILO%';

-- APP BHS (Bonifacio High Street)
UPDATE sites SET
  ship_to = '0001836095',
  sold_to = '0001597912',
  invoice_prefix = 'BHSSSR#',
  contact_person = 'MA. PARTRICIA BAGARES',
  contact_phone = '0966-9135692',
  contact_email = 'patricia.bagares@mobilecareph.com',
  address = 'BONIFACIO HIGH ST.,FORT BONIFACIO TAGUIG CITY 46 1634 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-BHS, BONIFACIO HIGH ST.,FORT BONIFACIO TAGUIG CITY 46 1634 Philippines'
WHERE code IN ('BHS', 'APP BHS', 'APP_BHS') OR name ILIKE '%BONIFACIO HIGH STREET%' OR name ILIKE '%BGC%';

-- APP GB3 (Greenbelt 3)
UPDATE sites SET
  ship_to = '0001645879',
  sold_to = '0001597912',
  invoice_prefix = 'GB3SSR#',
  contact_person = 'AILA CASSANDRA DE GALA',
  contact_phone = '0917-9294265',
  contact_email = 'cassandraaila.degala@mobilecareph.com',
  address = 'GREENBELT 3, AYALA CENTER MAKATI 46 1224 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-GB3, GREENBELT 3, AYALA CENTER MAKATI 46 1224 Philippines'
WHERE code IN ('GB3', 'APP GB3', 'APP_GB3') OR name ILIKE '%GREENBELT 3%' OR name ILIKE '%GREENBELT3%';

-- APP FES (Festival Mall Alabang)
UPDATE sites SET
  ship_to = '0001815657',
  sold_to = '0001597912',
  invoice_prefix = 'FESSSR#',
  contact_person = 'FRANCHESCA MACALINAO',
  contact_phone = '0915-2010819',
  contact_email = 'franscesca.macalinao@mobilecareph.com',
  address = 'SPACE NO.UGF-2274.2.1-UGF-2274.2.2, MUNTINLUPA CITY 46 1781 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-FES, SPACE NO.UGF-2274.2.1-UGF-2274.2.2, MUNTINLUPA CITY 46 1781 Philippines'
WHERE code IN ('FMA', 'FES', 'APP FES', 'APP_FES', 'APP FMA') OR (name ILIKE '%FESTIVAL%' AND code LIKE 'APP%');

-- APP PPM (Power Plant Mall)
UPDATE sites SET
  ship_to = '0001603617',
  sold_to = '0001597912',
  invoice_prefix = 'PPMSSR#',
  contact_person = 'JOHN NITMARI ESPIRITU',
  contact_phone = '0915-4520862',
  contact_email = 'johnnitimari.espiritu@mobilecareph.com',
  address = 'ROCKWELL CENTER BRGY. POBLACION MAKATI 46 1210 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-PPM, ROCKWELL CENTER BRGY. POBLACION MAKATI 46 1210 Philippines'
WHERE code IN ('PPM', 'APP PPM', 'APP_PPM') OR name ILIKE '%POWER PLANT%';

-- APP RM (Robinsons Magnolia)
UPDATE sites SET
  ship_to = '0001764735',
  sold_to = '0001597912',
  invoice_prefix = 'RMSSR#',
  contact_person = 'EDWARD RUSSEL VISTAN',
  contact_phone = '0968-7403586',
  contact_email = 'edwardrussel.vistan@mobilecareph.com',
  address = 'DOÑA HEMADY,NEW MANILA, QUEZON CITY 46 1111 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-MAG, DOÑA HEMADY,NEW MANILA, QUEZON CITY 46 1111 Philippines'
WHERE code IN ('RMG', 'RM', 'APP RM', 'APP_RM', 'APP RMG') OR name ILIKE '%ROBINSONS MAGNOLIA%' OR name ILIKE '%MAGNOLIA%';

-- APP TRI (TriNoma)
UPDATE sites SET
  ship_to = '0001764730',
  sold_to = '0001597912',
  invoice_prefix = 'TRSSR#',
  contact_person = 'JIMBOY TONDAG',
  contact_phone = '0926-6975495',
  contact_email = 'jimboy.tondag@mobilecareph.com',
  address = 'NORTH AVE., BRGY. BAGONG PAG-ASA, QUEZON CITY 46 1105 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-TRI, NORTH AVE., BRGY. BAGONG PAG-ASA, QUEZON CITY 46 1105 Philippines'
WHERE code IN ('TRI', 'APP TRI', 'APP_TRI') OR name ILIKE '%TRINOMA%';

-- APP MOA (SM Mall of Asia)
UPDATE sites SET
  ship_to = '0001645876',
  sold_to = '0001597912',
  invoice_prefix = 'MOASSR#',
  contact_person = 'JAY IAN DULAY',
  contact_phone = '0995-4385493',
  contact_email = 'jayian.dulay@mobilecareph.com',
  address = 'SM MALL OF ASIA BARANGAY 76 PASAY CITY 46 1300 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-MOA, SM MALL OF ASIA BARANGAY 76 PASAY CITY 46 1300 Philippines'
WHERE code IN ('MOA', 'APP MOA', 'APP_MOA') OR name ILIKE '%MALL OF ASIA%';

-- APP MEG (SM Megamall)
UPDATE sites SET
  ship_to = '0001745440',
  sold_to = '0001597912',
  invoice_prefix = 'MGSSR#',
  contact_person = 'LEANDRO LEE',
  contact_phone = '0917-4761344',
  contact_email = 'leandro.lee@mobilecareph.com',
  address = 'BLDG. B, CYBERZONE, SM MEGAMALL MANDALUYONG 46 1550 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-MEG, BLDG. B, CYBERZONE, SM MEGAMALL MANDALUYONG 46 1550 Philippines'
WHERE code IN ('SME', 'MEG', 'APP MEG', 'APP_MEG', 'APP SME') OR name ILIKE '%MEGAMALL%' OR name ILIKE '%SM MEGA%';

-- APP ANX (SM City North EDSA The Annex)
UPDATE sites SET
  ship_to = '0001764718',
  sold_to = '0001597912',
  invoice_prefix = 'ANSSR#',
  contact_person = 'RANDAL ESGUERRA',
  contact_phone = '0995-9201560',
  contact_email = 'randallchristian.esguerra@mobilecareph.com',
  address = 'SMCITY NORTH EDSA, BRGY. STO CRISTO QUEZON CITY 46 1105 Philippines',
  full_address = 'MOBILECARE SERVICES PHILS. INC.-ANX, SMCITY NORTH EDSA, BRGY. STO CRISTO QUEZON CITY 46 1105 Philippines'
WHERE code IN ('SMA', 'ANX', 'APP ANX', 'APP_ANX', 'APP SMA') OR name ILIKE '%SM ANNEX%' OR name ILIKE '%THE ANNEX%';
