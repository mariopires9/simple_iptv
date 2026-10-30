import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Module boundaries (docs/ARCHITECTURE.md §2): features → worker/player/providers/core/ui;
// worker → providers/core; core imports nothing above it.
// TEC-01: the full string catalogs (every namespace, statically imported) are for tests and
// tooling only; app code reads `t` from `@/i18n`, which loads feature strings lazily.
const CATALOGS_PATTERN = {
  group: ['@/i18n/catalogs', '**/i18n/catalogs', './catalogs', '../catalogs'],
  message: 'The full string catalogs are for tests and tooling only (TEC-01); use `t` from @/i18n.',
};
// PRX-01: proxy/ is a standalone Node program copied to the owner's PC; the app never imports it
// (tests may, for the URL contract test).
const PROXY_PATTERN = {
  group: ['**/proxy/*.ts', '**/proxy/*.json'],
  message: 'proxy/ is a standalone program (PRX-01); src may import it only from tests.',
};
const TEST_FILES = ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/test-utils/**'];

/** `no-restricted-imports` for the boundary groups, plus the catalogs outside tests. */
const restrict = (groups, { catalogs }) => {
  const patterns = groups.map((g) => ({
    group: [`@/${g}`, `@/${g}/**`],
    message: `Import forbidden by module boundaries (see docs/ARCHITECTURE.md §2): ${g}`,
  }));
  if (catalogs) patterns.push(CATALOGS_PATTERN, PROXY_PATTERN);
  return { 'no-restricted-imports': patterns.length ? ['error', { patterns }] : 'off' };
};

/**
 * A layer's import rules: its boundaries everywhere, and no full catalogs outside its tests. (One
 * rule, so the test override restates the boundaries: a later config replaces the options.)
 */
const forbid = (files, ...groups) => [
  { files, rules: restrict(groups, { catalogs: true }) },
  {
    files: files.flatMap((glob) => [
      glob.replace(/\*\*$/, '**/*.test.{ts,tsx}'),
      glob.replace(/\*\*$/, '**/test-utils/**'),
    ]),
    rules: restrict(groups, { catalogs: false }),
  },
];

// HTML-string sinks (SEC-01 AC3): external metadata is rendered as text only.
const HTML_SINK_MESSAGE =
  'HTML-string sinks are forbidden; render external metadata as text only (SEC-01).';
const HTML_PROPS = '/^(innerHTML|outerHTML|srcdoc)$/';
const HTML_MIME = '/^(text\\/html|application\\/xhtml\\+xml|image\\/svg\\+xml)$/i';
const htmlSinkSelectors = [
  // el.innerHTML = s / el.outerHTML += s / iframe.srcdoc = s
  `AssignmentExpression > MemberExpression.left[computed=false][property.name=${HTML_PROPS}]`,
  // el['innerHTML'] = s
  `AssignmentExpression > MemberExpression.left[computed=true][property.value=${HTML_PROPS}]`,
  // el[`innerHTML`] = s
  `AssignmentExpression > MemberExpression.left[computed=true][property.type='TemplateLiteral'][property.expressions.length=0][property.quasis.0.value.cooked=${HTML_PROPS}]`,
  // Object.assign(el, { innerHTML: s }) and similar object literals
  `ObjectExpression > Property[computed=false][key.name=${HTML_PROPS}]`,
  `ObjectExpression > Property[key.value=${HTML_PROPS}]`,
  `ObjectExpression > Property[computed=true][key.type='TemplateLiteral'][key.expressions.length=0][key.quasis.0.value.cooked=${HTML_PROPS}]`,
  // <iframe srcDoc={s} />
  `JSXAttribute[name.name=/^srcdoc$/i]`,
  // new DOMParser().parseFromString(s, 'text/html')
  `CallExpression[callee.property.name='parseFromString'][arguments.1.value=${HTML_MIME}]`,
  `CallExpression[callee.property.name='parseFromString'][arguments.1.type='TemplateLiteral'][arguments.1.quasis.0.value.cooked=${HTML_MIME}]`,
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'spikes',
      'fixtures/streams',
      'playwright-report',
      'test-results',
      '.claude',
    ],
  },
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
        // HTML sinks (SEC-01). Lint is defence-in-depth alongside the CSP and code review: keys
        // held in variables (`const k = 'inner' + 'HTML'; el[k] = s`) cannot be caught statically.
        ...htmlSinkSelectors.map((selector) => ({ selector, message: HTML_SINK_MESSAGE })),
      ],
      'no-restricted-properties': [
        'error',
        ...[
          'insertAdjacentHTML',
          'createContextualFragment',
          'setHTMLUnsafe',
          'parseHTMLUnsafe',
        ].map((property) => ({ property, message: HTML_SINK_MESSAGE })),
        ...['write', 'writeln'].map((property) => ({
          object: 'document',
          property,
          message: HTML_SINK_MESSAGE,
        })),
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Everything in src (app, i18n, main…): no full catalogs outside tests and test helpers.
  { files: ['src/**'], rules: restrict([], { catalogs: true }) },
  { files: TEST_FILES, rules: restrict([], { catalogs: false }) },
  ...forbid(['src/core/**'], 'app', 'ui', 'features', 'player', 'providers', 'worker'),
  ...forbid(['src/providers/**'], 'app', 'ui', 'features', 'player', 'worker'),
  // Data worker composition root (task registry + entry point): may use core and providers.
  ...forbid(['src/worker/**'], 'app', 'ui', 'features', 'player'),
  ...forbid(['src/player/**'], 'app', 'features', 'providers'),
  ...forbid(['src/ui/**'], 'app', 'features'),
  ...forbid(['src/features/**'], 'app', 'features'),
  // The logger (core/log) is the only place allowed to write to the console.
  { files: ['src/core/log/**'], rules: { 'no-console': 'off' } },
  {
    files: ['*.config.{js,ts}', 'e2e/**', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Personal proxy (PRX-01, ADR-010): standalone, Node only, nothing from the app.
  {
    files: ['proxy/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '**/src/**'],
              message: "proxy/ is standalone: it is copied to the owner's PC on its own (PRX-01).",
            },
          ],
        },
      ],
    },
  },
  // The proxy logger is the only proxy file allowed to write to the console (no URLs, ever).
  { files: ['proxy/log.ts'], rules: { 'no-console': 'off' } },
);
