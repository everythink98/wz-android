import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inputs are generated test patterns, never recordings or downloaded media.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, '.codex-tmp/media-pressure-assets');
const ffmpeg = process.argv[2];
if (!ffmpeg) throw new Error('Usage: node dev/media-pressure-proof/generate-assets.mjs <ffmpeg executable>');
mkdirSync(output, { recursive: true });
const common = ['-hide_banner', '-loglevel', 'error', '-y'];
const inputs = [
  {
    name: 'video.mp4',
    args: [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=15',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=44100',
      '-t',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '32',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '32k',
      '-movflags',
      '+faststart'
    ]
  },
  ...[440, 660].map((frequency, index) => ({
    name: `audio-${index}.wav`,
    args: [
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${frequency}:sample_rate=16000`,
      '-t',
      '30',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le'
    ]
  }))
];
const files = inputs.map(({ name, args }) => {
  execFileSync(ffmpeg, [...common, ...args, path.join(output, name)], { windowsHide: true });
  const data = readFileSync(path.join(output, name));
  if (!data.length) throw new Error(`Generated empty media: ${name}`);
  return { name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), args };
});
const version = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/, 1)[0];
writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify({ generator: 'ffmpeg lavfi', version, files }, null, 2)
);
console.log(JSON.stringify({ output, files }, null, 2));
