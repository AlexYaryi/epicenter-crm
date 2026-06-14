import { notFound } from "next/navigation";
import { bookingStatusBadge, rentalStatusBadge, getProtectedCrmPage, money, SimpleModulePage, sourceLabel } from "@/app/components/CrmPages";
import { activateCustomerReferralAction, cancelBookingAction, createBookingAction, deleteBookingAction, deleteCustomerAction, sendCustomerMessageAction, updateCustomerAction, updateCustomerReferralLinkAction, updateLeadStageAction, markReferralPayoutPaidAction, uploadCustomerMediaAction, createLeadFromCustomerAction, mergeCustomersAction, recalculateCustomerMetricsAction } from "@/lib/actions";
import { getCustomerMessages } from "@/lib/repository";
import { CustomerConversation } from "@/app/components/CustomerConversation";
import { CustomerEditForm } from "@/app/components/CustomerEditForm";
import { BookingForm } from "@/app/components/BookingForm";
import { BookingRowActions } from "@/app/components/BookingRowActions";
import { MessageComposeForm } from "@/app/components/MessageComposeForm";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { formatDisplayDate } from "@/lib/i18n";
import { ReplaceVehicleForm } from "@/app/components/ReplaceVehicleForm";
import { CustomerDocumentsPanel } from "@/app/components/CustomerDocumentsPanel";
import { LeadProgressForm } from "@/app/components/LeadProgressForm";

type PageParams = {
  params: Promise<{ id: string }>;
};

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
}) {
  if (customer.has_valid_idp) return true;
  if (!customer.idp_number?.trim()) return false;
  const expiresAt = parseDateOnly(customer.idp_expires);
  if (!expiresAt) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiresAt >= today;
}

export default async function Page({ params }: PageParams) {
  const { id } = await params;
  const { data, locale, user } = await getProtectedCrmPage();
  const customer = data.customers.find((item) => item.id === id);

  if (!customer) {
    notFound();
  }

  const bookings = data.bookings.filter((booking) => booking.customer_id === customer.id || booking.customer_name === customer.full_name);
  const messages = await getCustomerMessages(customer.id, user.tenantId);
  const canEdit = user.role === "owner" || user.role === "manager" || user.role === "operator" || user.role === "marketer";
  const isOwner = user.role === "owner";
  const clientLeads = data.leads.filter((lead) => lead.customer_id === customer.id);
  const latestLead = clientLeads[clientLeads.length - 1];

  const ltv = customer.lifetime_value_thb ?? 0;
  let cohortLabel = "New";
  let cohortClass = "muted";
  let cohortDescr = "Менее 30 000 THB";
  if (locale === "en") cohortDescr = "Under 30,000 THB";

  if (ltv >= 100000) {
    cohortLabel = "VIP";
    cohortClass = "ok";
    cohortDescr = "Более 100 000 THB";
    if (locale === "en") cohortDescr = "Over 100,000 THB";
  } else if (ltv >= 30000) {
    cohortLabel = "Regular";
    cohortClass = "info";
    cohortDescr = "30 000 - 100 000 THB";
    if (locale === "en") cohortDescr = "30,000 - 100,000 THB";
  } else if (ltv === 0) {
    cohortLabel = "Lead";
    cohortClass = "muted";
    cohortDescr = "Нет завершенных аренд";
    if (locale === "en") cohortDescr = "No completed bookings";
  }

  const activePartners = data.partners?.filter((p) => p.active) || [];
  const referrer = data.partners?.find((p) => p.id === customer.referral_partner_id);
  const hasValidPermit = hasValidDrivingPermit(customer);

  const ownPartner = data.partners?.find((p) =>
    p.name.toLowerCase() === customer.full_name.toLowerCase() ||
    (customer.phone && p.contact === customer.phone) ||
    (customer.telegram_username && p.telegram === customer.telegram_username)
  );

  const referredCustomers = ownPartner ? data.customers.filter((c) => c.referral_partner_id === ownPartner.id) : [];
  const isRevenueRental = (booking: (typeof data.bookings)[number]) =>
    ["handed_over", "active", "in_use", "returning", "returned"].includes(booking.rental_status) ||
    ["handed_over", "active", "in_use", "returning", "completed"].includes(booking.status);

  const validBookings = bookings
    .filter(isRevenueRental)
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
  const firstBooking = validBookings[0];
  const hasPaidReferralPayout = customer.tags?.includes("referral_payout_completed");

  const hasLineMsg = messages.find(m => m.channel === "line");
  const hasInstaMsg = messages.find(m => m.channel === "instagram");
  const hasTiktokMsg = messages.find(m => m.channel === "tiktok");

  const lineHandle = customer.source === "line" ? customer.source_detail : hasLineMsg?.contact_handle;
  const instagramHandle = customer.source === "instagram" ? customer.source_detail : hasInstaMsg?.contact_handle;
  const tiktokHandle = customer.source === "tiktok" ? customer.source_detail : hasTiktokMsg?.contact_handle;

  return (
    <SimpleModulePage title={customer.full_name} subtitle="" locale={locale} activePath="/customers">
      
      {/* 💬 Ergonomic Split Layout: Chat on the Left, Details & Verification on the Right */}
      <section className="grid-2" style={{ alignItems: "start", marginBottom: "24px" }}>
        
        {/* ==================== LEFT COLUMN: CHAT ==================== */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          
          {/* Unified Communication Center Panel */}
          <div className="panel" style={{ margin: 0, display: "flex", flexDirection: "column", borderRadius: "12px", overflow: "hidden" }}>
            <div className="panel-head">
              <div>
                <h2>{locale === "en" ? "Communication Center" : "Центр общения"}</h2>
                <p className="sub">
                  {locale === "en"
                    ? "Inbound and outbound messages in real time via Epicenter gateways."
                    : "Просмотр входящих и отправка исходящих сообщений в реальном времени."}
                </p>
              </div>
            </div>
            
            {/* Scrollable Chat Area with stable, safe fixed height of 450px */}
            <div className="panel-body" style={{ height: "450px", overflowY: "auto", padding: "16px", background: "#f5fafb", borderBottom: "1px solid var(--line)" }}>
              <CustomerConversation customerId={customer.id} customerName={customer.full_name} initialMessages={messages} locale={locale} />
            </div>

            {/* Pinned Message Composer directly below the chat */}
            <div className="panel-body" style={{ background: "#ffffff", padding: "16px" }}>
              <MessageComposeForm
                action={sendCustomerMessageAction}
                locale={locale}
                entityType="customer"
                entityId={customer.id}
                recipientLabel={
                  customer.whatsapp || customer.phone || customer.telegram_username || lineHandle || instagramHandle || tiktokHandle || ""
                }
                defaultChannel={
                  customer.whatsapp || customer.phone
                    ? "whatsapp"
                    : customer.telegram_username
                    ? "telegram"
                    : lineHandle
                    ? "line"
                    : instagramHandle
                    ? "instagram"
                    : tiktokHandle
                    ? "tiktok"
                    : "whatsapp"
                }
                whatsappEnabled={Boolean(customer.whatsapp || customer.phone)}
                telegramEnabled={Boolean(customer.telegram_username)}
                lineEnabled={Boolean(lineHandle)}
                instagramEnabled={Boolean(instagramHandle)}
                tiktokEnabled={Boolean(tiktokHandle)}
                whatsappLabel={customer.whatsapp || customer.phone || ""}
                telegramLabel={customer.telegram_username || ""}
                lineLabel={lineHandle || ""}
                instagramLabel={instagramHandle || ""}
                tiktokLabel={tiktokHandle || ""}
              />
            </div>
          </div>
        </div>

        {/* ==================== RIGHT COLUMN: PROFILE & DETAILS ==================== */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Customer Profile Panel */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-head"><h2>{locale === "en" ? "Customer profile" : "Профиль клиента"}</h2></div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Phone" : "Телефон"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.phone ?? "-"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>WhatsApp</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.whatsapp ?? customer.phone ?? "-"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>Telegram</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.telegram_username ?? "-"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Source" : "Источник"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{sourceLabel(customer.source, locale)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Source detail" : "Источник / чат"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.source_detail ?? "-"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Passport name" : "Имя в паспорте"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.full_name_passport ?? "-"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Language" : "Язык"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.language_pref.toUpperCase()}</span>
              </div>
            </div>
          </div>

          {/* Documents Panel with Upload & Lightbox Preview */}
          <CustomerDocumentsPanel 
            customer={customer} 
            locale={locale} 
          />

          {/* LTV & Referral Status Panel */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-head">
              <h2>{locale === "en" ? "LTV & Referral Status" : "Аналитика LTV и Рефералы"}</h2>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px" }}>
              {canEdit ? (
                <ActionFeedbackForm
                  action={recalculateCustomerMetricsAction}
                  className="filters"
                  locale={locale}
                  savingText={locale === "en" ? "Recalculating metrics..." : "Пересчитываю метрики..."}
                  fallbackError={locale === "en" ? "Metrics were not recalculated." : "Метрики не пересчитаны."}
                >
                  <input type="hidden" name="customer_id" value={customer.id} />
                  <button className="button" type="submit">
                    {locale === "en" ? "Recalculate metrics" : "Пересчитать метрики"}
                  </button>
                </ActionFeedbackForm>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Lifetime Value (LTV)" : "Пожизненная ценность (LTV)"}</span>
                <span style={{ fontWeight: "bold", fontSize: "14px", color: "#28a745" }}>{money(customer.lifetime_value_thb ?? 0)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Total Bookings" : "Всего броней"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.total_bookings_count ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Last Booking Date" : "Дата последней брони"}</span>
                <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{customer.last_booking_date ? formatDisplayDate(customer.last_booking_date) : "-"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Customer Cohort" : "Когорта клиента"}</span>
                <span className={`badge ${cohortClass}`} style={{ fontWeight: "bold", fontSize: "12px", padding: "2px 8px" }}>
                  {cohortLabel} ({cohortDescr})
                </span>
              </div>
              
              <hr style={{ margin: "12px 0", border: "0", borderTop: "1px solid #eaeaea" }} />
              
              {customer.referral_partner_id ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Invited By" : "Приглашен партнером"}</span>
                    <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{referrer ? `${referrer.name} (${customer.promo_code_used || referrer.promo_code})` : (customer.promo_code_used || "-")}</span>
                  </div>
                  {firstBooking ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                        <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "First Rental Reward" : "Награда за 1-ю аренду"}</span>
                        <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{money(firstBooking.rental_amount * 0.1)} (10%)</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Payout Status" : "Статус выплаты"}</span>
                        {hasPaidReferralPayout ? (
                          <span className="badge ok" style={{ fontSize: "12px", padding: "2px 8px" }}>✓ {locale === "en" ? "Paid" : "Выплачено"}</span>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span className="badge warn" style={{ fontSize: "12px", padding: "2px 8px" }}>⚠ {locale === "en" ? "To Pay" : "К выплате"}</span>
                            {canEdit ? (
                              <ActionFeedbackForm action={markReferralPayoutPaidAction} locale={locale} savingText={locale === "en" ? "Saving..." : "Сохраняю..."}>
                                <input type="hidden" name="customer_id" value={customer.id} />
                                <input type="hidden" name="reward_amount" value={String(firstBooking.rental_amount * 0.1)} />
                                <button className="button ok-button" style={{ padding: "4px 10px", fontSize: "11px", height: "28px", minHeight: "28px", lineHeight: "1" }}>
                                  {locale === "en" ? "Mark Paid" : "Выплатить"}
                                </button>
                              </ActionFeedbackForm>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                        <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "First Booking" : "Первая аренда"}</span>
                        <span className="muted">{locale === "en" ? "No active/completed rentals yet" : "Нет активных/завершенных аренд"}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Payout Status" : "Статус выплаты"}</span>
                        <span className="badge muted" style={{ fontSize: "12px", padding: "2px 8px" }}>{locale === "en" ? "Not Accrued" : "Не начислено"}</span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div style={{ marginTop: "4px" }}>
                  <p className="muted" style={{ marginBottom: "8px", fontSize: "0.9rem" }}>
                    {locale === "en" ? "Not referred. Link to a partner/promo code:" : "Не приглашен рефералом. Привязать к партнеру/промокоду:"}
                  </p>
                  {canEdit ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", alignItems: "center" }}>
                      <ActionFeedbackForm action={updateCustomerReferralLinkAction} locale={locale} className="grid-2">
                        <input type="hidden" name="customer_id" value={customer.id} />
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", width: "100%" }}>
                          <select name="referral_partner_id" className="input" style={{ flex: "1", minWidth: "150px" }}>
                            <option value="">{locale === "en" ? "-- Choose Partner --" : "-- Выберите партнера --"}</option>
                            {activePartners.map(p => (
                              <option key={p.id} value={p.id}>{p.name} ({p.promo_code})</option>
                            ))}
                          </select>
                          <input type="text" name="promo_code_used" placeholder={locale === "en" ? "Promo Code" : "Промокод"} className="input" style={{ flex: "1", minWidth: "120px" }} />
                        </div>
                        <button className="button primary" style={{ height: "38px", minHeight: "38px" }}>
                          {locale === "en" ? "Link" : "Привязать"}
                        </button>
                      </ActionFeedbackForm>
                    </div>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Own Referral Program Panel */}
          <div className="panel" style={{ margin: 0 }}>
            <div className="panel-head">
              <h2>{locale === "en" ? "Own Referral Program" : "Собственная реферальная программа"}</h2>
            </div>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px" }}>
              {ownPartner ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Promo Code" : "Промокод"}</span>
                    <code style={{ fontSize: "1.2rem", color: "#0070f3", background: "#f0f8ff", padding: "2px 8px", borderRadius: "4px", fontWeight: "bold" }}>
                      {ownPartner.promo_code}
                    </code>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Referrals Count" : "Привлечено рефералов"}</span>
                    <span style={{ fontWeight: "600", fontSize: "13px", color: "var(--ink)" }}>{ownPartner.total_referrals} {locale === "en" ? "clients" : "клиентов"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid #f2fafa" }}>
                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>{locale === "en" ? "Total Commission Paid" : "Выплачено вознаграждений"}</span>
                    <span style={{ fontWeight: "bold", fontSize: "13px", color: "#0070f3" }}>{money(ownPartner.total_commission_paid)}</span>
                  </div>

                  {referredCustomers.length > 0 ? (
                    <div style={{ marginTop: "16px" }}>
                      <h3 style={{ fontSize: "1.05rem", marginBottom: "8px" }}>{locale === "en" ? "Referred Clients Details" : "Список привлеченных клиентов"}</h3>
                      <div className="table-wrap" style={{ maxHeight: "200px", overflowY: "auto" }}>
                        <table style={{ fontSize: "12px" }}>
                          <thead>
                            <tr>
                              <th>{locale === "en" ? "Client" : "Клиент"}</th>
                              <th>{locale === "en" ? "1st Rental" : "1-я аренда"}</th>
                              <th>{locale === "en" ? "Status" : "Статус"}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {referredCustomers.map((refCust) => {
                              const refBookings = data.bookings
                                .filter(b => b.customer_id === refCust.id || b.customer_name === refCust.full_name)
                                .filter(isRevenueRental)
                                .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
                              const refFirstBooking = refBookings[0];
                              const refHasPaid = refCust.tags?.includes("referral_payout_completed");

                              return (
                                <tr key={refCust.id}>
                                  <td>
                                    <a href={`/customers/${refCust.id}`}>{refCust.full_name}</a>
                                  </td>
                                  <td>
                                    {refFirstBooking ? money(refFirstBooking.rental_amount) : "-"}
                                  </td>
                                  <td>
                                    {refFirstBooking ? (
                                      refHasPaid ? (
                                        <span className="badge ok" style={{ fontSize: "10px", padding: "1px 4px" }}>✓ {locale === "en" ? "Paid" : "Выплачено"}</span>
                                      ) : (
                                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                          <span className="badge warn" style={{ fontSize: "10px", padding: "1px 4px" }}>⚠ {locale === "en" ? "To Pay" : "К выплате"}</span>
                                          {canEdit ? (
                                            <ActionFeedbackForm action={markReferralPayoutPaidAction} locale={locale}>
                                              <input type="hidden" name="customer_id" value={refCust.id} />
                                              <input type="hidden" name="reward_amount" value={String(refFirstBooking.rental_amount * 0.1)} />
                                              <button className="button ok-button" style={{ padding: "0 4px", fontSize: "9px", height: "18px", minHeight: "18px" }}>
                                                {locale === "en" ? "Pay" : "Выплатить"}
                                              </button>
                                            </ActionFeedbackForm>
                                          ) : null}
                                        </div>
                                      )
                                    ) : (
                                      <span className="badge muted" style={{ fontSize: "10px", padding: "1px 4px" }}>{locale === "en" ? "No bookings" : "Нет броней"}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="blankslate" style={{ padding: "16px", textAlign: "center", border: "1px dashed #ccc", borderRadius: "6px" }}>
                  <p className="muted" style={{ fontSize: "0.9rem" }}>
                    {locale === "en" ? "This customer doesn't have an active referral code yet." : "У этого клиента еще нет активного реферального кода."}</p>
                  {canEdit ? (
                    <div style={{ marginTop: "12px" }}>
                      <ActionFeedbackForm action={activateCustomerReferralAction} locale={locale} savingText={locale === "en" ? "Activating..." : "Активирую..."}>
                        <input type="hidden" name="customer_id" value={customer.id} />
                        <button className="button primary-button">
                          {locale === "en" ? "Generate Referral Code" : "Создать реферальный код"}
                        </button>
                      </ActionFeedbackForm>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {canEdit ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Edit customer" : "Редактировать клиента"}</h2>
              <p className="sub">{locale === "en" ? "Update contacts, documents, IDP and source." : "Обновить контакты, документы, IDP и источник."}</p>
            </div>
          </div>
          <div className="panel-body">
            <CustomerEditForm action={updateCustomerAction} customer={customer} locale={locale} />
          </div>
        </section>
      ) : null}

      {canEdit && (!latestLead || ["not_lead", "lost", "booked", "completed"].includes(String(latestLead.stage))) ? (
        <section className="panel" style={{ borderLeft: "4px solid var(--yellow-color, #eab308)", marginBottom: "24px" }}>
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Start Sales Deal" : "Начать сделку (провести по воронке)"}</h2>
              <p className="sub">
                {locale === "en"
                  ? "This customer has no active sales deal. Create a new lead to guide them through the sales funnel."
                  : "У этого клиента сейчас нет активной сделки. Создайте лид, чтобы провести его по воронке продаж."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <ActionFeedbackForm action={createLeadFromCustomerAction} locale={locale} redirectBasePath="/leads" savingText={locale === "en" ? "Creating deal..." : "Создаю сделку..."}>
              <input type="hidden" name="customer_id" value={customer.id} />
              <button className="button primary">{locale === "en" ? "🔑 Start Sales Deal" : "🔑 Начать новую сделку"}</button>
            </ActionFeedbackForm>
          </div>
        </section>
      ) : null}

      {canEdit && latestLead && !["not_lead", "lost", "booked", "completed"].includes(String(latestLead.stage)) ? (
        <section className="panel" style={{ borderLeft: "4px solid #0070f3", marginBottom: "24px" }}>
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Move through pipeline" : "Вести по воронке"}</h2>
              <p className="sub">{locale === "en" ? "Set the next stage, reminder and concrete next action." : "Поставьте следующий этап, напоминание и конкретное следующее действие."}</p>
            </div>
          </div>
          <div className="panel-body">
            <LeadProgressForm action={updateLeadStageAction} leadId={latestLead.id} currentStage={latestLead.stage} nextAction={latestLead.next_action} reminderAt={latestLead.reminder_at} locale={locale} />
          </div>
        </section>
      ) : null}

      {canEdit && latestLead && latestLead.stage !== "not_lead" ? (
        <section className="panel" style={{ borderLeft: "4px solid #dc3545" }}>
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Mark as Non-Lead" : "Отметить как Не лид"}</h2>
              <p className="sub">
                {locale === "en"
                  ? "If this conversation is spam or not related to car rental, mark it to exclude from pipeline statistics."
                  : "Если этот диалог — спам или не относится к аренде авто, отметьте его для исключения из статистики лидов."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <ActionFeedbackForm action={updateLeadStageAction} locale={locale} savingText={locale === "en" ? "Processing..." : "Обрабатываю..."}>
              <input type="hidden" name="lead_id" value={latestLead.id} />
              <input type="hidden" name="status" value="not_lead" />
              <input type="hidden" name="next_action" value="Переведено в Не лид из карточки клиента" />
              <button className="button danger-button">{locale === "en" ? "Move to Non-Lead" : "Перевести в Не лид"}</button>
            </ActionFeedbackForm>
          </div>
        </section>
      ) : null}

      {isOwner ? (
        <section className="panel" style={{ borderLeft: "4px solid #dc3545", marginTop: "24px" }}>
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Danger Zone" : "Опасная зона"}</h2>
              <p className="sub">
                {locale === "en"
                  ? "Permanently delete this customer or merge them with another customer."
                  : "Безвозвратное удаление карточки клиента или объединение с другим клиентом."}
              </p>
            </div>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            
            {/* Merge customer */}
            <div style={{ padding: "16px", background: "#fff5f5", border: "1px solid #ffe3e3", borderRadius: "8px" }}>
              <h3 style={{ margin: "0 0 8px 0", color: "#c53030", fontSize: "16px" }}>
                {locale === "en" ? "🔗 Merge into another client" : "🔗 Объединить с другим клиентом"}
              </h3>
              <p className="sub" style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#742a2a" }}>
                {locale === "en"
                  ? "This will transfer all bookings, leads, and messages from this client to the target client, and then delete this client."
                  : "Все брони, сделки и сообщения этого клиента будут перенесены на целевого клиента, после чего эта карточка будет безвозвратно удалена."}
              </p>
              
              <ActionFeedbackForm
                action={mergeCustomersAction}
                locale={locale}
                savingText={locale === "en" ? "Merging..." : "Объединяю..."}
                redirectBasePath="/customers"
                confirmText={locale === "en" 
                  ? "Are you sure you want to merge this customer? This will delete the current customer record and move all their data!" 
                  : "Вы уверены, что хотите объединить этого клиента? Это удалит текущую карточку и перенесет все связанные данные!"}
              >
                <input type="hidden" name="source_customer_id" value={customer.id} />
                <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <select name="target_customer_id" className="input" required style={{ flex: "1", minWidth: "200px" }}>
                    <option value="">{locale === "en" ? "-- Select target client to merge into --" : "-- Выберите целевого клиента --"}</option>
                    {data.customers
                      .filter((c) => c.id !== customer.id)
                      .sort((a, b) => a.full_name.localeCompare(b.full_name))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name} ({c.phone ?? c.whatsapp ?? c.telegram_username ?? "нет контактов"})
                        </option>
                      ))}
                  </select>
                  <button className="button danger-button" style={{ height: "38px" }}>
                    {locale === "en" ? "Merge Clients" : "Объединить"}
                  </button>
                </div>
              </ActionFeedbackForm>
            </div>

            {/* Permanent delete */}
            <div style={{ padding: "16px", background: "#fff5f5", border: "1px solid #ffe3e3", borderRadius: "8px" }}>
              <h3 style={{ margin: "0 0 8px 0", color: "#c53030", fontSize: "16px" }}>
                {locale === "en" ? "🗑 Delete Customer Record" : "🗑 Удалить карточку клиента"}
              </h3>
              <p className="sub" style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#742a2a" }}>
                {locale === "en"
                  ? "Permanently delete this customer record. Fails if there are linked bookings or messages (use merge instead)."
                  : "Безвозвратное удаление карточки клиента. Не сработает, если есть связанные бронирования или сообщения (в этом случае используйте объединение)."}
              </p>
              <ActionFeedbackForm
                action={deleteCustomerAction}
                locale={locale}
                savingText={locale === "en" ? "Deleting..." : "Удаляю..."}
                confirmText={locale === "en" ? "Are you sure you want to permanently delete this customer?" : "Вы уверены, что хотите безвозвратно удалить этого клиента?"}
              >
                <input type="hidden" name="customer_id" value={customer.id} />
                <button className="button danger-button">
                  {locale === "en" ? "🗑 Delete Customer" : "🗑 Удалить клиента"}
                </button>
              </ActionFeedbackForm>
            </div>

          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head"><h2>{locale === "en" ? "Bookings history" : "История броней"}</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{locale === "en" ? "Booking" : "Бронь"}</th><th>{locale === "en" ? "Vehicle" : "Автомобиль"}</th><th>{locale === "en" ? "Dates" : "Даты"}</th><th>{locale === "en" ? "Status" : "Статус"}</th><th>{locale === "en" ? "Total" : "Сумма"}</th><th>{locale === "en" ? "Actions" : "Действия"}</th></tr></thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td><a href={`/bookings/${booking.id}`}>{booking.booking_number}</a></td>
                  <td>
                    <a href={`/fleet/${booking.vehicle_id}`} style={{ fontWeight: 800 }}>{booking.vehicle}</a>
                    {["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"].includes(booking.status) || ["handed_over", "active", "in_use", "returning"].includes(booking.rental_status) ? (
                      <div style={{ marginTop: "6px" }}>
                        <ReplaceVehicleForm 
                          bookingId={booking.id}
                          currentVehicleId={booking.vehicle_id}
                          startDate={booking.start_date}
                          endDate={booking.end_date}
                          actualEnd={booking.actual_end}
                          vehicles={data.vehicles}
                          allBookings={data.bookings}
                          maintenance={data.maintenance}
                          locale={locale}
                          compact={true}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td>{formatDisplayDate(booking.start_date)} - {formatDisplayDate(booking.end_date)}</td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {bookingStatusBadge(booking.status, locale)}
                      {rentalStatusBadge(booking.rental_status, locale)}
                    </div>
                  </td>
                  <td>{money(booking.grand_total)}</td>
                  <td>
                    <BookingRowActions
                      bookingId={booking.id}
                      bookingStatus={booking.status}
                      canDelete={["owner", "manager"].includes(user.role)}
                      locale={locale}
                      cancelAction={cancelBookingAction}
                      deleteAction={deleteBookingAction}
                    />
                  </td>
                </tr>
              ))}
              {bookings.length === 0 ? <tr><td colSpan={6}>{locale === "en" ? "No bookings yet" : "Броней пока нет"}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Book a vehicle for this customer" : "Забронировать авто этому клиенту"}</h2>
            <p className="sub">{locale === "en" ? "Choose a vehicle and create the booking from the customer card." : "Выберите автомобиль и создайте бронь из карточки клиента."}</p>
          </div>
        </div>
        <div className="panel-body">
          <BookingForm
            action={createBookingAction}
            tenantId={user.tenantId}
            locale={locale}
            customers={data.customers}
            vehicles={data.vehicles}
            existingBookings={data.bookings}
            fixedCustomerId={customer.id}
            defaultDailyRate={390}
            defaultMonthlyRate={11700}
            defaultDeposit={5000}
            submitLabel={locale === "en" ? "Create booking" : "Создать бронь"}
          />
        </div>
      </section>
    </SimpleModulePage>
  );
}
