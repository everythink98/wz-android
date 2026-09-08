const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const { androidPackagePath, injectMainApplicationPackage } = require('./androidPackageRegistration');

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
  const registered = injectMainApplicationPackage(contents, 'DiagnosticsPackage');
  if (registered.includes('DiagnosticJournal.install(this)')) return registered;
  if (!registered.includes('super.onCreate()')) throw new Error('Diagnostic application template changed.');
  return registered.replace('super.onCreate()', 'super.onCreate()\n    DiagnosticJournal.install(this)');
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
      const packageName = mod.android?.package;
      if (!packageName) throw new Error('Diagnostics requires an Android package.');
      const root = mod.modRequest.platformProjectRoot;
      for (const [sourceSet, fileNames] of [
        ['main', ['DiagnosticJournal.kt', 'DiagnosticsModule.kt']],
        ['test', ['DiagnosticLogStoreTest.kt']]
      ]) {
        const output = path.join(root, 'app', 'src', sourceSet, 'java', androidPackagePath(packageName));
        fs.mkdirSync(output, { recursive: true });
        for (const name of fileNames) {
          const template = fs.readFileSync(path.join(__dirname, 'diagnostics', name), 'utf8');
          fs.writeFileSync(
            path.join(output, name),
            template.replace(/^package com\.wz\.reader/m, `package ${packageName}`)
          );
        }
      }
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
