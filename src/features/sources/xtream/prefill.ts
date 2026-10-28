// One-shot handoff of Xtream form values from the M3U-URL screen (SRC-05 AC2: a `get.php` URL is
// converted to the Xtream form). The values (they include the password) are kept in memory only:
// the navigation carries an opaque random id in router state, so neither the URL bar nor the
// session history (`history.state`) ever holds the credentials. A reload simply loses them.
import type { XtreamFormValues } from './validate';

let stash: { id: string; values: Partial<XtreamFormValues> } | undefined;

/** Router state key carrying the opaque id. */
export const XTREAM_PREFILL_STATE_KEY = 'xtreamPrefill';

/** Stores `values` (replacing any previous ones) and returns the router state to navigate with. */
export function stashXtreamPrefill(values: Partial<XtreamFormValues>): Record<string, string> {
  const id = crypto.randomUUID();
  stash = { id, values };
  return { [XTREAM_PREFILL_STATE_KEY]: id };
}

/** Values stored for the router `state`, if its id matches; does not consume them. */
export function readXtreamPrefill(state: unknown): Partial<XtreamFormValues> | undefined {
  if (typeof state !== 'object' || state === null || !stash) return undefined;
  const id = (state as Record<string, unknown>)[XTREAM_PREFILL_STATE_KEY];
  return id === stash.id ? { ...stash.values } : undefined;
}

/** Forgets the stored values for `state` (the form that used them was left). */
export function clearXtreamPrefill(state: unknown): void {
  if (readXtreamPrefill(state) !== undefined) stash = undefined;
}
