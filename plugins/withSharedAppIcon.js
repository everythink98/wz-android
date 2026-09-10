const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function withSharedAppIcon(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/drawable-xxxhdpi');
      await fs.mkdir(directory, { recursive: true });
      await fs.copyFile(
        path.join(config.modRequest.projectRoot, 'assets/icon.webp'),
        path.join(directory, 'reader_app_icon.webp')
      );
      return config;
    }
  ]);
};
