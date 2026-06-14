import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, getDashboardData } from "@/lib/repository";
import * as XLSX from "xlsx";
import { formatDisplayDate } from "@/lib/i18n";
import { calculateBookingRevenue } from "@/lib/payment-status";

export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserContext();
    // Allow export if authenticated, or if running in demo/offline mode
    if (user.supabaseConfigured && !user.isAuthenticated) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const operator = searchParams.get("assigned_operator");
    const source = searchParams.get("source");
    const category = searchParams.get("category");
    const stage = searchParams.get("stage");
    const referral = searchParams.get("referral");
    const customerId = searchParams.get("customer_id");

    const data = await getDashboardData();
    const bookings = data.bookings || [];
    const leads = data.leads || [];
    const customers = data.customers || [];
    const partners = data.partners || [];
    const payments = data.payments || [];
    const isRevenueRental = (booking: (typeof bookings)[number]) =>
      ["handed_over", "active", "in_use", "returning", "returned"].includes(booking.rental_status) ||
      ["handed_over", "active", "in_use", "returning", "completed"].includes(booking.status);

    // Helper: Filter by date range
    const filterByDate = (dateStr: string | null | undefined) => {
      if (!dateStr) return true;
      const formattedDate = dateStr.slice(0, 10);
      if (startDate && formattedDate < startDate) return false;
      if (endDate && formattedDate > endDate) return false;
      return true;
    };

    // Filter Leads
    const filteredLeads = leads.filter((lead) => {
      if (!filterByDate(lead.reminder_at)) return false;
      if (source && lead.channel !== source) return false;
      if (stage && lead.stage !== stage) return false;
      if (category && lead.category !== category) return false;
      if (customerId && lead.customer_id !== customerId) return false;
      if (referral) {
        const linkedCust = lead.customer_id ? customers.find((c) => c.id === lead.customer_id) : null;
        const isRef = Boolean(linkedCust?.referral_partner_id);
        if (referral === "yes" && !isRef) return false;
        if (referral === "no" && isRef) return false;
      }
      return true;
    });

    // Filter Bookings
    const filteredBookings = bookings.filter((booking) => {
      if (!filterByDate(booking.start_date)) return false;
      if (category) {
        const vehicle = data.vehicles.find((v) => v.id === booking.vehicle_id);
        if (vehicle?.category !== category) return false;
      }
      if (customerId && booking.customer_id !== customerId) return false;
      if (referral) {
        const linkedCust = booking.customer_id ? customers.find((c) => c.id === booking.customer_id) : null;
        const isRef = Boolean(linkedCust?.referral_partner_id);
        if (referral === "yes" && !isRef) return false;
        if (referral === "no" && isRef) return false;
      }
      return true;
    });

    // Filter Deliveries (completed/handed over/active bookings)
    const filteredDeliveries = filteredBookings.filter(isRevenueRental);

    // Dynamic LTV calculations per customer
    const customerBookingsCount = new Map<string, number>();
    const customerLTV = new Map<string, number>();
    const customerFirstDate = new Map<string, string>();
    const customerLastDate = new Map<string, string>();

    // Sort bookings chronologically to calculate first/last booking dates
    const chronBookings = [...bookings].sort((a, b) => a.start_date.localeCompare(b.start_date));
    for (const b of chronBookings) {
      if (!b.customer_id) continue;
      const amount = isRevenueRental(b) ? calculateBookingRevenue(b) : 0;
      
      // Counter
      customerBookingsCount.set(b.customer_id, (customerBookingsCount.get(b.customer_id) || 0) + 1);
      
      // LTV (only count completed/active rental revenue)
      customerLTV.set(b.customer_id, (customerLTV.get(b.customer_id) || 0) + amount);
      
      // Dates
      if (!customerFirstDate.has(b.customer_id)) {
        customerFirstDate.set(b.customer_id, b.start_date);
      }
      customerLastDate.set(b.customer_id, b.start_date);
    }

    // Filter Clients
    const filteredClients = customers.filter((c) => {
      if (customerId && c.id !== customerId) return false;
      if (source && c.source !== source) return false;
      if (referral) {
        const isRef = Boolean(c.referral_partner_id);
        if (referral === "yes" && !isRef) return false;
        if (referral === "no" && isRef) return false;
      }
      return true;
    });

    // Referrers mapping
    const partnersMap = new Map(partners.map((p) => [p.id, p]));

    // Referrals calculations (Strictly 10% commission of the first booking only!)
    const referredCustomers = customers.filter((c) => c.referral_partner_id);
    const referralRows: any[] = [];
    const payoutsCalculation = new Map<string, { count: number; earned: number; paid: number }>();

    for (const c of referredCustomers) {
      const partner = partnersMap.get(c.referral_partner_id!);
      if (!partner) continue;

      // Find first chronologically completed/active booking for this customer
      const clientBookings = chronBookings.filter((b) => b.customer_id === c.id && isRevenueRental(b));
      const firstBooking = clientBookings[0];

      const firstBookingDate = firstBooking ? firstBooking.start_date : null;
      const firstRentalAmount = firstBooking ? firstBooking.rental_amount : 0;
      const commission = firstBooking ? Math.round(firstRentalAmount * 0.1) : 0;

      let commissionStatus = "Не начислено";
      if (firstBooking) {
        const isPaid = (c.tags || []).includes("referral_payout_completed");
        commissionStatus = isPaid ? "Выплачено" : "К выплате";
      }

      // Add to referrals sheet data
      referralRows.push({
        "ID Клиента": c.id,
        "Имя Реферала": c.full_name,
        "Реферер": partner.name,
        "Промокод": partner.promo_code,
        "Дата первой аренды": firstBookingDate ? formatDisplayDate(firstBookingDate) : "-",
        "Сумма первой аренды (THB)": firstRentalAmount,
        "Вознаграждение (10%)": commission,
        "Статус выплаты": commissionStatus
      });

      // Accumulate for Payouts summary sheet
      const currentPay = payoutsCalculation.get(partner.id) || { count: 0, earned: 0, paid: partner.total_commission_paid || 0 };
      if (firstBooking) {
        currentPay.count += 1;
        currentPay.earned += commission;
      }
      payoutsCalculation.set(partner.id, currentPay);
    }

    const payoutsRows = partners.map((partner) => {
      const calc = payoutsCalculation.get(partner.id) || { count: 0, earned: 0, paid: partner.total_commission_paid || 0 };
      return {
        "ID Партнера": partner.id,
        "Имя Реферера": partner.name,
        "Промокод": partner.promo_code,
        "Привлечено рефералов с арендой": calc.count,
        "Всего начислено бонусов (THB)": calc.earned,
        "Всего выплачено бонусов (THB)": calc.paid,
        "Остаток к выплате (THB)": Math.max(0, calc.earned - calc.paid)
      };
    });

    // 1. SUMMARY SHEET
    const totalRevenue = filteredDeliveries.reduce((sum, b) => sum + calculateBookingRevenue(b), 0);
    const avgCheck = filteredDeliveries.length ? Math.round(totalRevenue / filteredDeliveries.length) : 0;

    let uniqueReferredCount = 0;
    let totalReferredEarned = 0;
    payoutsCalculation.forEach((calc) => {
      uniqueReferredCount += calc.count;
      totalReferredEarned += calc.earned;
    });
    const totalPayoutsPaid = partners.reduce((sum, p) => sum + p.total_commission_paid, 0);

    const summaryRows = [
      { "Показатель": "Период выгрузки", "Значение": `${startDate || "Начало"} — ${endDate || "Сегодня"}` },
      { "Показатель": "Количество лидов", "Значение": filteredLeads.length },
      { "Показатель": "Количество броней", "Значение": filteredBookings.length },
      { "Показатель": "Количество выдач авто", "Значение": filteredDeliveries.length },
      { "Показатель": "Сумма выручки (THB)", "Значение": totalRevenue },
      { "Показатель": "Уникальных клиентов в базе", "Значение": filteredClients.length },
      { "Показатель": "Средний чек (THB)", "Значение": avgCheck },
      { "Показатель": "Количество реферальных выдач", "Значение": uniqueReferredCount },
      { "Показатель": "Сумма начислений по рефералам (THB)", "Значение": totalReferredEarned },
      { "Показатель": "Сумма выплаченных бонусов (THB)", "Значение": totalPayoutsPaid },
      { "Показатель": "Доля реферальных сделок (%)", "Значение": filteredDeliveries.length ? Math.round((uniqueReferredCount / filteredDeliveries.length) * 100) : 0 }
    ];

    // 2. LEADS SHEET
    const leadsRows = filteredLeads.map((l) => ({
      "ID": l.id,
      "Клиент": l.customer_name,
      "Телефон": l.phone || "-",
      "Telegram": l.telegram_username || "-",
      "Источник": l.channel,
      "Детали источника": l.source_detail || "-",
      "Этап воронки": l.stage,
      "Оценка (Score)": l.score,
      "Напоминание": l.reminder_at ? formatDisplayDate(l.reminder_at) : "-",
      "Запрос": l.note
    }));

    // 3. BOOKINGS SHEET
    const bookingsRows = filteredBookings.map((b) => ({
      "ID": b.id,
      "Номер брони": b.booking_number,
      "Клиент": b.customer_name,
      "Автомобиль": b.vehicle,
      "Статус": b.status,
      "Начало": formatDisplayDate(b.start_date),
      "Конец": formatDisplayDate(b.end_date),
      "Аренда (THB)": b.rental_amount,
      "Депозит (THB)": b.deposit_amount,
      "Доставка (THB)": b.delivery_fee,
      "Выручка без депозита (THB)": calculateBookingRevenue(b),
      "Итого (THB)": b.grand_total
    }));

    // 4. DELIVERIES SHEET
    const deliveriesRows = filteredDeliveries.map((b) => ({
      "ID": b.id,
      "Номер брони": b.booking_number,
      "Клиент": b.customer_name,
      "Автомобиль": b.vehicle,
      "Выдача": formatDisplayDate(b.start_date),
      "Возврат": formatDisplayDate(b.end_date),
      "Выручка без депозита (THB)": calculateBookingRevenue(b),
      "Итого к получению (THB)": b.grand_total,
      "Статус": b.status
    }));

    // 5. CLIENTS SHEET
    const clientsRows = filteredClients.map((c) => {
      const bookingsCount = customerBookingsCount.get(c.id) || 0;
      const ltv = customerLTV.get(c.id) || 0;
      const firstDate = customerFirstDate.get(c.id);
      const lastDate = customerLastDate.get(c.id);

      let retentionStatus = "Новый";
      if (bookingsCount === 2) retentionStatus = "Повторный";
      else if (bookingsCount >= 3) retentionStatus = "Постоянный";

      return {
        "ID": c.id,
        "Имя Клиента": c.full_name,
        "Имя по паспорту": c.full_name_passport || "-",
        "Телефон": c.phone || "-",
        "WhatsApp": c.whatsapp || "-",
        "Telegram": c.telegram_username || "-",
        "Язык": c.language_pref.toUpperCase(),
        "Источник": c.source || "-",
        "Общий LTV (THB)": ltv,
        "Всего аренд": bookingsCount,
        "Дата первой аренды": firstDate ? formatDisplayDate(firstDate) : "-",
        "Дата последней аренды": lastDate ? formatDisplayDate(lastDate) : "-",
        "Статус возвращаемости": retentionStatus,
        "Пришел по рефералке": c.referral_partner_id ? "Да" : "Нет"
      };
    });

    // Generate Workbook
    const wb = XLSX.utils.book_new();

    const addSheet = (rows: any[], sheetName: string) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    addSheet(summaryRows, "Summary");
    addSheet(leadsRows, "Leads");
    addSheet(bookingsRows, "Bookings");
    addSheet(deliveriesRows, "Deliveries");
    addSheet(clientsRows, "Clients");
    addSheet(referralRows, "Referrals");
    addSheet(payoutsRows, "Payouts");

    // Write buffer
    const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `epicenter_analytics_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    });

  } catch (error) {
    console.error("Excel Export Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
