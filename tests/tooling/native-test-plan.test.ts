// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nativeTestTasks, relatedNativeTasks, verifyNativeTestReports } from '../../scripts/native-test-plan.mjs';

const sdkBuildTools = [{ name: '35.0.0', isDirectory: () => true }];

function instrumentationInstallTransport(permissionGranted = false) {
  const installed = new Set(['android']);
  const digest = createHash('sha256').update('fixture-apk').digest('hex');
  return (command: string, args: readonly string[]) => {
    const testPackage = args.at(-1)?.endsWith('androidTest.apk');
    const pkg = testPackage ? 'com.wz.reader.test' : 'com.wz.reader';
    if (/aapt2(?:\.exe)?$/.test(command)) return `package: name='${pkg}' versionCode='${testPackage ? '' : '42'}'`;
    if (command === 'java') return `Signer #1 certificate SHA-256 digest: ${'a'.repeat(64)}`;
    if (args.includes('packages')) return [...installed].map((name) => `package:${name}`).join('\n');
    if (args.includes('install')) {
      installed.add(pkg);
      return 'Success';
    }
    if (args.includes('path')) return `package:/data/app/${args.at(-1)}/base.apk`;
    if (args.includes('sha256sum')) return digest;
    if (args.includes('dumpsys'))
      return `userId=10042\nfirstInstallTime=2026-09-10 12:34:56\nUser 0: installed=true\nandroid.permission.READ_MEDIA_IMAGES: granted=${permissionGranted}`;
    return undefined;
  };
}

describe('Native behavior test selection', () => {
  it('does not schedule Native tests for unrelated content and includes all owners after dependency changes', () => {
    expect(relatedNativeTasks(['README.md', 'src/features/user/UserScreen.tsx'])).toEqual([]);
    expect(relatedNativeTasks(['package-lock.json'])).toEqual(Object.keys(nativeTestTasks));
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
        'com.wz.reader.DocumentPickerThreadingTest',
        'com.wz.reader.SharingModuleTest'
      ])
    );
  });
  it('runs migrated platform behavior and bridge owners directly in the library', () => {
    const owners = [
      'ApkInstallerSigner',
      'ForumSearchCustomTabUrl',
      'NotificationDigestExecutor',
      'PreviewRegionImageMath',
      'TopicShareCapture',
      'NetworkProxyProfile',
      'AppEncryptedDns',
      'NetworkUserAgent',
      'ForumPlatformPackage'
    ].map((name) => `com.wz.reader.${name}Test`);
    expect(nativeTestTasks[':forum-platform:testDebugUnitTest'].classes).toEqual(expect.arrayContaining(owners));
    for (const owner of owners) expect(nativeTestTasks[':app:testReleaseUnitTest'].classes).not.toContain(owner);
    expect(
      relatedNativeTasks(['modules/forum-platform/android/src/main/java/com/wz/reader/ForumPlatformPackage.kt'])
    ).toContain(':forum-platform:testDebugUnitTest');
  });
  it.each([
    ['modules/forum-content-selection/android/src/main/renamed.kt', ':forum-content-selection:testDebugUnitTest'],
    ['src/features/topic/selection/TopicSelectionSurface.tsx', ':forum-content-selection:testDebugUnitTest'],
    ['scripts/run-forum-selection-native-tests.mjs', ':forum-content-selection:testDebugUnitTest'],
    ['patches/react-native+0.86.3.patch', ':app:testReleaseUnitTest'],
    ['patches/expo-document-picker+57.0.1.patch', ':app:testReleaseUnitTest'],
    ['patches/expo-sharing+57.0.17.patch', ':app:testReleaseUnitTest'],
    ['src/platform/network/request.ts', ':app:testReleaseUnitTest'],
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
    ['patches/expo-blur+57.0.3.patch', ':expo-blur:testDebugUnitTest'],
    ['patches/expo-image+57.0.4.patch', ':forum-platform:testDebugUnitTest'],
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
  const fileFaultOwners = [
    'PlatformFileFaultInstrumentedTest#backupWriterRejectsProviderIoAndQuotaErrorsAfterPartialWrites',
    'PlatformFileFaultInstrumentedTest#managedImageDownloadPropagatesProviderEnospcAndRemovesItsPart',
    'PlatformFileFaultInstrumentedTest#backupWriterRejectsAnAlreadyReportedReliableDescriptorErrorAtClose',
    'PlatformExportInstrumentedTest#realBackupBridgeRejectsProviderWriteFailuresAndReleasesItsPendingOperation'
  ].map((owner) => `com.wz.reader.${owner}`);
  const topicShareOwners = [
    'singleLongPngIncludesAllRowsAndKeepsEveryBitmapUnder256Rows',
    'cancellationDiskFailureAndChangingLayoutDiscardThePartialPng',
    'realFabricScrollViewAndExpoImageCaptureThroughTheJsBridge',
    'realShareSheetPreservesOriginalImageDetailAndExportsOnePng'
  ].map((method) => `com.wz.reader.TopicShareCaptureInstrumentedTest#${method}`);
  const registryOwner =
    'com.wz.reader.AnimatedPropsRegistryInstrumentedTest#actualRegistrySettlesEvictsAndRefreshesInvalidatedProps';
  it.each([
    ['--registry-settlement', [registryOwner], 180_000],
    ['--hardware-pressure', ['NetworkImageHardwarePressureInstrumentedTest'], 300_000],
    ['--topic-share', [topicShareOwners.join(',')], 300_000],
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
    ['--platform-file-faults', [fileFaultOwners.join(',')], 300_000],
    ...['missing', 'started', 'skipped', 'duplicate', 'wrong-owner', 'failed', 'summary-only'].flatMap(
      (failure): [string, string[], number, string][] => [
        ['--platform-file-faults', [fileFaultOwners.join(',')], 300_000, failure],
        ['--topic-share', [topicShareOwners.join(',')], 300_000, failure],
        ['--registry-settlement', [registryOwner], 180_000, failure]
      ]
    ),
    ...['missing-final-code', 'failed-final-code', 'duplicate-final-code', 'instrumentation-failed'].map(
      (failure): [string, string[], number, string] => ['--registry-settlement', [registryOwner], 180_000, failure]
    ),
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
  ] satisfies [string, readonly string[], number, string?][])(
    'keeps %s restricted to completed owners with %s at timeout %s and failure %s',
    async (mode, owners, timeout, failure?: string) => {
      const originalArgv = process.argv;
      const registry = mode === '--registry-settlement';
      const installTransport = instrumentationInstallTransport();
      const exec = vi.fn((command: string, args: readonly string[], _options?: { timeout?: number }) => {
        const installation = installTransport(command, args);
        if (installation !== undefined) return installation;
        if (args[0] === 'devices') return 'List of devices attached\nemulator-5556\tdevice\n';
        if (args.includes('emu')) return 'WZ_ImageRuntime_Test_API35\nOK\n';
        if (
          args.includes('instrument') &&
          (registry || mode === '--platform-file-faults' || mode === '--topic-share')
        ) {
          const expected = registry ? [registryOwner] : mode === '--topic-share' ? topicShareOwners : fileFaultOwners;
          const completed = failure === 'missing' ? expected.slice(0, registry ? 0 : 1) : [...expected];
          if (failure === 'duplicate') {
            if (registry) completed.push(registryOwner);
            else completed[3] = completed[0];
          }
          if (failure === 'wrong-owner') completed[registry ? 0 : 3] = 'com.wz.reader.OtherTest#otherMethod';
          const statuses =
            failure === 'summary-only'
              ? ''
              : completed
                  .map((owner, index) => {
                    const [className, method] = owner.split('#');
                    const code =
                      index === (registry ? 0 : 3) && failure
                        ? failure === 'started'
                          ? 1
                          : failure === 'skipped'
                            ? -3
                            : failure === 'failed'
                              ? -2
                              : 0
                        : 0;
                    return `INSTRUMENTATION_STATUS: test=${method}\r\nINSTRUMENTATION_STATUS: class=${className}\r\nINSTRUMENTATION_STATUS_CODE: ${code}\r\n`;
                  })
                  .join('');
          const final =
            !registry || failure === 'missing-final-code'
              ? ''
              : `INSTRUMENTATION_CODE: ${failure === 'failed-final-code' ? -2 : -1}\n` +
                (failure === 'duplicate-final-code' ? 'INSTRUMENTATION_CODE: -1\n' : '') +
                (failure === 'instrumentation-failed' ? 'INSTRUMENTATION_FAILED: fixture launch failed\n' : '');
          return `${statuses}OK (${registry ? 1 : completed.length} tests)\n${final}`;
        }
        return 'OK (1 test)\n';
      });
      const spawn = vi.fn((_command: string, _args: readonly string[]) => ({ status: 0 }));
      const write = vi.fn<(file: string, contents: string) => void>();
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
        readdirSync: () => sdkBuildTools,
        readFileSync: (file: string) =>
          file.endsWith('BuildConfig.java') ? 'fixturebuildid' : Buffer.from('fixture-apk'),
        rmSync: vi.fn(),
        writeFileSync: write
      }));
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        process.argv = [process.execPath, 'scripts/run-network-image-instrumented-tests.mjs', ...(mode ? [mode] : [])];
        const running = import('../../scripts/run-network-image-instrumented-tests.mjs');
        if (failure) await expect(running).rejects.toThrow('instrumentation');
        else await running;
        const instruments = exec.mock.calls.filter(([, args]) => args.includes('instrument'));
        expect(instruments.map(([, args]) => args[args.indexOf('class') + 1])).toEqual(
          owners.map((owner) => (owner.startsWith('com.wz.reader.') ? owner : `com.wz.reader.${owner}`))
        );
        expect(instruments[0][2]?.timeout).toBe(timeout);
        const initWrite = write.mock.calls.find(([file]) => file.endsWith('init.gradle'));
        if (!initWrite) throw new Error('Expected generated instrumentation init script');
        const [initFile, init] = initWrite;
        if (registry) {
          expect(init).toContain('tests/native/reanimated-settlement/registry-proof.cmake');
          expect(init).toContain('CMAKE_PROJECT_Reanimated_INCLUDE=');
          expect(init).toContain("p.dependencies.add('implementation', 'com.facebook.react:hermes-android')");
          expect(init).toContain("getByName('release').java.srcDir(new File(registry, 'java'))");
          expect(init).toContain("getByName('androidTest').java.srcDir(new File(registry, 'androidTest'))");
          expect(init).not.toMatch(/entryFile|manifest\.srcFile|res\.srcDir/);
          expect(
            exec.mock.calls.some(([, args]) =>
              args.some((arg) => ['force-stop', 'cookieProofStage', 'grant', 'revoke'].includes(arg))
            )
          ).toBe(false);
          expect(instruments[0][1]).toEqual(expect.arrayContaining(['proofBuildId', 'fixturebuildid']));
        } else {
          expect(init).not.toMatch(/reanimated-settlement|CMAKE_PROJECT_Reanimated_INCLUDE|hermes-android/);
        }
        expect(spawn.mock.calls[0][1].some((arg) => arg.includes(initFile))).toBe(true);
        expect(spawn.mock.calls.at(-1)?.[1]).toContain(':app:assembleRelease');
        expect(spawn.mock.calls.at(-1)?.[1].some((arg) => arg.includes(initFile))).toBe(false);
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
    }
  );
  it('keeps the registry oracle in a stable deferred CMake asset', () => {
    const cmake = readFileSync(
      new URL('../native/reanimated-settlement/registry-proof.cmake', import.meta.url),
      'utf8'
    );
    expect(cmake).toContain('cmake_language(DEFER CALL wz_add_registry_proof)');
    expect(cmake).toContain('${CMAKE_CURRENT_FUNCTION_LIST_DIR}/registry-proof.cpp');
    expect(cmake).toContain('target_link_libraries(reanimated hermes-engine::hermesvm)');
    expect(cmake).not.toMatch(/\.codex-tmp|registry-bootstrap/);
  });
});

describe('image instrumentation permission lease cleanup', () => {
  async function runFixture(
    failures: {
      instrument?: { error: unknown };
      grant?: { error: unknown };
      revoke?: { error: unknown };
      fixture?: { error: unknown };
      restoreBuild?: { error: unknown };
      permissionGranted?: boolean;
    } = {}
  ) {
    const originalArgv = process.argv;
    const installTransport = instrumentationInstallTransport(failures.permissionGranted);
    const exec = vi.fn((command: string, args: readonly string[]) => {
      const installation = installTransport(command, args);
      if (installation !== undefined) return installation;
      if (args[0] === 'devices') return 'List of devices attached\nemulator-5556\tdevice\n';
      if (args.includes('emu')) return 'WZ_ImageRuntime_Test_API35\nOK\n';
      if (args.includes('grant') && failures.grant) throw failures.grant.error;
      if (args.includes('instrument')) {
        if (failures.instrument) throw failures.instrument.error;
        return 'OK (1 test)\n';
      }
      if (args.includes('revoke') && failures.revoke) throw failures.revoke.error;
      return '';
    });
    const spawn = vi.fn((): { status: number | null; error?: unknown } =>
      spawn.mock.calls.length === 2 && failures.restoreBuild
        ? { error: failures.restoreBuild.error, status: null }
        : { status: 0 }
    );
    const remove = vi.fn(() => {
      if (failures.fixture) throw failures.fixture.error;
    });
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
      readdirSync: () => sdkBuildTools,
      readFileSync: (file: string) =>
        file.endsWith('BuildConfig.java') ? 'fixturebuildid' : Buffer.from('fixture-apk'),
      rmSync: remove,
      writeFileSync: vi.fn()
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let outcome: { kind: 'passed' } | { kind: 'failed'; error: unknown } = { kind: 'passed' };
    try {
      process.argv = [process.execPath, 'scripts/run-network-image-instrumented-tests.mjs', '--platform-exports'];
      await import('../../scripts/run-network-image-instrumented-tests.mjs');
    } catch (error) {
      outcome = { kind: 'failed', error };
    } finally {
      process.argv = originalArgv;
      log.mockRestore();
      output.mockRestore();
      vi.doUnmock('node:child_process');
      vi.doUnmock('node:crypto');
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
    return { outcome, exec, spawn, remove };
  }

  it('retains permission restoration responsibility when the temporary grant fails', async () => {
    const failure = new Error('Permission grant failed');
    const result = await runFixture({ grant: { error: failure } });
    expect(
      result.exec.mock.calls
        .filter(([, args]) => args.includes('grant') || args.includes('revoke'))
        .map(([, args]) => args.slice(2))
    ).toEqual([
      ['shell', 'pm', 'grant', 'com.wz.reader', 'android.permission.READ_MEDIA_IMAGES'],
      ['shell', 'pm', 'revoke', 'com.wz.reader', 'android.permission.READ_MEDIA_IMAGES']
    ]);
    expect(result.exec.mock.calls.some(([, args]) => args.includes('instrument'))).toBe(false);
    expect(result.remove).toHaveBeenCalledOnce();
    expect(result.spawn).toHaveBeenCalledTimes(2);
    if (result.outcome.kind !== 'failed') throw new Error('Expected grant failure');
    expect(result.outcome.error).toBe(failure);
  });

  it('restores the normal build and releases the fixture even when permission restoration fails', async () => {
    const failure = new Error('permission restore');
    const result = await runFixture({ revoke: { error: failure } });
    expect(result.remove).toHaveBeenCalledOnce();
    expect(result.spawn).toHaveBeenCalledTimes(2);
    expect(result.outcome).toEqual({ kind: 'failed', error: failure });
  });

  it('preserves the body and every cleanup failure, including falsy thrown values', async () => {
    const business = new Error('instrumentation');
    const permission = new Error('permission restore');
    const restoreBuild = new Error('normal build restore');
    const result = await runFixture({
      instrument: { error: business },
      revoke: { error: permission },
      fixture: { error: false },
      restoreBuild: { error: restoreBuild }
    });
    expect(result.remove).toHaveBeenCalledOnce();
    expect(result.spawn).toHaveBeenCalledTimes(2);
    if (result.outcome.kind !== 'failed') throw new Error('Expected all causes');
    if (!(result.outcome.error instanceof AggregateError)) throw new Error('Expected compound failure');
    expect(result.outcome.error.errors).toEqual([business, permission, false, restoreBuild]);
  });

  it('preserves an existing image permission and still releases every local resource', async () => {
    const result = await runFixture({ permissionGranted: true });
    expect(result.outcome).toEqual({ kind: 'passed' });
    expect(result.exec.mock.calls.some(([, args]) => args.includes('grant') || args.includes('revoke'))).toBe(false);
    expect(result.remove).toHaveBeenCalledOnce();
    expect(result.spawn).toHaveBeenCalledTimes(2);
  });
});
