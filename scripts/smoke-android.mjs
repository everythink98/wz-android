import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAgentDeviceVersion, deviceSelectionArgs, runAgentDevice, selectedDeviceName } from './agent-device-runtime.mjs';
import { resolveAndroidDevice, runDeviceReplay } from './run-device-replay.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const appConfig = JSON.parse(readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
const appPackage = appConfig.expo.android.package;
const defaultApkPath = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-x86_64-smoke-dev.apk');
const smokeSession = 'wz-apk-sanity';

const runtimeFailurePatterns = [
  ['Android 崩溃', /FATAL EXCEPTION|AndroidRuntime[^\n]*FATAL|keeps stopping|has stopped/i],
  ['Android ANR', /ANR in com\.wz\.reader|Application Not Responding(?:: com\.wz\.reader)?/i],
  ['React Native RedBox', /\bRedBox\b|Unhandled JS Exception|com\.facebook\.react\.common\.JavascriptException|Log \d+ of \d+/i]
];

function assertNoRuntimeFailure(output, source) {
  const failure = runtimeFailurePatterns.find(([, pattern]) => pattern.test(output));
  if (failure) {
    throw new Error(`${source} 检测到${failure[0]}`);
  }
}

function waitFor(selector, timeout = 60_000, runAgentDeviceCommand = runAgentDevice) {
  runAgentDeviceCommand(['wait', selector, String(timeout), '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
}

function appLogPath(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => /app\.log$/i.test(line));
}

function verifyLogWindow(runAgentDeviceCommand = runAgentDevice) {
  const output = runAgentDeviceCommand(['logs', 'path', '--session', smokeSession, '--platform', 'android'], {
    capture: true,
    cwd: rootDir
  });
  const logPath = appLogPath(output);
  if (!logPath || !existsSync(logPath)) {
    throw new Error('agent-device 未返回可读取的 App 日志路径。');
  }
  assertNoRuntimeFailure(readFileSync(logPath, 'utf8'), 'App 日志');
}

function runAdb(args, { allowFailure = false } = {}) {
  const result = spawnSync('adb', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) {
    throw new Error(`adb 启动失败：${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`adb ${args.join(' ')} 失败：${String(result.stderr || '').trim() || `退出码 ${result.status ?? 'unknown'}`}`);
  }
  return String(result.stdout || '');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function logcatProcessId(line) {
  return line.match(/^\S+\s+\S+\s+(\d+)\s+\d+\s+[A-Z]\s+/)?.[1];
}

function androidPackageLogWindow(output, packageName, marker, currentPids = '') {
  const lines = String(output).split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.includes(marker));
  if (markerIndex < 0) {
    throw new Error('首次启动日志 marker 已从 logcat 窗口丢失，无法形成 APK_SANITY 证据。');
  }
  const windowLines = lines.slice(markerIndex + 1);
  const packagePattern = escapeRegex(packageName);
  const startProcessPattern = new RegExp(`\\bStart proc\\s+(\\d+):${packagePattern}(?:\\b|:)`);
  const crashProcessPattern = new RegExp(`\\bProcess:\\s*${packagePattern}(?::[^,\\s]+)?\\s*,\\s*PID:\\s*(\\d+)`);
  const packagePids = new Set(String(currentPids).match(/\b\d+\b/g) || []);
  for (const line of windowLines) {
    const processId = startProcessPattern.exec(line)?.[1] || crashProcessPattern.exec(line)?.[1];
    if (processId) {
      packagePids.add(processId);
    }
  }
  return windowLines.filter((line) => {
    const processId = logcatProcessId(line);
    return line.includes(packageName) || Boolean(processId && packagePids.has(processId));
  }).join('\n');
}

function verifyFirstLaunchLogWindow(deviceId, marker, logcatStart, runAdbCommand = runAdb) {
  const currentPids = runAdbCommand(['-s', deviceId, 'shell', 'pidof', appPackage], { allowFailure: true });
  const output = runAdbCommand(['-s', deviceId, 'logcat', '-d', '-v', 'threadtime', '-T', logcatStart]);
  assertNoRuntimeFailure(
    androidPackageLogWindow(output, appPackage, marker, currentPids),
    'APK 首次启动日志'
  );
}

function resolveApkPath(value) {
  const apkPath = value ? path.resolve(rootDir, value) : defaultApkPath;
  if (path.extname(apkPath).toLowerCase() !== '.apk' || !existsSync(apkPath)) {
    throw new Error(`未找到待 Smoke 的 APK：${apkPath}`);
  }
  return apkPath;
}

export function withSmokeSession({ selectedDevice, runAgentDeviceCommand = runAgentDevice }, action) {
  const [, deviceName] = deviceSelectionArgs(selectedDevice);
  runAgentDeviceCommand(['boot', '--session', smokeSession, '--platform', 'android', '--device', deviceName, '--headless'], { cwd: rootDir });
  let failure;
  try {
    return action();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      runAgentDeviceCommand(['close', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
    } catch (closeError) {
      if (failure) {
        throw new AggregateError([failure, closeError], 'Android Smoke session 清理失败');
      }
      throw closeError;
    }
  }
}

export function runApkSanity({
  apkPath,
  device,
  marker = `wz-apk-sanity-first-launch-${process.pid}-${Date.now()}`,
  runAdbCommand = runAdb,
  runAgentDeviceCommand = runAgentDevice,
  verifySessionLog
}) {
  try {
    runAgentDeviceCommand(['install', appPackage, apkPath, '--platform', 'android', ...deviceSelectionArgs(device.name)], { cwd: rootDir });
  } catch (error) {
    throw new Error(`BLOCKED_BY_ENV：覆盖安装失败；未卸载 App，也未清数据、Cookie 或登录态。${error instanceof Error ? ` ${error.message}` : ''}`);
  }

  const logcatStart = runAdbCommand(['-s', device.id, 'shell', 'date', '+%s.%3N']).trim();
  if (!/^\d+\.\d+$/.test(logcatStart)) {
    throw new Error('无法读取设备 logcat 起始时间，未执行首次启动。');
  }
  runAdbCommand(['-s', device.id, 'shell', 'log', '-p', 'i', '-t', 'WZ_APK_SANITY', marker]);
  let logging = false;
  const errors = [];
  try {
    runAgentDeviceCommand(['open', appPackage, '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
    runAgentDeviceCommand(['logs', 'clear', '--restart', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
    logging = true;
    runAgentDeviceCommand(['logs', 'mark', 'wz-apk-sanity-start', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
    runAgentDeviceCommand(['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch'], { cwd: rootDir });
    waitFor('id="main-tab-feed"', 60_000, runAgentDeviceCommand);
    const appState = runAgentDeviceCommand(['appstate', '--session', smokeSession, '--platform', 'android', '--json'], {
      capture: true,
      cwd: rootDir,
      echoCapture: false
    });
    if (JSON.parse(appState)?.data?.package !== appPackage) {
      throw new Error(`APK 启动后前台包名不是 ${appPackage}。`);
    }
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      verifyFirstLaunchLogWindow(device.id, marker, logcatStart, runAdbCommand);
    } catch (error) {
      errors.push(error);
    }
    if (logging) {
      try {
        runAgentDeviceCommand(['logs', 'mark', 'wz-apk-sanity-end', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
        runAgentDeviceCommand(['logs', 'stop', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
        (verifySessionLog || (() => verifyLogWindow(runAgentDeviceCommand)))();
      } catch (error) {
        errors.push(error);
      }
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, 'APK_SANITY 失败');
  }
}

async function main() {
  const apkPath = resolveApkPath(process.argv[2]);
  const selectedDevice = selectedDeviceName();
  assertAgentDeviceVersion(rootDir);
  runAgentDevice(['doctor', '--platform', 'android'], { cwd: os.tmpdir() });
  const device = withSmokeSession({ selectedDevice }, () => {
    const smokeDevice = resolveAndroidDevice(selectedDevice);
    runApkSanity({ apkPath, device: smokeDevice });
    return smokeDevice;
  });
  console.log('APK_SANITY');
  await runDeviceReplay({
    apkPath,
    selectedDevice
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
