"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";
import type { Customer } from "@/lib/types";

type LeadCustomerLinkFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  tenantId: string;
  leadId: string;
  source: string;
  customers?: Customer[];
  defaultName: string;
  defaultPhone?: string | null;
  defaultTelegram?: string | null;
  locale: Locale;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function LeadCustomerLinkForm({ action, tenantId, leadId, source, customers = [], defaultName, defaultPhone, defaultTelegram, locale }: LeadCustomerLinkFormProps) {
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
      <div className="field wide">
        <label>{text(locale, "Привязать существующего клиента", "Link existing customer")}</label>
        <select name="existing_customer_id" defaultValue="">
          <option value="">{text(locale, "Создать нового клиента из лида", "Create a new customer from this lead")}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.full_name} · {customer.whatsapp || customer.phone || customer.telegram_username || text(locale, "контакт не заполнен", "no contact")}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>{text(locale, "Имя", "Name")}</label>
        <input name="full_name" defaultValue={defaultName} />
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
          {isSaving ? text(locale, "Сохраняю связь...", "Saving link...") : text(locale, "Создать / привязать клиента", "Create / link customer")}
        </button>
      </div>
    </form>
  );
}
