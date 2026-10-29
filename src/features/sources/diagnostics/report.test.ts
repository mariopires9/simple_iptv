// SRC-09 AC3: the copied report — snapshot of the redacted text; never credentials or the host.
import { describe, expect, it } from 'vitest';
import { NetError } from '@/core/net';
import { t } from '@/i18n';
import { ptPT } from '@/i18n/pt-PT';
import {
  checkApi,
  checkBrowser,
  checkCodecs,
  checkHttps,
  checkLiveFormat,
  type PlaybackCaps,
} from './checks';
import { CODECS } from './codecs';
import { buildReport, maskSensitive } from './report';
import type { DiagnosticsResult } from './runDiagnostics';

// Fictitious values only (CLAUDE.md).
const HOST = 'panel.example.test';
const USER = 'jdoe';
const PASS = 'testpass';
const SERVER = `http://${HOST}:8080`;
const CHROME: PlaybackCaps = { mse: true, mms: false, nativeHls: false, isSafari: false };

function result(): DiagnosticsResult {
  return {
    sourceKind: 'xtream',
    maskedAddress: 'http://***/',
    at: Date.UTC(2026, 9, 29, 12, 0, 0),
    checks: [
      checkHttps({ kind: 'xtream', sourceProtocol: 'http:', pageProtocol: 'https:' }),
      checkApi(
        {
          outcome: 'error',
          error: new NetError({
            kind: 'blocked',
            hint: 'mixed-content',
            url: `${SERVER}/player_api.php?username=${USER}&password=${PASS}`,
          }),
        },
        'xtream',
      ),
      checkLiveFormat({ kind: 'xtream', configured: 'auto', caps: CHROME }),
      checkBrowser(CHROME),
      checkCodecs(
        CODECS.map((codec) => ({
          codec,
          mediaSource: codec !== 'ac3' && codec !== 'eac3',
          native: false,
        })),
        CHROME,
      ),
    ],
  };
}

const context = {
  text: t.diagnostics,
  kindLabel: t.sources.myLists.kinds.xtream,
  pageProtocol: 'https:',
  sensitive: [SERVER, USER, PASS],
};

describe('buildReport', () => {
  it('matches the redacted snapshot', () => {
    expect(buildReport(result(), context)).toMatchInlineSnapshot(`
      "Simple IPTV — compatibility diagnostics
      Date: 2026-10-29T12:00:00.000Z
      List type: Xtream
      Address (hidden): http://***/
      App page: https

      Problems found: see below what you can do.

      [Problem] HTTPS
        The list uses HTTP. This app runs on a secure (HTTPS) page, and browsers block HTTP requests from secure pages (mixed content).
        What you can do:
        - Use an HTTPS address if your provider offers one: edit the list and change the address to https://.
        - Download the list (M3U) on this device and add it as a file. This avoids the list request; each channel’s address must still work in the browser.
        - A personal proxy you run yourself could get around these limits. This app does not support one yet.

      [Problem] API access (CORS)
        The browser blocked the request because the server uses HTTP on a secure page (mixed content).
        What you can do:
        - Use an HTTPS address if your provider offers one: edit the list and change the address to https://.
        - Download the list (M3U) on this device and add it as a file. This avoids the list request; each channel’s address must still work in the browser.
        - A personal proxy you run yourself could get around these limits. This app does not support one yet.

      [OK] Live format (TS/HLS)
        Live channels can play in this browser in the chosen format.
        Chosen format: Auto.
        This browser plays: MPEG-TS (mpegts.js), HLS (hls.js).

      [OK] Browser support
        This browser supports Media Source Extensions, which the app uses for most streams.
        Media Source Extensions: yes · Managed Media Source: no · Native HLS: no.

      [Warning] Codecs
        Some codecs are not supported: channels that use them may play without picture or sound.
        H.264: yes · AAC: yes · HEVC (H.265): yes · AC-3 (Dolby Digital): no · E-AC-3 (Dolby Digital Plus): no
        Support reported by the browser; actual playback also depends on the device.
        What you can do:
        - Try Safari (Mac, iPhone or iPad): it plays HLS natively and supports more codecs, such as Dolby audio and HEVC.

      Credentials and the server address are hidden in this report."
    `);
  });

  it('never contains the username, password or host — in any locale', () => {
    for (const text of [t.diagnostics, ptPT.diagnostics]) {
      const report = buildReport(result(), { ...context, text });
      for (const secret of [HOST, USER, PASS, SERVER, '8080']) {
        expect(report).not.toContain(secret);
      }
    }
  });

  it('masks a sensitive value even if it slipped into the text', () => {
    const leaky: DiagnosticsResult = { ...result(), maskedAddress: `${SERVER}/` };
    const report = buildReport(leaky, context);
    expect(report).not.toContain(HOST);
    expect(report).toContain('Address (hidden): ***/');
  });
});

describe('maskSensitive', () => {
  it('masks values and the host of URLs, ignoring too-short values', () => {
    expect(maskSensitive(`a ${HOST}:8080 b ${USER} c ab`, [SERVER, USER, 'ab', undefined])).toBe(
      'a *** b *** c ab',
    );
  });
});
