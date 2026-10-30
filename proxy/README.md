# Simple IPTV personal proxy

A small relay you run **on your own PC** so the Simple IPTV web app (served over HTTPS) can play
streams that your provider only delivers over plain `http://`. Browsers block `http://` media inside
an `https://` page (mixed content); the proxy fetches the stream for the app and hands it back over
HTTPS through **Tailscale Serve**, privately, inside your own tailnet.

- Story PRX-01, decision ADR-010 (`docs/DECISIONS.md`), security policy `docs/SECURITY.md` §4.
- Plain Node.js 24, **no dependencies, no build step**: Node runs the TypeScript files directly.
- It is **not** a general-purpose or public proxy: every request needs your token, upstream hosts
  must be on your allowlist, private network addresses are refused, and nothing is cached.

> **What was tested, and where.** The automated suite (`npm test`, files `proxy/*.test.ts`) runs
> with Node 24.18.0 on Linux (WSL2), against local fake upstream servers. The Windows steps, the
> Task Scheduler entry and Tailscale Serve below follow the vendors' documentation but have **not**
> yet been verified end to end; nothing here is a compatibility promise. Record what you test.

## How it fits together

```
phone/laptop (Tailscale)                 your Windows PC
┌──────────────────────┐   HTTPS (tailnet)   ┌─────────────────────────┐   http/https   ┌──────────┐
│ Simple IPTV web app  │ ──────────────────► │ Tailscale Serve :443    │ ─────────────► │ provider │
│ (GitHub Pages)       │                     │  → 127.0.0.1:8787 proxy │   (internet)   │ API/edge │
└──────────────────────┘                     └─────────────────────────┘                └──────────┘
```

The app turns `http://provider/live/user/pass/1.ts` into
`https://<pc>.<tailnet>.ts.net/v1/<token>/u/<base64url of the URL>/1.ts`. The proxy checks the
token and the allowlist, connects to the provider from your PC (your home IP, which the provider
already accepts), follows the provider's redirects to its `http://` edge servers itself, and streams
the bytes back. HLS playlists are rewritten so every segment also goes through the proxy.

## Set up on Windows

### 1. Install Node.js 24

Download the **Node.js 24 LTS** Windows installer (`.msi`) from <https://nodejs.org/> and install
it with the defaults. Check in a new PowerShell window:

```powershell
node --version   # v24.x
```

### 2. Copy the proxy

Copy this `proxy` folder to a normal Windows folder, for example `C:\simple-iptv-proxy`.
Do **not** run it from a `\\wsl$\...` path or a network share. Only the `.ts` files and
`config.example.json` are needed; the `*.test.ts` files and `test-support.ts` are for development.

### 3. Create a token

```powershell
cd C:\simple-iptv-proxy
node server.ts --generate-token
```

It prints a random 43-character token. Treat it like a password: anyone with it (and access to your
tailnet) can use your proxy.

### 4. Write the configuration

Create the folder `%APPDATA%\SimpleIPTVProxy` and copy `config.example.json` into it as
`config.json` (or keep it elsewhere and start the proxy with `--config <path>`):

```powershell
mkdir "$env:APPDATA\SimpleIPTVProxy"
copy C:\simple-iptv-proxy\config.example.json "$env:APPDATA\SimpleIPTVProxy\config.json"
notepad "$env:APPDATA\SimpleIPTVProxy\config.json"
```

| Key | Meaning |
|---|---|
| `listen.host` / `listen.port` | Must be a loopback address (`127.0.0.1` or `::1`); default port `8787`. Tailscale Serve connects here. The proxy refuses to start on any other address. |
| `token` | Paste the token from step 3. |
| `allowedOrigins` | Web pages allowed to call the proxy: the app's origin, e.g. `https://<your-user>.github.io` (no path, no trailing slash). Keep the `localhost` entries only if you develop the app. |
| `upstream.allowedHosts` | **Optional.** Left out (the default in `config.example.json`), the proxy relays to **any public host**, so lists from any provider work without editing the config; private, loopback, tailnet and cloud-metadata addresses are still refused. To restrict it, list your providers' host names **as they appear in the URLs you added to the app** (the API/panel host, the M3U host). `*.example.net` allows every subdomain of `example.net` (not `example.net` itself). Edge hosts reached through redirects never need to be listed. An empty list is refused. |
| `upstream.maxRedirects` | Redirect hops followed inside the proxy (default 5). |
| `upstream.headersTimeoutMs` | 504 if the provider sends no response headers in time (default 15000 per hop). |
| `upstream.idleTimeoutMs` | A stream whose provider sends no data for this long while the player is reading is closed (default 30000). |
| `limits.requestsPerMinute` | Global request budget (default 1200). |
| `limits.maxConcurrentUpstreams` | Open provider connections at once (default 8). |
| `limits.badTokenPerMinute` | After this many wrong tokens in a minute, **every** request gets 429 for 60 s (default 10). |
| `limits.playlistMaxBytes` | Largest HLS playlist that will be rewritten (default 4 MiB). |
| `grantTtlSeconds` | Lifetime of the URLs written into rewritten playlists (default 86400 = 24 h). |
| `publicBaseUrl` | Optional. Normally omitted: the proxy builds playlist URLs from the `Host` and `X-Forwarded-Proto` headers that Tailscale Serve sends, giving `https://<pc>.<tailnet>.ts.net`. Set it (e.g. `https://<pc>.<tailnet>.ts.net/iptv`) only if you mount the proxy under a path. |

Unknown keys, an invalid token, an empty `allowedOrigins` (or an empty `allowedHosts` when present) and bad values stop the proxy at startup with a message
naming the field (never its value).

### 5. Start it

```powershell
node C:\simple-iptv-proxy\server.ts
```

It prints one JSON line with the port and how many hosts (`0` = no allowlist, any public host) and origins are configured, then one line per
request with only the status, an error code, the duration and the byte count. **It never logs
hosts, paths, query strings, tokens or URLs.** Stop it with Ctrl+C.

### 6. Expose it to your tailnet with Tailscale Serve

1. Install **Tailscale for Windows** from <https://tailscale.com/download> and sign in.
2. In the Tailscale admin console (<https://login.tailscale.com/admin/dns>), enable **MagicDNS**
   and **HTTPS Certificates**.
3. In PowerShell:

   ```powershell
   tailscale serve --bg 8787     # https://<pc>.<tailnet>.ts.net/ → http://127.0.0.1:8787
   tailscale serve status        # shows the URL
   tailscale serve reset         # removes the configuration again (when you stop using it)
   ```

4. Check from another device on the tailnet (the token goes in the path):
   `https://<pc>.<tailnet>.ts.net/v1/<token>/health` must answer
   `{"service":"simple-iptv-proxy","api":1,"activeUpstreams":0}`.

### 7. Install Tailscale on the viewing device

Install the Tailscale app on the phone/tablet/laptop that runs Simple IPTV and sign in with the
**same account** (or share the PC's node with that account from the admin console). The proxy URL
only works while Tailscale is connected on that device.

### 8. Configure the app

In Simple IPTV: **Settings › Personal proxy** → enter `https://<pc>.<tailnet>.ts.net` and the token,
press **Test**, then in the list's settings set the proxy routing to **Streams** (or also the API,
if needed).

### 9. Start at login and keep the PC awake

Either create a scheduled task that starts at logon:

```powershell
schtasks /Create /TN "Simple IPTV Proxy" /SC ONLOGON /RL LIMITED /TR "\"C:\Program Files\nodejs\node.exe\" C:\simple-iptv-proxy\server.ts"
schtasks /Query /TN "Simple IPTV Proxy"
schtasks /Delete /TN "Simple IPTV Proxy" /F     # to remove it
```

or put a `simple-iptv-proxy.cmd` file in your Startup folder (Win+R → `shell:startup`):

```bat
@echo off
start "Simple IPTV Proxy" /min "C:\Program Files\nodejs\node.exe" C:\simple-iptv-proxy\server.ts
```

The PC must be on and awake while you watch: set **Settings › System › Power › Screen and sleep ›
Sleep** to *Never* when plugged in (or `powercfg /change standby-timeout-ac 0`). Tailscale Serve
keeps its configuration across reboots (`--bg`).

## Set up on Linux

The same program and configuration keys as on Windows; only paths and service management differ.
Tested only by the automated suite on Linux (Node 24); not yet on a real Linux server.

```sh
# 1. Node.js 24 (distribution package, NodeSource or nvm), then check:
node --version            # v24.x
# 2. Copy the proxy folder (only proxy/ is needed), e.g. to ~/simple-iptv-proxy
# 3. Token and configuration (default path: ~/.config/simple-iptv-proxy/config.json)
cd ~/simple-iptv-proxy
node server.ts --generate-token
mkdir -p ~/.config/simple-iptv-proxy
cp config.example.json ~/.config/simple-iptv-proxy/config.json
chmod 600 ~/.config/simple-iptv-proxy/config.json
nano ~/.config/simple-iptv-proxy/config.json   # paste the token; allowedOrigins = the app origin
# 4. Start it (Ctrl+C stops it)
node server.ts
```

Leave `upstream.allowedHosts` out (as in the example) to use lists from any provider without
editing the configuration again; add it only if you want to restrict the relay.

Run it as a user service so it starts at boot and restarts on failure
(`~/.config/systemd/user/simple-iptv-proxy.service`):

```ini
[Unit]
Description=Simple IPTV personal proxy
After=network-online.target

[Service]
ExecStart=/usr/bin/node %h/simple-iptv-proxy/server.ts
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now simple-iptv-proxy
loginctl enable-linger "$USER"      # keep it running without a login session
journalctl --user -u simple-iptv-proxy -f
```

Use the path `which node` prints in `ExecStart`. Then expose it exactly as on Windows (step 6):
install Tailscale (`curl -fsSL https://tailscale.com/install.sh | sh`, `sudo tailscale up`),
enable MagicDNS and HTTPS certificates, and run `sudo tailscale serve --bg 8787`.

## Security warnings — read these

- **Never use `tailscale funnel`, port forwarding on your router, or a public VPS** for this proxy.
  That would put an internet-facing relay of your provider credentials online. Tailscale Serve keeps
  it inside your tailnet; the token is a second lock, not the only one.
- **The proxy sees your provider credentials.** Xtream credentials are part of every stream URL. The
  proxy runs on your machine and never logs or stores them, but anything with access to that PC can
  read the traffic. Do not run it on a shared machine.
- **PC → provider edge is plain `http://`.** The proxy fixes the browser's mixed-content block; it
  cannot add encryption the provider does not offer. Credentials and video cross the internet
  unencrypted between your PC and the edge server, exactly as with a set-top box.
- **HTTPS certificates are public.** Enabling Tailscale HTTPS certificates records your machine name
  and tailnet name (`<pc>.<tailnet>.ts.net`) in public Certificate Transparency logs. Pick a machine
  name you are comfortable publishing.
- **Chrome "Local Network Access" prompt.** Tailscale addresses are in `100.64.0.0/10`; Chrome may ask
  whether the app may access devices on your local network. Allow it for the Simple IPTV site.
- **Token rotation.** If the token may have leaked: generate a new one, put it in `config.json`,
  restart the proxy and update the app. Old proxy URLs, including URLs inside rewritten playlists,
  stop working immediately.
- **One provider connection.** Most providers allow one stream at a time. The proxy closes the
  upstream connection as soon as the app stops reading, but switching channels very fast can still
  briefly overlap two connections.
- **Smart TVs.** Samsung (Tizen) and LG (webOS) TVs have no Tailscale app, so this setup does not
  work on them.

## What the proxy enforces

- **Token** in every path (`/v1/<token>/…`), compared in constant time; a query-string token is
  ignored. 10 wrong tokens per minute lock all requests out for 60 s.
- **Methods** `GET`, `HEAD` and CORS preflight `OPTIONS` only (405 otherwise, CONNECT refused).
- **Origins**: requests with an `Origin` header must come from `allowedOrigins` (403 otherwise);
  requests without one (the `<video>` element, curl) are allowed.
- **Optional upstream allowlist** for app-built URLs (without one: any public host); redirects are followed inside the proxy (≤ 5 hops) and
  never forwarded to the client.
- **SSRF protection**: http/https only, no `user:pass@`, every DNS answer checked against private,
  loopback, link-local, CGNAT/Tailscale, documentation, multicast and reserved ranges (including
  IPv4-mapped, NAT64 and 6to4 IPv6 forms); the connection is pinned to the vetted address.
- **Headers**: only `Range`, `If-Range`, `Accept`, `Accept-Encoding` (gzip/deflate/br) and
  `User-Agent` go upstream — never cookies, `Authorization`, `Origin`, `Referer`, `X-Forwarded-*` or
  `Tailscale-*`. `Set-Cookie` is never passed back. Every response has
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and
  `Content-Security-Policy: default-src 'none'; sandbox`.
- **Streaming** with backpressure and no buffering, except HLS playlists (rewritten, ≤ 4 MiB).
  IPTV M3U channel lists are passed through byte for byte.

## URL contract (for the app)

`proxy/url.ts` is the shared, dependency-free implementation; the app's tests import it.

| Path (after the configured base URL `B`) | Purpose |
|---|---|
| `B/v1/<token>/health` | `200 {"service":"simple-iptv-proxy","api":1,"activeUpstreams":n}` |
| `B/v1/<token>/health/<b64u(url)>` | same, plus `"upstreamAllowed": true\|false` (allowlist only, no DNS) |
| `B/v1/<token>/u/<b64u(url)>/<name>` | relay an allowlisted URL (built by the app) |
| `B/v1/<token>/g/<grant>/<b64u(url)>/<name>` | relay a URL from a rewritten playlist (built only by the proxy) |

- `b64u` = unpadded base64url of the UTF-8 absolute `http(s)` URL, at most 8 KiB decoded, canonical.
- `<name>` = the last path segment of the upstream URL if it matches `[A-Za-z0-9._-]{1,64}` (and is
  not only dots), else `_`. Cosmetic (players look at extensions); the proxy ignores it.
- `grant` = `<expiry epoch seconds in base36>.<first 22 chars of b64u(HMAC-SHA256(Kg, expiry + "\n" + url))>`
  where `expiry` is the base36 text and `Kg = HMAC-SHA256(key = token, "simple-iptv-proxy grant v1")`.
- No query strings anywhere in the scheme.

| Status | `X-Simple-Iptv-Proxy-Error` | When |
|---|---|---|
| 400 | `malformed`, `bad-url` | bad path, base64url, scheme, userinfo, URL > 8 KiB |
| 401 | `bad-token` | missing or wrong token (empty body) |
| 403 | `host-not-allowed`, `address-blocked`, `bad-grant`, `origin-not-allowed` | allowlist, private address, invalid/expired grant, foreign `Origin` |
| 404 | `not-found` | not under `/v1/` |
| 405 | `method-not-allowed` | anything but GET/HEAD/OPTIONS |
| 429 | `rate-limited`, `too-many-upstreams` | rate limit, bad-token lockout, too many open upstreams |
| 502 | `upstream-unreachable`, `upstream-tls`, `too-many-redirects`, `bad-redirect`, `playlist-too-large` | DNS/connect/TLS failure, > 5 redirects, redirect to a non-http URL, playlist over the cap |
| 504 | `upstream-timeout` | no upstream response headers within 15 s |

Upstream statuses (200, 206, 404, …) are passed through unchanged, without the error header. The
error header is readable by the app through CORS (`Access-Control-Expose-Headers`).

### Implementation notes

- **Public base for playlists.** Rewritten playlists contain absolute URLs on the base the client
  used: `X-Forwarded-Proto` (sent by Tailscale Serve) + `Host`, or `publicBaseUrl` if configured.
- **Range and playlists.** `Range`/`If-Range` are not forwarded for URLs ending in `.m3u`/`.m3u8`,
  so playlists are always fetched whole and rewritten; the rewritten playlist is a plain 200.
- **HLS detection.** A 200 body is treated as HLS only if, after `#EXTM3U`, an `#EXT-X-` playlist tag
  starts a line within the first 64 KiB. Anything else is streamed unchanged (at most the first
  64 KiB is held back while deciding).
- **Paused playback.** `idleTimeoutMs` counts only provider silence while the player is reading.
  A player that stops reading (Safari's native player buffering ahead, ManagedMediaSource
  `endstreaming`, a paused VOD) keeps its connection for as long as its own socket stays open;
  the provider connection is closed when the player disconnects (PLY-07).
- **One connection per request.** Upstream connections are not pooled (`agent: false`), so closing a
  client request always closes its provider connection.

## Development

From the repository root: `npm run proxy` (default config path), `npm run proxy:token`,
`npm test` (includes `proxy/*.test.ts`), `npm run typecheck` (includes `tsc -p proxy`).
Tests never touch the network: fake upstreams listen on `127.0.0.1` and host names are resolved by
an injected resolver.
