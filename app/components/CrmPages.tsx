import { redirect } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { BookingForm } from "@/app/components/BookingForm";
import { BookingMediaUploadForm } from "@/app/components/BookingMediaUploadForm";
import { BookingPaymentsForm } from "@/app/components/BookingPaymentsForm";
import { BookingStatusButton } from "@/app/components/BookingStatusButton";
import { CustomerQuickForm } from "@/app/components/CustomerQuickForm";
import { LanguageSwitch } from "@/app/components/LanguageSwitch";
import { LeadCaptureForm } from "@/app/components/LeadCaptureForm";
import { LeadProgressForm } from "@/app/components/LeadProgressForm";
import { MessageCenter } from "@/app/components/MessageCenter";
import { getLocale, tr } from "@/lib/i18n";
import { isActiveLeadStage, leadStageMeta, leadStages } from "@/lib/lead-stages";
import { getCurrentUserContext, getDashboardData } from "@/lib/repository";
import type { Locale } from "@/lib/i18n";
import type { CurrentUserContext } from "@/lib/repository";
import type { DashboardData, VehicleCategory } from "@/lib/types";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import {
  createBookingAction,
  createCustomerAction,
  createInsuranceAction,
  createLeadAction,
  createVehicleAction,
  recordBookingPaymentsAction,
  recordRoadTaxAction,
  updateBookingStatusAction,
  updateLeadStageAction,
  uploadBookingMediaAction
} from "@/lib/actions";

type PageProps = {
  user: CurrentUserContext;
  data: DashboardData;
  locale: Locale;
};

export async function getProtectedCrmPage(): Promise<PageProps> {
  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    redirect("/login");
  }
  const data = await getDashboardData();
  const locale = await getLocale();
  return { user, data, locale };
}

export function PageFrame({
  title,
  subtitle,
  action,
  locale,
  activePath = "/",
  children
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  locale: Locale;
  activePath?: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell activePath={activePath}>
      <header className="topbar">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="sub topbar-sub">{subtitle}</p> : null}
        </div>
        <div className="topbar-actions">
          <MessageCenter locale={locale} />
          <LanguageSwitch locale={locale} />
          {action}
        </div>
      </header>
      <div className="content">{children}</div>
    </AppShell>
  );
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} THB`;
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    economy: "Эконом",
    comfort: "Комфорт",
    suv: "SUV",
    premium: "Премиум",
    pickup: "Пикап",
    convertible: "Кабриолет"
  };
  return labels[category] ?? category;
}

function statusBadge(status: string) {
  const danger = ["lost", "cancelled", "retired", "repair", "UNDERPERFORMING", "DECOMMISSION_RECOMMENDED"];
  const ok = ["available", "completed", "RECOVERED", "PROFIT_GENERATING", "booked"];
  const cls = danger.includes(status) ? "danger" : ok.includes(status) ? "ok" : "info";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function bookingStatusLabel(status: string, locale: Locale) {
  const labels: Record<string, { ru: string; en: string }> = {
    draft: { ru: "черновик", en: "draft" },
    confirmed: { ru: "бронь подтверждена", en: "confirmed" },
    paid_deposit: { ru: "депозит оплачен", en: "deposit paid" },
    handed_over: { ru: "выдано", en: "handed over" },
    active: { ru: "в аренде", en: "active rental" },
    returning: { ru: "возврат", en: "returning" },
    completed: { ru: "завершено", en: "completed" },
    cancelled: { ru: "отменено", en: "cancelled" },
    no_show: { ru: "не приехал", en: "no show" }
  };
  const item = labels[status];
  return item ? tx(locale, item.ru, item.en) : status;
}

export function bookingStatusBadge(status: string, locale: Locale) {
  const danger = ["cancelled", "no_show"];
  const ok = ["handed_over", "active", "completed"];
  const warn = ["confirmed", "paid_deposit", "returning"];
  const cls = danger.includes(status) ? "danger" : ok.includes(status) ? "ok" : warn.includes(status) ? "warn" : "info";
  return <span className={`badge ${cls}`}>{bookingStatusLabel(status, locale)}</span>;
}

function vehicleStatusLabel(status: string, locale: Locale) {
  const labels: Record<string, { ru: string; en: string }> = {
    available: { ru: "свободно", en: "available" },
    reserved: { ru: "есть брони", en: "booked" },
    confirmed: { ru: "есть брони", en: "booked" },
    paid_deposit: { ru: "есть брони", en: "booked" },
    handed_over: { ru: "в аренде", en: "rented" },
    active: { ru: "в аренде", en: "rented" },
    in_use: { ru: "в аренде", en: "rented" },
    returning: { ru: "в аренде", en: "rented" },
    maintenance: { ru: "техническое обслуживание", en: "maintenance" },
    repair: { ru: "ремонт", en: "repair" },
    retired: { ru: "выведено", en: "retired" }
  };
  const item = labels[status];
  if (!item) return status;
  return locale === "en" ? item.en : item.ru;
}

function vehicleStatusBadge(status: string, locale: Locale) {
  const rented = ["handed_over", "active", "in_use", "returning"];
  const booked = ["reserved", "confirmed", "paid_deposit"];
  const cls = rented.includes(status) ? "ok" : booked.includes(status) ? "warn" : status === "repair" ? "danger" : status === "maintenance" ? "info" : "ok";
  return <span className={`badge ${cls}`}>{vehicleStatusLabel(status, locale)}</span>;
}

function tx(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

function sourceLabel(source: string | null | undefined, locale: Locale) {
  const labels: Record<string, { ru: string; en: string }> = {
    whatsapp: { ru: "WhatsApp", en: "WhatsApp" },
    telegram: { ru: "Telegram", en: "Telegram" },
    telegram_chat: { ru: "Telegram", en: "Telegram" },
    telegram_channel: { ru: "Telegram канал", en: "Telegram channel" },
    instagram: { ru: "Instagram", en: "Instagram" },
    facebook: { ru: "Facebook", en: "Facebook" },
    google_ads: { ru: "Google Ads", en: "Google Ads" },
    referral_marina: { ru: "Реферал", en: "Referral" },
    walk_in: { ru: "Walk-in", en: "Walk-in" },
    other: { ru: "Другое", en: "Other" }
  };
  const key = source ?? "";
  const label = labels[key];
  return label ? tx(locale, label.ru, label.en) : key || "-";
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateInRange(day: string, start: string, end: string) {
  return day >= start && day <= end;
}

function bookingForVehicleDay(vehicle: DashboardData["vehicles"][number], bookings: DashboardData["bookings"], day: string) {
  return bookings.find((booking) => {
    const sameVehicle = booking.vehicle_id === vehicle.id || booking.vehicle === vehicle.id || booking.vehicle === vehicle.license_plate || booking.vehicle.includes(vehicle.license_plate);
    return sameVehicle && dateInRange(day, booking.start_date, booking.end_date);
  });
}

function MiniBarChart({ values, labels, tone = "aqua" }: { values: number[]; labels: string[]; tone?: "aqua" | "sun" }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mini-bars">
      {values.map((value, index) => (
        <div className="mini-bar-col" key={`${labels[index]}-${index}`}>
          <div className="mini-bar-track">
            <span className={`mini-bar-fill ${tone}`} style={{ height: `${Math.max(5, (value / max) * 100)}%` }} />
          </div>
          <small>{labels[index]}</small>
        </div>
      ))}
    </div>
  );
}

function ProgressRow({ label, value, detail, tone = "aqua" }: { label: string; value: number; detail: string; tone?: "aqua" | "sun" | "danger" }) {
  return (
    <div className="progress-row">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <div className="progress-track">
        <span className={`progress-fill ${tone}`} style={{ width: `${clampPct(value)}%` }} />
      </div>
      <b>{clampPct(value)}%</b>
    </div>
  );
}

export function DashboardPage({ user, data, locale }: PageProps) {
  const canSeeStrategic = user.role === "owner" || user.role === "accountant";
  const workingLeads = data.leads.filter((lead) => isActiveLeadStage(lead.stage));
  const leadQueue = workingLeads.length;
  const bookedLeads = data.leads.filter((lead) => lead.stage === "booked").length;
  const conversionBase = workingLeads.length + bookedLeads + data.leads.filter((lead) => lead.stage === "lost").length;
  const leadConversion = conversionBase ? Math.round((bookedLeads / conversionBase) * 100) : 0;
  const recovered = data.vehicles.filter((vehicle) => vehicle.status_financial === "RECOVERED" || vehicle.status_financial === "PROFIT_GENERATING").length;
  const revenueToday = data.bookings.reduce((sum, booking) => sum + booking.grand_total, 0);
  const vehiclesTotal = data.vehicles.length || 1;
  const availableVehicles = data.vehicles.filter((vehicle) => vehicle.status === "available").length;
  const serviceVehicles = data.vehicles.filter((vehicle) => ["maintenance", "repair"].includes(vehicle.status)).length;
  const reservedVehicles = data.vehicles.filter((vehicle) => vehicle.status === "reserved").length;
  const rentedVehicles = data.vehicles.filter((vehicle) => ["handed_over", "in_use", "returning"].includes(vehicle.status)).length;
  const recoveredPct = data.vehicles.length ? Math.round((recovered / data.vehicles.length) * 100) : 0;
  const utilizationAvg = data.vehicles.length ? Math.round(data.vehicles.reduce((sum, vehicle) => sum + vehicle.utilization_90, 0) / data.vehicles.length) : 0;
  const paybackAvg = data.vehicles.length ? Math.round(data.vehicles.reduce((sum, vehicle) => sum + vehicle.payback_pct, 0) / data.vehicles.length) : 0;
  const revpadAvg = data.vehicles.length ? Math.round(data.vehicles.reduce((sum, vehicle) => sum + vehicle.revpad, 0) / data.vehicles.length) : 0;
  const underperformers = data.vehicles.filter((vehicle) => vehicle.status_financial === "UNDERPERFORMING" || vehicle.performance_band === "BOTTOM_QUARTILE");
  const docsAlerts = data.vehicles.filter((vehicle) => !vehicle.insurance_expires_at || !vehicle.road_tax_due_date || vehicle.insurance_expires_at <= dateKey(addDays(new Date(), 7)) || vehicle.road_tax_due_date <= dateKey(addDays(new Date(), 7))).length;
  const revenueBars = [0.54, 0.67, 0.59, 0.72, 0.81, 0.76, 1].map((factor) => Math.round(revenueToday * factor));
  const calendarDays = Array.from({ length: 21 }, (_, index) => dateKey(addDays(new Date(), index)));
  const statusTotal = availableVehicles + rentedVehicles + reservedVehicles + serviceVehicles || 1;
  const rentedDeg = (rentedVehicles / statusTotal) * 360;
  const reservedDeg = ((rentedVehicles + reservedVehicles) / statusTotal) * 360;
  const serviceDeg = ((rentedVehicles + reservedVehicles + serviceVehicles) / statusTotal) * 360;

  return (
    <PageFrame
      title="Epicenter Rental OS"
      subtitle={tr(locale, "dashboardSubtitle")}
      locale={locale}
      activePath="/"
      action={<a className="primary" href="/settings">{tr(locale, "loginRoles")}</a>}
    >
      <section className="kpis">
        <div className="card">
          <div className="metric-label">{tx(locale, "Выручка в активных бронях", "Revenue in active bookings")}</div>
          <div className="metric-value">{money(revenueToday)}</div>
          <div className="muted">{tx(locale, "Сумма по текущей базе броней", "Total from current booking base")}</div>
        </div>
        <div className="card">
          <div className="metric-label">{tx(locale, "Загрузка флота 90 дней", "Fleet utilization 90d")}</div>
          <div className="metric-value">{utilizationAvg}%</div>
          <div className="muted">{tx(locale, "Цель: выше 70%", "Target: above 70%")}</div>
        </div>
        {canSeeStrategic ? (
          <div className="card">
            <div className="metric-label">{tx(locale, "Окупаемость флота", "Fleet payback")}</div>
            <div className="metric-value">{paybackAvg}%</div>
            <div className="muted">{recoveredPct}% {tx(locale, "машин recovered", "vehicles recovered")}</div>
          </div>
        ) : (
          <div className="card">
            <div className="metric-label">{tx(locale, "Конверсия лидов", "Lead conversion")}</div>
            <div className="metric-value">{leadConversion}%</div>
            <div className="muted">{bookedLeads} / {conversionBase} {tx(locale, "рабочих лидов стали бронями", "working leads became bookings")}</div>
          </div>
        )}
        <div className="card">
          <div className="metric-label">{tx(locale, "Тревоги сегодня", "Alerts today")}</div>
          <div className="metric-value">{leadQueue + docsAlerts + (canSeeStrategic ? underperformers.length : 0)}</div>
          <div className="muted">{leadQueue} {tx(locale, "лидов", "leads")} · {docsAlerts} compliance{canSeeStrategic ? ` · ${underperformers.length} ROI` : ""}</div>
        </div>
      </section>

      <section className="grid-2 dashboard-main">
        <div className="panel fleet-health">
          <div className="panel-head">
            <div>
              <h2>{tx(locale, "Здоровье автопарка", "Fleet health")}</h2>
              <p className="sub">{tx(locale, "Статусы машин, загрузка, простои и документы одним взглядом.", "Vehicle statuses, utilization, downtime and compliance at a glance.")}</p>
            </div>
          </div>
          <div className="panel-body fleet-health-body">
            <div className="donut-wrap">
              <div
                className="status-donut"
                style={{
                  background: `conic-gradient(var(--ok) 0deg ${rentedDeg}deg, var(--sun) ${rentedDeg}deg ${reservedDeg}deg, var(--danger) ${reservedDeg}deg ${serviceDeg}deg, var(--aqua) ${serviceDeg}deg 360deg)`
                }}
              >
                <span>{data.vehicles.length}</span>
                <small>{tx(locale, "машин", "cars")}</small>
              </div>
              <div className="legend">
                <span><i className="dot ok" />{tx(locale, "в аренде", "rented")} <b>{rentedVehicles}</b></span>
                <span><i className="dot sun" />{tx(locale, "бронь", "reserved")} <b>{reservedVehicles}</b></span>
                <span><i className="dot danger" />{tx(locale, "сервис", "service")} <b>{serviceVehicles}</b></span>
                <span><i className="dot aqua" />{tx(locale, "свободно", "available")} <b>{availableVehicles}</b></span>
              </div>
            </div>
            <div className="health-bars">
              <ProgressRow label={tx(locale, "Utilization", "Utilization")} value={utilizationAvg} detail={tx(locale, "средняя загрузка за 90 дней", "average 90-day load")} tone={utilizationAvg >= 70 ? "aqua" : "danger"} />
              {canSeeStrategic ? (
                <>
                  <ProgressRow label="Payback" value={paybackAvg} detail={tx(locale, "средний прогресс окупаемости", "average payback progress")} tone={paybackAvg >= 80 ? "sun" : "aqua"} />
                  <ProgressRow label="Recovered" value={recoveredPct} detail={tx(locale, "доля окупившихся машин", "share of recovered vehicles")} tone="sun" />
                </>
              ) : (
                <>
                  <ProgressRow label={tx(locale, "Lead conversion", "Lead conversion")} value={leadConversion} detail={tx(locale, "конверсия из лида в бронь", "lead to booking conversion")} tone="sun" />
                  <ProgressRow label={tx(locale, "Open leads", "Open leads")} value={Math.min(100, leadQueue * 10)} detail={tx(locale, "лиды, требующие ответа", "leads that need follow-up")} tone={leadQueue ? "danger" : "aqua"} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{canSeeStrategic ? tx(locale, "Деньги и спрос", "Money and demand") : tx(locale, "Спрос и продажи", "Demand and sales")}</h2>
              <p className="sub">{canSeeStrategic ? `RevPAD ${money(revpadAvg)} · ` : ""}{tx(locale, "роль", "role")}: {user.role}</p>
            </div>
          </div>
          <div className="panel-body">
            <MiniBarChart
              labels={tx(locale, ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].join("|"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].join("|")).split("|")}
              values={revenueBars}
              tone="sun"
            />
            <div className="insight-grid">
              <div><strong>{canSeeStrategic ? money(revpadAvg) : `${leadConversion}%`}</strong><span>{canSeeStrategic ? "RevPAD avg" : tx(locale, "конверсия", "conversion")}</span></div>
              <div><strong>{data.bookings.length}</strong><span>{tx(locale, "активных броней", "bookings tracked")}</span></div>
              <div><strong>{leadQueue}</strong><span>{tx(locale, "лидов в работе", "leads in work")}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{tx(locale, "Календарь автопарка на 21 день", "Fleet calendar for 21 days")}</h2>
            <p className="sub">{tx(locale, "Зеленый - аренда, желтый - бронь, красный - сервис, бирюзовый - свободно.", "Green - rented, yellow - reserved, red - service, aqua - available.")}</p>
          </div>
          <a className="button" href="/fleet">{tx(locale, "Открыть автопарк", "Open fleet")}</a>
        </div>
        <div className="fleet-calendar">
          <div className="fleet-calendar-head">
            <span>{tx(locale, "Авто", "Vehicle")}</span>
            {calendarDays.map((day) => <b key={day}>{day.slice(5)}</b>)}
          </div>
          {data.vehicles.map((vehicle) => (
            <div className="fleet-calendar-row" key={vehicle.id}>
              <a href={`/fleet/${vehicle.id}`}><strong>{vehicle.license_plate}</strong><small>{vehicle.make} {vehicle.model}</small></a>
              {calendarDays.map((day) => {
                const booking = bookingForVehicleDay(vehicle, data.bookings, day);
                const service = ["maintenance", "repair"].includes(vehicle.status);
                const cls = service ? "service" : booking ? (["confirmed", "paid_deposit", "reserved"].includes(booking.status) ? "reserved" : "rented") : vehicle.status === "reserved" ? "reserved" : "free";
                const title = booking ? `${booking.booking_number}: ${booking.status}` : service ? vehicle.status : tx(locale, "Свободно", "Available");
                return <span className={`calendar-cell ${cls}`} title={title} key={`${vehicle.id}-${day}`} />;
              })}
            </div>
          ))}
        </div>
      </section>

      {canSeeStrategic ? <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{tx(locale, "ROI по машинам", "Vehicle ROI")}</h2>
              <p className="sub">{tx(locale, "Какие активы кормят бизнес, а какие требуют решения.", "Which assets feed the business and which need a decision.")}</p>
            </div>
            <a className="button" href="/finance">ROI</a>
          </div>
          <div className="panel-body roi-list">
            {data.vehicles
              .slice()
              .sort((a, b) => b.revpad - a.revpad)
              .map((vehicle) => (
                <ProgressRow
                  key={vehicle.id}
                  label={`${vehicle.make} ${vehicle.model}`}
                  value={vehicle.payback_pct}
                  detail={`${vehicle.license_plate} · RevPAD ${money(vehicle.revpad)} · ${vehicle.performance_band}`}
                  tone={vehicle.status_financial === "UNDERPERFORMING" ? "danger" : vehicle.payback_pct >= 100 ? "sun" : "aqua"}
                />
              ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{tx(locale, "Что требует внимания", "Needs attention")}</h2>
              <p className="sub">{tx(locale, "Система выводит только то, что влияет на деньги, риск или продажи.", "Only items that affect money, risk or sales.")}</p>
            </div>
          </div>
          <div className="panel-body">
            {underperformers.map((vehicle) => (
              <div className="task attention" key={vehicle.id}>
                <strong>{vehicle.make} {vehicle.model} · {vehicle.license_plate}</strong>
                <span className="muted">Payback {vehicle.payback_pct}% · Utilization {vehicle.utilization_90}% · {vehicle.status_financial}</span>
                <a className="button" href={`/fleet/${vehicle.id}`}>{tx(locale, "Разобрать", "Review")}</a>
              </div>
            ))}
            {docsAlerts ? (
              <div className="task attention">
                <strong>{tx(locale, "Документы и compliance", "Documents and compliance")}</strong>
                <span className="muted">{docsAlerts} {tx(locale, "машин требуют проверки страховки или налога", "vehicles need insurance or tax review")}</span>
                <a className="button" href="/insurance">{tx(locale, "Проверить", "Check")}</a>
              </div>
            ) : null}
            {leadQueue ? (
              <div className="task">
                <strong>{tx(locale, "Лиды без закрытия", "Open leads")}</strong>
                <span className="muted">{leadQueue} {tx(locale, "лидов в работе, SLA ответа критичен", "leads in work, first response SLA matters")}</span>
                <a className="button" href="/leads">{tx(locale, "Открыть", "Open")}</a>
              </div>
            ) : null}
          </div>
        </div>
      </section> : null}

      <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{tr(locale, "operationsQueue")}</h2>
              <p className="sub">{tr(locale, "todayWork")}</p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            <table>
              <thead><tr><th>{tr(locale, "type")}</th><th>{tr(locale, "object")}</th><th>{tr(locale, "status")}</th><th>{tr(locale, "action")}</th></tr></thead>
              <tbody>
                {workingLeads.slice(0, 5).map((lead) => (
                  <tr key={lead.id}><td>{tr(locale, "lead")}</td><td>{lead.customer_name}</td><td>{statusBadge(lead.stage)}</td><td>{lead.next_action}</td></tr>
                ))}
                {data.bookings.slice(0, 5).map((booking) => (
                  <tr key={booking.id}><td>{tr(locale, "booking")}</td><td>{booking.booking_number}</td><td>{bookingStatusBadge(booking.status, locale)}</td><td>{booking.start_date} - {booking.end_date}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {canSeeStrategic ? <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{tr(locale, "topRecommendations")}</h2>
              <p className="sub">Rule-based ROI engine.</p>
            </div>
          </div>
          <div className="panel-body">
            {data.recommendations.length ? data.recommendations.slice(0, 5).map((item) => (
              <div className="task" key={item.id}>
                <strong>{item.type}</strong>
                <span className="muted">{item.reasoning}</span>
                <span className="badge warn">confidence {item.confidence}%</span>
              </div>
            )) : <p className="muted">{tr(locale, "recommendationsAfterJob")}</p>}
          </div>
        </div> : null}
      </section>
    </PageFrame>
  );
}

export function FleetPage({ user, data, locale, selectedCategory = "all" }: PageProps & { selectedCategory?: "all" | VehicleCategory | "weak" }) {
  const canManageFleet = user.role === "owner" || user.role === "manager" || user.role === "marketer";
  const canSeeStrategic = user.role === "owner" || user.role === "accountant";
  const categories: ["all" | VehicleCategory, string][] = [
    ["all", tr(locale, "all")],
    ["economy", tr(locale, "economy")],
    ["comfort", tr(locale, "comfort")],
    ["suv", tr(locale, "suv")],
    ["pickup", tr(locale, "pickup")],
    ["convertible", tr(locale, "convertible")]
  ];
  const visibleVehicles =
    selectedCategory === "all"
      ? data.vehicles
      : selectedCategory === "weak"
        ? data.vehicles.filter((vehicle) => vehicle.status_financial === "UNDERPERFORMING")
        : data.vehicles.filter((vehicle) => vehicle.category === selectedCategory);

  return (
    <PageFrame title={tr(locale, "fleetTitle")} subtitle="" locale={locale} activePath="/fleet" action={<a className="primary" href="/api/vehicles">API vehicles</a>}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{tr(locale, "vehicles")}</h2>
            <p className="sub">{tr(locale, "clickCategory")}</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="filters">
            {categories.map(([key, label]) => {
              const count = key === "all" ? data.vehicles.length : data.vehicles.filter((vehicle) => vehicle.category === key).length;
              const href = key === "all" ? "/fleet" : `/fleet?category=${key}`;
              return <a className={`chip ${selectedCategory === key ? "active" : ""}`} href={href} key={key}>{label}<b>{count}</b></a>;
            })}
            <a className={`chip ${selectedCategory === "weak" ? "active" : ""}`} href="/fleet?category=weak">
              {tr(locale, "weakAssets")}<b>{data.vehicles.filter((vehicle) => vehicle.status_financial === "UNDERPERFORMING").length}</b>
            </a>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tx(locale, "Фото", "Photo")}</th><th>{tr(locale, "vehicle")}</th><th>{tr(locale, "category")}</th><th>{tr(locale, "status")}</th><th>{tr(locale, "price")}</th>{canSeeStrategic ? <><th>RevPAD</th><th>Payback</th></> : null}</tr></thead>
            <tbody>
              {visibleVehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td>
                    <a href={`/fleet/${vehicle.id}`} className="fleet-thumb">
                      {vehicle.photos[0] ? <img src={vehicle.photos[0]} alt={`${vehicle.make} ${vehicle.model}`} /> : <span>{tx(locale, "Нет фото", "No photo")}</span>}
                    </a>
                  </td>
                  <td>
                    <a href={`/fleet/${vehicle.id}`} className="fleet-car-title"><strong>{vehicle.make} {vehicle.model}</strong></a>
                    <span className="fleet-plate">{vehicle.license_plate}</span>
                    <span className="muted">{vehicle.location}</span>
                  </td>
                  <td>{categoryLabel(vehicle.category)}</td>
                  <td>{vehicleStatusBadge(vehicle.status, locale)}</td>
                  <td>{tr(locale, "fromRate30", { rate: vehicle.daily_rate_long_term })}</td>
                  {canSeeStrategic ? <><td>{money(vehicle.revpad)}</td><td><span className="badge warn">{vehicle.payback_pct}%</span></td></> : null}
                </tr>
              ))}
              {visibleVehicles.length === 0 ? (
                <tr>
                  <td colSpan={canSeeStrategic ? 7 : 5}>
                    <span className="muted">{tr(locale, "noVehiclesCategory")}</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {canManageFleet ? <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "addVehicle")}</h2></div>
        <div className="panel-body">
          <ActionFeedbackForm action={createVehicleAction} className="form-grid" locale={locale} savingText={tx(locale, "Добавляю автомобиль...", "Adding vehicle...")} fallbackError={tx(locale, "Автомобиль не добавлен. Проверьте данные.", "Vehicle was not added.")}>
            <input type="hidden" name="tenant_id" value={user.tenantId} />
            <div className="field"><label>{tr(locale, "location")}</label><select name="location_id">{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
            <div className="field"><label>{tx(locale, "Номер", "Plate")}</label><input name="license_plate" placeholder="กม-2026" required /></div>
            <div className="field"><label>{tx(locale, "Марка", "Make")}</label><input name="make" placeholder="Toyota" required /></div>
            <div className="field"><label>{tx(locale, "Модель", "Model")}</label><input name="model" placeholder="Vios" required /></div>
            <div className="field"><label>{tx(locale, "Год", "Year")}</label><input name="year" type="number" defaultValue="2022" required /></div>
            <div className="field"><label>VIN</label><input name="vin" /></div>
            <div className="field"><label>{tx(locale, "Цвет", "Color")}</label><input name="color" /></div>
            <div className="field"><label>{tr(locale, "status")}</label><select name="status"><option value="available">{vehicleStatusLabel("available", locale)}</option><option value="reserved">{vehicleStatusLabel("reserved", locale)}</option><option value="in_use">{vehicleStatusLabel("in_use", locale)}</option><option value="maintenance">{vehicleStatusLabel("maintenance", locale)}</option><option value="repair">{vehicleStatusLabel("repair", locale)}</option></select></div>
            <div className="field"><label>{tx(locale, "Кузов", "Body type")}</label><select name="body_type"><option value="sedan">{tx(locale, "Седан", "Sedan")}</option><option value="suv">SUV</option><option value="pickup">{tr(locale, "pickup")}</option><option value="hatchback">{tx(locale, "Хэтчбек", "Hatchback")}</option><option value="convertible">{tr(locale, "convertible")}</option></select></div>
            <div className="field"><label>{tr(locale, "category")}</label><select name="category"><option value="economy">{tr(locale, "economy")}</option><option value="comfort">{tr(locale, "comfort")}</option><option value="suv">SUV</option><option value="pickup">{tr(locale, "pickup")}</option><option value="convertible">{tr(locale, "convertible")}</option></select></div>
            <div className="field"><label>{tx(locale, "Топливо", "Fuel")}</label><input name="fuel_type" defaultValue="gasoline" /></div>
            <div className="field"><label>{tx(locale, "Коробка", "Transmission")}</label><select name="transmission"><option value="auto">{tx(locale, "Автомат", "Automatic")}</option><option value="manual">{tx(locale, "Механика", "Manual")}</option></select></div>
            <div className="field"><label>{tx(locale, "Мест", "Seats")}</label><input name="seats" type="number" defaultValue="5" /></div>
            <div className="field"><label>{tx(locale, "Пробег", "Mileage")}</label><input name="mileage_current" type="number" defaultValue="0" /></div>
            <div className="field"><label>{tx(locale, "Тип владения", "Ownership")}</label><select name="ownership_type"><option value="own">own</option><option value="partner">partner</option><option value="leased">leased</option></select></div>
            {canSeeStrategic ? <div className="field"><label>{tx(locale, "Стоимость покупки", "Acquisition cost")}</label><input name="acquisition_cost_thb" type="number" defaultValue="0" /></div> : <input type="hidden" name="acquisition_cost_thb" value="0" />}
            <div className="field"><label>{tx(locale, "Дата покупки", "Acquisition date")}</label><input name="acquisition_date" type="date" required /></div>
            <div className="field"><label>Short-term / {tx(locale, "день", "day")}</label><input name="daily_rate_short_term" type="number" defaultValue="1200" required /></div>
            <div className="field"><label>Long-term / {tx(locale, "день", "day")}</label><input name="daily_rate_long_term" type="number" defaultValue="390" required /></div>
            <div className="field"><label>{tx(locale, "Месяц", "Month")}</label><input name="monthly_rate" type="number" defaultValue="11700" required /></div>
            <div className="field"><label>{tr(locale, "deposit")}</label><input name="deposit_amount" type="number" defaultValue="5000" /></div>
            <div className="field"><label>{tx(locale, "Порядок на сайте", "Website sort order")}</label><input name="public_sort_order" type="number" defaultValue="100" /></div>
            <div className="field checkbox-field"><label><input name="public_visible" type="checkbox" defaultChecked /> {tx(locale, "Показывать на сайте", "Show on website")}</label></div>
            <div className="field wide"><label>{tx(locale, "Публичное описание RU", "Public description RU")}</label><textarea name="public_description_ru" /></div>
            <div className="field wide"><label>{tx(locale, "Public description EN", "Public description EN")}</label><textarea name="public_description_en" /></div>
            <div className="field wide"><label>{tx(locale, "Особенности через запятую", "Features comma-separated")}</label><input name="public_features" placeholder="Bluetooth, child seat, airport delivery" /></div>
            <div className="field wide"><label>{tx(locale, "Внутренние заметки", "Internal notes")}</label><textarea name="notes_internal" /></div>
            <div className="field wide"><button className="primary">{tr(locale, "saveVehicle")}</button></div>
          </ActionFeedbackForm>
        </div>
      </section> : null}
    </PageFrame>
  );
}

export function CustomersPage({ user, data, locale }: PageProps) {
  return (
    <PageFrame title={tr(locale, "customersTitle")} subtitle={tr(locale, "customersSubtitle")} locale={locale} activePath="/customers" action={<a className="primary" href="/leads">{tr(locale, "createLead")}</a>}>
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "customerBase")}</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "customer")}</th><th>{tr(locale, "contact")}</th><th>{tr(locale, "source")}</th><th>{tr(locale, "passport")}</th><th>IDP</th><th>{tr(locale, "language")}</th></tr></thead>
            <tbody>
              {data.customers.map((customer) => (
                <tr key={customer.id}>
                  <td><a href={`/customers/${customer.id}`}><strong>{customer.full_name}</strong></a><br /><span className="muted">{customer.full_name_passport ?? tr(locale, "passportNameMissing")}</span></td>
                  <td>{customer.phone ?? customer.whatsapp ?? customer.telegram_username ?? "-"}</td>
                  <td>{sourceLabel(customer.source, locale)}<br /><span className="muted">{customer.source_detail ?? ""}</span></td>
                  <td>{customer.passport_number ?? "-"}<br /><span className="muted">{customer.passport_expires ?? ""}</span></td>
                  <td>{customer.has_valid_idp ? <span className="badge ok">{tr(locale, "valid")}</span> : <span className="badge danger">{tr(locale, "idpNeeded")}</span>}<br /><span className="muted">{customer.idp_number ?? ""}</span></td>
                  <td>{customer.language_pref.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "addCustomer")}</h2></div>
        <div className="panel-body">
          <CustomerQuickForm action={createCustomerAction} tenantId={user.tenantId} locale={locale} showFullFields />
        </div>
      </section>
    </PageFrame>
  );
}

export function LeadsPage({ user, data, locale }: PageProps) {
  const activeLeads = data.leads.filter((lead) => isActiveLeadStage(lead.stage)).length;
  const notLeads = data.leads.filter((lead) => lead.stage === "not_lead").length;

  return (
    <PageFrame title={tr(locale, "leadsTitle")} subtitle={tr(locale, "leadsSubtitle")} locale={locale} activePath="/leads">
      <section className="filters">
        <span className="chip active">{tx(locale, "Лидогенерация", "Lead generation")} <b>{data.leads.filter((lead) => lead.stage === "new").length}</b></span>
        <span className="chip active">{tx(locale, "Продажа", "Sales")} <b>{activeLeads}</b></span>
        <span className="chip active">{tx(locale, "Операции", "Operations")} <b>{data.leads.filter((lead) => lead.stage === "booked").length}</b></span>
        <span className="chip active">{tx(locale, "Ретеншн", "Retention")} <b>{data.leads.filter((lead) => lead.stage === "lost").length}</b></span>
        <span className="chip active">{tx(locale, "Не лиды", "Not leads")} <b>{notLeads}</b></span>
      </section>
      <section className="kanban">
        {leadStages.map((stage) => (
          <div className="col" key={stage}>
            <strong>{locale === "en" ? leadStageMeta[stage].en : leadStageMeta[stage].ru}</strong>
            <p className="muted">{locale === "en" ? leadStageMeta[stage].zoneEn : leadStageMeta[stage].zoneRu}</p>
            <p className="muted">{locale === "en" ? leadStageMeta[stage].descEn : leadStageMeta[stage].descRu}</p>
            <div className="filters">
              {(locale === "en" ? leadStageMeta[stage].actionsEn : leadStageMeta[stage].actionsRu).map((action) => <span className="chip" key={action}>{action}</span>)}
            </div>
            {data.leads.filter((lead) => lead.stage === stage).map((lead) => (
              <div className="task" key={lead.id}>
                <div className="lead-card-head">
                  <a href={`/leads/${lead.id}`}><strong>{lead.customer_name}</strong></a>
                  <a className="button lead-open-button" href={`/leads/${lead.id}`}>{tx(locale, "Работать", "Work")}</a>
                </div>
                <span className="muted">{sourceLabel(lead.channel, locale)} · score {lead.score}</span>
                <span className="lead-note">{lead.note}</span>
                <LeadProgressForm action={updateLeadStageAction} leadId={lead.id} currentStage={lead.stage} nextAction={lead.next_action} reminderAt={lead.reminder_at} locale={locale} compact />
              </div>
            ))}
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "captureLead")}</h2></div>
        <div className="panel-body">
          <LeadCaptureForm action={createLeadAction} tenantId={user.tenantId} locale={locale} />
        </div>
      </section>
    </PageFrame>
  );
}

export function BookingsPage({ user, data, locale }: PageProps) {
  return (
    <PageFrame title={tr(locale, "bookingsTitle")} subtitle={tr(locale, "bookingsSubtitle")} locale={locale} activePath="/bookings">
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "currentBookings")}</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "booking")}</th><th>{tr(locale, "customer")}</th><th>{tr(locale, "vehicle")}</th><th>{tr(locale, "dates")}</th><th>{tr(locale, "amount")}</th><th>{tr(locale, "status")}</th></tr></thead>
            <tbody>{data.bookings.map((booking) => <tr key={booking.id}><td><a href={`/bookings/${booking.id}`}>{booking.booking_number}</a></td><td>{booking.customer_id ? <a href={`/customers/${booking.customer_id}`}>{booking.customer_name}</a> : booking.customer_name}</td><td>{booking.vehicle_id ? <a href={`/fleet/${booking.vehicle_id}`}>{booking.vehicle}</a> : booking.vehicle}</td><td>{booking.start_date} - {booking.end_date}</td><td>{money(booking.grand_total)}</td><td>{bookingStatusBadge(booking.status, locale)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "createBooking")}</h2></div>
        <div className="panel-body">
          <BookingForm
            action={createBookingAction}
            tenantId={user.tenantId}
            locale={locale}
            customers={data.customers}
            vehicles={data.vehicles}
            defaultDailyRate={390}
            defaultMonthlyRate={11700}
            defaultDeposit={5000}
            submitLabel={tr(locale, "createBooking")}
          />
        </div>
      </section>
    </PageFrame>
  );
}

export function HandoverPage({ user, data, locale }: PageProps) {
  const actionableBookings = data.bookings.filter((booking) => ["confirmed", "paid_deposit", "handed_over", "active", "returning"].includes(booking.status));
  const queuePriority: Record<string, number> = { returning: 0, confirmed: 1, paid_deposit: 2, active: 3, handed_over: 4 };
  const sortedActionableBookings = [...actionableBookings].sort((left, right) => {
    const priorityDiff = (queuePriority[left.status] ?? 9) - (queuePriority[right.status] ?? 9);
    if (priorityDiff !== 0) return priorityDiff;
    const leftDate = ["confirmed", "paid_deposit"].includes(left.status) ? left.start_date : left.end_date;
    const rightDate = ["confirmed", "paid_deposit"].includes(right.status) ? right.start_date : right.end_date;
    return leftDate.localeCompare(rightDate);
  });
  const pickupQueue = sortedActionableBookings.filter((booking) => ["confirmed", "paid_deposit"].includes(booking.status));
  const activeRentals = sortedActionableBookings.filter((booking) => ["handed_over", "active"].includes(booking.status));
  const returnQueue = sortedActionableBookings.filter((booking) => booking.status === "returning" || booking.end_date <= dateKey(addDays(new Date(), 1)));
  const booking = sortedActionableBookings[0];
  return (
    <PageFrame title={tr(locale, "handoverTitle")} subtitle={tr(locale, "handoverSubtitle")} locale={locale} activePath="/handover">
      <section className="grid-3">
        <div className="card">
          <div className="metric-label">{tx(locale, "Ближайшие выдачи", "Upcoming handovers")}</div>
          <div className="metric-value">{pickupQueue.length}</div>
          <div className="muted">{tx(locale, "confirmed / paid deposit", "confirmed / paid deposit")}</div>
        </div>
        <div className="card">
          <div className="metric-label">{tx(locale, "Сейчас в аренде", "Currently rented")}</div>
          <div className="metric-value">{activeRentals.length}</div>
          <div className="muted">{tx(locale, "активные договоры", "active rentals")}</div>
        </div>
        <div className="card">
          <div className="metric-label">{tx(locale, "Возвраты", "Returns")}</div>
          <div className="metric-value">{returnQueue.length}</div>
          <div className="muted">{tx(locale, "сегодня / завтра / returning", "today / tomorrow / returning")}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{tx(locale, "Очередь выдачи и возврата", "Handover and return queue")}</h2>
            <p className="sub">{tx(locale, "Все брони и текущие аренды, по которым оператор оформляет выдачу или возврат.", "All bookings and active rentals that operators process for handover or return.")}</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "booking")}</th><th>{tr(locale, "customer")}</th><th>{tr(locale, "vehicle")}</th><th>{tr(locale, "dates")}</th><th>{tr(locale, "status")}</th><th>{tx(locale, "Действие", "Action")}</th></tr></thead>
            <tbody>
              {sortedActionableBookings.map((item) => {
                const actionLabel = ["confirmed", "paid_deposit"].includes(item.status)
                  ? tx(locale, "Оформить выдачу", "Process handover")
                  : tx(locale, "Оформить возврат", "Process return");
                return (
                  <tr key={item.id}>
                    <td><a href={`/bookings/${item.id}`}>{item.booking_number}</a></td>
                    <td>{item.customer_id ? <a href={`/customers/${item.customer_id}`}>{item.customer_name}</a> : item.customer_name}</td>
                    <td>{item.vehicle_id ? <a href={`/fleet/${item.vehicle_id}`}>{item.vehicle}</a> : item.vehicle}</td>
                    <td>{item.start_date} - {item.end_date}</td>
                    <td>{bookingStatusBadge(item.status, locale)}</td>
                    <td>
                      <div className="action-stack">
                        <a className="button" href={`/bookings/${item.id}`}>{actionLabel}</a>
                        <BookingStatusButton
                          action={updateBookingStatusAction}
                          bookingId={item.id}
                          status={["confirmed", "paid_deposit"].includes(item.status) ? "handed_over" : item.status === "returning" ? "completed" : "returning"}
                          label={["confirmed", "paid_deposit"].includes(item.status)
                            ? tx(locale, "Выдать", "Hand over")
                            : item.status === "returning"
                              ? tx(locale, "Завершить", "Complete")
                              : tx(locale, "К возврату", "Start return")}
                          locale={locale}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedActionableBookings.length === 0 ? <tr><td colSpan={6}>{tr(locale, "createBookingFirst")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {booking ? (
        <section className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>{tx(locale, "Быстрое оформление", "Quick processing")} · {booking.booking_number}</h2>
                <p className="sub">{booking.customer_name} · {booking.vehicle} · {booking.start_date} - {booking.end_date}</p>
              </div>
              <span>{bookingStatusBadge(booking.status, locale)}</span>
            </div>
            <div className="panel-body">
              <div className="media-grid">
                {[
                  ["handover-media", "handover_video", tx(locale, "Видео фиксации авто", "Vehicle video evidence"), "video"],
                  ["handover-media", "car_photos", tx(locale, "Фото авто / повреждения", "Car / damage photos"), ""],
                  ["customer-documents", "driver_license", tx(locale, "Фото прав клиента", "Customer license photo"), ""],
                  ["customer-documents", "passport", tx(locale, "Фото паспорта клиента", "Customer passport photo"), ""],
                  ["return-media", "return_video", tx(locale, "Видео возврата", "Return video"), "video"]
                ].map(([bucket, field, label, type]) => (
                  <BookingMediaUploadForm
                    action={uploadBookingMediaAction}
                    bookingId={booking.id}
                    bucket={bucket}
                    field={field}
                    label={label}
                    type={type === "video" ? "video" : "image"}
                    locale={locale}
                    key={field}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h2>{tr(locale, "paymentByBooking")}</h2></div>
            <div className="panel-body">
              <BookingPaymentsForm action={recordBookingPaymentsAction} booking={booking} tenantId={user.tenantId} locale={locale} />
            </div>
          </div>
        </section>
      ) : <section className="panel"><div className="panel-body">{tr(locale, "createBookingFirst")}</div></section>}
    </PageFrame>
  );
}

export function InsurancePage({ user, data, locale }: PageProps) {
  return (
    <PageFrame title={tr(locale, "insuranceTitle")} subtitle={tr(locale, "insuranceSubtitle")} locale={locale} activePath="/insurance">
      <ComplianceTable kind="insurance" vehicles={data.vehicles} locale={locale} />
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "addInsurance")}</h2></div>
        <div className="panel-body">
          <ActionFeedbackForm action={createInsuranceAction} className="form-grid" locale={locale} savingText={tx(locale, "Сохраняю страховку...", "Saving insurance...")} fallbackError={tx(locale, "Страховка не сохранена.", "Insurance was not saved.")}>
            <input type="hidden" name="tenant_id" value={user.tenantId} />
            <div className="field"><label>{tr(locale, "vehicle")}</label><select name="vehicle_id">{data.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.license_plate} · {vehicle.make} {vehicle.model}</option>)}</select></div>
            <div className="field"><label>{tx(locale, "Тип", "Type")}</label><select name="type"><option value="1st_class">1st class</option><option value="2nd_class">2nd class</option><option value="3rd_class">3rd class</option><option value="CMI_compulsory">CMI compulsory</option></select></div>
            <div className="field"><label>{tr(locale, "provider")}</label><input name="provider" placeholder="Viriyah / Roojai / Bangkok Insurance" required /></div>
            <div className="field"><label>{tr(locale, "policy")}</label><input name="policy_number" required /></div>
            <div className="field"><label>{tr(locale, "start")}</label><input name="start_date" type="date" required /></div>
            <div className="field"><label>{tr(locale, "end")}</label><input name="end_date" type="date" required /></div>
            <div className="field"><label>{tr(locale, "premium")}</label><input name="premium_amount" type="number" required /></div>
            <div className="field"><label>{tr(locale, "deductible")}</label><input name="deductible" type="number" defaultValue="0" /></div>
            <div className="field wide"><button className="primary">{tr(locale, "saveInsurance")}</button></div>
          </ActionFeedbackForm>
        </div>
      </section>
    </PageFrame>
  );
}

export function TaxPage({ user, data, locale }: PageProps) {
  return (
    <PageFrame title={tr(locale, "taxTitle")} subtitle={tr(locale, "taxSubtitle")} locale={locale} activePath="/tax">
      <ComplianceTable kind="tax" vehicles={data.vehicles} locale={locale} />
      <section className="panel">
        <div className="panel-head"><h2>{tr(locale, "recordTax")}</h2></div>
        <div className="panel-body">
          <ActionFeedbackForm action={recordRoadTaxAction} className="form-grid" locale={locale} savingText={tx(locale, "Записываю оплату налога...", "Recording tax payment...")} fallbackError={tx(locale, "Налог не записан.", "Tax payment was not recorded.")}>
            <input type="hidden" name="tenant_id" value={user.tenantId} />
            <div className="field"><label>{tr(locale, "vehicle")}</label><select name="vehicle_id">{data.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.license_plate} · {vehicle.make} {vehicle.model}</option>)}</select></div>
            <div className="field"><label>{tr(locale, "amount")}</label><input name="amount_thb" type="number" required /></div>
            <div className="field"><label>{tr(locale, "paidAt")}</label><input name="paid_at" type="date" required /></div>
            <div className="field"><label>{tr(locale, "periodFrom")}</label><input name="period_from" type="date" required /></div>
            <div className="field"><label>{tr(locale, "periodTo")}</label><input name="period_to" type="date" required /></div>
            <div className="field"><label>{tr(locale, "paidTo")}</label><input name="paid_to" placeholder="DLT / insurer" /></div>
            <div className="field wide"><button className="primary">{tr(locale, "saveTax")}</button></div>
          </ActionFeedbackForm>
        </div>
      </section>
    </PageFrame>
  );
}

function ComplianceTable({ kind, vehicles, locale }: { kind: "insurance" | "tax"; vehicles: DashboardData["vehicles"]; locale: Locale }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>{kind === "insurance" ? tr(locale, "insuranceTitle") : tr(locale, "taxTitle")}</h2></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "vehicle")}</th><th>{tr(locale, "companyContact")}</th><th>{tr(locale, "expiresAt")}</th><th>{tr(locale, "reminders")}</th><th>{tr(locale, "status")}</th></tr></thead>
          <tbody>
            {vehicles.map((vehicle) => {
              const due = kind === "insurance" ? vehicle.insurance_expires_at : vehicle.road_tax_due_date;
              return (
                <tr key={vehicle.id}>
                  <td><strong>{vehicle.license_plate}</strong><br /><span className="muted">{vehicle.make} {vehicle.model}</span></td>
                  <td>{kind === "insurance" ? (vehicle.insurance_provider || tr(locale, "notFilled")) : "DLT / Por Ror Bor"}<br /><span className="muted">{kind === "insurance" ? (vehicle.insurance_phone || tr(locale, "phoneAdd")) : tr(locale, "reminders")}</span></td>
                  <td>{due || tr(locale, "notFilled")}</td>
                  <td><span className="badge warn">{tx(locale, "7 дней", "7 days")}</span> <span className="badge warn">{tx(locale, "3 дня", "3 days")}</span> <span className="badge danger">{tx(locale, "1 день", "1 day")}</span></td>
                  <td>{due ? <span className="badge ok">tracked</span> : <span className="badge danger">{tr(locale, "needFill")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SimpleModulePage({ title, subtitle, locale, activePath, children }: { title: string; subtitle: string; locale: Locale; activePath: string; children: React.ReactNode }) {
  return <PageFrame title={title} subtitle={subtitle} locale={locale} activePath={activePath}>{children}</PageFrame>;
}

export { money, sourceLabel, statusBadge, vehicleStatusBadge, vehicleStatusLabel };
