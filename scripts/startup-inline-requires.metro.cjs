const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(root);
const getTransformOptions = config.transformer.getTransformOptions;

config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return {
    ...options,
    transform: {
      ...options.transform,
      // Keep bootstrap registration and Splash setup eager while deferring other module imports.
      inlineRequires: {
        blockList: Object.fromEntries(
          ['index.ts', 'App.tsx', 'src/app/AppRoot.tsx', 'src/app/AppComposition.tsx'].map((file) => [
            path.join(root, file),
            true
          ])
        )
      }
    }
  };
};

module.exports = config;
