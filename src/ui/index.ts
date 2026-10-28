// Module ui — see docs/ARCHITECTURE.md §3. Filled in by the corresponding stories.
// The theme provider is imported from `@/ui/theme` only: it pulls in the Inter font and core/db,
// which must not ride along with every `@/ui` import.
export * as tokens from './theme/tokens';
export type { ColorMode, ColorTokens } from './theme/tokens';
export { createAppTheme, type AppThemeOptions } from './theme/createAppTheme';
// State and feedback components (UX-02). No Dexie: typed errors are matched structurally.
export * from './state';
