// Spike S-00 — descartável, fora do build da app (docs/USER_STORIES.md#s-00).
// Mede: HTTPS, CORS na API Xtream, formatos permitidos, redirecionamentos e reprodução HLS/TS no browser atual.
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

// ---------- relatório com redação ----------
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

// ---------- ambiente ----------
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
  log(`== Ambiente (${new Date().toISOString()}) ==`);
  log(`Browser: ${navigator.userAgent}`);
  log(`Página: ${location.protocol} · contexto seguro: ${window.isSecureContext}`);
  log(`MSE: ${mse} · ManagedMediaSource: ${mms} · HLS nativo (canPlayType): "${video.canPlayType('application/vnd.apple.mpegurl') || 'não'}"`);
  log(`hls.js suportado: ${Hls.isSupported()} · mpegts.js suportado: ${mpegts.isSupported()}`);
  const support = Object.entries(codecs).map(([name, type]) => `${name}=${MS?.isTypeSupported(type) ? 'sim' : 'não'}`);
  log(`Codecs (isTypeSupported): ${support.join(' · ')}`);
}

// ---------- rede ----------
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
      return { ok: false, reason: `resposta não é JSON (começa por: ${JSON.stringify(text.slice(0, 40))})` };
    }
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, reason: 'timeout (15 s)' };
    return { ok: false, reason: `bloqueado pelo browser (${(e as Error).name}) — CORS, mixed content ou DNS` };
  } finally {
    clearTimeout(timer);
  }
}

async function testApi() {
  reportEl.textContent = '';
  environment();
  const c = creds!;
  log(`\n== API Xtream ==`);
  log(`Servidor configurado: ${c.base.protocol}//***:${c.base.port || (c.base.protocol === 'https:' ? 443 : 80)}`);
  if (location.protocol === 'https:' && c.base.protocol === 'http:') {
    log('Página HTTPS + servidor HTTP: o browser bloqueia como mixed content.', 'warn');
  }
  if (location.protocol === 'http:' && c.base.protocol === 'http:') {
    log('Nota: esta página está em http://localhost, por isso não há bloqueio de mixed content aqui. Na app publicada (HTTPS) um servidor HTTP será bloqueado.', 'warn');
  }

  const auth = await fetchJson(apiUrl(c.base));
  if (!auth.ok) {
    log(`Autenticação/CORS: ${auth.reason}`, 'fail');
    return;
  }
  log('API acessível a partir do browser (CORS ok)', 'ok');
  const data = auth.data as { user_info?: Record<string, unknown>; server_info?: Record<string, unknown> };
  const ui = data.user_info ?? {};
  const si = data.server_info ?? {};
  if (String(ui.auth) !== '1') {
    log('Credenciais rejeitadas (user_info.auth != 1)', 'fail');
    return;
  }
  const exp = Number(ui.exp_date) ? new Date(Number(ui.exp_date) * 1000).toISOString().slice(0, 10) : 'sem data';
  log(`Conta: estado=${ui.status} · expira=${exp} · ligações=${ui.active_cons}/${ui.max_connections}`, 'ok');
  log(`Formatos permitidos: ${JSON.stringify(ui.allowed_output_formats ?? 'não indicado')}`);
  log(`server_info: protocolo=${si.server_protocol} · porta=${si.port} · https_port=${si.https_port || 'nenhuma'} · fuso=${si.timezone}`);

  // Tentar HTTPS se o servidor anunciar uma porta HTTPS.
  if (c.base.protocol === 'http:' && si.https_port) {
    const httpsBase = new URL(c.base);
    httpsBase.protocol = 'https:';
    httpsBase.port = String(si.https_port);
    const r = await fetchJson(apiUrl(httpsBase));
    if (r.ok) {
      log(`HTTPS disponível na porta ${si.https_port} e acessível (CORS ok) → usar HTTPS resolve o mixed content`, 'ok');
      c.base = httpsBase;
    } else log(`HTTPS anunciado na porta ${si.https_port} mas falhou: ${r.reason}`, 'fail');
  } else if (c.base.protocol === 'http:') {
    log('O servidor não anuncia porta HTTPS → numa página HTTPS será bloqueado (decisivo para ADR-010)', 'fail');
  }

  // Um canal para testar a reprodução.
  liveId = c.streamId;
  if (!liveId) {
    const cats = await fetchJson(apiUrl(c.base, { action: 'get_live_categories' }));
    const firstCat = cats.ok && Array.isArray(cats.data) ? (cats.data[0] as { category_id?: string }) : undefined;
    const streams = await fetchJson(
      apiUrl(c.base, firstCat?.category_id ? { action: 'get_live_streams', category_id: String(firstCat.category_id) } : { action: 'get_live_streams' }),
    );
    if (streams.ok && Array.isArray(streams.data) && streams.data.length) {
      liveId = String((streams.data[0] as { stream_id: unknown }).stream_id);
      log(`Canal de teste: stream_id=${liveId} (primeiro da primeira categoria)`);
    } else log(`Não foi possível obter canais: ${streams.ok ? 'lista vazia' : streams.reason}`, 'fail');
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
      `Stream .${ext}: HTTP ${res.status} · tipo=${res.headers.get('content-type')} · ` +
        (res.redirected ? `redireciona para ${final.protocol}//${sameHost ? 'mesmo host' : 'OUTRO host'}` : 'sem redirecionamento') +
        ' · CORS ok',
      res.ok ? 'ok' : 'fail',
    );
    ctrl.abort(); // não descarregar o stream
  } catch (e) {
    if ((e as Error).name !== 'AbortError') log(`Stream .${ext}: bloqueado pelo browser (CORS/mixed content) — hls.js/mpegts.js não funcionarão em modo direto`, 'fail');
    else log(`Stream .${ext}: sem resposta em 10 s`, 'warn');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- reprodução ----------
function resetPlayer() {
  cleanup?.();
  cleanup = undefined;
  video.removeAttribute('src');
  video.load();
}
function watchPlayback(label: string) {
  const t0 = performance.now();
  const timeout = setTimeout(() => log(`${label}: sem imagem após 20 s`, 'fail'), 20000);
  const onPlaying = () => {
    clearTimeout(timeout);
    const ms = Math.round(performance.now() - t0);
    const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean; audioTracks?: { length: number } };
    log(`${label}: a reproduzir · primeiro frame em ${ms} ms · ${video.videoWidth}×${video.videoHeight}`, 'ok');
    setTimeout(() => {
      const audio = v.webkitAudioDecodedByteCount ?? (v.mozHasAudio === undefined ? undefined : Number(v.mozHasAudio));
      if (audio === undefined) log(`${label}: deteção de áudio indisponível neste browser — confirma se ouves som (ativa o som no leitor)`, 'warn');
      else log(`${label}: áudio descodificado: ${audio > 0 ? 'sim' : 'NÃO (codec de áudio provavelmente não suportado)'}`, audio > 0 ? 'ok' : 'fail');
    }, 3000);
  };
  const onError = () => {
    clearTimeout(timeout);
    log(`${label}: erro do elemento <video> code=${video.error?.code} ${video.error?.message ?? ''}`, 'fail');
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
  if (!Hls.isSupported()) return log('hls.js: não suportado neste browser', 'fail');
  const stop = watchPlayback('hls.js (.m3u8)');
  const hls = new Hls({ enableWorker: true });
  hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
    const l = d.levels[0];
    log(`hls.js: manifesto ok · ${d.levels.length} qualidade(s) · vídeo=${l?.videoCodec ?? '?'} · áudio=${l?.audioCodec ?? '?'}`);
  });
  hls.on(Hls.Events.ERROR, (_e, d) => {
    if (d.fatal) log(`hls.js: erro fatal ${d.type}/${d.details}${d.response ? ` HTTP ${d.response.code}` : ''}`, 'fail');
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
  if (!video.canPlayType('application/vnd.apple.mpegurl')) log('HLS nativo: o browser diz que não suporta (a tentar mesmo assim)', 'warn');
  const stop = watchPlayback('HLS nativo (.m3u8)');
  video.src = streamUrl('m3u8');
  void video.play().catch(() => undefined);
  cleanup = stop;
}

function playTs() {
  resetPlayer();
  if (!mpegts.isSupported()) return log('mpegts.js: não suportado neste browser', 'fail');
  const stop = watchPlayback('mpegts.js (.ts)');
  const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: streamUrl('ts') }, { enableWorker: true, lazyLoad: false });
  player.on(mpegts.Events.MEDIA_INFO, (info: { videoCodec?: string; audioCodec?: string }) => {
    log(`mpegts.js: vídeo=${info.videoCodec ?? '?'} · áudio=${info.audioCodec ?? '?'}`);
  });
  player.on(mpegts.Events.ERROR, (type: string, detail: string, info: { msg?: string; code?: number }) => {
    log(`mpegts.js: erro ${type}/${detail} ${info?.code ?? ''} ${info?.msg ?? ''}`, 'fail');
  });
  player.attachMediaElement(video);
  player.load();
  void Promise.resolve(player.play()).catch(() => undefined);
  cleanup = () => {
    stop();
    player.destroy();
  };
}

// ---------- ligações ----------
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
    log('Endereço do servidor inválido', 'fail');
  }
});
$<HTMLButtonElement>('play-hls').addEventListener('click', playHls);
$<HTMLButtonElement>('play-native').addEventListener('click', playNative);
$<HTMLButtonElement>('play-ts').addEventListener('click', playTs);
