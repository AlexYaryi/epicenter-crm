import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 60;

type PublicVehicle = {
  id: string;
  slug: string;
  title: string;
  license_plate: string;
  category: string;
  status: string;
  year: number;
  seats: number | null;
  transmission: string | null;
  daily_rate_long_term: number;
  monthly_rate: number;
  deposit_amount: number | null;
  photo_url: string | null;
  photos: string[];
  description: string;
  whatsapp_url: string;
  pricing?: PublicPriceRule[];
  available_for_dates?: boolean;
  unavailable_reason?: string | null;
};

type PublicPriceRule = {
  season: string;
  months: number[];
  bucket: string;
  min_days: number;
  max_days: number;
  daily_rate_thb: number | null;
  monthly_rate_thb: number | null;
};

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
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
  };
}

function safeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePhotos(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

function overlapsRequestedRange(blockStart: string | null, blockEnd: string | null, requestStart: string, requestEnd: string) {
  if (!blockStart || !blockEnd) return false;
  return blockStart <= requestEnd && blockEnd >= requestStart;
}

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function complianceReason(vehicle: Record<string, unknown>, hasInsurance: boolean, endDate: string) {
  return null;
}

const blockingBookingStatuses = ["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"];
const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
const busyVehicleStatuses = new Set(["reserved", "handed_over", "in_use", "returning", "maintenance", "repair", "retired"]);

function publicDescription(vehicle: Record<string, unknown>, lang: string) {
  const ru = vehicle.public_description_ru;
  const en = vehicle.public_description_en;
  const fallbackRu = `${vehicle.make ?? ""} ${vehicle.model ?? ""}: аренда авто на Пхукете, long-term цена от ${vehicle.daily_rate_long_term ?? 390} THB/день при аренде от 30 дней.`;
  const fallbackEn = `${vehicle.make ?? ""} ${vehicle.model ?? ""}: car rental in Phuket, long-term price from ${vehicle.daily_rate_long_term ?? 390} THB/day for 30+ days.`;
  if (lang === "en") {
    return typeof en === "string" && en ? en : fallbackEn;
  }
  return typeof ru === "string" && ru ? ru : fallbackRu;
}

function toPublicVehicle(
  vehicle: Record<string, unknown>,
  lang: string,
  pricing: PublicPriceRule[] = [],
  availability?: { available: boolean; reason: string | null }
): PublicVehicle {
  const make = String(vehicle.make ?? "");
  const model = String(vehicle.model ?? "");
  const licensePlate = String(vehicle.license_plate ?? "");
  const photos = normalizePhotos(vehicle.photos);
  const phone = (process.env.NEXT_PUBLIC_WHATSAPP_PHONE || "+66827474212").replace(/[^\d]/g, "");
  const title = `${make} ${model}`.trim();
  const text =
    lang === "en"
      ? `Hello! I want to rent ${title} (${licensePlate}).`
      : `Здравствуйте! Хочу арендовать ${title} (${licensePlate}).`;

  return {
    id: String(vehicle.id),
    slug: typeof vehicle.public_slug === "string" && vehicle.public_slug ? vehicle.public_slug : safeSlug(`${make}-${model}-${licensePlate}`),
    title,
    license_plate: licensePlate,
    category: String(vehicle.category ?? "economy"),
    status: String(vehicle.status ?? "available"),
    year: Number(vehicle.year ?? 0),
    seats: vehicle.seats == null ? null : Number(vehicle.seats),
    transmission: vehicle.transmission == null ? null : String(vehicle.transmission),
    daily_rate_long_term: Number(vehicle.daily_rate_long_term ?? 390),
    monthly_rate: Number(vehicle.monthly_rate ?? 0),
    deposit_amount: vehicle.deposit_amount == null ? null : Number(vehicle.deposit_amount),
    photo_url: photos[0] ?? null,
    photos,
    description: publicDescription(vehicle, lang),
    whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
    pricing,
    available_for_dates: availability?.available,
    unavailable_reason: availability?.reason ?? null
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lang = searchParams.get("lang") === "en" ? "en" : "ru";
  const category = searchParams.get("category");
  const includeUnavailable = searchParams.get("include_unavailable") === "1";
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");
  const hasDateFilter = Boolean(startDate && endDate);

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503, headers: corsHeaders(request) });
  }

  const supabase = createServiceSupabaseClient();
  const publicSelect =
    "id, license_plate, make, model, year, category, status, seats, transmission, daily_rate_long_term, monthly_rate, deposit_amount, photos, public_slug, public_visible, public_sort_order, public_description_ru, public_description_en, road_tax_due_date, inspection_expires_at";
  const baseSelect = "id, license_plate, make, model, year, category, status, seats, transmission, daily_rate_long_term, monthly_rate, deposit_amount, photos, road_tax_due_date, inspection_expires_at";

  const buildQuery = (select: string, withPublicSort: boolean) => {
    let query = supabase.from("vehicles").select(select);

    if (!includeUnavailable) {
      query = query.not("status", "in", '("reserved","handed_over","in_use","returning","maintenance","repair","retired")');
    }

    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    if (withPublicSort) {
      return query.order("public_sort_order", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
    }

    return query.order("created_at", { ascending: false });
  };

  let { data, error } = await buildQuery(publicSelect, true);
  if (error && /public_|public/.test(error.message)) {
    const fallback = await buildQuery(baseSelect, false);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(request) });
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const vehicleIds = rows.map((vehicle) => String(vehicle.id));
  const pricingByVehicle = new Map<string, PublicPriceRule[]>();
  const unavailableByVehicle = new Map<string, string>();
  const insuredVehicleIds = new Set<string>();

  if (vehicleIds.length) {
    const { data: priceRows, error: priceError } = await supabase
      .from("vehicle_price_rules")
      .select("vehicle_id, season, season_months, duration_bucket, min_days, max_days, daily_rate_thb, monthly_rate_thb")
      .in("vehicle_id", vehicleIds)
      .eq("active", true)
      .order("season", { ascending: true })
      .order("min_days", { ascending: true });

    if (!priceError) {
      for (const row of priceRows ?? []) {
        const vehicleId = String(row.vehicle_id);
        const list = pricingByVehicle.get(vehicleId) ?? [];
        list.push({
          season: String(row.season),
          months: Array.isArray(row.season_months) ? row.season_months.map(Number) : [],
          bucket: String(row.duration_bucket),
          min_days: Number(row.min_days),
          max_days: Number(row.max_days),
          daily_rate_thb: row.daily_rate_thb == null ? null : Number(row.daily_rate_thb),
          monthly_rate_thb: row.monthly_rate_thb == null ? null : Number(row.monthly_rate_thb)
        });
        pricingByVehicle.set(vehicleId, list);
      }
    }
  }

  if (hasDateFilter && vehicleIds.length) {
    const [{ data: bookingBlocks }, { data: maintenanceBlocks }, { data: insuranceBlocks }] = await Promise.all([
      supabase
        .from("bookings")
        .select("vehicle_id, booking_number, status, rental_status, start_date, end_date, actual_end")
        .in("vehicle_id", vehicleIds)
        .lte("start_date", endDate),
      supabase
        .from("maintenance_log")
        .select("vehicle_id, type, status")
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
      if (overlapsRequestedRange(String(booking.start_date ?? "").slice(0, 10), effectiveEndDate, String(startDate), String(endDate))) {
        unavailableByVehicle.set(String(booking.vehicle_id), `booking:${booking.booking_number ?? booking.status}`);
      }
    }
    for (const maintenance of maintenanceBlocks ?? []) {
      unavailableByVehicle.set(String(maintenance.vehicle_id), `maintenance:${maintenance.type ?? maintenance.status}`);
    }
    for (const policy of insuranceBlocks ?? []) {
      insuredVehicleIds.add(String(policy.vehicle_id));
    }
  }

  const vehicles = rows
    .filter((vehicle) => vehicle.public_visible !== false)
    .map((vehicle) => {
      const vehicleId = String(vehicle.id);
      const reason =
        unavailableByVehicle.get(vehicleId) ??
        (hasDateFilter ? complianceReason(vehicle, insuredVehicleIds.has(vehicleId), String(endDate)) : null) ??
        (busyVehicleStatuses.has(String(vehicle.status ?? "")) ? `status:${vehicle.status}` : null);
      return toPublicVehicle(vehicle, lang, pricingByVehicle.get(vehicleId) ?? [], hasDateFilter ? { available: !reason, reason } : undefined);
    })
    .filter((vehicle) => !hasDateFilter || includeUnavailable || vehicle.available_for_dates !== false);

  return NextResponse.json({ source: "supabase", updated_at: new Date().toISOString(), vehicles }, { headers: corsHeaders(request) });
}
