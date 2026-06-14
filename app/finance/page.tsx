import { redirect } from "next/navigation";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { getProtectedCrmPage, money, SimpleModulePage, statusBadge } from "@/app/components/CrmPages";
import { recalculateAllCustomerMetricsAction, updateRecommendationStatusAction } from "@/lib/actions";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  if (user.role !== "owner" && user.role !== "accountant") {
    redirect("/");
  }

  const activeBookingStatuses = new Set(["confirmed", "paid_deposit", "handed_over", "active", "returning"]);
  const activeRentalStatuses = new Set(["handed_over", "active", "returning"]);
  const activeFinancialBookings = data.bookings.filter((booking) =>
    activeBookingStatuses.has(booking.status) || activeRentalStatuses.has(booking.rental_status)
  );
  const paymentAttention = activeFinancialBookings.filter((booking) => booking.payment_status !== "fully_paid");
  const depositToTake = activeFinancialBookings.filter((booking) =>
    Number(booking.deposit_amount ?? 0) > 0 &&
    !["held", "fully_returned", "forfeited"].includes(String(booking.deposit_status ?? "not_taken"))
  );
  const depositToClose = data.bookings.filter((booking) =>
    Number(booking.deposit_amount ?? 0) > 0 &&
    (booking.status === "completed" || booking.rental_status === "returned") &&
    ["held", "partially_returned"].includes(String(booking.deposit_status ?? "not_taken"))
  );
  const ownerFinanceQueue = [
    ...paymentAttention.map((booking) => ({ kind: locale === "en" ? "Payment" : "Оплата", booking })),
    ...depositToTake.map((booking) => ({ kind: locale === "en" ? "Take deposit" : "Взять депозит", booking })),
    ...depositToClose.map((booking) => ({ kind: locale === "en" ? "Close deposit" : "Закрыть депозит", booking }))
  ].slice(0, 25);
  const amountInPaymentAttention = paymentAttention.reduce((sum, booking) => sum + Number(booking.grand_total ?? 0), 0);
  const amountInDepositAttention = [...depositToTake, ...depositToClose].reduce((sum, booking) => sum + Number(booking.deposit_amount ?? 0), 0);

  return (
    <SimpleModulePage
      title={locale === "en" ? "Finance / ROI" : "Финансы / ROI"}
      subtitle={locale === "en" ? "Strategic module for owner/accountant: payback, RevPAD, ROI and recommendations." : "Стратегический модуль для owner/accountant: payback, RevPAD, ROI и рекомендации."}
      locale={locale}
      activePath="/finance"
    >
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Owner daily finance control" : "Ежедневный финансовый контроль owner"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Until accountant is connected, owner checks rental payment, deposit intake and deposit return here every day."
                : "Пока accountant не подключен, owner каждый день проверяет здесь оплату аренды, взятие депозита и возврат депозита."}
            </p>
          </div>
          <span className={ownerFinanceQueue.length ? "badge warn" : "badge ok"}>{ownerFinanceQueue.length}</span>
        </div>
        <div className="dashboard-grid">
          <div className="metric-card">
            <div className="metric-label">{locale === "en" ? "Payment attention" : "Проверить оплаты"}</div>
            <div className="metric-value">{paymentAttention.length}</div>
            <div className="muted">{money(amountInPaymentAttention)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{locale === "en" ? "Deposits to take" : "Депозиты взять"}</div>
            <div className="metric-value">{depositToTake.length}</div>
            <div className="muted">{money(depositToTake.reduce((sum, booking) => sum + Number(booking.deposit_amount ?? 0), 0))}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{locale === "en" ? "Deposits to close" : "Депозиты закрыть"}</div>
            <div className="metric-value">{depositToClose.length}</div>
            <div className="muted">{money(depositToClose.reduce((sum, booking) => sum + Number(booking.deposit_amount ?? 0), 0))}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">{locale === "en" ? "Deposit exposure" : "Сумма депозитов в контроле"}</div>
            <div className="metric-value">{money(amountInDepositAttention)}</div>
            <div className="muted">{locale === "en" ? "not accountant yet" : "пока без accountant"}</div>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{locale === "en" ? "Action" : "Действие"}</th>
                <th>{locale === "en" ? "Booking" : "Бронь"}</th>
                <th>{locale === "en" ? "Customer" : "Клиент"}</th>
                <th>{locale === "en" ? "Vehicle" : "Машина"}</th>
                <th>{locale === "en" ? "Payment" : "Оплата"}</th>
                <th>{locale === "en" ? "Deposit" : "Депозит"}</th>
              </tr>
            </thead>
            <tbody>
              {ownerFinanceQueue.map(({ kind, booking }, index) => (
                <tr key={`${kind}-${booking.id}-${index}`}>
                  <td><span className="badge warn">{kind}</span></td>
                  <td><a href={`/bookings/${booking.id}`}><strong>{booking.booking_number}</strong></a><br /><span className="muted">{booking.start_date} - {booking.end_date}</span></td>
                  <td>{booking.customer_id ? <a href={`/customers/${booking.customer_id}`}>{booking.customer_name}</a> : booking.customer_name}</td>
                  <td>{booking.vehicle_id ? <a href={`/fleet/${booking.vehicle_id}`}>{booking.vehicle}</a> : booking.vehicle}</td>
                  <td>{booking.payment_status ?? "unpaid"}<br /><span className="muted">{money(booking.grand_total)}</span></td>
                  <td>{booking.deposit_status ?? "not_taken"}<br /><span className="muted">{money(booking.deposit_amount)}</span></td>
                </tr>
              ))}
              {ownerFinanceQueue.length === 0 ? (
                <tr><td colSpan={6}>{locale === "en" ? "No urgent finance items for owner." : "Срочных финансовых задач для owner нет."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Vehicle ROI" : "ROI по машинам"}</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{locale === "en" ? "Vehicle" : "Машина"}</th><th>{locale === "en" ? "Financial status" : "Фин. статус"}</th><th>Band</th><th>RevPAD</th><th>Payback</th></tr></thead>
              <tbody>
                {data.vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td><strong>{vehicle.license_plate}</strong><br /><span className="muted">{vehicle.make} {vehicle.model}</span></td>
                    <td>{statusBadge(vehicle.status_financial)}</td>
                    <td>{vehicle.performance_band}</td>
                    <td>{money(vehicle.revpad)}</td>
                    <td>{vehicle.payback_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Recommendations Inbox</h2></div>
          <div className="panel-body">
            {data.recommendations.length ? data.recommendations.map((item) => (
              <div className="task" key={item.id}>
                <strong>{item.type}</strong>
                <span className="muted">{item.reasoning}</span>
                <span>{money(item.impact_thb)}</span>
                <div className="filters">
                  <form action={updateRecommendationStatusAction}>
                    <input type="hidden" name="recommendation_id" value={item.id} />
                    <input type="hidden" name="status" value="acted_on" />
                    <input type="hidden" name="acted_on_action" value="Marked acted on from CRM" />
                    <button className="button">Acted on</button>
                  </form>
                  <form action={updateRecommendationStatusAction}>
                    <input type="hidden" name="recommendation_id" value={item.id} />
                    <input type="hidden" name="status" value="snoozed" />
                    <button className="button">Snooze 30d</button>
                  </form>
                  <form action={updateRecommendationStatusAction}>
                    <input type="hidden" name="recommendation_id" value={item.id} />
                    <input type="hidden" name="status" value="dismissed" />
                    <button className="button">Dismiss</button>
                  </form>
                </div>
              </div>
            )) : <p className="muted">{locale === "en" ? "After the weekly job, SELL / BUY / RAISE_PRICE recommendations will appear here." : "После недельного job здесь появятся рекомендации SELL / BUY / RAISE_PRICE."}</p>}
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Customer metrics" : "Метрики клиентов"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Recalculate LTV and booking counts after finance formula changes or data cleanup."
                : "Пересчитать LTV и количество аренд после изменений финансовой формулы или чистки данных."}
            </p>
          </div>
        </div>
        <div className="panel-body">
          <ActionFeedbackForm
            action={recalculateAllCustomerMetricsAction}
            className="filters"
            locale={locale}
            savingText={locale === "en" ? "Recalculating customer metrics..." : "Пересчитываю метрики клиентов..."}
            fallbackError={locale === "en" ? "Customer metrics were not recalculated." : "Метрики клиентов не пересчитаны."}
          >
            <button className="primary" type="submit">{locale === "en" ? "Recalculate customer metrics" : "Пересчитать метрики клиентов"}</button>
          </ActionFeedbackForm>
        </div>
      </section>
    </SimpleModulePage>
  );
}
