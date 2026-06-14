-- Epicenter CRM hard lock for vehicle availability.
-- Goal: one vehicle cannot be booked/rented/repaired for overlapping dates.
--
-- Run the AUDIT queries first. If they return rows, resolve them before adding
-- the exclusion constraint, otherwise PostgreSQL will correctly reject it.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.epicenter_booking_blocks_vehicle(
  p_status text,
  p_rental_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_status, '') IN ('confirmed', 'paid_deposit', 'handed_over', 'active', 'in_use', 'returning')
    OR coalesce(p_rental_status, '') IN ('handed_over', 'active', 'in_use', 'returning');
$$;

-- AUDIT 1: existing booking-booking conflicts.
SELECT
  b1.tenant_id,
  b1.vehicle_id,
  b1.booking_number AS booking_a,
  b1.start_date AS booking_a_start,
  coalesce(b1.actual_end, b1.end_date) AS booking_a_end,
  b2.booking_number AS booking_b,
  b2.start_date AS booking_b_start,
  coalesce(b2.actual_end, b2.end_date) AS booking_b_end
FROM public.bookings b1
JOIN public.bookings b2
  ON b1.tenant_id = b2.tenant_id
 AND b1.vehicle_id = b2.vehicle_id
 AND b1.id < b2.id
WHERE b1.vehicle_id IS NOT NULL
  AND public.epicenter_booking_blocks_vehicle(b1.status::text, coalesce(b1.rental_status::text, 'not_started'))
  AND public.epicenter_booking_blocks_vehicle(b2.status::text, coalesce(b2.rental_status::text, 'not_started'))
  AND daterange(b1.start_date::date, coalesce(b1.actual_end::date, b1.end_date::date), '[]')
      && daterange(b2.start_date::date, coalesce(b2.actual_end::date, b2.end_date::date), '[]');

-- AUDIT 2: existing booking-maintenance conflicts.
SELECT
  b.tenant_id,
  b.vehicle_id,
  b.booking_number,
  b.start_date AS booking_start,
  coalesce(b.actual_end, b.end_date) AS booking_end,
  m.id AS maintenance_id,
  m.type AS maintenance_type,
  m.status AS maintenance_status,
  m.vehicle_unavailable_from,
  m.vehicle_unavailable_to
FROM public.bookings b
JOIN public.maintenance_log m
  ON b.tenant_id = m.tenant_id
 AND b.vehicle_id = m.vehicle_id
WHERE b.vehicle_id IS NOT NULL
  AND public.epicenter_booking_blocks_vehicle(b.status::text, coalesce(b.rental_status::text, 'not_started'))
  AND m.status::text IN ('scheduled', 'in_progress')
  AND m.vehicle_unavailable_from IS NOT NULL
  AND daterange(b.start_date::date, coalesce(b.actual_end::date, b.end_date::date), '[]')
      && daterange(
        m.vehicle_unavailable_from::date,
        coalesce(m.vehicle_unavailable_to::date, CASE WHEN m.status::text = 'in_progress' THEN 'infinity'::date ELSE m.vehicle_unavailable_from::date END),
        '[]'
      );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_vehicle_overlap;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_vehicle_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    vehicle_id WITH =,
    daterange(start_date::date, coalesce(actual_end::date, end_date::date), '[]') WITH &&
  )
  WHERE (
    vehicle_id IS NOT NULL
    AND (
      status::text IN ('confirmed', 'paid_deposit', 'handed_over', 'active', 'in_use', 'returning')
      OR coalesce(rental_status::text, 'not_started') IN ('handed_over', 'active', 'in_use', 'returning')
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_vehicle_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start date;
  new_end date;
  conflicting_booking text;
  conflicting_maintenance text;
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
  FROM public.vehicles v
  WHERE v.tenant_id = new.tenant_id
    AND v.id = new.vehicle_id
    AND v.status::text IN ('maintenance', 'repair', 'retired')
  LIMIT 1;

  IF blocked_vehicle IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle % is not available because it is in maintenance/repair/retired status.', blocked_vehicle;
  END IF;

  SELECT coalesce(b.booking_number, b.id::text)
    INTO conflicting_booking
  FROM public.bookings b
  WHERE b.tenant_id = new.tenant_id
    AND b.vehicle_id = new.vehicle_id
    AND b.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.epicenter_booking_blocks_vehicle(
      b.status::text,
      coalesce(b.rental_status::text, 'not_started')
    )
    AND daterange(b.start_date::date, coalesce(b.actual_end::date, b.end_date::date), '[]')
      && daterange(new_start, new_end, '[]')
  ORDER BY b.start_date ASC
  LIMIT 1;

  IF conflicting_booking IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle is already blocked by booking % for selected dates.', conflicting_booking;
  END IF;

  SELECT concat_ws(' ', m.type, m.vehicle_unavailable_from::text, coalesce(m.vehicle_unavailable_to::text, 'open-ended'))
    INTO conflicting_maintenance
  FROM public.maintenance_log m
  WHERE m.tenant_id = new.tenant_id
    AND m.vehicle_id = new.vehicle_id
    AND m.status::text IN ('scheduled', 'in_progress')
    AND m.vehicle_unavailable_from IS NOT NULL
    AND daterange(
      m.vehicle_unavailable_from::date,
      coalesce(m.vehicle_unavailable_to::date, CASE WHEN m.status::text = 'in_progress' THEN 'infinity'::date ELSE m.vehicle_unavailable_from::date END),
      '[]'
    ) && daterange(new_start, new_end, '[]')
  ORDER BY m.vehicle_unavailable_from ASC
  LIMIT 1;

  IF conflicting_maintenance IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle is blocked by maintenance/repair % for selected dates.', conflicting_maintenance;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS bookings_prevent_vehicle_overlap ON public.bookings;
CREATE TRIGGER bookings_prevent_vehicle_overlap
BEFORE INSERT OR UPDATE OF tenant_id, vehicle_id, start_date, end_date, actual_end, status, rental_status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_vehicle_booking_overlap();

CREATE OR REPLACE FUNCTION public.prevent_maintenance_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  maint_start date;
  maint_end date;
  conflicting_booking text;
BEGIN
  IF new.status::text NOT IN ('scheduled', 'in_progress') THEN
    RETURN new;
  END IF;

  maint_start := new.vehicle_unavailable_from::date;
  maint_end := coalesce(
    new.vehicle_unavailable_to::date,
    CASE WHEN new.status::text = 'in_progress' THEN 'infinity'::date ELSE new.vehicle_unavailable_from::date END
  );

  IF maint_start IS NULL THEN
    RETURN new;
  END IF;

  IF maint_end < maint_start THEN
    RAISE EXCEPTION 'Maintenance unavailable end date cannot be before start date.';
  END IF;

  SELECT coalesce(b.booking_number, b.id::text)
    INTO conflicting_booking
  FROM public.bookings b
  WHERE b.tenant_id = new.tenant_id
    AND b.vehicle_id = new.vehicle_id
    AND public.epicenter_booking_blocks_vehicle(
      b.status::text,
      coalesce(b.rental_status::text, 'not_started')
    )
    AND daterange(b.start_date::date, coalesce(b.actual_end::date, b.end_date::date), '[]')
      && daterange(maint_start, maint_end, '[]')
  ORDER BY b.start_date ASC
  LIMIT 1;

  IF conflicting_booking IS NOT NULL THEN
    RAISE EXCEPTION 'Maintenance/repair overlaps blocked booking %.', conflicting_booking;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_prevent_booking_overlap ON public.maintenance_log;
CREATE TRIGGER maintenance_prevent_booking_overlap
BEFORE INSERT OR UPDATE OF tenant_id, vehicle_id, status, vehicle_unavailable_from, vehicle_unavailable_to
ON public.maintenance_log
FOR EACH ROW
EXECUTE FUNCTION public.prevent_maintenance_booking_overlap();
