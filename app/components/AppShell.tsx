import Image from "next/image";
import { ActiveNav } from "@/app/components/ActiveNav";
import { GlobalFormFeedback } from "@/app/components/GlobalFormFeedback";
import { UserProfileCard } from "@/app/components/UserProfileCard";
import { getLocale, tr } from "@/lib/i18n";
import { getCurrentUserContext } from "@/lib/repository";
import type { I18nKey } from "@/lib/i18n";
import type { Role } from "@/lib/types";

type NavItem = [href: string, labelKey: I18nKey, roles?: Role[]];

const strategicRoles: Role[] = ["owner", "accountant"];
const analyticsRoles: Role[] = ["owner", "accountant", "manager", "marketer"];

const navItems: NavItem[] = [
  ["/", "navHome"],
  ["/launch", "navLaunch", ["owner", "manager", "operator", "accountant"]],
  ["/fleet", "navFleet"],
  ["/fleet?category=rented", "navRented"],
  ["/customers", "navCustomers"],
  ["/leads", "navLeads"],
  ["/bookings", "navBookings"],
  ["/handover", "navHandover"],
  ["/insurance", "navInsurance"],
  ["/tax", "navTax"],
  ["/maintenance", "navMaintenance"],
  ["/documents", "navDocuments"],
  ["/finance", "navFinance", strategicRoles],
  ["/analytics", "navAnalytics", analyticsRoles],
  ["/settings", "navSettings", strategicRoles],
  ["/users", "navUsers", ["owner"]]
];

function canSeeNavItem(role: Role, roles?: Role[]) {
  return !roles || roles.includes(role);
}

export async function AppShell({ children, activePath = "/" }: { children: React.ReactNode; activePath?: string }) {
  const user = await getCurrentUserContext();
  const locale = await getLocale();
  const translatedNav = navItems
    .filter(([, , roles]) => canSeeNavItem(user.role, roles))
    .map(([href, labelKey, roles]) => [href, tr(locale, labelKey), Boolean(roles)] as [string, string, boolean?]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Image src="/assets/logo.png" alt="Epicenter" width={54} height={54} priority />
          <div>
            <strong>Epicenter Rental OS</strong>
            <span>{tr(locale, "carRentalCrm")}</span>
          </div>
        </div>
        <ActiveNav items={translatedNav} activePath={activePath} />
        <UserProfileCard user={user} locale={locale} />
      </aside>
      <main className="main">
        {children}
        <GlobalFormFeedback />
      </main>
    </div>
  );
}
