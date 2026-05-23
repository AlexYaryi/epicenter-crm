import { redirect } from "next/navigation";
import { getProtectedCrmPage, SimpleModulePage } from "@/app/components/CrmPages";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { changeUserPasswordAction, createAppUserAction, deleteUserWithTransferAction, updateAppUserAction } from "@/lib/actions";
import { getAppUsers } from "@/lib/repository";
import type { AppUser } from "@/lib/types";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  if (user.role !== "owner" && user.role !== "accountant") {
    redirect("/");
  }
  const users = await getAppUsers(user.tenantId);
  const isOwner = user.role === "owner";

  function t(ru: string, en: string) {
    return locale === "en" ? en : ru;
  }

  return (
    <SimpleModulePage
      title={t("Настройки", "Settings")}
      subtitle={t("Пользователи, роли, локации, языки, прайс-листы, ROI thresholds и high season.", "Users, roles, locations, languages, price lists, ROI thresholds and high season.")}
      locale={locale}
      activePath="/settings"
    >
      <section className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>{t("Текущий пользователь", "Current user")}</h2></div>
          <div className="panel-body">
            <p><strong>{user.fullName}</strong></p>
            <p className="muted">Email: {user.email ?? t("нет", "none")} · {t("роль", "role")}: {user.role} · tenant: {user.tenantId}</p>
            <div className="filters">
              <span className="chip">{t("Owner видит стратегию", "Owner sees strategy")}</span>
              <span className="chip">{t("Operator без ROI", "Operator without ROI")}</span>
              <span className="chip">{t("RU / EN интерфейс", "RU / EN interface")}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{t("Локации", "Locations")}</h2></div>
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

      {/* Users table */}
      <section className="panel">
        <div className="panel-head"><h2>{t("Пользователи и роли", "Users and roles")}</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Пользователь", "User")}</th>
                <th>{t("Роль", "Role")}</th>
                <th>{t("Статус", "Status")}</th>
                <th>{t("Изменить роль / статус", "Change role / status")}</th>
                {isOwner ? <th>{t("Пароль", "Password")}</th> : null}
                {isOwner ? <th>{t("Удалить", "Delete")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map((item: AppUser) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.full_name}</strong>
                    <br />
                    <span className="muted">{item.phone ?? ""} {item.telegram_username ?? ""}</span>
                  </td>
                  <td>{item.role}</td>
                  <td><span className={item.active ? "badge ok" : "badge danger"}>{item.active ? "active" : "disabled"}</span></td>
                  <td>
                    <ActionFeedbackForm action={updateAppUserAction} className="filters" locale={locale} savingText={t("Сохраняю...", "Saving...")} fallbackError={t("Ошибка", "Error")}>
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
                      <button className="button">{t("Сохранить", "Save")}</button>
                    </ActionFeedbackForm>
                  </td>
                  {isOwner ? (
                    <td>
                      <ActionFeedbackForm action={changeUserPasswordAction} className="filters" locale={locale} savingText={t("Меняю пароль...", "Changing password...")} fallbackError={t("Ошибка смены пароля", "Password change error")}>
                        <input type="hidden" name="user_id" value={item.id} />
                        <input name="new_password" type="password" placeholder={t("Новый пароль", "New password")} minLength={6} style={{minWidth:"150px"}} />
                        <button className="button">{t("Сменить", "Change")}</button>
                      </ActionFeedbackForm>
                    </td>
                  ) : null}
                  {isOwner ? (
                    <td>
                      <ActionFeedbackForm action={deleteUserWithTransferAction} className="filters" locale={locale} savingText={t("Удаляю...", "Deleting...")} fallbackError={t("Ошибка удаления", "Delete error")}>
                        <input type="hidden" name="user_id" value={item.id} />
                        <select name="transfer_to_user_id">
                          <option value="">{t("Данные никуда не переносить", "Don't transfer data")}</option>
                          {users.filter((u: AppUser) => u.id !== item.id).map((u: AppUser) => (
                            <option key={u.id} value={u.id}>{t("→ ", "→ ")}{u.full_name}</option>
                          ))}
                        </select>
                        <button className="button danger-button">{t("Удалить", "Delete")}</button>
                      </ActionFeedbackForm>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Create user */}
        <div className="panel-body">
          <h3 style={{marginBottom:"12px"}}>{t("Создать пользователя", "Create user")}</h3>
          <ActionFeedbackForm action={createAppUserAction} className="form-grid" locale={locale} savingText={t("Создаю пользователя...", "Creating user...")} fallbackError={t("Ошибка создания", "Create error")}>
            <input type="hidden" name="tenant_id" value={user.tenantId} />
            <div className="field"><label>Email</label><input name="email" type="email" required /></div>
            <div className="field"><label>{t("Временный пароль", "Temporary password")}</label><input name="password" type="password" required minLength={6} /></div>
            <div className="field"><label>{t("Имя", "Full name")}</label><input name="full_name" required /></div>
            <div className="field">
              <label>{t("Роль", "Role")}</label>
              <select name="role">
                <option value="operator">operator</option>
                <option value="marketer">marketer</option>
                <option value="manager">manager</option>
                <option value="accountant">accountant</option>
                <option value="partner_view">partner_view</option>
                <option value="owner">owner</option>
              </select>
            </div>
            <div className="field"><label>{t("Телефон", "Phone")}</label><input name="phone" /></div>
            <div className="field"><label>Telegram</label><input name="telegram_username" /></div>
            <div className="field wide"><button className="primary">{t("Создать пользователя", "Create user")}</button></div>
          </ActionFeedbackForm>
        </div>
      </section>
    </SimpleModulePage>
  );
}
