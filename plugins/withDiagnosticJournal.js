const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { injectMainApplicationPackage } = require('./androidPackageRegistration');

function injectDiagnosticBuildId(contents, buildId) {
  if (!/^[a-f0-9]{32}$/.test(buildId)) throw new Error('Invalid diagnostic build identity.');
  const field = `buildConfigField 'String', 'DIAGNOSTIC_BUILD_ID', '\"${buildId}\"'`;
  if (/buildConfigField 'String', 'DIAGNOSTIC_BUILD_ID', '[^']*'/.test(contents)) {
    return contents.replace(/buildConfigField 'String', 'DIAGNOSTIC_BUILD_ID', '[^']*'/, field);
  }
  if (!/defaultConfig\s*\{/.test(contents)) throw new Error('Diagnostic build config template changed.');
  return contents.replace(/defaultConfig\s*\{/, (match) => `${match}\n        ${field}`);
}

function injectDiagnosticStartup(contents) {
  const registered = injectMainApplicationPackage(contents, 'com.wz.reader.DiagnosticsPackage');
  if (registered.includes('com.wz.reader.DiagnosticJournal.install(this,')) return registered;
  if (!registered.includes('super.onCreate()')) throw new Error('Diagnostic application template changed.');
  return registered.replace(
    'super.onCreate()',
    'super.onCreate()\n    com.wz.reader.DiagnosticJournal.install(this, BuildConfig.DIAGNOSTIC_BUILD_ID, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)'
  );
}

function withDiagnosticJournal(config) {
  const buildId = process.env.WZ_DIAGNOSTIC_BUILD_ID || randomUUID().replaceAll('-', '');
  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = injectDiagnosticBuildId(mod.modResults.contents, buildId);
    return mod;
  });
  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const root = mod.modRequest.platformProjectRoot;
      fs.writeFileSync(path.join(root, 'diagnostic-build.json'), JSON.stringify({ buildId }) + '\n');
      return mod;
    }
  ]);
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = injectDiagnosticStartup(mod.modResults.contents);
    return mod;
  });
}

module.exports = withDiagnosticJournal;
module.exports.injectDiagnosticBuildId = injectDiagnosticBuildId;
module.exports.injectDiagnosticStartup = injectDiagnosticStartup;
