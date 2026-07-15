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

export function androidRecordingScratchCleanupArgs(deviceId) {
  return [
    '-s',
    deviceId,
    'shell',
    'rm -f /sdcard/agent-device-recording-*.mp4 /sdcard/agent-device-recording-active.json /sdcard/agent-device-recording-active.json.tmp /data/local/tmp/agent-device-recording-*.mp4 /data/local/tmp/agent-device-recording-active.json /data/local/tmp/agent-device-recording-active.json.tmp'
  ];
}

export function parseAndroidAgentDeviceRecorders(output) {
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

function localAgentDeviceDaemonPids() {
  let result;
  if (process.platform === 'win32') {
    const query = [
      "$ErrorActionPreference = 'Stop'",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'agent-device' -and $_.CommandLine -match '[\\\\/]internal[\\\\/]daemon\\.js' -and $_.CommandLine -notmatch '\\bmcp\\b' } | ForEach-Object { $_.ProcessId }"
    ].join('; ');
    result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', query
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    result = spawnSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  if (result.error || result.status !== 0) {
    throw new Error(`无法读取 agent-device daemon 进程：${result.error?.message || String(result.stderr || '').trim()}`);
  }
  if (process.platform === 'win32') {
    return new Set(String(result.stdout || '').match(/\d+/g)?.map(Number) || []);
  }
  return new Set(String(result.stdout || '').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+.*agent-device.*[\\/]internal[\\/]daemon\.js\b/);
    return match && !/\bmcp\b/.test(line) ? [Number(match[1])] : [];
  }));
}

function stopNewLocalAgentDeviceDaemons(previousPids) {
  for (const pid of localAgentDeviceDaemonPids()) {
    if (previousPids.has(pid) || pid === process.pid) {
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        throw error;
      }
    }
  }
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function cleanupAgentDeviceRecordingScratch(deviceId) {
  const recorders = agentDeviceRecorders(deviceId);
  for (const recorder of recorders) {
    runAdb(['-s', deviceId, 'shell', 'kill', '-2', recorder.pid]);
  }
  if (recorders.length > 0) {
    await delay(750);
  }
  const remainingRecorders = agentDeviceRecorders(deviceId);
  for (const recorder of remainingRecorders) {
    runAdb(['-s', deviceId, 'shell', 'kill', '-9', recorder.pid]);
  }
  if (remainingRecorders.length > 0) {
    await delay(100);
  }
  runAdb(androidRecordingScratchCleanupArgs(deviceId));
  if (agentDeviceRecorders(deviceId).length > 0) {
    throw new Error('BLOCKED_BY_ENV：agent-device 录屏进程未能停止，未开始新的 Replay。');
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

function resolveAndroidDevice(selectedDevice) {
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

export function listReplayFiles(deviceDir = path.join(rootDir, 'tests', 'device')) {
  return readdirSync(deviceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ad'))
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

function closeDefaultReplaySession() {
  try {
    runAgentDevice(['close', '--platform', 'android'], {
      capture: true,
      cwd: rootDir,
      echoCapture: false
    });
  } catch {
    // Preserve the original Replay failure; this is best-effort tool cleanup only.
  }
}

export async function runDeviceReplay({ apkPath: apkValue, selectedDevice: selectedValue } = {}) {
  const apkPath = resolveExpectedApkPath(apkValue);
  const selectedDevice = selectedDeviceName(selectedValue);
  assertAgentDeviceVersion(rootDir);
  const device = resolveAndroidDevice(selectedDevice);
  const identity = verifyInstalledApk({ apkPath, deviceId: device.id });
  await cleanupAgentDeviceRecordingScratch(device.id);
  const artifactsDir = path.join(rootDir, 'tmp', 'agent-device');
  mkdirSync(artifactsDir, { recursive: true });
  const replayFiles = listReplayFiles();
  if (replayFiles.length === 0) {
    throw new Error('tests/device 中没有可执行的 .ad Replay。');
  }

  const git = gitIdentity();
  console.log(
    `Replay identity: revision=${git.revision} dirty=${git.dirty} version=${identity.versionName} versionCode=${identity.versionCode} apkSha256=${identity.sha256} device=${device.name}(${device.id})`
  );
  await runReplayBatch(replayFiles, async (replayFile) => {
    const replayName = path.basename(replayFile, '.ad');
    const replayArtifactsDir = path.join(artifactsDir, replayName);
    const junitPath = path.join(artifactsDir, `${replayName}.junit.xml`);
    mkdirSync(replayArtifactsDir, { recursive: true });
    const localDaemonPidsBefore = localAgentDeviceDaemonPids();
    let replayError;
    let cleanupError;
    try {
      runAgentDevice([
        'test', replayFile,
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
      closeDefaultReplaySession();
    }
    try {
      stopNewLocalAgentDeviceDaemons(localDaemonPidsBefore);
      await cleanupAgentDeviceRecordingScratch(device.id);
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
