import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;

function corsHeaders(request?: NextRequest) {
  const allowedOrigin = process.env.TILDA_ALLOWED_ORIGIN || "*";
  const requestOrigin = request?.headers.get("origin");
  const origin = allowedOrigin === "*" ? "*" : requestOrigin === allowedOrigin ? allowedOrigin : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}

function isDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: NextRequest) {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503, headers: corsHeaders(request) });
  }

  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const category = searchParams.get("category");
  const includeUnavailable = searchParams.get("include_unavailable") === "1";

  if (!isDate(startDate) || !isDate(endDate) || String(startDate) > String(endDate)) {
    return NextResponse.json({ error: "Use start_date and end_date in YYYY-MM-DD format." }, { status: 400, headers: corsHeaders(request) });
  }

  const supabase = createServiceSupabaseClient();
  let vehicleQuery = supabase
    .from("vehicles")
    .select("id, license_plate, make, model, year, category, status, public_visible, public_sort_order")
    .not("status", "in", '("retired","repair")')
    .order("public_sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (category && category !== "all") {
    vehicleQuery = vehicleQuery.eq("category", category);
  }

  const { data: vehicles, error: vehicleError } = await vehicleQuery;
  if (vehicleError) {
    return NextResponse.json({ error: vehicleError.message }, { status: 500, headers: corsHeaders(request) });
  }

  const publicVehicles = (vehicles ?? []).filter((vehicle) => vehicle.public_visible !== false);
  const vehicleIds = publicVehicles.map((vehicle) => vehicle.id);
  const unavailable = new Map<string, string>();

  if (vehicleIds.length) {
    const [{ data: bookingBlocks }, { data: maintenanceBlocks }] = await Promise.all([
      supabase
        .from("bookings")
        .select("vehicle_id, booking_number, status, start_date, end_date")
        .in("vehicle_id", vehicleIds)
        .in("status", ["confirmed", "paid_deposit", "handed_over", "active", "returning"])
        .lte("start_date", endDate)
        .gte("end_date", startDate),
      supabase
        .from("maintenance_log")
        .select("vehicle_id, type, status, vehicle_unavailable_from, vehicle_unavailable_to")
        .in("vehicle_id", vehicleIds)
        .in("status", ["scheduled", "in_progress"])
        .lte("vehicle_unavailable_from", endDate)
        .gte("vehicle_unavailable_to", startDate)
    ]);

    for (const booking of bookingBlocks ?? []) {
      unavailable.set(booking.vehicle_id, `booking:${booking.booking_number ?? booking.status}`);
    }
    for (const maintenance of maintenanceBlocks ?? []) {
      unavailable.set(maintenance.vehicle_id, `maintenance:${maintenance.type ?? maintenance.status}`);
    }
  }

  const rows = publicVehicles
    .map((vehicle) => {
      const reason = unavailable.get(vehicle.id) ?? null;
      return {
        id: vehicle.id,
        license_plate: vehicle.license_plate,
        title: `${vehicle.make} ${vehicle.model}`.trim(),
        year: vehicle.year,
        category: vehicle.category,
        status: vehicle.status,
        available: !reason,
        unavailable_reason: reason
      };
    })
    .filter((vehicle) => includeUnavailable || vehicle.available);

  return NextResponse.json(
    {
      source: "supabase",
      start_date: startDate,
      end_date: endDate,
      total: rows.length,
      vehicles: rows
    },
    { headers: corsHeaders(request) }
  );
}
