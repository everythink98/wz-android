import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { assertAgentDeviceVersion, runAgentDevice } from './agent-device-runtime.mjs';
import { diagnosticProofFixture } from './run-diagnostic-device-proof.mjs';
import { proofDeviceForSerial, withProofCheckpoint } from './review-proof-checkpoint.mjs';

const root = path.resolve(import.meta.dirname, '..');
const baselineDirectory = path.join(root, '.codex-tmp', 'visual-baselines', 'api35-standard');
const scenes = [
  'search.idle.recent',
  'search.aggregate.partial',
  'topic.content.structured',
  'user.profile.long',
  'notifications.detail.error',
  'more.sources.mixed'
];
export const visualFrames = [
  ...scenes.flatMap((scene) => ['light', 'dark'].map((theme) => ({ scene, theme, font: 1 }))),
  ...['search.idle.recent', 'user.profile.long'].map((scene) => ({ scene, theme: 'light', font: 1.4 }))
].map((frame) => ({ ...frame, name: `${frame.scene}-${frame.theme}-${frame.font}.png` }));
const hashFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function compareVisualFrame(baseline, current, diff) {
  if (!existsSync(baseline)) throw new Error(`Missing visual baseline: ${baseline}`);
  const before = PNG.sync.read(readFileSync(baseline));
  const after = PNG.sync.read(readFileSync(current));
  if (before.width !== after.width || before.height !== after.height)
    throw new Error(`Screenshot dimensions differ: ${current}`);
  const report = JSON.parse(
    runAgentDevice(
      ['diff', 'screenshot', '--baseline', baseline, current, '--out', diff, '--threshold', '0.1', '--json'],
      { capture: true, echoCapture: false }
    )
  );
  if (
    !report.success ||
    report.data?.differentPixels !== 0 ||
    report.data?.totalPixels !== before.width * before.height
  )
    throw new Error(
      `Screenshot differs (${report.data?.differentPixels ?? 'unknown'} pixels): ${current}; diff: ${diff}`
    );
  return report.data;
}

export function assertVisualEnvironment(expected, actual) {
  if (!isDeepStrictEqual(expected, actual)) throw new Error('Visual environment mismatch; baseline comparison refused');
}

export function loadApprovedVisualBaseline(directory) {
  const report = readJson(path.join(directory, 'baseline.json'));
  if (!report.approvedAt || !report.stable || report.frames?.length !== visualFrames.length)
    throw new Error('Missing complete approved visual baseline');
  for (const frame of visualFrames) {
    const record = report.frames.find((item) => item.name === frame.name);
    if (!record || hashFile(path.join(directory, frame.name)) !== record.captures?.[0])
      throw new Error(`Reviewed baseline checksum changed: ${frame.name}`);
  }
  return report;
}

export function approveVisualBaseline(candidate, directory = baselineDirectory) {
  const report = readJson(path.join(candidate, 'candidate.json'));
  if (!report.stable || report.frames?.length !== visualFrames.length || report.restoration?.phase !== 'restored')
    throw new Error('Candidate lacks three stable captures and a completed checkpoint restore');
  for (const frame of visualFrames) {
    const record = report.frames.find((item) => item.name === frame.name);
    if (!record || record.captures?.length !== 3) throw new Error('Incomplete candidate matrix');
    for (let round = 1; round <= 3; round++) {
      const file = path.join(candidate, `round-${round}`, frame.name);
      if (hashFile(file) !== record.captures[round - 1])
        throw new Error('Candidate changed after stability verification');
    }
  }
  mkdirSync(directory, { recursive: true });
  for (const frame of visualFrames)
    copyFileSync(path.join(candidate, 'round-1', frame.name), path.join(directory, frame.name));
  writeFileSync(
    path.join(directory, 'baseline.json'),
    JSON.stringify({ ...report, approvedAt: new Date().toISOString(), candidate: path.resolve(candidate) }, null, 2)
  );
}

function buildGallery() {
  const android = path.join(root, 'android');
  const fixture = mkdtempSync(path.join(root, '.codex-tmp', 'visual-gallery-build-'));
  const config = diagnosticProofFixture(android, fixture);
  writeFileSync(
    path.join(fixture, 'AndroidManifest.xml'),
    config.manifest
      .replace('<activity android:name="com.wz.reader.DiagnosticsProofFaultActivity" android:exported="true"/>', '')
      .replace('wzdiag', 'wzvisual')
  );
  writeFileSync(
    path.join(fixture, 'init.gradle'),
    config.init.replace('dev/diagnostics-proof/index.tsx', 'dev/visual-gallery/index.ts')
  );
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.ENTRY_FILE;
  for (const name of [
    'WZ_ANDROID_KEYSTORE_PATH',
    'WZ_ANDROID_KEYSTORE_PASSWORD',
    'WZ_ANDROID_KEY_ALIAS',
    'WZ_ANDROID_KEY_PASSWORD'
  ])
    delete env[name];
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
    { cwd: android, env, stdio: 'inherit' }
  );
  const apk = path.join(fixture, 'visual-gallery.apk');
  copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), apk);
  console.log(`Gallery APK: ${apk}`);
  return apk;
}

async function main() {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string' },
      apk: { type: 'string' },
      build: { type: 'boolean' },
      'capture-baseline': { type: 'boolean' },
      'approve-baseline': { type: 'string' }
    }
  });
  if (values['approve-baseline']) {
    const candidate = path.resolve(values['approve-baseline']);
    const relative = path.relative(path.join(root, '.codex-tmp', 'visual-runs'), candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Approve an existing ignored visual candidate directory');
    approveVisualBaseline(candidate);
    console.log(`Approved ${visualFrames.length} reviewed visual baselines: ${baselineDirectory}`);
    return;
  }
  if (!values.serial || Boolean(values.apk) === Boolean(values.build))
    throw new Error('Use --serial and exactly one of --apk / --build');
  const baseline = values['capture-baseline'] ? undefined : loadApprovedVisualBaseline(baselineDirectory);
  const version = assertAgentDeviceVersion(root);
  const device = proofDeviceForSerial(values.serial);
  const runs = path.join(root, '.codex-tmp', 'visual-runs');
  mkdirSync(runs, { recursive: true });
  const directory = mkdtempSync(path.join(runs, 'capture-'));
  const apk = values.build ? buildGallery() : path.resolve(values.apk);
  const started = Date.now();
  let report;
  try {
    const outcome = await withProofCheckpoint({
      directory: path.join(root, '.codex-tmp', 'review-remediation-checkpoints', device.avd),
      device,
      prepare: () => device.adb('install', '-r', apk),
      run: async () => {
        const { adb } = device;
        const environment = {
          avd: device.avd,
          fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint').trim(),
          api: adb('shell', 'getprop', 'ro.build.version.sdk').trim(),
          size: adb('shell', 'wm', 'size').trim(),
          density: adb('shell', 'wm', 'density').trim(),
          fontScale: adb('shell', 'settings', 'get', 'system', 'font_scale').trim(),
          locale:
            adb('shell', 'getprop', 'persist.sys.locale').trim() || adb('shell', 'getprop', 'ro.product.locale').trim(),
          navigation: adb('shell', 'settings', 'get', 'secure', 'navigation_mode').trim(),
          timezone: adb('shell', 'getprop', 'persist.sys.timezone').trim(),
          systemTheme: adb('shell', 'cmd', 'uimode', 'night').trim(),
          toolVersion: version
        };
        if (
          environment.api !== '35' ||
          environment.size !== 'Physical size: 1080x2400' ||
          environment.density !== 'Physical density: 420' ||
          Number(environment.fontScale) !== 1 ||
          environment.locale !== 'en-US'
        )
          throw new Error('Expected API35 / 1080x2400 / density420 / font1 / en-US; device settings were not changed');
        if (baseline) assertVisualEnvironment(baseline.environment, environment);
        report = {
          environment,
          apkSha256: hashFile(apk),
          revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
          dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
          frames: []
        };
        adb('shell', 'am', 'start', '-n', `${device.package}/.MainActivity`, '-f', '0x10008000');
        const rounds = values['capture-baseline'] ? 3 : 1;
        for (let round = 1; round <= rounds; round++) {
          const target = path.join(directory, `round-${round}`);
          mkdirSync(target);
          for (const frame of visualFrames) {
            const image = path.join(target, frame.name);
            const session = `visual-${path.basename(directory)}-${round}-${frame.scene}-${frame.theme}-${frame.font}`;
            const args = [
              'test',
              'dev/visual-gallery/capture.ad',
              '--retries',
              '0',
              '--platform',
              'android',
              '--serial',
              values.serial,
              '--device',
              device.avd.replaceAll('_', ' '),
              '--session',
              session,
              '--artifacts-dir',
              path.join(target, `${frame.name}-steps`)
            ];
            for (const [key, value] of Object.entries({
              SCENE: frame.scene,
              THEME: frame.theme,
              FONT: frame.font,
              THEME_LABEL: frame.theme === 'light' ? '浅色' : '深色',
              FONT_LABEL: frame.font === 1 ? '100%' : '140%',
              IMAGE: image.replaceAll('\\', '/')
            }))
              args.push('-e', `${key}=${value}`);
            let output;
            try {
              output = runAgentDevice(args, { capture: true, echoCapture: false });
            } catch (error) {
              writeFileSync(
                path.join(target, `${frame.name}.log`),
                [String(error), error.stdout, error.stderr].filter(Boolean).join('\n')
              );
              try {
                writeFileSync(
                  path.join(target, `failure-${frame.name}`),
                  execFileSync('adb', ['-s', values.serial, 'exec-out', 'screencap', '-p'], {
                    maxBuffer: 16 * 1024 * 1024
                  })
                );
              } catch (captureError) {
                error.captureError = String(captureError);
              }
              throw error;
            }
            writeFileSync(path.join(target, `${frame.name}.log`), output);
            if (round === 1) report.frames.push({ name: frame.name, captures: [hashFile(image)] });
            else {
              compareVisualFrame(
                path.join(directory, 'round-1', frame.name),
                image,
                path.join(target, `diff-${frame.name}`)
              );
              report.frames.find((item) => item.name === frame.name).captures.push(hashFile(image));
            }
            if (
              baseline &&
              hashFile(path.join(baselineDirectory, frame.name)) !==
                baseline.frames.find((item) => item.name === frame.name)?.captures[0]
            )
              throw new Error(`Reviewed baseline checksum changed: ${frame.name}`);
            if (baseline)
              compareVisualFrame(
                path.join(baselineDirectory, frame.name),
                image,
                path.join(target, `diff-${frame.name}`)
              );
          }
        }
        return report;
      }
    });
    report = {
      ...outcome.result,
      restoration: outcome.checkpoint,
      stable: Boolean(values['capture-baseline']),
      elapsedMs: Date.now() - started
    };
    writeFileSync(
      path.join(directory, values['capture-baseline'] ? 'candidate.json' : 'result.json'),
      JSON.stringify(report, null, 2)
    );
    console.log(
      `${values['capture-baseline'] ? 'NEEDS_REVIEW: 3 stable captures' : 'DEVICE_REPLAY_PASS'}; ${visualFrames.length} frames; ${Math.round(report.elapsedMs / 1000)}s; ${directory}`
    );
  } catch (error) {
    writeFileSync(
      path.join(directory, 'result.json'),
      JSON.stringify({ ...report, passed: false, error: String(error), restoration: error.checkpoint }, null, 2)
    );
    throw new Error(`Visual suite failed; evidence: ${directory}`, { cause: error });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
