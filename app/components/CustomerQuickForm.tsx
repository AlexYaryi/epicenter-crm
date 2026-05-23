"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type CustomerQuickFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  tenantId: string;
  locale: Locale;
  returnPath?: string;
  sourceDetail?: string;
  showFullFields?: boolean;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function CustomerQuickForm({ action, tenantId, locale, returnPath, sourceDetail, showFullFields = false }: CustomerQuickFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setIsSaving(true);
    setResult({ ok: true, message: text(locale, "Создаю клиента...", "Creating customer...") });

    try {
      const response = await action(new FormData(form));
      setResult(response);
      if (response.ok) {
        setCreatedId(response.id ?? null);
        form.reset();
        router.refresh();
      } else {
        setCreatedId(null);
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : text(locale, "Не удалось создать клиента.", "Customer was not created.")
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid" data-no-global-feedback="true">
      <input type="hidden" name="tenant_id" value={tenantId} />
      {returnPath ? <input type="hidden" name="return_path" value={returnPath} /> : null}
      {sourceDetail && !showFullFields ? <input type="hidden" name="source_detail" value={sourceDetail} /> : null}
      <div className="field"><label>{text(locale, "Имя", "Name")}</label><input name="full_name" required /></div>
      <div className="field"><label>{text(locale, "Имя как в паспорте", "Passport name")}</label><input name="full_name_passport" /></div>
      <div className="field"><label>{text(locale, "Телефон", "Phone")}</label><input name="phone" /></div>
      <div className="field"><label>WhatsApp</label><input name="whatsapp" /></div>
      <div className="field"><label>Telegram</label><input name="telegram_username" /></div>
      {showFullFields ? (
        <>
          <div className="field"><label>Email</label><input name="email" type="email" /></div>
          <div className="field"><label>{text(locale, "Гражданство", "Nationality")}</label><input name="nationality" placeholder="RU" /></div>
        </>
      ) : null}
      <div className="field"><label>{text(locale, "Язык", "Language")}</label><select name="language_pref"><option value="ru">RU</option><option value="en">EN</option></select></div>
      <div className="field">
        <label>{text(locale, "Источник", "Source")}</label>
        <select name="source">
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram_chat">{text(locale, "Telegram Чат", "Telegram Chat")}</option>
          <option value="telegram_channel">{text(locale, "Telegram Канал", "Telegram Channel")}</option>
          <option value="groupswatcher">Groups Watcher</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="google_ads">Google Ads</option>
          <option value="referral_marina">Referral</option>
          <option value="localrent">LocalRent</option>
          <option value="takecars">TakeCars</option>
          <option value="walk_in">Walk-in</option>
          <option value="other">{text(locale, "Другое", "Other")}</option>
        </select>
      </div>
      {showFullFields ? (
        <>
          <div className="field wide"><label>{text(locale, "Источник подробнее / ссылка на чат", "Source detail / chat link")}</label><input name="source_detail" defaultValue={sourceDetail ?? ""} placeholder={text(locale, "@instagram, WhatsApp chat, Facebook profile, кампания", "@instagram, WhatsApp chat, Facebook profile, campaign")} /></div>
          <div className="field"><label>{text(locale, "Паспорт номер", "Passport number")}</label><input name="passport_number" /></div>
          <div className="field"><label>{text(locale, "Паспорт действителен до", "Passport expires")}</label><input name="passport_expires" type="date" /></div>
          <div className="field"><label>{text(locale, "IDP номер", "IDP number")}</label><input name="idp_number" /></div>
          <div className="field"><label>{text(locale, "IDP действителен до", "IDP expires")}</label><input name="idp_expires" type="date" /></div>
        </>
      ) : null}
      {result ? (
        <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>
          {result.message}
          {result.ok && createdId ? <a href={`/customers/${createdId}`}>{text(locale, "Открыть клиента", "Open customer")}</a> : null}
          {result.ok && returnPath ? <a href={returnPath}>{text(locale, "Вернуться к машине", "Back to vehicle")}</a> : null}
        </div>
      ) : null}
      <div className="field wide"><button className="primary" disabled={isSaving}>{isSaving ? text(locale, "Сохраняю...", "Saving...") : text(locale, "Добавить клиента", "Add customer")}</button></div>
    </form>
  );
}
