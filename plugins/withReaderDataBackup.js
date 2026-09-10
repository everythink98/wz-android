const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

// Expo SQLite stores this database in files/SQLite, not Android's databases/.
const readerRules = `    <include domain="sharedpref" path="." />
    <exclude domain="sharedpref" path="SecureStore" />
    <include domain="file" path="SQLite/reader-data.db" />
    <include domain="file" path="SQLite/reader-data.db-wal" />
    <include domain="file" path="SQLite/reader-data.db-shm" />`;

module.exports = function withReaderDataBackup(config) {
  config = withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0].$;
    application['android:fullBackupContent'] = '@xml/reader_backup_rules';
    application['android:dataExtractionRules'] = '@xml/reader_data_extraction_rules';
    return config;
  });
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'reader_backup_rules.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${readerRules}
</full-backup-content>
`
      );
      fs.writeFileSync(
        path.join(directory, 'reader_data_extraction_rules.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${readerRules}
  </cloud-backup>
  <device-transfer>
${readerRules}
  </device-transfer>
</data-extraction-rules>
`
      );
      return config;
    }
  ]);
};
