import { notFound } from "next/navigation";
import { getProtectedCrmPage, PageFrame, sourceLabel, statusBadge } from "@/app/components/CrmPages";
import { BookingForm } from "@/app/components/BookingForm";
import { CustomerConversation } from "@/app/components/CustomerConversation";
import { LeadCustomerLinkForm } from "@/app/components/LeadCustomerLinkForm";
import { LeadProgressForm } from "@/app/components/LeadProgressForm";
import { MessageComposeForm } from "@/app/components/MessageComposeForm";
import { createBookingAction, createCustomerFromLeadAction, sendCustomerMessageAction, sendLeadMessageAction, updateLeadStageAction } from "@/lib/actions";
import { leadStageLabel } from "@/lib/lead-stages";
import { getCustomerMessages, getLeadMessages } from "@/lib/repository";

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

  const normalizeDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const leadDigits = normalizeDigits(lead.phone);
  const customer = lead.customer_id
    ? data.customers.find((item) => item.id === lead.customer_id)
    : data.customers.find((item) => {
        if (leadDigits) {
          const phoneDigits = normalizeDigits(item.whatsapp || item.phone);
          return phoneDigits === leadDigits || phoneDigits.endsWith(leadDigits) || leadDigits.endsWith(phoneDigits);
        }
        return false;
      });
  const messages = customer
    ? await getCustomerMessages(customer.id, user.tenantId)
    : await getLeadMessages(lead.id, user.tenantId);
  const leadContact = lead.phone || lead.telegram_username || lead.contact_handle || customer?.whatsapp || customer?.phone || customer?.telegram_username || "";
  const leadUsesTelegram = lead.channel.startsWith("telegram") || Boolean(lead.telegram_username);
  const leadUsesWhatsApp = lead.channel === "whatsapp" || Boolean(lead.phone) || (!leadUsesTelegram && Boolean(lead.contact_handle));

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
      </section>

      <section className="grid-2">
        <div className="panel">
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

        <div className="panel">
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

      {!customer ? (
        <section className="panel">
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
              defaultName={lead.customer_name}
              defaultPhone={lead.phone || (leadUsesWhatsApp ? lead.contact_handle : null)}
              defaultTelegram={lead.telegram_username || (leadUsesTelegram ? lead.contact_handle : null)}
              locale={locale}
            />
          </div>
        </section>
      ) : null}

      <section className="panel">
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
            messageEndpoint={customer ? undefined : `/api/leads/${lead.id}/messages`}
          />
        </div>
      </section>

      <section className="panel">
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
                ? customer.whatsapp || customer.phone || customer.telegram_username || ""
                : leadContact || (locale === "en" ? "Latest inbound contact" : "Последний входящий контакт")
            }
            defaultChannel={customer ? (customer.whatsapp || customer.phone ? "whatsapp" : "telegram") : (leadUsesTelegram ? "telegram" : "whatsapp")}
            whatsappEnabled={customer ? Boolean(customer.whatsapp || customer.phone) : leadUsesWhatsApp}
            telegramEnabled={customer ? Boolean(customer.telegram_username) : Boolean(lead.telegram_username || lead.contact_handle)}
            whatsappLabel={customer?.whatsapp || customer?.phone || lead.phone || ""}
            telegramLabel={customer?.telegram_username || lead.telegram_username || lead.contact_handle || ""}
            placeholder={locale === "en" ? "Write the next sales reply..." : "Напишите следующий ответ клиенту..."}
          />
        </div>
      </section>

      {customer ? (
        <section className="panel">
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
              submitLabel={locale === "en" ? "Create booking from lead" : "Создать бронь из лида"}
            />
          </div>
        </section>
      ) : null}
    </PageFrame>
  );
}
