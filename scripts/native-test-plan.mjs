import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const selectionClasses = [
  'ForumTextOffsetMapTest',
  'ForumSelectionSystemActionsTest',
  'ForumSelectionGesturePolicyTest',
  'ForumSelectionDocumentTest',
  'ForumReplacementRangeMatcherTest'
].map((name) => `expo.modules.forumcontentselection.${name}`);
const appClasses = [
  'ApkInstallerSignerTest',
  'ForumSearchCustomTabUrlTest',
  'NotificationDigestExecutorTest',
  'PreviewRegionImageMathTest',
  'ComposerKeyboardTest',
  'ComposerWebViewInsetsTest'
].map((name) => `com.wz.reader.${name}`);
const reactClasses = [
  'com.facebook.react.modules.fresco.ReactOkHttpNetworkFetcherTest',
  'com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayoutTest',
  'com.facebook.react.views.image.ReactImageViewEventTest',
  'com.facebook.react.views.text.TextLayoutManagerInlineViewSizeTest',
  'com.facebook.react.views.text.internal.span.CustomLineHeightSpanTest'
];
export const nativeTestTasks = {
  ':forum-platform:testDebugUnitTest': {
    args: [],
    reports: 'modules/forum-platform/android/build/test-results/testDebugUnitTest',
    classes: [
      'DiagnosticLogStoreTest',
      'ManagedCookieResponsesTest',
      'NetworkProxyRuntimeTest',
      'SvgRendererPolicyTest',
      'BackupExportTest',
      'ImageDownloadTest'
    ].map((name) => `com.wz.reader.${name}`)
  },
  ':forum-content-selection:testDebugUnitTest': {
    args: [],
    reports: 'modules/forum-content-selection/android/build/test-results/testDebugUnitTest',
    classes: selectionClasses
  },
  ':app:testReleaseUnitTest': {
    args: ['-I', '../tests/native/composer-keyboard.gradle', '-PreactNativeArchitectures=x86_64'],
    reports: 'android/app/build/test-results/testReleaseUnitTest',
    classes: appClasses
  },
  ':react-native:packages:react-native:ReactAndroid:testDebugUnitTest': {
    args: reactClasses.flatMap((name) => ['--tests', name]),
    reports: 'node_modules/react-native/ReactAndroid/build/test-results/testDebugUnitTest',
    classes: reactClasses
  },
  ':expo-file-system:testDebugUnitTest': {
    args: ['--tests', 'expo.modules.filesystem.DownloadResponseTest'],
    reports: 'node_modules/expo-file-system/android/build/test-results/testDebugUnitTest',
    classes: ['expo.modules.filesystem.DownloadResponseTest']
  },
  ':expo-image:testDebugUnitTest': {
    args: [
      '--tests',
      'expo.modules.image.events.GlideRequestListenerTest',
      '--tests',
      'expo.modules.image.ExpoImageViewWrapperTest'
    ],
    reports: 'node_modules/expo-image/android/build/test-results/testDebugUnitTest',
    classes: ['expo.modules.image.events.GlideRequestListenerTest', 'expo.modules.image.ExpoImageViewWrapperTest']
  }
};

export function relatedNativeTasks(files) {
  const changed = files.map((file) => file.replaceAll('\\', '/'));
  const shared = changed.some((file) =>
    [
      'app.json',
      'package.json',
      'package-lock.json',
      '.github/workflows/ci.yml',
      'scripts/native-test-plan.mjs',
      'scripts/run-related-native-tests.mjs',
      'tests/tooling/native-test-plan.test.ts',
      'plugins/withAndroidGradleJvmMemory.js',
      'gradle.properties'
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
        file.startsWith('tests/native/') ||
        file === 'src/ui/controls/ComposerBottomSheet.tsx' ||
        file.startsWith('src/platform/update/') ||
        file.startsWith('plugins/') ||
        file.startsWith('patches/') ||
        file.startsWith('src/platform/network/') ||
        file.startsWith('src/platform/media/svgPosterRenderer') ||
        file.startsWith('src/platform/diagnostics/')
    );
  return [
    ...(shared ||
    changed.some(
      (file) =>
        file.startsWith('modules/forum-platform/') ||
        file.startsWith('plugins/') ||
        file.startsWith('src/platform/network/') ||
        file.startsWith('src/platform/diagnostics/') ||
        file.startsWith('src/platform/media/') ||
        file.startsWith('src/platform/storage/backup') ||
        file === 'src/features/more/useBackupStatusController.ts'
    )
      ? [':forum-platform:testDebugUnitTest']
      : []),
    ...(selection ? [':forum-content-selection:testDebugUnitTest'] : []),
    ...(app ? [':app:testReleaseUnitTest'] : []),
    ...(shared ||
    changed.some(
      (file) =>
        file.startsWith('patches/react-native+') ||
        file.startsWith('plugins/network/') ||
        file.startsWith('modules/forum-platform/') ||
        file === 'plugins/withNetworkProxyModule.js' ||
        file.startsWith('src/platform/network/')
    )
      ? [':react-native:packages:react-native:ReactAndroid:testDebugUnitTest']
      : []),
    ...(shared ||
    changed.some((file) => file.startsWith('patches/expo-file-system+') || file.startsWith('src/platform/update/'))
      ? [':expo-file-system:testDebugUnitTest']
      : []),
    ...(shared || changed.some((file) => file.startsWith('patches/expo-image+'))
      ? [':expo-image:testDebugUnitTest']
      : [])
  ];
}

export function verifyNativeTestReports(root, startedAt, expectedClasses = []) {
  const files = existsSync(root)
    ? readdirSync(root, { recursive: true })
        .map((file) => path.join(root, String(file)))
        .filter((file) => file.endsWith('.xml'))
    : [];
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const executed = new Set();
  let tests = 0;
  for (const file of files) {
    if (statSync(file).mtimeMs < startedAt - 1000) continue;
    const xml = readFileSync(file, 'utf8');
    if (XMLValidator.validate(xml) !== true) throw new Error(`Invalid Native test report: ${file}`);
    const parsed = parser.parse(xml);
    const suites = parsed.testsuite ?? parsed.testsuites?.testsuite ?? [];
    for (const suite of Array.isArray(suites) ? suites : [suites]) {
      const counts = ['tests', 'skipped', 'failures', 'errors'].map((key) =>
        Number(suite[key] ?? (key === 'tests' ? NaN : 0))
      );
      const [total, skipped, failures, errors] = counts;
      if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) || skipped > total || failures || errors) {
        throw new Error(`Failed or invalid Native test suite: ${suite.name ?? file}`);
      }
      if (total > skipped) {
        tests += total - skipped;
        executed.add(suite.name);
      }
    }
  }
  for (const name of expectedClasses) {
    if (!executed.has(name)) throw new Error(`Native test class has no fresh executed cases: ${name} (${root})`);
  }
  if (!tests) throw new Error(`Native test task produced no fresh nonempty report: ${root}`);
  return tests;
}
