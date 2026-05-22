"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type MessageComposeFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  locale: Locale;
  entityType: "customer" | "lead";
  entityId: string;
  recipientLabel: string;
  defaultChannel: "whatsapp" | "telegram";
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  whatsappLabel?: string;
  telegramLabel?: string;
  placeholder?: string;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function MessageComposeForm({
  action,
  locale,
  entityType,
  entityId,
  recipientLabel,
  defaultChannel,
  whatsappEnabled,
  telegramEnabled,
  whatsappLabel,
  telegramLabel,
  placeholder
}: MessageComposeFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setResult(null);
    try {
      const form = event.currentTarget;
      const response = await action(new FormData(form));
      setResult(response);
      if (response.ok) {
        form.reset();
        window.dispatchEvent(new CustomEvent("epicenter:message-sent", { detail: { entityType, entityId } }));
        router.refresh();
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : text(locale, "Не удалось отправить сообщение.", "Could not send message.")
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-grid" data-no-global-feedback="true">
      <input type="hidden" name={entityType === "customer" ? "customer_id" : "lead_id"} value={entityId} />
      <div className="field">
        <label>{text(locale, "Канал", "Channel")}</label>
        <select name="channel" defaultValue={defaultChannel}>
          <option value="whatsapp" disabled={!whatsappEnabled}>WhatsApp {whatsappEnabled ? whatsappLabel ?? "" : "— no number"}</option>
          <option value="telegram" disabled={!telegramEnabled}>Telegram {telegramEnabled ? telegramLabel ?? "" : "— no username"}</option>
        </select>
      </div>
      <div className="field">
        <label>{text(locale, "Получатель", "Recipient")}</label>
        <input value={recipientLabel} readOnly />
      </div>
      <div className="field wide">
        <label>{text(locale, "Сообщение", "Message")}</label>
        <textarea name="message_text" required placeholder={placeholder ?? text(locale, "Введите сообщение клиенту...", "Write a message...")} />
      </div>
      {result ? <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div> : null}
      <div className="field wide">
        <button className="primary" disabled={isSaving}>
          {isSaving ? text(locale, "Отправляю...", "Sending...") : text(locale, "Отправить сообщение", "Send message")}
        </button>
      </div>
    </form>
  );
}
