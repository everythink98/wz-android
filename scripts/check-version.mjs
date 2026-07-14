import { readFileSync } from 'node:fs';
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

if (version !== appVersion) {
  errors.push(`package.json version ${version} != app.json version ${appVersion}`);
}
if (!Number.isInteger(versionCode) || versionCode < 1) {
  errors.push(`app.json Android versionCode 必须是正整数，当前为 ${versionCode}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
