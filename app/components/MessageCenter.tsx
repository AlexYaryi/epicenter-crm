"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";

type RecentMessage = {
  id: string;
  customer_id: string | null;
  lead_id?: string | null;
  customer_name?: string | null;
  channel: string;
  sender_name?: string | null;
  contact_handle?: string | null;
  message_text: string;
  occurred_at: string;
};

type MessageIntegrationHealth = {
  inbound_24h_count: number;
  unlinked_count: number;
};

const LAST_SEEN_KEY = "epicenter_messages_last_seen_at";
const SOUND_KEY = "epicenter_message_sound_enabled";

function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function playNotificationTone(audioContextRef: React.MutableRefObject<AudioContext | null>) {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = audioContextRef.current || new AudioContextCtor();
  audioContextRef.current = context;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.setValueAtTime(660, context.currentTime + 0.12);
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
}

export function MessageCenter({ locale }: { locale: Locale }) {
  const [messages, setMessages] = useState<RecentMessage[]>([]);
  const [health, setHealth] = useState<MessageIntegrationHealth | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<RecentMessage | null>(null);
  const initializedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const latestMessageIdRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const latestAt = useMemo(() => messages[0]?.occurred_at ?? null, [messages]);

  useEffect(() => {
    const storedSeen = window.localStorage.getItem(LAST_SEEN_KEY);
    const storedSound = window.localStorage.getItem(SOUND_KEY);
    setLastSeenAt(storedSeen);
    setSoundEnabled(storedSound === "true");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const since = window.localStorage.getItem(LAST_SEEN_KEY);
      try {
        const response = await fetch(`/api/messages/recent${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: RecentMessage[];
          unread_count?: number;
          latest_at?: string | null;
          integration_health?: MessageIntegrationHealth;
        };
        if (cancelled) return;

        const nextMessages = payload.data || [];
        const previousLatestId = latestMessageIdRef.current;
        setMessages(nextMessages);
        setHealth(payload.integration_health ?? null);
        latestMessageIdRef.current = nextMessages[0]?.id ?? null;

        if (!initializedRef.current) {
          initializedRef.current = true;
          if (!since && payload.latest_at) {
            window.localStorage.setItem(LAST_SEEN_KEY, payload.latest_at);
            setLastSeenAt(payload.latest_at);
          }
          return;
        }

        const nextUnread = payload.unread_count || 0;
        setUnreadCount(nextUnread);
        const newest = nextMessages[0];
        if (newest && newest.id !== previousLatestId && nextUnread > 0) {
          setToast(newest);
          if (soundEnabled) playNotificationTone(audioContextRef);
        }
      } catch {
        // Keep the CRM usable even if the polling request fails once.
      }
    }

    poll();
    const timer = window.setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [soundEnabled]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function scheduleClose() {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 350);
  }

  function cancelScheduledClose() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function markRead() {
    if (!latestAt) return;
    window.localStorage.setItem(LAST_SEEN_KEY, latestAt);
    setLastSeenAt(latestAt);
    setUnreadCount(0);
    setToast(null);
  }

  function enableSound() {
    setSoundEnabled(true);
    window.localStorage.setItem(SOUND_KEY, "true");
    playNotificationTone(audioContextRef);
  }

  function messageHref(message: RecentMessage) {
    if (message.customer_id) return `/customers/${message.customer_id}`;
    if (message.lead_id) return `/leads/${message.lead_id}`;
    return "/customers";
  }

  return (
    <>
      <div ref={rootRef} className="message-center-root" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
        <button
          className={`message-center-button ${unreadCount ? "has-unread" : ""}`}
          type="button"
          onClick={() => setOpen((value) => !value)}
          onFocus={cancelScheduledClose}
        >
          <span>{locale === "en" ? "Inbox" : "Входящие"}</span>
          {unreadCount ? <b>{unreadCount}</b> : null}
        </button>
        {open ? (
          <div className="message-center-panel">
            <div className="message-center-head">
              <strong>{locale === "en" ? "Incoming messages" : "Входящие сообщения"}</strong>
              <button type="button" onClick={markRead}>{locale === "en" ? "Read" : "Прочитано"}</button>
            </div>
            {!soundEnabled ? (
              <button className="sound-enable" type="button" onClick={enableSound}>
                {locale === "en" ? "Enable sound alerts" : "Включить звук уведомлений"}
              </button>
            ) : null}
            {health ? (
              <div className={`message-health ${health.unlinked_count ? "warn" : "ok"}`}>
                <strong>{locale === "en" ? "Integration health" : "Здоровье интеграций"}</strong>
                <span>
                  {locale === "en"
                    ? `${health.inbound_24h_count} inbound in 24h · ${health.unlinked_count} unlinked`
                    : `${health.inbound_24h_count} входящих за 24ч · ${health.unlinked_count} без привязки`}
                </span>
              </div>
            ) : null}
            <div className="message-center-list">
              {messages.map((message) => (
                <a key={message.id} href={messageHref(message)} onClick={markRead}>
                  <strong>{message.customer_name || message.sender_name || message.contact_handle || "WhatsApp"}</strong>
                  <span>{message.channel} · {formatTime(message.occurred_at, locale)}</span>
                  <p>{message.message_text}</p>
                </a>
              ))}
              {messages.length === 0 ? <div className="empty-state">{locale === "en" ? "No incoming messages yet" : "Входящих сообщений пока нет"}</div> : null}
            </div>
            {lastSeenAt ? <small>{locale === "en" ? "Last read" : "Последнее прочитано"}: {formatTime(lastSeenAt, locale)}</small> : null}
          </div>
        ) : null}
      </div>
      {toast ? (
        <a className="message-toast" href={messageHref(toast)} onClick={markRead}>
          <strong>{locale === "en" ? "New message" : "Новое сообщение"}</strong>
          <span>{toast.customer_name || toast.sender_name || toast.contact_handle}</span>
          <p>{toast.message_text}</p>
        </a>
      ) : null}
    </>
  );
}
