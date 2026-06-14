import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_ICON = path.join(PROJECT_ROOT, 'assets', 'icon.png');
const OUTPUT_ICON = path.join(PROJECT_ROOT, 'assets', 'adaptive-icon.png');
const CANVAS_SIZE = 1024;
const FOREGROUND_SIZE = 704;
const PADDING = (CANVAS_SIZE - FOREGROUND_SIZE) / 2;

await sharp(SOURCE_ICON)
  .resize(FOREGROUND_SIZE, FOREGROUND_SIZE, { fit: 'contain' })
  .extend({
    top: PADDING,
    bottom: PADDING,
    left: PADDING,
    right: PADDING,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toFile(OUTPUT_ICON);

const output = await sharp(OUTPUT_ICON).metadata();

if (output.width !== CANVAS_SIZE || output.height !== CANVAS_SIZE) {
  throw new Error(`Expected ${OUTPUT_ICON} to be ${CANVAS_SIZE}x${CANVAS_SIZE}, got ${output.width}x${output.height}`);
}

console.log(`Generated ${path.relative(PROJECT_ROOT, OUTPUT_ICON)} from ${path.relative(PROJECT_ROOT, SOURCE_ICON)}`);
