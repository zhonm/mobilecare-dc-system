-- ============================================================================
-- Supabase SQL Migration: Fix Parts Master Catalog Categories
-- Purpose:
--   1. Ensures the 'OTHER' category exists in public.part_categories.
--   2. Updates public.parts so each part SKU is assigned to its accurate category
--      (BATTERY, DISPLAY, CAMERA, BACK_GLASS, MID_REAR, OTHER).
-- ============================================================================

-- Step 1: Ensure 'OTHER' category exists in public.part_categories
INSERT INTO public.part_categories (code, name, has_imei, is_serialized, sort_order)
VALUES ('OTHER', 'Other Components', false, false, 6)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order;

-- Step 2: Resolve and cache Category UUIDs
DO $$
DECLARE
  v_cat_battery UUID;
  v_cat_display UUID;
  v_cat_camera UUID;
  v_cat_back_glass UUID;
  v_cat_mid_rear UUID;
  v_cat_other UUID;
BEGIN
  SELECT id INTO v_cat_battery FROM public.part_categories WHERE code = 'BATTERY' LIMIT 1;
  SELECT id INTO v_cat_display FROM public.part_categories WHERE code = 'DISPLAY' LIMIT 1;
  SELECT id INTO v_cat_camera FROM public.part_categories WHERE code = 'CAMERA' LIMIT 1;
  SELECT id INTO v_cat_back_glass FROM public.part_categories WHERE code = 'BACK_GLASS' LIMIT 1;
  SELECT id INTO v_cat_mid_rear FROM public.part_categories WHERE code = 'MID_REAR' LIMIT 1;
  SELECT id INTO v_cat_other FROM public.part_categories WHERE code = 'OTHER' LIMIT 1;

  -- 2.1 Update DISPLAY parts
  UPDATE public.parts
  SET category_id = v_cat_display, updated_at = NOW()
  WHERE v_cat_display IS NOT NULL
    AND (
      LOWER(description) LIKE '%display%'
      OR LOWER(description) LIKE '%screen%'
    )
    AND LOWER(description) NOT LIKE '%logic board%'
    AND LOWER(description) NOT LIKE '%rear system%'
    AND LOWER(description) NOT LIKE '%enclosure%'
    AND LOWER(description) NOT LIKE '%housing%';

  -- 2.2 Update BATTERY parts
  UPDATE public.parts
  SET category_id = v_cat_battery, updated_at = NOW()
  WHERE v_cat_battery IS NOT NULL
    AND (
      LOWER(description) LIKE '%battery%'
      OR LOWER(description) ~* '\ybatt\y'
    )
    AND LOWER(description) NOT LIKE '%logic board%'
    AND LOWER(description) NOT LIKE '%rear system%'
    AND LOWER(description) NOT LIKE '%enclosure%'
    AND LOWER(description) NOT LIKE '%housing%';

  -- 2.3 Update CAMERA parts
  UPDATE public.parts
  SET category_id = v_cat_camera, updated_at = NOW()
  WHERE v_cat_camera IS NOT NULL
    AND (
      LOWER(description) LIKE '%camera%'
      OR LOWER(description) LIKE '%truedepth%'
      OR LOWER(description) LIKE '%sensor%'
      OR LOWER(description) LIKE '%face id%'
      OR LOWER(description) LIKE '%lidar%'
    )
    AND LOWER(description) NOT LIKE '%display%'
    AND LOWER(description) NOT LIKE '%battery%'
    AND LOWER(description) NOT LIKE '%speaker%'
    AND LOWER(description) NOT LIKE '%microphone%';

  -- 2.4 Update BACK_GLASS parts
  UPDATE public.parts
  SET category_id = v_cat_back_glass, updated_at = NOW()
  WHERE v_cat_back_glass IS NOT NULL
    AND (
      LOWER(description) LIKE '%back glass%'
      OR LOWER(description) LIKE '%rear glass%'
      OR LOWER(description) LIKE '%back-glass%'
      OR LOWER(description) LIKE '%rear-glass%'
    )
    AND LOWER(description) NOT LIKE '%display%'
    AND LOWER(description) NOT LIKE '%battery%';

  -- 2.5 Update MID_REAR (Logic Boards, Rear Systems, Enclosures, Housings) parts
  UPDATE public.parts
  SET category_id = v_cat_mid_rear, updated_at = NOW()
  WHERE v_cat_mid_rear IS NOT NULL
    AND (
      LOWER(description) LIKE '%logic board%'
      OR LOWER(description) LIKE '%main logic%'
      OR LOWER(description) LIKE '%rear system%'
      OR LOWER(description) LIKE '%mid system%'
      OR LOWER(description) LIKE '%mid/rear%'
      OR LOWER(description) LIKE '%mid-rear%'
      OR LOWER(description) LIKE '%enclosure%'
      OR LOWER(description) LIKE '%housing%'
      OR LOWER(description) LIKE '%chassis%'
      OR LOWER(description) ~* '\y(64|128|256|512)\s*gb\y'
      OR LOWER(description) ~* '\y1\s*tb\y'
      OR LOWER(description) LIKE '%ci/ar%'
    )
    AND LOWER(description) NOT LIKE '%display%'
    AND LOWER(description) NOT LIKE '%battery%'
    AND LOWER(description) NOT LIKE '%camera%'
    AND LOWER(description) NOT LIKE '%speaker%'
    AND LOWER(description) NOT LIKE '%microphone%'
    AND LOWER(description) NOT LIKE '%sim tray%'
    AND LOWER(description) NOT LIKE '%case%';

  -- 2.6 Update OTHER (Speakers, Microphones, Taptic Engines, SIM Trays, Cases, Accessories)
  UPDATE public.parts
  SET category_id = v_cat_other, updated_at = NOW()
  WHERE v_cat_other IS NOT NULL
    AND (
      LOWER(description) LIKE '%speaker%'
      OR LOWER(description) LIKE '%microphone%'
      OR LOWER(description) LIKE '%mic,%'
      OR LOWER(description) LIKE '%taptic%'
      OR LOWER(description) LIKE '%vibrat%'
      OR LOWER(description) LIKE '%sim tray%'
      OR LOWER(description) LIKE '%case%'
      OR LOWER(description) LIKE '%replacement part%'
      OR LOWER(description) LIKE '%screw%'
      OR LOWER(description) LIKE '%bracket%'
      OR LOWER(description) LIKE '%adhesive%'
    );

END $$;
