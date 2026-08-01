import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('APK installer signer inspection', () => {
  it('[REG-UPDATE-004] inspects exactly one current APK signer instead of certificate history', () => {
    const plugin = readFileSync(path.resolve(__dirname, '../..', 'plugins', 'withApkInstaller.js'), 'utf8');

    expect(plugin).toContain(
      'singleCurrentApkSigner(signingInfo.apkContentsSigners, signingInfo.signingCertificateHistory)'
    );
    expect(plugin).toContain('singleCurrentApkSigner(packageInfo.signatures, null)');
    expect(plugin).toContain('): T? = currentSigners?.singleOrNull()');
    expect(plugin).toContain('singleCurrentApkSigner(arrayOf("current"), arrayOf("old", "current"))');
    expect(plugin).toContain('class ApkInstallerSignerTest');
    expect(plugin).not.toContain('firstOrNull()');
  });
});
