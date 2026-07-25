import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizedAndroidDeviceName,
  runDeviceReplay
} from './run-device-replay.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), '..');

/** @param {Record<string, string | undefined>} [environment] */
export function loggedOutDeviceName(environment = process.env) {
  const device = String(environment.WZ_ANDROID_LOGGED_OUT_DEVICE || '').trim();
  if (!device) {
    throw new Error('必须设置 WZ_ANDROID_LOGGED_OUT_DEVICE；未登录验收不会使用主测试设备。');
  }
  const protectedDevices = [
    environment.WZ_ANDROID_TEST_DEVICE,
    environment.WZ_ANDROID_SMOKE_DEVICE
  ].map((value) => normalizedAndroidDeviceName(value || '')).filter(Boolean);
  if (protectedDevices.includes(normalizedAndroidDeviceName(device))) {
    throw new Error('WZ_ANDROID_LOGGED_OUT_DEVICE 必须与主测试/Smoke 设备不同。');
  }
  return device;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runDeviceReplay({
    selectedDevice: loggedOutDeviceName(),
    replayDirectory: path.join(rootDir, 'tests', 'device-logged-out')
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
