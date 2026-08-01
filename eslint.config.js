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
  {
    files: ['**/*.test.{ts,tsx,js,mjs,cjs}', 'tests/**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'import/first': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off'
    }
  },
  {
    // These state owners intentionally pin refs and query objects to preserve
    // cancellation and screen-lifetime semantics. Their behavior is covered by tests.
    files: [
      'src/app/AppRoot.tsx',
      'src/app/use*Controller.{ts,tsx}',
      'src/components/ForumContentVideo.tsx',
      'src/screens/LibraryScreen.tsx',
      'src/screens/SearchScreen.tsx',
      'src/screens/UserScreen.tsx',
      'src/screens/more/MorePanels.tsx',
      'src/screens/topic/ReplyComposer.tsx',
      'src/screens/topic/ReplyItem.tsx',
      'src/screens/topic/TopicScreenBody.tsx'
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off'
    }
  },
  prettier
]);
