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
  'ComposerKeyboardTest',
  'ComposerKeyboardHostTest',
  'ComposerWebViewInsetsTest',
  'ComposerWebViewPrewarmTest',
  'DocumentPickerThreadingTest'
].map((name) => `com.wz.reader.${name}`);
const reactClasses = [
  'com.facebook.react.modules.fresco.ReactOkHttpNetworkFetcherTest',
  'com.facebook.react.views.swiperefresh.ReactSwipeRefreshLayoutTest',
  'com.facebook.react.views.image.ReactImageViewEventTest',
  'com.facebook.react.views.textinput.ReactTextInputUnderlineBackgroundTest',
  'com.facebook.react.views.text.TextLayoutManagerInlineViewSizeTest',
  'com.facebook.react.views.text.internal.span.CustomLineHeightSpanTest'
];
export const nativeTestTasks = {
  ':forum-platform:testDebugUnitTest': {
    related: (file) =>
      file.startsWith('modules/forum-platform/') ||
      file.startsWith('plugins/') ||
      file.startsWith('src/platform/network/') ||
      file.startsWith('src/platform/diagnostics/') ||
      file.startsWith('src/platform/media/') ||
      file.startsWith('src/platform/update/') ||
      file === 'src/platform/android/forumSearchCustomTab.ts' ||
      file === 'src/platform/android/secureRandom.ts' ||
      file === 'src/platform/notifications/notificationSystem.ts' ||
      file === 'src/ui/media/PreviewRegionImage.tsx' ||
      file.startsWith('src/platform/storage/backup') ||
      file === 'src/features/more/useBackupStatusController.ts',
    args: [],
    reports: 'modules/forum-platform/android/build/test-results/testDebugUnitTest',
    classes: [
      'DiagnosticLogStoreTest',
      'ManagedCookieResponsesTest',
      'NetworkProxyRuntimeTest',
      'SvgRendererPolicyTest',
      'BackupExportTest',
      'ImageDownloadTest',
      'ApkInstallerSignerTest',
      'ForumSearchCustomTabUrlTest',
      'NotificationDigestExecutorTest',
      'PreviewRegionImageMathTest',
      'ForumPlatformPackageTest'
    ].map((name) => `com.wz.reader.${name}`)
  },
  ':forum-content-selection:testDebugUnitTest': {
    related: (file) =>
      file.startsWith('modules/forum-content-selection/') ||
      file.startsWith('src/features/topic/selection/') ||
      file === 'src/features/topic/useTopicRouteBeforeRemove.ts' ||
      file === 'scripts/run-forum-selection-native-tests.mjs' ||
      file.startsWith('patches/react-native+'),
    args: [],
    reports: 'modules/forum-content-selection/android/build/test-results/testDebugUnitTest',
    classes: selectionClasses
  },
  ':app:testReleaseUnitTest': {
    related: (file) =>
      file.startsWith('tests/native/') ||
      file.startsWith('modules/forum-platform/android/src/main/java/com/wz/reader/composer/') ||
      file === 'src/ui/composer/ComposerKeyboardHost.tsx' ||
      file === 'src/ui/hooks/useKeyboardHandoff.ts' ||
      file === 'src/ui/sheets/FixedComposerPanel.tsx' ||
      file === 'src/ui/sheets/ComposerBottomSheet.tsx' ||
      file === 'src/ui/composer/StructuredReplyComposer.tsx' ||
      file.startsWith('src/platform/update/') ||
      file.startsWith('plugins/') ||
      file.startsWith('patches/') ||
      file.startsWith('src/platform/network/') ||
      file.startsWith('src/platform/media/svgPosterRenderer') ||
      file.startsWith('src/platform/diagnostics/'),
    args: ['-I', '../tests/native/composer-keyboard.gradle', '-PreactNativeArchitectures=x86_64'],
    reports: 'android/app/build/test-results/testReleaseUnitTest',
    classes: appClasses
  },
  ':react-native:packages:react-native:ReactAndroid:testDebugUnitTest': {
    related: (file) =>
      file.startsWith('patches/react-native+') ||
      file.startsWith('modules/forum-platform/') ||
      file === 'plugins/withForumPlatform.js' ||
      file.startsWith('src/platform/network/'),
    args: reactClasses.flatMap((name) => ['--tests', name]),
    reports: 'node_modules/react-native/ReactAndroid/build/test-results/testDebugUnitTest',
    classes: reactClasses
  },
  ':expo-file-system:testDebugUnitTest': {
    related: (file) => file.startsWith('patches/expo-file-system+') || file.startsWith('src/platform/update/'),
    args: ['--tests', 'expo.modules.filesystem.DownloadResponseTest'],
    reports: 'node_modules/expo-file-system/android/build/test-results/testDebugUnitTest',
    classes: ['expo.modules.filesystem.DownloadResponseTest']
  },
  ':expo-image:testDebugUnitTest': {
    related: (file) => file.startsWith('patches/expo-image+'),
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
  return Object.keys(nativeTestTasks).filter((task) => shared || changed.some(nativeTestTasks[task].related));
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
