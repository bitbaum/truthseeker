import { describe, it, expect } from "vitest";
import { capturePaste, pasteFor, NO_PASTE } from "./pasted-body";

const ARTICLE = "…twenty thousand characters of Republik prose…";

describe("pasteFor", () => {
  it("returns nothing before anything is pasted", () => {
    expect(pasteFor(NO_PASTE, "https://republik.ch/a")).toBe("");
  });

  it("returns the body under the URL it was captured for", () => {
    const paste = capturePaste("https://republik.ch/a", ARTICLE);
    expect(pasteFor(paste, "https://republik.ch/a")).toBe(ARTICLE);
  });

  // #11: a body rescued for one article must never be analyzed under another.
  it("withholds the body once the URL changes", () => {
    const paste = capturePaste("https://republik.ch/a", ARTICLE);
    expect(pasteFor(paste, "https://nzz.ch/b")).toBe("");
  });

  // The regression this module was written for: submitting must not consume
  // the body, or the "retry — it's a model quirk" advice cannot be followed.
  it("still holds the body after the submission that used it failed", () => {
    const paste = capturePaste("https://republik.ch/a", ARTICLE);
    const sent = pasteFor(paste, "https://republik.ch/a");
    expect(sent).toBe(ARTICLE);
    // …LLM chain exhausted; the reader clicks Examine again on the same URL.
    expect(pasteFor(paste, "https://republik.ch/a")).toBe(ARTICLE);
  });

  it("treats surrounding whitespace in the input as the same article", () => {
    const paste = capturePaste("https://republik.ch/a", ARTICLE);
    expect(pasteFor(paste, "  https://republik.ch/a  ")).toBe(ARTICLE);
  });

  it("distinguishes URLs that differ only in path", () => {
    const paste = capturePaste("https://republik.ch/a", ARTICLE);
    expect(pasteFor(paste, "https://republik.ch/ab")).toBe("");
  });

  it("re-capturing under a new URL replaces the old body", () => {
    let paste = capturePaste("https://republik.ch/a", ARTICLE);
    paste = capturePaste("https://nzz.ch/b", "other body");
    expect(pasteFor(paste, "https://nzz.ch/b")).toBe("other body");
    expect(pasteFor(paste, "https://republik.ch/a")).toBe("");
  });
});
