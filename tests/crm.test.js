import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extract, normalisePhone, extractBudget } from "../src/extract.js";
import { buildCrm, toCsv } from "../src/crm.js";

const data = JSON.parse(readFileSync(new URL("../data/messages.json", import.meta.url)));
const crm = buildCrm(data);
const byName = (n) => crm.contacts.find((c) => c.name === n);

test("phone numbers are normalised to international format", () => {
  assert.equal(normalisePhone("069 234 5678"), "+355692345678");
  assert.equal(normalisePhone("3381234567"), "+393381234567");
  assert.equal(normalisePhone("07700 900123"), "+447700900123");
  assert.equal(normalisePhone("0039 347 112 2334"), "+393471122334");
  assert.equal(normalisePhone("12345"), null);
});

test("budgets in three languages and currencies", () => {
  assert.deepEqual(extractBudget("budget around 120,000 EUR"), { budget: 120000, currency: "EUR" });
  assert.deepEqual(extractBudget("il mio budget è di 350 mila euro"), { budget: 350000, currency: "EUR" });
  assert.deepEqual(extractBudget("deri ne 13 milion leke"), { budget: 13000000, currency: "ALL" });
  assert.deepEqual(extractBudget("up to £150,000"), { budget: 150000, currency: "GBP" });
  assert.deepEqual(extractBudget("a 2+1 for 2 people"), { budget: null, currency: null });
});

test("a phone number is never read as a budget", () => {
  assert.equal(extract("Cerco una villa. Potete chiamarmi al +39 347 112 2334, budget 350 mila euro").budget, 350000);
});

test("the same person across email, WhatsApp and web form becomes one contact", () => {
  const klajdi = byName("Klajdi Basha");
  assert.deepEqual(klajdi.messages, ["m02", "m13", "t13"]);
  assert.deepEqual(klajdi.channels.sort(), ["email", "web_form", "whatsapp"]);
  assert.equal(klajdi.phones[0], "+355684451122");
  assert.equal(klajdi.emails[0], "klajdi.basha98@gmail.com");
});

test("latest requirements win, viewing requests become the next step", () => {
  const ana = byName("Ana Hoxha");
  assert.equal(ana.budget, 140000);
  assert.equal(ana.bedrooms, 3);
  assert.equal(ana.intent, "buy");
  assert.equal(ana.next_step, "arrange viewing");
});

test("messages without contact details go to the review queue", () => {
  assert.deepEqual(crm.review.map((m) => m.id).sort(), ["m05", "m14", "t08"]);
});

test("notifications, newsletters and emoji are ignored", () => {
  assert.deepEqual(crm.ignored.map((m) => m.id).sort(), ["m10", "m19", "t09"]);
});

test("no contact appears twice", () => {
  const keys = crm.contacts.flatMap((c) => [...c.emails, ...c.phones]);
  assert.equal(new Set(keys).size, keys.length);
});

test("CSV export escapes commas and quotes", () => {
  const csv = toCsv([{ id: "C-1", name: 'Rossi, "Marco"', emails: ["a@b.it"], phones: [], channels: ["email"], messages: ["m1"] }]);
  assert.match(csv.split("\n")[1], /^C-1,"Rossi, ""Marco""",a@b.it,/);
});

test("held-out accuracy stays above the bar", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = JSON.parse(execFileSync("node", [new URL("../scripts/evaluate.mjs", import.meta.url).pathname, "--json"]));
  assert.ok(out.test.fieldAccuracy >= 0.95, `test accuracy ${out.test.fieldAccuracy}`);
});
