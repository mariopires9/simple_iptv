import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Module boundaries (docs/ARCHITECTURE.md §2): features → worker/player/providers/core/ui;
// worker → providers/core; core imports nothing above it.
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
  {
    files: ['src/core/**'],
    rules: forbid('app', 'ui', 'features', 'player', 'providers', 'worker'),
  },
  { files: ['src/providers/**'], rules: forbid('app', 'ui', 'features', 'player', 'worker') },
  // Data worker composition root (task registry + entry point): may use core and providers.
  { files: ['src/worker/**'], rules: forbid('app', 'ui', 'features', 'player') },
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
