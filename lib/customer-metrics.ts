import { createServiceSupabaseClient } from "./supabase";
import { calculateBookingRevenue } from "./payment-status";

type SupabaseServiceClient = ReturnType<typeof createServiceSupabaseClient>;

const revenueBookingStatuses = new Set(["handed_over", "active", "in_use", "returning", "completed"]);
const revenueRentalStatuses = new Set(["handed_over", "active", "in_use", "returning", "returned"]);

export async function recalculateCustomerBookingStats(
  supabase: SupabaseServiceClient,
  tenantId: string,
  customerId: string | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!customerId) {
    return { ok: true };
  }

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("status, rental_status, start_date, end_date, actual_end, total_rental_amount, deposit_amount, delivery_fee, extras_total, discount_amount, grand_total")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);

  if (bookingsError) {
    return { ok: false, error: bookingsError.message };
  }

  const revenueBookings = (bookings ?? []).filter((booking) => {
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    return revenueBookingStatuses.has(bookingStatus) || revenueRentalStatuses.has(rentalStatus);
  });

  const lifetimeValue = revenueBookings.reduce((sum, booking) => sum + calculateBookingRevenue(booking), 0);
  const lastBookingDate = revenueBookings
    .map((booking) => String(booking.actual_end ?? booking.end_date ?? booking.start_date ?? "").slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const { error: updateError } = await supabase
    .from("customers")
    .update({
      lifetime_value_thb: lifetimeValue,
      total_bookings_count: revenueBookings.length,
      last_booking_date: lastBookingDate
    })
    .eq("tenant_id", tenantId)
    .eq("id", customerId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true };
}
