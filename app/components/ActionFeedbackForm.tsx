"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type ActionFeedbackFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  locale: Locale;
  savingText?: string;
  fallbackError?: string;
  confirmText?: string;
  redirectBasePath?: string;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function ActionFeedbackForm({ action, children, className, locale, savingText, fallbackError, confirmText, redirectBasePath }: ActionFeedbackFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function submit(formData: FormData) {
    if (confirmText && !window.confirm(confirmText)) {
      return;
    }
    setResult({ ok: true, message: savingText ?? text(locale, "Сохраняю...", "Saving...") });
    startTransition(async () => {
      try {
        const response = await action(formData);
        setResult(response);
        if (response.ok && redirectBasePath && response.id) {
          router.push(`${redirectBasePath}/${response.id}`);
          return;
        }
        if (response.ok) router.refresh();
      } catch (error) {
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : fallbackError ?? text(locale, "Данные не сохранены.", "Data was not saved.")
        });
      }
    });
  }

  return (
    <form action={submit} className={className} aria-busy={isPending}>
      {children}
      {result ? <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div> : null}
    </form>
  );
}
