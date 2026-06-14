import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

type Recipient = {
  id: string;
  tenant_id: string;
  full_name: string | null;
  role: string | null;
  phone: string | null;
  telegram_username: string | null;
};

type VehicleRow = {
  id: string;
  tenant_id: string;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  road_tax_due_date: string | null;
  inspection_expires_at: string | null;
};

type InsuranceRow = {
  vehicle_id: string | null;
  tenant_id: string;
  end_date: string | null;
};

const reminderDays = new Set([7, 3, 1, 0]);

function authorized(request: NextRequest) {
  const expected = process.env.EPICENTER_MESSAGING_SECRET || process.env.LEAD_WEBHOOK_SECRET;
  if (!expected) return false;
  const header = request.headers.get("x-epicenter-messaging-secret") || request.headers.get("x-epicenter-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === expected || bearer === expected;
}

function dateKey(value: string | null | undefined) {
  return String(value ?? "").slice(0, 10);
}

function daysUntil(target: string, today: string) {
  const targetMs = Date.parse(`${target}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  if (Number.isNaN(targetMs) || Number.isNaN(todayMs)) return null;
  return Math.round((targetMs - todayMs) / 86400000);
}

function vehicleName(vehicle: VehicleRow) {
  return [vehicle.make, vehicle.model, vehicle.license_plate].filter(Boolean).join(" ") || "автомобиль";
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("ru-RU");
}

function messageFor(kind: "insurance" | "road_tax" | "inspection", vehicle: VehicleRow, dueDate: string, daysLeft: number) {
  const kindLabel =
    kind === "insurance"
      ? "страховку"
      : kind === "road_tax"
        ? "Por Ror Bor / road tax"
        : "техпроверку";
  const timing =
    daysLeft === 0
      ? "сегодня последний день"
      : daysLeft === 1
        ? "остался 1 день"
        : `осталось ${daysLeft} дня/дней`;

  return [
    "Дружелюбное напоминание CRM 🌿",
    "",
    `По машине ${vehicleName(vehicle)} нужно продлить ${kindLabel}.`,
    `Дата окончания: ${formatDate(dueDate)} (${timing}).`,
    "",
    "Это нормальная рабочая ситуация: аренду, бронирование и рекламу автомобиля CRM не блокирует.",
    "Пожалуйста, продлите документ и обновите дату в карточке автомобиля."
  ].join("\n");
}

async function sendMessage(recipient: Recipient, messageText: string) {
  const messagingSecret = process.env.EPICENTER_MESSAGING_SECRET || "00d57c65010537e2d52f8979d0ef8c88204410a4dcf7b6b36187879c08a05034";
  const sends: Promise<unknown>[] = [];

  if (recipient.phone) {
    sends.push(fetch(process.env.WHATSAPP_SEND_URL || "https://n8nx.pro/webhook/whatsappOutboundWfCR/webhook/epicenter-messaging/whatsapp/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-epicenter-messaging-secret": messagingSecret
      },
      body: JSON.stringify({ phoneNumber: recipient.phone, messageText })
    }).catch(() => undefined));
  }

  const telegram = String(recipient.telegram_username ?? "").trim().replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "").replace(/^@/, "");
  if (telegram) {
    sends.push(fetch(process.env.TELEGRAM_SEND_URL || "https://n8nx.pro/epicenter-messaging/telegram/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-epicenter-messaging-secret": messagingSecret
      },
      body: JSON.stringify({ TelegramUsername: `@${telegram}`, messageText })
    }).catch(() => undefined));
  }

  await Promise.all(sends);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const supabase = createServiceSupabaseClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const [{ data: recipients, error: recipientsError }, { data: vehicles, error: vehiclesError }, { data: insurance, error: insuranceError }] = await Promise.all([
    supabase
      .from("app_users")
      .select("id, tenant_id, full_name, role, phone, telegram_username")
      .eq("active", true)
      .or("role.eq.owner,full_name.ilike.%Thomas%,full_name.ilike.%Томас%"),
    supabase
      .from("vehicles")
      .select("id, tenant_id, make, model, license_plate, road_tax_due_date, inspection_expires_at")
      .not("status", "eq", "retired"),
    supabase
      .from("insurance")
      .select("tenant_id, vehicle_id, end_date")
      .order("end_date", { ascending: false })
  ]);

  if (recipientsError || vehiclesError || insuranceError) {
    return NextResponse.json({
      error: recipientsError?.message || vehiclesError?.message || insuranceError?.message
    }, { status: 500 });
  }

  const recipientsByTenant = new Map<string, Recipient[]>();
  for (const recipient of (recipients ?? []) as Recipient[]) {
    const current = recipientsByTenant.get(recipient.tenant_id) ?? [];
    if (!current.some((item) => item.id === recipient.id)) current.push(recipient);
    recipientsByTenant.set(recipient.tenant_id, current);
  }

  const latestInsuranceByVehicle = new Map<string, InsuranceRow>();
  for (const row of (insurance ?? []) as InsuranceRow[]) {
    if (!row.vehicle_id || latestInsuranceByVehicle.has(row.vehicle_id)) continue;
    latestInsuranceByVehicle.set(row.vehicle_id, row);
  }

  let reminders = 0;
  for (const vehicle of (vehicles ?? []) as VehicleRow[]) {
    const checks: Array<{ kind: "insurance" | "road_tax" | "inspection"; dueDate: string }> = [];
    const latestInsurance = latestInsuranceByVehicle.get(vehicle.id);
    const insuranceDue = dateKey(latestInsurance?.end_date);
    if (insuranceDue) checks.push({ kind: "insurance", dueDate: insuranceDue });
    const roadTaxDue = dateKey(vehicle.road_tax_due_date);
    if (roadTaxDue) checks.push({ kind: "road_tax", dueDate: roadTaxDue });
    const inspectionDue = dateKey(vehicle.inspection_expires_at);
    if (inspectionDue) checks.push({ kind: "inspection", dueDate: inspectionDue });

    for (const check of checks) {
      const daysLeft = daysUntil(check.dueDate, today);
      if (daysLeft === null || !reminderDays.has(daysLeft)) continue;
      const messageText = messageFor(check.kind, vehicle, check.dueDate, daysLeft);
      for (const recipient of recipientsByTenant.get(vehicle.tenant_id) ?? []) {
        await sendMessage(recipient, messageText);
        reminders += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, reminders, today });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
