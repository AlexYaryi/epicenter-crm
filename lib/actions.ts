"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { getCurrentUserContext } from "./repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "./supabase";
import { recalculateCustomerBookingStats } from "./customer-metrics";
import { calculateBookingFinancialStatus, calculateRentalPaymentCoverage } from "./payment-status";
import type { Role } from "./types";

function requireSupabase() {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createServiceSupabaseClient();
}

async function refreshCustomerBookingStats(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  customerId: string | null | undefined
) {
  const result = await recalculateCustomerBookingStats(supabase, tenantId, customerId);
  if (!result.ok) {
    console.warn("Customer booking stats recalculation failed.", result.error);
  }
}

function formString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDateInput(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;
  const dottedMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dottedMatch) {
    const [, day, month, year] = dottedMatch;
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function hasValidDrivingPermit(idpNumber: string | null | undefined, idpExpires: string | null | undefined) {
  const normalizedExpires = normalizeDateInput(idpExpires);
  if (!idpNumber?.trim() || !normalizedExpires) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expiresUtc = Date.parse(`${normalizedExpires}T00:00:00.000Z`);
  return !Number.isNaN(expiresUtc) && expiresUtc >= todayUtc;
}

function hasMediaItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function hasChecklistVideos(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const videos = (value as { videos?: unknown }).videos;
  return Array.isArray(videos) && videos.length > 0;
}

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

async function validateVehicleComplianceForBooking(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicleId: string,
  startDate: string,
  endDate: string,
  role: Role,
  vehicleLabel = "Автомобиль"
) {
  return null;
}

function revalidatePublicVehicleApis() {
  revalidatePath("/api/tilda/vehicles");
  revalidatePath("/api/tilda/availability");
}

function cleanPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/[^\d+]/g, "");
  return cleaned || null;
}

async function findDuplicateCustomerMessage(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  input: { phone?: string | null; whatsapp?: string | null; telegram_username?: string | null; passport_number?: string | null },
  excludeCustomerId?: string
) {
  const baseSelect = "id, full_name, phone, whatsapp, telegram_username, passport_number";
  const seen = new Set<string>();
  const checks: Array<{ key: string; label: string; run: () => Promise<{ data: any[] | null; error: { message: string } | null }> }> = [];
  const addPhoneCheck = (value: string | null, label: string) => {
    if (!value || seen.has(`phone:${value}`)) return;
    seen.add(`phone:${value}`);
    checks.push({
      key: value,
      label,
      run: async () => {
        let query = supabase
          .from("customers")
          .select(baseSelect)
          .eq("tenant_id", tenantId)
          .or(`phone.eq.${value},whatsapp.eq.${value}`)
          .limit(1);
        if (excludeCustomerId) query = query.neq("id", excludeCustomerId);
        return query;
      }
    });
  };

  addPhoneCheck(cleanPhone(input.phone), "телефоном");
  addPhoneCheck(cleanPhone(input.whatsapp), "WhatsApp");

  const telegram = input.telegram_username?.trim();
  if (telegram) {
    checks.push({
      key: telegram,
      label: "Telegram",
      run: async () => {
        let query = supabase
          .from("customers")
          .select(baseSelect)
          .eq("tenant_id", tenantId)
          .eq("telegram_username", telegram)
          .limit(1);
        if (excludeCustomerId) query = query.neq("id", excludeCustomerId);
        return query;
      }
    });
  }

  const passport = input.passport_number?.trim();
  if (passport) {
    checks.push({
      key: passport,
      label: "паспортом",
      run: async () => {
        let query = supabase
          .from("customers")
          .select(baseSelect)
          .eq("tenant_id", tenantId)
          .eq("passport_number", passport)
          .limit(1);
        if (excludeCustomerId) query = query.neq("id", excludeCustomerId);
        return query;
      }
    });
  }

  for (const check of checks) {
    const { data, error } = await check.run();
    if (error) return `Не удалось проверить дубли клиента: ${error.message}`;
    const duplicate = data?.[0];
    if (duplicate) {
      return `Клиент с таким ${check.label} уже есть: ${duplicate.full_name ?? duplicate.id}. Откройте существующую карточку или объедините клиентов.`;
    }
  }

  return null;
}

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

function normalizeSourceForDb(value: FormDataEntryValue | string | null | undefined) {
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

async function requireRole(roles: Role[]) {
  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    console.warn("Authentication required.");
    return null;
  }
  if (!roles.includes(user.role)) {
    console.warn(`Current role cannot perform this action: ${user.role}.`);
    return null;
  }
  return user;
}

const leadSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  source: z.string().min(1),
  source_detail: z.string().optional(),
  campaign: z.string().optional(),
  conversation_log_url: z.string().optional(),
  customer_name: z.string().min(1),
  phone: z.string().optional(),
  inquiry_text: z.string().optional(),
  status: z.enum(["new", "contacted", "qualified", "quoted", "negotiating", "booked", "lost", "not_lead"]).default("new"),
  score: z.coerce.number().int().min(0).max(100).default(50)
});

const customerSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  full_name: z.string().min(1),
  full_name_passport: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  telegram_username: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  nationality: z.string().optional(),
  language_pref: z.enum(["ru", "en"]).default("ru"),
  source: z.string().default("whatsapp"),
  source_detail: z.string().optional(),
  passport_number: z.string().optional(),
  passport_expires: z.string().optional(),
  idp_number: z.string().optional(),
  idp_expires: z.string().optional()
});

const leadCustomerSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  lead_id: z.string().uuid(),
  existing_customer_id: z.string().uuid().optional().or(z.literal("")),
  full_name: z.string().optional(),
  phone: z.string().optional(),
  telegram_username: z.string().optional(),
  source: z.string().default("whatsapp")
});

export async function createCustomerAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав для создания клиента.");

  const parsed = customerSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    full_name: formString(formData.get("full_name")),
    full_name_passport: formString(formData.get("full_name_passport")),
    phone: formString(formData.get("phone")),
    whatsapp: formString(formData.get("whatsapp")),
    telegram_username: formString(formData.get("telegram_username")),
    email: formString(formData.get("email")),
    nationality: formString(formData.get("nationality")),
    language_pref: formData.get("language_pref") || "ru",
    source: formString(formData.get("source")) || "whatsapp",
    source_detail: formString(formData.get("source_detail")),
    passport_number: formString(formData.get("passport_number")),
    passport_expires: formString(formData.get("passport_expires")),
    idp_number: formString(formData.get("idp_number")),
    idp_expires: formString(formData.get("idp_expires"))
  });

  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные клиента.");
  }

  const input = parsed.data;
  const customerSource = normalizeSourceForDb(input.source);
  const customerSourceDetail = sourceDetailWithOriginalSource(input.source, input.source_detail);
  const passportExpires = normalizeDateInput(input.passport_expires);
  const idpExpires = normalizeDateInput(input.idp_expires);
  const hasValidIdp = hasValidDrivingPermit(input.idp_number, idpExpires);
  const duplicateMessage = await findDuplicateCustomerMessage(supabase, user.tenantId, input);
  if (duplicateMessage) return actionError(duplicateMessage);

  const { data: customer, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: user.tenantId,
      full_name: input.full_name,
      full_name_passport: input.full_name_passport || null,
      phone: cleanPhone(input.phone),
      whatsapp: cleanPhone(input.whatsapp) || cleanPhone(input.phone),
      telegram_username: input.telegram_username || null,
      email: input.email || null,
      nationality: input.nationality || null,
      language_pref: input.language_pref,
      source: customerSource,
      source_detail: customerSourceDetail,
      passport_number: input.passport_number || null,
      passport_expires: passportExpires,
      idp_number: input.idp_number || null,
      idp_expires: idpExpires,
      has_valid_idp: hasValidIdp,
      first_contact_channel: customerSource
    })
    .select("id")
    .single();

  if (error) {
    console.error(error.message);
    if (error.code === "23505") {
      return actionError("Клиент с таким номером телефона уже зарегистрирован в системе.");
    }
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/fleet");
  const returnPath = formString(formData.get("return_path"));
  if (returnPath.startsWith("/")) revalidatePath(returnPath.split("#")[0]);
  return actionOk("Клиент создан. Теперь его можно выбрать в броне.", customer?.id);
}

export async function createCustomerFromLeadAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав для создания клиента из лида.");

  const parsed = leadCustomerSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    lead_id: formData.get("lead_id"),
    existing_customer_id: formData.get("existing_customer_id"),
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    telegram_username: formData.get("telegram_username"),
    source: formData.get("source") || "whatsapp"
  });
  if (!parsed.success) return actionError("Проверьте имя клиента и данные лида.");
  const input = parsed.data;
  const customerSource = normalizeSourceForDb(input.source);

  const { data: leadForLink, error: leadForLinkError } = await supabase
    .from("leads")
    .select("id, customer_id, anonymous_data, converted_to_booking_id")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.lead_id)
    .maybeSingle();

  if (leadForLinkError || !leadForLink) {
    console.error(leadForLinkError?.message ?? "Lead not found.");
    return actionError("Лид не найден в текущей компании.");
  }

  if (input.existing_customer_id) {
    const { data: existingCustomer, error: existingCustomerError } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", user.tenantId)
      .eq("id", input.existing_customer_id)
      .maybeSingle();

    if (existingCustomerError || !existingCustomer) {
      console.error(existingCustomerError?.message ?? "Existing customer not found.");
      return actionError("Выбранный клиент не найден в текущей компании.");
    }

    if (leadForLink.customer_id && leadForLink.customer_id !== existingCustomer.id) {
      return actionError("Лид уже привязан к другому клиенту. Откройте текущую карточку клиента вместо новой привязки.");
    }

    const { error: leadLinkError } = await supabase
      .from("leads")
      .update({
        customer_id: existingCustomer.id,
        status_changed_at: new Date().toISOString()
      })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.lead_id);

    if (leadLinkError) {
      console.error(leadLinkError.message);
      return actionError(leadLinkError.message);
    }

    await supabase
      .from("conversation_messages")
      .update({ customer_id: existingCustomer.id })
      .eq("tenant_id", user.tenantId)
      .eq("lead_id", input.lead_id)
      .is("customer_id", null);

    revalidatePath("/");
    revalidatePath("/leads");
    revalidatePath(`/leads/${input.lead_id}`);
    revalidatePath("/customers");
    revalidatePath(`/customers/${existingCustomer.id}`);
    return actionOk(`Лид привязан к клиенту ${existingCustomer.full_name}.`, existingCustomer.id);
  }

  if (!input.full_name?.trim()) {
    return actionError("Введите имя нового клиента или выберите существующего клиента для привязки.");
  }
  if (leadForLink.customer_id) {
    return actionError("Лид уже привязан к клиенту. Откройте существующую карточку клиента вместо создания дубля.");
  }
  const duplicateMessage = await findDuplicateCustomerMessage(supabase, user.tenantId, {
    phone: input.phone,
    whatsapp: customerSource === "whatsapp" ? input.phone : null,
    telegram_username: input.telegram_username
  });
  if (duplicateMessage) return actionError(duplicateMessage);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      tenant_id: user.tenantId,
      full_name: input.full_name,
      phone: cleanPhone(input.phone),
      whatsapp: customerSource === "whatsapp" ? cleanPhone(input.phone) : null,
      telegram_username: input.telegram_username || null,
      language_pref: "ru",
      source: customerSource,
      first_contact_channel: customerSource
    })
    .select("id")
    .single();

  if (customerError || !customer) {
    console.error(customerError?.message ?? "Customer was not created.");
    if (customerError?.code === "23505") {
      return actionError("Клиент с таким номером телефона уже зарегистрирован в системе.");
    }
    return actionError(customerError?.message ?? "Клиент не создан.");
  }

  const previousAnonymous = (leadForLink.anonymous_data ?? {}) as Record<string, unknown>;

  const { error: leadError } = await supabase
    .from("leads")
    .update({
      customer_id: customer.id,
      anonymous_data: {
        ...previousAnonymous,
        name: input.full_name,
        phone: input.phone,
        telegram_username: input.telegram_username,
        source: customerSource
      }
    })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.lead_id);

  if (leadError) {
    console.error(leadError.message);
    await supabase.from("customers").delete().eq("tenant_id", user.tenantId).eq("id", customer.id);
    return actionError(`Клиент создан, но лид не привязан: ${leadError.message}`);
  }

  await supabase
    .from("conversation_messages")
    .update({ customer_id: customer.id })
    .eq("tenant_id", user.tenantId)
    .eq("lead_id", input.lead_id)
    .is("customer_id", null);

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${input.lead_id}`);
  revalidatePath("/customers");
  revalidatePath(`/customers/${customer.id}`);
  return actionOk("Клиент создан и привязан к лиду.", customer.id);
}

export async function createLeadAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав для создания лида.");

  const parsed = leadSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    source: formData.get("source"),
    source_detail: formData.get("source_detail"),
    campaign: formData.get("campaign"),
    conversation_log_url: formData.get("conversation_log_url"),
    customer_name: formData.get("customer_name"),
    phone: formData.get("phone"),
    inquiry_text: formData.get("inquiry_text"),
    status: formData.get("status") || "new",
    score: formData.get("score") || 50
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные лида.");
  }
  const input = parsed.data;
  const leadSource = normalizeSourceForDb(input.source);
  const leadSourceDetail = sourceDetailWithOriginalSource(input.source, input.source_detail);

  const { data: lead, error } = await supabase.from("leads").insert({
    tenant_id: user.tenantId,
    source: leadSource,
    source_detail: leadSourceDetail,
    utm_campaign: input.campaign || null,
    anonymous_data: {
      name: input.customer_name,
      phone: input.phone,
      source: leadSource,
      source_detail: leadSourceDetail,
      campaign: input.campaign
    },
    inquiry_text: input.inquiry_text,
    status: input.status === "not_lead" ? "lost" : input.status,
    score: input.score,
    conversation_log_url: input.conversation_log_url || null,
    notes: input.status === "not_lead"
      ? [{ at: new Date().toISOString(), type: "status_flag", value: "not_lead" }]
      : []
  }).select("id").single();

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/leads");
  if (lead?.id) revalidatePath(`/leads/${lead.id}`);
  return actionOk("Лид создан. Можно открыть карточку и вести его по воронке.", lead?.id);
}

export async function createLeadFromCustomerAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав для создания сделки.");

  const customerId = formData.get("customer_id");
  if (!customerId || typeof customerId !== "string") {
    return actionError("Не указан идентификатор клиента.");
  }

  const { data: customer, error: fetchError } = await supabase
    .from("customers")
    .select("id, full_name, phone, whatsapp, telegram_username, source, source_detail")
    .eq("id", customerId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (fetchError || !customer) {
    return actionError(fetchError?.message ?? "Клиент не найден.");
  }

  const { data: lead, error: insertError } = await supabase
    .from("leads")
    .insert({
      tenant_id: user.tenantId,
      customer_id: customer.id,
      source: customer.source || "manual",
      source_detail: customer.source_detail || "Ручное создание",
      inquiry_text: "Сделка создана вручную из карточки клиента",
      status: "new",
      status_changed_at: new Date().toISOString(),
      score: 60,
      anonymous_data: {
        name: customer.full_name,
        phone: customer.phone || customer.whatsapp || null,
        telegram: customer.telegram_username || null,
        source: customer.source || "manual"
      }
    })
    .select("id")
    .single();

  if (insertError) {
    console.error(insertError.message);
    return actionError(`Не удалось создать сделку: ${insertError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customer.id}`);
  if (lead?.id) revalidatePath(`/leads/${lead.id}`);

  return actionOk("Сделка начата. Лид успешно создан.", lead?.id);
}

const vehicleSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  location_id: z.string().uuid(),
  license_plate: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce.number().int().min(1990).max(2100),
  vin: z.string().optional(),
  color: z.string().optional(),
  body_type: z.string().default("sedan"),
  category: z.string().default("economy"),
  fuel_type: z.string().default("gasoline"),
  transmission: z.string().default("auto"),
  seats: z.coerce.number().int().min(1).max(12).default(5),
  mileage_current: z.coerce.number().int().nonnegative().default(0),
  status: z.string().default("available"),
  ownership_type: z.string().default("own"),
  acquisition_cost_thb: z.coerce.number().nonnegative().default(0),
  acquisition_date: z.string(),
  daily_rate_short_term: z.coerce.number().nonnegative().default(0),
  daily_rate_long_term: z.coerce.number().nonnegative().default(0),
  monthly_rate: z.coerce.number().nonnegative().default(0),
  deposit_amount: z.coerce.number().nonnegative().default(0),
  notes_internal: z.string().optional(),
  public_visible: z.coerce.boolean().default(true),
  public_sort_order: z.coerce.number().int().default(100),
  public_description_ru: z.string().optional(),
  public_description_en: z.string().optional(),
  public_features: z.string().optional()
});

export async function createVehicleAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return actionError("Недостаточно прав для добавления автомобиля.");

  const parsed = vehicleSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    location_id: formData.get("location_id"),
    license_plate: formData.get("license_plate"),
    make: formData.get("make"),
    model: formData.get("model"),
    year: formData.get("year"),
    vin: formData.get("vin"),
    color: formData.get("color"),
    body_type: formData.get("body_type") || "sedan",
    category: formData.get("category") || "economy",
    fuel_type: formData.get("fuel_type") || "gasoline",
    transmission: formData.get("transmission") || "auto",
    seats: formData.get("seats") || 5,
    mileage_current: formData.get("mileage_current") || 0,
    status: formData.get("status") || "available",
    ownership_type: formData.get("ownership_type") || "own",
    acquisition_cost_thb: formData.get("acquisition_cost_thb") || 0,
    acquisition_date: formData.get("acquisition_date"),
    daily_rate_short_term: formData.get("daily_rate_short_term") || 0,
    daily_rate_long_term: formData.get("daily_rate_long_term") || 0,
    monthly_rate: formData.get("monthly_rate") || 0,
    deposit_amount: formData.get("deposit_amount") || 0,
    notes_internal: formData.get("notes_internal"),
    public_visible: formData.has("public_visible") ? formData.get("public_visible") === "on" : undefined,
    public_sort_order: formData.get("public_sort_order") || 100,
    public_description_ru: formData.get("public_description_ru"),
    public_description_en: formData.get("public_description_en"),
    public_features: formData.get("public_features")
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте обязательные поля автомобиля.");
  }
  const input = parsed.data;

  const { error } = await supabase.from("vehicles").insert({
    ...input,
    tenant_id: user.tenantId,
    status: normalizeManualVehicleStatus(input.status) ?? "available",
    vin: input.vin || null,
    color: input.color || null,
    notes_internal: input.notes_internal || null,
    acquisition_payment_method: "cash",
    financing_terms: {},
    current_market_value_thb: input.acquisition_cost_thb || null,
    estimated_resale_value_thb: input.acquisition_cost_thb || null,
    depreciation_schedule: {},
    high_season_multiplier: 1,
    target_payback_months: 24,
    public_description_ru: input.public_description_ru || null,
    public_description_en: input.public_description_en || null,
    public_features: input.public_features ? input.public_features.split(",").map((item) => item.trim()).filter(Boolean) : []
  });
  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePublicVehicleApis();
  return actionOk("Автомобиль добавлен в автопарк.");
}

const emptyStringToUndefined = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? undefined : val),
  z.string().optional()
);

const nullableCoercedNumber = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? undefined : val),
  z.coerce.number().nonnegative().optional()
);

const nullableCoercedInt = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? undefined : val),
  z.coerce.number().int().optional()
);

const vehicleUpdateSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  license_plate: emptyStringToUndefined,
  make: emptyStringToUndefined,
  model: emptyStringToUndefined,
  year: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : val),
    z.coerce.number().int().min(1990).max(2100).optional()
  ),
  vin: emptyStringToUndefined,
  color: emptyStringToUndefined,
  body_type: emptyStringToUndefined,
  category: emptyStringToUndefined,
  fuel_type: emptyStringToUndefined,
  transmission: emptyStringToUndefined,
  seats: nullableCoercedInt,
  mileage_current: nullableCoercedInt,
  status: emptyStringToUndefined,
  ownership_type: emptyStringToUndefined,
  acquisition_cost_thb: nullableCoercedNumber,
  acquisition_date: emptyStringToUndefined,
  daily_rate_short_term: nullableCoercedNumber,
  daily_rate_long_term: nullableCoercedNumber,
  monthly_rate: nullableCoercedNumber,
  deposit_amount: nullableCoercedNumber,
  notes_internal: emptyStringToUndefined,
  public_visible: z.preprocess(
    (val) => val === "on" || val === true,
    z.boolean().optional()
  ),
  public_sort_order: nullableCoercedInt,
  public_description_ru: emptyStringToUndefined,
  public_description_en: emptyStringToUndefined,
  public_features: emptyStringToUndefined
});

export async function updateVehicleAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return actionError("Недостаточно прав для изменения автомобиля.");

  const parsed = vehicleUpdateSchema.safeParse({
    id: formData.get("id"),
    tenant_id: formData.get("tenant_id"),
    location_id: formData.get("location_id"),
    license_plate: formData.get("license_plate"),
    make: formData.get("make"),
    model: formData.get("model"),
    year: formData.get("year"),
    vin: formData.get("vin"),
    color: formData.get("color"),
    body_type: formData.get("body_type"),
    category: formData.get("category"),
    fuel_type: formData.get("fuel_type"),
    transmission: formData.get("transmission"),
    seats: formData.get("seats"),
    mileage_current: formData.get("mileage_current"),
    status: formData.get("status"),
    ownership_type: formData.get("ownership_type"),
    acquisition_cost_thb: formData.get("acquisition_cost_thb"),
    acquisition_date: formData.get("acquisition_date"),
    daily_rate_short_term: formData.get("daily_rate_short_term"),
    daily_rate_long_term: formData.get("daily_rate_long_term"),
    monthly_rate: formData.get("monthly_rate"),
    deposit_amount: formData.get("deposit_amount"),
    notes_internal: formData.get("notes_internal"),
    public_visible: formData.get("public_visible") === "on",
    public_sort_order: formData.get("public_sort_order"),
    public_description_ru: formData.get("public_description_ru"),
    public_description_en: formData.get("public_description_en"),
    public_features: formData.get("public_features")
  });

  if (!parsed.success) {
    console.error("Zod validation error updating vehicle:", parsed.error.issues);
    return actionError(`Проверьте правильность заполнения полей: ${parsed.error.issues[0]?.message ?? "некорректный формат."}`);
  }

  const input = parsed.data;
  const requestedVehicleStatus = normalizeManualVehicleStatus(input.status);

  if (requestedVehicleStatus && ["maintenance", "repair", "retired"].includes(requestedVehicleStatus)) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: blockingBookings, error: blockingBookingsError } = await supabase
      .from("bookings")
      .select("id, booking_number, status, rental_status, start_date, end_date, actual_end")
      .eq("tenant_id", user.tenantId)
      .eq("vehicle_id", input.id)
      .in("status", ["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"])
      .limit(1000);

    if (blockingBookingsError) {
      console.error(blockingBookingsError.message);
      return actionError("Не удалось проверить активные брони перед изменением статуса автомобиля.");
    }

    const blockingBooking = (blockingBookings ?? []).find((booking) => {
      const status = String(booking.status ?? "");
      const rentalStatus = String(booking.rental_status ?? "");
      const start = String(booking.start_date ?? "").slice(0, 10);
      const end = String(booking.actual_end ?? booking.end_date ?? "").slice(0, 10);
      if (rentalStatusIsActive(rentalStatus) || rentalStatusIsActive(status)) return true;
      return ["confirmed", "paid_deposit"].includes(status) && start <= today && end >= today;
    });

    if (blockingBooking) {
      return actionError(`Статус заблокирован: автомобиль связан с активной бронью ${bookingNumberLabel(blockingBooking)}. Сначала завершите аренду/возврат или перенесите бронь.`);
    }
  }

  const vehiclePatch: Record<string, unknown> = {};
  const setIfPresent = (key: string, value: unknown) => {
    if (value !== undefined) vehiclePatch[key] = value;
  };

  setIfPresent("location_id", input.location_id);
  setIfPresent("license_plate", input.license_plate);
  setIfPresent("make", input.make);
  setIfPresent("model", input.model);
  setIfPresent("year", input.year);
  setIfPresent("vin", input.vin);
  setIfPresent("color", input.color);
  setIfPresent("body_type", input.body_type);
  setIfPresent("category", input.category);
  setIfPresent("fuel_type", input.fuel_type);
  setIfPresent("transmission", input.transmission);
  setIfPresent("seats", input.seats);
  setIfPresent("mileage_current", input.mileage_current);
  setIfPresent("status", requestedVehicleStatus);
  setIfPresent("ownership_type", input.ownership_type);
  setIfPresent("acquisition_cost_thb", input.acquisition_cost_thb);
  setIfPresent("acquisition_date", input.acquisition_date);
  setIfPresent("daily_rate_short_term", input.daily_rate_short_term);
  setIfPresent("daily_rate_long_term", input.daily_rate_long_term);
  setIfPresent("monthly_rate", input.monthly_rate);
  setIfPresent("deposit_amount", input.deposit_amount);
  setIfPresent("notes_internal", input.notes_internal);
  setIfPresent("public_visible", input.public_visible);
  setIfPresent("public_sort_order", input.public_sort_order);
  setIfPresent("public_description_ru", input.public_description_ru);
  setIfPresent("public_description_en", input.public_description_en);
  setIfPresent(
    "public_features",
    input.public_features ? input.public_features.split(",").map((item) => item.trim()).filter(Boolean) : undefined
  );

  if (Object.keys(vehiclePatch).length === 0) {
    return actionOk("Нет изменений для сохранения.");
  }

  const { error } = await supabase
    .from("vehicles")
    .update(vehiclePatch)
    .eq("id", input.id)
    .eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  if (vehiclePatch.status === "available") {
    await syncVehicleStatusForBooking(supabase, user.tenantId, input.id);
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.id}`);
  revalidatePublicVehicleApis();
  return actionOk("Данные автомобиля успешно обновлены.");
}

const vehiclePhotoSchema = z.object({
  vehicle_id: z.string().uuid()
});

export async function uploadVehiclePhotoAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) return;
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return;

  const input = vehiclePhotoSchema.parse({ vehicle_id: formData.get("vehicle_id") });
  const files = formData
    .getAll("files")
    .filter((file): file is File => file instanceof File && file.size > 0);
  const legacyFile = formData.get("file");
  if (legacyFile instanceof File && legacyFile.size > 0) {
    files.push(legacyFile);
  }

  if (files.length === 0) {
    console.warn("No vehicle photos selected.");
    return;
  }

  const { data: vehicle, error: readError } = await supabase
    .from("vehicles")
    .select("photos")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id)
    .maybeSingle();
  if (readError || !vehicle) {
    console.error(readError?.message ?? "Vehicle not found.");
    return;
  }

  const uploadedUrls: string[] = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${input.vehicle_id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("vehicle-photos").upload(path, file, {
      contentType: file.type,
      upsert: false
    });
    if (uploadError) {
      console.error(uploadError.message);
      continue;
    }

    const { data: publicUrl } = supabase.storage.from("vehicle-photos").getPublicUrl(path);
    uploadedUrls.push(publicUrl.publicUrl);
  }

  if (uploadedUrls.length === 0) {
    return;
  }

  const photos = Array.isArray(vehicle.photos) ? vehicle.photos : [];
  const { error } = await supabase
    .from("vehicles")
    .update({ photos: [...photos, ...uploadedUrls] })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id);
  if (error) console.error(error.message);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePath("/api/tilda/vehicles");
}

const vehiclePricingSchema = z.object({
  vehicle_id: z.string().uuid()
});

const shortTermPriceBuckets = [
  { key: "1_day", minDays: 1, maxDays: 1, monthly: false },
  { key: "2_day", minDays: 2, maxDays: 2, monthly: false },
  { key: "3_4_day", minDays: 3, maxDays: 4, monthly: false },
  { key: "5_6_day", minDays: 5, maxDays: 6, monthly: false },
  { key: "7_12_day", minDays: 7, maxDays: 12, monthly: false },
  { key: "13_20_day", minDays: 13, maxDays: 20, monthly: false },
  { key: "21_29_day", minDays: 21, maxDays: 29, monthly: false },
  { key: "1_month", minDays: 30, maxDays: 999, monthly: true }
] as const;

function numberOrNull(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function upsertVehiclePricingAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен. Матрица цен не сохранена.");
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return actionError("Недостаточно прав для изменения цен.");

  const parsed = vehiclePricingSchema.safeParse({
    vehicle_id: formData.get("vehicle_id")
  });
  if (!parsed.success) return actionError("Не найден автомобиль для сохранения цен.");
  const input = parsed.data;

  const rows = [];
  const seasons = [
    { key: "high", months: [11, 12, 1, 2, 3] },
    { key: "medium", months: [4, 5, 6, 7, 8, 9, 10] }
  ];

  for (const season of seasons) {
    for (const bucket of shortTermPriceBuckets) {
      const amount = numberOrNull(formData.get(`price_${season.key}_${bucket.key}`));
      rows.push({
        tenant_id: user.tenantId,
        vehicle_id: input.vehicle_id,
        season: season.key,
        season_months: season.months,
        duration_bucket: bucket.key,
        min_days: bucket.minDays,
        max_days: bucket.maxDays,
        daily_rate_thb: bucket.monthly ? null : amount,
        monthly_rate_thb: bucket.monthly ? amount : null,
        currency: "THB",
        active: amount !== null
      });
    }
  }

  const { error: deactivateError } = await supabase
    .from("vehicle_price_rules")
    .update({ active: false })
    .eq("tenant_id", user.tenantId)
    .eq("vehicle_id", input.vehicle_id)
    .eq("season", "custom");
  if (deactivateError) return actionError(`Не удалось обновить старые Long Term цены: ${deactivateError.message}`);

  const longTermAmount = numberOrNull(formData.get("price_long_term_monthly"));
  rows.push({
    tenant_id: user.tenantId,
    vehicle_id: input.vehicle_id,
    season: "custom",
    season_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    duration_bucket: "long_term",
    min_days: 30,
    max_days: 3650,
    daily_rate_thb: null,
    monthly_rate_thb: longTermAmount,
    currency: "THB",
    active: longTermAmount !== null
  });

  const { error } = await supabase.from("vehicle_price_rules").upsert(rows, {
    onConflict: "tenant_id,vehicle_id,season,duration_bucket,min_days,max_days"
  });

  if (error) {
    console.error(error.message);
    return actionError(`Матрица цен не сохранена: ${error.message}`);
  }

  const highDay = numberOrNull(formData.get("price_high_1_day"));
  const longMonth = longTermAmount;
  const highMonth = numberOrNull(formData.get("price_high_1_month"));
  const monthlyRate = longMonth ?? highMonth;
  const vehicleUpdate: Record<string, number> = {};
  if (highDay !== null) vehicleUpdate.daily_rate_short_term = highDay;
  if (monthlyRate !== null) {
    vehicleUpdate.monthly_rate = monthlyRate;
    vehicleUpdate.daily_rate_long_term = Math.round(monthlyRate / 30);
  }
  if (Object.keys(vehicleUpdate).length > 0) {
    const { error: vehicleError } = await supabase
      .from("vehicles")
      .update(vehicleUpdate)
      .eq("tenant_id", user.tenantId)
      .eq("id", input.vehicle_id);
    if (vehicleError) return actionError(`Цены сохранены, но карточка машины не обновилась: ${vehicleError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePublicVehicleApis();
  return actionOk("Матрица цен сохранена. Каталог Tilda получит новые цены через API.");
}

const vehiclePhotoDeleteSchema = z.object({
  vehicle_id: z.string().uuid(),
  photo_url: z.string().url()
});

const vehicleComplianceSchema = z.object({
  vehicle_id: z.string().uuid(),
  insurance_type: z.enum(["CMI_compulsory", "1st_class", "2nd_class", "3rd_class"]).default("1st_class"),
  insurance_provider: z.string().optional().nullable(),
  insurance_phone: z.string().optional().nullable(),
  policy_number: z.string().optional().nullable(),
  insurance_start_date: z.string().optional().nullable(),
  insurance_end_date: z.string().optional().nullable(),
  premium_amount: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? 0 : val),
    z.coerce.number().nonnegative().default(0)
  ),
  deductible: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? 0 : val),
    z.coerce.number().nonnegative().default(0)
  ),
  road_tax_amount_thb: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? 0 : val),
    z.coerce.number().nonnegative().default(0)
  ),
  road_tax_due_date: z.string().optional().nullable(),
  inspection_mileage: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? null : val),
    z.coerce.number().int().nonnegative().optional().nullable()
  )
});

export async function saveVehicleComplianceAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен. Данные документов не сохранены.");
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return actionError("Недостаточно прав для изменения документов автомобиля.");

  const parsed = vehicleComplianceSchema.safeParse({
    vehicle_id: formData.get("vehicle_id"),
    insurance_type: formData.get("insurance_type") || "1st_class",
    insurance_provider: formData.get("insurance_provider"),
    insurance_phone: formData.get("insurance_phone"),
    policy_number: formData.get("policy_number"),
    insurance_start_date: formData.get("insurance_start_date"),
    insurance_end_date: formData.get("insurance_end_date"),
    premium_amount: formData.get("premium_amount"),
    deductible: formData.get("deductible"),
    road_tax_amount_thb: formData.get("road_tax_amount_thb"),
    road_tax_due_date: formData.get("road_tax_due_date"),
    inspection_mileage: formData.get("inspection_mileage")
  });
  if (!parsed.success) return actionError("Проверьте поля страховки, налога и километража.");
  const input = parsed.data;

  let insuranceId: string | null = null;
  const hasInsuranceData = Boolean(
    input.insurance_provider ||
    input.policy_number ||
    input.insurance_start_date ||
    input.insurance_end_date ||
    (input.premium_amount && input.premium_amount > 0) ||
    (input.deductible && input.deductible > 0)
  );

  if (hasInsuranceData) {
    if (!input.insurance_start_date || !input.insurance_end_date) {
      return actionError("Для сохранения страховки необходимо указать дату начала и окончания.");
    }

    const provider = input.insurance_phone 
      ? `${input.insurance_provider || ""} | ${input.insurance_phone}` 
      : (input.insurance_provider || "");
    const policy_number = input.policy_number || "";

    const { data: insurance, error: insuranceError } = await supabase
      .from("insurance")
      .upsert(
        {
          tenant_id: user.tenantId,
          vehicle_id: input.vehicle_id,
          type: input.insurance_type,
          provider,
          policy_number,
          start_date: input.insurance_start_date,
          end_date: input.insurance_end_date,
          premium_amount: input.premium_amount,
          deductible: input.deductible
        },
        { onConflict: "tenant_id,vehicle_id,policy_number" }
      )
      .select("id")
      .maybeSingle();

    if (insuranceError) {
      console.error("Insurance upsert error:", insuranceError.message);
      return actionError(`Страховка не сохранена: ${insuranceError.message}`);
    } else {
      insuranceId = insurance?.id ?? null;
    }
  }

  const { data: currentVehicle, error: currentVehicleError } = await supabase
    .from("vehicles")
    .select("depreciation_schedule")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id)
    .maybeSingle();

  if (currentVehicleError) {
    console.error(currentVehicleError.message);
    return actionError(`Карточка автомобиля не прочитана: ${currentVehicleError.message}`);
  }

  const currentSchedule =
    currentVehicle?.depreciation_schedule &&
    typeof currentVehicle.depreciation_schedule === "object" &&
    !Array.isArray(currentVehicle.depreciation_schedule)
      ? currentVehicle.depreciation_schedule
      : {};

  const vehicleUpdate: Record<string, unknown> = {
    road_tax_amount_thb: input.road_tax_amount_thb,
    road_tax_due_date: input.road_tax_due_date || null,
    road_tax_paid_until: input.road_tax_due_date || null,
    depreciation_schedule: {
      ...currentSchedule,
      inspection_mileage: input.inspection_mileage ?? null
    },
    inspection_expires_at: null
  };
  if (insuranceId) vehicleUpdate.insurance_id = insuranceId;

  const { error } = await supabase
    .from("vehicles")
    .update(vehicleUpdate)
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id);
  if (error) {
    console.error(error.message);
    return actionError(`Карточка автомобиля не обновлена: ${error.message}`);
  }

  if (input.road_tax_due_date) {
    // Calculate period_from as 1 year before period_to to prevent database check constraint violations (period_to >= period_from)
    const dueDate = new Date(input.road_tax_due_date);
    const periodFromDate = new Date(dueDate);
    periodFromDate.setFullYear(dueDate.getFullYear() - 1);
    const periodFromStr = periodFromDate.toISOString().slice(0, 10);

    const { error: taxError } = await supabase.from("road_tax_payments").insert({
      tenant_id: user.tenantId,
      vehicle_id: input.vehicle_id,
      amount_thb: input.road_tax_amount_thb,
      paid_at: new Date().toISOString().slice(0, 10),
      period_from: periodFromStr,
      period_to: input.road_tax_due_date,
      paid_to: "DLT / Por Ror Bor"
    });
    if (taxError) return actionError(`Данные машины сохранены, но запись налога не создана: ${taxError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePath("/insurance");
  revalidatePath("/tax");
  return actionOk("Страховка, налог и техосмотр сохранены.");
}

function storagePathFromPublicUrl(url: string) {
  const marker = "/storage/v1/object/public/vehicle-photos/";
  const index = url.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}

export async function deleteVehiclePhotoAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) return;
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return;

  const input = vehiclePhotoDeleteSchema.parse({
    vehicle_id: formData.get("vehicle_id"),
    photo_url: formData.get("photo_url")
  });
  const { data: vehicle, error: readError } = await supabase
    .from("vehicles")
    .select("photos")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id)
    .maybeSingle();
  if (readError || !vehicle) {
    console.error(readError?.message ?? "Vehicle not found.");
    return;
  }
  const photos = Array.isArray(vehicle.photos) ? vehicle.photos : [];
  const { error } = await supabase
    .from("vehicles")
    .update({ photos: photos.filter((url) => url !== input.photo_url) })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id);
  if (error) {
    console.error(error.message);
    return;
  }

  const storagePath = storagePathFromPublicUrl(input.photo_url);
  if (storagePath) {
    await supabase.storage.from("vehicle-photos").remove([storagePath]);
  }
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePublicVehicleApis();
}

const vehiclePhotosOrderSchema = z.object({
  vehicle_id: z.string().uuid(),
  photos: z.array(z.string())
});

export async function updateVehiclePhotosOrderAction(vehicleId: string, photos: string[]): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не подключен");
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return actionError("Нет доступа");

  const input = vehiclePhotosOrderSchema.parse({
    vehicle_id: vehicleId,
    photos: photos
  });

  const { error } = await supabase
    .from("vehicles")
    .update({ photos: input.photos })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.vehicle_id);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePublicVehicleApis();
  return actionOk("Порядок фотографий успешно сохранен.");
}

const vehicleDeleteSchema = z.object({
  vehicle_id: z.string().uuid()
});

export async function deleteVehicleAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) return;
  const user = await requireRole(["owner", "manager"]);
  if (!user) return;

  const input = vehicleDeleteSchema.parse({ vehicle_id: formData.get("vehicle_id") });
  const { error } = await supabase.from("vehicles").delete().eq("tenant_id", user.tenantId).eq("id", input.vehicle_id);
  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePublicVehicleApis();
  redirect("/fleet");
}

const leadStageSchema = z.object({
  lead_id: z.string().uuid(),
  status: z.enum(["new", "contacted", "qualified", "quoted", "negotiating", "booked", "lost", "not_lead"]),
  next_action: z.string().optional(),
  reminder_at: z.string().optional()
});

export async function updateLeadStageAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав для изменения лида.");

  const parsed = leadStageSchema.safeParse({
    lead_id: formData.get("lead_id"),
    status: formData.get("status"),
    next_action: formData.get("next_action"),
    reminder_at: formData.get("reminder_at")
  });
  if (!parsed.success) return actionError("Проверьте статус лида и дату напоминания.");
  const input = parsed.data;
  const { data: currentLead } = await supabase
    .from("leads")
    .select("notes,status,customer_id,converted_to_booking_id")
    .eq("id", input.lead_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (!currentLead) {
    return actionError("Лид не найден в текущей компании.");
  }

  const { data: linkedBooking, error: linkedBookingError } = await supabase
    .from("bookings")
    .select("id, booking_number")
    .eq("tenant_id", user.tenantId)
    .eq("lead_id", input.lead_id)
    .not("status", "in", "(draft,cancelled,no_show)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (linkedBookingError) {
    return actionError(linkedBookingError.message);
  }

  if (input.status === "booked" && !linkedBooking?.id) {
    return actionError("Нельзя вручную поставить лид в «Забронирован». Сначала создайте бронь из карточки лида, тогда CRM сама свяжет лид с бронью.");
  }

  if (["lost", "not_lead"].includes(input.status) && linkedBooking?.id) {
    return actionError(`По этому лиду уже есть бронь ${bookingNumberLabel(linkedBooking)}. Сначала отмените бронь или оставьте лид в статусе «Забронирован».`);
  }

  const existingNotes = Array.isArray(currentLead?.notes) ? currentLead.notes : [];
  const previousAction = [...existingNotes]
    .filter((note): note is Record<string, unknown> => Boolean(note) && typeof note === "object")
    .filter((note) => note.type === "next_action" || typeof note.text === "string")
    .sort((left, right) => String(right.at ?? "").localeCompare(String(left.at ?? "")))[0];
  const normalizedNextAction = input.next_action?.trim() ?? "";
  const normalizedReminderAt = input.reminder_at?.trim() ?? "";

  // Filter out any existing status flags
  let nextNotes = existingNotes.filter((n: any) => !(n && n.type === "status_flag"));

  if (input.status === "not_lead") {
    nextNotes.push({
      at: new Date().toISOString(),
      type: "status_flag",
      value: "not_lead"
    });
  }

  const dbStatus = input.status === "not_lead" ? "lost" : input.status;
  const hasCurrentNotLeadFlag = existingNotes
    .filter((note): note is Record<string, unknown> => Boolean(note) && typeof note === "object")
    .some((note) => note.type === "status_flag" && note.value === "not_lead");
  const currentLogicalStatus = hasCurrentNotLeadFlag ? "not_lead" : currentLead?.status;
  const statusChanged = input.status !== currentLogicalStatus;
  const reminderChanged = normalizedReminderAt !== String(previousAction?.reminder_at ?? "");
  const actionChanged = normalizedNextAction !== String(previousAction?.text ?? "");

  if (normalizedNextAction || normalizedReminderAt || statusChanged || actionChanged || reminderChanged) {
    nextNotes.push({
      at: new Date().toISOString(),
      type: "next_action",
      text: normalizedNextAction || String(previousAction?.text ?? ""),
      reminder_at: normalizedReminderAt || null,
      status: input.status
    });
  }

  const leadUpdatePayload: Record<string, unknown> = {
    status: dbStatus,
    status_changed_at: new Date().toISOString(),
    notes: nextNotes
  };
  if (input.status === "booked" && linkedBooking?.id) {
    leadUpdatePayload.converted_to_booking_id = linkedBooking.id;
  }
  if (["lost", "not_lead"].includes(input.status)) {
    leadUpdatePayload.converted_to_booking_id = null;
  }

  const { error } = await supabase
    .from("leads")
    .update(leadUpdatePayload)
    .eq("id", input.lead_id)
    .eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${input.lead_id}`);
  return actionOk("Движение лида сохранено.");
}

const bookingSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional().or(z.literal("")),
  booking_number: z.string().min(1),
  customer_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  rental_type: z.string().default("short_term"),
  start_date: z.string(),
  end_date: z.string(),
  pickup_method: z.string().default("office"),
  pickup_location: z.string().optional().nullable(),
  return_location: z.string().optional().nullable(),
  daily_rate_applied: z.coerce.number().nonnegative(),
  total_rental_amount: z.coerce.number().nonnegative(),
  deposit_amount: z.coerce.number().nonnegative(),
  delivery_fee: z.coerce.number().nonnegative().default(0),
  extras_total: z.coerce.number().nonnegative().default(0),
  grand_total: z.coerce.number().nonnegative()
});

const splitBookingSchema = bookingSchema.extend({
  temporary_vehicle_id: z.string().uuid(),
  temporary_start_date: z.string(),
  temporary_end_date: z.string(),
  temporary_daily_rate_applied: z.coerce.number().nonnegative(),
  temporary_total_rental_amount: z.coerce.number().nonnegative(),
  temporary_price_included: z.coerce.boolean().default(false)
});

const bookingStatusSchema = z.object({
  booking_id: z.string().uuid(),
  status: z.enum(["draft", "confirmed", "paid_deposit", "handed_over", "active", "returning", "completed", "cancelled", "no_show"])
});

const bookingRentalStatusSchema = z.object({
  booking_id: z.string().uuid(),
  rental_status: z.enum(["not_started", "handed_over", "active", "returning", "returned"])
});

const rentalStatusFlow: Record<string, string[]> = {
  not_started: ["handed_over", "active"],
  handed_over: ["active", "returning", "returned"],
  active: ["returning", "returned"],
  in_use: ["returning", "returned"],
  returning: ["returned"],
  returned: []
};

function validateRentalStatusTransition(currentStatus: string | null | undefined, nextStatus: string, role: string) {
  const current = String(currentStatus || "not_started");
  if (current === nextStatus) return null;
  if (rentalStatusFlow[current]?.includes(nextStatus)) return null;
  if (role === "owner" && nextStatus === "not_started" && current === "not_started") return null;
  if (current === "returned") {
    return "Аренда уже возвращена. Чтобы снова выдать машину, создайте новую бронь или новую часть составной брони.";
  }
  return `Нельзя изменить статус аренды с «${current}» на «${nextStatus}». Правильный поток: ожидает выдачи → выдана/в аренде → возврат → возвращена.`;
}

const bookingDetailsUpdateSchema = z.object({
  booking_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  rental_type: z.enum(["short_term", "long_term"]),
  start_date: z.string().min(10),
  end_date: z.string().min(10),
  pickup_location: z.string().optional(),
  return_location: z.string().optional(),
  pickup_method: z.enum(["office", "hotel_delivery", "airport_meet"]).default("office"),
  daily_rate_applied: z.coerce.number().nonnegative(),
  total_rental_amount: z.coerce.number().nonnegative(),
  deposit_amount: z.coerce.number().nonnegative(),
  delivery_fee: z.coerce.number().nonnegative(),
  extras_total: z.coerce.number().nonnegative(),
  discount_amount: z.coerce.number().nonnegative(),
  grand_total: z.coerce.number().nonnegative(),
  payment_status: z.enum(["unpaid", "partial", "fully_paid", "refunded"]).default("unpaid"),
  deposit_status: z.enum(["not_taken", "held", "partially_returned", "fully_returned", "forfeited"]).default("not_taken")
});

const cancelBookingSchema = z.object({
  booking_id: z.string().uuid(),
  cancellation_reason: z.string().max(500).optional()
});

const deleteBookingSchema = z.object({
  booking_id: z.string().uuid(),
  confirm_delete: z.string().trim().min(1)
});

export type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
  data?: any;
};

function actionOk(message: string, id?: string): ActionResult {
  return { ok: true, message, id };
}

function actionError(message: string): ActionResult {
  return { ok: false, message };
}

type OverlapBookingCandidate = {
  id: string;
  booking_number?: string | null;
  status?: string | null;
  rental_status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  actual_end?: string | null;
};

type MaintenanceBlockCandidate = {
  id: string;
  type?: string | null;
  status?: string | null;
  vehicle_unavailable_from?: string | null;
  vehicle_unavailable_to?: string | null;
};

function bookingNumberLabel(booking: { id?: string | null; booking_number?: string | null }) {
  const bookingNumber = String(booking.booking_number ?? "").trim();
  if (bookingNumber) return bookingNumber;
  const shortId = String(booking.id ?? "").slice(0, 8);
  return shortId ? `бронь ${shortId}` : "другая бронь";
}

function maintenanceBlockLabel(block: MaintenanceBlockCandidate) {
  const type = String(block.type ?? "ремонт/ТО");
  const start = String(block.vehicle_unavailable_from ?? "").slice(0, 10);
  const end = String(block.vehicle_unavailable_to ?? "").slice(0, 10);
  const range = start && end ? `${start} - ${end}` : start ? `с ${start}` : "";
  return range ? `${type} ${range}` : type;
}

function splitBookingBase(value: unknown) {
  return String(value ?? "").match(/^(.*)-([AB])$/i)?.[1] ?? null;
}

function splitBookingPart(value: unknown) {
  return String(value ?? "").match(/^(.*)-([AB])$/i)?.[2]?.toUpperCase() ?? null;
}

function normalizeManualVehicleStatus(status: unknown) {
  const value = String(status ?? "").trim();
  if (!value) return undefined;
  if (["reserved", "in_use", "handed_over", "returning"].includes(value)) {
    return "available";
  }
  return value;
}

function rentalStatusIsActive(status: unknown) {
  return ["handed_over", "active", "in_use", "returning"].includes(String(status ?? ""));
}

function rentalStatusWasIssued(status: unknown) {
  return ["handed_over", "active", "in_use", "returning", "returned"].includes(String(status ?? ""));
}

function isBookingNumberSchemaCacheError(error: { message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("bookings") && message.includes("booking_number");
}

async function syncVehicleStatusForBooking(supabase: ReturnType<typeof createServiceSupabaseClient>, tenantId: string, vehicleId: string) {
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicle && ["maintenance", "repair", "retired"].includes(vehicle.status)) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error: rpcError } = await supabase.rpc("sync_vehicle_status_from_bookings", {
    p_tenant_id: tenantId,
    p_vehicle_id: vehicleId
  });

  if (rpcError) {
    console.warn("Database vehicle status sync failed, using application fallback.", rpcError.message);
  }

  const { data: statusBookings } = await supabase
    .from("bookings")
    .select("id, status, rental_status, start_date, end_date, actual_end")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .limit(1000);

  const bookingEffectiveEnd = (booking: { end_date: string; actual_end?: string | null }) =>
    String(booking.actual_end ?? booking.end_date).slice(0, 10);
  const bookingEffectiveStart = (booking: { start_date: string }) => String(booking.start_date).slice(0, 10);

  const activeRentalStatuses = ["handed_over", "active", "in_use", "returning"];
  const reservedBookingStatuses = ["confirmed", "paid_deposit"];
  const hasActiveBooking = (statusBookings ?? []).some((booking) => {
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    
    if (activeRentalStatuses.includes(rentalStatus)) {
      return true;
    }
    
    return (
      activeRentalStatuses.includes(bookingStatus) &&
      bookingEffectiveStart(booking) <= today &&
      bookingEffectiveEnd(booking) >= today
    );
  });

  if (hasActiveBooking) {
    await supabase.from("vehicles").update({ status: "in_use" }).eq("tenant_id", tenantId).eq("id", vehicleId);
    return;
  }

  const hasReservedBooking = (statusBookings ?? []).some((booking) => {
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    return (
      !activeRentalStatuses.includes(rentalStatus) &&
      reservedBookingStatuses.includes(bookingStatus) &&
      bookingEffectiveStart(booking) <= today &&
      bookingEffectiveEnd(booking) >= today
    );
  });

  await supabase
    .from("vehicles")
    .update({ status: hasReservedBooking ? "reserved" : "available" })
    .eq("tenant_id", tenantId)
    .eq("id", vehicleId)
    .not("status", "in", "(maintenance,repair,retired)");
}

async function syncVehicleStatusAfterMaintenance(supabase: ReturnType<typeof createServiceSupabaseClient>, tenantId: string, vehicleId: string) {
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", vehicleId)
    .maybeSingle();

  if (!vehicle || vehicle.status === "retired") return;

  const today = new Date().toISOString().slice(0, 10);
  const { error: rpcError } = await supabase.rpc("sync_vehicle_status_from_bookings", {
    p_tenant_id: tenantId,
    p_vehicle_id: vehicleId
  });

  if (rpcError) {
    console.warn("Database vehicle status sync after maintenance failed, using application fallback.", rpcError.message);
  }

  const { data: statusBookings } = await supabase
    .from("bookings")
    .select("id, status, rental_status, start_date, end_date, actual_end")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .limit(1000);

  const bookingEffectiveEnd = (booking: { end_date: string; actual_end?: string | null }) =>
    String(booking.actual_end ?? booking.end_date).slice(0, 10);
  const bookingEffectiveStart = (booking: { start_date: string }) => String(booking.start_date).slice(0, 10);
  const activeRentalStatuses = ["handed_over", "active", "in_use", "returning"];
  const reservedBookingStatuses = ["confirmed", "paid_deposit"];
  const hasActiveBooking = (statusBookings ?? []).some((booking) =>
    (activeRentalStatuses.includes(String(booking.status ?? "")) || activeRentalStatuses.includes(String(booking.rental_status ?? ""))) &&
    bookingEffectiveStart(booking) <= today &&
    bookingEffectiveEnd(booking) >= today
  );
  const hasReservedBooking = (statusBookings ?? []).some((booking) =>
    !activeRentalStatuses.includes(String(booking.rental_status ?? "")) &&
    reservedBookingStatuses.includes(String(booking.status ?? "")) &&
    bookingEffectiveStart(booking) <= today &&
    bookingEffectiveEnd(booking) >= today
  );

  await supabase
    .from("vehicles")
    .update({ status: hasActiveBooking ? "in_use" : hasReservedBooking ? "reserved" : "available" })
    .eq("tenant_id", tenantId)
    .eq("id", vehicleId)
    .not("status", "eq", "retired");
}

function revalidateBookingSurfaces(input: {
  bookingId?: string;
  oldVehicleId?: string | null;
  newVehicleId?: string | null;
  customerId?: string | null;
  leadId?: string | null;
}) {
  revalidatePath("/");
  revalidatePath("/bookings");
  if (input.bookingId) revalidatePath(`/bookings/${input.bookingId}`);
  revalidatePath("/fleet");
  if (input.oldVehicleId) revalidatePath(`/fleet/${input.oldVehicleId}`);
  if (input.newVehicleId && input.newVehicleId !== input.oldVehicleId) revalidatePath(`/fleet/${input.newVehicleId}`);
  revalidatePath("/customers");
  if (input.customerId) revalidatePath(`/customers/${input.customerId}`);
  revalidatePath("/leads");
  if (input.leadId) revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/handover");
  revalidatePublicVehicleApis();
}

async function findOverlappingBooking(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicleId: string,
  startDate: string,
  endDate: string,
  excludeBookingId?: string
) {
  const startDateOnly = String(startDate).slice(0, 10);
  const endDateOnly = String(endDate).slice(0, 10);

  const query = supabase
    .from("bookings")
    .select("id, booking_number, status, rental_status, start_date, end_date, actual_end")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .lte("start_date", endDateOnly + "T23:59:59");

  if (excludeBookingId) {
    query.neq("id", excludeBookingId);
  }

  const { data, error } = await query;
  let bookings: OverlapBookingCandidate[] = (data ?? []) as OverlapBookingCandidate[];
  if (error) {
    if (!isBookingNumberSchemaCacheError(error)) {
      throw new Error(error.message);
    }

    const fallbackQuery = supabase
      .from("bookings")
      .select("id, status, rental_status, start_date, end_date, actual_end")
      .eq("tenant_id", tenantId)
      .eq("vehicle_id", vehicleId)
      .lte("start_date", endDateOnly + "T23:59:59");

    if (excludeBookingId) {
      fallbackQuery.neq("id", excludeBookingId);
    }

    const { data: fallbackData, error: fallbackError } = await fallbackQuery;
    if (fallbackError) {
      throw new Error(fallbackError.message);
    }
    bookings = (fallbackData ?? []) as OverlapBookingCandidate[];
  }

  const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
  const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
  return bookings.find((booking) => {
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    if (!blockingBookingStatuses.has(bookingStatus) && !blockingRentalStatuses.has(rentalStatus)) {
      return false;
    }
    const effectiveEnd = String(booking.actual_end ?? booking.end_date).slice(0, 10);
    return effectiveEnd >= startDateOnly;
  });
}

async function findOverlappingMaintenance(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicleId: string,
  startDate: string,
  endDate: string
) {
  const startDateOnly = String(startDate).slice(0, 10);
  const endDateOnly = String(endDate).slice(0, 10);

  const { data, error } = await supabase
    .from("maintenance_log")
    .select("id, type, status, vehicle_unavailable_from, vehicle_unavailable_to")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .in("status", ["scheduled", "in_progress"])
    .lte("vehicle_unavailable_from", endDateOnly)
    .or(`vehicle_unavailable_to.gte.${startDateOnly},vehicle_unavailable_to.is.null`);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as MaintenanceBlockCandidate[]).find((block) => {
    const blockStart = String(block.vehicle_unavailable_from ?? "").slice(0, 10);
    const blockEnd = String(block.vehicle_unavailable_to ?? "9999-12-31").slice(0, 10);
    return Boolean(blockStart) && blockStart <= endDateOnly && blockEnd >= startDateOnly;
  }) ?? null;
}

async function findLatestBlockingBookingForVehicle(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicleId: string,
  excludeBookingId?: string
) {
  const query = supabase
    .from("bookings")
    .select("id, booking_number, status, rental_status, start_date, end_date, actual_end")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId);

  if (excludeBookingId) {
    query.neq("id", excludeBookingId);
  }

  const { data, error } = await query;
  if (error) {
    if (!isBookingNumberSchemaCacheError(error)) {
      throw new Error(error.message);
    }
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
  const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);

  return ((data ?? []) as OverlapBookingCandidate[])
    .filter((booking) => {
      const bookingStatus = String(booking.status ?? "");
      const rentalStatus = String(booking.rental_status ?? "");
      const effectiveEnd = String(booking.actual_end ?? booking.end_date).slice(0, 10);
      return (
        (blockingBookingStatuses.has(bookingStatus) || blockingRentalStatuses.has(rentalStatus)) &&
        effectiveEnd >= today
      );
    })
    .sort((a, b) => {
      const aEnd = String(a.actual_end ?? a.end_date ?? "").slice(0, 10);
      const bEnd = String(b.actual_end ?? b.end_date ?? "").slice(0, 10);
      return bEnd.localeCompare(aEnd);
    })[0] ?? null;
}

async function validateLeadCanCreateBooking(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  leadId: string | null | undefined,
  customerId: string
) {
  if (!leadId) return null;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, customer_id, converted_to_booking_id")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (leadError) return leadError.message;
  if (!lead) return "Лид не найден в текущей компании.";
  if (lead.customer_id && lead.customer_id !== customerId) {
    return "Лид уже привязан к другому клиенту.";
  }
  if (lead.converted_to_booking_id) {
    return "Лид уже конвертирован в бронь. Откройте существующую бронь вместо создания дубля.";
  }

  const { data: existingBooking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, booking_number")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .not("status", "in", "(draft,cancelled,no_show)")
    .limit(1)
    .maybeSingle();

  if (bookingError) return bookingError.message;
  if (existingBooking) {
    return `По этому лиду уже есть бронь ${bookingNumberLabel(existingBooking)}.`;
  }

  return null;
}

async function findUsedBookingNumber(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  bookingNumbers: string[]
) {
  const candidates = bookingNumbers.map((value) => value.trim()).filter(Boolean);
  if (!candidates.length) return null;

  const { data, error } = await supabase
    .from("bookings")
    .select("booking_number")
    .eq("tenant_id", tenantId)
    .in("booking_number", candidates)
    .limit(1);

  if (error) return null;
  return data?.[0]?.booking_number ?? null;
}

async function syncLeadBookingConversionStatus(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  leadId: string | null | undefined
) {
  if (!leadId) return;

  const { data: activeBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .not("status", "in", "(draft,cancelled,no_show)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (activeBooking?.id) {
    await supabase
      .from("leads")
      .update({
        status: "booked",
        status_changed_at: new Date().toISOString(),
        converted_to_booking_id: activeBooking.id
      })
      .eq("tenant_id", tenantId)
      .eq("id", leadId);
    return;
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("status, converted_to_booking_id")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (!lead?.converted_to_booking_id && lead?.status !== "booked") return;

  const updatePayload: Record<string, string | null> = {
    status_changed_at: new Date().toISOString(),
    converted_to_booking_id: null
  };
  if (lead.status === "booked") {
    updatePayload.status = "negotiating";
  }

  await supabase.from("leads").update(updatePayload).eq("tenant_id", tenantId).eq("id", leadId);
}

async function findVehicleAvailabilityBlock(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  vehicleId: string,
  startDate: string,
  endDate: string,
  excludeBookingId?: string,
  vehicleStatus?: string | null
) {
  const overlap = await findOverlappingBooking(supabase, tenantId, vehicleId, startDate, endDate, excludeBookingId);
  if (overlap) return overlap;

  const maintenanceOverlap = await findOverlappingMaintenance(supabase, tenantId, vehicleId, startDate, endDate);
  if (maintenanceOverlap) {
    return {
      id: maintenanceOverlap.id,
      booking_number: maintenanceBlockLabel(maintenanceOverlap),
      status: maintenanceOverlap.status ?? "maintenance"
    } satisfies OverlapBookingCandidate;
  }

  let currentStatus = String(vehicleStatus ?? "");
  if (!currentStatus) {
    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("id", vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    currentStatus = String(vehicle?.status ?? "");
  }

  if (["maintenance", "repair", "retired"].includes(currentStatus)) {
    return {
      id: vehicleId,
      booking_number: `статус автомобиля: ${currentStatus}`,
      status: currentStatus
    } satisfies OverlapBookingCandidate;
  }

  if (["reserved", "handed_over", "in_use", "returning"].includes(currentStatus)) {
    const latest = await findLatestBlockingBookingForVehicle(supabase, tenantId, vehicleId, excludeBookingId);
    if (!latest) {
      return null;
    }
    const latestEnd = String(latest.actual_end ?? latest.end_date).slice(0, 10);
    const startDateOnly = String(startDate).slice(0, 10);
    if (latestEnd >= startDateOnly) {
      return latest;
    }
  }

  return null;
}

async function generateBookingNumber(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  requestedNumber: string
) {
  let bookingNumber = requestedNumber;
  if (!bookingNumber || bookingNumber.trim() === "" || bookingNumber.endsWith("-")) {
    const year = new Date().getFullYear();
    const prefix = bookingNumber && bookingNumber.endsWith("-") ? bookingNumber : `EPC-${year}-`;
    const { data: latestBookings, error } = await supabase
      .from("bookings")
      .select("booking_number")
      .eq("tenant_id", tenantId)
      .like("booking_number", `${prefix}%`);
    if (error) {
      const fallbackSuffix = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
      return `${prefix}${fallbackSuffix}`;
    }
    let maxNum = 0;
    if (latestBookings && latestBookings.length > 0) {
      for (const b of latestBookings) {
        const numStr = String(b.booking_number ?? "").replace(prefix, "").split("-")[0]?.trim() ?? "";
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const nextNum = maxNum + 1;
    const formattedNum = String(nextNum).padStart(4, "0");
    bookingNumber = `${prefix}${formattedNum}`;
  }

  return bookingNumber;
}

async function createSplitBookingAction(
  formData: FormData,
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  user: NonNullable<Awaited<ReturnType<typeof requireRole>>>
): Promise<ActionResult> {
  const startDateVal = formData.get("start_date");
  const startTimeVal = formData.get("start_time") || "12:00";
  const endDateVal = formData.get("end_date");
  const endTimeVal = formData.get("end_time") || "12:00";
  
  const tempStartDateVal = formData.get("temporary_start_date");
  const tempStartTimeVal = formData.get("temporary_start_time") || "12:00";
  const tempEndDateVal = formData.get("temporary_end_date");
  const tempEndTimeVal = formData.get("temporary_end_time") || "12:00";

  const parsed = splitBookingSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    lead_id: formData.get("lead_id") || "",
    booking_number: formData.get("booking_number"),
    customer_id: formData.get("customer_id"),
    vehicle_id: formData.get("vehicle_id"),
    rental_type: formData.get("rental_type") || "short_term",
    start_date: startDateVal && startTimeVal ? `${startDateVal}T${startTimeVal}` : startDateVal,
    end_date: endDateVal && endTimeVal ? `${endDateVal}T${endTimeVal}` : endDateVal,
    pickup_method: formData.get("pickup_method") || "office",
    daily_rate_applied: formData.get("daily_rate_applied"),
    total_rental_amount: formData.get("total_rental_amount"),
    deposit_amount: formData.get("deposit_amount"),
    delivery_fee: formData.get("delivery_fee") || 0,
    extras_total: formData.get("extras_total") || 0,
    grand_total: formData.get("grand_total"),
    temporary_vehicle_id: formData.get("temporary_vehicle_id"),
    temporary_start_date: tempStartDateVal && tempStartTimeVal ? `${tempStartDateVal}T${tempStartTimeVal}` : tempStartDateVal,
    temporary_end_date: tempEndDateVal && tempEndTimeVal ? `${tempEndDateVal}T${tempEndTimeVal}` : tempEndDateVal,
    temporary_daily_rate_applied: formData.get("temporary_daily_rate_applied"),
    temporary_total_rental_amount: formData.get("temporary_total_rental_amount"),
    temporary_price_included: formData.get("temporary_price_included") === "on"
  });

  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные составной брони.");
  }

  const input = parsed.data;
  if (input.temporary_vehicle_id === input.vehicle_id) {
    return actionError("Для составной брони выберите две разные машины.");
  }
  if (input.temporary_end_date < input.temporary_start_date || input.end_date < input.start_date) {
    return actionError("Дата возврата не может быть раньше даты выдачи.");
  }
  if (input.start_date < input.temporary_end_date) {
    return actionError("В составной броне желаемая машина должна начинаться после окончания временной машины.");
  }

  const [{ data: customer }, { data: temporaryVehicle }, { data: desiredVehicle }] = await Promise.all([
    supabase.from("customers").select("id").eq("tenant_id", user.tenantId).eq("id", input.customer_id).maybeSingle(),
    supabase.from("vehicles").select("id, status").eq("tenant_id", user.tenantId).eq("id", input.temporary_vehicle_id).maybeSingle(),
    supabase.from("vehicles").select("id, status").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle()
  ]);

  if (!customer || !temporaryVehicle || !desiredVehicle) {
    return actionError("Клиент или один из автомобилей не найден в текущей компании.");
  }

  const leadValidationError = await validateLeadCanCreateBooking(
    supabase,
    user.tenantId,
    input.lead_id || null,
    input.customer_id
  );
  if (leadValidationError) {
    return actionError(leadValidationError);
  }

  if (["maintenance", "repair", "retired"].includes(String(temporaryVehicle.status))) {
    return actionError("Временный автомобиль сейчас в ТО, ремонте или выведен из парка.");
  }
  if (["maintenance", "repair", "retired"].includes(String(desiredVehicle.status))) {
    return actionError("Желаемый автомобиль сейчас в ТО, ремонте или выведен из парка.");
  }

  const [temporaryComplianceError, desiredComplianceError] = await Promise.all([
    validateVehicleComplianceForBooking(
      supabase,
      user.tenantId,
      input.temporary_vehicle_id,
      input.temporary_start_date,
      input.temporary_end_date,
      user.role,
      "Временный автомобиль"
    ),
    validateVehicleComplianceForBooking(
      supabase,
      user.tenantId,
      input.vehicle_id,
      input.start_date,
      input.end_date,
      user.role,
      "Желаемый автомобиль"
    )
  ]);
  if (temporaryComplianceError) return actionError(temporaryComplianceError);
  if (desiredComplianceError) return actionError(desiredComplianceError);

  const [temporaryOverlap, desiredOverlap] = await Promise.all([
    findVehicleAvailabilityBlock(
      supabase,
      user.tenantId,
      input.temporary_vehicle_id,
      input.temporary_start_date,
      input.temporary_end_date,
      undefined,
      temporaryVehicle.status
    ),
    findVehicleAvailabilityBlock(
      supabase,
      user.tenantId,
      input.vehicle_id,
      input.start_date,
      input.end_date,
      undefined,
      desiredVehicle.status
    )
  ]);

  if (temporaryOverlap) {
    return actionError(`Временный автомобиль уже занят на эти даты: ${bookingNumberLabel(temporaryOverlap)}.`);
  }
  if (desiredOverlap) {
    return actionError(`Желаемый автомобиль уже занят на эти даты: ${bookingNumberLabel(desiredOverlap)}.`);
  }

  const baseBookingNumber = await generateBookingNumber(supabase, user.tenantId, input.booking_number);
  const usedSplitBookingNumber = await findUsedBookingNumber(supabase, user.tenantId, [
    baseBookingNumber,
    `${baseBookingNumber}-A`,
    `${baseBookingNumber}-B`
  ]);
  if (usedSplitBookingNumber) {
    return actionError(`Номер брони ${usedSplitBookingNumber} уже существует. Укажите другой номер.`);
  }

  const now = new Date().toISOString();
  const billableTemporaryAmount = input.temporary_price_included ? 0 : input.temporary_total_rental_amount;
  const common = {
    tenant_id: user.tenantId,
    customer_id: input.customer_id,
    lead_id: input.lead_id || null,
    pickup_method: input.pickup_method,
    status: "confirmed",
    rental_status: "not_started",
    payment_status: "unpaid",
    deposit_status: "not_taken",
    currency: "THB",
    discount_amount: 0,
    created_at: now,
    updated_at: now
  };

  const { data: bookings, error } = await supabase
    .from("bookings")
    .insert([
      {
        ...common,
        booking_number: `${baseBookingNumber}-A`,
        vehicle_id: input.temporary_vehicle_id,
        rental_type: "short_term",
        start_date: input.temporary_start_date,
        end_date: input.temporary_end_date,
        daily_rate_applied: input.temporary_daily_rate_applied,
        total_rental_amount: billableTemporaryAmount,
        deposit_amount: input.deposit_amount,
        delivery_fee: input.delivery_fee,
        extras_total: input.extras_total,
        grand_total: billableTemporaryAmount + input.deposit_amount + input.delivery_fee + input.extras_total
      },
      {
        ...common,
        booking_number: `${baseBookingNumber}-B`,
        vehicle_id: input.vehicle_id,
        rental_type: input.rental_type,
        start_date: input.start_date,
        end_date: input.end_date,
        daily_rate_applied: input.daily_rate_applied,
        total_rental_amount: input.total_rental_amount,
        deposit_amount: 0,
        delivery_fee: 0,
        extras_total: 0,
        grand_total: input.total_rental_amount
      }
    ])
    .select("id, vehicle_id");

  if (error) {
    return actionError(error.message);
  }

  const firstBookingId = bookings?.[0]?.id;
  if (input.lead_id && firstBookingId) {
    await supabase
      .from("leads")
      .update({
        status: "booked",
        status_changed_at: new Date().toISOString(),
        converted_to_booking_id: firstBookingId
      })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.lead_id);
  }

  await Promise.all([
    syncVehicleStatusForBooking(supabase, user.tenantId, input.temporary_vehicle_id),
    syncVehicleStatusForBooking(supabase, user.tenantId, input.vehicle_id)
  ]);
  await refreshCustomerBookingStats(supabase, user.tenantId, input.customer_id);

  revalidateBookingSurfaces({
    bookingId: firstBookingId,
    newVehicleId: input.temporary_vehicle_id,
    customerId: input.customer_id,
    leadId: input.lead_id || null
  });
  revalidateBookingSurfaces({
    bookingId: bookings?.[1]?.id,
    newVehicleId: input.vehicle_id,
    customerId: input.customer_id,
    leadId: input.lead_id || null
  });

  return actionOk(
    `Составная бронь ${baseBookingNumber} создана: временная машина ${input.temporary_start_date}–${input.temporary_end_date}, затем желаемая ${input.start_date}–${input.end_date}.`,
    firstBookingId
  );
}

export async function createBookingAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для создания брони.");

  if (formData.get("split_booking") === "on") {
    return createSplitBookingAction(formData, supabase, user);
  }

  const startDateVal = formData.get("start_date");
  const startTimeVal = formData.get("start_time") || "12:00";
  const endDateVal = formData.get("end_date");
  const endTimeVal = formData.get("end_time") || "12:00";

  const parsed = bookingSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    lead_id: formData.get("lead_id") || "",
    booking_number: formData.get("booking_number"),
    customer_id: formData.get("customer_id"),
    vehicle_id: formData.get("vehicle_id"),
    rental_type: formData.get("rental_type") || "short_term",
    start_date: startDateVal && startTimeVal ? `${startDateVal}T${startTimeVal}` : startDateVal,
    end_date: endDateVal && endTimeVal ? `${endDateVal}T${endTimeVal}` : endDateVal,
    pickup_method: formData.get("pickup_method") || "office",
    pickup_location: formData.get("pickup_location") || "",
    return_location: formData.get("return_location") || "",
    daily_rate_applied: formData.get("daily_rate_applied"),
    total_rental_amount: formData.get("total_rental_amount"),
    deposit_amount: formData.get("deposit_amount"),
    delivery_fee: formData.get("delivery_fee") || 0,
    extras_total: formData.get("extras_total") || 0,
    grand_total: formData.get("grand_total")
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные брони.");
  }
  const input = parsed.data;

  const bookingNumber = await generateBookingNumber(supabase, user.tenantId, input.booking_number);
  const usedBookingNumber = await findUsedBookingNumber(supabase, user.tenantId, [
    bookingNumber,
    `${bookingNumber}-A`,
    `${bookingNumber}-B`
  ]);
  if (usedBookingNumber) {
    return actionError(`Номер брони ${usedBookingNumber} уже существует. Укажите другой номер.`);
  }

  if (input.end_date < input.start_date) {
    return actionError("Дата возврата не может быть раньше даты выдачи.");
  }

  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    supabase.from("customers").select("id").eq("tenant_id", user.tenantId).eq("id", input.customer_id).maybeSingle(),
    supabase.from("vehicles").select("id, status").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle()
  ]);

  if (!customer || !vehicle) {
    return actionError("Клиент или автомобиль не найден в текущей компании.");
  }

  const leadValidationError = await validateLeadCanCreateBooking(
    supabase,
    user.tenantId,
    input.lead_id || null,
    input.customer_id
  );
  if (leadValidationError) {
    return actionError(leadValidationError);
  }

  if (["maintenance", "repair", "retired"].includes(vehicle.status)) {
    return actionError("Автомобиль сейчас в ТО, ремонте или выведен из парка. Сначала измените статус автомобиля.");
  }

  const complianceError = await validateVehicleComplianceForBooking(
    supabase,
    user.tenantId,
    input.vehicle_id,
    input.start_date,
    input.end_date,
    user.role
  );
  if (complianceError) {
    return actionError(complianceError);
  }

  try {
    const overlappingBooking = await findVehicleAvailabilityBlock(
      supabase,
      user.tenantId,
      input.vehicle_id,
      input.start_date,
      input.end_date,
      undefined,
      vehicle.status
    );
    if (overlappingBooking) {
      return actionError(`Автомобиль уже занят на эти даты: ${bookingNumberLabel(overlappingBooking)}.`);
    }
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Не удалось проверить доступность автомобиля.");
  }

  const { data: booking, error } = await supabase.from("bookings").insert({
    ...input,
    booking_number: bookingNumber,
    tenant_id: user.tenantId,
    lead_id: input.lead_id || null,
    status: "confirmed",
    currency: "THB",
    discount_amount: 0
  }).select("id").single();

  if (error) {
    return actionError(error.message);
  }

  if (input.lead_id && booking?.id) {
    await supabase
      .from("leads")
      .update({
        status: "booked",
        status_changed_at: new Date().toISOString(),
        converted_to_booking_id: booking.id
      })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.lead_id);
  }

  await syncVehicleStatusForBooking(supabase, user.tenantId, input.vehicle_id);
  await refreshCustomerBookingStats(supabase, user.tenantId, input.customer_id);

  if (booking?.id) {
    await sendCustomerNotification(booking.id, "booking_confirmed", user.tenantId);
  }

  revalidateBookingSurfaces({
    bookingId: booking?.id,
    newVehicleId: input.vehicle_id,
    customerId: input.customer_id,
    leadId: input.lead_id || null
  });
  return actionOk(`Бронь ${bookingNumber} создана и автомобиль отмечен как забронированный.`, booking?.id);
}

export async function updateBookingDetailsAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для редактирования брони.");

  const startDateVal = formData.get("start_date");
  const startTimeVal = formData.get("start_time") || "12:00";
  const endDateVal = formData.get("end_date");
  const endTimeVal = formData.get("end_time") || "12:00";

  const parsed = bookingDetailsUpdateSchema.safeParse({
    booking_id: formData.get("booking_id"),
    customer_id: formData.get("customer_id"),
    vehicle_id: formData.get("vehicle_id"),
    rental_type: formData.get("rental_type") || "short_term",
    start_date: startDateVal && startTimeVal ? `${startDateVal}T${startTimeVal}` : startDateVal,
    end_date: endDateVal && endTimeVal ? `${endDateVal}T${endTimeVal}` : endDateVal,
    pickup_location: formData.get("pickup_location") || "",
    return_location: formData.get("return_location") || "",
    pickup_method: formData.get("pickup_method") || "office",
    daily_rate_applied: formData.get("daily_rate_applied") || 0,
    total_rental_amount: formData.get("total_rental_amount") || 0,
    deposit_amount: formData.get("deposit_amount") || 0,
    delivery_fee: formData.get("delivery_fee") || 0,
    extras_total: formData.get("extras_total") || 0,
    discount_amount: formData.get("discount_amount") || 0,
    grand_total: formData.get("grand_total") || 0,
    payment_status: formData.get("payment_status") || "unpaid",
    deposit_status: formData.get("deposit_status") || "not_taken"
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные брони.");
  }
  const input = parsed.data;
  if (input.end_date < input.start_date) {
    return actionError("Дата возврата не может быть раньше даты выдачи.");
  }
  const calculatedGrandTotal = Math.max(
    0,
    input.total_rental_amount + input.deposit_amount + input.delivery_fee + input.extras_total - input.discount_amount
  );

  const { data: currentBooking, error: currentBookingError } = await supabase
    .from("bookings")
    .select("id, booking_number, lead_id, customer_id, vehicle_id, status, rental_status, start_date, end_date, actual_end, payment_status, deposit_status")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();
  if (currentBookingError || !currentBooking) {
    return actionError("Бронь не найдена в текущей компании.");
  }
  const canEditFinancialStatus = ["owner", "accountant"].includes(user.role);
  if (
    !canEditFinancialStatus &&
    (input.payment_status !== String(currentBooking.payment_status ?? "unpaid") ||
      input.deposit_status !== String(currentBooking.deposit_status ?? "not_taken"))
  ) {
    return actionError("Финансовые статусы брони может менять только owner/accountant. Для manager/operator они обновляются через запись платежей.");
  }

  const splitBase = splitBookingBase(currentBooking.booking_number);
  const splitPart = splitBookingPart(currentBooking.booking_number);
  if (splitBase && splitPart) {
    const siblingNumber = `${splitBase}-${splitPart === "A" ? "B" : "A"}`;
    const { data: siblingBooking, error: siblingBookingError } = await supabase
      .from("bookings")
      .select("id, booking_number, customer_id, lead_id, start_date, end_date")
      .eq("tenant_id", user.tenantId)
      .eq("booking_number", siblingNumber)
      .maybeSingle();

    if (siblingBookingError) {
      return actionError(siblingBookingError.message);
    }
    if (siblingBooking) {
      if (input.customer_id !== siblingBooking.customer_id) {
        return actionError("Нельзя изменить клиента только в одной части составной брони. Клиент должен совпадать в частях A и B.");
      }
      if (splitPart === "A" && input.end_date > siblingBooking.start_date) {
        return actionError(`Часть A должна закончиться до начала части B (${siblingBooking.booking_number}).`);
      }
      if (splitPart === "B" && input.start_date < siblingBooking.end_date) {
        return actionError(`Часть B должна начинаться после окончания части A (${siblingBooking.booking_number}).`);
      }
      if (splitPart === "B" && (input.deposit_amount > 0 || input.delivery_fee > 0 || input.extras_total > 0)) {
        return actionError("В составной брони депозит, доставка и extras должны быть в части A. Часть B хранит только стоимость аренды своей машины.");
      }
    }
  }

  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    supabase.from("customers").select("id").eq("tenant_id", user.tenantId).eq("id", input.customer_id).maybeSingle(),
    supabase.from("vehicles").select("id, status").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle()
  ]);
  if (!customer || !vehicle) {
    return actionError("Клиент или автомобиль не найден в текущей компании.");
  }
  if (["maintenance", "repair", "retired"].includes(String(vehicle.status ?? ""))) {
    return actionError("Автомобиль сейчас в ТО, ремонте или выведен из парка. Сначала измените статус автомобиля.");
  }

  const complianceError = await validateVehicleComplianceForBooking(
    supabase,
    user.tenantId,
    input.vehicle_id,
    input.start_date,
    input.end_date,
    user.role
  );
  if (complianceError) {
    return actionError(complianceError);
  }

  try {
    const overlappingBooking = await findVehicleAvailabilityBlock(
      supabase,
      user.tenantId,
      input.vehicle_id,
      input.start_date,
      input.end_date,
      input.booking_id,
      vehicle.status
    );
    if (overlappingBooking) {
      const currentEndDate = String(currentBooking.actual_end ?? currentBooking.end_date ?? "").slice(0, 10);
      const requestedEndDate = String(input.end_date ?? "").slice(0, 10);
      const isExtendingCurrentRental =
        rentalStatusIsActive(currentBooking.rental_status) &&
        currentBooking.vehicle_id === input.vehicle_id &&
        requestedEndDate > currentEndDate;
      if (isExtendingCurrentRental) {
        return actionError(
          `Продление аренды заблокировано: на эту машину уже есть следующая бронь ${bookingNumberLabel(overlappingBooking)}. ` +
          "Нужно заменить машину в следующей брони или выбрать другую дату возврата."
        );
      }
      return actionError(`Автомобиль уже занят на эти даты: ${bookingNumberLabel(overlappingBooking)}.`);
    }
  } catch (error) {
    return actionError(error instanceof Error ? error.message : "Не удалось проверить доступность автомобиля.");
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      customer_id: input.customer_id,
      vehicle_id: input.vehicle_id,
      rental_type: input.rental_type,
      start_date: input.start_date,
      end_date: input.end_date,
      pickup_location: input.pickup_location || null,
      return_location: input.return_location || null,
      pickup_method: input.pickup_method,
      daily_rate_applied: input.daily_rate_applied,
      total_rental_amount: input.total_rental_amount,
      deposit_amount: input.deposit_amount,
      delivery_fee: input.delivery_fee,
      extras_total: input.extras_total,
      discount_amount: input.discount_amount,
      grand_total: calculatedGrandTotal,
      payment_status: canEditFinancialStatus ? input.payment_status : currentBooking.payment_status,
      deposit_status: canEditFinancialStatus ? input.deposit_status : currentBooking.deposit_status
    })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (error) {
    return actionError(error.message);
  }

  if (currentBooking.vehicle_id && currentBooking.vehicle_id !== input.vehicle_id) {
    await syncVehicleStatusForBooking(supabase, user.tenantId, currentBooking.vehicle_id);
  }
  await syncVehicleStatusForBooking(supabase, user.tenantId, input.vehicle_id);
  await refreshCustomerBookingStats(supabase, user.tenantId, currentBooking.customer_id);
  if (currentBooking.customer_id !== input.customer_id) {
    await refreshCustomerBookingStats(supabase, user.tenantId, input.customer_id);
  }

  await sendCustomerNotification(input.booking_id, "booking_updated", user.tenantId);

  revalidateBookingSurfaces({
    bookingId: input.booking_id,
    oldVehicleId: currentBooking.vehicle_id,
    newVehicleId: input.vehicle_id,
    customerId: input.customer_id,
    leadId: currentBooking.lead_id
  });
  if (currentBooking.customer_id !== input.customer_id) {
    revalidatePath(`/customers/${currentBooking.customer_id}`);
  }
  return actionOk("Бронь обновлена, статус автомобиля и календарь пересчитаны.");
}

export async function cancelBookingAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для отмены брони.");

  const parsed = cancelBookingSchema.safeParse({
    booking_id: formData.get("booking_id"),
    cancellation_reason: formData.get("cancellation_reason") || ""
  });
  if (!parsed.success) return actionError("Некорректная бронь для отмены.");

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, customer_id, vehicle_id, lead_id, status, rental_status")
    .eq("tenant_id", user.tenantId)
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  if (bookingError || !booking) {
    return actionError("Бронь не найдена в текущей компании.");
  }
  if (rentalStatusWasIssued(booking.rental_status) || booking.status === "completed") {
    return actionError("Нельзя отменить бронь, по которой машина уже была выдана. Проведите возврат и завершение аренды, чтобы сохранить историю машины и денег.");
  }

  const payload: Record<string, string | null> = {
    status: "cancelled",
    rental_status: "not_started",
    cancellation_reason: parsed.data.cancellation_reason?.trim() || null
  };

  const { error } = await supabase
    .from("bookings")
    .update(payload)
    .eq("tenant_id", user.tenantId)
    .eq("id", parsed.data.booking_id);
  if (error) {
    return actionError(error.message);
  }

  await syncVehicleStatusForBooking(supabase, user.tenantId, booking.vehicle_id);
  await refreshCustomerBookingStats(supabase, user.tenantId, booking.customer_id);
  await syncLeadBookingConversionStatus(supabase, user.tenantId, booking.lead_id);
  revalidateBookingSurfaces({
    bookingId: parsed.data.booking_id,
    oldVehicleId: booking.vehicle_id,
    newVehicleId: booking.vehicle_id,
    customerId: booking.customer_id,
    leadId: booking.lead_id
  });
  return actionOk("Бронь отменена, автомобиль освобождён для доступных дат.");
}

export async function deleteBookingAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner", "manager"]);
  if (!user) return actionError("Удалять брони может только owner или manager. Оператор может отменить бронь.");

  const parsed = deleteBookingSchema.safeParse({
    booking_id: formData.get("booking_id"),
    confirm_delete: formData.get("confirm_delete")
  });
  if (!parsed.success || parsed.data.confirm_delete !== "DELETE") {
    return actionError("Для удаления введите DELETE в поле подтверждения.");
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, booking_number, customer_id, vehicle_id, lead_id, status, rental_status")
    .eq("tenant_id", user.tenantId)
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  if (bookingError || !booking) {
    return actionError("Бронь не найдена в текущей компании.");
  }
  if (rentalStatusWasIssued(booking.rental_status) || booking.status === "completed") {
    return actionError("Нельзя удалить бронь, по которой машина уже была выдана. Завершите аренду через возврат, чтобы сохранить историю автомобиля, клиента и финансов.");
  }

  const { count: paymentsCount, error: paymentsCountError } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("booking_id", booking.id);
  if (paymentsCountError) {
    return actionError(paymentsCountError.message);
  }
  if ((paymentsCount ?? 0) > 0) {
    return actionError("Нельзя удалить бронь с платежами. Отмените бронь, чтобы сохранить финансовую историю.");
  }

  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("tenant_id", user.tenantId)
    .eq("id", booking.id);
  if (error) {
    return actionError(error.message);
  }

  await syncVehicleStatusForBooking(supabase, user.tenantId, booking.vehicle_id);
  await refreshCustomerBookingStats(supabase, user.tenantId, booking.customer_id);
  await syncLeadBookingConversionStatus(supabase, user.tenantId, booking.lead_id);
  revalidateBookingSurfaces({
    bookingId: booking.id,
    oldVehicleId: booking.vehicle_id,
    newVehicleId: booking.vehicle_id,
    customerId: booking.customer_id,
    leadId: booking.lead_id
  });
  const redirectTo = formString(formData.get("redirect_to"));
  if (redirectTo.startsWith("/")) {
    redirect(redirectTo);
  }
  return actionOk("Бронь удалена, статус автомобиля и календарь пересчитаны.");
}

export async function updateBookingStatusAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для изменения брони.");

  const parsed = bookingStatusSchema.safeParse({
    booking_id: formData.get("booking_id"),
    status: formData.get("status")
  });
  if (!parsed.success) {
    return actionError("Проверьте статус брони: передано некорректное значение.");
  }
  const input = parsed.data;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, customer_id, vehicle_id, lead_id, status, rental_status, start_date, end_date, actual_end, actual_start, grand_total, deposit_amount, payment_status, deposit_status, return_photos, return_checklist")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();

  if (bookingError || !booking) {
    console.error(bookingError?.message ?? "Booking not found.");
    return actionError("Бронь не найдена в текущей компании.");
  }

  if (["handed_over", "active"].includes(input.status)) {
    if (!booking.vehicle_id) {
      return actionError("Выдача заблокирована: в брони не выбран автомобиль.");
    }
    if (!booking.customer_id) {
      return actionError("Выдача заблокирована: в брони не выбран клиент.");
    }
    try {
      const overlappingBooking = await findVehicleAvailabilityBlock(
        supabase,
        user.tenantId,
        booking.vehicle_id,
        booking.start_date,
        booking.actual_end ?? booking.end_date,
        booking.id
      );
      if (overlappingBooking) {
        return actionError(`Выдача заблокирована: автомобиль пересекается с бронью ${bookingNumberLabel(overlappingBooking)}.`);
      }
    } catch (error) {
      return actionError(error instanceof Error ? error.message : "Не удалось проверить доступность автомобиля перед выдачей.");
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("full_name_passport, passport_number, passport_expires, passport_photo_url, driver_license_photo_url, idp_number, idp_expires, idp_photo_url, has_valid_idp")
      .eq("tenant_id", user.tenantId)
      .eq("id", booking.customer_id)
      .maybeSingle();
    const hasValidPermit = Boolean(customer?.has_valid_idp) || hasValidDrivingPermit(customer?.idp_number, customer?.idp_expires);
    const missingDocuments: string[] = [];
    if (!customer?.full_name_passport?.trim()) missingDocuments.push("имя как в паспорте");
    if (!customer?.passport_number?.trim()) missingDocuments.push("номер паспорта");
    if (!normalizeDateInput(customer?.passport_expires)) missingDocuments.push("срок паспорта");
    if (!customer?.passport_photo_url) missingDocuments.push("фото паспорта");
    if (!customer?.driver_license_photo_url && !customer?.idp_photo_url) missingDocuments.push("фото прав / IDP");
    if (!hasValidPermit) missingDocuments.push("действующий IDP / тайские права");
    if (missingDocuments.length > 0 && user.role !== "owner") {
      return actionError(`Выдача заблокирована: заполните ${missingDocuments.join(", ")}.`);
    }
    if (Number(booking.grand_total ?? 0) <= 0) {
      return actionError("Выдача заблокирована: сумма аренды в брони не заполнена.");
    }
    if (String(booking.payment_status ?? "unpaid") === "unpaid" && user.role !== "owner") {
      return actionError("Выдача заблокирована: оплата не отмечена. Owner может принять финансовое решение вручную.");
    }
    if (Number(booking.deposit_amount ?? 0) > 0 && String(booking.deposit_status ?? "not_taken") === "not_taken" && user.role !== "owner") {
      return actionError("Выдача заблокирована: депозит не отмечен. Owner может принять финансовое решение вручную.");
    }
  }

  const currentRentalStatus = String(booking.rental_status ?? "not_started");
  const currentRentalWasIssued = rentalStatusWasIssued(currentRentalStatus);
  if (input.status === "completed" && !currentRentalWasIssued) {
    return actionError("Нельзя завершить бронь как аренду без фактической выдачи. Если клиент не приехал, используйте «Неявка» или «Отменена».");
  }
  if (input.status === "completed" && user.role !== "owner") {
    const isReturning = String(booking.status ?? "") === "returning" || String(booking.rental_status ?? "") === "returning";
    if (!isReturning) {
      return actionError("Сначала переведите аренду в «Возврат», загрузите фиксацию возврата, затем завершайте аренду.");
    }
    if (!hasMediaItems(booking.return_photos)) {
      return actionError("Завершение заблокировано: загрузите фото возврата автомобиля.");
    }
    if (!hasChecklistVideos(booking.return_checklist)) {
      return actionError("Завершение заблокировано: загрузите видео возврата автомобиля.");
    }
    if (Number(booking.deposit_amount ?? 0) > 0 && String(booking.deposit_status ?? "not_taken") === "held") {
      return actionError("Завершение заблокировано: депозит ещё в статусе held. Верните, удержите или отметьте решение по депозиту.");
    }
  }
  if (input.status === "no_show" && currentRentalWasIssued) {
    return actionError("Нельзя поставить «Неявка», когда автомобиль уже был выдан. Используйте возврат/завершение аренды.");
  }
  if (["cancelled", "draft"].includes(input.status) && currentRentalWasIssued) {
    return actionError("Нельзя отменить или вернуть в черновик бронь, по которой машина уже была выдана. Проведите возврат и завершение аренды.");
  }

  const updatePayload: Record<string, string> = {
    status: input.status
  };
  const nowIso = new Date().toISOString();
  if (["handed_over", "active"].includes(input.status)) {
    updatePayload.rental_status = input.status;
    if (!booking.actual_start) {
      updatePayload.actual_start = nowIso;
    }
  }
  if (input.status === "returning") {
    updatePayload.rental_status = "returning";
  }
  if (input.status === "completed") {
    updatePayload.rental_status = "returned";
    updatePayload.actual_end = nowIso;
  }
  if (["cancelled", "no_show", "draft"].includes(input.status)) {
    updatePayload.rental_status = "not_started";
  }

  const { error } = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  const oldStatus = booking.status;
  const newStatus = input.status;
  const isConfirmedEvent = ["confirmed", "paid_deposit"].includes(newStatus) && !["confirmed", "paid_deposit"].includes(oldStatus);

  if (isConfirmedEvent) {
    await sendCustomerNotification(booking.id, "booking_confirmed", user.tenantId);
  } else if (newStatus === "completed" && oldStatus !== "completed") {
    await sendCustomerNotification(booking.id, "rental_returned", user.tenantId);
  } else if (newStatus !== oldStatus) {
    await sendCustomerNotification(booking.id, "booking_updated", user.tenantId);
  }

  await syncVehicleStatusForBooking(supabase, user.tenantId, booking.vehicle_id);
  await refreshCustomerBookingStats(supabase, user.tenantId, booking.customer_id);
  await syncLeadBookingConversionStatus(supabase, user.tenantId, booking.lead_id);

  revalidateBookingSurfaces({
    bookingId: input.booking_id,
    oldVehicleId: booking.vehicle_id,
    newVehicleId: booking.vehicle_id,
    customerId: booking.customer_id,
    leadId: booking.lead_id
  });
  return actionOk("Статус бронирования успешно сохранен.");
}

export async function updateBookingRentalStatusAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase is not configured.");
  }
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для изменения статуса аренды.");

  const parsed = bookingRentalStatusSchema.safeParse({
    booking_id: formData.get("booking_id"),
    rental_status: formData.get("rental_status") || formData.get("status")
  });
  if (!parsed.success) {
    return actionError("Проверьте статус аренды: передано некорректное значение.");
  }
  const input = parsed.data;

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, customer_id, vehicle_id, lead_id, status, rental_status, start_date, end_date, actual_end, actual_start, deposit_amount, deposit_status, return_photos, return_checklist")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();

  if (bookingError || !booking) {
    return actionError("Бронь не найдена в текущей компании.");
  }
  if (input.rental_status === "not_started" && rentalStatusWasIssued(booking.rental_status)) {
    return actionError("Нельзя вернуть уже выданную аренду в «Ожидает выдачи». Используйте поток возврата: «Возврат» → «Возвращена».");
  }

  const transitionError = validateRentalStatusTransition(booking.rental_status, input.rental_status, user.role);
  if (transitionError) {
    return actionError(transitionError);
  }

  if (["cancelled", "no_show"].includes(String(booking.status ?? ""))) {
    return actionError("Нельзя менять аренду у отменённой брони или no-show. Создайте новую бронь, если клиент всё-таки приехал.");
  }

  if (input.rental_status === "returned" && user.role !== "owner") {
    const isReturning = String(booking.status ?? "") === "returning" || String(booking.rental_status ?? "") === "returning";
    if (!isReturning) {
      return actionError("Сначала переведите аренду в «Возврат», загрузите фиксацию возврата, затем ставьте «Возвращена».");
    }
    if (!hasMediaItems(booking.return_photos)) {
      return actionError("Возврат заблокирован: загрузите фото возврата автомобиля.");
    }
    if (!hasChecklistVideos(booking.return_checklist)) {
      return actionError("Возврат заблокирован: загрузите видео возврата автомобиля.");
    }
    if (Number(booking.deposit_amount ?? 0) > 0 && String(booking.deposit_status ?? "not_taken") === "held") {
      return actionError("Возврат заблокирован: депозит ещё в статусе held. Верните, удержите или отметьте решение по депозиту.");
    }
  }

  if (["handed_over", "active"].includes(input.rental_status)) {
    try {
      const overlappingBooking = await findVehicleAvailabilityBlock(
        supabase,
        user.tenantId,
        booking.vehicle_id,
        booking.start_date,
        booking.actual_end ?? booking.end_date,
        booking.id
      );
      if (overlappingBooking) {
        return actionError(`Выдача заблокирована: автомобиль пересекается с бронью ${bookingNumberLabel(overlappingBooking)}.`);
      }
    } catch (error) {
      return actionError(error instanceof Error ? error.message : "Не удалось проверить доступность автомобиля перед выдачей.");
    }
  }

  if (["handed_over", "active"].includes(input.rental_status)) {
    const { data: customer } = await supabase
      .from("customers")
      .select("has_valid_idp, idp_number, idp_expires")
      .eq("tenant_id", user.tenantId)
      .eq("id", booking.customer_id)
      .maybeSingle();
    const hasValidPermit = Boolean(customer?.has_valid_idp) || hasValidDrivingPermit(customer?.idp_number, customer?.idp_expires);
    if (hasValidPermit && customer?.has_valid_idp !== true) {
      await supabase
        .from("customers")
        .update({ has_valid_idp: true })
        .eq("tenant_id", user.tenantId)
        .eq("id", booking.customer_id);
    }
    if (!hasValidPermit && user.role !== "owner") {
      return actionError("Выдача заблокирована: у клиента нет действующего IDP / тайских прав.");
    }
  }

  const updatePayload: Record<string, string | boolean> = {
    rental_status: input.rental_status
  };
  const nowIso = new Date().toISOString();
  if (["handed_over", "active"].includes(input.rental_status) && !booking.actual_start) {
    updatePayload.actual_start = nowIso;
  }
  if (input.rental_status === "returned") {
    updatePayload.status = "completed";
    updatePayload.actual_end = nowIso;
  }
  if (["handed_over", "active"].includes(input.rental_status)) {
    const { data: customer } = await supabase
      .from("customers")
      .select("has_valid_idp, idp_number, idp_expires")
      .eq("tenant_id", user.tenantId)
      .eq("id", booking.customer_id)
      .maybeSingle();
    const hasValidPermit = Boolean(customer?.has_valid_idp) || hasValidDrivingPermit(customer?.idp_number, customer?.idp_expires);
    if (!hasValidPermit && user.role === "owner") {
      updatePayload.idp_owner_override = true;
      updatePayload.idp_override_note = `Owner override: ${user.fullName || "owner"} accepted IDP / Thai license risk at ${nowIso}`;
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (error) {
    console.error(error.message);
    let friendlyMessage = error.message;
    if (error.message.includes("without active insurance")) {
      friendlyMessage = "База данных всё ещё содержит старый стоп-триггер по страховке. По новой логике страховка/Por Ror Bor продлеваются по напоминаниям и не должны блокировать аренду. Нужно снять старый DB-триггер в Supabase.";
    }
    if (error.message.includes("Valid IDP is required")) {
      friendlyMessage = user.role === "owner"
        ? "База данных всё ещё блокирует owner override по IDP. Прогоните SQL docs/16_owner_idp_override_for_handover.sql в Supabase SQL Editor."
        : "Выдача заблокирована: у клиента нет действующего IDP / тайских прав.";
    }
    if (error.message.includes("idp_owner_override")) {
      friendlyMessage = "Owner override ещё не включён в базе. Прогоните SQL docs/16_owner_idp_override_for_handover.sql в Supabase SQL Editor.";
    }
    return actionError(friendlyMessage);
  }

  const oldRentalStatus = booking.rental_status;
  const newRentalStatus = input.rental_status;

  if (["handed_over", "active"].includes(newRentalStatus) && !["handed_over", "active"].includes(oldRentalStatus)) {
    await sendCustomerNotification(booking.id, "rental_active", user.tenantId);
  } else if (newRentalStatus === "returned" && oldRentalStatus !== "returned") {
    await sendCustomerNotification(booking.id, "rental_returned", user.tenantId);
  } else if (newRentalStatus !== oldRentalStatus) {
    await sendCustomerNotification(booking.id, "booking_updated", user.tenantId);
  }

  await syncVehicleStatusForBooking(supabase, user.tenantId, booking.vehicle_id);
  await refreshCustomerBookingStats(supabase, user.tenantId, booking.customer_id);

  revalidateBookingSurfaces({
    bookingId: input.booking_id,
    oldVehicleId: booking.vehicle_id,
    newVehicleId: booking.vehicle_id,
    customerId: booking.customer_id,
    leadId: booking.lead_id
  });
  return actionOk("Статус аренды сохранен, статус автомобиля пересчитан.");
}

const replaceVehicleSchema = z.object({
  booking_id: z.string().uuid(),
  new_vehicle_id: z.string().uuid()
});

export async function replaceBookingVehicleAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) throw new Error("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) throw new Error("Недостаточно прав для изменения брони.");

  const parsed = replaceVehicleSchema.safeParse({
    booking_id: formData.get("booking_id"),
    new_vehicle_id: formData.get("new_vehicle_id")
  });
  if (!parsed.success) {
    throw new Error("Некорректные идентификаторы брони или автомобиля.");
  }
  const input = parsed.data;

  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select("id, vehicle_id, booking_number, customer_id, lead_id, start_date, end_date, actual_end")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();

  if (bErr || !booking) {
    throw new Error("Бронь не найдена.");
  }

  const oldVehicleId = booking.vehicle_id;
  const newVehicleId = input.new_vehicle_id;

  if (oldVehicleId === newVehicleId) {
    throw new Error("Выбран тот же самый автомобиль.");
  }

  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("make, model, license_plate, status")
    .eq("tenant_id", user.tenantId)
    .eq("id", newVehicleId)
    .maybeSingle();

  if (vErr || !vehicle) {
    throw new Error("Новый автомобиль не найден.");
  }

  if (["maintenance", "repair", "retired"].includes(String(vehicle.status ?? ""))) {
    throw new Error("Новый автомобиль сейчас в ТО, ремонте или выведен из парка.");
  }

  const bookingEnd = String(booking.actual_end ?? booking.end_date);
  const overlappingBooking = await findVehicleAvailabilityBlock(
    supabase,
    user.tenantId,
    newVehicleId,
    booking.start_date,
    bookingEnd,
    booking.id,
    vehicle.status
  );

  if (overlappingBooking) {
    throw new Error(`Новый автомобиль уже занят на эти даты: ${bookingNumberLabel(overlappingBooking)}.`);
  }

  const { error: uErr } = await supabase
    .from("bookings")
    .update({
      vehicle_id: newVehicleId
    })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (uErr) {
    console.error("Update booking vehicle error:", uErr.message);
    throw new Error(uErr.message);
  }

  if (oldVehicleId) {
    await syncVehicleStatusForBooking(supabase, user.tenantId, oldVehicleId);
  }
  await syncVehicleStatusForBooking(supabase, user.tenantId, newVehicleId);

  try {
    await supabase.from("system_activities").insert({
      tenant_id: user.tenantId,
      event_type: "booking.vehicle_changed",
      entity_type: "booking",
      entity_id: booking.id,
      payload: {
        booking_number: booking.booking_number,
        old_vehicle_id: oldVehicleId,
        new_vehicle_id: newVehicleId,
        changed_by: user.authUserId
      }
    });
  } catch (e) {
    console.warn("Could not insert system activity:", e);
  }

  await sendCustomerNotification(input.booking_id, "booking_updated", user.tenantId);

  revalidateBookingSurfaces({
    bookingId: input.booking_id,
    oldVehicleId,
    newVehicleId,
    customerId: booking.customer_id,
    leadId: booking.lead_id
  });
}

const paymentSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  booking_id: z.string().uuid(),
  rental_amount: z.coerce.number().nonnegative(),
  deposit_amount: z.coerce.number().nonnegative(),
  pickup_fee: z.coerce.number().nonnegative(),
  delivery_fee: z.coerce.number().nonnegative(),
  extras_amount: z.coerce.number().nonnegative(),
  method: z.string().default("cash")
});

function formatPaymentDate(value: string | null | undefined, lang: "ru" | "en") {
  if (!value) return lang === "en" ? "not covered yet" : "пока не покрыта";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(lang === "en" ? "en-US" : "ru-RU");
}

async function sendBookingPaymentNotification(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  bookingId: string,
  paidNow: number
) {
  try {
    if (paidNow <= 0) return;

    const [{ data: booking }, { data: payments }] = await Promise.all([
      supabase
        .from("bookings")
        .select("*, customer:customers(*), vehicle:vehicles(*)")
        .eq("tenant_id", tenantId)
        .eq("id", bookingId)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("amount, type, status")
        .eq("tenant_id", tenantId)
        .eq("booking_id", bookingId)
        .eq("status", "completed")
    ]);

    if (!booking?.customer) return;

    const customer = booking.customer;
    const vehicle = booking.vehicle;
    const lang: "ru" | "en" = customer.language_pref === "en" ? "en" : "ru";
    const coverage = calculateRentalPaymentCoverage(booking, payments ?? []);
    const customerName = customer.full_name || customer.full_name_passport || (lang === "en" ? "there" : "клиент");
    const vehicleName = vehicle ? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() : lang === "en" ? "your car" : "ваш автомобиль";
    const paidThrough = coverage.isLongTerm && coverage.paidThroughDate
      ? formatPaymentDate(coverage.paidThroughDate, lang)
      : coverage.isFullyPaid
      ? (lang === "en" ? "the end of the rental" : "конца аренды")
      : formatPaymentDate(coverage.paidThroughDate, lang);
    const moneyText = (value: number) => `${Math.round(Number(value || 0)).toLocaleString("ru-RU")} THB`;
    const coverageLabel = coverage.isLongTerm
      ? (lang === "en" ? "monthly rental period" : "месячный период аренды")
      : (lang === "en" ? "full short-term rental" : "вся краткосрочная аренда");
    const fullTermLabel = coverage.isLongTerm
      ? `${coverage.termMonths} ${lang === "en" ? "month(s)" : "мес."} × ${moneyText(coverage.rentalDue)} = ${moneyText(coverage.fullRentalDue)}`
      : `${coverage.totalDays} ${lang === "en" ? "day(s)" : "дн."} × ${moneyText(coverage.dailyRate)} = ${moneyText(coverage.fullRentalDue)}`;
    const balanceLabel = lang === "en" ? "Remaining until rental end" : "Осталось оплатить до конца срока";

    const messageText = lang === "en"
      ? `Hi ${customerName}! We received your payment of ${moneyText(paidNow)} for booking #${booking.booking_number} (${vehicleName}).\n\nPayment basis: ${coverageLabel} (${moneyText(coverage.rentalDue)}).\nFull rental term: ${fullTermLabel}.\nRental is now paid until ${paidThrough}.\n${balanceLabel}: ${moneyText(coverage.remainingRental)}.\nDeposit paid: ${moneyText(coverage.depositPaid)}.\n\nThank you! We will keep everything updated in your booking.`
      : `Здравствуйте, ${customerName}! Мы получили оплату ${moneyText(paidNow)} по брони #${booking.booking_number} (${vehicleName}).\n\nБаза оплаты: ${coverageLabel} (${moneyText(coverage.rentalDue)}).\nВесь срок аренды: ${fullTermLabel}.\nАренда сейчас оплачена до ${paidThrough}.\n${balanceLabel}: ${moneyText(coverage.remainingRental)}.\nОплачено депозита: ${moneyText(coverage.depositPaid)}.\n\nСпасибо! Мы все зафиксировали в вашей брони.`;

    const messagingSecret = process.env.EPICENTER_MESSAGING_SECRET || "00d57c65010537e2d52f8979d0ef8c88204410a4dcf7b6b36187879c08a05034";
    const recordPaymentNotificationAttempt = async (
      channel: "whatsapp" | "telegram",
      recipient: string,
      status: "sent" | "failed",
      rawPayload: Record<string, unknown>
    ) => {
      const { error: insertError } = await supabase.from("conversation_messages").insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        channel,
        direction: "outbound",
        sender_type: "system",
        sender_name: "CRM payment automation",
        contact_handle: recipient,
        message_text: channel === "telegram" ? messageText.replace(/\*/g, "") : messageText,
        message_type: "text",
        status,
        raw_payload: {
          event: "booking_payment_recorded",
          booking_id: booking.id,
          booking_number: booking.booking_number,
          paid_now: paidNow,
          paid_through: coverage.paidThroughDate,
          remaining_rental: coverage.remainingRental,
          deposit_paid: coverage.depositPaid,
          ...rawPayload
        },
        occurred_at: new Date().toISOString()
      });
      if (insertError) {
        console.error(`Payment notification ${channel} history insert failed: ${insertError.message}`);
      }
    };

    const phoneNum = customer.whatsapp || customer.phone;
    if (phoneNum) {
      const gateway = process.env.WHATSAPP_SEND_URL || "https://n8nx.pro/webhook/whatsappOutboundWfCR/webhook/epicenter-messaging/whatsapp/send";
      try {
        const response = await fetch(gateway, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-epicenter-messaging-secret": messagingSecret
          },
          body: JSON.stringify({ phoneNumber: phoneNum, messageText })
        });
        const responseText = await response.text().catch(() => "");
        await recordPaymentNotificationAttempt("whatsapp", phoneNum, response.ok ? "sent" : "failed", {
          gateway,
          http_status: response.status,
          response_text: responseText.slice(0, 500)
        });
        if (!response.ok) {
          console.error(`Payment notification WhatsApp send failed: ${response.status} ${responseText}`);
        }
      } catch (err) {
        await recordPaymentNotificationAttempt("whatsapp", phoneNum, "failed", {
          gateway,
          error: err instanceof Error ? err.message : String(err)
        });
        console.error("Payment notification WhatsApp send failed:", err);
      }
    }

    if (customer.telegram_username) {
      const cleanedTg = String(customer.telegram_username).trim().replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "").replace(/^@/, "");
      if (cleanedTg) {
        const tgUsername = `@${cleanedTg}`;
        const gateway = process.env.TELEGRAM_SEND_URL || "https://n8nx.pro/epicenter-messaging/telegram/send";
        const telegramMessageText = messageText.replace(/\*/g, "");
        try {
          const response = await fetch(gateway, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-epicenter-messaging-secret": messagingSecret
            },
            body: JSON.stringify({ TelegramUsername: tgUsername, messageText: telegramMessageText })
          });
          const responseText = await response.text().catch(() => "");
          await recordPaymentNotificationAttempt("telegram", tgUsername, response.ok ? "sent" : "failed", {
            gateway,
            http_status: response.status,
            response_text: responseText.slice(0, 500)
          });
          if (!response.ok) {
            console.error(`Payment notification Telegram send failed: ${response.status} ${responseText}`);
          }
        } catch (err) {
          await recordPaymentNotificationAttempt("telegram", tgUsername, "failed", {
            gateway,
            error: err instanceof Error ? err.message : String(err)
          });
          console.error("Payment notification Telegram send failed:", err);
        }
      }
    }
  } catch (err) {
    console.error("sendBookingPaymentNotification crashed:", err);
  }
}

export async function recordBookingPaymentsAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner", "manager", "operator", "accountant"]);
  if (!user) return actionError("Недостаточно прав для записи платежей.");

  const parsed = paymentSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    booking_id: formData.get("booking_id"),
    rental_amount: formData.get("rental_amount"),
    deposit_amount: formData.get("deposit_amount"),
    pickup_fee: formData.get("pickup_fee"),
    delivery_fee: formData.get("delivery_fee"),
    extras_amount: formData.get("extras_amount"),
    method: formData.get("method") || "cash"
  });
  if (!parsed.success) return actionError("Проверьте суммы платежей и выбранную бронь.");
  const input = parsed.data;

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, booking_number, customer_id, vehicle_id, grand_total, deposit_amount")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();

  if (!booking) return actionError("Бронь не найдена или недоступна текущему пользователю.");
  if (
    splitBookingPart(booking.booking_number) === "B" &&
    (input.deposit_amount > 0 || input.pickup_fee > 0 || input.delivery_fee > 0 || input.extras_amount > 0)
  ) {
    return actionError("В части B составной брони можно записывать только оплату аренды этой машины. Депозит, доставка, забор и extras записывайте в часть A.");
  }

  const rows = [
    { type: "rental", amount: input.rental_amount },
    { type: "deposit", amount: input.deposit_amount },
    { type: "extras", amount: input.pickup_fee, notes: "pickup fee" },
    { type: "extras", amount: input.delivery_fee, notes: "delivery fee" },
    { type: "extras", amount: input.extras_amount, notes: "extras" }
  ]
    .filter((row) => row.amount > 0)
    .map((row) => ({
      tenant_id: user.tenantId,
      booking_id: input.booking_id,
      amount: row.amount,
      currency: "THB",
      type: row.type,
      method: input.method,
      status: "completed",
      paid_at: new Date().toISOString(),
      notes: row.notes
    }));

  if (rows.length > 0) {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    for (const row of rows) {
      const { data: duplicatePayment, error: duplicateError } = await supabase
        .from("payments")
        .select("id")
        .eq("tenant_id", user.tenantId)
        .eq("booking_id", input.booking_id)
        .eq("type", row.type)
        .eq("amount", row.amount)
        .eq("method", input.method)
        .eq("status", "completed")
        .gte("created_at", twoMinutesAgo)
        .limit(1)
        .maybeSingle();
      if (duplicateError) {
        return actionError(`Не удалось проверить повтор платежа: ${duplicateError.message}`);
      }
      if (duplicatePayment) {
        return actionOk("Похожий платеж уже записан недавно. Повторная запись остановлена.");
      }
    }

    const { error } = await supabase.from("payments").insert(rows);
    if (error) {
      console.error(error.message);
      return actionError(`Платежи не сохранены: ${error.message}`);
    }
  }

  const { data: completedPayments, error: paymentsError } = await supabase
    .from("payments")
    .select("amount, type, status")
    .eq("tenant_id", user.tenantId)
    .eq("booking_id", input.booking_id)
    .eq("status", "completed");

  if (paymentsError) {
    return actionError(`Платежи записаны, но не удалось пересчитать статус оплаты: ${paymentsError.message}`);
  }

  const financialStatus = calculateBookingFinancialStatus(booking, completedPayments ?? []);
  const { error: bookingError } = await supabase
    .from("bookings")
    .update({ payment_status: financialStatus.paymentStatus, deposit_status: financialStatus.depositStatus })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (bookingError) return actionError(`Платежи записаны, но статус брони не обновился: ${bookingError.message}`);

  await refreshCustomerBookingStats(supabase, user.tenantId, booking.customer_id);
  const paidNow = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  if (paidNow > 0) {
    await sendBookingPaymentNotification(supabase, user.tenantId, input.booking_id, paidNow);
  }

  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/handover");
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${input.booking_id}`);
  if (booking.vehicle_id) revalidatePath(`/fleet/${booking.vehicle_id}`);
  if (booking.customer_id) revalidatePath(`/customers/${booking.customer_id}`);
  return actionOk(rows.length > 0 ? "Платежи записаны и статус оплаты обновлен." : "Суммы равны 0, новых платежей не создано.");
}

const insuranceSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid(),
  type: z.string().default("1st_class"),
  provider: z.string().min(1),
  policy_number: z.string().min(1),
  start_date: z.string(),
  end_date: z.string(),
  premium_amount: z.coerce.number().nonnegative(),
  deductible: z.coerce.number().nonnegative().default(0)
});

export async function createInsuranceAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для добавления страховки.");

  const parsed = insuranceSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    vehicle_id: formData.get("vehicle_id"),
    type: formData.get("type") || "1st_class",
    provider: formData.get("provider"),
    policy_number: formData.get("policy_number"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    premium_amount: formData.get("premium_amount"),
    deductible: formData.get("deductible") || 0
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные страховки.");
  }
  const input = parsed.data;

  const { data: vehicle } = await supabase.from("vehicles").select("id").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle();
  if (!vehicle) {
    console.error("Vehicle was not found in the current tenant.");
    return actionError("Автомобиль не найден в текущей компании.");
  }

  const { error } = await supabase.from("insurance").insert({
    ...input,
    tenant_id: user.tenantId
  });
  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/insurance");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  return actionOk("Страховка добавлена.");
}

const roadTaxSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid(),
  amount_thb: z.coerce.number().nonnegative(),
  paid_at: z.string(),
  period_from: z.string(),
  period_to: z.string(),
  paid_to: z.string().optional()
});

export async function recordRoadTaxAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для записи налога.");

  const parsed = roadTaxSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    vehicle_id: formData.get("vehicle_id"),
    amount_thb: formData.get("amount_thb"),
    paid_at: formData.get("paid_at"),
    period_from: formData.get("period_from"),
    period_to: formData.get("period_to"),
    paid_to: formData.get("paid_to")
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте поля налога.");
  }
  const input = parsed.data;

  const { data: vehicle } = await supabase.from("vehicles").select("id").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle();
  if (!vehicle) {
    console.error("Vehicle was not found in the current tenant.");
    return actionError("Автомобиль не найден в текущей компании.");
  }

  const { error } = await supabase.from("road_tax_payments").insert({
    ...input,
    tenant_id: user.tenantId
  });
  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/tax");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  return actionOk("Оплата Por Ror Bor записана.");
}

const mediaSchema = z.object({
  bucket: z.enum(["handover-media", "return-media", "customer-documents", "contracts", "vehicle-photos"]),
  booking_id: z.string().uuid(),
  field: z.string().min(1)
});

const appUserSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(1),
  role: z.enum(["owner", "manager", "operator", "accountant", "marketer", "partner_view"]),
  phone: z.string().optional(),
  telegram_username: z.string().optional()
});

export async function createAppUserAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner"]);
  if (!user) return actionError("Только owner может создавать пользователей.");

  const parsed = appUserSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    phone: formData.get("phone"),
    telegram_username: formData.get("telegram_username")
  });
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные пользователя.");
  const input = parsed.data;

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name, role: input.role }
  });

  if (authError || !authData.user) {
    console.error(authError?.message ?? "Auth user was not created.");
    return actionError(authError?.message ?? "Пользователь в Auth не создан.");
  }

  const { error } = await supabase.from("app_users").insert({
    tenant_id: user.tenantId,
    auth_user_id: authData.user.id,
    full_name: input.full_name,
    role: input.role,
    phone: input.phone || null,
    telegram_username: input.telegram_username || null,
    active: true
  });

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }
  revalidatePath("/settings");
  return actionOk(`Пользователь ${input.full_name} создан. Email: ${input.email}`);
}

const appUserUpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  email: z.string().email("Некорректный формат email"),
  phone: z.string().optional(),
  telegram_username: z.string().optional(),
  role: z.enum(["owner", "manager", "operator", "accountant", "marketer", "partner_view"]),
  active: z.enum(["true", "false"])
});

export async function updateAppUserAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner"]);
  if (!user) return actionError("Только owner может изменять роли.");

  const parsed = appUserUpdateSchema.safeParse({
    id: formData.get("id"),
    full_name: formString(formData.get("full_name")),
    email: formString(formData.get("email")),
    phone: formString(formData.get("phone")),
    telegram_username: formString(formData.get("telegram_username")),
    role: formData.get("role"),
    active: formData.get("active")
  });
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные пользователя.");
  const input = parsed.data;

  // 1. Получаем auth_user_id из базы
  const { data: dbUser, error: dbUserError } = await supabase
    .from("app_users")
    .select("auth_user_id")
    .eq("id", input.id)
    .eq("tenant_id", user.tenantId)
    .single();

  if (dbUserError || !dbUser) {
    return actionError("Пользователь не найден.");
  }

  // 2. Обновляем email в Supabase Auth
  if (dbUser.auth_user_id) {
    const { error: authError } = await supabase.auth.admin.updateUserById(dbUser.auth_user_id, {
      email: input.email
    });
    if (authError) {
      console.error("Failed to update auth email:", authError.message);
      return actionError(`Не удалось обновить логин (Email): ${authError.message}`);
    }
  }

  // 3. Обновляем профиль в app_users
  const { error } = await supabase
    .from("app_users")
    .update({
      full_name: input.full_name,
      phone: input.phone || null,
      telegram_username: input.telegram_username || null,
      role: input.role,
      active: input.active === "true"
    })
    .eq("id", input.id)
    .eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }
  revalidatePath("/settings");
  return actionOk("Данные пользователя и логин успешно обновлены.");
}

const contractSchema = z.object({
  booking_id: z.string().uuid(),
  language: z.enum(["ru", "en"]).default("ru")
});

function asciiSafe(value: unknown) {
  return String(value ?? "-").replace(/[^\x20-\x7E]/g, "");
}

export async function generateContractPdfAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) return;
  const user = await requireRole(["owner", "manager", "operator", "accountant"]);
  if (!user) return;

  const input = contractSchema.parse({
    booking_id: formData.get("booking_id"),
    language: formData.get("language") || "ru"
  });

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", input.booking_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (bookingError || !booking) {
    console.error(bookingError?.message ?? "Booking not found.");
    return;
  }

  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", booking.customer_id).eq("tenant_id", user.tenantId).maybeSingle(),
    supabase.from("vehicles").select("*").eq("id", booking.vehicle_id).eq("tenant_id", user.tenantId).maybeSingle()
  ]);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const lines = [
    "EPICENTER CAR RENTAL SERVICE",
    `Rental Agreement / Dogovor arendy: ${booking.booking_number}`,
    "",
    `Customer: ${asciiSafe(customer?.full_name_passport || customer?.full_name)}`,
    `Phone: ${asciiSafe(customer?.phone)}`,
    `Passport: ${asciiSafe(customer?.passport_number)} / expires ${asciiSafe(customer?.passport_expires)}`,
    `IDP: ${asciiSafe(customer?.idp_number)} / expires ${asciiSafe(customer?.idp_expires)}`,
    "",
    `Vehicle: ${asciiSafe(vehicle?.make)} ${asciiSafe(vehicle?.model)} ${asciiSafe(vehicle?.year)}`,
    `License plate: ${asciiSafe(vehicle?.license_plate)}`,
    `Rental period: ${booking.start_date} - ${booking.end_date}`,
    `Rental type: ${booking.rental_type}`,
    "",
    `Rental amount: ${booking.total_rental_amount} THB`,
    `Deposit: ${booking.deposit_amount} THB`,
    `Delivery fee: ${booking.delivery_fee} THB`,
    `Extras: ${booking.extras_total} THB`,
    `Grand total: ${booking.grand_total} THB`,
    "",
    "Terms:",
    "1. Valid passport, driving license and IDP are required before handover.",
    "2. Deposit is held for at least 30 days after return for traffic fines.",
    "3. Customer is responsible for fines, damage and late return charges.",
    "4. Vehicle must be returned with agreed fuel level and condition.",
    "",
    "Customer signature: _______________________",
    "Epicenter representative: __________________"
  ];

  page.drawText(lines[0], { x: 48, y: 790, size: 18, font: bold, color: rgb(0.02, 0.42, 0.45) });
  let y = 756;
  for (const line of lines.slice(1)) {
    page.drawText(line, { x: 48, y, size: line ? 10 : 6, font });
    y -= line ? 18 : 10;
  }

  const bytes = await pdfDoc.save();
  const path = `${booking.id}/contract-${input.language}-${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("contracts").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true
  });

  if (uploadError) {
    console.error(uploadError.message);
    return;
  }

  const { data: publicUrl } = supabase.storage.from("contracts").getPublicUrl(path);
  const { error: updateError } = await supabase
    .from("bookings")
    .update({ contract_pdf_url: publicUrl.publicUrl })
    .eq("id", booking.id)
    .eq("tenant_id", user.tenantId);

  if (updateError) console.error(updateError.message);
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${booking.id}`);
  revalidatePath("/documents");
}

const maintenanceExpenseSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid(),
  type: z.enum(["scheduled_service", "repair", "accident", "inspection", "tire_change", "battery", "oil_change", "wash"]),
  status: z.enum(["scheduled", "in_progress", "completed"]).default("completed"),
  completed_date: z.string().optional(),
  vehicle_unavailable_from: z.string().optional(),
  vehicle_unavailable_to: z.string().optional(),
  mileage_at_service: z.coerce.number().int().nonnegative().optional(),
  cost: z.coerce.number().nonnegative(),
  paid_to: z.string().optional(),
  work_description: z.string().optional()
});

export async function recordMaintenanceExpenseAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для записи расхода.");

  const parsed = maintenanceExpenseSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    vehicle_id: formData.get("vehicle_id"),
    type: formData.get("type") || "scheduled_service",
    status: formData.get("status") || "completed",
    completed_date: formData.get("completed_date") || undefined,
    vehicle_unavailable_from: formData.get("vehicle_unavailable_from") || undefined,
    vehicle_unavailable_to: formData.get("vehicle_unavailable_to") || undefined,
    mileage_at_service: formData.get("mileage_at_service") || undefined,
    cost: formData.get("cost"),
    paid_to: formData.get("paid_to"),
    work_description: formData.get("work_description")
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте поля ТО/ремонта.");
  }
  const input = parsed.data;
  if (input.status === "completed" && !input.completed_date) {
    return actionError("Для завершенной работы укажите дату выполнения.");
  }
  if (input.status === "scheduled" && (!input.vehicle_unavailable_from || !input.vehicle_unavailable_to)) {
    return actionError("Для запланированного ТО/ремонта укажите даты недоступности автомобиля.");
  }
  if (input.status === "in_progress" && !input.vehicle_unavailable_from) {
    return actionError("Для ремонта в работе укажите дату начала недоступности автомобиля.");
  }
  if (input.vehicle_unavailable_from && input.vehicle_unavailable_to && input.vehicle_unavailable_to < input.vehicle_unavailable_from) {
    return actionError("Дата окончания недоступности не может быть раньше даты начала.");
  }

  const { data: vehicle } = await supabase.from("vehicles").select("id").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle();
  if (!vehicle) {
    console.error("Vehicle was not found in the current tenant.");
    return actionError("Автомобиль не найден в текущей компании.");
  }

  const unavailableFrom = input.vehicle_unavailable_from || (input.status === "in_progress" ? new Date().toISOString().slice(0, 10) : null);
  const unavailableTo = input.vehicle_unavailable_to || (input.status === "in_progress" ? null : unavailableFrom);
  if (input.status !== "completed" && unavailableFrom) {
    const unavailableCheckTo = unavailableTo || "9999-12-31";
    try {
      const overlappingBooking = await findOverlappingBooking(
        supabase,
        user.tenantId,
        input.vehicle_id,
        unavailableFrom,
        unavailableCheckTo
      );
      if (overlappingBooking) {
        return actionError(`Нельзя поставить ремонт/ТО на эти даты: автомобиль уже заблокирован бронью ${bookingNumberLabel(overlappingBooking)}.`);
      }
      const overlappingMaintenance = await findOverlappingMaintenance(
        supabase,
        user.tenantId,
        input.vehicle_id,
        unavailableFrom,
        unavailableCheckTo
      );
      if (overlappingMaintenance) {
        return actionError(`Нельзя поставить ремонт/ТО на эти даты: уже есть блок ${maintenanceBlockLabel(overlappingMaintenance)}.`);
      }
    } catch (error) {
      return actionError(error instanceof Error ? error.message : "Не удалось проверить брони перед записью ремонта/ТО.");
    }
  }

  const { error } = await supabase.from("maintenance_log").insert({
    tenant_id: user.tenantId,
    vehicle_id: input.vehicle_id,
    type: input.type,
    is_routine: input.type === "scheduled_service" || input.type === "oil_change" || input.type === "wash",
    completed_date: input.status === "completed" ? input.completed_date : null,
    vehicle_unavailable_from: unavailableFrom,
    vehicle_unavailable_to: input.vehicle_unavailable_to || null,
    mileage_at_service: input.mileage_at_service ?? null,
    cost: input.cost,
    cost_breakdown: { parts: 0, labor: input.cost, diagnostics: 0 },
    paid_to: input.paid_to || null,
    work_description: input.work_description || null,
    status: input.status
  });

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  const today = new Date().toISOString().slice(0, 10);
  const isUnavailableNow =
    input.status === "in_progress" ||
    (input.status === "scheduled" &&
      Boolean(unavailableFrom) &&
      unavailableFrom! <= today &&
      (!unavailableTo || unavailableTo >= today));

  if (isUnavailableNow) {
    const nextVehicleStatus = input.type === "repair" || input.type === "accident" ? "repair" : "maintenance";
    await supabase
      .from("vehicles")
      .update({ status: nextVehicleStatus })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.vehicle_id)
      .not("status", "eq", "retired");
  } else if (input.status === "completed") {
    await syncVehicleStatusAfterMaintenance(supabase, user.tenantId, input.vehicle_id);
  }

  revalidatePath("/");
  revalidatePath("/maintenance");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePath("/launch");
  return actionOk("Расход ТО/ремонта записан.");
}

const recommendationStatusSchema = z.object({
  recommendation_id: z.string().uuid(),
  status: z.enum(["acknowledged", "acted_on", "dismissed", "snoozed"]),
  acted_on_action: z.string().optional()
});

export async function updateRecommendationStatusAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return;
  }

  const user = await requireRole(["owner", "manager"]);
  if (!user) return;

  const input = recommendationStatusSchema.parse({
    recommendation_id: formData.get("recommendation_id"),
    status: formData.get("status"),
    acted_on_action: formData.get("acted_on_action")
  });

  const snoozedUntil = new Date();
  snoozedUntil.setDate(snoozedUntil.getDate() + 30);

  const { error } = await supabase
    .from("fleet_recommendations")
    .update({
      status: input.status,
      acted_on_action: input.acted_on_action || null,
      reviewed_at: new Date().toISOString(),
      snoozed_until: input.status === "snoozed" ? snoozedUntil.toISOString().slice(0, 10) : null
    })
    .eq("id", input.recommendation_id)
    .eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/");
  revalidatePath("/finance");
}

export async function recalculateAllCustomerMetricsAction(): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }

  const user = await requireRole(["owner", "accountant"]);
  if (!user) return actionError("Пересчет клиентских метрик доступен только owner/accountant.");

  const { data: customers, error } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .limit(10000);

  if (error) {
    return actionError(`Не удалось прочитать клиентов: ${error.message}`);
  }

  const failures: string[] = [];
  for (const customer of customers ?? []) {
    const result = await recalculateCustomerBookingStats(supabase, user.tenantId, customer.id);
    if (!result.ok) failures.push(`${customer.id}: ${result.error}`);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/analytics");
  revalidatePath("/finance");
  revalidatePath("/launch");

  if (failures.length > 0) {
    return actionError(`Метрики пересчитаны частично. Ошибок: ${failures.length}. Первая: ${failures[0]}`);
  }

  return actionOk(`Метрики клиентов пересчитаны: ${customers?.length ?? 0}.`);
}

const customerMetricsSchema = z.object({
  customer_id: z.string().uuid()
});

export async function recalculateCustomerMetricsAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }

  const user = await requireRole(["owner", "accountant", "manager"]);
  if (!user) return actionError("Недостаточно прав для пересчета метрик клиента.");

  const parsed = customerMetricsSchema.safeParse({
    customer_id: formData.get("customer_id")
  });
  if (!parsed.success) {
    return actionError("Некорректный идентификатор клиента.");
  }

  const { data: customer, error } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .eq("id", parsed.data.customer_id)
    .maybeSingle();
  if (error) return actionError(`Не удалось прочитать клиента: ${error.message}`);
  if (!customer) return actionError("Клиент не найден в текущей компании.");

  const result = await recalculateCustomerBookingStats(supabase, user.tenantId, customer.id);
  if (!result.ok) return actionError(`Метрики клиента не пересчитаны: ${result.error}`);

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customer.id}`);
  revalidatePath("/analytics");
  revalidatePath("/finance");

  return actionOk("Метрики клиента пересчитаны.");
}

export async function uploadBookingMediaAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для загрузки файлов.");

  const parsed = mediaSchema.safeParse({
    bucket: formData.get("bucket"),
    booking_id: formData.get("booking_id"),
    field: formData.get("field")
  });
  if (!parsed.success) return actionError("Некорректная бронь или тип файла.");
  const input = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    console.warn("No file selected.");
    return actionError("Выберите файл для загрузки.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${input.booking_id}/${input.field}/${Date.now()}-${safeName}`;
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_id, handover_photos, return_photos, handover_checklist, return_checklist")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();
  if (!booking) {
    console.error("Booking was not found in the current tenant.");
    return actionError("Бронь не найдена или недоступна текущему пользователю.");
  }

  const { error: uploadError } = await supabase.storage.from(input.bucket).upload(path, file, {
    contentType: file.type,
    upsert: false
  });

  if (uploadError) {
    console.error(uploadError.message);
    return actionError(`Файл не загружен: ${uploadError.message}`);
  }

  const { data: publicUrl } = supabase.storage.from(input.bucket).getPublicUrl(path);
  const fileUrl = publicUrl.publicUrl;

  if (input.field === "car_photos") {
    const photos = Array.isArray(booking.handover_photos) ? booking.handover_photos : [];
    const { error } = await supabase
      .from("bookings")
      .update({ handover_photos: [...photos, fileUrl] })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.booking_id);
    if (error) return actionError(`Файл загружен, но не привязан к брони: ${error.message}`);
  } else if (input.field === "return_photos") {
    const photos = Array.isArray(booking.return_photos) ? booking.return_photos : [];
    const { error } = await supabase
      .from("bookings")
      .update({ return_photos: [...photos, fileUrl] })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.booking_id);
    if (error) return actionError(`Файл загружен, но не привязан к возврату: ${error.message}`);
  } else if (input.field === "handover_video" || input.field === "return_video") {
    const checklistField = input.field === "handover_video" ? "handover_checklist" : "return_checklist";
    const checklist = (booking[checklistField] && typeof booking[checklistField] === "object" ? booking[checklistField] : {}) as Record<string, unknown>;
    const videos = Array.isArray(checklist.videos) ? checklist.videos : [];
    const { error } = await supabase
      .from("bookings")
      .update({ [checklistField]: { ...checklist, videos: [...videos, fileUrl] } })
      .eq("tenant_id", user.tenantId)
      .eq("id", input.booking_id);
    if (error) return actionError(`Видео загружено, но не привязано к чек-листу: ${error.message}`);
  } else if (input.field === "driver_license" || input.field === "passport") {
    const customerField = input.field === "driver_license" ? "driver_license_photo_url" : "passport_photo_url";
    const { error } = await supabase
      .from("customers")
      .update({ [customerField]: fileUrl })
      .eq("tenant_id", user.tenantId)
      .eq("id", booking.customer_id);
    if (error) return actionError(`Документ загружен, но не привязан к клиенту: ${error.message}`);
  }

  revalidatePath("/");
  revalidatePath("/handover");
  revalidatePath("/launch");
  revalidatePath("/documents");
  revalidatePath(`/bookings/${input.booking_id}`);
  if (booking.customer_id) revalidatePath(`/customers/${booking.customer_id}`);
  return actionOk("Файл загружен и привязан к брони.");
}

export async function uploadCustomerMediaAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для загрузки файлов.");

  const customerId = formData.get("customer_id");
  const field = formData.get("field");
  if (!customerId || !field || typeof customerId !== "string" || typeof field !== "string") {
    return actionError("Некорректный клиент или тип файла.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionError("Выберите файл для загрузки.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `customers/${customerId}/${field}/${Date.now()}-${safeName}`;
  const bucket = "customer-documents";

  const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, file, {
    contentType: file.type,
    upsert: false
  });

  if (uploadError) {
    console.error(uploadError.message);
    return actionError(`Файл не загружен: ${uploadError.message}`);
  }

  // Store "bucket:path" so display layer can generate signed URLs on demand
  const fileUrl = `${bucket}:${storagePath}`;

  const dbField =
    field === "passport"
      ? "passport_photo_url"
      : field === "driver_license"
      ? "driver_license_photo_url"
      : field === "idp"
      ? "idp_photo_url"
      : null;

  if (!dbField) {
    return actionError("Некорректный тип документа.");
  }

  // Fetch current documents to append
  const { data: customer, error: fetchError } = await supabase
    .from("customers")
    .select("passport_photo_url, driver_license_photo_url, idp_photo_url")
    .eq("tenant_id", user.tenantId)
    .eq("id", customerId)
    .single();

  if (fetchError || !customer) {
    return actionError("Клиент не найден.");
  }

  const currentVal = customer[dbField];
  let filesList: { url: string; name: string; type: string }[] = [];

  if (currentVal) {
    try {
      if (currentVal.startsWith("[") && currentVal.endsWith("]")) {
        filesList = JSON.parse(currentVal);
      } else {
        filesList = [{ url: currentVal, name: "Document", type: "image/jpeg" }];
      }
    } catch {
      filesList = [{ url: currentVal, name: "Document", type: "image/jpeg" }];
    }
  }

  // Append new file
  filesList.push({
    url: fileUrl,
    name: file.name,
    type: file.type
  });

  const { error } = await supabase
    .from("customers")
    .update({ [dbField]: JSON.stringify(filesList) })
    .eq("tenant_id", user.tenantId)
    .eq("id", customerId);

  if (error) {
    return actionError(`Документ загружен, но не привязан к клиенту: ${error.message}`);
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return actionOk("Файл успешно загружен и привязан к клиенту.");
}

export async function deleteCustomerMediaAction(
  customerId: string,
  field: "passport" | "driver_license" | "idp",
  fileUrl: string
): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав.");

  const dbField =
    field === "passport"
      ? "passport_photo_url"
      : field === "driver_license"
      ? "driver_license_photo_url"
      : field === "idp"
      ? "idp_photo_url"
      : null;

  if (!dbField) {
    return actionError("Некорректный тип документа.");
  }

  const { data: customer, error: fetchError } = await supabase
    .from("customers")
    .select("passport_photo_url, driver_license_photo_url, idp_photo_url")
    .eq("tenant_id", user.tenantId)
    .eq("id", customerId)
    .single();

  if (fetchError || !customer) {
    return actionError("Клиент не найден.");
  }

  const currentVal = customer[dbField];
  let filesList: { url: string; name: string; type: string }[] = [];

  if (currentVal) {
    try {
      if (currentVal.startsWith("[") && currentVal.endsWith("]")) {
        filesList = JSON.parse(currentVal);
      } else {
        filesList = [{ url: currentVal, name: "Document", type: "image/jpeg" }];
      }
    } catch {
      filesList = [{ url: currentVal, name: "Document", type: "image/jpeg" }];
    }
  }

  // Remove the specified file
  filesList = filesList.filter((f) => f.url !== fileUrl);

  const updatedVal = filesList.length > 0 ? JSON.stringify(filesList) : null;

  const { error } = await supabase
    .from("customers")
    .update({ [dbField]: updatedVal })
    .eq("tenant_id", user.tenantId)
    .eq("id", customerId);

  if (error) {
    return actionError(`Не удалось удалить файл: ${error.message}`);
  }

  // Try to delete from Supabase storage
  try {
    let bucket = "customer-documents";
    let path = fileUrl;
    if (fileUrl.includes(":")) {
      const idx = fileUrl.indexOf(":");
      bucket = fileUrl.slice(0, idx);
      path = fileUrl.slice(idx + 1);
    }
    await supabase.storage.from(bucket).remove([path]);
  } catch (err) {
    console.warn("Could not delete from storage bucket:", err);
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return actionOk("Файл успешно удален.");
}

export async function uploadMessageAttachmentAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }

  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для загрузки файлов.");

  const customerId = formData.get("customer_id") || formData.get("lead_id");
  if (!customerId || typeof customerId !== "string") {
    return actionError("Не указан идентификатор клиента или лида.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionError("Выберите файл для загрузки.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `conversation_messages/${customerId}/${Date.now()}-${safeName}`;
  const bucket = "contracts";

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false
  });

  if (uploadError) {
    console.error(uploadError.message);
    return actionError(`Файл не загружен: ${uploadError.message}`);
  }

  const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(path);
  const fileUrl = publicUrl.publicUrl;

  return {
    ok: true,
    message: "Файл успешно загружен.",
    data: {
      url: fileUrl,
      type: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "document"
    } as any
  };
}

const customerMessageSchema = z.object({
  customer_id: z.string().uuid(),
  channel: z.enum(["whatsapp", "telegram", "line", "instagram", "tiktok"]),
  message_text: z.string().max(4000).optional().default(""),
  message_type: z.enum(["text", "image", "video", "audio", "document"]).optional().default("text"),
  media_url: z.string().nullable().optional()
});

const leadMessageSchema = z.object({
  lead_id: z.string().uuid(),
  channel: z.enum(["whatsapp", "telegram", "line", "instagram", "tiktok"]),
  message_text: z.string().max(4000).optional().default(""),
  message_type: z.enum(["text", "image", "video", "audio", "document"]).optional().default("text"),
  media_url: z.string().nullable().optional()
});
function messagingEndpoint(channel: "whatsapp" | "telegram" | "line" | "instagram" | "tiktok") {
  if (channel === "whatsapp") {
    return "http://127.0.0.1:5011/send_whatsapp";
  }
  if (channel === "telegram") {
    return "http://127.0.0.1:5010/send_telegram";
  }
  if (channel === "line") {
    return process.env.LINE_SEND_URL || "https://n8nx.pro/epicenter-messaging/line/send";
  }
  if (channel === "instagram") {
    return process.env.INSTAGRAM_SEND_URL || "https://n8nx.pro/epicenter-messaging/instagram/send";
  }
  return process.env.TIKTOK_SEND_URL || "https://n8nx.pro/epicenter-messaging/tiktok/send";
}

function effectiveConversationChannel(message: { channel?: string | null; raw_payload?: any }) {
  const original = message.raw_payload && typeof message.raw_payload === "object" ? message.raw_payload.original_channel : null;
  return typeof original === "string" && original ? original : String(message.channel ?? "");
}

function sameMessagingChannel(storedChannel: string, requestedChannel: string) {
  if (storedChannel === requestedChannel) return true;
  if (requestedChannel === "telegram") {
    return ["telegram", "telegram_chat", "telegram_channel"].includes(storedChannel);
  }
  return false;
}

async function findLastConversationContact(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  scope: { customerId?: string | null; leadId?: string | null },
  channel: "whatsapp" | "telegram" | "line" | "instagram" | "tiktok"
) {
  let query = supabase
    .from("conversation_messages")
    .select("contact_handle, channel, raw_payload")
    .eq("tenant_id", tenantId)
    .not("contact_handle", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (scope.customerId) {
    query = query.eq("customer_id", scope.customerId);
  }
  if (scope.leadId) {
    query = query.eq("lead_id", scope.leadId);
  }

  const { data: messages } = await query;
  const matched = (messages ?? []).find((message) => sameMessagingChannel(effectiveConversationChannel(message), channel));
  return matched?.contact_handle ?? null;
}

async function hasRecentOutboundMessage(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  tenantId: string,
  scope: { customerId?: string | null; leadId?: string | null },
  input: {
    channel: "whatsapp" | "telegram" | "line" | "instagram" | "tiktok";
    recipient: string;
    messageText: string;
    messageType: string;
    mediaUrl?: string | null;
  }
) {
  const storedChannel = ["line", "tiktok"].includes(input.channel) ? "other" : input.channel;
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  let query = supabase
    .from("conversation_messages")
    .select("id, channel, message_text, message_type, media_url, raw_payload")
    .eq("tenant_id", tenantId)
    .eq("direction", "outbound")
    .eq("contact_handle", input.recipient)
    .eq("channel", storedChannel)
    .gte("occurred_at", twoMinutesAgo)
    .limit(20);

  if (scope.customerId) query = query.eq("customer_id", scope.customerId);
  if (scope.leadId) query = query.eq("lead_id", scope.leadId);

  const { data, error } = await query;
  if (error) {
    console.warn("Recent outbound duplicate check failed.", error.message);
    return false;
  }

  return (data ?? []).some((message) => {
    if (!sameMessagingChannel(effectiveConversationChannel(message), input.channel)) return false;
    if (String(message.message_text ?? "") !== input.messageText) return false;
    if (String(message.message_type ?? "text") !== input.messageType) return false;
    return String(message.media_url ?? "") === String(input.mediaUrl ?? "");
  });
}

export async function sendCustomerMessageAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }

  const currentUser = await getCurrentUserContext();
  if (currentUser.supabaseConfigured && !currentUser.isAuthenticated) {
    console.warn("Authentication required to send customer messages.");
    return actionError("Нужно войти в CRM, чтобы отправлять сообщения.");
  }
  if (currentUser.role === "partner_view" || currentUser.role === "accountant") {
    console.warn("Current role cannot send customer messages.");
    return actionError("У этой роли нет прав отправлять сообщения клиентам.");
  }

  const parsed = customerMessageSchema.safeParse({
    customer_id: formData.get("customer_id"),
    channel: formData.get("channel"),
    message_text: formData.get("message_text") || "",
    message_type: formData.get("message_type") || "text",
    media_url: formData.get("media_url") || null
  });
  if (!parsed.success) return actionError("Проверьте канал, текст сообщения и файлы.");
  const input = parsed.data;

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, tenant_id, full_name, phone, whatsapp, telegram_username, source, source_detail, language_pref")
    .eq("id", input.customer_id)
    .eq("tenant_id", currentUser.tenantId)
    .maybeSingle();

  if (customerError || !customer) {
    console.error(customerError?.message ?? "Customer not found.");
    return actionError(customerError?.message ?? "Клиент не найден.");
  }

  let recipient: string | null = null;
  if (input.channel === "whatsapp") {
    recipient = customer.whatsapp || customer.phone;
  } else if (input.channel === "telegram") {
    recipient = customer.telegram_username;
  } else if (input.channel === "line" && customer.source === "line") {
    recipient = customer.source_detail;
  } else if (input.channel === "instagram" && customer.source === "instagram") {
    recipient = customer.source_detail;
  } else if (input.channel === "tiktok" && customer.source === "tiktok") {
    recipient = customer.source_detail;
  }

  if (!recipient) {
    recipient = await findLastConversationContact(supabase, currentUser.tenantId, { customerId: customer.id }, input.channel);
  }

  if (!recipient) {
    console.error(`Customer has no ${input.channel} recipient.`);
    return actionError(`У клиента нет контакта для ${input.channel}.`);
  }
  const messageText = input.message_text || (input.message_type === "video" ? "[Видео]" : "[Фото]");
  const recentDuplicate = await hasRecentOutboundMessage(supabase, currentUser.tenantId, { customerId: customer.id }, {
    channel: input.channel,
    recipient,
    messageText,
    messageType: input.message_type,
    mediaUrl: input.media_url
  });
  if (recentDuplicate) {
    return actionOk("Такое сообщение уже отправлялось этому клиенту недавно. Повторная отправка остановлена.");
  }

  let payload: Record<string, unknown> = {};
  if (input.channel === "whatsapp") {
    payload = {
      phoneNumber: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "telegram") {
    payload = {
      TelegramUsername: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "line") {
    payload = {
      lineUserId: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "instagram") {
    payload = {
      instagramUsername: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "tiktok") {
    payload = {
      tiktokUsername: recipient,
      messageText: input.message_text
    };
  }

  if (input.media_url) {
    payload.mediaUrl = input.media_url;
    payload.messageType = input.message_type;
  }

  const messagingSecret = process.env.EPICENTER_MESSAGING_SECRET;
  if (!messagingSecret) {
    console.error("EPICENTER_MESSAGING_SECRET is not configured.");
    return actionError("Не настроен секрет шлюза сообщений EPICENTER_MESSAGING_SECRET.");
  }

  const response = await fetch(messagingEndpoint(input.channel), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-epicenter-messaging-secret": messagingSecret
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.error(`Message gateway failed: ${response.status} ${await response.text()}`);
    return actionError(`Шлюз сообщений вернул ошибку ${response.status}.`);
  }

  const { error: messageInsertError } = await supabase.from("conversation_messages").insert({
    tenant_id: customer.tenant_id,
    customer_id: customer.id,
    channel: ["line", "tiktok"].includes(input.channel) ? "other" : input.channel,
    direction: "outbound",
    sender_type: "operator",
    sender_name: currentUser.fullName,
    sender_user_id: currentUser.authUserId,
    contact_handle: recipient,
    message_text: messageText,
    message_type: input.message_type,
    media_url: input.media_url,
    status: "sent",
    raw_payload: {
      gateway: messagingEndpoint(input.channel),
      recipient,
      ...(["line", "tiktok"].includes(input.channel) ? { original_channel: input.channel } : {})
    },
    occurred_at: new Date().toISOString()
  });
  if (messageInsertError) {
    console.error(`Message sent but history insert failed: ${messageInsertError.message}`);
    return actionError("Сообщение отправлено, но история не сохранилась. Проверьте чат и не отправляйте повторно сразу.");
  }

  await supabase.from("notifications").insert({
    tenant_id: customer.tenant_id,
    notification_type: "customer_message_sent",
    customer_id: customer.id,
    related_entity_type: "customer",
    related_entity_id: customer.id,
    channel: ["telegram", "ntfy", "whatsapp", "email"].includes(input.channel) ? (input.channel as any) : "ntfy",
    priority: "normal",
    scheduled_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
    content: input.message_text,
    language: customer.language_pref || "ru"
  });

  await supabase.from("event_outbox").insert({
    tenant_id: customer.tenant_id,
    event_type: "customer.message_sent",
    entity_type: "customer",
    entity_id: customer.id,
    payload: {
      channel: input.channel,
      recipient,
      customer_name: customer.full_name,
      sent_by: currentUser.authUserId,
      content_preview: input.message_text.slice(0, 160)
    }
  });

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customer.id}`);
  return actionOk("Сообщение отправлено и сохранено в истории.");
}

export async function sendLeadMessageAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    console.warn("Supabase is not configured. Create crm/.env.local first.");
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }

  const currentUser = await getCurrentUserContext();
  if (currentUser.supabaseConfigured && !currentUser.isAuthenticated) {
    console.warn("Authentication required to send lead messages.");
    return actionError("Нужно войти в CRM, чтобы отправлять сообщения.");
  }
  if (currentUser.role === "partner_view" || currentUser.role === "accountant") {
    console.warn("Current role cannot send lead messages.");
    return actionError("У этой роли нет прав отправлять сообщения лидам.");
  }

  const parsed = leadMessageSchema.safeParse({
    lead_id: formData.get("lead_id"),
    channel: formData.get("channel"),
    message_text: formData.get("message_text") || "",
    message_type: formData.get("message_type") || "text",
    media_url: formData.get("media_url") || null
  });
  if (!parsed.success) return actionError("Проверьте канал, текст сообщения и файлы.");
  const input = parsed.data;

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, tenant_id, customer_id, source, anonymous_data")
    .eq("id", input.lead_id)
    .eq("tenant_id", currentUser.tenantId)
    .maybeSingle();

  if (leadError || !lead) {
    console.error(leadError?.message ?? "Lead not found.");
    return actionError(leadError?.message ?? "Лид не найден.");
  }

  const anonymous = (lead.anonymous_data ?? {}) as Record<string, string | null | undefined>;
  let recipient =
    input.channel === "whatsapp"
      ? anonymous.phone || anonymous.whatsapp || anonymous.contact || anonymous.contact_handle
      : input.channel === "telegram"
      ? anonymous.telegram_username || anonymous.telegram || anonymous.contact || anonymous.contact_handle
      : anonymous.contact || anonymous.contact_handle || anonymous.username || anonymous.handle || anonymous.userId;

  if (!recipient) {
    recipient = await findLastConversationContact(supabase, currentUser.tenantId, { leadId: input.lead_id }, input.channel);
  }

  if (!recipient) {
    console.error(`Lead has no ${input.channel} recipient.`);
    return actionError(`У лида нет контакта для ${input.channel}.`);
  }
  const messageText = input.message_text || (input.message_type === "video" ? "[Видео]" : "[Фото]");
  const recentDuplicate = await hasRecentOutboundMessage(supabase, currentUser.tenantId, { leadId: lead.id }, {
    channel: input.channel,
    recipient,
    messageText,
    messageType: input.message_type,
    mediaUrl: input.media_url
  });
  if (recentDuplicate) {
    return actionOk("Такое сообщение уже отправлялось этому лиду недавно. Повторная отправка остановлена.");
  }

  let payload: Record<string, unknown> = {};
  if (input.channel === "whatsapp") {
    payload = {
      phoneNumber: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "telegram") {
    payload = {
      TelegramUsername: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "line") {
    payload = {
      lineUserId: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "instagram") {
    payload = {
      instagramUsername: recipient,
      messageText: input.message_text
    };
  } else if (input.channel === "tiktok") {
    payload = {
      tiktokUsername: recipient,
      messageText: input.message_text
    };
  }

  if (input.media_url) {
    payload.mediaUrl = input.media_url;
    payload.messageType = input.message_type;
  }

  const messagingSecret = process.env.EPICENTER_MESSAGING_SECRET;
  if (!messagingSecret) {
    console.error("EPICENTER_MESSAGING_SECRET is not configured.");
    return actionError("Не настроен секрет шлюза сообщений EPICENTER_MESSAGING_SECRET.");
  }

  const response = await fetch(messagingEndpoint(input.channel), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-epicenter-messaging-secret": messagingSecret
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    console.error(`Message gateway failed: ${response.status} ${await response.text()}`);
    return actionError(`Шлюз сообщений вернул ошибку ${response.status}.`);
  }

  const { error: messageInsertError } = await supabase.from("conversation_messages").insert({
    tenant_id: lead.tenant_id,
    customer_id: lead.customer_id,
    lead_id: lead.id,
    channel: ["line", "tiktok"].includes(input.channel) ? "other" : input.channel,
    direction: "outbound",
    sender_type: "operator",
    sender_name: currentUser.fullName,
    sender_user_id: currentUser.authUserId,
    contact_handle: recipient,
    message_text: messageText,
    message_type: input.message_type,
    media_url: input.media_url,
    status: "sent",
    raw_payload: {
      gateway: messagingEndpoint(input.channel),
      recipient,
      ...(["line", "tiktok"].includes(input.channel) ? { original_channel: input.channel } : {})
    },
    occurred_at: new Date().toISOString()
  });
  if (messageInsertError) {
    console.error(`Lead message sent but history insert failed: ${messageInsertError.message}`);
    return actionError("Сообщение отправлено, но история лида не сохранилась. Проверьте чат и не отправляйте повторно сразу.");
  }

  await supabase.from("event_outbox").insert({
    tenant_id: lead.tenant_id,
    event_type: "lead.message_sent",
    entity_type: "lead",
    entity_id: lead.id,
    payload: {
      channel: input.channel,
      recipient,
      sent_by: currentUser.authUserId,
      content_preview: input.message_text.slice(0, 160)
    }
  });

  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${lead.id}`);
  if (lead.customer_id) revalidatePath(`/customers/${lead.customer_id}`);
  return actionOk("Сообщение отправлено и сохранено в истории лида.");
}

const deleteCustomerSchema = z.object({
  customer_id: z.string().uuid()
});

export async function deleteCustomerAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner"]);
  if (!user) return actionError("Удалять клиентов может только Владелец (owner).");

  const parsed = deleteCustomerSchema.safeParse({
    customer_id: formData.get("customer_id")
  });
  if (!parsed.success) {
    return actionError("Некорректный идентификатор клиента.");
  }

  const { customer_id } = parsed.data;

  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("tenant_id", user.tenantId)
    .eq("id", customer_id);

  if (error) {
    console.error("Error deleting customer:", error.message);
    if (error.message.includes("foreign key") || error.code === "23503") {
      return actionError("Нельзя удалить клиента, у которого есть связанные брони, сделки или сообщения.");
    }
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  return actionOk("Клиент успешно удален.");
}

const customerUpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1),
  full_name_passport: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  telegram_username: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  nationality: z.string().optional(),
  language_pref: z.enum(["ru", "en"]).default("ru"),
  source: z.string().default("whatsapp"),
  source_detail: z.string().optional(),
  passport_number: z.string().optional(),
  passport_expires: z.string().optional(),
  idp_number: z.string().optional(),
  idp_expires: z.string().optional()
});

export async function updateCustomerAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "operator", "marketer", "accountant", "partner_view"]);
  if (!user) return actionError("Недостаточно прав для редактирования клиента.");

  const parsed = customerUpdateSchema.safeParse({
    id: formString(formData.get("id")),
    full_name: formString(formData.get("full_name")),
    full_name_passport: formString(formData.get("full_name_passport")),
    phone: formString(formData.get("phone")),
    whatsapp: formString(formData.get("whatsapp")),
    telegram_username: formString(formData.get("telegram_username")),
    email: formString(formData.get("email")),
    nationality: formString(formData.get("nationality")),
    language_pref: formData.get("language_pref") || "ru",
    source: formString(formData.get("source")) || "whatsapp",
    source_detail: formString(formData.get("source_detail")),
    passport_number: formString(formData.get("passport_number")),
    passport_expires: formString(formData.get("passport_expires")),
    idp_number: formString(formData.get("idp_number")),
    idp_expires: formString(formData.get("idp_expires"))
  });
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные клиента.");
  const input = parsed.data;

  const passportExpires = normalizeDateInput(input.passport_expires);
  const idpExpires = normalizeDateInput(input.idp_expires);
  const hasValidIdp = hasValidDrivingPermit(input.idp_number, idpExpires);
  const customerSource = normalizeSourceForDb(input.source);
  const customerSourceDetail = sourceDetailWithOriginalSource(input.source, input.source_detail);
  const duplicateMessage = await findDuplicateCustomerMessage(supabase, user.tenantId, input, input.id);
  if (duplicateMessage) return actionError(duplicateMessage);

  const { error } = await supabase.from("customers").update({
    full_name: input.full_name,
    full_name_passport: input.full_name_passport || null,
    phone: cleanPhone(input.phone),
    whatsapp: cleanPhone(input.whatsapp) || cleanPhone(input.phone),
    telegram_username: input.telegram_username || null,
    email: input.email || null,
    nationality: input.nationality || null,
    language_pref: input.language_pref,
    source: customerSource,
    source_detail: customerSourceDetail,
    passport_number: input.passport_number || null,
    passport_expires: passportExpires,
    idp_number: input.idp_number || null,
    idp_expires: idpExpires,
    has_valid_idp: hasValidIdp
  }).eq("id", input.id).eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/customers");
  revalidatePath(`/customers/${input.id}`);
  revalidatePath("/");
  return actionOk("Карточка клиента сохранена.");
}

const changePasswordSchema = z.object({
  user_id: z.string().uuid(),
  new_password: z.string().min(6)
});

export async function changeUserPasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const currentUser = await requireRole(["owner"]);
  if (!currentUser) return actionError("Только owner может менять пароли.");

  const parsed = changePasswordSchema.safeParse({
    user_id: formData.get("user_id"),
    new_password: formData.get("new_password")
  });
  if (!parsed.success) return actionError("Пароль должен быть минимум 6 символов.");
  const input = parsed.data;

  const { data: appUser } = await supabase.from("app_users")
    .select("auth_user_id, full_name").eq("id", input.user_id).eq("tenant_id", currentUser.tenantId).maybeSingle();
  if (!appUser?.auth_user_id) return actionError("Пользователь не найден.");

  const { error } = await supabase.auth.admin.updateUserById(appUser.auth_user_id, { password: input.new_password });
  if (error) return actionError(error.message);

  revalidatePath("/settings");
  return actionOk(`Пароль для ${appUser.full_name} изменён.`);
}

const deleteUserSchema = z.object({
  user_id: z.string().uuid(),
  transfer_to_user_id: z.string().uuid().optional().or(z.literal(""))
});

export async function deleteUserWithTransferAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const currentUser = await requireRole(["owner"]);
  if (!currentUser) return actionError("Только owner может удалять пользователей.");

  const parsed = deleteUserSchema.safeParse({
    user_id: formData.get("user_id"),
    transfer_to_user_id: formData.get("transfer_to_user_id") || ""
  });
  if (!parsed.success) return actionError("Проверьте данные для удаления.");
  const input = parsed.data;

  if (input.user_id === currentUser.authUserId) return actionError("Нельзя удалить самого себя.");

  const { data: appUser } = await supabase.from("app_users")
    .select("auth_user_id, full_name").eq("id", input.user_id).eq("tenant_id", currentUser.tenantId).maybeSingle();
  if (!appUser) return actionError("Пользователь не найден.");

  const transferTargetId = input.transfer_to_user_id || null;

  if (transferTargetId) {
    const { data: targetUser } = await supabase.from("app_users")
      .select("auth_user_id").eq("id", transferTargetId).eq("tenant_id", currentUser.tenantId).maybeSingle();
    if (targetUser?.auth_user_id) {
      await supabase.from("conversation_messages")
        .update({ sender_user_id: targetUser.auth_user_id })
        .eq("tenant_id", currentUser.tenantId)
        .eq("sender_user_id", appUser.auth_user_id);
    }
  }

  await supabase.from("app_users").delete().eq("id", input.user_id).eq("tenant_id", currentUser.tenantId);

  if (appUser.auth_user_id) {
    await supabase.auth.admin.deleteUser(appUser.auth_user_id);
  }

  revalidatePath("/settings");
  return actionOk(`Пользователь ${appUser.full_name} удалён${transferTargetId ? " и данные переданы." : "."}`);
}

export async function activateCustomerReferralAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав.");

  const customerId = formData.get("customer_id") as string;
  if (!customerId) return actionError("Идентификатор клиента не указан.");

  const { data: customer, error: fetchErr } = await supabase.from("customers")
    .select("id, full_name, phone, whatsapp, telegram_username")
    .eq("id", customerId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (fetchErr || !customer) return actionError("Клиент не найден.");

  const firstName = customer.full_name.split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "") || "EPIC";
  const promoCode = `${firstName}${Math.floor(100 + Math.random() * 900)}`;

  const { error: insertErr } = await supabase.from("partners").insert({
    tenant_id: user.tenantId,
    name: customer.full_name,
    contact: customer.phone || null,
    telegram: customer.telegram_username || null,
    whatsapp: customer.whatsapp || customer.phone || null,
    promo_code: promoCode,
    commission_thb_per_booking: 10,
    active: true,
    total_referrals: 0,
    total_commission_paid: 0
  });

  if (insertErr) {
    console.error("Insert partner error:", insertErr.message);
    return actionError(`Ошибка при создании промокода: ${insertErr.message}`);
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/analytics");
  return actionOk(`Реферальный код ${promoCode} успешно создан!`);
}

export async function updateCustomerReferralLinkAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав.");

  const customerId = formData.get("customer_id") as string;
  const referralPartnerId = formData.get("referral_partner_id") as string;
  const promoCodeUsed = formData.get("promo_code_used") as string;

  if (!customerId) return actionError("Идентификатор клиента не указан.");

  let finalPartnerId = referralPartnerId || null;
  let finalPromoCode = promoCodeUsed || null;

  if (!finalPartnerId && finalPromoCode) {
    const { data: partner } = await supabase.from("partners")
      .select("id")
      .eq("promo_code", finalPromoCode.trim())
      .eq("tenant_id", user.tenantId)
      .maybeSingle();
    if (partner) {
      finalPartnerId = partner.id;
    }
  }

  const { error: updateErr } = await supabase.from("customers").update({
    referral_partner_id: finalPartnerId,
    promo_code_used: finalPromoCode
  }).eq("id", customerId).eq("tenant_id", user.tenantId);

  if (updateErr) {
    return actionError(`Ошибка при обновлении реферальной связи: ${updateErr.message}`);
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/analytics");
  return actionOk("Реферальная связь обновлена.");
}

export async function markReferralPayoutPaidAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "operator", "accountant"]);
  if (!user) return actionError("Недостаточно прав.");

  const customerId = formData.get("customer_id") as string;
  const rewardAmount = Number(formData.get("reward_amount") || 0);

  if (!customerId) return actionError("Клиент не указан.");

  const { data: customer, error: fetchErr } = await supabase.from("customers")
    .select("id, referral_partner_id, tags")
    .eq("id", customerId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (fetchErr || !customer) return actionError("Клиент не найден.");
  if (!customer.referral_partner_id) return actionError("Этот клиент не является рефералом.");

  const { data: partner } = await supabase.from("partners")
    .select("id, total_commission_paid")
    .eq("id", customer.referral_partner_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (!partner) return actionError("Реферер не найден.");

  const currentTags = Array.isArray(customer.tags) ? customer.tags : [];
  if (currentTags.includes("referral_payout_completed")) {
    revalidatePath("/analytics");
    revalidatePath(`/customers/${customerId}`);
    return actionOk("Выплата уже была зафиксирована ранее. Повторное начисление не выполнено.");
  }

  if (!currentTags.includes("referral_payout_completed")) {
    currentTags.push("referral_payout_completed");
  }

  const { error: updateCustErr } = await supabase.from("customers").update({
    tags: currentTags
  }).eq("id", customerId).eq("tenant_id", user.tenantId);

  if (updateCustErr) {
    return actionError(`Ошибка при обновлении статуса: ${updateCustErr.message}`);
  }

  const newPaid = Number(partner.total_commission_paid ?? 0) + rewardAmount;
  const { error: updatePartnerErr } = await supabase.from("partners").update({
    total_commission_paid: newPaid
  }).eq("id", partner.id).eq("tenant_id", user.tenantId);

  if (updatePartnerErr) {
    return actionError(`Ошибка при обновлении баланса партнера: ${updatePartnerErr.message}`);
  }

  revalidatePath("/analytics");
  revalidatePath(`/customers/${customerId}`);
  return actionOk("Выплата успешно зафиксирована!");
}

export async function uploadAvatarAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");

  const currentUser = await getCurrentUserContext();
  if (!currentUser.isAuthenticated) {
    return actionError("Необходимо войти в систему.");
  }

  const targetUserId = formData.get("user_id") as string;
  if (!targetUserId) {
    return actionError("Не указан ID пользователя.");
  }

  // A user can only upload their own avatar, unless they are the owner
  if (currentUser.appUserId !== targetUserId && currentUser.role !== "owner") {
    return actionError("Недостаточно прав для изменения чужого аватара.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionError("Выберите файл для загрузки.");
  }

  // Upload to avatars bucket
  const fileExt = file.name.split('.').pop() || 'png';
  const path = `${currentUser.tenantId}/${targetUserId}-${Date.now()}.${fileExt}`;

  // First, upload to storage
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
    contentType: file.type,
    upsert: true
  });

  if (uploadError) {
    console.error("Avatar upload error:", uploadError.message);
    return actionError(`Ошибка загрузки: ${uploadError.message}`);
  }

  // Get public URL
  const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(path);
  const fileUrl = publicUrl.publicUrl;

  // Update in app_users
  const { error: updateError } = await supabase
    .from("app_users")
    .update({ avatar_url: fileUrl })
    .eq("id", targetUserId)
    .eq("tenant_id", currentUser.tenantId);

  if (updateError) {
    console.error("Avatar db update error:", updateError.message);
    return actionError(`Ошибка сохранения в БД: ${updateError.message}`);
  }

  revalidatePath("/");
  revalidatePath("/users");
  revalidatePath("/settings");

  return actionOk("Фотография успешно обновлена.");
}

const mergeCustomersSchema = z.object({
  source_customer_id: z.string().uuid(),
  target_customer_id: z.string().uuid()
});

export async function mergeCustomersAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase не настроен. Проверьте переменные окружения CRM.");
  }
  const user = await requireRole(["owner"]);
  if (!user) return actionError("Объединять клиентов может только Владелец (owner).");

  const parsed = mergeCustomersSchema.safeParse({
    source_customer_id: formData.get("source_customer_id"),
    target_customer_id: formData.get("target_customer_id")
  });
  if (!parsed.success) {
    return actionError("Некорректные идентификаторы клиентов.");
  }

  const { source_customer_id, target_customer_id } = parsed.data;

  if (source_customer_id === target_customer_id) {
    return actionError("Нельзя объединить клиента самого с собой.");
  }

  // 1. Fetch both customers
  const { data: sourceCust, error: sourceErr } = await supabase
    .from("customers")
    .select("*")
    .eq("id", source_customer_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  const { data: targetCust, error: targetErr } = await supabase
    .from("customers")
    .select("*")
    .eq("id", target_customer_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (sourceErr || !sourceCust) return actionError("Исходный клиент не найден.");
  if (targetErr || !targetCust) return actionError("Целевой клиент не найден.");

  // 2. Coalesce metadata fields from source to target
  const updatedFields: Record<string, any> = {};
  const coalesceKeys = [
    "full_name_passport", "phone", "whatsapp", "telegram_username",
    "email", "nationality", "passport_number", "passport_expires",
    "passport_photo_url", "driver_license_number", "driver_license_country",
    "driver_license_photo_url", "idp_number", "idp_expires", "idp_photo_url",
    "referral_partner_id", "promo_code_used"
  ];

  for (const key of coalesceKeys) {
    if (!targetCust[key] && sourceCust[key]) {
      updatedFields[key] = sourceCust[key];
    }
  }

  // Combine tags arrays
  const sourceTags = Array.isArray(sourceCust.tags) ? sourceCust.tags : [];
  const targetTags = Array.isArray(targetCust.tags) ? targetCust.tags : [];
  const combinedTags = Array.from(new Set([...sourceTags, ...targetTags])).filter(Boolean);
  if (combinedTags.length > 0) {
    updatedFields["tags"] = combinedTags;
  }

  // Update target customer if there are any fields to coalesce
  if (Object.keys(updatedFields).length > 0) {
    const { error: updateTargetErr } = await supabase
      .from("customers")
      .update(updatedFields)
      .eq("id", target_customer_id)
      .eq("tenant_id", user.tenantId);
    if (updateTargetErr) {
      console.error("Error updating target customer during merge:", updateTargetErr.message);
    }
  }

  // 3. Update bookings
  const { error: bookingsErr } = await supabase
    .from("bookings")
    .update({ customer_id: target_customer_id })
    .eq("customer_id", source_customer_id)
    .eq("tenant_id", user.tenantId);

  if (bookingsErr) {
    console.error("Error updating bookings during merge:", bookingsErr.message);
    return actionError(`Не удалось перенести бронирования: ${bookingsErr.message}`);
  }

  // 4. Update customer references in related records
  const customerReferenceUpdates = [
    { table: "reviews", column: "customer_id", label: "отзывы" },
    { table: "notifications", column: "customer_id", label: "уведомления" },
    { table: "maintenance_log", column: "caused_by_customer_id", label: "ремонт/повреждения" },
    { table: "traffic_fines", column: "charged_to_customer_id", label: "штрафы" }
  ];

  for (const updateConfig of customerReferenceUpdates) {
    const { error: referenceErr } = await supabase
      .from(updateConfig.table)
      .update({ [updateConfig.column]: target_customer_id })
      .eq(updateConfig.column, source_customer_id)
      .eq("tenant_id", user.tenantId);

    if (referenceErr) {
      console.error(`Error updating ${updateConfig.table} during merge:`, referenceErr.message);
      return actionError(`Не удалось перенести ${updateConfig.label}: ${referenceErr.message}`);
    }
  }

  // 5. Update leads
  const { error: leadsErr } = await supabase
    .from("leads")
    .update({ customer_id: target_customer_id })
    .eq("customer_id", source_customer_id)
    .eq("tenant_id", user.tenantId);

  if (leadsErr) {
    console.error("Error updating leads during merge:", leadsErr.message);
    return actionError(`Не удалось перенести сделки: ${leadsErr.message}`);
  }

  // 6. Update conversation messages
  const { error: messagesErr } = await supabase
    .from("conversation_messages")
    .update({ customer_id: target_customer_id })
    .eq("customer_id", source_customer_id)
    .eq("tenant_id", user.tenantId);

  if (messagesErr) {
    console.error("Error updating messages during merge:", messagesErr.message);
    return actionError(`Не удалось перенести сообщения: ${messagesErr.message}`);
  }

  // 7. Delete source customer
  const { error: deleteErr } = await supabase
    .from("customers")
    .delete()
    .eq("id", source_customer_id)
    .eq("tenant_id", user.tenantId);

  if (deleteErr) {
    console.error("Error deleting source customer during merge:", deleteErr.message);
    return actionError(`Не удалось удалить старого клиента после переноса данных: ${deleteErr.message}`);
  }

  await refreshCustomerBookingStats(supabase, user.tenantId, target_customer_id);

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${target_customer_id}`);
  revalidatePath("/bookings");
  revalidatePath("/leads");
  revalidatePath("/analytics");
  revalidatePath("/launch");
  return actionOk("Клиенты успешно объединены! Все данные перенесены.", target_customer_id);
}

export async function sendCustomerNotification(
  bookingId: string,
  event: "booking_confirmed" | "booking_updated" | "rental_active" | "rental_returned",
  tenantId: string
) {
  try {
    const supabase = requireSupabase();
    if (!supabase) return;

    // Fetch booking details
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("*, customer:customers(*), vehicle:vehicles(*)")
      .eq("tenant_id", tenantId)
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingErr || !booking || !booking.customer) {
      console.error("sendCustomerNotification error fetching booking:", bookingErr?.message);
      return;
    }

    const customer = booking.customer;
    const vehicle = booking.vehicle;
    const lang = customer.language_pref === "en" ? "en" : "ru";

    const customerName = customer.full_name || customer.full_name_passport || "Клиент";
    const vehicleName = vehicle ? `${vehicle.make} ${vehicle.model}`.trim() : "автомобиль";
    const plate = vehicle?.license_plate || "-";
    const formatDateTime = (dateStr: string | null | undefined, lang: "ru" | "en") => {
      if (!dateStr) return "-";
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return "-";
      const datePart = date.toLocaleDateString(lang === "en" ? "en-US" : "ru-RU");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return lang === "ru" ? `${datePart} в ${hours}:${minutes}` : `${datePart} at ${hours}:${minutes}`;
    };

    const startDate = formatDateTime(booking.start_date, lang);
    const endDate = formatDateTime(booking.end_date, lang);
    const pickupLoc = booking.pickup_location || (lang === "en" ? "Not specified" : "Не указано");
    const returnLoc = booking.return_location || (lang === "en" ? "Not specified" : "Не указано");

    let messageText = "";

    if (event === "booking_updated") {
      if (lang === "ru") {
        messageText = `🔄 *Ваше бронирование обновлено!* 🚗\n\n` +
          `Уважаемый(а) ${customerName}, детали вашей брони #${booking.booking_number} были успешно изменены.\n\n` +
          `📋 *Новые детали поездки:*\n` +
          `• *Автомобиль:* ${vehicleName} · ${plate}\n` +
          `• *Период аренды:* с ${startDate} по ${endDate}\n` +
          `• *Локация выдачи:* ${pickupLoc} 📍\n` +
          `• *Локация возврата:* ${returnLoc} 📍\n\n` +
          `💰 *Финансовые условия:*\n` +
          `• *Итого к оплате:* ${booking.grand_total} THB\n\n` +
          `Если у вас возникнут вопросы, мы всегда на связи!`;
      } else {
        messageText = `🔄 *Your booking has been updated!* 🚗\n\n` +
          `Dear ${customerName}, the details of your booking #${booking.booking_number} have been successfully updated.\n\n` +
          `📋 *New Booking Details:*\n` +
          `• *Vehicle:* ${vehicleName} · ${plate}\n` +
          `• *Rental period:* from ${startDate} to ${endDate}\n` +
          `• *Pickup location:* ${pickupLoc} 📍\n` +
          `• *Return location:* ${returnLoc} 📍\n\n` +
          `💰 *Financial Terms:*\n` +
          `• *Grand total:* ${booking.grand_total} THB\n\n` +
          `If you have any questions, we are always here to help!`;
      }
    } else if (event === "booking_confirmed") {
      if (lang === "ru") {
        messageText = `🎉 *Ваше бронирование успешно подтверждено!* 🚗\n\n` +
          `Уважаемый(а) ${customerName}, мы рады подтвердить вашу бронь автомобиля в компании Epicenter.\n\n` +
          `📋 *Детали вашей поездки:*\n` +
          `• *Номер брони:* #${booking.booking_number}\n` +
          `• *Автомобиль:* ${vehicleName} · ${plate}\n` +
          `• *Период аренды:* с ${startDate} по ${endDate}\n` +
          `• *Локация выдачи:* ${pickupLoc} 📍\n` +
          `• *Локация возврата:* ${returnLoc} 📍\n\n` +
          `💰 *Финансовые условия:*\n` +
          `• *Стоимость аренды:* ${booking.total_rental_amount} THB\n` +
          `• *Депозит (залог):* ${booking.deposit_amount} THB\n` +
          `• *Стоимость доставки:* ${booking.delivery_fee} THB\n` +
          `• *Итого к оплате:* ${booking.grand_total} THB\n\n` +
          `С нетерпением ждем встречи с вами! Желаем вам отличных дорог и прекрасного отдыха на солнечном Пхукете! 🌴☀️`;
      } else {
        messageText = `🎉 *Your booking is successfully confirmed!* 🚗\n\n` +
          `Dear ${customerName}, we are happy to confirm your booking with Epicenter.\n\n` +
          `📋 *Booking Details:*\n` +
          `• *Booking number:* #${booking.booking_number}\n` +
          `• *Vehicle:* ${vehicleName} · ${plate}\n` +
          `• *Rental period:* from ${startDate} to ${endDate}\n` +
          `• *Pickup location:* ${pickupLoc} 📍\n` +
          `• *Return location:* ${returnLoc} 📍\n\n` +
          `💰 *Financial Terms:*\n` +
          `• *Rental amount:* ${booking.total_rental_amount} THB\n` +
          `• *Deposit:* ${booking.deposit_amount} THB\n` +
          `• *Delivery fee:* ${booking.delivery_fee} THB\n` +
          `• *Grand total:* ${booking.grand_total} THB\n\n` +
          `We look forward to meeting you! Have a wonderful trip in Phuket! 🌴☀️`;
      }
    } else if (event === "rental_active") {
      if (lang === "ru") {
        messageText = `🔑 *Ваша аренда успешно началась!* 🚗\n\n` +
          `Уважаемый(а) ${customerName}, ваш автомобиль ${vehicleName} (${plate}) официально передан вам.\n\n` +
          `Желаем вам приятного, комфортного и безопасного вождения по дорогам Пхукета! Если у вас возникнут вопросы или потребуется какая-либо помощь, мы всегда на связи с вами в этом чате. Хорошей поездки! 🌴☀️`;
      } else {
        messageText = `🔑 *Your rental has successfully started!* 🚗\n\n` +
          `Dear ${customerName}, your vehicle ${vehicleName} (${plate}) has been successfully handed over to you.\n\n` +
          `We wish you a pleasant, comfortable, and safe driving experience in Phuket! If you have any questions or need any assistance, we are always here for you in this chat. Enjoy your ride! 🌴☀️`;
      }
    } else if (event === "rental_returned") {
      if (lang === "ru") {
        messageText = `✅ *Аренда успешно завершена!* 🚗\n\n` +
          `Уважаемый(а) ${customerName}, искренне благодарим вас за возврат автомобиля ${vehicleName} (${plate}).\n\n` +
          `Аренда официально закрыта, возврат залога (депозита) успешно зафиксирован.\n\n` +
          `Спасибо, что выбрали Epicenter! Мы будем счастливы видеть вас снова среди наших клиентов при следующих поездках на Пхукет. Счастливого пути и до новых встреч! 👋✨`;
      } else {
        messageText = `✅ *Rental successfully completed!* 🚗\n\n` +
          `Dear ${customerName}, thank you for returning the vehicle ${vehicleName} (${plate}).\n\n` +
          `Your rental is officially completed, and your deposit return has been successfully processed.\n\n` +
          `Thank you for choosing Epicenter! We look forward to welcoming you back on your next trip to Phuket. Safe travels and see you soon! 👋✨`;
      }
    }

    const messagingSecret = process.env.EPICENTER_MESSAGING_SECRET || "00d57c65010537e2d52f8979d0ef8c88204410a4dcf7b6b36187879c08a05034";
    const recordNotificationAttempt = async (
      channel: "whatsapp" | "telegram",
      recipient: string,
      status: "sent" | "failed",
      rawPayload: Record<string, unknown>
    ) => {
      const { error: insertError } = await supabase.from("conversation_messages").insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        channel,
        direction: "outbound",
        sender_type: "system",
        sender_name: "CRM automation",
        contact_handle: recipient,
        message_text: channel === "telegram" ? messageText.replace(/\*/g, "") : messageText,
        message_type: "text",
        status,
        raw_payload: {
          event,
          booking_id: booking.id,
          booking_number: booking.booking_number,
          ...rawPayload
        },
        occurred_at: new Date().toISOString()
      });
      if (insertError) {
        console.error(`Notification ${channel} history insert failed: ${insertError.message}`);
      }
    };

    // 1. WhatsApp outbound
    const phoneNum = customer.whatsapp || customer.phone;
    if (phoneNum) {
      console.log(`sendCustomerNotification: Sending WhatsApp for event ${event} to ${phoneNum}`);
      const gateway = process.env.WHATSAPP_SEND_URL || "https://n8nx.pro/webhook/whatsappOutboundWfCR/webhook/epicenter-messaging/whatsapp/send";
      try {
        const response = await fetch(gateway, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-epicenter-messaging-secret": messagingSecret
          },
          body: JSON.stringify({
            phoneNumber: phoneNum,
            messageText: messageText
          })
        });
        const responseText = await response.text().catch(() => "");
        await recordNotificationAttempt("whatsapp", phoneNum, response.ok ? "sent" : "failed", {
          gateway,
          http_status: response.status,
          response_text: responseText.slice(0, 500)
        });
        if (!response.ok) {
          console.error(`Notification WhatsApp send failed: ${response.status} ${responseText}`);
        }
      } catch (err) {
        await recordNotificationAttempt("whatsapp", phoneNum, "failed", {
          gateway,
          error: err instanceof Error ? err.message : String(err)
        });
        console.error("Notification WhatsApp send failed:", err);
      }
    }

    // 2. Telegram outbound
    if (customer.telegram_username) {
      let cleanedTg = customer.telegram_username.trim();
      cleanedTg = cleanedTg.replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "");
      cleanedTg = cleanedTg.replace(/^@/, "");
      if (cleanedTg) {
        const tgUsername = `@${cleanedTg}`;
        console.log(`sendCustomerNotification: Sending Telegram for event ${event} to ${tgUsername}`);
        const gateway = process.env.TELEGRAM_SEND_URL || "https://n8nx.pro/epicenter-messaging/telegram/send";
        const telegramMessageText = messageText.replace(/\*/g, "");
        try {
          const response = await fetch(gateway, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-epicenter-messaging-secret": messagingSecret
            },
            body: JSON.stringify({
              TelegramUsername: tgUsername,
              messageText: telegramMessageText
            })
          });
          const responseText = await response.text().catch(() => "");
          await recordNotificationAttempt("telegram", tgUsername, response.ok ? "sent" : "failed", {
            gateway,
            http_status: response.status,
            response_text: responseText.slice(0, 500)
          });
          if (!response.ok) {
            console.error(`Notification Telegram send failed: ${response.status} ${responseText}`);
          }
        } catch (err) {
          await recordNotificationAttempt("telegram", tgUsername, "failed", {
            gateway,
            error: err instanceof Error ? err.message : String(err)
          });
          console.error("Notification Telegram send failed:", err);
        }
      }
    }
  } catch (err) {
    console.error("sendCustomerNotification crashed:", err);
  }
}
