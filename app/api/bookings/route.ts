import { NextResponse } from "next/server";
import { z } from "zod";
import { demoBookings } from "@/lib/demo-data";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

const bookingCreateSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  booking_number: z.string(),
  customer_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  rental_type: z.string(),
  status: z.string().default("draft"),
  start_date: z.string(),
  end_date: z.string(),
  daily_rate_applied: z.number(),
  total_rental_amount: z.number(),
  deposit_amount: z.number().default(0),
  delivery_fee: z.number().default(0),
  extras_total: z.number().default(0),
  discount_amount: z.number().default(0),
  grand_total: z.number(),
  currency: z.string().default("THB")
});

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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = bookingCreateSchema.parse(await request.json());
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("bookings")
    .insert({ ...payload, tenant_id: user.tenantId })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
