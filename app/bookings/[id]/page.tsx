import { notFound } from "next/navigation";
import { BookingStatusButton } from "@/app/components/BookingStatusButton";
import { bookingStatusBadge, getProtectedCrmPage, money, SimpleModulePage } from "@/app/components/CrmPages";
import { generateContractPdfAction, updateBookingStatusAction } from "@/lib/actions";
import { getBookingDetail } from "@/lib/repository";
import type { BookingStatus } from "@/lib/types";

type PageParams = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageParams) {
  const { id } = await params;
  const { locale, user } = await getProtectedCrmPage();
  const booking = await getBookingDetail(id, user.tenantId);

  if (!booking) {
    notFound();
  }

  return (
    <SimpleModulePage
      title={`${locale === "en" ? "Booking" : "Бронь"} ${booking.booking_number}`}
      subtitle=""
      locale={locale}
      activePath="/bookings"
    >
      <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Booking card" : "Карточка брони"}</h2>
              <p className="sub">{booking.start_date} - {booking.end_date}</p>
            </div>
            {bookingStatusBadge(booking.status, locale)}
          </div>
          <div className="panel-body">
            <div className="task">
              <strong>{locale === "en" ? "Customer" : "Клиент"}</strong>
              <span>
                {booking.customer ? <a href={`/customers/${booking.customer.id}`}>{booking.customer.full_name}</a> : "-"}
              </span>
              <span className="muted">{booking.customer?.phone ?? ""}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Vehicle" : "Автомобиль"}</strong>
              <span>
                {booking.vehicle ? (
                  <a href={`/fleet/${booking.vehicle.id}`}>{booking.vehicle.make} {booking.vehicle.model} · {booking.vehicle.license_plate}</a>
                ) : "-"}
              </span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Handover / return" : "Выдача / возврат"}</strong>
              <a className="button" href="/handover">{locale === "en" ? "Open operator queue" : "Открыть очередь оператора"}</a>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "IDP control" : "Проверка IDP"}</strong>
              {booking.customer?.has_valid_idp ? <span className="badge ok">valid</span> : <span className="badge danger">{locale === "en" ? "handover blocked" : "выдача заблокирована"}</span>}
              <span className="muted">IDP: {booking.customer?.idp_number ?? "-"}</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Booking workflow" : "Движение брони"}</h2></div>
          <div className="panel-body">
            <p className="muted">
              {locale === "en"
                ? "Change the booking state from here. Handover is blocked if the customer has no valid IDP."
                : "Меняйте статус брони отсюда. Выдача блокируется, если у клиента нет действующего IDP."}
            </p>
            <div className="filters">
              {[
                ["confirmed", locale === "en" ? "Confirmed" : "Подтверждена"],
                ["paid_deposit", locale === "en" ? "Deposit paid" : "Депозит оплачен"],
                ["handed_over", locale === "en" ? "Handed over" : "Выдана"],
                ["active", locale === "en" ? "Active rental" : "В аренде"],
                ["returning", locale === "en" ? "Returning" : "Возврат"],
                ["completed", locale === "en" ? "Completed" : "Завершена"]
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
