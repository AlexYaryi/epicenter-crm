import { getProtectedCrmPage, SimpleModulePage } from "@/app/components/CrmPages";
import { generateContractPdfAction } from "@/lib/actions";

export default async function Page() {
  const { data, locale } = await getProtectedCrmPage();

  return (
    <SimpleModulePage
      title={locale === "en" ? "Documents" : "Документы"}
      subtitle={locale === "en" ? "Passports, licenses, IDP, contracts, policies, tax invoices and CAPEX invoices." : "Паспорта, права, IDP, договоры, полисы, tax invoices и CAPEX invoices."}
      locale={locale}
      activePath="/documents"
    >
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Customer documents" : "Документы клиентов"}</h2>
            <p className="sub">{locale === "en" ? "Photo/video uploads are already connected in the handover/return section." : "Загрузки фото/видео уже подключены в разделе выдачи/возврата."}</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{locale === "en" ? "Customer" : "Клиент"}</th><th>{locale === "en" ? "Passport" : "Паспорт"}</th><th>IDP</th><th>{locale === "en" ? "Contract" : "Договор"}</th></tr></thead>
            <tbody>
              {data.customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.full_name}</td>
                  <td>{customer.passport_number ?? (locale === "en" ? "not filled" : "не заполнено")}</td>
                  <td>{customer.has_valid_idp ? <span className="badge ok">valid</span> : <span className="badge danger">{locale === "en" ? "IDP required" : "нужен IDP"}</span>}</td>
                  <td><span className="badge info">{locale === "en" ? "Stored in profile" : "В карточке клиента"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{locale === "en" ? "Rental contracts" : "Договоры аренды"}</h2>
            <p className="sub">{locale === "en" ? "Generate and reopen booking contracts from one place." : "Создание и открытие договоров по всем броням из одного места."}</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{locale === "en" ? "Booking" : "Бронь"}</th>
                <th>{locale === "en" ? "Dates" : "Даты"}</th>
                <th>{locale === "en" ? "Contract" : "Договор"}</th>
                <th>{locale === "en" ? "Action" : "Действие"}</th>
              </tr>
            </thead>
            <tbody>
              {data.bookings.map((booking) => (
                <tr key={booking.id}>
                  <td><a href={`/bookings/${booking.id}`}>{booking.booking_number}</a></td>
                  <td>{booking.start_date} - {booking.end_date}</td>
                  <td>
                    {booking.contract_pdf_url ? (
                      <a className="button" href={booking.contract_pdf_url} target="_blank">{locale === "en" ? "Open" : "Открыть"}</a>
                    ) : (
                      <span className="badge warn">{locale === "en" ? "not generated" : "не создан"}</span>
                    )}
                  </td>
                  <td>
                    <form action={generateContractPdfAction}>
                      <input type="hidden" name="booking_id" value={booking.id} />
                      <input type="hidden" name="language" value={locale} />
                      <button className="primary">{locale === "en" ? "Generate PDF" : "Создать PDF"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SimpleModulePage>
  );
}
