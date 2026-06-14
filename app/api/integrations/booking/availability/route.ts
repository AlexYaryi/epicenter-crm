import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;
export const dynamic = "force-dynamic";

interface CategorySummaryItem {
  category: string;
  available_count: number;
  min_daily_rate_thb: number;
  vehicles: string[];
}

interface AvailabilityResponseData {
  source: string;
  start_date: string;
  end_date: string;
  currency: string;
  categories: CategorySummaryItem[];
}

interface CacheEntry {
  expiresAt: number;
  data: AvailabilityResponseData;
}

const bookingAvailabilityCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 секунд кэша
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

function publicDailyRate(value: unknown) {
  const rate = Number(value ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 1000;
}

function authorized(request: NextRequest) {
  const expected = process.env.EPICENTER_MESSAGING_SECRET || process.env.LEAD_WEBHOOK_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-epicenter-secret") || request.headers.get("x-epicenter-messaging-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === expected || bearer === expected;
}

function isDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const category = searchParams.get("category"); // optional filter

  if (!isDate(startDate) || !isDate(endDate) || String(startDate) > String(endDate)) {
    return NextResponse.json({ error: "Use start_date and end_date in YYYY-MM-DD format." }, { status: 400 });
  }

  // Проверяем in-memory кэш
  const cacheKey = `${startDate}_${endDate}_${category || "all"}`;
  const now = Date.now();
  const cached = bookingAvailabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data);
  }

  const supabase = createServiceSupabaseClient();
  
  // 1. Извлекаем все активные публичные автомобили
  let vehicleQuery = supabase
    .from("vehicles")
    .select("id, make, model, category, status, public_visible, daily_rate_short_term, road_tax_due_date, inspection_expires_at")
    .not("status", "in", '("retired","repair")')
    .eq("public_visible", true);

  if (category && category !== "all") {
    vehicleQuery = vehicleQuery.eq("category", category);
  }

  const { data: vehicles, error: vehicleError } = await vehicleQuery;
  if (vehicleError) {
    return NextResponse.json({ error: vehicleError.message }, { status: 500 });
  }

  const vehicleIds = (vehicles ?? []).map((vehicle) => vehicle.id);
  const unavailableIds = new Set<string>();
  const insuredVehicleIds = new Set<string>();

  if (vehicleIds.length) {
    // 2. Ищем пересечения с бронированиями и ремонтами
    const [{ data: bookingBlocks }, { data: maintenanceBlocks }, { data: insuranceBlocks }] = await Promise.all([
      supabase
        .from("bookings")
        .select("vehicle_id, status, rental_status, start_date, end_date, actual_end")
        .in("vehicle_id", vehicleIds)
        .lte("start_date", endDate),
      supabase
        .from("maintenance_log")
        .select("vehicle_id")
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
        unavailableIds.add(booking.vehicle_id);
      }
    }
    for (const maintenance of maintenanceBlocks ?? []) {
      unavailableIds.add(maintenance.vehicle_id);
    }
    for (const policy of insuranceBlocks ?? []) {
      insuredVehicleIds.add(String(policy.vehicle_id));
    }
  }

  // 3. Агрегируем свободные автомобили по категориям
  const categorySummary: Record<string, { category: string; available_count: number; min_daily_rate_thb: number; vehicles: string[] }> = {};

  for (const vehicle of vehicles ?? []) {
    const complianceBlock = complianceReason(vehicle, insuredVehicleIds.has(String(vehicle.id)), endDate);
    const isAvailable = !unavailableIds.has(vehicle.id) && !complianceBlock && !busyVehicleStatuses.has(String(vehicle.status ?? ""));
    if (!isAvailable) continue;

    const cat = vehicle.category || "compact";
    if (!categorySummary[cat]) {
      categorySummary[cat] = {
        category: cat,
        available_count: 0,
        min_daily_rate_thb: publicDailyRate(vehicle.daily_rate_short_term),
        vehicles: []
      };
    }

    categorySummary[cat].available_count += 1;
    categorySummary[cat].vehicles.push(`${vehicle.make} ${vehicle.model}`);
    const rate = publicDailyRate(vehicle.daily_rate_short_term);
    if (rate < categorySummary[cat].min_daily_rate_thb) {
      categorySummary[cat].min_daily_rate_thb = rate;
    }
  }

  const responseData = {
    source: "marketplace_api",
    start_date: startDate,
    end_date: endDate,
    currency: "THB",
    categories: Object.values(categorySummary)
  };

  // Записываем в кэш
  bookingAvailabilityCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    data: responseData
  });

  return NextResponse.json(responseData);
}
