import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
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
  daily_rate_short_term: z.number().nonnegative().default(0),
  daily_rate_long_term: z.number().nonnegative().default(0),
  monthly_rate: z.number().nonnegative().default(0),
  acquisition_cost_thb: z.number().nonnegative().default(0),
  deposit_amount: z.number().nonnegative().default(0),
  vin: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(["available", "maintenance", "repair", "retired"]).default("available"),
  public_visible: z.boolean().default(true),
  public_description_ru: z.string().optional(),
  public_description_en: z.string().optional()
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
  const licensePlate = payload.license_plate.trim();
  const vin = payload.vin?.trim() || null;

  const [{ data: location }, { data: duplicatePlate }, duplicateVinResult] = await Promise.all([
    supabase.from("locations").select("id").eq("tenant_id", user.tenantId).eq("id", payload.location_id).maybeSingle(),
    supabase
      .from("vehicles")
      .select("id, license_plate")
      .eq("tenant_id", user.tenantId)
      .ilike("license_plate", licensePlate)
      .limit(1)
      .maybeSingle(),
    vin
      ? supabase
          .from("vehicles")
          .select("id, vin")
          .eq("tenant_id", user.tenantId)
          .eq("vin", vin)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (!location) {
    return NextResponse.json({ error: "Location not found in current tenant." }, { status: 404 });
  }
  if (duplicatePlate) {
    return NextResponse.json({ error: `Vehicle with license plate ${licensePlate} already exists.` }, { status: 409 });
  }
  if (duplicateVinResult.data) {
    return NextResponse.json({ error: `Vehicle with VIN ${vin} already exists.` }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      ...payload,
      tenant_id: user.tenantId,
      license_plate: licensePlate,
      vin,
      color: payload.color?.trim() || null,
      public_description_ru: payload.public_description_ru?.trim() || null,
      public_description_en: payload.public_description_en?.trim() || null,
      acquisition_payment_method: "cash",
      financing_terms: {},
      current_market_value_thb: payload.acquisition_cost_thb || null,
      estimated_resale_value_thb: payload.acquisition_cost_thb || null,
      depreciation_schedule: {},
      high_season_multiplier: 1,
      target_payback_months: 24
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${data.id}`);
  revalidatePath("/launch");
  revalidatePath("/api/tilda/vehicles");
  revalidatePath("/api/tilda/availability");
  revalidatePath("/api/integrations/booking/availability");

  return NextResponse.json({ data }, { status: 201 });
}
