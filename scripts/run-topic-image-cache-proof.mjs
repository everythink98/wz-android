import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { assertMediaPressureAvd, mediaPressureIdentity } from './run-media-pressure-device-proof.mjs';

const { values } = parseArgs({
  options: {
    serial: { type: 'string' },
    apk: { type: 'string' },
    output: { type: 'string' },
    'build-id': { type: 'string' },
    cycles: { type: 'string', default: '2' }
  }
});
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
check(
  values.serial && values.apk && values.output && /^[a-f0-9]{32}$/.test(values['build-id']),
  'Expected --serial --apk --build-id --output'
);
const cycles = Number(values.cycles);
check(Number.isSafeInteger(cycles) && cycles > 0, 'Use a positive integer for --cycles');
const output = path.resolve(values.output);
const relative = path.relative(path.resolve('.codex-tmp'), output);
check(
  relative && !relative.startsWith('..') && !path.isAbsolute(relative) && !existsSync(output),
  'Use a new directory inside .codex-tmp'
);
const pkg = 'com.wz.reader';
const adb = (args, binary = false) =>
  execFileSync('adb', ['-s', values.serial, ...args], {
    encoding: binary ? 'buffer' : 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024
  });
const shell = (...args) => adb(['shell', ...args]).trim();
assertMediaPressureAvd(adb(['emu', 'avd', 'name']));
const identity = () => {
  const apkPath = shell('pm', 'path', '--user', '0', pkg)
    .split(/\r?\n/)
    .find((v) => v.endsWith('/base.apk'))
    ?.slice(8);
  check(apkPath && /^\/data\/app\/[^\r\n]+\/base\.apk$/.test(apkPath), 'Missing installed base APK');
  const hash = shell('sha256sum', apkPath).split(/\s/)[0];
  return mediaPressureIdentity(shell('dumpsys', 'package', pkg), apkPath, hash);
};
const before = identity();
check(
  before.apkHash === createHash('sha256').update(readFileSync(values.apk)).digest('hex'),
  'Install the matching proof APK before running'
);
mkdirSync(output, { recursive: true });
const result = { before, token: randomUUID(), cycles, visits: [], idle: [], passed: false };
const save = () => writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
let step = 0;
let pid;
let buildId;
let processSessionId;
function meminfo() {
  const current = shell('pidof', pkg);
  check(/^\d+$/.test(current) && (!pid || current === pid), 'Process identity changed during workload');
  pid = current;
  const dump = shell('dumpsys', 'meminfo', pid);
  const number = (pattern) => {
    const found = dump.match(pattern);
    check(found, 'Incomplete process memory sample');
    return Number(found[1].replaceAll(',', ''));
  };
  // In API 35's detailed heap rows the final three columns are heap size, allocated and free.
  const allocated = (pattern) => {
    const values = dump.match(pattern)?.[1].trim().split(/\s+/);
    check(values?.length >= 8, 'Missing detailed heap allocation columns');
    return Number(values.at(-2).replaceAll(',', ''));
  };
  return {
    pssKiB: number(/TOTAL PSS:\s*([\d,]+)/),
    nativePssKiB: number(/^\s*Native Heap:\s*([\d,]+)/m),
    javaPssKiB: number(/^\s*Java Heap:\s*([\d,]+)/m),
    graphicsPssKiB: number(/^\s*Graphics:\s*([\d,]+)/m),
    nativeHeapAllocatedKiB: allocated(/^\s*Native Heap[ \t]+([\d, \t]+)\r?$/m),
    dalvikHeapAllocatedKiB: allocated(/^\s*Dalvik Heap[ \t]+([\d, \t]+)\r?$/m)
  };
}
async function read(command, deadline) {
  let phase = 'waiting-for-intent';
  while (Date.now() < deadline) {
    let receipt;
    try {
      receipt = JSON.parse(shell('run-as', pkg, 'cat', 'cache/topic-image-pressure.json'));
    } catch {
      // Another command may be replacing its receipt while adb reads it.
    }
    if (
      receipt?.token === result.token &&
      receipt.step === command.step &&
      receipt.topic === command.topic &&
      receipt.page === command.page
    ) {
      check(!receipt.error, receipt.error || 'Image fixture failed');
      check(
        receipt.isHermes && !receipt.isDev && receipt.catalogSize === 256 && receipt.pagesPerTopic === 4,
        'Expected Release Hermes image fixture'
      );
      check(receipt.installedVersionCode === before.versionCode, 'PackageManager version does not match installed APK');
      if (receipt.phase === 'displayed')
        check(
          receipt.catalog?.count === 256 && receipt.catalog.lastIndex === 255,
          'Full catalog ownership or last image lookup failed'
        );
      check(receipt.buildId === values['build-id'], 'Receipt does not match supplied build ID');
      check(
        /^[0-9a-f]{32}$/.test(receipt.buildId) && /^process-[0-9a-f]{32}$/.test(receipt.processSessionId),
        'Missing proof identities'
      );
      check(
        (!buildId || buildId === receipt.buildId) &&
          (!processSessionId || processSessionId === receipt.processSessionId),
        'Build or process changed'
      );
      buildId = receipt.buildId;
      processSessionId = receipt.processSessionId;
      phase = receipt.phase;
      if (phase === (command.topic ? 'displayed' : 'idle')) return receipt;
    }
    await delay(350);
  }
  throw new Error(
    `No completed receipt for step ${command.step}, topic ${command.topic}, page ${command.page}, phase ${phase}`
  );
}
async function select(topic, page = 0) {
  step++;
  const url = `wztopicimagecache://run?token=${result.token}&step=${step}&topic=${topic}&page=${page}`;
  shell('am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, '-p', pkg);
  return read({ step, topic, page }, Date.now() + 20000);
}
function changedRatio(left, right, rect) {
  check(
    rect?.width > 32 && rect?.height > 32 && left.width === right.width && left.height === right.height,
    'Invalid image comparison bounds'
  );
  const x0 = Math.max(0, Math.ceil(rect.x + rect.width * 0.15));
  const y0 = Math.max(0, Math.ceil(rect.y + rect.height * 0.15));
  const x1 = Math.min(left.width, Math.floor(rect.x + rect.width * 0.85));
  const y1 = Math.min(left.height, Math.floor(rect.y + rect.height * 0.85));
  check(x1 - x0 > 16 && y1 - y0 > 16, 'Image is outside the visible capture');
  let changed = 0;
  for (let y = y0; y < y1; y += 3)
    for (let x = x0; x < x1; x += 3) {
      const offset = (y * left.width + x) * 4;
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(left.data[offset + c] - right.data[offset + c]))) > 10) changed++;
    }
  return changed / (Math.ceil((y1 - y0) / 3) * Math.ceil((x1 - x0) / 3));
}
async function confirmAnimation(boxes) {
  const snapshot = () => PNG.sync.read(adb(['exec-out', 'screencap', '-p'], true));
  const start = snapshot();
  for (let attempt = 0; attempt < 8; attempt++) {
    await delay(125 + attempt * 17);
    const current = snapshot();
    const animation = changedRatio(start, current, boxes.upper);
    const photo = changedRatio(start, current, boxes.lower);
    if (animation > 0.01 && photo < 0.002) return { animation, photo };
  }
  throw new Error('No moving GIF next to a stable photograph');
}
async function runCycle(cycle) {
  const previousLoads = (cycle - 1) * 15;
  for (let topic = 1; topic <= 15; topic++) {
    const pages = [];
    let motion;
    for (let page = 0; page < 4; page++) {
      const active = await select(topic, page);
      check(
        active.geometry && active.cached === topic && active.loads === previousLoads + topic,
        'Missing distinct topic or native display'
      );
      const { idle, displayed } = active.geometry;
      const deltaPx = {
        upperHeight: displayed.upper.height - idle.upper.height,
        lowerHeight: displayed.lower.height - idle.lower.height,
        nextRowTop: displayed.lower.y - idle.lower.y
      };
      check(
        Object.values(deltaPx).every((value) => value === 0),
        'Native image admission moved a row with known dimensions'
      );
      if (page === 0) motion = await confirmAnimation(displayed);
      pages.push({ page, deltaPx });
    }
    const memory = meminfo();
    const closed = await select(0);
    check(closed.cached === topic, 'Returning to the list unexpectedly evicted a topic');
    result.visits.push({
      cycle,
      topic,
      catalog: closed.catalogSize,
      cached: closed.cached,
      pages,
      motion,
      memory,
      afterReturn: meminfo()
    });
    save();
  }
  const warm = await select(1);
  check(
    warm.loads === previousLoads + 15 && warm.cached === 15 && warm.geometry,
    'Warm revisit refetched or lost media'
  );
  const idle = await select(0);
  const returned = Date.now();
  for (const seconds of [0, 30, 60, 300, 315]) {
    await delay(Math.max(0, returned + seconds * 1000 - Date.now()));
    const receipt = await read(idle, Date.now() + 10000);
    result.idle.push({
      cycle,
      seconds: Math.round((Date.now() - returned) / 1000),
      cached: receipt.cached,
      memory: meminfo()
    });
    save();
  }
  check(result.idle.at(-1).cached === 0, 'Inactive topics outlived the ordinary client cache interval');
}
try {
  const initial = await select(0);
  check(initial.cached === 0 && initial.loads === 0, 'Expected fresh query ownership');
  result.initialMemory = meminfo();
  for (let cycle = 1; cycle <= cycles; cycle++) await runCycle(cycle);
  result.after = identity();
  check(JSON.stringify(before) === JSON.stringify(result.after), 'Installation identity changed');
  result.passed = true;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  Object.assign(result, { buildId, processSessionId, pid });
  save();
}
check(result.passed, result.error || 'Image pressure proof failed');
console.log(JSON.stringify({ passed: true, visits: result.visits.length, pid, idle: result.idle }));
