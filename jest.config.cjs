module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: require('jest-expo/jest-preset').transformIgnorePatterns.map((pattern) =>
    pattern.replace('/node_modules/(?!', '/node_modules/(?!@shopify/flash-list|')
  ),
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^react-native-worklets$': '<rootDir>/node_modules/react-native-worklets/src/mock.ts'
  },
  modulePathIgnorePatterns: ['<rootDir>/.codex-tmp/'],
  testMatch: ['<rootDir>/tests/ui/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/ui/setup.ts']
};
