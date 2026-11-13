// Field-level accuracy of the extractor against hand-labelled messages.
//   node scripts/evaluate.mjs            -> both splits
//   node scripts/evaluate.mjs --errors   -> also print every mistake
//   node scripts/evaluate.mjs --json     -> machine-readable (used by the demo page)
import { readFileSync } from "node:fs";
import { extract, FIELDS } from "../src/extract.js";

const data = JSON.parse(readFileSync(new URL("../data/messages.json", import.meta.url)));
const showErrors = process.argv.includes("--errors");
const asJson = process.argv.includes("--json");

const eq = (a, b) => (a ?? null) === (b ?? null);

export function evaluate(rows) {
  const per = Object.fromEntries(FIELDS.map((f) => [f, { right: 0, total: 0 }]));
  const errors = [];
  let auto = 0, autoAllCorrect = 0, review = 0, ignored = 0;
  for (const row of rows) {
    const got = extract(row.raw);
    let allRight = true;
    for (const f of FIELDS) {
      per[f].total++;
      if (eq(got[f], row.gold[f])) per[f].right++;
      else {
        allRight = false;
        errors.push({ id: row.id, field: f, expected: row.gold[f], got: got[f] });
      }
    }
    if (got.status === "auto") { auto++; if (allRight) autoAllCorrect++; }
    else if (got.status === "review") review++;
    else ignored++;
  }
  const right = Object.values(per).reduce((s, x) => s + x.right, 0);
  const total = Object.values(per).reduce((s, x) => s + x.total, 0);
  return {
    messages: rows.length,
    fieldAccuracy: right / total,
    perField: Object.fromEntries(Object.entries(per).map(([f, x]) => [f, x.right / x.total])),
    auto, autoAllCorrect, review, ignored,
    errors,
  };
}

const results = {
  dev: evaluate(data.filter((d) => d.split === "dev")),
  test: evaluate(data.filter((d) => d.split === "test")),
};

if (asJson) {
  for (const r of Object.values(results)) delete r.errors;
  console.log(JSON.stringify(results, null, 2));
} else {
  const pct = (x) => (100 * x).toFixed(0).padStart(3) + "%";
  for (const [split, r] of Object.entries(results)) {
    console.log(`\n${split.toUpperCase()} (${r.messages} messages): field accuracy ${pct(r.fieldAccuracy)}`);
    console.log("  " + FIELDS.map((f) => `${f} ${pct(r.perField[f])}`).join(" · "));
    console.log(`  auto-filed ${r.auto} (fully correct ${r.autoAllCorrect}) · review ${r.review} · ignored ${r.ignored}`);
    if (showErrors) for (const e of r.errors) console.log(`    ${e.id} ${e.field}: expected ${JSON.stringify(e.expected)}, got ${JSON.stringify(e.got)}`);
  }
}
