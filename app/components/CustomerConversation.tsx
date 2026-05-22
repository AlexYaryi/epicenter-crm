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

export function CustomerConversation({ customerId, customerName, initialMessages, locale, messageEndpoint }: CustomerConversationProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
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
        // Polling should be silent for operators; the global inbox still shows gateway health.
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

  return (
    <div className="chat-thread">
      {messages.map((message) => (
        <article key={message.id} data-message-id={message.id} className={`chat-message ${message.direction}`}>
          <div className="chat-bubble">
            <div className="chat-meta">
              <strong>
                {message.direction === "outbound"
                  ? locale === "en" ? "Epicenter team" : "Команда Epicenter"
                  : message.sender_name || customerName}
              </strong>
              <span>{message.channel}</span>
              <time>{formatMessageTime(message.occurred_at, locale)}</time>
            </div>
            <p>{message.message_text}</p>
            <small>{message.status}</small>
          </div>
        </article>
      ))}
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
    </div>
  );
}
