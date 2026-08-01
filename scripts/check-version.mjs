import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(...parts) {
  return JSON.parse(readFileSync(path.join(rootDir, ...parts), 'utf8'));
}

const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const version = packageJson.version;
const appVersion = appJson.expo?.version;
const versionCode = appJson.expo?.android?.versionCode;
const errors = [];
const requirePreviousRelease = process.argv.includes('--require-previous-release');

if (requirePreviousRelease) {
  try {
    const isShallow =
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() === 'true';
    if (isShallow) {
      errors.push('正式发布不能从浅克隆校验上一正式版本。');
    }
  } catch {
    errors.push('无法确认正式发布仓库是否为浅克隆。');
  }
}

if (version !== appVersion) {
  errors.push(`package.json version ${version} != app.json version ${appVersion}`);
}
if (!Number.isInteger(versionCode) || versionCode < 1) {
  errors.push(`app.json Android versionCode 必须是正整数，当前为 ${versionCode}`);
}

let previousTag = '';
try {
  previousTag = execFileSync(
    'git',
    ['describe', '--tags', '--abbrev=0', '--match', 'v*', '--exclude', `v${appVersion}`],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }
  ).trim();
} catch {
  const message = '未找到上一正式版本 tag，跳过 versionCode 递增校验。';
  if (requirePreviousRelease) {
    errors.push(`无法校验上一正式版本：${message}`);
  } else {
    console.warn(message);
  }
}

if (previousTag) {
  try {
    const previousAppJson = JSON.parse(
      execFileSync('git', ['show', `${previousTag}:app.json`], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
    );
    const previousVersion = previousAppJson.expo?.version;
    const previousVersionCode = previousAppJson.expo?.android?.versionCode;
    if (!Number.isInteger(previousVersionCode) || previousVersionCode < 1) {
      errors.push(`${previousTag} 的 app.json Android versionCode 无效。`);
    } else if (appVersion !== previousVersion && versionCode <= previousVersionCode) {
      errors.push(`版本升级但 versionCode 未递增：${previousTag} 为 ${previousVersionCode}，当前为 ${versionCode}`);
    }
  } catch {
    errors.push(`无法读取上一正式版本 ${previousTag} 的 app.json。`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
