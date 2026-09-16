// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { relatedNativeTasks, verifyNativeTestReports } from '../../scripts/native-test-plan.mjs';

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
  it('does not schedule Native tests for unrelated content and includes both tasks after dependency changes', () => {
    expect(relatedNativeTasks(['README.md', 'src/features/user/UserScreen.tsx'])).toEqual([]);
    expect(relatedNativeTasks(['package-lock.json'])).toHaveLength(2);
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
