import { InsurancePage, getProtectedCrmPage } from "@/app/components/CrmPages";

export default async function Page() {
  const props = await getProtectedCrmPage();
  return <InsurancePage {...props} />;
}
