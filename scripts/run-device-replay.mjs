import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAgentDeviceVersion, deviceSelectionArgs, runAgentDevice, selectedDeviceName } from './agent-device-runtime.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const appConfig = JSON.parse(readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
const appPackage = appConfig.expo.android.package;
const expectedVersionName = appConfig.expo.version;
const expectedVersionCode = appConfig.expo.android.versionCode;

export function parseAgentDeviceList(output) {
  const parsed = JSON.parse(output);
  return Array.isArray(parsed?.data?.devices) ? parsed.data.devices : [];
}

export function parseAndroidPackageInfo(output) {
  const versionCode = Number(String(output).match(/\bversionCode=(\d+)/)?.[1]);
  const versionName = String(output).match(/\bversionName=([^\s]+)/)?.[1] || '';
  if (!Number.isInteger(versionCode) || !versionName) {
    throw new Error('无法从设备读取 App versionName/versionCode。');
  }
  return { versionCode, versionName };
}

export function replayDeviceSelectionArgs(device) {
  return deviceSelectionArgs(device.name);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function runAdb(args) {
  const result = spawnSync('adb', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) {
    throw new Error(`adb 启动失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`adb ${args.join(' ')} 失败：${String(result.stderr || '').trim() || `退出码 ${result.status ?? 'unknown'}`}`);
  }
  return String(result.stdout || '');
}

function parseAndroidAgentDeviceRecorders(output) {
  return String(output).split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+.*\bscreenrecord\b.*(\/(?:sdcard|data\/local\/tmp)\/agent-device-recording-\d+\.mp4)(?:\s|$)/);
    return match ? [{ pid: match[1], remotePath: match[2] }] : [];
  });
}

function agentDeviceRecorders(deviceId) {
  return parseAndroidAgentDeviceRecorders(runAdb([
    '-s', deviceId, 'shell', 'ps', '-A', '-o', 'pid=,args='
  ]));
}

const androidRecordingManifestPaths = [
  '/sdcard/agent-device-recording-active.json',
  '/data/local/tmp/agent-device-recording-active.json'
];
const androidRecordingScratchRoots = ['/sdcard', '/data/local/tmp'];

export function parseAndroidRecordingScratchPaths(output, root) {
  if (!androidRecordingScratchRoots.includes(root)) {
    throw new Error(`不受支持的录屏 scratch 根目录：${root}`);
  }
  return String(output).split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => /^(?:agent-device-recording-\d+\.mp4|agent-device-recording-active\.json(?:\.tmp)?)$/.test(name))
    .map((name) => `${root}/${name}`);
}

function androidRecordingScratchPaths(deviceId) {
  return androidRecordingScratchRoots.flatMap((root) => parseAndroidRecordingScratchPaths(
    runAdb(['-s', deviceId, 'shell', 'ls', '-1', root]),
    root
  ));
}

function readAndroidRecordingManifests(deviceId) {
  return androidRecordingManifestPaths.flatMap((manifestPath) => {
    const result = spawnSync('adb', ['-s', deviceId, 'shell', 'cat', manifestPath], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) {
      throw new Error(`adb 启动失败：${result.error.message}`);
    }
    return result.status === 0 && String(result.stdout || '').trim()
      ? [{ manifestPath, text: String(result.stdout).trim() }]
      : [];
  });
}

function isAndroidRecordingPath(value) {
  return typeof value === 'string'
    && /^\/(?:sdcard|data\/local\/tmp)\/agent-device-recording-\d+\.mp4$/.test(value);
}

export function replayRecordingRecoverySession(manifestText, deviceId, replaySession) {
  try {
    const manifest = JSON.parse(manifestText);
    const paths = [
      manifest?.current?.remotePath,
      manifest?.pending?.remotePath,
      ...(Array.isArray(manifest?.chunks) ? manifest.chunks.map((chunk) => chunk?.remotePath) : [])
    ].filter((value) => value !== undefined);
    if (
      manifest?.version !== 1
      || manifest?.deviceId !== deviceId
      || typeof manifest?.sessionName !== 'string'
      || !manifest.sessionName.startsWith(`${replaySession}:test:`)
      || typeof manifest?.recordingId !== 'string'
      || paths.length === 0
      || paths.some((recordingPath) => !isAndroidRecordingPath(recordingPath))
    ) {
      return undefined;
    }
    return manifest.sessionName;
  } catch {
    return undefined;
  }
}

function assertNoExistingAgentDeviceRecording(deviceId) {
  if (
    readAndroidRecordingManifests(deviceId).length > 0
    || agentDeviceRecorders(deviceId).length > 0
    || androidRecordingScratchPaths(deviceId).length > 0
  ) {
    throw new Error('BLOCKED_BY_ENV：设备已有无法归属于本次任务的 agent-device 录屏；未终止进程或删除 scratch。');
  }
}

function recoverOwnedReplayRecording(device, replaySession) {
  const manifests = readAndroidRecordingManifests(device.id);
  const recoverySessions = manifests.map(({ text }) => replayRecordingRecoverySession(text, device.id, replaySession));
  if (recoverySessions.some((sessionName) => !sessionName)) {
    throw new Error('设备存在不属于本次 Replay 的录屏 manifest；已保留进程和 scratch。');
  }
  for (const sessionName of new Set(recoverySessions)) {
    runAgentDevice([
      'record', 'stop',
      '--session', sessionName,
      '--platform', 'android',
      ...replayDeviceSelectionArgs(device)
    ], { cwd: rootDir });
  }
  if (
    readAndroidRecordingManifests(device.id).length > 0
    || agentDeviceRecorders(device.id).length > 0
    || androidRecordingScratchPaths(device.id).length > 0
  ) {
    throw new Error('本次 Replay 的录屏恢复后仍有设备残留；已停止后续 Replay。');
  }
}

function resolveExpectedApkPath(value = process.argv[2] || process.env.WZ_ANDROID_TEST_APK) {
  const apkPath = value ? path.resolve(rootDir, value) : '';
  if (!apkPath || path.extname(apkPath).toLowerCase() !== '.apk' || !existsSync(apkPath)) {
    throw new Error('必须通过参数或 WZ_ANDROID_TEST_APK 指定当前待验证 APK，Replay 不接受未声明身份的已安装 App。');
  }
  return apkPath;
}

function normalizedAndroidDeviceName(value) {
  return String(value).trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

export function matchingAndroidDevices(devices, selectedDevice) {
  const normalizedSelectedDevice = normalizedAndroidDeviceName(selectedDevice);
  return devices.filter((device) => (
    device.platform === 'android'
    && (
      device.id === selectedDevice
      || device.name === selectedDevice
      || normalizedAndroidDeviceName(device.name) === normalizedSelectedDevice
    )
  ));
}

export function resolveAndroidDevice(selectedDevice) {
  const output = runAgentDevice(['devices', '--platform', 'android', '--json'], {
    capture: true,
    cwd: rootDir,
    echoCapture: false
  });
  const matches = matchingAndroidDevices(parseAgentDeviceList(output), selectedDevice);
  if (matches.length !== 1) {
    throw new Error(`无法唯一匹配 Android 设备：${selectedDevice}`);
  }
  if (!matches[0].booted) {
    throw new Error(`BLOCKED_BY_ENV：指定设备尚未启动：${selectedDevice}`);
  }
  return matches[0];
}

function verifyInstalledApk({ apkPath, deviceId }) {
  const packageInfo = parseAndroidPackageInfo(runAdb(['-s', deviceId, 'shell', 'dumpsys', 'package', appPackage]));
  if (packageInfo.versionName !== expectedVersionName || packageInfo.versionCode !== expectedVersionCode) {
    throw new Error(
      `设备 App 身份不匹配：期望 ${expectedVersionName}/${expectedVersionCode}，实际 ${packageInfo.versionName}/${packageInfo.versionCode}。`
    );
  }

  const packagePaths = runAdb(['-s', deviceId, 'shell', 'pm', 'path', appPackage])
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ''))
    .filter(Boolean);
  const installedApkPath = packagePaths.find((candidate) => candidate.endsWith('/base.apk')) || packagePaths[0];
  if (!installedApkPath) {
    throw new Error(`设备上未找到 ${appPackage} 的 base.apk。`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'wz-device-identity-'));
  const localInstalledApk = path.join(tempDir, 'base.apk');
  try {
    runAdb(['-s', deviceId, 'pull', installedApkPath, localInstalledApk]);
    const expectedSha256 = sha256(apkPath);
    const installedSha256 = sha256(localInstalledApk);
    if (expectedSha256 !== installedSha256) {
      throw new Error(`设备 APK SHA-256 不匹配：期望 ${expectedSha256}，实际 ${installedSha256}。`);
    }
    return { ...packageInfo, sha256: installedSha256 };
  } finally {
    if (existsSync(localInstalledApk)) {
      unlinkSync(localInstalledApk);
    }
    rmdirSync(tempDir);
  }
}

function gitIdentity() {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' });
  return {
    revision: revision.status === 0 ? String(revision.stdout).trim() : 'unknown',
    dirty: status.status === 0 && String(status.stdout).trim().length > 0
  };
}

export function listReplayFiles(
  deviceDir = path.join(rootDir, 'tests', 'device'),
  excludedReplayFileNames = []
) {
  const excluded = new Set(excludedReplayFileNames);
  return readdirSync(deviceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ad') && !excluded.has(entry.name))
    .map((entry) => path.join(deviceDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export class ReplayCleanupError extends Error {
  constructor(replayFile, cause) {
    super(`Device Replay 清理失败，已停止后续文件：${path.basename(replayFile)}`, { cause });
    this.name = 'ReplayCleanupError';
  }
}

export async function runReplayBatch(replayFiles, executeReplay) {
  const failures = [];
  for (const replayFile of replayFiles) {
    try {
      await executeReplay(replayFile);
    } catch (error) {
      if (error instanceof ReplayCleanupError) {
        if (failures.length === 0) {
          throw error;
        }
        throw new AggregateError(
          [...failures.map((failure) => failure.error), error],
          `Device Replay 在 ${path.basename(replayFile)} 清理失败并停止；此前执行失败 ${failures.length} 个：${failures.map((failure) => path.basename(failure.replayFile)).join(', ')}`
        );
      }
      failures.push({ replayFile, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Device Replay 失败 ${failures.length}/${replayFiles.length}：${failures.map((failure) => path.basename(failure.replayFile)).join(', ')}`
    );
  }
}

export async function runDeviceReplay({
  apkPath: apkValue,
  selectedDevice: selectedValue,
  excludedReplayFileNames = []
} = {}) {
  const apkPath = resolveExpectedApkPath(apkValue);
  const selectedDevice = selectedDeviceName(selectedValue);
  assertAgentDeviceVersion(rootDir);
  const device = resolveAndroidDevice(selectedDevice);
  const identity = verifyInstalledApk({ apkPath, deviceId: device.id });
  assertNoExistingAgentDeviceRecording(device.id);
  const artifactsDir = path.join(rootDir, 'tmp', 'agent-device');
  mkdirSync(artifactsDir, { recursive: true });
  const replayFiles = listReplayFiles(undefined, excludedReplayFileNames);
  if (replayFiles.length === 0) {
    throw new Error('tests/device 中没有可执行的 .ad Replay。');
  }

  const git = gitIdentity();
  console.log(
    `Replay identity: revision=${git.revision} dirty=${git.dirty} version=${identity.versionName} versionCode=${identity.versionCode} apkSha256=${identity.sha256} device=${device.name}(${device.id})`
  );
  await runReplayBatch(replayFiles, async (replayFile) => {
    const replayName = path.basename(replayFile, '.ad');
    const replaySession = `wz-replay-${process.pid}-${replayName}`;
    const replayArtifactsDir = path.join(artifactsDir, replayName);
    const junitPath = path.join(artifactsDir, `${replayName}.junit.xml`);
    mkdirSync(replayArtifactsDir, { recursive: true });
    let replayError;
    let cleanupError;
    try {
      runAgentDevice([
        'test', replayFile,
        '--session', replaySession,
        ...replayDeviceSelectionArgs(device),
        '--timeout', '180000',
        '--retries', '0',
        '--fail-fast',
        '--record-video',
        '--artifacts-dir', replayArtifactsDir,
        '--reporter', 'default',
        '--reporter', `junit:${junitPath}`
      ], { cwd: rootDir });
    } catch (error) {
      replayError = error;
    }
    try {
      recoverOwnedReplayRecording(device, replaySession);
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError) {
      const cause = replayError
        ? new AggregateError([replayError, cleanupError], `${replayName} 执行和清理均失败`)
        : cleanupError;
      throw new ReplayCleanupError(replayFile, cause);
    }
    if (replayError) {
      throw replayError;
    }
  });
  console.log('DEVICE_REPLAY_PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runDeviceReplay().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
