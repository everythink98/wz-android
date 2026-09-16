import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relatedNativeTasks, verifyNativeTestReports } from './native-test-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--base'))
  throw new Error('Usage: run-related-native-tests.mjs [--base revision]');
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/u).filter(Boolean);
const base = args[1];
const files =
  base && !/^0+$/u.test(base)
    ? git('diff', '--name-only', base, 'HEAD', '--')
    : base
      ? git('ls-files')
      : [...git('diff', '--name-only', 'HEAD', '--'), ...git('ls-files', '--others', '--exclude-standard')];
for (const task of relatedNativeTasks(files)) {
  const startedAt = Date.now();
  const result = spawnSync(
    process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
    [task, '--rerun', '--no-daemon', '--console=plain'],
    { cwd: path.join(root, 'android'), stdio: 'inherit', shell: process.platform === 'win32' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const reports = task.startsWith(':app:')
    ? 'android/app/build/test-results/testReleaseUnitTest'
    : 'modules/forum-content-selection/android/build/test-results/testDebugUnitTest';
  console.log(`${task}: ${verifyNativeTestReports(path.join(root, reports), startedAt)} tests`);
}
