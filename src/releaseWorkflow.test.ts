import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(projectRoot, ...parts), 'utf8');
}

describe('release workflow trust gates', () => {
  it('requires a previous release baseline before expensive release work and fetches tags in CI', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const ciWorkflow = readProjectFile('.github', 'workflows', 'ci.yml');
    const preflightIndex = releaseScript.indexOf('verifyReleaseSigningEnv();');
    const versionGateIndex = releaseScript.indexOf("run('node', ['scripts/check-version.mjs', '--require-previous-release']);");
    const verifyIndex = releaseScript.indexOf("run('npm', ['run', 'verify']);");
    const resolvedKeystoreIndex = releaseScript.indexOf('path.resolve(rootDir, process.env.WZ_ANDROID_KEYSTORE_PATH)');
    const absoluteKeystoreEnvIndex = releaseScript.indexOf('process.env.WZ_ANDROID_KEYSTORE_PATH = keystorePath;');

    expect(resolvedKeystoreIndex).toBeGreaterThanOrEqual(0);
    expect(absoluteKeystoreEnvIndex).toBeGreaterThan(resolvedKeystoreIndex);
    expect(versionGateIndex).toBeGreaterThan(preflightIndex);
    expect(versionGateIndex).toBeLessThan(verifyIndex);
    expect(ciWorkflow).toMatch(/uses: actions\/checkout@v4\s+with:\s+fetch-depth: 0/);
  });

  it('pins React Doctor while retaining the permissions used by its configured review features', () => {
    const workflow = readProjectFile('.github', 'workflows', 'react-doctor.yml');

    expect(workflow).toContain('uses: millionco/react-doctor@01820bb4fd4d0a4aebcd8df2b2a143a098649cb2');
    expect(workflow).not.toContain('millionco/react-doctor@v2');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('statuses: write');
  });
});
