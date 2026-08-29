import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : '8081';
const bundleUrl = `http://127.0.0.1:${port}/dev/visual-gallery/index.bundle?platform=android&dev=true&minify=false`;
const clientUrl = `exp+wz-android://expo-development-client/?url=${encodeURIComponent(bundleUrl)}`;

console.log(`Visual Gallery bundle: ${bundleUrl}`);
console.log(`Development client URL: ${clientUrl}`);

const expoCli = path.join(process.cwd(), 'node_modules', 'expo', 'bin', 'cli');
const child = spawn(process.execPath, [expoCli, 'start', '--dev-client', '--localhost', ...args], {
  env: process.env,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
