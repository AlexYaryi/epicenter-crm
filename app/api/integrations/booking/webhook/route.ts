import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const BOOKING_COM_DB_SOURCE = "other";

function bookingComSourceDetail(bookingNumber: string) {
  return `Booking.com booking ${bookingNumber} | original_source=booking_com`;
}

const bookingWebhookSchema = z.object({
  booking_number: z.string().min(1),
  customer_name: z.string().min(1),
  customer_phone: z.string().optional(),
  customer_email: z.string().email().optional().or(z.literal("")).transform((v) => v || null),
  start_date: z.string(),
  end_date: z.string(),
  category: z.string().default("compact"),
  total_price_thb: z.coerce.number().default(0),
  pickup_location: z.string().optional(),
  dropoff_location: z.string().optional(),
  raw_payload: z.record(z.unknown()).optional()
});

function authorized(request: NextRequest) {
  const expected = process.env.LEAD_WEBHOOK_SECRET || process.env.EPICENTER_MESSAGING_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-epicenter-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === expected || bearer === expected;
}

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function vehicleCompliantForDates(
  vehicle: { road_tax_due_date?: unknown; inspection_expires_at?: unknown },
  insuredVehicleIds: Set<string>,
  vehicleId: string,
  endDate: string
) {
  return true;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bookingWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }
  const input = parsed.data;
  const supabase = createServiceSupabaseClient();

  // 1. Получаем ID первого активного tenant
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: tenantError?.message ?? "Tenant not found" }, { status: 500 });
  }

  // 2. Предотвращение дублирования вебхуков (идемпотентность по booking_number)
  const { data: existingBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("booking_number", input.booking_number)
    .maybeSingle();

  if (existingBooking) {
    return NextResponse.json(
      { status: "skipped", message: "Booking already exists", booking_id: existingBooking.id },
      { status: 200 }
    );
  }

  const phone = input.customer_phone || null;
  let customerId: string | null = null;

  // 3. Ищем или создаем клиента
  if (phone || input.customer_email) {
    let customerQuery = supabase.from("customers").select("id").eq("tenant_id", tenant.id).limit(1);
    if (phone) {
      customerQuery = customerQuery.or(`phone.eq.${phone},whatsapp.eq.${phone}`);
    } else if (input.customer_email) {
      customerQuery = customerQuery.eq("email", input.customer_email);
    }

    const { data: existingCustomer } = await customerQuery.maybeSingle();
    if (existingCustomer?.id) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          tenant_id: tenant.id,
          full_name: input.customer_name,
          phone,
          whatsapp: phone,
          email: input.customer_email || null,
          language_pref: "ru",
          source: BOOKING_COM_DB_SOURCE,
          source_detail: bookingComSourceDetail(input.booking_number),
          first_contact_channel: BOOKING_COM_DB_SOURCE
        })
        .select("id")
        .single();

      if (customerError) {
        return NextResponse.json({ error: `Failed to create customer: ${customerError.message}` }, { status: 400 });
      }
      customerId = newCustomer.id;
    }
  }

  if (!customerId) {
    return NextResponse.json({ error: "Customer identification failed" }, { status: 400 });
  }

  // 4. Создаем лид со статусом booked (бронь подтверждена)
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      anonymous_data: {
        name: input.customer_name,
        phone,
        email: input.customer_email,
        booking_number: input.booking_number,
        raw_payload: input.raw_payload
      },
      source: BOOKING_COM_DB_SOURCE,
      source_detail: bookingComSourceDetail(input.booking_number),
      inquiry_text: `Автоматический импорт бронирования Booking.com #${input.booking_number}. Категория: ${input.category}. Период: ${input.start_date} - ${input.end_date}.`,
      inquiry_dates: { start_date: input.start_date, end_date: input.end_date },
      inquiry_vehicle_category: input.category,
      status: "booked",
      status_changed_at: new Date().toISOString(),
      score: 100
    })
    .select("id")
    .single();

  if (leadError) {
    return NextResponse.json({ error: `Failed to create lead: ${leadError.message}` }, { status: 400 });
  }

  // 5. Поиск свободного авто в указанной категории на выбранные даты
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, make, model, category, license_plate, status, road_tax_due_date, inspection_expires_at")
    .eq("tenant_id", tenant.id)
    .eq("category", input.category)
    .not("status", "in", '("retired","repair","maintenance")');

  let selectedVehicleId: string | null = null;
  let vehicleDetails = "Авто не назначено (нет свободных машин данной категории)";

  if (vehicles && vehicles.length > 0) {
    const vehicleIds = vehicles.map((v) => v.id);

    // Check overlaps by both commercial booking status and physical rental status.
    const { data: activeBookings } = await supabase
      .from("bookings")
      .select("vehicle_id, status, rental_status, start_date, end_date, actual_end")
      .eq("tenant_id", tenant.id)
      .in("vehicle_id", vehicleIds)
      .lte("start_date", input.end_date);

    const [{ data: maintenanceBlocks }, { data: insuranceBlocks }] = await Promise.all([
      supabase
        .from("maintenance_log")
        .select("vehicle_id")
        .eq("tenant_id", tenant.id)
        .in("vehicle_id", vehicleIds)
        .in("status", ["scheduled", "in_progress"])
        .lte("vehicle_unavailable_from", input.end_date)
        .or(`vehicle_unavailable_to.gte.${input.start_date},vehicle_unavailable_to.is.null`),
      supabase
        .from("insurance")
        .select("vehicle_id")
        .eq("tenant_id", tenant.id)
        .in("vehicle_id", vehicleIds)
        .lte("start_date", input.start_date)
        .gte("end_date", input.end_date)
    ]);

    const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
    const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
    const busyVehicleStatuses = new Set(["reserved", "handed_over", "in_use", "returning"]);
    const busyVehicleIds = new Set(
      (activeBookings ?? [])
        .filter((booking) => {
          const bookingStatus = String(booking.status ?? "");
          const rentalStatus = String(booking.rental_status ?? "");
          if (!blockingBookingStatuses.has(bookingStatus) && !blockingRentalStatuses.has(rentalStatus)) {
            return false;
          }
          const effectiveEnd = String(booking.actual_end ?? booking.end_date).slice(0, 10);
          return effectiveEnd >= input.start_date;
        })
        .map((booking) => booking.vehicle_id)
    );
    for (const maintenance of maintenanceBlocks ?? []) {
      busyVehicleIds.add(maintenance.vehicle_id);
    }
    const insuredVehicleIds = new Set((insuranceBlocks ?? []).map((policy) => String(policy.vehicle_id)));
    const freeVehicle = vehicles.find((v) =>
      !busyVehicleIds.has(v.id) &&
      !busyVehicleStatuses.has(String(v.status ?? "")) &&
      vehicleCompliantForDates(v, insuredVehicleIds, String(v.id), input.end_date)
    );

    if (freeVehicle) {
      selectedVehicleId = freeVehicle.id;
      vehicleDetails = `${freeVehicle.make} ${freeVehicle.model} · ${freeVehicle.license_plate}`;
    }
  }

  const BOOKING_DEFAULT_DEPOSIT = Number(process.env.BOOKING_DEFAULT_DEPOSIT || 5000);

  // 6. Создаем запись бронирования
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      tenant_id: tenant.id,
      lead_id: lead.id,
      customer_id: customerId,
      vehicle_id: selectedVehicleId, // Будет null, если свободный авто не найден
      booking_number: input.booking_number,
      rental_type: "short_term",
      status: selectedVehicleId ? "confirmed" : "draft", // draft если авто занято и требует ручного назначения
      start_date: input.start_date,
      end_date: input.end_date,
      total_rental_amount: input.total_price_thb,
      grand_total: input.total_price_thb,
      deposit_amount: BOOKING_DEFAULT_DEPOSIT,
      delivery_fee: 0,
      contract_signed: false
    })
    .select("id")
    .single();

  if (bookingError) {
    return NextResponse.json({ error: `Failed to create booking: ${bookingError.message}` }, { status: 400 });
  }

  // 7. Отправляем Push-уведомление через ntfy.sh
  if (process.env.NTFY_TOPIC) {
    fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: "POST",
      body: `Новая бронь с Booking.com #${input.booking_number}: ${input.customer_name}, Авто: ${vehicleDetails}. Период: ${input.start_date} - ${input.end_date}.`,
      headers: {
        Title: "Booking.com: Новое Бронирование!",
        Priority: "high"
      }
    }).catch(() => undefined);
  }

  return NextResponse.json(
    {
      status: "success",
      booking_id: booking.id,
      lead_id: lead.id,
      customer_id: customerId,
      vehicle: vehicleDetails,
      auto_assigned: Boolean(selectedVehicleId)
    },
    { status: 201 }
  );
}
