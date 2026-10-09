import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
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
assert.equal(adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim(), 'WZ_Pixel_API_35');
const device = (...args) =>
  runAgentDevice([...args, '--session', session, '--platform', 'android', '--serial', serial], {
    capture: true,
    echoCapture: false,
    timeout: 30000
  });
const snapshot = () => JSON.parse(device('snapshot', '--json')).data.nodes;
const button = (nodes, label) => {
  const matches = nodes.filter((node) => node.type === 'android.widget.Button' && node.label === label);
  assert.equal(matches.length, 1, `Expected one visible ${label} button.`);
  return matches[0].rect;
};
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
const remote = `/data/local/tmp/wz-reader-boundaries-${Date.now()}.jar`;
adb('push', path.join(evidence, 'touch.jar'), remote);
const results = [];
let expandedAppearance = false;
try {
  for (const surface of ['more', 'rail']) {
    if (surface === 'more') {
      device('press', 'id="main-tab-more"');
      expandedAppearance = snapshot().some((node) => node.label === '展开外观');
      if (expandedAppearance) device('press', 'label="展开外观"');
    } else {
      if (expandedAppearance) {
        device('press', 'label="收起外观"');
        expandedAppearance = false;
      }
      device('press', 'id="main-tab-feed"');
      device('press', 'id="feed-source-v2ex"');
    }
    const nodes = snapshot();
    const horizontal = surface === 'rail';
    const anchorLabel = horizontal ? '问与答' : '收起外观';
    const anchor = (items) => button(items, anchorLabel)[horizontal ? 'x' : 'y'];
    const rect = horizontal
      ? nodes.find((node) => node.type === 'android.widget.HorizontalScrollView')?.rect
      : nodes.filter((node) => node.type === 'android.widget.ScrollView' && node.rect.height < 2400)[0]?.rect;
    assert(rect?.width > 0 && rect.height > 0, 'Expected the active reading surface.');
    const x = Math.round(horizontal ? rect.x + rect.width * 0.4 : rect.x + rect.width - 35);
    const y = Math.round(horizontal ? rect.y + rect.height / 2 : rect.y + rect.height * 0.35);
    const pan = (direction) =>
      device(
        'gesture',
        'pan',
        String(horizontal && direction > 0 ? rect.x + 60 : x),
        String(y),
        String(horizontal ? (direction > 0 ? rect.width - 120 : -100) : 0),
        String(horizontal ? 0 : direction * 400),
        '700'
      );
    pan(1);
    pan(1);
    await setTimeout(800);
    const start = anchor(snapshot());
    pan(-1);
    assert(anchor(snapshot()) < start - 20, `${surface} must actually have scrollable content.`);
    for (const terminal of [1, 3]) {
      pan(1);
      pan(1);
      await setTimeout(800);
      const before = anchor(snapshot());
      const points = [[0, 0, x, y]];
      const point = (time, distance) => [time, 2, x + (horizontal ? distance : 0), y + (horizontal ? 0 : distance)];
      for (let step = 1; step <= 6; step++) points.push(point(step * 30, Math.round((151 * step) / 6)));
      for (let step = 1; step <= 4; step++) points.push(point(180 + step * 30, 151 - Math.round((81 * step) / 4)));
      points.push(point(420, 70), [450, terminal, x + (horizontal ? 70 : 0), y + (horizontal ? 0 : 70)]);
      const delivered = adb(
        'shell',
        `CLASSPATH=${remote} app_process / TouchTrace '${points.map((p) => p.join(',')).join(';')}'`
      );
      const actualTimes = delivered
        .trim()
        .split(';')
        .filter(Boolean)
        .map((p) => Number(p.split(',')[0]));
      assert.equal(actualTimes.length, points.length);
      assert(
        actualTimes.every((time, index) => Math.abs(time - points[index][0]) <= 50),
        'Input drift exceeded 50 ms.'
      );
      const after = snapshot();
      if (horizontal)
        assert(after.some((node) => node.identifier === 'feed-source-v2ex' && node.label === 'V2EX，已选择'));
      const movement = anchor(after) - before;
      results.push({ surface, terminal: terminal === 1 ? 'UP' : 'CANCEL', movement, expected: -81, actualTimes });
      writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ serial, results }, null, 2));
    }
  }
} finally {
  adb('shell', 'rm', remote);
  if (expandedAppearance) device('press', 'label="收起外观"');
}
assert(
  results.every((result) => Math.abs(result.movement - result.expected) <= 4),
  `Edge reversal must move immediately: ${JSON.stringify(results.map(({ surface, terminal, movement }) => ({ surface, terminal, movement })))}`
);
console.log(`PASS: ${results.length} native reading surface reversals.`);
