// Settings sections, in display order (UX-04 AC1, docs/UX_UI.md §4.8). One component per
// section, each wrapping its content in `SettingsSection`; a new section (e.g. PWA-01's Install)
// is one component plus one entry here.
import type { ComponentType } from 'react';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { InstallSection } from './InstallSection';
import { LanguageSection } from './LanguageSection';
import { PlaybackSection } from './PlaybackSection';
import { PrivacySection } from './PrivacySection';
import { ProxySection } from './ProxySection';
import { SourcesSection } from './SourcesSection';
import { StorageSection } from './StorageSection';

export interface SettingsSectionEntry {
  /** Stable id (React key, tests). */
  id: string;
  Component: ComponentType;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
  { id: 'sources', Component: SourcesSection },
  { id: 'appearance', Component: AppearanceSection },
  { id: 'language', Component: LanguageSection },
  { id: 'playback', Component: PlaybackSection },
  { id: 'proxy', Component: ProxySection },
  { id: 'storage', Component: StorageSection },
  { id: 'install', Component: InstallSection },
  { id: 'privacy', Component: PrivacySection },
  { id: 'about', Component: AboutSection },
];
