"use client";

import React, { useState } from "react";
import { money, sourceLabel, statusBadge } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { formatDisplayDate } from "@/lib/i18n";
import { markReferralPayoutPaidAction } from "@/lib/actions";
import { calculateBookingRevenue } from "@/lib/payment-status";

type AnalyticsDashboardProps = {
  data: any; // DashboardData
  locale: Locale;
  user: any;
};

export function AnalyticsDashboard({ data, locale, user }: AnalyticsDashboardProps) {
  const [activeTab, setActiveTab] = useState<"funnel" | "ltv" | "referrals">("funnel");
  
  // Filter States
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [assignedOperator, setAssignedOperator] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [vehicleCategory, setVehicleCategory] = useState("");

  const bookings = data.bookings || [];
  const leads = data.leads || [];
  const customers = data.customers || [];
  const partners = data.partners || [];
  const isRevenueRental = (booking: any) =>
    ["handed_over", "active", "in_use", "returning", "returned"].includes(booking.rental_status) ||
    ["handed_over", "active", "in_use", "returning", "completed"].includes(booking.status);

  // Reset Filters
  const handleResetFilters = () => {
    setStartDate("");
    setEndDate("");
    setAssignedOperator("");
    setLeadSource("");
    setVehicleCategory("");
  };

  // Date Check Helper
  const filterByDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return true;
    const formatted = dateStr.slice(0, 10);
    if (startDate && formatted < startDate) return false;
    if (endDate && formatted > endDate) return false;
    return true;
  };

  // Filtered Datasets
  const filteredLeads = leads.filter((l: any) => {
    if (!filterByDate(l.reminder_at)) return false;
    if (leadSource && l.channel !== leadSource) return false;
    if (vehicleCategory && l.category !== vehicleCategory) return false;
    return true;
  });

  const filteredBookings = bookings.filter((b: any) => {
    if (!filterByDate(b.start_date)) return false;
    if (vehicleCategory) {
      const vehicle = data.vehicles.find((v: any) => v.id === b.vehicle_id);
      if (vehicle?.category !== vehicleCategory) return false;
    }
    return true;
  });

  const filteredDeliveries = filteredBookings.filter(isRevenueRental);

  // Dynamic LTV Calculations per Customer
  const customerLTV = new Map<string, number>();
  const customerBookingsCount = new Map<string, number>();
  const customerFirstDate = new Map<string, string>();
  const customerLastDate = new Map<string, string>();

  // Sort Bookings Chronologically
  const chronBookings = [...bookings].sort((a: any, b: any) => a.start_date.localeCompare(b.start_date));
  for (const b of chronBookings) {
    if (!b.customer_id) continue;
    const isCompleted = isRevenueRental(b);
    const amount = isCompleted ? calculateBookingRevenue(b) : 0;
    
    if (isCompleted) {
      customerBookingsCount.set(b.customer_id, (customerBookingsCount.get(b.customer_id) || 0) + 1);
      customerLTV.set(b.customer_id, (customerLTV.get(b.customer_id) || 0) + amount);
      
      if (!customerFirstDate.has(b.customer_id)) {
        customerFirstDate.set(b.customer_id, b.start_date);
      }
      customerLastDate.set(b.customer_id, b.start_date);
    }
  }

  // Filtered Clients
  const filteredClients = customers.filter((c: any) => {
    if (leadSource && c.source !== leadSource) return false;
    const hasBookings = customerBookingsCount.has(c.id);
    if (!hasBookings) return false; // Only count customers who actually rented
    return true;
  });

  // Unique Operators for filters
  const operators = Array.from(new Set(leads.map((l: any) => l.assigned_operator || "").filter(Boolean))) as string[];
  // Unique Sources for filters
  const sources = Array.from(new Set(customers.map((c: any) => c.source || "").filter(Boolean))) as string[];
  // Unique Vehicle Categories
  const categories = ["economy", "comfort", "suv", "premium", "pickup", "convertible", "7seater"];

  // Excel Export URL Handler
  const handleExcelExport = () => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (assignedOperator) params.set("assigned_operator", assignedOperator);
    if (leadSource) params.set("source", leadSource);
    if (vehicleCategory) params.set("category", vehicleCategory);
    
    window.location.href = `/api/analytics/export?${params.toString()}`;
  };

  // Funnel Sheet Calculations
  const leadsCount = filteredLeads.length;
  const bookingsCount = filteredBookings.length;
  const deliveriesCount = filteredDeliveries.length;
  const totalRevenue = filteredDeliveries.reduce((sum: number, b: any) => sum + calculateBookingRevenue(b), 0);

  const convLeadBooking = leadsCount ? Math.round((bookingsCount / leadsCount) * 100) : 0;
  const convBookingDelivery = bookingsCount ? Math.round((deliveriesCount / bookingsCount) * 100) : 0;
  const convLeadDelivery = leadsCount ? Math.round((deliveriesCount / leadsCount) * 100) : 0;
  const avgCheck = deliveriesCount ? Math.round(totalRevenue / deliveriesCount) : 0;

  // Leads by source breakdown
  const leadsBySource: Record<string, number> = {};
  filteredLeads.forEach((l: any) => {
    leadsBySource[l.channel] = (leadsBySource[l.channel] || 0) + 1;
  });

  // Revenue by source breakdown
  const revenueBySource: Record<string, number> = {};
  filteredDeliveries.forEach((d: any) => {
    const cust = customers.find((c: any) => c.id === d.customer_id);
    const src = cust?.source || "other";
    revenueBySource[src] = (revenueBySource[src] || 0) + calculateBookingRevenue(d);
  });

  // --- LTV COHORT CALCULATIONS ---
  let cohortNew = 0;
  let cohortReturning = 0;
  let cohortLoyal = 0;
  let totalCalculatedLTV = 0;

  filteredClients.forEach((c: any) => {
    const count = customerBookingsCount.get(c.id) || 0;
    const ltv = customerLTV.get(c.id) || 0;
    totalCalculatedLTV += ltv;
    
    if (count === 1) cohortNew++;
    else if (count === 2) cohortReturning++;
    else if (count >= 3) cohortLoyal++;
  });

  const avgLTV = filteredClients.length ? Math.round(totalCalculatedLTV / filteredClients.length) : 0;

  // LTV by Traffic Source
  const ltvBySource: Record<string, { total: number; count: number }> = {};
  filteredClients.forEach((c: any) => {
    const src = c.source || "other";
    const ltv = customerLTV.get(c.id) || 0;
    if (!ltvBySource[src]) ltvBySource[src] = { total: 0, count: 0 };
    ltvBySource[src].total += ltv;
    ltvBySource[src].count += 1;
  });

  // --- REFERRALS & PAYOUTS CALCULATIONS ---
  const partnersMap = new Map<string, any>(partners.map((p: any) => [p.id, p]));
  const referredCustomers = customers.filter((c: any) => c.referral_partner_id);

  // Strictly 10% from the first booking of referred customer
  const referralsList: any[] = [];
  const payoutsSummary = new Map<string, { count: number; earned: number; paid: number }>();

  for (const c of referredCustomers) {
    const partner = partnersMap.get(c.referral_partner_id!);
    if (!partner) continue;

    // First chronologically completed/active booking
    const clientBookings = chronBookings.filter((b: any) => b.customer_id === c.id && isRevenueRental(b));
    const firstBooking = clientBookings[0];

    const firstBookingDate = firstBooking ? firstBooking.start_date : null;
    const firstRentalAmount = firstBooking ? firstBooking.rental_amount : 0;
    const reward = firstBooking ? Math.round(firstRentalAmount * 0.1) : 0;

    let commissionStatus: "pending" | "to_pay" | "paid" = "pending";
    if (firstBooking) {
      const isPaid = (c.tags || []).includes("referral_payout_completed");
      commissionStatus = isPaid ? "paid" : "to_pay";
    }

    referralsList.push({
      customerId: c.id,
      customerName: c.full_name,
      partnerId: partner.id,
      partnerName: partner.name,
      promoCode: partner.promo_code,
      bookingNumber: firstBooking ? firstBooking.booking_number : "-",
      bookingAmount: firstRentalAmount,
      rewardAmount: reward,
      status: commissionStatus,
      date: firstBookingDate
    });

    // Payout balances
    const currentCalc = payoutsSummary.get(partner.id) || { count: 0, earned: 0, paid: partner.total_commission_paid || 0 };
    if (firstBooking) {
      currentCalc.count += 1;
      currentPayoffAccumulator(partner.id, reward, payoutsSummary, partner.total_commission_paid);
    }
  }

  function currentPayoffAccumulator(partnerId: string, reward: number, map: Map<string, any>, totalPaid: number) {
    const current = map.get(partnerId) || { count: 0, earned: 0, paid: totalPaid };
    current.count += 1;
    current.earned += reward;
    map.set(partnerId, current);
  }

  // Totals for Referrals Summary Card
  const totalReferredCustomers = referredCustomers.length;
  const totalReferralBookings = referralsList.filter(r => r.status !== "pending").length;
  const totalCommissionEarned = referralsList.reduce((sum, r) => sum + r.rewardAmount, 0);
  const totalCommissionPaid = partners.reduce((sum: number, p: any) => sum + p.total_commission_paid, 0);
  const totalPayoutsDue = Math.max(0, totalCommissionEarned - totalCommissionPaid);

  const [payoutSavingId, setPayoutSavingId] = useState<string | null>(null);
  const [payoutResult, setPayoutResult] = useState<string | null>(null);

  async function handleMarkAsPaid(customerId: string, rewardAmount: number) {
    setPayoutSavingId(customerId);
    setPayoutResult(null);
    try {
      const formData = new FormData();
      formData.append("customer_id", customerId);
      formData.append("reward_amount", String(rewardAmount));
      
      const res = await markReferralPayoutPaidAction(formData);
      if (res.ok) {
        setPayoutResult(locale === "en" ? "Payout completed!" : "Выплата записана!");
        window.location.reload();
      } else {
        setPayoutResult(res.message);
      }
    } catch (err) {
      setPayoutResult(err instanceof Error ? err.message : "Error");
    } finally {
      setPayoutSavingId(null);
    }
  }

  return (
    <div className="analytics-dashboard">
      {/* EXCEL EXPORT & FILTERS PANEL */}
      <section className="panel" style={{ borderLeft: "4px solid #005f73", marginBottom: "2rem" }}>
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Export & Date Range Filter" : "Выгрузка отчетов и фильтр дат"}</h2>
            <p className="sub">{locale === "en" ? "Filter metrics in real-time or export a comprehensive workbook to Excel." : "Фильтруйте метрики в реальном времени или выгружайте полный отчет в Excel."}</p>
          </div>
          <button className="primary" onClick={handleExcelExport} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            📊 {locale === "en" ? "Download Excel (.xlsx)" : "Скачать Excel (.xlsx)"}
          </button>
        </div>
        <div className="panel-body form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div className="field">
            <label>{locale === "en" ? "Start Date" : "Начало периода"}</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field">
            <label>{locale === "en" ? "End Date" : "Конец периода"}</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="field">
            <label>{locale === "en" ? "Lead Source" : "Источник лида"}</label>
            <select value={leadSource} onChange={(e) => setLeadSource(e.target.value)}>
              <option value="">{locale === "en" ? "All Sources" : "Все источники"}</option>
              {sources.map((s) => (
                <option key={s} value={s}>{sourceLabel(s, locale)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{locale === "en" ? "Vehicle Class" : "Класс автомобиля"}</label>
            <select value={vehicleCategory} onChange={(e) => setVehicleCategory(e.target.value)}>
              <option value="">{locale === "en" ? "All Categories" : "Все категории"}</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="button" onClick={handleResetFilters} style={{ width: "100%" }}>
              {locale === "en" ? "Reset Filters" : "Сбросить фильтры"}
            </button>
          </div>
        </div>
      </section>

      {/* DASHBOARD TABS */}
      <div className="filters" style={{ marginBottom: "2rem" }}>
        <button className={`chip ${activeTab === "funnel" ? "active" : ""}`} onClick={() => setActiveTab("funnel")}>
          📊 {locale === "en" ? "Funnel & Revenue" : "Воронка & Выручка"}
        </button>
        <button className={`chip ${activeTab === "ltv" ? "active" : ""}`} onClick={() => setActiveTab("ltv")}>
          👤 {locale === "en" ? "LTV & Cohorts" : "Аналитика LTV & Когорты"}
        </button>
        <button className={`chip ${activeTab === "referrals" ? "active" : ""}`} onClick={() => setActiveTab("referrals")}>
          🤝 {locale === "en" ? "Referral & Payouts" : "Реферальная система & Выплаты"}
        </button>
      </div>

      {/* TAB 1: FUNNEL & REVENUE */}
      {activeTab === "funnel" && (
        <div>
          <section className="grid-4" style={{ marginBottom: "2rem" }}>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Leads" : "Количество лидов"}</div>
              <div className="metric-value">{leadsCount}</div>
            </div>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Bookings" : "Бронирования"}</div>
              <div className="metric-value">{bookingsCount}</div>
              <div className="muted">{locale === "en" ? "Lead → Booking conv" : "Конверсия лид → бронь"}: {convLeadBooking}%</div>
            </div>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Deliveries" : "Выдачи авто"}</div>
              <div className="metric-value">{deliveriesCount}</div>
              <div className="muted">{locale === "en" ? "Booking → Delivery conv" : "Конверсия бронь → выдача"}: {convBookingDelivery}%</div>
            </div>
            <div className="card" style={{ borderRight: "4px solid #2b9348" }}>
              <div className="metric-label">{locale === "en" ? "Revenue" : "Выручка за период"}</div>
              <div className="metric-value">{money(totalRevenue)}</div>
              <div className="muted">{locale === "en" ? "Avg check" : "Средний чек"}: {money(avgCheck)}</div>
            </div>
          </section>

          <section className="grid-2">
            <div className="panel">
              <div className="panel-head"><h2>{locale === "en" ? "Leads by Source" : "Лиды по источникам привлечения"}</h2></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{locale === "en" ? "Source" : "Источник"}</th><th>{locale === "en" ? "Leads" : "Количество лидов"}</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(leadsBySource).map(([src, count]) => (
                      <tr key={src}><td><strong>{sourceLabel(src, locale)}</strong></td><td>{count}</td></tr>
                    ))}
                    {Object.keys(leadsBySource).length === 0 && (
                      <tr><td colSpan={2} className="muted">{locale === "en" ? "No leads in this period" : "Нет лидов за указанный период"}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head"><h2>{locale === "en" ? "Revenue by Source" : "Выручка по источникам привлечения"}</h2></div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{locale === "en" ? "Source" : "Источник"}</th><th>{locale === "en" ? "Revenue (THB)" : "Сумма выручки"}</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(revenueBySource).map(([src, rev]) => (
                      <tr key={src}><td><strong>{sourceLabel(src, locale)}</strong></td><td>{money(rev)}</td></tr>
                    ))}
                    {Object.keys(revenueBySource).length === 0 && (
                      <tr><td colSpan={2} className="muted">{locale === "en" ? "No rental payments recorded" : "Нет оплат за указанный период"}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: LTV & COHORTS */}
      {activeTab === "ltv" && (
        <div>
          <section className="grid-4" style={{ marginBottom: "2rem" }}>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Unique Renters" : "Клиентов с арендой"}</div>
              <div className="metric-value">{filteredClients.length}</div>
            </div>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "New Cohort (1)" : "Когорта Новые (1)"}</div>
              <div className="metric-value">{cohortNew}</div>
              <div className="muted">{Math.round((cohortNew / (filteredClients.length || 1)) * 100)}% {locale === "en" ? "of base" : "от базы"}</div>
            </div>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Returning (2)" : "Повторные (2)"}</div>
              <div className="metric-value">{cohortReturning}</div>
              <div className="muted">{Math.round((cohortReturning / (filteredClients.length || 1)) * 100)}% {locale === "en" ? "of base" : "от базы"}</div>
            </div>
            <div className="card" style={{ borderRight: "4px solid #ae2012" }}>
              <div className="metric-label">{locale === "en" ? "Average LTV" : "Средний LTV клиента"}</div>
              <div className="metric-value">{money(avgLTV)}</div>
              <div className="muted">{locale === "en" ? "Total LTV" : "Совокупный LTV"}: {money(totalCalculatedLTV)}</div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>{locale === "en" ? "LTV & Cohort Retention by Source" : "LTV и распределение когорт по источникам"}</h2></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{locale === "en" ? "Source" : "Источник"}</th>
                    <th>{locale === "en" ? "Renters" : "Клиентов"}</th>
                    <th>{locale === "en" ? "Average LTV" : "Средний LTV"}</th>
                    <th>{locale === "en" ? "Total Revenue" : "Общая выручка"}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(ltvBySource).map(([src, stat]) => (
                    <tr key={src}>
                      <td><strong>{sourceLabel(src, locale)}</strong></td>
                      <td>{stat.count}</td>
                      <td>{money(Math.round(stat.total / stat.count))}</td>
                      <td>{money(stat.total)}</td>
                    </tr>
                  ))}
                  {Object.keys(ltvBySource).length === 0 && (
                    <tr><td colSpan={4} className="muted">{locale === "en" ? "No customer history" : "Нет истории продаж"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: REFERRAL & PAYOUTS */}
      {activeTab === "referrals" && (
        <div>
          <section className="grid-4" style={{ marginBottom: "2rem" }}>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Referred Customers" : "Привлечено рефералов"}</div>
              <div className="metric-value">{totalReferredCustomers}</div>
            </div>
            <div className="card">
              <div className="metric-label">{locale === "en" ? "Completed Deals" : "Сделок с арендой"}</div>
              <div className="metric-value">{totalReferralBookings}</div>
              <div className="muted">{locale === "en" ? "Share of base" : "Доля рефералов"}: {filteredDeliveries.length ? Math.round((totalReferralBookings / filteredDeliveries.length) * 100) : 0}%</div>
            </div>
            <div className="card" style={{ borderRight: "4px solid #ffb703" }}>
              <div className="metric-label">{locale === "en" ? "Commission Earned" : "Начислено бонусов"}</div>
              <div className="metric-value">{money(totalCommissionEarned)}</div>
              <div className="muted">10% {locale === "en" ? "of first rental" : "с первой аренды рефералов"}</div>
            </div>
            <div className="card" style={{ borderRight: "4px solid #d00000" }}>
              <div className="metric-label">{locale === "en" ? "Remaining To Pay" : "Остаток к выплате"}</div>
              <div className="metric-value" style={{ color: "#d00000" }}>{money(totalPayoutsDue)}</div>
              <div className="muted">{locale === "en" ? "Total Paid" : "Выплачено всего"}: {money(totalCommissionPaid)}</div>
            </div>
          </section>

          {/* ACTIVE PAYOUTS LEDGER */}
          <section className="panel" style={{ marginBottom: "2rem" }}>
            <div className="panel-head">
              <div>
                <h2>{locale === "en" ? "Referral Commission Ledger (10% from 1st rental)" : "Журнал начислений (10% за первую аренду привлеченного клиента)"}</h2>
                <p className="sub">{locale === "en" ? "Record payout rewards and explicitly mark them as Paid to update partner accounts." : "Фиксируйте выплаты и ставьте отметку «Выплачено» для расчета партнерского баланса."}</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{locale === "en" ? "Referred Customer" : "Привлеченный клиент"}</th>
                    <th>{locale === "en" ? "Referrer (Partner)" : "Реферер (Партнер)"}</th>
                    <th>{locale === "en" ? "Promo Code" : "Промокод"}</th>
                    <th>{locale === "en" ? "First Rental Date" : "Дата первой аренды"}</th>
                    <th>{locale === "en" ? "Rental Cost" : "Сумма аренды"}</th>
                    <th>{locale === "en" ? "Payout Reward" : "Вознаграждение (10%)"}</th>
                    <th>{locale === "en" ? "Status" : "Статус выплаты"}</th>
                    <th>{locale === "en" ? "Action" : "Действие"}</th>
                  </tr>
                </thead>
                <tbody>
                  {referralsList.map((r, idx) => {
                    const isPaid = r.status === "paid";
                    const isPending = r.status === "pending";
                    return (
                      <tr key={idx}>
                        <td><a href={`/customers/${r.customerId}`}><strong>{r.customerName}</strong></a></td>
                        <td>{r.partnerName}</td>
                        <td><span className="badge info">{r.promoCode}</span></td>
                        <td>{r.date ? formatDisplayDate(r.date) : "-"}</td>
                        <td>{money(r.bookingAmount)}</td>
                        <td><strong>{money(r.rewardAmount)}</strong></td>
                        <td>
                          {isPaid ? (
                            <span className="badge ok">✓ {locale === "en" ? "Paid" : "Выплачено"}</span>
                          ) : isPending ? (
                            <span className="badge info">{locale === "en" ? "No rentals" : "Нет аренд"}</span>
                          ) : (
                            <span className="badge warn" style={{ color: "#d00000", background: "#f8d7da" }}>⚠️ {locale === "en" ? "To Pay" : "К выплате"}</span>
                          )}
                        </td>
                        <td>
                          {!isPaid && !isPending && (
                            <button
                              className="button primary-button"
                              style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
                              disabled={payoutSavingId === r.customerId}
                              onClick={() => handleMarkAsPaid(r.customerId, r.rewardAmount)}
                            >
                              {payoutSavingId === r.customerId ? "..." : (locale === "en" ? "Mark Paid" : "Отметить: Выплачено")}
                            </button>
                          )}
                          {isPaid && <span className="muted" style={{ fontSize: "0.85rem" }}>{locale === "en" ? "Payout completed" : "Выплата произведена"}</span>}
                          {isPending && <span className="muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {referralsList.length === 0 && (
                    <tr><td colSpan={8} className="muted">{locale === "en" ? "No referrals registered" : "Реферальных привлечений пока нет"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {payoutResult && (
              <div className="panel-body" style={{ marginTop: "1rem" }}>
                <div className="form-result ok">{payoutResult}</div>
              </div>
            )}
          </section>

          {/* PARTNERS DIRECTORY AND BALANCES */}
          <section className="panel">
            <div className="panel-head"><h2>{locale === "en" ? "Referral Partners Directory" : "Список партнеров и балансы комиссионных"}</h2></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{locale === "en" ? "Partner Name" : "Имя партнера"}</th>
                    <th>{locale === "en" ? "Promo Code" : "Промокод"}</th>
                    <th>{locale === "en" ? "Referred (with Rentals)" : "Привлечено (с арендой)"}</th>
                    <th>{locale === "en" ? "Total Commission Earned" : "Всего начислено"}</th>
                    <th>{locale === "en" ? "Total Payouts Paid" : "Всего выплачено"}</th>
                    <th>{locale === "en" ? "Balance Due" : "Остаток к выплате"}</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p: any) => {
                    const calc = payoutsSummary.get(p.id) || { count: 0, earned: 0, paid: p.total_commission_paid || 0 };
                    const due = Math.max(0, calc.earned - calc.paid);
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong><br /><span className="muted">{p.whatsapp || p.contact || "-"}</span></td>
                        <td><span className="badge info">{p.promo_code}</span></td>
                        <td>{calc.count}</td>
                        <td>{money(calc.earned)}</td>
                        <td>{money(calc.paid)}</td>
                        <td><strong style={{ color: due > 0 ? "#ae2012" : "inherit" }}>{money(due)}</strong></td>
                      </tr>
                    );
                  })}
                  {partners.length === 0 && (
                    <tr><td colSpan={6} className="muted">{locale === "en" ? "No active referral partners" : "Нет активных партнеров"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
