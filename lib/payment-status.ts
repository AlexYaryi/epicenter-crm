type PaymentLike = {
  amount?: number | string | null;
  type?: string | null;
  status?: string | null;
};

type BookingFinancialInput = {
  start_date?: string | null;
  end_date?: string | null;
  rental_type?: string | null;
  status?: string | null;
  rental_status?: string | null;
  payment_status?: string | null;
  deposit_status?: string | null;
  daily_rate_applied?: number | string | null;
  grand_total?: number | string | null;
  deposit_amount?: number | string | null;
  rental_amount?: number | string | null;
  total_rental_amount?: number | string | null;
  delivery_fee?: number | string | null;
  pickup_fee?: number | string | null;
  extras_total?: number | string | null;
  discount_amount?: number | string | null;
};

const rentalPaymentTypes = new Set(["rental", "extras", "damage", "fine"]);

export function calculateBookingFinancialStatus(booking: BookingFinancialInput, payments: PaymentLike[]) {
  const completedPayments = payments.filter((payment) => String(payment.status ?? "completed") === "completed");
  const grandTotal = Number(booking.grand_total ?? 0);
  const depositAmount = Number(booking.deposit_amount ?? 0);
  const fallbackRentalDue = Math.max(grandTotal - depositAmount, 0);
  const rentalType = String(booking.rental_type ?? "");
  const explicitRentalAmount = Number(booking.total_rental_amount ?? booking.rental_amount ?? 0);
  const totalDays = inclusiveRentalDays(booking.start_date, booking.end_date);
  const dailyRateFromBooking = Number(booking.daily_rate_applied ?? 0);
  const shortTermDailyRate = dailyRateFromBooking > 0 ? dailyRateFromBooking : explicitRentalAmount / Math.max(totalDays, 1);
  const monthlyRate = explicitRentalAmount > 0 ? explicitRentalAmount : Math.round(Math.max(dailyRateFromBooking, 0) * 30);
  const rentalDue = rentalType === "long_term"
    ? monthlyRate * billingMonths(booking.start_date, booking.end_date)
    : explicitRentalAmount > 0
      ? Math.round(shortTermDailyRate * Math.max(totalDays, 1))
      : fallbackRentalDue;
  const rentalPaid = completedPayments
    .filter((payment) => rentalPaymentTypes.has(String(payment.type ?? "")))
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const depositPaid = completedPayments
    .filter((payment) => String(payment.type ?? "") === "deposit")
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const refundPaid = completedPayments
    .filter((payment) => String(payment.type ?? "") === "refund")
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);

  const paymentStatus =
    rentalPaid <= 0
      ? "unpaid"
      : rentalDue <= 0 || rentalPaid >= rentalDue
        ? "fully_paid"
        : "partial";
  const depositStatus =
    depositPaid <= 0
      ? "not_taken"
      : refundPaid <= 0
        ? "held"
        : refundPaid >= depositPaid
          ? "fully_returned"
          : "partially_returned";

  return {
    paymentStatus,
    depositStatus,
    rentalDue,
    rentalPaid,
    depositPaid,
    refundPaid
  };
}

function dateKey(value: string | null | undefined) {
  return String(value ?? "").slice(0, 10);
}

function addDays(dateKeyValue: string, days: number) {
  const date = new Date(`${dateKeyValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(dateKeyValue: string, months: number) {
  const date = new Date(`${dateKeyValue}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function inclusiveRentalDays(startDate: string | null | undefined, endDate: string | null | undefined) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end) return 0;
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

function billingMonths(startDate: string | null | undefined, endDate: string | null | undefined) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end) return 1;
  const startDateValue = new Date(`${start}T00:00:00.000Z`);
  const endDateValue = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(startDateValue.getTime()) || Number.isNaN(endDateValue.getTime()) || endDateValue <= startDateValue) {
    return 1;
  }

  let months =
    (endDateValue.getUTCFullYear() - startDateValue.getUTCFullYear()) * 12 +
    (endDateValue.getUTCMonth() - startDateValue.getUTCMonth());
  months = Math.max(months, 1);

  const anchor = new Date(startDateValue);
  anchor.setUTCMonth(anchor.getUTCMonth() + months);
  if (anchor < endDateValue) {
    months += 1;
  }

  return Math.max(months, 1);
}

export function calculateRentalPaymentCoverage(booking: BookingFinancialInput, payments: PaymentLike[]) {
  const financialStatus = calculateBookingFinancialStatus(booking, payments);
  const bookingStatus = String(booking.status ?? "");
  const rentalStatus = String(booking.rental_status ?? "");
  const depositStatus = String(booking.deposit_status ?? "");
  const rentalIsIssued = ["handed_over", "active", "in_use", "returning"].includes(rentalStatus) || ["handed_over", "active", "in_use", "returning"].includes(bookingStatus);
  const depositIsMarkedPaid = bookingStatus === "paid_deposit" || ["held", "partially_returned", "fully_returned", "forfeited"].includes(depositStatus);
  const rentalType = String(booking.rental_type ?? "");
  const isLongTerm = rentalType === "long_term";
  const explicitRentalAmount = Number(booking.total_rental_amount ?? booking.rental_amount ?? 0);
  const totalDays = inclusiveRentalDays(booking.start_date, booking.end_date);
  const dailyRateFromBooking = Number(booking.daily_rate_applied ?? 0);
  const shortTermDailyRate = dailyRateFromBooking > 0 ? dailyRateFromBooking : explicitRentalAmount / Math.max(totalDays, 1);
  const monthlyRate = explicitRentalAmount > 0 ? explicitRentalAmount : Math.round(Math.max(dailyRateFromBooking, 0) * 30);
  const termMonths = isLongTerm ? billingMonths(booking.start_date, booking.end_date) : 0;
  const fullRentalDue = isLongTerm ? monthlyRate * termMonths : Math.round(shortTermDailyRate * Math.max(totalDays, 1));
  const rentalDue = isLongTerm ? monthlyRate : fullRentalDue;
  const statusRentalCredit = rentalIsIssued ? rentalDue : 0;
  const rentalPaid = Math.min(fullRentalDue, financialStatus.rentalPaid + statusRentalCredit);
  const depositDue = Number(booking.deposit_amount ?? 0);
  const depositPaid =
    financialStatus.depositPaid > 0
      ? financialStatus.depositPaid
      : depositIsMarkedPaid
        ? depositDue
        : 0;
  const dailyRate = Math.max(isLongTerm ? Math.round(monthlyRate / 30) : shortTermDailyRate, 0);
  const paidPeriods = isLongTerm && monthlyRate > 0 ? Math.floor(rentalPaid / monthlyRate) : 0;
  const extraLongTermDays = isLongTerm && monthlyRate > 0 && dailyRate > 0 ? Math.floor((rentalPaid % monthlyRate) / dailyRate) : 0;
  const paidDays = !isLongTerm && dailyRate > 0 ? Math.floor(rentalPaid / dailyRate) : extraLongTermDays;
  const start = dateKey(booking.start_date);
  const end = dateKey(booking.end_date);
  const paidThroughDate =
    rentalPaid >= fullRentalDue && end
      ? end
      : isLongTerm && start && paidPeriods > 0
      ? addDays(addMonths(start, paidPeriods), extraLongTermDays)
      : start && paidDays > 0
        ? addDays(start, paidDays)
        : null;

  return {
    ...financialStatus,
    rentalDue,
    fullRentalDue,
    rentalPaid,
    depositPaid,
    totalDays,
    termMonths,
    dailyRate,
    paidDays,
    paidPeriods,
    paidThroughDate,
    remainingRental: Math.max(fullRentalDue - rentalPaid, 0),
    depositDue,
    remainingDeposit: Math.max(depositDue - depositPaid, 0),
    isLongTerm,
    periodLabel: isLongTerm ? "monthly" : "full_rental",
    isFullyPaid: fullRentalDue <= 0 || rentalPaid >= fullRentalDue,
    inferredRentalFromStatus: statusRentalCredit > 0,
    inferredDepositFromStatus: financialStatus.depositPaid <= 0 && depositPaid > 0
  };
}

export function calculateBookingRevenue(booking: BookingFinancialInput) {
  const explicitRental = Number(booking.rental_amount ?? booking.total_rental_amount ?? 0);
  if (explicitRental > 0) {
    const delivery = Number(booking.delivery_fee ?? booking.pickup_fee ?? 0);
    return Math.max(
      explicitRental +
        delivery +
        Number(booking.extras_total ?? 0) -
        Number(booking.discount_amount ?? 0),
      0
    );
  }

  return Math.max(Number(booking.grand_total ?? 0) - Number(booking.deposit_amount ?? 0), 0);
}
