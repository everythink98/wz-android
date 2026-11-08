import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import pngjs from 'pngjs';

export function captureDeviceScreenshot(serial, evidence, name) {
  const bytes = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p']);
  writeFileSync(path.join(evidence, `${name}.png`), bytes);
  return pngjs.PNG.sync.read(bytes);
}
