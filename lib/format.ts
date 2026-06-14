import type { Locale } from "@/lib/i18n";
import React from "react";

export function money(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} THB`;
}

export function sourceLabel(source: string | null | undefined, locale: Locale): string {
  const labels: Record<string, { ru: string; en: string }> = {
    whatsapp: { ru: "WhatsApp", en: "WhatsApp" },
    telegram: { ru: "Telegram", en: "Telegram" },
    telegram_chat: { ru: "Telegram", en: "Telegram" },
    telegram_channel: { ru: "Telegram канал", en: "Telegram channel" },
    instagram: { ru: "Instagram", en: "Instagram" },
    facebook: { ru: "Facebook", en: "Facebook" },
    google_ads: { ru: "Google Ads", en: "Google Ads" },
    groupswatcher: { ru: "GroupsWatcher", en: "GroupsWatcher" },
    tilda: { ru: "Tilda", en: "Tilda" },
    line: { ru: "LINE", en: "LINE" },
    tiktok: { ru: "TikTok", en: "TikTok" },
    referral_marina: { ru: "Реферал", en: "Referral" },
    localrent: { ru: "LocalRent", en: "LocalRent" },
    takecars: { ru: "TakeCars", en: "TakeCars" },
    booking_com: { ru: "Booking.com", en: "Booking.com" },
    walk_in: { ru: "Walk-in", en: "Walk-in" },
    other: { ru: "Другое", en: "Other" }
  };
  const key = source ?? "";
  const label = labels[key];
  const tx = (l: Locale, ru: string, en: string) => (l === "en" ? en : ru);
  return label ? tx(locale, label.ru, label.en) : key || "-";
}

export function statusBadge(status: string) {
  const danger = ["lost", "cancelled", "retired", "repair", "UNDERPERFORMING", "DECOMMISSION_RECOMMENDED"];
  const ok = ["available", "completed", "RECOVERED", "PROFIT_GENERATING", "booked"];
  const cls = danger.includes(status) ? "danger" : ok.includes(status) ? "ok" : "info";
  return React.createElement("span", { className: `badge ${cls}` }, status);
}
