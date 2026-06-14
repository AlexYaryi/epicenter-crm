"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";
import type { Booking, MaintenanceBlock } from "@/lib/types";

type EditableBooking = {
  id: string;
  customer_id?: string | null;
  vehicle_id?: string | null;
  rental_type?: "short_term" | "long_term" | string | null;
  pickup_method?: string | null;
  start_date: string;
  end_date: string;
  pickup_location?: string | null;
  return_location?: string | null;
  daily_rate_applied: number;
  total_rental_amount: number;
  deposit_amount: number;
  delivery_fee: number;
  extras_total: number;
  discount_amount: number;
  grand_total: number;
  payment_status?: string | null;
  deposit_status?: string | null;
};

type Props = {
  booking: EditableBooking;
  customerOptions: Array<{ id: string; label: string; contact: string }>;
  vehicleOptions: Array<{ id: string; label: string; status: string }>;
  existingBookings: Booking[];
  existingMaintenance: MaintenanceBlock[];
  locale: Locale;
  currentUserRole: string;
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

function toDateInput(value: string) {
  return value.slice(0, 10);
}

function toTimeInput(value: string) {
  if (!value || value.length < 11) return "12:00";
  const timePart = value.includes("T") ? value.split("T")[1] : value.split(" ")[1];
  if (!timePart) return "12:00";
  return timePart.slice(0, 5);
}

function parseMoney(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function paymentStatusLabel(value: string | null | undefined, locale: Locale) {
  const labels: Record<string, { ru: string; en: string }> = {
    unpaid: { ru: "Не оплачено", en: "Unpaid" },
    partial: { ru: "Частично", en: "Partial" },
    fully_paid: { ru: "Оплачено полностью", en: "Fully paid" },
    refunded: { ru: "Возврат", en: "Refunded" }
  };
  const item = labels[String(value || "unpaid")] ?? labels.unpaid;
  return locale === "en" ? item.en : item.ru;
}

function depositStatusLabel(value: string | null | undefined, locale: Locale) {
  const labels: Record<string, { ru: string; en: string }> = {
    not_taken: { ru: "Не взят", en: "Not taken" },
    held: { ru: "Удерживается", en: "Held" },
    partially_returned: { ru: "Частично возвращён", en: "Partially returned" },
    fully_returned: { ru: "Возвращён", en: "Fully returned" },
    forfeited: { ru: "Удержан", en: "Forfeited" }
  };
  const item = labels[String(value || "not_taken")] ?? labels.not_taken;
  return locale === "en" ? item.en : item.ru;
}

function daysBetween(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
const alwaysUnavailableVehicleStatuses = new Set(["maintenance", "repair", "retired"]);

function rangesOverlap(start: string, end: string, blockStart: string, blockEnd: string) {
  return Boolean(start && end && blockStart && blockEnd && blockStart <= end && blockEnd >= start);
}

export function BookingEditForm({ booking, customerOptions, vehicleOptions, existingBookings, existingMaintenance, locale, currentUserRole, action }: Props) {
  const [rentalType, setRentalType] = useState(String(booking.rental_type || "short_term"));
  const [vehicleId, setVehicleId] = useState(booking.vehicle_id ?? "");
  const [startDate, setStartDate] = useState(toDateInput(booking.start_date));
  const [endDate, setEndDate] = useState(toDateInput(booking.end_date));
  const [startTime, setStartTime] = useState(() => toTimeInput(booking.start_date));
  const [endTime, setEndTime] = useState(() => toTimeInput(booking.end_date));
  const [dailyRate, setDailyRate] = useState(Math.round(Number(booking.daily_rate_applied || 0)));
  const [rentalAmount, setRentalAmount] = useState(Math.round(Number(booking.total_rental_amount || 0)));
  const [depositAmount, setDepositAmount] = useState(Math.round(Number(booking.deposit_amount || 0)));
  const [deliveryFee, setDeliveryFee] = useState(Math.round(Number(booking.delivery_fee || 0)));
  const [extrasTotal, setExtrasTotal] = useState(Math.round(Number(booking.extras_total || 0)));
  const [discountAmount, setDiscountAmount] = useState(Math.round(Number(booking.discount_amount || 0)));

  const durationDays = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);
  const grandTotal = Math.max(0, rentalAmount + depositAmount + deliveryFee + extrasTotal - discountAmount);
  const canEditFinancialStatus = currentUserRole === "owner" || currentUserRole === "accountant";
  const selectedVehicle = vehicleOptions.find((vehicle) => vehicle.id === vehicleId);
  const vehicleConflict = useMemo(() => {
    if (!vehicleId || !startDate || !endDate) return null;
    if (alwaysUnavailableVehicleStatuses.has(String(selectedVehicle?.status ?? ""))) {
      return text(locale, "Автомобиль сейчас в статусе ремонта/ТО/выведен из парка.", "Vehicle is currently maintenance/repair/retired.");
    }

    const bookingConflict = existingBookings.find((item) => {
      if (item.id === booking.id || item.vehicle_id !== vehicleId) return false;
      if (!blockingBookingStatuses.has(item.status) && !blockingRentalStatuses.has(item.rental_status)) return false;
      return rangesOverlap(startDate, endDate, toDateInput(item.start_date), toDateInput(item.actual_end ?? item.end_date));
    });
    if (bookingConflict) {
      return text(
        locale,
        `Пересечение с бронью ${bookingConflict.booking_number}: ${toDateInput(bookingConflict.start_date)} - ${toDateInput(bookingConflict.actual_end ?? bookingConflict.end_date)}.`,
        `Overlaps booking ${bookingConflict.booking_number}: ${toDateInput(bookingConflict.start_date)} - ${toDateInput(bookingConflict.actual_end ?? bookingConflict.end_date)}.`
      );
    }

    const maintenanceConflict = existingMaintenance.find((item) => {
      if (item.vehicle_id !== vehicleId) return false;
      if (!["scheduled", "in_progress"].includes(String(item.status ?? ""))) return false;
      return rangesOverlap(
        startDate,
        endDate,
        toDateInput(String(item.vehicle_unavailable_from ?? "")),
        toDateInput(String(item.vehicle_unavailable_to ?? "9999-12-31"))
      );
    });
    if (maintenanceConflict) {
      return text(
        locale,
        `Пересечение с ремонтом/ТО: ${toDateInput(String(maintenanceConflict.vehicle_unavailable_from ?? ""))} - ${toDateInput(String(maintenanceConflict.vehicle_unavailable_to ?? "9999-12-31"))}.`,
        `Overlaps maintenance: ${toDateInput(String(maintenanceConflict.vehicle_unavailable_from ?? ""))} - ${toDateInput(String(maintenanceConflict.vehicle_unavailable_to ?? "9999-12-31"))}.`
      );
    }

    return null;
  }, [booking.id, endDate, existingBookings, existingMaintenance, locale, selectedVehicle?.status, startDate, vehicleId]);

  useEffect(() => {
    if (rentalType !== "long_term") {
      setRentalAmount(dailyRate * durationDays);
    }
  }, [dailyRate, durationDays, rentalType]);

  function handleDailyRateChange(value: string) {
    const nextDailyRate = parseMoney(value);
    setDailyRate(nextDailyRate);
    if (rentalType === "long_term") {
      setRentalAmount(nextDailyRate * 30);
      return;
    }
    setRentalAmount(nextDailyRate * durationDays);
  }

  function handleRentalAmountChange(value: string) {
    const nextRentalAmount = parseMoney(value);
    setRentalAmount(nextRentalAmount);
    if (rentalType === "long_term") {
      setDailyRate(Math.round(nextRentalAmount / 30));
      return;
    }
    setDailyRate(Math.round(nextRentalAmount / durationDays));
  }

  function handleRentalTypeChange(value: string) {
    setRentalType(value);
    if (value === "long_term") {
      setRentalAmount(dailyRate * 30);
      return;
    }
    setRentalAmount(dailyRate * durationDays);
  }

  return (
    <ActionFeedbackForm
      action={action}
      className="form-grid"
      locale={locale}
      savingText={text(locale, "Сохраняю бронь...", "Saving booking...")}
    >
      <input type="hidden" name="booking_id" value={booking.id} />

      <div className="field">
        <label>{text(locale, "Клиент", "Customer")}</label>
        <select name="customer_id" defaultValue={booking.customer_id ?? ""} required>
          {customerOptions.map((customer) => (
            <option value={customer.id} key={customer.id}>
              {customer.label} · {customer.contact}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{text(locale, "Автомобиль", "Vehicle")}</label>
        <select name="vehicle_id" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} required>
          {vehicleOptions.map((vehicle) => (
            <option value={vehicle.id} key={vehicle.id}>
              {vehicle.label} · {vehicle.status}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{text(locale, "Тип аренды", "Rental type")}</label>
        <select name="rental_type" value={rentalType} onChange={(event) => handleRentalTypeChange(event.target.value)}>
          <option value="short_term">Short-term</option>
          <option value="long_term">Long-term</option>
        </select>
      </div>

      <div className="field">
        <label>{text(locale, "Метод выдачи", "Pickup method")}</label>
        <select name="pickup_method" defaultValue={booking.pickup_method || "office"}>
          <option value="office">Office</option>
          <option value="hotel_delivery">Hotel delivery</option>
          <option value="airport_meet">Airport meet</option>
        </select>
      </div>

      <div className="field">
        <label>{text(locale, "Начало", "Start")}</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input name="start_date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required style={{ flex: 2 }} />
          <input name="start_time" type="time" value={startTime} onChange={(event) => {
            setStartTime(event.target.value);
            setEndTime(event.target.value);
          }} required style={{ flex: 1 }} />
        </div>
      </div>

      <div className="field">
        <label>{text(locale, "Конец", "End")}</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input name="end_date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required style={{ flex: 2 }} />
          <input name="end_time" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required style={{ flex: 1 }} />
        </div>
      </div>

      {vehicleConflict ? (
        <div className="form-result wide error">
          {vehicleConflict}
          <br />
          <span className="muted">
            {text(locale, "Выберите другую машину или свободный период. Сервер также заблокирует такое сохранение.", "Choose another vehicle or an available period. The server will also block this save.")}
          </span>
        </div>
      ) : vehicleId && startDate && endDate ? (
        <div className="form-result wide ok">
          {text(locale, "Машина свободна для выбранных дат по текущему календарю CRM.", "Vehicle is available for the selected dates in the current CRM calendar.")}
        </div>
      ) : null}

      <div className="field">
        <label>{text(locale, "Место выдачи", "Pickup location")}</label>
        <input name="pickup_location" defaultValue={booking.pickup_location ?? ""} placeholder="Office / hotel / airport" />
      </div>

      <div className="field">
        <label>{text(locale, "Место возврата", "Return location")}</label>
        <input name="return_location" defaultValue={booking.return_location ?? ""} placeholder="Office / hotel / airport" />
      </div>

      <div className="field">
        <label>{rentalType === "long_term" ? text(locale, "Цена в день", "Daily rate") : text(locale, "Цена в день", "Daily rate")}</label>
        <input name="daily_rate_applied" type="number" min="0" step="1" value={dailyRate} onChange={(event) => handleDailyRateChange(event.target.value)} />
        {rentalType === "long_term" ? (
          <small className="sub">{text(locale, "При вводе дневной цены CRM считает месяц как 30 дней.", "Monthly total is calculated as 30 days.")}</small>
        ) : (
          <small className="sub">{text(locale, `Дней аренды: ${durationDays}`, `Rental days: ${durationDays}`)}</small>
        )}
      </div>

      <div className="field">
        <label>{rentalType === "long_term" ? text(locale, "Цена за месяц / сумма аренды", "Monthly price / rental amount") : text(locale, "Сумма аренды", "Rental amount")}</label>
        <input name="total_rental_amount" type="number" min="0" step="1" value={rentalAmount} onChange={(event) => handleRentalAmountChange(event.target.value)} />
      </div>

      <div className="field">
        <label>{text(locale, "Депозит", "Deposit")}</label>
        <input name="deposit_amount" type="number" min="0" step="1" value={depositAmount} onChange={(event) => setDepositAmount(parseMoney(event.target.value))} />
      </div>

      <div className="field">
        <label>{text(locale, "Доставка / забор", "Delivery / pickup fee")}</label>
        <input name="delivery_fee" type="number" min="0" step="1" value={deliveryFee} onChange={(event) => setDeliveryFee(parseMoney(event.target.value))} />
      </div>

      <div className="field">
        <label>Extras</label>
        <input name="extras_total" type="number" min="0" step="1" value={extrasTotal} onChange={(event) => setExtrasTotal(parseMoney(event.target.value))} />
      </div>

      <div className="field">
        <label>{text(locale, "Скидка", "Discount")}</label>
        <input name="discount_amount" type="number" min="0" step="1" value={discountAmount} onChange={(event) => setDiscountAmount(parseMoney(event.target.value))} />
      </div>

      <div className="field">
        <label>{text(locale, "Итого", "Grand total")}</label>
        <input name="grand_total" type="number" min="0" step="1" value={grandTotal} readOnly />
        <small className="sub">
          {text(
            locale,
            "Аренда + депозит + доставка/забор + extras - скидка.",
            "Rental + deposit + delivery/pickup + extras - discount."
          )}
        </small>
      </div>

      <div className="field">
        <label>{text(locale, "Статус оплаты", "Payment status")}</label>
        {canEditFinancialStatus ? (
          <select name="payment_status" defaultValue={booking.payment_status || "unpaid"}>
            <option value="unpaid">{text(locale, "Не оплачено", "Unpaid")}</option>
            <option value="partial">{text(locale, "Частично", "Partial")}</option>
            <option value="fully_paid">{text(locale, "Оплачено полностью", "Fully paid")}</option>
            <option value="refunded">{text(locale, "Возврат", "Refunded")}</option>
          </select>
        ) : (
          <>
            <input type="hidden" name="payment_status" value={booking.payment_status || "unpaid"} />
            <div className="readonly-field">{paymentStatusLabel(booking.payment_status, locale)}</div>
            <small className="sub">{text(locale, "Обновляется через запись платежей.", "Updated through payment records.")}</small>
          </>
        )}
      </div>

      <div className="field">
        <label>{text(locale, "Статус депозита", "Deposit status")}</label>
        {canEditFinancialStatus ? (
          <select name="deposit_status" defaultValue={booking.deposit_status || "not_taken"}>
            <option value="not_taken">{text(locale, "Не взят", "Not taken")}</option>
            <option value="held">{text(locale, "Удерживается", "Held")}</option>
            <option value="partially_returned">{text(locale, "Частично возвращён", "Partially returned")}</option>
            <option value="fully_returned">{text(locale, "Возвращён", "Fully returned")}</option>
            <option value="forfeited">{text(locale, "Удержан", "Forfeited")}</option>
          </select>
        ) : (
          <>
            <input type="hidden" name="deposit_status" value={booking.deposit_status || "not_taken"} />
            <div className="readonly-field">{depositStatusLabel(booking.deposit_status, locale)}</div>
            <small className="sub">{text(locale, "Обновляется через запись платежей.", "Updated through payment records.")}</small>
          </>
        )}
      </div>

      <div className="field wide">
        <button className="primary" disabled={Boolean(vehicleConflict)}>
          {text(locale, "Сохранить изменения брони", "Save booking changes")}
        </button>
      </div>
    </ActionFeedbackForm>
  );
}
