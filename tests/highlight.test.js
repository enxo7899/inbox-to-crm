import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extract } from "../src/extract.js";
import { findSpans } from "../src/highlight.js";

const messages = JSON.parse(readFileSync(new URL("../data/messages.json", import.meta.url)));

test("each highlighted span in a message points at the text the value came from", () => {
  const raw = "Buongiorno, mi chiamo Sara Greco. Cerco un appartamento 2+1 in affitto a Durazzo, massimo 550 euro al mese. Tel 347 555 1212";
  const r = extract(raw);
  const got = Object.fromEntries(findSpans(raw, r).map((s) => [s.field, raw.slice(s.start, s.end)]));
  assert.equal(got.name, "Sara Greco");
  assert.equal(got.phone, "347 555 1212");
  assert.equal(got.city, "Durazzo");
  assert.equal(got.bedrooms, "2+1");
  assert.match(got.budget, /550 euro/);
});

test("highlights never overlap, so a phone number is never also shown as a budget", () => {
  for (const m of messages) {
    const spans = findSpans(m.raw, extract(m.raw));
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i].start >= spans[i - 1].end, `${m.id} overlaps`);
  }
});

test("emails and phones found by the extractor are always located in the message", () => {
  for (const m of messages) {
    const r = extract(m.raw);
    const fields = new Set(findSpans(m.raw, r).map((s) => s.field));
    if (r.email) assert.ok(fields.has("email"), `${m.id} email`);
    if (r.phone) assert.ok(fields.has("phone"), `${m.id} phone`);
  }
});
