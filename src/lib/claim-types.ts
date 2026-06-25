// SSOT for how the three claim types present in the UI.
// The claim-type color coding (factual / normative / causal) is truthseeker's
// signature visual language — defined once here and consumed everywhere a claim,
// tag, or source attribution is rendered. Colors resolve to CSS vars in
// globals.css; this module only references the semantic Tailwind class names.

import type { CoreClaim } from "./analysis";

type ClaimType = CoreClaim["type"];

interface ClaimTypeStyle {
  label: string;
  /** One-line gloss shown on the empty-state legend — teaches the taxonomy. */
  gloss: string;
  /** Left-edge accent border-color utility for claim cards. */
  border: string;
  /** Text color utility for the type name. */
  text: string;
  /** Soft tinted chip background + text for the type tag. */
  chip: string;
  /** The legend dot marker color. */
  dot: string;
}

export const CLAIM_TYPES: Record<ClaimType, ClaimTypeStyle> = {
  factual: {
    label: "factual",
    gloss: "verifiable against the record",
    border: "border-l-factual",
    text: "text-factual",
    chip: "bg-factual-soft text-factual",
    dot: "bg-factual",
  },
  normative: {
    label: "normative",
    gloss: "a value judgment — what should be",
    border: "border-l-normative",
    text: "text-normative",
    chip: "bg-normative-soft text-normative",
    dot: "bg-normative",
  },
  causal: {
    label: "causal",
    gloss: "a claimed cause-and-effect chain",
    border: "border-l-causal",
    text: "text-causal",
    chip: "bg-causal-soft text-causal",
    dot: "bg-causal",
  },
};

export const CLAIM_TYPE_ORDER: ClaimType[] = ["factual", "normative", "causal"];
