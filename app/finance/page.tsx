import { redirect } from "next/navigation";
import { getProtectedCrmPage, money, SimpleModulePage, statusBadge } from "@/app/components/CrmPages";
import { updateRecommendationStatusAction } from "@/lib/actions";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  if (user.role !== "owner" && user.role !== "accountant") {
    redirect("/");
  }

  return (
    <SimpleModulePage
      title={locale === "en" ? "Finance / ROI" : "Финансы / ROI"}
      subtitle={locale === "en" ? "Strategic module for owner/accountant: payback, RevPAD, ROI and recommendations." : "Стратегический модуль для owner/accountant: payback, RevPAD, ROI и рекомендации."}
      locale={locale}
      activePath="/finance"
    >
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
    </SimpleModulePage>
  );
}
