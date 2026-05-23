"use server";

import { revalidatePath } from "next/cache";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { getCurrentUserContext } from "./repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "./supabase";
import type { Role } from "./types";

function requireSupabase() {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createServiceSupabaseClient();
}

function formString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
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
  if (source === "manual" || source === "phone" || source === "email") return "other";
  return dbSourceValues.has(source) ? source : "other";
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
  full_name: z.string().min(1),
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

  const { data: customer, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: user.tenantId,
      full_name: input.full_name,
      full_name_passport: input.full_name_passport || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || input.phone || null,
      telegram_username: input.telegram_username || null,
      email: input.email || null,
      nationality: input.nationality || null,
      language_pref: input.language_pref,
      source: customerSource,
      source_detail: input.source_detail || null,
      passport_number: input.passport_number || null,
      passport_expires: input.passport_expires || null,
      idp_number: input.idp_number || null,
      idp_expires: input.idp_expires || null,
      first_contact_channel: customerSource
    })
    .select("id")
    .single();

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/fleet");
  const returnPath = formString(formData.get("return_path"));
  if (returnPath.startsWith("/")) revalidatePath(returnPath);
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
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    telegram_username: formData.get("telegram_username"),
    source: formData.get("source") || "whatsapp"
  });
  if (!parsed.success) return actionError("Проверьте имя клиента и данные лида.");
  const input = parsed.data;
  const customerSource = normalizeSourceForDb(input.source);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      tenant_id: user.tenantId,
      full_name: input.full_name,
      phone: input.phone || null,
      whatsapp: customerSource === "whatsapp" ? input.phone || null : null,
      telegram_username: input.telegram_username || null,
      language_pref: "ru",
      source: customerSource,
      first_contact_channel: customerSource
    })
    .select("id")
    .single();

  if (customerError || !customer) {
    console.error(customerError?.message ?? "Customer was not created.");
    return actionError(customerError?.message ?? "Клиент не создан.");
  }

  const { data: existingLead, error: existingLeadError } = await supabase
    .from("leads")
    .select("anonymous_data")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.lead_id)
    .maybeSingle();

  if (existingLeadError) {
    console.error(existingLeadError.message);
    return actionError(existingLeadError.message);
  }

  const previousAnonymous = (existingLead?.anonymous_data ?? {}) as Record<string, unknown>;

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

  const { data: lead, error } = await supabase.from("leads").insert({
    tenant_id: user.tenantId,
    source: leadSource,
    source_detail: input.source_detail || null,
    utm_campaign: input.campaign || null,
    anonymous_data: {
      name: input.customer_name,
      phone: input.phone,
      source: leadSource,
      source_detail: input.source_detail,
      campaign: input.campaign
    },
    inquiry_text: input.inquiry_text,
    status: input.status,
    score: input.score,
    conversation_log_url: input.conversation_log_url || null
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
  daily_rate_short_term: z.coerce.number().nonnegative(),
  daily_rate_long_term: z.coerce.number().nonnegative(),
  monthly_rate: z.coerce.number().nonnegative(),
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
    daily_rate_short_term: formData.get("daily_rate_short_term"),
    daily_rate_long_term: formData.get("daily_rate_long_term"),
    monthly_rate: formData.get("monthly_rate"),
    deposit_amount: formData.get("deposit_amount") || 0,
    notes_internal: formData.get("notes_internal"),
    public_visible: formData.get("public_visible") === "on",
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
    vin: input.vin || null,
    color: input.color || null,
    notes_internal: input.notes_internal || null,
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
  return actionOk("Автомобиль добавлен в автопарк.");
}

const vehicleUpdateSchema = vehicleSchema.extend({
  id: z.string().uuid()
});

export async function updateVehicleAction(formData: FormData): Promise<void> {
  const supabase = requireSupabase();
  if (!supabase) return;
  const user = await requireRole(["owner", "manager", "marketer"]);
  if (!user) return;

  const input = vehicleUpdateSchema.parse({
    id: formData.get("id"),
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
    daily_rate_short_term: formData.get("daily_rate_short_term"),
    daily_rate_long_term: formData.get("daily_rate_long_term"),
    monthly_rate: formData.get("monthly_rate"),
    deposit_amount: formData.get("deposit_amount") || 0,
    notes_internal: formData.get("notes_internal"),
    public_visible: formData.get("public_visible") === "on",
    public_sort_order: formData.get("public_sort_order") || 100,
    public_description_ru: formData.get("public_description_ru"),
    public_description_en: formData.get("public_description_en"),
    public_features: formData.get("public_features")
  });

  const { error } = await supabase
    .from("vehicles")
    .update({
      location_id: input.location_id,
      license_plate: input.license_plate,
      make: input.make,
      model: input.model,
      year: input.year,
      vin: input.vin || null,
      color: input.color || null,
      body_type: input.body_type,
      category: input.category,
      fuel_type: input.fuel_type,
      transmission: input.transmission,
      seats: input.seats,
      mileage_current: input.mileage_current,
      status: input.status,
      ownership_type: input.ownership_type,
      acquisition_cost_thb: input.acquisition_cost_thb,
      acquisition_date: input.acquisition_date,
      daily_rate_short_term: input.daily_rate_short_term,
      daily_rate_long_term: input.daily_rate_long_term,
      monthly_rate: input.monthly_rate,
      deposit_amount: input.deposit_amount,
      notes_internal: input.notes_internal || null,
      public_visible: input.public_visible,
      public_sort_order: input.public_sort_order,
      public_description_ru: input.public_description_ru || null,
      public_description_en: input.public_description_en || null,
      public_features: input.public_features ? input.public_features.split(",").map((item) => item.trim()).filter(Boolean) : []
    })
    .eq("id", input.id)
    .eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return;
  }

  revalidatePath("/");
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.id}`);
  revalidatePath("/api/tilda/vehicles");
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
  { key: "1_month", minDays: 30, maxDays: 30, monthly: true }
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
  revalidatePath("/api/tilda/vehicles");
  return actionOk("Матрица цен сохранена. Каталог Tilda получит новые цены через API.");
}

const vehiclePhotoDeleteSchema = z.object({
  vehicle_id: z.string().uuid(),
  photo_url: z.string().url()
});

const vehicleComplianceSchema = z.object({
  vehicle_id: z.string().uuid(),
  insurance_type: z.enum(["CMI_compulsory", "1st_class", "2nd_class", "3rd_class"]).default("1st_class"),
  insurance_provider: z.string().optional(),
  insurance_phone: z.string().optional(),
  policy_number: z.string().optional(),
  insurance_start_date: z.string().optional(),
  insurance_end_date: z.string().optional(),
  premium_amount: z.coerce.number().nonnegative().default(0),
  deductible: z.coerce.number().nonnegative().default(0),
  road_tax_amount_thb: z.coerce.number().nonnegative().default(0),
  road_tax_due_date: z.string().optional(),
  road_tax_paid_until: z.string().optional(),
  inspection_expires_at: z.string().optional()
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
    premium_amount: formData.get("premium_amount") || 0,
    deductible: formData.get("deductible") || 0,
    road_tax_amount_thb: formData.get("road_tax_amount_thb") || 0,
    road_tax_due_date: formData.get("road_tax_due_date"),
    road_tax_paid_until: formData.get("road_tax_paid_until"),
    inspection_expires_at: formData.get("inspection_expires_at")
  });
  if (!parsed.success) return actionError("Проверьте поля страховки, налога и даты документов.");
  const input = parsed.data;

  let insuranceId: string | null = null;
  if (input.insurance_provider && input.policy_number && input.insurance_start_date && input.insurance_end_date) {
    const provider = input.insurance_phone ? `${input.insurance_provider} | ${input.insurance_phone}` : input.insurance_provider;
    const { data: insurance, error: insuranceError } = await supabase
      .from("insurance")
      .upsert(
        {
          tenant_id: user.tenantId,
          vehicle_id: input.vehicle_id,
          type: input.insurance_type,
          provider,
          policy_number: input.policy_number,
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
      console.error(insuranceError.message);
      return actionError(`Страховка не сохранена: ${insuranceError.message}`);
    } else {
      insuranceId = insurance?.id ?? null;
    }
  }

  const vehicleUpdate: Record<string, string | number | null> = {
    road_tax_amount_thb: input.road_tax_amount_thb,
    road_tax_due_date: input.road_tax_due_date || null,
    road_tax_paid_until: input.road_tax_paid_until || null,
    inspection_expires_at: input.inspection_expires_at || input.insurance_end_date || null
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

  if (input.road_tax_paid_until || input.road_tax_due_date) {
    const { error: taxError } = await supabase.from("road_tax_payments").insert({
      tenant_id: user.tenantId,
      vehicle_id: input.vehicle_id,
      amount_thb: input.road_tax_amount_thb,
      paid_at: new Date().toISOString().slice(0, 10),
      period_from: new Date().toISOString().slice(0, 10),
      period_to: input.road_tax_paid_until || input.road_tax_due_date,
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
  revalidatePath("/api/tilda/vehicles");
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
  revalidatePath("/api/tilda/vehicles");
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
    .select("notes")
    .eq("id", input.lead_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const existingNotes = Array.isArray(currentLead?.notes) ? currentLead.notes : [];
  const nextNotes = input.next_action
    ? [
        ...existingNotes,
        {
          at: new Date().toISOString(),
          type: "next_action",
          text: input.next_action,
          reminder_at: input.reminder_at || null,
          status: input.status
        }
      ]
    : existingNotes;

  const { error } = await supabase
    .from("leads")
    .update({
      status: input.status,
      status_changed_at: new Date().toISOString(),
      notes: nextNotes
    })
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
  daily_rate_applied: z.coerce.number().nonnegative(),
  total_rental_amount: z.coerce.number().nonnegative(),
  deposit_amount: z.coerce.number().nonnegative(),
  delivery_fee: z.coerce.number().nonnegative().default(0),
  extras_total: z.coerce.number().nonnegative().default(0),
  grand_total: z.coerce.number().nonnegative()
});

const bookingStatusSchema = z.object({
  booking_id: z.string().uuid(),
  status: z.enum(["confirmed", "paid_deposit", "handed_over", "active", "returning", "completed", "cancelled", "no_show"])
});

export type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

function actionOk(message: string, id?: string): ActionResult {
  return { ok: true, message, id };
}

function actionError(message: string): ActionResult {
  return { ok: false, message };
}

async function syncVehicleStatusForBooking(supabase: ReturnType<typeof createServiceSupabaseClient>, tenantId: string, vehicleId: string) {
  const { data: activeBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .in("status", ["handed_over", "active", "returning"])
    .limit(1)
    .maybeSingle();

  if (activeBooking) {
    await supabase.from("vehicles").update({ status: "in_use" }).eq("tenant_id", tenantId).eq("id", vehicleId);
    return;
  }

  const { data: reservedBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .in("status", ["confirmed", "paid_deposit"])
    .gte("end_date", new Date().toISOString().slice(0, 10))
    .limit(1)
    .maybeSingle();

  await supabase
    .from("vehicles")
    .update({ status: reservedBooking ? "reserved" : "available" })
    .eq("tenant_id", tenantId)
    .eq("id", vehicleId)
    .not("status", "in", "(maintenance,repair,retired)");
}

export async function createBookingAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) {
    return actionError("Supabase is not configured. Create crm/.env.local first.");
  }
  const user = await requireRole(["owner", "manager", "operator"]);
  if (!user) return actionError("Недостаточно прав для создания брони.");

  const parsed = bookingSchema.safeParse({
    tenant_id: formData.get("tenant_id"),
    lead_id: formData.get("lead_id") || "",
    booking_number: formData.get("booking_number"),
    customer_id: formData.get("customer_id"),
    vehicle_id: formData.get("vehicle_id"),
    rental_type: formData.get("rental_type") || "short_term",
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    pickup_method: formData.get("pickup_method") || "office",
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

  if (input.end_date < input.start_date) {
    return actionError("Дата возврата не может быть раньше даты выдачи.");
  }

  const [{ data: customer }, { data: vehicle }, { data: overlappingBooking }] = await Promise.all([
    supabase.from("customers").select("id").eq("tenant_id", user.tenantId).eq("id", input.customer_id).maybeSingle(),
    supabase.from("vehicles").select("id, status").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle(),
    supabase
      .from("bookings")
      .select("id, booking_number")
      .eq("tenant_id", user.tenantId)
      .eq("vehicle_id", input.vehicle_id)
      .in("status", ["confirmed", "paid_deposit", "handed_over", "active", "returning"])
      .lte("start_date", input.end_date)
      .gte("end_date", input.start_date)
      .limit(1)
      .maybeSingle()
  ]);

  if (!customer || !vehicle) {
    return actionError("Клиент или автомобиль не найден в текущей компании.");
  }

  if (overlappingBooking) {
    return actionError(`Автомобиль уже занят на эти даты: ${overlappingBooking.booking_number}.`);
  }

  const { data: booking, error } = await supabase.from("bookings").insert({
    ...input,
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

  revalidatePath("/");
  revalidatePath("/bookings");
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${input.vehicle_id}`);
  revalidatePath(`/customers/${input.customer_id}`);
  revalidatePath("/handover");
  revalidatePath("/api/tilda/vehicles");
  revalidatePath("/api/tilda/availability");
  if (booking?.id) revalidatePath(`/bookings/${booking.id}`);
  if (input.lead_id) revalidatePath(`/leads/${input.lead_id}`);
  return actionOk(`Бронь ${input.booking_number} создана и автомобиль отмечен как забронированный.`, booking?.id);
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
    .select("id, customer_id, vehicle_id, status")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();

  if (bookingError || !booking) {
    console.error(bookingError?.message ?? "Booking not found.");
    return actionError("Бронь не найдена в текущей компании.");
  }

  if (["handed_over", "active"].includes(input.status)) {
    const { data: customer } = await supabase
      .from("customers")
      .select("has_valid_idp")
      .eq("tenant_id", user.tenantId)
      .eq("id", booking.customer_id)
      .maybeSingle();
    if (!customer?.has_valid_idp) {
      console.error("IDP is required before vehicle handover.");
      return actionError("Выдача заблокирована: у клиента нет действующего IDP.");
    }
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      status: input.status,
      actual_start: ["handed_over", "active"].includes(input.status) ? new Date().toISOString() : undefined,
      actual_end: input.status === "completed" ? new Date().toISOString() : undefined
    })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  await syncVehicleStatusForBooking(supabase, user.tenantId, booking.vehicle_id);

  revalidatePath("/");
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${input.booking_id}`);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${booking.vehicle_id}`);
  revalidatePath(`/customers/${booking.customer_id}`);
  revalidatePath("/handover");
  revalidatePath("/api/tilda/availability");
  revalidatePath("/api/tilda/vehicles");
  return actionOk("Статус брони сохранен, статус автомобиля пересчитан.");
}

const paymentSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  booking_id: z.string().uuid(),
  rental_amount: z.coerce.number().nonnegative(),
  deposit_amount: z.coerce.number().nonnegative(),
  pickup_fee: z.coerce.number().nonnegative(),
  delivery_fee: z.coerce.number().nonnegative(),
  method: z.string().default("cash")
});

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
    method: formData.get("method") || "cash"
  });
  if (!parsed.success) return actionError("Проверьте суммы платежей и выбранную бронь.");
  const input = parsed.data;

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_id, vehicle_id, grand_total")
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id)
    .maybeSingle();

  if (!booking) return actionError("Бронь не найдена или недоступна текущему пользователю.");

  const rows = [
    { type: "rental", amount: input.rental_amount },
    { type: "deposit", amount: input.deposit_amount },
    { type: "extras", amount: input.pickup_fee, notes: "pickup fee" },
    { type: "extras", amount: input.delivery_fee, notes: "delivery fee" }
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
    const { error } = await supabase.from("payments").insert(rows);
    if (error) {
      console.error(error.message);
      return actionError(`Платежи не сохранены: ${error.message}`);
    }
  }

  const totalPaid = rows.filter((row) => row.type !== "deposit").reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const paymentStatus = totalPaid <= 0 ? "unpaid" : totalPaid >= Number(booking.grand_total ?? 0) ? "fully_paid" : "partial";
  const { error: bookingError } = await supabase
    .from("bookings")
    .update({ payment_status: paymentStatus, deposit_status: input.deposit_amount > 0 ? "held" : "not_taken" })
    .eq("tenant_id", user.tenantId)
    .eq("id", input.booking_id);

  if (bookingError) return actionError(`Платежи записаны, но статус брони не обновился: ${bookingError.message}`);

  revalidatePath("/");
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
    role: formData.get("role"),
    active: formData.get("active")
  });
  if (!parsed.success) return actionError("Проверьте роль и статус.");
  const input = parsed.data;

  const { error } = await supabase
    .from("app_users")
    .update({ role: input.role, active: input.active === "true" })
    .eq("id", input.id)
    .eq("tenant_id", user.tenantId);

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }
  revalidatePath("/settings");
  return actionOk("Роль и статус обновлены.");
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
  completed_date: z.string(),
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
    completed_date: formData.get("completed_date"),
    mileage_at_service: formData.get("mileage_at_service") || undefined,
    cost: formData.get("cost"),
    paid_to: formData.get("paid_to"),
    work_description: formData.get("work_description")
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Проверьте поля ТО/ремонта.");
  }
  const input = parsed.data;

  const { data: vehicle } = await supabase.from("vehicles").select("id").eq("tenant_id", user.tenantId).eq("id", input.vehicle_id).maybeSingle();
  if (!vehicle) {
    console.error("Vehicle was not found in the current tenant.");
    return actionError("Автомобиль не найден в текущей компании.");
  }

  const { error } = await supabase.from("maintenance_log").insert({
    tenant_id: user.tenantId,
    vehicle_id: input.vehicle_id,
    type: input.type,
    is_routine: input.type === "scheduled_service" || input.type === "oil_change" || input.type === "wash",
    completed_date: input.completed_date,
    mileage_at_service: input.mileage_at_service ?? null,
    cost: input.cost,
    cost_breakdown: { parts: 0, labor: input.cost, diagnostics: 0 },
    paid_to: input.paid_to || null,
    work_description: input.work_description || null,
    status: "completed"
  });

  if (error) {
    console.error(error.message);
    return actionError(error.message);
  }

  revalidatePath("/");
  revalidatePath("/maintenance");
  revalidatePath(`/fleet/${input.vehicle_id}`);
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
  revalidatePath("/documents");
  revalidatePath(`/bookings/${input.booking_id}`);
  if (booking.customer_id) revalidatePath(`/customers/${booking.customer_id}`);
  return actionOk("Файл загружен и привязан к брони.");
}

const customerMessageSchema = z.object({
  customer_id: z.string().uuid(),
  channel: z.enum(["whatsapp", "telegram"]),
  message_text: z.string().min(1).max(4000)
});

const leadMessageSchema = z.object({
  lead_id: z.string().uuid(),
  channel: z.enum(["whatsapp", "telegram"]),
  message_text: z.string().min(1).max(4000)
});

function messagingEndpoint(channel: "whatsapp" | "telegram") {
  if (channel === "whatsapp") {
    return process.env.WHATSAPP_SEND_URL || "https://n8nx.pro/epicenter-messaging/whatsapp/send";
  }

  return process.env.TELEGRAM_SEND_URL || "https://n8nx.pro/epicenter-messaging/telegram/send";
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
    message_text: formData.get("message_text")
  });
  if (!parsed.success) return actionError("Проверьте канал и текст сообщения.");
  const input = parsed.data;

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, tenant_id, full_name, phone, whatsapp, telegram_username, language_pref")
    .eq("id", input.customer_id)
    .eq("tenant_id", currentUser.tenantId)
    .maybeSingle();

  if (customerError || !customer) {
    console.error(customerError?.message ?? "Customer not found.");
    return actionError(customerError?.message ?? "Клиент не найден.");
  }

  const payload =
    input.channel === "whatsapp"
      ? {
          phoneNumber: customer.whatsapp || customer.phone,
          messageText: input.message_text
        }
      : {
          TelegramUsername: customer.telegram_username,
          messageText: input.message_text
        };

  const recipient = input.channel === "whatsapp" ? payload.phoneNumber : payload.TelegramUsername;
  if (!recipient) {
    console.error(`Customer has no ${input.channel} recipient.`);
    return actionError(`У клиента нет контакта для ${input.channel}.`);
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

  await supabase.from("conversation_messages").insert({
    tenant_id: customer.tenant_id,
    customer_id: customer.id,
    channel: input.channel,
    direction: "outbound",
    sender_type: "operator",
    sender_name: currentUser.fullName,
    sender_user_id: currentUser.authUserId,
    contact_handle: recipient,
    message_text: input.message_text,
    message_type: "text",
    status: "sent",
    raw_payload: {
      gateway: messagingEndpoint(input.channel),
      recipient
    },
    occurred_at: new Date().toISOString()
  });

  await supabase.from("notifications").insert({
    tenant_id: customer.tenant_id,
    notification_type: "customer_message_sent",
    customer_id: customer.id,
    related_entity_type: "customer",
    related_entity_id: customer.id,
    channel: input.channel === "whatsapp" ? "whatsapp" : "telegram",
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
    message_text: formData.get("message_text")
  });
  if (!parsed.success) return actionError("Проверьте канал и текст сообщения.");
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
  const { data: lastContact } = await supabase
    .from("conversation_messages")
    .select("contact_handle")
    .eq("tenant_id", currentUser.tenantId)
    .eq("lead_id", input.lead_id)
    .eq("channel", input.channel)
    .not("contact_handle", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const recipient =
    input.channel === "whatsapp"
      ? anonymous.phone || anonymous.whatsapp || anonymous.contact || anonymous.contact_handle || lastContact?.contact_handle
      : anonymous.telegram_username || anonymous.telegram || anonymous.contact || anonymous.contact_handle || lastContact?.contact_handle;

  if (!recipient) {
    console.error(`Lead has no ${input.channel} recipient.`);
    return actionError(`У лида нет контакта для ${input.channel}.`);
  }

  const payload =
    input.channel === "whatsapp"
      ? {
          phoneNumber: recipient,
          messageText: input.message_text
        }
      : {
          TelegramUsername: recipient,
          messageText: input.message_text
        };

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

  await supabase.from("conversation_messages").insert({
    tenant_id: lead.tenant_id,
    customer_id: lead.customer_id,
    lead_id: lead.id,
    channel: input.channel,
    direction: "outbound",
    sender_type: "operator",
    sender_name: currentUser.fullName,
    sender_user_id: currentUser.authUserId,
    contact_handle: recipient,
    message_text: input.message_text,
    message_type: "text",
    status: "sent",
    raw_payload: {
      gateway: messagingEndpoint(input.channel),
      recipient
    },
    occurred_at: new Date().toISOString()
  });

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
  idp_expires: z.string().optional(),
  notes_internal: z.string().optional()
});

export async function updateCustomerAction(formData: FormData): Promise<ActionResult> {
  const supabase = requireSupabase();
  if (!supabase) return actionError("Supabase не настроен.");
  const user = await requireRole(["owner", "manager", "operator", "marketer"]);
  if (!user) return actionError("Недостаточно прав для редактирования клиента.");

  const parsed = customerUpdateSchema.safeParse({
    id: formData.get("id"),
    full_name: formData.get("full_name"),
    full_name_passport: formData.get("full_name_passport"),
    phone: formData.get("phone"),
    whatsapp: formData.get("whatsapp"),
    telegram_username: formData.get("telegram_username"),
    email: formData.get("email"),
    nationality: formData.get("nationality"),
    language_pref: formData.get("language_pref") || "ru",
    source: formData.get("source") || "whatsapp",
    source_detail: formData.get("source_detail"),
    passport_number: formData.get("passport_number"),
    passport_expires: formData.get("passport_expires"),
    idp_number: formData.get("idp_number"),
    idp_expires: formData.get("idp_expires"),
    notes_internal: formData.get("notes_internal")
  });
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Проверьте данные клиента.");
  const input = parsed.data;

  const hasValidIdp = Boolean(input.idp_number && input.idp_expires && new Date(input.idp_expires) > new Date());

  const { error } = await supabase.from("customers").update({
    full_name: input.full_name,
    full_name_passport: input.full_name_passport || null,
    phone: input.phone || null,
    whatsapp: input.whatsapp || input.phone || null,
    telegram_username: input.telegram_username || null,
    email: input.email || null,
    nationality: input.nationality || null,
    language_pref: input.language_pref,
    source: normalizeSourceForDb(input.source),
    source_detail: input.source_detail || null,
    passport_number: input.passport_number || null,
    passport_expires: input.passport_expires || null,
    idp_number: input.idp_number || null,
    idp_expires: input.idp_expires || null,
    has_valid_idp: hasValidIdp,
    notes_internal: input.notes_internal || null
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
