import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const messageIntakeSchema = z.object({
  channel: z.enum(["whatsapp", "telegram", "instagram", "facebook", "google_ads", "phone", "email", "manual", "line", "tiktok", "other"]).default("other"),
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  external_message_id: z.string().optional(),
  contact_handle: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  telegram_username: z.string().optional(),
  sender_name: z.string().optional(),
  message_text: z.string().optional().default(""),
  message_type: z.string().default("text"),
  media_url: z.string().optional(),
  occurred_at: z.string().optional(),
  source_detail: z.string().optional(),
  raw_payload: z.record(z.unknown()).optional()
});

function extractMediaUrl(input: z.infer<typeof messageIntakeSchema>) {
  if (input.media_url) return input.media_url;
  const raw = input.raw_payload || {};
  return (
    rawString(raw, "media_url") ||
    rawString(raw, "mediaUrl") ||
    rawString(raw, "url") ||
    rawString(raw, "fileUrl") ||
    rawString(raw, "file_url") ||
    rawString(raw, "photoUrl") ||
    rawString(raw, "videoUrl") ||
    ""
  ) || null;
}

function detectMessageType(input: z.infer<typeof messageIntakeSchema>, mediaUrl: string | null) {
  if (input.message_type && input.message_type !== "text") {
    return normalizeMessageType(input.message_type);
  }
  if (!mediaUrl) return "text";
  
  const urlLower = mediaUrl.toLowerCase();
  if (urlLower.includes(".png") || urlLower.includes(".jpg") || urlLower.includes(".jpeg") || urlLower.includes(".webp") || urlLower.includes(".gif") || urlLower.includes(".heic")) {
    return "image";
  }
  if (urlLower.includes(".mp4") || urlLower.includes(".mov") || urlLower.includes(".avi") || urlLower.includes(".mkv") || urlLower.includes(".webm")) {
    return "video";
  }
  
  const raw = input.raw_payload || {};
  const rawType = String(raw.type || raw.messageType || "").toLowerCase();
  if (rawType.includes("image")) return "image";
  if (rawType.includes("video")) return "video";
  if (rawType.includes("document")) return "document";
  
  return "image";
}

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

function isWhatsAppGroupId(value?: string | null) {
  return (value ?? "").trim().toLowerCase().endsWith("@g.us");
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

function truthyRawBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function rawNestedTruthyBoolean(raw: Record<string, unknown>, objectKey: string, key: string) {
  const value = raw[objectKey];
  if (!value || typeof value !== "object") return false;
  const nested = value as Record<string, unknown>;
  return truthyRawBoolean(nested[key]);
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
    const participantCandidates = [
      rawString(raw, "participant"),
      rawString(raw, "author"),
      rawNestedString(raw, "key", "participant"),
      rawNestedString(raw, "message", "sender"),
      rawNestedString(raw, "message", "from"),
      rawNestedString(raw, "data", "sender"),
      rawNestedString(raw, "data", "from")
    ].filter(Boolean);

    const participant = participantCandidates.find((value) => {
      const lower = value.toLowerCase();
      return !lower.includes("status@broadcast") && !isWhatsAppGroupId(lower);
    });

    if (participant) return normalizeWhatsAppContact(participant);

    const candidates = [
      rawNestedString(raw, "key", "remoteJid"),
      rawString(raw, "remoteJid"),
      rawString(raw, "from"),
      rawString(raw, "sender"),
      rawNestedString(raw, "key", "remoteJid")
    ].filter(Boolean);
    const whatsappSender = candidates.find((value) => {
      const lower = value.toLowerCase();
      return !lower.includes("status@broadcast") && !isWhatsAppGroupId(lower);
    });
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

function isExternalEcho(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  if (input.direction !== "inbound") return false;
  return [
    raw.is_echo,
    raw.echo,
    raw.fromMe,
    raw.from_me,
    rawNestedTruthyBoolean(raw, "key", "fromMe"),
    rawNestedTruthyBoolean(raw, "message", "is_echo"),
    rawNestedTruthyBoolean(raw, "message", "isEcho"),
    rawNestedTruthyBoolean(raw, "data", "is_echo"),
    rawNestedTruthyBoolean(raw, "data", "from_me")
  ].some(truthyRawBoolean);
}

function isWhatsAppLidPayload(input: z.infer<typeof messageIntakeSchema>) {
  const raw = input.raw_payload || {};
  const rawValues = [
    input.contact_handle,
    input.phone,
    input.whatsapp,
    raw.from,
    raw.sender,
    raw.author,
    rawString(raw, "remoteJid"),
    rawString(raw, "participant"),
    rawNestedString(raw, "key", "remoteJid"),
    rawNestedString(raw, "key", "participant"),
    rawNestedString(raw, "message", "sender"),
    rawNestedString(raw, "message", "from"),
    rawNestedString(raw, "data", "sender"),
    rawNestedString(raw, "data", "from")
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return input.channel === "whatsapp" && rawValues.some((value) => value.includes("@lid") || value.endsWith("lid"));
}

function looksLikeRentalInquiry(text: string) {
  const lower = text.toLowerCase();
  if (!lower || looksLikeEncodedPayload(lower)) return false;
  const keywords = [
    "rent",
    "rental",
    "car",
    "book",
    "booking",
    "available",
    "availability",
    "price",
    "month",
    "monthly",
    "day",
    "days",
    "long term",
    "short term",
    "suv",
    "sedan",
    "honda",
    "toyota",
    "nissan",
    "mazda",
    "mitsubishi",
    "ford",
    "mg",
    "airport",
    "phuket",
    "delivery",
    "аренд",
    "машин",
    "авто",
    "снять",
    "брон",
    "заброн",
    "свобод",
    "цена",
    "стоим",
    "месяц",
    "день",
    "дней",
    "сутки",
    "долгоср",
    "аэропорт",
    "пхукет",
    "доставка"
  ];
  return keywords.some((keyword) => lower.includes(keyword));
}

function isExplicitLeadPayload(input: z.infer<typeof messageIntakeSchema>) {
  const sourceText = `${input.source_detail ?? ""}`.toLowerCase();
  return ["lead", "ads", "ad_id", "campaign", "form", "facebook", "instagram", "google", "utm", "groupswatcher"]
    .some((keyword) => sourceText.includes(keyword));
}

function shouldCreateLead(input: z.infer<typeof messageIntakeSchema>, text: string) {
  if (input.direction !== "inbound") return false;
  if (isWhatsAppLidPayload(input) && !input.sender_name) return false;
  if (text === "[technical whatsapp payload]") return false;
  if (text.length < 2) return false;
  if (input.channel === "google_ads") return true;
  if (isExplicitLeadPayload(input)) return true;
  if (["whatsapp", "telegram", "facebook", "instagram", "manual"].includes(input.channel)) {
    return looksLikeRentalInquiry(text);
  }
  return false;
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

  if (isOpaqueWhatsAppId(contact)) {
    return null;
  }

  let previousMessagesQuery = supabase
    .from("conversation_messages")
    .select("customer_id, contact_handle")
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .not("customer_id", "is", null)
    .order("occurred_at", { ascending: false });

  if (contact) {
    const digitsOnly = digits(contact);
    if (digitsOnly && digitsOnly.length >= 7) {
      previousMessagesQuery = previousMessagesQuery.or(`contact_handle.ilike.%${digitsOnly}%,contact_handle.eq.${contact}`);
    } else {
      const cleanContact = contact.replace(/[^a-zA-Z0-9_]/g, "");
      if (cleanContact) {
        previousMessagesQuery = previousMessagesQuery.ilike("contact_handle", `%${cleanContact}%`);
      }
    }
  }

  const { data: previousMessages } = await previousMessagesQuery.limit(1000);

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

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = messageIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }
  const input = parsed.data;

  if (isWhatsAppStatusBroadcast(input)) {
    return NextResponse.json({ status: "ignored", reason: "whatsapp_status_broadcast" }, { status: 202 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: tenant, error: tenantError } = await supabase.from("tenants").select("id").order("created_at", { ascending: true }).limit(1).single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: tenantError?.message ?? "Tenant not found" }, { status: 500 });
  }

  // Handle echo messages (e.g., fromMe = true or is_echo = true)
  const isEcho = isOwnWhatsAppEcho(input) || isExternalEcho(input);
  if (isEcho) {
    const contact = extractInboundContact(input);
    const text = displayMessageText(input);
    
    if (contact && text) {
      const fifteenSecondsAgo = new Date(Date.now() - 15000).toISOString();
      
      const { data: recentSent } = await supabase
        .from("conversation_messages")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("channel", ["line", "tiktok"].includes(input.channel) ? "other" : input.channel)
        .eq("direction", "outbound")
        .eq("message_text", text)
        .gte("occurred_at", fifteenSecondsAgo)
        .limit(1)
        .maybeSingle();

      if (recentSent) {
        // This is a duplicate of a message just sent from the CRM. Ignore it.
        return NextResponse.json({ status: "ignored", reason: "message_echo_crm" }, { status: 202 });
      }
    }
    
    // Not found in CRM outbound messages in the last 15 seconds. This was sent from the phone!
    // Re-route as a valid outbound message.
    input.direction = "outbound";
    if (!input.sender_name) {
      input.sender_name = "Телефон";
    }
  }

  let mediaUrl = extractMediaUrl(input);
  const msgType = detectMessageType(input, mediaUrl);

  let rawText = input.message_text.trim();
  if (looksLikeEncodedPayload(rawText)) {
    if (!mediaUrl) {
      if (msgType === "image") {
        mediaUrl = rawText.startsWith("data:") ? rawText : `data:image/jpeg;base64,${rawText}`;
      } else if (msgType === "video") {
        mediaUrl = rawText.startsWith("data:") ? rawText : `data:video/mp4;base64,${rawText}`;
      }
    }
    rawText = msgType === "video" ? "[Видео]" : "[Фото]";
  }

  const messageText = (!rawText && mediaUrl) ? (msgType === "video" ? "[Видео]" : "[Фото]") : rawText;
  const contact = extractInboundContact(input);
  const senderName = extractSenderName(input);
  const source = sourceForDb(input.channel);
  let customerId: string | null = null;
  const isWhatsAppLid = isWhatsAppLidPayload(input) || (input.channel === "whatsapp" && isOpaqueWhatsAppId(contact));

  if (!customerId && contact) {
    customerId = await findCustomerByConversationHandle(supabase, tenant.id, input.channel, contact);
  }

  if (!customerId && contact && !isWhatsAppLid) {
    const cleanDigits = digits(contact);
    const cleanTg = contact.replace(/[^a-zA-Z0-9_]/g, "");
    
    const orConditions = [
      cleanDigits ? `phone.eq.${cleanDigits},phone.eq.+${cleanDigits}` : null,
      cleanDigits ? `whatsapp.eq.${cleanDigits},whatsapp.eq.+${cleanDigits}` : null,
      cleanTg ? `telegram_username.eq.${cleanTg}` : null
    ].filter(Boolean).join(",");

    if (orConditions) {
      const { data: exactCustomer } = await supabase
        .from("customers")
        .select("id, full_name")
        .eq("tenant_id", tenant.id)
        .or(orConditions)
        .limit(1)
        .maybeSingle();

      if (exactCustomer?.id) {
        customerId = exactCustomer.id;
      }
    }

    if (!customerId) {
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

  let isNewCustomer = false;
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
        source_detail: input.source_detail || (
          input.channel === "line" ? "LINE" :
          input.channel === "tiktok" ? "TikTok" :
          isWhatsAppLid ? `WhatsApp LID: ${contact}` : "incoming message"
        ),
        first_contact_channel: source
      })
      .select("id")
      .single();

    if (customerError) {
      return NextResponse.json({ error: customerError.message }, { status: 400 });
    }
    customerId = newCustomer.id;
    isNewCustomer = true;
  }

  if (!customerId) {
    return NextResponse.json({ status: "ignored", reason: "unidentifiable_contact" }, { status: 202 });
  }

  const { data: latestLead } = await supabase
    .from("leads")
    .select("id, status, notes")
    .eq("tenant_id", tenant.id)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestNotes = Array.isArray(latestLead?.notes) ? latestLead.notes as Array<Record<string, unknown>> : [];
  const isNotLead =
    latestNotes.some((n) => n?.type === "status_flag" && n?.value === "not_lead") ||
    latestLead?.status === "not_lead";

  if (isNotLead) {
    return NextResponse.json({ status: "ignored", reason: "not_lead" }, { status: 202 });
  }

  let leadId: string | null = null;
  const shouldOpenLead = isNewCustomer || shouldCreateLead(input, messageText);

  if (latestLead?.id && !["booked", "lost", "not_lead"].includes(String(latestLead.status))) {
    leadId = latestLead.id;
  } else if (shouldOpenLead) {
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

  const storedChannel = ["line", "tiktok"].includes(input.channel) ? "other" : input.channel;
  if (!input.external_message_id && contact && messageText) {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentDuplicate } = await supabase
      .from("conversation_messages")
      .select("id, customer_id, lead_id")
      .eq("tenant_id", tenant.id)
      .eq("channel", storedChannel)
      .eq("direction", input.direction)
      .eq("contact_handle", contact)
      .eq("message_text", messageText)
      .gte("occurred_at", twoMinutesAgo)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentDuplicate) {
      return NextResponse.json({ data: recentDuplicate, status: "duplicate" }, { status: 200 });
    }
  }

  const { data: message, error: messageError } = await supabase
    .from("conversation_messages")
    .insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      lead_id: leadId,
      channel: storedChannel,
      direction: input.direction,
      sender_type: input.direction === "inbound" ? "customer" : "integration",
      sender_name: senderName || null,
      contact_handle: contact,
      external_message_id: input.external_message_id || null,
      message_text: messageText,
      message_type: msgType,
      media_url: mediaUrl,
      status: input.direction === "inbound" ? "received" : "sent",
      raw_payload: {
        ...(input.raw_payload || {}),
        ...(["line", "tiktok"].includes(input.channel) ? { original_channel: input.channel } : {})
      },
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

  const { error: outboxError } = await supabase.from("event_outbox").insert({
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

  if (outboxError) {
    console.error("Failed to insert event into outbox:", outboxError.message);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/launch");

  return NextResponse.json({ data: message }, { status: 201 });
}
