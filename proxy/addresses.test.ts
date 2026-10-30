// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { embeddedIPv4, isBlockedAddress, parseIPv6 } from './addresses.ts';

describe('isBlockedAddress', () => {
  it.each([
    // IPv4 ranges
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.10',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    // IPv6 ranges
    '::',
    '::1',
    'fc00::1',
    'fd7a:115c:a1e0::1',
    'fe80::1',
    'ff02::1',
    '100::1',
    '2001:db8::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '64:ff9b:1::1',
    // Embedded IPv4
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::10.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '2002:c0a8:0101::1',
    '2002:7f00:0001::',
    // Not an IP at all: fail closed
    'localhost',
    '',
    'fe80::1%eth0',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',
    '100.128.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.169.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4003:80b::200e',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:0808:0808::1',
  ])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('IPv6 helpers', () => {
  it('expands compressed and dotted forms', () => {
    expect(Array.from(parseIPv6('::ffff:1.2.3.4') ?? [])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 1, 2, 3, 4,
    ]);
    expect(parseIPv6('1.2.3.4')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
  });

  it('extracts the embedded IPv4 address', () => {
    const v4 = (address: string) => embeddedIPv4(parseIPv6(address) ?? new Uint8Array(16));
    expect(v4('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(v4('64:ff9b::c0a8:101')).toBe('192.168.1.1');
    expect(v4('2002:0a00:0001:1::1')).toBe('10.0.0.1');
    expect(v4('2606:4700::1')).toBeNull();
  });
});
