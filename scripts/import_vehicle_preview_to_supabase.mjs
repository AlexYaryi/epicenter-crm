import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const crmDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(crmDir, "..");
const previewDir = path.join(rootDir, "import_preview");
const envPath = path.join(crmDir, ".env.local");
const batch = `vehicle_import_${new Date().toISOString().slice(0, 10)}`;
const fallbackAcquisitionDate = "2026-01-01";
const yearOverridesByPlate = {
  "1066": 2013
};

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ""));
  return rows.slice(1).map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

async function readCsv(name) {
  return parseCsv(await fs.readFile(path.join(previewDir, name), "utf8"));
}

function asNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

function asInt(value, fallback = null) {
  const num = asNumber(value, Number.NaN);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

function nullableDate(value) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function previousPlates(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function seatsFor(category, model) {
  const text = `${category} ${model}`.toLowerCase();
  if (text.includes("br-v") || text.includes("innova") || text.includes("avanza")) return 7;
  if (category === "pickup" || category === "suv") return 5;
  return 5;
}

function buildImportNote(row) {
  return "";
}

async function chunkedInsert(supabase, table, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function chunkedUpsert(supabase, table, rows, onConflict, chunkSize = 250) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const env = parseEnv(await fs.readFile(envPath, "utf8"));
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in crm/.env.local");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [vehiclesPreview, priceRulesPreview, issuesPreview] = await Promise.all([
    readCsv("vehicles_import_preview.csv"),
    readCsv("vehicle_price_rules_preview.csv"),
    readCsv("import_issues.csv").catch(() => [])
  ]);

  const { data: tenants, error: tenantError } = await supabase.from("tenants").select("id, name").order("created_at", { ascending: true }).limit(1);
  if (tenantError || !tenants?.length) throw new Error(`Tenant lookup failed: ${tenantError?.message ?? "no tenant"}`);
  const tenant = tenants[0];

  let { data: locations, error: locationError } = await supabase
    .from("locations")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .order("name", { ascending: true })
    .limit(1);
  if (locationError) throw new Error(`Location lookup failed: ${locationError.message}`);
  if (!locations?.length && commit) {
    const created = await supabase
      .from("locations")
      .insert({ tenant_id: tenant.id, name: "Phuket Main", city: "Phuket", country_code: "TH", kind: "office", active: true })
      .select("id, name")
      .single();
    if (created.error) throw new Error(`Location create failed: ${created.error.message}`);
    locations = [created.data];
  }
  if (!locations?.length) throw new Error("No location found. Run with --commit to allow creating Phuket Main.");
  const location = locations[0];

  const vehicleRows = vehiclesPreview.map((row) => {
    const year = asInt(row.year) ?? yearOverridesByPlate[row.license_plate] ?? null;
    const acquisitionDate = nullableDate(row.acquisition_date) ?? fallbackAcquisitionDate;
    const importNote = buildImportNote(row);
    return {
      tenant_id: tenant.id,
      license_plate: row.license_plate,
      previous_license_plates: previousPlates(row.previous_license_plates),
      make: row.make || "Unknown",
      model: row.model || row.raw_name || "Unknown",
      year,
      body_type: row.body_type || "hatchback",
      category: row.category || "economy",
      fuel_type: "gasoline",
      transmission: "auto",
      seats: seatsFor(row.category, row.model),
      status: row.status || "available",
      ownership_type: "own",
      revenue_share_pct: 0,
      location_id: location.id,
      photos: [],
      notes_internal: [row.import_notes, importNote].filter(Boolean).join("\n"),
      acquisition_cost_thb: asNumber(row.acquisition_cost_thb),
      acquisition_cost_usd: asNumber(row.acquisition_cost_usd),
      acquisition_fx_rate_usd_thb: 32,
      acquisition_fx_date: "2026-05-18",
      acquisition_date: acquisitionDate,
      acquisition_payment_method: "cash",
      financing_terms: {},
      depreciation_schedule: {},
      daily_rate_short_term: asNumber(row.daily_rate_short_term_thb),
      daily_rate_long_term: asNumber(row.daily_rate_long_term_thb),
      monthly_rate: asNumber(row.monthly_rate_thb),
      deposit_amount: 0,
      high_season_multiplier: 1,
      road_tax_due_date: nullableDate(row.road_tax_due_date),
      road_tax_paid_until: nullableDate(row.road_tax_due_date),
      inspection_expires_at: nullableDate(row.insurance_end_date),
      target_payback_months: row.category === "premium" ? 36 : 24,
      source_import_key: `${batch}:${row.license_plate}`,
      raw_import_data: row
    };
  });

  const skippedVehicles = vehicleRows.filter((row) => !row.license_plate || !row.year);
  const importableVehicles = vehicleRows.filter((row) => row.license_plate && row.year);

  const stagingRows = vehiclesPreview.map((row) => ({
    tenant_id: tenant.id,
    import_batch: batch,
    source_file: row.source_row_dds ? "ДДС ПХУКЕТ 2026.xlsx" : "Аренда Авто Пхукет.xlsx",
    source_sheet: row.source_row_dds ? "АвтоПарк" : "Высокий/Средний",
    source_row: asInt(row.source_row_dds),
    license_plate: row.license_plate || null,
    previous_license_plates: previousPlates(row.previous_license_plates),
    make: row.make || null,
    model: row.model || null,
    year: asInt(row.year) ?? yearOverridesByPlate[row.license_plate] ?? null,
    category: row.category || null,
    body_type: row.body_type || null,
    status: row.status || null,
    acquisition_date: nullableDate(row.acquisition_date),
    acquisition_cost_usd: asNumber(row.acquisition_cost_usd),
    acquisition_cost_thb: asNumber(row.acquisition_cost_thb),
    repair_cost_usd: asNumber(row.repair_cost_usd),
    repair_cost_thb: asNumber(row.repair_cost_thb),
    capex_total_usd: asNumber(row.capex_total_usd),
    capex_total_thb: asNumber(row.capex_total_thb),
    road_tax_due_date: nullableDate(row.road_tax_due_date),
    insurance_end_date: nullableDate(row.insurance_end_date),
    daily_rate_short_term_thb: asNumber(row.daily_rate_short_term_thb),
    daily_rate_long_term_thb: asNumber(row.daily_rate_long_term_thb),
    monthly_rate_thb: asNumber(row.monthly_rate_thb),
    raw_payload: row,
    review_status: row.year || yearOverridesByPlate[row.license_plate] ? "approved" : "pending",
    review_notes: buildImportNote(row)
  }));

  const summary = {
    mode: commit ? "commit" : "dry-run",
    tenant,
    location,
    batch,
    staging_rows: stagingRows.length,
    importable_vehicles: importableVehicles.length,
    skipped_vehicles: skippedVehicles.map((row) => ({ license_plate: row.license_plate, make: row.make, model: row.model, reason: !row.year ? "missing_year" : "missing_plate" })),
    price_rules_preview_rows: priceRulesPreview.length,
    issues_preview_rows: issuesPreview.length
  };

  if (!commit) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await supabase.from("vehicle_import_staging").delete().eq("tenant_id", tenant.id).eq("import_batch", batch);
  await chunkedInsert(supabase, "vehicle_import_staging", stagingRows);

  await chunkedUpsert(supabase, "vehicles", importableVehicles, "tenant_id,license_plate");

  const { data: vehicleIds, error: vehiclesError } = await supabase
    .from("vehicles")
    .select("id, license_plate")
    .eq("tenant_id", tenant.id)
    .in("license_plate", importableVehicles.map((row) => row.license_plate));
  if (vehiclesError) throw new Error(`Vehicle ID lookup failed: ${vehiclesError.message}`);
  const vehicleIdByPlate = new Map((vehicleIds ?? []).map((row) => [row.license_plate, row.id]));

  const priceRows = priceRulesPreview
    .map((row) => {
      const vehicleId = vehicleIdByPlate.get(row.license_plate);
      if (!vehicleId) return null;
      return {
        tenant_id: tenant.id,
        vehicle_id: vehicleId,
        season: row.season,
        season_months: String(row.season_months)
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item)),
        duration_bucket: row.duration_bucket,
        min_days: asInt(row.min_days, 1),
        max_days: asInt(row.max_days, 1),
        daily_rate_thb: asNumber(row.daily_rate_thb),
        monthly_rate_thb: asNumber(row.monthly_rate_thb),
        currency: "THB",
        source_sheet: row.source_sheet,
        source_row: asInt(row.source_row),
        active: true
      };
    })
    .filter(Boolean);

  await chunkedUpsert(supabase, "vehicle_price_rules", priceRows, "tenant_id,vehicle_id,season,duration_bucket,min_days,max_days");

  const insuranceRows = vehiclesPreview
    .map((row) => {
      const vehicleId = vehicleIdByPlate.get(row.license_plate);
      const endDate = nullableDate(row.insurance_end_date);
      if (!vehicleId || !endDate) return null;
      const startYear = Number(endDate.slice(0, 4)) - 1;
      const startDate = `${startYear}${endDate.slice(4)}`;
      return {
        tenant_id: tenant.id,
        vehicle_id: vehicleId,
        type: "1st_class",
        provider: "Unknown imported",
        policy_number: `import-${row.license_plate}-${endDate}`,
        start_date: startDate,
        end_date: endDate,
        premium_amount: 0,
        deductible: 0,
        covers_theft: false,
        covers_third_party: true
      };
    })
    .filter(Boolean);
  if (insuranceRows.length) {
    await chunkedUpsert(supabase, "insurance", insuranceRows, "tenant_id,vehicle_id,policy_number");
  }

  const { count: vehiclesCount } = await supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  const { count: priceRulesCount } = await supabase.from("vehicle_price_rules").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  const { count: stagingCount } = await supabase.from("vehicle_import_staging").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("import_batch", batch);

  console.log(JSON.stringify({ ...summary, imported_price_rules: priceRows.length, imported_insurance_rows: insuranceRows.length, live_counts: { vehicles: vehiclesCount, vehicle_price_rules: priceRulesCount, staging_batch: stagingCount } }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
