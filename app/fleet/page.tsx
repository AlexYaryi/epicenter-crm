import { FleetPage, getProtectedCrmPage } from "@/app/components/CrmPages";
import type { VehicleCategory } from "@/lib/types";

const allowedCategories = new Set(["all", "economy", "comfort", "suv", "pickup", "convertible", "weak"]);

export default async function Page({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const props = await getProtectedCrmPage();
  const params = await searchParams;
  const selected = allowedCategories.has(params.category ?? "") ? params.category : "all";
  return <FleetPage {...props} selectedCategory={selected as "all" | VehicleCategory | "weak"} />;
}
