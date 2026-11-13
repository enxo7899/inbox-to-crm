// Optional second pass: send review-queue messages to Claude for extraction
// with a strict JSON schema. The rule-based extractor handles the bulk for
// free; the model only sees messages the rules weren't sure about.
//
//   ANTHROPIC_API_KEY=... node llm/extract-llm.js
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { buildCrm } from "../src/crm.js";
import { FIELDS } from "../src/extract.js";

const nullable = (type) => ({ anyOf: [{ type }, { type: "null" }] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: FIELDS,
  properties: {
    name: nullable("string"),
    email: nullable("string"),
    phone: { ...nullable("string"), description: "E.164, e.g. +355691234567" },
    language: { anyOf: [{ type: "string", enum: ["en", "it", "sq"] }, { type: "null" }] },
    intent: { type: "string", enum: ["buy", "rent", "list", "viewing", "other"] },
    property_type: { anyOf: [{ type: "string", enum: ["apartment", "villa", "office", "shop", "land"] }, { type: "null" }] },
    budget: nullable("number"),
    currency: { anyOf: [{ type: "string", enum: ["EUR", "ALL", "GBP", "USD"] }, { type: "null" }] },
    city: { anyOf: [{ type: "string", enum: ["Tirana", "Durres", "Vlore", "Sarande", "Shkoder"] }, { type: "null" }] },
    bedrooms: nullable("integer"),
  },
};

const client = new Anthropic();

export async function extractWithClaude(raw) {
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system:
      "You extract CRM fields from messages sent to a real-estate agency in Albania (English, Italian or Albanian). " +
      "'list' means the sender owns a property and wants to sell or let it. A 2+1 apartment has 2 bedrooms. " +
      "Use null for anything not stated. Never guess contact details.",
    messages: [{ role: "user", content: raw }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b) => b.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL("../data/messages.json", import.meta.url)));
  const { review } = buildCrm(data);
  for (const m of review) {
    console.log(m.id, m.extracted.reasons.join(", "));
    console.log("  rules :", JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, m.extracted[f]]))));
    console.log("  claude:", JSON.stringify(await extractWithClaude(m.raw)));
  }
}
