// Fake <video> for player tests: jsdom does not implement media loading (load() only logs
// "not implemented"), so the engines run against this stand-in that records what they do.
import { vi } from 'vitest';

type Listener = EventListenerOrEventListenerObject;

export class FakeVideo extends EventTarget {
  readonly attributes = new Map<string, string>();
  srcObject: unknown = null;
  error: { code: number } | null = null;
  currentTime = 0;
  readonly load = vi.fn();
  private readonly active = new Map<string, Set<Listener>>();

  get src(): string {
    return this.attributes.get('src') ?? '';
  }

  set src(value: string) {
    this.attributes.set('src', value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  override addEventListener(
    type: string,
    listener: Listener | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (listener) {
      const set = this.active.get(type) ?? new Set();
      set.add(listener);
      this.active.set(type, set);
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: Listener | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (listener) this.active.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }

  /** Listeners currently registered (all types, or one type). */
  listenerCount(type?: string): number {
    if (type !== undefined) return this.active.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.active.values()) total += set.size;
    return total;
  }

  /** Simulates a media error (`MediaError.code`). */
  fail(code: number): void {
    this.error = { code };
    this.dispatchEvent(new Event('error'));
  }

  asElement(): HTMLVideoElement {
    return this as unknown as HTMLVideoElement;
  }
}

/** Installs counting `URL.createObjectURL`/`revokeObjectURL` (jsdom has neither); call `restore()`. */
export function stubObjectUrls() {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let next = 0;
  const live = new Set<string>();
  const create = vi.fn<(obj: Blob | MediaSource) => string>(() => {
    const url = `blob:fake/${++next}`;
    live.add(url);
    return url;
  });
  const revoke = vi.fn<(url: string) => void>((url) => {
    live.delete(url);
  });
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  return {
    create,
    revoke,
    live,
    restore() {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}
