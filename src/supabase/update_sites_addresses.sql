  ALTER TABLE sites ADD COLUMN IF NOT EXISTS ship_to TEXT;
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS sold_to TEXT;
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS invoice_prefix TEXT;
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS contact_email TEXT;
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS full_address TEXT;
  ALTER TABLE sites ADD COLUMN IF NOT EXISTS city TEXT;

  UPDATE sites SET
    ship_to = '1506282',
    sold_to = '1029842',
    invoice_prefix = 'VNSSR#',
    contact_email = 'cedricmatthew.carreon@mobilecareph.com',
    address = '3/F Unit R1-L3-006 Ayala Malls Vertis North, Bagong Pag-Asa, Quezon City, 1100',
    full_address = 'Mobile Care Services Philippines, Inc. By Power Mac Center Vertis North, Apple Authorized Service Provider 3/F Unit R1-L3-006 Ayala Malls Vertis North, Bagong Pag-Asa Quezon City, Philippines 1100'
  WHERE code IN ('VTN', 'ASP VN', 'ASP_VN', 'VN') OR name ILIKE '%VERTIS NORTH%';

  UPDATE sites SET
    ship_to = '1272226',
    sold_to = '1029842',
    invoice_prefix = 'PODSSR#',
    contact_email = 'jasmilrose.guban@mobilecareph.com',
    address = '4/F, The Podium, 12 ADB Ave, Ortigas Center, Mandaluyong City, 1550 Metro Manila',
    full_address = '4/F, The Podium, 12 ADB Ave, Ortigas Center, Mandaluyong City, 1550 Metro Manila'
  WHERE code IN ('POD', 'ASP POD', 'ASP_POD') OR name ILIKE '%PODIUM%';

  UPDATE sites SET
    ship_to = '1240088',
    sold_to = '1029842',
    invoice_prefix = 'MRKSSR#',
    contact_email = 'giandanzel.samar@mobilecareph.com',
    address = 'Marcos Highway, Barangay Calumpang, Marikina City, Metro Manila, Philippines',
    full_address = 'Marcos Highway, Barangay Calumpang, Marikina City, Metro Manila, Philippines'
  WHERE code IN ('SMM', 'ASP MRK', 'MRK', 'ASP_MRK') OR name ILIKE '%SM MARIKINA%' OR name ILIKE '%MARIKINA%';

  UPDATE sites SET
    ship_to = '1102538',
    sold_to = '1029842',
    invoice_prefix = 'NESSRR#',
    contact_email = 'janajane.teneza@mobilecareph.com',
    address = '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila',
    full_address = '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills San Juan City, Metro Manila'
  WHERE code IN ('NES', 'ASP NES', 'ASP_NES') OR name ILIKE '%NORTH EAST SQUARE%' OR name ILIKE '%NORTHEAST%';

  UPDATE sites SET
    ship_to = '1102537',
    sold_to = '1029842',
    invoice_prefix = 'GL5SSR#',
    contact_email = 'danica.ramos@powermaccenter.com',
    address = 'Unit 329 3/F Glorietta 5, Ayala Center, Brgy. San Lorenzo, Makati City, Metro Manila',
    full_address = 'Unit 329 3/F Glorietta St., 5 Ayala Center, Brgy. San Lorenzo Makati City, Metro Manila'
  WHERE code IN ('GL5', 'ASP GL5', 'ASP_GL5') OR name ILIKE '%GLORIETTA 5%' OR name ILIKE '%GLORIETTA5%';

  UPDATE sites SET
    ship_to = '1103790',
    sold_to = '1029842',
    invoice_prefix = 'SMSSSR#',
    contact_email = 'jessabel.gregorio@mobilecareph.com',
    address = '2/L, S Maison at Conrad Manila, Seaside Blvd., Coral Way, MOA Complex, Brgy. 76, Pasay City, 1300',
    full_address = '2/L, Smaison At Conrad Manila, Seaside Blvd., Coral Way, Moa Complex, Brgy. 76 Pasay City, 1300'
  WHERE code IN ('SMN', 'SMS', 'ASP SMS', 'ASP_SMS', 'ASP SMN') OR name ILIKE '%S MAISON%' OR name ILIKE '%SMAISON%';

  UPDATE sites SET
    ship_to = '1597912',
    sold_to = '1645876',
    invoice_prefix = 'MOASSR#',
    contact_email = 'jennelyn.decastro@mobilecareph.com',
    address = '2/L North Parking Building, Cyberzone, SM Mall of Asia, Barangay 76, Pasay City',
    full_address = '2/L North Parking Building Cyberzone Power Mac Center SM Mall Of Asia Barangay 76 Pasay City'
  WHERE code IN ('MOA', 'APP MOA', 'APP_MOA') OR name ILIKE '%MALL OF ASIA%';

  UPDATE sites SET
    ship_to = '1603617',
    sold_to = '1597912',
    invoice_prefix = 'PPMSSR#',
    contact_email = 'eljonrenz.quarto@mobilecareph.com',
    address = 'Power Mac Center R2 Level, Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila',
    full_address = 'Power Mac Center R2 Level Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila'
  WHERE code IN ('PPM', 'APP PPM', 'APP_PPM') OR name ILIKE '%POWER PLANT%';

  UPDATE sites SET
    ship_to = '1645879',
    sold_to = '1597912',
    invoice_prefix = 'GB3SSR#',
    contact_email = 'joshua.malubay@mobilecareph.com',
    address = 'Space Nos. 214-215, 2/F, Greenbelt 3, Greenbelt Complex, Ayala Center, Brgy. San Lorenzo, Makati City 1228',
    full_address = 'Space Nos. 214-215, 2/F, Greenbelt 3, Greenbelt Complex, Ayala Center Brgy. Lorenzo, Makati City 1228'
  WHERE code IN ('GB3', 'APP GB3', 'APP_GB3') OR name ILIKE '%GREENBELT 3%' OR name ILIKE '%GREENBELT3%';

  UPDATE sites SET
    ship_to = '1196666',
    sold_to = '1029842',
    invoice_prefix = 'NPMSSR#',
    contact_email = 'maurice.mojica@mobilecareph.com',
    address = 'Unit 1, 2F, Newpoint Mall, Doña Teresa Ave., Nepo Center, Angeles City, Pampanga 2009',
    full_address = 'Unit 1, 2F, Newpoint Mall, Doña Teresa Ave., Nepo Center, Angeles City Pampanga, Philippines, 2009'
  WHERE code IN ('NPM', 'ASP NPM', 'ASP_NPM') OR name ILIKE '%NEW POINT%' OR name ILIKE '%NEWPOINT%';

  UPDATE sites SET
    ship_to = '1102534',
    sold_to = '1029842',
    invoice_prefix = 'CEBSSR#',
    contact_email = 'johnaliza.amora@mobilecareph.com',
    address = 'Unit 4033, 4/L Robinsons Galleria Cebu, General Maxilom Ave, Cebu City 6000',
    full_address = 'MOBILECARE SERVICES PHILS. INC., 4033, 4/L ROBINSONS GALLERIA CEBU, CEBU CITY 6000 PH'
  WHERE code IN ('CEB', 'ASP CEB', 'ASP_CEB') OR name ILIKE '%ROBINSONS GALLERIA%CEBU%' OR name ILIKE '%CEBU%';

  UPDATE sites SET
    ship_to = '1102535',
    sold_to = '1029842',
    invoice_prefix = 'ABRSSR#',
    contact_email = 'jerry.dimakuta@mobilecareph.com',
    address = '2nd Floor, Abreeza Mall, JP Laurel Avenue, Bajada, Davao City, Davao del Sur 8000',
    full_address = '2nd Floor, Abreeza Mall JP Laurel Avenue, Bajada Davao City, Davao del Sur 8000'
  WHERE code IN ('ABR', 'ABZ', 'ASP ABR', 'ASP_ABR', 'ASP ABZ') OR name ILIKE '%ABREEZA%' OR (name ILIKE '%DAVAO%' AND name NOT ILIKE '%LANANG%');

  UPDATE sites SET
    ship_to = '1128342',
    sold_to = '1029842',
    invoice_prefix = 'ZAMSSR#',
    contact_email = 'ruther.calumpang@mobilecareph.com',
    address = '2/F East Wing, KCC Mall de Zamboanga, Gov. Camins Ave., Camino Nuevo, Zamboanga City 7000',
    full_address = 'Mobilecare Services Inc. 2/F East Wing, KCC Mall de Zamboanga, Governor Camins Avenue, Camino Nuevo, 7000'
  WHERE code IN ('ZAM', 'ZMB', 'ASP ZAM', 'ASP_ZAM') OR name ILIKE '%ZAMBOANGA%';

  UPDATE sites SET
    ship_to = '1218985',
    sold_to = '1029842',
    invoice_prefix = 'CDOSRR#',
    contact_email = 'juliagamo.inguito@mobilecareph.com',
    address = '2/L, East Concourse, Limketkai Mall, Limketkai Center, Cagayan De Oro City 9000',
    full_address = '2/L, East Concourse Limketkai Mall, Cagayan De Oro City 9000 PH'
  WHERE code IN ('CDO', 'ASP CDO', 'ASP_CDO') OR name ILIKE '%LIMKETKAI%' OR name ILIKE '%CAGAYAN%';

  UPDATE sites SET
    ship_to = '1029842',
    sold_to = '1229790',
    invoice_prefix = 'ILOSSR#',
    contact_email = 'ileto.palenciaii@mobilecareph.com',
    address = 'G/F Festive Walk Mall, Iloilo Business Park, Airport Road, Mandurriao, Iloilo City',
    full_address = 'G/F Festive Walk Mall, Iloilo Business Park, Airport Road, Mandurriao Iloilo City'
  WHERE code IN ('ILO', 'ASP ILO', 'ASP_ILO') OR name ILIKE '%FESTIVE WALK%';

  UPDATE sites SET
    ship_to = '1029842',
    sold_to = '1597912',
    invoice_prefix = 'APILOSSR#',
    contact_email = 'app.smiloilo@mobilecareph.com',
    address = 'Cyberzone, 3/F SM City Iloilo, Senator Benigno Aquino Jr. Ave, Mandurriao, Iloilo City',
    full_address = 'Space 322-323, 3/F Cyberzone, SM City Iloilo, Mandurriao, Iloilo City 5000'
  WHERE code IN ('APP ILO', 'APP_ILO', 'APPILO') OR name ILIKE '%SM ILOILO%';

  UPDATE sites SET
    ship_to = '1730389',
    sold_to = '1029842',
    invoice_prefix = 'NGSSR#',
    contact_email = 'johnlloyd.agapito@mobilecareph.com',
    address = 'Unit 101-101a, Level 1, Robinsons Naga, Roxas Ave cor Almeda Hwy, Naga City, Camarines Sur',
    full_address = 'Unit 101-101a, Level 1 Robinsons Naga, Brgy. Roxas Avenue, Cor Almeda Hwy, Naga City, Camarines Sur'
  WHERE code IN ('RNG', 'NAG', 'ASP NAG', 'ASP_NAG', 'ASP RNG') OR name ILIKE '%NAGA%' OR name ILIKE '%ROBINSONS NAGA%';

  UPDATE sites SET
    ship_to = '1745440',
    sold_to = '1597912',
    invoice_prefix = 'MGSSR#',
    contact_email = 'eugene.deborja@mobilecareph.com',
    address = 'Bldg. B, 4/F Cyberzone, SM Megamall, EDSA cor Doña Julia Vargas Ave, Mandaluyong City 1550',
    full_address = 'Bldg. B, Cyberzone, SM Megamall, Mandaluyong City 1550 Philippines'
  WHERE code IN ('SME', 'MEG', 'APP MEG', 'APP_MEG', 'APP SME') OR name ILIKE '%MEGAMALL%' OR name ILIKE '%SM MEGA%';

  UPDATE sites SET
    ship_to = '1764718',
    sold_to = '1597912',
    invoice_prefix = 'ANSSR#',
    contact_email = 'patrickjohn.rino@mobilecareph.com',
    address = '4/F Cyberzone, SM City North EDSA The Annex, Brgy. Sto. Cristo, Quezon City 1105',
    full_address = 'SMCITY NORTH EDSA, BRGY. STO CRISTO, QUEZON CITY 1105 PH'
  WHERE code IN ('SMA', 'ANX', 'APP ANX', 'APP_ANX', 'APP SMA') OR name ILIKE '%SM ANNEX%' OR name ILIKE '%THE ANNEX%';

  UPDATE sites SET
    ship_to = '1764735',
    sold_to = '1597912',
    invoice_prefix = 'RMSSR#',
    contact_email = 'jeffrey.ignacio@mobilecareph.com',
    address = 'Unit 211, Level 2, Robinsons Magnolia (Expansion Bldg), Aurora Blvd cor Doña Hemady St, Quezon City 1111',
    full_address = 'Unit 211, Level 2, Robinsons Magnolia (Expansion Bldg), Aurora Blvd. Doña Hemady, Kaunlaran, Quezon City, Metro Manila, 1111'
  WHERE code IN ('RMG', 'RM', 'APP RM', 'APP_RM', 'APP RMG') OR name ILIKE '%ROBINSONS MAGNOLIA%' OR name ILIKE '%MAGNOLIA%';

  UPDATE sites SET
    ship_to = '1764730',
    sold_to = '1597912',
    invoice_prefix = 'TRSSR#',
    contact_email = 'jimboy.tondag@mobilecareph.com',
    address = '3rd Level, Mindanao Ave. wing, TriNoma Mall, EDSA cor North Ave, Quezon City, Metro Manila',
    full_address = '3rd Level, Mindanao Ave., TriNoma Mall, EDSA, cor North Ave, Quezon City, Metro Manila'
  WHERE code IN ('TRI', 'APP TRI', 'APP_TRI') OR name ILIKE '%TRINOMA%';

  UPDATE sites SET
    ship_to = '1754212',
    sold_to = '1029842',
    invoice_prefix = 'LMSSR#',
    contact_email = 'jhimadrian.callos@mobilecareph.com',
    address = 'Blk A Unit R07-08, The Outlets at Lipa, LIMA Estate, Lipa City, Batangas',
    full_address = 'Blk A Unit R07-08, The Outlets at Lima Estates, Lipa City, Batangas'
  WHERE code IN ('TOL', 'LIM', 'ASP LIM', 'ASP_LIM', 'ASP TOL') OR name ILIKE '%LIMA%' OR name ILIKE '%OUTLETS%';

  UPDATE sites SET
    ship_to = '1815649',
    sold_to = '1029842',
    invoice_prefix = 'LUSSR#',
    contact_email = 'mheynardjohanne.madarang@mobilecareph.com',
    address = 'Space 316, Level 3 Digiworld, Robinsons Place La Union, National Highway, Brgy. Sevilla, San Fernando City, La Union',
    full_address = 'Space 316, Level 3, Digiworld, Robinsons Place La Union, National Highway, Sevilla, San Fernando, La Union'
  WHERE code IN ('LAU', 'ASP LAU', 'ASP_LAU') OR name ILIKE '%LA UNION%' OR name ILIKE '%ROBINSONS LA UNION%';

  UPDATE sites SET
    ship_to = NULL,
    sold_to = NULL,
    invoice_prefix = 'CBOSSR#',
    contact_email = 'michellekaye.vingno@mobilecareph.com',
    address = 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave, Rosary Heights 2, Cotabato City',
    full_address = 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City'
  WHERE code IN ('COT', 'ASP COT', 'ASP_COT') OR name ILIKE '%COTABATO%';

  UPDATE sites SET
    ship_to = '1815657',
    sold_to = '1597912',
    invoice_prefix = 'FESSSR#',
    contact_email = 'josefvictor.cruz@mobilecareph.com',
    address = 'Space No. UGF-2274.2.1-UGF-2274.2.2, Festival Mall Alabang, Filinvest City, Muntinlupa City 1781',
    full_address = 'Space No. UGF-2274.2.1-UGF-2274.2.2, Festival Mall Alabang, Muntinlupa City 1781 PH'
  WHERE code IN ('FMA', 'FES', 'APP FES', 'APP_FES', 'APP FMA') OR name ILIKE '%FESTIVAL MALL%' OR name ILIKE '%ALABANG%';

  UPDATE sites SET
    ship_to = '1836095',
    sold_to = '1597912',
    invoice_prefix = 'BHSSSR#',
    contact_email = 'ghibertjustine.flores@mobilecareph.com',
    address = '1/F Wumaco Building, 7th Ave cor Lane P, Bonifacio High Street, BGC, Taguig City 1635',
    full_address = '1F, Wumaco Building, 7th Ave cor. Lane P, High Street, Taguig, 1635'
  WHERE code IN ('BHS', 'APP BHS', 'APP_BHS') OR name ILIKE '%BONIFACIO HIGH STREET%' OR name ILIKE '%BGC%';

  UPDATE sites SET
    ship_to = '1102535',
    sold_to = '1029842',
    invoice_prefix = 'LANSSR#',
    contact_email = 'jerry.dimakuta@mobilecareph.com',
    address = '3/F Cyberzone, SM Lanang Premier, JP Laurel Ave, Lanang, Davao City, 8000',
    full_address = '3/F Cyberzone, SM Lanang Premier, JP Laurel Ave, Lanang, Davao City, 8000'
  WHERE code IN ('LAN', 'APP LAN', 'APP_LAN') OR name ILIKE '%SM LANANG%' OR name ILIKE '%LANANG%';

  UPDATE sites SET
    address = '2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila',
    full_address = 'Business and Distribution Center, 2/L Northeast Square, #47 Connecticut St. Northeast Greenhills, San Juan City, Metro Manila'
  WHERE code IN ('DC', 'DC-MDC') OR is_dc = true;

  INSERT INTO sites (name, code, region, address, is_dc, is_active, ship_to, sold_to, invoice_prefix, contact_email, full_address)
  SELECT 'POWER PLANT MALL', 'APP PPM', 'Metro Manila', 'Power Mac Center R2 Level, Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila', false, true,
    '1603617', '1597912', 'PPMSSR#', 'eljonrenz.quarto@mobilecareph.com',
    'Power Mac Center R2 Level Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila'
  WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code IN ('PPM', 'APP PPM') OR name ILIKE '%POWER PLANT%');

  INSERT INTO sites (name, code, region, address, is_dc, is_active, ship_to, sold_to, invoice_prefix, contact_email, full_address)
  SELECT 'ROBINSONS LA UNION', 'ASP LAU', 'Provincial', 'Space 316, Level 3 Digiworld, Robinsons Place La Union, National Highway, San Fernando, La Union', false, true,
    '1815649', '1029842', 'LUSSR#', 'mheynardjohanne.madarang@mobilecareph.com',
    'Space 316, Level 3, Digiworld, Robinsons Place La Union, National Highway, Sevilla, San Fernando, La Union'
  WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code IN ('LAU', 'ASP LAU') OR name ILIKE '%LA UNION%');

  INSERT INTO sites (name, code, region, address, is_dc, is_active, ship_to, sold_to, invoice_prefix, contact_email, full_address)
  SELECT 'TRINOMA', 'APP TRI', 'Metro Manila', '3rd Level, Mindanao Ave., TriNoma Mall, EDSA cor North Ave, Quezon City, Metro Manila', false, true,
    '1764730', '1597912', 'TRSSR#', 'jimboy.tondag@mobilecareph.com',
    '3rd Level, Mindanao Ave., TriNoma Mall, EDSA, cor North Ave, Quezon City, Metro Manila'
  WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code IN ('TRI', 'APP TRI') OR name ILIKE '%TRINOMA%');

  INSERT INTO sites (name, code, region, address, is_dc, is_active, ship_to, sold_to, invoice_prefix, contact_email, full_address)
  SELECT 'ROBINSONS NAGA', 'ASP NAG', 'Provincial', 'Unit 101-101a, Level 1 Robinsons Naga, Brgy. Roxas Ave, Cor Almeda Hwy, Naga City, Camarines Sur', false, true,
    '1730389', '1029842', 'NGSSR#', 'johnlloyd.agapito@mobilecareph.com',
    'Unit 101-101a, Level 1 Robinsons Naga, Brgy. Roxas Avenue, Cor Almeda Hwy, Naga City, Camarines Sur'
  WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code IN ('RNG', 'NAG', 'ASP NAG') OR name ILIKE '%NAGA%');

  INSERT INTO sites (name, code, region, address, is_dc, is_active, ship_to, sold_to, invoice_prefix, contact_email, full_address)
  SELECT 'BONIFACIO HIGH STREET', 'APP BHS', 'Metro Manila', '1/F Wumaco Building, 7th Ave cor Lane P, Bonifacio High Street, Taguig City 1635', false, true,
    '1836095', '1597912', 'BHSSSR#', 'ghibertjustine.flores@mobilecareph.com',
    '1F, Wumaco Building, 7th Ave cor. Lane P, High Street, Taguig, 1635'
  WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code IN ('BHS', 'APP BHS') OR name ILIKE '%BONIFACIO HIGH STREET%');

  INSERT INTO sites (name, code, region, address, is_dc, is_active, ship_to, sold_to, invoice_prefix, contact_email, full_address)
  SELECT 'KCC MALL, COTABATO', 'ASP COT', 'Provincial', 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave, Rosary Heights 2, Cotabato City', false, true,
    NULL, NULL, 'CBOSSR#', 'michellekaye.vingno@mobilecareph.com',
    'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City'
  WHERE NOT EXISTS (SELECT 1 FROM sites WHERE code IN ('COT', 'ASP COT') OR name ILIKE '%COTABATO%');
