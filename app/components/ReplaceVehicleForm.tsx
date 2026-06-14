"use client";

import React, { useState, useMemo } from "react";
import { replaceBookingVehicleAction } from "@/lib/actions";
import type { DashboardData } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

interface ReplaceVehicleFormProps {
  bookingId: string;
  currentVehicleId: string | undefined;
  startDate: string;
  endDate: string;
  actualEnd?: string | null;
  vehicles: DashboardData["vehicles"];
  allBookings: DashboardData["bookings"];
  maintenance: DashboardData["maintenance"];
  locale: Locale;
  compact?: boolean;
}

export function ReplaceVehicleForm({
  bookingId,
  currentVehicleId,
  startDate,
  endDate,
  actualEnd,
  vehicles,
  allBookings,
  maintenance,
  locale,
  compact = false
}: ReplaceVehicleFormProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
  const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
  const bookingStart = startDate.slice(0, 10);
  const bookingEnd = (actualEnd ?? endDate).slice(0, 10);
  
  const unavailableVehicleIds = useMemo(() => {
    return new Set(
      allBookings
        .filter((item) => item.id !== bookingId)
        .filter((item) => blockingBookingStatuses.has(item.status) || blockingRentalStatuses.has(item.rental_status))
        .filter((item) => item.start_date.slice(0, 10) <= bookingEnd && (item.actual_end ?? item.end_date).slice(0, 10) >= bookingStart)
        .map((item) => item.vehicle_id)
        .filter(Boolean)
    );
  }, [allBookings, bookingId, bookingStart, bookingEnd]);

  const maintenanceBlockedVehicleIds = useMemo(() => {
    return new Set(
      maintenance
        .filter((item) => ["scheduled", "in_progress"].includes(String(item.status ?? "")))
        .filter((item) => {
          const blockStart = String(item.vehicle_unavailable_from ?? "").slice(0, 10);
          const blockEnd = String(item.vehicle_unavailable_to ?? "9999-12-31").slice(0, 10);
          return Boolean(item.vehicle_id && blockStart && blockEnd && blockStart <= bookingEnd && blockEnd >= bookingStart);
        })
        .map((item) => item.vehicle_id)
        .filter(Boolean)
    );
  }, [bookingStart, bookingEnd, maintenance]);

  const sortedAndFilteredVehicles = useMemo(() => {
    const baseList = vehicles
      .filter((v) => v.id !== currentVehicleId)
      .filter((v) => !["reserved", "handed_over", "active", "in_use", "returning", "maintenance", "repair", "retired"].includes(v.status))
      .filter((v) => !unavailableVehicleIds.has(v.id))
      .filter((v) => !maintenanceBlockedVehicleIds.has(v.id));

    // Sort alphabetically: make -> model -> plate
    const sorted = [...baseList].sort((a, b) => {
      const makeCompare = (a.make || "").localeCompare(b.make || "", locale === "en" ? "en" : "ru");
      if (makeCompare !== 0) return makeCompare;
      const modelCompare = (a.model || "").localeCompare(b.model || "", locale === "en" ? "en" : "ru");
      if (modelCompare !== 0) return modelCompare;
      return (a.license_plate || "").localeCompare(b.license_plate || "");
    });

    const q = searchQuery.toLowerCase().trim();
    if (!q) return sorted;
    return sorted.filter(v =>
      (v.make || "").toLowerCase().includes(q) ||
      (v.model || "").toLowerCase().includes(q) ||
      (v.license_plate || "").toLowerCase().includes(q)
    );
  }, [vehicles, currentVehicleId, unavailableVehicleIds, maintenanceBlockedVehicleIds, searchQuery, locale]);

  return (
    <form 
      action={replaceBookingVehicleAction} 
      className="filters" 
      style={{ display: "inline-flex", gap: "6px", alignItems: "center", margin: 0, padding: 0 }}
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      
      {/* Search Input */}
      <input
        type="text"
        placeholder={locale === "en" ? "🔍 Search..." : "🔍 Поиск..."}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="input"
        style={{
          padding: "2px 6px",
          fontSize: compact ? "11px" : "12px",
          height: compact ? "26px" : "30px",
          width: compact ? "80px" : "100px",
          border: "1px solid var(--line, #e2e8f0)",
          borderRadius: "6px",
          background: "#ffffff"
        }}
      />

      <select 
        name="new_vehicle_id" 
        className="input" 
        style={{ 
          padding: compact ? "2px 6px" : "4px 8px", 
          fontSize: compact ? "11px" : "12px", 
          height: compact ? "26px" : "30px", 
          width: compact ? "150px" : "180px",
          border: "1px solid var(--line)",
          borderRadius: "6px",
          background: "#ffffff"
        }} 
        required
      >
        <option value="">{locale === "en" ? "-- Swap Vehicle --" : "-- Заменить машину --"}</option>
        {sortedAndFilteredVehicles.map(v => (
          <option key={v.id} value={v.id}>
            {v.make} {v.model} ({v.license_plate})
          </option>
        ))}
        {sortedAndFilteredVehicles.length === 0 ? (
          <option value="" disabled>{locale === "en" ? "No free vehicles" : "Нет свободных машин"}</option>
        ) : null}
      </select>
      <button 
        type="submit" 
        className="primary" 
        style={{ 
          padding: compact ? "2px 8px" : "4px 10px", 
          fontSize: compact ? "11px" : "12px", 
          height: compact ? "26px" : "30px", 
          minHeight: compact ? "26px" : "30px", 
          lineHeight: "1",
          borderRadius: "6px",
          cursor: "pointer"
        }}
      >
        {locale === "en" ? "Swap" : "Заменить"}
      </button>
    </form>
  );
}
