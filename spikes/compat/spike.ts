// Spike S-00 — throwaway, outside the app build (docs/USER_STORIES.md#s-00).
// Measures: HTTPS, CORS on the Xtream API, allowed formats, redirects and HLS/TS playback in the current browser.
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

type Creds = { base: URL; username: string; password: string; streamId?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const video = $<HTMLVideoElement>('video');
const reportEl = $<HTMLPreElement>('report');
const playButtons = ['play-hls', 'play-native', 'play-ts'].map((id) => $<HTMLButtonElement>(id));

let creds: Creds | undefined;
let liveId: string | undefined;
let cleanup: (() => void) | undefined;

// ---------- report with redaction ----------
function mask(text: string): string {
  if (!creds) return text;
  const secrets = [creds.base.hostname, creds.username, creds.password]
    .filter((s) => s.length > 0)
    .flatMap((s) => [s, encodeURIComponent(s)]);
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}
function log(line: string, cls?: 'ok' | 'fail' | 'warn') {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  const mark = cls === 'ok' ? '✔ ' : cls === 'fail' ? '✘ ' : cls === 'warn' ? '⚠ ' : '';
  span.textContent = mask(mark + line) + '\n';
  reportEl.append(span);
}

// ---------- environment ----------
function environment() {
  const mms = 'ManagedMediaSource' in window;
  const mse = 'MediaSource' in window;
  const MS = (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ?? window.MediaSource;
  const codecs: Record<string, string> = {
    'H.264': 'video/mp4; codecs="avc1.64001f"',
    'HEVC': 'video/mp4; codecs="hvc1.1.6.L93.B0"',
    'AAC': 'audio/mp4; codecs="mp4a.40.2"',
    'AC-3': 'audio/mp4; codecs="ac-3"',
    'E-AC-3': 'audio/mp4; codecs="ec-3"',
    'MP3': 'audio/mpeg',
  };
  log(`== Environment (${new Date().toISOString()}) ==`);
  log(`Browser: ${navigator.userAgent}`);
  log(`Page: ${location.protocol} · secure context: ${window.isSecureContext}`);
  log(`MSE: ${mse} · ManagedMediaSource: ${mms} · native HLS (canPlayType): "${video.canPlayType('application/vnd.apple.mpegurl') || 'no'}"`);
  log(`hls.js supported: ${Hls.isSupported()} · mpegts.js supported: ${mpegts.isSupported()}`);
  const support = Object.entries(codecs).map(([name, type]) => `${name}=${MS?.isTypeSupported(type) ? 'yes' : 'no'}`);
  log(`Codecs (isTypeSupported): ${support.join(' · ')}`);
}

// ---------- network ----------
function normalizeBase(input: string): URL {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  u.pathname = '/';
  u.search = '';
  u.hash = '';
  return u;
}
function apiUrl(base: URL, params: Record<string, string> = {}) {
  const u = new URL('player_api.php', base);
  u.searchParams.set('username', creds!.username);
  u.searchParams.set('password', creds!.password);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer' });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, reason: `response is not JSON (starts with: ${JSON.stringify(text.slice(0, 40))})` };
    }
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, reason: 'timeout (15 s)' };
    return { ok: false, reason: `blocked by the browser (${(e as Error).name}) — CORS, mixed content or DNS` };
  } finally {
    clearTimeout(timer);
  }
}

async function testApi() {
  reportEl.textContent = '';
  environment();
  const c = creds!;
  log(`\n== API Xtream ==`);
  log(`Configured server: ${c.base.protocol}//***:${c.base.port || (c.base.protocol === 'https:' ? 443 : 80)}`);
  if (location.protocol === 'https:' && c.base.protocol === 'http:') {
    log('HTTPS page + HTTP server: the browser blocks it as mixed content.', 'warn');
  }
  if (location.protocol === 'http:' && c.base.protocol === 'http:') {
    log('Note: this page is on http://localhost, so there is no mixed-content blocking here. In the published app (HTTPS) an HTTP server will be blocked.', 'warn');
  }

  const auth = await fetchJson(apiUrl(c.base));
  if (!auth.ok) {
    log(`Authentication/CORS: ${auth.reason}`, 'fail');
    return;
  }
  log('API reachable from the browser (CORS ok)', 'ok');
  const data = auth.data as { user_info?: Record<string, unknown>; server_info?: Record<string, unknown> };
  const ui = data.user_info ?? {};
  const si = data.server_info ?? {};
  if (String(ui.auth) !== '1') {
    log('Credentials rejected (user_info.auth != 1)', 'fail');
    return;
  }
  const exp = Number(ui.exp_date) ? new Date(Number(ui.exp_date) * 1000).toISOString().slice(0, 10) : 'no date';
  log(`Account: status=${ui.status} · expires=${exp} · connections=${ui.active_cons}/${ui.max_connections}`, 'ok');
  log(`Allowed formats: ${JSON.stringify(ui.allowed_output_formats ?? 'not stated')}`);
  log(`server_info: protocol=${si.server_protocol} · port=${si.port} · https_port=${si.https_port || 'none'} · timezone=${si.timezone}`);

  // Try HTTPS if the server advertises an HTTPS port.
  if (c.base.protocol === 'http:' && si.https_port) {
    const httpsBase = new URL(c.base);
    httpsBase.protocol = 'https:';
    httpsBase.port = String(si.https_port);
    const r = await fetchJson(apiUrl(httpsBase));
    if (r.ok) {
      log(`HTTPS available on port ${si.https_port} and reachable (CORS ok) → using HTTPS solves mixed content`, 'ok');
      c.base = httpsBase;
    } else log(`HTTPS advertised on port ${si.https_port} but failed: ${r.reason}`, 'fail');
  } else if (c.base.protocol === 'http:') {
    log('The server advertises no HTTPS port → it will be blocked on an HTTPS page (decisive for ADR-010)', 'fail');
  }

  // A channel to test playback.
  liveId = c.streamId;
  if (!liveId) {
    const cats = await fetchJson(apiUrl(c.base, { action: 'get_live_categories' }));
    const firstCat = cats.ok && Array.isArray(cats.data) ? (cats.data[0] as { category_id?: string }) : undefined;
    const streams = await fetchJson(
      apiUrl(c.base, firstCat?.category_id ? { action: 'get_live_streams', category_id: String(firstCat.category_id) } : { action: 'get_live_streams' }),
    );
    if (streams.ok && Array.isArray(streams.data) && streams.data.length) {
      liveId = String((streams.data[0] as { stream_id: unknown }).stream_id);
      log(`Test channel: stream_id=${liveId} (first of the first category)`);
    } else log(`Could not fetch channels: ${streams.ok ? 'empty list' : streams.reason}`, 'fail');
  }
  if (liveId) {
    await probeRedirect('m3u8');
    await probeRedirect('ts');
    playButtons.forEach((b) => (b.disabled = false));
  }
}

function streamUrl(ext: 'm3u8' | 'ts') {
  const c = creds!;
  return new URL(`live/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${liveId}.${ext}`, c.base).toString();
}

async function probeRedirect(ext: 'm3u8' | 'ts') {
  const url = streamUrl(ext);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer' });
    const final = new URL(res.url);
    const sameHost = final.host === new URL(url).host;
    log(
      `Stream .${ext}: HTTP ${res.status} · type=${res.headers.get('content-type')} · ` +
        (res.redirected ? `redirects to ${final.protocol}//${sameHost ? 'same host' : 'ANOTHER host'}` : 'no redirect') +
        ' · CORS ok',
      res.ok ? 'ok' : 'fail',
    );
    ctrl.abort(); // do not download the stream
  } catch (e) {
    if ((e as Error).name !== 'AbortError') log(`Stream .${ext}: blocked by the browser (CORS/mixed content) — hls.js/mpegts.js will not work in direct mode`, 'fail');
    else log(`Stream .${ext}: no response within 10 s`, 'warn');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- playback ----------
function resetPlayer() {
  cleanup?.();
  cleanup = undefined;
  video.removeAttribute('src');
  video.load();
}
function watchPlayback(label: string) {
  const t0 = performance.now();
  const timeout = setTimeout(() => log(`${label}: no picture after 20 s`, 'fail'), 20000);
  const onPlaying = () => {
    clearTimeout(timeout);
    const ms = Math.round(performance.now() - t0);
    const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean; audioTracks?: { length: number } };
    log(`${label}: playing · first frame in ${ms} ms · ${video.videoWidth}×${video.videoHeight}`, 'ok');
    setTimeout(() => {
      const audio = v.webkitAudioDecodedByteCount ?? (v.mozHasAudio === undefined ? undefined : Number(v.mozHasAudio));
      if (audio === undefined) log(`${label}: audio detection unavailable in this browser — check whether you hear sound (unmute the player)`, 'warn');
      else log(`${label}: audio decoded: ${audio > 0 ? 'yes' : 'NO (audio codec probably unsupported)'}`, audio > 0 ? 'ok' : 'fail');
    }, 3000);
  };
  const onError = () => {
    clearTimeout(timeout);
    log(`${label}: <video> element error code=${video.error?.code} ${video.error?.message ?? ''}`, 'fail');
  };
  video.addEventListener('playing', onPlaying, { once: true });
  video.addEventListener('error', onError, { once: true });
  return () => {
    clearTimeout(timeout);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('error', onError);
  };
}

function playHls() {
  resetPlayer();
  if (!Hls.isSupported()) return log('hls.js: not supported in this browser', 'fail');
  const stop = watchPlayback('hls.js (.m3u8)');
  const hls = new Hls({ enableWorker: true });
  hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
    const l = d.levels[0];
    log(`hls.js: manifest ok · ${d.levels.length} quality level(s) · video=${l?.videoCodec ?? '?'} · audio=${l?.audioCodec ?? '?'}`);
  });
  hls.on(Hls.Events.ERROR, (_e, d) => {
    if (d.fatal) log(`hls.js: fatal error ${d.type}/${d.details}${d.response ? ` HTTP ${d.response.code}` : ''}`, 'fail');
  });
  hls.loadSource(streamUrl('m3u8'));
  hls.attachMedia(video);
  void video.play().catch(() => undefined);
  cleanup = () => {
    stop();
    hls.destroy();
  };
}

function playNative() {
  resetPlayer();
  if (!video.canPlayType('application/vnd.apple.mpegurl')) log('Native HLS: the browser says it is not supported (trying anyway)', 'warn');
  const stop = watchPlayback('Native HLS (.m3u8)');
  video.src = streamUrl('m3u8');
  void video.play().catch(() => undefined);
  cleanup = stop;
}

function playTs() {
  resetPlayer();
  if (!mpegts.isSupported()) return log('mpegts.js: not supported in this browser', 'fail');
  const stop = watchPlayback('mpegts.js (.ts)');
  const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: streamUrl('ts') }, { enableWorker: true, lazyLoad: false });
  player.on(mpegts.Events.MEDIA_INFO, (info: { videoCodec?: string; audioCodec?: string }) => {
    log(`mpegts.js: video=${info.videoCodec ?? '?'} · audio=${info.audioCodec ?? '?'}`);
  });
  player.on(mpegts.Events.ERROR, (type: string, detail: string, info: { msg?: string; code?: number }) => {
    log(`mpegts.js: error ${type}/${detail} ${info?.code ?? ''} ${info?.msg ?? ''}`, 'fail');
  });
  player.attachMediaElement(video);
  player.load();
  void Promise.resolve(player.play()).catch(() => undefined);
  cleanup = () => {
    stop();
    player.destroy();
  };
}

// ---------- wiring ----------
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  try {
    resetPlayer();
    playButtons.forEach((b) => (b.disabled = true));
    creds = {
      base: normalizeBase(String(fd.get('server'))),
      username: String(fd.get('username')),
      password: String(fd.get('password')),
      streamId: String(fd.get('streamId') ?? '').trim() || undefined,
    };
    void testApi();
  } catch {
    log('Invalid server address', 'fail');
  }
});
$<HTMLButtonElement>('play-hls').addEventListener('click', playHls);
$<HTMLButtonElement>('play-native').addEventListener('click', playNative);
$<HTMLButtonElement>('play-ts').addEventListener('click', playTs);
