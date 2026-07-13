import { spawnSync } from 'node:child_process';

function runGitCommand(rootDir, args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 执行失败：${result.stderr || result.error?.message || 'unknown error'}`);
  }
  return result.stdout.trim();
}

function compareVersions(left, right) {
  const parse = (value) => /^\d+\.\d+\.\d+$/.test(value)
    ? value.split('.').map(Number)
    : null;
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) {
    return null;
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

export function validateVersionState({ current, head, latest, releaseCandidate }) {
  if (!latest) {
    return releaseCandidate ? ['未找到可比较的历史 release tag，拒绝发布。'] : [];
  }
  const errors = [];
  const order = compareVersions(current.version, latest.version);
  if (order === null) {
    errors.push(`版本号必须为 x.y.z，当前为 ${current.version}，历史 ${latest.tag} 为 ${latest.version}。`);
    return errors;
  }
  if (order < 0) {
    errors.push(`版本 ${current.version} 不能低于历史 ${latest.tag} 的 ${latest.version}。`);
  } else if (order === 0) {
    if (current.versionCode !== latest.versionCode) {
      errors.push(`版本 ${current.version} 已由 ${latest.tag} 固定为 versionCode ${latest.versionCode}，当前为 ${current.versionCode}。`);
    }
    if (releaseCandidate && head !== latest.commit) {
      errors.push(`${latest.tag} 已发布；新提交发布前必须递增 version 和 versionCode。`);
    }
  } else if (current.versionCode <= latest.versionCode) {
    errors.push(`Android versionCode ${current.versionCode} 必须高于历史 ${latest.tag} 的 ${latest.versionCode}。`);
  }
  return errors;
}

export function assertCleanWorktree({ rootDir, phase = '发布前', runGit = runGitCommand }) {
  const status = runGit(rootDir, ['status', '--porcelain=v1', '--untracked-files=all']).trim();
  if (status) {
    throw new Error(`${phase}要求 git 工作区干净：\n${status}`);
  }
}

function latestRelease(rootDir, runGit) {
  const tags = runGit(rootDir, ['tag', '--list', 'v*', '--sort=-version:refname'])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  for (const tag of tags) {
    try {
      const app = JSON.parse(runGit(rootDir, ['show', `${tag}:app.json`]));
      const version = app.expo?.version;
      const versionCode = app.expo?.android?.versionCode;
      if (typeof version === 'string' && Number.isInteger(versionCode)) {
        return {
          tag,
          version,
          versionCode,
          commit: runGit(rootDir, ['rev-list', '-n', '1', tag])
        };
      }
    } catch {
      // Ignore non-release tags without a readable app.json.
    }
  }
  return null;
}

export function assertVersionState({ rootDir, current, releaseCandidate = false, runGit = runGitCommand }) {
  const shallow = runGit(rootDir, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  if (shallow) {
    if (releaseCandidate) {
      throw new Error('当前仓库是 shallow clone，发布历史不完整；请先执行 git fetch --unshallow --tags。');
    }
    return { checked: false, reason: 'shallow-history' };
  }
  const errors = validateVersionState({
    current,
    head: runGit(rootDir, ['rev-parse', 'HEAD']),
    latest: latestRelease(rootDir, runGit),
    releaseCandidate
  });
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  return { checked: true };
}
