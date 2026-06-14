import { notFound } from "next/navigation";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { BookingStatusButton } from "@/app/components/BookingStatusButton";
import { bookingStatusBadge, rentalStatusBadge, getProtectedCrmPage, money, SimpleModulePage } from "@/app/components/CrmPages";
import { BookingEditForm } from "@/app/components/BookingEditForm";
import {
  cancelBookingAction,
  deleteBookingAction,
  generateContractPdfAction,
  recordBookingPaymentsAction,
  replaceBookingVehicleAction,
  updateBookingDetailsAction,
  updateBookingStatusAction,
  updateBookingRentalStatusAction
} from "@/lib/actions";
import { getBookingDetail } from "@/lib/repository";
import type { BookingStatus, Customer, RentalStatus, Vehicle } from "@/lib/types";
import { formatDisplayDate, formatDisplayDateTime, type Locale } from "@/lib/i18n";
import { ReplaceVehicleForm } from "@/app/components/ReplaceVehicleForm";
import { BookingPaymentsForm } from "@/app/components/BookingPaymentsForm";
import { calculateRentalPaymentCoverage } from "@/lib/payment-status";

type PageParams = {
  params: Promise<{ id: string }>;
};

type ServerFormAction = (formData: FormData) => Promise<void>;

function renderLocationLink(value: string | null | undefined) {
  if (!value?.trim()) return "-";
  const trimmed = value.trim();
  const isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes("google.com/maps") || trimmed.includes("maps.app.goo.gl");
  if (isUrl) {
    return (
      <a href={trimmed} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary, #064f58)", textDecoration: "underline", fontWeight: "bold" }}>
        📍 {trimmed.length > 40 ? trimmed.slice(0, 37) + "..." : trimmed}
      </a>
    );
  }
  return trimmed;
}

function customerLabel(customer: Customer | null) {
  if (!customer) return "-";
  return customer.full_name || customer.full_name_passport || customer.whatsapp || customer.phone || customer.telegram_username || "-";
}

function vehicleLabel(vehicle: Vehicle | null) {
  if (!vehicle) return "-";
  const modelName = [vehicle.make, vehicle.model].filter(Boolean).join(" ");
  return [modelName, vehicle.license_plate].filter(Boolean).join(" · ") || "-";
}

function compositeBookingBase(bookingNumber: string) {
  const match = bookingNumber.match(/^(.*)-[AB]$/);
  return match?.[1] ?? null;
}

function compositeBookingSegmentLabel(bookingNumber: string, locale: Locale) {
  if (bookingNumber.endsWith("-A")) return locale === "en" ? "split booking: temporary car" : "составная бронь: временная машина";
  if (bookingNumber.endsWith("-B")) return locale === "en" ? "split booking: main car" : "составная бронь: основная машина";
  return "";
}

function dateKey(value: string | null | undefined) {
  return String(value ?? "").slice(0, 10);
}

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    return Date.UTC(Number(dotMatch[3]), Number(dotMatch[2]) - 1, Number(dotMatch[1]));
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function hasValidDrivingPermit(customer: Customer | null) {
  if (customer?.has_valid_idp) return true;
  if (!customer?.idp_number?.trim()) return false;
  const expiresAt = parseDateOnly(customer.idp_expires);
  if (!expiresAt) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiresAt >= today;
}

export default async function Page({ params }: PageParams) {
  const { id } = await params;
  const { data, locale, user } = await getProtectedCrmPage();
  const booking = await getBookingDetail(id, user.tenantId);
  const vehicles = data.vehicles || [];
  const customers = data.customers || [];

  if (!booking) {
    notFound();
  }

  const blockingBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "in_use", "returning"]);
  const blockingRentalStatuses = new Set(["handed_over", "active", "in_use", "returning"]);
  const bookingStart = dateKey(booking.start_date);
  const bookingEnd = dateKey(booking.actual_end ?? booking.end_date);
  const unavailableVehicleIds = new Set(
    data.bookings
      .filter((item) => item.id !== booking.id)
      .filter((item) => blockingBookingStatuses.has(item.status) || blockingRentalStatuses.has(item.rental_status))
      .filter((item) => {
        const itemStart = dateKey(item.start_date);
        const itemEnd = dateKey(item.actual_end ?? item.end_date);
        return Boolean(bookingStart && bookingEnd && itemStart && itemEnd && itemStart <= bookingEnd && itemEnd >= bookingStart);
      })
      .map((item) => item.vehicle_id)
      .filter(Boolean)
  );
  const hasValidPermit = hasValidDrivingPermit(booking.customer);
  const canOwnerOverrideIdp = !hasValidPermit && user.role === "owner";
  const customerOptions = customers.map((customer) => ({
    id: customer.id,
    label: customerLabel(customer),
    contact: customer.whatsapp || customer.phone || customer.telegram_username || "-"
  }));
  const vehicleOptions = [...vehicles]
    .sort((a, b) => {
      const makeCompare = (a.make || "").localeCompare(b.make || "", locale === "en" ? "en" : "ru");
      if (makeCompare !== 0) return makeCompare;
      const modelCompare = (a.model || "").localeCompare(b.model || "", locale === "en" ? "en" : "ru");
      if (modelCompare !== 0) return modelCompare;
      return (a.license_plate || "").localeCompare(b.license_plate || "");
    })
    .map((vehicle) => ({
      id: vehicle.id,
      label: vehicleLabel(vehicle),
      status: vehicle.status
    }));
  const compositeBase = compositeBookingBase(booking.booking_number);
  const compositeSegments = compositeBase
    ? data.bookings
        .filter((item) => item.booking_number === compositeBase || item.booking_number.startsWith(`${compositeBase}-`))
        .sort((left, right) => left.booking_number.localeCompare(right.booking_number))
    : [];
  const currentCompositeLabel = compositeBookingSegmentLabel(booking.booking_number, locale);
  const rentalCoverage = calculateRentalPaymentCoverage(booking, booking.payments ?? []);
  const paidThroughLabel = rentalCoverage.isFullyPaid
    ? rentalCoverage.isLongTerm
      ? rentalCoverage.paidThroughDate
        ? `${locale === "en" ? "rent paid until" : "аренда оплачена до"} ${formatDisplayDate(rentalCoverage.paidThroughDate)}`
        : locale === "en" ? "current month paid" : "текущий месяц оплачен"
      : rentalCoverage.paidThroughDate
        ? `${locale === "en" ? "rent paid until" : "аренда оплачена до"} ${formatDisplayDate(rentalCoverage.paidThroughDate)}`
        : locale === "en" ? "paid to rental end" : "оплачено до конца аренды"
    : rentalCoverage.paidThroughDate
      ? `${locale === "en" ? "rent paid until" : "аренда оплачена до"} ${formatDisplayDate(rentalCoverage.paidThroughDate)}`
      : locale === "en" ? "not covered yet" : "аренда еще не покрыта";
  const rentalCounterBaseLabel = rentalCoverage.isLongTerm
    ? locale === "en" ? "Monthly rent" : "Месячная аренда"
    : locale === "en" ? "Short-term rental total" : "Стоимость всех дней аренды";
  const isRentalDocument =
    ["handed_over", "active", "in_use", "returning"].includes(String(booking.rental_status ?? "")) ||
    ["handed_over", "active", "in_use", "returning"].includes(String(booking.status ?? ""));
  const documentLabel = isRentalDocument
    ? locale === "en" ? "Rental" : "Аренда"
    : locale === "en" ? "Booking" : "Бронь";
  const documentCardLabel = isRentalDocument
    ? locale === "en" ? "Rental card" : "Карточка аренды"
    : locale === "en" ? "Booking card" : "Карточка брони";

  return (
    <SimpleModulePage
      title={`${documentLabel} ${booking.booking_number}`}
      subtitle=""
      locale={locale}
      activePath="/bookings"
    >
      <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{documentCardLabel}</h2>
              <p className="sub">{formatDisplayDateTime(booking.start_date)} - {formatDisplayDateTime(booking.end_date)}</p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {currentCompositeLabel ? <span className="badge info">{currentCompositeLabel}</span> : null}
              {bookingStatusBadge(booking.status, locale)}
              {rentalStatusBadge(booking.rental_status, locale)}
            </div>
          </div>
          <div className="panel-body">
            <div className="task" style={{ background: "#f6ffff" }}>
              <strong>{locale === "en" ? "Rental payment counter" : "Счетчик оплаты аренды"}</strong>
              <span className={rentalCoverage.isFullyPaid ? "badge ok" : rentalCoverage.rentalPaid > 0 ? "badge warn" : "badge danger"}>
                {paidThroughLabel}
              </span>
              <span className="muted">
                {rentalCounterBaseLabel}: {money(rentalCoverage.rentalDue)}
              </span>
              {rentalCoverage.isLongTerm ? (
                <span className="muted">
                  {locale === "en" ? "Full rental term:" : "Весь срок аренды:"} {rentalCoverage.termMonths} {locale === "en" ? "month(s)" : "мес."} × {money(rentalCoverage.rentalDue)} = {money(rentalCoverage.fullRentalDue)}
                </span>
              ) : (
                <span className="muted">
                  {locale === "en" ? "Full rental term:" : "Весь срок аренды:"} {rentalCoverage.totalDays} {locale === "en" ? "day(s)" : "дн."} × {money(rentalCoverage.dailyRate)} = {money(rentalCoverage.fullRentalDue)}
                </span>
              )}
              <span className="muted">
                {locale === "en" ? "Paid for rental:" : "Оплачено за аренду:"} {money(rentalCoverage.rentalPaid)}
                {rentalCoverage.inferredRentalFromStatus ? ` · ${locale === "en" ? "including rental status credit" : "включая автозачет по статусу аренды"}` : ""}
              </span>
              <span className="muted">
                {locale === "en" ? "Remaining until rental end:" : "Осталось оплатить до конца срока:"} {money(rentalCoverage.remainingRental)}
              </span>
              <span className="muted">
                {locale === "en" ? "Deposit paid:" : "Оплачено депозита:"} {money(rentalCoverage.depositPaid)} / {money(rentalCoverage.depositDue)}
                {rentalCoverage.inferredDepositFromStatus ? ` · ${locale === "en" ? "from deposit status" : "по статусу депозита"}` : ""}
              </span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Customer" : "Клиент"}</strong>
              <span>
                {booking.customer ? <a href={`/customers/${booking.customer.id}`}>{customerLabel(booking.customer)}</a> : "-"}
              </span>
              <span className="muted">{booking.customer?.phone ?? ""}</span>
            </div>
            <div className="task" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
              <strong>{locale === "en" ? "Vehicle" : "Автомобиль"}</strong>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
                <span>
                  {booking.vehicle ? (
                    <a href={`/fleet/${booking.vehicle.id}`}>{vehicleLabel(booking.vehicle)}</a>
                  ) : "-"}
                </span>
                
                {blockingBookingStatuses.has(booking.status) || blockingRentalStatuses.has(booking.rental_status) ? (
                  <ReplaceVehicleForm 
                    bookingId={booking.id}
                    currentVehicleId={booking.vehicle?.id}
                    startDate={booking.start_date}
                    endDate={booking.end_date}
                    actualEnd={booking.actual_end}
                    vehicles={vehicles}
                    allBookings={data.bookings}
                    maintenance={data.maintenance}
                    locale={locale}
                  />
                ) : null}
              </div>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Pickup location" : "Место выдачи"}</strong>
              <span>{renderLocationLink(booking.pickup_location)}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Return location" : "Место возврата"}</strong>
              <span>{renderLocationLink(booking.return_location)}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Handover / return" : "Выдача / возврат"}</strong>
              <a className="button" href="/handover">{locale === "en" ? "Open operator queue" : "Открыть очередь оператора"}</a>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "IDP / Thai license control" : "Проверка IDP / тайских прав"}</strong>
              {hasValidPermit ? (
                <span className="badge ok">valid</span>
              ) : canOwnerOverrideIdp ? (
                <span className="badge warn">{locale === "en" ? "owner override available" : "owner может выдать вручную"}</span>
              ) : (
                <span className="badge danger">{locale === "en" ? "handover blocked" : "выдача заблокирована"}</span>
              )}
              <span className="muted">
                {locale === "en" ? "IDP / Thai license #:" : "IDP / Тайские права №:"} {booking.customer?.idp_number ?? "-"}
              </span>
              <span className="muted">
                {locale === "en" ? "Valid until:" : "Действует до:"} {booking.customer?.idp_expires ? formatDisplayDate(booking.customer.idp_expires) : "-"}
              </span>
              {booking.idp_owner_override ? (
                <span className="badge warn">{locale === "en" ? "issued by owner override" : "выдано по решению owner"}</span>
              ) : null}
              {booking.idp_override_note ? <span className="muted">{booking.idp_override_note}</span> : null}
              {canOwnerOverrideIdp ? (
                <span className="muted">
                  {locale === "en"
                    ? "Owner can intentionally press Handed Over below: CRM will record the override and keep the audit note."
                    : "Owner может намеренно нажать «Выдана» ниже: CRM зафиксирует override и сохранит заметку для аудита."}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Payments" : "Оплаты"}</h2></div>
          <div className="panel-body">
            <BookingPaymentsForm
              action={recordBookingPaymentsAction}
              booking={{
                id: booking.id,
                booking_number: booking.booking_number,
                customer_id: booking.customer_id,
                customer_name: customerLabel(booking.customer),
                vehicle_id: booking.vehicle_id,
                vehicle: vehicleLabel(booking.vehicle),
                status: booking.status as BookingStatus,
                rental_status: booking.rental_status as RentalStatus,
                start_date: booking.start_date,
                end_date: booking.end_date,
                actual_end: booking.actual_end,
                rental_amount: booking.total_rental_amount,
                deposit_amount: booking.deposit_amount,
                pickup_fee: 0,
                delivery_fee: booking.delivery_fee,
                grand_total: booking.grand_total,
                payment_status: booking.payment_status,
                deposit_status: booking.deposit_status,
                idp_ok: hasValidPermit
              }}
              tenantId={user.tenantId}
              locale={locale}
              coverage={rentalCoverage}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Booking Status" : "Статус бронирования (Договор)"}</h2></div>
          <div className="panel-body">
            <p className="muted">
              {locale === "en"
                ? "Manage the contract and financial state of the booking."
                : "Управляйте договорным и финансовым состоянием бронирования."}
            </p>
            <div className="filters">
              {[
                ["confirmed", locale === "en" ? "Confirmed" : "Подтверждена"],
                ["paid_deposit", locale === "en" ? "Deposit paid" : "Депозит оплачен"],
                ["completed", locale === "en" ? "Completed" : "Завершена"],
                ["cancelled", locale === "en" ? "Cancelled" : "Отменена"],
                ["no_show", locale === "en" ? "No show" : "Неявка"]
              ].map(([status, label]) => (
                <BookingStatusButton
                  action={updateBookingStatusAction}
                  bookingId={booking.id}
                  status={status as BookingStatus}
                  label={label}
                  active={booking.status === status}
                  locale={locale}
                  key={status}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Rental Status" : "Статус автомобиля в аренде (Физический)"}</h2></div>
          <div className="panel-body">
            <p className="muted">
              {locale === "en"
                ? "Manage the physical handover process. Handover is blocked without a valid IDP / Thai license, except owner override."
                : "Управляйте физическим процессом выдачи и возврата. Выдача блокируется без действующего IDP / тайских прав, кроме owner override."}
            </p>
            {canOwnerOverrideIdp ? (
              <div className="task warning">
                <strong>{locale === "en" ? "Owner override" : "Owner override"}</strong>
                <span>
                  {locale === "en"
                    ? "This customer has no valid IDP / Thai license in CRM. If you continue with Handed Over as owner, the handover will be allowed and marked as an owner risk acceptance."
                    : "У клиента нет действующего IDP / тайских прав в CRM. Если owner продолжит через «Выдана», выдача будет разрешена и отмечена как принятие риска владельцем."}
                </span>
              </div>
            ) : null}
            <div className="filters">
              {[
                ["not_started", locale === "en" ? "Awaiting Handover" : "Ожидает выдачи"],
                ["handed_over", locale === "en" ? "Handed Over" : "Выдана"],
                ["active", locale === "en" ? "Active Rental" : "В аренде"],
                ["returning", locale === "en" ? "Returning" : "Возврат"],
                ["returned", locale === "en" ? "Returned" : "Возвращена"]
              ].map(([rstatus, label]) => (
                <BookingStatusButton
                  action={updateBookingRentalStatusAction}
                  bookingId={booking.id}
                  status={rstatus as RentalStatus}
                  label={label}
                  active={booking.rental_status === rstatus}
                  locale={locale}
                  key={rstatus}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Contract PDF" : "Договор PDF"}</h2></div>
          <div className="panel-body">
            <p className="muted">
              {locale === "en"
                ? "Generates a real PDF, uploads it to Supabase Storage and saves the link in the booking."
                : "Создает реальный PDF, загружает его в Supabase Storage и сохраняет ссылку в брони."}
            </p>
            {booking.contract_pdf_url ? (
              <p><a className="primary" href={booking.contract_pdf_url} target="_blank">{locale === "en" ? "Open contract" : "Открыть договор"}</a></p>
            ) : (
              <p><span className="badge warn">{locale === "en" ? "not generated" : "не создан"}</span></p>
            )}
            <form action={generateContractPdfAction} className="filters">
              <input type="hidden" name="booking_id" value={booking.id} />
              <input type="hidden" name="language" value={locale} />
              <button className="primary">{locale === "en" ? "Generate PDF" : "Сформировать PDF"}</button>
            </form>
          </div>
        </div>
      </section>

      {compositeSegments.length > 1 ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Split booking parts" : "Части составной брони"}</h2>
              <p className="sub">
                {locale === "en"
                  ? "Each car segment is a normal booking with its own dates, vehicle status and handover/return controls."
                  : "Каждая машина в составной брони работает как обычная бронь: свои даты, свой статус автомобиля, своя выдача и возврат."}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{locale === "en" ? "Part" : "Часть"}</th>
                  <th>{locale === "en" ? "Vehicle" : "Автомобиль"}</th>
                  <th>{locale === "en" ? "Dates" : "Даты"}</th>
                  <th>{locale === "en" ? "Amount" : "Сумма"}</th>
                  <th>{locale === "en" ? "Status" : "Статус"}</th>
                </tr>
              </thead>
              <tbody>
                {compositeSegments.map((segment) => (
                  <tr key={segment.id}>
                    <td>
                      <div className="booking-number-cell">
                        <a href={`/bookings/${segment.id}`}>{segment.booking_number}</a>
                        <span className="muted">{compositeBookingSegmentLabel(segment.booking_number, locale)}</span>
                      </div>
                    </td>
                    <td>{segment.vehicle_id ? <a href={`/fleet/${segment.vehicle_id}`}>{segment.vehicle}</a> : segment.vehicle}</td>
                    <td>{formatDisplayDateTime(segment.start_date)} - {formatDisplayDateTime(segment.end_date)}</td>
                    <td>{money(segment.grand_total)}</td>
                    <td>
                      <div className="status-stack">
                        {bookingStatusBadge(segment.status, locale)}
                        {rentalStatusBadge(segment.rental_status, locale)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Edit booking" : "Редактировать бронь"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Change customer, vehicle, dates and financial split. CRM checks vehicle overlaps before saving."
                : "Измените клиента, автомобиль, даты и оплату. CRM проверит пересечение брони перед сохранением."}
            </p>
          </div>
        </div>
        <BookingEditForm
          action={updateBookingDetailsAction}
          booking={booking}
          customerOptions={customerOptions}
          vehicleOptions={vehicleOptions}
          existingBookings={data.bookings}
          existingMaintenance={data.maintenance}
          locale={locale}
          currentUserRole={user.role}
        />
      </section>

      <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Cancel booking" : "Отменить бронь"}</h2>
              <p className="sub">{locale === "en" ? "Keeps the booking history and releases the vehicle." : "История брони остаётся, автомобиль освобождается."}</p>
            </div>
          </div>
          <ActionFeedbackForm
            action={cancelBookingAction}
            className="form-grid"
            locale={locale}
            savingText={locale === "en" ? "Cancelling booking..." : "Отменяю бронь..."}
          >
            <input type="hidden" name="booking_id" value={booking.id} />
            <div className="field wide">
              <label>{locale === "en" ? "Reason" : "Причина отмены"}</label>
              <input name="cancellation_reason" defaultValue={booking.cancellation_reason ?? ""} placeholder={locale === "en" ? "Optional" : "Необязательно"} />
            </div>
            <div className="field wide">
              <button className="button" type="submit">{locale === "en" ? "Cancel booking" : "Отменить бронь"}</button>
            </div>
          </ActionFeedbackForm>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Delete mistaken booking" : "Удалить ошибочную бронь"}</h2>
              <p className="sub">{locale === "en" ? "Owner/manager only. Bookings with payments are not deleted." : "Только owner/manager. Брони с платежами не удаляются."}</p>
            </div>
          </div>
          <form action={deleteBookingAction as unknown as ServerFormAction} className="form-grid">
            <input type="hidden" name="booking_id" value={booking.id} />
            <input type="hidden" name="redirect_to" value="/bookings" />
            <div className="field wide">
              <label>{locale === "en" ? "Type DELETE to confirm" : "Введите DELETE для подтверждения"}</label>
              <input name="confirm_delete" placeholder="DELETE" />
            </div>
            <div className="field wide">
              <button className="button danger" type="submit">{locale === "en" ? "Delete booking" : "Удалить бронь"}</button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>{locale === "en" ? "Payment split" : "Разбивка оплаты"}</h2></div>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><th>{locale === "en" ? "Rental" : "Аренда"}</th><td>{money(booking.total_rental_amount)}</td></tr>
              <tr><th>{locale === "en" ? "Deposit" : "Депозит"}</th><td>{money(booking.deposit_amount)}</td></tr>
              <tr><th>{locale === "en" ? "Delivery" : "Доставка"}</th><td>{money(booking.delivery_fee)}</td></tr>
              <tr><th>{locale === "en" ? "Extras" : "Дополнительно"}</th><td>{money(booking.extras_total)}</td></tr>
              <tr><th>{locale === "en" ? "Grand total" : "Итого"}</th><td><strong>{money(booking.grand_total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </SimpleModulePage>
  );
}
