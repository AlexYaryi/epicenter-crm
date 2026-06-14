"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type CustomerMediaUploadFormProps = {
  customerId: string;
  field: "passport" | "driver_license" | "idp";
  label: string;
  locale: Locale;
  /** Called after a successful upload so the parent can refresh signed URLs */
  onUploadSuccess?: () => void;
};

export function CustomerMediaUploadForm({
  customerId,
  field,
  label,
  locale,
  onUploadSuccess,
}: CustomerMediaUploadFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setResult(null);
    startTransition(async () => {
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const formData = new FormData();
          formData.append("customer_id", customerId);
          formData.append("field", field);
          formData.append("file", file);

          const uploadResponse = await fetch(`/api/customers/${customerId}/media`, {
            method: "POST",
            body: formData,
            credentials: "same-origin"
          });
          const payload = await uploadResponse.json().catch(() => ({}));
          const response: ActionResult = uploadResponse.ok
            ? {
                ok: true,
                message: payload.message || (locale === "en" ? "File uploaded successfully." : "Файл успешно загружен.")
              }
            : {
                ok: false,
                message: payload.error || (locale === "en" ? "Upload failed." : "Ошибка загрузки.")
              };
          if (!response.ok) {
            setResult(response);
            return;
          }
        }

        setResult({
          ok: true,
          message: locale === "en" ? "Files uploaded successfully." : "Файлы успешно загружены.",
        });
        router.refresh();
        onUploadSuccess?.();
      } catch (error) {
        setResult({
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : locale === "en"
              ? "Upload failed."
              : "Ошибка загрузки.",
        });
      }
    });
  }

  return (
    <div style={{ display: "inline-block", position: "relative" }}>
      <label
        className="button primary"
        style={{
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          padding: "6px 14px",
          fontSize: "12px",
          fontWeight: "bold",
          height: "36px",
          minHeight: "36px",
          lineHeight: "1.2",
          opacity: isPending ? 0.6 : 1,
          pointerEvents: isPending ? "none" : "auto",
          margin: 0,
          boxShadow: "0 2px 4px rgba(6, 79, 88, 0.05)",
          borderRadius: "6px",
          transition: "all 0.2s",
          background: "var(--yellow-color, #eab308)",
          color: "#000",
          border: "none",
        }}
      >
        <span>{isPending ? (locale === "en" ? "Uploading…" : "Загрузка…") : label}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          onChange={handleFileChange}
          style={{ display: "none" }}
          disabled={isPending}
        />
      </label>
      {result && !result.ok && (
        <div
          style={{
            color: "#dc3545",
            fontSize: "11px",
            marginTop: "4px",
            position: "absolute",
            zIndex: 10,
            right: 0,
            whiteSpace: "nowrap",
            background: "#fff",
            border: "1px solid #f5c6cb",
            borderRadius: "4px",
            padding: "2px 6px",
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
