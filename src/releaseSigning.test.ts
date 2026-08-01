import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveReleaseKeystorePath } from '../scripts/release-environment.mjs';

const temporaryProjects: string[] = [];
const require = createRequire(import.meta.url);
const { singleApkSignerSha256 } = require('../scripts/apk-signing.cjs') as {
  singleApkSignerSha256: (output: string) => string;
};

function createReleaseProject() {
  const project = mkdtempSync(path.join(tmpdir(), 'wz-release-signing-'));
  temporaryProjects.push(project);
  return project;
}

afterEach(() => {
  for (const project of temporaryProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe('Android release signing preflight', () => {
  it('[REG-UPDATE-004] accepts exactly one current signer and rejects a second signer', () => {
    const official = 'ab'.repeat(32);
    const other = 'cd'.repeat(32);

    expect(singleApkSignerSha256(`Signer #1 certificate SHA-256 digest: ${official}`)).toBe(official);
    expect(singleApkSignerSha256([
      `Signer #1 certificate SHA-256 digest: ${official}`,
      `Signer #2 certificate SHA-256 digest: ${other}`
    ].join('\n'))).toBe('');
  });

  it('[REG-OPS-013] rejects a missing repository-relative keystore', () => {
    const project = createReleaseProject();

    expect(() => resolveReleaseKeystorePath(project, 'signing/release.jks'))
      .toThrow(`keystore 不存在：${path.join(project, 'signing', 'release.jks')}`);
  });

  it('rejects a directory used as the release keystore', () => {
    const project = createReleaseProject();
    mkdirSync(path.join(project, 'signing'));

    expect(() => resolveReleaseKeystorePath(project, 'signing'))
      .toThrow('keystore 不是普通文件');
  });
});
