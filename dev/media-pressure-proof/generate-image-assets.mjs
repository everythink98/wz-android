import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ffmpeg = process.argv[2];
if (!ffmpeg) throw new Error('Usage: node dev/media-pressure-proof/generate-image-assets.mjs <ffmpeg>');
const output = new URL('../../.codex-tmp/media-pressure-assets/', import.meta.url);
mkdirSync(output, { recursive: true });
const samples = Array.from({ length: 15 }, (_, index) => {
  const color = ['yellow', 'cyan', 'lime'][index % 3];
  const source = `testsrc2=size=384x216:rate=5,hue=h=${index * 17},drawbox=x=${8 + index * 9}:y=18:w=48:h=52:c=${color}:t=fill`;
  const encode = (options) =>
    execFileSync(
      ffmpeg,
      ['-v', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', source, '-threads', '1', ...options, 'pipe:1'],
      {
        windowsHide: true
      }
    );
  const images = encode(['-frames:v', '7', '-q:v', '10', '-c:v', 'mjpeg', '-f', 'image2pipe']);
  const photos = [];
  const endMarker = Buffer.from([0xff, 0xd9]);
  for (let offset = 0; offset < images.length;) {
    if (images.readUInt16BE(offset) !== 0xffd8) throw new Error('Missing JPEG start marker');
    const end = images.indexOf(endMarker, offset + 2);
    if (end === -1) throw new Error('Missing JPEG end marker');
    photos.push('data:image/jpeg;base64,' + images.subarray(offset, end + 2).toString('base64'));
    offset = end + 2;
  }
  if (new Set(photos).size !== 7) throw new Error('Expected seven distinct frames per topic');
  return {
    animation: 'data:image/gif;base64,' + encode(['-frames:v', '5', '-loop', '0', '-f', 'gif']).toString('base64'),
    photos
  };
});
if (new Set(samples.flatMap(({ animation, photos }) => [animation, ...photos])).size !== samples.length * 8) {
  throw new Error('Each browsed image must be distinct across all fifteen topics');
}
const manifest = new URL('topic-image-samples.json', output);
writeFileSync(manifest, JSON.stringify(samples));
console.log(fileURLToPath(manifest));
