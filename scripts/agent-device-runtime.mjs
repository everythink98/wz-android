import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const MIN_AGENT_DEVICE_VERSION = '0.19.0';

export function selectedDeviceName(device = process.env.WZ_ANDROID_TEST_DEVICE || process.env.WZ_ANDROID_SMOKE_DEVICE) {
  const selectedDevice = String(device || '').trim();
  if (!selectedDevice) {
    throw new Error(
      '必须设置 WZ_ANDROID_TEST_DEVICE（发布 Smoke 可沿用 WZ_ANDROID_SMOKE_DEVICE），不会自动选择、启动或重置其他设备。'
    );
  }
  return selectedDevice;
}

export function deviceSelectionArgs(device) {
  return ['--device', selectedDeviceName(device)];
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

export function runAgentDevice(
  args,
  { capture = false, cwd = process.cwd(), echoCapture = true, env = process.env } = {}
) {
  const executable = agentDeviceCommand();
  const result = spawnSync(executable.command, [...executable.prefixArgs, ...args], {
    cwd,
    env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (capture && echoCapture) {
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
  return capturedAgentDeviceOutput(result);
}

export function capturedAgentDeviceOutput(result) {
  return String(result.stdout || '');
}

function versionParts(version) {
  const match = String(version)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
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

export function assertAgentDeviceVersion(cwd = process.cwd()) {
  const version = runAgentDevice(['--version'], { capture: true, cwd, echoCapture: false }).trim();
  if (!isVersionSupported(version)) {
    throw new Error(`需要 agent-device >= ${MIN_AGENT_DEVICE_VERSION}，当前为 ${version || 'unknown'}。`);
  }
  return version;
}
