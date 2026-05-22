import { DashboardPage, getProtectedCrmPage } from "@/app/components/CrmPages";

export default async function HomePage() {
  const props = await getProtectedCrmPage();
  return <DashboardPage {...props} />;
}
