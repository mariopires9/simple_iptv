// SSRF address policy (PRX-01, docs/SECURITY.md §4): the proxy refuses to connect to loopback,
// private, link-local, shared (CGNAT/Tailscale), documentation, benchmarking, multicast and
// reserved ranges. IPv6 addresses that embed an IPv4 address (IPv4-mapped, IPv4-compatible,
// NAT64, 6to4) are also checked against the IPv4 rules.
import { BlockList, isIP } from 'node:net';

const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // shared address space; also the Tailscale range
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4], // includes 255.255.255.255
];

const IPV6_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local; also Tailscale's fd7a:115c:a1e0::/48
  ['fe80::', 10],
  ['ff00::', 8],
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentation
  ['2001::', 32], // Teredo: embeds an obfuscated IPv4 address, never a normal server
  ['64:ff9b:1::', 48], // local-use NAT64
];

const blockList = new BlockList();
for (const [network, prefix] of IPV4_BLOCKED) blockList.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6_BLOCKED) blockList.addSubnet(network, prefix, 'ipv6');

/** Expands an IPv6 address (without zone) to 16 bytes, or `null` if it is not valid IPv6. */
export function parseIPv6(address: string): Uint8Array | null {
  if (isIP(address) !== 6 || address.includes('%')) return null;
  let text = address.toLowerCase();
  const words: number[] = [];
  // A dotted IPv4 tail becomes the last two 16-bit words.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const headWords = head === '' ? [] : head.split(':');
  const restWords = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? 0 : 8 - headWords.length - restWords.length;
  for (const word of headWords) words.push(parseInt(word, 16));
  for (let i = 0; i < fill; i++) words.push(0);
  for (const word of restWords) words.push(parseInt(word, 16));
  if (words.length !== 8 || words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) {
    return null;
  }
  const bytes = new Uint8Array(16);
  words.forEach((word, i) => {
    bytes[i * 2] = word >> 8;
    bytes[i * 2 + 1] = word & 0xff;
  });
  return bytes;
}

const ipv4At = (bytes: Uint8Array, offset: number): string =>
  Array.from(bytes.subarray(offset, offset + 4)).join('.');

/**
 * The IPv4 address embedded in an IPv6 address, if any: IPv4-mapped `::ffff:0:0/96`,
 * IPv4-compatible `::/96`, NAT64 `64:ff9b::/96` (last 32 bits) or 6to4 `2002::/16` (bits 16–48).
 */
export function embeddedIPv4(bytes: Uint8Array): string | null {
  const zeros = (from: number, to: number) => bytes.subarray(from, to).every((b) => b === 0);
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return ipv4At(bytes, 12);
  if (zeros(0, 12)) return ipv4At(bytes, 12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (zeros(4, 12)) return ipv4At(bytes, 12);
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4At(bytes, 2);
  return null;
}

/** True when the proxy must refuse to connect to `address` (an IP literal). Fails closed. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockList.check(address, 'ipv4');
  if (family !== 6) return true;
  const bytes = parseIPv6(address);
  if (bytes === null) return true;
  if (blockList.check(address, 'ipv6')) return true;
  const v4 = embeddedIPv4(bytes);
  return v4 !== null && blockList.check(v4, 'ipv4');
}

/** Address policy: returns true when connecting to `address` is allowed. */
export type AddressPolicy = (address: string) => boolean;

export const defaultAddressPolicy: AddressPolicy = (address) => !isBlockedAddress(address);
