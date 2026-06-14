import { redirect } from "next/navigation";
import { getProtectedCrmPage, SimpleModulePage } from "@/app/components/CrmPages";
import { AnalyticsDashboard } from "@/app/components/AnalyticsDashboard";

export const revalidate = 0;

export default async function Page() {
  const { user, data, locale } = await getProtectedCrmPage();
  
  // Authorization check (Only owners, managers, accountants, marketers can access analytics)
  if (!["owner", "accountant", "manager", "marketer"].includes(user.role)) {
    redirect("/");
  }

  return (
    <SimpleModulePage
      title={locale === "en" ? "Analytics & LTV" : "Аналитика & LTV"}
      subtitle={locale === "en" ? "Comprehensive operational funnel, LTV parameter analysis, and referral payouts ledger." : "Сквозная операционная воронка, аналитика показателей LTV и реферальная система выплат."}
      locale={locale}
      activePath="/analytics"
    >
      <AnalyticsDashboard data={data} locale={locale} user={user} />
    </SimpleModulePage>
  );
}
