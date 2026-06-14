"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";
import type { BookingStatus, RentalStatus } from "@/lib/types";

type BookingStatusButtonProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  bookingId: string;
  status: BookingStatus | RentalStatus;
  label: string;
  active?: boolean;
  locale: Locale;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function BookingStatusButton({ action, bookingId, status, label, active, locale }: BookingStatusButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleClick() {
    setResult(null);
    const formData = new FormData();
    formData.set("booking_id", bookingId);
    formData.set("status", status);

    startTransition(async () => {
      try {
        const response = await action(formData);
        setResult(response);
        if (response.ok) router.refresh();
      } catch (error) {
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : text(locale, "Не удалось изменить статус брони.", "Could not update booking status.")
        });
      }
    });
  }

  return (
    <div className="inline-action">
      <button type="button" className={active ? "primary" : "button"} onClick={handleClick} disabled={isPending}>
        {isPending ? text(locale, "Сохраняю...", "Saving...") : label}
      </button>
      {result ? <span className={`form-result ${result.ok ? "ok" : "error"}`}>{result.message}</span> : null}
    </div>
  );
}
