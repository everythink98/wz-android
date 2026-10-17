import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import pngjs from 'pngjs';

import { runAgentDevice } from './agent-device-runtime.mjs';

// Light theme, aggregate notification list at the top. Does not open messages or mark them read.
const serial = process.env.ANDROID_SERIAL;
const evidence = process.argv[2];
assert(serial && evidence, 'Set ANDROID_SERIAL and pass an ignored evidence directory.');
execFileSync('git', ['check-ignore', path.resolve(evidence)]);
mkdirSync(evidence, { recursive: true });
const device = (...args) =>
  runAgentDevice([...args, '--platform', 'android', '--serial', serial], { capture: true, echoCapture: false });
device('wait', 'id="notification-source-all"', '10000');
device('press', 'id="notification-source-all"');
device(
  'wait',
  'id="notification-outcome-data-all" || id="notification-outcome-empty-all" || id="notification-outcome-partial-all"',
  '60000'
);
await setTimeout(1000);
const nodes = JSON.parse(device('snapshot', '--json')).data.nodes;
const list = nodes.find((node) => /^notification-outcome-(data|empty|partial)-all$/.test(node.identifier || ''))?.rect;
assert(list?.x === 0 && list.height > 0, 'Start on a full, settled notification list.');

function capture(name) {
  const bytes = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p']);
  writeFileSync(path.join(evidence, `${name}.png`), bytes);
  const { width, height, data } = pngjs.PNG.sync.read(bytes);
  let blue = 0;
  // Error notices can move the list and its native refresh indicator below the header.
  for (let y = list.y; y < Math.min(height, list.y + list.height * 0.3); y++) {
    for (let x = Math.round(width * 0.44); x < width * 0.56; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 2] > 160 && data[i + 2] - data[i] > 35 && data[i + 2] - data[i + 1] > 15) blue++;
    }
  }
  return { width, height, blue };
}

const baseline = capture('before');
const x = Math.round(baseline.width * 0.51);
const y = Math.round(baseline.height * 0.4);
const end = Math.round(baseline.height * 0.78);
assert(y > list.y && end < list.y + list.height, 'The existing pull trajectory must stay inside the list.');
try {
  execFileSync('adb', [
    '-s',
    serial,
    'shell',
    `input motionevent DOWN ${x} ${y}; input motionevent MOVE ${x} ${y + 200}; input motionevent MOVE ${x} ${end}`
  ]);
  await setTimeout(500);
  const pulling = capture('pulling');
  assert(pulling.blue > baseline.blue + 80, 'Must visibly pull out the refresh indicator before cancelling.');
} finally {
  execFileSync('adb', ['-s', serial, 'shell', `input motionevent CANCEL ${x} ${end}`]);
}
await setTimeout(1000);
const cancelled = capture('cancelled');
console.log(JSON.stringify({ baselineBlue: baseline.blue, cancelledBlue: cancelled.blue }));
assert(cancelled.blue <= baseline.blue + 20, 'Cancelled notification refresh must retract without another touch.');
device('gesture', 'pan', String(x), String(y), '0', String(end - y), '800');
let refreshed;
for (let attempt = 0; attempt < 20; attempt++) {
  await setTimeout(3000);
  refreshed = capture('refreshed');
  if (refreshed.blue <= baseline.blue + 20) break;
}
assert(refreshed.blue <= baseline.blue + 20, 'The next normal refresh must settle and retract.');
console.log('PASS: notification CANCEL retracts the indicator and the next refresh settles.');
