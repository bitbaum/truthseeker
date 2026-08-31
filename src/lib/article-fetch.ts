// Fetch an article URL and reduce its HTML to plain text the LLM can
// reason about. Deliberately simple — no Mozilla Readability dependency
// (would pull in jsdom), no third-party reader API. The LLM's context
// window is large enough to absorb mild boilerplate; what we strip here
// is the noise that breaks LLM attention (script bodies, CSS, nav menus
// repeating the publication's section names 50 times).

import { decodeHTML } from "entities";

export interface FetchedArticle {
  url: string;
  /** Status code returned by the fetch. */
  status: number;
  /** Full HTTP content-type, useful for caller debugging. */
  contentType: string | null;
  /** Best-effort article title from <title> or first <h1>. */
  title: string | null;
  /** Plain-text article body — stripped of scripts/styles/nav junk. */
  text: string;
  /** Approximate length of the cleaned text, for ergonomics. */
  textLength: number;
}

// User-Agent that real browsers send. Some publications (republik.ch,
// nytimes, etc.) gate or 403 requests with obviously-bot UAs.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function fetchArticle(url: string): Promise<FetchedArticle> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Ch-Ua": '"Chromium";v="126", "Not-A.Brand";v="8"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Linux"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
    // Articles can be slow on first-byte; the LLM call has its own timeout.
    signal: AbortSignal.timeout(20_000),
  });

  const contentType = res.headers.get("content-type");
  // Reject non-HTML payloads before spending an LLM call on them. Without
  // this, a PDF or image URL silently comes back as "textLength > 200"
  // (binary bytes decoded as garbage text) and produces a nonsense analysis
  // with no visible error — the failure mode this guards against is silent,
  // not loud.
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new Error(
      `URL returned non-HTML content (content-type: ${contentType}). PDFs, images, and other non-HTML formats aren't supported yet — try a text/HTML version of the source, or paste the text directly.`,
    );
  }
  const html = await res.text();

  // Title: <title>...</title> first, else the first <h1>...</h1>.
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = htmlToText(titleMatch?.[1] ?? h1Match?.[1] ?? "").slice(0, 300) || null;

  // Strip noise then collapse whitespace. Order matters — kill scripts and
  // styles BEFORE the broad tag strip, because their CDATA can contain
  // angle brackets the broad strip would mishandle.
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  body = htmlToText(body);

  return {
    url,
    status: res.status,
    contentType,
    title,
    text: body,
    textLength: body.length,
  };
}

/**
 * An HTML fragment reduced to the plain text a reader would see: tags dropped,
 * entities decoded, whitespace collapsed. Both the title and the body go
 * through this, so they can never again disagree about what "decoded" means —
 * the split between them is what #12 had to repair.
 *
 * Decoding happens AFTER the tag strip, never before: decoding first would turn
 * an escaped `&lt;script&gt;` in the prose into a real tag for stripTags to eat.
 */
function htmlToText(fragment: string): string {
  return decodeHTML(stripTags(fragment)).replace(/\s+/g, " ").trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}
