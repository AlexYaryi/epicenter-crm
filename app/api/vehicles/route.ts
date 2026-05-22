import { NextResponse } from "next/server";
import { z } from "zod";
import { demoVehicles } from "@/lib/demo-data";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

const vehicleCreateSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  license_plate: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int(),
  body_type: z.string(),
  category: z.string(),
  fuel_type: z.string(),
  transmission: z.string(),
  seats: z.number().int(),
  location_id: z.string().uuid(),
  acquisition_date: z.string(),
  daily_rate_short_term: z.number(),
  daily_rate_long_term: z.number(),
  monthly_rate: z.number()
});

export async function GET() {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ source: "demo", data: demoVehicles });
  }

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
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
  if (user.supabaseConfigured && (!user.isAuthenticated || !["owner", "manager", "marketer"].includes(user.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = vehicleCreateSchema.parse(await request.json());
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...payload, tenant_id: user.tenantId })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
