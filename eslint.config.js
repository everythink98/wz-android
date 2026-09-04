const { defineConfig, globalIgnores } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier/flat');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores([
    'android/**',
    'modules/*/android/build/**',
    '.codex-tmp/**',
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
    rules: {
      'no-unreachable-loop': 'error',
      'no-useless-assignment': 'error',
      // React Compiler is not enabled. These three compiler-readiness rules conflict with
      // existing tested lifecycle/ref owners, while the ordinary Hooks rules remain enabled.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off'
    }
  },
  {
    // Reanimated SharedValue mutation is the library's public worklet API.
    files: [
      'src/features/more/components/ContentSourcesPanel.tsx',
      'src/features/topic/rendering/topicTableRenderers.tsx',
      'src/ui/media/ImagePreviewModal.tsx'
    ],
    rules: {
      'react-hooks/immutability': 'off'
    }
  },
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
      'src/features/**/use*Controller.{ts,tsx}',
      'src/features/search/SearchScreen.tsx',
      'src/features/topic/TopicScreen.tsx',
      'src/features/topic/components/ReplyItem.tsx',
      'src/features/user/UserScreen.tsx',
      'src/ui/content/ForumContentVideo.tsx'
    ],
    rules: {
      'react-hooks/exhaustive-deps': 'off'
    }
  },
  prettier
]);
