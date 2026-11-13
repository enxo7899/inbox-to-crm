// Rule-based extraction of CRM fields from messy EN / IT / AL messages.
// Deterministic and free to run; anything it isn't confident about is sent to
// a review queue (or, in production, to the LLM extractor in llm/).

export const FIELDS = ["name", "email", "phone", "language", "intent", "property_type", "budget", "currency", "city", "bedrooms"];

export function fold(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ------------------------------------------------------------------ language
const LANG_WORDS = {
  en: "the and i to a is my for in looking want can you hi hello please would we our thanks regards apartment flat bed budget rent buy".split(" "),
  it: "il la di che e un una per sono vorrei cerco mi buongiorno ciao salve grazie saluti appartamento affitto camere casa posso".split(" "),
  sq: "dhe nje te ne per me eshte jam dua kerkoj pershendetje faleminderit apartament qera shtepi buxheti a mund sa keni ketu".split(" "),
};
export function detectLanguage(text) {
  const words = fold(text).split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return null;
  const score = {};
  for (const [lang, list] of Object.entries(LANG_WORDS)) {
    const set = new Set(list);
    score[lang] = words.filter((w) => set.has(w)).length;
  }
  const [best, n] = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return n === 0 ? null : best;
}

// ------------------------------------------------------------------ contact
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NO_REPLY = /^(no-?reply|news|newsletter|info|notifications?|mailer-daemon)@/i;

export function extractEmail(text) {
  const all = (text.match(EMAIL_RE) || []).map((e) => e.toLowerCase());
  return all.find((e) => !NO_REPLY.test(e)) ?? null;
}

export function normalisePhone(raw) {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+")) return d.length >= 10 && d.length <= 16 ? d : null;
  if (/^06\d{8}$/.test(d)) return "+355" + d.slice(1); // Albanian mobile
  if (/^3\d{8,9}$/.test(d)) return "+39" + d; // Italian mobile
  if (/^07\d{9}$/.test(d)) return "+44" + d.slice(1); // UK mobile
  return null;
}

export function extractPhone(text) {
  const candidates = text.match(/(?:\+|00)?\d[\d\s().-]{7,18}\d/g) || [];
  for (const c of candidates) {
    if (/^\d{1,3}[.,]\d{3}/.test(c.trim())) continue; // looks like a price
    const p = normalisePhone(c);
    if (p) return p;
  }
  return null;
}

// ------------------------------------------------------------------ name
const SIGNOFF = /^(thanks|thank you|best|best regards|regards|kind regards|cheers|cordiali saluti|saluti|grazie|distinti saluti|faleminderit|me respekt|pershendetje)[,!.]?$/i;
const NOT_NAMES = new Set(["hi", "hello", "ciao", "salve", "tel", "phone", "subject", "oggetto", "from"]);

function titleCase(s) {
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
function cleanName(s) {
  if (!s) return null;
  const n = s.replace(/["<>]/g, "").replace(/\s+/g, " ").trim();
  if (!n || /[@\d]/.test(n) || n.split(" ").length > 4 || NOT_NAMES.has(n.toLowerCase())) return null;
  if (/^(newsletter|no-?reply|notifications?)$/i.test(n)) return null;
  return titleCase(n);
}

export function extractName(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const pick = (re) => {
    const m = text.match(re);
    return m ? cleanName(m[1]) : null;
  };
  // Form field or email header display name
  const field = pick(/^Name:[ \t]*([^\n]+)$/im);
  if (field) return field;
  const header = pick(/^From:\s*"?([^"<\n]+?)"?\s*<[^>]+>/im);
  // Self-introductions in three languages
  const intro =
    pick(/\b(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    pick(/\b(?:mi chiamo|sono)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    pick(/\b(?:quhem|une jam|unë jam|jam)\s+([A-Z][a-zë]+(?:\s+[A-Z][a-zë]+)?)/) ||
    pick(/\b([A-Z][a-z]+)\s+(?:here|ketu|këtu)\b/) ||
    pick(/\b(?:its|it's)\s+([a-z]+)\s*$/i);
  // Line after a sign-off
  let signed = null;
  for (let i = 0; i < lines.length - 1; i++) {
    if (SIGNOFF.test(lines[i])) {
      signed = cleanName(lines[i + 1]);
      if (signed) break;
    }
  }
  // Prefer the fullest version of the name we found
  const found = [header, intro, signed].filter(Boolean);
  if (!found.length) {
    // Trailing "Name 069..." on WhatsApp
    const tail = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,\s]+(?:\+|00|0)\d[\d\s]{7,}\s*$/);
    return tail ? cleanName(tail[1]) : null;
  }
  return found.sort((a, b) => b.length - a.length)[0];
}

// ------------------------------------------------------------------ intent & property
const INTENT_RULES = [
  ["list", /\b(sell my|vendere la mia|vendere|te shes|dua te shes|shitje|jap me qera|dua te jap|affittare il mio|to let my|rent out)\b/],
  ["viewing", /\b(viewing|view the|view it|can we view|could we view|see the|can i see|visit|visitare|vedere|ta shoh|ta shihni|te shoh)\b/],
  ["rent", /\b(rent|renting|rental|let|affitto|in affitto|qera|me qera|qira|me qira|holiday let)\b/],
  ["buy", /\b(buy|buying|purchase|acquisto|acquistare|comprare|blej|blerje|te marr|invest|how much|sa kushton|cmimi|price)\b/],
];
export function extractIntent(text, property) {
  const t = fold(text);
  if (/unsubscribe|log in to see|newsletter|new views/.test(t)) return "other";
  for (const [intent, re] of INTENT_RULES) if (re.test(t)) {
    // "sa kushton zyra" for an office usually means rent
    if (intent === "buy" && property === "office" && !/blej|blerje|buy/.test(t)) return "rent";
    return intent;
  }
  return property ? "buy" : "other";
}

const PROPERTY_RULES = [
  ["office", /\b(office|ufficio|zyre|zyra|zyren)\b/],
  ["shop", /\b(shop|retail|negozio|dyqan)\b/],
  ["land", /\b(land|plot|terreno|toke|token|truall)\b/],
  ["villa", /\b(villa|ville|vile|vila|house|casa|shtepi|shtepine)\b/],
  ["apartment", /\b(apartment|apartments|flat|flats|appartamento|monolocale|bilocale|apartament|apartamentin|apartamenti|\d\+1|\d bed)\b/],
];
export function extractProperty(text) {
  const t = fold(text);
  for (const [type, re] of PROPERTY_RULES) if (re.test(t)) return type;
  return null;
}

// ------------------------------------------------------------------ budget
const CURRENCY = [
  ["EUR", /€|\beur\b|\beuro\b|\beuros\b/],
  ["GBP", /£|\bgbp\b|\bpounds?\b/],
  ["USD", /\$|\busd\b|\bdollars?\b/],
  ["ALL", /\bleke\b|\blek\b|\ball\b(?=\s|$|\/)/],
];
export function extractBudget(text) {
  const t = fold(text).replace(/(\d)[ ](?=\d{3}\b)/g, "$1"); // "50 000" -> "50000"
  const re = /(€|£|\$)?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|mila|mije|mij|milion|million|mln)?\s?(€|£|\$|eur(?:os?)?|euro|gbp|usd|leke|lek)?/g;
  let best = null;
  for (const m of t.matchAll(re)) {
    const [whole, pre, num, mult, post] = m;
    const ctxStart = Math.max(0, m.index - 30);
    const ctx = t.slice(ctxStart, m.index + whole.length + 25);
    const hasMoneyWord = /budget|buxhet|max|massimo|deri|up to|around|about|rreth|fino|€|£|\$|euro|eur|leke|lek|price|cmim|month|mese|muaj/.test(ctx);
    if (!pre && !post && !mult && !hasMoneyWord) continue;
    if (/^0\d/.test(num) || /\+\d$/.test(t.slice(m.index, m.index + 3))) continue; // phone or 2+1
    if (/\d\s?(m2|mq|sqm)/.test(whole + t.slice(m.index + whole.length, m.index + whole.length + 3))) continue;
    let n = /^\d{1,3}([.,]\d{3})+$/.test(num) ? Number(num.replace(/[.,]/g, "")) : Number(num.replace(",", "."));
    if (mult === "k" || mult === "mila" || mult === "mije" || mult === "mij") n *= 1000;
    if (["milion", "million", "mln"].includes(mult)) n *= 1_000_000;
    if (n < 100) continue; // bedrooms, days, people
    const sym = pre || post || "";
    let currency = null;
    for (const [code, cre] of CURRENCY) if (cre.test(sym)) currency = code;
    if (!currency) for (const [code, cre] of CURRENCY) if (cre.test(ctx)) { currency = code; break; }
    if (!best || n > best.budget) best = { budget: n, currency };
  }
  return best ?? { budget: null, currency: null };
}

// ------------------------------------------------------------------ place & rooms
const CITIES = [
  ["Tirana", /\b(tirana|tirane|tiranë|blloku|bllok|komunes se parisit|rruga e kavajes)\b/],
  ["Durres", /\b(durres|durresi|durazzo)\b/],
  ["Vlore", /\b(vlore|vlora|valona)\b/],
  ["Sarande", /\b(sarande|saranda|sarandë)\b/],
  ["Shkoder", /\b(shkoder|shkodra|scutari)\b/],
];
export function extractCity(text) {
  const t = fold(text);
  let best = null;
  for (const [city, re] of CITIES) {
    const m = t.match(re);
    if (m && (best === null || m.index < best.index)) best = { city, index: m.index };
  }
  return best?.city ?? null;
}

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, una: 1, due: 2, tre: 3, quattro: 4, nje: 1, dy: 2 };
export function extractBedrooms(text) {
  const t = fold(text);
  let m = t.match(/\b(\d)\+1\b/);
  if (m) return Number(m[1]);
  m = t.match(/\b(\d|one|two|three|four|five|una|due|tre|quattro|nje|dy)[\s-]*(bed|beds|bedroom|bedrooms|camere|camera|dhoma)\b/);
  if (m) return WORD_NUM[m[1]] ?? Number(m[1]);
  return null;
}

// ------------------------------------------------------------------ main
// Remove phone numbers before looking for prices, so "+39 347 112 2334"
// isn't read as a budget of 39,347.
function withoutPhones(text) {
  return text.replace(/(?:\+|00)?\d[\d\s().-]{7,18}\d/g, (m) => (normalisePhone(m) ? " " : m));
}

export function extract(raw) {
  const text = String(raw || "");
  const property_type = extractProperty(text);
  const { budget, currency } = extractBudget(withoutPhones(text));
  const record = {
    name: extractName(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    language: detectLanguage(text),
    intent: extractIntent(text, property_type),
    property_type,
    budget,
    currency,
    city: extractCity(text),
    bedrooms: extractBedrooms(text),
  };
  if (record.intent === "other") {
    // Notifications, newsletters, emoji: keep nothing but the language.
    for (const f of FIELDS) if (f !== "language") record[f] = f === "intent" ? "other" : null;
  }
  return { ...record, ...review(record, text) };
}

/** Decide whether a person needs to look at this record before it enters the CRM. */
export function review(r, text) {
  const reasons = [];
  if (r.intent === "other") return { status: "ignored", reasons: ["not a customer enquiry"] };
  if (!r.email && !r.phone) reasons.push("no contact details");
  if (!r.name) reasons.push("no name");
  if (r.budget && !r.currency) reasons.push("budget without currency");
  if (/\b(or|o|ose)\b/.test(fold(text)) && r.city && /saranda or vlora|vlora or saranda/i.test(text)) reasons.push("more than one city");
  return { status: reasons.length ? "review" : "auto", reasons };
}
