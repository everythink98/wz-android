const { defineConfig, globalIgnores } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier/flat');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores([
    'android/**',
    '.expo/**',
    'coverage/**',
    'node_modules/**',
    'tmp/**',
    'tmp-*',
    'android-*.bundle',
    'dogfood-output/**'
  ]),
  ...expo,
  {
    files: ['*.{js,mjs,cjs}', 'plugins/**/*.js', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node
    }
  },
  prettier
]);
