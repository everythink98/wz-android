import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runAgentDevice } from './agent-device-runtime.mjs';

const pkg = 'com.wz.reader';
const proofAvd = 'WZ_ImageRuntime_Test_API35';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const check = (value, message) => {
  if (!value) throw new Error(message);
};

export function assertMediaPressureAvd(avd) {
  avd = avd.trim().split(/\r?\n/)[0].trim();
  check(avd === proofAvd, `Refusing non-proof device: ${avd}`);
}

export function mediaPressureIdentity(packageDump, apkPath, apkHash) {
  const uid = packageDump.match(/^\s*(?:userId|appId)=(\d+)/m)?.[1];
  const firstInstallTime = packageDump.match(/^\s*firstInstallTime=(.+)$/m)?.[1]?.trim();
  const versionCode = packageDump.match(/^\s*versionCode=(\d+)/m)?.[1];
  check(/User 0:.*installed=true/.test(packageDump), 'Package is not installed for user 0');
  check(uid && firstInstallTime && versionCode, 'Incomplete installed package identity');
  check(/^\/data\/app\/[^\r\n]+\/base\.apk$/.test(apkPath), 'Missing installed base.apk path');
  check(/^[a-f0-9]{64}$/.test(apkHash), 'Installed APK hash is unavailable');
  return { uid, firstInstallTime, versionCode: Number(versionCode), apkPath, apkHash };
}

export function assertMediaPressureReceipt(receipt, expected, complete = false) {
  check(receipt?.token === expected.token, 'Receipt token mismatch');
  check(/^[a-f0-9]{32}$/.test(receipt.buildId), 'Missing native buildId');
  check(/^process-[a-f0-9]{32}$/.test(receipt.processSessionId), 'Missing native process identity');
  if (expected.buildId) check(receipt.buildId === expected.buildId, 'Native buildId changed or mismatched');
  if (expected.processSessionId)
    check(receipt.processSessionId === expected.processSessionId, 'Native process restarted');
  check(receipt.versionCode === expected.versionCode, 'Installed versionCode and receipt differ');
  check(receipt.isDev === false && receipt.isHermes === true, 'Proof must run its release Hermes bundle');
  check(receipt.rounds === 20 && receipt.minSeconds === 180 && receipt.externalEvery === 5, 'Unexpected workload');
  check(Array.isArray(receipt.errors) && receipt.errors.length === 0 && !receipt.error, 'Proof reported an error');
  check(receipt.phase !== 'failed', 'Native media proof failed');
  if (!complete) return;
  check(receipt.phase === 'passed', 'Native media proof has not completed');
  check(receipt.completedRounds >= 20 && receipt.elapsedMs >= 180_000, 'Insufficient rounds or duration');
  check(
    Array.isArray(receipt.roundResults) &&
      receipt.roundResults.length === receipt.completedRounds &&
      receipt.roundResults.every((round, index) => round.index === index && round.created === round.released),
    'Incomplete or unbalanced round results'
  );
  check(
    receipt.created > 0 &&
      receipt.created === receipt.released &&
      receipt.roundResults.at(-1)?.created === receipt.created &&
      receipt.peakPlayers === 2 &&
      receipt.livePlayers === 0 &&
      receipt.players?.length === 0 &&
      receipt.observerSubscriptions === 0,
    'Native player calls or proof observers did not settle'
  );
  const externalRounds = receipt.roundResults.filter(({ index }) => index % 5 === 0 || index === 19).length;
  check(
    receipt.roundResults
      .filter(({ index }) => index % 5 === 0 || index === 19)
      .every(({ fullscreenRetention }) => fullscreenRetention?.serial > 0 && fullscreenRetention.retainedMs >= 600),
    'Fullscreen did not retain the player after committed inline removal for 600ms'
  );
  check(
    receipt.roundResults
      .filter(({ index }) => index % 5 === 0 || index === 19)
      .every(
        ({ fullscreenRetention }) =>
          fullscreenRetention.startedPlaying === true &&
          Number.isFinite(fullscreenRetention.startPosition) &&
          Number.isFinite(fullscreenRetention.endPosition) &&
          fullscreenRetention.endPosition - fullscreenRetention.startPosition >= 0.3
      ),
    'Retained fullscreen did not advance the real native playback position'
  );
  check(
    receipt.fullscreenEntries === externalRounds &&
      receipt.fullscreenExits === externalRounds &&
      receipt.backgroundEntries === externalRounds &&
      receipt.foregroundReturns === externalRounds,
    'Missing native fullscreen or real background transitions'
  );
}

function retainedFullscreen(receipt) {
  const serial = receipt?.fullscreenRetention?.serial;
  return (
    receipt?.phase === 'await-fullscreen-exit' &&
    receipt.inlineVideoMounted === false &&
    receipt.players?.some(
      (player) =>
        player.serial === serial &&
        player.fullscreen === true &&
        player.fullscreenActive === true &&
        typeof player.detachedAt === 'number'
    )
  );
}

export async function driveMediaFullscreen({
  receipt,
  snapshot,
  tap,
  readReceipt,
  screenshot = (_name) => {},
  wait = (ms) => delay(ms)
}) {
  const entering = receipt.phase === 'await-fullscreen-enter';
  check(entering || receipt.phase === 'await-fullscreen-exit', 'Unexpected fullscreen phase');
  const counter = entering ? 'fullscreenEntries' : 'fullscreenExits';
  const otherCounter = entering ? 'fullscreenExits' : 'fullscreenEntries';
  const labels = entering
    ? ['Enter fullscreen', '进入全屏模式', '進入全螢幕模式', '進入全螢幕']
    : ['Exit fullscreen', '退出全屏模式', '結束全螢幕模式', '關閉全螢幕'];
  const transitioned = (current) =>
    current?.token === receipt.token &&
    current[counter] === receipt[counter] + 1 &&
    current[otherCounter] === receipt[otherCounter] &&
    (!entering || retainedFullscreen(current));
  if (!entering) {
    check(retainedFullscreen(receipt), 'Missing committed inline removal and native fullscreen retention');
    // RN MainActivity timers pause behind FullscreenPlayerActivity; keep the real fullscreen open on the host clock.
    screenshot('fullscreen-hold-start');
    await wait(750);
    screenshot('fullscreen-hold-end');
    const retained = readReceipt();
    check(
      retained?.token === receipt.token && retainedFullscreen(retained),
      'Fullscreen retention lost during the host hold'
    );
  }
  const visible = (node) =>
    node.enabled === true && node.visibleToUser === true && node.rect?.width > 0 && node.rect?.height > 0;
  const press = (node) => {
    const { x, y, width, height } = node.rect;
    check([x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0, 'Invalid observed target rectangle');
    // Tap this observed rectangle immediately; resolving the selector again can race native auto-hide animation.
    tap(Math.round(x + width / 2), Math.round(y + height / 2), node);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (transitioned(readReceipt())) return;
    let nodes = snapshot(`attempt-${attempt + 1}`);
    let button = nodes.find((node) => node.identifier === `${pkg}:id/exo_fullscreen` && visible(node));
    if (!button) {
      const frame = nodes.find(
        (node) =>
          [`${pkg}:id/texture_player_view`, `${pkg}:id/player_view`, 'forum-content-video-frame'].includes(
            node.identifier
          ) && visible(node)
      );
      check(frame, 'No visible native video frame to reveal fullscreen controls');
      press(frame);
      await wait(200);
      nodes = snapshot(`attempt-${attempt + 1}-revealed`);
      button = nodes.find((node) => node.identifier === `${pkg}:id/exo_fullscreen` && visible(node));
    }
    check(button && button.hittable !== false, 'Actual visible exo_fullscreen button absent');
    check(labels.includes(button.label), `Expected native fullscreen ${entering ? 'enter' : 'exit'} button`);
    press(button);
    for (let poll = 0; poll < 16; poll++) {
      await wait(250);
      if (transitioned(readReceipt())) return;
    }
  }
  throw new Error(
    `Native fullscreen ${entering ? 'enter' : 'exit'} was not confirmed after two observed button attempts`
  );
}

export async function runMediaPressureDeviceProof(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      serial: { type: 'string' },
      apk: { type: 'string' },
      output: { type: 'string' },
      'build-id': { type: 'string' }
    }
  });
  check(
    values.serial && values.apk && values.output,
    'Required: --serial <serial> --apk <apk> --output <new-directory>'
  );
  if (values['build-id']) check(/^[a-f0-9]{32}$/.test(values['build-id']), 'Invalid --build-id');
  const output = path.resolve(values.output);
  check(!existsSync(output), 'Output directory already exists; preserving existing evidence');
  const apkHash = hash(readFileSync(path.resolve(values.apk)));
  mkdirSync(output, { recursive: true });
  const deadline = Date.now() + 600_000;
  const timeout = () => {
    const remaining = deadline - Date.now();
    check(remaining > 0, 'Ten-minute runner deadline exceeded');
    return Math.min(10_000, remaining);
  };
  const adb = (args, binary = false) =>
    execFileSync('adb', ['-s', values.serial, ...args], {
      encoding: binary ? undefined : 'utf8',
      timeout: timeout(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  const shell = (...args) => adb(['shell', ...args]);
  const token = randomUUID();
  const session = `media-pressure-${token}`;
  const result = {
    passed: false,
    token,
    serial: values.serial,
    apk: path.resolve(values.apk),
    apkHash,
    screenshotEvidence: 'NOT_VERIFIED: inspect both samples for a displayed video frame and visible change',
    memoryEvidence: 'Raw per-phase dumpsys meminfo; no decoder or memory-leak verdict inferred from release calls'
  };
  const persist = () => writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  const identity = () => {
    const apkPath = shell('pm', 'path', '--user', '0', pkg)
      .trim()
      .replace(/^package:/, '');
    check(/^\/data\/app\/[^\r\n]+\/base\.apk$/.test(apkPath), 'Installed package has no unique base.apk');
    const installedHash = shell('sha256sum', apkPath).trim().split(/\s+/)[0];
    return mediaPressureIdentity(shell('dumpsys', 'package', pkg), apkPath, installedHash);
  };
  let safeToDrive = false;
  let agentOpened = false;
  let startedEpoch;
  let pid;
  let step = 0;
  let expected;
  let lastReceipt;
  const agent = (args) =>
    runAgentDevice(
      [
        ...args,
        '--platform',
        'android',
        '--serial',
        values.serial,
        '--device',
        proofAvd.replaceAll('_', ' '),
        '--session',
        session,
        '--state-dir',
        path.join(output, 'agent')
      ],
      { capture: true, echoCapture: false, timeout: timeout() }
    );
  const snapshot = (name) => {
    const raw = agent(['snapshot', '--json', '--timeout', String(timeout())]);
    writeFileSync(path.join(output, `${name}.snapshot.json`), raw);
    const value = JSON.parse(raw);
    check(value.success && Array.isArray(value.data?.nodes), 'Native accessibility snapshot unavailable');
    return value.data.nodes;
  };
  const screenshot = (name) =>
    writeFileSync(path.join(output, `${name}.png`), adb(['exec-out', 'screencap', '-p'], true));
  const evidence = (name) => {
    const currentPid = shell('pidof', pkg).trim();
    check(/^\d+$/.test(currentPid), 'Expected exactly one running proof process');
    if (pid) check(pid === currentPid, 'Proof process died or restarted');
    pid = currentPid;
    writeFileSync(path.join(output, `${name}.meminfo.txt`), shell('dumpsys', 'meminfo', pid));
  };
  const readReceipt = () => {
    let receipt;
    try {
      receipt = JSON.parse(shell('run-as', pkg, 'cat', 'cache/media-pressure-proof.json'));
    } catch {
      // A missing/partially written receipt is retried until the bounded runner deadline.
      return null;
    }
    if (receipt.token !== token) return null;
    lastReceipt = receipt;
    assertMediaPressureReceipt(receipt, expected);
    expected.buildId ||= receipt.buildId;
    expected.processSessionId ||= receipt.processSessionId;
    return receipt;
  };
  persist();
  try {
    assertMediaPressureAvd(adb(['emu', 'avd', 'name']));
    result.before = identity();
    check(result.before.apkHash === apkHash, 'Installed APK differs from --apk; runner never installs');
    expected = { token, versionCode: result.before.versionCode, buildId: values['build-id'] };
    startedEpoch = Number(shell('date', '+%s').trim());
    check(Number.isFinite(startedEpoch), 'Device epoch unavailable');
    safeToDrive = true;
    agent(['open', pkg, '--no-test-ime']);
    agentOpened = true;
    evidence('000-before');
    const url = `wzmediapressure://run?token=${token}&rounds=20&minSeconds=180&externalEvery=5`;
    shell('am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, '-n', `${pkg}/.MainActivity`);
    let previous = '';
    let sampled = false;
    let backgroundStarted;
    while (Date.now() < deadline - 30_000) {
      const receipt = readReceipt();
      if (!receipt) {
        await delay(250);
        continue;
      }
      const phaseKey = `${receipt.completedRounds}:${receipt.phase}`;
      if (phaseKey !== previous) {
        previous = phaseKey;
        const name = `${String(++step).padStart(3, '0')}-${phaseKey.replace(':', '-')}`;
        appendFileSync(
          path.join(output, 'receipts.jsonl'),
          JSON.stringify({ observedAt: new Date().toISOString(), ...receipt }) + '\n'
        );
        evidence(name);
        if (receipt.phase === 'await-fullscreen-enter' || receipt.phase === 'await-fullscreen-exit') {
          if (!sampled && receipt.phase === 'await-fullscreen-enter') {
            screenshot('video-sample-1');
            await delay(1_000);
            screenshot('video-sample-2');
            sampled = true;
          }
          await driveMediaFullscreen({
            receipt,
            snapshot: (attempt) => snapshot(`${name}-${attempt}`),
            tap: (x, y, node) => {
              shell('input', 'tap', String(x), String(y));
              appendFileSync(
                path.join(output, 'actions.jsonl'),
                JSON.stringify({
                  phase: receipt.phase,
                  at: new Date().toISOString(),
                  x,
                  y,
                  identifier: node.identifier,
                  label: node.label,
                  rect: node.rect
                }) + '\n'
              );
            },
            readReceipt,
            screenshot: (moment) => screenshot(`${name}-${moment}`),
            wait: delay
          });
        } else if (receipt.phase === 'await-background') {
          shell('input', 'keyevent', 'KEYCODE_HOME');
        } else if (receipt.phase === 'await-foreground') {
          backgroundStarted = Date.now();
          await delay(2_500);
          shell('am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
          appendFileSync(
            path.join(output, 'actions.jsonl'),
            JSON.stringify({ phase: 'foreground-return', heldMs: Date.now() - backgroundStarted }) + '\n'
          );
        } else if (receipt.phase === 'passed') {
          assertMediaPressureReceipt(receipt, expected, true);
          check(sampled, 'Missing displayed-frame review samples');
          result.receipt = receipt;
          result.passed = true;
          break;
        }
      }
      await delay(250);
    }
    check(result.passed, 'Media pressure proof timed out before the ten-minute deadline');
  } catch (error) {
    result.error = error?.message || String(error);
    result.detail = String(error?.stderr || error?.stdout || '');
    result.receipt = lastReceipt;
  } finally {
    const failures = [];
    for (const [name, collect] of Object.entries({
      identity: () => {
        if (!result.before) return;
        const previouslySafe = safeToDrive;
        safeToDrive = false;
        result.after = identity();
        check(
          JSON.stringify(result.before) === JSON.stringify(result.after),
          'Installed identity changed; device actions frozen'
        );
        safeToDrive = previouslySafe;
      },
      failureScreen: () => {
        if (!result.passed && safeToDrive) screenshot('failure');
      },
      memory: () => {
        if (pid) evidence('final');
      },
      nativeErrors: () => {
        if (!pid || !startedEpoch) return;
        const raw = adb(['logcat', '-d', '-v', 'epoch', `--pid=${pid}`, '*:E']);
        const lines = raw.split(/\r?\n/).filter((line) => Number(line.trim().split(/\s+/)[0]) >= startedEpoch);
        writeFileSync(path.join(output, 'native-errors.log'), lines.join('\n'));
        result.nativeErrorLines = lines.length;
        result.nativeErrorReview = lines.length
          ? 'REVIEW_REQUIRED'
          : 'No process error-priority lines captured in run interval';
        if (
          lines.some((line) =>
            /FATAL EXCEPTION|Fatal signal|ReactNativeJS.*(?:TypeError|ReferenceError|Error:)/.test(line)
          )
        )
          throw new Error('Fatal native or JavaScript error captured; inspect native-errors.log');
      },
      session: () => {
        if (safeToDrive && agentOpened) agent(['close']);
      },
      home: () => {
        if (safeToDrive) shell('input', 'keyevent', 'KEYCODE_HOME');
      }
    })) {
      try {
        collect();
      } catch (error) {
        failures.push(`${name}: ${error?.message || String(error)}`);
      }
    }
    if (failures.length) {
      result.passed = false;
      result.evidenceErrors = failures;
    }
    persist();
  }
  check(result.passed, result.error || result.evidenceErrors?.join('; ') || 'Media proof failed');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMediaPressureDeviceProof().then(
    (result) =>
      console.log(
        JSON.stringify({
          passed: result.passed,
          rounds: result.receipt.completedRounds,
          elapsedMs: result.receipt.elapsedMs
        })
      ),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
