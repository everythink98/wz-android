import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');
const appConfig = JSON.parse(readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
const appPackage = appConfig.expo.android.package;
const defaultApkPath = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-x86_64-smoke-dev.apk');
const smokeSession = 'wz-release-smoke';

export const MIN_AGENT_DEVICE_VERSION = '0.14.0';
export const READ_ONLY_PRESS_TARGETS = Object.freeze([
  'id="main-tab-search"',
  'id="main-tab-library"',
  'id="main-tab-more"',
  'label="展开问题诊断"',
  'id="main-tab-feed"',
  'id="search-submit"',
  'id="search-result-first"',
  'id="library-favorite-first"',
  'id="feed-topic-first"',
  'id="topic-author"',
  'id="user-topic-first"',
  'label="返回"'
]);

const runtimeFailurePatterns = [
  ['Android 崩溃', /FATAL EXCEPTION|AndroidRuntime[^\n]*FATAL|keeps stopping|has stopped/i],
  ['Android ANR', /ANR in com\.wz\.reader|Application Not Responding(?:: com\.wz\.reader)?/i],
  ['React Native RedBox', /\bRedBox\b|Unhandled JS Exception|com\.facebook\.react\.common\.JavascriptException|Log \d+ of \d+/i]
];

export function deviceSelectionArgs(device = process.env.WZ_ANDROID_SMOKE_DEVICE) {
  const selectedDevice = String(device || '').trim();
  if (!selectedDevice) {
    throw new Error('必须设置 WZ_ANDROID_SMOKE_DEVICE，smoke 不会自动选择或启动其他模拟器。');
  }
  return ['--device', selectedDevice];
}

function executableOnPath(fileName) {
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(entry.replace(/^"|"$/g, ''), fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function agentDeviceCommand() {
  if (process.platform !== 'win32') {
    return { command: 'agent-device', prefixArgs: [] };
  }
  const shimPath = executableOnPath('agent-device.ps1');
  if (!shimPath) {
    throw new Error('未找到已安装的 agent-device。请先将可信安装加入 PATH。');
  }
  return {
    command: 'powershell.exe',
    prefixArgs: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', shimPath]
  };
}

function runAgentDevice(args, { capture = false, cwd = rootDir } = {}) {
  const executable = agentDeviceCommand();
  const result = spawnSync(executable.command, [...executable.prefixArgs, ...args], {
    cwd,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (capture) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
  if (result.error) {
    throw new Error(`agent-device 启动失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`agent-device ${args.join(' ')} 失败（退出码 ${result.status ?? 'unknown'}）`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function tryAgentDevice(args) {
  const executable = agentDeviceCommand();
  const result = spawnSync(executable.command, [...executable.prefixArgs, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error) {
    throw new Error(`agent-device 启动失败：${result.error.message}`);
  }
  return result.status === 0;
}

function versionParts(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  return match ? { numbers: match.slice(1, 4).map(Number), suffix: match[4] } : null;
}

export function isVersionSupported(version) {
  const actual = versionParts(version);
  const minimum = versionParts(MIN_AGENT_DEVICE_VERSION);
  if (!actual || !minimum) {
    return false;
  }
  for (let index = 0; index < minimum.numbers.length; index += 1) {
    if (actual.numbers[index] !== minimum.numbers[index]) {
      return actual.numbers[index] > minimum.numbers[index];
    }
  }
  return !actual.suffix.startsWith('-');
}

function assertNoRuntimeFailure(output, source) {
  const failure = runtimeFailurePatterns.find(([, pattern]) => pattern.test(output));
  if (failure) {
    throw new Error(`${source} 检测到${failure[0]}`);
  }
}

function waitFor(selector, timeout = 60_000) {
  runAgentDevice(['wait', selector, String(timeout), '--session', smokeSession, '--platform', 'android']);
}

function elementAttrsFromOutput(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function searchOutcomeFromCompletionAttrs(output) {
  const label = String(elementAttrsFromOutput(output)?.label || '');
  if (label === '搜索结果，已完成，有可打开结果') {
    return 'result';
  }
  if (label === '搜索结果，已完成，结构化回退') {
    return 'fallback';
  }
  return null;
}

export function searchQueryIsPreserved(output, query) {
  const value = String(elementAttrsFromOutput(output)?.value || '').trim().toLowerCase();
  const normalizedQuery = String(query).trim().toLowerCase();
  return value === normalizedQuery;
}

export function libraryOutcomeFromCompletionAttrs(output) {
  const label = String(elementAttrsFromOutput(output)?.label || '');
  if (label === '收藏列表，已加载，有收藏') {
    return 'result';
  }
  if (label === '收藏列表，已加载，没有收藏') {
    return 'empty';
  }
  return null;
}

function assertSearchQueryPreserved(query) {
  const attrs = runAgentDevice(['get', 'attrs', 'id="search-query"', '--session', smokeSession, '--platform', 'android'], { capture: true });
  assertNoRuntimeFailure(attrs, '搜索返回状态');
  if (!searchQueryIsPreserved(attrs, query)) {
    throw new Error(`搜索返回后未保留查询词：${query}`);
  }
}

function findSearchOutcome() {
  const attrs = runAgentDevice(['get', 'attrs', 'id="search-complete"', '--session', smokeSession, '--platform', 'android'], { capture: true });
  const outcome = searchOutcomeFromCompletionAttrs(attrs);
  if (outcome === 'result') {
    if (!tryAgentDevice(['is', 'visible', 'id="search-result-first"', '--session', smokeSession, '--platform', 'android'])) {
      throw new Error('搜索声明存在结果，但首条结果不可见或不可打开。');
    }
    return outcome;
  }
  throw new Error(outcome === 'fallback'
    ? '搜索只返回 error/auth/empty，未完成搜索→详情只读验收。'
    : '搜索完成后没有可打开结果。');
}

function findLibraryOutcome() {
  const attrs = runAgentDevice(['get', 'attrs', 'id="library-favorites-ready"', '--session', smokeSession, '--platform', 'android'], { capture: true });
  const outcome = libraryOutcomeFromCompletionAttrs(attrs);
  if (outcome === 'result') {
    return outcome;
  }
  if (outcome === 'empty' && tryAgentDevice(['is', 'visible', 'id="library-favorites-empty"', '--session', smokeSession, '--platform', 'android'])) {
    throw new Error('本机没有可用于只读 smoke 的收藏，无法验证收藏→详情→用户→返回。');
  }
  throw new Error('收藏页加载完成后既没有可打开收藏，也没有结构化空态。');
}

function pressReadOnly(selector) {
  if (!READ_ONLY_PRESS_TARGETS.includes(selector)) {
    throw new Error(`smoke 拒绝未列入只读白名单的交互：${selector}`);
  }
  runAgentDevice(['press', selector, '--timeout', '60000', '--session', smokeSession, '--platform', 'android']);
}

function systemBack() {
  runAgentDevice(['back', '--system', '--session', smokeSession, '--platform', 'android']);
}

function appLogPath(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).find((line) => /app\.log$/i.test(line));
}

function verifyLogWindow() {
  const output = runAgentDevice(['logs', 'path', '--session', smokeSession, '--platform', 'android'], { capture: true });
  const logPath = appLogPath(output);
  if (!logPath || !existsSync(logPath)) {
    throw new Error('agent-device 未返回可读取的 App 日志路径。');
  }
  assertNoRuntimeFailure(readFileSync(logPath, 'utf8'), 'App 日志');
}

function resolveApkPath(value) {
  const apkPath = value ? path.resolve(rootDir, value) : defaultApkPath;
  if (path.extname(apkPath).toLowerCase() !== '.apk' || !existsSync(apkPath)) {
    throw new Error(`未找到待 smoke 的 APK：${apkPath}`);
  }
  return apkPath;
}

function bootSelectedDevice() {
  const [, selectedDevice] = deviceSelectionArgs();
  runAgentDevice(['boot', '--platform', 'android', '--device', selectedDevice, '--headless']);
}

async function main() {
  const apkPath = resolveApkPath(process.argv[2]);
  const version = runAgentDevice(['--version'], { capture: true }).trim();
  if (!isVersionSupported(version)) {
    throw new Error(`需要 agent-device >= ${MIN_AGENT_DEVICE_VERSION}，当前为 ${version || 'unknown'}。`);
  }

  runAgentDevice(['doctor', '--platform', 'android'], { cwd: os.tmpdir() });
  bootSelectedDevice();
  runAgentDevice(['install', appPackage, apkPath, '--platform', 'android', ...deviceSelectionArgs()]);

  let opened = false;
  let logging = false;
  const errors = [];
  try {
    runAgentDevice(['open', appPackage, '--session', smokeSession, '--platform', 'android', ...deviceSelectionArgs()]);
    opened = true;
    runAgentDevice(['logs', 'clear', '--restart', '--session', smokeSession, '--platform', 'android']);
    logging = true;
    runAgentDevice(['logs', 'mark', 'wz-smoke-start', '--session', smokeSession, '--platform', 'android']);
    runAgentDevice(['open', appPackage, '--session', smokeSession, '--platform', 'android', '--relaunch']);
    runAgentDevice(['wait', '60000', '--session', smokeSession, '--platform', 'android']);
    waitFor('id="feed-topic-first"', 60_000);
    pressReadOnly('id="main-tab-search"');
    waitFor('id="search-query"');
    runAgentDevice(['fill', 'id="search-query"', 'codex', '--session', smokeSession, '--platform', 'android']);
    pressReadOnly('id="search-submit"');
    runAgentDevice(['keyboard', 'dismiss', '--session', smokeSession, '--platform', 'android']);
    waitFor('id="search-complete"', 60_000);
    assertSearchQueryPreserved('codex');
    findSearchOutcome();
    pressReadOnly('id="search-result-first"');
    waitFor('id="topic-detail-loaded"', 60_000);
    pressReadOnly('id="topic-author"');
    waitFor('id="user-screen-loaded"', 60_000);
    waitFor('id="user-topic-first"', 60_000);
    pressReadOnly('id="user-topic-first"');
    waitFor('id="topic-detail-loaded"', 60_000);
    systemBack();
    waitFor('id="user-screen-loaded"', 60_000);
    systemBack();
    waitFor('id="topic-detail-loaded"', 60_000);
    systemBack();
    waitFor('id="search-complete"', 60_000);
    assertSearchQueryPreserved('codex');
    pressReadOnly('id="main-tab-search"');
    waitFor('id="search-complete"', 60_000);
    assertSearchQueryPreserved('codex');
    pressReadOnly('id="main-tab-library"');
    waitFor('id="library-favorites-ready"', 60_000);
    findLibraryOutcome();
    waitFor('id="library-favorite-first"');
    pressReadOnly('id="library-favorite-first"');
    waitFor('id="topic-detail-loaded"', 60_000);
    pressReadOnly('id="topic-author"');
    waitFor('id="user-screen-loaded"', 60_000);
    systemBack();
    waitFor('id="topic-detail-loaded"', 60_000);
    systemBack();
    waitFor('id="library-favorites-ready"', 60_000);
    if (findLibraryOutcome() !== 'result') {
      throw new Error('从收藏详情返回后收藏列表状态丢失。');
    }
    pressReadOnly('id="main-tab-more"');
    waitFor('text="关于阅坛"');
    pressReadOnly('label="展开问题诊断"');
    waitFor('label="生成并分享诊断日志"');
    pressReadOnly('id="main-tab-feed"');
    waitFor('id="feed-topic-first"', 60_000);

    pressReadOnly('id="feed-topic-first"');
    waitFor('id="topic-detail-loaded"', 60_000);
    pressReadOnly('id="topic-author"');
    waitFor('id="user-screen-loaded"', 60_000);
    systemBack();
    waitFor('id="topic-detail-loaded"', 60_000);
    systemBack();
    waitFor('id="feed-topic-first"', 60_000);
  } catch (error) {
    errors.push(error);
  } finally {
    if (logging) {
      try {
        runAgentDevice(['logs', 'mark', 'wz-smoke-end', '--session', smokeSession, '--platform', 'android']);
      } catch (error) {
        errors.push(error);
      }
      try {
        runAgentDevice(['logs', 'stop', '--session', smokeSession, '--platform', 'android']);
      } catch (error) {
        errors.push(error);
      }
      try {
        verifyLogWindow();
      } catch (error) {
        errors.push(error);
      }
    }
    if (opened) {
      try {
        runAgentDevice(['close', '--session', smokeSession, '--platform', 'android']);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, 'Android smoke 失败');
  }
  console.log('Android 只读 smoke 通过。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
