import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export function relatedNativeTasks(files) {
  const changed = files.map((file) => file.replaceAll('\\', '/'));
  const shared = changed.some((file) =>
    [
      'app.json',
      'package.json',
      'package-lock.json',
      '.github/workflows/ci.yml',
      'scripts/native-test-plan.mjs',
      'scripts/run-related-native-tests.mjs'
    ].includes(file)
  );
  const selection =
    shared ||
    changed.some(
      (file) =>
        file.startsWith('modules/forum-content-selection/') ||
        file.startsWith('src/features/topic/selection/') ||
        file === 'src/features/topic/useTopicRouteBeforeRemove.ts' ||
        file === 'scripts/run-forum-selection-native-tests.mjs' ||
        file.startsWith('patches/react-native+')
    );
  const app =
    shared ||
    changed.some(
      (file) =>
        file.startsWith('plugins/') ||
        file.startsWith('patches/') ||
        file.startsWith('src/platform/network/') ||
        file.startsWith('src/platform/media/svgPosterRenderer') ||
        file.startsWith('src/platform/diagnostics/')
    );
  return [
    ...(selection ? [':forum-content-selection:testDebugUnitTest'] : []),
    ...(app ? [':app:testReleaseUnitTest'] : [])
  ];
}

export function verifyNativeTestReports(root, startedAt) {
  const files = existsSync(root)
    ? readdirSync(root, { recursive: true })
        .map((file) => path.join(root, String(file)))
        .filter((file) => file.endsWith('.xml'))
    : [];
  let tests = 0;
  for (const file of files) {
    if (statSync(file).mtimeMs < startedAt - 1000) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/<testsuite\b[^>]*\btests="(\d+)"/gu))
      tests += Number(match[1]);
  }
  if (!tests) throw new Error(`Native test task produced no fresh nonempty report: ${root}`);
  return tests;
}
