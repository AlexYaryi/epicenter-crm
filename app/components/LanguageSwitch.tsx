import type { Locale } from "@/lib/i18n";

export function LanguageSwitch({ locale }: { locale: Locale }) {
  return (
    <div className="language-switch" aria-label="Language switcher">
      <a className={locale === "ru" ? "active" : undefined} href="/lang/ru">RU</a>
      <a className={locale === "en" ? "active" : undefined} href="/lang/en">EN</a>
    </div>
  );
}
