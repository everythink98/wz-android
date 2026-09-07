import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { runAgentDevice } from './agent-device-runtime.mjs';

const serial = process.env.ANDROID_SERIAL;
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const evidence = process.argv[2];
const source = process.argv[3] || 'v2ex';
assert(serial && sdk && evidence, 'Set ANDROID_SERIAL, ANDROID_HOME and pass an ignored evidence directory.');
assert(['v2ex', 'yaohuo', 'nodeseek', 'linuxdo'].includes(source), 'Select a supported, readable source.');
execFileSync('git', ['check-ignore', path.resolve(evidence)]);
mkdirSync(evidence, { recursive: true });
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);
const device = (...args) =>
  runAgentDevice([...args, '--platform', 'android', '--serial', serial], { capture: true, echoCapture: false });
const snapshot = () => JSON.parse(device('snapshot', '--json')).data.nodes;
const selected = (nodes) =>
  nodes.find((node) => node.identifier?.startsWith('feed-source-') && node.label?.includes('已选择'));
const bounds = (nodes) => {
  const tab = selected(nodes);
  assert(tab, 'Feed must stay visible; a verification page is not a gesture verdict.');
  return nodes.find((node) => node.identifier === tab.identifier.replace('feed-source-', 'feed-secondary-'))?.rect;
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
const remote = `/data/local/tmp/wz-feed-gestures-${Date.now()}.jar`;
adb('push', path.join(evidence, 'touch.jar'), remote);
const results = [];
function selectSourceAtTop() {
  // Changing source recreates the list even when the optional top button is hidden.
  device('press', 'id="feed-source-all"');
  device('press', `id="feed-source-${source}"`);
  device('wait', 'id="feed-topic-first"', '60000');
}

try {
  selectSourceAtTop();
  const original = bounds(snapshot());
  assert(original?.x === 0 && original.width > 0, 'Start on one full page.');
  const width = original.width;
  const list = snapshot().find((node) => node.identifier?.startsWith(`feed-outcome-data-${source}-`))?.rect;
  assert(list?.height > 0, 'The source must have a real, loaded list.');
  const px = (fraction) => Math.round(width * fraction);
  const py = (fraction) => Math.round(list.y + list.height * fraction);
  const points = [];
  function drag(start, locations, duration, terminal = 1) {
    points.push([start, 0, ...locations[0]]);
    // Synchronous Android injection takes about 10ms per event on this emulator.
    // Space samples by at least one 60Hz frame so an 80ms flick stays an 80ms flick.
    const steps = Math.min(16, Math.max(2, Math.floor(duration / (locations.length - 1) / 16)));
    for (let segment = 1; segment < locations.length; segment++) {
      for (let step = 1; step <= steps; step++) {
        points.push([
          Math.round(start + (duration * (segment - 1 + step / steps)) / (locations.length - 1)),
          2,
          ...locations[segment].map((value, axis) =>
            Math.round(locations[segment - 1][axis] + ((value - locations[segment - 1][axis]) * step) / steps)
          )
        ]);
      }
    }
    points.push([start + duration + 16, terminal, ...locations.at(-1)]);
  }
  const kinds = [
    'settling-vertical',
    'horizontal',
    'short-horizontal',
    'short-slow-horizontal',
    'vertical-diagonal',
    'vertical-horizontal',
    'horizontal-vertical',
    'fling-horizontal',
    'fling-short-horizontal',
    'handoff-short-horizontal',
    'fling-tap',
    'reverse',
    'cancel'
  ];
  const focus = process.argv[4];
  const selectedKinds = focus ? focus.split(',') : kinds;
  assert(
    selectedKinds.every((kind) => kinds.includes(kind)),
    'Select existing gesture kinds for a focused reproduction.'
  );
  for (const kind of selectedKinds) {
    for (const duration of kind === 'short-slow-horizontal'
      ? [800]
      : kind.includes('short-horizontal')
        ? [80, 120]
        : [120, 350, 800]) {
      for (const direction of [1, -1]) {
        selectSourceAtTop();
        await setTimeout(500);
        device('gesture', 'pan', String(px(0.7)), String(py(0.8)), '0', String(-Math.round(list.height * 0.35)), '400');
        await setTimeout(300);
        const before = snapshot();
        assert.equal(selected(before)?.identifier, `feed-source-${source}`, 'The setup scroll must keep the source.');
        assert.deepEqual(bounds(before), original, 'Start every case on a full page.');
        points.length = 0;
        const x = px(direction > 0 ? 0.16 : 0.84),
          y = py(0.45);
        const dx = direction * px(0.12),
          dy = Math.round(list.height * 0.2);
        if (kind === 'settling-vertical') {
          drag(
            0,
            [
              [x, y],
              [x + dx, y]
            ],
            180
          );
          drag(
            215,
            [
              [px(0.52), y],
              [px(0.52), y - dy]
            ],
            duration
          );
        } else if (['horizontal', 'short-horizontal', 'short-slow-horizontal'].includes(kind)) {
          drag(
            0,
            [
              [x, y],
              [
                x + direction * px(kind === 'short-horizontal' ? 0.2 : kind === 'short-slow-horizontal' ? 0.12 : 0.68),
                y
              ]
            ],
            duration
          );
        } else if (kind === 'vertical-diagonal') {
          drag(
            0,
            [
              [x, py(0.8)],
              [x + direction * px(0.5), py(0.2)]
            ],
            duration
          );
        } else if (kind === 'vertical-horizontal') {
          drag(
            0,
            [
              [x, y],
              [x, y - dy],
              [x + dx, y - dy]
            ],
            duration
          );
        } else if (kind === 'horizontal-vertical') {
          drag(
            0,
            [
              [x, y],
              [x + dx, y],
              [x + dx, y - dy]
            ],
            duration
          );
        } else if (
          ['fling-horizontal', 'fling-short-horizontal', 'fling-tap', 'handoff-short-horizontal'].includes(kind)
        ) {
          const handedOff = kind === 'handoff-short-horizontal';
          if (handedOff)
            drag(
              0,
              [
                [x, y],
                [x + dx, y]
              ],
              180
            );
          drag(
            handedOff ? 215 : 0,
            [
              [px(0.7), py(0.8)],
              [px(0.7), py(0.25)]
            ],
            120
          );
          drag(
            handedOff ? 370 : 155,
            [
              [x, y],
              [x + direction * px(kind === 'fling-tap' ? 0 : kind === 'fling-horizontal' ? 0.68 : 0.2), y]
            ],
            duration
          );
        } else if (kind === 'reverse') {
          drag(
            0,
            [
              [x, y],
              [x + direction * px(0.4), y],
              [x, y]
            ],
            duration
          );
        } else {
          drag(
            0,
            [
              [x, y],
              [x + dx, y]
            ],
            duration,
            3
          );
        }
        assert(points.flat().every(Number.isFinite), 'Only numeric touch coordinates are allowed.');
        const delivered = adb(
          'shell',
          `CLASSPATH=${remote} app_process / TouchTrace '${points.map((point) => point.join(',')).join(';')}'`
        );
        writeFileSync(path.join(evidence, `${kind}-${duration}-${direction}-timing.txt`), delivered);
        const actualTimes = delivered
          .toString()
          .trim()
          .split(';')
          .filter(Boolean)
          .map((point) => Number(point.split(',')[0]));
        assert.equal(actualTimes.length, points.length, 'Every injected event must have timing evidence.');
        assert(
          actualTimes.every((time, index) => Math.abs(time - points[index][0]) <= 50),
          'BLOCKED_BY_ENV: input delivery drift exceeded 50ms; this is not the requested gesture speed.'
        );
        await setTimeout(1000);
        const after = snapshot(),
          tab = selected(after)?.identifier,
          rect = bounds(after);
        const result = { kind, duration, direction, tab, rect, status: 'pending' };
        results.push(result);
        writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
        assert(
          rect?.x === 0 && rect.width === width,
          `${JSON.stringify(result)}: release must settle on one full page.`
        );
        if (['vertical-diagonal', 'vertical-horizontal', 'cancel', 'fling-tap'].includes(kind))
          assert.equal(tab, `feed-source-${source}`, `${kind} must keep the source.`);
        if (kind === 'fling-tap') {
          const rows = after.filter(
            (node) =>
              node.type === 'android.widget.Button' &&
              node.label?.length > 10 &&
              node.rect.width > width * 0.8 &&
              node.rect.y > py(0.15) &&
              node.rect.y < py(0.7)
          );
          assert(rows.length >= 2, 'Stopping momentum needs visible content.');
          await setTimeout(500);
          const stopped = snapshot();
          assert(
            rows.every((row) =>
              stopped.some((node) => node.label === row.label && Math.abs(node.rect.y - row.rect.y) <= 2)
            ),
            'A tap must stop the list momentum.'
          );
        }
        if (kind === 'settling-vertical' && tab === `feed-source-${source}`) {
          const titles = before.filter(
            (node) =>
              node.type === 'android.widget.Button' &&
              node.label?.length > 10 &&
              node.rect.width > width * 0.8 &&
              node.rect.y > py(0.15) &&
              node.rect.y < py(0.7)
          );
          assert(titles.length >= 2, 'The handoff needs visible list content to verify vertical movement.');
          const moved = titles.filter((title) => {
            const match = after.find((node) => node.label === title.label);
            return !match || Math.abs(match.rect.y - title.rect.y) > 10;
          });
          assert(moved.length >= 2, 'The list must actually scroll after taking over from the pager.');
        }
        if (
          [
            'horizontal',
            'short-horizontal',
            'fling-horizontal',
            'fling-short-horizontal',
            'handoff-short-horizontal'
          ].includes(kind)
        )
          assert.notEqual(tab, `feed-source-${source}`, 'A horizontal swipe or short fast flick must switch source.');
        if (tab !== `feed-source-${source}`)
          assert(
            !after.some((node) => node.label === '回到顶部'),
            'A new source must not inherit the previous top button.'
          );
        result.status = 'pass';
        writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
        console.log(`PASS ${kind} ${duration}ms ${direction}`);
      }
    }
  }
} finally {
  adb('shell', 'input', 'motionevent', 'CANCEL', '0', '0');
  adb('shell', 'rm', remote);
}
console.log(`PASS: ${results.length} Feed gesture combinations.`);
