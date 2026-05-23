import { unstable_noStore as noStore } from "next/cache";
import { demoDashboard } from "./demo-data";
import { createCookieSupabaseClient } from "./supabase-server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "./supabase";
import type { DashboardData } from "./types";
import type { AppUser, BookingDetail, ConversationMessage } from "./types";
import type { Role } from "./types";

export type CurrentUserContext = {
  authUserId: string | null;
  email: string | null;
  fullName: string;
  role: Role;
  tenantId: string;
  isAuthenticated: boolean;
  supabaseConfigured: boolean;
};

export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  noStore();
  const fallback: CurrentUserContext = {
    authUserId: null,
    email: null,
    fullName: "Demo owner",
    role: "owner",
    tenantId: "00000000-0000-0000-0000-000000000001",
    isAuthenticated: false,
    supabaseConfigured: hasSupabaseEnv()
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
      supabaseConfigured: true
    };
  }

  const serviceClient = createServiceSupabaseClient();
  const { data: appUser, error: appUserError } = await serviceClient
    .from("app_users")
    .select("tenant_id, full_name, role")
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
      supabaseConfigured: true
    };
  }

  return {
    authUserId: userData.user.id,
    email: userData.user.email ?? null,
    fullName: appUser?.full_name ?? userData.user.email ?? "Authenticated user",
    role: (appUser?.role ?? "operator") as Role,
    tenantId: appUser?.tenant_id ?? fallback.tenantId,
    isAuthenticated: true,
    supabaseConfigured: true
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

  const [vehiclesResult, leadsResult, bookingsResult, recommendationsResult, customersResult, locationsResult, priceRulesResult, insuranceResult] = await Promise.all([
    supabase.from("vehicles").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
    supabase.from("leads").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(800),
    supabase.from("bookings").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1500),
    supabase.from("fleet_recommendations").select("*").eq("tenant_id", tenantId).order("generated_at", { ascending: false }).limit(20),
    supabase
      .from("customers")
      .select("id, full_name, full_name_passport, phone, whatsapp, telegram_username, source, source_detail, passport_number, passport_expires, idp_number, idp_expires, language_pref, has_valid_idp")
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
      .select("id, vehicle_id, provider, policy_number, start_date, end_date, premium_amount, deductible")
      .eq("tenant_id", tenantId)
      .order("end_date", { ascending: false })
  ]);

  if (vehiclesResult.error || leadsResult.error || bookingsResult.error || recommendationsResult.error || customersResult.error || locationsResult.error) {
    return demoDashboard;
  }

  const customersById = new Map((customersResult.data ?? []).map((customer) => [customer.id, customer]));
  const vehiclesById = new Map((vehiclesResult.data ?? []).map((vehicle) => [vehicle.id, vehicle]));
  const derivedVehicleStatuses = new Map<string, "reserved" | "in_use">();
  const today = new Date().toISOString().slice(0, 10);
  for (const booking of bookingsResult.data ?? []) {
    if (["handed_over", "active", "returning"].includes(booking.status)) {
      derivedVehicleStatuses.set(booking.vehicle_id, "in_use");
      continue;
    }
    if (
      !derivedVehicleStatuses.has(booking.vehicle_id) &&
      ["confirmed", "paid_deposit"].includes(booking.status) &&
      booking.end_date >= today
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
    vehicles: vehiclesResult.data.map((vehicle) => ({
      id: vehicle.id,
      license_plate: vehicle.license_plate,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      category: vehicle.category,
      status: ["maintenance", "repair", "retired"].includes(vehicle.status) ? vehicle.status : derivedVehicleStatuses.get(vehicle.id) ?? vehicle.status,
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
      insurance_provider: insuranceByVehicle.get(vehicle.id)?.provider ?? "",
      insurance_phone: insuranceByVehicle.get(vehicle.id)?.provider?.split(" | ")[1] ?? "",
      insurance_expires_at: insuranceByVehicle.get(vehicle.id)?.end_date ?? vehicle.inspection_expires_at ?? "",
      inspection_expires_at: vehicle.inspection_expires_at ?? "",
      road_tax_amount_thb: Number(vehicle.road_tax_amount_thb ?? 0),
      road_tax_due_date: vehicle.road_tax_due_date ?? "",
      road_tax_paid_until: vehicle.road_tax_paid_until ?? "",
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
    })),
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
        stage: lead.status,
        score: lead.score ?? 0,
        first_response_minutes: lead.first_response_time_minutes ?? 0,
        next_action: action.nextAction,
        reminder_at: action.reminderAt || lead.status_changed_at,
        category: lead.inquiry_vehicle_category ?? "unknown",
        tags: Array.isArray(lead.tags) ? lead.tags : [],
        note: lead.inquiry_text ?? ""
      };
    }),
    bookings: bookingsResult.data.map((booking) => ({
      id: booking.id,
      booking_number: booking.booking_number,
      lead_id: booking.lead_id ?? null,
      customer_id: booking.customer_id,
      customer_name: customersById.get(booking.customer_id)?.full_name ?? "Клиент не найден",
      vehicle_id: booking.vehicle_id,
      vehicle: (() => {
        const vehicle = vehiclesById.get(booking.vehicle_id);
        return vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate}` : "Авто не найдено";
      })(),
      status: booking.status,
      start_date: booking.start_date,
      end_date: booking.end_date,
      rental_amount: Number(booking.total_rental_amount ?? 0),
      deposit_amount: Number(booking.deposit_amount ?? 0),
      pickup_fee: Number(booking.delivery_fee ?? 0),
      delivery_fee: Number(booking.delivery_fee ?? 0),
      grand_total: Number(booking.grand_total ?? 0),
      idp_ok: Boolean(booking.contract_signed),
      contract_pdf_url: booking.contract_pdf_url ?? null
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
      idp_number: customer.idp_number,
      idp_expires: customer.idp_expires,
      language_pref: customer.language_pref,
      has_valid_idp: customer.has_valid_idp
    })),
    locations: locationsResult.data.map((location) => ({
      id: location.id,
      name: location.name,
      city: location.city,
      country_code: location.country_code
    }))
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
    .select("id, auth_user_id, full_name, role, phone, telegram_username, active, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
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
    .select("phone, whatsapp, telegram_username")
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
      [customer?.phone, customer?.whatsapp, customer?.telegram_username]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => {
          const compact = value.replace(/[^\d+]/g, "");
          const withoutPlus = compact.replace(/^\+/, "");
          const whatsappJid = withoutPlus ? `${withoutPlus}@s.whatsapp.net` : "";
          return [value, compact, withoutPlus, whatsappJid].filter(Boolean);
        })
    )
  );

  const { data: byCustomer, error } = await supabase
    .from("conversation_messages")
    .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("occurred_at", { ascending: true })
    .limit(300);

  const { data: byLinkedLead } =
    linkedLeadIds.length > 0
      ? await supabase
          .from("conversation_messages")
          .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at")
          .eq("tenant_id", tenantId)
          .in("lead_id", linkedLeadIds)
          .order("occurred_at", { ascending: true })
          .limit(300)
      : { data: [] };

  if (error) {
    return [];
  }

  const knownHandles = new Set(baseHandles);
  for (const message of (byCustomer ?? []) as ConversationMessage[]) {
    if (message.contact_handle) {
      knownHandles.add(message.contact_handle);
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
    .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false })
    .limit(2000);

  const merged = new Map<string, ConversationMessage>();
  const allCandidateMessages = [
    ...((byCustomer ?? []) as ConversationMessage[]),
    ...((byLinkedLead ?? []) as ConversationMessage[]),
    ...((recentMessages ?? []) as ConversationMessage[])
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
  const { data: lead } = await supabase
    .from("leads")
    .select("id, customer_id, anonymous_data")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();

  if (lead?.customer_id) {
    return getCustomerMessages(lead.customer_id, tenantId);
  }

  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: true })
    .limit(300);

  if (error) {
    return [];
  }

  const merged = new Map<string, ConversationMessage>();
  for (const message of (data ?? []) as ConversationMessage[]) {
    merged.set(message.id, message);
  }

  const anonymous = (lead?.anonymous_data ?? {}) as Record<string, unknown>;
  const handles = [anonymous.phone, anonymous.whatsapp, anonymous.contact, anonymous.telegram_username]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (handles.length > 0) {
    const { data: recentMessages } = await supabase
      .from("conversation_messages")
      .select("id, customer_id, lead_id, channel, direction, sender_type, sender_name, contact_handle, message_text, message_type, status, occurred_at")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(1000);

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

    for (const message of (recentMessages ?? []) as ConversationMessage[]) {
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
    supabase.from("customers").select("id, full_name").eq("tenant_id", tenantId).limit(3000)
  ]);

  if (bookingsError) {
    return [];
  }

  const customersById = new Map((customers ?? []).map((customer) => [customer.id, customer]));
  return (bookings ?? []).map((booking) => ({
    id: booking.id,
    booking_number: booking.booking_number,
    lead_id: booking.lead_id ?? null,
    customer_id: booking.customer_id,
    customer_name: customersById.get(booking.customer_id)?.full_name ?? "Клиент не найден",
    vehicle_id: booking.vehicle_id,
    vehicle: vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate}` : "Авто не найдено",
    status: booking.status,
    start_date: booking.start_date,
    end_date: booking.end_date,
    rental_amount: Number(booking.total_rental_amount ?? 0),
    deposit_amount: Number(booking.deposit_amount ?? 0),
    pickup_fee: Number(booking.delivery_fee ?? 0),
    delivery_fee: Number(booking.delivery_fee ?? 0),
    grand_total: Number(booking.grand_total ?? 0),
    idp_ok: Boolean(booking.contract_signed),
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

  const [{ data: customer }, { data: vehicle }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, full_name_passport, phone, whatsapp, telegram_username, source, source_detail, passport_number, passport_expires, idp_number, idp_expires, language_pref, has_valid_idp")
      .eq("tenant_id", scopedTenantId)
      .eq("id", booking.customer_id)
      .maybeSingle(),
    supabase.from("vehicles").select("*").eq("tenant_id", scopedTenantId).eq("id", booking.vehicle_id).maybeSingle()
  ]);

  return {
    id: booking.id,
    tenant_id: booking.tenant_id,
    booking_number: booking.booking_number,
    status: booking.status,
    start_date: booking.start_date,
    end_date: booking.end_date,
    rental_type: booking.rental_type,
    total_rental_amount: Number(booking.total_rental_amount ?? 0),
    deposit_amount: Number(booking.deposit_amount ?? 0),
    delivery_fee: Number(booking.delivery_fee ?? 0),
    extras_total: Number(booking.extras_total ?? 0),
    grand_total: Number(booking.grand_total ?? 0),
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
          idp_number: customer.idp_number,
          idp_expires: customer.idp_expires,
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
      : null
  };
}
