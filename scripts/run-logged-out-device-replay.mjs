import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchingAndroidDevices, resolveAndroidDevice, runDeviceReplay } from './run-device-replay.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');

/**
 * @param {Record<string, string | undefined>} [environment]
 * @param {typeof resolveAndroidDevice} [resolveDevice]
 */
export function resolveLoggedOutDevice(environment = process.env, resolveDevice = resolveAndroidDevice) {
  const selection = environment.WZ_ANDROID_LOGGED_OUT_DEVICE?.trim();
  if (!selection) {
    throw new Error('必须设置 WZ_ANDROID_LOGGED_OUT_DEVICE；未登录验收不会使用主测试设备。');
  }
  const device = resolveDevice(selection);
  for (const value of [environment.WZ_ANDROID_TEST_DEVICE, environment.WZ_ANDROID_SMOKE_DEVICE]) {
    const protectedSelection = value?.trim();
    if (protectedSelection && matchingAndroidDevices([device], protectedSelection).length > 0) {
      throw new Error('WZ_ANDROID_LOGGED_OUT_DEVICE 必须与主测试/Smoke 设备不同。');
    }
  }
  return device;
}

async function main() {
  const device = resolveLoggedOutDevice();
  await runDeviceReplay({
    selectedDevice: device.id,
    device,
    replayDirectory: path.join(rootDir, 'tests', 'device-logged-out')
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
