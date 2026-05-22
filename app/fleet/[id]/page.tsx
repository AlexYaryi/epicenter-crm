import { notFound } from "next/navigation";
import { bookingStatusBadge, getProtectedCrmPage, money, SimpleModulePage, vehicleStatusBadge } from "@/app/components/CrmPages";
import { VehiclePhotoUploader } from "@/app/components/VehiclePhotoUploader";
import { ActionFeedbackForm } from "@/app/components/ActionFeedbackForm";
import { BookingForm } from "@/app/components/BookingForm";
import { CustomerQuickForm } from "@/app/components/CustomerQuickForm";
import {
  createBookingAction,
  createCustomerAction,
  deleteVehicleAction,
  deleteVehiclePhotoAction,
  saveVehicleComplianceAction,
  updateVehicleAction,
  upsertVehiclePricingAction
} from "@/lib/actions";
import { getVehicleBookings } from "@/lib/repository";
import type { Vehicle } from "@/lib/types";

type PageParams = {
  params: Promise<{ id: string }>;
};

const shortTermBuckets = [
  { key: "1_day", labelRu: "1 день", labelEn: "1 day" },
  { key: "2_day", labelRu: "2 дня", labelEn: "2 days" },
  { key: "3_4_day", labelRu: "3-4 дня", labelEn: "3-4 days" },
  { key: "5_6_day", labelRu: "5-6 дней", labelEn: "5-6 days" },
  { key: "7_12_day", labelRu: "7-12 дней", labelEn: "7-12 days" },
  { key: "13_20_day", labelRu: "13-20 дней", labelEn: "13-20 days" },
  { key: "21_29_day", labelRu: "21-29 дней", labelEn: "21-29 days" },
  { key: "1_month", labelRu: "1 месяц", labelEn: "1 month" }
] as const;

function priceValue(vehicle: Vehicle, season: string, bucket: string) {
  const rule =
    vehicle.price_rules?.find((item) => item.season === season && item.duration_bucket === bucket) ??
    (bucket === "long_term" ? vehicle.price_rules?.find((item) => item.season === "custom" && item.active) : undefined);
  const value = rule?.monthly_rate_thb ?? rule?.daily_rate_thb;
  return value == null ? "" : String(value);
}

export default async function Page({ params }: PageParams) {
  const { id } = await params;
  const { data, locale, user } = await getProtectedCrmPage();
  const vehicle = data.vehicles.find((item) => item.id === id);

  if (!vehicle) {
    notFound();
  }

  const bookings = await getVehicleBookings(vehicle.id, user.tenantId);
  const strategicAllowed = user.role === "owner" || user.role === "accountant";
  const canManageFleet = user.role === "owner" || user.role === "manager" || user.role === "marketer";
  const features = vehicle.public_features.join(", ");
  const today = new Date().toISOString().slice(0, 10);
  const activeBookings = bookings.filter((booking) => {
    if (["handed_over", "active", "returning"].includes(booking.status)) return true;
    return ["confirmed", "paid_deposit"].includes(booking.status) && booking.end_date >= today;
  });
  const sortedBookings = bookings.slice().sort((a, b) => {
    const aActive = activeBookings.some((booking) => booking.id === a.id) ? 0 : 1;
    const bActive = activeBookings.some((booking) => booking.id === b.id) ? 0 : 1;
    return aActive - bActive || a.start_date.localeCompare(b.start_date);
  });
  const nextBookings = activeBookings.slice().sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 5);

  return (
    <SimpleModulePage title={`${vehicle.make} ${vehicle.model}`} subtitle={vehicle.license_plate} locale={locale} activePath="/fleet">
      <section className="grid-4">
        <div className="card"><div className="metric-label">{locale === "en" ? "Status" : "Статус"}</div><div>{vehicleStatusBadge(vehicle.status, locale)}</div></div>
        <div className="card"><div className="metric-label">{locale === "en" ? "Category" : "Категория"}</div><div className="metric-value">{vehicle.category}</div></div>
        <div className="card"><div className="metric-label">{locale === "en" ? "Website" : "Сайт"}</div><div className="metric-value">{vehicle.public_visible ? "ON" : "OFF"}</div></div>
        {strategicAllowed ? <div className="card"><div className="metric-label">Payback</div><div className="metric-value">{vehicle.payback_pct}%</div></div> : <div className="card"><div className="metric-label">{locale === "en" ? "Photos" : "Фото"}</div><div className="metric-value">{vehicle.photos.length}</div></div>}
      </section>

      <section className="panel" id="vehicle-bookings">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Vehicle activity" : "Активность по машине"}</h2>
            <p className="sub">
              {locale === "en"
                ? "Current and upcoming bookings are shown here immediately after saving."
                : "Текущие и ближайшие брони показываются здесь сразу после сохранения."}
            </p>
          </div>
          <span className={activeBookings.length ? "badge warn" : "badge ok"}>{activeBookings.length}</span>
        </div>
        <div className="panel-body">
          {nextBookings.length ? (
            <div className="booking-strip">
              {nextBookings.map((booking) => (
                <a className="booking-chip-card" href={`/bookings/${booking.id}`} key={booking.id}>
                  <strong>{booking.booking_number}</strong>
                  <span>{booking.customer_id ? booking.customer_name : locale === "en" ? "Customer missing" : "Клиент не найден"}</span>
                  <small>{booking.start_date} - {booking.end_date}</small>
                  {bookingStatusBadge(booking.status, locale)}
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-state">{locale === "en" ? "No active bookings for this vehicle." : "Активных броней по этой машине нет."}</div>
          )}
        </div>
      </section>

      {canManageFleet ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Edit vehicle" : "Редактировать автомобиль"}</h2>
              <p className="sub">{locale === "en" ? "All operational, website and pricing fields are edited here." : "Здесь редактируются операционные поля, сайт и цены по машине."}</p>
            </div>
          </div>
          <div className="panel-body">
            <form action={updateVehicleAction} className="form-grid" data-save-message={locale === "en" ? "Saving vehicle..." : "Сохраняю автомобиль..."} data-saved-message={locale === "en" ? "Vehicle data sent for saving." : "Данные автомобиля отправлены на сохранение."}>
              <input type="hidden" name="id" value={vehicle.id} />
              <input type="hidden" name="tenant_id" value={user.tenantId} />
              <div className="field"><label>{locale === "en" ? "Location" : "Локация"}</label><select name="location_id" defaultValue={vehicle.location_id}>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
              <div className="field"><label>{locale === "en" ? "Plate" : "Номер"}</label><input name="license_plate" defaultValue={vehicle.license_plate} required /></div>
              <div className="field"><label>{locale === "en" ? "Make" : "Марка"}</label><input name="make" defaultValue={vehicle.make} required /></div>
              <div className="field"><label>{locale === "en" ? "Model" : "Модель"}</label><input name="model" defaultValue={vehicle.model} required /></div>
              <div className="field"><label>{locale === "en" ? "Year" : "Год"}</label><input name="year" type="number" defaultValue={vehicle.year} required /></div>
              <div className="field"><label>VIN</label><input name="vin" defaultValue={vehicle.vin ?? ""} /></div>
              <div className="field"><label>{locale === "en" ? "Color" : "Цвет"}</label><input name="color" defaultValue={vehicle.color ?? ""} /></div>
              <div className="field"><label>{locale === "en" ? "Status" : "Статус"}</label><select name="status" defaultValue={vehicle.status}><option value="available">{locale === "en" ? "available" : "свободно"}</option><option value="reserved">{locale === "en" ? "booked" : "есть брони"}</option><option value="in_use">{locale === "en" ? "rented" : "в аренде"}</option><option value="maintenance">{locale === "en" ? "maintenance" : "техническое обслуживание"}</option><option value="repair">{locale === "en" ? "repair" : "ремонт"}</option></select></div>
              <div className="field"><label>{locale === "en" ? "Body type" : "Кузов"}</label><select name="body_type" defaultValue={vehicle.body_type}><option value="sedan">sedan</option><option value="suv">suv</option><option value="pickup">pickup</option><option value="hatchback">hatchback</option><option value="convertible">convertible</option><option value="7-seat">7-seat</option></select></div>
              <div className="field"><label>{locale === "en" ? "Category" : "Категория"}</label><select name="category" defaultValue={vehicle.category}><option value="economy">economy</option><option value="comfort">comfort</option><option value="suv">suv</option><option value="premium">premium</option><option value="pickup">pickup</option><option value="convertible">convertible</option></select></div>
              <div className="field"><label>{locale === "en" ? "Fuel" : "Топливо"}</label><input name="fuel_type" defaultValue={vehicle.fuel_type} /></div>
              <div className="field"><label>{locale === "en" ? "Transmission" : "Коробка"}</label><select name="transmission" defaultValue={vehicle.transmission}><option value="auto">auto</option><option value="manual">manual</option></select></div>
              <div className="field"><label>{locale === "en" ? "Seats" : "Мест"}</label><input name="seats" type="number" defaultValue={vehicle.seats} /></div>
              <div className="field"><label>{locale === "en" ? "Mileage" : "Пробег"}</label><input name="mileage_current" type="number" defaultValue={vehicle.mileage_current} /></div>
              <div className="field"><label>{locale === "en" ? "Ownership" : "Тип владения"}</label><select name="ownership_type" defaultValue={vehicle.ownership_type}><option value="own">own</option><option value="partner">partner</option><option value="leased">leased</option></select></div>
              {strategicAllowed ? <div className="field"><label>{locale === "en" ? "Acquisition cost" : "Стоимость покупки"}</label><input name="acquisition_cost_thb" type="number" defaultValue={vehicle.acquisition_cost_thb} /></div> : <input type="hidden" name="acquisition_cost_thb" value={vehicle.acquisition_cost_thb} />}
              <div className="field"><label>{locale === "en" ? "Acquisition date" : "Дата покупки"}</label><input name="acquisition_date" type="date" defaultValue={vehicle.acquisition_date} required /></div>
              <div className="field"><label>Short-term / {locale === "en" ? "day" : "день"}</label><input name="daily_rate_short_term" type="number" defaultValue={vehicle.daily_rate_short_term} required /></div>
              <div className="field"><label>Long-term / {locale === "en" ? "day" : "день"}</label><input name="daily_rate_long_term" type="number" defaultValue={vehicle.daily_rate_long_term} required /></div>
              <div className="field"><label>{locale === "en" ? "Month" : "Месяц"}</label><input name="monthly_rate" type="number" defaultValue={vehicle.monthly_rate} required /></div>
              <div className="field"><label>{locale === "en" ? "Deposit" : "Депозит"}</label><input name="deposit_amount" type="number" defaultValue={vehicle.deposit_amount} /></div>
              <div className="field"><label>{locale === "en" ? "Website sort order" : "Порядок на сайте"}</label><input name="public_sort_order" type="number" defaultValue={vehicle.public_sort_order} /></div>
              <div className="field checkbox-field"><label><input name="public_visible" type="checkbox" defaultChecked={vehicle.public_visible} /> {locale === "en" ? "Show on website" : "Показывать на сайте"}</label></div>
              <div className="field wide"><label>{locale === "en" ? "Public description RU" : "Публичное описание RU"}</label><textarea name="public_description_ru" defaultValue={vehicle.public_description_ru ?? ""} /></div>
              <div className="field wide"><label>{locale === "en" ? "Public description EN" : "Публичное описание EN"}</label><textarea name="public_description_en" defaultValue={vehicle.public_description_en ?? ""} /></div>
              <div className="field wide"><label>{locale === "en" ? "Features comma-separated" : "Особенности через запятую"}</label><input name="public_features" defaultValue={features} /></div>
              <div className="field wide"><label>{locale === "en" ? "Internal notes" : "Внутренние заметки"}</label><textarea name="notes_internal" defaultValue={vehicle.notes_internal ?? ""} /></div>
              <div className="field wide"><button className="primary">{locale === "en" ? "Save changes" : "Сохранить изменения"}</button></div>
            </form>
          </div>
        </section>
      ) : null}

      {canManageFleet ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Seasonal and long-term pricing" : "Сезонные цены и Long Term"}</h2>
              <p className="sub">
                {locale === "en"
                  ? "Set the exact price matrix by season and rental duration. These prices are also used by the public Tilda catalog."
                  : "Задайте точную матрицу цен по сезону и длительности аренды. Эти цены также отдаются в каталог на Tilda."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <ActionFeedbackForm
              action={upsertVehiclePricingAction}
              className="pricing-matrix"
              locale={locale}
              savingText={locale === "en" ? "Saving pricing matrix..." : "Сохраняю матрицу цен..."}
              fallbackError={locale === "en" ? "Pricing matrix was not saved." : "Матрица цен не сохранена."}
            >
              <input type="hidden" name="vehicle_id" value={vehicle.id} />
              <input type="hidden" name="tenant_id" value={user.tenantId} />

              <div className="pricing-season-card">
                <div className="pricing-season-head">
                  <div>
                    <h3>{locale === "en" ? "High season" : "Высокий сезон"}</h3>
                    <p className="muted">{locale === "en" ? "November - March" : "Ноябрь - март"}</p>
                  </div>
                  <span className="badge warn">Nov-Mar</span>
                </div>
                <div className="price-bucket-grid">
                  {shortTermBuckets.map((bucket) => (
                    <label key={bucket.key}>
                      <span>{locale === "en" ? bucket.labelEn : bucket.labelRu}</span>
                      <input
                        name={`price_high_${bucket.key}`}
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={priceValue(vehicle, "high", bucket.key)}
                        placeholder="THB"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="pricing-season-card">
                <div className="pricing-season-head">
                  <div>
                    <h3>{locale === "en" ? "Medium season" : "Средний сезон"}</h3>
                    <p className="muted">{locale === "en" ? "April - October" : "Апрель - октябрь"}</p>
                  </div>
                  <span className="badge info">Apr-Oct</span>
                </div>
                <div className="price-bucket-grid">
                  {shortTermBuckets.map((bucket) => (
                    <label key={bucket.key}>
                      <span>{locale === "en" ? bucket.labelEn : bucket.labelRu}</span>
                      <input
                        name={`price_medium_${bucket.key}`}
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={priceValue(vehicle, "medium", bucket.key)}
                        placeholder="THB"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="pricing-season-card long-term-card">
                <div className="pricing-season-head">
                  <div>
                    <h3>Long Term</h3>
                    <p className="muted">
                      {locale === "en"
                        ? "Individual monthly prices for long rentals. Empty fields are not shown as active rules."
                        : "Индивидуальные месячные цены для длинной аренды. Пустые поля не показываются как активные правила."}
                    </p>
                  </div>
                  <span className="badge ok">{locale === "en" ? "Monthly" : "Помесячно"}</span>
                </div>
                <div className="price-bucket-grid long-term-grid single-long-term">
                  <label>
                    <span>{locale === "en" ? "Long-term monthly price" : "Цена Long Term за месяц"}</span>
                    <input
                      name="price_long_term_monthly"
                      type="number"
                      min="0"
                      step="1"
                      defaultValue={priceValue(vehicle, "custom", "long_term")}
                      placeholder={locale === "en" ? "THB / month" : "THB / месяц"}
                    />
                  </label>
                </div>
              </div>

              <button className="primary">{locale === "en" ? "Save pricing matrix" : "Сохранить матрицу цен"}</button>
            </ActionFeedbackForm>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Vehicle photos" : "Фото автомобиля"}</h2>
            <p className="sub">{locale === "en" ? "Upload many photos at once: exterior, interior, trunk, dashboard and keys." : "Загружайте сразу много фотографий: кузов, салон, багажник, панель и ключи."}</p>
          </div>
        </div>
        <div className="panel-body">
          {canManageFleet ? <VehiclePhotoUploader vehicleId={vehicle.id} locale={locale} /> : null}
          <div className="vehicle-photo-grid">
            {vehicle.photos.map((photo, index) => (
              <div className="vehicle-photo-card" key={photo}>
                <img src={photo} alt={`${vehicle.make} ${vehicle.model} ${index + 1}`} />
                {canManageFleet ? (
                  <form action={deleteVehiclePhotoAction}>
                    <input type="hidden" name="vehicle_id" value={vehicle.id} />
                    <input type="hidden" name="photo_url" value={photo} />
                    <button className="button danger-button">{locale === "en" ? "Delete" : "Удалить"}</button>
                  </form>
                ) : null}
              </div>
            ))}
            {vehicle.photos.length === 0 ? <p className="muted">{locale === "en" ? "No photos yet." : "Фото пока не загружены."}</p> : null}
          </div>
        </div>
      </section>

      {canManageFleet ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Insurance and Por Ror Bor" : "Страховка и Пор Рор Бор"}</h2>
              <p className="sub">
                {locale === "en"
                  ? "Quick compliance fields for this vehicle without leaving the vehicle card."
                  : "Быстрый ввод документов по этой машине прямо из карточки автомобиля."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <ActionFeedbackForm
              action={saveVehicleComplianceAction}
              className="form-grid"
              locale={locale}
              savingText={locale === "en" ? "Saving compliance..." : "Сохраняю страховку и налог..."}
              fallbackError={locale === "en" ? "Compliance data was not saved." : "Данные по страховке и Пор Рор Бор не сохранены."}
            >
              <input type="hidden" name="tenant_id" value={user.tenantId} />
              <input type="hidden" name="vehicle_id" value={vehicle.id} />
              <div className="field"><label>{locale === "en" ? "Insurance type" : "Тип страховки"}</label><select name="insurance_type" defaultValue="1st_class"><option value="1st_class">1st class</option><option value="2nd_class">2nd class</option><option value="3rd_class">3rd class</option><option value="CMI_compulsory">CMI / Por Ror Bor</option></select></div>
              <div className="field"><label>{locale === "en" ? "Insurance company" : "Страховая компания"}</label><input name="insurance_provider" defaultValue={vehicle.insurance_provider?.split(" | ")[0] ?? ""} placeholder="Viriyah / Roojai / Bangkok Insurance" /></div>
              <div className="field"><label>{locale === "en" ? "Insurer phone / support" : "Телефон страховщика / поддержки"}</label><input name="insurance_phone" defaultValue={vehicle.insurance_phone || vehicle.insurance_provider?.split(" | ")[1] || ""} placeholder="+66..." /></div>
              <div className="field"><label>{locale === "en" ? "Policy number" : "Номер полиса"}</label><input name="policy_number" placeholder="POLICY-..." /></div>
              <div className="field"><label>{locale === "en" ? "Insurance start" : "Начало страховки"}</label><input name="insurance_start_date" type="date" /></div>
              <div className="field"><label>{locale === "en" ? "Insurance end" : "Окончание страховки"}</label><input name="insurance_end_date" type="date" defaultValue={vehicle.insurance_expires_at || ""} /></div>
              <div className="field"><label>{locale === "en" ? "Premium THB" : "Стоимость страховки THB"}</label><input name="premium_amount" type="number" min="0" defaultValue="0" /></div>
              <div className="field"><label>{locale === "en" ? "Deductible THB" : "Франшиза THB"}</label><input name="deductible" type="number" min="0" defaultValue="0" /></div>
              <div className="field"><label>{locale === "en" ? "Road tax amount THB" : "Сумма налога / Пор Рор Бор THB"}</label><input name="road_tax_amount_thb" type="number" min="0" defaultValue={vehicle.road_tax_amount_thb ?? 0} /></div>
              <div className="field"><label>{locale === "en" ? "Road tax due date" : "Дата окончания налога"}</label><input name="road_tax_due_date" type="date" defaultValue={vehicle.road_tax_due_date || ""} /></div>
              <div className="field"><label>{locale === "en" ? "Road tax paid until" : "Оплачено до"}</label><input name="road_tax_paid_until" type="date" defaultValue={vehicle.road_tax_paid_until ?? vehicle.road_tax_due_date ?? ""} /></div>
              <div className="field"><label>{locale === "en" ? "Inspection expires" : "Техосмотр до"}</label><input name="inspection_expires_at" type="date" defaultValue={vehicle.inspection_expires_at ?? ""} /></div>
              <div className="field wide"><button className="primary">{locale === "en" ? "Save insurance and tax" : "Сохранить страховку и Пор Рор Бор"}</button></div>
            </ActionFeedbackForm>
          </div>
        </section>
      ) : null}

      <section className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Operations" : "Операции"}</h2></div>
          <div className="panel-body">
            <div className="task"><strong>{locale === "en" ? "Daily long-term rate" : "Цена long-term"}</strong><span>{money(vehicle.daily_rate_long_term)} / {locale === "en" ? "day" : "день"}</span></div>
            <div className="task"><strong>{locale === "en" ? "Monthly rate" : "Цена за месяц"}</strong><span>{money(vehicle.monthly_rate)}</span></div>
            <div className="task"><strong>{locale === "en" ? "Location" : "Локация"}</strong><span>{vehicle.location}</span></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Compliance" : "Compliance"}</h2></div>
          <div className="panel-body">
            <div className="task"><strong>{locale === "en" ? "Insurance" : "Страховка"}</strong><span>{vehicle.insurance_provider || "-"}</span><span className="muted">{vehicle.insurance_expires_at || "-"}</span></div>
            <div className="task"><strong>{locale === "en" ? "Road tax / Por Ror Bor" : "Налог / Пор Рор Бор"}</strong><span>{vehicle.road_tax_due_date || "-"}</span></div>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Book this vehicle for a customer" : "Забронировать это авто клиенту"}</h2>
              <p className="sub">{locale === "en" ? "Choose an existing customer and create a booking directly from the vehicle card." : "Выберите существующего клиента и создайте бронь прямо из карточки автомобиля."}</p>
            </div>
          </div>
          <div className="panel-body">
            <BookingForm
              action={createBookingAction}
              tenantId={user.tenantId}
              locale={locale}
              customers={data.customers}
              vehicles={data.vehicles}
              fixedVehicleId={vehicle.id}
              defaultDailyRate={vehicle.daily_rate_long_term || vehicle.daily_rate_short_term || 390}
              defaultMonthlyRate={vehicle.monthly_rate || (vehicle.daily_rate_long_term ? vehicle.daily_rate_long_term * 30 : 0)}
              defaultDeposit={vehicle.deposit_amount || 5000}
              submitLabel={locale === "en" ? "Create booking for this vehicle" : "Создать бронь на это авто"}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Add a new customer for this vehicle" : "Добавить нового клиента под это авто"}</h2>
              <p className="sub">{locale === "en" ? "Create the customer first, then select them in the booking form." : "Сначала создайте клиента, затем выберите его в форме брони."}</p>
            </div>
          </div>
          <div className="panel-body">
            <CustomerQuickForm
              action={createCustomerAction}
              tenantId={user.tenantId}
              locale={locale}
              returnPath={`/fleet/${vehicle.id}`}
              sourceDetail={`Vehicle card: ${vehicle.license_plate} ${vehicle.make} ${vehicle.model}`}
            />
          </div>
        </div>
      </section>

      {strategicAllowed ? (
        <section className="panel">
          <div className="panel-head"><h2>{locale === "en" ? "Finance and ROI" : "Финансы и ROI"}</h2></div>
          <div className="panel-body">
            <div className="filters">
              <span className="chip">Financial: <b>{vehicle.status_financial}</b></span>
              <span className="chip">Band: <b>{vehicle.performance_band}</b></span>
              <span className="chip">90d utilization: <b>{vehicle.utilization_90}%</b></span>
            </div>
          </div>
        </section>
      ) : null}

      {canManageFleet ? (
        <section className="panel danger-zone">
          <div className="panel-head">
            <div>
              <h2>{locale === "en" ? "Danger zone" : "Опасная зона"}</h2>
              <p className="sub">{locale === "en" ? "Deletion can fail if bookings, payments or logs still reference this vehicle." : "Удаление может не пройти, если на машину уже есть брони, платежи или журналы."}</p>
            </div>
          </div>
          <div className="panel-body">
            <form action={deleteVehicleAction}>
              <input type="hidden" name="vehicle_id" value={vehicle.id} />
              <button className="button danger-button">{locale === "en" ? "Delete vehicle from CRM" : "Удалить автомобиль из CRM"}</button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Bookings and rentals" : "Брони и аренды"}</h2>
            <p className="sub">
              {locale === "en"
                ? "All bookings linked to this vehicle are shown here immediately after saving."
                : "Все брони, связанные с этой машиной, появляются здесь сразу после сохранения."}
            </p>
          </div>
          <span className="badge info">{bookings.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{locale === "en" ? "Booking" : "Бронь"}</th><th>{locale === "en" ? "Customer" : "Клиент"}</th><th>{locale === "en" ? "Dates" : "Даты"}</th><th>{locale === "en" ? "Status" : "Статус"}</th><th>{locale === "en" ? "Total" : "Сумма"}</th></tr></thead>
            <tbody>
              {sortedBookings.map((booking) => (
                <tr key={booking.id}>
                  <td><a href={`/bookings/${booking.id}`}>{booking.booking_number}</a></td>
                  <td>{booking.customer_id ? <a href={`/customers/${booking.customer_id}`}>{booking.customer_name}</a> : booking.customer_name}</td>
                  <td>{booking.start_date} - {booking.end_date}</td>
                  <td>{bookingStatusBadge(booking.status, locale)}</td>
                  <td>{money(booking.grand_total)}</td>
                </tr>
              ))}
              {sortedBookings.length === 0 ? <tr><td colSpan={5}>{locale === "en" ? "No bookings yet" : "Броней пока нет"}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </SimpleModulePage>
  );
}
