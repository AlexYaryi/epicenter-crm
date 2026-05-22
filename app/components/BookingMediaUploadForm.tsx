"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type BookingMediaUploadFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  bookingId: string;
  bucket: string;
  field: string;
  label: string;
  type?: "image" | "video";
  locale: Locale;
};

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function BookingMediaUploadForm({ action, bookingId, bucket, field, label, type = "image", locale }: BookingMediaUploadFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      try {
        const response = await action(formData);
        setResult(response);
        if (response.ok) router.refresh();
      } catch (error) {
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : text(locale, "Файл не загружен.", "File was not uploaded.")
        });
      }
    });
  }

  return (
    <form action={submit} className={`upload ${type === "video" ? "video" : ""}`}>
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="bucket" value={bucket} />
      <input type="hidden" name="field" value={field} />
      <label>
        {label}
        <br />
        <input
          name="file"
          type="file"
          accept={type === "video" ? "video/*" : "image/*"}
          onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")}
        />
      </label>
      <button className="button" disabled={isPending}>
        {isPending ? text(locale, "Загружаю...", "Uploading...") : text(locale, "Загрузить", "Upload")}
      </button>
      {fileName ? <span className="upload-file-name">{fileName}</span> : null}
      {result ? <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div> : null}
    </form>
  );
}
