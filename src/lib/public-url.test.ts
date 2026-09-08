/**
 * `POST /api/analyze` takes a URL from an unauthenticated stranger and the
 * SERVER fetches it. From inside the box that reaches Postgres on 127.0.0.1,
 * anything else listening on localhost, and — on a cloud host —
 * 169.254.169.254, whose response comes back to the caller inside the analysis.
 *
 * Two of these tests are the whole point, because a naive guard passes the
 * others while failing them: a hostname that RESOLVES to a private address, and
 * a public URL that REDIRECTS to one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { isBlockedAddress } from "./public-url";

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and reserved v4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata — the one that leaks credentials
      "100.64.0.1", // carrier-grade NAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public v4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks v6 loopback, unique-local, link-local and multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks IPv4-MAPPED v6, which reaches the v4 stack", () => {
    // ::ffff:127.0.0.1 is loopback wearing a v6 costume. A guard that checks
    // only the v6 prefixes waves it straight through.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows ordinary public v6", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("refuses anything that is not an address at all", () => {
    // An unrecognised value must never become an allow.
    for (const value of ["", "not-an-ip", "127.0.0.1.evil.com", "999.1.1.1"]) {
      expect(isBlockedAddress(value), value).toBe(true);
    }
  });
});

describe("assertPublicUrl", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:dns/promises");
  });

  async function withLookup(addresses: Array<{ address: string; family: number }>) {
    vi.doMock("node:dns/promises", () => ({ lookup: async () => addresses }));
    return (await import("./public-url")).assertPublicUrl;
  }

  it("allows a hostname that resolves to a public address", async () => {
    const assertPublicUrl = await withLookup([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicUrl("https://example.com/article")).resolves.toBeUndefined();
  });

  it("blocks a hostname that RESOLVES to a private address", async () => {
    // The attack a string check cannot see: the hostname is public-looking and
    // DNS points it at localhost.
    const assertPublicUrl = await withLookup([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicUrl("https://totally-normal.example.com/")).rejects.toThrow(
      /private or reserved/,
    );
  });

  it("blocks when ANY resolved address is private, not just the first", async () => {
    // Which record the fetch uses is the resolver's business. A host with a
    // public A and a loopback AAAA must not pass on the strength of the A.
    const assertPublicUrl = await withLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "::1", family: 6 },
    ]);
    await expect(assertPublicUrl("https://dual.example.com/")).rejects.toThrow(
      /private or reserved/,
    );
  });

  it("blocks a literal private address without consulting DNS", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => {
        throw new Error("DNS must not be called for a literal address");
      },
    }));
    const { assertPublicUrl } = await import("./public-url");

    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private or reserved/,
    );
    await expect(assertPublicUrl("http://[::1]:8080/")).rejects.toThrow(/private or reserved/);
  });

  it("refuses non-http schemes", async () => {
    const { assertPublicUrl } = await import("./public-url");
    for (const url of ["file:///etc/passwd", "gopher://x/", "ftp://x/"]) {
      await expect(assertPublicUrl(url), url).rejects.toThrow(/http or https/);
    }
  });

  it("refuses a hostname that does not resolve", async () => {
    vi.doMock("node:dns/promises", () => ({
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
    }));
    const { assertPublicUrl } = await import("./public-url");
    await expect(assertPublicUrl("https://nope.invalid/")).rejects.toThrow(/Could not resolve/);
  });
});
