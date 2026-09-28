// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nativeTestTasks, relatedNativeTasks, verifyNativeTestReports } from '../../scripts/native-test-plan.mjs';

describe('Native behavior test selection', () => {
  it.each([
    'modules/forum-content-selection/android/src/main/renamed.kt',
    'src/features/topic/selection/TopicSelectionSurface.tsx',
    'scripts/run-forum-selection-native-tests.mjs'
  ])('runs the selection module tests for %s', (file) => {
    expect(relatedNativeTasks([file])).toContain(':forum-content-selection:testDebugUnitTest');
  });
  it.each([
    'patches/react-native+0.86.3.patch',
    'patches/expo-document-picker+57.0.1.patch',
    'src/platform/network/request.ts'
  ])('runs generated app Native tests for %s', (file) => {
    expect(relatedNativeTasks([file])).toContain(':app:testReleaseUnitTest');
  });
  it('does not schedule Native tests for unrelated content and includes all owners after dependency changes', () => {
    expect(relatedNativeTasks(['README.md', 'src/features/user/UserScreen.tsx'])).toEqual([]);
    expect(relatedNativeTasks(['package-lock.json'])).toHaveLength(6);
  });
  it('executes App and Composer together with the test source overlay', () => {
    const tasks = relatedNativeTasks([
      'tests/native/ComposerKeyboardTest.kt',
      'patches/react-native-reanimated+4.patch',
      'patches/react-native-webview+13.patch'
    ]);
    expect(tasks.filter((task) => task === ':app:testReleaseUnitTest')).toHaveLength(1);
    const app = nativeTestTasks[':app:testReleaseUnitTest'];
    expect(app.args).toEqual(['-I', '../tests/native/composer-keyboard.gradle', '-PreactNativeArchitectures=x86_64']);
    expect(app.classes).toEqual(
      expect.arrayContaining([
        'com.wz.reader.ComposerKeyboardTest',
        'com.wz.reader.ComposerKeyboardHostTest',
        'com.wz.reader.ComposerWebViewInsetsTest',
        'com.wz.reader.ComposerWebViewPrewarmTest',
        'com.wz.reader.DocumentPickerThreadingTest'
      ])
    );
  });
  it('runs migrated platform behavior and bridge owners directly in the library', () => {
    const owners = [
      'ApkInstallerSigner',
      'ForumSearchCustomTabUrl',
      'NotificationDigestExecutor',
      'PreviewRegionImageMath',
      'ForumPlatformPackage'
    ].map((name) => `com.wz.reader.${name}Test`);
    expect(nativeTestTasks[':forum-platform:testDebugUnitTest'].classes).toEqual(expect.arrayContaining(owners));
    for (const owner of owners) expect(nativeTestTasks[':app:testReleaseUnitTest'].classes).not.toContain(owner);
    expect(
      relatedNativeTasks(['modules/forum-platform/android/src/main/java/com/wz/reader/ForumPlatformPackage.kt'])
    ).toContain(':forum-platform:testDebugUnitTest');
  });
  it.each([
    [
      'modules/forum-platform/android/src/main/java/com/wz/reader/network/NetworkProxyRuntime.kt',
      ':forum-platform:testDebugUnitTest'
    ],
    [
      'modules/forum-platform/android/src/main/java/com/wz/reader/svg/SvgRendererModule.kt',
      ':forum-platform:testDebugUnitTest'
    ],
    ['patches/react-native+0.86.3.patch', ':react-native:packages:react-native:ReactAndroid:testDebugUnitTest'],
    ['plugins/withForumPlatform.js', ':react-native:packages:react-native:ReactAndroid:testDebugUnitTest'],
    ['plugins/withForumPlatform.js', ':forum-platform:testDebugUnitTest'],
    ['src/platform/update/appUpdateDownload.ts', ':forum-platform:testDebugUnitTest'],
    ['src/platform/android/forumSearchCustomTab.ts', ':forum-platform:testDebugUnitTest'],
    ['src/platform/android/secureRandom.ts', ':forum-platform:testDebugUnitTest'],
    ['src/platform/notifications/notificationSystem.ts', ':forum-platform:testDebugUnitTest'],
    ['src/ui/media/PreviewRegionImage.tsx', ':forum-platform:testDebugUnitTest'],
    ['src/ui/sheets/ComposerBottomSheet.tsx', ':app:testReleaseUnitTest'],
    ['src/ui/sheets/FixedComposerPanel.tsx', ':app:testReleaseUnitTest'],
    ['src/ui/hooks/useKeyboardHandoff.ts', ':app:testReleaseUnitTest'],
    ['src/ui/composer/ComposerKeyboardHost.tsx', ':app:testReleaseUnitTest'],
    [
      'modules/forum-platform/android/src/main/java/com/wz/reader/composer/ComposerKeyboardHost.kt',
      ':app:testReleaseUnitTest'
    ],
    ['src/ui/composer/StructuredReplyComposer.tsx', ':app:testReleaseUnitTest'],
    ['patches/expo-file-system+57.0.6.patch', ':expo-file-system:testDebugUnitTest'],
    ['src/platform/update/download.ts', ':expo-file-system:testDebugUnitTest'],
    ['patches/expo-image+57.0.4.patch', ':expo-image:testDebugUnitTest'],
    ['tests/native/ComposerKeyboardTest.kt', ':app:testReleaseUnitTest'],
    ['tests/native/ComposerWebViewPrewarmTest.kt', ':app:testReleaseUnitTest'],
    ['tests/native/composer-keyboard.gradle', ':app:testReleaseUnitTest']
  ])('schedules the owning JVM task for %s', (file, task) => {
    expect(relatedNativeTasks([file])).toContain(task);
  });
  it.each([
    '<testsuite name="Neighbor" tests="3" skipped="0" failures="0" errors="0"/>',
    '<testsuite name="Owner" tests="0" skipped="0" failures="0" errors="0"/>',
    '<testsuite name="Owner" tests="3" skipped="3" failures="0" errors="0"/>',
    '<testsuite name="Owner" tests="3" skipped="0" failures="1" errors="0"/>',
    '<testsuite name="Owner" tests="3" skipped="0" failures="0" errors="1"/>'
  ])('rejects a report that does not prove the requested owner: %s', (xml) => {
    const root = mkdtempSync(join(tmpdir(), 'native-owner-'));
    try {
      writeFileSync(join(root, 'TEST.xml'), xml);
      expect(() => verifyNativeTestReports(root, Date.now(), ['Owner'])).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('rejects missing, zero and stale reports and accepts freshly executed cases', () => {
    const root = mkdtempSync(join(tmpdir(), 'native-reports-'));
    const now = Date.now();
    try {
      expect(() => verifyNativeTestReports(root, now)).toThrow();
      const file = join(root, 'TEST-owner.xml');
      writeFileSync(file, '<testsuite tests="0"/>');
      expect(() => verifyNativeTestReports(root, now)).toThrow();
      writeFileSync(file, '<testsuite tests="2"/>');
      expect(verifyNativeTestReports(root, now)).toBe(2);
      utimesSync(file, new Date(0), new Date(0));
      expect(() => verifyNativeTestReports(root, now)).toThrow();
      writeFileSync(join(root, 'TEST-neighbor.xml'), '<testsuite name="Neighbor" tests="3"/>');
      expect(() => verifyNativeTestReports(root, now, ['Owner'])).toThrow('Owner');
      writeFileSync(file, '<testsuite name="Owner" tests="2" skipped="1" failures="0" errors="0"/>');
      expect(verifyNativeTestReports(root, now, ['Owner'])).toBe(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('image instrumentation runner mode isolation', () => {
  it.each([
    ['--hardware-pressure', ['NetworkImageHardwarePressureInstrumentedTest'], 300_000],
    ['--svg-only', ['SvgRendererInstrumentedTest'], 180_000],
    [
      '--platform-export-ui',
      [
        'PlatformExportInstrumentedTest#realBackupBridgeRejectsProviderWriteFailuresAndReleasesItsPendingOperation',
        'PlatformExportInstrumentedTest#safRoundTripCancellationRecreationAndDelayedSharingUseRealExpoBridges'
      ],
      300_000
    ],
    [
      '--platform-exports',
      [
        'ImageDownloadInstrumentedTest,com.wz.reader.PlatformExportInstrumentedTest#realBackupBridgeRejectsProviderWriteFailuresAndReleasesItsPendingOperation',
        'PlatformExportInstrumentedTest#safRoundTripCancellationRecreationAndDelayedSharingUseRealExpoBridges'
      ],
      300_000
    ],
    [
      '--platform-file-faults',
      [
        'PlatformFileFaultInstrumentedTest#backupWriterRejectsProviderIoAndQuotaErrorsAfterPartialWrites,com.wz.reader.PlatformFileFaultInstrumentedTest#managedImageDownloadPropagatesProviderEnospcAndRemovesItsPart,com.wz.reader.PlatformFileFaultInstrumentedTest#backupWriterRejectsAnAlreadyReportedReliableDescriptorErrorAtClose,com.wz.reader.PlatformExportInstrumentedTest#realBackupBridgeRejectsProviderWriteFailuresAndReleasesItsPendingOperation'
      ],
      300_000
    ],
    [
      '',
      [
        'NetworkImageRuntimeInstrumentedTest,com.wz.reader.ManagedCookieResponsesInstrumentedTest,com.wz.reader.SvgRendererInstrumentedTest',
        'ManagedCookieResponsesInstrumentedTest#persistRenewalBeforeProcessExit',
        'ManagedCookieResponsesInstrumentedTest#restartedProcessAuthenticatesWithPersistedRenewal',
        ...['complete', 'error', 'cancel'].flatMap(() => [
          'ManagedCookieResponsesInstrumentedTest#observeWebViewTerminalCookieBeforeProcessExit',
          'ManagedCookieResponsesInstrumentedTest#observeWebViewTerminalCookieAfterProcessRestart'
        ]),
        'NetworkImagePressureInstrumentedTest'
      ],
      180_000
    ]
  ] as const)('keeps %s restricted to its intended owners', async (mode, owners, timeout) => {
    const originalArgv = process.argv;
    const exec = vi.fn((_command: string, args: readonly string[], _options?: { timeout?: number }) => {
      if (args[0] === 'devices') return 'List of devices attached\nemulator-5556\tdevice\n';
      if (args.includes('emu')) return 'WZ_ImageRuntime_Test_API35\nOK\n';
      if (args.includes('dumpsys')) return '';
      return 'OK (1 test)\n';
    });
    const spawn = vi.fn(() => ({ status: 0 }));
    vi.resetModules();
    vi.doMock('node:child_process', () => ({ execFileSync: exec, spawnSync: spawn }));
    vi.doMock('node:crypto', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:crypto')>()),
      randomUUID: () => 'fixture-build-id'
    }));
    vi.doMock('node:fs', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs')>()),
      existsSync: () => true,
      mkdirSync: vi.fn(),
      mkdtempSync: (prefix: string) => `${prefix}fixture`,
      readdirSync: () => ['35.0.0'],
      readFileSync: (file: string) =>
        file.endsWith('BuildConfig.java') ? 'fixturebuildid' : Buffer.from('fixture-apk'),
      rmSync: vi.fn(),
      writeFileSync: vi.fn()
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.argv = [process.execPath, 'scripts/run-network-image-instrumented-tests.mjs', ...(mode ? [mode] : [])];
      await import('../../scripts/run-network-image-instrumented-tests.mjs');
      const instruments = exec.mock.calls.filter(([, args]) => args.includes('instrument'));
      expect(instruments.map(([, args]) => args[args.indexOf('class') + 1])).toEqual(
        owners.map((owner) => `com.wz.reader.${owner}`)
      );
      expect(instruments[0][2]?.timeout).toBe(timeout);
      if (mode === '--hardware-pressure') {
        const forceStop = exec.mock.calls.findIndex(([, args]) => args.includes('force-stop'));
        expect(forceStop).toBeGreaterThan(-1);
        expect(forceStop).toBeLessThan(exec.mock.calls.findIndex(([, args]) => args.includes('instrument')));
        expect(instruments[0][1]).toEqual(expect.arrayContaining(['proofBuildId', 'fixturebuildid']));
      }
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      process.argv = originalArgv;
      log.mockRestore();
      output.mockRestore();
      vi.doUnmock('node:child_process');
      vi.doUnmock('node:crypto');
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});
