import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Module boundaries (docs/ARCHITECTURE.md §2): features → player/providers/core/ui; core imports nothing above it.
const forbid = (...groups) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: groups.map((g) => ({
        group: [`@/${g}`, `@/${g}/**`],
        message: `Import forbidden by module boundaries (see docs/ARCHITECTURE.md §2): ${g}`,
      })),
    },
  ],
});

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'spikes', 'playwright-report', 'test-results', '.claude'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'External metadata is rendered as text only (SEC-01).',
        },
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]',
          message: 'Do not assign HTML strings; render external metadata as text only (SEC-01).',
        },
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.value=/^(innerHTML|outerHTML)$/]',
          message: 'Do not assign HTML strings; render external metadata as text only (SEC-01).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          property: 'insertAdjacentHTML',
          message: 'Do not insert HTML strings; render external metadata as text only (SEC-01).',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/core/**'], rules: forbid('app', 'ui', 'features', 'player', 'providers') },
  { files: ['src/providers/**'], rules: forbid('app', 'ui', 'features', 'player') },
  { files: ['src/player/**'], rules: forbid('app', 'features', 'providers') },
  { files: ['src/ui/**'], rules: forbid('app', 'features') },
  { files: ['src/features/**'], rules: forbid('app', 'features') },
  // The logger (core/log) is the only place allowed to write to the console.
  { files: ['src/core/log/**'], rules: { 'no-console': 'off' } },
  {
    files: ['*.config.{js,ts}', 'e2e/**', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
