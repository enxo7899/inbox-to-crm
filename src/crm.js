// Turns extracted messages into CRM contacts: the same person writing by
// email, WhatsApp and the web form becomes one contact with one timeline.
import { extract } from "./extract.js";

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) {
    if (!this.p.has(x)) this.p.set(x, x);
    const r = this.p.get(x);
    if (r === x) return x;
    const root = this.find(r);
    this.p.set(x, root);
    return root;
  }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}

const keysOf = (r) => [r.email && `e:${r.email}`, r.phone && `p:${r.phone}`].filter(Boolean);

/**
 * messages: [{id, channel, raw, receivedAt?}] in arrival order.
 * Returns {contacts, review, ignored, processed}.
 */
export function buildCrm(messages) {
  const processed = messages.map((m, i) => ({ ...m, order: i, extracted: extract(m.raw) }));
  const uf = new UnionFind();

  // Link every message to its email and phone; shared keys merge people.
  for (const m of processed) {
    const ks = keysOf(m.extracted);
    if (!ks.length) continue;
    uf.find(`m:${m.id}`);
    for (const k of ks) uf.union(`m:${m.id}`, k);
  }

  const groups = new Map();
  const review = [];
  const ignored = [];
  for (const m of processed) {
    const r = m.extracted;
    if (r.status === "ignored") { ignored.push(m); continue; }
    if (!keysOf(r).length) { review.push(m); continue; }
    const root = uf.find(`m:${m.id}`);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(m);
  }

  const contacts = [...groups.values()].map((msgs, i) => {
    msgs.sort((a, b) => a.order - b.order);
    const all = msgs.map((m) => m.extracted);
    const latest = (f) => [...all].reverse().find((r) => r[f] !== null && r[f] !== undefined)?.[f] ?? null;
    const uniq = (f) => [...new Set(all.map((r) => r[f]).filter(Boolean))];
    const names = uniq("name").sort((a, b) => b.length - a.length);
    const needsReview = msgs.some((m) => m.extracted.status === "review");
    return {
      id: `C-${String(i + 1).padStart(3, "0")}`,
      name: names[0] ?? null,
      emails: uniq("email"),
      phones: uniq("phone"),
      language: latest("language"),
      // Latest stated requirement wins: people raise budgets and change their minds.
      // A viewing request is a next step, not a change of goal.
      intent: [...all].reverse().find((r) => ["buy", "rent", "list"].includes(r.intent))?.intent ?? latest("intent"),
      next_step: all.at(-1).intent === "viewing" ? "arrange viewing" : "send options",
      property_type: latest("property_type"),
      budget: latest("budget"),
      currency: latest("currency"),
      city: latest("city"),
      bedrooms: latest("bedrooms"),
      channels: [...new Set(msgs.map((m) => m.channel))],
      messages: msgs.map((m) => m.id),
      merged: msgs.length > 1,
      status: needsReview ? "check" : "ok",
      reasons: [...new Set(msgs.flatMap((m) => m.extracted.reasons))],
    };
  });

  return { contacts, review, ignored, processed };
}

export function toCsv(contacts) {
  const cols = ["id", "name", "emails", "phones", "language", "intent", "property_type", "budget", "currency", "city", "bedrooms", "channels", "messages", "status"];
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join("; ") : v ?? "";
    return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  };
  return [cols.join(","), ...contacts.map((c) => cols.map((k) => esc(c[k])).join(","))].join("\n");
}
