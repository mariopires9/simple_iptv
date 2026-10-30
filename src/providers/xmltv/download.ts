// Streaming XMLTV download with transparent decompression — EPG-02 AC1. Runs inside the data
// worker.
//
// The format is sniffed from the first bytes, not the URL: `1f 8b` is gzip
// (`DecompressionStream('gzip')`, native), `fd 37 7a 58 5a 00` is xz (the `xz-decompress` WASM
// decoder, loaded on first use into the worker chunk only — browsers have no native xz), anything
// else is read as plain XML. A server that sends the file with `Content-Encoding: gzip` is already
// decoded by the browser, so sniffing avoids decoding twice.
//
// Built on core/net `fetchStream` (inactivity timeout, `NetError` classification, URL never
// logged). The body is never accumulated: each decompressed chunk is decoded and parsed as it
// arrives. A corrupt compressed stream is an `XmltvFormatError('corrupt')`; an xz decoder that
// cannot start (WebAssembly refused, e.g. by a Content Security Policy without
// 'wasm-unsafe-eval') is `xz-unavailable`. xz files with a SHA-256 check are not supported by the
// decoder (CRC32/CRC64, the `xz` defaults, are) and surface as `corrupt`.
import {
  NetError,
  fetchStream,
  type FetchImpl,
  type StreamBody,
  type UrlRewriter,
} from '@/core/net';

export const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export type XmltvCompression = 'none' | 'gzip' | 'xz';

export class XmltvFormatError extends Error {
  override readonly name = 'XmltvFormatError';
  constructor(readonly code: 'corrupt' | 'xz-unavailable' | 'not-xmltv' | 'too-large') {
    super(`XMLTV ${code}`);
  }
}

const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];

export function sniffCompression(head: Uint8Array): XmltvCompression {
  if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  if (XZ_MAGIC.every((byte, i) => head[i] === byte)) return 'xz';
  return 'none';
}

export interface XmltvDownloadOptions {
  signal: AbortSignal;
  fetchImpl?: FetchImpl;
  rewriter?: UrlRewriter;
  inactivityTimeoutMs?: number;
  /** Decoded text, chunk by chunk (awaited: back-pressure). Resolve `false` to stop early. */
  onText: (text: string) => boolean | void | Promise<boolean | void>;
  /** Compressed bytes read so far. */
  onBytes?: (bytes: number) => void;
}

/** Turns `StreamBody.read()` into a ReadableStream that starts with the already read `head`. */
function bodyStream(head: Uint8Array, body: StreamBody): ReadableStream<Uint8Array> {
  let first: Uint8Array | undefined = head;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (first) {
        controller.enqueue(first);
        first = undefined;
        return;
      }
      const chunk = await body.read();
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
}

async function decoded(
  compression: XmltvCompression,
  stream: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array>> {
  if (compression === 'gzip') {
    return stream.pipeThrough(
      new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    );
  }
  if (compression === 'xz') {
    const { XzReadableStream } = await import('xz-decompress');
    return new XzReadableStream(stream);
  }
  return stream;
}

const isAbort = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'AbortError';

/** Resolves with the compressed bytes read and whether the body was read to the end. */
export function downloadXmltv(
  url: string,
  options: XmltvDownloadOptions,
): Promise<{ bytes: number; compression: XmltvCompression; completed: boolean }> {
  return fetchStream(
    url,
    async (body) => {
      // Enough bytes to sniff the format.
      let head = new Uint8Array(0);
      while (head.length < XZ_MAGIC.length) {
        const chunk = await body.read();
        if (chunk === undefined) break;
        const merged = new Uint8Array(head.length + chunk.length);
        merged.set(head);
        merged.set(chunk, head.length);
        head = merged;
      }
      const compression = sniffCompression(head);
      const reader = (await decoded(compression, bodyStream(head, body))).getReader();
      const text = new TextDecoder('utf-8');
      let completed = false;
      try {
        for (;;) {
          let result: ReadableStreamReadResult<Uint8Array>;
          try {
            result = await reader.read();
          } catch (error) {
            if (error instanceof NetError || isAbort(error) || options.signal.aborted) throw error;
            const name = error instanceof Error ? error.name : '';
            throw new XmltvFormatError(
              compression === 'xz' && /CompileError|LinkError|EvalError/.test(name)
                ? 'xz-unavailable'
                : 'corrupt',
            );
          }
          options.onBytes?.(body.bytes);
          if (result.done) {
            const rest = text.decode();
            if (rest !== '') await options.onText(rest);
            completed = true;
            break;
          }
          if ((await options.onText(text.decode(result.value, { stream: true }))) === false) break;
        }
      } finally {
        // Releases the decoder (the xz decoder serialises its contexts) and the body.
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      return { bytes: body.bytes, compression, completed };
    },
    {
      signal: options.signal,
      purpose: 'epg',
      inactivityTimeoutMs: options.inactivityTimeoutMs ?? DOWNLOAD_INACTIVITY_TIMEOUT_MS,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.rewriter ? { rewriter: options.rewriter } : {}),
    },
  );
}
