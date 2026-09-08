/**
 * The redirect hop is the half a first-URL check misses.
 *
 * `https://safe.example.com/` is a perfectly public URL. If it answers
 * `302 Location: http://169.254.169.254/latest/meta-data/`, then
 * `redirect: "follow"` takes the server there and hands the body back to the
 * caller — and a guard that validated only the original URL never sees it.
 * Checking hop one checks the one hop that was never the risk.
 *
 * Separate from article-fetch.test.ts because these need per-test control of
 * the resolver, and that file mocks it once for the whole suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function html(title: string) {
  return new Response(
    `<html><head><title>${title}</title></head><body><p>${"word ".repeat(80)}</p></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

/** Hostnames resolve public unless a test maps them somewhere else. */
function mockDns(map: Record<string, string> = {}) {
  vi.doMock("node:dns/promises", () => ({
    lookup: async (hostname: string) => [{ address: map[hostname] ?? "93.184.216.34", family: 4 }],
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("node:dns/promises");
});

describe("fetchArticle redirect handling", () => {
  it("REFUSES a redirect into cloud metadata — and never contacts it", async () => {
    mockDns();
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("safe.example.com")
        ? redirectTo("http://169.254.169.254/latest/meta-data/")
        : html("SHOULD NEVER BE FETCHED"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchArticle } = await import("./article-fetch");

    await expect(fetchArticle("https://safe.example.com/")).rejects.toThrow(/private or reserved/);

    // Refused BEFORE the request, not after reading the response — otherwise
    // the credentials have already left the metadata service.
    const asked = fetchMock.mock.calls.map(([u]) => String(u));
    expect(asked.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("REFUSES a redirect to a hostname that resolves to loopback", async () => {
    mockDns({ "inside.example.com": "127.0.0.1" });
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("safe.example.com")
        ? redirectTo("https://inside.example.com/admin")
        : html("SHOULD NEVER BE FETCHED"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchArticle } = await import("./article-fetch");

    await expect(fetchArticle("https://safe.example.com/")).rejects.toThrow(/private or reserved/);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("follows an ordinary public redirect and attributes the FINAL url", async () => {
    mockDns();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/short")
          ? redirectTo("https://example.com/full")
          : html("The Real Headline"),
      ),
    );
    const { fetchArticle } = await import("./article-fetch");

    const article = await fetchArticle("https://example.com/short");

    expect(article.title).toBe("The Real Headline");
    // Where it actually came from, not where the caller pointed.
    expect(article.url).toBe("https://example.com/full");
  });

  it("resolves a RELATIVE Location against the current url", async () => {
    mockDns();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/a") ? redirectTo("/b") : html("Landed"),
      ),
    );
    const { fetchArticle } = await import("./article-fetch");

    expect((await fetchArticle("https://example.com/a")).url).toBe("https://example.com/b");
  });

  it("gives up on a redirect loop instead of spinning", async () => {
    mockDns();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => redirectTo("https://example.com/loop")),
    );
    const { fetchArticle } = await import("./article-fetch");

    await expect(fetchArticle("https://example.com/loop")).rejects.toThrow(/Too many redirects/);
  });

  it("refuses a private target given directly, before any request", async () => {
    mockDns();
    const fetchMock = vi.fn(async () => html("SHOULD NEVER BE FETCHED"));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchArticle } = await import("./article-fetch");

    await expect(fetchArticle("http://127.0.0.1:5432/")).rejects.toThrow(/private or reserved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
