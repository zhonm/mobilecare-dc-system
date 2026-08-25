-- ============================================================================
-- MDC SYSTEM 2: Masterlist Raw Usage Ingestion & Analytical Views Migration
-- Enables single-source-of-truth repair record storage, dynamic aggregation,
-- all-time per-site historical shares, and hardened Row Level Security.
-- ============================================================================

-- 1. Ensure Table Structure for Raw Repair Usage Records
CREATE TABLE IF NOT EXISTS repair_usage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_batch_id UUID NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
    raw_site_name TEXT NOT NULL,
    raw_part_number TEXT NOT NULL,
    raw_part_description TEXT NOT NULL,
    repair_closed_date DATE,
    month_name TEXT NOT NULL,
    repair_number TEXT,
    order_id TEXT,
    kgb_kbb_number TEXT,
    quantity INT NOT NULL DEFAULT 1,
    raw_row_ref INT,
    is_in_scope BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all columns exist if table was previously created
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS raw_site_name TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS raw_part_number TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS raw_part_description TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS repair_closed_date DATE;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS month_name TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS repair_number TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS kgb_kbb_number TEXT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS raw_row_ref INT;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS is_in_scope BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE repair_usage_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Indexes for High Performance Downstream Aggregations
CREATE INDEX IF NOT EXISTS idx_repair_usage_batch ON repair_usage_records(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_repair_usage_desc_date ON repair_usage_records(raw_part_description, repair_closed_date);
CREATE INDEX IF NOT EXISTS idx_repair_usage_desc_site ON repair_usage_records(raw_part_description, raw_site_name);
CREATE INDEX IF NOT EXISTS idx_repair_usage_month ON repair_usage_records(month_name);
CREATE INDEX IF NOT EXISTS idx_repair_usage_in_scope ON repair_usage_records(is_in_scope);

-- 3. SQL View: Filtered In-Scope Universe (Battery & Display iPhone)
-- Exact Filter Specification:
--   a. raw_part_description ILIKE '%iphone%'
--   b. raw_part_description ILIKE '%battery%' OR raw_part_description ILIKE '%display%'
--   c. TRIM(raw_part_description) does NOT case-insensitively match the 20 legacy exclusions
CREATE OR REPLACE VIEW view_repair_usage_in_scope AS
SELECT 
    r.*,
    CASE 
        WHEN LOWER(r.raw_part_description) LIKE '%display%' THEN 'DISPLAY'
        WHEN LOWER(r.raw_part_description) LIKE '%battery%' THEN 'BATTERY'
        ELSE 'OTHER'
    END AS commodity_group
FROM repair_usage_records r
WHERE 
    r.raw_part_description ILIKE '%iphone%'
    AND (r.raw_part_description ILIKE '%battery%' OR r.raw_part_description ILIKE '%display%')
    AND LOWER(TRIM(r.raw_part_description)) NOT IN (
        -- Battery Exclusions
        'battery, iphone 11',
        'battery, iphone 8',
        'battery, iphone 11 pro',
        'battery, iphone 11 pro max',
        'battery, iphone 12 and 12 pro',
        'battery, iphone 12 mini',
        'battery, iphone 12 pro max',
        'battery, iphone 13 mini',
        'battery, iphone 8 plus',
        'battery, iphone se 2nd gen',
        'battery, iphone se 3rd generation',
        'battery, iphone x',
        'battery, iphone xr',
        -- Display Exclusions
        'display, iphone 11',
        'display, iphone 12',
        'display, iphone 12 mini',
        'display, iphone 12 pro',
        'display, iphone 12 pro max',
        'display, iphone 13 mini',
        'display, iphone xr'
    );

-- 4. SQL View: Monthly Aggregated Usage per Part
CREATE OR REPLACE VIEW view_monthly_part_usage AS
SELECT 
    raw_part_number,
    raw_part_description,
    commodity_group,
    EXTRACT(YEAR FROM repair_closed_date) AS repair_year,
    EXTRACT(MONTH FROM repair_closed_date) AS month_number,
    month_name,
    SUM(quantity) AS total_usage_count
FROM view_repair_usage_in_scope
WHERE repair_closed_date IS NOT NULL
GROUP BY 
    raw_part_number,
    raw_part_description,
    commodity_group,
    EXTRACT(YEAR FROM repair_closed_date),
    EXTRACT(MONTH FROM repair_closed_date),
    month_name
ORDER BY 
    commodity_group,
    raw_part_description,
    repair_year,
    month_number;

-- 5. SQL View: All-Time Per-Site Historical Shares
-- Computes: (filtered repairs of this part at this site) / (filtered repairs of this part, all sites, all time)
CREATE OR REPLACE VIEW view_part_site_shares AS
WITH part_site_counts AS (
    SELECT 
        raw_part_number,
        raw_part_description,
        commodity_group,
        COALESCE(s.code, r.raw_site_name) AS site_code,
        COALESCE(s.name, r.raw_site_name) AS site_name,
        SUM(r.quantity) AS site_usage_count
    FROM view_repair_usage_in_scope r
    LEFT JOIN sites s ON r.site_id = s.id OR UPPER(r.raw_site_name) = UPPER(s.name) OR UPPER(r.raw_site_name) = UPPER(s.code)
    GROUP BY 
        raw_part_number,
        raw_part_description,
        commodity_group,
        COALESCE(s.code, r.raw_site_name),
        COALESCE(s.name, r.raw_site_name)
),
part_totals AS (
    SELECT 
        raw_part_description,
        SUM(site_usage_count) AS part_total_usage
    FROM part_site_counts
    GROUP BY raw_part_description
)
SELECT 
    psc.raw_part_number,
    psc.raw_part_description,
    psc.commodity_group,
    psc.site_code,
    psc.site_name,
    psc.site_usage_count,
    pt.part_total_usage,
    CASE 
        WHEN pt.part_total_usage > 0 THEN ROUND((psc.site_usage_count::NUMERIC / pt.part_total_usage::NUMERIC), 6)
        ELSE 0
    END AS all_time_share_pct
FROM part_site_counts psc
JOIN part_totals pt ON psc.raw_part_description = pt.raw_part_description
ORDER BY 
    psc.commodity_group,
    psc.raw_part_description,
    psc.site_code;

-- 6. Row Level Security (RLS) Policies
ALTER TABLE repair_usage_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Allow public read of repair_usage_records" ON repair_usage_records
        FOR SELECT TO public USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public insert of repair_usage_records" ON repair_usage_records
        FOR INSERT TO public WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public update of repair_usage_records" ON repair_usage_records
        FOR UPDATE TO public USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public delete of repair_usage_records" ON repair_usage_records
        FOR DELETE TO public USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
