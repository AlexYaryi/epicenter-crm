"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";
import type { Booking } from "@/lib/types";

type BookingPaymentsFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  booking: Booking;
  tenantId: string;
  locale: Locale;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} THB`;
}

export function BookingPaymentsForm({ action, booking, tenantId, locale }: BookingPaymentsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      try {
        const response = await action(formData);
        setResult(response);
        if (response.ok) router.refresh();
      } catch (error) {
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : text(locale, "Платежи не сохранены.", "Payments were not saved.")
        });
      }
    });
  }

  return (
    <form action={submit}>
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="booking_id" value={booking.id} />
      <div className="payment-line">
        <strong>{text(locale, "Аренда", "Rental")}</strong>
        <input name="rental_amount" type="number" min="0" defaultValue={booking.rental_amount} />
      </div>
      <div className="payment-line">
        <strong>{text(locale, "Депозит", "Deposit")}</strong>
        <input name="deposit_amount" type="number" min="0" defaultValue={booking.deposit_amount} />
      </div>
      <div className="payment-line">
        <strong>{text(locale, "Забор", "Pickup")}</strong>
        <input name="pickup_fee" type="number" min="0" defaultValue={booking.pickup_fee} />
      </div>
      <div className="payment-line">
        <strong>{text(locale, "Доставка", "Delivery")}</strong>
        <input name="delivery_fee" type="number" min="0" defaultValue={booking.delivery_fee} />
      </div>
      <div className="field">
        <label>{text(locale, "Метод", "Method")}</label>
        <select name="method" defaultValue="cash">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="crypto_usdt">USDT</option>
        </select>
      </div>
      <div className="total">
        <span>{text(locale, "Итого", "Grand total")}</span>
        <b>{money(booking.grand_total)}</b>
      </div>
      <br />
      <button className="primary" disabled={isPending}>
        {isPending ? text(locale, "Записываю...", "Recording...") : text(locale, "Записать оплату", "Record payment")}
      </button>
      {result ? <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div> : null}
    </form>
  );
}
