/**
 * claim-types.ts is the SSOT for truthseeker's signature visual language: the
 * factual / normative / causal colour coding that every claim card, chip, tag
 * and legend dot is rendered from. Its own header says so.
 *
 * The risk it carries is a SEAM, not a bug in either file. This module names
 * semantic Tailwind classes (`bg-factual-soft`, `border-l-causal`); the values
 * behind them are CSS custom properties in globals.css. Rename or drop a token
 * on one side and nothing errors — Tailwind emits a class whose colour resolves
 * to nothing, and the chip renders transparent. It looks like a CSS bug, in a
 * different file, days later.
 *
 * Nothing executed this repo's source before: `verify` was lint + typecheck and
 * there was no test script at all.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLAIM_TYPES, CLAIM_TYPE_ORDER } from "./claim-types";

const globalsCss = fs.readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");

/** Custom properties defined anywhere in globals.css. */
const definedVars = new Set(
  [...globalsCss.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)].map((m) => m[2]),
);

/**
 * Colour-bearing utility prefixes used by this module. The token name is
 * whatever follows, and must exist as `--color-<token>`.
 */
const COLOUR_PREFIXES = ["border-l-", "bg-", "text-"];

/** Every colour token referenced by a style object's class strings. */
function tokensIn(classNames: string[]): string[] {
  const tokens: string[] = [];
  for (const cls of classNames.flatMap((c) => c.split(/\s+/)).filter(Boolean)) {
    const prefix = COLOUR_PREFIXES.find((p) => cls.startsWith(p));
    if (!prefix) continue;
    const token = cls.slice(prefix.length);
    // `text-white` and friends are Tailwind built-ins, not project tokens.
    if (["white", "black", "transparent", "current", "inherit"].includes(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

describe("claim-type colour tokens", () => {
  it("references at least one token per claim type (parser sanity)", () => {
    for (const [type, style] of Object.entries(CLAIM_TYPES)) {
      const tokens = tokensIn([style.border, style.text, style.chip, style.dot]);
      expect(tokens.length, `no colour tokens parsed for "${type}"`).toBeGreaterThan(0);
    }
  });

  it("every class it names resolves to a --color-* defined in globals.css", () => {
    const missing: string[] = [];
    for (const [type, style] of Object.entries(CLAIM_TYPES)) {
      for (const token of tokensIn([style.border, style.text, style.chip, style.dot])) {
        if (!definedVars.has(`--color-${token}`)) missing.push(`${type}: --color-${token}`);
      }
    }
    expect(
      missing,
      `claim-types.ts names utilities whose colour token globals.css does not define:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("CLAIM_TYPE_ORDER", () => {
  it("covers exactly the keys of CLAIM_TYPES", () => {
    // Drift here is silent in the UI: a type missing from the order simply
    // never renders in the legend, and an extra one renders undefined styling.
    expect([...CLAIM_TYPE_ORDER].sort()).toEqual(Object.keys(CLAIM_TYPES).sort());
  });

  it("has no duplicates", () => {
    expect(new Set(CLAIM_TYPE_ORDER).size).toBe(CLAIM_TYPE_ORDER.length);
  });
});

describe("CLAIM_TYPES entries", () => {
  it("every type has a non-empty label and gloss", () => {
    // The gloss is what teaches the taxonomy on the empty state — an empty one
    // ships a legend that explains nothing.
    for (const [type, style] of Object.entries(CLAIM_TYPES)) {
      expect(style.label.trim(), `${type} label`).not.toBe("");
      expect(style.gloss.trim(), `${type} gloss`).not.toBe("");
    }
  });

  it("labels match their key, so the UI never disagrees with the data", () => {
    for (const [type, style] of Object.entries(CLAIM_TYPES)) {
      expect(style.label).toBe(type);
    }
  });
});
