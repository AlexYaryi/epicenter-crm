-- Migration: Alter bookings columns start_date, end_date and actual_end to TIMESTAMP to support time.

-- 1. Drop the bookings_no_vehicle_overlap exclusion constraint because it depends on start_date/end_date column types
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_vehicle_overlap;

-- 2. Temporary drop the overlap check trigger because it depends on start_date/end_date types
DROP TRIGGER IF EXISTS bookings_prevent_vehicle_overlap ON public.bookings;

-- 3. Alter the columns of bookings table to TIMESTAMP
ALTER TABLE public.bookings ALTER COLUMN start_date TYPE timestamp USING start_date::timestamp;
ALTER TABLE public.bookings ALTER COLUMN end_date TYPE timestamp USING end_date::timestamp;
ALTER TABLE public.bookings ALTER COLUMN actual_end TYPE timestamp USING actual_end::timestamp;

-- 4. Recreate the bookings_no_vehicle_overlap exclusion constraint with date casts
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_vehicle_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    vehicle_id WITH =,
    daterange((start_date::date), (end_date::date), '[]') WITH &&
  ) WHERE (status IN ('confirmed','paid_deposit','handed_over','active','returning'));

-- 3. Update the prevent_vehicle_booking_overlap function to use explicit cast to date
CREATE OR REPLACE FUNCTION public.prevent_vehicle_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start date;
  new_end date;
  conflicting_booking text;
  blocked_vehicle text;
BEGIN
  IF new.vehicle_id IS NULL THEN
    RETURN new;
  END IF;

  IF NOT public.epicenter_booking_blocks_vehicle(
    new.status::text,
    coalesce(new.rental_status::text, 'not_started')
  ) THEN
    RETURN new;
  END IF;

  new_start := new.start_date::date;
  new_end := coalesce(new.actual_end::date, new.end_date::date);

  IF new_start IS NULL OR new_end IS NULL THEN
    RETURN new;
  END IF;

  IF new_end < new_start THEN
    RAISE EXCEPTION 'Booking end date cannot be before start date.';
  END IF;

  SELECT concat_ws(' ', v.make, v.model, nullif(v.license_plate, ''))
    INTO blocked_vehicle
  from public.vehicles v
  where v.tenant_id = new.tenant_id
    and v.id = new.vehicle_id
    and v.status::text in ('maintenance', 'repair', 'retired')
  LIMIT 1;

  IF blocked_vehicle IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle % is not available because it is in maintenance/repair/retired status.', blocked_vehicle;
  END IF;

  SELECT coalesce(b.booking_number, b.id::text)
    INTO conflicting_booking
  from public.bookings b
  where b.tenant_id = new.tenant_id
    and b.vehicle_id = new.vehicle_id
    and b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    and public.epicenter_booking_blocks_vehicle(
      b.status::text,
      coalesce(b.rental_status::text, 'not_started')
    )
    and daterange(b.start_date::date, coalesce(b.actual_end::date, b.end_date::date), '[]')
      && daterange(new_start, new_end, '[]')
  ORDER BY b.start_date ASC
  LIMIT 1;

  IF conflicting_booking IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle is already blocked by booking % for selected dates.', conflicting_booking;
  END IF;

  RETURN new;
END;
$$;

-- 4. Recreate the trigger
CREATE TRIGGER bookings_prevent_vehicle_overlap
BEFORE INSERT OR UPDATE OF tenant_id, vehicle_id, start_date, end_date, actual_end, status, rental_status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_vehicle_booking_overlap();
