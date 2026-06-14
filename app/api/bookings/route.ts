import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { demoBookings } from "@/lib/demo-data";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";
import { sendCustomerNotification } from "@/lib/actions";

const bookingCreateSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional().or(z.literal("")),
  booking_number: z.string(),
  customer_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  rental_type: z.string(),
  status: z.string().default("confirmed"),
  start_date: z.string(),
  end_date: z.string(),
  pickup_method: z.string().default("office"),
  pickup_location: z.string().optional().nullable(),
  return_location: z.string().optional().nullable(),
  daily_rate_applied: z.coerce.number(),
  total_rental_amount: z.coerce.number(),
  deposit_amount: z.coerce.number().default(0),
  delivery_fee: z.coerce.number().default(0),
  extras_total: z.coerce.number().default(0),
  discount_amount: z.coerce.number().default(0),
  grand_total: z.coerce.number(),
  currency: z.string().default("THB")
});

function dateOnly(value: string | null | undefined) {
  return String(value ?? "").slice(0, 10);
}

function bookingNumberLabel(booking: { booking_number?: string | null; id?: string | null }) {
  return booking.booking_number ? `#${booking.booking_number}` : booking.id ?? "unknown";
}

async function generateApiBookingNumber(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  requestedNumber: string
) {
  let bookingNumber = requestedNumber.trim();
  if (!bookingNumber || bookingNumber.endsWith("-")) {
    const year = new Date().getFullYear();
    const prefix = bookingNumber.endsWith("-") ? bookingNumber : `EPC-${year}-`;
    const { data: latestBookings, error } = await supabase
      .from("bookings")
      .select("booking_number")
      .eq("tenant_id", tenantId)
      .like("booking_number", `${prefix}%`);

    if (error) {
      const fallbackSuffix = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
      return `${prefix}${fallbackSuffix}`;
    }

    let maxNum = 0;
    for (const booking of latestBookings ?? []) {
      const suffix = String(booking.booking_number ?? "").replace(prefix, "").split("-")[0]?.trim() ?? "";
      const number = parseInt(suffix, 10);
      if (!Number.isNaN(number) && number > maxNum) {
        maxNum = number;
      }
    }
    bookingNumber = `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
  }

  return bookingNumber;
}

async function findApiBookingBlock(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicleId: string,
  startDate: string,
  endDate: string
) {
  const startDateOnly = dateOnly(startDate);
  const endDateOnly = dateOnly(endDate);
  const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
  const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id, booking_number, status, rental_status, start_date, end_date, actual_end")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .lte("start_date", `${endDateOnly}T23:59:59`);

  if (bookingsError) throw new Error(bookingsError.message);

  const bookingBlock = (bookings ?? []).find((booking) => {
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    if (!blockingBookingStatuses.has(bookingStatus) && !blockingRentalStatuses.has(rentalStatus)) return false;
    return dateOnly(booking.actual_end ?? booking.end_date) >= startDateOnly;
  });
  if (bookingBlock) return { type: "booking", label: bookingNumberLabel(bookingBlock) };

  const { data: maintenanceBlocks, error: maintenanceError } = await supabase
    .from("maintenance_log")
    .select("id, type, status, vehicle_unavailable_from, vehicle_unavailable_to")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .in("status", ["scheduled", "in_progress"])
    .lte("vehicle_unavailable_from", endDateOnly)
    .or(`vehicle_unavailable_to.gte.${startDateOnly},vehicle_unavailable_to.is.null`);

  if (maintenanceError) throw new Error(maintenanceError.message);

  const maintenanceBlock = (maintenanceBlocks ?? []).find((block) => {
    const blockStart = dateOnly(block.vehicle_unavailable_from);
    const blockEnd = dateOnly(block.vehicle_unavailable_to ?? "9999-12-31");
    return Boolean(blockStart) && blockStart <= endDateOnly && blockEnd >= startDateOnly;
  });
  if (maintenanceBlock) return { type: "maintenance", label: `${maintenanceBlock.type ?? "maintenance"}:${maintenanceBlock.status ?? "scheduled"}` };

  return null;
}

async function validateApiVehicleCompliance(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicle: { id: string; status?: string | null; road_tax_due_date?: string | null; inspection_expires_at?: string | null },
  startDate: string,
  endDate: string,
  role: string
) {
  const vehicleStatus = String(vehicle.status ?? "");
  if (["maintenance", "repair", "retired"].includes(vehicleStatus)) {
    return `Vehicle is not available: status=${vehicleStatus}.`;
  }
  return null;
}

export async function GET() {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ source: "demo", data: demoBookings });
  }

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("tenant_id", user.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ source: "supabase", data });
}

export async function POST(request: Request) {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured. Add env vars first." }, { status: 503 });
  }

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && (!user.isAuthenticated || !["owner", "manager", "operator"].includes(user.role))) {
    return NextResponse.json({ error: user.isAuthenticated ? `Forbidden for role: ${user.role}` : "Authentication required" }, { status: 403 });
  }

  const payload = bookingCreateSchema.parse(await request.json());
  const supabase = createServiceSupabaseClient();
  if (dateOnly(payload.end_date) < dateOnly(payload.start_date)) {
    return NextResponse.json({ error: "end_date cannot be earlier than start_date." }, { status: 400 });
  }

  const bookingNumber = await generateApiBookingNumber(supabase, user.tenantId, payload.booking_number);

  const [{ data: customer }, { data: vehicle }, { data: existingBooking }] = await Promise.all([
    supabase.from("customers").select("id").eq("tenant_id", user.tenantId).eq("id", payload.customer_id).maybeSingle(),
    supabase
      .from("vehicles")
      .select("id, status, road_tax_due_date, inspection_expires_at")
      .eq("tenant_id", user.tenantId)
      .eq("id", payload.vehicle_id)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id, booking_number")
      .eq("tenant_id", user.tenantId)
      .eq("booking_number", bookingNumber)
      .maybeSingle()
  ]);

  if (!customer) {
    return NextResponse.json({ error: "Customer not found in current tenant." }, { status: 404 });
  }
  if (!vehicle) {
    return NextResponse.json({ error: "Vehicle not found in current tenant." }, { status: 404 });
  }
  if (existingBooking) {
    return NextResponse.json({ error: `Booking number already exists: ${bookingNumberLabel(existingBooking)}.` }, { status: 409 });
  }

  const complianceError = await validateApiVehicleCompliance(supabase, user.tenantId, vehicle, payload.start_date, payload.end_date, user.role);
  if (complianceError) {
    return NextResponse.json({ error: complianceError }, { status: 409 });
  }

  try {
    const block = await findApiBookingBlock(supabase, user.tenantId, payload.vehicle_id, payload.start_date, payload.end_date);
    if (block) {
      return NextResponse.json({ error: `Vehicle is blocked by ${block.type}: ${block.label}.` }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to check vehicle availability." }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      ...payload,
      booking_number: bookingNumber,
      tenant_id: user.tenantId,
      lead_id: payload.lead_id || null,
      payment_status: "unpaid",
      deposit_status: "not_taken"
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (["confirmed", "paid_deposit"].includes(String(payload.status ?? ""))) {
    await supabase
      .from("vehicles")
      .update({ status: "reserved" })
      .eq("tenant_id", user.tenantId)
      .eq("id", payload.vehicle_id)
      .eq("status", "available");
  }

  if (payload.lead_id && data?.id) {
    await supabase
      .from("leads")
      .update({
        status: "booked",
        status_changed_at: new Date().toISOString(),
        converted_to_booking_id: data.id
      })
      .eq("tenant_id", user.tenantId)
      .eq("id", payload.lead_id);
  }

  if (data?.id) {
    sendCustomerNotification(data.id, "booking_confirmed", user.tenantId).catch((err) =>
      console.error("Failed to send booking confirmed notification:", err)
    );
  }

  revalidatePath("/");
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${data.id}`);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${payload.vehicle_id}`);
  revalidatePath(`/customers/${payload.customer_id}`);
  revalidatePath("/launch");
  if (payload.lead_id) revalidatePath(`/leads/${payload.lead_id}`);

  return NextResponse.json({ data }, { status: 201 });
}
