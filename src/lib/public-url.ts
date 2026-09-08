// Is this URL safe for the SERVER to fetch on a stranger's behalf?
//
// `POST /api/analyze` takes a URL from an unauthenticated caller and fetches
// it. That is server-side request forgery by construction unless the target is
// checked: from inside the box, `http://127.0.0.1:5432`, `http://localhost:9000`
// and — on any cloud host — `http://169.254.169.254/latest/meta-data/` are all
// reachable, and the fetched body comes back to the caller inside the analysis.
//
// Two things make this harder than a string check, and both are the reason this
// file exists rather than a regex at the call site:
//
//   1. THE HOSTNAME LIES. `http://spoof.example.com` can resolve to 127.0.0.1.
//      Only the resolved ADDRESS says where a request actually goes, so the
//      check has to happen after DNS.
//   2. REDIRECTS RE-OPEN IT. A perfectly public URL may answer 302 to
//      `http://169.254.169.254/`, and `redirect: "follow"` takes it. Validating
//      the first URL and then following redirects blindly checks the one hop
//      that was never the risk.
//
// So: resolve, judge every address, and re-judge on every hop.

import { lookup } from "node:dns/promises";
import net from "node:net";

/** Blocked v4 ranges, as [network, prefix-length] over a 32-bit integer. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // RFC6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — cloud metadata lives at 169.254.169.254
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const value = v4ToInt(ip);
  return BLOCKED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (v4ToInt(network) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const address = ip.toLowerCase().split("%")[0]; // strip any zone id

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms reach the v4
  // stack, so they must be judged by the v4 rules — checking only the v6
  // prefixes here would wave loopback straight through.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);

  if (address === "::" || address === "::1") return true; // unspecified, loopback
  if (/^f[cd]/.test(address)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(address)) return true; // fe80::/10 link-local
  if (/^ff/.test(address)) return true; // ff00::/8 multicast
  return false;
}

/** True when this literal address must never be fetched from the server. */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedV4(ip);
  if (version === 6) return isBlockedV6(ip);
  // Not an IP at all — the caller resolved something wrong. Refuse rather than
  // guess: an unrecognised value must not become an allow.
  return true;
}

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/**
 * Throw unless `url` is an http(s) URL whose hostname resolves ONLY to public
 * addresses.
 *
 * Every resolved address is checked, not just the first: a hostname with an
 * A record on the public internet and a AAAA record on ::1 would otherwise
 * pass, and which one the fetch actually uses is the resolver's business, not
 * ours to predict.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedUrlError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError("URL must use http or https");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]

  // A literal address needs no DNS, and must not be handed to the resolver.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedUrlError(`Refusing to fetch a private or reserved address (${hostname})`);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError(`Could not resolve ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError(`Could not resolve ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedUrlError(
        `Refusing to fetch ${hostname} — it resolves to a private or reserved address (${address})`,
      );
    }
  }
}
