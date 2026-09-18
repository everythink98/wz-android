import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { runAgentDevice } from './agent-device-runtime.mjs';
import { diagnosticProofFixture } from './run-diagnostic-device-proof.mjs';
import apkSigning from './apk-signing.cjs';

const root = path.resolve(import.meta.dirname, '..');
const pkg = 'com.wz.reader';
const expectedAvd = 'WZ_ComposerInsets_0916';
const hash = (data) => createHash('sha256').update(data).digest('hex');
export const composerCases = [
  ...['nodeseek', 'linuxdo'].flatMap((source) =>
    ['rich', 'source'].flatMap((mode) =>
      ['sheet', 'fullscreen'].flatMap((presentation) =>
        ['shown', 'hidden'].map((keyboard) => ({
          id: `${source}-${mode}-${presentation}-${keyboard}`,
          source,
          mode,
          presentation,
          keyboard,
          entry: 'reply'
        }))
      )
    )
  ),
  ...['nodeseek', 'linuxdo', 'yaohuo'].flatMap((source) =>
    (source === 'yaohuo' ? ['reply', 'message'] : ['floor', 'edit', 'message']).flatMap((entry) =>
      ['success', 'network-error'].map((outcome) => ({
        id: `${source}-${entry}-${outcome}`,
        source,
        entry,
        outcome,
        mode: 'rich',
        presentation: 'sheet',
        keyboard: 'shown'
      }))
    )
  ),
  ...['reopen', 'cycles', 'image', 'delay', 'ime-fast', 'ime-slow'].map((stress) => ({
    id: `stress-${stress}`,
    source: 'nodeseek',
    entry: 'reply',
    outcome: 'success',
    stress,
    mode: 'rich',
    presentation: 'fullscreen',
    keyboard: stress === 'image' ? 'hidden' : 'shown'
  })),
  ...[false, true].map((dark) => ({
    id: `fullscreen-${dark ? 'dark' : 'light'}`,
    source: 'nodeseek',
    entry: 'reply',
    outcome: 'success',
    dark,
    mode: 'rich',
    presentation: 'fullscreen',
    keyboard: 'hidden'
  }))
];

export function composerSourceHash() {
  const files = [];
  function walk(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (/\.(tsx?|js|json|patch)$/.test(name) && !/\.test\.[^.]+$/.test(name)) files.push(name);
    }
  }
  for (const directory of ['src', 'plugins', 'patches', 'dev/composer-proof']) walk(directory);
  files.push(
    'tests/ui/composerSubmissionFixture.tsx',
    'tests/ui/composerMessageFixture.tsx',
    'tests/helpers/accountSessions.ts',
    'package-lock.json',
    'app.json'
  );
  return hash(
    files
      .sort()
      .map((file) => `${file}:${hash(readFileSync(path.join(root, file)))}`)
      .join('\n')
  );
}

export function assertComposerReceipt(receipt, expected) {
  if (
    !receipt ||
    receipt.token !== expected.token ||
    receipt.buildId !== expected.buildId ||
    receipt.isHermes !== true ||
    receipt.isDev !== false
  )
    throw new Error('Stale or mismatched composer receipt');
  if (
    expected.closed &&
    (receipt.visible !== false ||
      receipt.content !== '' ||
      receipt.busy !== false ||
      receipt.keyboardShown !== false ||
      receipt.confirmations !== 1 ||
      receipt.requests !== (expected.requests ?? 1))
  )
    throw new Error('Submission did not settle exactly once into an empty closed composer');
}

export function assertComposerClosed(nodes, before, after) {
  if (nodes.some((node) => node.label === 'Bottom Sheet' && node.visibleToUser !== false && node.rect?.height > 0))
    throw new Error('Successful submission left a visible Bottom Sheet');
  if (before.width !== after.width || before.height !== after.height) throw new Error('Screen geometry changed');
  // Empty right edge of the fixture detects a remaining dim backdrop independently of accessibility.
  for (const fraction of [0.5, 0.75]) {
    const offset = (Math.floor(before.height * fraction) * before.width + before.width - 2) * 4;
    if (!before.data.subarray(offset, offset + 3).equals(after.data.subarray(offset, offset + 3)))
      throw new Error('Closed composer left visible sheet/backdrop pixels');
  }
}

export function composerSafeTop(windowInsets, requireCutout = false) {
  const bar = windowInsets.match(/type=statusBars[^\r\n]*frame=\[0,0\]\[\d+,(\d+)\]/);
  if (!bar) throw new Error('Status bar geometry unavailable');
  const cutout = Math.max(
    0,
    ...Array.from(windowInsets.matchAll(/mDisplayCutout=DisplayCutout\{insets=Rect\(\d+, (\d+) - /g), (match) =>
      Number(match[1])
    )
  );
  if (requireCutout && cutout === 0) throw new Error('Requested cutout has no effective safe inset');
  return Math.max(Number(bar[1]), cutout);
}

export function assertComposerFullscreen(nodes, screenshot, safeTop) {
  const sheet = nodes.find((node) => node.label === 'Bottom Sheet');
  if (!sheet || sheet.rect.y !== 0) throw new Error(`Fullscreen background starts at ${sheet?.rect?.y}, expected 0`);
  const close = nodes.find((node) => ['收起回复', '取消楼层回复', '取消编辑', '取消'].includes(node.label));
  if (!close || close.rect.y < safeTop) throw new Error('Fullscreen toolbar overlaps the safe top inset');
  const pixel = (y) =>
    screenshot.data.subarray(
      (y * screenshot.width + screenshot.width - 2) * 4,
      (y * screenshot.width + screenshot.width - 2) * 4 + 3
    );
  if (!pixel(Math.floor(safeTop / 2)).equals(pixel(safeTop + 3)))
    throw new Error('Fullscreen status-bar background has a seam');
}

async function main() {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string' },
      output: { type: 'string' },
      build: { type: 'boolean' },
      apk: { type: 'string' },
      'require-cutout': { type: 'boolean' },
      cases: { type: 'string' }
    }
  });
  if (!values.serial || !values.output || Boolean(values.build) === Boolean(values.apk))
    throw new Error('Use --serial --output and exactly one of --build / --apk');
  const output = path.resolve(values.output);
  const relative = path.relative(path.join(root, '.codex-tmp'), output);
  if (relative.startsWith('..') || path.isAbsolute(relative) || existsSync(output))
    throw new Error('Use a new .codex-tmp output directory');
  mkdirSync(output, { recursive: true });
  const adb = (...args) =>
    execFileSync('adb', ['-s', values.serial, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const avd = adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim();
  if (avd !== expectedAvd) throw new Error(`Refusing non-proof device: ${avd}`);
  const identity = () => adb('shell', 'dumpsys', 'package', pkg).match(/firstInstallTime=([^\r\n]+)/)?.[1];
  const installedAt = identity();
  if (!installedAt) throw new Error('Expected an existing isolated proof installation');
  const ime = adb('shell', 'settings', 'get', 'secure', 'default_input_method');
  if (ime.includes('imehelper')) throw new Error('Select a real keyboard on the isolated device before running');
  const windowAnimationScale = adb('shell', 'settings', 'get', 'global', 'window_animation_scale');
  const setWindowAnimationScale = (value) =>
    value === 'null'
      ? adb('shell', 'settings', 'delete', 'global', 'window_animation_scale')
      : adb('shell', 'settings', 'put', 'global', 'window_animation_scale', value);
  for (const patch of readdirSync(path.join(root, 'patches')).filter((name) => name.endsWith('.patch')))
    execFileSync('git', ['apply', '--reverse', '--check', '--whitespace=nowarn', path.join(root, 'patches', patch)], {
      cwd: root,
      windowsHide: true
    });
  let apk = values.apk && path.resolve(values.apk);
  if (values.build) {
    execFileSync(process.execPath, ['scripts/build-composer-editor.mjs'], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true
    });
    const sourceHash = composerSourceHash();
    const android = path.join(root, 'android');
    const fixture = mkdtempSync(path.join(root, '.codex-tmp', 'composer-proof-build-'));
    const config = diagnosticProofFixture(android, fixture);
    writeFileSync(
      path.join(fixture, 'AndroidManifest.xml'),
      config.manifest
        .replace('<activity android:name="com.wz.reader.DiagnosticsProofFaultActivity" android:exported="true"/>', '')
        .replace('wzdiag', 'wzcomposerproof')
    );
    writeFileSync(
      path.join(fixture, 'init.gradle'),
      config.init.replace('dev/diagnostics-proof/index.tsx', 'dev/composer-proof/index.tsx')
    );
    const env = { ...process.env, NODE_ENV: 'production' };
    for (const name of Object.keys(env))
      if (name === 'ENTRY_FILE' || name.startsWith('WZ_ANDROID_KEY')) delete env[name];
    execFileSync(
      'java',
      [
        '-jar',
        'gradle/wrapper/gradle-wrapper.jar',
        '--no-daemon',
        '--max-workers=2',
        '-PreactNativeArchitectures=x86_64',
        '-I',
        path.join(fixture, 'init.gradle'),
        ':app:assembleRelease'
      ],
      { cwd: android, env, stdio: 'inherit', windowsHide: true }
    );
    apk = path.join(fixture, 'composer-proof.apk');
    copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), apk);
    if (sourceHash !== composerSourceHash())
      throw new Error('Composer sources changed during build; rebuild before replay');
    writeFileSync(
      `${apk}.json`,
      JSON.stringify({ buildId: config.buildId, sourceHash, apkHash: hash(readFileSync(apk)) })
    );
  }
  const artifact = JSON.parse(readFileSync(`${apk}.json`, 'utf8'));
  if (artifact.sourceHash !== composerSourceHash() || artifact.apkHash !== hash(readFileSync(apk)))
    throw new Error('APK does not match the current composer sources');
  const buildTools = path.join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '', 'build-tools');
  const signer = readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => path.join(buildTools, version, 'lib/apksigner.jar'))
    .find(existsSync);
  if (!signer) throw new Error('Android apksigner unavailable');
  const signingIdentity = (file) =>
    apkSigning.singleApkSignerSha256(
      execFileSync('java', ['-jar', signer, 'verify', '--print-certs', file], { encoding: 'utf8', windowsHide: true })
    );
  const installedPath = adb('shell', 'pm', 'path', pkg)
    .split(/\r?\n/)[0]
    .replace(/^package:/, '');
  const installedCopy = path.join(output, 'previous.apk');
  adb('pull', installedPath, installedCopy);
  const certificate = signingIdentity(apk);
  if (!certificate || certificate !== signingIdentity(installedCopy))
    throw new Error('APK signer mismatch; installation frozen');
  adb('install', '-r', apk);
  if (identity() !== installedAt) throw new Error('Installation identity changed; device changes frozen');
  const report = {
    artifact,
    runnerHash: hash(readFileSync(fileURLToPath(import.meta.url))),
    apk,
    avd,
    serial: values.serial,
    installedAt,
    ime,
    windowAnimationScale,
    certificate,
    webView: adb('shell', 'dumpsys', 'webviewupdate'),
    size: adb('shell', 'wm', 'size'),
    overlays: adb('shell', 'cmd', 'overlay', 'list'),
    results: []
  };
  writeFileSync(path.join(output, 'environment.json'), JSON.stringify(report, null, 2));
  const chosen = values.cases
    ? values.cases.split(',').map((id) => {
        const scenario = composerCases.find((value) => value.id === id);
        if (!scenario) throw new Error(`Unknown composer case: ${id}`);
        return scenario;
      })
    : composerCases;
  const session = `composer-${randomUUID()}`;
  const agent = (args, capture = true) =>
    runAgentDevice(
      [
        ...args,
        '--platform',
        'android',
        '--serial',
        values.serial,
        '--device',
        avd.replaceAll('_', ' '),
        '--session',
        session,
        '--state-dir',
        path.join(output, 'agent')
      ],
      { capture, echoCapture: false }
    );
  const replay = (name, submitLabel, launcher = '打开测试回复', close = '收起回复') =>
    agent([
      'replay',
      `dev/composer-proof/${name}.ad`,
      '-e',
      `SUBMIT_LABEL=${submitLabel}`,
      '-e',
      `LAUNCHER=${launcher}`,
      '-e',
      `CLOSE_LABEL=${close}`
    ]);
  const capture = (directory, name) => {
    const image = execFileSync('adb', ['-s', values.serial, 'exec-out', 'screencap', '-p'], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    writeFileSync(path.join(directory, `${name}.png`), image);
    return PNG.sync.read(image);
  };
  async function receipt(token, condition = () => true, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      let value;
      try {
        value = JSON.parse(adb('shell', 'run-as', pkg, 'cat', 'cache/composer-proof.json'));
      } catch {}
      if (value?.token === token && condition(value)) {
        assertComposerReceipt(value, { token, buildId: artifact.buildId });
        return value;
      }
      await delay(100);
    }
    throw new Error('Composer receipt timed out');
  }
  const snapshot = (directory, name) => {
    const result = JSON.parse(agent(['snapshot', '--json']));
    writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(result));
    if (!result.success || !Array.isArray(result.data?.nodes)) throw new Error('Native snapshot unavailable');
    return result.data.nodes;
  };
  try {
    for (const scenario of chosen) {
      const token = randomUUID().replaceAll('-', '');
      const directory = path.join(output, scenario.id);
      mkdirSync(directory);
      const result = { ...scenario, token, passed: false };
      try {
        result.windowAnimationScale =
          scenario.stress === 'ime-fast' ? '0' : scenario.stress === 'ime-slow' ? '5' : windowAnimationScale;
        setWindowAnimationScale(result.windowAnimationScale);
        adb('shell', 'am', 'force-stop', pkg);
        adb(
          'shell',
          'am',
          'start',
          '-n',
          `${pkg}/.MainActivity`,
          '-a',
          'android.intent.action.VIEW',
          '-d',
          `'wzcomposerproof://${token}?source=${scenario.source}&entry=${scenario.entry}&outcome=${scenario.outcome || 'success'}&theme=${scenario.dark ? 'dark' : 'light'}&stress=${scenario.stress || ''}'`
        );
        await receipt(token, undefined, 60000);
        const submitLabel = scenario.entry === 'edit' ? '保存编辑' : '发送回复';
        const message = scenario.entry === 'message';
        const launcher = message ? (scenario.source === 'nodeseek' ? '发私信' : '回复私信') : '打开测试回复';
        const closeLabel = message
          ? '取消'
          : scenario.entry === 'edit'
            ? '取消编辑'
            : scenario.entry === 'floor'
              ? '取消楼层回复'
              : '收起回复';
        replay(message ? 'open-message' : 'open', submitLabel);
        adb('shell', 'ime', 'set', ime);
        const before = capture(directory, 'before');
        replay('open-editor', submitLabel, launcher);
        await receipt(token, (value) => value.keyboardShown === true);
        if (scenario.source !== 'yaohuo') agent(['press', `label="${scenario.mode === 'source' ? '源码' : '富文本'}"`]);
        if (message) {
          // agent-device caches its test IME ownership after open. Restore that IME only
          // for text entry, then use the real keyboard for every layout/submit assertion.
          adb('shell', 'ime', 'set', 'com.callstack.agentdevice.imehelper/.TestInputMethodService');
          replay('message-input', submitLabel);
          adb('shell', 'ime', 'set', ime);
          await receipt(token, (value) => value.keyboardShown);
        }
        if (scenario.presentation === 'fullscreen') replay('fullscreen', submitLabel);
        if (scenario.stress === 'cycles') {
          for (let cycle = 0; cycle < 3; cycle++) {
            replay('manual-close', submitLabel, launcher, closeLabel);
            await receipt(token, (value) => !value.visible && !value.keyboardShown);
            replay('open-editor', submitLabel, launcher);
            await receipt(token, (value) => value.visible && value.keyboardShown);
            replay('fullscreen', submitLabel);
          }
        }
        if (scenario.stress === 'image') {
          replay('image-cancel', submitLabel);
          await receipt(token, (value) => value.visible && !value.busy);
          if (!(await receipt(token)).content.includes('Local mock reply; never sent.'))
            throw new Error('Picker cancellation lost draft');
        }
        if (scenario.keyboard === 'hidden') {
          if ((await receipt(token)).keyboardShown) adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
          await receipt(token, (value) => value.keyboardShown === false);
        }
        if (adb('shell', 'settings', 'get', 'secure', 'default_input_method') !== ime)
          throw new Error('The real IME must be active for layout and submission');
        const beforeSubmit = await receipt(token, (value) => value.keyboardShown === (scenario.keyboard === 'shown'));
        writeFileSync(path.join(directory, 'before-submit.json'), JSON.stringify(beforeSubmit));
        const windowInsets = adb('shell', 'dumpsys', 'window');
        writeFileSync(path.join(directory, 'window-insets.txt'), windowInsets);
        const opened = snapshot(directory, 'opened');
        if (scenario.presentation === 'fullscreen') {
          result.fullscreenError = undefined;
          try {
            result.safeTop = composerSafeTop(windowInsets, values['require-cutout']);
            assertComposerFullscreen(opened, capture(directory, 'fullscreen'), result.safeTop);
          } catch (error) {
            result.fullscreenError = error.message;
          }
        }
        replay('submit', submitLabel);
        if (scenario.stress === 'reopen') {
          const reopened = await receipt(
            token,
            (value) =>
              value.visible && value.content === '' && !value.busy && value.confirmations === 1 && value.keyboardShown
          );
          writeFileSync(path.join(directory, 'reopened-during-close-receipt.json'), JSON.stringify(reopened));
          if (!snapshot(directory, 'reopened-during-close').some((node) => node.label === '发送回复'))
            throw new Error('Old close covered the new session');
          replay('manual-close', submitLabel, launcher, closeLabel);
          result.reopenedDuringClose = true;
        }
        if (scenario.outcome === 'network-error') {
          const rejected = await receipt(
            token,
            (value) =>
              value.requests === 1 &&
              value.confirmations === 0 &&
              (message || (value.busy === false && value.notice === 'Mock network offline'))
          );
          writeFileSync(path.join(directory, 'failed-receipt.json'), JSON.stringify(rejected));
          if (message) replay('failed', submitLabel);
          const failed = snapshot(directory, 'failed');
          if (!failed.some((node) => node.label?.includes('Local mock reply; never sent.')))
            throw new Error('Failed request lost the visible draft');
          replay('manual-close', submitLabel, launcher, closeLabel);
          await receipt(token, (value) => !value.keyboardShown && (message || !value.visible));
          agent(['press', 'text="下一次成功"']);
          replay('open-editor', submitLabel, launcher);
          await receipt(token, (value) => value.keyboardShown);
          const retained = snapshot(directory, 'retained');
          if (!retained.some((node) => node.label?.includes('Local mock reply; never sent.')))
            throw new Error('Reopened failed draft is missing');
          replay('submit', submitLabel);
        }
        const settled = await receipt(
          token,
          (value) =>
            (message ? value.notice === '回复已发送' : value.visible === false) && !value.busy && !value.keyboardShown
        );
        writeFileSync(path.join(directory, 'settled.json'), JSON.stringify(settled));
        assertComposerReceipt(settled, {
          token,
          buildId: artifact.buildId,
          closed: !message,
          requests: scenario.outcome === 'network-error' ? 2 : 1
        });
        if (settled.confirmations !== 1 || settled.requests !== (scenario.outcome === 'network-error' ? 2 : 1))
          throw new Error('Submission count mismatch');
        // Poll the actual view until it exits; time is a deadline, never the success oracle.
        const deadline = Date.now() + 8000;
        let closeError;
        do {
          try {
            assertComposerClosed(snapshot(directory, 'closed'), before, capture(directory, 'closed'));
            closeError = undefined;
            break;
          } catch (error) {
            closeError = error;
          }
          await delay(150);
        } while (Date.now() < deadline);
        if (closeError) throw closeError;
        replay('closed', submitLabel);
        result.closed = true;
        replay(
          'open-editor',
          scenario.entry === 'edit' ? '发送回复' : submitLabel,
          scenario.entry === 'edit' ? '打开空白回复' : launcher
        );
        await receipt(token, (value) => value.keyboardShown);
        const reopened = snapshot(directory, 'reopened');
        if (reopened.some((node) => node.label?.includes('Local mock reply; never sent.')))
          throw new Error('Sent document returned on reopen');
        replay('manual-close', submitLabel, launcher, scenario.entry === 'edit' ? '收起回复' : closeLabel);
        result.reopenedEmpty = true;
        if (result.fullscreenError) throw new Error(result.fullscreenError);
        result.passed = true;
      } catch (error) {
        result.error = error.message;
        result.detail = error.stderr || error.stdout;
        try {
          writeFileSync(
            path.join(directory, 'failure-receipt.json'),
            adb('shell', 'run-as', pkg, 'cat', 'cache/composer-proof.json')
          );
        } catch {}
        capture(directory, 'failure');
      }
      report.results.push(result);
      writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'} ${scenario.id}: ${result.error || 'settled and visually closed'}`
      );
    }
  } finally {
    try {
      try {
        agent(['close']);
      } catch (error) {
        if (!String(error.stderr).includes('SESSION_NOT_FOUND')) throw error;
      }
    } finally {
      adb('shell', 'ime', 'set', ime);
      setWindowAnimationScale(windowAnimationScale);
    }
  }
  if (report.results.some((result) => !result.passed)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
