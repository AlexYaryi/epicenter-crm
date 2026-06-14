"use client";

import { FormEvent, useState, useRef, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { uploadMessageAttachmentAction } from "@/lib/actions";
import type { ActionResult } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

type MessageComposeFormProps = {
  action: (formData: FormData) => ActionResult | Promise<ActionResult>;
  locale: Locale;
  entityType: "customer" | "lead";
  entityId: string;
  recipientLabel: string;
  defaultChannel: "whatsapp" | "telegram" | "line" | "instagram" | "tiktok";
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  lineEnabled?: boolean;
  instagramEnabled?: boolean;
  tiktokEnabled?: boolean;
  whatsappLabel?: string;
  telegramLabel?: string;
  lineLabel?: string;
  instagramLabel?: string;
  tiktokLabel?: string;
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
  lineEnabled = false,
  instagramEnabled = false,
  tiktokEnabled = false,
  whatsappLabel,
  telegramLabel,
  lineLabel,
  instagramLabel,
  tiktokLabel,
  placeholder
}: MessageComposeFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  // Media Attachment States
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentType, setAttachmentType] = useState<"text" | "image" | "video" | "audio" | "document">("text");
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  async function handleFileUpload(file: File) {
    if (!file) return;
    setIsUploading(true);
    setResult(null);

    const formData = new FormData();
    formData.append(entityType === "customer" ? "customer_id" : "lead_id", entityId);
    formData.append("file", file);

    try {
      const res = await uploadMessageAttachmentAction(formData);
      if (res.ok && res.data) {
        setAttachmentUrl(res.data.url);
        setAttachmentType(res.data.type as any);
      } else {
        setResult(res);
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : text(locale, "Не удалось загрузить файл.", "Could not upload file.")
      });
    } finally {
      setIsUploading(false);
    }
  }

  function handleDrag(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || isSaving || isUploading) return;
    submittingRef.current = true;
    setIsSaving(true);
    setResult(null);
    try {
      const form = event.currentTarget;
      const response = await action(new FormData(form));
      setResult(response);
      if (response.ok) {
        form.reset();
        setAttachmentUrl(null);
        setAttachmentType("text");
        window.dispatchEvent(new CustomEvent("epicenter:message-sent", { detail: { entityType, entityId } }));
        router.refresh();
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : text(locale, "Не удалось отправить сообщение.", "Could not send message.")
      });
    } finally {
      submittingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`form-grid message-composer ${dragActive ? "drag-active" : ""}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      data-no-global-feedback="true"
      style={{
        position: "relative",
        border: dragActive ? "2px dashed var(--yellow-color, #eab308)" : "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px",
        padding: "16px",
        background: "rgba(30, 30, 30, 0.4)",
        backdropFilter: "blur(12px)",
        transition: "all 0.2s ease"
      }}
    >
      {dragActive && (
        <div style={{
          position: "absolute",
          inset: 0,
          background: "rgba(234, 179, 8, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--yellow-color, #eab308)",
          fontWeight: "bold",
          fontSize: "18px",
          borderRadius: "14px",
          pointerEvents: "none",
          zIndex: 10
        }}>
          {text(locale, "Перетащите файл сюда", "Drop file here")}
        </div>
      )}

      <input type="hidden" name={entityType === "customer" ? "customer_id" : "lead_id"} value={entityId} />
      {attachmentUrl && (
        <>
          <input type="hidden" name="media_url" value={attachmentUrl} />
          <input type="hidden" name="message_type" value={attachmentType} />
        </>
      )}

      <div className="field">
        <label>{text(locale, "Канал", "Channel")}</label>
        <select name="channel" defaultValue={defaultChannel}>
          <option value="whatsapp" disabled={!whatsappEnabled}>WhatsApp {whatsappEnabled ? whatsappLabel ?? "" : "— no number"}</option>
          <option value="telegram" disabled={!telegramEnabled}>Telegram {telegramEnabled ? telegramLabel ?? "" : "— no username"}</option>
          <option value="line" disabled={!lineEnabled}>Line {lineEnabled ? lineLabel ?? "" : "— no ID"}</option>
          <option value="instagram" disabled={!instagramEnabled}>Instagram {instagramEnabled ? instagramLabel ?? "" : "— no username"}</option>
          <option value="tiktok" disabled={!tiktokEnabled}>TikTok {tiktokEnabled ? tiktokLabel ?? "" : "— no handle"}</option>
        </select>
      </div>

      <div className="field">
        <label>{text(locale, "Получатель", "Recipient")}</label>
        <input value={recipientLabel} readOnly style={{ opacity: 0.8 }} />
      </div>

      <div className="field wide" style={{ position: "relative" }}>
        <label>{text(locale, "Сообщение", "Message")}</label>
        <div style={{ position: "relative" }}>
          <textarea
            name="message_text"
            required={!attachmentUrl}
            placeholder={placeholder ?? text(locale, "Введите сообщение клиенту...", "Write a message...")}
            style={{
              width: "100%",
              minHeight: "100px",
              paddingRight: "40px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(20, 20, 20, 0.4)",
              color: "#fff"
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            style={{
              position: "absolute",
              right: "12px",
              bottom: "12px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "20px",
              opacity: isUploading ? 0.5 : 0.8,
              transition: "opacity 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
            title={text(locale, "Прикрепить фото или видео", "Attach photo or video")}
          >
            📎
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            accept="image/*,video/*"
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* Attachment Previews */}
      {isUploading && (
        <div className="field wide" style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "10px" }}>
          <span style={{ fontSize: "16px", animation: "spin 1s linear infinite" }}>🔄</span>
          <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)" }}>{text(locale, "Загрузка файла...", "Uploading file...")}</span>
        </div>
      )}

      {attachmentUrl && (
        <div className="field wide" style={{ display: "flex", alignItems: "center", gap: "16px", background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "12px", position: "relative" }}>
          {attachmentType === "image" ? (
            <img
              src={attachmentUrl}
              alt="Preview"
              style={{
                width: "80px",
                height: "80px",
                objectFit: "cover",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.15)"
              }}
            />
          ) : (
            <div style={{
              width: "80px",
              height: "80px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.3)",
              borderRadius: "8px",
              fontSize: "32px",
              border: "1px solid rgba(255,255,255,0.15)"
            }}>
              🎬
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: "bold" }}>
              {attachmentType === "image" ? text(locale, "Фото готово к отправке", "Photo ready to send") : text(locale, "Видео готово к отправке", "Video ready to send")}
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", wordBreak: "break-all" }}>
              {attachmentUrl}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setAttachmentUrl(null); setAttachmentType("text"); }}
            style={{
              background: "rgba(220, 38, 38, 0.2)",
              color: "#f87171",
              border: "1px solid rgba(220, 38, 38, 0.4)",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              transition: "all 0.2s"
            }}
            title={text(locale, "Удалить файл", "Remove file")}
          >
            ✕
          </button>
        </div>
      )}

      {result ? <div className={`form-result wide ${result.ok ? "ok" : "error"}`}>{result.message}</div> : null}
      
      <div className="field wide" style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
        <button
          className="primary"
          disabled={isSaving || isUploading}
          style={{
            background: "var(--yellow-color, #eab308)",
            color: "#000",
            fontWeight: "bold",
            padding: "10px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: "pointer",
            transition: "all 0.2s",
            opacity: (isSaving || isUploading) ? 0.6 : 1
          }}
        >
          {isSaving ? text(locale, "Отправляю...", "Sending...") : text(locale, "Отправить", "Send")}
        </button>
      </div>
    </form>
  );
}
