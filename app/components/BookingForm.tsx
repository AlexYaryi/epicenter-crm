"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import type { ActionResult } from "@/lib/actions";
import type { Customer, Vehicle, Booking } from "@/lib/types";

type BookingFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  tenantId: string;
  locale: Locale;
  customers: Customer[];
  vehicles: Vehicle[];
  fixedCustomerId?: string;
  fixedVehicleId?: string;
  fixedLeadId?: string;
  defaultDailyRate?: number;
  defaultMonthlyRate?: number;
  defaultDeposit?: number;
  defaultStartDate?: string;
  defaultEndDate?: string;
  defaultVehicleCategory?: string;
  existingBookings?: Booking[];
  submitLabel: string;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

function currentYearBookingPrefix() {
  return `EPC-${new Date().getFullYear()}-`;
}

function vehicleStatusText(status: string, locale: Locale) {
  const labels: Record<string, { ru: string; en: string }> = {
    available: { ru: "свободно", en: "available" },
    reserved: { ru: "есть брони", en: "booked" },
    in_use: { ru: "в аренде", en: "rented" },
    handed_over: { ru: "в аренде", en: "rented" },
    returning: { ru: "в аренде", en: "rented" },
    maintenance: { ru: "техническое обслуживание", en: "maintenance" },
    repair: { ru: "ремонт", en: "repair" },
    retired: { ru: "выведено", en: "retired" }
  };
  const item = labels[status];
  return item ? (locale === "en" ? item.en : item.ru) : status;
}

function vehicleOptionLabel(vehicle: Vehicle, locale: Locale) {
  return `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate} · ${vehicleStatusText(vehicle.status, locale)}`;
}

export function BookingForm({
  action,
  tenantId,
  locale,
  customers,
  vehicles,
  fixedCustomerId,
  fixedVehicleId,
  fixedLeadId,
  defaultDailyRate = 390,
  defaultMonthlyRate = 0,
  defaultDeposit = 5000,
  defaultStartDate = "",
  defaultEndDate = "",
  defaultVehicleCategory = "",
  existingBookings = [],
  submitLabel
}: BookingFormProps) {
  const router = useRouter();
  const [rentalType, setRentalType] = useState<"short_term" | "long_term">("short_term");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  const initialVehicle = useMemo(() => {
    if (fixedVehicleId) return vehicles.find(v => v.id === fixedVehicleId);
    if (defaultVehicleCategory) {
      const matched = vehicles.find(v => v.category === defaultVehicleCategory);
      if (matched) return matched;
    }
    return vehicles[0];
  }, [fixedVehicleId, defaultVehicleCategory, vehicles]);

  const [selectedVehicleId, setSelectedVehicleId] = useState(initialVehicle?.id ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || initialVehicle;

  const [dailyRate, setDailyRate] = useState(() => {
    const v = initialVehicle;
    return v ? (v.daily_rate_long_term || v.daily_rate_short_term || defaultDailyRate) : defaultDailyRate;
  });
  const [monthlyRate, setMonthlyRate] = useState(() => {
    const v = initialVehicle;
    return v ? (v.monthly_rate || (v.daily_rate_long_term || v.daily_rate_short_term || defaultDailyRate) * 30) : defaultMonthlyRate;
  });
  const [rentalAmount, setRentalAmount] = useState(() => {
    const v = initialVehicle;
    return v ? (v.monthly_rate || (v.daily_rate_long_term || v.daily_rate_short_term || defaultDailyRate) * 30) : defaultMonthlyRate;
  });
  const [deposit, setDeposit] = useState(() => {
    const v = initialVehicle;
    return v ? (v.deposit_amount || defaultDeposit) : defaultDeposit;
  });

  const [deliveryFee, setDeliveryFee] = useState(0);
  const [extras, setExtras] = useState(0);

  const calculatedDailyRate = dailyRate;
  const effectiveRentalAmount = rentalType === "long_term" ? monthlyRate : rentalAmount;
  const grandTotal = useMemo(
    () => Math.max(0, Number(effectiveRentalAmount || 0) + Number(deposit || 0) + Number(deliveryFee || 0) + Number(extras || 0)),
    [effectiveRentalAmount, deposit, deliveryFee, extras]
  );

  const isVehicleAvailable = useMemo(() => {
    return (vehicleId: string, startStr: string, endStr: string) => {
      if (!existingBookings || !existingBookings.length || !startStr || !endStr) return true;
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;

      // Check if there is any overlapping booking for this vehicle that is NOT cancelled or draft
      const activeBookings = existingBookings.filter(
        b => b.vehicle_id === vehicleId && b.status !== "cancelled" && b.status !== "draft"
      );

      for (const b of activeBookings) {
        const bStart = new Date(b.start_date);
        const bEnd = new Date(b.end_date);
        if (!isNaN(bStart.getTime()) && !isNaN(bEnd.getTime())) {
          // Overlap check
          if (bStart <= end && bEnd >= start) {
            return false;
          }
        }
      }
      return true;
    };
  }, [existingBookings]);

  const isSelectedVehicleAvailable = useMemo(() => {
    if (!selectedVehicleId) return true;
    return isVehicleAvailable(selectedVehicleId, startDate, endDate);
  }, [selectedVehicleId, startDate, endDate, isVehicleAvailable]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setResult({ ok: true, message: text(locale, "Создаю бронь...", "Creating booking...") });

    try {
      const response = await action(new FormData(event.currentTarget));
      setResult(response);
      if (response.ok) {
        router.refresh();
        if (fixedVehicleId) {
          window.setTimeout(() => {
            document.getElementById("vehicle-bookings")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 250);
        }
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : text(locale, "Не удалось создать бронь.", "Booking was not created.")
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid" data-no-global-feedback="true">
      <input type="hidden" name="tenant_id" value={tenantId} />
      {fixedLeadId ? <input type="hidden" name="lead_id" value={fixedLeadId} /> : null}
      {fixedCustomerId ? <input type="hidden" name="customer_id" value={fixedCustomerId} /> : null}
      {fixedVehicleId ? <input type="hidden" name="vehicle_id" value={fixedVehicleId} /> : null}
      <input type="hidden" name="daily_rate_applied" value={calculatedDailyRate} />
      <input type="hidden" name="total_rental_amount" value={effectiveRentalAmount || 0} />
      <input type="hidden" name="grand_total" value={grandTotal} />

      <div className="field">
        <label>{text(locale, "Номер брони", "Booking number")}</label>
        <input name="booking_number" defaultValue={currentYearBookingPrefix()} required />
      </div>

      {!fixedCustomerId ? (
        <div className="field">
          <label>{text(locale, "Клиент", "Customer")}</label>
          <select name="customer_id">
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.full_name} · {customer.whatsapp || customer.phone || "-"}</option>
            ))}
          </select>
        </div>
      ) : null}

      {!fixedVehicleId ? (
        <div className="field wide">
          <label>{text(locale, "Автомобиль", "Vehicle")}</label>
          <select
            name="vehicle_id"
            value={selectedVehicleId}
            onChange={(event) => {
              const nextVehicle = vehicles.find((vehicle) => vehicle.id === event.target.value);
              setSelectedVehicleId(event.target.value);
              if (nextVehicle) {
                const nextDaily = nextVehicle.daily_rate_long_term || nextVehicle.daily_rate_short_term || 390;
                setDailyRate(nextDaily);
                setMonthlyRate(nextVehicle.monthly_rate || nextDaily * 30);
                setRentalAmount(nextVehicle.monthly_rate || nextDaily * 30);
                setDeposit(nextVehicle.deposit_amount || 0);
              }
            }}
          >
            {vehicles.map((vehicle) => {
              const available = isVehicleAvailable(vehicle.id, startDate, endDate);
              const label = `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate} · ${available ? (locale === 'en' ? '🟢 Available' : '🟢 Свободен') : (locale === 'en' ? '🔴 Booked' : '🔴 Занят')}`;
              return (
                <option key={vehicle.id} value={vehicle.id}>
                  {label}
                </option>
              );
            })}
          </select>
          {selectedVehicle ? <span className="muted">{text(locale, "Выбрано:", "Selected:")} {vehicleOptionLabel(selectedVehicle, locale)}</span> : null}
        </div>
      ) : selectedVehicle ? (
        <div className="field wide">
          <label>{text(locale, "Автомобиль", "Vehicle")}</label>
          <div className="readonly-box">{vehicleOptionLabel(selectedVehicle, locale)}</div>
        </div>
      ) : null}

      <div className="field">
        <label>{text(locale, "Тип аренды", "Rental type")}</label>
        <select name="rental_type" value={rentalType} onChange={(event) => setRentalType(event.target.value as "short_term" | "long_term")}>
          <option value="short_term">Short-term</option>
          <option value="long_term">Long-term</option>
        </select>
      </div>

      <div className="field">
        <label>{text(locale, "Начало", "Start")}</label>
        <input name="start_date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
      </div>
      <div className="field">
        <label>{text(locale, "Конец", "End")}</label>
        <input name="end_date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
      </div>
      
      {!isSelectedVehicleAvailable ? (
        <div className="form-result wide error" style={{ margin: "0.5rem 0", padding: "0.75rem", gridColumn: "span 2" }}>
          ⚠️ {text(locale, "Внимание: этот автомобиль уже забронирован на выбранные даты!", "Warning: this vehicle is already booked for the selected dates!")}
        </div>
      ) : startDate && endDate ? (
        <div className="form-result wide ok" style={{ margin: "0.5rem 0", padding: "0.75rem", gridColumn: "span 2" }}>
          ✨ {text(locale, "Автомобиль свободен на выбранные даты.", "Vehicle is available for the selected dates.")}
        </div>
      ) : null}

      <div className="field"><label>{text(locale, "Метод выдачи", "Pickup method")}</label><select name="pickup_method"><option value="office">Office</option><option value="hotel_delivery">Hotel delivery</option><option value="airport_meet">Airport meet</option></select></div>

      {rentalType === "long_term" ? (
        <div className="field-pair wide">
          <div className="field">
            <label>{text(locale, "Цена за день", "Daily price")}</label>
            <input
              type="number"
              min="0"
              step="1"
              value={dailyRate}
              onChange={(event) => {
                const value = Number(event.target.value || 0);
                setDailyRate(value);
                setMonthlyRate(value * 30);
              }}
              placeholder="THB / день"
              required
            />
          </div>
          <div className="field">
            <label>{text(locale, "Цена за месяц", "Monthly price")}</label>
            <input
              type="number"
              min="0"
              step="1"
              value={monthlyRate}
              onChange={(event) => {
                const value = Number(event.target.value || 0);
                setMonthlyRate(value);
                setDailyRate(Math.round(value / 30));
              }}
              placeholder="THB / месяц"
              required
            />
          </div>
          <span className="muted">{text(locale, "Long-term: можно ввести цену за день или за месяц, второе поле пересчитается автоматически.", "Long-term: enter either daily or monthly price, the other field recalculates automatically.")}</span>
        </div>
      ) : (
        <>
          <div className="field">
            <label>{text(locale, "Цена в день", "Daily rate")}</label>
            <input type="number" min="0" step="1" value={dailyRate} onChange={(event) => setDailyRate(Number(event.target.value || 0))} required />
          </div>
          <div className="field">
            <label>{text(locale, "Сумма аренды", "Rental amount")}</label>
            <input type="number" min="0" step="1" value={rentalAmount} onChange={(event) => setRentalAmount(Number(event.target.value || 0))} required />
          </div>
        </>
      )}

      <div className="field"><label>{text(locale, "Депозит", "Deposit")}</label><input name="deposit_amount" type="number" min="0" step="1" value={deposit} onChange={(event) => setDeposit(Number(event.target.value || 0))} required /></div>
      <div className="field"><label>{text(locale, "Доставка / забор", "Delivery / pickup fee")}</label><input name="delivery_fee" type="number" min="0" step="1" value={deliveryFee} onChange={(event) => setDeliveryFee(Number(event.target.value || 0))} /></div>
      <div className="field"><label>Extras</label><input name="extras_total" type="number" min="0" step="1" value={extras} onChange={(event) => setExtras(Number(event.target.value || 0))} /></div>
      <div className="field"><label>{text(locale, "Итого", "Grand total")}</label><input value={grandTotal} readOnly /></div>

      {result ? (
        <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>
          {result.message}
          {result.ok && result.id ? <a href={`/bookings/${result.id}`}>{text(locale, "Открыть бронь", "Open booking")}</a> : null}
          {result.ok && fixedVehicleId ? <a href="#vehicle-bookings">{text(locale, "Показать в карточке авто", "Show in vehicle card")}</a> : null}
        </div>
      ) : null}
      <div className="field wide"><button className="primary" disabled={isSaving}>{isSaving ? text(locale, "Сохраняю...", "Saving...") : submitLabel}</button></div>
    </form>
  );
}
