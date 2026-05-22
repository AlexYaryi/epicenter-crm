import { redirect } from "next/navigation";
import { getProtectedCrmPage, SimpleModulePage } from "@/app/components/CrmPages";
import { createAppUserAction, updateAppUserAction } from "@/lib/actions";
import { getAppUsers } from "@/lib/repository";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  if (user.role !== "owner" && user.role !== "accountant") {
    redirect("/");
  }
  const users = await getAppUsers(user.tenantId);

  return (
    <SimpleModulePage
      title={locale === "en" ? "Settings" : "Настройки"}
      subtitle={locale === "en" ? "Users, roles, locations, languages, price lists, ROI thresholds and high season." : "Пользователи, роли, локации, языки, прайс-листы, ROI thresholds и high season."}
      locale={locale}
      activePath="/settings"
    >
      <section className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Current user" : "Текущий пользователь"}</h2></div>
          <div className="panel-body">
            <p><strong>{user.fullName}</strong></p>
            <p className="muted">Email: {user.email ?? (locale === "en" ? "none" : "нет")} · {locale === "en" ? "role" : "роль"}: {user.role} · tenant: {user.tenantId}</p>
            <div className="filters">
              <span className="chip">{locale === "en" ? "Owner sees strategy" : "Owner видит стратегию"}</span>
              <span className="chip">{locale === "en" ? "Operator without ROI" : "Operator без ROI"}</span>
              <span className="chip">{locale === "en" ? "RU / EN interface" : "RU / EN интерфейс"}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Locations" : "Локации"}</h2></div>
          <div className="panel-body">
            {data.locations.map((location) => (
              <div className="task" key={location.id}>
                <strong>{location.name}</strong>
                <span className="muted">{location.city}, {location.country_code}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>{locale === "en" ? "Users and roles" : "Пользователи и роли"}</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{locale === "en" ? "User" : "Пользователь"}</th>
                <th>{locale === "en" ? "Role" : "Роль"}</th>
                <th>{locale === "en" ? "Status" : "Статус"}</th>
                <th>{locale === "en" ? "Action" : "Действие"}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.full_name}</strong><br /><span className="muted">{item.phone ?? ""} {item.telegram_username ?? ""}</span></td>
                  <td>{item.role}</td>
                  <td><span className={item.active ? "badge ok" : "badge danger"}>{item.active ? "active" : "disabled"}</span></td>
                  <td>
                    <form action={updateAppUserAction} className="filters">
                      <input type="hidden" name="id" value={item.id} />
                      <select name="role" defaultValue={item.role}>
                        <option value="owner">owner</option>
                        <option value="manager">manager</option>
                        <option value="operator">operator</option>
                        <option value="accountant">accountant</option>
                        <option value="marketer">marketer</option>
                        <option value="partner_view">partner_view</option>
                      </select>
                      <select name="active" defaultValue={String(item.active)}>
                        <option value="true">active</option>
                        <option value="false">disabled</option>
                      </select>
                      <button className="button">{locale === "en" ? "Save" : "Сохранить"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-body">
          <h3>{locale === "en" ? "Create user" : "Создать пользователя"}</h3>
          <form action={createAppUserAction} className="form-grid">
            <input type="hidden" name="tenant_id" value={user.tenantId} />
            <div className="field"><label>Email</label><input name="email" type="email" required /></div>
            <div className="field"><label>{locale === "en" ? "Temporary password" : "Временный пароль"}</label><input name="password" type="password" required /></div>
            <div className="field"><label>{locale === "en" ? "Full name" : "Имя"}</label><input name="full_name" required /></div>
            <div className="field"><label>{locale === "en" ? "Role" : "Роль"}</label><select name="role"><option value="operator">operator</option><option value="marketer">marketer</option><option value="manager">manager</option><option value="accountant">accountant</option><option value="partner_view">partner_view</option><option value="owner">owner</option></select></div>
            <div className="field"><label>{locale === "en" ? "Phone" : "Телефон"}</label><input name="phone" /></div>
            <div className="field"><label>Telegram</label><input name="telegram_username" /></div>
            <div className="field wide"><button className="primary">{locale === "en" ? "Create user" : "Создать пользователя"}</button></div>
          </form>
        </div>
      </section>
    </SimpleModulePage>
  );
}
