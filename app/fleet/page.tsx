import { FleetPage, getProtectedCrmPage } from "@/app/components/CrmPages";
import type { VehicleCategory } from "@/lib/types";

const allowedCategories = new Set(["all", "economy", "comfort", "suv", "pickup", "convertible", "weak", "7seater", "rented"]);

export default async function Page({ searchParams }: { searchParams: Promise<{ category?: string; rented_category?: string }> }) {
  const props = await getProtectedCrmPage();
  const params = await searchParams;
  const selected = allowedCategories.has(params.category ?? "") ? params.category : "all";
  const rentedCategory = allowedCategories.has(params.rented_category ?? "") && params.rented_category !== "weak" && params.rented_category !== "rented"
    ? params.rented_category
    : "all";
  return <FleetPage {...props} selectedCategory={selected as "all" | VehicleCategory | "weak" | "rented"} selectedRentedCategory={rentedCategory as "all" | VehicleCategory} />;}
