const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertMatches(relativePath, pattern, message) {
  const source = read(relativePath);
  assert.match(source, pattern, `${relativePath}: ${message}`);
}

function assertDoesNotMatch(relativePath, pattern, message) {
  const source = read(relativePath);
  assert.doesNotMatch(source, pattern, `${relativePath}: ${message}`);
}

const publicAvailabilityFiles = [
  "app/api/integrations/booking/availability/route.ts",
  "app/api/tilda/availability/route.ts",
  "app/api/tilda/vehicles/route.ts"
];

for (const relativePath of publicAvailabilityFiles) {
  assertMatches(
    relativePath,
    /function\s+complianceReason[\s\S]*?\{\s*return\s+null;\s*\}/,
    "insurance, Por Ror Bor and inspection must not block public availability"
  );
}

assertMatches(
  "app/api/integrations/booking/webhook/route.ts",
  /function\s+vehicleCompliantForDates[\s\S]*?\{\s*return\s+true;\s*\}/,
  "insurance, Por Ror Bor and inspection must not block automatic vehicle assignment"
);

assertMatches(
  "app/launch/page.tsx",
  /Страховка,\s*Por Ror Bor\s+и\s+налог\s+—\s+это\s+напоминания\s+ниже,\s+не\s+блокеры\./,
  "launch page must explain that compliance renewals are reminders, not blockers"
);

assertDoesNotMatch(
  "lib/repository.ts",
  /critical\.push\([\s\S]{0,500}(insurance_readiness|tax_readiness)/,
  "insurance and tax readiness must stay warnings, not critical launch blockers"
);

console.log("Compliance blocker regression passed.");
