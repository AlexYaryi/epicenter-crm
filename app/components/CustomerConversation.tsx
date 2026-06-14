"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConversationMessage } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

type CustomerConversationProps = {
  customerId: string;
  customerName: string;
  initialMessages: ConversationMessage[];
  locale: Locale;
  messageEndpoint?: string;
};

function formatMessageTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function text(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

export function CustomerConversation({ customerId, customerName, initialMessages, locale, messageEndpoint }: CustomerConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lightboxMedia, setLightboxMedia] = useState<{ url: string; type: "image" | "video" } | null>(null);

  const endpoint = messageEndpoint ?? `/api/customers/${customerId}/messages`;
  const latestMessageId = useMemo(() => messages[messages.length - 1]?.id ?? "", [messages]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMessages() {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { data?: ConversationMessage[] };
        if (!cancelled && Array.isArray(payload.data)) {
          setMessages(payload.data);
          setLastUpdatedAt(new Date().toISOString());
        }
      } catch {
        // Polling should be silent for operators
      }
    }

    refreshMessages();
    const timer = window.setInterval(refreshMessages, 12_000);
    const onFocus = () => refreshMessages();
    const onMessageSent = () => refreshMessages();
    window.addEventListener("focus", onFocus);
    window.addEventListener("epicenter:message-sent", onMessageSent);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("epicenter:message-sent", onMessageSent);
    };
  }, [endpoint]);

  useEffect(() => {
    const node = document.querySelector(`[data-message-id="${latestMessageId}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [latestMessageId]);

  const handleDownload = async (url: string, defaultName: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = defaultName || url.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.download = defaultName;
      a.click();
    }
  };

  return (
    <div className="chat-thread" style={{ position: "relative" }}>
      {messages.map((message) => {
        const isImage = message.message_type === "image" && message.media_url;
        const isVideo = message.message_type === "video" && message.media_url;
        const isDoc = message.message_type === "document" && message.media_url;

        return (
          <article key={message.id} data-message-id={message.id} className={`chat-message ${message.direction}`}>
            <div className="chat-bubble" style={{ maxWidth: "80%" }}>
              <div className="chat-meta">
                <strong>
                  {message.direction === "outbound"
                    ? locale === "en" ? "Epicenter team" : "Команда Epicenter"
                    : message.sender_name || customerName}
                </strong>
                <span>{message.channel}</span>
                <time>{formatMessageTime(message.occurred_at, locale)}</time>
              </div>

              {/* Message Content Render */}
              <div className="chat-content" style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                {isImage && (
                  <div
                    onClick={() => setLightboxMedia({ url: message.media_url!, type: "image" })}
                    style={{
                      position: "relative",
                      borderRadius: "12px",
                      overflow: "hidden",
                      cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.1)",
                      maxHeight: "220px",
                      maxWidth: "320px",
                      background: "rgba(0,0,0,0.1)",
                      transition: "transform 0.2s ease"
                    }}
                    className="media-hover"
                  >
                    <img
                      src={message.media_url!}
                      alt="Attached photo"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        maxHeight: "220px",
                        display: "block"
                      }}
                    />
                    <div style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(0,0,0,0.3)",
                      opacity: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: "24px",
                      transition: "opacity 0.2s"
                    }} className="media-overlay">
                      🔍
                    </div>
                  </div>
                )}

                {isVideo && (
                  <div style={{
                    borderRadius: "12px",
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.1)",
                    maxWidth: "320px",
                    background: "#000"
                  }}>
                    <video
                      src={message.media_url!}
                      controls
                      style={{
                        width: "100%",
                        maxHeight: "220px",
                        display: "block"
                      }}
                    />
                  </div>
                )}

                {isDoc && (
                  <a
                    href={message.media_url!}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      background: "rgba(255,255,255,0.1)",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      color: "#fff",
                      textDecoration: "none",
                      border: "1px solid rgba(255,255,255,0.1)"
                    }}
                  >
                    <span style={{ fontSize: "20px" }}>📄</span>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "13px", fontWeight: "bold" }}>{text(locale, "Документ", "Document")}</span>
                      <span style={{ fontSize: "11px", opacity: 0.6 }}>{text(locale, "Открыть файл", "Open file")}</span>
                    </div>
                  </a>
                )}

                {/* Display text caption / text content */}
                {message.message_text && (!message.media_url || (message.message_text !== "[Фото]" && message.message_text !== "[Видео]" && message.message_text !== "[media]")) && (
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.message_text}</p>
                )}
              </div>

              <small style={{ display: "block", marginTop: "4px", opacity: 0.6, fontSize: "10px", textAlign: "right" }}>
                {message.status}
              </small>
            </div>
          </article>
        );
      })}

      {messages.length === 0 ? (
        <div className="empty-state">
          {locale === "en" ? "No messages yet. Send the first message below." : "Сообщений пока нет. Отправьте первое сообщение ниже."}
        </div>
      ) : null}

      {lastUpdatedAt ? (
        <div className="chat-refresh-note">
          {locale === "en" ? "Auto refreshed" : "Автообновлено"} {formatMessageTime(lastUpdatedAt, locale)}
        </div>
      ) : null}

      {/* Premium Glassmorphic Lightbox overlay */}
      {lightboxMedia && (
        <div
          onClick={() => setLightboxMedia(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.85)",
            backdropFilter: "blur(20px)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "fadeIn 0.2s ease"
          }}
        >
          <button
            onClick={() => setLightboxMedia(null)}
            style={{
              position: "absolute",
              top: "24px",
              right: "24px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              borderRadius: "50%",
              width: "48px",
              height: "48px",
              fontSize: "20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.2s"
            }}
          >
            ✕
          </button>
          
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "90%",
              maxHeight: "80%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {lightboxMedia.type === "image" ? (
              <img
                src={lightboxMedia.url}
                alt="Enlarged preview"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: "12px",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
                  border: "1px solid rgba(255,255,255,0.1)"
                }}
              />
            ) : (
              <video
                src={lightboxMedia.url}
                controls
                autoPlay
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  borderRadius: "12px",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
                }}
              />
            )}
          </div>
          <div style={{ marginTop: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              onClick={() => handleDownload(lightboxMedia.url, lightboxMedia.type === "video" ? "video.mp4" : "image.jpg")}
              style={{
                background: "var(--yellow-color, #eab308)",
                color: "#000",
                border: "none",
                padding: "8px 20px",
                borderRadius: "8px",
                fontWeight: "bold",
                fontSize: "14px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              📥 {text(locale, "Скачать", "Download")}
            </button>
            <a
              href={lightboxMedia.url}
              target="_blank"
              rel="noreferrer"
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.25)",
                padding: "8px 20px",
                borderRadius: "8px",
                textDecoration: "none",
                fontWeight: "bold",
                fontSize: "14px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              ↗ {text(locale, "Открыть оригинал", "Open Original")}
            </a>
          </div>
        </div>
      )}

      {/* Simple embedded styles for hover overlays */}
      <style>{`
        .media-hover:hover .media-overlay {
          opacity: 1 !important;
        }
        .chat-bubble {
          transition: all 0.2s ease;
        }
      `}</style>
    </div>
  );
}
