"use client";

import { useState, useEffect, useCallback } from "react";
import { CustomerMediaUploadForm } from "./CustomerMediaUploadForm";
import type { Locale } from "@/lib/i18n";
import { formatDisplayDate } from "@/lib/i18n";
import { deleteCustomerMediaAction } from "@/lib/actions";

type CustomerDocumentsPanelProps = {
  customer: {
    id: string;
    passport_number?: string | null;
    passport_expires?: string | null;
    passport_photo_url?: string | null;
    driver_license_number?: string | null;
    driver_license_country?: string | null;
    driver_license_photo_url?: string | null;
    idp_number?: string | null;
    idp_expires?: string | null;
    idp_photo_url?: string | null;
    has_valid_idp?: boolean | null;
  };
  locale: Locale;
};

type DocFile = {
  url: string;
  signedUrl: string;
  name: string;
  type: string;
};

type DocumentUrls = {
  passport_photo_url: string | null;
  passport_files?: DocFile[];
  driver_license_photo_url: string | null;
  driver_license_files?: DocFile[];
  idp_photo_url: string | null;
  idp_files?: DocFile[];
};

export function CustomerDocumentsPanel({ customer, locale }: CustomerDocumentsPanelProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [pdfViewerName, setPdfViewerName] = useState<string>("");
  
  const [signedUrls, setSignedUrls] = useState<DocumentUrls>({
    passport_photo_url: null,
    passport_files: [],
    driver_license_photo_url: null,
    driver_license_files: [],
    idp_photo_url: null,
    idp_files: [],
  });
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const hasAnyDoc =
    !!customer.passport_photo_url ||
    !!customer.driver_license_photo_url ||
    !!customer.idp_photo_url;

  const fetchSignedUrls = useCallback(async () => {
    setUrlsLoading(true);
    try {
      const res = await fetch(`/api/customers/${customer.id}/document-urls`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data: DocumentUrls = await res.json();
        setSignedUrls(data);
      }
    } catch {
      // silently fail
    } finally {
      setUrlsLoading(false);
    }
  }, [customer.id, hasAnyDoc]);

  useEffect(() => {
    fetchSignedUrls();
  }, [fetchSignedUrls]);

  // Close lightboxes on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxUrl(null);
        setPdfViewerUrl(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleDeleteFile = async (field: "passport" | "driver_license" | "idp", fileUrl: string) => {
    const confirmMsg =
      locale === "en"
        ? "Are you sure you want to delete this file?"
        : "Вы уверены, что хотите удалить этот файл?";
    if (!window.confirm(confirmMsg)) return;

    setIsDeleting(fileUrl);
    try {
      const res = await deleteCustomerMediaAction(customer.id, field, fileUrl);
      if (res.ok) {
        await fetchSignedUrls();
      } else {
        alert(res.message);
      }
    } catch (err) {
      alert(locale === "en" ? "Error deleting file" : "Ошибка удаления файла");
    } finally {
      setIsDeleting(null);
    }
  };

  const docs = [
    {
      key: "passport",
      title: locale === "en" ? "Passport" : "Паспорт",
      number: customer.passport_number,
      expires: customer.passport_expires,
      files: signedUrls.passport_files || [],
      uploadLabel: locale === "en" ? "📷 Add Passport Document" : "📷 Добавить паспорт / PDF",
      field: "passport" as const,
    },
    {
      key: "driver_license",
      title: locale === "en" ? "Driver's License / IDP" : "Водительское удостоверение / МВУ",
      number: customer.driver_license_number || customer.idp_number,
      expires: customer.idp_expires,
      files: [
        ...(signedUrls.driver_license_files || []),
        ...(signedUrls.idp_files || []),
      ],
      uploadLabel: locale === "en" ? "📷 Add License / IDP" : "📷 Добавить права / МВУ / PDF",
      field: "driver_license" as const,
    },
  ];

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
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-head">
        <h2>{locale === "en" ? "Documents & Verification" : "Документы и верификация"}</h2>
      </div>

      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {docs.map((doc) => (
          <div
            key={doc.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              padding: "16px 18px",
              background: "#ffffff",
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: "12px",
              boxShadow: "0 4px 12px rgba(6, 79, 88, 0.03)",
            }}
          >
            {/* Header row: title + upload button */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
              <div>
                <strong style={{ fontSize: "15px", color: "var(--ink, #1e293b)", display: "block", fontWeight: 600 }}>
                  {doc.title}
                </strong>
                <div style={{ fontSize: "12px", color: "var(--muted, #64748b)", marginTop: "4px" }}>
                  {doc.number
                    ? `${locale === "en" ? "Number" : "Номер"}: ${doc.number}`
                    : locale === "en"
                    ? "Number not set"
                    : "Номер не указан"}
                  {doc.expires
                    ? ` • ${locale === "en" ? "Expires" : "До"}: ${formatDisplayDate(doc.expires)}`
                    : ""}
                </div>
              </div>
              <CustomerMediaUploadForm
                customerId={customer.id}
                field={doc.field}
                label={doc.uploadLabel}
                locale={locale}
                onUploadSuccess={fetchSignedUrls}
              />
            </div>

            {/* Document files list */}
            {doc.files.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: "14px",
                  marginTop: "8px",
                }}
              >
                {doc.files.map((file, idx) => {
                  const isPdf = file.type === "application/pdf" || file.url.toLowerCase().endsWith(".pdf");
                  return (
                    <div
                      key={file.url + idx}
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                        background: "#f8fafc",
                        borderRadius: "10px",
                        border: "1.5px solid #e2e8f0",
                        overflow: "visible",
                        transition: "all 0.2s ease",
                      }}
                      className="doc-file-card"
                    >
                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteFile(doc.field, file.url)}
                        disabled={isDeleting === file.url}
                        style={{
                          position: "absolute",
                          top: "-6px",
                          right: "-6px",
                          background: "#ef4444",
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "20px",
                          height: "20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          cursor: "pointer",
                          zIndex: 10,
                          boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
                          transition: "transform 0.15s ease",
                        }}
                        className="doc-delete-btn"
                        title={locale === "en" ? "Delete file" : "Удалить файл"}
                      >
                        {isDeleting === file.url ? "⏳" : "✕"}
                      </button>

                      {/* Preview / Icon Container */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (isPdf) {
                            setPdfViewerUrl(file.signedUrl);
                            setPdfViewerName(file.name);
                          } else {
                            setLightboxUrl(file.signedUrl);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            if (isPdf) {
                              setPdfViewerUrl(file.signedUrl);
                              setPdfViewerName(file.name);
                            } else {
                              setLightboxUrl(file.signedUrl);
                            }
                          }
                        }}
                        style={{
                          position: "relative",
                          height: "90px",
                          borderRadius: "8px 8px 0 0",
                          overflow: "visible",
                          cursor: "zoom-in",
                          background: "#edf2f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        className="doc-thumb"
                      >
                        {isPdf ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "4px",
                              color: "#dc2626",
                            }}
                          >
                            <span style={{ fontSize: "32px" }}>📕</span>
                            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px" }}>PDF</span>
                          </div>
                        ) : (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={file.signedUrl}
                              alt={file.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                borderRadius: "8px 8px 0 0",
                                display: "block",
                              }}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                                const parent = e.currentTarget.parentElement;
                                if (parent) {
                                  const fb = document.createElement("div");
                                  fb.innerHTML = "🖼️";
                                  fb.style.fontSize = "24px";
                                  parent.appendChild(fb);
                                }
                              }}
                            />
                            {/* CSS hover floating tooltip preview */}
                            <div className="hover-preview-tooltip">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={file.signedUrl} alt="Hover Preview" />
                            </div>
                          </>
                        )}

                        {/* Zoom overlay */}
                        <div
                           className="doc-thumb-overlay"
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(6, 79, 88, 0.65)",
                            borderRadius: "8px 8px 0 0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: 0,
                            transition: "opacity 0.18s ease",
                            color: "#fff",
                            fontSize: "12px",
                            fontWeight: 600,
                            gap: "4px",
                            flexDirection: "column",
                            zIndex: 5,
                          }}
                        >
                          <span style={{ fontSize: "20px" }}>🔍</span>
                          <span>{locale === "en" ? "View" : "Открыть"}</span>
                        </div>
                      </div>

                      {/* File Name Info Block */}
                      <div
                        style={{
                          padding: "6px 8px",
                          fontSize: "11px",
                          color: "#334155",
                          borderTop: "1px solid #e2e8f0",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textAlign: "center",
                          background: "#ffffff",
                          borderRadius: "0 0 8px 8px",
                          fontWeight: 500,
                        }}
                        title={file.name}
                      >
                        {file.name || (isPdf ? "Document.pdf" : "Photo.jpg")}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  border: "1.5px dashed #cbd5e1",
                  borderRadius: "10px",
                  padding: "20px",
                  textAlign: "center",
                  fontSize: "13px",
                  color: "#64748b",
                  background: "#f8fafc",
                }}
              >
                {locale === "en" ? "No files uploaded yet" : "Документы еще не загружены"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 🖼️ Fullscreen Image Lightbox */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={locale === "en" ? "Document viewer" : "Просмотр документа"}
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.94)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            zIndex: 99999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "docFadeIn 0.2s ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "min(95vw, 1200px)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setLightboxUrl(null)}
              style={{
                position: "absolute",
                top: "-52px",
                right: 0,
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: "50%",
                width: "40px",
                height: "40px",
                fontSize: "20px",
                fontWeight: "bold",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(4px)",
                transition: "background 0.15s",
              }}
              aria-label="Close"
            >
              ✕
            </button>

            {/* Image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Document"
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "80vh",
                borderRadius: "10px",
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
                border: "1.5px solid rgba(255,255,255,0.15)",
                objectFit: "contain",
              }}
            />

            {/* Action bar */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => handleDownload(lightboxUrl, "document.jpg")}
                style={{
                  background: "var(--yellow-color, #eab308)",
                  color: "#000",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 18px",
                  fontSize: "13px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                📥 {locale === "en" ? "Download" : "Скачать"}
              </button>
              <a
                href={lightboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: "8px",
                  padding: "8px 18px",
                  fontSize: "13px",
                  textDecoration: "none",
                  backdropFilter: "blur(4px)",
                  fontWeight: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                ↗ {locale === "en" ? "Open original" : "Открыть оригинал"}
              </a>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px" }}>
                {locale === "en" ? "Press Esc or click outside to close" : "Esc или клик вне фото для закрытия"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 📄 Modern Fullscreen PDF Viewer Modal */}
      {pdfViewerUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="PDF Viewer"
          onClick={() => setPdfViewerUrl(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            zIndex: 99999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "docFadeIn 0.2s ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "min(95vw, 1000px)",
              height: "85vh",
              background: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.4)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 24px",
                borderBottom: "1px solid #e2e8f0",
                background: "#f8fafc",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "24px" }}>📕</span>
                <span style={{ fontWeight: 600, color: "#0f172a", fontSize: "16px" }}>
                  {pdfViewerName || "PDF Document"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button
                  onClick={() => handleDownload(pdfViewerUrl, pdfViewerName || "document.pdf")}
                  style={{
                    background: "#0ea5e9",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  📥 {locale === "en" ? "Download" : "Скачать"}
                </button>
                <a
                  href={pdfViewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "var(--yellow-color, #eab308)",
                    color: "#000",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                    cursor: "pointer",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                  }}
                >
                  ↗ {locale === "en" ? "Open Fullscreen" : "На весь экран"}
                </a>
                <button
                  onClick={() => setPdfViewerUrl(null)}
                  style={{
                    background: "#e2e8f0",
                    color: "#475569",
                    border: "none",
                    borderRadius: "50%",
                    width: "36px",
                    height: "36px",
                    fontSize: "16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background 0.2s",
                  }}
                  title={locale === "en" ? "Close" : "Закрыть"}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* IFrame Viewer */}
            <div style={{ flex: 1, background: "#64748b", position: "relative" }}>
              <iframe
                src={pdfViewerUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
                title="PDF Iframe"
              />
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes docFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        .doc-file-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(6, 79, 88, 0.08);
          border-color: #cbd5e1 !important;
        }
        .doc-thumb:hover .doc-thumb-overlay {
          opacity: 1 !important;
        }
        .doc-delete-btn:hover {
          transform: scale(1.15);
          background: #dc2626 !important;
        }
        
        /* CSS Hover Floating Preview Tooltip styling */
        .hover-preview-tooltip {
          position: absolute;
          bottom: 110%;
          left: 50%;
          transform: translateX(-50%) scale(0.9);
          pointer-events: none;
          opacity: 0;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 1000;
          background: rgba(15, 23, 42, 0.95);
          padding: 8px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
          width: 260px;
          height: 180px;
          display: flex;
          align-items: center;
          justifyContent: center;
        }
        .doc-thumb:hover .hover-preview-tooltip {
          opacity: 1;
          transform: translateX(-50%) scale(1);
        }
        .hover-preview-tooltip img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
