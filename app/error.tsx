"use client";

import { useEffect, useMemo } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

function getLocale() {
  if (typeof document === "undefined") return "ru";
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("epicenter_locale="))
    ?.split("=")[1] === "en" ? "en" : "ru";
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const locale = useMemo(getLocale, []);
  const isServerActionMismatch = /Server Action/i.test(error.message || "");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="error-page">
      <div className="error-card">
        <img src="/assets/logo.png" alt="Epicenter" className="error-logo" />
        <h1>{locale === "en" ? "CRM needs a refresh" : "CRM нужно обновить"}</h1>
        <p>
          {isServerActionMismatch
            ? locale === "en"
              ? "The server was updated while this browser tab was open. Refresh the page and continue working."
              : "Сервер обновился, пока эта вкладка была открыта. Обновите страницу и продолжайте работу."
            : locale === "en"
            ? "A temporary error occurred. Try refreshing this screen."
            : "Произошла временная ошибка. Попробуйте обновить этот экран."}
        </p>
        <div className="error-actions">
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            {locale === "en" ? "Refresh page" : "Обновить страницу"}
          </button>
          <button type="button" className="button" onClick={reset}>
            {locale === "en" ? "Try again" : "Попробовать ещё раз"}
          </button>
        </div>
        {error.digest ? <small>ERR {error.digest}</small> : null}
      </div>
    </main>
  );
}
