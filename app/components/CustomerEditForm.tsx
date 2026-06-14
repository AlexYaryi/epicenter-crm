"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Customer } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

type Props = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  customer: Customer;
  locale: Locale;
};

function t(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

function normalizeSourceForSelect(source: string | null | undefined) {
  if (source === "telegram") return "telegram_chat";
  return source ?? "other";
}

const SOURCES = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram_chat", label: "Telegram" },
  { value: "telegram_channel", label: "Telegram Channel" },
  { value: "groupswatcher", label: "Groups Watcher" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "google_ads", label: "Google Ads" },
  { value: "tilda", label: "Tilda" },
  { value: "referral_marina", label: "Referral" },
  { value: "localrent", label: "LocalRent" },
  { value: "takecars", label: "TakeCars" },
  { value: "booking_com", label: "Booking.com" },
  { value: "line", label: "LINE" },
  { value: "tiktok", label: "TikTok" },
  { value: "walk_in", label: "Walk-in" },
  { value: "other", label: "Другое / Other" }
];

export function CustomerEditForm({ action, customer, locale }: Props) {
  const router = useRouter();
  const sourceValue = normalizeSourceForSelect(customer.source);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSaving(true);
    setResult({ ok: true, message: t(locale, "Сохраняю...", "Saving...") });
    try {
      const res = await action(new FormData(e.currentTarget));
      setResult(res);
      if (res.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : t(locale, "Ошибка сохранения", "Save error") });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid" data-no-global-feedback="true">
      <input type="hidden" name="id" value={customer.id} />

      <div className="field"><label>{t(locale, "Имя", "Name")}</label><input name="full_name" defaultValue={customer.full_name} required /></div>
      <div className="field"><label>{t(locale, "Имя в паспорте", "Passport name")}</label><input name="full_name_passport" defaultValue={customer.full_name_passport ?? ""} /></div>
      <div className="field"><label>{t(locale, "Телефон", "Phone")}</label><input name="phone" defaultValue={customer.phone ?? ""} /></div>
      <div className="field"><label>WhatsApp</label><input name="whatsapp" defaultValue={customer.whatsapp ?? ""} /></div>
      <div className="field"><label>Telegram</label><input name="telegram_username" defaultValue={customer.telegram_username ?? ""} placeholder="@username" /></div>
      <div className="field"><label>Email</label><input name="email" type="email" defaultValue={(customer as Customer & { email?: string }).email ?? ""} /></div>
      <div className="field">
        <label>{t(locale, "Язык", "Language")}</label>
        <select name="language_pref" defaultValue={customer.language_pref}>
          <option value="ru">RU</option>
          <option value="en">EN</option>
        </select>
      </div>
      <div className="field">
        <label>{t(locale, "Источник", "Source")}</label>
        <select name="source" defaultValue={sourceValue}>
          {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="field wide"><label>{t(locale, "Источник подробнее", "Source detail")}</label><input name="source_detail" defaultValue={customer.source_detail ?? ""} /></div>
      <div className="field"><label>{t(locale, "Паспорт №", "Passport #")}</label><input name="passport_number" defaultValue={customer.passport_number ?? ""} /></div>
      <div className="field"><label>{t(locale, "Паспорт до", "Passport expires")}</label><input name="passport_expires" type="date" defaultValue={customer.passport_expires ?? ""} /></div>
      <div className="field"><label>{t(locale, "IDP / Тайские права №", "IDP / Thai license #")}</label><input name="idp_number" defaultValue={customer.idp_number ?? ""} /></div>
      <div className="field"><label>{t(locale, "IDP / Тайские права до", "IDP / Thai license expires")}</label><input name="idp_expires" type="date" defaultValue={customer.idp_expires ?? ""} /></div>

      {result ? (
        <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div>
      ) : null}
      <div className="field wide">
        <button className="primary" disabled={isSaving}>
          {isSaving ? t(locale, "Сохраняю...", "Saving...") : t(locale, "Сохранить клиента", "Save customer")}
        </button>
      </div>
    </form>
  );
}
