"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";
import { leadStageLabel, leadStages } from "@/lib/lead-stages";

type LeadCaptureFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  tenantId: string;
  locale: Locale;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function LeadCaptureForm({ action, tenantId, locale }: LeadCaptureFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsSaving(true);
    setResult({ ok: true, message: text(locale, "Создаю лид...", "Creating lead...") });

    try {
      const response = await action(new FormData(form));
      setResult(response);
      if (response.ok) {
        form.reset();
        router.refresh();
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : text(locale, "Не удалось создать лид.", "Lead was not created.")
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid" data-no-global-feedback="true">
      <input type="hidden" name="tenant_id" value={tenantId} />
      <div className="field">
        <label>{text(locale, "Источник", "Source")}</label>
        <select name="source">
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram_chat">Telegram</option>
          <option value="telegram_channel">{text(locale, "Telegram Канал", "Telegram Channel")}</option>
          <option value="groupswatcher">Groups Watcher</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="google_ads">Google Ads</option>
          <option value="tilda">Tilda</option>
          <option value="localrent">LocalRent</option>
          <option value="takecars">TakeCars</option>
          <option value="booking_com">Booking.com</option>
          <option value="line">LINE</option>
          <option value="tiktok">TikTok</option>
          <option value="other">{text(locale, "Другое", "Other")}</option>
        </select>
      </div>
      <div className="field"><label>{text(locale, "Имя клиента", "Customer name")}</label><input name="customer_name" required /></div>
      <div className="field"><label>{text(locale, "Телефон / WhatsApp", "Phone / WhatsApp")}</label><input name="phone" /></div>
      <div className="field">
        <label>{text(locale, "Статус", "Status")}</label>
        <select name="status">
          {leadStages.map((stage) => <option value={stage} key={stage}>{leadStageLabel(stage, locale)}</option>)}
        </select>
      </div>
      <div className="field"><label>Score</label><input name="score" type="number" min="0" max="100" defaultValue="50" /></div>
      <div className="field"><label>{text(locale, "Кампания", "Campaign")}</label><input name="campaign" placeholder="FB Lead Form Phuket" /></div>
      <div className="field"><label>{text(locale, "Источник подробнее", "Source detail")}</label><input name="source_detail" placeholder={text(locale, "форма, группа, профиль", "form, group, profile")} /></div>
      <div className="field wide"><label>{text(locale, "Ссылка на чат / профиль", "Chat / profile link")}</label><input name="conversation_log_url" placeholder="https://wa.me/... или Instagram/Facebook URL" /></div>
      <div className="field wide"><label>{text(locale, "Запрос клиента", "Client request")}</label><textarea name="inquiry_text" placeholder="Dates, budget, vehicle category, language..." /></div>
      {result ? (
        <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>
          {result.message}
          {result.ok && result.id ? <a href={`/leads/${result.id}`}>{text(locale, "Открыть лид", "Open lead")}</a> : null}
        </div>
      ) : null}
      <div className="field wide">
        <button className="primary" disabled={isSaving}>
          {isSaving ? text(locale, "Сохраняю...", "Saving...") : text(locale, "Создать лид", "Create lead")}
        </button>
      </div>
    </form>
  );
}
