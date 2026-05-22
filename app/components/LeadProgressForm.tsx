"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";
import type { LeadStage } from "@/lib/types";
import { leadStageLabel, leadStages } from "@/lib/lead-stages";

type LeadProgressFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  leadId: string;
  currentStage: LeadStage;
  nextAction?: string | null;
  reminderAt?: string | null;
  locale: Locale;
  compact?: boolean;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export function LeadProgressForm({ action, leadId, currentStage, nextAction, reminderAt, locale, compact = false }: LeadProgressFormProps) {
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
        message: error instanceof Error ? error.message : text(locale, "Не удалось сохранить лид.", "Could not save lead.")
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? "lead-card-form" : "form-grid"} data-no-global-feedback="true">
      <input type="hidden" name="lead_id" value={leadId} />
      <div className="field">
        <label>{text(locale, "Следующий статус", "Next status")}</label>
        <select name="status" defaultValue={currentStage}>
          {leadStages.map((stage) => (
            <option key={stage} value={stage}>
              {leadStageLabel(stage, locale)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>{text(locale, "Напомнить", "Reminder")}</label>
        <input name="reminder_at" type="datetime-local" defaultValue={toDateTimeLocal(reminderAt)} />
      </div>
      <div className="field wide">
        <label>{text(locale, "Следующее действие", "Next action")}</label>
        {compact ? (
          <input name="next_action" defaultValue={nextAction ?? ""} placeholder="WhatsApp follow-up..." />
        ) : (
          <textarea name="next_action" defaultValue={nextAction ?? ""} placeholder={text(locale, "Например: отправить Mazda 2 и запросить фото IDP", "Example: send Mazda 2 offer and ask for IDP photo")} />
        )}
      </div>
      {result ? <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div> : null}
      <div className="field wide">
        <button className={compact ? "button" : "primary"} disabled={isSaving}>
          {isSaving ? text(locale, "Сохраняю...", "Saving...") : text(locale, "Обновить лид", "Update lead")}
        </button>
      </div>
    </form>
  );
}
