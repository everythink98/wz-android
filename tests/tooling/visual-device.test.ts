// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { runAgentDevice } from '../../scripts/agent-device-runtime.mjs';
import {
  assertVisualEnvironment,
  compareVisualFrame,
  loadApprovedVisualBaseline,
  visualFrames
} from '../../scripts/run-visual-device.mjs';

vi.mock('../../scripts/agent-device-runtime.mjs', () => ({
  runAgentDevice: vi.fn(),
  assertAgentDeviceVersion: vi.fn()
}));
const { PNG } = createRequire(import.meta.url)('pngjs');
const directories: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function images() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wz-visual-compare-'));
  directories.push(directory);
  const baseline = path.join(directory, 'baseline.png');
  const current = path.join(directory, 'current.png');
  const png = new PNG({ width: 20, height: 20 });
  png.data.fill(255);
  writeFileSync(baseline, PNG.sync.write(png));
  writeFileSync(current, readFileSync(baseline));
  return { baseline, current, diff: path.join(directory, 'diff.png') };
}
describe('device visual result contract', () => {
  it('requires all fourteen named frames including the two large-font states', () => {
    expect(new Set(visualFrames.map((frame) => frame.name)).size).toBe(14);
    expect(visualFrames.filter((frame) => frame.font === 1.4).map((frame) => frame.scene)).toEqual([
      'search.idle.recent',
      'user.profile.long'
    ]);
  });
  it('accepts only a complete zero-pixel CLI result at the fixed color threshold', () => {
    const files = images();
    vi.mocked(runAgentDevice).mockReturnValue(
      JSON.stringify({ success: true, data: { differentPixels: 0, totalPixels: 400 } })
    );
    expect(compareVisualFrame(files.baseline, files.current, files.diff)).toMatchObject({ differentPixels: 0 });
    expect(runAgentDevice).toHaveBeenCalledWith(expect.arrayContaining(['--threshold', '0.1']), expect.anything());
  });
  it.each([{ differentPixels: 1, totalPixels: 400 }, { differentPixels: 0, totalPixels: 399 }, { match: true }])(
    'rejects incomplete or changed pixel evidence: %j',
    (data) => {
      const files = images();
      vi.mocked(runAgentDevice).mockReturnValue(JSON.stringify({ success: true, data }));
      expect(() => compareVisualFrame(files.baseline, files.current, files.diff)).toThrow('Screenshot differs');
    }
  );
  it('rejects missing baselines and changed dimensions before invoking the comparator', () => {
    const files = images();
    expect(() => compareVisualFrame(`${files.baseline}-missing`, files.current, files.diff)).toThrow('Missing');
    writeFileSync(files.current, PNG.sync.write(new PNG({ width: 21, height: 20 })));
    expect(() => compareVisualFrame(files.baseline, files.current, files.diff)).toThrow('dimensions');
    expect(runAgentDevice).not.toHaveBeenCalled();
  });
  it('rejects a changed environment without accepting build identity as visual evidence', () => {
    const baseline = { fingerprint: 'api35-image', density: 420 };
    expect(() => assertVisualEnvironment(baseline, { ...baseline })).not.toThrow();
    expect(() => assertVisualEnvironment(baseline, { ...baseline, density: 440 })).toThrow('environment mismatch');
  });
  it('rejects missing approval and baseline files modified after approval', () => {
    const files = images();
    const directory = path.dirname(files.baseline);
    const bytes = readFileSync(files.baseline);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const report = {
      stable: true,
      approvedAt: '2026-09-17',
      frames: visualFrames.map((frame) => ({ name: frame.name, captures: [hash, hash, hash] }))
    };
    for (const frame of visualFrames) writeFileSync(path.join(directory, frame.name), bytes);
    writeFileSync(path.join(directory, 'baseline.json'), JSON.stringify(report));
    expect(loadApprovedVisualBaseline(directory).frames).toHaveLength(14);
    writeFileSync(path.join(directory, visualFrames[0].name), 'changed');
    expect(() => loadApprovedVisualBaseline(directory)).toThrow('checksum changed');
    writeFileSync(path.join(directory, 'baseline.json'), JSON.stringify({ ...report, approvedAt: null }));
    expect(() => loadApprovedVisualBaseline(directory)).toThrow('approved');
  });
});
