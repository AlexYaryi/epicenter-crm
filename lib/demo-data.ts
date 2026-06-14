import type { Booking, Customer, DashboardData, Lead, Location, Recommendation, Vehicle } from "./types";

const demoVehiclesBase: Array<Partial<Vehicle> & Pick<Vehicle, "id" | "license_plate" | "make" | "model" | "year" | "category" | "status" | "location">> = [
  {
    id: "v-mazda-2",
    license_plate: "กต-9041",
    make: "Mazda",
    model: "2",
    year: 2022,
    category: "economy",
    status: "in_use",
    location: "Phuket HQ",
    daily_rate_long_term: 390,
    monthly_rate: 11700,
    status_financial: "PROFIT_GENERATING",
    performance_band: "TOP_QUARTILE",
    payback_pct: 112,
    revpad: 870,
    utilization_90: 86,
    insurance_provider: "Viriyah Insurance",
    insurance_phone: "02-239-1557",
    insurance_expires_at: "2026-06-14",
    road_tax_due_date: "2026-07-01"
  },
  {
    id: "v-brv",
    license_plate: "ขพ-1180",
    make: "Honda",
    model: "BR-V",
    year: 2021,
    category: "suv",
    status: "reserved",
    location: "Airport meet",
    daily_rate_long_term: 690,
    monthly_rate: 20700,
    status_financial: "RECOVERED",
    performance_band: "TOP_QUARTILE",
    payback_pct: 84,
    revpad: 928,
    utilization_90: 92,
    insurance_provider: "Bangkok Insurance",
    insurance_phone: "1620",
    insurance_expires_at: "2026-05-18",
    road_tax_due_date: "2026-05-14"
  },
  {
    id: "v-ciaz",
    license_plate: "นค-6632",
    make: "Suzuki",
    model: "Ciaz",
    year: 2019,
    category: "comfort",
    status: "available",
    location: "Phuket HQ",
    daily_rate_long_term: 430,
    monthly_rate: 12900,
    status_financial: "UNDERPERFORMING",
    performance_band: "BOTTOM_QUARTILE",
    payback_pct: 41,
    revpad: 390,
    utilization_90: 44,
    insurance_provider: "Dhipaya Insurance",
    insurance_phone: "1736",
    insurance_expires_at: "2026-08-02",
    road_tax_due_date: "2026-10-21"
  },
  {
    id: "v-ranger",
    license_plate: "กพ-7712",
    make: "Ford",
    model: "Ranger",
    year: 2020,
    category: "pickup",
    status: "maintenance",
    location: "Phuket HQ",
    daily_rate_long_term: 790,
    monthly_rate: 23700,
    status_financial: "NOT_RECOVERED",
    performance_band: "LOWER_MID",
    payback_pct: 55,
    revpad: 610,
    utilization_90: 62,
    insurance_provider: "Muang Thai Insurance",
    insurance_phone: "1484",
    insurance_expires_at: "2026-05-09",
    road_tax_due_date: "2026-05-08"
  }
];

export const demoVehicles: Vehicle[] = demoVehiclesBase.map((vehicle) => ({
  location_id: "00000000-0000-0000-0000-000000000101",
  vin: null,
  color: null,
  body_type: vehicle.category === "suv" ? "suv" : vehicle.category === "pickup" ? "pickup" : "sedan",
  fuel_type: "gasoline",
  transmission: "auto",
  seats: vehicle.category === "suv" ? 7 : 5,
  mileage_current: 0,
  ownership_type: "own",
  photos: [],
  notes_internal: null,
  daily_rate_short_term: 1200,
  deposit_amount: 5000,
  public_visible: true,
  public_sort_order: 100,
  public_description_ru: null,
  public_description_en: null,
  public_features: [],
  price_rules: [],
  acquisition_cost_thb: 0,
  acquisition_date: "2026-01-01",
  ...vehicle
})) as Vehicle[];

export const demoLeads: Lead[] = [
  {
    id: "l-anna",
    customer_id: null,
    customer_name: "Анна",
    phone: null,
    telegram_username: null,
    contact_handle: null,
    channel: "WhatsApp",
    stage: "qualified",
    score: 86,
    first_response_minutes: 18,
    next_action: "Попросить фото IDP и подтвердить даты",
    reminder_at: "2026-05-07T12:30:00+07:00",
    category: "Long-term / expat",
    tags: ["long_term", "needs_idp", "high_budget"],
    note: "Хочет Mazda 2 или аналог на 30 дней. Показывать 390 THB/day только для 30+ дней."
  },
  {
    id: "l-family-suv",
    customer_id: null,
    customer_name: "Ivan family",
    phone: null,
    telegram_username: null,
    contact_handle: null,
    channel: "Google Ads PMax",
    stage: "quoted",
    score: 79,
    first_response_minutes: 55,
    next_action: "Отправить BR-V и Fortuner, уточнить детское кресло",
    reminder_at: "2026-05-07T16:00:00+07:00",
    category: "Family / SUV",
    tags: ["family", "suv"],
    note: "Нужна машина на 10 дней, аэропорт, ребенок 4 года."
  }
];

export const demoBookings: Booking[] = [
  {
    id: "00000000-0000-0000-0000-000000000042",
    booking_number: "EPC-2026-0042",
    customer_name: "Anna Smith",
    vehicle: "Honda BR-V",
    status: "paid_deposit",
    rental_status: "handed_over",
    start_date: "2026-05-07",
    end_date: "2026-05-21",
    rental_amount: 18900,
    deposit_amount: 10000,
    pickup_fee: 500,
    delivery_fee: 800,
    grand_total: 30200,
    idp_ok: true
  },
  {
    id: "00000000-0000-0000-0000-000000000045",
    booking_number: "EPC-2026-0045",
    customer_name: "Иван Петров",
    vehicle: "Mazda 2",
    status: "paid_deposit",
    rental_status: "active",
    start_date: "2026-05-01",
    end_date: "2026-05-31",
    rental_amount: 11700,
    deposit_amount: 10000,
    pickup_fee: 0,
    delivery_fee: 0,
    grand_total: 21700,
    idp_ok: true
  }
];

export const demoRecommendations: Recommendation[] = [
  {
    id: "r-brv-price",
    type: "RAISE_PRICE",
    vehicle: "Honda BR-V",
    confidence: 88,
    reasoning: "Загрузка 92%, верхний квартиль, семейный SUV сегмент перегрет.",
    impact_thb: 33872
  },
  {
    id: "r-ciaz-monitor",
    type: "KEEP_AND_MONITOR",
    vehicle: "Suzuki Ciaz",
    confidence: 74,
    reasoning: "Нижний квартиль, но продажу лучше рассматривать в low season window.",
    impact_thb: 0
  }
];

export const demoCustomers: Customer[] = [
  {
    id: "00000000-0000-0000-0000-000000000201",
    full_name: "Anna Smith",
    full_name_passport: "SMITH ANNA",
    phone: "+66827474212",
    whatsapp: "+66827474212",
    telegram_username: "@alexander",
    source: "whatsapp",
    source_detail: "Demo customer",
    passport_number: "P1234567",
    passport_expires: "2030-01-01",
    idp_number: "IDP-2026-001",
    idp_expires: "2027-01-01",
    language_pref: "ru",
    has_valid_idp: true
  }
];

export const demoLocations: Location[] = [
  {
    id: "00000000-0000-0000-0000-000000000101",
    name: "Phuket HQ",
    city: "Phuket",
    country_code: "TH"
  }
];

export const demoDashboard: DashboardData = {
  vehicles: demoVehicles,
  leads: demoLeads,
  bookings: demoBookings,
  maintenance: [],
  recommendations: demoRecommendations,
  customers: demoCustomers,
  locations: demoLocations
};
