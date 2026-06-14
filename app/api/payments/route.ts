import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recalculateCustomerBookingStats } from "@/lib/customer-metrics";
import { calculateBookingFinancialStatus } from "@/lib/payment-status";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

const paymentCreateSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  booking_id: z.string().uuid(),
  amount: z.number().nonnegative(),
  currency: z.string().default("THB"),
  type: z.enum(["rental", "deposit", "extras", "damage", "fine", "refund"]),
  method: z.enum(["cash", "card", "bank_transfer", "crypto_usdt", "crypto_btc", "paypal", "wise"]),
  status: z.enum(["pending", "completed", "failed", "refunded"]).default("completed"),
  notes: z.string().optional()
});

export async function GET() {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
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
  if (user.supabaseConfigured && (!user.isAuthenticated || !["owner", "manager", "operator", "accountant"].includes(user.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = paymentCreateSchema.parse(await request.json());
  const supabase = createServiceSupabaseClient();
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, customer_id, vehicle_id, grand_total, deposit_amount")
    .eq("tenant_id", user.tenantId)
    .eq("id", payload.booking_id)
    .maybeSingle();

  if (bookingError) {
    return NextResponse.json({ error: bookingError.message }, { status: 500 });
  }
  if (!booking) {
    return NextResponse.json({ error: "Booking not found in current tenant." }, { status: 404 });
  }

  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: duplicatePayment, error: duplicateError } = await supabase
    .from("payments")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .eq("booking_id", payload.booking_id)
    .eq("type", payload.type)
    .eq("amount", payload.amount)
    .eq("method", payload.method)
    .eq("status", payload.status)
    .gte("created_at", twoMinutesAgo)
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    return NextResponse.json({ error: `Duplicate payment check failed: ${duplicateError.message}` }, { status: 500 });
  }
  if (duplicatePayment) {
    return NextResponse.json({ data: duplicatePayment, status: "duplicate", message: "Recent duplicate payment was not inserted." }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      ...payload,
      tenant_id: user.tenantId,
      paid_at: payload.status === "completed" ? new Date().toISOString() : null
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: completedPayments, error: paymentsError } = await supabase
    .from("payments")
    .select("amount, type, status")
    .eq("tenant_id", user.tenantId)
    .eq("booking_id", payload.booking_id)
    .eq("status", "completed");

  if (paymentsError) {
    return NextResponse.json({ data, warning: `Payment saved, but booking payment status was not recalculated: ${paymentsError.message}` }, { status: 201 });
  }

  const financialStatus = calculateBookingFinancialStatus(booking, completedPayments ?? []);
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      payment_status: financialStatus.paymentStatus,
      deposit_status: financialStatus.depositStatus
    })
    .eq("tenant_id", user.tenantId)
    .eq("id", payload.booking_id);

  if (updateError) {
    return NextResponse.json({ data, warning: `Payment saved, but booking status was not updated: ${updateError.message}` }, { status: 201 });
  }

  if (booking.customer_id) {
    await recalculateCustomerBookingStats(supabase, user.tenantId, booking.customer_id);
  }
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/handover");
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${payload.booking_id}`);
  if (booking.vehicle_id) revalidatePath(`/fleet/${booking.vehicle_id}`);
  if (booking.customer_id) revalidatePath(`/customers/${booking.customer_id}`);

  return NextResponse.json({
    data,
    booking_status: {
      payment_status: financialStatus.paymentStatus,
      deposit_status: financialStatus.depositStatus,
      rental_due: financialStatus.rentalDue,
      rental_paid: financialStatus.rentalPaid,
      deposit_paid: financialStatus.depositPaid
    }
  }, { status: 201 });
}
