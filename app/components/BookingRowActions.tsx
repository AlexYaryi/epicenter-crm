"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type BookingRowActionsProps = {
  bookingId: string;
  bookingStatus: string;
  canDelete?: boolean;
  locale: Locale;
  cancelAction: (formData: FormData) => ActionResult | Promise<ActionResult>;
  deleteAction: (formData: FormData) => ActionResult | Promise<ActionResult>;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function BookingRowActions({
  bookingId,
  bookingStatus,
  canDelete = false,
  locale,
  cancelAction,
  deleteAction
}: BookingRowActionsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  function runAction(kind: "cancel" | "delete") {
    setResult(null);
    const formData = new FormData();
    formData.set("booking_id", bookingId);
    formData.set("return_path", pathname);
    formData.set("redirect_to", pathname === `/bookings/${bookingId}` ? "/bookings" : pathname);
    if (kind === "cancel") {
      formData.set("cancellation_reason", text(locale, "Отменено из таблицы броней", "Cancelled from bookings table"));
    } else {
      formData.set("confirm_delete", confirmDelete);
    }

    startTransition(async () => {
      try {
        const response = await (kind === "cancel" ? cancelAction(formData) : deleteAction(formData));
        setResult(response);
        if (response.ok) router.refresh();
      } catch (error) {
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : text(locale, "Действие не выполнено.", "Action was not completed.")
        });
      }
    });
  }

  const isCancelled = bookingStatus === "cancelled";

  return (
    <div className="action-stack">
      <a className="button" href={`/bookings/${bookingId}`}>{text(locale, "Открыть / править", "Open / edit")}</a>
      <button
        type="button"
        className="button"
        disabled={isPending || isCancelled}
        onClick={() => runAction("cancel")}
      >
        {isPending ? text(locale, "Сохраняю...", "Saving...") : text(locale, "Отменить", "Cancel")}
      </button>
      {canDelete ? (
        <details className="inline-details">
          <summary>{text(locale, "Удалить", "Delete")}</summary>
          <div className="action-stack">
            <input
              value={confirmDelete}
              onChange={(event) => setConfirmDelete(event.target.value)}
              placeholder="DELETE"
              aria-label={text(locale, "Введите DELETE", "Type DELETE")}
            />
            <button type="button" className="button danger" disabled={isPending} onClick={() => runAction("delete")}>
              {text(locale, "Удалить бронь", "Delete booking")}
            </button>
          </div>
        </details>
      ) : null}
      {result ? <span className={`form-result ${result.ok ? "ok" : "error"}`}>{result.message}</span> : null}
    </div>
  );
}
