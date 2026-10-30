// Test helpers for the stream probe (PLY-06): MPEG-TS packets and fake fetch responses.

const PACKET = 188;

function packet(pid: number, section: number[]): Uint8Array {
  const bytes = new Uint8Array(PACKET).fill(0xff);
  bytes.set([0x47, 0x40 | ((pid >> 8) & 0x1f), pid & 0xff, 0x10, 0x00, ...section]);
  return bytes;
}

/** PAT (program 1 → PMT PID 0x100) + PMT with the given elementary stream types. */
export function tsWithStreamTypes(types: readonly number[]): Uint8Array {
  const pat = packet(
    0,
    [0x00, 0xb0, 13, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0, 0, 0, 0],
  );
  const streams = types.flatMap((type, i) => [type, 0xe1, 0x01 + i, 0xf0, 0x00]);
  const length = 9 + streams.length + 4;
  const pmt = packet(0x100, [
    0x02,
    0xb0,
    length,
    0x00,
    0x01,
    0xc1,
    0x00,
    0x00,
    0xe1,
    0x01,
    0xf0,
    0x00,
    ...streams,
    0,
    0,
    0,
    0,
  ]);
  const out = new Uint8Array(PACKET * 3);
  out.set(pat, 0);
  out.set(pmt, PACKET);
  out.set(packet(0x101, []), PACKET * 2);
  return out;
}

export const H264_AAC = [0x1b, 0x0f];
export const HEVC_AAC = [0x24, 0x0f];

export interface FakeResponseInit {
  status?: number;
  url?: string;
  redirected?: boolean;
  type?: ResponseType;
  /** Body chunks; `endless` keeps producing chunks until cancelled. */
  body?: Uint8Array | string;
  endless?: boolean;
}

/** A Response with the read-only fields fetch() sets (url, redirected, type). */
export function fakeResponse(init: FakeResponseInit = {}): Response & { cancelled: () => boolean } {
  let cancelled = false;
  const chunk = typeof init.body === 'string' ? new TextEncoder().encode(init.body) : init.body;
  const stream =
    init.type === 'opaque' || init.type === 'opaqueredirect'
      ? null
      : new ReadableStream<Uint8Array>({
          pull(controller) {
            if (init.endless) {
              controller.enqueue(chunk ?? new Uint8Array(1024));
              return;
            }
            if (chunk) controller.enqueue(chunk);
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        });
  const status =
    init.type === 'opaque' || init.type === 'opaqueredirect' ? 200 : (init.status ?? 200);
  const response = new Response(stream, { status });
  Object.defineProperties(response, {
    url: { value: init.url ?? '' },
    redirected: { value: init.redirected ?? false },
    type: { value: init.type ?? 'cors' },
    ...(init.type === 'opaque' || init.type === 'opaqueredirect'
      ? { status: { value: 0 }, ok: { value: false } }
      : {}),
  });
  return Object.assign(response, { cancelled: () => cancelled });
}
