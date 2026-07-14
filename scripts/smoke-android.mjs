import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertAgentDeviceVersion, deviceSelectionArgs, runAgentDevice, selectedDeviceName } from './agent-device-runtime.mjs';
import { runDeviceReplay } from './run-device-replay.mjs';

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

function waitFor(selector, timeout = 60_000) {
  runAgentDevice(['wait', selector, String(timeout), '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
}

function appLogPath(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => /app\.log$/i.test(line));
}

function verifyLogWindow() {
  const output = runAgentDevice(['logs', 'path', '--session', smokeSession, '--platform', 'android'], {
    capture: true,
    cwd: rootDir
  });
  const logPath = appLogPath(output);
  if (!logPath || !existsSync(logPath)) {
    throw new Error('agent-device 未返回可读取的 App 日志路径。');
  }
  assertNoRuntimeFailure(readFileSync(logPath, 'utf8'), 'App 日志');
}

function resolveApkPath(value) {
  const apkPath = value ? path.resolve(rootDir, value) : defaultApkPath;
  if (path.extname(apkPath).toLowerCase() !== '.apk' || !existsSync(apkPath)) {
    throw new Error(`未找到待 Smoke 的 APK：${apkPath}`);
  }
  return apkPath;
}

function bootSelectedDevice() {
  const [, selectedDevice] = deviceSelectionArgs();
  runAgentDevice(['boot', '--platform', 'android', '--device', selectedDevice, '--headless'], { cwd: rootDir });
}

async function main() {
  const apkPath = resolveApkPath(process.argv[2]);
  const selectedDevice = selectedDeviceName();
  assertAgentDeviceVersion(rootDir);
  runAgentDevice(['doctor', '--platform', 'android'], { cwd: os.tmpdir() });
  bootSelectedDevice();
  try {
    runAgentDevice(['install', appPackage, apkPath, '--platform', 'android', ...deviceSelectionArgs()], { cwd: rootDir });
  } catch (error) {
    throw new Error(`BLOCKED_BY_ENV：覆盖安装失败；未卸载 App，也未清数据、Cookie 或登录态。${error instanceof Error ? ` ${error.message}` : ''}`);
  }

  let opened = false;
  let logging = false;
  const errors = [];
  try {
    runAgentDevice(['open', appPackage, '--session', smokeSession, '--platform', 'android', ...deviceSelectionArgs()], { cwd: rootDir });
    opened = true;
    runAgentDevice(['logs', 'clear', '--restart', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
    logging = true;
    runAgentDevice(['logs', 'mark', 'wz-apk-sanity-start', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
    runAgentDevice(['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch'], { cwd: rootDir });
    waitFor('id="feed-list-ready-all"', 60_000);
    const appState = runAgentDevice(['appstate', '--session', smokeSession, '--platform', 'android', '--json'], {
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
    if (logging) {
      try {
        runAgentDevice(['logs', 'mark', 'wz-apk-sanity-end', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
        runAgentDevice(['logs', 'stop', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
        verifyLogWindow();
      } catch (error) {
        errors.push(error);
      }
    }
    if (opened) {
      try {
        runAgentDevice(['close', '--session', smokeSession, '--platform', 'android'], { cwd: rootDir });
      } catch (error) {
        errors.push(error);
      }
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, 'APK_SANITY 失败');
  }
  console.log('APK_SANITY');
  await runDeviceReplay({ apkPath, selectedDevice });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
