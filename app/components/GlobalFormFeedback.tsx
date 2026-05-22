"use client";

import { useEffect, useState } from "react";

export function GlobalFormFeedback() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    function onSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form || form.dataset.noGlobalFeedback === "true") return;
      setMessage(form.dataset.saveMessage || "Отправляю данные на сервер...");
      window.setTimeout(() => setMessage(form.dataset.savedMessage || "Запрос отправлен. Страница обновится, если сервер принял изменения."), 900);
      window.setTimeout(() => setMessage(""), 4200);
    }

    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  return message ? <div className="global-save-toast">{message}</div> : null;
}
