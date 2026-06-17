import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(...parts) {
  const filePath = path.join(rootDir, ...parts);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function readJson(...parts) {
  return JSON.parse(readText(...parts));
}

const packageJson = readJson('package.json');
const appJson = readJson('app.json');
const version = packageJson.version;
const appVersion = appJson.expo?.version;
const versionCode = appJson.expo?.android?.versionCode;
const errors = [];

if (version !== appVersion) {
  errors.push(`package.json version ${version} != app.json version ${appVersion}`);
}

const readme = readText('README.md');
if (!readme.includes(`当前版本为 \`${version}\``)) {
  errors.push(`README.md 未同步版本 ${version}`);
}
if (!readme.includes(`versionCode\` 为 \`${versionCode}\``)) {
  errors.push(`README.md 未同步 versionCode ${versionCode}`);
}

const memory = readText('memory', 'project.md');
if (memory) {
  if (!memory.includes(`当前应用版本为 \`${version}\``)) {
    errors.push(`memory/project.md 未同步版本 ${version}`);
  }
  if (!memory.includes(`versionCode\` 为 \`${versionCode}\``)) {
    errors.push(`memory/project.md 未同步 versionCode ${versionCode}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
