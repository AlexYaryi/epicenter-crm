import { notFound } from "next/navigation";
import { bookingStatusBadge, getProtectedCrmPage, money, PageFrame, rentalStatusBadge, sourceLabel, statusBadge } from "@/app/components/CrmPages";
import { BookingForm } from "@/app/components/BookingForm";
import { BookingRowActions } from "@/app/components/BookingRowActions";
import { CustomerConversation } from "@/app/components/CustomerConversation";
import { LeadCustomerLinkForm } from "@/app/components/LeadCustomerLinkForm";
import { LeadProgressForm } from "@/app/components/LeadProgressForm";
import { MessageComposeForm } from "@/app/components/MessageComposeForm";
import { cancelBookingAction, createBookingAction, createCustomerFromLeadAction, deleteBookingAction, sendCustomerMessageAction, sendLeadMessageAction, updateLeadStageAction } from "@/lib/actions";
import { leadStageLabel } from "@/lib/lead-stages";
import { getCustomerMessages, getLeadMessages } from "@/lib/repository";
import { formatDisplayDate } from "@/lib/i18n";

function extractDatesFromText(text: string): { startDate?: string; endDate?: string } {
  if (!text) return {};
  
  // 1. Look for YYYY-MM-DD patterns
  const yyyymmddRegex = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g;
  const matches = [...text.matchAll(yyyymmddRegex)];
  if (matches.length >= 2) {
    return {
      startDate: `${matches[0][1]}-${matches[0][2].padStart(2, '0')}-${matches[0][3].padStart(2, '0')}`,
      endDate: `${matches[1][1]}-${matches[1][2].padStart(2, '0')}-${matches[1][3].padStart(2, '0')}`
    };
  }

  // 2. Look for DD.MM.YYYY or DD.MM.YY or DD.MM patterns
  const ddmmRegex = /(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g;
  const ddmmMatches = [...text.matchAll(ddmmRegex)];
  if (ddmmMatches.length >= 2) {
    const currentYear = new Date().getFullYear();
    const parseMatch = (m: RegExpMatchArray) => {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      let year = String(currentYear);
      if (m[3]) {
        year = m[3].length === 2 ? `20${m[3]}` : m[3];
      }
      return `${year}-${month}-${day}`;
    };
    return {
      startDate: parseMatch(ddmmMatches[0]),
      endDate: parseMatch(ddmmMatches[1])
    };
  }

  // 3. Look for Russian month keywords: e.g., "с 10 мая по 25 мая"
  const ruMonths = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const ruMonthsFull = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const ruMonthRegex = /(\d{1,2})\s*([а-яёA-Za-z]+)/gi;
  const ruMatches = [...text.matchAll(ruMonthRegex)];
  const resolvedDates: string[] = [];
  const currentYear = new Date().getFullYear();
  for (const m of ruMatches) {
    const day = m[1].padStart(2, '0');
    const monthWord = m[2].toLowerCase();
    let monthIdx = -1;
    for (let i = 0; i < 12; i++) {
      if (monthWord.startsWith(ruMonths[i]) || monthWord.startsWith(ruMonthsFull[i].slice(0, 3))) {
        monthIdx = i;
        break;
      }
    }
    if (monthIdx !== -1) {
      const month = String(monthIdx + 1).padStart(2, '0');
      resolvedDates.push(`${currentYear}-${month}-${day}`);
    }
  }

  if (resolvedDates.length >= 2) {
    return {
      startDate: resolvedDates[0],
      endDate: resolvedDates[1]
    };
  } else if (resolvedDates.length === 1) {
    return {
      startDate: resolvedDates[0]
    };
  }

  return {};
}

type PageParams = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageParams) {
  const { id } = await params;
  const { data, locale, user } = await getProtectedCrmPage();
  const lead = data.leads.find((item) => item.id === id);

  if (!lead) {
    notFound();
  }

  const parsedDates = extractDatesFromText(lead.note);

  const normalizeDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const leadDigits = normalizeDigits(lead.phone);
  const customer = lead.customer_id
    ? data.customers.find((item) => item.id === lead.customer_id)
    : data.customers.find((item) => {
        if (!leadDigits) return false;
        const phoneDigits = normalizeDigits(item.whatsapp || item.phone);
        if (!phoneDigits) return false;
        if (phoneDigits.length < 7 || leadDigits.length < 7) return false;
        return phoneDigits === leadDigits || phoneDigits.endsWith(leadDigits) || leadDigits.endsWith(phoneDigits);
      });
  const leadMessages = await getLeadMessages(lead.id, user.tenantId);
  const customerMessages = customer ? await getCustomerMessages(customer.id, user.tenantId) : [];
  const messages = Array.from(
    new Map([...leadMessages, ...customerMessages].map((message) => [message.id, message])).values()
  ).sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  const leadContact = lead.phone || lead.telegram_username || lead.contact_handle || customer?.whatsapp || customer?.phone || customer?.telegram_username || "";
  const leadUsesTelegram = lead.channel.startsWith("telegram") || Boolean(lead.telegram_username);
  const leadUsesWhatsApp = lead.channel === "whatsapp" || Boolean(lead.phone) || (!leadUsesTelegram && Boolean(lead.contact_handle));

  const hasLineMsg = messages.find(m => m.channel === "line");
  const hasInstaMsg = messages.find(m => m.channel === "instagram");
  const hasTiktokMsg = messages.find(m => m.channel === "tiktok");

  const leadUsesLine = lead.channel === "line" || Boolean(hasLineMsg);
  const leadUsesInstagram = lead.channel === "instagram" || Boolean(hasInstaMsg);
  const leadUsesTiktok = lead.channel === "tiktok" || Boolean(hasTiktokMsg);

  const lineHandle = customer ? (customer.source === "line" ? customer.source_detail : hasLineMsg?.contact_handle) : (lead.channel === "line" ? lead.contact_handle : hasLineMsg?.contact_handle);
  const instagramHandle = customer ? (customer.source === "instagram" ? customer.source_detail : hasInstaMsg?.contact_handle) : (lead.channel === "instagram" ? lead.contact_handle : hasInstaMsg?.contact_handle);
  const tiktokHandle = customer ? (customer.source === "tiktok" ? customer.source_detail : hasTiktokMsg?.contact_handle) : (lead.channel === "tiktok" ? lead.contact_handle : hasTiktokMsg?.contact_handle);

  const leadBookings = data.bookings.filter((booking) => booking.lead_id === lead.id || (customer ? booking.customer_id === customer.id : false));
  const canBook = Boolean(customer);
  const reminderText = lead.reminder_at
    ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lead.reminder_at))
    : locale === "en" ? "No reminder" : "Нет напоминания";

  return (
    <PageFrame
      title={lead.customer_name}
      subtitle={locale === "en" ? "Lead card: conversation, next action, status and sales pipeline." : "Карточка лида: запрос, следующий шаг, статус и движение по воронке продаж."}
      locale={locale}
      activePath="/leads"
      action={<a className="button" href="/leads">{locale === "en" ? "Back to pipeline" : "Назад в воронку"}</a>}
    >
      <section className="grid-3">
        <div className="card">
          <div className="metric-label">{locale === "en" ? "Current stage" : "Текущий этап"}</div>
          <div>{statusBadge(leadStageLabel(lead.stage, locale))}</div>
        </div>
        <div className="card">
          <div className="metric-label">{locale === "en" ? "Source" : "Источник"}</div>
          <div className="metric-value">{sourceLabel(lead.channel, locale)}</div>
        </div>
        <div className="card">
          <div className="metric-label">Score</div>
          <div className="metric-value">{lead.score}</div>
        </div>
        <div className="card">
          <div className="metric-label">{locale === "en" ? "Next reminder" : "Следующее напоминание"}</div>
          <div className="lead-kpi-text">{reminderText}</div>
        </div>
        <div className="card">
          <div className="metric-label">{locale === "en" ? "Messages" : "Сообщения"}</div>
          <div className="metric-value">{messages.length}</div>
        </div>
        <div className="card">
          <div className="metric-label">{locale === "en" ? "Bookings" : "Брони"}</div>
          <div className="metric-value">{leadBookings.length}</div>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel" id="lead-request">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Client request" : "Запрос клиента"}</h2>
              <p className="sub">{locale === "en" ? "What the customer wrote and what the operator should use for the offer." : "Что написал клиент и на что опираться оператору при предложении."}</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="task">
              <strong>{locale === "en" ? "Customer" : "Клиент"}</strong>
              {customer ? (
                <a className="button" href={`/customers/${customer.id}`}>{locale === "en" ? "Open customer card" : "Открыть карточку клиента"}</a>
              ) : (
                <span className="badge warn">{locale === "en" ? "not linked yet" : "клиент еще не создан"}</span>
              )}
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Phone / contact" : "Телефон / контакт"}</strong>
              <span>{leadContact || "-"}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Source detail" : "Источник подробнее"}</strong>
              <span className="lead-detail-text">{lead.source_detail || "-"}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Request text" : "Текст запроса"}</strong>
              <span className="lead-detail-text">{lead.note || "-"}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Category" : "Категория авто"}</strong>
              <span>{lead.category}</span>
            </div>
            <div className="task">
              <strong>{locale === "en" ? "Tags" : "Теги"}</strong>
              <span>{lead.tags.length ? lead.tags.join(", ") : "-"}</span>
            </div>
          </div>
        </div>

        <div className="panel" id="lead-progress">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Move through pipeline" : "Вести по воронке"}</h2>
              <p className="sub">{locale === "en" ? "Set the next stage, reminder and concrete next action." : "Поставьте следующий этап, напоминание и конкретное следующее действие."}</p>
            </div>
          </div>
          <div className="panel-body">
            <LeadProgressForm action={updateLeadStageAction} leadId={lead.id} currentStage={lead.stage} nextAction={lead.next_action} reminderAt={lead.reminder_at} locale={locale} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Sales workspace" : "Рабочее место по лиду"}</h2>
            <p className="sub">
              {locale === "en"
                ? "The operator can process the lead end to end without leaving this card."
                : "Оператор может обработать лид полностью, не выходя из этой карточки."}
            </p>
          </div>
        </div>
        <div className="panel-body lead-workspace">
          <a className="lead-workspace-step" href="#lead-conversation"><strong>1</strong><span>{locale === "en" ? "Read conversation" : "Прочитать переписку"}</span></a>
          <a className="lead-workspace-step" href="#lead-reply"><strong>2</strong><span>{locale === "en" ? "Reply" : "Ответить"}</span></a>
          <a className="lead-workspace-step" href="#lead-progress"><strong>3</strong><span>{locale === "en" ? "Set next step" : "Поставить следующий шаг"}</span></a>
          <a className={canBook ? "lead-workspace-step" : "lead-workspace-step disabled"} href={canBook ? "#lead-booking" : "#lead-customer"}>
            <strong>4</strong>
            <span>{canBook ? (locale === "en" ? "Create booking" : "Создать бронь") : (locale === "en" ? "Create customer first" : "Сначала создать клиента")}</span>
          </a>
        </div>
      </section>

      {!customer ? (
        <section className="panel" id="lead-customer">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Create customer from this lead" : "Создать клиента из лида"}</h2>
              <p className="sub">{locale === "en" ? "After linking, messages and booking tools become available here." : "После привязки здесь появятся переписка, отправка сообщений и создание брони."}</p>
            </div>
          </div>
          <div className="panel-body">
            <LeadCustomerLinkForm
              action={createCustomerFromLeadAction}
              tenantId={user.tenantId}
              leadId={lead.id}
              source={lead.channel}
              customers={data.customers}
              defaultName={lead.customer_name}
              defaultPhone={lead.phone || (leadUsesWhatsApp ? lead.contact_handle : null)}
              defaultTelegram={lead.telegram_username || (leadUsesTelegram ? lead.contact_handle : null)}
              locale={locale}
            />
          </div>
        </section>
      ) : null}

      <section className="panel" id="lead-conversation">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Conversation" : "Переписка"}</h2>
            <p className="sub">{locale === "en" ? "Full inbound and outbound history connected to this lead/customer." : "Полная история входящих и исходящих сообщений по этому лиду/клиенту."}</p>
          </div>
        </div>
        <div className="panel-body">
          <CustomerConversation
            customerId={customer?.id ?? lead.id}
            customerName={customer?.full_name ?? lead.customer_name}
            initialMessages={messages}
            locale={locale}
            messageEndpoint={`/api/leads/${lead.id}/messages`}
          />
        </div>
      </section>

      <section className="panel" id="lead-reply">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Reply to lead" : "Ответить лиду"}</h2>
            <p className="sub">
              {customer
                ? (locale === "en" ? "Send directly through the linked customer card." : "Отправка напрямую через привязанную карточку клиента.")
                : (locale === "en" ? "Send before the lead is converted into a customer. CRM will use the lead phone or latest inbound contact." : "Можно отвечать до создания клиента. CRM возьмет телефон лида или последний входящий контакт.")}
            </p>
          </div>
        </div>
        <div className="panel-body">
          <MessageComposeForm
            action={customer ? sendCustomerMessageAction : sendLeadMessageAction}
            locale={locale}
            entityType={customer ? "customer" : "lead"}
            entityId={customer?.id ?? lead.id}
            recipientLabel={
              customer
                ? customer.whatsapp || customer.phone || customer.telegram_username || lineHandle || instagramHandle || tiktokHandle || ""
                : leadContact || lineHandle || instagramHandle || tiktokHandle || (locale === "en" ? "Latest inbound contact" : "Последний входящий контакт")
            }
            defaultChannel={
              customer
                ? (customer.whatsapp || customer.phone
                  ? "whatsapp"
                  : customer.telegram_username
                  ? "telegram"
                  : lineHandle
                  ? "line"
                  : instagramHandle
                  ? "instagram"
                  : tiktokHandle
                  ? "tiktok"
                  : "whatsapp")
                : (leadUsesTelegram
                  ? "telegram"
                  : leadUsesLine
                  ? "line"
                  : leadUsesInstagram
                  ? "instagram"
                  : leadUsesTiktok
                  ? "tiktok"
                  : "whatsapp")
            }
            whatsappEnabled={customer ? Boolean(customer.whatsapp || customer.phone) : leadUsesWhatsApp}
            telegramEnabled={customer ? Boolean(customer.telegram_username) : Boolean(lead.telegram_username || lead.contact_handle || lead.channel.startsWith("telegram"))}
            lineEnabled={customer ? Boolean(lineHandle) : leadUsesLine}
            instagramEnabled={customer ? Boolean(instagramHandle) : leadUsesInstagram}
            tiktokEnabled={customer ? Boolean(tiktokHandle) : leadUsesTiktok}
            whatsappLabel={customer?.whatsapp || customer?.phone || lead.phone || ""}
            telegramLabel={customer?.telegram_username || lead.telegram_username || lead.contact_handle || ""}
            lineLabel={lineHandle || ""}
            instagramLabel={instagramHandle || ""}
            tiktokLabel={tiktokHandle || ""}
            placeholder={locale === "en" ? "Write the next sales reply..." : "Напишите следующий ответ клиенту..."}
          />
        </div>
      </section>

      {customer ? (
        <section className="panel" id="lead-booking">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Reserve or rent a vehicle" : "Забронировать или сдать авто"}</h2>
              <p className="sub">{locale === "en" ? "Create a booking from this lead. The lead will move to Booked automatically." : "Создайте бронь из лида. Лид автоматически перейдет в этап «Забронировано»."}</p>
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
              fixedLeadId={lead.id}
              defaultDailyRate={390}
              defaultMonthlyRate={11700}
              defaultDeposit={5000}
              defaultStartDate={parsedDates.startDate}
              defaultEndDate={parsedDates.endDate}
              defaultVehicleCategory={lead.category}
              existingBookings={data.bookings}
              submitLabel={locale === "en" ? "Create booking from lead" : "Создать бронь из лида"}
            />
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Bookings from this lead" : "Брони из этого лида"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Linked reservations and active rentals are visible here after saving."
                : "Связанные брони и текущие аренды видны здесь сразу после сохранения."}
            </p>
          </div>
          <span className="badge info">{leadBookings.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{locale === "en" ? "Booking" : "Бронь"}</th>
                <th>{locale === "en" ? "Vehicle" : "Автомобиль"}</th>
                <th>{locale === "en" ? "Dates" : "Даты"}</th>
                <th>{locale === "en" ? "Status" : "Статус"}</th>
                <th>{locale === "en" ? "Total" : "Сумма"}</th>
                <th>{locale === "en" ? "Actions" : "Действия"}</th>
              </tr>
            </thead>
            <tbody>
              {leadBookings.map((booking) => (
                <tr key={booking.id}>
                  <td><a href={`/bookings/${booking.id}`}>{booking.booking_number}</a></td>
                  <td>{booking.vehicle_id ? <a href={`/fleet/${booking.vehicle_id}`}>{booking.vehicle}</a> : booking.vehicle}</td>
                  <td>{formatDisplayDate(booking.start_date)} - {formatDisplayDate(booking.end_date)}</td>
                  <td>
                    <span className="badge-row">
                      {bookingStatusBadge(booking.status, locale)}
                      {rentalStatusBadge(booking.rental_status, locale)}
                    </span>
                  </td>
                  <td>{money(booking.grand_total)}</td>
                  <td>
                    <BookingRowActions
                      bookingId={booking.id}
                      bookingStatus={booking.status}
                      canDelete={["owner", "manager"].includes(user.role)}
                      locale={locale}
                      cancelAction={cancelBookingAction}
                      deleteAction={deleteBookingAction}
                    />
                  </td>
                </tr>
              ))}
              {leadBookings.length === 0 ? <tr><td colSpan={6}>{locale === "en" ? "No bookings yet" : "Броней пока нет"}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </PageFrame>
  );
}
