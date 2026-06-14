import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
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

const dbSourceValues = new Set([
  "google_ads",
  "telegram_channel",
  "telegram_chat",
  "instagram",
  "facebook",
  "whatsapp",
  "referral_marina",
  "localrent",
  "takecars",
  "walk_in",
  "groupswatcher",
  "other"
]);

function cleanPhone(value: unknown) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(/[^\d+]/g, "");
  return cleaned || null;
}

function normalizeSourceForDb(value: unknown) {
  const source = String(value ?? "").trim();
  if (source === "telegram") return "telegram_chat";
  if (source === "manual" || source === "phone" || source === "email" || source === "tilda" || source === "line" || source === "tiktok" || source === "booking_com") return "other";
  return dbSourceValues.has(source) ? source : "other";
}

function sourceDetailWithOriginalSource(source: string, sourceDetail: string | null | undefined) {
  const normalized = normalizeSourceForDb(source);
  const detail = sourceDetail?.trim();
  if (normalized === source || source === "telegram") return detail || null;
  return [detail, `original_source=${source}`].filter(Boolean).join(" | ");
}

function anonymousString(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

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
  const anonymous = payload.anonymous_data ?? {};
  const phone = cleanPhone(anonymousString(anonymous, ["phone", "whatsapp", "contact", "contact_handle"]));
  const email = anonymousString(anonymous, ["email"]);
  const telegram = anonymousString(anonymous, ["telegram_username", "telegram"]);
  let customerId = payload.customer_id ?? null;

  if (customerId) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", user.tenantId)
      .eq("id", customerId)
      .maybeSingle();
    if (customerError) {
      return NextResponse.json({ error: customerError.message }, { status: 500 });
    }
    if (!customer) {
      return NextResponse.json({ error: "Customer not found in current tenant." }, { status: 404 });
    }
  } else if (phone || email || telegram) {
    let matchedCustomer: { id: string } | null = null;
    if (phone) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", user.tenantId)
        .or(`phone.eq.${phone},whatsapp.eq.${phone}`)
        .limit(1)
        .maybeSingle();
      matchedCustomer = data ?? null;
    }
    if (!matchedCustomer && email) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", user.tenantId)
        .eq("email", email)
        .limit(1)
        .maybeSingle();
      matchedCustomer = data ?? null;
    }
    if (!matchedCustomer && telegram) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", user.tenantId)
        .eq("telegram_username", telegram)
        .limit(1)
        .maybeSingle();
      matchedCustomer = data ?? null;
    }
    customerId = matchedCustomer?.id ?? null;
  }

  if (customerId && String(payload.status ?? "new") === "new") {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLead } = await supabase
      .from("leads")
      .select("id, score, status")
      .eq("tenant_id", user.tenantId)
      .eq("customer_id", customerId)
      .eq("status", "new")
      .gt("created_at", twentyFourHoursAgo)
      .limit(1)
      .maybeSingle();
    if (recentLead) {
      return NextResponse.json({ data: recentLead, status: "skipped", message: "Duplicate new lead within 24h" }, { status: 200 });
    }
  }

  if (payload.assigned_to) {
    const { data: assignee, error: assigneeError } = await supabase
      .from("app_users")
      .select("id")
      .eq("tenant_id", user.tenantId)
      .eq("id", payload.assigned_to)
      .eq("active", true)
      .maybeSingle();
    if (assigneeError) {
      return NextResponse.json({ error: assigneeError.message }, { status: 500 });
    }
    if (!assignee) {
      return NextResponse.json({ error: "Assigned user not found or inactive." }, { status: 404 });
    }
  }

  const normalizedSource = normalizeSourceForDb(payload.source);
  const normalizedDetail = sourceDetailWithOriginalSource(payload.source, payload.source_detail);
  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...payload,
      tenant_id: user.tenantId,
      customer_id: customerId,
      source: normalizedSource,
      source_detail: normalizedDetail,
      status_changed_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${data.id}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
  revalidatePath("/launch");

  return NextResponse.json({ data }, { status: 201 });
}
