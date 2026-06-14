"use client";

import { useState, useMemo } from "react";
import type { Locale } from "@/lib/i18n";
import { tr } from "@/lib/i18n";

function tx(locale: Locale, ru: string, en: string) {
  return locale === "en" ? en : ru;
}

import type { Customer } from "@/lib/types";
import { ActionFeedbackForm } from "./ActionFeedbackForm";
import { deleteCustomerAction } from "@/lib/actions";

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) return Date.UTC(Number(dotMatch[3]), Number(dotMatch[2]) - 1, Number(dotMatch[1]));
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function hasValidDrivingPermit(customer: Customer) {
  if (customer.has_valid_idp) return true;
  if (!customer.idp_number?.trim()) return false;
  const expiresAt = parseDateOnly(customer.idp_expires);
  if (!expiresAt) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiresAt >= today;
}

type CustomerListProps = {
  customers: Customer[];
  locale: Locale;
  canDelete?: boolean;
};

export function CustomerList({ customers, locale, canDelete = false }: CustomerListProps) {
  const [query, setQuery] = useState("");

  const filteredCustomers = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return customers;

    return customers.filter((customer) => {
      const name = (customer.full_name || "").toLowerCase();
      const passportName = (customer.full_name_passport || "").toLowerCase();
      const phoneVal = (customer.phone || "").toLowerCase();
      const whatsappVal = (customer.whatsapp || "").toLowerCase();
      const tgVal = (customer.telegram_username || "").toLowerCase();
      const passportNum = (customer.passport_number || "").toLowerCase();
      const idpNum = (customer.idp_number || "").toLowerCase();
      const sourceVal = (customer.source || "").toLowerCase();
      const sourceDetail = (customer.source_detail || "").toLowerCase();
      const lang = (customer.language_pref || "").toLowerCase();
      const tagsString = (customer.tags || []).join(" ").toLowerCase();

      return (
        name.includes(trimmed) ||
        passportName.includes(trimmed) ||
        phoneVal.includes(trimmed) ||
        whatsappVal.includes(trimmed) ||
        tgVal.includes(trimmed) ||
        passportNum.includes(trimmed) ||
        idpNum.includes(trimmed) ||
        sourceVal.includes(trimmed) ||
        sourceDetail.includes(trimmed) ||
        lang.includes(trimmed) ||
        tagsString.includes(trimmed)
      );
    });
  }, [customers, query]);

  return (
    <div>
      <div style={{ marginBottom: "16px", position: "relative", width: "100%", maxWidth: "420px" }}>
        <input
          type="text"
          placeholder={locale === "en" ? "Search customers by name, phone, passport, tags..." : "Поиск клиентов по имени, телефону, паспорту, тегам..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 36px 10px 14px",
            fontSize: "14px",
            border: "1px solid var(--line, #e2e8f0)",
            borderRadius: "8px",
            background: "var(--light-bg, #fff)",
            color: "var(--text, #1a202c)",
            outline: "none",
            boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))",
            transition: "border-color 0.2s"
          }}
        />
        <span style={{ position: "absolute", left: "auto", right: "12px", top: "50%", transform: "translateY(-50%)", fontSize: "16px", opacity: 0.5 }}>
          🔍
        </span>
        {query && (
          <button
            onClick={() => setQuery("")}
            style={{
              position: "absolute",
              right: "36px",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "14px",
              opacity: 0.5,
              padding: "4px"
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{locale === "en" ? "Customer" : "Клиент"}</th>
              <th>{locale === "en" ? "Contact" : "Контакты"}</th>
              <th>{locale === "en" ? "Source" : "Источник"}</th>
              <th>{locale === "en" ? "Passport" : "Паспорт"}</th>
              <th>IDP</th>
              <th>{locale === "en" ? "Language" : "Язык"}</th>
              {canDelete && <th>{locale === "en" ? "Actions" : "Действия"}</th>}
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <a href={`/customers/${customer.id}`}>
                    <strong>{customer.full_name}</strong>
                  </a>
                  <br />
                  <span className="muted">
                    {customer.full_name_passport ?? (locale === "en" ? "Passport name missing" : "Имя в паспорте отсутствует")}
                  </span>
                </td>
                <td>{customer.phone ?? customer.whatsapp ?? customer.telegram_username ?? "-"}</td>
                <td>
                  {customer.source}
                  <br />
                  <span className="muted">{customer.source_detail ?? ""}</span>
                </td>
                <td>
                  {customer.passport_number ?? "-"}
                  <br />
                  <span className="muted">{customer.passport_expires ?? ""}</span>
                </td>
                <td>
                  {hasValidDrivingPermit(customer) ? (
                    <span className="badge ok">{locale === "en" ? "Valid" : "Действительны"}</span>
                  ) : (
                    <span className="badge danger">{locale === "en" ? "IDP needed" : "Нужны МВУ"}</span>
                  )}
                  <br />
                  <span className="muted">{customer.idp_number ?? ""}</span>
                </td>
                <td>{customer.language_pref.toUpperCase()}</td>
                {canDelete && (
                  <td>
                    <ActionFeedbackForm
                      action={deleteCustomerAction}
                      locale={locale}
                      savingText={locale === "en" ? "Deleting..." : "Удаляю..."}
                      confirmText={locale === "en" ? "Are you sure you want to permanently delete this customer?" : "Вы уверены, что хотите безвозвратно удалить этого клиента?"}
                    >
                      <input type="hidden" name="customer_id" value={customer.id} />
                      <button className="button danger-button" style={{ padding: "4px 8px", fontSize: "11px", height: "28px", minHeight: "28px", lineHeight: "1" }}>
                        {locale === "en" ? "Delete" : "Удалить"}
                      </button>
                    </ActionFeedbackForm>
                  </td>
                )}
              </tr>
            ))}
            {filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 7 : 6} style={{ textAlign: "center", padding: "24px" }} className="muted">
                  {locale === "en" ? "No matches found" : "Ничего не найдено"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
