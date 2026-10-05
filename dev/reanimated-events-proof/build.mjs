import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeviceProof } from '../../scripts/device-proof-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = buildDeviceProof(root, {
  name: 'reanimated-events-proof',
  entryFile: 'dev/reanimated-events-proof/index.tsx',
  scheme: 'wzreanimatedproof'
});
result.sha256 = createHash('sha256').update(readFileSync(result.apk)).digest('hex');
writeFileSync(path.join(root, '.codex-tmp/reanimated-events-proof-build.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
