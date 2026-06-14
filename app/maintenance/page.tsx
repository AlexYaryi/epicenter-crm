import { getProtectedCrmPage, SimpleModulePage, statusBadge } from "@/app/components/CrmPages";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { recordMaintenanceExpenseAction } from "@/lib/actions";

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  const vehiclesById = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const activeMaintenance = [...data.maintenance]
    .filter((item) => ["scheduled", "in_progress"].includes(String(item.status ?? "")))
    .sort((left, right) => String(left.vehicle_unavailable_from ?? "").localeCompare(String(right.vehicle_unavailable_from ?? "")));

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
            <h2>{locale === "en" ? "Active service blocks" : "Активные блокировки сервиса"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Cars unavailable because of scheduled or in-progress maintenance. These dates block new bookings."
                : "Машины, недоступные из-за запланированного или текущего ремонта/ТО. Эти даты блокируют новые брони."}
            </p>
          </div>
          <span className="badge info">{activeMaintenance.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{locale === "en" ? "Vehicle" : "Машина"}</th>
                <th>{locale === "en" ? "Work" : "Работы"}</th>
                <th>{locale === "en" ? "Unavailable" : "Недоступна"}</th>
                <th>{locale === "en" ? "Status" : "Статус"}</th>
                <th>{locale === "en" ? "Action" : "Действие"}</th>
              </tr>
            </thead>
            <tbody>
              {activeMaintenance.map((item) => {
                const vehicle = item.vehicle_id ? vehiclesById.get(item.vehicle_id) : null;
                const vehicleLabel = vehicle ? `${vehicle.license_plate} · ${vehicle.make} ${vehicle.model}` : (locale === "en" ? "Vehicle not found" : "Машина не найдена");
                const from = String(item.vehicle_unavailable_from ?? "").slice(0, 10) || "-";
                const to = String(item.vehicle_unavailable_to ?? "").slice(0, 10) || (locale === "en" ? "open end" : "без даты окончания");
                return (
                  <tr key={item.id}>
                    <td><strong>{vehicleLabel}</strong></td>
                    <td>{item.type ?? "maintenance"}</td>
                    <td>{from} - {to}</td>
                    <td>{statusBadge(item.status)}</td>
                    <td>{vehicle ? <a className="button" href={`/fleet/${vehicle.id}`}>{locale === "en" ? "Open car" : "Открыть авто"}</a> : <a className="button" href="#record-maintenance">{locale === "en" ? "Record" : "Записать"}</a>}</td>
                  </tr>
                );
              })}
              {activeMaintenance.length === 0 ? (
                <tr><td colSpan={5}>{locale === "en" ? "No active maintenance blocks." : "Активных блокировок ремонта/ТО нет."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
                {[...data.vehicles]
                  .sort((a, b) => {
                    const makeCompare = (a.make || "").localeCompare(b.make || "", locale === "en" ? "en" : "ru");
                    if (makeCompare !== 0) return makeCompare;
                    const modelCompare = (a.model || "").localeCompare(b.model || "", locale === "en" ? "en" : "ru");
                    if (modelCompare !== 0) return modelCompare;
                    return (a.license_plate || "").localeCompare(b.license_plate || "");
                  })
                  .map((vehicle) => (
                    <option value={vehicle.id} key={vehicle.id}>{vehicle.license_plate} · {vehicle.make} {vehicle.model}</option>
                  ))
                }
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
            <div className="field">
              <label>{locale === "en" ? "Work status" : "Статус работ"}</label>
              <select name="status" defaultValue="completed">
                <option value="completed">{locale === "en" ? "Completed" : "Завершено"}</option>
                <option value="scheduled">{locale === "en" ? "Scheduled / blocks calendar" : "Запланировано / блокирует календарь"}</option>
                <option value="in_progress">{locale === "en" ? "In progress / car unavailable" : "В работе / машина недоступна"}</option>
              </select>
              <span className="muted">
                {locale === "en"
                  ? "Scheduled requires from/to dates. In progress requires a start date and may have an open end."
                  : "Для запланированного ремонта нужны даты с/до. Для ремонта в работе нужна дата начала, конец можно оставить открытым."}
              </span>
            </div>
            <div className="field"><label>{locale === "en" ? "Unavailable from" : "Недоступна с"}</label><input name="vehicle_unavailable_from" type="date" /></div>
            <div className="field"><label>{locale === "en" ? "Unavailable to" : "Недоступна до"}</label><input name="vehicle_unavailable_to" type="date" /></div>
            <div className="field"><label>{locale === "en" ? "Completed date" : "Дата выполнения"}</label><input name="completed_date" type="date" /></div>
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
