import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;

function corsHeaders(request?: NextRequest) {
  const allowedOrigin = process.env.TILDA_ALLOWED_ORIGIN || "*";
  const requestOrigin = request?.headers.get("origin");
  let origin = "*";
  if (allowedOrigin !== "*") {
    origin = requestOrigin === allowedOrigin ? requestOrigin : "null";
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
}

function isDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

interface PublicAvailabilityVehicle {
  id: string;
  license_plate: string;
  title: string;
  year: number;
  category: string;
  status: string;
  available: boolean;
  unavailable_reason: string | null;
}

interface PublicAvailabilityData {
  source: string;
  start_date: string | null;
  end_date: string | null;
  total: number;
  vehicles: PublicAvailabilityVehicle[];
}

interface CacheEntry {
  expiresAt: number;
  data: PublicAvailabilityData;
}

const availabilityCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds cache TTL
const blockingBookingStatuses = ["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"];
const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
const busyVehicleStatuses = new Set(["reserved", "handed_over", "in_use", "returning", "maintenance", "repair", "retired"]);

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function overlapsRequestedRange(blockStart: string | null, blockEnd: string | null, requestStart: string, requestEnd: string) {
  if (!blockStart || !blockEnd) return false;
  return blockStart <= requestEnd && blockEnd >= requestStart;
}

function complianceReason(vehicle: { road_tax_due_date?: unknown; inspection_expires_at?: unknown }, hasInsurance: boolean, endDate: string) {
  return null;
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

  // Check in-memory cache first
  const cacheKey = `${startDate}_${endDate}_${category}_${includeUnavailable}`;
  const now = Date.now();
  const cached = availabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data, { headers: corsHeaders(request) });
  }

  const supabase = createServiceSupabaseClient();
  let vehicleQuery = supabase
    .from("vehicles")
    .select("id, license_plate, make, model, year, category, status, public_visible, public_sort_order, road_tax_due_date, inspection_expires_at")
    .not("status", "in", '("retired","repair","maintenance")')
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
  const insuredVehicleIds = new Set<string>();

  if (vehicleIds.length) {
    const [{ data: bookingBlocks }, { data: maintenanceBlocks }, { data: insuranceBlocks }] = await Promise.all([
      supabase
        .from("bookings")
        .select("vehicle_id, booking_number, status, rental_status, start_date, end_date, actual_end")
        .in("vehicle_id", vehicleIds)
        .lte("start_date", endDate),
      supabase
        .from("maintenance_log")
        .select("vehicle_id, type, status, vehicle_unavailable_from, vehicle_unavailable_to")
        .in("vehicle_id", vehicleIds)
        .in("status", ["scheduled", "in_progress"])
        .lte("vehicle_unavailable_from", endDate)
        .or(`vehicle_unavailable_to.gte.${startDate},vehicle_unavailable_to.is.null`),
      supabase
        .from("insurance")
        .select("vehicle_id")
        .in("vehicle_id", vehicleIds)
        .lte("start_date", startDate)
        .gte("end_date", endDate)
    ]);

    for (const booking of bookingBlocks ?? []) {
      const blocksByRentalStatus = blockingRentalStatuses.has(String(booking.rental_status ?? ""));
      const blocksByBookingStatus = blockingBookingStatuses.includes(String(booking.status ?? ""));
      if (!blocksByRentalStatus && !blocksByBookingStatus) continue;

      const effectiveEndDate = String(booking.actual_end ?? booking.end_date ?? "").slice(0, 10);
      if (overlapsRequestedRange(String(booking.start_date ?? "").slice(0, 10), effectiveEndDate, startDate, endDate)) {
        unavailable.set(booking.vehicle_id, `booking:${booking.booking_number ?? booking.status}`);
      }
    }
    for (const maintenance of maintenanceBlocks ?? []) {
      unavailable.set(maintenance.vehicle_id, `maintenance:${maintenance.type ?? maintenance.status}`);
    }
    for (const policy of insuranceBlocks ?? []) {
      insuredVehicleIds.add(String(policy.vehicle_id));
    }
  }

  const rows = publicVehicles
    .map((vehicle) => {
      const reason =
        unavailable.get(vehicle.id) ??
        complianceReason(vehicle, insuredVehicleIds.has(String(vehicle.id)), endDate) ??
        (busyVehicleStatuses.has(String(vehicle.status ?? "")) ? `status:${vehicle.status}` : null);
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

  const responseData = {
    source: "supabase",
    start_date: startDate,
    end_date: endDate,
    total: rows.length,
    vehicles: rows
  };

  // Cache response for future queries
  availabilityCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    data: {
      ...responseData,
      source: "cache"
    }
  });

  return NextResponse.json(responseData, { headers: corsHeaders(request) });
}
