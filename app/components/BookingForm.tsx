"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import type { ActionResult } from "@/lib/actions";
import type { Customer, Vehicle, Booking, MaintenanceBlock } from "@/lib/types";

type BookingFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  tenantId: string;
  locale: Locale;
  customers: Customer[];
  vehicles: Vehicle[];
  fixedCustomerId?: string;
  preferredCustomerId?: string | null;
  fixedVehicleId?: string;
  fixedLeadId?: string;
  defaultDailyRate?: number;
  defaultMonthlyRate?: number;
  defaultDeposit?: number;
  defaultStartDate?: string;
  defaultEndDate?: string;
  defaultVehicleCategory?: string;
  existingBookings?: Booking[];
  existingMaintenance?: MaintenanceBlock[];
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

function customerOptionLabel(customer: Customer) {
  const name = customer.full_name || customer.full_name_passport || customer.whatsapp || customer.phone || customer.telegram_username || "Клиент";
  const contact = customer.whatsapp || customer.phone || customer.telegram_username || "-";
  return `${name} · ${contact}`;
}

const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
const alwaysUnavailableVehicleStatuses = new Set(["maintenance", "repair", "retired"]);
const busyVehicleStatuses = new Set(["reserved", "handed_over", "in_use", "returning"]);

function rentalDays(startStr: string, endStr: string) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diff = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, diff);
}

function fallbackVehiclePrice(vehicle: Vehicle | undefined, defaultDailyRate: number, defaultMonthlyRate: number) {
  const daily = vehicle ? (vehicle.daily_rate_long_term || vehicle.daily_rate_short_term || defaultDailyRate) : defaultDailyRate;
  const monthly = vehicle ? (vehicle.monthly_rate || daily * 30) : (defaultMonthlyRate || daily * 30);
  return { daily, monthly };
}

function vehiclePriceQuote(
  vehicle: Vehicle | undefined,
  rentalType: "short_term" | "long_term",
  startDate: string,
  endDate: string,
  defaultDailyRate: number,
  defaultMonthlyRate: number
) {
  const fallback = fallbackVehiclePrice(vehicle, defaultDailyRate, defaultMonthlyRate);
  if (!vehicle) return { daily: fallback.daily, monthly: fallback.monthly, total: fallback.monthly };

  const rules = (vehicle.price_rules ?? []).filter((rule) => rule.active);
  const days = rentalDays(startDate, endDate);
  if (rentalType === "long_term") {
    const longTermRule = rules.find((rule) => rule.duration_bucket === "long_term" && rule.monthly_rate_thb);
    const monthly = longTermRule?.monthly_rate_thb ?? fallback.monthly;
    return { daily: Math.round(monthly / 30), monthly, total: monthly };
  }

  if (!days) {
    return { daily: fallback.daily, monthly: fallback.monthly, total: fallback.daily };
  }

  const month = new Date(startDate).getMonth() + 1;
  const season = [11, 12, 1, 2, 3].includes(month) ? "high" : "medium";
  const matchingRule = rules
    .filter((rule) => rule.season === season || rule.season_months.includes(month))
    .find((rule) => days >= rule.min_days && days <= rule.max_days);

  if (matchingRule?.monthly_rate_thb) {
    const daily = Math.round(matchingRule.monthly_rate_thb / Math.max(days, 1));
    return { daily, monthly: matchingRule.monthly_rate_thb, total: matchingRule.monthly_rate_thb };
  }

  const daily = matchingRule?.daily_rate_thb ?? (days >= 30 ? fallback.monthly / 30 : (vehicle.daily_rate_short_term || fallback.daily));
  return { daily: Math.round(daily), monthly: fallback.monthly, total: Math.round(daily * days) };
}

export function BookingForm({
  action,
  tenantId,
  locale,
  customers,
  vehicles,
  fixedCustomerId,
  preferredCustomerId,
  fixedVehicleId,
  fixedLeadId,
  defaultDailyRate = 390,
  defaultMonthlyRate = 0,
  defaultDeposit = 5000,
  defaultStartDate = "",
  defaultEndDate = "",
  defaultVehicleCategory = "",
  existingBookings = [],
  existingMaintenance = [],
  submitLabel
}: BookingFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [rentalType, setRentalType] = useState<"short_term" | "long_term">("short_term");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("12:00");
  const [splitBooking, setSplitBooking] = useState(false);
  const [temporaryPriceIncluded, setTemporaryPriceIncluded] = useState(true);
  const [temporaryVehicleId, setTemporaryVehicleId] = useState("");
  const [temporaryStartDate, setTemporaryStartDate] = useState(defaultStartDate);
  const [temporaryEndDate, setTemporaryEndDate] = useState(defaultStartDate);
  const [temporaryStartTime, setTemporaryStartTime] = useState("12:00");
  const [temporaryEndTime, setTemporaryEndTime] = useState("12:00");

  const handleStartTimeChange = (val: string) => {
    setStartTime(val);
    setEndTime(val);
    if (splitBooking) {
      setTemporaryStartTime(val);
      setTemporaryEndTime(val);
    }
  };

  const [vehicleSearch, setVehicleSearch] = useState("");
  const [tempVehicleSearch, setTempVehicleSearch] = useState("");

  const sortVehicles = (list: Vehicle[]) => {
    return [...list].sort((a, b) => {
      const makeCompare = (a.make || "").localeCompare(b.make || "", locale === "en" ? "en" : "ru");
      if (makeCompare !== 0) return makeCompare;
      const modelCompare = (a.model || "").localeCompare(b.model || "", locale === "en" ? "en" : "ru");
      if (modelCompare !== 0) return modelCompare;
      return (a.license_plate || "").localeCompare(b.license_plate || "");
    });
  };

  const initialVehicle = useMemo(() => {
    if (fixedVehicleId) return vehicles.find(v => v.id === fixedVehicleId);
    if (defaultVehicleCategory) {
      const matched = vehicles.find(v => v.category === defaultVehicleCategory);
      if (matched) return matched;
    }
    return vehicles[0];
  }, [fixedVehicleId, defaultVehicleCategory, vehicles]);

  const [selectedVehicleId, setSelectedVehicleId] = useState(initialVehicle?.id ?? "");

  const filteredVehicles = useMemo(() => {
    const sorted = sortVehicles(vehicles);
    const q = vehicleSearch.toLowerCase().trim();
    if (!q) return sorted;
    return sorted.filter(v => 
      v.id === selectedVehicleId ||
      (v.make || "").toLowerCase().includes(q) ||
      (v.model || "").toLowerCase().includes(q) ||
      (v.license_plate || "").toLowerCase().includes(q)
    );
  }, [vehicles, vehicleSearch, selectedVehicleId, locale]);

  const filteredTempVehicles = useMemo(() => {
    const baseList = vehicles.filter((v) => v.id !== selectedVehicleId);
    const sorted = sortVehicles(baseList);
    const q = tempVehicleSearch.toLowerCase().trim();
    if (!q) return sorted;
    return sorted.filter(v => 
      v.id === temporaryVehicleId ||
      (v.make || "").toLowerCase().includes(q) ||
      (v.model || "").toLowerCase().includes(q) ||
      (v.license_plate || "").toLowerCase().includes(q)
    );
  }, [vehicles, tempVehicleSearch, selectedVehicleId, temporaryVehicleId, locale]);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const selectedPreferredCustomerId = useMemo(() => {
    if (!preferredCustomerId) return undefined;
    return customers.some((customer) => customer.id === preferredCustomerId) ? preferredCustomerId : undefined;
  }, [customers, preferredCustomerId]);

  function revealVehicleBookings() {
    const bookingsPanel = document.getElementById("vehicle-bookings");
    if (bookingsPanel) {
      bookingsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function formValue(formData: FormData, key: string) {
    return String(formData.get(key) ?? "").trim();
  }

  function formNumber(formData: FormData, key: string) {
    return Number(formData.get(key) || 0);
  }

  async function createBookingViaApi(formData: FormData): Promise<ActionResult> {
    const startDateValue = formValue(formData, "start_date");
    const endDateValue = formValue(formData, "end_date");
    const startTimeValue = formValue(formData, "start_time") || "12:00";
    const endTimeValue = formValue(formData, "end_time") || "12:00";
    const payload = {
      tenant_id: tenantId,
      lead_id: formValue(formData, "lead_id") || undefined,
      booking_number: formValue(formData, "booking_number"),
      customer_id: formValue(formData, "customer_id"),
      vehicle_id: formValue(formData, "vehicle_id"),
      rental_type: formValue(formData, "rental_type") || "short_term",
      status: "confirmed",
      start_date: startDateValue && startTimeValue ? `${startDateValue}T${startTimeValue}` : startDateValue,
      end_date: endDateValue && endTimeValue ? `${endDateValue}T${endTimeValue}` : endDateValue,
      pickup_method: formValue(formData, "pickup_method") || "office",
      pickup_location: formValue(formData, "pickup_location") || null,
      return_location: formValue(formData, "return_location") || null,
      daily_rate_applied: formNumber(formData, "daily_rate_applied"),
      total_rental_amount: formNumber(formData, "total_rental_amount"),
      deposit_amount: formNumber(formData, "deposit_amount"),
      delivery_fee: formNumber(formData, "delivery_fee"),
      extras_total: formNumber(formData, "extras_total"),
      discount_amount: 0,
      grand_total: formNumber(formData, "grand_total"),
      currency: "THB"
    };

    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = typeof json.error === "string" ? json.error : text(locale, "Не удалось создать бронь.", "Booking was not created.");
      if (response.status === 401 || message === "Authentication required") {
        return {
          ok: false,
          message: text(
            locale,
            "Сессия CRM не передалась при создании брони. Обновите страницу, войдите снова и повторите создание.",
            "CRM session was not sent while creating the booking. Refresh, sign in again, and retry."
          )
        };
      }
      if (response.status === 403) {
        return {
          ok: false,
          message: text(locale, `Недостаточно прав для создания брони: ${message}`, `Not enough permissions to create booking: ${message}`)
        };
      }
      return { ok: false, message };
    }

    const bookingId = json.data?.id as string | undefined;
    const bookingNumber = json.data?.booking_number as string | undefined;
    return {
      ok: true,
      id: bookingId,
      message: bookingNumber
        ? text(locale, `Бронь ${bookingNumber} создана и автомобиль отмечен как забронированный.`, `Booking ${bookingNumber} created and vehicle marked as reserved.`)
        : text(locale, "Бронь создана и автомобиль отмечен как забронированный.", "Booking created and vehicle marked as reserved.")
    };
  }

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || initialVehicle;
  const temporaryVehicle = vehicles.find((vehicle) => vehicle.id === temporaryVehicleId);

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
  const [temporaryDailyRate, setTemporaryDailyRate] = useState(defaultDailyRate);
  const [temporaryRentalAmount, setTemporaryRentalAmount] = useState(defaultDailyRate);

  useEffect(() => {
    const quote = vehiclePriceQuote(selectedVehicle, rentalType, startDate, endDate, defaultDailyRate, defaultMonthlyRate);
    setDailyRate(quote.daily);
    setMonthlyRate(quote.monthly);
    setRentalAmount(quote.total);
  }, [selectedVehicle, rentalType, startDate, endDate, defaultDailyRate, defaultMonthlyRate]);

  useEffect(() => {
    if (!splitBooking) return;
    const quote = vehiclePriceQuote(temporaryVehicle, "short_term", temporaryStartDate, temporaryEndDate, defaultDailyRate, defaultMonthlyRate);
    setTemporaryDailyRate(quote.daily);
    setTemporaryRentalAmount(quote.total);
  }, [splitBooking, temporaryVehicle, temporaryStartDate, temporaryEndDate, defaultDailyRate, defaultMonthlyRate]);

  const calculatedDailyRate = dailyRate;
  const effectiveRentalAmount = rentalType === "long_term" ? monthlyRate : rentalAmount;
  const effectiveTemporaryRentalAmount = splitBooking && !temporaryPriceIncluded ? temporaryRentalAmount : 0;
  const grandTotal = useMemo(
    () => Math.max(0, Number(effectiveRentalAmount || 0) + Number(effectiveTemporaryRentalAmount || 0) + Number(deposit || 0) + Number(deliveryFee || 0) + Number(extras || 0)),
    [effectiveRentalAmount, effectiveTemporaryRentalAmount, deposit, deliveryFee, extras]
  );

  const isVehicleAvailable = useMemo(() => {
    return (vehicleId: string, startStr: string, endStr: string) => {
      const vehicle = vehicles.find((item) => item.id === vehicleId);
      if (!startStr || !endStr) return true;
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
      const vehicleStatus = String(vehicle?.status ?? "");

      // Check only statuses that actually block vehicle availability.
      const activeBookings = existingBookings.filter((booking) => {
        const blocksByBookingStatus = blockingBookingStatuses.has(booking.status);
        const blocksByRentalStatus = blockingRentalStatuses.has(booking.rental_status);
        return booking.vehicle_id === vehicleId && (blocksByBookingStatus || blocksByRentalStatus);
      });

      const activeBookingWindows = activeBookings
        .map((booking) => {
          const bookingStart = new Date(booking.start_date);
          const bookingEnd = new Date(booking.actual_end ?? booking.end_date);
          if (isNaN(bookingStart.getTime()) || isNaN(bookingEnd.getTime())) {
            return null;
          }
          return { start: bookingStart, end: bookingEnd };
        })
        .filter((window): window is { start: Date; end: Date } => Boolean(window));

      for (const window of activeBookingWindows) {
        if (window.start <= end && window.end >= start) {
          return false;
        }
      }

      const activeMaintenanceWindows = existingMaintenance
        .filter((item) => {
          const status = String(item.status ?? "");
          return item.vehicle_id === vehicleId && (status === "scheduled" || status === "in_progress");
        })
        .map((item) => {
          const blockStart = new Date(String(item.vehicle_unavailable_from ?? "").slice(0, 10));
          const blockEnd = new Date(String(item.vehicle_unavailable_to ?? "9999-12-31").slice(0, 10));
          if (isNaN(blockStart.getTime()) || isNaN(blockEnd.getTime())) {
            return null;
          }
          return { start: blockStart, end: blockEnd };
        })
        .filter((window): window is { start: Date; end: Date } => Boolean(window));

      for (const window of activeMaintenanceWindows) {
        if (window.start <= end && window.end >= start) {
          return false;
        }
      }

      if (alwaysUnavailableVehicleStatuses.has(vehicleStatus)) {
        return false;
      }

      // If the car is physically busy, keep it blocked until the last known
      // active booking window ends. Without a window we block it entirely.
      if (busyVehicleStatuses.has(vehicleStatus)) {
        if (activeBookingWindows.length === 0) {
          return false;
        }
        const latestBlockingEnd = activeBookingWindows.reduce(
          (latest, window) => (window.end > latest ? window.end : latest),
          activeBookingWindows[0].end
        );
        if (start <= latestBlockingEnd) {
          return false;
        }
      }

      return true;
    };
  }, [existingBookings, existingMaintenance, vehicles]);

  const isSelectedVehicleAvailable = useMemo(() => {
    if (!selectedVehicleId) return true;
    return isVehicleAvailable(selectedVehicleId, startDate, endDate);
  }, [selectedVehicleId, startDate, endDate, isVehicleAvailable]);

  const isTemporaryVehicleAvailable = useMemo(() => {
    if (!splitBooking || !temporaryVehicleId) return true;
    return isVehicleAvailable(temporaryVehicleId, temporaryStartDate, temporaryEndDate);
  }, [splitBooking, temporaryVehicleId, temporaryStartDate, temporaryEndDate, isVehicleAvailable]);

  const selectableVehicles = useMemo(
    () => filteredVehicles.filter((vehicle) => isVehicleAvailable(vehicle.id, startDate, endDate)),
    [filteredVehicles, isVehicleAvailable, startDate, endDate]
  );

  const selectableTempVehicles = useMemo(
    () => filteredTempVehicles.filter((vehicle) => isVehicleAvailable(vehicle.id, temporaryStartDate, temporaryEndDate)),
    [filteredTempVehicles, isVehicleAvailable, temporaryStartDate, temporaryEndDate]
  );

  useEffect(() => {
    if (fixedVehicleId) return;
    if (selectedVehicleId && selectableVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) return;
    const nextVehicle = selectableVehicles[0];
    setSelectedVehicleId(nextVehicle?.id ?? "");
  }, [fixedVehicleId, selectableVehicles, selectedVehicleId]);

  useEffect(() => {
    if (!splitBooking) return;
    if (temporaryVehicleId && selectableTempVehicles.some((vehicle) => vehicle.id === temporaryVehicleId)) return;
    setTemporaryVehicleId(selectableTempVehicles[0]?.id ?? "");
  }, [selectableTempVehicles, splitBooking, temporaryVehicleId]);

  const canSubmitSplitBooking = !splitBooking || Boolean(
    temporaryVehicleId &&
    temporaryStartDate &&
    temporaryEndDate &&
    temporaryVehicleId !== selectedVehicleId &&
    isTemporaryVehicleAvailable &&
    isSelectedVehicleAvailable
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setResult({ ok: true, message: text(locale, "Создаю бронь...", "Creating booking...") });

    try {
      const formData = new FormData(event.currentTarget);
      const response = splitBooking ? await action(formData) : await createBookingViaApi(formData);
      setResult(response);
      if (response.ok) {
        router.refresh();
        if (fixedVehicleId) {
          window.setTimeout(() => {
            window.history.replaceState(null, "", `${pathname}#vehicle-bookings`);
            router.refresh();
            revealVehicleBookings();
          }, 300);
          window.setTimeout(() => {
            router.refresh();
            revealVehicleBookings();
          }, 1100);
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
      {splitBooking ? (
        <>
          <input type="hidden" name="split_booking" value="on" />
          {temporaryPriceIncluded ? <input type="hidden" name="temporary_price_included" value="on" /> : null}
          <input type="hidden" name="temporary_daily_rate_applied" value={temporaryDailyRate || 0} />
          <input type="hidden" name="temporary_total_rental_amount" value={temporaryRentalAmount || 0} />
        </>
      ) : null}

      <div className="field">
        <label>{text(locale, "Номер брони", "Booking number")}</label>
        <input name="booking_number" defaultValue={currentYearBookingPrefix()} required />
      </div>

      {!fixedCustomerId ? (
        <div className="field">
          <label>{text(locale, "Клиент", "Customer")}</label>
          <select name="customer_id" defaultValue={selectedPreferredCustomerId}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customerOptionLabel(customer)}</option>
            ))}
          </select>
          {selectedPreferredCustomerId ? (
            <span className="muted">
              {text(locale, "Новый клиент уже выбран для этой брони.", "The newly created customer is already selected.")}
            </span>
          ) : null}
        </div>
      ) : null}

      {!fixedVehicleId ? (
        <div className="field wide">
          <label>{splitBooking ? text(locale, "Основной / желаемый автомобиль", "Main / desired vehicle") : text(locale, "Автомобиль", "Vehicle")}</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <input
              type="text"
              placeholder={text(locale, "🔍 Поиск машины (марка, модель или госномер)...", "🔍 Search vehicle (make, model or plate)...")}
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              className="input"
              style={{
                padding: "6px 10px",
                fontSize: "13px",
                border: "1px solid var(--line, #e2e8f0)",
                borderRadius: "6px",
                width: "100%"
              }}
            />
            <select
              name="vehicle_id"
              value={selectedVehicleId}
              onChange={(event) => {
                const nextVehicle = vehicles.find((vehicle) => vehicle.id === event.target.value);
                setSelectedVehicleId(event.target.value);
                if (nextVehicle) {
                  const quote = vehiclePriceQuote(nextVehicle, rentalType, startDate, endDate, defaultDailyRate, defaultMonthlyRate);
                  setDailyRate(quote.daily);
                  setMonthlyRate(quote.monthly);
                  setRentalAmount(quote.total);
                  setDeposit(nextVehicle.deposit_amount || 0);
                }
              }}
            >
              {selectableVehicles.map((vehicle) => {
                const label = `${vehicle.make} ${vehicle.model} · ${vehicle.license_plate} · ${locale === 'en' ? '🟢 Available' : '🟢 Свободен'}`;
                return (
                  <option key={vehicle.id} value={vehicle.id}>
                    {label}
                  </option>
                );
              })}
              {selectableVehicles.length === 0 ? (
                <option value="" disabled>{text(locale, "Нет свободных машин на эти даты", "No available vehicles for these dates")}</option>
              ) : null}
            </select>
          </div>
          {selectedVehicle ? <span className="muted">{text(locale, "Выбрано:", "Selected:")} {vehicleOptionLabel(selectedVehicle, locale)}</span> : null}
        </div>
      ) : selectedVehicle ? (
        <div className="field wide">
          <label>{text(locale, "Автомобиль", "Vehicle")}</label>
          <div className="readonly-box">{vehicleOptionLabel(selectedVehicle, locale)}</div>
        </div>
      ) : null}

      <div className="field wide">
        <label className="checkbox-line" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
          <input
            type="checkbox"
            checked={splitBooking}
            onChange={(event) => {
              setSplitBooking(event.target.checked);
              if (event.target.checked && !temporaryVehicleId) {
                const fallbackVehicle = vehicles.find((vehicle) =>
                  vehicle.id !== selectedVehicleId &&
                  isVehicleAvailable(vehicle.id, temporaryStartDate, temporaryEndDate)
                );
                setTemporaryVehicleId(fallbackVehicle?.id ?? "");
              }
            }}
          />
          <span>
            <strong>{text(locale, "Составная бронь: временная машина → желаемая машина", "Split booking: temporary car → desired car")}</strong>
            <br />
            <span className="muted">
              {text(
                locale,
                "Если нужная машина занята в начале аренды, CRM создаст две брони и заблокирует даты обеих машин.",
                "If the desired car is busy at the start, CRM creates two bookings and blocks both cars."
              )}
            </span>
          </span>
        </label>
      </div>

      {splitBooking ? (
        <div className="field-pair wide">
          <div className="field wide">
            <label className="checkbox-line" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
              <input
                type="checkbox"
                checked={temporaryPriceIncluded}
                onChange={(event) => setTemporaryPriceIncluded(event.target.checked)}
              />
              <span>
                <strong>{text(locale, "Стоимость временной машины входит в цену основной", "Temporary car price is included in the main price")}</strong>
                <br />
                <span className="muted">
                  {text(
                    locale,
                    "Включено: клиент платит только основную цену, временная машина нужна для занятости и операционного контроля. Выключено: CRM считает две цены отдельно.",
                    "On: customer pays only the main price, temporary car is for availability and operations. Off: CRM charges both car periods separately."
                  )}
                </span>
              </span>
            </label>
          </div>
          <div className="field wide">
            <label>{text(locale, "Основной / желаемый автомобиль", "Main / desired vehicle")}</label>
            {!fixedVehicleId ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <input
                  type="text"
                  placeholder={text(locale, "🔍 Поиск основной машины...", "🔍 Search main vehicle...")}
                  value={vehicleSearch}
                  onChange={(event) => setVehicleSearch(event.target.value)}
                  className="input"
                  style={{
                    padding: "6px 10px",
                    fontSize: "13px",
                    border: "1px solid var(--line, #e2e8f0)",
                    borderRadius: "6px",
                    width: "100%"
                  }}
                />
                <select
                  value={selectedVehicleId}
                  onChange={(event) => {
                    const nextVehicle = vehicles.find((vehicle) => vehicle.id === event.target.value);
                    setSelectedVehicleId(event.target.value);
                    if (nextVehicle) {
                      const quote = vehiclePriceQuote(nextVehicle, rentalType, startDate, endDate, defaultDailyRate, defaultMonthlyRate);
                      setDailyRate(quote.daily);
                      setMonthlyRate(quote.monthly);
                      setRentalAmount(quote.total);
                      setDeposit(nextVehicle.deposit_amount || 0);
                    }
                  }}
                >
                  {selectableVehicles.map((vehicle) => {
                    return (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.make} {vehicle.model} · {vehicle.license_plate} · {text(locale, "🟢 Свободен", "🟢 Available")}
                      </option>
                    );
                  })}
                  {selectableVehicles.length === 0 ? (
                    <option value="" disabled>{text(locale, "Нет свободных машин на эти даты", "No available vehicles for these dates")}</option>
                  ) : null}
                </select>
                {selectedVehicle ? (
                  <span className="muted">
                    {text(locale, "Именно эта машина будет второй частью составной брони.", "This car will be the second part of the split booking.")}
                  </span>
                ) : null}
              </div>
            ) : selectedVehicle ? (
              <div className="readonly-box">{vehicleOptionLabel(selectedVehicle, locale)}</div>
            ) : null}
          </div>
          <div className="field">
            <label>{text(locale, "Временный автомобиль", "Temporary vehicle")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <input
                type="text"
                placeholder={text(locale, "🔍 Поиск временной машины...", "🔍 Search temporary vehicle...")}
                value={tempVehicleSearch}
                onChange={(e) => setTempVehicleSearch(e.target.value)}
                className="input"
                style={{
                  padding: "6px 10px",
                  fontSize: "13px",
                  border: "1px solid var(--line, #e2e8f0)",
                  borderRadius: "6px",
                  width: "100%"
                }}
              />
              <select
                name="temporary_vehicle_id"
                value={temporaryVehicleId}
                onChange={(event) => setTemporaryVehicleId(event.target.value)}
                required={splitBooking}
              >
                <option value="">{text(locale, "Выберите временную машину", "Choose temporary car")}</option>
                {selectableTempVehicles.map((vehicle) => {
                  return (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.make} {vehicle.model} · {vehicle.license_plate} · {text(locale, "🟢 Свободен", "🟢 Available")}
                    </option>
                  );
                })}
                {selectableTempVehicles.length === 0 ? (
                  <option value="" disabled>{text(locale, "Нет свободных временных машин", "No available temporary vehicles")}</option>
                ) : null}
              </select>
            </div>
          </div>
          <div className="field">
            <label>{text(locale, "Даты временной машины", "Temporary car dates")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  name="temporary_start_date"
                  type="date"
                  value={temporaryStartDate}
                  onChange={(event) => setTemporaryStartDate(event.target.value)}
                  required={splitBooking}
                  style={{ flex: 2 }}
                />
                <input
                  name="temporary_start_time"
                  type="time"
                  value={temporaryStartTime}
                  onChange={(event) => setTemporaryStartTime(event.target.value)}
                  required={splitBooking}
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  name="temporary_end_date"
                  type="date"
                  value={temporaryEndDate}
                  onChange={(event) => setTemporaryEndDate(event.target.value)}
                  required={splitBooking}
                  style={{ flex: 2 }}
                />
                <input
                  name="temporary_end_time"
                  type="time"
                  value={temporaryEndTime}
                  onChange={(event) => setTemporaryEndTime(event.target.value)}
                  required={splitBooking}
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>
          <div className="field">
            <label>{text(locale, "Цена временной машины / день", "Temporary car daily rate")}</label>
            <input
              type="number"
              min="0"
              step="1"
              value={temporaryDailyRate}
              onChange={(event) => {
                const value = Number(event.target.value || 0);
                setTemporaryDailyRate(value);
                setTemporaryRentalAmount(value * rentalDays(temporaryStartDate, temporaryEndDate));
              }}
            />
          </div>
          <div className="field">
            <label>
              {temporaryPriceIncluded
                ? text(locale, "Сумма временной аренды (не добавляется к итогу)", "Temporary rental amount (not added to total)")
                : text(locale, "Сумма временной аренды", "Temporary rental amount")}
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={temporaryRentalAmount}
              onChange={(event) => setTemporaryRentalAmount(Number(event.target.value || 0))}
            />
          </div>
          {!isTemporaryVehicleAvailable ? (
            <div className="form-result wide error">
              ⚠️ {text(locale, "Временный автомобиль уже занят на эти даты.", "Temporary vehicle is already booked for these dates.")}
            </div>
          ) : temporaryVehicleId && temporaryStartDate && temporaryEndDate ? (
            <div className="form-result wide ok">
              {text(locale, "Временный автомобиль свободен на выбранные даты.", "Temporary vehicle is available for the selected dates.")}
            </div>
          ) : null}
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
        <label>{splitBooking ? text(locale, "Начало желаемой машины", "Desired car start") : text(locale, "Начало", "Start")}</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input name="start_date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required style={{ flex: 2 }} />
          <input name="start_time" type="time" value={startTime} onChange={e => handleStartTimeChange(e.target.value)} required style={{ flex: 1 }} />
        </div>
      </div>
      <div className="field">
        <label>{splitBooking ? text(locale, "Конец желаемой машины", "Desired car end") : text(locale, "Конец", "End")}</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input name="end_date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required style={{ flex: 2 }} />
          <input name="end_time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required style={{ flex: 1 }} />
        </div>
      </div>
      
      {!isSelectedVehicleAvailable ? (
        <div className="form-result wide error" style={{ margin: "0.5rem 0", padding: "0.75rem", gridColumn: "span 2" }}>
          ⚠️ {text(locale, "Внимание: этот автомобиль уже забронирован на выбранные даты!", "Warning: this vehicle is already booked for the selected dates!")}
          <br />
          <span className="muted">
            {text(locale, "Включите составную бронь и поставьте для желаемой машины только свободный период.", "Use split booking and set the desired car only for the available period.")}
          </span>
        </div>
      ) : startDate && endDate ? (
        <div className="form-result wide ok" style={{ margin: "0.5rem 0", padding: "0.75rem", gridColumn: "span 2" }}>
          ✨ {text(locale, "Автомобиль свободен на выбранные даты.", "Vehicle is available for the selected dates.")}
        </div>
      ) : null}

      <div className="field"><label>{text(locale, "Метод выдачи", "Pickup method")}</label><select name="pickup_method"><option value="office">Office</option><option value="hotel_delivery">Hotel delivery</option><option value="airport_meet">Airport meet</option></select></div>

      <div className="field">
        <label>{text(locale, "Место выдачи", "Pickup location")}</label>
        <input name="pickup_location" placeholder={text(locale, "Отель / аэропорт / адрес или Google ссылка", "Hotel / airport / address or Google link")} />
      </div>

      <div className="field">
        <label>{text(locale, "Место возврата", "Return location")}</label>
        <input name="return_location" placeholder={text(locale, "Отель / аэропорт / адрес или Google ссылка", "Hotel / airport / address or Google link")} />
      </div>

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
      {splitBooking ? (
        <div className="form-result wide ok">
          {temporaryPriceIncluded
            ? text(locale, "Итог считает только основную машину, депозит, доставку/забор и extras. Временная машина блокирует даты, но не добавляет цену.", "Total counts only the main car, deposit, delivery/pickup and extras. Temporary car blocks dates but does not add price.")
            : text(locale, "Итог включает временную машину, желаемую машину, депозит, доставку/забор и extras.", "Total includes temporary car, desired car, deposit, delivery/pickup and extras.")}
        </div>
      ) : null}

      {result ? (
        <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>
          {result.message}
          {result.ok && fixedVehicleId ? (
            <span className="muted">{text(locale, "Карточка автомобиля обновляется, ниже будет виден новый статус и бронь.", "Vehicle card is refreshing, the new status and booking will be visible below.")}</span>
          ) : null}
          {result.ok && result.id ? <a href={`/bookings/${result.id}`}>{text(locale, "Открыть бронь", "Open booking")}</a> : null}
          {result.ok && fixedVehicleId ? <a href="#vehicle-bookings">{text(locale, "Показать в карточке авто", "Show in vehicle card")}</a> : null}
        </div>
      ) : null}
      <div className="field wide"><button className="primary" disabled={isSaving || !canSubmitSplitBooking}>{isSaving ? text(locale, "Сохраняю...", "Saving...") : submitLabel}</button></div>
    </form>
  );
}
