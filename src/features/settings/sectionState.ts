// UX-08: which Settings sections are expanded. All start collapsed; the ones the user opens are
// remembered in localStorage (a per-device convenience, cleared by "Delete all data" with the
// other `simple-iptv:` keys). A section rendered outside the Settings screen has no id and is
// always expanded.
import { createContext, useCallback, useContext, useState } from 'react';

export const SETTINGS_OPEN_KEY = 'simple-iptv:settings-open';

/** The section id SettingsScreen gives each section; undefined outside it. */
export const SettingsSectionIdContext = createContext<string | undefined>(undefined);

function readOpen(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_OPEN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeOpen(open: Set<string>): void {
  try {
    if (open.size === 0) globalThis.localStorage?.removeItem(SETTINGS_OPEN_KEY);
    else globalThis.localStorage?.setItem(SETTINGS_OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Storage unavailable (private mode): the choice lasts for this visit only.
  }
}

/** Expanded state of the current section, or `null` when it is not collapsible. */
export function useSectionExpanded(): { expanded: boolean; toggle: () => void } | null {
  const id = useContext(SettingsSectionIdContext);
  const [expanded, setExpanded] = useState(() => id !== undefined && readOpen().has(id));
  const toggle = useCallback(() => {
    if (id === undefined) return;
    setExpanded((was) => {
      const open = readOpen();
      if (was) open.delete(id);
      else open.add(id);
      writeOpen(open);
      return !was;
    });
  }, [id]);
  return id === undefined ? null : { expanded, toggle };
}
