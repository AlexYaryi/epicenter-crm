import { unstable_noStore as noStore } from "next/cache";
import { demoDashboard } from "./demo-data";
import { calculateBookingFinancialStatus } from "./payment-status";
import { createCookieSupabaseClient } from "./supabase-server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "./supabase";
import type { DashboardData } from "./types";
import type { AppUser, BookingDetail, ConversationMessage } from "./types";
import type { Role } from "./types";

function looksLikeEncodedPayload(value: string) {
  const compact = value.trim();
  if (compact.length < 250) return false;
  if (compact.includes(" ")) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

function readableMessageText(value: string | null | undefined, messageType?: string | null) {
  const text = String(value ?? "").trim();
  if (!looksLikeEncodedPayload(text)) return text;
  const type = messageType && messageType !== "text" ? messageType : "media";
  return `[${type}]`;
}

function displayCustomerName(customer: {
  full_name?: string | null;
  full_name_passport?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  telegram_username?: string | null;
} | null | undefined, fallback = "Клиент не найден") {
  const values = [
    customer?.full_name,
    customer?.full_name_passport,
    customer?.phone,
    customer?.whatsapp,
    customer?.telegram_username
  ];
  return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? fallback;
}

function displayVehicleName(vehicle: {
  make?: string | null;
  model?: string | null;
  license_plate?: string | null;
} | null | undefined, fallback = "Авто не найдено") {
  if (!vehicle) return fallback;
  const modelName = [vehicle.make, vehicle.model].map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  const plate = String(vehicle.license_plate ?? "").trim();
  if (modelName && plate) return `${modelName} · ${plate}`;
  return modelName || plate || fallback;
}

function displayBookingNumber(booking: { booking_number?: string | null; id?: string | null }) {
  const number = String(booking.booking_number ?? "").trim();
  if (number) return number;
  const shortId = String(booking.id ?? "").slice(0, 8);
  return shortId ? `Бронь ${shortId}` : "Бронь";
}

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) return Date.UTC(Number(dotMatch[3]), Number(dotMatch[2]) - 1, Number(dotMatch[1]));
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function hasValidDrivingPermit(customer: {
  has_valid_idp?: boolean | null;
  idp_number?: string | null;
  idp_expires?: string | null;
} | null | undefined) {
  if (customer?.has_valid_idp) return true;
  if (!customer?.idp_number?.trim()) return false;
  const expiresAt = parseDateOnly(customer.idp_expires);
  if (!expiresAt) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiresAt >= today;
}

function mapMessage(msg: any): ConversationMessage {
  if (!msg) return msg;

  let mediaUrl = msg.media_url;
  const isImageBase64 = msg.message_type === "image" && !mediaUrl && msg.message_text && looksLikeEncodedPayload(msg.message_text);
  if (isImageBase64) {
    const rawText = msg.message_text.trim();
    mediaUrl = rawText.startsWith("data:") ? rawText : `data:image/jpeg;base64,${rawText}`;
  }

  const isVideoBase64 = msg.message_type === "video" && !mediaUrl && msg.message_text && looksLikeEncodedPayload(msg.message_text);
  if (isVideoBase64) {
    const rawText = msg.message_text.trim();
    mediaUrl = rawText.startsWith("data:") ? rawText : `data:video/mp4;base64,${rawText}`;
  }

  return {
    id: msg.id,
    customer_id: msg.customer_id,
    lead_id: msg.lead_id,
    channel: msg.raw_payload?.original_channel || msg.channel,
    direction: msg.direction,
    sender_type: msg.sender_type,
    sender_name: msg.sender_name,
    contact_handle: msg.contact_handle,
    message_text: readableMessageText(msg.message_text, msg.message_type),
    message_type: msg.message_type,
    status: msg.status,
    occurred_at: msg.occurred_at,
    media_url: mediaUrl,
    raw_payload: msg.raw_payload
  };
}

function expandContactHandles(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  const handles = new Set<string>([raw]);
  const lidMatch = raw.match(/(?:whatsapp\s+lid|lid)\s*:\s*([^|\s]+)/i);
  if (lidMatch?.[1]) {
    handles.add(lidMatch[1].trim());
  }

  const compact = raw.replace(/[^\d+]/g, "");
  const withoutPlus = compact.replace(/^\+/, "");
  if (compact) handles.add(compact);
  if (withoutPlus) {
    handles.add(withoutPlus);
    handles.add(`${withoutPlus}@s.whatsapp.net`);
  }

  return Array.from(handles).filter(Boolean);
}

function readInspectionMileage(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value) && "inspection_mileage" in value) {
    const mileage = Number((value as { inspection_mileage?: unknown }).inspection_mileage);
    return Number.isFinite(mileage) ? mileage : null;
  }

  if (value !== null && value !== undefined && typeof value !== "object") {
    const mileage = Number(value);
    return Number.isFinite(mileage) ? mileage : null;
  }

  return null;
}

export type CurrentUserContext = {
  appUserId: string | null;
  authUserId: string | null;
  email: string | null;
  fullName: string;
  role: Role;
  tenantId: string;
  isAuthenticated: boolean;
  supabaseConfigured: boolean;
  avatarUrl: string | null;
};

export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  noStore();
  const fallback: CurrentUserContext = {
    appUserId: null,
    authUserId: null,
    email: null,
    fullName: "Demo owner",
    role: "owner",
    tenantId: "00000000-0000-0000-0000-000000000001",
    isAuthenticated: false,
    supabaseConfigured: hasSupabaseEnv(),
    avatarUrl: null
  };

  if (!hasSupabaseEnv()) {
    return fallback;
  }

  const authClient = await createCookieSupabaseClient();
  const { data: userData, error: userError } = await authClient.auth.getUser();

  if (userError || !userData.user) {
    return fallback;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ...fallback,
      authUserId: userData.user.id,
      email: userData.user.email ?? null,
      isAuthenticated: true,
      supabaseConfigured: true,
      avatarUrl: null
    };
  }

  const serviceClient = createServiceSupabaseClient();
  const { data: appUser, error: appUserError } = await serviceClient
    .from("app_users")
    .select("id, tenant_id, full_name, role, avatar_url")
    .eq("auth_user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (appUserError) {
    return {
      ...fallback,
      authUserId: userData.user.id,
      email: userData.user.email ?? null,
      fullName: userData.user.email ?? "Authenticated user",
      role: "operator",
      isAuthenticated: true,
      supabaseConfigured: true,
      avatarUrl: null
    };
  }

  return {
    appUserId: appUser?.id ?? null,
    authUserId: userData.user.id,
    email: userData.user.email ?? null,
    fullName: appUser?.full_name ?? userData.user.email ?? "Authenticated user",
    role: (appUser?.role ?? "operator") as Role,
    tenantId: appUser?.tenant_id ?? fallback.tenantId,
    isAuthenticated: true,
    supabaseConfigured: true,
    avatarUrl: appUser?.avatar_url ?? null
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return demoDashboard;
  }

  const currentUser = await getCurrentUserContext();
  if (currentUser.supabaseConfigured && !currentUser.isAuthenticated) {
    return demoDashboard;
  }

  const supabase = createServiceSupabaseClient();
  const tenantId = currentUser.tenantId;

  const [vehiclesResult, leadsResult, bookingsResult, maintenanceResult, recommendationsResult, customersResult, locationsResult, priceRulesResult, insuranceResult, partnersResult, paymentsResult] = await Promise.all([
    supabase.from("vehicles").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
    supabase.from("leads").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(800),
    supabase.from("bookings").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1500),
    supabase
      .from("maintenance_log")
      .select("id, vehicle_id, type, status, vehicle_unavailable_from, vehicle_unavailable_to")
      .eq("tenant_id", tenantId)
      .in("status", ["scheduled", "in_progress"])
      .limit(1000),
    supabase.from("fleet_recommendations").select("*").eq("tenant_id", tenantId).order("generated_at", { ascending: false }).limit(20),
    supabase
      .from("customers")
      .select("id, full_name, full_name_passport, phone, whatsapp, telegram_username, source, source_detail, passport_number, passport_expires, passport_photo_url, driver_license_number, driver_license_country, driver_license_photo_url, idp_number, idp_expires, idp_photo_url, language_pref, has_valid_idp, referral_partner_id, promo_code_used, lifetime_value_thb, total_bookings_count, last_booking_date, tags")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(3000),
    supabase.from("locations").select("id, name, city, country_code").eq("tenant_id", tenantId).order("name", { ascending: true }).limit(50),
    supabase
      .from("vehicle_price_rules")
      .select("id, vehicle_id, season, season_months, duration_bucket, min_days, max_days, daily_rate_thb, monthly_rate_thb, active")
      .eq("tenant_id", tenantId)
      .order("season", { ascending: true })
      .order("min_days", { ascending: true }),
    supabase
      .from("insurance")
      .select("id, vehicle_id, type, provider, policy_number, start_date, end_date, premium_amount, deductible")
      .eq("tenant_id", tenantId)
      .order("end_date", { ascending: false }),
    supabase.from("partners").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000),
    supabase.from("payments").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000)
  ]);

  if (vehiclesResult.error || leadsResult.error || bookingsResult.error || recommendationsResult.error || customersResult.error || locationsResult.error) {
    return demoDashboard;
  }

  const customersById = new Map((customersResult.data ?? []).map((customer) => [customer.id, customer]));
  const locationsById = new Map((locationsResult.data ?? []).map((loc) => [loc.id, loc]));
  const vehiclesById = new Map((vehiclesResult.data ?? []).map((vehicle) => [vehicle.id, vehicle]));
  const derivedVehicleStatuses = new Map<string, "reserved" | "in_use">();
  const today = new Date().toISOString().slice(0, 10);
  const activeRentalStatuses = ["handed_over", "active", "in_use", "returning"];
  const reservedBookingStatuses = ["confirmed", "paid_deposit"];
  for (const booking of bookingsResult.data ?? []) {
    const effectiveEndDate = String(booking.actual_end ?? booking.end_date).slice(0, 10);
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    if (
      (activeRentalStatuses.includes(bookingStatus) || activeRentalStatuses.includes(rentalStatus)) &&
      effectiveEndDate >= today
    ) {
      derivedVehicleStatuses.set(booking.vehicle_id, "in_use");
      continue;
    }
    if (
      !derivedVehicleStatuses.has(booking.vehicle_id) &&
      !activeRentalStatuses.includes(rentalStatus) &&
      reservedBookingStatuses.includes(bookingStatus) &&
      effectiveEndDate >= today
    ) {
      derivedVehicleStatuses.set(booking.vehicle_id, "reserved");
    }
  }

  const priceRulesByVehicle = new Map<string, NonNullable<typeof priceRulesResult.data>>();
  if (!priceRulesResult.error) {
    for (const rule of priceRulesResult.data ?? []) {
      const current = priceRulesByVehicle.get(rule.vehicle_id) ?? [];
      current.push(rule);
      priceRulesByVehicle.set(rule.vehicle_id, current);
    }
  }

  const insuranceByVehicle = new Map<string, NonNullable<typeof insuranceResult.data>[number]>();
  if (!insuranceResult.error) {
    for (const insurance of insuranceResult.data ?? []) {
      if (!insuranceByVehicle.has(insurance.vehicle_id)) {
        insuranceByVehicle.set(insurance.vehicle_id, insurance);
      }
    }
  }

  const latestLeadAction = (notes: unknown): { nextAction: string; reminderAt: string } => {
    if (!Array.isArray(notes)) {
      return { nextAction: "", reminderAt: "" };
    }

    const actionNotes = notes
      .filter((note): note is Record<string, unknown> => Boolean(note) && typeof note === "object")
      .filter((note) => note.type === "next_action" || typeof note.text === "string")
      .sort((left, right) => String(right.at ?? "").localeCompare(String(left.at ?? "")));
    const latest = actionNotes[0];
    return {
      nextAction: typeof latest?.text === "string" ? latest.text : "",
      reminderAt: typeof latest?.reminder_at === "string" ? latest.reminder_at : ""
    };
  };

  return {
    vehicles: vehiclesResult.data.map((vehicle) => {
      const activeInsurance = (insuranceResult.data ?? []).find(ins => ins.id === vehicle.insurance_id)
        || (insuranceResult.data ?? []).find(ins => ins.vehicle_id === vehicle.id);
      return {
        id: vehicle.id,
        license_plate: vehicle.license_plate,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        category: vehicle.category,
        status: ["maintenance", "repair", "retired"].includes(vehicle.status) ? vehicle.status : derivedVehicleStatuses.get(vehicle.id) ?? vehicle.status,
        location: (vehicle.location_id ? locationsById.get(vehicle.location_id)?.name : null) ?? "Phuket",
        location_id: vehicle.location_id,
        vin: vehicle.vin ?? null,
        color: vehicle.color ?? null,
        body_type: vehicle.body_type,
        fuel_type: vehicle.fuel_type,
        transmission: vehicle.transmission,
        seats: Number(vehicle.seats ?? 5),
        mileage_current: Number(vehicle.mileage_current ?? 0),
        ownership_type: vehicle.ownership_type ?? "own",
        photos: Array.isArray(vehicle.photos) ? vehicle.photos : [],
        notes_internal: vehicle.notes_internal ?? null,
        daily_rate_short_term: Number(vehicle.daily_rate_short_term ?? 0),
        daily_rate_long_term: Number(vehicle.daily_rate_long_term ?? 0),
        monthly_rate: Number(vehicle.monthly_rate ?? 0),
        deposit_amount: Number(vehicle.deposit_amount ?? 0),
        public_visible: vehicle.public_visible !== false,
        public_sort_order: Number(vehicle.public_sort_order ?? 100),
        public_description_ru: vehicle.public_description_ru ?? null,
        public_description_en: vehicle.public_description_en ?? null,
        public_features: Array.isArray(vehicle.public_features) ? vehicle.public_features : [],
        acquisition_cost_thb: Number(vehicle.acquisition_cost_thb ?? 0),
        acquisition_date: vehicle.acquisition_date ?? "",
        status_financial: vehicle.status_financial,
        performance_band: vehicle.performance_band ?? "LOWER_MID",
        payback_pct: 0,
        revpad: 0,
        utilization_90: 0,
        insurance_provider: activeInsurance?.provider ?? "",
        insurance_phone: activeInsurance?.provider?.split(" | ")[1] ?? "",
        insurance_expires_at: activeInsurance?.end_date ?? vehicle.inspection_expires_at ?? "",
        insurance_type: activeInsurance?.type ?? "1st_class",
        insurance_policy_number: activeInsurance?.policy_number ?? "",
        insurance_start_date: activeInsurance?.start_date ?? "",
        insurance_premium_amount: Number(activeInsurance?.premium_amount ?? 0),
        insurance_deductible: Number(activeInsurance?.deductible ?? 0),
        inspection_expires_at: vehicle.inspection_expires_at ?? "",
        inspection_mileage: readInspectionMileage(vehicle.depreciation_schedule),
        road_tax_amount_thb: Number(vehicle.road_tax_amount_thb ?? 0),
        road_tax_due_date: vehicle.road_tax_due_date ?? "",
        price_rules: (priceRulesByVehicle.get(vehicle.id) ?? []).map((rule) => ({
        id: rule.id,
        season: rule.season,
        season_months: Array.isArray(rule.season_months) ? rule.season_months : [],
        duration_bucket: rule.duration_bucket,
        min_days: Number(rule.min_days ?? 0),
        max_days: Number(rule.max_days ?? 0),
        daily_rate_thb: rule.daily_rate_thb == null ? null : Number(rule.daily_rate_thb),
        monthly_rate_thb: rule.monthly_rate_thb == null ? null : Number(rule.monthly_rate_thb),
        active: rule.active !== false
      }))
      };
    }),
    leads: leadsResult.data.map((lead) => {
      const linkedCustomer = lead.customer_id ? customersById.get(lead.customer_id) : null;
      const action = latestLeadAction(lead.notes);
      return {
        id: lead.id,
        customer_id: lead.customer_id ?? null,
        customer_name: linkedCustomer?.full_name ?? lead.anonymous_data?.name ?? "Новый клиент",
        phone: lead.anonymous_data?.phone ?? null,
        telegram_username: lead.anonymous_data?.telegram_username ?? lead.anonymous_data?.telegram ?? null,
        contact_handle: lead.anonymous_data?.contact ?? lead.anonymous_data?.contact_handle ?? null,
        channel: lead.source,
        source_detail: lead.source_detail ?? lead.anonymous_data?.source_detail ?? null,
        stage: (() => {
          const notes = Array.isArray(lead.notes) ? lead.notes : [];
          const hasNotLeadFlag = notes.some((n: any) => n && n.type === "status_flag" && n.value === "not_lead");
          return hasNotLeadFlag || lead.status === "not_lead" ? "not_lead" : lead.status;
        })(),
        score: lead.score ?? 0,
        first_response_minutes: lead.first_response_time_minutes ?? 0,
        next_action: action.nextAction,
        reminder_at: action.reminderAt || "",
        category: lead.inquiry_vehicle_category ?? "unknown",
        tags: Array.isArray(lead.tags) ? lead.tags : [],
        note: readableMessageText(lead.inquiry_text, "text")
      };
    }),
    bookings: bookingsResult.data.map((booking) => ({
      id: booking.id,
      booking_number: displayBookingNumber(booking),
      lead_id: booking.lead_id ?? null,
      customer_id: booking.customer_id,
      customer_name: displayCustomerName(customersById.get(booking.customer_id)),
      vehicle_id: booking.vehicle_id,
      vehicle: displayVehicleName(vehiclesById.get(booking.vehicle_id)),
      status: booking.status,
      rental_status: booking.rental_status ?? "not_started",
      start_date: booking.start_date,
      end_date: booking.end_date,
      actual_end: booking.actual_end ?? null,
      rental_amount: Number(booking.total_rental_amount ?? 0),
      deposit_amount: Number(booking.deposit_amount ?? 0),
      pickup_fee: Number(booking.delivery_fee ?? 0),
      delivery_fee: Number(booking.delivery_fee ?? 0),
      grand_total: Number(booking.grand_total ?? 0),
      payment_status: booking.payment_status ?? null,
      deposit_status: booking.deposit_status ?? null,
      return_photos: Array.isArray(booking.return_photos) ? booking.return_photos : [],
      return_checklist: booking.return_checklist ?? null,
      idp_ok: hasValidDrivingPermit(customersById.get(booking.customer_id)),
      contract_pdf_url: booking.contract_pdf_url ?? null
    })),
    maintenance: maintenanceResult.error
      ? []
      : (maintenanceResult.data ?? []).map((item) => ({
          id: item.id,
          vehicle_id: item.vehicle_id,
          type: item.type ?? null,
          status: item.status,
          vehicle_unavailable_from: item.vehicle_unavailable_from ?? null,
          vehicle_unavailable_to: item.vehicle_unavailable_to ?? null
        })),
    recommendations: recommendationsResult.data.map((recommendation) => ({
      id: recommendation.id,
      type: recommendation.recommendation_type,
      vehicle: recommendation.vehicle_id ?? "Fleet",
      confidence: recommendation.confidence_score,
      reasoning: recommendation.reasoning,
      impact_thb: Number(recommendation.estimated_impact_thb ?? 0)
    })),
    customers: customersResult.data.map((customer) => ({
      id: customer.id,
      full_name: customer.full_name,
      full_name_passport: customer.full_name_passport,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      telegram_username: customer.telegram_username,
      source: customer.source ?? null,
      source_detail: customer.source_detail,
      passport_number: customer.passport_number,
      passport_expires: customer.passport_expires,
      passport_photo_url: customer.passport_photo_url,
      driver_license_number: customer.driver_license_number,
      driver_license_country: customer.driver_license_country,
      driver_license_photo_url: customer.driver_license_photo_url,
      idp_number: customer.idp_number,
      idp_expires: customer.idp_expires,
      idp_photo_url: customer.idp_photo_url,
      language_pref: customer.language_pref,
      has_valid_idp: customer.has_valid_idp,
      referral_partner_id: customer.referral_partner_id,
      promo_code_used: customer.promo_code_used,
      lifetime_value_thb: Number(customer.lifetime_value_thb ?? 0),
      total_bookings_count: Number(customer.total_bookings_count ?? 0),
      last_booking_date: customer.last_booking_date,
      tags: Array.isArray(customer.tags) ? customer.tags : []
    })),
    locations: locationsResult.data.map((location) => ({
      id: location.id,
      name: location.name,
      city: location.city,
      country_code: location.country_code
    })),
    partners: (partnersResult?.data ?? []).map((partner: any) => ({
      id: partner.id,
      tenant_id: partner.tenant_id,
      name: partner.name,
      contact: partner.contact,
      telegram: partner.telegram,
      whatsapp: partner.whatsapp,
      promo_code: partner.promo_code,
      commission_thb_per_booking: Number(partner.commission_thb_per_booking ?? 0),
      active: partner.active !== false,
      total_referrals: Number(partner.total_referrals ?? 0),
      total_commission_paid: Number(partner.total_commission_paid ?? 0),
      last_referral_date: partner.last_referral_date,
      created_at: partner.created_at
    })),
    payments: paymentsResult?.data ?? []
  };
}

export type LaunchReadinessIssue = {
  id: string;
  severity: "critical" | "warning";
  type: string;
  title: string;
  detail: string;
  href: string;
};

export type LaunchReadinessData = {
  generatedAt: string;
  critical: LaunchReadinessIssue[];
  warnings: LaunchReadinessIssue[];
  operationalAgenda: {
    id: string;
    date: string;
    kind: "handover" | "return" | "maintenance";
    title: string;
    detail: string;
    href: string;
  }[];
  integrations: {
    id: string;
    label: string;
    status: "ok" | "warning" | "critical";
    detail: string;
  }[];
  counts: {
    vehicles: number;
    bookings: number;
    maintenance: number;
    activeUsers: number;
    integrationsOk: number;
    integrationsWarnings: number;
    integrationsCritical: number;
    financeWarnings: number;
    documentWarnings: number;
    returnWarnings: number;
    insuranceWarnings: number;
    taxWarnings: number;
    statusWarnings: number;
    customerWarnings: number;
    leadWarnings: number;
    messageWarnings: number;
    taskWarnings: number;
    publicCatalogWarnings: number;
    critical: number;
    warnings: number;
  };
  activeRoles: Record<string, number>;
};

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function addDaysKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function blocksVehicle(booking: { status?: unknown; rental_status?: unknown }) {
  const bookingStatus = String(booking.status ?? "");
  const rentalStatus = String(booking.rental_status ?? "");
  return (
    ["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"].includes(bookingStatus) ||
    ["handed_over", "active", "in_use", "returning"].includes(rentalStatus)
  );
}

function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return Boolean(leftStart && leftEnd && rightStart && rightEnd && leftStart <= rightEnd && leftEnd >= rightStart);
}

function hasMediaItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function hasChecklistVideos(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const videos = (value as { videos?: unknown }).videos;
  return Array.isArray(videos) && videos.length > 0;
}

function normalizedPhoneKey(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : "";
}

function normalizedTextKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function latestLeadAction(notes: unknown) {
  const items = Array.isArray(notes) ? notes : [];
  const latest = items
    .filter((note: any) => note && (note.type === "next_action" || typeof note.text === "string"))
    .sort((left: any, right: any) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")))[0] as any;
  return {
    text: String(latest?.text ?? "").trim(),
    reminderAt: String(latest?.reminder_at ?? "").trim()
  };
}

export async function getLaunchReadinessData(): Promise<LaunchReadinessData> {
  noStore();

  const empty = {
    generatedAt: new Date().toISOString(),
    critical: [],
    warnings: [],
    operationalAgenda: [],
    integrations: [],
    counts: { vehicles: 0, bookings: 0, maintenance: 0, activeUsers: 0, integrationsOk: 0, integrationsWarnings: 0, integrationsCritical: 0, financeWarnings: 0, documentWarnings: 0, returnWarnings: 0, insuranceWarnings: 0, taxWarnings: 0, statusWarnings: 0, customerWarnings: 0, leadWarnings: 0, messageWarnings: 0, taskWarnings: 0, publicCatalogWarnings: 0, critical: 0, warnings: 0 },
    activeRoles: {}
  };

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return empty;
  }

  const currentUser = await getCurrentUserContext();
  if (currentUser.supabaseConfigured && !currentUser.isAuthenticated) {
    return empty;
  }

  const supabase = createServiceSupabaseClient();
  const tenantId = currentUser.tenantId;

  const [vehiclesResult, bookingsResult, maintenanceResult, customersResult, usersResult, paymentsResult, insuranceResult, leadsResult, messagesResult, tasksResult, priceRulesResult] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, make, model, license_plate, status, road_tax_due_date, inspection_expires_at, photos, daily_rate_long_term, monthly_rate, deposit_amount, public_visible, public_description_ru, public_description_en")
      .eq("tenant_id", tenantId)
      .limit(1000),
    supabase
      .from("bookings")
      .select("id, booking_number, customer_id, vehicle_id, status, rental_status, start_date, end_date, actual_end, grand_total, deposit_amount, payment_status, deposit_status, return_photos, return_checklist")
      .eq("tenant_id", tenantId)
      .limit(2500),
    supabase
      .from("maintenance_log")
      .select("id, vehicle_id, type, status, vehicle_unavailable_from, vehicle_unavailable_to")
      .eq("tenant_id", tenantId)
      .limit(2500),
    supabase
      .from("customers")
      .select("id, full_name, full_name_passport, phone, whatsapp, telegram_username, passport_number, passport_expires, passport_photo_url, driver_license_number, driver_license_photo_url, idp_number, idp_expires, idp_photo_url, has_valid_idp")
      .eq("tenant_id", tenantId)
      .limit(4000),
    supabase.from("app_users").select("id, tenant_id, full_name, role, active").eq("tenant_id", tenantId).limit(200),
    supabase.from("payments").select("id, booking_id, amount, type, status").eq("tenant_id", tenantId).limit(5000),
    supabase.from("insurance").select("id, vehicle_id, provider, policy_number, start_date, end_date").eq("tenant_id", tenantId).limit(2000),
    supabase.from("leads").select("id, customer_id, status, score, anonymous_data, notes, created_at").eq("tenant_id", tenantId).limit(1000),
    supabase
      .from("conversation_messages")
      .select("id, customer_id, lead_id, channel, direction, contact_handle, status, occurred_at")
      .eq("tenant_id", tenantId)
      .eq("direction", "inbound")
      .order("occurred_at", { ascending: false })
      .limit(500),
    supabase
      .from("crm_tasks")
      .select("id, title, status, priority, assigned_to, due_date")
      .eq("tenant_id", tenantId)
      .limit(1000),
    supabase
      .from("vehicle_price_rules")
      .select("id, vehicle_id, active, daily_rate_thb, monthly_rate_thb")
      .eq("tenant_id", tenantId)
      .limit(5000)
  ]);

  const vehicles = vehiclesResult.data ?? [];
  const bookings = bookingsResult.data ?? [];
  const maintenance = maintenanceResult.data ?? [];
  const customers = customersResult.data ?? [];
  const users = usersResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const insurancePolicies = insuranceResult.data ?? [];
  const leads = leadsResult.data ?? [];
  const messages = messagesResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  const priceRules = priceRulesResult.data ?? [];
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const critical: LaunchReadinessIssue[] = [];
  const warnings: LaunchReadinessIssue[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDaysKey(today, 1);
  const integrations: LaunchReadinessData["integrations"] = [];
  const envPresent = (key: string) => Boolean(String(process.env[key] ?? "").trim());
  const addIntegration = (id: string, label: string, ok: boolean, detail: string, missingIsCritical = true) => {
    integrations.push({
      id,
      label,
      status: ok ? "ok" : missingIsCritical ? "critical" : "warning",
      detail
    });
  };

  addIntegration("supabase_url", "Supabase URL", envPresent("NEXT_PUBLIC_SUPABASE_URL"), envPresent("NEXT_PUBLIC_SUPABASE_URL") ? "configured" : "missing");
  addIntegration("supabase_anon", "Supabase anon key", envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY"), envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY") ? "configured" : "missing");
  addIntegration("supabase_service", "Supabase service role", envPresent("SUPABASE_SERVICE_ROLE_KEY"), envPresent("SUPABASE_SERVICE_ROLE_KEY") ? "configured" : "missing");
  addIntegration("lead_secret", "Lead webhook secret", envPresent("LEAD_WEBHOOK_SECRET"), envPresent("LEAD_WEBHOOK_SECRET") ? "configured" : "missing");
  addIntegration("messaging_secret", "Messaging webhook secret", envPresent("EPICENTER_MESSAGING_SECRET"), envPresent("EPICENTER_MESSAGING_SECRET") ? "configured" : "missing");
  addIntegration("ntfy", "Push notifications", envPresent("NTFY_TOPIC"), envPresent("NTFY_TOPIC") ? "topic configured" : "NTFY_TOPIC missing", false);
  addIntegration("public_whatsapp", "Public WhatsApp phone", envPresent("NEXT_PUBLIC_WHATSAPP_PHONE"), envPresent("NEXT_PUBLIC_WHATSAPP_PHONE") ? "configured" : "missing", false);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch("https://n8nx.pro/epicenter-wa/health", {
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timeout);
    const health = await response.json().catch(() => null);
    const connected = Boolean(health?.up && health?.connected);
    integrations.push({
      id: "whatsapp_health",
      label: "WhatsApp gateway",
      status: connected ? "ok" : "warning",
      detail: connected ? `connected (${health?.status ?? "ok"})` : `health check returned ${response.status}`
    });
  } catch {
    integrations.push({
      id: "whatsapp_health",
      label: "WhatsApp gateway",
      status: "warning",
      detail: "health check timeout or unavailable"
    });
  }
  const activeRoles = users
    .filter((user) => user.active !== false)
    .reduce<Record<string, number>>((acc, user) => {
      const role = String(user.role ?? "missing");
      acc[role] = (acc[role] ?? 0) + 1;
      return acc;
    }, {});

  const vehicleName = (vehicleId: string | null | undefined) => {
    const vehicle = vehicleId ? vehiclesById.get(vehicleId) : null;
    return displayVehicleName(vehicle, "Авто не назначено");
  };
  const customerName = (customerId: string | null | undefined) => displayCustomerName(customerId ? customersById.get(customerId) : null);
  const bookingLabel = (booking: { id: string; booking_number?: string | null }) =>
    String(booking.booking_number ?? "").trim() || booking.id.slice(0, 8);

  const blockingBookings = bookings.filter((booking) => blocksVehicle(booking));
  const rentalIsActive = (booking: { status?: unknown; rental_status?: unknown }) => {
    const bookingStatus = String(booking.status ?? "");
    const rentalStatus = String(booking.rental_status ?? "");
    return (
      ["handed_over", "active", "in_use", "returning"].includes(bookingStatus) ||
      ["handed_over", "active", "in_use", "returning"].includes(rentalStatus)
    );
  };
  const upcomingEnd = addDaysKey(today, 7);
  const operationalAgenda = [
    ...blockingBookings
      .flatMap((booking) => {
        const start = dateOnly(booking.start_date);
        const end = dateOnly(booking.actual_end ?? booking.end_date);
        const items: LaunchReadinessData["operationalAgenda"] = [];
        if (start >= today && start <= upcomingEnd && ["confirmed", "paid_deposit"].includes(String(booking.status ?? ""))) {
          items.push({
            id: `handover-${booking.id}`,
            date: start,
            kind: "handover",
            title: `Выдача ${bookingLabel(booking)}`,
            detail: `${customerName(booking.customer_id)} · ${vehicleName(booking.vehicle_id)}`,
            href: `/bookings/${booking.id}`
          });
        }
        if (end >= today && end <= upcomingEnd && (rentalIsActive(booking) || String(booking.status ?? "") === "returning")) {
          items.push({
            id: `return-${booking.id}`,
            date: end,
            kind: "return",
            title: `Возврат ${bookingLabel(booking)}`,
            detail: `${customerName(booking.customer_id)} · ${vehicleName(booking.vehicle_id)}`,
            href: `/bookings/${booking.id}`
          });
        }
        return items;
      }),
    ...maintenance
      .filter((item) => ["scheduled", "in_progress"].includes(String(item.status ?? "")))
      .map((item): LaunchReadinessData["operationalAgenda"][number] | null => {
        const start = dateOnly(item.vehicle_unavailable_from);
        const end = dateOnly(item.vehicle_unavailable_to) || "9999-12-31";
        if (!start || start > upcomingEnd || end < today) return null;
        return {
          id: `maintenance-${item.id}`,
          date: start < today ? today : start,
          kind: "maintenance",
          title: String(item.status ?? "") === "in_progress" ? "Ремонт/ТО в работе" : "Плановый ремонт/ТО",
          detail: `${vehicleName(item.vehicle_id)} · ${start} - ${end === "9999-12-31" ? "без даты окончания" : end}`,
          href: item.vehicle_id ? `/fleet/${item.vehicle_id}` : "/maintenance"
        };
      })
      .filter((item): item is LaunchReadinessData["operationalAgenda"][number] => Boolean(item))
  ]
    .sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind))
    .slice(0, 25);
  const completedPaymentTotals = payments.reduce<Map<string, number>>((acc, payment) => {
    const bookingId = String(payment.booking_id ?? "");
    if (!bookingId || String(payment.status ?? "completed") !== "completed") return acc;
    acc.set(bookingId, (acc.get(bookingId) ?? 0) + Number(payment.amount ?? 0));
    return acc;
  }, new Map<string, number>());
  const completedRentalPaymentTotals = payments.reduce<Map<string, number>>((acc, payment) => {
    const bookingId = String(payment.booking_id ?? "");
    if (!bookingId || String(payment.status ?? "completed") !== "completed") return acc;
    const financial = calculateBookingFinancialStatus({ grand_total: 0, deposit_amount: 0 }, [payment]);
    if (financial.rentalPaid <= 0) return acc;
    acc.set(bookingId, (acc.get(bookingId) ?? 0) + financial.rentalPaid);
    return acc;
  }, new Map<string, number>());
  let financeWarnings = 0;
  let documentWarnings = 0;
  let returnWarnings = 0;
  let insuranceWarnings = 0;
  let taxWarnings = 0;
  let statusWarnings = 0;
  let customerWarnings = 0;
  let leadWarnings = 0;
  let messageWarnings = 0;
  let taskWarnings = 0;
  let publicCatalogWarnings = 0;
  const addFinanceWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    financeWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "finance_readiness"
    });
  };
  const addDocumentWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    documentWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "handover_documents"
    });
  };
  const addReturnWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    returnWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "return_readiness"
    });
  };
  const addInsuranceWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    insuranceWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "insurance_readiness"
    });
  };
  const addTaxWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    taxWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "tax_readiness"
    });
  };
  const addStatusWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    statusWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "vehicle_status_sync"
    });
  };
  const addCustomerWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    customerWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "customer_duplicates"
    });
  };
  const addLeadWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    leadWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "lead_readiness"
    });
  };
  const addMessageWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    messageWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "message_readiness"
    });
  };
  const addTaskWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    taskWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "task_readiness"
    });
  };
  const addPublicCatalogWarning = (issue: Omit<LaunchReadinessIssue, "severity" | "type">) => {
    publicCatalogWarnings += 1;
    warnings.push({
      ...issue,
      severity: "warning",
      type: "public_catalog"
    });
  };
  const activeInsuranceFor = (vehicleId: string | null | undefined, start: string, end: string) => {
    if (!vehicleId || !start || !end) return null;
    return insurancePolicies.find((policy) => {
      const policyStart = dateOnly(policy.start_date);
      const policyEnd = dateOnly(policy.end_date);
      return policy.vehicle_id === vehicleId && policyStart && policyEnd && policyStart <= start && policyEnd >= end;
    }) ?? null;
  };

  for (const integration of integrations) {
    if (integration.status === "critical") {
      critical.push({
        id: `integration-${integration.id}`,
        severity: "critical",
        type: "integration",
        title: `${integration.label}: ${integration.detail}`,
        detail: "Проверьте переменные окружения на VPS перед запуском CRM.",
        href: "/settings"
      });
    }
    if (integration.status === "warning") {
      warnings.push({
        id: `integration-${integration.id}`,
        severity: "warning",
        type: "integration",
        title: `${integration.label}: ${integration.detail}`,
        detail: "Интеграция не блокирует учет аренды, но ее нужно проверить перед полноценной работой.",
        href: "/launch"
      });
    }
  }

  if (!activeRoles.owner) {
    critical.push({
      id: "access-no-owner",
      severity: "critical",
      type: "access_owner",
      title: "Нет активного owner",
      detail: "Нужен хотя бы один owner для пользователей, паролей, override IDP и критических настроек.",
      href: "/settings"
    });
  }
  if (!activeRoles.manager && !activeRoles.operator) {
    critical.push({
      id: "access-no-operations",
      severity: "critical",
      type: "access_operations",
      title: "Нет активного manager/operator",
      detail: "Нужен manager или operator для создания броней, выдачи и возврата автомобилей.",
      href: "/settings"
    });
  }
  for (const appUser of users) {
    if (!appUser.role || !appUser.tenant_id) {
      warnings.push({
        id: `access-user-${appUser.id}`,
        severity: "warning",
        type: "access_user_profile",
        title: "Профиль пользователя заполнен не полностью",
        detail: `${appUser.full_name ?? appUser.id}: role=${appUser.role ?? "missing"}, tenant=${appUser.tenant_id ? "ok" : "missing"}`,
        href: "/settings"
      });
    }
  }

  const duplicateGroups = new Map<string, typeof customers>();
  const addDuplicateKey = (key: string, customer: typeof customers[number]) => {
    if (!key) return;
    const group = duplicateGroups.get(key) ?? [];
    group.push(customer);
    duplicateGroups.set(key, group);
  };
  for (const customer of customers) {
    addDuplicateKey(`phone:${normalizedPhoneKey(customer.phone)}`, customer);
    addDuplicateKey(`whatsapp:${normalizedPhoneKey(customer.whatsapp)}`, customer);
    addDuplicateKey(`telegram:${normalizedTextKey(customer.telegram_username)}`, customer);
    addDuplicateKey(`passport:${normalizedTextKey(customer.passport_number)}`, customer);
  }
  for (const [key, group] of duplicateGroups) {
    if (group.length < 2) continue;
    const [kind] = key.split(":");
    const names = group
      .slice(0, 4)
      .map((customer) => displayCustomerName(customer, customer.id.slice(0, 8)))
      .join(" / ");
    addCustomerWarning({
      id: `customer-duplicate-${kind}-${group.map((customer) => customer.id.slice(0, 8)).join("-")}`,
      title: `Возможный дубль клиентов по ${kind}`,
      detail: `${group.length} карточки: ${names}`,
      href: `/customers/${group[0].id}`
    });
  }

  const openLeadStatuses = new Set(["new", "contacted", "qualified", "quoted", "negotiating"]);
  for (const lead of leads) {
    const status = String(lead.status ?? "new");
    if (!openLeadStatuses.has(status)) continue;
    const anonymous = (lead.anonymous_data && typeof lead.anonymous_data === "object" ? lead.anonymous_data : {}) as Record<string, unknown>;
    const hasContact = Boolean(
      lead.customer_id ||
      normalizedPhoneKey(anonymous.phone) ||
      normalizedPhoneKey(anonymous.whatsapp) ||
      normalizedTextKey(anonymous.telegram_username) ||
      normalizedTextKey(anonymous.telegram) ||
      normalizedTextKey(anonymous.contact) ||
      normalizedTextKey(anonymous.contact_handle)
    );
    const action = latestLeadAction(lead.notes);
    const leadLabel = lead.id.slice(0, 8);
    if (!hasContact) {
      addLeadWarning({
        id: `lead-no-contact-${lead.id}`,
        title: `Лид ${leadLabel}: нет контакта`,
        detail: `status=${status}, score=${lead.score ?? 0}`,
        href: `/leads/${lead.id}`
      });
    }
    if (!action.text) {
      addLeadWarning({
        id: `lead-no-next-action-${lead.id}`,
        title: `Лид ${leadLabel}: нет следующего действия`,
        detail: `status=${status}, score=${lead.score ?? 0}`,
        href: `/leads/${lead.id}`
      });
    }
    if (!action.reminderAt) {
      addLeadWarning({
        id: `lead-no-reminder-${lead.id}`,
        title: `Лид ${leadLabel}: нет reminder`,
        detail: `status=${status}, score=${lead.score ?? 0}`,
        href: `/leads/${lead.id}`
      });
    } else if (action.reminderAt.slice(0, 10) < today) {
      addLeadWarning({
        id: `lead-overdue-reminder-${lead.id}`,
        title: `Лид ${leadLabel}: reminder просрочен`,
        detail: `reminder_at=${action.reminderAt}`,
        href: `/leads/${lead.id}`
      });
    }
  }

  const unlinkedMessages = messages.filter((message) => !message.customer_id && !message.lead_id);
  for (const message of unlinkedMessages.slice(0, 25)) {
    addMessageWarning({
      id: `message-unlinked-${message.id}`,
      title: "Входящее сообщение не привязано к клиенту или лиду",
      detail: `${message.channel ?? "channel"} / ${message.contact_handle ?? "no handle"} / ${dateOnly(message.occurred_at) || "без даты"}`,
      href: "/customers"
    });
  }
  if (unlinkedMessages.length > 25) {
    addMessageWarning({
      id: "message-unlinked-overflow",
      title: "Есть дополнительные непривязанные входящие сообщения",
      detail: `Показаны первые 25 из ${unlinkedMessages.length}. Проверьте входящие и привязку клиентов.`,
      href: "/customers"
    });
  }

  for (const task of tasks) {
    if (String(task.status ?? "") === "done") continue;
    const dueDate = dateOnly(task.due_date);
    const title = String(task.title ?? task.id).trim() || task.id.slice(0, 8);
    if (!task.assigned_to) {
      addTaskWarning({
        id: `task-unassigned-${task.id}`,
        title: `Задача без ответственного: ${title}`,
        detail: `priority=${task.priority ?? "medium"}, status=${task.status ?? "todo"}`,
        href: "/users"
      });
    }
    if (!dueDate) {
      addTaskWarning({
        id: `task-no-due-date-${task.id}`,
        title: `Задача без срока: ${title}`,
        detail: `priority=${task.priority ?? "medium"}, status=${task.status ?? "todo"}`,
        href: "/users"
      });
    } else if (dueDate < today) {
      addTaskWarning({
        id: `task-overdue-${task.id}`,
        title: `Просроченная задача: ${title}`,
        detail: `due_date=${dueDate}, priority=${task.priority ?? "medium"}`,
        href: "/users"
      });
    }
    if (String(task.priority ?? "") === "high" && String(task.status ?? "") === "todo") {
      addTaskWarning({
        id: `task-high-not-started-${task.id}`,
        title: `Высокий приоритет ещё не в работе: ${title}`,
        detail: `status=${task.status ?? "todo"}, due_date=${dueDate || "missing"}`,
        href: "/users"
      });
    }
  }

  const activePriceRulesByVehicle = priceRules.reduce<Map<string, number>>((acc, rule) => {
    if (rule.active === false) return acc;
    if (rule.daily_rate_thb == null && rule.monthly_rate_thb == null) return acc;
    const vehicleId = String(rule.vehicle_id ?? "");
    if (!vehicleId) return acc;
    acc.set(vehicleId, (acc.get(vehicleId) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  for (const vehicle of vehicles) {
    if (vehicle.public_visible === false) continue;
    const vehicleTitle = displayVehicleName(vehicle);
    const href = `/fleet/${vehicle.id}`;
    if (!Array.isArray(vehicle.photos) || vehicle.photos.length === 0) {
      addPublicCatalogWarning({
        id: `catalog-no-photos-${vehicle.id}`,
        title: "Публичная машина без фото",
        detail: vehicleTitle,
        href
      });
    }
    if (Number(vehicle.daily_rate_long_term ?? 0) <= 0 && Number(vehicle.monthly_rate ?? 0) <= 0 && !activePriceRulesByVehicle.has(vehicle.id)) {
      addPublicCatalogWarning({
        id: `catalog-no-price-${vehicle.id}`,
        title: "Публичная машина без цены",
        detail: vehicleTitle,
        href
      });
    }
    if (Number(vehicle.deposit_amount ?? 0) <= 0) {
      addPublicCatalogWarning({
        id: `catalog-no-deposit-${vehicle.id}`,
        title: "Публичная машина без депозита",
        detail: vehicleTitle,
        href
      });
    }
    if (!String(vehicle.public_description_ru ?? "").trim()) {
      addPublicCatalogWarning({
        id: `catalog-no-description-ru-${vehicle.id}`,
        title: "Публичная машина без описания RU",
        detail: vehicleTitle,
        href
      });
    }
    if (!String(vehicle.public_description_en ?? "").trim()) {
      addPublicCatalogWarning({
        id: `catalog-no-description-en-${vehicle.id}`,
        title: "Публичная машина без описания EN",
        detail: vehicleTitle,
        href
      });
    }
    if (!activePriceRulesByVehicle.has(vehicle.id)) {
      addPublicCatalogWarning({
        id: `catalog-no-price-rules-${vehicle.id}`,
        title: "Публичная машина без активных price rules",
        detail: vehicleTitle,
        href
      });
    }
  }

  for (const booking of bookings) {
    const start = dateOnly(booking.start_date);
    const end = dateOnly(booking.actual_end ?? booking.end_date);
    if (start && end && end < start) {
      critical.push({
        id: `booking-date-${booking.id}`,
        severity: "critical",
        type: "booking_dates",
        title: `Некорректные даты брони ${bookingLabel(booking)}`,
        detail: `${vehicleName(booking.vehicle_id)}: ${start} - ${end}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (blocksVehicle(booking) && !booking.vehicle_id) {
      critical.push({
        id: `booking-no-vehicle-${booking.id}`,
        severity: "critical",
        type: "booking_no_vehicle",
        title: `Бронь ${bookingLabel(booking)} блокирует календарь без машины`,
        detail: `${start || "без даты"} - ${end || "без даты"}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (blocksVehicle(booking) && !booking.customer_id) {
      critical.push({
        id: `booking-no-customer-${booking.id}`,
        severity: "critical",
        type: "booking_no_customer",
        title: `Бронь ${bookingLabel(booking)} блокирует календарь без клиента`,
        detail: `${vehicleName(booking.vehicle_id)}: ${start || "без даты"} - ${end || "без даты"}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (blocksVehicle(booking) && booking.customer_id && !customersById.has(booking.customer_id)) {
      warnings.push({
        id: `booking-customer-${booking.id}`,
        severity: "warning",
        type: "missing_customer",
        title: `Клиент брони ${bookingLabel(booking)} не найден`,
        detail: `${vehicleName(booking.vehicle_id)}: ${start} - ${end}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (
      ["handed_over", "active", "in_use", "returning"].includes(String(booking.rental_status ?? "")) &&
      end &&
      end < today
    ) {
      warnings.push({
        id: `overdue-return-${booking.id}`,
        severity: "warning",
        type: "overdue_return",
        title: `Просроченный возврат ${bookingLabel(booking)}`,
        detail: `${vehicleName(booking.vehicle_id)} должен был вернуться ${end}`,
        href: `/bookings/${booking.id}`
      });
    }
  }

  for (const booking of blockingBookings) {
    const start = dateOnly(booking.start_date);
    const dueForHandover = rentalIsActive(booking) || (["confirmed", "paid_deposit"].includes(String(booking.status ?? "")) && start && start <= tomorrow);
    if (!dueForHandover || !booking.customer_id) continue;
    const customer = customersById.get(booking.customer_id);
    if (!customer) continue;
    const label = bookingLabel(booking);
    const customerName = customer.full_name || customer.full_name_passport || customer.phone || customer.whatsapp || booking.customer_id;
    const href = `/customers/${booking.customer_id}`;
    const passportExpires = dateOnly(customer.passport_expires);

    if (!String(customer.full_name_passport ?? "").trim()) {
      addDocumentWarning({
        id: `handover-passport-name-${booking.id}`,
        title: `Выдача ${label}: не заполнено имя как в паспорте`,
        detail: `${customerName} / ${vehicleName(booking.vehicle_id)} / старт ${start || "без даты"}`,
        href
      });
    }
    if (!String(customer.passport_number ?? "").trim()) {
      addDocumentWarning({
        id: `handover-passport-number-${booking.id}`,
        title: `Выдача ${label}: не заполнен номер паспорта`,
        detail: `${customerName} / ${vehicleName(booking.vehicle_id)} / старт ${start || "без даты"}`,
        href
      });
    }
    if (!passportExpires || passportExpires < today) {
      addDocumentWarning({
        id: `handover-passport-expiry-${booking.id}`,
        title: `Выдача ${label}: паспорт просрочен или без срока`,
        detail: `${customerName}: passport_expires=${passportExpires || "missing"}`,
        href
      });
    }
    if (!hasValidDrivingPermit(customer)) {
      addDocumentWarning({
        id: `handover-driving-permit-${booking.id}`,
        title: `Выдача ${label}: нет действующего IDP / тайских прав`,
        detail: `${customerName}: idp=${customer.idp_number || "missing"}, expires=${dateOnly(customer.idp_expires) || "missing"}`,
        href
      });
    }
    if (!customer.passport_photo_url) {
      addDocumentWarning({
        id: `handover-passport-photo-${booking.id}`,
        title: `Выдача ${label}: нет фото паспорта`,
        detail: `${customerName} / ${vehicleName(booking.vehicle_id)}`,
        href
      });
    }
    if (!customer.driver_license_photo_url && !customer.idp_photo_url) {
      addDocumentWarning({
        id: `handover-license-photo-${booking.id}`,
        title: `Выдача ${label}: нет фото прав / IDP`,
        detail: `${customerName} / ${vehicleName(booking.vehicle_id)}`,
        href
      });
    }
  }

  for (const booking of blockingBookings) {
    const grandTotal = Number(booking.grand_total ?? 0);
    const depositAmount = Number(booking.deposit_amount ?? 0);
    const paidTotal = completedPaymentTotals.get(booking.id) ?? 0;
    const rentalPaid = completedRentalPaymentTotals.get(booking.id) ?? 0;
    const financialStatus = calculateBookingFinancialStatus(booking, payments.filter((payment) => payment.booking_id === booking.id));
    const paymentStatus = String(booking.payment_status ?? "");
    const depositStatus = String(booking.deposit_status ?? "");
    const label = bookingLabel(booking);
    const activeRental = rentalIsActive(booking);

    if (grandTotal <= 0) {
      addFinanceWarning({
        id: `finance-total-${booking.id}`,
        title: `Бронь ${label}: не заполнена сумма аренды`,
        detail: `${vehicleName(booking.vehicle_id)}: grand_total=${grandTotal}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (activeRental && (!paymentStatus || paymentStatus === "unpaid") && rentalPaid <= 0) {
      addFinanceWarning({
        id: `finance-unpaid-active-${booking.id}`,
        title: `Активная аренда ${label} без оплаты`,
        detail: `${vehicleName(booking.vehicle_id)}: payment_status=${paymentStatus || "missing"}, rental_paid=${rentalPaid}, all_payments=${paidTotal}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (activeRental && depositAmount > 0 && (!depositStatus || depositStatus === "not_taken")) {
      addFinanceWarning({
        id: `finance-deposit-active-${booking.id}`,
        title: `Активная аренда ${label} без депозита`,
        detail: `${vehicleName(booking.vehicle_id)}: deposit_amount=${depositAmount}, deposit_status=${depositStatus || "missing"}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (String(booking.status ?? "") === "paid_deposit" && !["held", "partially_returned", "fully_returned", "forfeited"].includes(depositStatus)) {
      addFinanceWarning({
        id: `finance-deposit-status-${booking.id}`,
        title: `Бронь ${label}: статус paid_deposit без взятого депозита`,
        detail: `${vehicleName(booking.vehicle_id)}: deposit_status=${depositStatus || "missing"}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (rentalPaid > 0 && paymentStatus === "unpaid") {
      addFinanceWarning({
        id: `finance-payment-sync-${booking.id}`,
        title: `Бронь ${label}: платежи есть, но статус unpaid`,
        detail: `${vehicleName(booking.vehicle_id)}: rental_paid=${rentalPaid}, payment_status=${paymentStatus}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (financialStatus.rentalDue > 0 && rentalPaid >= financialStatus.rentalDue && paymentStatus && paymentStatus !== "fully_paid") {
      addFinanceWarning({
        id: `finance-payment-full-sync-${booking.id}`,
        title: `Бронь ${label}: оплачена полностью, но статус не fully_paid`,
        detail: `${vehicleName(booking.vehicle_id)}: rental_paid=${rentalPaid}, rental_due=${financialStatus.rentalDue}, payment_status=${paymentStatus}`,
        href: `/bookings/${booking.id}`
      });
    }
    if (financialStatus.rentalDue > 0 && paymentStatus === "fully_paid" && rentalPaid < financialStatus.rentalDue) {
      addFinanceWarning({
        id: `finance-payment-deposit-miscount-${booking.id}`,
        title: `Бронь ${label}: fully_paid мог быть закрыт депозитом`,
        detail: `${vehicleName(booking.vehicle_id)}: rental_paid=${rentalPaid}, rental_due=${financialStatus.rentalDue}, all_payments=${paidTotal}`,
        href: `/bookings/${booking.id}`
      });
    }
  }

  for (const booking of blockingBookings) {
    const end = dateOnly(booking.actual_end ?? booking.end_date);
    const returnDue =
      String(booking.status ?? "") === "returning" ||
      String(booking.rental_status ?? "") === "returning" ||
      (rentalIsActive(booking) && end && end <= tomorrow);
    if (!returnDue) continue;

    const label = bookingLabel(booking);
    const href = `/bookings/${booking.id}`;
    if (!hasMediaItems(booking.return_photos)) {
      addReturnWarning({
        id: `return-photos-${booking.id}`,
        title: `Возврат ${label}: нет фото возврата`,
        detail: `${vehicleName(booking.vehicle_id)}: дата возврата ${end || "без даты"}`,
        href
      });
    }
    if (!hasChecklistVideos(booking.return_checklist)) {
      addReturnWarning({
        id: `return-video-${booking.id}`,
        title: `Возврат ${label}: нет видео возврата`,
        detail: `${vehicleName(booking.vehicle_id)}: дата возврата ${end || "без даты"}`,
        href
      });
    }
    if (Number(booking.deposit_amount ?? 0) > 0 && String(booking.deposit_status ?? "not_taken") === "held") {
      addReturnWarning({
        id: `return-deposit-${booking.id}`,
        title: `Возврат ${label}: депозит ещё held`,
        detail: `${vehicleName(booking.vehicle_id)}: deposit_status=held`,
        href
      });
    }
  }

  for (const booking of blockingBookings) {
    if (!booking.vehicle_id) continue;
    const start = dateOnly(booking.start_date);
    const end = dateOnly(booking.actual_end ?? booking.end_date);
    if (!start || !end) continue;
    const policy = activeInsuranceFor(booking.vehicle_id, start, end);
    if (!policy) {
      addInsuranceWarning({
        id: `insurance-booking-${booking.id}`,
        title: `Страховку нужно продлить во время аренды ${bookingLabel(booking)}`,
        detail: `${vehicleName(booking.vehicle_id)}: аренда ${start} - ${end}. Это не блокирует аренду, бронь или рекламу.`,
        href: `/bookings/${booking.id}`
      });
      continue;
    }
    const policyEnd = dateOnly(policy.end_date);
    if (policyEnd && policyEnd <= addDaysKey(today, 14)) {
      addInsuranceWarning({
        id: `insurance-expiring-booking-${booking.id}`,
        title: `Страховка скоро заканчивается: ${bookingLabel(booking)}`,
        detail: `${vehicleName(booking.vehicle_id)}: полис до ${policyEnd}, бронь ${start} - ${end}`,
        href: `/fleet/${booking.vehicle_id}`
      });
    }
  }

  for (const vehicle of vehicles) {
    const vehiclePolicies = insurancePolicies.filter((policy) => policy.vehicle_id === vehicle.id);
    if (vehiclePolicies.length === 0) {
      addInsuranceWarning({
        id: `insurance-missing-vehicle-${vehicle.id}`,
        title: "У автомобиля нет страхового полиса",
        detail: displayVehicleName(vehicle),
        href: `/fleet/${vehicle.id}`
      });
      continue;
    }
    const latestPolicy = vehiclePolicies
      .slice()
      .sort((left, right) => dateOnly(right.end_date).localeCompare(dateOnly(left.end_date)))[0];
    const latestEnd = dateOnly(latestPolicy.end_date);
    if (!latestEnd || latestEnd < today) {
      addInsuranceWarning({
        id: `insurance-expired-vehicle-${vehicle.id}`,
        title: "У автомобиля истекла страховка",
        detail: `${displayVehicleName(vehicle)}: полис до ${latestEnd || "missing"}`,
        href: `/fleet/${vehicle.id}`
      });
    } else if (latestEnd <= addDaysKey(today, 14)) {
      addInsuranceWarning({
        id: `insurance-renewal-vehicle-${vehicle.id}`,
        title: "Страховка автомобиля скоро заканчивается",
        detail: `${displayVehicleName(vehicle)}: полис до ${latestEnd}`,
        href: `/fleet/${vehicle.id}`
      });
    }
  }

  for (const booking of blockingBookings) {
    if (!booking.vehicle_id) continue;
    const vehicle = vehiclesById.get(booking.vehicle_id);
    if (!vehicle) continue;
    const end = dateOnly(booking.actual_end ?? booking.end_date);
    if (!end) continue;
    const roadTaxDue = dateOnly(vehicle.road_tax_due_date);
    const inspectionDue = dateOnly(vehicle.inspection_expires_at);
    if (!roadTaxDue || roadTaxDue < end) {
      addTaxWarning({
        id: `tax-booking-${booking.id}`,
        title: `Por Ror Bor / road tax нужно продлить во время аренды ${bookingLabel(booking)}`,
        detail: `${vehicleName(booking.vehicle_id)}: road_tax_due_date=${roadTaxDue || "missing"}, аренда до ${end}. Это не блокирует аренду.`,
        href: `/fleet/${booking.vehicle_id}`
      });
    }
    if (inspectionDue && inspectionDue < end) {
      addTaxWarning({
        id: `inspection-booking-${booking.id}`,
        title: `Техпроверку нужно продлить во время аренды ${bookingLabel(booking)}`,
        detail: `${vehicleName(booking.vehicle_id)}: inspection_expires_at=${inspectionDue}, аренда до ${end}. Это не блокирует аренду.`,
        href: `/fleet/${booking.vehicle_id}`
      });
    }
  }

  for (const vehicle of vehicles) {
    const roadTaxDue = dateOnly(vehicle.road_tax_due_date);
    const inspectionDue = dateOnly(vehicle.inspection_expires_at);
    if (!roadTaxDue) {
      addTaxWarning({
        id: `tax-missing-vehicle-${vehicle.id}`,
        title: "У автомобиля не заполнен Por Ror Bor / road tax",
        detail: displayVehicleName(vehicle),
        href: `/fleet/${vehicle.id}`
      });
    } else if (roadTaxDue < today) {
      addTaxWarning({
        id: `tax-expired-vehicle-${vehicle.id}`,
        title: "У автомобиля истёк Por Ror Bor / road tax",
        detail: `${displayVehicleName(vehicle)}: до ${roadTaxDue}`,
        href: `/fleet/${vehicle.id}`
      });
    } else if (roadTaxDue <= addDaysKey(today, 14)) {
      addTaxWarning({
        id: `tax-renewal-vehicle-${vehicle.id}`,
        title: "Por Ror Bor / road tax скоро заканчивается",
        detail: `${displayVehicleName(vehicle)}: до ${roadTaxDue}`,
        href: `/fleet/${vehicle.id}`
      });
    }
    if (inspectionDue && inspectionDue <= addDaysKey(today, 14)) {
      addTaxWarning({
        id: `inspection-renewal-vehicle-${vehicle.id}`,
        title: "Техпроверка скоро заканчивается",
        detail: `${displayVehicleName(vehicle)}: до ${inspectionDue}`,
        href: `/fleet/${vehicle.id}`
      });
    }
  }

  const activeBookingsByVehicle = new Map<string, typeof blockingBookings[number][]>();
  for (const booking of blockingBookings) {
    if (!booking.vehicle_id) continue;
    const items = activeBookingsByVehicle.get(booking.vehicle_id) ?? [];
    items.push(booking);
    activeBookingsByVehicle.set(booking.vehicle_id, items);
  }
  const activeMaintenanceByVehicle = new Map<string, typeof maintenance[number][]>();
  for (const item of maintenance) {
    const status = String(item.status ?? "");
    if (!["scheduled", "in_progress"].includes(status) || !item.vehicle_id) continue;
    const start = dateOnly(item.vehicle_unavailable_from);
    const end = dateOnly(item.vehicle_unavailable_to || (status === "in_progress" ? "9999-12-31" : item.vehicle_unavailable_from));
    if (start && start <= today && end >= today) {
      const items = activeMaintenanceByVehicle.get(item.vehicle_id) ?? [];
      items.push(item);
      activeMaintenanceByVehicle.set(item.vehicle_id, items);
    }
  }
  for (const vehicle of vehicles) {
    const vehicleStatus = String(vehicle.status ?? "");
    const activeBookings = activeBookingsByVehicle.get(vehicle.id) ?? [];
    const activeRentals = activeBookings.filter((booking) => rentalIsActive(booking));
    const reservedBookings = activeBookings.filter((booking) => !rentalIsActive(booking));
    const activeMaintenance = activeMaintenanceByVehicle.get(vehicle.id) ?? [];

    if (activeMaintenance.length > 0 && !["maintenance", "repair"].includes(vehicleStatus)) {
      addStatusWarning({
        id: `vehicle-status-maintenance-${vehicle.id}`,
        title: "Статус машины не отражает ремонт/ТО",
        detail: `${displayVehicleName(vehicle)}: status=${vehicleStatus || "missing"}, активных ТО/ремонтов=${activeMaintenance.length}`,
        href: `/fleet/${vehicle.id}`
      });
    }
    if (activeRentals.length > 0 && !["handed_over", "in_use", "returning"].includes(vehicleStatus)) {
      addStatusWarning({
        id: `vehicle-status-rental-${vehicle.id}`,
        title: "Статус машины не отражает активную аренду",
        detail: `${displayVehicleName(vehicle)}: status=${vehicleStatus || "missing"}, активных аренд=${activeRentals.length}`,
        href: `/fleet/${vehicle.id}`
      });
    }
    if (reservedBookings.length > 0 && activeRentals.length === 0 && activeMaintenance.length === 0 && vehicleStatus === "available") {
      addStatusWarning({
        id: `vehicle-status-reserved-${vehicle.id}`,
        title: "Статус машины свободна, но есть подтвержденная бронь",
        detail: `${displayVehicleName(vehicle)}: активных броней=${reservedBookings.length}`,
        href: `/fleet/${vehicle.id}`
      });
    }
    if (activeBookings.length === 0 && activeMaintenance.length === 0 && ["reserved", "handed_over", "in_use", "returning"].includes(vehicleStatus)) {
      addStatusWarning({
        id: `vehicle-status-stale-${vehicle.id}`,
        title: "Статус машины выглядит устаревшим",
        detail: `${displayVehicleName(vehicle)}: status=${vehicleStatus}, активных броней/ремонтов нет`,
        href: `/fleet/${vehicle.id}`
      });
    }
  }

  for (let i = 0; i < blockingBookings.length; i += 1) {
    const left = blockingBookings[i];
    if (!left.vehicle_id) continue;
    const leftStart = dateOnly(left.start_date);
    const leftEnd = dateOnly(left.actual_end ?? left.end_date);
    for (let j = i + 1; j < blockingBookings.length; j += 1) {
      const right = blockingBookings[j];
      if (left.vehicle_id !== right.vehicle_id) continue;
      const rightStart = dateOnly(right.start_date);
      const rightEnd = dateOnly(right.actual_end ?? right.end_date);
      if (rangesOverlap(leftStart, leftEnd, rightStart, rightEnd)) {
        critical.push({
          id: `booking-overlap-${left.id}-${right.id}`,
          severity: "critical",
          type: "booking_overlap",
          title: `Пересечение броней: ${bookingLabel(left)} и ${bookingLabel(right)}`,
          detail: `${vehicleName(left.vehicle_id)}: ${leftStart} - ${leftEnd} / ${rightStart} - ${rightEnd}`,
          href: `/bookings/${left.id}`
        });
      }
    }
  }

  for (const item of maintenance) {
    const status = String(item.status ?? "");
    const start = dateOnly(item.vehicle_unavailable_from);
    const end = dateOnly(item.vehicle_unavailable_to || (status === "in_progress" ? "9999-12-31" : item.vehicle_unavailable_from));
    if (["scheduled", "in_progress"].includes(status) && !start) {
      warnings.push({
        id: `maintenance-no-date-${item.id}`,
        severity: "warning",
        type: "maintenance_no_date",
        title: "Ремонт/ТО без даты недоступности",
        detail: `${vehicleName(item.vehicle_id)}: ${item.type ?? "maintenance"}`,
        href: item.vehicle_id ? `/fleet/${item.vehicle_id}` : "/maintenance"
      });
      continue;
    }
    if (start && end && end < start) {
      critical.push({
        id: `maintenance-date-${item.id}`,
        severity: "critical",
        type: "maintenance_dates",
        title: "Некорректные даты ремонта/ТО",
        detail: `${vehicleName(item.vehicle_id)}: ${start} - ${end}`,
        href: item.vehicle_id ? `/fleet/${item.vehicle_id}` : "/maintenance"
      });
    }
    if (!["scheduled", "in_progress"].includes(status) || !item.vehicle_id || !start || !end) continue;
    for (const booking of blockingBookings) {
      if (booking.vehicle_id !== item.vehicle_id) continue;
      const bookingStart = dateOnly(booking.start_date);
      const bookingEnd = dateOnly(booking.actual_end ?? booking.end_date);
      if (rangesOverlap(start, end, bookingStart, bookingEnd)) {
        critical.push({
          id: `booking-maintenance-${booking.id}-${item.id}`,
          severity: "critical",
          type: "booking_maintenance_overlap",
          title: `Бронь ${bookingLabel(booking)} пересекается с ремонтом/ТО`,
          detail: `${vehicleName(item.vehicle_id)}: бронь ${bookingStart} - ${bookingEnd}, ТО ${start} - ${end === "9999-12-31" ? "без даты окончания" : end}`,
          href: `/bookings/${booking.id}`
        });
      }
    }
  }

  return {
    generatedAt: empty.generatedAt,
    critical,
    warnings,
    operationalAgenda,
    counts: {
      vehicles: vehicles.length,
      bookings: blockingBookings.length,
      maintenance: maintenance.filter((item) => ["scheduled", "in_progress"].includes(String(item.status ?? ""))).length,
      activeUsers: users.filter((user) => user.active !== false).length,
      integrationsOk: integrations.filter((integration) => integration.status === "ok").length,
      integrationsWarnings: integrations.filter((integration) => integration.status === "warning").length,
      integrationsCritical: integrations.filter((integration) => integration.status === "critical").length,
      financeWarnings,
      documentWarnings,
      returnWarnings,
      insuranceWarnings,
      taxWarnings,
      statusWarnings,
      customerWarnings,
      leadWarnings,
      messageWarnings,
      taskWarnings,
      publicCatalogWarnings,
      critical: critical.length,
      warnings: warnings.length
    },
    activeRoles,
    integrations
  };
}

export async function getAppUsers(tenantId: string): Promise<AppUser[]> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, auth_user_id, full_name, role, phone, telegram_username, active, created_at, avatar_url")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  try {
    const { data: authData } = await supabase.auth.admin.listUsers();
    const emailMap = new Map(authData?.users?.map((u) => [u.id, u.email]) ?? []);
    return data.map((item) => ({
      ...item,
      email: item.auth_user_id ? emailMap.get(item.auth_user_id) ?? null : null
    })) as AppUser[];
  } catch (err) {
    console.error("Failed to list auth users:", err);
  }

  return data as AppUser[];
}

export async function getCustomerMessages(customerId: string, tenantId: string): Promise<ConversationMessage[]> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const supabase = createServiceSupabaseClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("phone, whatsapp, telegram_username, source_detail")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();

  const { data: linkedLeads } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .limit(500);
  const linkedLeadIds = (linkedLeads ?? []).map((lead) => lead.id);

  const normalizeDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const isOpaqueWhatsAppId = (value: string | null | undefined) => {
    const raw = (value ?? "").trim().toLowerCase();
    return raw.includes("@lid") || raw.endsWith("lid");
  };
  const isSameContact = (left: string | null | undefined, right: string | null | undefined) => {
    const leftRaw = (left ?? "").trim().toLowerCase();
    const rightRaw = (right ?? "").trim().toLowerCase();
    if (!leftRaw || !rightRaw) return false;
    if (leftRaw === rightRaw) return true;
    if (isOpaqueWhatsAppId(leftRaw) || isOpaqueWhatsAppId(rightRaw)) return false;

    const leftDigits = normalizeDigits(leftRaw);
    const rightDigits = normalizeDigits(rightRaw);
    if (!leftDigits || !rightDigits) return false;
    if (leftDigits.length < 7 || rightDigits.length < 7) return false;
    return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
  };

  const baseHandles = Array.from(
    new Set(
      [customer?.phone, customer?.whatsapp, customer?.telegram_username, customer?.source_detail]
        .filter((value): value is string => Boolean(value))
        .flatMap(expandContactHandles)
    )
  );

  const { data: byCustomer, error } = await supabase
    .from("conversation_messages")
    .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at, media_url, raw_payload")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("occurred_at", { ascending: true })
    .limit(300);

  const { data: byLinkedLead } =
    linkedLeadIds.length > 0
      ? await supabase
          .from("conversation_messages")
          .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at, media_url, raw_payload")
          .eq("tenant_id", tenantId)
          .in("lead_id", linkedLeadIds)
          .order("occurred_at", { ascending: true })
          .limit(300)
      : { data: [] };

  if (error) {
    return [];
  }

  const byCustomerMapped = (byCustomer ?? []).map(mapMessage);
  const byLinkedLeadMapped = (byLinkedLead ?? []).map(mapMessage);

  const knownHandles = new Set(baseHandles);
  for (const message of byCustomerMapped) {
    if (message.contact_handle) {
      for (const handle of expandContactHandles(message.contact_handle)) knownHandles.add(handle);
      const digits = isOpaqueWhatsAppId(message.contact_handle) ? "" : normalizeDigits(message.contact_handle);
      if (digits) {
        knownHandles.add(digits);
        knownHandles.add(`+${digits}`);
        knownHandles.add(`${digits}@s.whatsapp.net`);
      }
    }
  }

  const { data: recentMessages } = await supabase
    .from("conversation_messages")
    .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at, media_url, raw_payload")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(2000);

  const recentMessagesMapped = (recentMessages ?? []).map(mapMessage);

  const merged = new Map<string, ConversationMessage>();
  const allCandidateMessages = [
    ...byCustomerMapped,
    ...byLinkedLeadMapped,
    ...recentMessagesMapped
  ];
  for (const message of allCandidateMessages) {
    const belongsToCustomer = message.customer_id === customerId;
    const belongsToLinkedLead = Boolean(message.lead_id && linkedLeadIds.includes(message.lead_id));
    const matchesKnownHandle = Array.from(knownHandles).some((handle) => isSameContact(message.contact_handle, handle));
    if (!belongsToCustomer && !belongsToLinkedLead && !matchesKnownHandle) {
      continue;
    }
    merged.set(message.id, message);
  }

  return Array.from(merged.values()).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

export async function getLeadMessages(leadId: string, tenantId: string): Promise<ConversationMessage[]> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  const supabase = createServiceSupabaseClient();
  const { data: leadWithContactFields, error: leadWithContactFieldsError } = await supabase
    .from("leads")
    .select("id, customer_id, contact_handle, phone, whatsapp, telegram_username, anonymous_data")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  const { data: leadFallback } = leadWithContactFieldsError
    ? await supabase
        .from("leads")
        .select("id, customer_id, anonymous_data, source, source_detail")
        .eq("tenant_id", tenantId)
        .eq("id", leadId)
        .maybeSingle()
    : { data: null };

  const lead = (leadWithContactFields ?? leadFallback) as {
    customer_id?: string | null;
    contact_handle?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    telegram_username?: string | null;
    anonymous_data?: Record<string, unknown> | null;
    source_detail?: string | null;
  } | null;

  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at, media_url, raw_payload")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: true })
    .limit(300);

  if (error) {
    return [];
  }

  const dataMapped = (data ?? []).map(mapMessage);

  const merged = new Map<string, ConversationMessage>();
  for (const message of dataMapped) {
    merged.set(message.id, message);
  }

  if (lead?.customer_id) {
    const customerMessages = await getCustomerMessages(lead.customer_id, tenantId);
    for (const message of customerMessages) {
      merged.set(message.id, message);
    }
  }

  const anonymous = (lead?.anonymous_data ?? {}) as Record<string, unknown>;
  const handles = [
    lead?.contact_handle,
    lead?.phone,
    lead?.whatsapp,
    lead?.telegram_username,
    anonymous.phone,
    anonymous.whatsapp,
    anonymous.contact,
    anonymous.contact_handle,
    anonymous.telegram_username,
    anonymous.telegram,
    anonymous.sender,
    anonymous.from,
    lead?.source_detail
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .flatMap(expandContactHandles);

  if (handles.length > 0) {
    const { data: recentMessages } = await supabase
      .from("conversation_messages")
      .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at, media_url, raw_payload")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(1000);

    const recentMessagesMapped = (recentMessages ?? []).map(mapMessage);

    const normalizeDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
    const isOpaqueWhatsAppId = (value: string | null | undefined) => {
      const raw = (value ?? "").trim().toLowerCase();
      return raw.includes("@lid") || raw.endsWith("lid");
    };
    const sameHandle = (left: string | null | undefined, right: string | null | undefined) => {
      const leftRaw = (left ?? "").trim().toLowerCase();
      const rightRaw = (right ?? "").trim().toLowerCase();
      if (!leftRaw || !rightRaw) return false;
      if (leftRaw === rightRaw) return true;
      if (isOpaqueWhatsAppId(leftRaw) || isOpaqueWhatsAppId(rightRaw)) return false;
      const leftDigits = normalizeDigits(leftRaw);
      const rightDigits = normalizeDigits(rightRaw);
      if (leftDigits.length < 7 || rightDigits.length < 7) return false;
      return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
    };

    for (const message of recentMessagesMapped) {
      if (handles.some((handle) => sameHandle(message.contact_handle, handle))) {
        merged.set(message.id, message);
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}

export async function getVehicleBookings(vehicleId: string, tenantId: string): Promise<DashboardData["bookings"]> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return demoDashboard.bookings.filter((booking) => booking.vehicle_id === vehicleId);
  }

  const supabase = createServiceSupabaseClient();
  const [{ data: bookings, error: bookingsError }, { data: vehicle }, { data: customers }] = await Promise.all([
    supabase
      .from("bookings")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("vehicle_id", vehicleId)
      .order("start_date", { ascending: false })
      .limit(1000),
    supabase.from("vehicles").select("id, make, model, license_plate").eq("tenant_id", tenantId).eq("id", vehicleId).maybeSingle(),
    supabase
      .from("customers")
      .select("id, full_name, full_name_passport, phone, whatsapp, telegram_username, idp_number, idp_expires, has_valid_idp")
      .eq("tenant_id", tenantId)
      .limit(3000)
  ]);

  if (bookingsError) {
    return [];
  }

  const customersById = new Map((customers ?? []).map((customer) => [customer.id, customer]));
  return (bookings ?? []).map((booking) => ({
    id: booking.id,
    booking_number: displayBookingNumber(booking),
    lead_id: booking.lead_id ?? null,
    customer_id: booking.customer_id,
    customer_name: displayCustomerName(customersById.get(booking.customer_id)),
    vehicle_id: booking.vehicle_id,
    vehicle: displayVehicleName(vehicle),
    status: booking.status,
    rental_status: booking.rental_status ?? "not_started",
    start_date: booking.start_date,
    end_date: booking.end_date,
    actual_end: booking.actual_end ?? null,
    rental_amount: Number(booking.total_rental_amount ?? 0),
    deposit_amount: Number(booking.deposit_amount ?? 0),
    pickup_fee: Number(booking.delivery_fee ?? 0),
    delivery_fee: Number(booking.delivery_fee ?? 0),
    grand_total: Number(booking.grand_total ?? 0),
    payment_status: booking.payment_status ?? null,
    deposit_status: booking.deposit_status ?? null,
    return_photos: Array.isArray(booking.return_photos) ? booking.return_photos : [],
    return_checklist: booking.return_checklist ?? null,
    idp_ok: hasValidDrivingPermit(customersById.get(booking.customer_id)),
    contract_pdf_url: booking.contract_pdf_url ?? null
  }));
}

export async function getBookingDetail(id: string, tenantId?: string): Promise<BookingDetail | null> {
  noStore();
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const supabase = createServiceSupabaseClient();
  const currentUser = tenantId ? null : await getCurrentUserContext();
  const scopedTenantId = tenantId ?? currentUser?.tenantId;
  if (!scopedTenantId || (currentUser?.supabaseConfigured && !currentUser.isAuthenticated)) {
    return null;
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("tenant_id", scopedTenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !booking) {
    return null;
  }

  const [{ data: customer }, { data: vehicle }, { data: payments }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, full_name_passport, phone, whatsapp, telegram_username, source, source_detail, passport_number, passport_expires, passport_photo_url, driver_license_number, driver_license_country, driver_license_photo_url, idp_number, idp_expires, idp_photo_url, language_pref, has_valid_idp")
      .eq("tenant_id", scopedTenantId)
      .eq("id", booking.customer_id)
      .maybeSingle(),
    supabase.from("vehicles").select("*").eq("tenant_id", scopedTenantId).eq("id", booking.vehicle_id).maybeSingle(),
    supabase
      .from("payments")
      .select("id, tenant_id, booking_id, amount, currency, type, method, status, paid_at, recorded_by, receipt_url, transaction_id, notes, created_at")
      .eq("tenant_id", scopedTenantId)
      .eq("booking_id", booking.id)
      .order("paid_at", { ascending: false })
  ]);

  return {
    id: booking.id,
    tenant_id: booking.tenant_id,
    booking_number: booking.booking_number,
    lead_id: booking.lead_id ?? null,
    customer_id: booking.customer_id,
    vehicle_id: booking.vehicle_id,
    status: booking.status,
    rental_status: booking.rental_status ?? "not_started",
    start_date: booking.start_date,
    end_date: booking.end_date,
    actual_end: booking.actual_end ?? null,
    rental_type: booking.rental_type,
    pickup_location: booking.pickup_location ?? null,
    return_location: booking.return_location ?? null,
    pickup_method: booking.pickup_method ?? null,
    daily_rate_applied: Number(booking.daily_rate_applied ?? 0),
    total_rental_amount: Number(booking.total_rental_amount ?? 0),
    deposit_amount: Number(booking.deposit_amount ?? 0),
    delivery_fee: Number(booking.delivery_fee ?? 0),
    extras_total: Number(booking.extras_total ?? 0),
    discount_amount: Number(booking.discount_amount ?? 0),
    grand_total: Number(booking.grand_total ?? 0),
    payment_status: booking.payment_status ?? null,
    deposit_status: booking.deposit_status ?? null,
    cancellation_reason: booking.cancellation_reason ?? null,
    idp_owner_override: booking.idp_owner_override ?? null,
    idp_override_note: booking.idp_override_note ?? null,
    contract_pdf_url: booking.contract_pdf_url ?? null,
    contract_signed: Boolean(booking.contract_signed),
    customer: customer
      ? {
          id: customer.id,
          full_name: customer.full_name,
          full_name_passport: customer.full_name_passport,
          phone: customer.phone,
          whatsapp: customer.whatsapp,
          telegram_username: customer.telegram_username,
          source: customer.source ?? null,
          source_detail: customer.source_detail,
          passport_number: customer.passport_number,
          passport_expires: customer.passport_expires,
          passport_photo_url: customer.passport_photo_url,
          driver_license_number: customer.driver_license_number,
          driver_license_country: customer.driver_license_country,
          driver_license_photo_url: customer.driver_license_photo_url,
          idp_number: customer.idp_number,
          idp_expires: customer.idp_expires,
          idp_photo_url: customer.idp_photo_url,
          language_pref: customer.language_pref,
          has_valid_idp: customer.has_valid_idp
        }
      : null,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          license_plate: vehicle.license_plate,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          category: vehicle.category,
          status: vehicle.status,
          location: vehicle.location_id ?? "Phuket",
          location_id: vehicle.location_id,
          vin: vehicle.vin ?? null,
          color: vehicle.color ?? null,
          body_type: vehicle.body_type,
          fuel_type: vehicle.fuel_type,
          transmission: vehicle.transmission,
          seats: Number(vehicle.seats ?? 5),
          mileage_current: Number(vehicle.mileage_current ?? 0),
          ownership_type: vehicle.ownership_type ?? "own",
          photos: Array.isArray(vehicle.photos) ? vehicle.photos : [],
          notes_internal: vehicle.notes_internal ?? null,
          daily_rate_short_term: Number(vehicle.daily_rate_short_term ?? 0),
          daily_rate_long_term: Number(vehicle.daily_rate_long_term ?? 0),
          monthly_rate: Number(vehicle.monthly_rate ?? 0),
          deposit_amount: Number(vehicle.deposit_amount ?? 0),
          public_visible: vehicle.public_visible !== false,
          public_sort_order: Number(vehicle.public_sort_order ?? 100),
          public_description_ru: vehicle.public_description_ru ?? null,
          public_description_en: vehicle.public_description_en ?? null,
          public_features: Array.isArray(vehicle.public_features) ? vehicle.public_features : [],
          acquisition_cost_thb: Number(vehicle.acquisition_cost_thb ?? 0),
          acquisition_date: vehicle.acquisition_date ?? "",
          status_financial: vehicle.status_financial,
          performance_band: vehicle.performance_band ?? "LOWER_MID",
          payback_pct: 0,
          revpad: 0,
          utilization_90: 0,
          insurance_provider: "",
          insurance_phone: "",
          insurance_expires_at: vehicle.inspection_expires_at ?? "",
          road_tax_due_date: vehicle.road_tax_due_date ?? "",
          price_rules: []
        }
      : null,
    payments: (payments ?? []).map((payment) => ({
      id: payment.id,
      tenant_id: payment.tenant_id,
      booking_id: payment.booking_id,
      amount: Number(payment.amount ?? 0),
      currency: payment.currency ?? "THB",
      type: payment.type,
      method: payment.method,
      status: payment.status,
      paid_at: payment.paid_at ?? null,
      recorded_by: payment.recorded_by ?? null,
      receipt_url: payment.receipt_url ?? null,
      transaction_id: payment.transaction_id ?? null,
      notes: payment.notes ?? null,
      created_at: payment.created_at
    }))
  };
}
