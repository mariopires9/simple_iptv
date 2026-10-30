// Test helpers for the proxy integration tests (PRX-01). Not used by the proxy at runtime.
//
// Nothing here touches the network: upstream servers listen on 127.0.0.1, fake host names are
// resolved by an injected resolver, and the address policy is relaxed for 127.0.0.1 only.
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { defaultAddressPolicy } from './addresses.ts';
import { createProxyServer, type ProxyDeps, type ProxyServer } from './app.ts';
import { validateConfig, type ProxyConfig } from './config.ts';
import type { ResolvedAddress } from './upstream.ts';

/** A fake token (never a real credential). */
export const TEST_TOKEN = 'test-token-0123456789-abcdefghijklmnopq';
export const TEST_ORIGIN = 'https://app.example';

/** Fake DNS: host name → answers. Unknown names fail like NXDOMAIN. */
export const FAKE_DNS: Record<string, string[]> = {
  'upstream.test': ['127.0.0.1'],
  'a.edge.test': ['127.0.0.1'],
  'deep.a.edge.test': ['127.0.0.1'],
  'edge.test': ['127.0.0.1'],
  'other.test': ['127.0.0.1'],
  'private.test': ['10.0.0.1'],
  'metadata.test': ['169.254.169.254'],
  'mixed.test': ['127.0.0.1', '10.1.2.3'],
  'cgnat.test': ['100.100.100.100'],
  'v6private.test': ['fd7a:115c:a1e0::1'],
  'mapped.test': ['::ffff:192.168.1.1'],
};

export function fakeResolver(calls?: string[]) {
  return async (hostname: string): Promise<ResolvedAddress[]> => {
    calls?.push(hostname);
    const answers = FAKE_DNS[hostname];
    if (answers === undefined) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

/** The default policy, except that the fake upstream on 127.0.0.1 is reachable. */
export const testAddressPolicy = (address: string): boolean =>
  address === '127.0.0.1' || defaultAddressPolicy(address);

export function testConfig(overrides: Record<string, unknown> = {}): ProxyConfig {
  const { upstream, limits, ...rest } = overrides as {
    upstream?: Record<string, unknown>;
    limits?: Record<string, unknown>;
  };
  const upstreamDraft: Record<string, unknown> = {
    allowedHosts: [
      'upstream.test',
      '*.edge.test',
      'private.test',
      'metadata.test',
      'mixed.test',
      'cgnat.test',
      'v6private.test',
      'mapped.test',
      'nxdomain.test',
      '192.168.1.1',
      '[::1]',
      '127.0.0.1',
    ],
    headersTimeoutMs: 1000,
    ...upstream,
  };
  // `allowedHosts: null` leaves the key out: no allowlist (PRX-02).
  if (upstreamDraft.allowedHosts === null) delete upstreamDraft.allowedHosts;
  return validateConfig({
    token: TEST_TOKEN,
    allowedOrigins: [TEST_ORIGIN],
    upstream: upstreamDraft,
    limits: { requestsPerMinute: 100_000, badTokenPerMinute: 1000, ...limits },
    ...rest,
  });
}

export interface Listening {
  server: Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export function listen(server: Server): Promise<Listening> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
}

/** An ad-hoc upstream; every request is recorded. */
export async function startUpstream(handler: RequestListener) {
  const requests: RecordedRequest[] = [];
  const listening = await listen(
    createServer((req, res) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      handler(req, res);
    }),
  );
  return { ...listening, requests };
}

export async function startProxy(config: ProxyConfig = testConfig(), deps: ProxyDeps = {}) {
  const proxy: ProxyServer = createProxyServer(config, {
    resolve: fakeResolver(),
    addressPolicy: testAddressPolicy,
    ...deps,
  });
  const listening = await listen(proxy.server);
  return {
    ...listening,
    proxy,
    close: async () => {
      await proxy.close();
    },
  };
}

export interface FetchResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export function fetchRaw(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: options.method ?? 'GET', headers: options.headers ?? {} },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Opens a request and resolves with the response as soon as headers arrive (body not read). */
export function openRaw(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ req: ReturnType<typeof request>; res: IncomingMessage }>(
    (resolve, reject) => {
      const req = request(url, { headers }, (res) => resolve({ req, res }));
      req.on('error', reject);
      req.end();
    },
  );
}

/** Sends raw bytes to a local port and resolves with everything received until close. */
export function rawRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.on('data', (chunk: Buffer) => (data += chunk.toString('latin1')));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
  });
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` until it is true or `timeoutMs` elapses. */
export async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await delay(10);
  }
  return check();
}
