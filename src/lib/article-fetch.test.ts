/**
 * article-fetch turns a URL into the plain text every downstream stage reasons
 * about: the LLM prompt, the displayed title, the >=200-char gate in
 * analysis.ts. When entity decoding is incomplete nothing throws — the article
 * simply reaches the model as `Der W&auml;hler`, and the analysis quietly gets
 * worse. That silence is why this file exists.
 *
 * It has now been the bug twice: #12 fixed WHERE decoding ran (title as well as
 * body) but left WHAT it covered at six named entities and no hex escapes at
 * all. The fix is to stop hand-copying the WHATWG table into app code; these
 * tests are the gate that keeps it gone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArticle } from "./article-fetch";

/** Serve one canned HTML response to the next fetchArticle call. */
function stubPage(html: string, contentType: string | null = "text/html; charset=utf-8") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      headers: { get: () => contentType },
      text: async () => html,
    })),
  );
}

/**
 * fetchArticle does not strip <head>, so a <title> legitimately shows up at the
 * front of the extracted body too. Body assertions therefore use a page with no
 * <title>, and title assertions use one with no competing body prose — keeping
 * each test about one thing.
 */
const page = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const bodyOnly = (body: string) => page("", body);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("entity decoding", () => {
  it("decodes German named entities — the publications this tool targets are German-language", async () => {
    stubPage(
      page("<title>Der W&auml;hler</title>", "<p>&Uuml;ber die Stra&szlig;e, sagte er.</p>"),
    );
    const article = await fetchArticle("https://republik.ch/a");
    expect(article.title).toBe("Der Wähler");
    expect(article.text).toContain("Über die Straße, sagte er.");
    expect(article.text).not.toContain("&");
  });

  it("decodes hex numeric entities, not just decimal", async () => {
    stubPage(
      page(
        "<title>Trump&#x27;s plan</title>",
        "<p>10&#xa0;000 Franken &#x2014; l&#xe9;conomie</p>",
      ),
    );
    const article = await fetchArticle("https://example.com/a");
    expect(article.title).toBe("Trump's plan");
    expect(article.text).toContain("10 000 Franken — léconomie");
  });

  it("decodes typographic named entities", async () => {
    stubPage(bodyOnly("<p>It&rsquo;s a &ldquo;quote&rdquo; &mdash; really&hellip;</p>"));
    const { text } = await fetchArticle("https://example.com/a");
    expect(text).toBe("It’s a “quote” — really…");
  });

  it("decodes astral code points as one character instead of mangling them", async () => {
    stubPage(bodyOnly("<p>climate &#128293; crisis</p>"));
    const { text } = await fetchArticle("https://example.com/a");
    expect(text).toBe("climate 🔥 crisis");
  });

  it("decodes exactly once, so an escaped entity stays escaped", async () => {
    stubPage(bodyOnly("<p>write &amp;lt; for a less-than sign</p>"));
    const { text } = await fetchArticle("https://example.com/a");
    expect(text).toBe("write &lt; for a less-than sign");
  });

  it("leaves a bare ampersand alone", async () => {
    stubPage(bodyOnly("<p>AT&T and R&D spending</p>"));
    const { text } = await fetchArticle("https://example.com/a");
    expect(text).toBe("AT&T and R&D spending");
  });

  it("applies identical decoding to title and body", async () => {
    const entity = "&uuml;ber &amp; &#x27;so&#x27;";
    stubPage(page(`<title>${entity}</title>`, ""));
    const article = await fetchArticle("https://example.com/a");
    expect(article.title).toBe("über & 'so'");
    expect(article.text).toBe(article.title);
  });
});

describe("text extraction", () => {
  it("strips scripts, styles and chrome out of the body", async () => {
    stubPage(
      page(
        "<style>.a{color:red}</style>",
        "<nav>Home Politics Sport</nav><script>var x = 1 < 2;</script><p>The real body.</p><footer>Impressum</footer>",
      ),
    );
    const { text } = await fetchArticle("https://example.com/a");
    expect(text).toBe("The real body.");
  });

  it("falls back to the first h1 when there is no title tag", async () => {
    stubPage(page("", "<h1>Headline &amp; subhead</h1><p>Body text here.</p>"));
    const { title } = await fetchArticle("https://example.com/a");
    expect(title).toBe("Headline & subhead");
  });

  it("collapses whitespace in a multi-line title", async () => {
    stubPage(page("<title>\n  A long\n  headline\n</title>", "<p>Body.</p>"));
    const { title } = await fetchArticle("https://example.com/a");
    expect(title).toBe("A long headline");
  });

  it("returns a null title rather than an empty string when there is none", async () => {
    stubPage(page("", "<p>Body only.</p>"));
    const { title } = await fetchArticle("https://example.com/a");
    expect(title).toBeNull();
  });

  it("reports textLength consistent with the cleaned text", async () => {
    stubPage(bodyOnly("<p>Stra&szlig;e</p>"));
    const { text, textLength } = await fetchArticle("https://example.com/a");
    expect(textLength).toBe(text.length);
    expect(textLength).toBe("Straße".length);
  });
});

describe("content-type guard", () => {
  it("rejects a PDF before an LLM call is spent on its binary bytes", async () => {
    stubPage("%PDF-1.4 binary junk", "application/pdf");
    await expect(fetchArticle("https://example.com/a.pdf")).rejects.toThrow(/non-HTML content/);
  });

  it("accepts a missing content-type rather than guessing", async () => {
    stubPage(bodyOnly("<p>Body text.</p>"), null);
    const { text } = await fetchArticle("https://example.com/a");
    expect(text).toBe("Body text.");
  });
});
