import { NextResponse } from "next/server";
import { z } from "zod";
import { demoLeads } from "@/lib/demo-data";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

const leadCreateSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  anonymous_data: z.record(z.unknown()).default({}),
  source: z.string(),
  source_detail: z.string().optional(),
  inquiry_text: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
  status: z.string().default("new"),
  score: z.number().int().min(0).max(100).default(0)
});

export async function GET() {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ source: "demo", data: demoLeads });
  }

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("leads")
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
  if (user.supabaseConfigured && (!user.isAuthenticated || !["owner", "manager", "operator", "marketer"].includes(user.role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = leadCreateSchema.parse(await request.json());
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({ ...payload, tenant_id: user.tenantId })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
