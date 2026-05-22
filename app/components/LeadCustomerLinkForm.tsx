"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type LeadCustomerLinkFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  tenantId: string;
  leadId: string;
  source: string;
  defaultName: string;
  defaultPhone?: string | null;
  defaultTelegram?: string | null;
  locale: Locale;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function LeadCustomerLinkForm({ action, tenantId, leadId, source, defaultName, defaultPhone, defaultTelegram, locale }: LeadCustomerLinkFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setResult(null);
    try {
      const response = await action(new FormData(event.currentTarget));
      setResult(response);
      if (response.ok) router.refresh();
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : text(locale, "Не удалось создать клиента.", "Could not create customer.")
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid" data-no-global-feedback="true">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="source" value={source} />
      <div className="field">
        <label>{text(locale, "Имя", "Name")}</label>
        <input name="full_name" defaultValue={defaultName} required />
      </div>
      <div className="field">
        <label>{text(locale, "Телефон / WhatsApp", "Phone / WhatsApp")}</label>
        <input name="phone" defaultValue={defaultPhone ?? ""} />
      </div>
      <div className="field">
        <label>Telegram</label>
        <input name="telegram_username" defaultValue={defaultTelegram ?? ""} placeholder="@username или chat id" />
      </div>
      {result ? (
        <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>
          {result.message}
          {result.ok && result.id ? <> <a href={`/customers/${result.id}`}>{text(locale, "Открыть клиента", "Open customer")}</a></> : null}
        </div>
      ) : null}
      <div className="field wide">
        <button className="primary" disabled={isSaving}>
          {isSaving ? text(locale, "Создаю...", "Creating...") : text(locale, "Создать и привязать клиента", "Create and link customer")}
        </button>
      </div>
    </form>
  );
}
