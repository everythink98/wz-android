import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import pngjs from 'pngjs';
import { runAgentDevice } from './agent-device-runtime.mjs';

// Light theme, a readable source. Only refreshes reads; never opens or modifies posts.
const serial = process.env.ANDROID_SERIAL;
const evidence = process.argv[2];
const mode = process.argv[3] || 'pulls';
assert(serial && evidence, 'Set ANDROID_SERIAL and pass an ignored evidence directory.');
assert(['pulls', 'interruptions'].includes(mode), 'Select pulls or interruptions.');
execFileSync('git', ['check-ignore', path.resolve(evidence)]);
mkdirSync(evidence, { recursive: true });
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);
const device = (...args) =>
  runAgentDevice([...args, '--platform', 'android', '--serial', serial], { capture: true, echoCapture: false });
const snapshot = () => JSON.parse(device('snapshot', '--json')).data.nodes;
const results = [];
device('press', 'id="feed-source-all"');
device('press', 'id="feed-source-yaohuo"');
device('wait', 'id="feed-topic-first"', '60000');
await setTimeout(1000);
const list = snapshot().find((node) => node.identifier === 'feed-outcome-data-yaohuo-default')?.rect;
assert(list?.x === 0 && list.height > 0, 'Start on a full, loaded Yaohuo list.');
const rail = snapshot().find((node) => node.identifier === 'feed-secondary-yaohuo')?.rect;
const x = Math.round(list.width * 0.51);
const y = Math.round(list.y + list.height * 0.3);
const end = Math.round(list.y + list.height * 0.9);
function capture(name) {
  const bytes = adb('exec-out', 'screencap', '-p');
  writeFileSync(path.join(evidence, `${name}.png`), bytes);
  const { width, data } = pngjs.PNG.sync.read(bytes);
  let blue = 0;
  // The central indicator below the secondary rail; excludes selected tabs and avatars.
  for (let cy = list.y; cy < list.y + list.height * 0.3; cy++) {
    for (let cx = Math.round(width * 0.44); cx < width * 0.56; cx++) {
      const i = (cy * width + cx) * 4;
      if (data[i + 2] > 160 && data[i + 2] - data[i] > 35 && data[i + 2] - data[i + 1] > 15) blue++;
    }
  }
  return blue;
}
const baseline = capture('before');
async function settled(name, timeout = 1000, source = 'yaohuo') {
  let blue;
  for (let elapsed = 0; elapsed < timeout; elapsed += 1000) {
    await setTimeout(1000);
    blue = capture(`${name}-settled`);
    if (blue <= baseline + 20) break;
  }
  assert(blue <= baseline + 20, `${name}: refresh indicator must retract.`);
  device('wait', 'id="feed-topic-first"', '60000');
  const nodes = snapshot();
  assert(nodes.some((n) => n.identifier === `feed-source-${source}` && n.label?.includes('已选择')));
  assert(
    nodes.some((n) => n.identifier?.startsWith(`feed-outcome-data-${source}-`)),
    'The settled list must belong to the selected source.'
  );
  const rect = nodes.find((n) => n.identifier === `feed-secondary-${source}`)?.rect;
  assert(rect?.x === 0 && rect.width === rail.width, 'Source and full secondary rail must agree.');
  results.push({ name, baselineBlue: baseline, settledBlue: blue });
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`PASS ${name}`);
}
function motion(action, tx, ty) {
  adb('shell', 'input', 'motionevent', action, String(tx), String(ty));
}
if (mode === 'pulls') {
  for (const distance of [50, 100]) {
    device('gesture', 'pan', String(x), String(y), '0', String(distance), '600');
    await settled(`short-pull-${distance}`);
  }
  for (const scenario of ['cancel', 'pull-back', 'pull-sideways']) {
    try {
      motion('DOWN', x, y);
      motion('MOVE', x, y + 200);
      motion('MOVE', x, end);
      assert(capture(`${scenario}-pulling`) > baseline + 80, 'Precondition: visibly pull out the indicator.');
      if (scenario === 'pull-back') {
        motion('MOVE', x, y + 100);
        motion('MOVE', x, y);
      } else if (scenario === 'pull-sideways') {
        motion('MOVE', Math.round(list.width * 0.8), end);
      }
    } finally {
      motion(scenario === 'cancel' ? 'CANCEL' : 'UP', x, scenario === 'pull-back' ? y : end);
    }
    await settled(scenario, scenario === 'pull-sideways' ? 60000 : 1000);
  }
  device('gesture', 'pan', String(x), String(y), '0', String(end - y), '800');
  await settled('normal-refresh-after-cancel', 60000);
  console.log('PASS: Feed short pulls, long pull, reversal, sideways handoff, cancellation and next refresh.');
} else {
  for (const interruption of ['source-swipe', 'bottom-tab']) {
    device('press', 'id="feed-source-all"');
    device('press', 'id="feed-source-yaohuo"');
    device('wait', 'id="feed-topic-first"', '60000');
    const tabs = snapshot()
      .filter((n) => n.identifier?.startsWith('feed-source-'))
      .sort((a, b) => a.rect.x - b.rect.x);
    const current = tabs.findIndex((n) => n.identifier === 'feed-source-yaohuo');
    const direction = tabs[current + 1] ? -1 : 1;
    const next = tabs[current - direction];
    assert(next, 'Need a neighbouring source.');
    try {
      motion('DOWN', x, y);
      motion('MOVE', x, y + 200);
      motion('MOVE', x, end);
      assert(capture(`${interruption}-pulling`) > baseline + 80, 'Must pull out the indicator.');
    } finally {
      motion('UP', x, end);
    }
    await setTimeout(1000);
    const pendingBlue = capture(`${interruption}-refreshing`);
    const pendingNodes = snapshot().filter(
      (node) =>
        node.identifier?.startsWith('feed-outcome-') || node.label?.includes('更新列表') || node.label === '列表已更新'
    );
    writeFileSync(
      path.join(evidence, `${interruption}-pending.json`),
      JSON.stringify({ baseline, pendingBlue, pendingNodes }, null, 2)
    );
    assert(
      pendingBlue > baseline + 80,
      'Precondition: refresh must still be visibly pending before interruption; use a controlled slow connection.'
    );
    if (interruption === 'source-swipe') {
      device(
        'gesture',
        'pan',
        String(Math.round(list.width * (direction > 0 ? 0.15 : 0.85))),
        String(y),
        String(Math.round(list.width * 0.7) * direction),
        '0',
        '250'
      );
    } else {
      device('press', 'id="main-tab-more"');
      device('press', 'id="main-tab-feed"');
    }
    await settled(
      interruption,
      60000,
      interruption === 'source-swipe' ? next.identifier.replace('feed-source-', '') : 'yaohuo'
    );
  }
  console.log('PASS: pending refresh supports source swipes and bottom-tab return.');
}
