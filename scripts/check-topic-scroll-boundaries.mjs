import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runAgentDevice } from './agent-device-runtime.mjs';

const [session, output] = process.argv.slice(2);
const serial = process.env.ANDROID_SERIAL;
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
assert(session && output && serial && sdk, 'Pass session/output and set ANDROID_SERIAL/ANDROID_HOME.');
const evidence = path.resolve(output);
execFileSync('git', ['check-ignore', evidence]);
mkdirSync(evidence, { recursive: true });
const adb = (...args) =>
  execFileSync(path.join(sdk, 'platform-tools/adb'), ['-s', serial, ...args], { encoding: 'utf8' });
assert.equal(adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim(), 'WZ_ForumSelection_Test_API35');
const device = (...args) =>
  runAgentDevice([...args, '--session', session, '--platform', 'android', '--serial', serial], {
    capture: true,
    echoCapture: false,
    timeout: 30000
  });
function snapshot() {
  const nodes = JSON.parse(device('snapshot', '--json')).data.nodes;
  assert(
    nodes.some((node) => /^visual-frame-topic\.replies\.populated-.+-full$/.test(node.identifier || '')),
    'Open the populated replies Visual Gallery fixture in full-screen preview; real topics are unsupported.'
  );
  return nodes;
}
const replyRect = (nodes) => {
  const rect = nodes.find((node) => node.label === '第一条纯文本回复。')?.rect;
  assert(rect?.height > 0, 'The first fixture reply must remain visible.');
  return rect;
};
snapshot();
const java = (name) => (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name);
const androidJar = path.join(sdk, 'platforms/android-35/android.jar');
execFileSync(java('javac'), ['-cp', androidJar, '-d', evidence, 'tests/device/TouchTrace.java']);
execFileSync(java('java'), [
  '-cp',
  path.join(sdk, 'build-tools/36.0.0/lib/d8.jar'),
  'com.android.tools.r8.D8',
  '--lib',
  androidJar,
  '--output',
  path.join(evidence, 'touch.jar'),
  path.join(evidence, 'TouchTrace.class')
]);
const remote = `/data/local/tmp/wz-topic-boundaries-${Date.now()}.jar`;
adb('push', path.join(evidence, 'touch.jar'), remote);
const results = [];
try {
  for (const edge of ['bottom', 'top']) {
    for (const surface of ['reply', 'padding']) {
      for (const terminal of [1, 3]) {
        const list = snapshot().find((node) => node.identifier === 'topic-detail-loaded')?.rect;
        assert(list?.height > 0, 'The production topic list must be visible.');
        const direction = edge === 'bottom' ? -1 : 1;
        const resetY = Math.round(list.y + list.height * (edge === 'bottom' ? 0.85 : 0.15));
        device(
          'gesture',
          'pan',
          String(Math.round(list.width / 2)),
          String(resetY),
          '0',
          String(direction * Math.round(list.height * 0.7)),
          '180'
        );
        const before = replyRect(snapshot());
        const x = Math.round(surface === 'reply' ? before.x + before.width / 3 : list.x + list.width - 10);
        const y = Math.round(before.y + before.height / 2);
        const outward = Math.round(list.width * 0.14);
        const reverse = Math.round(list.width * 0.075);
        assert(y - outward > list.y && y + outward < list.y + list.height, 'Trace must stay inside the list.');
        const points = [[0, 0, x, y]];
        for (let step = 1; step <= 6; step++)
          points.push([step * 30, 2, x, y + direction * Math.round((outward * step) / 6)]);
        for (let step = 1; step <= 4; step++)
          points.push([180 + step * 30, 2, x, y + direction * (outward - Math.round((reverse * step) / 4))]);
        const endY = y + direction * (outward - reverse);
        points.push([420, 2, x, endY], [450, terminal, x, endY]);
        const delivered = adb(
          'shell',
          `CLASSPATH=${remote} app_process / TouchTrace '${points.map((point) => point.join(',')).join(';')}'`
        );
        const actualTimes = delivered
          .trim()
          .split(';')
          .filter(Boolean)
          .map((point) => Number(point.split(',')[0]));
        assert.equal(actualTimes.length, points.length);
        assert(
          actualTimes.every((time, index) => Math.abs(time - points[index][0]) <= 50),
          'Input timing drift exceeded 50 ms.'
        );
        const after = replyRect(snapshot());
        const movement = after.y - before.y;
        const expected = -direction * reverse;
        results.push({ edge, surface, terminal: terminal === 1 ? 'UP' : 'CANCEL', movement, expected, actualTimes });
        writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ serial, results }, null, 2));
        assert(
          Math.abs(movement - expected) <= 4,
          `${edge}/${surface}/${terminal}: reverse should move ${expected}px immediately; observed ${movement}px.`
        );
      }
    }
  }
} finally {
  adb('shell', 'rm', remote);
}
console.log(`PASS: ${results.length} topic boundary reversals; emulator and app remain open.`);
