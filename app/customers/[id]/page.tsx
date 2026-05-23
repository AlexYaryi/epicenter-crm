import { notFound } from "next/navigation";
import { bookingStatusBadge, getProtectedCrmPage, money, SimpleModulePage, sourceLabel } from "@/app/components/CrmPages";
import { createBookingAction, sendCustomerMessageAction, updateCustomerAction } from "@/lib/actions";
import { getCustomerMessages } from "@/lib/repository";
import { CustomerConversation } from "@/app/components/CustomerConversation";
import { CustomerEditForm } from "@/app/components/CustomerEditForm";
import { BookingForm } from "@/app/components/BookingForm";
import { MessageComposeForm } from "@/app/components/MessageComposeForm";

type PageParams = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageParams) {
  const { id } = await params;
  const { data, locale, user } = await getProtectedCrmPage();
  const customer = data.customers.find((item) => item.id === id);

  if (!customer) {
    notFound();
  }

  const bookings = data.bookings.filter((booking) => booking.customer_id === customer.id || booking.customer_name === customer.full_name);
  const messages = await getCustomerMessages(customer.id, user.tenantId);
  const canEdit = user.role === "owner" || user.role === "manager" || user.role === "operator" || user.role === "marketer";

  return (
    <SimpleModulePage title={customer.full_name} subtitle="" locale={locale} activePath="/customers">
      <section className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Customer profile" : "Профиль клиента"}</h2></div>
          <div className="panel-body">
            <div className="task"><strong>{locale === "en" ? "Phone" : "Телефон"}</strong><span>{customer.phone ?? "-"}</span></div>
            <div className="task"><strong>WhatsApp</strong><span>{customer.whatsapp ?? customer.phone ?? "-"}</span></div>
            <div className="task"><strong>Telegram</strong><span>{customer.telegram_username ?? "-"}</span></div>
            <div className="task"><strong>{locale === "en" ? "Source" : "Источник"}</strong><span>{sourceLabel(customer.source, locale)}</span></div>
            <div className="task"><strong>{locale === "en" ? "Source detail" : "Источник / чат"}</strong><span>{customer.source_detail ?? "-"}</span></div>
            <div className="task"><strong>{locale === "en" ? "Passport name" : "Имя в паспорте"}</strong><span>{customer.full_name_passport ?? "-"}</span></div>
            <div className="task"><strong>{locale === "en" ? "Language" : "Язык"}</strong><span>{customer.language_pref.toUpperCase()}</span></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Documents and hard blocks" : "Документы и блокировки"}</h2></div>
          <div className="panel-body">
            <div className="task"><strong>{locale === "en" ? "Passport" : "Паспорт"}</strong><span>{customer.passport_number ?? "-"}</span><span className="muted">{customer.passport_expires ?? ""}</span></div>
            <div className="task">
              <strong>IDP</strong>
              {customer.has_valid_idp ? <span className="badge ok">valid</span> : <span className="badge danger">{locale === "en" ? "required before handover" : "обязателен до выдачи"}</span>}
              <span className="muted">{customer.idp_number ?? "-"}</span>
            </div>
          </div>
        </div>
      </section>

      {canEdit ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Edit customer" : "Редактировать клиента"}</h2>
              <p className="sub">{locale === "en" ? "Update contacts, documents, IDP and source." : "Обновить контакты, документы, IDP и источник."}</p>
            </div>
          </div>
          <div className="panel-body">
            <CustomerEditForm action={updateCustomerAction} customer={customer} locale={locale} />
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Conversation history" : "История переписки"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Inbound and outbound messages from WhatsApp, Telegram, Facebook, Instagram and manual sources."
                : "Входящие и исходящие сообщения из WhatsApp, Telegram, Facebook, Instagram и ручных источников."}
            </p>
          </div>
        </div>
        <div className="panel-body">
          <CustomerConversation customerId={customer.id} customerName={customer.full_name} initialMessages={messages} locale={locale} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Message customer" : "Написать клиенту"}</h2>
            <p className="sub">
              {locale === "en"
                ? "CRM sends via the dedicated Epicenter WhatsApp/Telegram gateways."
                : "CRM отправляет через отдельные шлюзы Epicenter WhatsApp/Telegram."}
            </p>
          </div>
        </div>
        <div className="panel-body">
          <MessageComposeForm
            action={sendCustomerMessageAction}
            locale={locale}
            entityType="customer"
            entityId={customer.id}
            recipientLabel={customer.whatsapp || customer.phone || customer.telegram_username || ""}
            defaultChannel={customer.whatsapp || customer.phone ? "whatsapp" : "telegram"}
            whatsappEnabled={Boolean(customer.whatsapp || customer.phone)}
            telegramEnabled={Boolean(customer.telegram_username)}
            whatsappLabel={customer.whatsapp || customer.phone || ""}
            telegramLabel={customer.telegram_username || ""}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>{locale === "en" ? "Bookings history" : "История броней"}</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{locale === "en" ? "Booking" : "Бронь"}</th><th>{locale === "en" ? "Vehicle" : "Автомобиль"}</th><th>{locale === "en" ? "Dates" : "Даты"}</th><th>{locale === "en" ? "Status" : "Статус"}</th><th>{locale === "en" ? "Total" : "Сумма"}</th></tr></thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td><a href={`/bookings/${booking.id}`}>{booking.booking_number}</a></td>
                  <td><a href={`/fleet/${booking.vehicle_id}`}>{booking.vehicle}</a></td>
                  <td>{booking.start_date} - {booking.end_date}</td>
                  <td>{bookingStatusBadge(booking.status, locale)}</td>
                  <td>{money(booking.grand_total)}</td>
                </tr>
              ))}
              {bookings.length === 0 ? <tr><td colSpan={5}>{locale === "en" ? "No bookings yet" : "Броней пока нет"}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Book a vehicle for this customer" : "Забронировать авто этому клиенту"}</h2>
            <p className="sub">{locale === "en" ? "Choose a vehicle and create the booking from the customer card." : "Выберите автомобиль и создайте бронь из карточки клиента."}</p>
          </div>
        </div>
        <div className="panel-body">
          <BookingForm
            action={createBookingAction}
            tenantId={user.tenantId}
            locale={locale}
            customers={data.customers}
            vehicles={data.vehicles}
            fixedCustomerId={customer.id}
            defaultDailyRate={390}
            defaultMonthlyRate={11700}
            defaultDeposit={5000}
            submitLabel={locale === "en" ? "Create booking" : "Создать бронь"}
          />
        </div>
      </section>
    </SimpleModulePage>
  );
}
