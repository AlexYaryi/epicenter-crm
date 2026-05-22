import { redirect } from "next/navigation";
import { getProtectedCrmPage, SimpleModulePage } from "@/app/components/CrmPages";
import { isActiveLeadStage } from "@/lib/lead-stages";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  if (!["owner", "accountant", "manager", "marketer"].includes(user.role)) {
    redirect("/");
  }

  const workingLeads = data.leads.filter((lead) => isActiveLeadStage(lead.stage));
  const leads = workingLeads.length + data.leads.filter((lead) => ["booked", "lost"].includes(lead.stage)).length || 1;
  const booked = data.leads.filter((lead) => lead.stage === "booked").length;

  return (
    <SimpleModulePage
      title={locale === "en" ? "Analytics" : "Аналитика"}
      subtitle={locale === "en" ? "Marketing and operational analytics: lead conversion, channels, fleet demand and model leaderboard." : "Маркетинговая и операционная аналитика: конверсия лидов, каналы, спрос по автопарку и model leaderboard."}
      locale={locale}
      activePath="/analytics"
    >
      <section className="grid-4">
        <div className="card"><div className="metric-label">Lead → booking</div><div className="metric-value">{Math.round((booked / leads) * 100)}%</div></div>
        <div className="card"><div className="metric-label">Fleet size</div><div className="metric-value">{data.vehicles.length}</div></div>
        <div className="card"><div className="metric-label">Customers</div><div className="metric-value">{data.customers.length}</div></div>
        <div className="card"><div className="metric-label">Bookings</div><div className="metric-value">{data.bookings.length}</div></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Model performance leaderboard</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{locale === "en" ? "Model" : "Модель"}</th><th>{locale === "en" ? "Category" : "Категория"}</th><th>{locale === "en" ? "Status" : "Статус"}</th><th>Performance band</th></tr></thead>
            <tbody>
              {data.vehicles.map((vehicle) => (
                <tr key={vehicle.id}><td>{vehicle.make} {vehicle.model}</td><td>{vehicle.category}</td><td>{vehicle.status}</td><td>{vehicle.performance_band}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SimpleModulePage>
  );
}
