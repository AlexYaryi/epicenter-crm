import { getProtectedCrmPage, SimpleModulePage, statusBadge } from "@/app/components/CrmPages";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { recordMaintenanceExpenseAction } from "@/lib/actions";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();

  return (
    <SimpleModulePage
      title={locale === "en" ? "Maintenance" : "ТО / ремонт"}
      subtitle={locale === "en" ? "Scheduled service, emergency repairs, downtime and costs that affect ROI." : "Плановые работы, аварийные ремонты, downtime и расходы, влияющие на ROI."}
      locale={locale}
      activePath="/maintenance"
    >
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Maintenance queue" : "Очередь ТО"}</h2>
            <p className="sub">{locale === "en" ? "Quick maintenance expense entry writes to maintenance_log and updates ROI inputs." : "Быстрый ввод расхода пишет в maintenance_log и обновляет входные данные ROI."}</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{locale === "en" ? "Vehicle" : "Машина"}</th><th>{locale === "en" ? "Status" : "Статус"}</th><th>{locale === "en" ? "Mileage / date" : "Пробег / дата"}</th><th>{locale === "en" ? "Action" : "Действие"}</th></tr>
            </thead>
            <tbody>
              {data.vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <td><strong>{vehicle.license_plate}</strong><br /><span className="muted">{vehicle.make} {vehicle.model}</span></td>
                  <td>{statusBadge(vehicle.status)}</td>
                  <td><span className="muted">{locale === "en" ? "Trigger 500 km before service" : "Триггер за 500 км до ТО"}</span></td>
                  <td><a className="button" href="#record-maintenance">{locale === "en" ? "Record expense" : "Записать расход"}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" id="record-maintenance">
        <div className="panel-head">
          <h2>{locale === "en" ? "Record maintenance expense" : "Записать расход ТО / ремонта"}</h2>
        </div>
        <div className="panel-body">
          <ActionFeedbackForm action={recordMaintenanceExpenseAction} className="form-grid" locale={locale} savingText={locale === "en" ? "Saving expense..." : "Записываю расход..."} fallbackError={locale === "en" ? "Expense was not saved." : "Расход не сохранён."}>
            <input type="hidden" name="tenant_id" value={user.tenantId} />
            <div className="field">
              <label>{locale === "en" ? "Vehicle" : "Машина"}</label>
              <select name="vehicle_id">
                {data.vehicles.map((vehicle) => (
                  <option value={vehicle.id} key={vehicle.id}>{vehicle.license_plate} · {vehicle.make} {vehicle.model}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{locale === "en" ? "Type" : "Тип"}</label>
              <select name="type">
                <option value="scheduled_service">{locale === "en" ? "Scheduled service" : "Плановое ТО"}</option>
                <option value="oil_change">{locale === "en" ? "Oil change" : "Замена масла"}</option>
                <option value="repair">{locale === "en" ? "Repair" : "Ремонт"}</option>
                <option value="battery">{locale === "en" ? "Battery" : "Аккумулятор"}</option>
                <option value="tire_change">{locale === "en" ? "Tires" : "Шины"}</option>
                <option value="wash">{locale === "en" ? "Wash" : "Мойка"}</option>
                <option value="inspection">{locale === "en" ? "Inspection" : "Инспекция"}</option>
                <option value="accident">{locale === "en" ? "Accident" : "Авария"}</option>
              </select>
            </div>
            <div className="field"><label>{locale === "en" ? "Completed date" : "Дата выполнения"}</label><input name="completed_date" type="date" required /></div>
            <div className="field"><label>{locale === "en" ? "Mileage" : "Пробег"}</label><input name="mileage_at_service" type="number" min="0" /></div>
            <div className="field"><label>{locale === "en" ? "Cost THB" : "Сумма THB"}</label><input name="cost" type="number" min="0" required /></div>
            <div className="field"><label>{locale === "en" ? "Vendor" : "Поставщик"}</label><input name="paid_to" /></div>
            <div className="field wide"><label>{locale === "en" ? "Work description" : "Описание работ"}</label><textarea name="work_description" /></div>
            <div className="field wide"><button className="primary">{locale === "en" ? "Save expense" : "Сохранить расход"}</button></div>
          </ActionFeedbackForm>
        </div>
      </section>
    </SimpleModulePage>
  );
}
