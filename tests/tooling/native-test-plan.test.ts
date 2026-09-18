// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    'plugins/network/NetworkProxyRuntime.kt',
    'plugins/svg/SvgRendererModule.kt',
    'patches/react-native+0.86.3.patch',
    'src/platform/network/request.ts'
  ])('runs generated app Native tests for %s', (file) => {
    expect(relatedNativeTasks([file])).toContain(':app:testReleaseUnitTest');
  });
  it('does not schedule Native tests for unrelated content and includes all owners after dependency changes', () => {
    expect(relatedNativeTasks(['README.md', 'src/features/user/UserScreen.tsx'])).toEqual([]);
    expect(relatedNativeTasks(['package-lock.json'])).toHaveLength(5);
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
      expect.arrayContaining(['com.wz.reader.ComposerKeyboardTest', 'com.wz.reader.ComposerWebViewInsetsTest'])
    );
  });
  it.each([
    ['patches/react-native+0.86.3.patch', ':react-native:packages:react-native:ReactAndroid:testDebugUnitTest'],
    ['plugins/withNetworkProxyModule.js', ':react-native:packages:react-native:ReactAndroid:testDebugUnitTest'],
    ['patches/expo-file-system+57.0.6.patch', ':expo-file-system:testDebugUnitTest'],
    ['src/platform/update/download.ts', ':expo-file-system:testDebugUnitTest'],
    ['patches/expo-image+57.0.4.patch', ':expo-image:testDebugUnitTest'],
    ['tests/native/ComposerKeyboardTest.kt', ':app:testReleaseUnitTest'],
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
