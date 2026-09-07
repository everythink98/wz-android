import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

import { runAgentDevice } from './agent-device-runtime.mjs';

// Run against an already open Feed on the explicitly selected device; no installation or data reset.
const serial = process.env.ANDROID_SERIAL;
assert(serial, 'Set ANDROID_SERIAL to the device running the candidate APK.');
const device = (...args) =>
  runAgentDevice([...args, '--platform', 'android', '--serial', serial], { capture: true, echoCapture: false });
const snapshot = () => JSON.parse(device('snapshot', '--json')).data.nodes;
const bounds = () => snapshot().find((node) => node.identifier === 'feed-secondary-v2ex')?.rect;

device('wait', 'id="main-tab-feed"', '60000');
device('press', 'id="feed-source-v2ex"');
device('wait', 'id="feed-outcome-data-v2ex-all"', '60000');
const original = bounds();
assert(original?.width > 0 && original.x === 0, 'V2EX must start aligned to the viewport.');
const list = snapshot().find((node) => node.identifier === 'feed-outcome-data-v2ex-all').rect;
const x = Math.round(original.width * 0.4);
const y = Math.round(list.y + list.height * 0.7);
for (const [terminal, direction] of [
  ['CANCEL', 1],
  ['CANCEL', -1],
  ['UP', 1],
  ['UP', -1]
]) {
  device('press', 'id="feed-source-v2ex"');
  device('wait', 'id="feed-outcome-data-v2ex-all"', '60000');
  device('gesture', 'pan', String(x), String(y), '0', String(-Math.round(list.height * 0.55)), '350');
  await setTimeout(1000);
  const start = Math.round(original.width * (direction > 0 ? 0.15 : 0.85));
  const middle = start + direction * Math.round(original.width * 0.04);
  const end = start + direction * Math.round(original.width * 0.1);
  try {
    execFileSync('adb', [
      '-s',
      serial,
      'shell',
      `input motionevent DOWN ${start} ${y}; input motionevent MOVE ${middle} ${y}; ` +
        `input motionevent MOVE ${end} ${y}`
    ]);
    assert.notDeepEqual(bounds(), original, 'The page must actually move before cancellation.');
  } finally {
    execFileSync('adb', ['-s', serial, 'shell', `input motionevent ${terminal} ${end} ${y}`]);
  }
  await setTimeout(1000);
  if (terminal === 'CANCEL') {
    assert.deepEqual(bounds(), original, `Cancelled drag (${direction}) must restore the full page bounds.`);
    assert(
      snapshot().some((node) => node.identifier === 'feed-source-v2ex' && node.label === 'V2EX，已选择'),
      'A short cancelled drag must keep the original source.'
    );
  } else {
    // A normal release may commit the adjacent source according to native velocity.
    const nodes = snapshot();
    const selected = nodes.find(
      (node) => node.identifier?.startsWith('feed-source-') && node.label?.includes('已选择')
    );
    const scene = nodes.find(
      (node) => node.identifier === selected?.identifier.replace('feed-source-', 'feed-secondary-')
    );
    assert(scene?.rect.x === 0 && scene.rect.width === original.width, 'Normal release must settle on one full page.');
  }
}
console.log('PASS: mid-list horizontal cancellation and release restore page bounds in both directions.');
