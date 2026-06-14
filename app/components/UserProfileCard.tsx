"use client";

import React, { useState, useRef } from "react";
import { uploadAvatarAction } from "@/lib/actions";
import { signOutAction } from "@/lib/auth-actions";

type UserProfileCardProps = {
  user: {
    appUserId: string | null;
    authUserId: string | null;
    email: string | null;
    fullName: string;
    role: string;
    tenantId: string;
    isAuthenticated: boolean;
    avatarUrl?: string | null;
  };
  locale: string;
};

export function UserProfileCard({ user, locale }: UserProfileCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tx = (ru: string, en: string) => (locale === "en" ? en : ru);

  const getInitials = (name: string) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const getUserColor = (name: string) => {
    const colors = [
      "linear-gradient(135deg, #005f73 0%, #0a9396 100%)",
      "linear-gradient(135deg, #0a9396 0%, #94d2bd 100%)",
      "linear-gradient(135deg, #ee9b00 0%, #ca6702 100%)",
      "linear-gradient(135deg, #ca6702 0%, #bb3e03 100%)",
      "linear-gradient(135deg, #bb3e03 0%, #ae2012 100%)",
      "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)"
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setFeedback({ ok: false, message: tx("Размер файла не должен превышать 5 МБ", "File size must be under 5MB") });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user.appUserId) return;

    const file = fileInputRef.current?.files?.[0];
    if (!file && !previewUrl) {
      setFeedback({ ok: false, message: tx("Выберите изображение", "Please select an image") });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const fd = new FormData();
      fd.append("user_id", user.appUserId);
      if (file) {
        fd.append("file", file);
      }
      
      const res = await uploadAvatarAction(fd);
      if (res && res.ok) {
        setFeedback({ ok: true, message: res.message });
        setTimeout(() => {
          setIsOpen(false);
          setFeedback(null);
          setPreviewUrl(null);
          window.location.reload();
        }, 1200);
      } else {
        setFeedback({ ok: false, message: res?.message || tx("Не удалось загрузить фотографию", "Upload failed") });
      }
    } catch (err: any) {
      setFeedback({ ok: false, message: err.message || tx("Ошибка загрузки", "Upload error") });
    } finally {
      setIsSaving(false);
    }
  };

  const avatarDisplay = user.avatarUrl ? (
    <img
      src={user.avatarUrl}
      alt={user.fullName}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        objectFit: "cover",
        border: "2px solid rgba(255, 255, 255, 0.2)"
      }}
    />
  ) : (
    <div style={{
      width: "100%",
      height: "100%",
      borderRadius: "50%",
      background: getUserColor(user.fullName),
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: "bold",
      fontSize: "1.1rem",
      border: "2px solid rgba(255, 255, 255, 0.2)"
    }}>
      {getInitials(user.fullName)}
    </div>
  );

  return (
    <>
      <div className="role-card" style={{ display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>
        {/* Avatar trigger area */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
          <div 
            onClick={() => user.isAuthenticated && setIsOpen(true)}
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              cursor: user.isAuthenticated ? "pointer" : "default",
              position: "relative",
              overflow: "hidden",
              transition: "transform 0.2s"
            }}
            className="avatar-container"
          >
            {avatarDisplay}
            {user.isAuthenticated && (
              <div className="avatar-hover-overlay" style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                transition: "opacity 0.2s",
                borderRadius: "50%"
              }}>
                <span style={{ fontSize: "14px" }}>📷</span>
              </div>
            )}
          </div>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            <strong style={{ display: "block", color: "#f8fafc", fontSize: "0.95rem" }}>{user.fullName}</strong>
            <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
              {tx("роль", "role")}: {user.role.toUpperCase()}
            </span>
          </div>
        </div>

        {/* User extra info */}
        <div style={{ fontSize: "0.8rem", color: "#64748b", lineHeight: "1.4" }}>
          {user.isAuthenticated ? tx("✅ Авторизован", "✅ Authenticated") : tx("Демонстрационный режим", "Demo mode")}
          <br />
          {tx("Локация: Пхукет", "Location: Phuket")}
          <br />
          NTFY: epicenter
        </div>

        {user.isAuthenticated && (
          <form action={signOutAction} style={{ marginTop: 6 }}>
            <button className="button" style={{ width: "100%", padding: "6px" }}>
              {tx("Выйти", "Logout")} 🚪
            </button>
          </form>
        )}
      </div>

      {/* MODAL: PROFILE PHOTO UPLOAD */}
      {isOpen && (
        <div className="modal-overlay" style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(4px)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div className="panel" style={{ width: "100%", maxWidth: "420px", margin: "16px", background: "rgba(30, 41, 59, 0.95)", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
            <div className="panel-head">
              <h2>{tx("Фотография профиля", "Profile Photo")}</h2>
              <button className="chip" onClick={() => { setIsOpen(false); setPreviewUrl(null); setFeedback(null); }}>✕</button>
            </div>
            <div className="panel-body">
              {feedback && (
                <div className={`badge ${feedback.ok ? "ok" : "danger"}`} style={{ display: "block", padding: "10px", marginBottom: "1rem", borderRadius: "6px", fontSize: "0.85rem" }}>
                  {feedback.ok ? "✓ " : "✗ "} {feedback.message}
                </div>
              )}
              
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem" }}>
                <div style={{
                  width: "120px",
                  height: "120px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "3px solid #005f73",
                  boxShadow: "0 0 15px rgba(10, 147, 150, 0.3)",
                  position: "relative"
                }}>
                  {previewUrl ? (
                    <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="Current Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{
                      width: "100%",
                      height: "100%",
                      background: getUserColor(user.fullName),
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "2.5rem",
                      fontWeight: "bold"
                    }}>
                      {getInitials(user.fullName)}
                    </div>
                  )}
                </div>

                <div className="field" style={{ width: "100%" }}>
                  <label style={{ textAlign: "center", display: "block", marginBottom: "8px" }}>
                    {tx("Выберите изображение (PNG, JPG, WEBP до 5 МБ)", "Choose an image (PNG, JPG, WEBP up to 5MB)")}
                  </label>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    className="button"
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📂 {tx("Обзор файлов", "Browse Files")}
                  </button>
                </div>

                <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "0.5rem" }}>
                  <button className="primary" type="submit" disabled={isSaving || (!previewUrl && !user.avatarUrl)} style={{ flex: 1 }}>
                    {isSaving ? tx("Сохранение...", "Saving...") : tx("Сохранить", "Save")}
                  </button>
                  <button
                    className="button"
                    type="button"
                    style={{ flex: 1 }}
                    onClick={() => { setIsOpen(false); setPreviewUrl(null); setFeedback(null); }}
                  >
                    {tx("Отмена", "Cancel")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Styled JSX or CSS class styling overrides */}
      <style jsx global>{`
        .avatar-container:hover .avatar-hover-overlay {
          opacity: 1 !important;
        }
      `}</style>
    </>
  );
}
