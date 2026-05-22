import { NextResponse } from "next/server";
import { z } from "zod";
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
    return NextResponse.json({
      source: "demo",
      data: [
        { type: "rental", amount: 18900, currency: "THB" },
        { type: "deposit", amount: 10000, currency: "THB" },
        { type: "extras", amount: 1300, currency: "THB", notes: "pickup + delivery" }
      ]
    });
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
  const { data, error } = await supabase
    .from("payments")
    .insert({ ...payload, tenant_id: user.tenantId })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
