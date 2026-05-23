export type Role = "owner" | "manager" | "operator" | "accountant" | "marketer" | "partner_view";
export type Lang = "ru" | "en";

export type VehicleStatus =
  | "available"
  | "reserved"
  | "handed_over"
  | "in_use"
  | "returning"
  | "maintenance"
  | "repair"
  | "retired";

export type VehicleCategory = "economy" | "comfort" | "suv" | "premium" | "pickup" | "convertible";
export type FinancialStatus =
  | "NOT_RECOVERED"
  | "RECOVERED"
  | "PROFIT_GENERATING"
  | "UNDERPERFORMING"
  | "DECOMMISSION_RECOMMENDED";

export type PerformanceBand = "TOP_QUARTILE" | "UPPER_MID" | "LOWER_MID" | "BOTTOM_QUARTILE";

export type VehiclePriceRule = {
  id: string;
  season: "high" | "medium" | "low" | "custom" | string;
  season_months: number[];
  duration_bucket: string;
  min_days: number;
  max_days: number;
  daily_rate_thb: number | null;
  monthly_rate_thb: number | null;
  active: boolean;
};

export type Vehicle = {
  id: string;
  license_plate: string;
  make: string;
  model: string;
  year: number;
  category: VehicleCategory;
  status: VehicleStatus;
  location: string;
  location_id: string;
  vin: string | null;
  color: string | null;
  body_type: string;
  fuel_type: string;
  transmission: string;
  seats: number;
  mileage_current: number;
  ownership_type: string;
  photos: string[];
  notes_internal: string | null;
  daily_rate_short_term: number;
  daily_rate_long_term: number;
  monthly_rate: number;
  deposit_amount: number;
  public_visible: boolean;
  public_sort_order: number;
  public_description_ru: string | null;
  public_description_en: string | null;
  public_features: string[];
  acquisition_cost_thb: number;
  acquisition_date: string;
  status_financial: FinancialStatus;
  performance_band: PerformanceBand;
  payback_pct: number;
  revpad: number;
  utilization_90: number;
  insurance_provider: string;
  insurance_phone: string;
  insurance_expires_at: string;
  inspection_expires_at?: string;
  road_tax_amount_thb?: number;
  road_tax_due_date: string;
  road_tax_paid_until?: string;
  price_rules?: VehiclePriceRule[];
};

export type LeadStage = "new" | "contacted" | "qualified" | "quoted" | "negotiating" | "booked" | "lost" | "not_lead";

export type Lead = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  telegram_username: string | null;
  contact_handle: string | null;
  channel: string;
  source_detail?: string | null;
  stage: LeadStage;
  score: number;
  first_response_minutes: number;
  next_action: string;
  reminder_at: string;
  category: string;
  tags: string[];
  note: string;
};

export type BookingStatus = "draft" | "confirmed" | "paid_deposit" | "handed_over" | "active" | "returning" | "completed" | "cancelled" | "no_show";

export type Booking = {
  id: string;
  booking_number: string;
  lead_id?: string | null;
  customer_id?: string;
  customer_name: string;
  vehicle_id?: string;
  vehicle: string;
  status: BookingStatus;
  start_date: string;
  end_date: string;
  rental_amount: number;
  deposit_amount: number;
  pickup_fee: number;
  delivery_fee: number;
  grand_total: number;
  idp_ok: boolean;
  contract_pdf_url?: string | null;
};

export type Recommendation = {
  id: string;
  type: string;
  vehicle: string;
  confidence: number;
  reasoning: string;
  impact_thb: number;
};

export type DashboardData = {
  vehicles: Vehicle[];
  leads: Lead[];
  bookings: Booking[];
  recommendations: Recommendation[];
  customers: Customer[];
  locations: Location[];
};

export type Customer = {
  id: string;
  full_name: string;
  full_name_passport: string | null;
  phone: string | null;
  whatsapp: string | null;
  telegram_username: string | null;
  source: string | null;
  source_detail: string | null;
  passport_number: string | null;
  passport_expires: string | null;
  idp_number: string | null;
  idp_expires: string | null;
  language_pref: Lang;
  has_valid_idp: boolean;
};

export type ConversationMessage = {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  channel: string;
  direction: "inbound" | "outbound";
  sender_type: "customer" | "operator" | "system" | "integration";
  sender_name: string | null;
  contact_handle: string | null;
  message_text: string;
  message_type: string;
  status: string;
  occurred_at: string;
};

export type Location = {
  id: string;
  name: string;
  city: string;
  country_code: string;
};

export type AppUser = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  role: Role;
  phone: string | null;
  telegram_username: string | null;
  active: boolean;
  created_at: string;
};

export type BookingDetail = {
  id: string;
  tenant_id: string;
  booking_number: string;
  status: string;
  start_date: string;
  end_date: string;
  rental_type: string;
  total_rental_amount: number;
  deposit_amount: number;
  delivery_fee: number;
  extras_total: number;
  grand_total: number;
  contract_pdf_url: string | null;
  contract_signed: boolean;
  customer: Customer | null;
  vehicle: Vehicle | null;
};
