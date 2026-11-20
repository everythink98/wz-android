import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(...parts) {
  return JSON.parse(readFileSync(path.join(rootDir, ...parts), 'utf8'));
}

function gitOutput(...args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function releaseVersionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function validVersionCode(value) {
  return Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

function readTaggedReleases(tags) {
  // Each batch result has a header, exactly the declared number of blob bytes, then a newline.
  const blobs = execFileSync('git', ['cat-file', '--batch'], {
    cwd: rootDir,
    input: tags.map((tag) => `${tag}:app.json\n`).join(''),
    maxBuffer: Infinity,
    stdio: ['pipe', 'pipe', 'ignore']
  });
  let offset = 0;
  return tags.map((tag) => {
    const headerEnd = blobs.indexOf(10, offset);
    const header = /^\w+ blob (\d+)$/u.exec(blobs.toString('ascii', offset, headerEnd));
    if (!header) throw new Error(`无法读取 ${tag} 的 app.json。`);
    const start = headerEnd + 1;
    const end = start + Number(header[1]);
    const config = JSON.parse(blobs.toString('utf8', start, end)).expo;
    offset = end + 1;
    return { tag, version: config?.version, versionCode: config?.android?.versionCode };
  });
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
    const isShallow = gitOutput('rev-parse', '--is-shallow-repository') === 'true';
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
if (!validVersionCode(versionCode)) {
  errors.push(`app.json Android versionCode 必须是正整数且不超过 2147483647，当前为 ${versionCode}`);
}

let previousTags = [];
let taggedRebuild = false;
try {
  const currentTag = `v${appVersion}`;
  taggedRebuild =
    requirePreviousRelease && gitOutput('tag', '--points-at', 'HEAD', '--list', currentTag) === currentTag;
  if (taggedRebuild) {
    previousTags = [currentTag];
  } else if (requirePreviousRelease) {
    const tags = gitOutput('tag', '--list', '--sort=-version:refname', 'v*').split(/\r?\n/u);
    if (tags.includes(currentTag)) errors.push(`${currentTag} 已用于另一提交，正式发布必须递增版本号。`);
    // All release branches share the Android package and its upgrade sequence.
    previousTags = tags.filter((tag) => tag !== currentTag && releaseVersionParts(tag.slice(1)));
    if (!previousTags.length) throw new Error('No previous release tag');
  } else {
    previousTags = [gitOutput('describe', '--tags', '--abbrev=0', '--match', 'v*', '--exclude', currentTag)];
  }
} catch {
  const message = '未找到上一正式版本 tag，跳过 versionCode 递增校验。';
  if (requirePreviousRelease) {
    errors.push(`无法校验上一正式版本：${message}`);
  } else {
    console.warn(message);
  }
}

if (previousTags.length) {
  try {
    const releases = readTaggedReleases(previousTags);
    const { tag: previousTag, version: previousVersion } = releases[0];
    if (requirePreviousRelease) {
      const next = releaseVersionParts(appVersion);
      const previous = releaseVersionParts(previousVersion);
      const mismatch = releases.find((release) => release.tag !== `v${release.version}`);
      if (!next || !previous || mismatch) {
        errors.push(`正式版本须使用三段数字，历史 tag 与 app.json 必须一致：${mismatch?.tag || previousTag}。`);
      } else if (taggedRebuild) {
        if (versionCode !== releases[0].versionCode) {
          errors.push(`重建 ${previousTag} 时 versionCode 必须与原 tag 一致：${releases[0].versionCode}。`);
        }
      } else {
        const changed = next.findIndex((part, index) => part !== previous[index]);
        if (changed < 0 || next[changed] < previous[changed]) {
          errors.push(`正式发布版本号必须高于 ${previousTag}，当前为 ${appVersion}。`);
        }
      }
    }
    const invalidCode = releases.find((release) => !validVersionCode(release.versionCode));
    if (invalidCode) {
      errors.push(`${invalidCode.tag} 的 app.json Android versionCode 无效。`);
    } else {
      const highest = releases.reduce((a, b) => (a.versionCode >= b.versionCode ? a : b));
      if (appVersion !== previousVersion && versionCode <= highest.versionCode) {
        errors.push(`版本升级但 versionCode 未递增：${highest.tag} 为 ${highest.versionCode}，当前为 ${versionCode}`);
      }
    }
  } catch {
    errors.push('无法读取正式版本 tag 对应的 app.json。');
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
