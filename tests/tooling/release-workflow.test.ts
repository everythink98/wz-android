import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(projectRoot, ...parts), 'utf8');
}

describe('release workflow trust gates', () => {
  it('requires a previous release baseline before expensive release work and fetches tags in CI', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const ciWorkflow = readProjectFile('.github', 'workflows', 'ci.yml');
    const envLoadIndex = releaseScript.indexOf('const configuredReleaseEnv = loadReleaseEnvFile()');
    const nodeGateIndex = releaseScript.indexOf('assertReleaseNode22(process.versions.node)');
    const cleanGateIndex = releaseScript.indexOf('const gitSha = cleanGitSha()');
    const signingPreflightIndex = releaseScript.indexOf('verifyReleaseSigningEnv(configuredReleaseEnv)');
    const versionGateIndex = releaseScript.indexOf(
      "run('node', ['scripts/check-version.mjs', '--require-previous-release']);"
    );
    const verifyIndex = releaseScript.indexOf("run('npm', ['run', 'verify']);");
    const resolvedKeystoreIndex = releaseScript.indexOf(
      'resolveReleaseKeystorePath(rootDir, releaseEnv.WZ_ANDROID_KEYSTORE_PATH)'
    );
    const absoluteKeystoreEnvIndex = releaseScript.indexOf('WZ_ANDROID_KEYSTORE_PATH: keystorePath');

    expect(resolvedKeystoreIndex).toBeGreaterThanOrEqual(0);
    expect(absoluteKeystoreEnvIndex).toBeGreaterThan(resolvedKeystoreIndex);
    expect(nodeGateIndex).toBeGreaterThan(envLoadIndex);
    expect(cleanGateIndex).toBeGreaterThan(nodeGateIndex);
    expect(signingPreflightIndex).toBeGreaterThan(cleanGateIndex);
    expect(versionGateIndex).toBeGreaterThan(signingPreflightIndex);
    expect(versionGateIndex).toBeLessThan(verifyIndex);
    expect(ciWorkflow).toMatch(/uses: actions\/checkout@v4\s+with:\s+fetch-depth: 0/);
  });

  it('scopes signing secrets to the final assembly and records build provenance', () => {
    const releaseScript = readProjectFile('scripts', 'release-android.mjs');
    const packageJson = JSON.parse(readProjectFile('package.json'));
    const packageSnapshotIndex = releaseScript.indexOf(
      'const packageJsonBeforePrebuild = readFileSync(packageJsonPath'
    );
    const prebuildIndex = releaseScript.indexOf(
      "['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install']"
    );
    const packageRestoreIndex = releaseScript.indexOf(
      'restorePackageJsonAfterPrebuild(packageJsonPath, packageJsonBeforePrebuild)'
    );
    const buildStagesIndex = releaseScript.indexOf('runReleaseBuildStages({');

    expect(packageJson.scripts).not.toHaveProperty('ios');
    expect(releaseScript).not.toContain('process.env[name] =');
    expect(packageSnapshotIndex).toBeGreaterThanOrEqual(0);
    expect(prebuildIndex).toBeGreaterThanOrEqual(0);
    expect(prebuildIndex).toBeGreaterThan(packageSnapshotIndex);
    expect(packageRestoreIndex).toBeGreaterThan(prebuildIndex);
    expect(buildStagesIndex).toBeGreaterThan(packageRestoreIndex);
    expect(releaseScript).toContain("process.once('exit', restorePackageJsonOnPrebuildFailure)");
    expect(releaseScript).toContain('gitSha');
    expect(releaseScript).toContain('packageLockSha256');
    expect(releaseScript).toContain('nodeVersion');
    expect(releaseScript).toContain('npmVersion');
    expect(releaseScript).toContain('javaVersion');
    expect(releaseScript).toContain('gradleVersion');
    expect(releaseScript).toContain('builtAbis');
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
