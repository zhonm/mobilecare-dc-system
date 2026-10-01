-- Correct receipt dates for the two shipments shown in the shipment archive.
-- Pickup/shipment dates remain unchanged at 2026-09-10.

BEGIN;

UPDATE public.shipments
SET
  received_date = DATE '2026-09-11',
  received_at = CASE
    WHEN received_at IS NOT NULL
      AND received_at::date = DATE '2026-10-01'
    THEN received_at - INTERVAL '20 days'
    ELSE received_at
  END,
  updated_at = NOW()
WHERE invoice_ref IN ('DCOWNED#091026F', 'DCOWNED#091026C')
  AND received_date = DATE '2026-10-01';

UPDATE public.saved_records
SET
  snapshot_data = jsonb_set(
    jsonb_set(
      snapshot_data,
      '{received_date}',
      to_jsonb('2026-09-11'::text),
      true
    ),
    '{received_at}',
    CASE
      WHEN snapshot_data->>'received_at' IS NOT NULL
        AND (snapshot_data->>'received_at')::timestamptz::date = DATE '2026-10-01'
      THEN to_jsonb(
        to_char(
          (snapshot_data->>'received_at')::timestamptz - INTERVAL '20 days',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
      ELSE snapshot_data->'received_at'
    END,
    true
  ),
  updated_at = NOW()
WHERE record_type = 'shipment'
  AND period_label IN ('DCOWNED#091026F', 'DCOWNED#091026C')
  AND snapshot_data->>'received_date' = '2026-10-01';

COMMIT;
