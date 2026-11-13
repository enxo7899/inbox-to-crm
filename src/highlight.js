// Finds where each extracted value appears in the original message, so a person
// can check an extraction at a glance. Used by the demo page; no effect on extraction.
import { fold, normalisePhone, CITIES, PROPERTY_RULES, INTENT_RULES } from "./extract.js";

const PHONE_RE = /(?:\+|00)?\d[\d\s().-]{7,18}\d/g;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMWORD = "\\d|one|two|three|four|five|una|due|tre|quattro|nje|dy";

/** Returns [{field, start, end}] sorted by start, never overlapping. */
export function findSpans(raw, r) {
  const text = String(raw || "");
  const t = fold(text); // same length as text for precomposed characters
  const spans = [];
  const free = (s, e) => !spans.some((x) => s < x.end && e > x.start);
  const place = (field, re, src = t) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of src.matchAll(g)) {
      if (!m[0]) continue;
      const s = m.index, e = s + m[0].length;
      if (free(s, e)) { spans.push({ field, start: s, end: e }); return true; }
    }
    return false;
  };

  if (r.email) place("email", new RegExp(esc(fold(r.email))));
  if (r.phone) {
    for (const m of text.matchAll(PHONE_RE)) {
      const s = m.index, e = s + m[0].length;
      if (normalisePhone(m[0]) === r.phone && free(s, e)) { spans.push({ field: "phone", start: s, end: e }); break; }
    }
  }
  if (r.name && !place("name", new RegExp(`\\b${esc(fold(r.name))}\\b`))) {
    for (const part of r.name.split(/\s+/)) if (part.length > 2) place("name", new RegExp(`\\b${esc(fold(part))}\\b`));
  }
  if (r.budget) {
    const n = r.budget, k = n / 1000, forms = [n.toLocaleString("en"), n.toLocaleString("en").replace(/,/g, "."), n.toLocaleString("en").replace(/,/g, " "), String(n)];
    if (Number.isInteger(k)) forms.push(`${k}\\s?k`, `${k}\\s?mila`, `${k}\\s?mij[eë]?`);
    place("budget", new RegExp(`(€|£|\\$)?\\s?(${forms.map((f) => f.includes("\\") ? f : esc(f)).join("|")})(\\s?(€|£|\\$|eur(os?)?\\b|euro\\b|gbp\\b|usd\\b|leke\\b|lek\\b))?`));
  }
  if (r.city) { const rule = CITIES.find(([c]) => c === r.city); if (rule) place("city", rule[1]); }
  if (r.bedrooms) place("bedrooms", new RegExp(`\\b\\d\\+1\\b|\\b(${NUMWORD})[\\s-]*(bed|beds|bedroom|bedrooms|camere|camera|dhoma)\\b`));
  if (r.property_type) { const rule = PROPERTY_RULES.find(([p]) => p === r.property_type); if (rule) place("property_type", rule[1]); }
  if (r.intent) { const rule = INTENT_RULES.find(([i]) => i === r.intent); if (rule) place("intent", rule[1]); }
  return spans.sort((a, b) => a.start - b.start);
}
