import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Fronteiras entre módulos (docs/ARCHITECTURE.md §2): features → player/providers/core/ui; core não importa nada acima.
const forbid = (...groups) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: groups.map((g) => ({
        group: [`@/${g}`, `@/${g}/**`],
        message: `Importação proibida pelas fronteiras de módulos (ver docs/ARCHITECTURE.md §2): ${g}`,
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
          message: 'Metadados externos são renderizados só como texto (SEC-01).',
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
  // O logger (core/log) é o único ponto autorizado a escrever na consola.
  { files: ['src/core/log/**'], rules: { 'no-console': 'off' } },
  {
    files: ['*.config.{js,ts}', 'e2e/**', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
