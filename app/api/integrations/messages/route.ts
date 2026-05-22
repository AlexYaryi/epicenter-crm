import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const messageIntakeSchema = z.object({
  channel: z.enum(["whatsapp", "telegram", "instagram", "facebook", "google_ads", "phone", "email", "manual", "other"]).default("other"),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  external_message_id: z.string().optional(),
  contact_handle: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  telegram_username: z.string().optional(),
  sender_name: z.string().optional(),
  message_text: z.string().min(1),
  message_type: z.string().default("text"),
  occurred_at: z.string().optional(),
  source_detail: z.string().optional(),
  raw_payload: z.record(z.unknown()).optional()
});

function authorized(request: NextRequest) {
  const expected = process.env.EPICENTER_MESSAGING_SECRET || process.env.LEAD_WEBHOOK_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-epicenter-messaging-secret") || request.headers.get("x-epicenter-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === expected || bearer === expected;
}

function digits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function samePhone(left?: string | null, right?: string | null) {
  const a = digits(left);
  const b = digits(right);
  if (!a || !b) return false;
  if (a.length < 7 || b.length < 7) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function sameHandle(left?: string | null, right?: string | null) {
  const a = (left ?? "").trim().toLowerCase();
  const b = (right ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || samePhone(a, b);
}

function isOpaqueWhatsAppId(value?: string | null) {
  const lower = (value ?? "").trim().toLowerCase();
  return lower.includes("@lid") || lower.endsWith("lid");
}

function sameStableContact(left?: string | null, right?: string | null) {
  const a = (left ?? "").trim().toLowerCase();
  const b = (right ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (isOpaqueWhatsAppId(a) || isOpaqueWhatsAppId(b)) return false;
  return samePhone(a, b);
}

function normalizeMessageType(value: string) {
  if (value === "chat") return "text";
  if (["text", "image", "video", "audio", "document", "location"].includes(value)) return value;
  return "other";
}

function rawString(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

function rawNestedString(raw: Record<string, unknown>, objectKey: string, key: string) {
  const value = raw[objectKey];
  if (!value || typeof value !== "object") return "";
  const nested = value as Record<string, unknown>;
  return typeof nested[key] === "string" ? nested[key] : "";
}

function rawNestedBoolean(raw: Record<string, unknown>, objectKey: string, key: string) {
  const value = raw[objectKey];
  if (!value || typeof value !== "object") return false;
  const nested = value as Record<string, unknown>;
  return nested[key] === true;
}

function normalizeWhatsAppContact(value: string) {
  const contact = value.trim();
  const lower = contact.toLowerCase();
  if (lower.includes("@lid") || lower.endsWith("lid")) return contact;
  return contact
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/^whatsapp:/i, "")
    .trim();
}

function extractInboundContact(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  if (input.channel === "whatsapp" && input.direction === "inbound") {
    const candidates = [
      rawNestedString(raw, "key", "remoteJid"),
      rawString(raw, "remoteJid"),
      rawString(raw, "from"),
      rawString(raw, "sender"),
      rawString(raw, "participant"),
      rawString(raw, "author"),
      rawNestedString(raw, "key", "participant"),
      rawNestedString(raw, "key", "remoteJid"),
      rawNestedString(raw, "message", "sender"),
      rawNestedString(raw, "message", "from"),
      rawNestedString(raw, "data", "sender"),
      rawNestedString(raw, "data", "from")
    ].filter(Boolean);
    const whatsappSender = candidates.find((value) => !value.toLowerCase().includes("status@broadcast"));
    if (whatsappSender) return normalizeWhatsAppContact(whatsappSender);
  }

  return input.phone || input.whatsapp || input.contact_handle || input.telegram_username || null;
}

function extractSenderName(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  return (
    input.sender_name ||
    rawString(raw, "pushName") ||
    rawString(raw, "notifyName") ||
    rawString(raw, "name") ||
    rawNestedString(raw, "data", "pushName") ||
    rawNestedString(raw, "data", "notifyName") ||
    null
  );
}

function sourceForDb(channel: z.infer<typeof messageIntakeSchema>["channel"]) {
  if (channel === "telegram") return "telegram_chat";
  if (channel === "facebook" || channel === "instagram" || channel === "google_ads" || channel === "whatsapp") return channel;
  return "other";
}

function looksLikeEncodedPayload(value: string) {
  const compact = value.trim();
  if (compact.length < 250) return false;
  if (compact.includes(" ")) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

function displayMessageText(input: z.infer<typeof messageIntakeSchema>) {
  if (looksLikeEncodedPayload(input.message_text)) {
    const type = normalizeMessageType(input.message_type);
    return type === "text" ? "[technical whatsapp payload]" : `[${type}]`;
  }
  return input.message_text.trim();
}

function isWhatsAppStatusBroadcast(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  return input.channel === "whatsapp" && [raw.from, raw.sender, raw.remoteJid, rawNestedString(raw, "key", "remoteJid")]
    .some((value) => String(value || "").toLowerCase() === "status@broadcast");
}

function isOwnWhatsAppEcho(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  return input.channel === "whatsapp" && input.direction === "inbound" && rawNestedBoolean(raw, "key", "fromMe");
}

function isWhatsAppLidPayload(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  const rawValues = [input.contact_handle, input.phone, input.whatsapp, raw.from, raw.sender, raw.author]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return input.channel === "whatsapp" && rawValues.some((value) => value.includes("@lid") || value.endsWith("lid"));
}

function shouldCreateLead(input: z.infer<typeof messageIntakeSchema>, text: string) {
  if (input.direction !== "inbound") return false;
  if (isWhatsAppLidPayload(input) && !input.sender_name) return false;
  if (text === "[technical whatsapp payload]") return false;
  if (text.length < 2) return false;
  return true;
}

async function findCustomerByConversationHandle(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  channel: string,
  contact: string
) {
  const { data: exactMessage } = await supabase
    .from("conversation_messages")
    .select("customer_id")
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .eq("contact_handle", contact)
    .not("customer_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exactMessage?.customer_id) {
    return exactMessage.customer_id;
  }

  const { data: previousMessages } = await supabase
    .from("conversation_messages")
    .select("customer_id, contact_handle")
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .not("customer_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1000);

  const matched = previousMessages?.find((message) => sameStableContact(message.contact_handle, contact));
  return matched?.customer_id ?? null;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const input = messageIntakeSchema.parse(await request.json());
  if (isWhatsAppStatusBroadcast(input)) {
    return NextResponse.json({ status: "ignored", reason: "whatsapp_status_broadcast" }, { status: 202 });
  }
  if (isOwnWhatsAppEcho(input)) {
    return NextResponse.json({ status: "ignored", reason: "own_whatsapp_echo" }, { status: 202 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: tenant, error: tenantError } = await supabase.from("tenants").select("id").order("created_at", { ascending: true }).limit(1).single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: tenantError?.message ?? "Tenant not found" }, { status: 500 });
  }

  const messageText = displayMessageText(input);
  const contact = extractInboundContact(input);
  const senderName = extractSenderName(input);
  const source = sourceForDb(input.channel);
  let customerId: string | null = null;
  const isWhatsAppLid = isWhatsAppLidPayload(input);

  if (!customerId && contact && !isWhatsAppLid) {
    customerId = await findCustomerByConversationHandle(supabase, tenant.id, input.channel, contact);
  }

  if (!customerId && contact && !isWhatsAppLid) {
    const { data: exactCustomer } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", tenant.id)
      .or(`phone.eq.${contact},whatsapp.eq.${contact},telegram_username.eq.${contact}`)
      .limit(1)
      .maybeSingle();

    if (exactCustomer?.id) {
      customerId = exactCustomer.id;
    } else {
      const { data: candidates } = await supabase
        .from("customers")
        .select("id, phone, whatsapp, telegram_username")
        .eq("tenant_id", tenant.id)
        .limit(1000);
      const matched = candidates?.find((customer) => {
        if (input.channel === "telegram") return sameHandle(customer.telegram_username, contact);
        return samePhone(customer.phone, contact) || samePhone(customer.whatsapp, contact);
      });
      customerId = matched?.id ?? null;
    }
  }

  if (!customerId && contact && isWhatsAppLid && senderName) {
    const { data: lidCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("full_name", senderName)
      .eq("source_detail", `WhatsApp LID: ${contact}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    customerId = lidCustomer?.id ?? null;
  }

  if (!customerId && (contact || senderName)) {
    const { data: newCustomer, error: customerError } = await supabase
      .from("customers")
      .insert({
        tenant_id: tenant.id,
        full_name: senderName || contact || "Новый клиент",
        phone: input.channel === "whatsapp" && !isWhatsAppLid ? contact : input.phone || null,
        whatsapp: input.channel === "whatsapp" && !isWhatsAppLid ? contact : input.whatsapp || null,
        telegram_username: input.channel === "telegram" ? contact : input.telegram_username || null,
        language_pref: "ru",
        source,
        source_detail: input.source_detail || (isWhatsAppLid ? `WhatsApp LID: ${contact}` : "incoming message"),
        first_contact_channel: source
      })
      .select("id")
      .single();

    if (customerError) {
      return NextResponse.json({ error: customerError.message }, { status: 400 });
    }
    customerId = newCustomer.id;
  }

  if (!customerId) {
    return NextResponse.json({ status: "ignored", reason: "unidentifiable_contact" }, { status: 202 });
  }

  let leadId: string | null = null;
  const { data: latestLead } = await supabase
    .from("leads")
    .select("id, status")
    .eq("tenant_id", tenant.id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestLead?.id && !["booked", "lost"].includes(String(latestLead.status))) {
    leadId = latestLead.id;
  } else if (shouldCreateLead(input, messageText)) {
    const { data: lead } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        anonymous_data: {
          name: senderName,
          contact,
          raw_payload: input.raw_payload
        },
        source,
        source_detail: input.source_detail || "incoming message",
        inquiry_text: messageText,
        status: "new",
        status_changed_at: new Date().toISOString(),
        score: 60
      })
      .select("id")
      .single();
    leadId = lead?.id ?? null;
  }

  const { data: message, error: messageError } = await supabase
    .from("conversation_messages")
    .insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      lead_id: leadId,
      channel: input.channel,
      direction: input.direction,
      sender_type: input.direction === "inbound" ? "customer" : "integration",
      sender_name: senderName || null,
      contact_handle: contact,
      external_message_id: input.external_message_id || null,
      message_text: messageText,
      message_type: normalizeMessageType(input.message_type),
      status: input.direction === "inbound" ? "received" : "sent",
      raw_payload: input.raw_payload || {},
      occurred_at: input.occurred_at || new Date().toISOString()
    })
    .select("id, customer_id, lead_id")
    .single();

  if (messageError) {
    if (messageError.code === "23505") {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }
    return NextResponse.json({ error: messageError.message }, { status: 400 });
  }

  await supabase.from("event_outbox").insert({
    tenant_id: tenant.id,
    event_type: "customer.message_received",
    entity_type: "customer",
    entity_id: customerId,
    payload: {
      channel: input.channel,
      direction: input.direction,
      contact,
      message_id: message.id,
      lead_id: leadId,
      content_preview: messageText.slice(0, 160)
    }
  });

  return NextResponse.json({ data: message }, { status: 201 });
}
