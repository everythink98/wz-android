import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { runAgentDevice } from './agent-device-runtime.mjs';

const serial = process.env.ANDROID_SERIAL;
const evidence = process.argv[2];
const mode = process.argv[3] || 'all';
assert(['all', 'interactions', 'rail'].includes(mode), 'Select all boundaries, interactions or the category rail.');
const railSources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
const railSource = process.argv[4];
assert(!railSource || (mode === 'rail' && railSources.includes(railSource)), 'Select a supported rail source.');
assert(serial && evidence, 'Set ANDROID_SERIAL and pass an ignored evidence directory.');
execFileSync('git', ['check-ignore', path.resolve(evidence)]);
mkdirSync(evidence, { recursive: true });
const device = (...args) =>
  runAgentDevice([...args, '--platform', 'android', '--serial', serial], { capture: true, echoCapture: false });
const snapshot = () => JSON.parse(device('snapshot', '--json')).data.nodes;
const initial = snapshot();
const tabs = initial.filter((n) => n.identifier?.startsWith('feed-source-')).sort((a, b) => a.rect.x - b.rect.x);
assert(tabs.length >= 3 && tabs[0].identifier === 'feed-source-all', 'Visible source order is required.');
const rail = initial.find((n) => n.identifier?.startsWith('feed-secondary-'))?.rect;
assert(rail?.x === 0 && rail.width > 0, 'Start on one full Feed page.');
const list = initial.find((n) => n.identifier?.startsWith('feed-outcome-data-'))?.rect;
assert(list?.height > 0, 'Start on a loaded list.');
const px = (f) => Math.round(rail.width * f);
const py = (f) => Math.round(list.y + list.height * f);
const pan = (x, y, dx, dy, ms = 800, ...extra) => device('gesture', 'pan', ...[x, y, dx, dy, ms].map(String), ...extra);
const results = [];
async function check(name, expected) {
  await setTimeout(1000);
  const nodes = snapshot();
  const selected = nodes.find((n) => n.identifier?.startsWith('feed-source-') && n.label?.includes('已选择'));
  assert.equal(selected?.identifier, expected, `${name}: selected source`);
  const rect = nodes.find((n) => n.identifier === expected.replace('feed-source-', 'feed-secondary-'))?.rect;
  assert(rect?.x === 0 && rect.width === rail.width, `${name}: full page and secondary rail`);
  results.push({ name, source: expected, rect });
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`PASS ${name}`);
}
async function checkCategoryRails() {
  for (const source of railSources.filter((source) => !railSource || source === railSource)) {
    device('press', 'id="feed-source-all"');
    device('press', `id="feed-source-${source}"`);
    const nodes = snapshot();
    const header = nodes.find((n) => n.identifier === `feed-secondary-${source}`)?.rect;
    const viewport = nodes.find(
      (n) =>
        n.type === 'android.widget.HorizontalScrollView' && n.rect.y >= header?.y && n.rect.y < header.y + header.height
    )?.rect;
    assert(viewport?.width > 0, `${source}: category viewport required`);
    const buttons = () =>
      snapshot().filter(
        (n) =>
          n.type === 'android.widget.Button' &&
          n.rect.y >= viewport.y &&
          n.rect.y < viewport.y + viewport.height &&
          n.rect.x >= viewport.x &&
          n.rect.x < viewport.x + viewport.width
      );
    const geometry = (items) => items.map(({ label, rect }) => ({ label, x: rect.x, width: rect.width }));
    const initialButtons = buttons();
    const drag = async (direction) => {
      pan(
        Math.round(viewport.x + viewport.width * (direction < 0 ? 0.85 : 0.15)),
        Math.round(viewport.y + viewport.height / 2),
        Math.round(viewport.width * 0.7 * direction),
        0
      );
      await check(`${source}-category-drag-${direction}`, `feed-source-${source}`);
      return buttons();
    };
    try {
      const moved = await drag(-1);
      assert.notDeepEqual(
        geometry(moved),
        geometry(initialButtons),
        `${source}: hidden categories must scroll into view`
      );
      const revealed = moved.find((n) => !initialButtons.some((old) => old.label === n.label));
      assert(revealed, `${source}: reveal a previously hidden category`);
      const returned = await drag(1);
      assert.notDeepEqual(geometry(returned), geometry(moved), `${source}: reverse drag moves the categories back`);
      assert.deepEqual(
        geometry(await drag(1)),
        geometry(initialButtons),
        `${source}: reverse drags reach the rail start`
      );
      assert.deepEqual(
        geometry(await drag(1)),
        geometry(initialButtons),
        `${source}: start boundary stays in the rail`
      );
      let previous = initialButtons;
      let end;
      for (let attempt = 0; attempt < 30; attempt++) {
        const current = await drag(-1);
        if (JSON.stringify(geometry(current)) === JSON.stringify(geometry(previous))) {
          end = current;
          break;
        }
        previous = current;
      }
      assert(end, `${source}: reach a finite category rail end`);
      const target = end.find((n) => !initialButtons.some((old) => old.label === n.label));
      assert(target, `${source}: end contains a previously hidden category`);
      device('press', `@${target.ref}`);
      device('wait', `label="${target.label}，已选择"`, '5000');
      assert(
        buttons().some((n) => n.label === `${target.label}，已选择`),
        `${source}: hidden category is selectable`
      );
      await check(`${source}-hidden-category-selected`, `feed-source-${source}`);
    } finally {
      device('press', 'id="feed-source-all"');
    }
  }
}
if (mode === 'rail') {
  await checkCategoryRails();
  process.exit(0);
}
if (mode === 'all') {
  for (const [tab, direction] of [
    [tabs[0], 1],
    [tabs.at(-1), -1]
  ]) {
    device('press', `id="${tab.identifier}"`);
    for (const duration of [120, 800]) {
      pan(px(direction > 0 ? 0.15 : 0.85), py(0.5), direction * px(0.7), 0, duration);
      await check(`outward-${direction}-${duration}`, tab.identifier);
      const neighbour = direction > 0 ? tabs[1] : tabs.at(-2);
      // Touching an outer boundary must not block the next short swipe in either direction.
      for (const [dragDirection, expected, name] of [
        [-direction, neighbour.identifier, 'inward-short-after-boundary'],
        [direction, tab.identifier, 'short-return-to-boundary']
      ]) {
        const x = px(dragDirection > 0 ? 0.2 : 0.8);
        execFileSync('adb', [
          '-s',
          serial,
          'shell',
          'input',
          'swipe',
          ...[x, py(0.5), x + dragDirection * px(0.2), py(0.5), 120].map(String)
        ]);
        await check(`${name}-${direction}-${duration}`, expected);
      }
    }
  }
  device('press', 'id="feed-source-all"');
  const readTab = snapshot().find(
    (n) => n.type === 'android.widget.Button' && /^已读(?:，已选择)?$/.test(n.label || '')
  );
  assert(readTab, 'The All source must expose the Read filter.');
  device('press', `@${readTab.ref}`);
  assert(
    !snapshot().some((n) => n.label === '当前筛选没有匹配主题'),
    'NOT_VERIFIED: the finite Read fixture is empty; do not create test data by opening unread posts.'
  );
  device('wait', 'id="feed-topic-first"', '60000');
  for (const direction of [1, -1]) {
    pan(px(direction > 0 ? 0.2 : 0.8), py(0.2), direction * px(0.45), Math.round(list.height * 0.6));
    await check(`top-diagonal-${direction}`, 'feed-source-all');
  }
  let footer;
  for (let attempt = 0; attempt < 25; attempt++) {
    footer = snapshot().find((n) => n.label === '已经到底了');
    if (footer?.rect.height > 0) break;
    pan(px(0.7), py(0.85), 0, -Math.round(list.height * 0.7), 350);
  }
  assert(footer?.rect.height > 0, 'Reach the finite Read list footer; never chase an unfiltered infinite feed.');
  for (const direction of [1, -1]) {
    pan(px(direction > 0 ? 0.2 : 0.8), py(0.8), direction * px(0.45), -Math.round(list.height * 0.6));
    await check(`read-tail-diagonal-${direction}`, 'feed-source-all');
  }
}
// A second finger must not leave the pager stuck; single-finger scrolling resumes.
device('press', 'id="feed-source-yaohuo"');
device('wait', 'id="feed-topic-first"', '60000');
pan(px(0.4), py(0.75), px(0.06), -Math.round(list.height * 0.25), 500, '--pointer-count', '2');
const beforeSingle = snapshot().filter(
  (n) =>
    n.type === 'android.widget.Button' &&
    n.label?.length > 10 &&
    n.rect.width > rail.width * 0.8 &&
    n.rect.y > py(0.15) &&
    n.rect.y < py(0.7)
);
assert(beforeSingle.length >= 2, 'Single-finger recovery needs visible list content.');
pan(px(0.6), py(0.8), 0, -Math.round(list.height * 0.4));
await check('two-finger-then-single-finger', 'feed-source-yaohuo');
const afterSingle = snapshot();
assert(
  beforeSingle.filter((n) => {
    const match = afterSingle.find((other) => other.label === n.label);
    return !match || Math.abs(match.rect.y - n.rect.y) > 10;
  }).length >= 2,
  'Single-finger scrolling must actually move content after two-finger input.'
);
const target = tabs[0];
execFileSync('adb', [
  '-s',
  serial,
  'shell',
  `input swipe ${px(0.7)} ${py(0.8)} ${px(0.7)} ${py(0.2)} 120; ` +
    `input tap ${Math.round(target.rect.x + target.rect.width / 2)} ${Math.round(target.rect.y + target.rect.height / 2)}`
]);
await check('fling-then-distant-tab', target.identifier);
assert(!snapshot().some((n) => n.label === '回到顶部'), 'A source tap must clear the previous list top button.');
await checkCategoryRails();
device('press', 'id="main-tab-more"');
device('press', 'id="main-tab-feed"');
await check('bottom-tab-return', 'feed-source-all');
console.log(`PASS: ${results.length} Feed boundary and interruption checks.`);
