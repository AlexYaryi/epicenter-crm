import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;

const leadIntakeSchema = z.object({
  source: z.enum(["google_ads", "facebook", "instagram", "tilda", "whatsapp", "telegram_chat", "groupswatcher", "other"]).default("other"),
  source_detail: z.string().optional(),
  campaign: z.string().optional(),
  ad_id: z.string().optional(),
  form_id: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  telegram_username: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  language_pref: z.enum(["ru", "en"]).default("ru"),
  inquiry_text: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  vehicle_category: z.string().optional(),
  budget_range: z.string().optional(),
  conversation_url: z.string().optional(),
  raw_payload: z.record(z.unknown()).optional()
});

function authorized(request: NextRequest) {
  const expected = process.env.LEAD_WEBHOOK_SECRET || process.env.EPICENTER_MESSAGING_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-epicenter-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === expected || bearer === expected;
}

function scoreLead(input: z.infer<typeof leadIntakeSchema>) {
  let score = 30;
  if (input.phone || input.whatsapp) score += 25;
  if (input.start_date && input.end_date) score += 20;
  if (input.vehicle_category) score += 10;
  if (input.source === "google_ads" || input.source === "facebook" || input.source === "instagram") score += 10;
  if (input.budget_range) score += 5;
  return Math.min(score, 100);
}

function sourceDetail(input: z.infer<typeof leadIntakeSchema>) {
  return [input.source_detail, input.campaign && `campaign=${input.campaign}`, input.ad_id && `ad=${input.ad_id}`, input.form_id && `form=${input.form_id}`]
    .filter(Boolean)
    .join(" | ");
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const input = leadIntakeSchema.parse(await request.json());
  const supabase = createServiceSupabaseClient();

  const { data: tenant, error: tenantError } = await supabase.from("tenants").select("id").order("created_at", { ascending: true }).limit(1).single();
  if (tenantError || !tenant) {
    return NextResponse.json({ error: tenantError?.message ?? "Tenant not found" }, { status: 500 });
  }

  let customerId: string | null = null;
  const phone = input.phone || input.whatsapp || null;

  if (phone || input.email) {
    let customerQuery = supabase.from("customers").select("id").eq("tenant_id", tenant.id).limit(1);
    if (phone) {
      customerQuery = customerQuery.or(`phone.eq.${phone},whatsapp.eq.${phone}`);
    } else if (input.email) {
      customerQuery = customerQuery.eq("email", input.email);
    }

    const { data: existingCustomer } = await customerQuery.maybeSingle();
    if (existingCustomer?.id) {
      customerId = existingCustomer.id;
    } else if (input.name || phone || input.email) {
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          tenant_id: tenant.id,
          full_name: input.name || phone || input.email || "Новый лид",
          phone,
          whatsapp: input.whatsapp || phone,
          telegram_username: input.telegram_username || null,
          email: input.email || null,
          language_pref: input.language_pref,
          source: input.source,
          source_detail: sourceDetail(input) || null,
          first_contact_channel: input.source
        })
        .select("id")
        .single();

      if (customerError) {
        return NextResponse.json({ error: customerError.message }, { status: 400 });
      }
      customerId = newCustomer.id;
    }
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      anonymous_data: {
        name: input.name,
        phone,
        whatsapp: input.whatsapp,
        telegram_username: input.telegram_username,
        email: input.email,
        raw_payload: input.raw_payload
      },
      source: input.source,
      source_detail: sourceDetail(input) || null,
      utm_campaign: input.campaign || null,
      inquiry_text: input.inquiry_text || null,
      inquiry_dates: input.start_date || input.end_date ? { start_date: input.start_date, end_date: input.end_date } : {},
      inquiry_vehicle_category: input.vehicle_category || null,
      budget_range: input.budget_range || null,
      status: "new",
      status_changed_at: new Date().toISOString(),
      score: scoreLead(input),
      conversation_log_url: input.conversation_url || null
    })
    .select("id, score, status")
    .single();

  if (leadError) {
    return NextResponse.json({ error: leadError.message }, { status: 400 });
  }

  if (customerId && input.inquiry_text) {
    await supabase.from("conversation_messages").insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      lead_id: lead.id,
      channel: input.source,
      direction: "inbound",
      sender_type: "customer",
      sender_name: input.name || null,
      contact_handle: phone || input.telegram_username || input.email || null,
      external_message_id: input.ad_id ? `${input.source}:${input.ad_id}:${Date.now()}` : null,
      message_text: input.inquiry_text,
      message_type: "text",
      status: "received",
      raw_payload: input.raw_payload || {},
      occurred_at: new Date().toISOString()
    });
  }

  if (process.env.NTFY_TOPIC) {
    fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: "POST",
      body: `Новый лид: ${input.name || phone || input.source} (${input.source}), score ${lead.score}`,
      headers: {
        Title: "Epicenter CRM: новый лид",
        Priority: lead.score >= 70 ? "high" : "default"
      }
    }).catch(() => undefined);
  }

  return NextResponse.json({ data: lead }, { status: 201 });
}
