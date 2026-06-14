const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "lib", "payment-status.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;

const sandbox = {
  exports: {},
  module: { exports: {} },
  require
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const { calculateRentalPaymentCoverage } = sandbox.module.exports;

function coverage(booking, payments = []) {
  return calculateRentalPaymentCoverage(booking, payments);
}

const longTermBase = {
  start_date: "2026-04-22T11:01:00",
  end_date: "2026-10-22T11:01:00",
  rental_type: "long_term",
  rental_amount: 9000,
  total_rental_amount: 9000,
  deposit_amount: 5000,
  status: "paid_deposit",
  rental_status: "active",
  deposit_status: "held"
};

{
  const result = coverage(longTermBase);
  assert.equal(result.rentalDue, 9000);
  assert.equal(result.fullRentalDue, 54000);
  assert.equal(result.rentalPaid, 9000);
  assert.equal(result.remainingRental, 45000);
  assert.equal(result.paidThroughDate, "2026-05-22");
  assert.equal(result.depositPaid, 5000);
}

{
  const result = coverage(longTermBase, [{ type: "rental", status: "completed", amount: 9000 }]);
  assert.equal(result.rentalPaid, 18000);
  assert.equal(result.remainingRental, 36000);
  assert.equal(result.paidThroughDate, "2026-06-22");
}

{
  const result = coverage(longTermBase, [{ type: "rental", status: "completed", amount: 4500 }]);
  assert.equal(result.rentalPaid, 13500);
  assert.equal(result.remainingRental, 40500);
  assert.equal(result.dailyRate, 300);
  assert.equal(result.paidThroughDate, "2026-06-06");
}

{
  const result = coverage({ ...longTermBase, payment_status: "fully_paid" });
  assert.equal(result.rentalPaid, 9000);
  assert.equal(result.remainingRental, 45000);
  assert.equal(result.paidThroughDate, "2026-05-22");
}

{
  const result = coverage(longTermBase, [{ type: "rental", status: "completed", amount: 100000 }]);
  assert.equal(result.rentalPaid, 54000);
  assert.equal(result.remainingRental, 0);
  assert.equal(result.paidThroughDate, "2026-10-22");
  assert.equal(result.isFullyPaid, true);
}

const shortTermBase = {
  start_date: "2026-06-01T10:00:00",
  end_date: "2026-06-05T10:00:00",
  rental_type: "short_term",
  daily_rate_applied: 1000,
  deposit_amount: 3000,
  status: "confirmed",
  rental_status: "not_started",
  deposit_status: "not_taken"
};

{
  const result = coverage(shortTermBase);
  assert.equal(result.totalDays, 5);
  assert.equal(result.fullRentalDue, 5000);
  assert.equal(result.rentalPaid, 0);
  assert.equal(result.remainingRental, 5000);
  assert.equal(result.paidThroughDate, null);
}

{
  const result = coverage({ ...shortTermBase, rental_status: "active" });
  assert.equal(result.totalDays, 5);
  assert.equal(result.rentalPaid, 5000);
  assert.equal(result.remainingRental, 0);
  assert.equal(result.paidThroughDate, "2026-06-05");
}

console.log("payment-status regression tests passed");
