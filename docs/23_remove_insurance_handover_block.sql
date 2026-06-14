-- Remove old database-level blockers that prevent rental handover when
-- insurance does not cover the full booking dates.
--
-- Business rule:
-- Insurance, Por Ror Bor / road tax and inspection can be renewed during a rental.
-- They must create owner/Thomas reminders, but must not block bookings,
-- rental handover, active rentals, or public advertising.

DO $$
DECLARE
  trigger_record record;
BEGIN
  FOR trigger_record IN
    SELECT
      trigger_namespace.nspname AS table_schema,
      trigger_table.relname AS table_name,
      trigger_item.tgname AS trigger_name
    FROM pg_trigger trigger_item
    JOIN pg_class trigger_table ON trigger_table.oid = trigger_item.tgrelid
    JOIN pg_namespace trigger_namespace ON trigger_namespace.oid = trigger_table.relnamespace
    JOIN pg_proc trigger_function ON trigger_function.oid = trigger_item.tgfoid
    WHERE NOT trigger_item.tgisinternal
      AND trigger_namespace.nspname = 'public'
      AND pg_get_functiondef(trigger_function.oid) ILIKE '%without active insurance%'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trigger_record.trigger_name,
      trigger_record.table_schema,
      trigger_record.table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ILIKE '%without active insurance%'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s)',
      function_record.schema_name,
      function_record.function_name,
      function_record.args
    );
  END LOOP;
END $$;

-- Verification: should return zero rows for old insurance hard-blockers.
SELECT n.nspname AS schema_name, p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ILIKE '%without active insurance%';
