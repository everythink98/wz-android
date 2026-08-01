import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const temporaryRepositories: string[] = [];

function writeVersions(repository: string, version: string, versionCode: number) {
  writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    path.join(repository, 'app.json'),
    JSON.stringify({
      expo: {
        version,
        android: { versionCode }
      }
    })
  );
}

function createRepository(version: string, versionCode: number) {
  const repository = mkdtempSync(path.join(tmpdir(), 'wz-version-check-'));
  temporaryRepositories.push(repository);
  mkdirSync(path.join(repository, 'scripts'));
  copyFileSync(
    path.join(projectRoot, 'scripts', 'check-version.mjs'),
    path.join(repository, 'scripts', 'check-version.mjs')
  );
  writeVersions(repository, version, versionCode);
  execFileSync('git', ['init', '--quiet'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Version Check Test'], { cwd: repository });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: repository });
  return repository;
}

function commitVersions(repository: string, version: string, versionCode: number) {
  writeVersions(repository, version, versionCode);
  execFileSync('git', ['add', 'package.json', 'app.json'], { cwd: repository });
  execFileSync('git', ['commit', '--quiet', '-m', version], { cwd: repository });
}

function runVersionCheck(repository: string, ...args: string[]) {
  return spawnSync(process.execPath, ['scripts/check-version.mjs', ...args], {
    cwd: repository,
    encoding: 'utf8'
  });
}

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('Android release version gate', () => {
  it('[REG-OPS-012] rejects a version upgrade whose versionCode did not increase', () => {
    const repository = createRepository('1.0.0', 10);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repository });
    commitVersions(repository, '1.0.1', 10);

    const result = runVersionCheck(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('版本升级但 versionCode 未递增');
  });

  it('warns and continues when a normal local checkout has no release tag', () => {
    const repository = createRepository('1.0.0', 10);

    const result = runVersionCheck(repository);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('未找到上一正式版本 tag');
  });

  it('fails closed when a release checkout has no previous release tag', () => {
    const repository = createRepository('1.0.0', 10);

    const result = runVersionCheck(repository, '--require-previous-release');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('无法校验上一正式版本');
  });

  it('[REG-OPS-012] fails closed when the formal release checkout is shallow', () => {
    const source = createRepository('0.9.0', 9);
    commitVersions(source, '1.0.0', 10);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: source });
    commitVersions(source, '1.0.1', 11);
    const cloneRoot = mkdtempSync(path.join(tmpdir(), 'wz-version-shallow-'));
    temporaryRepositories.push(cloneRoot);
    const shallow = path.join(cloneRoot, 'repository');
    execFileSync('git', ['clone', '--quiet', '--depth', '2', pathToFileURL(source).href, shallow]);
    expect(
      execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
        cwd: shallow,
        encoding: 'utf8'
      }).trim()
    ).toBe('v1.0.0');

    const result = runVersionCheck(shallow, '--require-previous-release');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('浅克隆');
  });
});
