import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../..');
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
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repository });
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
  it.each<[string, string, number, string]>([
    ['a different package version', '1.0.1', 10, 'package.json version 1.0.1 != app.json version 1.0.0'],
    ['a zero versionCode', '1.0.0', 0, 'versionCode 必须是正整数'],
    ['a fractional versionCode', '1.0.0', 1.5, 'versionCode 必须是正整数']
  ])('rejects %s through the CLI', (_case, packageVersion, versionCode, message) => {
    const repository = createRepository('1.0.0', versionCode);
    writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ version: packageVersion }));

    const result = runVersionCheck(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('rejects a version upgrade whose versionCode did not increase', () => {
    const repository = createRepository('1.0.0', 10);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repository });
    commitVersions(repository, '1.0.1', 10);

    const result = runVersionCheck(repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('版本升级但 versionCode 未递增');
  });

  it('rejects a lower release version even when its Android code is higher', () => {
    const repository = createRepository('2.0.0', 20);
    execFileSync('git', ['tag', 'v2.0.0'], { cwd: repository });
    commitVersions(repository, '1.9.9', 21);
    const result = runVersionCheck(repository, '--require-previous-release');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('版本号必须高于 v2.0.0');
  });

  it('checks new releases against a newer tag on a parallel branch and permits tagged rebuilds', () => {
    const repository = createRepository('1.0.0', 10);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repository });
    commitVersions(repository, '1.0.1', 11);
    execFileSync('git', ['tag', '-a', 'v1.0.1', '-m', 'published'], { cwd: repository });
    commitVersions(repository, '1.0.10', 20);
    execFileSync('git', ['tag', 'v1.0.10'], { cwd: repository });
    execFileSync('git', ['checkout', '--quiet', '-b', 'maintenance', 'v1.0.1'], { cwd: repository });

    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
    commitVersions(repository, '1.0.9', 21);
    expect(runVersionCheck(repository, '--require-previous-release').stderr).toContain('版本号必须高于 v1.0.10');
    commitVersions(repository, '1.0.11', 20);
    expect(runVersionCheck(repository, '--require-previous-release').stderr).toContain('版本升级但 versionCode 未递增');
    commitVersions(repository, '1.0.11', 21);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
  });

  it('accepts the largest Android integer versionCode and rejects overflow at the release gate', () => {
    const repository = createRepository('1.0.0', 10);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repository });
    commitVersions(repository, '1.0.1', 2_147_483_647);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
    writeVersions(repository, '1.0.1', 2_147_483_648);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(1);
  });

  it('requires a fresh Android versionCode even if a maintenance release used it under a lower version name', () => {
    const repository = createRepository('1.0.0', 10);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: repository });
    commitVersions(repository, '2.0.0', 20);
    execFileSync('git', ['tag', 'v2.0.0'], { cwd: repository });
    execFileSync('git', ['checkout', '--quiet', '-b', 'maintenance', 'v1.0.0'], { cwd: repository });
    commitVersions(repository, '1.0.1', 21);
    execFileSync('git', ['tag', 'v1.0.1'], { cwd: repository });
    execFileSync('git', ['checkout', '--quiet', '-b', 'next', 'v2.0.0'], { cwd: repository });

    commitVersions(repository, '2.0.1', 21);
    expect(runVersionCheck(repository, '--require-previous-release').stderr).toContain('v1.0.1 为 21');
    commitVersions(repository, '2.0.1', 22);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
  });

  it('compares numeric components and only rebuilds an existing version at its tagged commit', () => {
    const repository = createRepository('1.0.9', 19);
    execFileSync('git', ['tag', 'v1.0.9'], { cwd: repository });
    commitVersions(repository, '1.0.10', 20);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
    execFileSync('git', ['tag', 'v1.0.10'], { cwd: repository });
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
    writeVersions(repository, '1.0.10', 21);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(1);
    writeVersions(repository, '1.0.10', 20);
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'new change'], { cwd: repository });
    expect(runVersionCheck(repository).status).toBe(0);
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(1);
  });

  it('rebuilds the first published tag from its own metadata', () => {
    const repository = createRepository('1.0.0', 10);
    execFileSync('git', ['tag', '-a', 'v1.0.0', '-m', 'first release'], { cwd: repository });
    expect(runVersionCheck(repository, '--require-previous-release').status).toBe(0);
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

  it('fails closed when the formal release checkout is shallow', () => {
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
