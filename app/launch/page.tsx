import { redirect } from "next/navigation";
import { PageFrame } from "@/app/components/CrmPages";
import { getLocale } from "@/lib/i18n";
import { getCurrentUserContext, getLaunchReadinessData, type LaunchReadinessIssue } from "@/lib/repository";

function readinessBadge(count: number) {
  return count > 0 ? <span className="badge danger">blocked</span> : <span className="badge ok">ready</span>;
}

function issueBadge(issue: LaunchReadinessIssue) {
  return <span className={`badge ${issue.severity === "critical" ? "danger" : "warn"}`}>{issue.severity}</span>;
}

function IssueTable({
  title,
  emptyText,
  issues
}: {
  title: string;
  emptyText: string;
  issues: LaunchReadinessIssue[];
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Issue</th>
              <th>Detail</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td>{issueBadge(issue)}</td>
                <td><strong>{issue.title}</strong><br /><span className="muted">{issue.type}</span></td>
                <td>{issue.detail}</td>
                <td><a className="button" href={issue.href}>Open</a></td>
              </tr>
            ))}
            {issues.length === 0 ? <tr><td colSpan={4}>{emptyText}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoleSummary({ roles }: { roles: Record<string, number> }) {
  const order = ["owner", "manager", "operator", "accountant", "marketer", "partner_view"];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {order.map((role) => (
        <span className={`badge ${roles[role] ? "info" : "muted"}`} key={role}>{role}: {roles[role] ?? 0}</span>
      ))}
    </div>
  );
}

function integrationBadge(status: "ok" | "warning" | "critical") {
  return <span className={`badge ${status === "ok" ? "ok" : status === "critical" ? "danger" : "warn"}`}>{status}</span>;
}

function agendaBadge(kind: "handover" | "return" | "maintenance", isEnglish: boolean) {
  const label = kind === "handover"
    ? (isEnglish ? "handover" : "выдача")
    : kind === "return"
      ? (isEnglish ? "return" : "возврат")
      : (isEnglish ? "maintenance" : "ремонт");
  const tone = kind === "handover" ? "info" : kind === "return" ? "warn" : "danger";
  return <span className={`badge ${tone}`}>{label}</span>;
}

function shiftStepLink(step: "start" | "booking" | "handover" | "maintenance" | "end", isEnglish: boolean) {
  const links = {
    start: { href: "/launch", label: isEnglish ? "Open launch" : "Открыть запуск" },
    booking: { href: "/bookings", label: isEnglish ? "Check bookings" : "Проверить брони" },
    handover: { href: "/handover", label: isEnglish ? "Open handover" : "Открыть выдачу" },
    maintenance: { href: "/maintenance", label: isEnglish ? "Open maintenance" : "Открыть ремонт" },
    end: { href: "/finance", label: isEnglish ? "Check finance" : "Проверить финансы" }
  };
  const item = links[step];
  return <a className="button" href={item.href}>{item.label}</a>;
}

export default async function Page() {
  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    redirect("/login");
  }

  const locale = await getLocale();
  const readiness = await getLaunchReadinessData();
  const isEnglish = locale === "en";
  const ready = readiness.counts.critical === 0;
  const firstFixes = readiness.critical.slice(0, 6);

  return (
    <PageFrame
      title={isEnglish ? "Launch readiness" : "Готовность к запуску"}
      subtitle={isEnglish ? "Operational blockers for rentals, bookings, fleet status and maintenance." : "Операционные блокеры по арендам, броням, статусам машин и ремонту."}
      locale={locale}
      activePath="/launch"
      action={<a className="primary" href="/bookings">{isEnglish ? "Bookings" : "Брони"}</a>}
    >
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{isEnglish ? "Readiness status" : "Статус готовности"}</h2>
            <p className="sub">
              {isEnglish
                ? `Generated ${new Date(readiness.generatedAt).toLocaleString("en-GB")}`
                : `Сформировано ${new Date(readiness.generatedAt).toLocaleString("ru-RU")}`}
            </p>
          </div>
          {readinessBadge(readiness.counts.critical)}
        </div>
        <div className="dashboard-grid">
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Critical blockers" : "Критические блокеры"}</div>
            <div className="metric-value">{readiness.counts.critical}</div>
            <div className="muted">{ready ? (isEnglish ? "No launch blockers" : "Блокеров запуска нет") : (isEnglish ? "Fix before launch" : "Исправить до запуска")}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Warnings" : "Предупреждения"}</div>
            <div className="metric-value">{readiness.counts.warnings}</div>
            <div className="muted">{isEnglish ? "Review with operations" : "Проверить с операторами"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Blocking bookings" : "Активные блокирующие брони"}</div>
            <div className="metric-value">{readiness.counts.bookings}</div>
            <div className="muted">{isEnglish ? "Confirmed/rented/returning" : "Подтверждены/в аренде/возврат"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Active maintenance" : "Активное ТО/ремонт"}</div>
            <div className="metric-value">{readiness.counts.maintenance}</div>
            <div className="muted">{isEnglish ? "Scheduled or in progress" : "Запланировано или в работе"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Active users" : "Активные пользователи"}</div>
            <div className="metric-value">{readiness.counts.activeUsers}</div>
            <RoleSummary roles={readiness.activeRoles} />
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Integrations" : "Интеграции"}</div>
            <div className="metric-value">{readiness.counts.integrationsOk}/{readiness.integrations.length}</div>
            <div className="muted">
              {readiness.counts.integrationsCritical > 0
                ? (isEnglish ? "Critical setup missing" : "Есть критичные настройки")
                : readiness.counts.integrationsWarnings > 0
                  ? (isEnglish ? "Warnings to review" : "Есть предупреждения")
                  : (isEnglish ? "Configured" : "Настроены")}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Finance checks" : "Финансовые проверки"}</div>
            <div className="metric-value">{readiness.counts.financeWarnings}</div>
            <div className="muted">{isEnglish ? "Owner controls now, accountant later" : "Сейчас ведет owner, accountant подключим позже"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Handover documents" : "Документы к выдаче"}</div>
            <div className="metric-value">{readiness.counts.documentWarnings}</div>
            <div className="muted">{isEnglish ? "Passport, IDP/license and evidence photos" : "Паспорт, IDP/права и фотофиксация"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Return checks" : "Проверки возврата"}</div>
            <div className="metric-value">{readiness.counts.returnWarnings}</div>
            <div className="muted">{isEnglish ? "Return photos, video and deposit status" : "Фото, видео и статус депозита"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Insurance" : "Страховки"}</div>
            <div className="metric-value">{readiness.counts.insuranceWarnings}</div>
            <div className="muted">{isEnglish ? "Coverage for bookings and renewals" : "Покрытие броней и продления"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Road tax" : "Por Ror Bor / налог"}</div>
            <div className="metric-value">{readiness.counts.taxWarnings}</div>
            <div className="muted">{isEnglish ? "Road tax and inspection dates" : "Налог и техпроверка"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Vehicle status" : "Статусы машин"}</div>
            <div className="metric-value">{readiness.counts.statusWarnings}</div>
            <div className="muted">{isEnglish ? "Fleet status vs bookings/maintenance" : "Парк против броней/ремонтов"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Customer duplicates" : "Дубли клиентов"}</div>
            <div className="metric-value">{readiness.counts.customerWarnings}</div>
            <div className="muted">{isEnglish ? "Phone, WhatsApp, Telegram, passport" : "Телефон, WhatsApp, Telegram, паспорт"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Leads" : "Лиды"}</div>
            <div className="metric-value">{readiness.counts.leadWarnings}</div>
            <div className="muted">{isEnglish ? "Contact, next action and reminder" : "Контакт, следующий шаг и reminder"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Messages" : "Сообщения"}</div>
            <div className="metric-value">{readiness.counts.messageWarnings}</div>
            <div className="muted">{isEnglish ? "Inbound messages linked to CRM" : "Привязка входящих к CRM"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Tasks" : "Задачи"}</div>
            <div className="metric-value">{readiness.counts.taskWarnings}</div>
            <div className="muted">{isEnglish ? "Assignee, due date and priority" : "Ответственный, срок и приоритет"}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{isEnglish ? "Public catalog" : "Публичный каталог"}</div>
            <div className="metric-value">{readiness.counts.publicCatalogWarnings}</div>
            <div className="muted">{isEnglish ? "Photos, prices, deposit and descriptions" : "Фото, цены, депозит и описания"}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{isEnglish ? "Fix first" : "Первым делом исправить"}</h2>
            <p className="sub">
              {isEnglish
                ? "Only real stop-factors are shown here. Insurance, Por Ror Bor and road tax renewals are reminders below."
                : "Здесь только реальные стоп-факторы. Страховка, Por Ror Bor и налог — это напоминания ниже, не блокеры."}
            </p>
          </div>
          <span className={ready ? "badge ok" : "badge danger"}>{ready ? (isEnglish ? "go" : "можно работать") : (isEnglish ? "no-go" : "стоп")}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{isEnglish ? "Priority" : "Приоритет"}</th>
                <th>{isEnglish ? "What" : "Что"}</th>
                <th>{isEnglish ? "Detail" : "Деталь"}</th>
                <th>{isEnglish ? "Open" : "Открыть"}</th>
              </tr>
            </thead>
            <tbody>
              {firstFixes.map((issue) => (
                <tr key={`first-${issue.id}`}>
                  <td>{issueBadge(issue)}</td>
                  <td><strong>{issue.title}</strong><br /><span className="muted">{issue.type}</span></td>
                  <td>{issue.detail}</td>
                  <td><a className="button" href={issue.href}>{isEnglish ? "Fix" : "Исправить"}</a></td>
                </tr>
              ))}
              {firstFixes.length === 0 ? (
                <tr><td colSpan={4}>{isEnglish ? "No launch blockers. Continue with the 7-day operations queue." : "Блокеров запуска нет. Дальше смотрим операции на 7 дней."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{isEnglish ? "7-day operations" : "Операции на 7 дней"}</h2>
            <p className="sub">
              {isEnglish
                ? "Upcoming handovers, returns and maintenance blocks from the same booking calendar."
                : "Ближайшие выдачи, возвраты и ремонты из единого календаря занятости машин."}
            </p>
          </div>
          <span className="badge info">{readiness.operationalAgenda.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{isEnglish ? "Date" : "Дата"}</th>
                <th>{isEnglish ? "Type" : "Тип"}</th>
                <th>{isEnglish ? "Operation" : "Операция"}</th>
                <th>{isEnglish ? "Detail" : "Деталь"}</th>
                <th>{isEnglish ? "Action" : "Действие"}</th>
              </tr>
            </thead>
            <tbody>
              {readiness.operationalAgenda.map((item) => (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td>{agendaBadge(item.kind, isEnglish)}</td>
                  <td><strong>{item.title}</strong></td>
                  <td>{item.detail}</td>
                  <td><a className="button" href={item.href}>{isEnglish ? "Open" : "Открыть"}</a></td>
                </tr>
              ))}
              {readiness.operationalAgenda.length === 0 ? (
                <tr><td colSpan={5}>{isEnglish ? "No operations in the next 7 days." : "Операций на ближайшие 7 дней нет."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{isEnglish ? "Integration readiness" : "Готовность интеграций"}</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{isEnglish ? "Status" : "Статус"}</th>
                <th>{isEnglish ? "Integration" : "Интеграция"}</th>
                <th>{isEnglish ? "Detail" : "Деталь"}</th>
              </tr>
            </thead>
            <tbody>
              {readiness.integrations.map((integration) => (
                <tr key={integration.id}>
                  <td>{integrationBadge(integration.status)}</td>
                  <td><strong>{integration.label}</strong></td>
                  <td>{integration.detail}</td>
                </tr>
              ))}
              {readiness.integrations.length === 0 ? <tr><td colSpan={3}>{isEnglish ? "No integration checks available." : "Проверки интеграций недоступны."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{isEnglish ? "Daily launch checklist" : "Ежедневный чеклист запуска"}</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{isEnglish ? "Step" : "Шаг"}</th>
                <th>{isEnglish ? "Owner" : "Ответственный"}</th>
                <th>{isEnglish ? "Required action" : "Что сделать"}</th>
                <th>{isEnglish ? "Screen" : "Экран"}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{isEnglish ? "Start shift" : "Начало смены"}</td>
                <td>manager / operator</td>
                <td>{isEnglish ? "Open this page and clear critical blockers before creating new bookings." : "Открыть эту страницу и убрать критические блокеры до создания новых броней."}</td>
                <td>{shiftStepLink("start", isEnglish)}</td>
              </tr>
              <tr>
                <td>{isEnglish ? "Before booking" : "Перед бронью"}</td>
                <td>manager</td>
                <td>{isEnglish ? "Use CRM availability only. Do not promise a car from chat memory or screenshots." : "Проверять доступность только в CRM. Не обещать машину по памяти из чата или скриншотов."}</td>
                <td>{shiftStepLink("booking", isEnglish)}</td>
              </tr>
              <tr>
                <td>{isEnglish ? "Before handover" : "Перед выдачей"}</td>
                <td>operator</td>
                <td>{isEnglish ? "Check IDP / Thai license, passport validity, payment and deposit status in the booking card." : "Проверить IDP / тайские права, паспорт, оплату и депозит в карточке брони."}</td>
                <td>{shiftStepLink("handover", isEnglish)}</td>
              </tr>
              <tr>
                <td>{isEnglish ? "Before maintenance" : "Перед ремонтом"}</td>
                <td>operator / manager</td>
                <td>{isEnglish ? "Enter unavailable dates. CRM will block repair dates that overlap active bookings." : "Указать даты недоступности. CRM заблокирует ремонт, если он пересекается с бронью."}</td>
                <td>{shiftStepLink("maintenance", isEnglish)}</td>
              </tr>
              <tr>
                <td>{isEnglish ? "End shift" : "Конец смены"}</td>
                <td>manager</td>
                <td>{isEnglish ? "Review overdue returns, open leads, unassigned bookings and payments before handoff." : "Проверить просроченные возвраты, открытые лиды, брони без авто и платежи перед передачей смены."}</td>
                <td>{shiftStepLink("end", isEnglish)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <IssueTable
        title={isEnglish ? "Critical blockers" : "Критические блокеры"}
        emptyText={isEnglish ? "No critical launch blockers found." : "Критических блокеров запуска не найдено."}
        issues={readiness.critical}
      />

      <IssueTable
        title={isEnglish ? "Warnings" : "Предупреждения"}
        emptyText={isEnglish ? "No warnings found." : "Предупреждений не найдено."}
        issues={readiness.warnings}
      />
    </PageFrame>
  );
}
