// Who a pasted article body belongs to.
//
// The paste fallback exists for bot-gated sources: the fetch 403s, the reader
// copies the body out of a logged-in tab, and that text is analyzed under the
// URL it came from. Two bugs have now come out of holding that text as a bare
// string next to the URL, one in each direction:
//
//   #11  the paste was never cleared, so a body rescued for article A was
//        silently analyzed under an unrelated article B — a confident, wrong
//        analysis with nothing on screen saying the text was stale.
//   this the over-correction: clearing on every submit destroyed the body the
//        moment it was sent, so when the analysis failed with the app's own
//        "usually fixed by retrying" advice, the retry had nothing left to
//        retry with. The reader had to go back and re-copy the whole article.
//
// Both are the same defect: two pieces of state carrying one fact between them.
// Store the URL WITH the text and the stale case stops being representable —
// the body is visible exactly while its own URL is still the one in the input,
// and surviving a failed submission costs nothing extra.

export interface PastedBody {
  /** The URL that was in the input when this text was pasted. */
  forUrl: string;
  text: string;
}

export const NO_PASTE: PastedBody = { forUrl: "", text: "" };

/** URLs are compared trimmed — leading/trailing whitespace in the input is not
 *  a different article, and it is what the submit path sends anyway. */
const key = (url: string): string => url.trim();

export function capturePaste(url: string, text: string): PastedBody {
  return { forUrl: key(url), text };
}

/** The pasted body for `url`, or "" when the paste belongs to a different one. */
export function pasteFor(paste: PastedBody, url: string): string {
  return paste.forUrl === key(url) ? paste.text : "";
}
