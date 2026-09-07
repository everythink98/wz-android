import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import pngjs from 'pngjs';

import { runAgentDevice } from './agent-device-runtime.mjs';

// Feed open, static list rows, no loading overlay. Screenshots stay in ignored evidence storage.
const serial = process.env.ANDROID_SERIAL;
const evidence = process.argv[2];
assert(serial && evidence, 'Set ANDROID_SERIAL and pass an ignored evidence directory.');
execFileSync('git', ['check-ignore', path.resolve(evidence)]);
mkdirSync(evidence, { recursive: true });
const device = (...args) => runAgentDevice([...args, '--platform', 'android', '--serial', serial]);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);
device('press', 'id="feed-source-all"');
device('press', 'id="feed-source-v2ex"');
device('wait', 'id="feed-topic-first"', '60000');
await setTimeout(1000);

function capture(name) {
  const bytes = adb('exec-out', 'screencap', '-p');
  writeFileSync(path.join(evidence, `${name}.png`), bytes);
  return pngjs.PNG.sync.read(bytes);
}

function changedFraction(a, b) {
  let changed = 0;
  let sampled = 0;
  // Exclude source tabs, scroll indicator, floating actions and bottom navigation.
  for (let y = Math.round(a.height * 0.22); y < a.height * 0.86; y += 2) {
    for (let x = Math.round(a.width * 0.08); x < a.width * 0.87; x += 2) {
      const i = (y * a.width + x) * 4;
      sampled++;
      if (
        Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2]) >
        90
      )
        changed++;
    }
  }
  return changed / sampled;
}

const before = capture('before');
const x = String(Math.round(before.width * 0.71));
adb(
  'shell',
  'input',
  'swipe',
  x,
  String(Math.round(before.height * 0.755)),
  x,
  String(Math.round(before.height * 0.324)),
  '120'
);
const released = capture('released');
await setTimeout(800);
const coasted = capture('coasted');
const draggedFraction = changedFraction(before, released);
const coastedFraction = changedFraction(released, coasted);
console.log(JSON.stringify({ draggedFraction, coastedFraction }));
assert(draggedFraction > 0.02, 'Precondition: list must visibly move during the fast swipe.');
assert(coastedFraction > 0.02, 'Fast swipe must continue scrolling after release without another touch.');
console.log('PASS: Feed retains momentum after a fast swipe.');
